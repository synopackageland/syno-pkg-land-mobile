import test from 'node:test';
import assert from 'node:assert/strict';
import { cover, keyboardOverlap, type CoverEvent, type CoverPhase } from '../src/core/webview/cover.ts';
const run = (events: CoverEvent[], from: CoverPhase = 'pending') => events.reduce(cover, from);
test('fast loads never show the cover', () => {
  assert.equal(run(['ready']), 'hidden');
  assert.equal(run(['ready', 'delay', 'slow']), 'hidden');
});
test('slow loads show after the delay, turn slow, then fade out', () => {
  assert.equal(run(['delay']), 'shown');
  assert.equal(run(['delay', 'slow']), 'slow');
  assert.equal(run(['delay', 'ready']), 'leaving');
  assert.equal(run(['delay', 'slow', 'ready', 'faded']), 'hidden');
  assert.equal(run(['slow']), 'pending');
});
test('a new document restarts the cover from any phase, and stale timers do nothing', () => {
  for (const phase of ['shown', 'slow', 'leaving', 'hidden'] as CoverPhase[]) assert.equal(cover(phase, 'start'), 'pending');
  assert.equal(run(['delay', 'ready', 'start', 'faded']), 'pending');
  assert.equal(cover('hidden', 'delay'), 'hidden');
  assert.equal(cover('leaving', 'slow'), 'leaving');
  assert.equal(cover('hidden', 'ready'), 'hidden');
});
test('keyboard overlap is the frame part below the keyboard top', () => {
  assert.equal(keyboardOverlap(740, null), 0);
  assert.equal(keyboardOverlap(740, 460), 280);
  assert.equal(keyboardOverlap(400, 460), 0);
  assert.equal(keyboardOverlap(740.4, 460.1), 280);
  assert.equal(keyboardOverlap(Number.NaN, 460), 0);
});
