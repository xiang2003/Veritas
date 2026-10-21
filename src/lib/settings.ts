export interface Settings {
  apiKey: string;
  model: string;
  nativeLanguage: string;
  level: string;
  /** Topics the learner likes, used to recommend articles. */
  interests: string;
  autoHighlight: boolean;
  speechRate: number;
}

export const DEFAULT_SETTINGS: Readonly<Settings> = Object.freeze({
  apiKey: '',
  model: 'gemini-3.8-flash',
  nativeLanguage: 'Traditional Chinese',
  level: 'B2',
  interests: '',
  autoHighlight: true,
  speechRate: 0.95,
});

/** The subset of chrome.storage.StorageArea we depend on. */
export interface StorageLike {
  get(keys: string[]): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
}

/** Thin wrapper over a chrome.storage-like area so callers never touch defaults. */
export function createSettings(area: StorageLike) {
  const known = Object.keys(DEFAULT_SETTINGS);
  return {
    async get(): Promise<Settings> {
      return { ...DEFAULT_SETTINGS, ...(await area.get(known)) };
    },
    async set(patch: Partial<Settings>): Promise<void> {
      const clean = Object.fromEntries(Object.entries(patch).filter(([k]) => known.includes(k)));
      await area.set(clean);
    },
  };
}
