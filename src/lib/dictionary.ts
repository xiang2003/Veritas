const FREE_DICTIONARY = 'https://api.dictionaryapi.dev/api/v2/entries/en';

export interface Pronunciation {
  /** Dictionary IPA, e.g. "/ɪˈlɒkwənt/". */
  ipa: string;
  /** Recording of a human speaker, if the dictionary has one. */
  audioUrl: string;
}

/** Cambridge Dictionary page for a word or phrase (phrases use hyphens in Cambridge URLs). */
export function cambridgeUrl(lemma: string): string {
  const slug = lemma.trim().toLowerCase().replace(/\s+/g, '-');
  return `https://dictionary.cambridge.org/dictionary/english/${encodeURIComponent(slug)}`;
}

interface Phonetic {
  text?: string;
  audio?: string;
}

/** Pick the best IPA + audio from a Free Dictionary API response, preferring US recordings. */
export function parseFreeDictionary(raw: unknown): Pronunciation | null {
  const entries = Array.isArray(raw) ? raw : [];
  const phonetics: Phonetic[] = entries.flatMap((e: any) => (Array.isArray(e?.phonetics) ? e.phonetics : []));
  const withAudio = phonetics.filter((p) => typeof p.audio === 'string' && p.audio.startsWith('https://'));
  const best = withAudio.find((p) => /-us\.mp3$/.test(p.audio!)) ?? withAudio[0];
  const ipa =
    best?.text ||
    phonetics.find((p) => typeof p.text === 'string' && p.text)?.text ||
    entries.find((e: any) => typeof e?.phonetic === 'string')?.phonetic ||
    '';
  const audioUrl = best?.audio ?? '';
  return ipa || audioUrl ? { ipa: ipa.trim(), audioUrl } : null;
}

/** Look a word up in the free, keyless Free Dictionary API. Unknown words resolve to null. */
export async function lookupPronunciation(fetchImpl: typeof fetch, word: string): Promise<Pronunciation | null> {
  const response = await fetchImpl(`${FREE_DICTIONARY}/${encodeURIComponent(word.trim().toLowerCase())}`);
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`Dictionary lookup failed (${response.status})`);
  return parseFreeDictionary(await response.json());
}
