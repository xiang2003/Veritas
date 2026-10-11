export interface VocabEntry {
  term: string;
  lemma: string;
  pos: string;
  ipa: string;
  definition: string;
  meaning: string;
  example: string;
  usage: string;
}

/** Article text handed to the AI layers (no DOM references, safe to send across contexts). */
export interface ArticleData {
  url: string;
  title: string;
  text: string;
}
