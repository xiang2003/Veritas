# Veritas

Chrome extension (Manifest V3, TypeScript) for reading English news and practising speaking.

- **Vocabulary underlining** – on CNN, BBC, NYT, Guardian, Reuters, AP, WaPo, NPR, CNBC and Time, hard words and phrases are underlined. Hover to see IPA, meaning (in your language), English definition, example and usage; click 🔊 to hear it.
- **Per-paragraph tools** – every paragraph gets 🔊 (read aloud, click again to stop) and 譯 buttons on its right; click 譯 to see the translation below the paragraph (cached, click again to hide).
- **Speaking tutor** – click the toolbar icon to open the side panel. Gemini has already read the article; talk about it by voice or typing (your recording is transcribed by Gemini, which also comments on pronunciation). It answers aloud (text-to-speech), lists your mistakes with explanations, and shows a better way to say what you meant.

## Setup

```bash
npm install
npm run build          # outputs dist/
```

1. `chrome://extensions` → enable Developer mode → **Load unpacked** → select `dist/`.
2. The options page opens on install: paste a free Gemini API key from <https://aistudio.google.com/apikey>, pick your level and explanation language, then click **Enable microphone**.
3. Open a news article; hard words get underlined after a few seconds.

## Development

| Command | What it does |
| --- | --- |
| `npm test` | unit tests (`node:test`, TS run natively by Node ≥ 22.18) |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run check` | both of the above |
| `npm run watch` | rebuild `dist/` on change |

## Architecture

```
src/lib/         pure logic, no chrome.* / DOM globals  (gemini, vocab, tutor, speech, recorder, settings)
src/content/     page side: extract → highlight → tooltip
src/background/  service worker: Gemini calls for the content script, per-URL cache
src/sidepanel/   controller (logic, fully tested) + view (DOM) + main (wiring)
src/options/     settings form
```

Modules talk through small interfaces (`JsonGenerator`, `StorageLike`, `View`, `RecorderLike`…) and receive their dependencies by injection, so each is tested with fakes and no network or browser.

## Adding a news site

Add its pattern to `content_scripts[0].matches` in `static/manifest.json`. If article text isn't found, add a container selector to `ROOT_SELECTORS` in `src/content/extract.ts`.

## Notes

- Free-tier Gemini keys are rate-limited; results are cached per URL (100 articles).
- Spoken answers are recorded in the side panel and sent to Gemini as audio (transcription + feedback in one call); text-to-speech uses the browser's built-in voices.
- Article text is sent to the Gemini API; nothing else leaves the browser. The API key is stored in `chrome.storage.local`.
