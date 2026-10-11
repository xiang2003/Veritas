const ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models';

export class GeminiError extends Error {
  status?: number;
  constructor(message: string, status?: number) {
    super(message);
    this.name = 'GeminiError';
    this.status = status;
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

interface GeminiDeps {
  fetch?: typeof fetch;
  /** Injected so tests do not actually wait. */
  sleep?: (ms: number) => Promise<void>;
  getSettings: () => Promise<{ apiKey: string; model: string }>;
}

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
  getSettings,
}: GeminiDeps): JsonGenerator {
  return {
    async generateJson({ system, messages, temperature = 0.4 }) {
      const { apiKey, model } = await getSettings();
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

      let response!: Response;
      for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
        response = await fetchImpl(`${ENDPOINT}/${model}:generateContent`, init);
        if (response.ok || !RETRYABLE.has(response.status) || attempt === MAX_ATTEMPTS) break;
        await sleep(BASE_DELAY_MS * 2 ** (attempt - 1));
      }

      if (!response.ok) {
        const detail = await response.json().then((j: any) => j?.error?.message as string | undefined, () => undefined);
        throw new GeminiError(detail || `Gemini request failed (${response.status})`, response.status);
      }
      return parseJsonLoose(extractText(await response.json()));
    },
  };
}
