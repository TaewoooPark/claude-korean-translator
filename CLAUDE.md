# Claude.ai 한↔영 번역 익스텐션 — Claude Code 구현 문서

> **목표**: claude.ai 웹에서 한국어로 프롬프트를 작성하면 영어로 변환해 전송하고, Claude의 영어 응답을 한국어로 번역해 보여주는 Chrome 익스텐션. 번역은 **사용자 각자가 등록한 Anthropic API 키**로 **Claude Haiku**(최저 사고 수준)를 호출해 처리한다. 공개 배포(BYOK) 가능하도록 설계한다.
>
> 이 문서는 Claude Code가 그대로 구현에 착수할 수 있는 사양서다. **"확정 사항"은 그대로 구현**하고, **"빌드 시 확인" 표시가 있는 부분(주로 claude.ai DOM 셀렉터)은 실제 페이지를 열어 검증한 뒤 채운다.**

---

## 0. 타당성 결론 (확정)

| 항목 | 결론 | 근거 |
|---|---|---|
| 브라우저에서 Anthropic API 직접 호출 | **가능** | `anthropic-dangerous-direct-browser-access: true` 헤더로 CORS 활성화 |
| BYOK(각 사용자 키) 배포 | **가능, 공식 인정 패턴** | Anthropic이 "bring your own API key"를 정당한 사용 사례로 명시 |
| Haiku 최저 사고 수준 | **가능** | extended thinking을 켜지 않음(=`thinking` 파라미터 생략)이 가장 낮고 빠름 |
| 코드/마크다운 보존 번역 | **가능** | Haiku에 "코드·마크다운은 그대로 두고 자연어만 번역" 지시 가능(순수 MT 대비 핵심 이점) |

**알아야 할 제약(나중에 사용자가 겪을 수 있는 것):**
1. 일부 Anthropic 조직은 CORS가 기본 차단되어 있어 `401 ... CORS requests are not allowed for this Organization` 이 날 수 있다. → 사용자가 Anthropic Console 조직 설정에서 클라이언트/CORS 접근을 허용해야 함. (8장 트러블슈팅 참고)
2. claude.ai는 클래스명이 난독화되어 있고 UI가 자주 바뀐다 → 셀렉터가 깨질 수 있음. 견고한 탐색 전략 + 버전 관리 필요.
3. claude.ai UI를 변형하는 익스텐션은 Anthropic 서비스 약관 검토 대상이 될 수 있음(사용자 자신의 세션·자신의 키로 동작하는 클라이언트 도구라는 점은 우호적 요소이나, 배포 전 약관 확인 권장).

---

## 1. 아키텍처 (확정)

```
┌─────────────────────────── Chrome ───────────────────────────┐
│                                                               │
│  claude.ai 탭                          익스텐션 (격리 컨텍스트)  │
│  ┌──────────────────────┐             ┌─────────────────────┐ │
│  │ content script       │  message    │ background          │ │
│  │  - 입력 가로채기       │ ──passing──▶│ service worker      │ │
│  │  - 응답 감지/주입      │ ◀──────────│  - API 키 보관(유일)  │ │
│  │  - (키 절대 안 가짐)   │  {text,dir} │  - Haiku 호출       │ │
│  └──────────────────────┘  {result}   └─────────┬───────────┘ │
│           ▲                                       │            │
│           │ DOM                                   │ fetch      │
└───────────┼───────────────────────────────────────┼───────────┘
            │                                        ▼
     claude.ai 페이지 DOM              api.anthropic.com /v1/messages
```

### 왜 이 구조인가 (중요)
- **fetch는 반드시 background service worker에서** 한다.
  - content script는 claude.ai 페이지 컨텍스트라 claude.ai의 **CSP(`connect-src`)** 에 묶여 `api.anthropic.com` 직접 호출이 차단된다.
  - service worker는 익스텐션 자체 컨텍스트라 CSP 영향을 안 받고, `host_permissions`에 도메인이 있으면 cross-origin 응답을 읽을 수 있다.
