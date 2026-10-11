import type { JsonGenerator } from '../lib/gemini.ts';
import { articleKey, type AnalyzeResponse, type Request, type TranslateResponse } from '../lib/messages.ts';
import { createLruCache } from '../lib/lru-cache.ts';
import { translateParagraph } from '../lib/translate.ts';
import type { Settings, StorageLike } from '../lib/settings.ts';
import type { ArticleData, VocabEntry } from '../lib/types.ts';
import { analyzeVocabulary } from '../lib/vocab.ts';

const MAX_CACHED_ARTICLES = 100;
const MAX_CACHED_TRANSLATIONS = 500;

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
}

/** Short stable key for a paragraph (djb2) – avoids using kilobytes of text as a storage key. */
export function hashText(text: string): string {
  let h = 5381;
  for (let i = 0; i < text.length; i++) h = ((h << 5) + h + text.charCodeAt(i)) | 0;
  return `${(h >>> 0).toString(36)}.${text.length}`;
}

export function createHandlers({ client, getSettings, cache, session }: HandlerDeps) {
  const vocabCache = createLruCache<CachedVocab>(cache, { prefix: 'vocab:', indexKey: 'vocabIndex', max: MAX_CACHED_ARTICLES });
  const translationCache = createLruCache<string>(cache, { prefix: 'tr:', indexKey: 'trIndex', max: MAX_CACHED_TRANSLATIONS });

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

  return {
    handle(message: Request, tabId?: number): Promise<AnalyzeResponse | TranslateResponse> | undefined {
      switch (message?.type) {
        case 'analyze':
          return analyze(message.article, tabId);
        case 'translate':
          return translate(message.text, message.title);
        default:
          return undefined;
      }
    },
  };
}
