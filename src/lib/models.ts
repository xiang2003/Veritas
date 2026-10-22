/** What a Gemini request is for; each task is routed to the model that suits it. */
export type Task = 'vocabulary' | 'tutor' | 'transcribe' | 'translate' | 'define' | 'recommend' | 'summarize';

/**
 * A model, as one ID or as candidate IDs for the same model (e.g. stable and preview names). The
 * client picks the first candidate the API key can actually use (see ListModels in gemini.ts).
 */
export type ModelChoice = string | readonly string[];

// Free-tier daily limits as shown in Google AI Studio (Oct 2026), strongest first.
export const FLASH_3_8: ModelChoice = ['gemini-3.8-flash']; // 20/day
export const FLASH_3_6: ModelChoice = ['gemini-3.6-flash']; // 20/day
export const FLASH_3: ModelChoice = ['gemini-3-flash', 'gemini-3-flash-preview']; // 20/day
export const FLASH_2_5: ModelChoice = ['gemini-2.5-flash']; // 20/day
export const LITE_3_5: ModelChoice = ['gemini-3.5-flash-lite']; // 500/day
export const LITE_3_1: ModelChoice = ['gemini-3.1-flash-lite', 'gemini-3.1-flash-lite-preview']; // 500/day

/**
 * Models to try per task, in order. Free-tier quotas are per model and the Flash models only allow
 * 20 requests a day, so each main task leads with a different one; the rest are fallbacks when it is
 * used up, slow or unavailable.
 * - tutor → 3.8: its corrections and better answers matter most;
 * - vocabulary → 3.6: one long answer per article, kept off the tutor's quota;
 * - transcription → 3 Flash: a spoken turn (transcription + tutor) uses two different quotas;
 * - simple, frequent tasks → the two 500/day Lite models.
 */
export const TASK_MODELS: Readonly<Record<Task, readonly ModelChoice[]>> = {
  tutor: [FLASH_3_8, FLASH_3_6, FLASH_3, FLASH_2_5],
  vocabulary: [FLASH_3_6, FLASH_3, FLASH_2_5, FLASH_3_8],
  transcribe: [FLASH_3, FLASH_3_6, FLASH_2_5, FLASH_3_8],
  translate: [LITE_3_5, LITE_3_1, FLASH_2_5],
  define: [LITE_3_5, LITE_3_1, FLASH_2_5],
  recommend: [LITE_3_5, LITE_3_1, FLASH_2_5],
  summarize: [LITE_3_5, LITE_3_1, FLASH_2_5],
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
