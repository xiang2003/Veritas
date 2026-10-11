import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStt, createTts, pickVoice, type RecognitionLike } from '../src/lib/speech.ts';

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

function fakeRecognition() {
  const rec: RecognitionLike & { started: number } = {
    lang: '', interimResults: false, continuous: true, started: 0,
    start() { this.started++; }, stop() { this.onend?.(); },
    onresult: null, onerror: null, onend: null,
  };
  return rec;
}
const result = (...items: [string, boolean][]) => ({ results: items.map(([t, f]) => Object.assign([{ transcript: t }], { isFinal: f })) });

test('stt reports interim then final transcripts', () => {
  const rec = fakeRecognition();
  const seen: [string, boolean][] = [];
  createStt(() => rec).start({ onResult: (t, f) => seen.push([t, f]), onError() {}, onEnd() {} });
  assert.equal(rec.lang, 'en-US');
  assert.equal(rec.interimResults, true);
  rec.onresult!(result(['I think', false]));
  rec.onresult!(result(['I think it is bad', true]));
  assert.deepEqual(seen, [['I think', false], ['I think it is bad', true]]);
});

test('stt maps error codes to friendly messages', () => {
  const rec = fakeRecognition();
  let msg = '';
  createStt(() => rec).start({ onResult() {}, onError: (m) => (msg = m), onEnd() {} });
  rec.onerror!({ error: 'not-allowed' });
  assert.match(msg, /Microphone access was denied/);
  rec.onerror!({ error: 'weird' });
  assert.match(msg, /weird/);
});

test('stt without browser support reports an error instead of throwing', () => {
  let msg = '';
  const stt = createStt(undefined);
  stt.start({ onResult() {}, onError: (m) => (msg = m), onEnd() {} });
  assert.equal(stt.supported, false);
  assert.match(msg, /not supported/);
});
