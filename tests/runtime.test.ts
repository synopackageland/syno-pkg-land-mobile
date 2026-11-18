import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { runtimeProbe, runtimeValues } from '../src/core/discovery/runtime.ts';
test('DSM runtime overrides raw grants and continues observing late autoLaunch changes', () => {
  let granted = true, valid = true, tick!: () => void;
  const messages: { values: Record<string, boolean>; scope: string }[] = [];
  const window: Record<string, unknown> = {
    SYNO: { SDS: { Config: { FnMap: { arbitraryApp: {}, anotherApp: {} } }, StatusNotifier: { isAppHasPrivilege: () => granted }, AppUtil: { isValidApp: () => valid } } },
    ReactNativeWebView: { postMessage: (value: string) => messages.push(JSON.parse(value)) },
  };
  window.top = window;
  vm.runInNewContext(runtimeProbe('https://nas.example.com', 'session-a'), {
    window, location: { origin: 'https://nas.example.com' }, setInterval: (fn: () => void) => { tick = fn; }, clearInterval() {},
  });
  assert.deepEqual(messages[0].values, { arbitraryApp: true, anotherApp: true });
  granted = false; tick();
  assert.deepEqual(messages[1].values, { arbitraryApp: false, anotherApp: false });
  granted = true; valid = false; tick();
  assert.equal(messages.length, 2, 'unchanged decisions do not flood the bridge');
  valid = true; tick(); assert.equal(messages.length, 3);
  assert.ok(messages.every(message => message.scope === 'session-a'));
});
test('unavailable or throwing runtime leaves the raw policy available; partial methods do not invent grants', () => {
  let tick!: () => void;
  const messages: { values: Record<string, boolean> }[] = [];
  const window: Record<string, unknown> = { ReactNativeWebView: { postMessage: (value: string) => messages.push(JSON.parse(value)) } };
  window.top = window;
  vm.runInNewContext(runtimeProbe('https://nas.example.com', 'scope'), {
    window, location: { origin: 'https://nas.example.com' }, setInterval: (fn: () => void) => { tick = fn; }, clearInterval() {},
  });
  tick(); assert.equal(messages.length, 0);
  window.SYNO = { SDS: { Config: { FnMap: { unknown: {}, broken: {}, known: {} } }, StatusNotifier: { isAppHasPrivilege: (id: string) => id === 'unknown' ? undefined : true }, AppUtil: { isValidApp: (id: string) => { if (id === 'broken') throw Error(); return true; } } } };
  tick(); assert.deepEqual(messages[0].values, { known: true });
});
test('runtime observations exclude foreign origins and child frames and validate boolean maps', () => {
  for (const child of [true, false]) {
    const window: Record<string, unknown> = {};
    window.top = child ? {} : window;
    vm.runInNewContext(runtimeProbe('https://nas.example.com', 'scope'), { window, location: { origin: child ? 'https://nas.example.com' : 'https://other.example.com' } });
  }
  for (const value of [null, [], 'true', { app: 1 }, { app: 'false' }]) assert.equal(runtimeValues(value), null);
  assert.deepEqual(runtimeValues({ app: false }), { app: false });
});
