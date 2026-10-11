import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTts, pickVoice, splitIntoChunks } from '../src/lib/speech.ts';

const voice = (lang: string) => ({ lang, name: lang }) as SpeechSynthesisVoice;

test('pickVoice prefers en-US, then any English, else undefined', () => {
  assert.equal(pickVoice([voice('fr-FR'), voice('en-GB'), voice('en-US')])!.lang, 'en-US');
  assert.equal(pickVoice([voice('fr-FR'), voice('en-GB')])!.lang, 'en-GB');
  assert.equal(pickVoice([voice('fr-FR')]), undefined);
});

function fakeSynth(voices: SpeechSynthesisVoice[] = []) {
  const log: string[] = [];
  let current: SpeechSynthesisUtterance | undefined;
  return {
    log,
    finish: () => current!.onend!(new Event('end') as SpeechSynthesisEvent),
    synth: {
      getVoices: () => voices,
      cancel: () => void log.push('cancel'),
      speak: (u: SpeechSynthesisUtterance) => (log.push('speak'), (current = u), undefined),
    },
  };
}

test('speak configures utterance, cancels previous speech and resolves on end', async () => {
  const f = fakeSynth([voice('en-US')]);
  const utterance = {} as SpeechSynthesisUtterance;
  const tts = createTts({ synth: f.synth, createUtterance: (t) => Object.assign(utterance, { text: t }) });
  const done = tts.speak('hello', 0.9);
  assert.deepEqual(f.log, ['cancel', 'speak']);
  assert.equal(utterance.lang, 'en-US');
  assert.equal(utterance.rate, 0.9);
  assert.equal(utterance.voice!.lang, 'en-US');
  f.finish();
  await done;
});

test('splitIntoChunks splits sentences and breaks very long ones at commas', () => {
  assert.deepEqual(splitIntoChunks('One. Two! Three?'), ['One.', 'Two!', 'Three?']);
  const long = `${'word, '.repeat(60)}end.`;
  const chunks = splitIntoChunks(long);
  assert.ok(chunks.length > 1);
  assert.ok(chunks.every((c) => c.length <= 230));
  assert.equal(chunks.join(' ').replace(/\s+/g, ' '), long.replace(/\s+/g, ' '));
});

test('a long text is spoken chunk by chunk, and stop() halts the remaining chunks', async () => {
  const spoken: string[] = [];
  let cancels = 0;
  let pending: SpeechSynthesisUtterance | undefined;
  const tts = createTts({
    synth: { getVoices: () => [], cancel: () => void cancels++, speak: (u) => void (pending = u) },
    createUtterance: (text) => ({ text }) as SpeechSynthesisUtterance,
  });
  const done = tts.speak('First. Second. Third.');
  const next = async () => {
    spoken.push((pending as { text: string }).text);
    pending!.onend!(new Event('end') as SpeechSynthesisEvent);
    await new Promise((r) => setImmediate(r));
  };
  await next(); // First
  tts.stop();
  await next(); // Second finishes (it was already queued) ...
  await done;
  assert.deepEqual(spoken, ['First.', 'Second.']); // ... but Third. is never started
  assert.ok(cancels >= 2);
});
