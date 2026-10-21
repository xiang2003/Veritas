import type { JsonGenerator } from './gemini.ts';

export interface TranslateOptions {
  nativeLanguage: string;
  /** Article title, given to the model as context for ambiguous words. */
  title?: string;
  /** Surrounding paragraph when translating a selection, so words get the sense used there. */
  context?: string;
}

export function buildTranslateSystemPrompt({ nativeLanguage, title, context }: TranslateOptions): string {
  if (context) {
    return `You translate text that a reader selected in an English news article${title ? ` titled ${JSON.stringify(title)}` : ''} into ${nativeLanguage}.
It appears in this passage: ${JSON.stringify(context)}
Translate ONLY the selected text, in the sense it has in that passage, faithfully and naturally. For a single word or short phrase give its meaning in ${nativeLanguage} (a few words), not a translation of the whole passage.
Respond ONLY as JSON: {"translation": string}`;
  }
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
