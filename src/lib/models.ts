/** What a Gemini request is for; each task is routed to the model that suits it. */
export type Task = 'vocabulary' | 'tutor' | 'transcribe' | 'translate' | 'define' | 'recommend' | 'summarize';

// Strongest first.
export const FLASH_3_8 = 'gemini-3.8-flash';
export const FLASH_3_6 = 'gemini-3.6-flash';
export const FLASH_3_5 = 'gemini-3.5-flash';
export const FLASH_LITE_3_5 = 'gemini-3.5-flash-lite';

/**
 * Models to try per task, in order. Free-tier quotas are per model, so each main task leads with its
 * own model to spread the daily budget; the others are fallbacks when it is used up, slow or down,
 * nearest in quality first so answers degrade gradually.
 * - tutor → 3.8: its corrections and better answers matter most;
 * - vocabulary → 3.6: one long answer per article, kept off the tutor's quota;
 * - transcription → 3.5: a spoken turn (transcription + tutor) uses two different quotas;
 * - simple, frequent tasks → lite.
 */
export const TASK_MODELS: Readonly<Record<Task, readonly string[]>> = {
  tutor: [FLASH_3_8, FLASH_3_6, FLASH_3_5, FLASH_LITE_3_5],
  vocabulary: [FLASH_3_6, FLASH_3_8, FLASH_3_5, FLASH_LITE_3_5],
  transcribe: [FLASH_3_5, FLASH_3_6, FLASH_3_8, FLASH_LITE_3_5],
  translate: [FLASH_LITE_3_5, FLASH_3_5, FLASH_3_6, FLASH_3_8],
  define: [FLASH_LITE_3_5, FLASH_3_5, FLASH_3_6, FLASH_3_8],
  recommend: [FLASH_LITE_3_5, FLASH_3_5, FLASH_3_6, FLASH_3_8],
  summarize: [FLASH_LITE_3_5, FLASH_3_5, FLASH_3_6, FLASH_3_8],
};

/**
 * How long one model may take before the request moves on to the next model. Vocabulary analysis
 * writes a long answer for a whole article, so it gets the most time.
 */
export const TASK_TIMEOUT_MS: Readonly<Record<Task, number>> = {
  vocabulary: 75_000, // x4 models stays within the ~5 min a service worker may spend on one message
  tutor: 60_000,
  transcribe: 60_000,
  summarize: 60_000,
  translate: 45_000,
  define: 45_000,
  recommend: 45_000,
};
