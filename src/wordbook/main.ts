import { lookupPronunciation } from '../lib/dictionary.ts';
import { createMistakebook, MISTAKES_STORAGE_KEY, type MistakeRecord } from '../lib/mistakes.ts';
import { createSettings } from '../lib/settings.ts';
import { createTts } from '../lib/speech.ts';
import { createWordbook, toCsv, WORDBOOK_STORAGE_KEY, type WordRecord } from '../lib/wordbook.ts';
import { createPronouncer, playAudioUrl } from '../content/pronounce.ts';
import { filterMistakes, renderMistakeList } from './mistakes-view.ts';
import { filterRecords, renderList, type Tab } from './view.ts';

const $ = <T extends HTMLElement>(selector: string) => document.querySelector<T>(selector)!;

const wordbook = createWordbook(chrome.storage.local);
const mistakebook = createMistakebook(chrome.storage.local);
const settings = createSettings(chrome.storage.local);
const tts = createTts({ synth: speechSynthesis, createUtterance: (t) => new SpeechSynthesisUtterance(t) });
const speak = async (text: string) => tts.speak(text, (await settings.get()).speechRate);
// Extension pages may fetch the dictionary and play its audio directly (no page CSP here).
const pronouncer = createPronouncer({
  lookup: (word) => lookupPronunciation(fetch, word),
  playAudio: (url) => playAudioUrl(url),
  speak,
});

type ViewName = 'words' | 'mistakes';

const VIEWS: Record<ViewName, { heading: string; learning: string; mastered: string; search: string; hint: string; csv: boolean }> = {
  words: {
    heading: '📒 生字本',
    learning: '學習中',
    mastered: '已熟悉',
    search: '搜尋單字或中文意思',
    hint: '依查詢次數排序：查越多次的字越前面，代表越不熟。',
    csv: true,
  },
  mistakes: {
    heading: '✏️ 錯誤本',
    learning: '練習中',
    mastered: '已記住',
    search: '搜尋錯誤或正確說法',
    hint: '依犯錯次數排序：重複犯的錯誤排最前面，最值得練習。',
    csv: false,
  },
};

let view: ViewName = location.hash === '#mistakes' ? 'mistakes' : 'words';
let words: WordRecord[] = [];
let mistakes: MistakeRecord[] = [];
let tab: Tab = 'learning';

function render(): void {
  const config = VIEWS[view];
  document.title = `Veritas ${config.heading.slice(2).trim()}`;
  $('#heading').textContent = config.heading;
  $('#hint').textContent = config.hint;
  $<HTMLInputElement>('#search').placeholder = config.search;
  $('#export').hidden = !config.csv;
  $('[data-tab="learning"]').textContent = config.learning;
  $('[data-tab="mastered"]').textContent = config.mastered;
  for (const b of document.querySelectorAll<HTMLButtonElement>('[data-view]')) b.classList.toggle('active', b.dataset.view === view);
  for (const b of document.querySelectorAll<HTMLButtonElement>('[data-tab]')) b.classList.toggle('active', b.dataset.tab === tab);

  const records: { mastered: boolean }[] = view === 'words' ? words : mistakes;
  const learning = records.filter((r) => !r.mastered).length;
  $('#summary').textContent = `${config.learning} ${learning} · ${config.mastered} ${records.length - learning}`;

  const filter = { query: $<HTMLInputElement>('#search').value, tab };
  $('#list').replaceChildren(
    ...(view === 'words'
      ? renderList(document, filterRecords(words, filter), {
          speak: (r) => void pronouncer.pronounce(r.lemma),
          setMastered: (r, mastered) => void wordbook.setMastered(r.key, mastered),
          remove: (r) => {
            if (confirm(`從生字本刪除「${r.lemma}」？`)) void wordbook.remove(r.key);
          },
        })
      : renderMistakeList(document, filterMistakes(mistakes, filter), {
          speak: (r) => void speak(r.corrected),
          setMastered: (r, mastered) => void mistakebook.setMastered(r.key, mastered),
          remove: (r) => {
            if (confirm(`從錯誤本刪除「${r.original} → ${r.corrected}」？`)) void mistakebook.remove(r.key);
          },
        })),
  );
}

async function reload(): Promise<void> {
  [words, mistakes] = await Promise.all([wordbook.list(), mistakebook.list()]);
  render();
}

function exportCsv(): void {
  // The BOM makes Excel read the Chinese text as UTF-8.
  const blob = new Blob(['﻿' + toCsv(words)], { type: 'text/csv;charset=utf-8' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = `veritas-wordbook-${new Date().toISOString().slice(0, 10)}.csv`;
  link.click();
  URL.revokeObjectURL(link.href);
}

$('#search').addEventListener('input', render);
for (const b of document.querySelectorAll<HTMLButtonElement>('[data-tab]')) {
  b.addEventListener('click', () => {
    tab = b.dataset.tab as Tab;
    render();
  });
}
for (const b of document.querySelectorAll<HTMLButtonElement>('[data-view]')) {
  b.addEventListener('click', () => {
    view = b.dataset.view as ViewName;
    history.replaceState(null, '', view === 'mistakes' ? '#mistakes' : '#');
    render();
  });
}
$('#export').addEventListener('click', exportCsv);
chrome.storage.local.onChanged.addListener((changes) => {
  if (WORDBOOK_STORAGE_KEY in changes || MISTAKES_STORAGE_KEY in changes) void reload();
});
void reload();
