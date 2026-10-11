import { test } from 'node:test';
import assert from 'node:assert/strict';
import { blobToClip, createSilenceDetector, rmsLevel } from '../src/lib/recorder.ts';

const opts = { threshold: 0.05, silenceMs: 1000, noSpeechMs: 3000 };

test('rmsLevel of silence is 0 and of a loud signal is high', () => {
  assert.equal(rmsLevel([]), 0);
  assert.equal(rmsLevel([0, 0, 0]), 0);
  assert.ok(rmsLevel([0.5, -0.5, 0.5, -0.5]) > 0.4);
});

test('keeps going while the learner pauses briefly, ends after sustained silence', () => {
  const d = createSilenceDetector(opts, 0);
  assert.equal(d.push(0.2, 100), 'continue'); // speaking
  assert.equal(d.push(0.0, 600), 'continue'); // short pause
  assert.equal(d.push(0.2, 900), 'continue'); // speaking again resets the clock
  assert.equal(d.push(0.0, 1800), 'continue');
  assert.equal(d.push(0.0, 1900), 'end-of-speech');
});

test('gives up when nothing is said', () => {
  const d = createSilenceDetector(opts, 0);
  assert.equal(d.push(0.01, 2900), 'continue');
  assert.equal(d.push(0.01, 3000), 'no-speech');
});

test('blobToClip base64-encodes and strips codec parameters from the mime type', async () => {
  const clip = await blobToClip(new Blob([new Uint8Array([1, 2, 3])], { type: 'audio/webm;codecs=opus' }));
  assert.deepEqual(clip, { mimeType: 'audio/webm', data: 'AQID' });
});
