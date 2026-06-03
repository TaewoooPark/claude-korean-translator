// options/options.js
const $ = (id) => document.getElementById(id);
const CT = window.CtxChromeTranslator;

function status(msg, kind) { const el = $("status"); el.textContent = msg; el.className = kind || ""; }

const AV_LABEL = {
  available: "다운로드됨 ✓",
  downloadable: "다운로드 필요",
  downloading: "다운로드 중…",
  unavailable: "미지원",
  "no-api": "이 브라우저는 내장 번역 API를 지원하지 않습니다"
};

async function refreshAiStatus() {
  const el = $("aiStatus");
  if (!CT || !CT.isSupported()) {
    el.className = "err";
    el.innerHTML = "이 브라우저는 Chrome 내장 번역 API를 지원하지 않습니다. 최신 Chrome을 쓰거나, 위에서 <b>Anthropic API 키</b> 백엔드로 전환하세요.";
    return;
  }
  const s = await CT.status();
  el.className = "muted";
  el.innerHTML = `한국어→영어: <b>${AV_LABEL[s.ko2en] || s.ko2en}</b> · 영어→한국어: <b>${AV_LABEL[s.en2ko] || s.en2ko}</b>`;
}

function applyBackendUI(backend) {
  const isChrome = backend !== "anthropic";
  $("panel-chrome").classList.toggle("hidden", !isChrome);
  $("panel-anthropic").classList.toggle("hidden", isChrome);
  $("lblChrome").classList.toggle("sel", isChrome);
  $("lblAnthropic").classList.toggle("sel", !isChrome);
  document.querySelector('input[name=backend][value=chrome]').checked = isChrome;
  document.querySelector('input[name=backend][value=anthropic]').checked = !isChrome;
  if (isChrome) refreshAiStatus();
}

async function load() {
  const s = await chrome.storage.local.get([
    "anthropicApiKey", "enabled", "translateInput", "translateOutput", "backend"
  ]);
  $("key").value = s.anthropicApiKey || "";
  $("enabled").checked = s.enabled !== false;
  $("translateInput").checked = s.translateInput !== false;
  $("translateOutput").checked = s.translateOutput !== false;
  applyBackendUI(s.backend === "anthropic" ? "anthropic" : "chrome");
}

// ---- backend selector ----
document.querySelectorAll('input[name=backend]').forEach((r) => {
  r.addEventListener("change", async () => {
    const backend = document.querySelector("input[name=backend]:checked").value;
    await chrome.storage.local.set({ backend });
    applyBackendUI(backend);
  });
});

// ---- on-device model download (runs under this click = user gesture) ----
$("dlModels").onclick = async () => {
  if (!CT || !CT.isSupported()) { refreshAiStatus(); return; }
  const btn = $("dlModels"); btn.disabled = true; const orig = btn.textContent;
  try {
    for (const dir of ["ko2en", "en2ko"]) {
      btn.textContent = `${dir === "ko2en" ? "KO→EN" : "EN→KO"} 다운로드 중…`;
      await CT.download(dir, () => {});
    }
    btn.textContent = orig;
    $("aiStatus").className = "ok"; $("aiStatus").textContent = "온디바이스 모델 준비 완료 ✓ (오프라인·무료)";
  } catch (e) {
    btn.textContent = orig;
    $("aiStatus").className = "err"; $("aiStatus").textContent = "다운로드 실패: " + (e && e.message || e);
  } finally {
    btn.disabled = false;
    setTimeout(refreshAiStatus, 800);
  }
};

// ---- Anthropic key ----
$("toggleVis").onclick = () => {
  const k = $("key"); k.type = k.type === "password" ? "text" : "password";
  $("toggleVis").textContent = k.type === "password" ? "표시" : "숨김";
};
$("save").onclick = async () => {
  await chrome.storage.local.set({ anthropicApiKey: $("key").value.trim() });
  status("저장됨.", "ok");
};
$("verify").onclick = async () => {
  status("검증 중…", "");
  await chrome.storage.local.set({ anthropicApiKey: $("key").value.trim() });
  let r;
  try { r = await chrome.runtime.sendMessage({ type: "TRANSLATE", payload: { text: "테스트", direction: "ko2en" } }); }
  catch (e) { status("확장 연결 오류: " + String(e), "err"); return; }
  if (!r) status("응답 없음 (서비스워커 확인).", "err");
  else if (r.error === "NO_API_KEY") status("키가 비어 있습니다.", "err");
  else if (r.error === "AUTH_OR_CORS") status("401: 키 또는 조직 CORS 설정 문제.", "err");
  else if (r.error === "RATE_LIMIT") status("429: 레이트리밋. 잠시 후 재시도.", "err");
  else if (r.error) status("오류: " + r.error, "err");
  else status("정상 동작 ✓  결과: " + r.text, "ok");
};

// ---- toggles ----
["enabled", "translateInput", "translateOutput"].forEach((id) => {
  $(id).addEventListener("change", async () => {
    await chrome.storage.local.set({ [id]: $(id).checked });
    status("설정 저장됨.", "ok");
  });
});

load();
