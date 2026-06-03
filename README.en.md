<h1 align="center">Claude Korean Translator · 한↔영</h1>

<p align="center">
  <strong>Write to claude.ai in Korean. Read Claude in Korean. Pay nothing.</strong><br>
  <em>A Chrome extension that translates your prompts KO→EN before they're sent and Claude's replies EN→KO inline — on-device and free by default, or through your own Anthropic key.</em>
</p>

<p align="center">
  <img src="https://img.shields.io/github/license/TaewoooPark/claude-korean-translator?style=flat-square&labelColor=000000&color=333333&cacheSeconds=3600" alt="License">
  <img src="https://img.shields.io/github/stars/TaewoooPark/claude-korean-translator?style=flat-square&logo=github&logoColor=white&labelColor=000000&color=333333&cacheSeconds=3600" alt="Stars">
  <img src="https://img.shields.io/github/last-commit/TaewoooPark/claude-korean-translator?style=flat-square&labelColor=000000&color=333333&cacheSeconds=3600" alt="Last commit">
  <img src="https://img.shields.io/github/languages/top/TaewoooPark/claude-korean-translator?style=flat-square&labelColor=000000&color=333333&cacheSeconds=3600" alt="Top language">
  &nbsp;
  <img src="https://img.shields.io/badge/Chrome-000000?style=flat-square&logo=googlechrome&logoColor=white&labelColor=000000&cacheSeconds=3600" alt="Chrome">
  <img src="https://img.shields.io/badge/Manifest%20V3-000000?style=flat-square&labelColor=000000&color=000000&cacheSeconds=3600" alt="Manifest V3">
  <img src="https://img.shields.io/badge/JavaScript-000000?style=flat-square&logo=javascript&logoColor=white&labelColor=000000&cacheSeconds=3600" alt="JavaScript">
  <img src="https://img.shields.io/badge/On--device%20AI-000000?style=flat-square&labelColor=000000&color=000000&cacheSeconds=3600" alt="On-device AI">
  <img src="https://img.shields.io/badge/Anthropic-000000?style=flat-square&logo=anthropic&logoColor=white&labelColor=000000&cacheSeconds=3600" alt="Anthropic">
</p>

<p align="center">
  <a href="./README.md">한국어 README</a>
</p>

---

<p align="center">
  <em>You think in Korean; Claude is sharpest in English. This extension keeps both sides happy —<br>
  Korean in the box, English on the wire, Korean back on screen — without ever touching the code in your prompts.</em>
</p>

<p align="center">
  <img src="assets/demo.png" alt="Claude's English markdown answer rendered in Korean with headings, lists and code blocks preserved" width="900">
</p>
<p align="center"><sub>Claude's English answer (artifacts included) rendered in Korean — headings, lists, code blocks intact. The composer gets a <b>KO→EN 전송</b> button.</sub></p>

---

## What it does

