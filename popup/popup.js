// popup/popup.js
const $ = (id) => document.getElementById(id);
const CT = window.CtxChromeTranslator;

async function load() {
  const s = await chrome.storage.local.get(["enabled", "translateInput", "translateOutput", "backend"]);
  $("enabled").checked = s.enabled !== false;
  $("translateInput").checked = s.translateInput !== false;
  $("translateOutput").checked = s.translateOutput !== false;

  const backend = s.backend === "anthropic" ? "anthropic" : "chrome";
  const bl = $("backendline");
  const ks = $("keystatus");

  if (backend === "chrome") {
    bl.textContent = "백엔드: Chrome 온디바이스 (무료)";
    bl.className = "key";
    if (CT && CT.isSupported()) {
      const st = await CT.status();
      const ready = st.ko2en === "available" && st.en2ko === "available";
      ks.textContent = ready ? "온디바이스 모델: 준비됨 ✓" : "온디바이스 모델: 설정에서 다운로드 필요";
      ks.className = "key " + (ready ? "ok" : "no");
    } else {
      ks.textContent = "내장 번역 API 미지원 — 설정에서 Anthropic 키로 전환";
      ks.className = "key no";
    }
  } else {
    bl.textContent = "백엔드: Anthropic API 키";
    bl.className = "key";
    let hasKey = false;
    try { const r = await chrome.runtime.sendMessage({ type: "PING_KEY" }); hasKey = !!(r && r.hasKey); } catch (e) {}
    ks.textContent = hasKey ? "API 키: 등록됨 ✓" : "API 키: 없음 — 설정에서 등록";
    ks.className = "key " + (hasKey ? "ok" : "no");
  }
}

["enabled", "translateInput", "translateOutput"].forEach((id) => {
  $(id).addEventListener("change", async () => {
    await chrome.storage.local.set({ [id]: $(id).checked });
  });
});

$("openOptions").onclick = () => chrome.runtime.openOptionsPage();

load();