- **API 키는 background에만** 존재한다. content script(=claude.ai 페이지와 같은 탭)로 절대 보내지 않는다. 키 유출면을 최소화한다.
- 데이터 흐름: content script가 `{ text, direction }` 만 background로 보내고, background가 번역 결과 문자열만 돌려준다.

---

## 2. 프로젝트 구조 (확정)

```
claude-translator/
├── manifest.json
├── background/
│   └── service-worker.js      # 키 보관 + Haiku 호출 + 메시지 핸들러
├── content/
│   ├── content.js             # 입력 가로채기 + 응답 감지/주입 (DOM 로직)
│   ├── claude-dom.js          # claude.ai 셀렉터/DOM 헬퍼 (빌드 시 검증·교체 지점 집중)
│   └── content.css            # 주입 UI 스타일
├── options/
│   ├── options.html           # API 키 입력 + 설정
│   └── options.js
├── popup/                     # (선택) 빠른 on/off 토글
│   ├── popup.html
│   └── popup.js
├── lib/
│   └── translate-prompts.js   # 번역 system 프롬프트 (양방향)
└── icons/
    ├── icon16.png  icon48.png  icon128.png
```

---

## 3. manifest.json (확정)

```json
{
  "manifest_version": 3,
  "name": "Claude KO↔EN Translator",
  "version": "0.1.0",
  "description": "Write to Claude.ai in Korean, get answers in Korean. Translation via your own Anthropic API key (Haiku).",
  "permissions": ["storage"],
  "host_permissions": [
    "https://claude.ai/*",
    "https://*.claude.ai/*",
    "https://api.anthropic.com/*"
  ],
  "background": {
    "service_worker": "background/service-worker.js",
    "type": "module"
  },
  "content_scripts": [
    {
      "matches": ["https://claude.ai/*", "https://*.claude.ai/*"],
      "js": ["content/claude-dom.js", "content/content.js"],
      "css": ["content/content.css"],
      "run_at": "document_idle"
    }
  ],
  "options_page": "options/options.html",
  "action": { "default_popup": "popup/popup.html", "default_title": "Claude Translator" },
  "icons": { "16": "icons/icon16.png", "48": "icons/icon48.png", "128": "icons/icon128.png" }
}
```

권한 최소화 원칙: `tabs`, `scripting`, 광범위 `<all_urls>` 등은 넣지 않는다. 위 3개 호스트와 `storage`만으로 충분하다.

---

## 4. background/service-worker.js (확정)

핵심: 키 읽기 → Haiku 호출(최저 사고 수준) → 결과 반환. **여기 외에는 키를 절대 노출하지 않는다.**

```js
// background/service-worker.js
import { SYSTEM_KO_TO_EN, SYSTEM_EN_TO_KO } from "../lib/translate-prompts.js";

const API_URL = "https://api.anthropic.com/v1/messages";
const MODEL = "claude-haiku-4-5-20251001"; // 빌드 시 최신 Haiku 모델 ID 확인: docs.claude.com 모델 페이지
const ANTHROPIC_VERSION = "2023-06-01";

async function getApiKey() {
  const { anthropicApiKey } = await chrome.storage.local.get("anthropicApiKey");
  return anthropicApiKey || null;
}

async function translate({ text, direction }) {
  const apiKey = await getApiKey();
  if (!apiKey) return { error: "NO_API_KEY" };
  if (!text || !text.trim()) return { text: "" };

  const system = direction === "ko2en" ? SYSTEM_KO_TO_EN : SYSTEM_EN_TO_KO;

  // 최저 사고 수준 = thinking 파라미터 생략. max_tokens는 긴 응답 대비 넉넉히.
  const body = {
    model: MODEL,
    max_tokens: 8192,
    system,
    messages: [{ role: "user", content: text }]
  };

  let res;
  try {
    res = await fetch(API_URL, {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": ANTHROPIC_VERSION,
        "content-type": "application/json",
        // 브라우저/익스텐션에서 직접 호출 시 필수
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

  const data = await res.json();
  // thinking 미사용 시 첫 text 블록이 결과. 안전하게 text 블록만 이어 붙임.
  const out = (data.content || [])
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("");
  return { text: out };
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === "TRANSLATE") {
    translate(msg.payload).then(sendResponse);
    return true; // 비동기 응답 유지
  }
  if (msg?.type === "PING_KEY") {
    getApiKey().then((k) => sendResponse({ hasKey: !!k }));
    return true;
  }
});
```

