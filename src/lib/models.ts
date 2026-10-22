/** What a Gemini request is for; each task is routed to the model that suits it. */
export type Task = 'vocabulary' | 'tutor' | 'transcribe' | 'translate' | 'define' | 'recommend' | 'summarize';

export const QUALITY_MODEL = 'gemini-3.8-flash';
export const BALANCED_MODEL = 'gemini-3.5-flash';
export const LIGHT_MODEL = 'gemini-3.5-flash-lite';

/**
 * Models to try per task, in order. Free-tier quotas are per model, so splitting the work spreads
 * the daily budget; later models are fallbacks when earlier ones are used up or down.
 * - quality first: tasks where mistakes hurt learning (picking vocabulary, the tutor's corrections);
 * - transcription leads with the balanced model so a spoken turn (transcription + tutor) draws on
 *   two different quotas instead of spending the quality model twice;
 * - light first: simple, frequent tasks.
 * Fallbacks step down (or up) one tier at a time so quality changes gradually.
 */
/**
 * How long one model may take before the request moves on to the next model. Vocabulary analysis
 * writes a long answer for a whole article, so it gets the most time.
 */
export const TASK_TIMEOUT_MS: Readonly<Record<Task, number>> = {
  vocabulary: 90_000, // x3 models stays within the ~5 min a service worker may spend on one message
  tutor: 60_000,
  transcribe: 60_000,
  summarize: 60_000,
  translate: 45_000,
  define: 45_000,
  recommend: 45_000,
};

export const TASK_MODELS: Readonly<Record<Task, readonly string[]>> = {
  vocabulary: [QUALITY_MODEL, BALANCED_MODEL, LIGHT_MODEL],
  tutor: [QUALITY_MODEL, BALANCED_MODEL, LIGHT_MODEL],
  transcribe: [BALANCED_MODEL, QUALITY_MODEL, LIGHT_MODEL],
  translate: [LIGHT_MODEL, BALANCED_MODEL, QUALITY_MODEL],
  define: [LIGHT_MODEL, BALANCED_MODEL, QUALITY_MODEL],
  recommend: [LIGHT_MODEL, BALANCED_MODEL, QUALITY_MODEL],
  summarize: [LIGHT_MODEL, BALANCED_MODEL, QUALITY_MODEL],
};
