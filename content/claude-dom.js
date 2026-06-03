// content/claude-dom.js
// claude.ai DOM helpers. Selectors are obfuscation-resistant: prefer roles,
// aria-labels, data-* attributes and structural heuristics over class names.
// Exposed as a global (window.CtxDOM) because manifest content scripts are
// classic scripts (no ES module import between them).
(function () {
  "use strict";

  function isVisible(el) {
    if (!el) return false;
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) return false;
    const cs = getComputedStyle(el);
    return cs.visibility !== "hidden" && cs.display !== "none";
  }

  // ---- 6.1 Composer ----------------------------------------------------
  function findComposer() {
    const candidates = [
      // Verified on live claude.ai (2026-06): the composer is a TipTap/ProseMirror
      // contenteditable with data-testid="chat-input", role="textbox".
      '[data-testid="chat-input"][contenteditable="true"]',
      '[data-testid="chat-input"]',
      'div[contenteditable="true"].ProseMirror',
      'div.ProseMirror[contenteditable="true"]',
      '[contenteditable="true"][role="textbox"]',
      'div[contenteditable="true"]',
      '[role="textbox"]'
    ];
    for (const sel of candidates) {
      const nodes = Array.from(document.querySelectorAll(sel)).filter(isVisible);
      if (nodes.length) {
        // Prefer the one nearest the bottom (main composer), largest area.
        nodes.sort((a, b) => {
          const ra = a.getBoundingClientRect();
          const rb = b.getBoundingClientRect();
          return rb.bottom - ra.bottom;
        });
        return nodes[0];
      }
    }
    return null;
  }

  // Block-aware text extraction so newlines survive whether they come from
  // <br>, separate <p>/<div> blocks (ProseMirror), or literal "\n" text nodes.
  function extractText(node) {
    let s = "";
    node.childNodes.forEach((c) => {
      if (c.nodeType === 3) { s += c.textContent; return; }
      if (c.nodeType !== 1) return;
      const tag = c.tagName.toLowerCase();
      if (tag === "br") { s += "\n"; return; }
      const block = /^(p|div|li|h[1-6]|pre|blockquote)$/.test(tag);
      s += extractText(c);
      if (block) s += "\n";
    });
    return s;
  }

  // The TipTap Editor instance claude.ai attaches to the composer DOM node.
  // VERIFIED on live claude.ai (2026-06): composer.editor is the canonical
  // ProseMirror document handle — what gets SENT — so reading/writing through it
  // is authoritative and persists (DOM-only edits get reverted by draft-restore).
  function getEditor(el) {
    return (el && el.editor && (el.editor.commands || el.editor.chain)) ? el.editor : null;
  }

  function readComposerText(el) {
    if (!el) return "";
    const ed = getEditor(el);
    if (ed && typeof ed.getText === "function") {
      try { return ed.getText().replace(/\n+$/g, ""); } catch (e) { /* fall back */ }
    }
    return extractText(el)
      .replace(/[ \t]+\n/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .replace(/\n+$/g, "");
  }

  // Convert plain text to one <p> per line (HTML-escaped) for editor.setContent.
  function textToParagraphHtml(text) {
    const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    return String(text).split("\n").map((l) => "<p>" + (l.length ? esc(l) : "<br>") + "</p>").join("");
  }

  // Whitespace-insensitive equality: confirms the visible characters match even
  // if the editor normalized whitespace differently than our source string.
  function sameContent(a, b) {
    const norm = (s) => (s || "").replace(/\s+/g, " ").trim();
    return norm(a) === norm(b);
  }

  function fireInput(el) {
    el.dispatchEvent(new InputEvent("input", { bubbles: true, cancelable: false }));
  }

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // One application attempt. Order is by reliability VERIFIED on live claude.ai
  // (TipTap): execCommand selectAll+delete+insertText creates real ProseMirror
  // transactions (updates the editor doc), unlike a plain Range+insertText.
  function applyComposerText(el, text) {
    // Attempt 1: execCommand selectAll + delete + insertText.
    try {
      el.focus();
      document.execCommand("selectAll");
      document.execCommand("delete");
      const ok = document.execCommand("insertText", false, text);
      fireInput(el);
      if (ok && sameContent(readComposerText(el), text)) return true;
    } catch (e) { /* try next */ }

    // Attempt 2: manual beforeinput insertText (some PM builds honor this).
    try {
      el.focus();
      document.execCommand("selectAll");
      el.dispatchEvent(new InputEvent("beforeinput", {
        bubbles: true, cancelable: true, inputType: "insertText", data: text
      }));
      document.execCommand("insertText", false, text);
      fireInput(el);
      if (sameContent(readComposerText(el), text)) return true;
    } catch (e) { /* try next */ }

    // Attempt 3 (last resort): direct DOM write, one <p> per line.
    try {
      el.innerHTML = "";
      String(text).split("\n").forEach((line) => {
        const p = document.createElement("p");
        if (line.length) p.textContent = line; else p.appendChild(document.createElement("br"));
        el.appendChild(p);
      });
      fireInput(el);
      return sameContent(readComposerText(el), text);
    } catch (e) { return false; }
  }

  // ProseMirror-safe text replacement.
  // PRIMARY: write through the TipTap Editor instance (composer.editor). This
  // updates the real ProseMirror document — the source of truth that claude.ai
  // sends and persists — so the text sticks. VERIFIED on live claude.ai.
  // FALLBACK (no editor, e.g. tests): hammer execCommand to beat draft-restore.
  async function setComposerText(el, text) {
    if (!el) return false;
    const ed = getEditor(el);
    if (ed) {
      try {
        const html = textToParagraphHtml(text);
        // emitUpdate=true so claude.ai sees the change (send button, draft sync).
        if (ed.chain) ed.chain().focus().setContent(html, true).run();
        else ed.commands.setContent(html, true);
        await sleep(120);
        if (sameContent(readComposerText(el), text)) return true;
        // one corrective retry
        ed.commands.setContent(html, true);
        await sleep(150);
        if (sameContent(readComposerText(el), text)) return true;
      } catch (e) { /* fall back to execCommand hammer */ }
    }
    // Fallback: rapid repeated execCommand applies to overwrite draft-restore.
    for (let i = 0; i < 6; i++) {
      applyComposerText(el, text);
      await sleep(130);
    }
    for (let i = 0; i < 4; i++) {
      await sleep(200);
      if (sameContent(readComposerText(el), text)) {
        await sleep(250);
        if (sameContent(readComposerText(el), text)) return true;
      }
      applyComposerText(el, text);
    }
    return sameContent(readComposerText(el), text);
  }

  // ---- 6.2 Send --------------------------------------------------------
  function findSendButton() {
    const sels = [
      'button[aria-label*="Send" i]',
      'button[aria-label*="보내기"]',
      'button[aria-label*="전송"]',
      'button[data-testid="send-button"]',
      'fieldset button[type="submit"]',
      'button[type="submit"]'
    ];
    for (const sel of sels) {
      const nodes = Array.from(document.querySelectorAll(sel)).filter(isVisible);
      const enabled = nodes.find((b) => !b.disabled);
      if (enabled) return enabled;
      if (nodes.length) return nodes[0];
    }
    return null;
  }

  function triggerSend(composerEl) {
    const btn = findSendButton();
    if (btn && !btn.disabled) {
      btn.click();
      return true;
    }
    // Fallback: Enter keydown on the composer.
    if (composerEl) {
      const opts = { bubbles: true, cancelable: true, key: "Enter", code: "Enter", keyCode: 13, which: 13 };
      composerEl.dispatchEvent(new KeyboardEvent("keydown", opts));
      composerEl.dispatchEvent(new KeyboardEvent("keyup", opts));
      return true;
    }
    return false;
  }

  // ---- 6.3 Assistant messages -----------------------------------------
  function getConversationRoot() {
    return (
      document.querySelector('[data-testid="conversation"]') ||
      document.querySelector("main") ||
      document.body
    );
  }

  // True only on an actual chat page (composer present). Used to suppress the
  // output observer on the marketing/login page, where .font-claude-response is
  // also used on headings and would otherwise be mistaken for assistant content.
  function isChatPage() {
    return !!document.querySelector('[data-testid="chat-input"], .ProseMirror[contenteditable="true"]');
  }

  // Identify an assistant message node.
  // VERIFIED on live claude.ai (2026-06): assistant turns render as
  // `.font-claude-response` (NOT font-claude-message; that class is not present
  // in the chat). User turns carry data-testid="user-message". The same
  // font-claude-response class also appears on the marketing page — guarded by
  // isChatPage() at the observer level.
  function isAssistantMessage(node) {
    if (!node || node.nodeType !== 1) return false;
    if (node.matches?.('[data-testid="user-message"]')) return false;
    if (node.closest?.('[data-testid="user-message"]')) return false;
    if (node.getAttribute?.("data-message-author-role") === "assistant") return true;
    if (node.matches?.('[data-message-author-role="assistant"]')) return true;
    // Assistant content container (self OR descendant).
    if (node.matches?.(".font-claude-response, .font-claude-message")) return true;
    if (node.querySelector?.(".font-claude-response, .font-claude-message")) return true;
    return false;
  }

  // Find all assistant message nodes under root.
  function findAssistantMessages(root) {
    const r = root || getConversationRoot();
    const set = new Set();
    const selectors = [
      '[data-message-author-role="assistant"]',
      '[data-testid="assistant-message"]',
      '.font-claude-response',
      '.font-claude-message'
    ];
    for (const sel of selectors) {
      r.querySelectorAll(sel).forEach((n) => set.add(n));
    }
    return Array.from(set);
  }

  // Extract markdown-ish source from a message node.
  function extractMessageMarkdown(node) {
    if (!node) return "";
    // Prefer the inner prose container if present.
    const prose = node.querySelector?.(".font-claude-response, .font-claude-message, .prose") || node;
    return domToMarkdown(prose);
  }

  // Inline markdown for a node's content, preserving inline `code`, **bold**,
  // *italic*, and [links](url). Used for headings/list items.
  function inlineMarkdown(node) {
    let out = "";
    node.childNodes.forEach((child) => {
      if (child.nodeType === 3) { out += child.textContent; return; }
      if (child.nodeType !== 1) return;
      const tag = child.tagName.toLowerCase();
      if (tag === "code") out += "`" + child.innerText + "`";
      else if (tag === "strong" || tag === "b") out += "**" + inlineMarkdown(child) + "**";
      else if (tag === "em" || tag === "i") out += "*" + inlineMarkdown(child) + "*";
      else if (tag === "a") out += "[" + inlineMarkdown(child) + "](" + (child.getAttribute("href") || "") + ")";
      else if (tag === "br") out += "\n";
      else out += inlineMarkdown(child);
    });
    return out.trim();
  }

  // Lightweight DOM -> markdown to preserve code fences / inline code.
  function domToMarkdown(root) {
    if (!root) return "";
    const lines = [];
    function walk(node, listPrefix) {
      node.childNodes.forEach((child) => {
        if (child.nodeType === 3) {
          const t = child.textContent;
          if (t && t.trim()) lines.push(t);
          return;
        }
        if (child.nodeType !== 1) return;
        const tag = child.tagName.toLowerCase();
        // Skip UI controls / collapsible "thinking"/tool-status widgets and
        // hidden nodes. VERIFIED on live claude.ai: assistant turns wrap a
        // collapsible status block in a button[aria-expanded] whose label text
        // duplicates the response — translating it caused doubled output.
        if (tag === "button" || tag === "svg" || tag === "style" || tag === "script") return;
        if (child.matches && child.matches('[aria-expanded], [role="button"], [aria-hidden="true"]')) return;
        if (child.getClientRects && child.getClientRects().length === 0 &&
            tag !== "br" && !/^(code|span|a|strong|em)$/.test(tag)) return; // hidden block
        if (tag === "pre") {
          const code = child.querySelector("code");
          const langMatch = (code?.className || "").match(/language-([\w-]+)/);
          const lang = langMatch ? langMatch[1] : "";
          const text = (code || child).innerText.replace(/\n+$/, "");
          lines.push("\n```" + lang + "\n" + text + "\n```\n");
          return;
        }
        if (tag === "code") {
          lines.push("`" + child.innerText + "`");
          return;
        }
        if (/^h[1-6]$/.test(tag)) {
          const level = Number(tag[1]);
          lines.push("\n" + "#".repeat(level) + " " + inlineMarkdown(child) + "\n");
          return;
        }
        if (tag === "li") {
          lines.push("\n" + (listPrefix || "- ") + inlineMarkdown(child));
          return;
        }
        if (tag === "ul" || tag === "ol") {
          lines.push("\n");
          let i = 1;
          child.childNodes.forEach((li) => {
            if (li.nodeType === 1 && li.tagName.toLowerCase() === "li") {
              const prefix = tag === "ol" ? `${i++}. ` : "- ";
              lines.push("\n" + prefix + inlineMarkdown(li));
            }
          });
          lines.push("\n");
          return;
        }
        if (tag === "p") {
          walk(child, listPrefix);
          lines.push("\n\n");
          return;
        }
        if (tag === "br") {
          lines.push("\n");
          return;
        }
        // Default: recurse.
        walk(child, listPrefix);
      });
    }
    walk(root, "- ");
    return lines.join("").replace(/\n{3,}/g, "\n\n").trim();
  }

  // ---- 7.2 Completion detection ---------------------------------------
  // Returns true when generation appears finished (no global stop button).
  function isGenerating() {
    const stopSels = [
      'button[aria-label*="Stop" i]',
      'button[aria-label*="중지"]',
      'button[aria-label*="중단"]',
      'button[data-testid="stop-button"]'
    ];
    for (const sel of stopSels) {
      const b = document.querySelector(sel);
      if (b && isVisible(b)) return true;
    }
    return false;
  }

  function isMessageComplete(node) {
    // Complete when not globally generating AND the message has an action
    // toolbar (copy/retry) OR simply when not generating.
    if (isGenerating()) return false;
    return true;
  }

  // Live diagnostic: run `CtxDOM.diagnose()` in the claude.ai console to confirm
  // every selector resolves against the real DOM (the only step that needs login).
  function describe(el) {
    if (!el) return null;
    return {
      tag: el.tagName?.toLowerCase(),
      id: el.id || undefined,
      classes: (el.className && typeof el.className === "string") ? el.className.slice(0, 120) : undefined,
      ariaLabel: el.getAttribute?.("aria-label") || undefined,
      testid: el.getAttribute?.("data-testid") || undefined,
      role: el.getAttribute?.("role") || undefined
    };
  }

  function diagnose() {
    const root = getConversationRoot();
    const msgs = findAssistantMessages(root);
    const report = {
      composer: describe(findComposer()),
      sendButton: describe(findSendButton()),
      conversationRoot: describe(root),
      assistantMessageCount: msgs.length,
      firstAssistant: describe(msgs[0]),
      firstAssistantMarkdownPreview: msgs[0] ? extractMessageMarkdown(msgs[0]).slice(0, 160) : null,
      isGenerating: isGenerating()
    };
    try { console.table([report.composer, report.sendButton, report.conversationRoot, report.firstAssistant].filter(Boolean)); } catch (e) {}
    console.log("[CtxDOM.diagnose]", report);
    return report;
  }

  window.CtxDOM = {
    isVisible,
    findComposer,
    readComposerText,
    setComposerText,
    sameContent,
    findSendButton,
    triggerSend,
    getConversationRoot,
    isChatPage,
    isAssistantMessage,
    findAssistantMessages,
    extractMessageMarkdown,
    domToMarkdown,
    isGenerating,
    isMessageComplete,
    diagnose
  };
})();