**주의**
- `max_tokens`는 필수 필드다. 8192로 두되, 매우 긴 응답에서 잘릴 수 있으니 입력 길이에 비례해 동적 산정하거나 응답이 잘렸는지(`stop_reason === "max_tokens"`) 확인해 사용자에게 표시하는 로직을 선택적으로 추가.
- 키·요청 본문을 절대 `console.log` 하지 않는다.

---

## 5. lib/translate-prompts.js (확정)

Haiku의 핵심 이점 = "코드·서식은 보존하고 자연어만 번역"을 지시할 수 있다는 것. 순수 기계번역이 코드/마크다운을 망가뜨리는 문제를 여기서 막는다.

```js
// lib/translate-prompts.js
export const SYSTEM_KO_TO_EN = `You are a translation engine. Translate the user's message from Korean to natural, fluent English.
Rules:
- Output ONLY the translation. No preamble, no quotes, no notes.
- Preserve all Markdown, code fences, inline code, URLs, file paths, and technical identifiers EXACTLY as-is. Translate only natural-language text.
- Do NOT translate or alter anything inside code blocks (\`\`\`...\`\`\`) or inline code (\`...\`).
- Keep the original meaning, tone, and formatting/line breaks.
- If the text is already English, return it unchanged.`;

export const SYSTEM_EN_TO_KO = `You are a translation engine. Translate the user's message from English to natural, fluent Korean.
Rules:
- Output ONLY the translation. No preamble, no quotes, no notes.
- Preserve all Markdown, code fences, inline code, URLs, file paths, and technical identifiers EXACTLY as-is. Translate only natural-language text.
- Do NOT translate or alter anything inside code blocks (\`\`\`...\`\`\`) or inline code (\`...\`). Keep code comments in their original language unless they are obviously natural-language prose.
- Keep the original meaning, tone, and Markdown structure/line breaks.
- Use natural Korean technical writing; keep well-known technical terms in English where that is conventional.`;
```

---

## 6. content/claude-dom.js — DOM 헬퍼 (⚠️ 빌드 시 검증)

> claude.ai DOM은 난독화·변동이 잦다. **이 파일에 셀렉터/조작 로직을 모아두고, 실제 페이지에서 검증한 값으로 채운다.** 아래는 동작 원리와 견고한 탐색 전략. 하드코딩된 클래스명은 신뢰하지 말 것.

### 6.1 입력 컴포저
- claude.ai 입력창은 **contenteditable(ProseMirror) 에디터**일 가능성이 높다(일반 `<textarea>`가 아님). 빌드 시 DevTools로 확인.
- 탐색 전략(우선순위): `[contenteditable="true"]` 중 보이는 메인 입력 → `[role="textbox"]` → `.ProseMirror`. 여러 후보 중 화면에 보이고 포커스 가능한 것을 선택.
- **텍스트 읽기**: `editor.textContent`.
- **텍스트 교체(ProseMirror 주의)**: `el.textContent = "..."` 만으로는 에디터 내부 상태가 갱신되지 않는다. 다음 중 동작하는 방식을 채택:
  1. 포커스 → 전체선택 → `document.execCommand("insertText", false, englishText)` (deprecated지만 ProseMirror에서 보통 동작, `beforeinput`/`input` 이벤트를 발생시킴)
  2. 실패 시 **paste 이벤트 시뮬레이션**: `DataTransfer`에 text 넣고 `ClipboardEvent("paste", {clipboardData})` dispatch
  3. 그래도 안 되면 `InputEvent("beforeinput", {inputType:"insertText", data})` 수동 dispatch
- 교체 후 React/ProseMirror가 상태를 반영하도록 `input` 이벤트를 dispatch.

### 6.2 전송 트리거
- 전송 버튼 탐색: `button[aria-label*="Send" i]`, 한국어 UI 대비 `aria-label*="보내기"`, `button[type="submit"]` 등 **여러 후보를 OR로** 시도. data-* 속성이 있으면 우선.
- 전송 실행: 버튼이 있으면 `.click()`, 폴백으로 컴포저에 `Enter` keydown dispatch.

### 6.3 응답 메시지
- 대화 컨테이너 탐색: 메시지들이 들어가는 스크롤 영역. `[data-testid]`, `main`, role 기반으로 식별.
- 어시스턴트 메시지 노드 식별: 사용자/어시스턴트 구분 속성(`data-message-author-role` 류) 또는 구조적 위치. 빌드 시 확인.
- **응답 원문 추출(중요)**: 렌더된 HTML이 아니라 **마크다운 원문**을 얻어야 코드/서식 보존 번역이 잘 된다.
  1. 우선: 메시지에 붙는 **"복사" 버튼**이 마크다운 원문을 클립보드에 넣는 경우가 많다 → 프로그램적으로 활용 가능하면 사용. 또는 메시지 노드의 raw 데이터 속성 탐색.
  2. 폴백: `messageEl.innerText` (줄바꿈은 보존되나 코드펜스 백틱은 사라짐 → Haiku가 코드/프로즈 구분이 약해질 수 있음. 허용 가능한 수준이면 사용).

### 6.4 함수 시그니처(이 파일이 export 해야 할 것)
```js
export function findComposer() {}              // -> HTMLElement | null
export function readComposerText(el) {}        // -> string
export async function setComposerText(el, t){} // ProseMirror-safe 교체
export function triggerSend(el) {}             // 전송
export function getConversationRoot() {}       // -> HTMLElement | null
export function isAssistantMessage(node) {}    // -> boolean
export function extractMessageMarkdown(node){} // -> string (복사버튼/innerText 폴백)
export function isMessageComplete(node) {}     // 완료 감지(아래 7.2)
```

---

## 7. content/content.js — 메인 로직 (확정 골격 + ⚠️ 셀렉터는 6장 의존)

### 7.1 입력 경로 (권장: 자체 버튼 방식)
비동기 번역을 **전송 전에** 끝내기 위해, 컴포저 옆에 자체 버튼("한국어→전송")을 주입하는 방식을 1순위로 한다. Enter 가로채기(아래 대안)는 동기 이벤트 중간에 await가 끼어 레이스가 생기므로 2순위.

```js
// content/content.js (요약)
import * as DOM from "./claude-dom.js";

let settings = { enabled: true, translateInput: true, translateOutput: true };

async function translateViaBg(text, direction) {
  const r = await chrome.runtime.sendMessage({ type: "TRANSLATE", payload: { text, direction } });
  if (r?.error) { showError(r); return null; }
  return r.text;
}

// --- 입력: 자체 버튼 ---
function injectSendButton() {
  const composer = DOM.findComposer();
  if (!composer || document.getElementById("ctx-ko-send")) return;
  const btn = document.createElement("button");
  btn.id = "ctx-ko-send";
  btn.textContent = "KO→EN 전송";
  btn.className = "ctx-ko-send-btn";
  btn.addEventListener("click", async () => {
    if (!settings.enabled || !settings.translateInput) return;
    const ko = DOM.readComposerText(composer).trim();
    if (!ko) return;
    btn.disabled = true; btn.textContent = "번역 중…";
    const en = await translateViaBg(ko, "ko2en");
    btn.disabled = false; btn.textContent = "KO→EN 전송";
    if (en == null) return;
    await DOM.setComposerText(composer, en);
    DOM.triggerSend(composer);
  });
  // 컴포저 인근에 배치 (빌드 시 적절한 부모에 append)
  composer.parentElement?.appendChild(btn);
}
```

**대안: Enter 가로채기** (자체 버튼이 UX상 싫을 때)
```js
composer.addEventListener("keydown", async (e) => {
  if (e.key === "Enter" && !e.shiftKey && settings.enabled && settings.translateInput) {
    e.preventDefault();
    e.stopImmediatePropagation(); // capture 단계에서 등록 필요
    const ko = DOM.readComposerText(composer).trim();
    if (!ko) return;
    const en = await translateViaBg(ko, "ko2en");
    if (en == null) return;
    await DOM.setComposerText(composer, en);
    DOM.triggerSend(composer);
  }
}, true); // ← capture=true 로 claude.ai 핸들러보다 먼저
```
> UX 메모: 두 방식 모두 **전송된 메시지 버블에는 영어가 표시**된다(claude.ai가 저장하는 건 실제 전송된 영어). 사용자의 원래 한국어를 화면에 함께 남기고 싶다면 별도 주입이 필요 — "열린 결정"(11장) 참고.

### 7.2 출력 경로 (응답 감지 → 번역 → 한국어 주입)
```js
function startOutputObserver() {
  const root = DOM.getConversationRoot();
  if (!root) return;
  const seen = new WeakSet();

  const observer = new MutationObserver(() => {
    if (!settings.enabled || !settings.translateOutput) return;
    const msgs = root.querySelectorAll("[data-assistant-message], .assistant-msg /* ⚠️빌드시 교체 */");
    msgs.forEach((node) => {
      if (seen.has(node)) return;
      if (!DOM.isAssistantMessage(node)) return;
      if (!DOM.isMessageComplete(node)) return; // 스트리밍 끝났는지
      seen.add(node);
      handleAssistantMessage(node);
    });
  });
  observer.observe(root, { childList: true, subtree: true });
}

async function handleAssistantMessage(node) {
  const en = DOM.extractMessageMarkdown(node);
  if (!en?.trim()) return;
  const ko = await translateViaBg(en, "en2ko");
  if (ko == null) return;
  injectKoreanBlock(node, ko);
}

function injectKoreanBlock(node, ko) {
  if (node.querySelector(".ctx-ko-translation")) return;
  const box = document.createElement("div");
  box.className = "ctx-ko-translation";
  // 마크다운 렌더가 필요하면 간단한 렌더러를 쓰거나 <pre>로 줄바꿈 보존
  box.innerText = ko;            // 안전: 텍스트 그대로(줄바꿈 보존)
  const toggle = document.createElement("button");
  toggle.textContent = "원문/번역 토글";
  toggle.className = "ctx-ko-toggle";
  toggle.onclick = () => box.classList.toggle("collapsed");
  node.appendChild(toggle);
  node.appendChild(box);
}
```

**완료 감지(`isMessageComplete`) 전략** — 다음 중 신뢰되는 것 채택:
1. **전송/중지 버튼 토글**: 생성 중에는 "중지(stop)" 버튼이 떠 있고 끝나면 "보내기"로 바뀐다 → 전역 상태로 "현재 생성 중 아님"을 판단.
2. **액션 툴바 등장**: 메시지 하단에 복사/재생성 등 버튼이 나타나면 완료.
3. **디바운스 폴백**: 해당 메시지 노드가 ~600ms 동안 mutation이 없으면 완료로 간주.

---

## 8. options/ — API 키 입력 & 설정 (확정)

`options.html`: 키 입력(type=password), 저장 버튼, "키 검증" 버튼, 토글(번역 입력/출력 on·off), 안내 문구(키는 로컬에만 저장·내 키로 과금됨).

```js
// options/options.js (요약)
document.getElementById("save").onclick = async () => {
  const key = document.getElementById("key").value.trim();
  await chrome.storage.local.set({ anthropicApiKey: key });
  status("저장됨");
};
document.getElementById("verify").onclick = async () => {
  // background를 통해 짧은 테스트 번역을 돌려 401/CORS/네트워크를 사전 점검
  const r = await chrome.runtime.sendMessage({ type: "TRANSLATE", payload: { text: "테스트", direction: "ko2en" }});
  if (r?.error === "AUTH_OR_CORS") status("키 또는 조직 CORS 설정 문제(401). 8.1 참고", true);
  else if (r?.error) status("오류: " + r.error, true);
  else status("정상: " + r.text);
};
// 토글 값들도 chrome.storage.local 에 저장하고, content.js가 시작 시/변경 시 로드
```

content.js는 시작 시 `chrome.storage.local.get`으로 설정을 읽고, `chrome.storage.onChanged`로 실시간 반영.

### 8.1 트러블슈팅 (사용자 안내에 포함)
- `401 ... CORS requests are not allowed for this Organization`: 사용자의 Anthropic 조직이 클라이언트 측 호출을 막은 상태. **Anthropic Console의 조직 설정에서 client-side/CORS(직접 브라우저 접근) 허용**을 켜야 한다. (설정 명칭은 콘솔에서 확인)
- `401 authentication_error`(키 문제): 키 오타/비활성/크레딧 부족.
- `429`: 레이트리밋 → 재시도 백오프 안내.

---

## 9. content.css (확정, 최소)

```css
.ctx-ko-send-btn { margin: 6px; padding: 6px 10px; border-radius: 8px; cursor: pointer; }
.ctx-ko-send-btn:disabled { opacity: .6; cursor: default; }
.ctx-ko-translation {
  margin-top: 8px; padding: 10px 12px; border-left: 3px solid currentColor;
  opacity: .92; white-space: pre-wrap; font-size: .95em; border-radius: 6px;
}
.ctx-ko-translation.collapsed { display: none; }
.ctx-ko-toggle { margin-top: 6px; font-size: .8em; opacity: .7; cursor: pointer; }
```
> 색상은 claude.ai 다크/라이트 테마와 충돌하지 않게 `currentColor`/투명 배경 위주로. 라이트/다크 모두에서 가독성 빌드 시 확인.

---

## 10. 보안 (확정 요구사항)

1. **키 격리**: API 키는 `chrome.storage.local`에 저장하고 **background service worker만** 읽는다. content script/페이지로 전달 금지. 메시지 프로토콜로 오가는 건 평문 텍스트와 번역 결과뿐.
2. **로깅 금지**: 키·요청 본문·응답 본문을 콘솔/원격에 남기지 않는다.
3. **저장 한계 고지**: `chrome.storage.local`은 암호화 저장은 아니지만 익스텐션 단위로 격리됨. "본인 키, 본인 기기"라는 점을 옵션 화면에 명시.
4. **외부 전송 없음**: 텍스트는 오직 `api.anthropic.com`으로만 간다. 제3 서버 경유 금지(BYOK의 신뢰 포인트).
5. **권한 최소화**: manifest 권한은 3장 그대로. 추가 권한 도입 시 정당성 문서화.
6. **원격 코드 금지(MV3)**: 모든 JS를 패키지에 포함. eval/원격 스크립트 로드 금지.

---

## 11. 열린 결정 (구현 전에 한 번 정할 것)

| 결정 | 옵션 A | 옵션 B | 문서 기본값 |
|---|---|---|---|
| 입력 트리거 | 자체 버튼 | Enter 가로채기 | **자체 버튼**(레이스 회피) |
| 출력 표시 | 영문 아래 한국어 **추가**(토글) | 영문을 한국어로 **치환** | **추가**(비파괴) |
| 내 메시지 표시 | 영어 버블 그대로 | 한국어 원문도 함께 주입 | 영어 그대로(단순) |
| 한국어 블록 렌더 | 텍스트(`innerText`) | 마크다운 렌더 | 텍스트(안전) |
| 배포 | Chrome Web Store | unpacked/사내 | 둘 다 지원, 공개는 Store |

---

## 12. 테스트 체크리스트

- [ ] 옵션에서 키 저장 → "키 검증"이 정상 번역 반환
- [ ] 잘못된 키 → `AUTH_OR_CORS`/`401`이 사용자 메시지로 노출
- [ ] 조직 CORS 차단 케이스의 안내 문구 노출
- [ ] 한국어 입력 → 컴포저에 영어로 교체되어 전송됨(ProseMirror 상태 정상 갱신)
- [ ] 코드블록 포함 한국어 프롬프트 → 코드 보존되어 영어로 전송
- [ ] 어시스턴트 응답(코드/마크다운 포함) → 완료 후 한국어 블록 주입, 코드 보존
- [ ] 스트리밍 도중 중복 주입 없음(`seen` WeakSet, 완료 감지 동작)
- [ ] 긴 응답 시 `max_tokens` 잘림 처리/표시
- [ ] 라이트/다크 테마에서 주입 UI 가독성
- [ ] on/off 토글 즉시 반영
- [ ] claude.ai 새 대화/대화 전환 후에도 옵저버·버튼 재주입(SPA 라우팅 대응; URL 변화 감지해 재초기화)

> claude.ai는 SPA라 페이지 전환 시 DOM이 갈린다. `MutationObserver`로 컴포저/컨테이너 재등장 감지 또는 history 변경 감지로 **재초기화** 로직을 반드시 넣을 것.

---

## 13. 배포 (Chrome Web Store)

1. **Manifest V3** 필수(MV2 불가).
2. Chrome Web Store 개발자 계정 등록(1회 등록비). 패키지 zip 업로드 후 심사.
3. **개인정보/데이터 사용 고지**: 이 익스텐션은 사용자가 입력/수신한 텍스트를 사용자 본인 키로 `api.anthropic.com`에 전송한다. 스토어의 데이터 사용 항목을 정확히 기재하고 **개인정보처리방침 URL**을 제공.
4. **권한 정당화**: `storage`(키/설정), `claude.ai` 호스트(주입), `api.anthropic.com` 호스트(번역 호출) — 각 사유 명시.
5. **원격 코드 금지** 준수(모든 코드 패키지 동봉).
6. **약관 주의**: claude.ai UI 변형/자동화에 대한 Anthropic 약관을 배포 전 확인. 클라이언트 측·본인 키 동작이라는 점을 설명에 명확히.
7. 대안 배포: unpacked(개발자 모드 로드), 사내 배포, Edge Add-ons 등.

---

## 14. 개발/로컬 실행

1. 위 구조로 파일 생성, `icons/`에 16/48/128 PNG 배치.
2. Chrome → `chrome://extensions` → 개발자 모드 ON → "압축해제된 확장 프로그램 로드" → 폴더 선택.
3. 옵션 페이지에서 Anthropic 키 입력 → "키 검증".
4. claude.ai 접속 → DevTools로 6장 셀렉터 확인·`claude-dom.js` 채우기 → 입력/출력 흐름 테스트.
5. `service-worker.js`는 수정 시 `chrome://extensions`에서 reload.

---

## 15. 구현 순서 권장 (Claude Code용 작업 분해)

1. manifest + 빈 파일 스캐폴드 + 아이콘.
2. `lib/translate-prompts.js` + `background/service-worker.js` 완성 → 옵션 페이지로 **번역 단독 동작** 검증(DOM 없이). ← 가장 확실한 핵심부터.
3. `options/` 키 입력·검증·설정 저장.
4. `content/claude-dom.js`를 **실제 claude.ai에서 검증**하며 채움(가장 불확실한 부분).
5. `content/content.js` 입력 경로(자체 버튼) → 출력 경로(옵저버) 순으로 연결.
6. SPA 재초기화, 완료 감지 튜닝, 테마 스타일.
7. 테스트 체크리스트 → 배포 패키징.

---

### 부록: 빌드 시 재확인 항목 (변동 가능 사실)
- 최신 Haiku 모델 ID (`docs.claude.com` 모델 페이지)
- `anthropic-version` 최신 권장 값(현재 `2023-06-01`로 동작)
- Anthropic Console의 조직 CORS/클라이언트 접근 설정 명칭·위치
- claude.ai 컴포저/메시지/버튼 셀렉터 (난독화·변동)