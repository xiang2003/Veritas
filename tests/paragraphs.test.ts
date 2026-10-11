import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createParagraphTools, type ParagraphToolsDeps } from '../src/content/paragraphs.ts';
import { highlightTerms } from '../src/content/highlighter.ts';

const LONG = 'This paragraph is comfortably longer than forty characters.';
const tick = () => new Promise((r) => setImmediate(r));

function setup(html: string, deps: Partial<ParagraphToolsDeps> = {}) {
  const { window } = new JSDOM(`<body><div id="r">${html}</div></body>`);
  const root = window.document.getElementById('r') as unknown as Element;
  const tools = createParagraphTools({
    translate: async () => '',
    speak: async () => {},
    stop: () => {},
    ...deps,
  });
  const click = (el: Element) =>
    el.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
  const buttons = (p = 0) => {
    const tools = root.querySelectorAll('p')[p]!.querySelector('.veritas-tools')!;
    return { speak: tools.children[0]!, translate: tools.children[1]! };
  };
  return { root, tools, click, buttons };
}

test('adds tools to long paragraphs only, and only once', () => {
  const s = setup(`<p>${LONG}</p><p>Photo: AP</p><p>${LONG}</p>`);
  assert.equal(s.tools.attach(s.root), 2);
  assert.equal(s.tools.attach(s.root), 0);
  assert.equal(s.root.querySelectorAll('.veritas-tools').length, 2);
});

test('translate: click fetches once, shows the result below the paragraph, then toggles', async () => {
  let calls = 0;
  const s = setup(`<p>${LONG}</p>`, { translate: async (t) => (calls++, `ZH:${t}`) });
  s.tools.attach(s.root);
  const { translate } = s.buttons();

  s.click(translate);
  const panel = s.root.querySelector('.veritas-tr-panel') as HTMLElement;
  assert.equal(panel.textContent, '翻譯中…');
  assert.equal(s.root.querySelector('p')!.nextElementSibling, panel);
  await tick();
  assert.equal(panel.textContent, `ZH:${LONG}`);

  s.click(translate); // hide
  assert.equal(panel.hidden, true);
  s.click(translate); // show again without another request
  assert.equal(panel.hidden, false);
  assert.equal(calls, 1);
});

test('the text sent excludes the button labels', () => {
  let sent = '';
  const s = setup(`<p>${LONG}</p>`, { translate: async (t) => ((sent = t), 'x') });
  s.tools.attach(s.root);
  s.click(s.buttons().translate);
  assert.equal(sent, LONG);
});

test('a failed translation shows the error and the next click retries', async () => {
  let fail = true;
  const s = setup(`<p>${LONG}</p>`, {
    translate: async () => {
      if (fail) throw new Error('quota');
      return 'ok';
    },
  });
  s.tools.attach(s.root);
  s.click(s.buttons().translate);
  await tick();
  assert.match(s.root.querySelector('.veritas-tr-panel')!.textContent!, /quota/);
  fail = false;
  s.click(s.buttons().translate);
  await tick();
  assert.equal(s.root.querySelector('.veritas-tr-panel')!.textContent, 'ok');
});

test('speak: click reads the paragraph, shows stop while playing, resets when finished', async () => {
  let finish!: () => void;
  const spoken: string[] = [];
  const s = setup(`<p>${LONG}</p>`, {
    speak: (t) => (spoken.push(t), new Promise<void>((r) => (finish = r))),
  });
  s.tools.attach(s.root);
  const { speak } = s.buttons();
  s.click(speak);
  assert.deepEqual(spoken, [LONG]);
  assert.equal(speak.textContent, '⏹');
  finish();
  await tick();
  assert.equal(speak.textContent, '🔊');
});

test('speak: clicking while playing stops it', () => {
  let stops = 0;
  const s = setup(`<p>${LONG}</p>`, { speak: () => new Promise(() => {}), stop: () => stops++ });
  s.tools.attach(s.root);
  const { speak } = s.buttons();
  s.click(speak);
  s.click(speak);
  assert.equal(stops, 1);
  assert.equal(speak.textContent, '🔊');
});

test('speak: starting another paragraph takes over the playing state', async () => {
  const resolvers: (() => void)[] = [];
  const s = setup(`<p>${LONG}</p><p>${LONG} Second.</p>`, {
    speak: () => new Promise<void>((r) => resolvers.push(r)),
  });
  s.tools.attach(s.root);
  const first = s.buttons(0).speak;
  const second = s.buttons(1).speak;
  s.click(first);
  s.click(second);
  assert.equal(first.textContent, '🔊');
  assert.equal(second.textContent, '⏹');
  resolvers[0]!(); // the interrupted first playback ends
  await tick();
  assert.equal(second.textContent, '⏹'); // must not reset the new owner
});

test('highlighter ignores the inserted tools and panel', async () => {
  const s = setup(`<p>${LONG}</p>`, { translate: async () => '譯文 translate' });
  s.tools.attach(s.root);
  s.click(s.buttons().translate);
  await tick();
  assert.equal(highlightTerms(s.root, [{ term: '譯' }, { term: 'translate' }]), 0);
});
