# Veritas

Chrome extension (Manifest V3, TypeScript) for reading English news and practising speaking.

On a news article Veritas turns itself on: the page features below start right away, and a **💬 AI 教練** button at the bottom right opens the tutor side panel (Chrome only lets extensions open the side panel in response to a user action, such as clicking that button or the toolbar icon). The panel only exists on the supported news sites: switching to any other tab hides it, switching back to a news tab shows it again with that article's own conversation. News front pages show article recommendations straight away. Both can be turned off in Options, in which case Veritas stays off until you click its toolbar icon.

- **Vocabulary underlining** – on CNN, BBC, NYT, Guardian, Reuters, AP, WaPo, NPR, CNBC and Time, hard words and phrases are underlined. Hover to see IPA, meaning (in your language), English definition, example, usage and a link to the Cambridge Dictionary entry; click 🔊 to hear a human recording from the free [Free Dictionary API](https://dictionaryapi.dev) (falls back to the browser voice for phrases or when the site blocks audio). The dictionary's IPA replaces the AI's estimate when available.
- **Per-paragraph tools** – every paragraph gets 🔊 (read aloud, click again to stop) and 譯 buttons on its right; click 譯 to see the translation below the paragraph (cached, click again to hide).
- **Article summary** – a 📝 文章總結 section after the article: click 產生總結 for the story in one English sentence plus 3–5 key points at your level (🔊 to listen) and a summary in your language, hidden until you ask so you read the English first. One request per article, cached.
- **Selection toolbar** – select any English text on an activated page to get 🔊 (human recording for single words, browser voice otherwise) and 譯 (translated in the sense used in its paragraph; one request, cached). For words and short phrases, 解釋 gives a full vocabulary card (meaning, definition, example, usage, Cambridge link) and underlines the term on the page – useful for anything the automatic analysis missed. Single words also show their dictionary IPA.
- **What to read** – on a news front or section page, a panel opens bottom right (or click **✨ 推薦文章** if auto-recommend is off): Gemini picks the 5 stories most worth reading for your level and interests (set in Options), with a reason, estimated level and topic, and marks them ⭐ on the page. One request per click, cached for 30 minutes.
- **Wordbook (生字本)** – every word you look up (card read for 1s, 🔊 played, or 解釋/譯 on a selected word) is recorded with its meaning and the sentence you met it in; a word counts once per page. Open it with 📒 in the side panel: words are sorted by how often you looked them up (your least familiar first), can be searched, played, marked 「我會了」 (looking one up again brings it back) or deleted, and exported to CSV for Anki. Stored only in your browser.
- **Speaking tutor** – click the toolbar icon to open the side panel. Gemini has already read the article and opens the conversation itself with an easy question, guiding you step by step from what happened to your opinion, with 💡 sentence starters you can click to fill in; answer by voice or typing (your recording is transcribed verbatim by a separate, context-free Gemini call so the tutor's expectations cannot change what you said; it also flags mispronounced words). It answers aloud (text-to-speech), lists your mistakes with explanations, and shows a better way to say what you meant.

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
src/content/     page side: extract → highlight → tooltip; front pages: headlines → recommendations
src/background/  service worker: Gemini calls for the content script, per-URL cache
src/sidepanel/   controller (logic, fully tested) + view (DOM) + main (wiring)
src/options/     settings form
src/wordbook/    wordbook page: view (filter/render, tested) + main (wiring)
```

Modules talk through small interfaces (`JsonGenerator`, `StorageLike`, `View`, `RecorderLike`…) and receive their dependencies by injection, so each is tested with fakes and no network or browser.

## Adding a news site

Add its pattern to `content_scripts[0].matches` in `static/manifest.json`. If article text isn't found, add a container selector to `ROOT_SELECTORS` in `src/content/extract.ts`.

## Notes

- Models are chosen per task (`src/lib/models.ts`): `gemini-3.8-flash` for vocabulary analysis and the tutor, `gemini-3.5-flash` for speech transcription (so a spoken turn uses two quotas), `gemini-3.5-flash-lite` for translation, explanations, recommendations and summaries. Free-tier quotas are per model, so this also spreads the daily budget. When a model's quota is used up, it is overloaded or unavailable, the next model takes over, one quality tier at a time; a used-up model is skipped until its quota resets.
- Results are cached: vocabulary per article (100), translations and explanations (500 each), recommendations per page for 30 minutes, summaries per article (100), pronunciations (500).
- Spoken answers are recorded in the side panel and cost two requests: a transcription call that sees only the audio, then the tutor call that sees only the transcript. Text-to-speech uses the browser's built-in voices.
- Article text is sent to the Gemini API; nothing else leaves the browser. The API key is stored in `chrome.storage.local`.
