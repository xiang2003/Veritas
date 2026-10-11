import type { AnalyzeRequest, AnalyzeResponse, Request, TranslateResponse } from '../lib/messages.ts';
import { createSettings } from '../lib/settings.ts';
import { createTts } from '../lib/speech.ts';
import { extractArticle } from './extract.ts';
import { highlightTerms } from './highlighter.ts';
import { createParagraphTools } from './paragraphs.ts';
import { injectStyles } from './styles.ts';
import { showToast } from './toast.ts';
import { createTooltip } from './tooltip.ts';
import type { VocabEntry } from '../lib/types.ts';

const REAPPLY_DELAY_MS = 500;

const send = <T>(request: Request): Promise<T> => chrome.runtime.sendMessage(request);

/** Sites like CNN re-render after load and wipe our additions; re-apply (idempotent) when the DOM changes. */
function keepApplied(root: Element, apply: () => void): void {
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

  injectStyles(document);
  const { speechRate } = await createSettings(chrome.storage.local).get();
  const tts = createTts({
    synth: speechSynthesis,
    createUtterance: (text) => new SpeechSynthesisUtterance(text),
  });
  const paragraphTools = createParagraphTools({
    translate: async (text) => {
      const res = await send<TranslateResponse>({ type: 'translate', text, title: data.title });
      if (!res.ok) throw new Error(res.error);
      return res.translation;
    },
    speak: (text) => tts.speak(text, speechRate),
    stop: () => tts.stop(),
  });

  let entries: VocabEntry[] = [];
  const apply = () => {
    paragraphTools.attach(root);
    highlightTerms(root, entries);
  };
  apply();
  keepApplied(root, apply);

  const request: AnalyzeRequest = { type: 'analyze', article: data };
  const response = await send<AnalyzeResponse>(request);
  if (!response.ok) return showToast(document, response.error);
  if (!response.entries.length) return showToast(document, 'AI returned no usable vocabulary for this page.');

  entries = response.entries;
  const count = highlightTerms(root, entries);
  console.info(`[Veritas] ${entries.length} terms from AI, ${count} highlighted`, entries.map((e) => e.term));
  if (!count) showToast(document, `AI found ${entries.length} terms but none matched the page text.`);

  const byTerm = new Map(entries.map((e) => [e.term.toLowerCase(), e]));
  createTooltip(document, {
    lookup: (term) => byTerm.get(term),
    speak: (text) => void tts.speak(text, speechRate),
  });
}

main().catch((error) => console.error('[Veritas]', error));
