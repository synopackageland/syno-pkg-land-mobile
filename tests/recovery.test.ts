import test from 'node:test';
import assert from 'node:assert/strict';
import { EntryRecovery, contentProbe } from '../src/core/webview/recovery.ts';
import vm from 'node:vm';
test('entry stays visibly loading until content; load end alone never means ready', () => {
  const state = new EntryRecovery();
  const attempt = state.attempt;
  state.loaded();
  assert.equal(state.phase, 'loading');
  state.content(attempt, false);
  assert.equal(state.phase, 'loading');
  state.content(attempt, true);
  assert.equal(state.phase, 'ready');
});
test('retry and renderer loss start a fresh canonical attempt and ignore stale content', () => {
  const state = new EntryRecovery();
  const stale = state.attempt;
  state.failed(); assert.equal(state.phase, 'failed');
  state.restart(); assert.equal(state.phase, 'loading');
  state.content(stale, true); assert.equal(state.phase, 'loading');
  state.content(state.attempt, true); assert.equal(state.phase, 'ready');
  state.restart(); assert.equal(state.phase, 'loading');
});
test('a content signal cannot dismiss a navigation failure', () => {
  const state = new EntryRecovery(); state.failed();
  state.content(state.attempt, true);
  assert.equal(state.phase, 'failed');
});
test('blank DOM is observed without time limits; content is reported when it arrives', () => {
  const messages: unknown[] = []; let tick!: () => void; let cleared = false;
  const body = { innerText: '', querySelectorAll: () => [] };
  const context = { window: {} as Record<string, unknown>, location: { origin: 'https://nas.example.com' }, document: { body }, setInterval: (fn: () => void) => { tick = fn; return 1; }, clearInterval: () => { cleared = true; } };
  context.window.top = context.window;
  context.window.ReactNativeWebView = { postMessage: (value: string) => messages.push(JSON.parse(value)) };
  vm.runInNewContext(contentProbe('https://nas.example.com', 3), context);
  assert.equal(messages.length, 0);
  for (let i = 0; i < 100; i++) tick();
  assert.equal(cleared, false);
  body.innerText = 'App content'; tick();
  assert.deepEqual(messages, [{ internal: 'content', attempt: 3, origin: 'https://nas.example.com' }]);
  assert.equal(cleared, true);
});
test('foreign origins and subframes cannot supply content observations', () => {
  for (const subframe of [false, true]) {
    const window: Record<string, unknown> = { ReactNativeWebView: { postMessage: () => assert.fail('foreign signal') } };
    window.top = subframe ? {} : window;
    vm.runInNewContext(contentProbe('https://nas.example.com', 0), { window, location: { origin: subframe ? 'https://nas.example.com' : 'https://foreign.example.com' } });
  }
});
test('hidden visual elements do not dismiss the blank-document recovery bar', () => {
  let sent = 0;
  const element = { getBoundingClientRect: () => ({ width: 0, height: 0 }) };
  const window: Record<string, unknown> = { ReactNativeWebView: { postMessage: () => { sent++; } } };
  window.top = window;
  vm.runInNewContext(contentProbe('https://nas.example.com', 0), {
    window, location: { origin: 'https://nas.example.com' },
    document: { body: { innerText: '', querySelector: () => element, querySelectorAll: () => [element] } },
    getComputedStyle: () => ({ visibility: 'hidden', opacity: '0' }), setInterval: () => 1, clearInterval: () => {},
  });
  assert.equal(sent, 0);
});
test('content probe installed at document commit waits for RN transport before reporting visible content', () => {
  let tick!: () => void, sent = 0;
  const window: Record<string, unknown> = {}; window.top = window;
  vm.runInNewContext(contentProbe('https://nas.example.com', 4), {
    window, location: { origin: 'https://nas.example.com' },
    document: { body: { innerText: 'Already rendered', querySelectorAll: () => [] } },
    setInterval: (fn: () => void) => { tick = fn; }, clearInterval() {},
  });
  window.ReactNativeWebView = { postMessage: () => { sent++; } };
  tick(); assert.equal(sent, 1);
});
