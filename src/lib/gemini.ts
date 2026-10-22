import { TASK_MODELS, TASK_TIMEOUT_MS, type ModelChoice, type Task } from './models.ts';

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
  routes?: Readonly<Record<Task, readonly ModelChoice[]>>;
  /** Per-model time limit per task; defaults to TASK_TIMEOUT_MS. */
  timeouts?: Readonly<Record<Task, number>>;
  log?: (message: string) => void;
}

/**
 * Pick, for each choice, the first candidate ID the key can use for generateContent. Choices with
 * no usable candidate are dropped; without a model list (lookup failed) the first candidate is used.
 */
export function resolveModels(choices: readonly ModelChoice[], available: ReadonlySet<string> | undefined): string[] {
  const ids: string[] = [];
  for (const choice of choices) {
    const candidates = typeof choice === 'string' ? [choice] : choice;
    const id = available ? candidates.find((c) => available.has(c)) : candidates[0];
    if (id && !ids.includes(id)) ids.push(id);
  }
  return ids;
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
  timeouts = TASK_TIMEOUT_MS,
  log = (message) => console.info(`[Veritas] ${message}`),
}: GeminiDeps): JsonGenerator {
  /** Models whose quota is used up, with the time it resets – skipped until then. */
  const exhaustedUntil = new Map<string, number>();
  let available: Promise<Set<string> | undefined> | undefined;

  /**
   * The model IDs this key can call (ListModels; does not count against generation quotas). Only
   * needed when a route lists alternative IDs for a model. A failed lookup is retried next time.
   */
  function listModels(apiKey: string): Promise<Set<string> | undefined> {
    available ??= fetchImpl(`${ENDPOINT}?pageSize=1000`, { headers: { 'x-goog-api-key': apiKey } })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`ListModels ${r.status}`))))
      .then((body: any) => {
        const ids = (body?.models ?? [])
          .filter((m: any) => (m?.supportedGenerationMethods ?? []).includes('generateContent'))
          .map((m: any) => String(m.name).replace(/^models\//, ''));
        log(`models available: ${ids.length}`);
        return new Set<string>(ids);
      })
      .catch((error) => {
        log(`could not list models (${error instanceof Error ? error.message : String(error)}); using default IDs`);
        available = undefined;
        return undefined;
      });
    return available;
  }

  /**
   * One HTTP request with a time limit. Without it a stalled request left the UI waiting forever;
   * a timeout or network failure lets the next model take over.
   */
  async function fetchWithTimeout(model: string, init: RequestInit, timeoutMs: number) {
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), timeoutMs);
    try {
      const response = await fetchImpl(`${ENDPOINT}/${model}:generateContent`, { ...init, signal: abort.signal });
      const body: any = await response.json().catch(() => undefined);
      return { response, body };
    } catch {
      const reason = abort.signal.aborted ? `AI 回應逾時（${model}，超過 ${Math.round(timeoutMs / 1000)} 秒）` : `無法連線到 Gemini（${model}）`;
      throw new GeminiError(reason, undefined, { fallback: true });
    } finally {
      clearTimeout(timer);
    }
  }

  /** One model, with short retries for transient overload / rate limiting. */
  async function callModel(model: string, init: RequestInit, timeoutMs: number): Promise<unknown> {
    for (let attempt = 1; ; attempt++) {
      const { response, body } = await fetchWithTimeout(model, init, timeoutMs);
      if (response.ok) return parseJsonLoose(extractText(body));

      const detail = body?.error?.message as string | undefined;
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

      const choices = routes[task];
      const needsLookup = choices.some((c) => typeof c !== 'string' && c.length > 1);
      const models = resolveModels(choices, needsLookup ? await listModels(apiKey) : undefined);
      if (!models.length) throw new GeminiError(`No Gemini model available for ${task}`);
      const resetIn = (model: string) => (exhaustedUntil.get(model) ?? 0) - now();
      let lastError: GeminiError | undefined;
      for (const model of models) {
        if (resetIn(model) > 0) continue;
        const started = now();
        const seconds = () => ((now() - started) / 1000).toFixed(1);
        try {
          const result = await callModel(model, init, timeouts[task]);
          log(`${task} → ${model}: ${seconds()}s`);
          return result;
        } catch (error) {
          log(`${task} → ${model} failed after ${seconds()}s: ${error instanceof Error ? error.message : String(error)}`);
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
