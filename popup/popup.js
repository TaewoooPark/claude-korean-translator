// popup/popup.js
const $ = (id) => document.getElementById(id);

async function load() {
  const s = await chrome.storage.local.get(["enabled", "translateInput", "translateOutput"]);
  $("enabled").checked = s.enabled !== false;
  $("translateInput").checked = s.translateInput !== false;
  $("translateOutput").checked = s.translateOutput !== false;

  let hasKey = false;
  try {
    const r = await chrome.runtime.sendMessage({ type: "PING_KEY" });
    hasKey = !!(r && r.hasKey);
  } catch (e) {}
  const ks = $("keystatus");
  ks.textContent = hasKey ? "API 키: 등록됨 ✓" : "API 키: 없음 — 설정에서 등록";
  ks.className = "key " + (hasKey ? "ok" : "no");
}

["enabled", "translateInput", "translateOutput"].forEach((id) => {
  $(id).addEventListener("change", async () => {
    await chrome.storage.local.set({ [id]: $(id).checked });
  });
});

$("openOptions").onclick = () => chrome.runtime.openOptionsPage();

load();
