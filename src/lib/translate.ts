import type { JsonGenerator } from './gemini.ts';

export interface TranslateOptions {
  nativeLanguage: string;
  /** Article title, given to the model as context for ambiguous words. */
  title?: string;
}

export function buildTranslateSystemPrompt({ nativeLanguage, title }: TranslateOptions): string {
  return `You translate one paragraph of an English news article${title ? ` titled ${JSON.stringify(title)}` : ''} into ${nativeLanguage}.
Translate faithfully and naturally, keep names and numbers accurate, add nothing and omit nothing.
Respond ONLY as JSON: {"translation": string}`;
}

export async function translateParagraph(
  client: JsonGenerator,
  text: string,
  options: TranslateOptions,
): Promise<string> {
  const raw = (await client.generateJson({
    system: buildTranslateSystemPrompt(options),
    messages: [{ role: 'user', text }],
    temperature: 0.2,
  })) as { translation?: unknown } | null;
  const translation = typeof raw?.translation === 'string' ? raw.translation.trim() : '';
  if (!translation) throw new Error('Translation came back empty');
  return translation;
}
