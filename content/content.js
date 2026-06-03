// content/content.js
// Main content logic. Uses window.CtxDOM (loaded by claude-dom.js first).
(function () {
  "use strict";
  const DOM = window.CtxDOM;
  if (!DOM) { console.warn("[ctx] CtxDOM not loaded"); return; }

  // Capability log (helps users/devs see which backend is usable here).
  console.info("[ctx] on-device Translator available in content script:",
    !!(window.CtxChromeTranslator && window.CtxChromeTranslator.isSupported()));

  // backend: "chrome" (on-device Translator, default) | "anthropic" (API key)
  let settings = { enabled: true, translateInput: true, translateOutput: true, backend: "chrome" };
  const translatedMessages = new WeakSet();
  let downloadToastShown = false;

  // ---- settings -------------------------------------------------------
  chrome.storage.local.get(["enabled", "translateInput", "translateOutput", "backend"]).then((s) => {
    settings.enabled = s.enabled !== false;
    settings.translateInput = s.translateInput !== false;
    settings.translateOutput = s.translateOutput !== false;
    settings.backend = s.backend === "anthropic" ? "anthropic" : "chrome";
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    if ("enabled" in changes) settings.enabled = changes.enabled.newValue !== false;
    if ("translateInput" in changes) settings.translateInput = changes.translateInput.newValue !== false;
    if ("translateOutput" in changes) settings.translateOutput = changes.translateOutput.newValue !== false;
    if ("backend" in changes) settings.backend = changes.backend.newValue === "anthropic" ? "anthropic" : "chrome";
  });

  // ---- translation dispatcher (on-device first, Anthropic fallback) ---
  // opts.allowDownload — permit first-time on-device model download (gesture only).
  async function translate(text, direction, opts) {
    opts = opts || {};
    const CT = window.CtxChromeTranslator;
    if (settings.backend === "chrome" && CT && CT.isSupported()) {
      try {
        return await CT.translate(text, direction, { allowDownload: !!opts.allowDownload });
      } catch (e) {
        const code = e && e.code;
        if (code === "NEEDS_DOWNLOAD") {
          if (!downloadToastShown) {
            downloadToastShown = true;
            showToast("온디바이스 번역 모델이 필요합니다 — 확장 옵션에서 '모델 다운로드'를 눌러주세요.", true);
          }
          return null;
        }
        // NO_API / UNAVAILABLE → try Anthropic key as a fallback if one is set.
        const viaKey = await translateViaBg(text, direction, true);
        if (viaKey != null) return viaKey;
        showToast("온디바이스 번역을 사용할 수 없습니다(브라우저 미지원). 옵션에서 Anthropic 키 백엔드로 전환하세요.", true);
        return null;
      }
    }
    // Anthropic backend
    return translateViaBg(text, direction);
  }

  // ---- bg bridge (Anthropic API via service worker) -------------------
  async function translateViaBg(text, direction, suppressNoKey) {
    let r;
    try {
      r = await chrome.runtime.sendMessage({ type: "TRANSLATE", payload: { text, direction } });
    } catch (e) {
      if (suppressNoKey) return null;
      showToast("확장 연결 오류: " + String(e), true);
      return null;
    }
    if (!r) { if (suppressNoKey) return null; showToast("응답 없음 (서비스워커?)", true); return null; }
    if (r.error) { if (suppressNoKey && r.error === "NO_API_KEY") return null; showError(r); return null; }
    if (r.truncated) showToast("⚠️ 응답이 max_tokens로 잘렸을 수 있습니다.", true);
    return r.text;
  }

  function showError(r) {
    const map = {
      NO_API_KEY: "API 키가 없습니다. 확장 옵션에서 키를 등록하세요.",
      AUTH_OR_CORS: "401: 키 오류 또는 조직 CORS 차단. 옵션의 안내(8.1)를 확인하세요.",
      RATE_LIMIT: "429: 레이트리밋. 잠시 후 다시 시도하세요.",
      NETWORK: "네트워크 오류.",
      HTTP: "HTTP 오류 " + (r.status || ""),
      PARSE: "응답 파싱 오류."
    };
    showToast(map[r.error] || ("오류: " + r.error), true);
  }

  // ---- toast ----------------------------------------------------------
  let toastEl = null, toastTimer = null;
  function showToast(msg, isError) {
    if (!toastEl) {
      toastEl = document.createElement("div");
      toastEl.className = "ctx-ko-toast";
      document.body.appendChild(toastEl);
    }
    toastEl.textContent = msg;
    toastEl.classList.toggle("error", !!isError);
    toastEl.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove("show"), 4000);
  }

  // ---- input path: own button ----------------------------------------
  function injectSendButton() {
    const composer = DOM.findComposer();
    if (!composer) return;
    if (document.getElementById("ctx-ko-send")) return;

    const btn = document.createElement("button");
    btn.id = "ctx-ko-send";
    btn.type = "button";
    btn.textContent = "KO→EN 전송";
    btn.className = "ctx-ko-send-btn";
    btn.addEventListener("click", async (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (!settings.enabled || !settings.translateInput) {
        showToast("입력 번역이 꺼져 있습니다 (옵션에서 켜기).");
        return;
      }
      // Re-find the composer at click time — claude.ai (React/TipTap) may remount
      // the node after the button was injected, making a captured reference stale.
      const liveComposer = DOM.findComposer() || composer;
      const ko = DOM.readComposerText(liveComposer).trim();
      if (!ko) { showToast("입력창이 비어 있습니다."); return; }
      btn.disabled = true;
      const orig = btn.textContent;
      btn.textContent = "번역 중…";
      // allowDownload: the click is a user gesture, so on-device model may
      // download on first use here.
      const en = await translate(ko, "ko2en", { allowDownload: true });
      btn.disabled = false;
      btn.textContent = orig;
      if (en == null) return;
      const target = DOM.findComposer() || liveComposer; // re-find again post-await
      const ok = await DOM.setComposerText(target, en);
      if (!ok) { showToast("입력창 교체 실패(ProseMirror).", true); return; }
      // small delay so PM/React settles & send button enables
      setTimeout(() => DOM.triggerSend(DOM.findComposer() || target), 120);
    });

    // Place near the composer. Walk up to a stable container.
    const host = composer.closest("fieldset") || composer.parentElement;
    (host || document.body).appendChild(btn);
  }

  // ---- output path: observe assistant messages ------------------------
  let outputObserver = null;
  function startOutputObserver() {
    const root = DOM.getConversationRoot();
    if (!root) return;
    if (outputObserver) outputObserver.disconnect();

    const debounceTimers = new WeakMap();
    const lenAtSchedule = new WeakMap();

    const scan = () => {
      if (!settings.enabled || !settings.translateOutput) return;
      // Only translate on a real chat page (guards against marketing/login page
      // where .font-claude-response is used on headings).
      if (DOM.isChatPage && !DOM.isChatPage()) return;
      const msgs = DOM.findAssistantMessages(root);
      msgs.forEach((node) => {
        if (translatedMessages.has(node)) return;
        if (!DOM.isAssistantMessage(node)) return;
        if (!DOM.isMessageComplete(node)) return;
        // Debounce + STABILITY: only translate once the message text has stopped
        // growing for the debounce window AND generation isn't running. This is
        // what prevents a long, still-streaming answer from being translated
        // half-finished (and then never re-translated).
        const len = (node.innerText || "").length;
        lenAtSchedule.set(node, len);
        clearTimeout(debounceTimers.get(node));
        debounceTimers.set(node, setTimeout(() => {
          if (translatedMessages.has(node)) return;
          if (DOM.isGenerating()) return;
          if ((node.innerText || "").length !== lenAtSchedule.get(node)) return; // still growing
          translatedMessages.add(node);
          handleAssistantMessage(node);
        }, 900));
      });
    };

    outputObserver = new MutationObserver(scan);
    outputObserver.observe(root, { childList: true, subtree: true });
    scan();
  }

  async function handleAssistantMessage(node) {
    const en = DOM.extractMessageMarkdown(node);
    if (!en || !en.trim()) return;
    // Show a loading placeholder immediately (on-device translation of a long
    // answer is line-by-line and can take a few seconds).
    const loading = injectLoadingBlock(node);
    const ko = await translate(en, "en2ko");
    if (loading && loading.isConnected) loading.remove();
    if (ko == null) { translatedMessages.delete(node); return; }
    if (!ko.trim()) return; // nothing meaningful to show; don't inject an empty block
    injectKoreanBlock(node, ko);
  }

  function injectLoadingBlock(node) {
    if (node.querySelector(".ctx-ko-translation-wrap")) return null;
    const wrap = document.createElement("div");
    wrap.className = "ctx-ko-translation-wrap ctx-ko-loading";
    const head = document.createElement("div");
    head.className = "ctx-ko-head";
    const label = document.createElement("span");
    label.className = "ctx-ko-label";
    label.textContent = "🇰🇷 한국어 번역";
    const spin = document.createElement("span");
    spin.className = "ctx-ko-spin";
    spin.textContent = "번역 중…";
    head.appendChild(label);
    head.appendChild(spin);
    wrap.appendChild(head);
    node.appendChild(wrap);
    return wrap;
  }

  function injectKoreanBlock(node, ko) {
    if (node.querySelector(".ctx-ko-translation-wrap")) return;
    const wrap = document.createElement("div");
    wrap.className = "ctx-ko-translation-wrap";

    const head = document.createElement("div");
    head.className = "ctx-ko-head";
    const label = document.createElement("span");
    label.className = "ctx-ko-label";
    label.textContent = "🇰🇷 한국어 번역";
    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "ctx-ko-toggle";
    toggle.textContent = "접기";
    head.appendChild(label);
    head.appendChild(toggle);

    const box = document.createElement("div");
    box.className = "ctx-ko-translation";
    // Render markdown so headings/lists/code/line breaks display properly.
    try {
      if (window.CtxMD) box.appendChild(window.CtxMD.render(ko));
      else box.textContent = ko;
    } catch (e) { box.textContent = ko; }

    // Use inline display (with !important) for hide/show — robust against
    // claude.ai's own CSS specificity / overrides, and doesn't depend on the
    // content.css class rule winning. preventDefault/stopPropagation so the
    // click never reaches claude.ai's message handlers.
    toggle.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      const hidden = box.style.display === "none";
      if (hidden) { box.style.removeProperty("display"); toggle.textContent = "접기"; }
      else { box.style.setProperty("display", "none", "important"); toggle.textContent = "펼치기"; }
    });

    wrap.appendChild(head);
    wrap.appendChild(box);
    node.appendChild(wrap);
  }

  // ---- selector self-check -------------------------------------------
  // Runs once the composer appears on a real claude.ai page. Surfaces which
  // selectors resolved so the (login-gated) live verification is turnkey:
  // open DevTools console and you immediately see if anything needs patching.
  let healthChecked = false;
  function selfCheck() {
    if (healthChecked) return;
    const composer = DOM.findComposer();
    if (!composer) return; // not ready yet
    healthChecked = true;
    const report = DOM.diagnose();
    const missing = [];
    if (!report.composer) missing.push("composer");
    if (!report.conversationRoot) missing.push("conversationRoot");
    // NOTE: sendButton is intentionally NOT required — claude.ai only renders it
    // once the composer has text, so it is expected-absent at load.
    if (missing.length) {
      console.warn("[ctx] selector self-check — UNRESOLVED:", missing.join(", "),
        "→ patch content/claude-dom.js. Full report above.");
    } else {
      console.info("[ctx] selector self-check OK — composer & conversation resolved (send button appears on input).");
    }
  }

  // ---- init / SPA re-init --------------------------------------------
  function init() {
    injectSendButton();
    startOutputObserver();
    selfCheck();
  }

  // Re-inject button if composer remounts; re-init observer on route change.
  const globalObserver = new MutationObserver(() => {
    if (!document.getElementById("ctx-ko-send")) injectSendButton();
  });
  globalObserver.observe(document.documentElement, { childList: true, subtree: true });

  // SPA route change detection.
  let lastUrl = location.href;
  setInterval(() => {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      setTimeout(init, 400);
    }
  }, 700);

  // Initial (page may still be hydrating).
  let tries = 0;
  const boot = setInterval(() => {
    tries++;
    if (DOM.findComposer() || tries > 20) {
      clearInterval(boot);
      init();
    }
  }, 400);
  init();

  // Expose for debugging/verification.
  window.__ctxContent = { settings, init, injectSendButton, startOutputObserver };
})();
