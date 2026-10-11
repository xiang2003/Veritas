import type { JsonGenerator } from '../lib/gemini.ts';
import { articleKey, type AnalyzeRequest, type AnalyzeResponse } from '../lib/messages.ts';
import type { Settings, StorageLike } from '../lib/settings.ts';
import type { ArticleData, VocabEntry } from '../lib/types.ts';
import { analyzeVocabulary } from '../lib/vocab.ts';

const INDEX_KEY = 'vocabIndex';
const MAX_CACHED_ARTICLES = 100;

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

const cacheKey = (url: string) => `vocab:${url}`;

export function createHandlers({ client, getSettings, cache, session }: HandlerDeps) {
  async function remember(url: string, value: CachedVocab): Promise<void> {
    const stored = await cache.get([INDEX_KEY]);
    const index = ((stored[INDEX_KEY] as string[] | undefined) ?? []).filter((u) => u !== url);
    index.push(url);
    const evicted = index.splice(0, Math.max(0, index.length - MAX_CACHED_ARTICLES));
    await cache.set({ [cacheKey(url)]: value, [INDEX_KEY]: index });
    // StorageLike has no remove(); overwrite evicted entries with an empty marker.
    await Promise.all(evicted.map((u) => cache.set({ [cacheKey(u)]: null })));
  }

  async function analyze(article: ArticleData, tabId: number | undefined): Promise<AnalyzeResponse> {
    try {
      if (tabId !== undefined) await session.set({ [articleKey(tabId)]: article });

      const settings = await getSettings();
      if (!settings.autoHighlight) return { ok: true, entries: [] };

      const signature = `${settings.level}|${settings.nativeLanguage}`;
      const hit = (await cache.get([cacheKey(article.url)]))[cacheKey(article.url)] as CachedVocab | null | undefined;
      if (hit && hit.signature === signature) return { ok: true, entries: hit.entries };

      const entries = await analyzeVocabulary(client, article, settings);
      await remember(article.url, { signature, entries });
      return { ok: true, entries };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  return {
    handle(message: AnalyzeRequest, tabId?: number): Promise<AnalyzeResponse> | undefined {
      if (message?.type === 'analyze') return analyze(message.article, tabId);
      return undefined;
    },
  };
}
