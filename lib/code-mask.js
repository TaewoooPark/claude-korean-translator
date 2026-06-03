// lib/code-mask.js
// Placeholder masking for machine translation (Chrome on-device Translator).
//
// WHY: A neural MT model translates EVERYTHING it sees — it will turn `useEffect`
// into `UseEffect`, translate code comments, mangle URLs, and collapse code-block
// newlines. The Anthropic backend avoids this with prompt instructions, but a raw
// MT engine has no such knob. So before translating we PROTECT non-natural-language
// spans, and restore them verbatim afterwards.
//
// Two-layer strategy:
//   1) Fenced code blocks (```...```) are SPLIT OUT entirely — never sent to the
//      MT — so their contents and line breaks are byte-for-byte preserved.
//   2) Inside the remaining prose, inline spans (inline `code`, URLs, emails,
//      file paths, Windows/UNIX paths) are replaced with sentinel placeholders
//      using rare math-bracket characters ⟦n⟧ (U+27E6/U+27E7) that MT engines
//      reliably pass through untouched. After translation they are swapped back.
//
// Exposed as a global (window.CtxMask) so it works both in classic content
// scripts and in extension pages via <script>.
(function () {
  "use strict";

  // Rare bracket chars — MT leaves these alone. Tolerate stray spaces MT may add.
  const PH_OPEN = "⟦";  // ⟦
  const PH_CLOSE = "⟧"; // ⟧
  const phToken = (n) => PH_OPEN + n + PH_CLOSE;
  const phRegex = (n) => new RegExp(PH_OPEN + "\\s*" + n + "\\s*" + PH_CLOSE);

  // Inline patterns that must never be translated. All are capture-group-free,
  // so the whole match IS the protected span (paths use a lookbehind, not a
  // capture group, to avoid swallowing a leading space).
  const INLINE_PATTERNS = [
    /`[^`\n]+`/g,                              // inline code: `foo()`
    /\bhttps?:\/\/[^\s<>()]+/gi,               // URLs
    /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, // emails
    /\b[A-Za-z]:\\[^\s]+/g,                    // Windows paths: C:\foo\bar
    /(?<![\w.@/-])\.{0,2}\/[\w.@/-]*[\w]/g     // UNIX-ish paths: ./src/x, /usr/bin
  ];

  // Mask inline protected spans in a single prose chunk.
  function maskInline(text) {
    const store = [];
    let out = text;
    for (const pat of INLINE_PATTERNS) {
      out = out.replace(pat, (m) => phToken(store.push(m) - 1));
    }
    return { masked: out, store };
  }

  function unmaskInline(text, store) {
    let out = text;
    for (let i = 0; i < store.length; i++) {
      const re = phRegex(i);
      // Replace once; if MT duplicated/dropped a placeholder, fall back gracefully.
      if (re.test(out)) out = out.replace(re, () => store[i]);
    }
    return out;
  }

  // Split text into an ordered list of parts: { type: "code"|"prose", text }.
  // Fenced code blocks (``` or ~~~) become "code" parts and are never translated.
  function splitFences(text) {
    const parts = [];
    const fence = /(^|\n)([ \t]*)(```|~~~)[^\n]*\n[\s\S]*?\n[ \t]*\3[ \t]*(?=\n|$)/g;
    let last = 0, m;
    while ((m = fence.exec(text)) !== null) {
      const start = m.index + (m[1] ? m[1].length : 0); // keep the leading newline in prose
      if (start > last) parts.push({ type: "prose", text: text.slice(last, start) });
      parts.push({ type: "code", text: text.slice(start, fence.lastIndex) });
      last = fence.lastIndex;
    }
    if (last < text.length) parts.push({ type: "prose", text: text.slice(last) });
    if (!parts.length) parts.push({ type: "prose", text });
    return parts;
  }

  // A line worth translating has at least one Hangul or Latin letter.
  // (Skips rules like "---", table separators "| --- |", emoji-only lines.)
  function isTranslatable(line) {
    return /[A-Za-z가-힣]/.test(line);
  }

  // Translate `text` while preserving code/URLs/paths AND markdown structure.
  // translateFn: async (plainProse: string) => translatedProse: string
  //
  // CRITICAL: prose is translated LINE BY LINE, not as one blob. On-device NMT
  // models collapse newlines and hallucinate ("0000…") when handed a large
  // structured markdown block; feeding one line at a time keeps each input short
  // and in-distribution, so headings/lists/line breaks survive and quality holds.
  async function translateMasked(text, translateFn) {
    if (!text || !text.trim()) return text || "";
    const parts = splitFences(text);
    const outParts = [];
    for (const part of parts) {
      if (part.type === "code") { outParts.push(part.text); continue; }     // never translate code
      const lines = part.text.split("\n");
      const outLines = [];
      for (const line of lines) {
        if (!line.trim() || !isTranslatable(line)) { outLines.push(line); continue; }
        const { masked, store } = maskInline(line);
        let translated;
        try { translated = await translateFn(masked); }
        catch (e) { translated = masked; } // keep original on failure, don't drop the line
        outLines.push(unmaskInline(translated, store));
      }
      outParts.push(outLines.join("\n"));
    }
    return outParts.join("");
  }

  window.CtxMask = { maskInline, unmaskInline, splitFences, translateMasked, isTranslatable };
})();
