import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPronouncer, playAudioUrl } from '../src/content/pronounce.ts';

function setup(found: { ipa: string; audioUrl: string } | null, audioWorks = true) {
  const log: string[] = [];
  let lookups = 0;
  const p = createPronouncer({
    lookup: async () => (lookups++, found),
    playAudio: async (url) => {
      log.push(`audio:${url}`);
      if (!audioWorks) throw new Error('blocked by CSP');
    },
    speak: async (text) => void log.push(`tts:${text}`),
  });
  return { p, log, lookups: () => lookups };
}

test('plays the human recording when there is one', async () => {
  const s = setup({ ipa: '/a/', audioUrl: 'https://x/a.mp3' });
  await s.p.pronounce('word');
  assert.deepEqual(s.log, ['audio:https://x/a.mp3']);
});

test('falls back to speech when there is no recording or the page blocks audio', async () => {
  const none = setup(null);
  await none.p.pronounce('red herring');
  assert.deepEqual(none.log, ['tts:red herring']);

  const blocked = setup({ ipa: '', audioUrl: 'https://x/a.mp3' }, false);
  await blocked.p.pronounce('batter', 'batters');
  assert.deepEqual(blocked.log, ['audio:https://x/a.mp3', 'tts:batters']);
});

test('lookups are cached per word and failures count as unknown', async () => {
  const s = setup(null);
  await s.p.find('Word');
  await s.p.find('word ');
  assert.equal(s.lookups(), 1);
  const failing = createPronouncer({
    lookup: async () => { throw new Error('offline'); },
    playAudio: async () => {},
    speak: async () => {},
  });
  assert.equal(await failing.find('x'), null);
});

test('playAudioUrl resolves on end and rejects on error', async () => {
  const fake = () => {
    const a = { play: async () => {}, onended: null as null | (() => void), onerror: null as null | (() => void) };
    return a as unknown as HTMLAudioElement;
  };
  let audio!: HTMLAudioElement;
  const done = playAudioUrl('u', (u) => (audio = fake()));
  await Promise.resolve();
  (audio.onended as () => void)();
  await done;

  const failed = playAudioUrl('u', () => ({ play: async () => { throw new Error('NotAllowedError'); } }) as unknown as HTMLAudioElement);
  await assert.rejects(failed, /NotAllowed/);
});
