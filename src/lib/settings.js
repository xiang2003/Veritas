export const DEFAULT_SETTINGS = Object.freeze({
  apiKey: '',
  model: 'gemini-2.5-flash',
  nativeLanguage: 'Traditional Chinese',
  level: 'B2',
  autoHighlight: true,
  speechRate: 0.95,
});

/** Thin wrapper over a chrome.storage-like area so callers never touch defaults. */
export function createSettings(area) {
  return {
    async get() {
      const stored = await area.get(Object.keys(DEFAULT_SETTINGS));
      return { ...DEFAULT_SETTINGS, ...stored };
    },
    async set(patch) {
      const known = Object.keys(DEFAULT_SETTINGS);
      const clean = Object.fromEntries(Object.entries(patch).filter(([k]) => known.includes(k)));
      await area.set(clean);
    },
  };
}
