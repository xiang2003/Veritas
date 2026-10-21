import type {
  AnalyzeRequest,
  AnalyzeResponse,
  PronounceResponse,
  RecommendResponse,
  Request,
  TranslateResponse,
} from '../lib/messages.ts';
import { createSettings } from '../lib/settings.ts';
import { createTts } from '../lib/speech.ts';
import { createActivation } from './activation.ts';
import { extractArticle } from './extract.ts';
import { collectHeadlines } from './headlines.ts';
import { highlightTerms } from './highlighter.ts';
import { createParagraphTools } from './paragraphs.ts';
import { createPronouncer, playAudioUrl } from './pronounce.ts';
import { createRecommendPanel, markPickedLinks } from './recommend-ui.ts';
import { createSelectionPopup, isSingleWord } from './selection.ts';
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

const MIN_HEADLINES_FOR_FRONT_PAGE = 8;

/** Front / section pages: offer AI recommendations of which stories to read. Costs nothing until clicked. */
function setUpFrontPage(): void {
  if (collectHeadlines(document).length < MIN_HEADLINES_FOR_FRONT_PAGE) return;
  injectStyles(document);
  createRecommendPanel(document, {
    load: async (force) => {
      const pageUrl = location.href.split('#')[0]!;
      const res = await send<RecommendResponse>({ type: 'recommend', pageUrl, headlines: collectHeadlines(document), force });
      if (!res.ok) throw new Error(res.error);
      markPickedLinks(document, res.picks);
      return res.picks;
    },
  });
}

async function translate(text: string, title: string, context?: string): Promise<string> {
  const res = await send<TranslateResponse>({ type: 'translate', text, title, context });
  if (!res.ok) throw new Error(res.error);
  return res.translation;
}

async function main(): Promise<void> {
  const { speechRate } = await createSettings(chrome.storage.local).get();
  const tts = createTts({
    synth: speechSynthesis,
    createUtterance: (text) => new SpeechSynthesisUtterance(text),
  });
  const pronouncer = createPronouncer({
    lookup: async (word) => {
      const res = await send<PronounceResponse>({ type: 'pronounce', word });
      return res.ok ? res.pronunciation : null;
    },
    playAudio: (url) => playAudioUrl(url),
    speak: (text) => tts.speak(text, speechRate),
  });

  const article = extractArticle(document);
  const title = article?.title ?? document.title;
  // Selection toolbar works on every activated page, article or not.
  createSelectionPopup(document, {
    translate: (text, context) => translate(text, title, context),
    // Single words get the dictionary recording; longer selections are read by the browser voice.
    pronounce: (text) => (isSingleWord(text) ? pronouncer.pronounce(text) : tts.speak(text, speechRate)),
    ipaOf: async (word) => (await pronouncer.find(word))?.ipa,
  });

  if (!article) return setUpFrontPage();
  const { root, ...data } = article;

  injectStyles(document);
  const paragraphTools = createParagraphTools({
    translate: (text) => translate(text, data.title),
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
    // Single words: the dictionary form has a human recording; phrases are spoken as written.
    speak: (entry) => void pronouncer.pronounce(entry.lemma || entry.term, entry.term),
    fetchIpa: async (entry) => (await pronouncer.find(entry.lemma || entry.term))?.ipa,
  });
}

const activation = createActivation(() => void main().catch((error) => console.error('[Veritas]', error)));
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (activation.handle(message)) sendResponse({ ok: true });
  return false;
});
