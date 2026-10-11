const ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models';

export class GeminiError extends Error {
  constructor(message, { status } = {}) {
    super(message);
    this.name = 'GeminiError';
    this.status = status;
  }
}

/** Remove ```json fences some models add even in JSON mode. */
export function parseJsonLoose(text) {
  const body = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  try {
    return JSON.parse(body);
  } catch {
    throw new GeminiError('Model returned invalid JSON');
  }
}

function extractText(data) {
  const blocked = data?.promptFeedback?.blockReason;
  if (blocked) throw new GeminiError(`Request blocked: ${blocked}`);
  const text = data?.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('');
  if (!text) throw new GeminiError('Model returned an empty response');
  return text;
}

/**
 * @param {{ fetch?: typeof fetch, getSettings: () => Promise<{apiKey: string, model: string}> }} deps
 */
export function createGeminiClient({ fetch: fetchImpl = globalThis.fetch, getSettings }) {
  /**
   * @param {{ system: string, messages: {role: 'user'|'model', text: string}[], temperature?: number }} req
   * @returns {Promise<any>} parsed JSON object
   */
  async function generateJson({ system, messages, temperature = 0.4 }) {
    const { apiKey, model } = await getSettings();
    if (!apiKey) throw new GeminiError('Gemini API key is not set. Open the extension options.');

    const response = await fetchImpl(`${ENDPOINT}/${model}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents: messages.map((m) => ({ role: m.role, parts: [{ text: m.text }] })),
        generationConfig: { responseMimeType: 'application/json', temperature },
      }),
    });

    if (!response.ok) {
      const detail = await response.json().then((j) => j?.error?.message, () => undefined);
      throw new GeminiError(detail || `Gemini request failed (${response.status})`, { status: response.status });
    }
    return parseJsonLoose(extractText(await response.json()));
  }

  return { generateJson };
}
