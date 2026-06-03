// lib/chrome-translator.js
// Wrapper around Chrome's built-in on-device Translator API (window.Translator).
// On-device, free, no API key, no network. Uses CtxMask to preserve code/URLs.
//
// Model lifecycle: the FIRST time a language pair is used the model must be
// downloaded, and Chrome requires that download to start under a user gesture
// (a click). So:
//   • input path (KO→EN button click) may download on first use (allowDownload),
//   • output path (observer, no gesture) only translates if the model is already
//     available, otherwise asks the user to pre-download from the options page.
//
// Exposed as a global (window.CtxChromeTranslator).
(function () {
  "use strict";

  const DIRS = {
    ko2en: { sourceLanguage: "ko", targetLanguage: "en" },
    en2ko: { sourceLanguage: "en", targetLanguage: "ko" }
  };
  const cache = {}; // dir -> Translator instance (per execution context)

  function isSupported() {
    return typeof self !== "undefined" && "Translator" in self;
  }

  function hasHangul(s) {
    return /[ㄱ-ㆎ가-힣]/.test(s || "");
  }

  async function availability(dir) {
    if (!isSupported()) return "no-api";
    try { return await self.Translator.availability(DIRS[dir]); }
    catch (e) { return "no-api"; }
  }

  // Create (and cache) a translator. If allowDownload, a missing model is
  // downloaded — caller MUST be inside a user gesture for that to be permitted.
  async function getTranslator(dir, allowDownload, onProgress) {
    if (cache[dir]) return cache[dir];
    if (!isSupported()) { const e = new Error("NO_API"); e.code = "NO_API"; throw e; }
    const av = await availability(dir);
    if (av === "unavailable" || av === "no-api") { const e = new Error("UNAVAILABLE"); e.code = "UNAVAILABLE"; throw e; }
    if (av !== "available" && !allowDownload) { const e = new Error("NEEDS_DOWNLOAD"); e.code = "NEEDS_DOWNLOAD"; throw e; }
    const opts = Object.assign({}, DIRS[dir]);
    if (av !== "available") {
      opts.monitor = (m) => m.addEventListener("downloadprogress", (ev) => {
        if (onProgress) onProgress(typeof ev.loaded === "number" ? ev.loaded : 0);
      });
    }
    cache[dir] = await self.Translator.create(opts);
    return cache[dir];
  }

  // Translate `text` for direction "ko2en" | "en2ko", preserving code/URLs/paths.
  // opts.allowDownload — permit first-time model download (must be a user gesture).
  async function translate(text, dir, opts) {
    opts = opts || {};
    if (!text || !text.trim()) return text || "";
    // Language guard: don't re-translate KO→EN when the text has no Korean.
    if (dir === "ko2en" && !hasHangul(text)) return text;
    const t = await getTranslator(dir, !!opts.allowDownload, opts.onProgress);
    return window.CtxMask.translateMasked(text, (chunk) => t.translate(chunk));
  }

  // Pre-download a model (options page "download" button — runs under a gesture).
  async function download(dir, onProgress) {
    await getTranslator(dir, true, onProgress);
    return true;
  }

  // Availability summary for the options UI.
  async function status() {
    return {
      supported: isSupported(),
      ko2en: await availability("ko2en"),
      en2ko: await availability("en2ko")
    };
  }

  window.CtxChromeTranslator = { isSupported, availability, translate, download, status, hasHangul };
})();
