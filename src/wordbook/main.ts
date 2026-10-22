import { lookupPronunciation } from '../lib/dictionary.ts';
import { createSettings } from '../lib/settings.ts';
import { createTts } from '../lib/speech.ts';
import { createWordbook, toCsv, WORDBOOK_STORAGE_KEY, type WordRecord } from '../lib/wordbook.ts';
import { createPronouncer, playAudioUrl } from '../content/pronounce.ts';
import { filterRecords, renderList, type Tab } from './view.ts';

const $ = <T extends HTMLElement>(selector: string) => document.querySelector<T>(selector)!;

const wordbook = createWordbook(chrome.storage.local);
const settings = createSettings(chrome.storage.local);
const tts = createTts({ synth: speechSynthesis, createUtterance: (t) => new SpeechSynthesisUtterance(t) });
// Extension pages may fetch the dictionary and play its audio directly (no page CSP here).
const pronouncer = createPronouncer({
  lookup: (word) => lookupPronunciation(fetch, word),
  playAudio: (url) => playAudioUrl(url),
  speak: async (text) => tts.speak(text, (await settings.get()).speechRate),
});

let records: WordRecord[] = [];
let tab: Tab = 'learning';

function render(): void {
  const learning = records.filter((r) => !r.mastered).length;
  $('#summary').textContent = `學習中 ${learning} · 已熟悉 ${records.length - learning}`;
  for (const b of document.querySelectorAll<HTMLButtonElement>('[data-tab]')) {
    b.classList.toggle('active', b.dataset.tab === tab);
  }
  const shown = filterRecords(records, { query: $<HTMLInputElement>('#search').value, tab });
  $('#list').replaceChildren(
    ...renderList(document, shown, {
      speak: (r) => void pronouncer.pronounce(r.lemma),
      setMastered: (r, mastered) => void wordbook.setMastered(r.key, mastered),
      remove: (r) => {
        if (confirm(`從生字本刪除「${r.lemma}」？`)) void wordbook.remove(r.key);
      },
    }),
  );
}

async function reload(): Promise<void> {
  records = await wordbook.list();
  render();
}

function exportCsv(): void {
  // The BOM makes Excel read the Chinese text as UTF-8.
  const blob = new Blob(['﻿' + toCsv(records)], { type: 'text/csv;charset=utf-8' });
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
$('#export').addEventListener('click', exportCsv);
chrome.storage.local.onChanged.addListener((changes) => {
  if (WORDBOOK_STORAGE_KEY in changes) void reload();
});
void reload();
