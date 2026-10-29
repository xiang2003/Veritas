import { createLruCache } from './lru-cache.ts';
import type { StorageLike } from './settings.ts';

/** Conversations kept, one per article; the least recently used is dropped beyond this. */
export const MAX_CONVERSATIONS = 50;

export interface ConversationStoreLike<T> {
  load(url: string): Promise<T | null>;
  save(url: string, conversation: T): Promise<void>;
}

/** Permanent per-article conversation storage (survives browser restarts), bounded by MAX_CONVERSATIONS. */
export function createConversationStore<T>(area: StorageLike): ConversationStoreLike<T> {
  const cache = createLruCache<T>(area, { prefix: 'conv:', indexKey: 'convIndex', max: MAX_CONVERSATIONS });
  return {
    load: async (url) => (await cache.get(url)) ?? null,
    save: (url, conversation) => cache.set(url, conversation),
  };
}
