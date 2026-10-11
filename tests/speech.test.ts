import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTts, pickVoice } from '../src/lib/speech.ts';

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
