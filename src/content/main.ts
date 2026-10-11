import type { AnalyzeRequest, AnalyzeResponse } from '../lib/messages.ts';
import { createSettings } from '../lib/settings.ts';
import { createTts } from '../lib/speech.ts';
import { extractArticle } from './extract.ts';
import { highlightTerms } from './highlighter.ts';
import { injectStyles } from './styles.ts';
import { showToast } from './toast.ts';
import { createTooltip } from './tooltip.ts';

const REAPPLY_DELAY_MS = 500;

/** Sites like CNN re-render after load and wipe our spans; re-apply (idempotent) when the DOM changes. */
function keepHighlighted(root: Element, apply: () => number): void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  new MutationObserver(() => {
    clearTimeout(timer);
    timer = setTimeout(apply, REAPPLY_DELAY_MS);
  }).observe(root, { childList: true, subtree: true });
}

async function main(): Promise<void> {
  const article = extractArticle(document);
  if (!article) return;

  const { root, ...data } = article;
  const request: AnalyzeRequest = { type: 'analyze', article: data };
  const response: AnalyzeResponse = await chrome.runtime.sendMessage(request);
  if (!response.ok) return showToast(document, response.error);
  if (!response.entries.length) return showToast(document, 'AI returned no usable vocabulary for this page.');

  const { speechRate } = await createSettings(chrome.storage.local).get();
  const tts = createTts({
    synth: speechSynthesis,
    createUtterance: (text) => new SpeechSynthesisUtterance(text),
  });
  const byTerm = new Map(response.entries.map((e) => [e.term.toLowerCase(), e]));

  injectStyles(document);
  const apply = () => highlightTerms(root, response.entries);
  const count = apply();
  console.info(`[Veritas] ${response.entries.length} terms from AI, ${count} highlighted`, response.entries.map((e) => e.term));
  if (!count) showToast(document, `AI found ${response.entries.length} terms but none matched the page text.`);
  keepHighlighted(root, apply);
  createTooltip(document, {
    lookup: (term) => byTerm.get(term),
    speak: (text) => void tts.speak(text, speechRate),
  });
}

main().catch((error) => console.error('[Veritas]', error));
