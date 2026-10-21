import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createActivation } from '../src/content/activation.ts';

test('starts once on the first activate message and ignores other messages', () => {
  let starts = 0;
  const a = createActivation(() => starts++);
  assert.equal(a.handle({ type: 'analyze' }), false);
  assert.equal(a.handle(null), false);
  assert.equal(a.started, false);
  assert.equal(a.handle({ type: 'activate' }), true);
  assert.equal(a.handle({ type: 'activate' }), true);
  assert.equal(starts, 1);
  assert.equal(a.started, true);
});
