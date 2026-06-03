// options/options.js
const $ = (id) => document.getElementById(id);

function status(msg, kind) {
  const el = $("status");
  el.textContent = msg;
  el.className = kind || "";
}

async function load() {
  const s = await chrome.storage.local.get([
    "anthropicApiKey", "enabled", "translateInput", "translateOutput"
  ]);
  $("key").value = s.anthropicApiKey || "";
  $("enabled").checked = s.enabled !== false;
  $("translateInput").checked = s.translateInput !== false;
  $("translateOutput").checked = s.translateOutput !== false;
}

$("toggleVis").onclick = () => {
  const k = $("key");
  k.type = k.type === "password" ? "text" : "password";
  $("toggleVis").textContent = k.type === "password" ? "표시" : "숨김";
};

$("save").onclick = async () => {
  const key = $("key").value.trim();
  await chrome.storage.local.set({ anthropicApiKey: key });
  status("저장됨.", "ok");
};

$("verify").onclick = async () => {
  status("검증 중…", "");
  // Save first so background reads the latest key.
  await chrome.storage.local.set({ anthropicApiKey: $("key").value.trim() });
  let r;
  try {
    r = await chrome.runtime.sendMessage({
      type: "TRANSLATE",
      payload: { text: "테스트", direction: "ko2en" }
    });
  } catch (e) {
    status("확장 연결 오류: " + String(e), "err");
    return;
  }
  if (!r) { status("응답 없음 (서비스워커 확인).", "err"); return; }
  if (r.error === "NO_API_KEY") status("키가 비어 있습니다.", "err");
  else if (r.error === "AUTH_OR_CORS") status("401: 키 또는 조직 CORS 설정 문제. 아래 8.1 참고.", "err");
  else if (r.error === "RATE_LIMIT") status("429: 레이트리밋. 잠시 후 재시도.", "err");
  else if (r.error) status("오류: " + r.error + (r.detail ? " — " + r.detail : ""), "err");
  else status("정상 동작 ✓  결과: " + r.text, "ok");
};

// Persist toggles on change.
["enabled", "translateInput", "translateOutput"].forEach((id) => {
  $(id).addEventListener("change", async () => {
    await chrome.storage.local.set({ [id]: $(id).checked });
    status("설정 저장됨.", "ok");
  });
});

load();
