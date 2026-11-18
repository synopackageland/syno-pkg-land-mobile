import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { initialFrameState, noticedDocument } from '../src/core/webview/frame-state.ts';

test('frame state: a launch page that finished loading before the shell noticed it counts as loaded', () => {
  // iPhone Safari: the SDK launch page loads and fires the frame's load event before the 16 ms poll sees it
  const afterLoad = { ...initialFrameState(), loaded: true, launchedAt: 100 };
  const state = noticedDocument(afterLoad, 'complete', 130, false);
  assert.equal(state.loaded, true);
  assert.equal(state.launchedAt, 130);
  assert.equal(state.ready, false);
});

test('frame state: a document still loading waits for its load event', () => {
  const state = noticedDocument({ ...initialFrameState(), loaded: true, reported: true, busy: true, ready: true, launched: 3 }, 'interactive', 50, false);
  assert.deepEqual({ ...state }, { ...initialFrameState(), launchedAt: 0 });
});

test('frame state: the warm DSM page keeps its launch time and failure bookkeeping', () => {
  const state = noticedDocument({ ...initialFrameState(), launchedAt: 7, failed: 2, placedAt: 9, launched: 2 }, 'complete', 99, true);
  assert.equal(state.launchedAt, 7); assert.equal(state.failed, 2); assert.equal(state.placedAt, 9); assert.equal(state.launched, 0); assert.equal(state.loaded, true);
});

test('frame state: the browser App view takes a new document through noticedDocument, never a blanket reset', () => {
  const source = readFileSync(new URL('../src/core/webview/ShellScreen.web.tsx', import.meta.url), 'utf8');
  assert.match(source, /noticedDocument\(state\.current, doc\.readyState/);
  assert.doesNotMatch(source, /loaded: false, reported: false/);
});

test('frame state: the browser App view hands an App the warm page could not open to a page of its own at once', () => {
  const source = readFileSync(new URL('../src/core/webview/ShellScreen.web.tsx', import.meta.url), 'utf8');
  // As the Android view does: the page's fitLaunch false fails the launched request before the host wait
  assert.match(source, /message\.internal === 'fitLaunch'\) \{ if \(message\.ok === false && live\.current\.host && s\.launched && !s\.ready\) fail\(s\.launched\); \}/);
});
