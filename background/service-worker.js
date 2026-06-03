// background/service-worker.js
import { SYSTEM_KO_TO_EN, SYSTEM_EN_TO_KO, buildMessages } from "../lib/translate-prompts.js";

const API_URL = "https://api.anthropic.com/v1/messages";
const MODEL = "claude-haiku-4-5-20251001"; // verified working 2026-06
const ANTHROPIC_VERSION = "2023-06-01";

async function getApiKey() {
  const { anthropicApiKey } = await chrome.storage.local.get("anthropicApiKey");
  return anthropicApiKey || null;
}

// max_tokens scaled to input length, clamped. Haiku 4.5 supports large outputs.
function computeMaxTokens(text) {
  const approxInputTokens = Math.ceil((text?.length || 0) / 3); // rough KO/EN char->token
  const scaled = Math.max(1024, Math.min(8192, approxInputTokens * 2 + 512));
  return scaled;
}

async function translate({ text, direction }) {
  const apiKey = await getApiKey();
  if (!apiKey) return { error: "NO_API_KEY" };
  if (!text || !text.trim()) return { text: "" };

  const system = direction === "ko2en" ? SYSTEM_KO_TO_EN : SYSTEM_EN_TO_KO;

  const body = {
    model: MODEL,
    max_tokens: computeMaxTokens(text),
    system,
    messages: buildMessages(direction, text)
  };

  let res;
  try {
    res = await fetch(API_URL, {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": ANTHROPIC_VERSION,
        "content-type": "application/json",
        // Required for direct browser/extension calls (enables CORS path).
        "anthropic-dangerous-direct-browser-access": "true"
      },
      body: JSON.stringify(body)
    });
  } catch (e) {
    return { error: "NETWORK", detail: String(e) };
  }

  if (!res.ok) {
    let detail = "";
    try { detail = JSON.stringify(await res.json()); } catch {}
    if (res.status === 401) return { error: "AUTH_OR_CORS", status: 401, detail };
    if (res.status === 429) return { error: "RATE_LIMIT", status: 429, detail };
    return { error: "HTTP", status: res.status, detail };
  }

  let data;
  try { data = await res.json(); }
  catch (e) { return { error: "PARSE", detail: String(e) }; }

  const out = (data.content || [])
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("");
  const truncated = data.stop_reason === "max_tokens";
  return { text: out, truncated };
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === "TRANSLATE") {
    translate(msg.payload).then(sendResponse);
    return true; // keep channel open for async response
  }
  if (msg?.type === "PING_KEY") {
    getApiKey().then((k) => sendResponse({ hasKey: !!k }));
    return true;
  }
});
