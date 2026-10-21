import type { JsonGenerator } from './gemini.ts';
import type { ArticleData, VocabEntry } from './types.ts';

const MAX_ENTRIES = 60;

export interface VocabOptions {
  level: string;
  nativeLanguage: string;
}

const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Comparison key that ignores case and typographic apostrophe/dash variants. */
export function termKey(term: string): string {
  return term.trim().toLowerCase().replace(/[‘’]/g, "'").replace(/[‐‑‒–—]/g, '-').replace(/\s+/g, ' ');
}

/**
 * Term boundaries: not inside a longer word. Hyphens (incl. the Unicode ‐ and non-breaking ‑) join
 * words, so "run" is not found in "state‑run"; en/em dashes separate words and do not block a match.
 */
export const TERM_START = "(?<![\\w'’‐‑-])";
export const TERM_END = '(?![\\w‐‑-])';

/** Regex source matching `term` with any apostrophe/dash style and any whitespace between words. */
export function termPattern(term: string): string {
  return escapeRegex(termKey(term))
    .replace(/'/g, "['‘’]")
    .replace(/-/g, '[-‐‑‒–—]')
    .replace(/ /g, '\\s+');
}

/**
 * Find how a term actually appears in the article. Single words may carry an inflection the
 * model dropped (lemma "beleaguer" → "beleaguered"). Returns the text as written, or null.
 */
export function findSurfaceForm(articleText: string, term: string): string | null {
  if (!term.trim()) return null;
  const suffix = /\s/.test(term.trim()) ? '' : '[a-z]{0,4}';
  const match = new RegExp(`${TERM_START}${termPattern(term)}${suffix}${TERM_END}`, 'i').exec(articleText);
  return match ? match[0] : null;
}

export function buildVocabSystemPrompt({ level, nativeLanguage }: VocabOptions): string {
  return `You are an English vocabulary coach for a learner at CEFR level ${level}.
From the news article provided, select EVERY word and phrase (idioms, phrasal verbs, collocations) that this learner is likely NOT to know – up to 50. Be thorough with rare, low-frequency, literary, technical and academic words: those matter most and must not be left out. Skip proper nouns and very common words.
Return JSON: {"entries":[{"term","lemma","pos","ipa","definition","meaning","example","usage"}]} where
- term: EXACT surface form as it appears in the article (same spelling, inflection), so it can be string-matched
- lemma: dictionary form
- pos: part of speech (e.g. "verb", "phrasal verb", "idiom")
- ipa: US IPA pronunciation of the term, e.g. "/ˈɛləˌkwɛnt/"
- definition: short English definition, in the sense used in the article
- meaning: that definition translated into ${nativeLanguage}
- example: one new natural example sentence (not copied from the article)
- usage: one short note in ${nativeLanguage} on usage, register or common collocations`;
}

const text = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

/**
 * Validate the model's output: drop malformed rows, terms not actually in the article,
 * and duplicates.
 */
export function normalizeEntries(raw: unknown, articleText: string): VocabEntry[] {
  const rows = (raw as { entries?: unknown } | null)?.entries;
  const seen = new Set<string>();
  const entries: VocabEntry[] = [];
  for (const row of Array.isArray(rows) ? rows : []) {
    if (!text(row?.meaning)) continue;
    // Use the form actually written in the article; fall back to the lemma if the model normalised it.
    const term = findSurfaceForm(articleText, text(row.term)) ?? findSurfaceForm(articleText, text(row.lemma));
    if (!term || seen.has(termKey(term))) continue;
    seen.add(termKey(term));
    entries.push({
      term,
      lemma: text(row.lemma) || term,
      pos: text(row.pos),
      ipa: text(row.ipa),
      definition: text(row.definition),
      meaning: text(row.meaning),
      example: text(row.example),
      usage: text(row.usage),
    });
    if (entries.length === MAX_ENTRIES) break;
  }
  return entries;
}

export async function analyzeVocabulary(
  client: JsonGenerator,
  article: ArticleData,
  options: VocabOptions,
): Promise<VocabEntry[]> {
  const raw = await client.generateJson({
    system: buildVocabSystemPrompt(options),
    messages: [{ role: 'user', text: `Title: ${article.title}\n\n${article.text}` }],
    temperature: 0.2,
  });
  return normalizeEntries(raw, article.text);
}

export interface DefineOptions extends VocabOptions {
  title?: string;
}

export function buildDefineSystemPrompt({ level, nativeLanguage, title }: DefineOptions): string {
  return `You are an English vocabulary coach for a learner at CEFR level ${level}. The learner selected a word or phrase in a news article${title ? ` titled ${JSON.stringify(title)}` : ''} and wants it explained in the sense used in the given passage.
Return JSON: {"lemma","pos","ipa","definition","meaning","example","usage"} where
- lemma: dictionary form
- pos: part of speech (e.g. "verb", "phrasal verb", "idiom")
- ipa: US IPA pronunciation of the selected text
- definition: short English definition, in the sense used in the passage
- meaning: that definition translated into ${nativeLanguage}
- example: one new natural example sentence (not copied from the passage)
- usage: one short note in ${nativeLanguage} on usage, register or common collocations`;
}

/** Explain a learner-selected term on demand (covers anything the article analysis missed). */
export async function defineTerm(
  client: JsonGenerator,
  term: string,
  context: string,
  options: DefineOptions,
): Promise<VocabEntry> {
  const raw = await client.generateJson({
    system: buildDefineSystemPrompt(options),
    messages: [{ role: 'user', text: `Selected: ${JSON.stringify(term)}\nPassage: ${JSON.stringify(context)}` }],
    temperature: 0.2,
  });
  // Re-use the article validator: the selection is by definition present in its own text.
  const [entry] = normalizeEntries({ entries: [{ ...(raw as object), term }] }, term);
  if (!entry) throw new Error('No explanation came back for this term');
  return entry;
}
