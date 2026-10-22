/** What a Gemini request is for; each task is routed to the model that suits it. */
export type Task = 'vocabulary' | 'tutor' | 'transcribe' | 'translate' | 'define' | 'recommend';

export const QUALITY_MODEL = 'gemini-3.8-flash';
export const LIGHT_MODEL = 'gemini-3.5-flash-lite';

/**
 * Models to try per task, in order. Free-tier quotas are per model, so splitting the work also
 * spreads the daily budget; the second model is the fallback when the first is used up or down.
 * - quality first: tasks where mistakes hurt learning (picking vocabulary, verbatim transcription,
 *   the tutor's corrections);
 * - light first: simple, frequent tasks.
 */
export const TASK_MODELS: Readonly<Record<Task, readonly string[]>> = {
  vocabulary: [QUALITY_MODEL, LIGHT_MODEL],
  tutor: [QUALITY_MODEL, LIGHT_MODEL],
  transcribe: [QUALITY_MODEL, LIGHT_MODEL],
  translate: [LIGHT_MODEL, QUALITY_MODEL],
  define: [LIGHT_MODEL, QUALITY_MODEL],
  recommend: [LIGHT_MODEL, QUALITY_MODEL],
};
