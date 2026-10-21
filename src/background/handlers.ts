import type { JsonGenerator } from '../lib/gemini.ts';
import {
  articleKey,
  type AnalyzeResponse,
  type PronounceResponse,
  type RecommendRequest,
  type RecommendResponse,
  type Request,
  type Response,
  type TranslateResponse,
} from '../lib/messages.ts';
import { recommendHeadlines, type Recommendation } from '../lib/recommend.ts';
import { lookupPronunciation, type Pronunciation } from '../lib/dictionary.ts';
import { createLruCache } from '../lib/lru-cache.ts';
import { translateParagraph } from '../lib/translate.ts';
import type { Settings, StorageLike } from '../lib/settings.ts';
import type { ArticleData, VocabEntry } from '../lib/types.ts';
import { analyzeVocabulary } from '../lib/vocab.ts';

const MAX_CACHED_ARTICLES = 100;
const MAX_CACHED_TRANSLATIONS = 500;
const MAX_CACHED_PAGES = 30;
const MAX_CACHED_PRONUNCIATIONS = 500;
/** Front pages change through the day, so recommendations expire. */
const RECOMMENDATION_TTL_MS = 30 * 60_000;

interface CachedPicks {
  at: number;
  signature: string;
  picks: Recommendation[];
}

interface CachedVocab {
  signature: string;
  entries: VocabEntry[];
}

export interface HandlerDeps {
  client: JsonGenerator;
  getSettings: () => Promise<Settings>;
  /** Persistent cache (chrome.storage.local). */
  cache: StorageLike;
  /** Per-browser-session store shared with the side panel (chrome.storage.session). */
  session: StorageLike;
  now?: () => number;
  /** Used for the (keyless) dictionary API; Gemini calls go through `client`. */
  fetch?: typeof fetch;
}

/** Short stable key for a paragraph (djb2) – avoids using kilobytes of text as a storage key. */
export function hashText(text: string): string {
  let h = 5381;
  for (let i = 0; i < text.length; i++) h = ((h << 5) + h + text.charCodeAt(i)) | 0;
  return `${(h >>> 0).toString(36)}.${text.length}`;
}

export function createHandlers({
  client,
  getSettings,
  cache,
  session,
  now = Date.now,
  fetch: fetchImpl = globalThis.fetch,
}: HandlerDeps) {
  const vocabCache = createLruCache<CachedVocab>(cache, { prefix: 'vocab:', indexKey: 'vocabIndex', max: MAX_CACHED_ARTICLES });
  const translationCache = createLruCache<string>(cache, { prefix: 'tr:', indexKey: 'trIndex', max: MAX_CACHED_TRANSLATIONS });
  const picksCache = createLruCache<CachedPicks>(cache, { prefix: 'rec:', indexKey: 'recIndex', max: MAX_CACHED_PAGES });
  // Unknown words are cached too ({ found: null }) so they are not looked up again.
  const pronunciationCache = createLruCache<{ found: Pronunciation | null }>(cache, {
    prefix: 'pron:',
    indexKey: 'pronIndex',
    max: MAX_CACHED_PRONUNCIATIONS,
  });

  async function analyze(article: ArticleData, tabId: number | undefined): Promise<AnalyzeResponse> {
    try {
      if (tabId !== undefined) await session.set({ [articleKey(tabId)]: article });

      const settings = await getSettings();
      if (!settings.autoHighlight) return { ok: true, entries: [] };

      const signature = `${settings.level}|${settings.nativeLanguage}`;
      const hit = await vocabCache.get(article.url);
      if (hit && hit.signature === signature) return { ok: true, entries: hit.entries };

      const entries = await analyzeVocabulary(client, article, settings);
      if (entries.length) await vocabCache.set(article.url, { signature, entries }); // never cache an empty result
      return { ok: true, entries };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  async function translate(text: string, title: string): Promise<TranslateResponse> {
    try {
      const { nativeLanguage } = await getSettings();
      const key = `${nativeLanguage}|${hashText(text)}`;
      const cached = await translationCache.get(key);
      if (cached) return { ok: true, translation: cached };

      const translation = await translateParagraph(client, text, { nativeLanguage, title });
      await translationCache.set(key, translation);
      return { ok: true, translation };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  async function recommend({ pageUrl, headlines, force }: RecommendRequest): Promise<RecommendResponse> {
    try {
      const settings = await getSettings();
      const signature = `${settings.level}|${settings.nativeLanguage}|${settings.interests}`;
      const hit = force ? undefined : await picksCache.get(pageUrl);
      if (hit && hit.signature === signature && now() - hit.at < RECOMMENDATION_TTL_MS) return { ok: true, picks: hit.picks };

      const picks = await recommendHeadlines(client, headlines, settings);
      await picksCache.set(pageUrl, { at: now(), signature, picks });
      return { ok: true, picks };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  async function pronounce(word: string): Promise<PronounceResponse> {
    try {
      const key = word.trim().toLowerCase();
      const hit = await pronunciationCache.get(key);
      if (hit) return { ok: true, pronunciation: hit.found };
      const found = await lookupPronunciation(fetchImpl, key);
      await pronunciationCache.set(key, { found });
      return { ok: true, pronunciation: found };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  return {
    handle(message: Request, tabId?: number): Promise<Response> | undefined {
      switch (message?.type) {
        case 'analyze':
          return analyze(message.article, tabId);
        case 'translate':
          return translate(message.text, message.title);
        case 'recommend':
          return recommend(message);
        case 'pronounce':
          return pronounce(message.word);
        default:
          return undefined;
      }
    },
  };
}