- **Input (KO → EN).** Type your prompt in Korean, press the injected **`KO→EN 전송`** button. The text is translated to English *in place* and sent — so Claude reasons in the language it's strongest in.
- **Output (EN → KO).** Each of Claude's English answers gets a collapsible **🇰🇷 Korean translation** block appended underneath. Toggle it on/off per message.
- **Code & markdown survive.** Code fences, inline `code`, URLs, and file paths are never translated — see [How code is preserved](#how-code-is-preserved-placeholder-masking) below.
- **Questions get *translated*, not *answered*.** A naive "ask an LLM to translate" turns "explain useEffect" into an explanation. This extension never does — a translator only translates.

---

## Two backends — pick your trade-off

| | **Chrome on-device** (default) | **Anthropic API key** (optional) |
|---|---|---|
| Cost | **Free** | Your key, your usage (Haiku — pennies) |
| Setup | None — one-time model download | Paste an `sk-ant-…` key |
| Network | **Nothing leaves your machine** | Text → `api.anthropic.com` only |
| Engine | Chrome's built-in `Translator` (on-device NMT) | Claude Haiku |
| Quality | Solid for KO↔EN | A notch higher on nuance |
| Code preservation | Placeholder masking | Prompt instruction + masking |

The default is **on-device** — zero cost, zero key, works offline. The original **API-key backend is kept as an option** for anyone who wants Haiku-grade nuance. Switch any time in the extension's options. Both protect your code the same way.

> The on-device engine uses Chrome's built-in **Translator API** (on-device neural MT, shipped in current Chrome). The first time a language pair is used its model downloads once (a few seconds), then runs offline forever. To enable automatic **output** translation, click **"모델 다운로드"** once in options.

---

## How code is preserved (placeholder masking)

A raw machine-translation model translates *everything* it sees. Left alone it will rewrite `useEffect` as `UseEffect`, translate the comments inside a code block, and mangle a URL. The Anthropic backend can be *told* not to (via the prompt); an on-device NMT engine has no such knob. So before any text is handed to the translator, [`lib/code-mask.js`](lib/code-mask.js) protects everything that isn't natural language, and restores it verbatim afterwards. **Two layers:**

**1 — Fenced code blocks are split out entirely.** Anything between ` ``` … ``` ` is removed from the translation stream, kept byte-for-byte (newlines and all), and stitched back into the exact same position. The model never sees it, so it can't touch it.

**2 — Inline spans are swapped for sentinel placeholders.** In the remaining prose, inline `` `code` ``, URLs, emails, and file paths are replaced with rare math-bracket tokens **`⟦0⟧ ⟦1⟧ …`** that MT engines reliably pass through untouched. After translation the tokens are swapped back for the originals.

```text
INPUT   리액트에서 useEffect 훅을 설명해줘. `useEffect(() => {}, [])` 참고: https://react.dev
masked  리액트에서 useEffect 훅을 설명해줘. ⟦0⟧ 참고: ⟦1⟧
        → on-device translate →
        Explain the useEffect hook in React. ⟦0⟧ Reference: ⟦1⟧
OUTPUT  Explain the useEffect hook in React. `useEffect(() => {}, [])` Reference: https://react.dev
```

What's protected: ` ```fenced``` ` blocks · inline `` `code` `` · `https://…` URLs · `name@host` emails · `./path/file.ext`, `/usr/bin`, `C:\…` paths. The result: your code goes to Claude exactly as you wrote it, and Claude's code comes back to you exactly as it wrote it — only the prose around it changes language.

---

## Install (unpacked)

1. Grab the code — download the latest [release zip](https://github.com/TaewoooPark/claude-korean-translator/releases) or clone:
   ```bash
   git clone https://github.com/TaewoooPark/claude-korean-translator.git
   ```
2. Chrome → `chrome://extensions` → toggle **Developer mode** (top-right).
3. **"Load unpacked"** → select the extension folder.
4. Open the extension's **options**. Default backend is **Chrome on-device** — click **"모델 다운로드 / 확인"** once. (Or switch to **Anthropic API 키** and paste your key.)
5. Go to [claude.ai](https://claude.ai) → use the **`KO→EN 전송`** button; answers get a Korean block automatically.

> Chrome blocks self-hosted `.crx` auto-install, so the unpacked path above is the way to load it.

---

## How it works

```
claude.ai tab                                 extension
 ┌───────────────────────────┐               ┌──────────────────────────┐
 │ content script            │  backend =    │ service worker (only for │
 │  · KO→EN button + observer │  "anthropic"  │  Anthropic backend)      │
 │  · code-mask + translate  │ ────────────▶ │  · holds the API key     │
 │  · editor.setContent      │ ◀──────────── │  · calls Haiku (fetch)   │
 │                           │   {result}    └──────────────────────────┘
 │  backend = "chrome":      │
 │  on-device Translator ───▶ translate locally, no network, no key
 └───────────────────────────┘
```

- **On-device backend** runs entirely in the content script: `Translator` → translate → restore masks. Nothing is sent anywhere.
- **Anthropic backend** routes text to the service worker, which is the *only* place the API key ever lives; the key is never exposed to the page.
- claude.ai's composer is a **TipTap/ProseMirror** editor — text is written through its `editor.setContent()` so the change updates the editor's real document (a DOM-only write gets reverted by claude.ai's draft restore).

---

## Privacy

- **On-device:** text never leaves your machine. No key, no server, no telemetry.
- **Anthropic:** text goes only to `api.anthropic.com`, billed to your own key. The key is stored in `chrome.storage.local` and read only by the service worker.
- No remote code (MV3 — everything is bundled). Nothing is logged.

---

## Build & dev

```bash
./scripts/build.sh        # → claude-korean-translator-vX.Y.Z.zip (ships only the extension files)
```

- claude.ai's obfuscated DOM lives behind `content/claude-dom.js`; run `CtxDOM.diagnose()` in the page console to check selector health after a claude.ai UI change.
- `test/` has a claude.ai DOM fixture + an integration harness (real round-trip). Full verification log: [`VERIFICATION.md`](VERIFICATION.md).

## Notes

- Unofficial; not affiliated with Anthropic. A client-side helper that runs on your own session.
- claude.ai changes its UI often — if selectors break, patch `content/claude-dom.js`.
- The on-device engine needs a current Chrome with the built-in Translator API; otherwise switch to the Anthropic backend.

---

## Connect

<p align="center">
  <a href="https://github.com/TaewoooPark"><img src="https://img.shields.io/badge/-GitHub-181717?style=for-the-badge&logo=github&logoColor=white&cacheSeconds=3600" alt="GitHub"></a>
  <a href="https://www.taewoopark.com/"><img src="https://img.shields.io/badge/-Website-4F46E5?style=for-the-badge&logo=google-chrome&logoColor=white&cacheSeconds=3600" alt="Website"></a>
  <a href="https://x.com/theoverstrcture"><img src="https://img.shields.io/badge/-X-000000?style=for-the-badge&logo=x&logoColor=white&cacheSeconds=3600" alt="X (Twitter)"></a>
  <a href="https://www.linkedin.com/in/taewoo-park-427a05352"><img src="https://img.shields.io/badge/-LinkedIn-0A66C2?style=for-the-badge&logo=linkedin&logoColor=white&cacheSeconds=3600" alt="LinkedIn"></a>
  <a href="https://www.instagram.com/t.wo0_x/"><img src="https://img.shields.io/badge/-Instagram-E4405F?style=for-the-badge&logo=instagram&logoColor=white&cacheSeconds=3600" alt="Instagram"></a>
</p>

---

## License

[MIT](LICENSE) © Taewoo Park

---

<p align="center">
  <em>Korean in the box, English on the wire, Korean back on screen — and your code untouched the whole way.</em>
</p>

<sub>keywords: claude, claude.ai, korean translator, 한영 번역, 클로드 번역, chrome extension, on-device translation, chrome built-in AI, translator api, anthropic, haiku, BYOK, prompt translation</sub>
