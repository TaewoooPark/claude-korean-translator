// lib/md-render.js
// Tiny, dependency-free, XSS-safe Markdown -> DOM renderer for the injected
// Korean translation block. Builds real DOM nodes (never innerHTML), so the
// translated text renders with proper headings, lists, code blocks, bold,
// inline code, links, and line breaks instead of raw markdown characters.
// Exposed as a global (window.CtxMD).
(function () {
  "use strict";

  // Inline: `code`, **bold**, *italic* / _italic_, ~~strike~~, [text](url).
  function renderInline(text) {
    const frag = document.createDocumentFragment();
    const re = /(`[^`]+`)|(\*\*[^*]+\*\*)|(__[^_]+__)|(\*[^*\n]+\*)|(_[^_\n]+_)|(~~[^~]+~~)|(\[[^\]]+\]\([^)\s]+\))/g;
    let last = 0, m;
    const pushText = (s) => { if (s) frag.appendChild(document.createTextNode(s)); };
    while ((m = re.exec(text)) !== null) {
      pushText(text.slice(last, m.index));
      const tok = m[0];
      if (tok.startsWith("`")) {
        const c = document.createElement("code"); c.textContent = tok.slice(1, -1); frag.appendChild(c);
      } else if (tok.startsWith("**") || tok.startsWith("__")) {
        const b = document.createElement("strong"); b.appendChild(renderInline(tok.slice(2, -2))); frag.appendChild(b);
      } else if (tok.startsWith("~~")) {
        const s = document.createElement("del"); s.appendChild(renderInline(tok.slice(2, -2))); frag.appendChild(s);
      } else if (tok.startsWith("*") || tok.startsWith("_")) {
        const e = document.createElement("em"); e.appendChild(renderInline(tok.slice(1, -1))); frag.appendChild(e);
      } else if (tok.startsWith("[")) {
        const mm = tok.match(/^\[([^\]]+)\]\(([^)\s]+)\)$/);
        const a = document.createElement("a");
        a.appendChild(renderInline(mm[1]));
        const href = mm[2];
        // Only allow safe URL schemes.
        a.href = /^(https?:|mailto:)/i.test(href) ? href : "#";
        a.target = "_blank"; a.rel = "noopener noreferrer";
        frag.appendChild(a);
      }
      last = re.lastIndex;
    }
    pushText(text.slice(last));
    return frag;
  }

  const BLOCK_START = /^\s*(```|~~~|#{1,6}\s|>\s?|[-*+]\s|\d+[.)]\s|\|)/;

  function render(md) {
    // DocumentFragment so blocks become direct children of the host element
    // (keeps first/last-child margin rules and spacing correct).
    const root = document.createDocumentFragment();
    const lines = String(md == null ? "" : md).replace(/\r\n/g, "\n").split("\n");
    let i = 0;

    while (i < lines.length) {
      const line = lines[i];

      // Fenced code block.
      const fence = line.match(/^\s*(```|~~~)(.*)$/);
      if (fence) {
        const marker = fence[1], lang = fence[2].trim();
        const close = new RegExp("^\\s*" + marker + "\\s*$");
        const buf = []; i++;
        while (i < lines.length && !close.test(lines[i])) { buf.push(lines[i]); i++; }
        i++; // skip closing fence
        const pre = document.createElement("pre");
        const code = document.createElement("code");
        if (lang) code.className = "language-" + lang.replace(/[^\w-]/g, "");
        code.textContent = buf.join("\n");
        pre.appendChild(code); root.appendChild(pre);
        continue;
      }

      // Heading (#..###### → h3..h6, scaled down for a sub-block).
      const h = line.match(/^\s*(#{1,6})\s+(.*)$/);
      if (h) {
        const lvl = Math.min(6, h[1].length + 2);
        const el = document.createElement("h" + lvl);
        el.appendChild(renderInline(h[2].replace(/\s*#+\s*$/, "")));
        root.appendChild(el); i++; continue;
      }

      // Table: a "| … |" header row followed by a "|---|---|" separator row.
      if (/^\s*\|.*\|\s*$/.test(line) && i + 1 < lines.length && /^\s*\|?[\s:|-]*-[\s:|-]*\|?\s*$/.test(lines[i + 1])) {
        const splitRow = (r) => r.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim());
        const headers = splitRow(line);
        i += 2; // header + separator
        const table = document.createElement("table");
        const thead = document.createElement("thead");
        const htr = document.createElement("tr");
        headers.forEach((c) => { const th = document.createElement("th"); th.appendChild(renderInline(c)); htr.appendChild(th); });
        thead.appendChild(htr); table.appendChild(thead);
        const tbody = document.createElement("tbody");
        while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) {
          const cells = splitRow(lines[i]);
          const tr = document.createElement("tr");
          cells.forEach((c) => { const td = document.createElement("td"); td.appendChild(renderInline(c)); tr.appendChild(td); });
          tbody.appendChild(tr); i++;
        }
        table.appendChild(tbody);
        const wrap = document.createElement("div"); wrap.className = "ctx-ko-table"; wrap.appendChild(table);
        root.appendChild(wrap); continue;
      }

      // Horizontal rule.
      if (/^\s*([-*_])\1{2,}\s*$/.test(line)) { root.appendChild(document.createElement("hr")); i++; continue; }

      // Blockquote.
      if (/^\s*>\s?/.test(line)) {
        const buf = [];
        while (i < lines.length && /^\s*>\s?/.test(lines[i])) { buf.push(lines[i].replace(/^\s*>\s?/, "")); i++; }
        const bq = document.createElement("blockquote");
        bq.appendChild(render(buf.join("\n")));
        root.appendChild(bq); continue;
      }

      // Lists (unordered / ordered) — supports one level of nesting by indent.
      if (/^\s*[-*+]\s+/.test(line) || /^\s*\d+[.)]\s+/.test(line)) {
        const ordered = /^\s*\d+[.)]\s+/.test(line);
        const listEl = document.createElement(ordered ? "ol" : "ul");
        const itemRe = ordered ? /^(\s*)\d+[.)]\s+(.*)$/ : /^(\s*)[-*+]\s+(.*)$/;
        let cur = null;
        while (i < lines.length && (/^\s*[-*+]\s+/.test(lines[i]) || /^\s*\d+[.)]\s+/.test(lines[i]) || /^\s{2,}\S/.test(lines[i]))) {
          const mm = lines[i].match(itemRe) || lines[i].match(/^(\s*)[-*+]\s+(.*)$/) || lines[i].match(/^(\s*)\d+[.)]\s+(.*)$/);
          if (mm) {
            cur = document.createElement("li");
            cur.appendChild(renderInline(mm[2]));
            listEl.appendChild(cur);
          } else if (cur) {
            // continuation / indented sub-text
            cur.appendChild(document.createElement("br"));
            cur.appendChild(renderInline(lines[i].trim()));
          }
          i++;
        }
        root.appendChild(listEl); continue;
      }

      // Blank line.
      if (line.trim() === "") { i++; continue; }

      // Paragraph: gather consecutive non-block lines; soft breaks → <br>.
      const buf = [line]; i++;
      while (i < lines.length && lines[i].trim() !== "" && !BLOCK_START.test(lines[i])) { buf.push(lines[i]); i++; }
      const p = document.createElement("p");
      buf.forEach((l, idx) => { if (idx > 0) p.appendChild(document.createElement("br")); p.appendChild(renderInline(l)); });
      root.appendChild(p);
    }
    return root;
  }

  window.CtxMD = { render, renderInline };
})();
