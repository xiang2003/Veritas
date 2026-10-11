const MAX_ENTRIES = 40;

export function buildVocabSystemPrompt({ level, nativeLanguage }) {
  return `You are an English vocabulary coach for a learner at CEFR level ${level}.
From the news article provided, select 15-30 words and phrases (idioms, phrasal verbs, collocations) that this learner is likely NOT to know. Skip proper nouns and very common words.
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

const text = (v) => (typeof v === 'string' ? v.trim() : '');

/**
 * Validate the model's output: drop malformed rows, terms not actually in the article,
 * and duplicates.
 */
export function normalizeEntries(raw, articleText) {
  const haystack = articleText.toLowerCase();
  const seen = new Set();
  const entries = [];
  for (const row of Array.isArray(raw?.entries) ? raw.entries : []) {
    const term = text(row?.term);
    const key = term.toLowerCase();
    if (!term || seen.has(key) || !haystack.includes(key) || !text(row.meaning)) continue;
    seen.add(key);
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

export async function analyzeVocabulary(client, article, { level, nativeLanguage }) {
  const raw = await client.generateJson({
    system: buildVocabSystemPrompt({ level, nativeLanguage }),
    messages: [{ role: 'user', text: `Title: ${article.title}\n\n${article.text}` }],
    temperature: 0.2,
  });
  return normalizeEntries(raw, article.text);
}
