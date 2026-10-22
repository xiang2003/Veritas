import { TASK_MODELS, type Task } from './models.ts';

const ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models';

export class GeminiError extends Error {
  status?: number;
  /** Another model may still work (quota used up, model unavailable, persistent overload). */
  fallback: boolean;
  /** For a used-up quota: how long until it resets. */
  retryAfterMs?: number;
  constructor(message: string, status?: number, { fallback = false, retryAfterMs }: { fallback?: boolean; retryAfterMs?: number } = {}) {
    super(message);
    this.name = 'GeminiError';
    this.status = status;
    this.fallback = fallback;
    this.retryAfterMs = retryAfterMs;
  }
}

/** Base64-encoded audio recorded from the learner. */
export interface AudioClip {
  mimeType: string;
  data: string;
}

export interface ChatMessage {
  role: 'user' | 'model';
  text: string;
  /** Sent before the text in the same turn (e.g. the learner's spoken answer). */
  audio?: AudioClip;
}

export interface JsonRequest {
  /** Decides which model handles the request (see models.ts). */
  task: Task;
  system: string;
  messages: ChatMessage[];
  temperature?: number;
}

/** The only part of the Gemini client other modules depend on – easy to fake in tests. */
export interface JsonGenerator {
  generateJson(request: JsonRequest): Promise<unknown>;
}

/** Overload and rate-limit responses that usually clear up within seconds. */
const RETRYABLE = new Set([429, 500, 502, 503, 504]);
const MAX_ATTEMPTS = 3;
const BASE_DELAY_MS = 1000;
/** Longer server-requested waits (e.g. a used-up daily quota) are reported instead of waited out. */
const MAX_AUTO_WAIT_MS = 15_000;
const MODEL_UNAVAILABLE = /not found|no longer available|not supported|is not available/i;

interface GeminiDeps {
  fetch?: typeof fetch;
  /** Injected so tests do not actually wait. */
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  getSettings: () => Promise<{ apiKey: string }>;
  /** Models per task; defaults to TASK_MODELS. */
  routes?: Readonly<Record<Task, readonly string[]>>;
}

/** Parse Google's "Please retry in 4h14m50.4s" hint from an error message. */
export function parseRetryDelayMs(message: string): number | undefined {
  const hint = /retry in ((?:[\d.]+[hms])+)/i.exec(message)?.[1];
  if (!hint) return undefined;
  const unit = { h: 3_600_000, m: 60_000, s: 1000 } as const;
  let ms = 0;
  for (const [, amount, u] of hint.matchAll(/([\d.]+)([hms])/g)) ms += Number(amount) * unit[u as 'h' | 'm' | 's'];
  return ms;
}

export function formatWait(ms: number): string {
  const minutes = Math.ceil(ms / 60_000);
  if (ms < 60_000) return `${Math.ceil(ms / 1000)} 秒`;
  return minutes < 60 ? `${minutes} 分鐘` : `${Math.floor(minutes / 60)} 小時 ${minutes % 60} 分`;
}

const quotaMessage = (models: readonly string[], waitMs: number) =>
  `免費額度已用完（${models.join('、')}），約 ${formatWait(waitMs)}後重置，請稍後再試。`;

/** Remove ```json fences some models add even in JSON mode. */
export function parseJsonLoose(text: string): unknown {
  const body = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  try {
    return JSON.parse(body);
  } catch {
    throw new GeminiError('Model returned invalid JSON');
  }
}

function extractText(data: any): string {
  const blocked = data?.promptFeedback?.blockReason;
  if (blocked) throw new GeminiError(`Request blocked: ${blocked}`);
  const parts: { text?: string }[] = data?.candidates?.[0]?.content?.parts ?? [];
  const text = parts.map((p) => p.text ?? '').join('');
  if (!text) throw new GeminiError('Model returned an empty response');
  return text;
}

function toContent(m: ChatMessage) {
  const parts: object[] = [];
  if (m.audio) parts.push({ inline_data: { mime_type: m.audio.mimeType, data: m.audio.data } });
  parts.push({ text: m.text });
  return { role: m.role, parts };
}

export function createGeminiClient({
  fetch: fetchImpl = globalThis.fetch,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  now = Date.now,
  getSettings,
  routes = TASK_MODELS,
}: GeminiDeps): JsonGenerator {
  /** Models whose quota is used up, with the time it resets – skipped until then. */
  const exhaustedUntil = new Map<string, number>();

  /** One model, with short retries for transient overload / rate limiting. */
  async function callModel(model: string, init: RequestInit): Promise<unknown> {
    for (let attempt = 1; ; attempt++) {
      const response = await fetchImpl(`${ENDPOINT}/${model}:generateContent`, init);
      if (response.ok) return parseJsonLoose(extractText(await response.json()));

      const detail = await response.json().then((j: any) => j?.error?.message as string | undefined, () => undefined);
      const requestedWait = detail ? parseRetryDelayMs(detail) : undefined;
      const wait = requestedWait ?? BASE_DELAY_MS * 2 ** (attempt - 1);
      if (RETRYABLE.has(response.status) && attempt < MAX_ATTEMPTS && wait <= MAX_AUTO_WAIT_MS) {
        await sleep(wait);
        continue;
      }
      const message = detail || `Gemini request failed (${response.status})`;
      if (response.status === 429 && requestedWait !== undefined) {
        throw new GeminiError(quotaMessage([model], requestedWait), 429, { fallback: true, retryAfterMs: requestedWait });
      }
      const unavailable = response.status === 404 || ([400, 403].includes(response.status) && MODEL_UNAVAILABLE.test(message));
      throw new GeminiError(message, response.status, { fallback: unavailable || RETRYABLE.has(response.status) });
    }
  }

  return {
    async generateJson({ task, system, messages, temperature = 0.4 }) {
      const { apiKey } = await getSettings();
      if (!apiKey) throw new GeminiError('Gemini API key is not set. Open the extension options.');

      const init: RequestInit = {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: system }] },
          contents: messages.map(toContent),
          generationConfig: { responseMimeType: 'application/json', temperature },
        }),
      };

      const models = routes[task];
      const resetIn = (model: string) => (exhaustedUntil.get(model) ?? 0) - now();
      let lastError: GeminiError | undefined;
      for (const model of models) {
        if (resetIn(model) > 0) continue;
        try {
          return await callModel(model, init);
        } catch (error) {
          if (!(error instanceof GeminiError) || !error.fallback) throw error;
          if (error.retryAfterMs !== undefined) exhaustedUntil.set(model, now() + error.retryAfterMs);
          lastError = error;
        }
      }

      // Every model failed or is known to be used up. If all are out of quota, say when the first resets.
      if (models.every((m) => resetIn(m) > 0)) {
        throw new GeminiError(quotaMessage(models, Math.min(...models.map(resetIn))), 429);
      }
      throw lastError ?? new GeminiError('No Gemini model available');
    },
  };
}
