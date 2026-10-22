import type {
  AnalyzeRequest,
  ActivateMessage,
  AnalyzeResponse,
  DefineResponse,
  OpenPanelMessage,
  PronounceResponse,
  RecommendResponse,
  SummarizeResponse,
  Request,
  TranslateResponse,
} from '../lib/messages.ts';
import { createSettings } from '../lib/settings.ts';
import { createTts } from '../lib/speech.ts';
import { createActivation } from './activation.ts';
import { installAutoOpen } from './auto-open.ts';
import { extractArticle } from './extract.ts';
import { collectHeadlines } from './headlines.ts';
import { highlightTerms } from './highlighter.ts';
import { createParagraphTools } from './paragraphs.ts';
import { createPronouncer, playAudioUrl } from './pronounce.ts';
import { createRecommendPanel, markPickedLinks } from './recommend-ui.ts';
import { blockText, createSelectionPopup, isSingleWord } from './selection.ts';
import { injectStyles } from './styles.ts';
import { createSummarySection } from './summary-ui.ts';
import { showToast } from './toast.ts';
import { createTooltip } from './tooltip.ts';
import type { VocabEntry } from '../lib/types.ts';
import { termKey } from '../lib/vocab.ts';
import { sentenceAround } from '../lib/wordbook.ts';

const REAPPLY_DELAY_MS = 500;
const DONE_TOAST_MS = 3000;
const ERROR_TOAST_MS = 12_000;

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

/** What runs without clicking the toolbar icon (each can be turned off in Options). */
async function autoStart(): Promise<void> {
  const { autoRecommend, autoOpen } = await createSettings(chrome.storage.local).get();
  if (extractArticle(document)) {
    if (!autoOpen) return;
    // News article: turn the page features on now, and open the tutor on the first click.
    const activate: ActivateMessage = { type: 'activate' };
    activation.handle(activate);
    installAutoOpen(document, async () => {
      const open: OpenPanelMessage = { type: 'open-panel' };
      const res: { ok: boolean } = await chrome.runtime.sendMessage(open);
      return res.ok;
    });
    return;
  }
  if (!autoRecommend) return;
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

  // Wordbook: each word counts once per page view, however often it is looked up here.
  const countedHere = new Set<string>();
  const recordLookup = (entry: VocabEntry, passage: string) => {
    const key = termKey(entry.lemma || entry.term);
    const count = !countedHere.has(key);
    countedHere.add(key);
    const context = { url: location.href.split('#')[0]!, title, sentence: sentenceAround(passage, entry.term) };
    void send({ type: 'record-lookup', entry, context, count }).catch(() => {});
  };

  // Every term with a card: the AI's article analysis plus anything the reader asked to explain.
  const vocabulary = new Map<string, VocabEntry>();
  const addTerms = (list: VocabEntry[]) => list.forEach((e) => vocabulary.set(termKey(e.term), e));
  injectStyles(document);
  createTooltip(document, {
    lookup: (key) => vocabulary.get(key),
    // Single words: the dictionary form has a human recording; phrases are spoken as written.
    speak: (entry) => void pronouncer.pronounce(entry.lemma || entry.term, entry.term),
    fetchIpa: async (entry) => (await pronouncer.find(entry.lemma || entry.term))?.ipa,
    onLookup: (entry, target) => recordLookup(entry, blockText(target)),
  });

  // Selection toolbar works on every activated page, article or not.
  createSelectionPopup(document, {
    translate: (text, context) => translate(text, title, context),
    define: async (term, context) => {
      const res = await send<DefineResponse>({ type: 'define', term, context, title });
      if (!res.ok) throw new Error(res.error);
      return res.entry;
    },
    onDefined: (entry, context) => {
      recordLookup(entry, context);
      addTerms([entry]);
      if (article) highlightTerms(article.root, [entry]);
    },
    onTranslated: (text, translation, context) =>
      recordLookup(
        { term: text, lemma: text, meaning: translation, pos: '', ipa: '', definition: '', example: '', usage: '' },
        context,
      ),
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

  const summary = createSummarySection(root, {
    load: async () => {
      const res = await send<SummarizeResponse>({ type: 'summarize', article: data });
      if (!res.ok) throw new Error(res.error);
      return res.summary;
    },
    speak: (text) => tts.speak(text, speechRate),
    stop: () => tts.stop(),
  });

  const apply = () => {
    paragraphTools.attach(root);
    summary.attach();
    highlightTerms(root, [...vocabulary.values()]);
  };
  apply();
  keepApplied(root, apply);

  // Analysis can take a while on long articles: keep the learner informed until it is done.
  const status = showToast(document, '正在分析這篇文章的生字…（長文章可能要一分鐘）', { persist: true });
  const request: AnalyzeRequest = { type: 'analyze', article: data };
  const response = await send<AnalyzeResponse>(request).catch(
    (error): AnalyzeResponse => ({ ok: false, error: error instanceof Error ? error.message : String(error) }),
  );
  if (!response.ok) {
    status.update(`生字分析失敗：${response.error}`);
    return status.close(ERROR_TOAST_MS);
  }
  if (!response.entries.length) {
    status.update('AI 沒有回傳可用的生字。');
    return status.close(ERROR_TOAST_MS);
  }

  addTerms(response.entries);
  const count = highlightTerms(root, response.entries);
  console.info(`[Veritas] ${response.entries.length} terms from AI, ${count} highlighted`, response.entries.map((e) => e.term));
  status.update(count ? `已標出 ${response.entries.length} 個生字` : `AI 找到 ${response.entries.length} 個生字，但和頁面文字對不上。`);
  status.close(count ? DONE_TOAST_MS : ERROR_TOAST_MS);
}

const activation = createActivation(() => void main().catch((error) => console.error('[Veritas]', error)));
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (activation.handle(message)) sendResponse({ ok: true });
  return false;
});
void autoStart().catch((error) => console.error('[Veritas]', error));
