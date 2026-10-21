import type {
  AnalyzeRequest,
  AnalyzeResponse,
  DefineResponse,
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
import { termKey } from '../lib/vocab.ts';

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
const LATE_HEADLINES_RETRY_MS = 2000;
let frontPageReady = false;

/**
 * Front / section pages: AI recommendations of which stories to read.
 * With `autoOpen` the picks load immediately (one request, cached 30 min per page); otherwise on click.
 * @returns whether the page qualifies as a front page
 */
function setUpFrontPage(autoOpen: boolean): boolean {
  if (frontPageReady) return true;
  if (collectHeadlines(document).length < MIN_HEADLINES_FOR_FRONT_PAGE) return false;
  frontPageReady = true;
  injectStyles(document);
  createRecommendPanel(document, {
    autoOpen,
    load: async (force) => {
      const pageUrl = location.href.split('#')[0]!;
      const res = await send<RecommendResponse>({ type: 'recommend', pageUrl, headlines: collectHeadlines(document), force });
      if (!res.ok) throw new Error(res.error);
      markPickedLinks(document, res.picks);
      return res.picks;
    },
  });
  return true;
}

/** Recommendations are the one feature that runs without activation (if enabled in Options). */
async function autoRecommend(): Promise<void> {
  const { autoRecommend } = await createSettings(chrome.storage.local).get();
  if (!autoRecommend || extractArticle(document)) return;
  // Some front pages render their story lists after load; look once more a little later.
  if (!setUpFrontPage(true)) setTimeout(() => setUpFrontPage(true), LATE_HEADLINES_RETRY_MS);
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

  // Every term with a card: the AI's article analysis plus anything the reader asked to explain.
  const vocabulary = new Map<string, VocabEntry>();
  const addTerms = (list: VocabEntry[]) => list.forEach((e) => vocabulary.set(termKey(e.term), e));
  injectStyles(document);
  createTooltip(document, {
    lookup: (key) => vocabulary.get(key),
    // Single words: the dictionary form has a human recording; phrases are spoken as written.
    speak: (entry) => void pronouncer.pronounce(entry.lemma || entry.term, entry.term),
    fetchIpa: async (entry) => (await pronouncer.find(entry.lemma || entry.term))?.ipa,
  });

  // Selection toolbar works on every activated page, article or not.
  createSelectionPopup(document, {
    translate: (text, context) => translate(text, title, context),
    define: async (term, context) => {
      const res = await send<DefineResponse>({ type: 'define', term, context, title });
      if (!res.ok) throw new Error(res.error);
      return res.entry;
    },
    onDefined: (entry) => {
      addTerms([entry]);
      if (article) highlightTerms(article.root, [entry]);
    },
    // Single words get the dictionary recording; longer selections are read by the browser voice.
    pronounce: (text) => (isSingleWord(text) ? pronouncer.pronounce(text) : tts.speak(text, speechRate)),
    ipaOf: async (word) => (await pronouncer.find(word))?.ipa,
  });

  if (!article) return void setUpFrontPage(false);
  const { root, ...data } = article;

  const paragraphTools = createParagraphTools({
    translate: (text) => translate(text, data.title),
    speak: (text) => tts.speak(text, speechRate),
    stop: () => tts.stop(),
  });

  const apply = () => {
    paragraphTools.attach(root);
    highlightTerms(root, [...vocabulary.values()]);
  };
  apply();
  keepApplied(root, apply);

  const request: AnalyzeRequest = { type: 'analyze', article: data };
  const response = await send<AnalyzeResponse>(request);
  if (!response.ok) return showToast(document, response.error);
  if (!response.entries.length) return showToast(document, 'AI returned no usable vocabulary for this page.');

  addTerms(response.entries);
  const count = highlightTerms(root, response.entries);
  console.info(`[Veritas] ${response.entries.length} terms from AI, ${count} highlighted`, response.entries.map((e) => e.term));
  if (!count) showToast(document, `AI found ${response.entries.length} terms but none matched the page text.`);
}

const activation = createActivation(() => void main().catch((error) => console.error('[Veritas]', error)));
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (activation.handle(message)) sendResponse({ ok: true });
  return false;
});
void autoRecommend().catch((error) => console.error('[Veritas]', error));
