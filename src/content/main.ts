import type { AnalyzeRequest, AnalyzeResponse } from '../lib/messages.ts';
import { createSettings } from '../lib/settings.ts';
import { createTts } from '../lib/speech.ts';
import { extractArticle } from './extract.ts';
import { highlightTerms } from './highlighter.ts';
import { injectStyles } from './styles.ts';
import { showToast } from './toast.ts';
import { createTooltip } from './tooltip.ts';

async function main(): Promise<void> {
  const article = extractArticle(document);
  if (!article) return;

  const { root, ...data } = article;
  const request: AnalyzeRequest = { type: 'analyze', article: data };
  const response: AnalyzeResponse = await chrome.runtime.sendMessage(request);
  if (!response.ok) return showToast(document, response.error);
  if (!response.entries.length) return;

  const { speechRate } = await createSettings(chrome.storage.local).get();
  const tts = createTts({
    synth: speechSynthesis,
    createUtterance: (text) => new SpeechSynthesisUtterance(text),
  });
  const byTerm = new Map(response.entries.map((e) => [e.term.toLowerCase(), e]));

  injectStyles(document);
  highlightTerms(root, response.entries);
  createTooltip(document, {
    lookup: (term) => byTerm.get(term),
    speak: (text) => void tts.speak(text, speechRate),
  });
}

main().catch((error) => console.error('[Veritas]', error));
