import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { BridgeHost } from '../src/core/bridge/host.ts';
import { IntakeInbox } from '../src/core/intake/inbox.ts';
import { bridgeScript, eventScript } from '../src/core/bridge/injection.ts';
import { isNativeEvent, isNativeMessage, type NativeBridge, type NativeEvent } from '../src/core/bridge/contract.ts';
const origin = 'https://nas.example.com';
const description: Omit<NativeBridge, 'post'> = {
  protocol: 1, shell: { name: 'Package Land', version: '0.1.0', platform: 'android' },
  caps: { download: { base64: true, url: true, maxBase64: 52428800 }, openExternal: true, intake: true, camera: 'live' },
};
function page(url = origin, child = false) {
  const messages: unknown[] = [], events: unknown[] = [];
  const window: Record<string, unknown> = { SynoPkgTransport: { postMessage: (m: string) => messages.push(JSON.parse(m)) }, dispatchEvent: (event: unknown) => events.push(event) };
  window.top = child ? {} : window;
  const context = { window, location: { origin: url }, navigator: { userActivation: { isActive: true } }, document: { addEventListener() {} }, CustomEvent: class { type: string; detail: unknown; constructor(type: string, detail: unknown) { this.type = type; this.detail = detail; } } };
  vm.runInNewContext(bridgeScript(origin, description), context);
  return { window, context, messages, events };
}
test('injection exposes exact bridge only to the NAS main frame', () => {
  const main = page();
  const bridge = main.window.SynoPkgNative as NativeBridge;
  assert.equal(bridge.protocol, 1);
  bridge.post({ v: 1, type: 'ready', fcp: 3 });
  assert.deepEqual(main.messages, [{ message: { v: 1, type: 'ready', fcp: 3 } }]);
  assert.equal(page(origin, true).window.SynoPkgNative, undefined);
  assert.equal(page('https://other.example.com').window.SynoPkgNative, undefined);
});
test('event injection never dispatches to another origin or a child frame', () => {
  const event: NativeEvent = { v: 1, type: 'launch', link: '/add', intake: 'opaque' };
  const main = page(), foreign = page('https://other.example.com'), child = page(origin, true);
  for (const p of [main, foreign, child]) vm.runInNewContext(eventScript(origin, event), p.context);
  assert.equal(main.events.length, 1); assert.equal(foreign.events.length, 0); assert.equal(child.events.length, 0);
});
test('wire validators reject malformed and mixed download messages', () => {
  assert.equal(isNativeMessage({ v: 1, type: 'download', filename: 'a', mime: '', base64: 'YQ==' }), false);
  assert.equal(isNativeMessage({ v: 1, type: 'download', id: 'd', filename: '../a', mime: '', base64: 'YQ==' }), false);
  assert.equal(isNativeMessage({ v: 1, type: 'download', id: 'd', filename: 'a', mime: '', base64: 'YQ==', url: origin }), false);
  assert.equal(isNativeMessage({ v: 1, type: 'ready', fcp: Infinity }), false);
});
function host() {
  let now = 2000;
  const opened: string[] = [], downloaded: unknown[] = [], events: NativeEvent[] = [];
  const inbox = new IntakeInbox();
  const instance = new BridgeHost(origin, ['download', 'open-external'], inbox, {
    ready() {}, emit(event) { assert.ok(isNativeEvent(event)); events.push(event); },
    async download(message) { downloaded.push(message); }, async openExternal(url) { opened.push(url); },
  }, () => now);
  return { instance, inbox, opened, downloaded, events, tick() { now += 1001; } };
}
test('intake replies read once, resists wrong origin and handle reuse', async () => {
  const h = host(); h.inbox.put('shared_1', origin, [{ kind: 'url', url: 'magnet:?xt=example' }]);
  assert.equal(await h.instance.receive({ v: 1, type: 'intake.take', id: 'shared_1' }, 'https://other.example.com'), false);
  await h.instance.receive({ v: 1, type: 'intake.take', id: 'shared_1' }, origin);
  await h.instance.receive({ v: 1, type: 'intake.take', id: 'shared_1' }, origin);
  assert.equal(h.events[0].type === 'reply' && h.events[0].ok && h.events[0].items.length, 1);
  assert.equal(h.events[1].type === 'reply' && h.events[1].ok && h.events[1].items.length, 0);
  assert.throws(() => h.inbox.put('shared_1', origin, []));
});
test('intake rejects files with mismatched declared size', () => {
  assert.throws(() => new IntakeInbox().put('file', origin, [{ kind: 'file', filename: 'a', mime: 'text/plain', size: 4, base64: 'YQ==' }]));
});
test('URL and base64 downloads accept the contract; credentials and foreign origins fail', async () => {
  const h = host();
  for (const payload of [{ url: origin + '/file' }, { base64: 'YQ==' }]) assert.equal(await h.instance.receive({ v: 1, id: 'download', type: 'download', filename: 'a.txt', mime: 'text/plain', ...payload }, origin), true);
  for (const url of ['https://other.example.com/file', 'https://user:password@nas.example.com/file']) assert.equal(await h.instance.receive({ v: 1, id: 'download', type: 'download', filename: 'a', mime: '', url }, origin), false);
  assert.equal(h.downloaded.length, 2);
});
test('openExternal requires fresh native activation and a one-second rate limit', async () => {
  const h = host(), message = { v: 1, type: 'openExternal', url: 'https://example.org/' };
  assert.equal(await h.instance.receive(message, origin), false);
  h.instance.activate(); assert.equal(await h.instance.receive(message, origin), true);
  h.instance.activate(); assert.equal(await h.instance.receive(message, origin), false);
  h.tick(); h.instance.activate(); assert.equal(await h.instance.receive({ ...message, url: 'javascript:alert(1)' }, origin), false);
  assert.equal(await h.instance.receive(message, origin), true);
  assert.equal(h.opened.length, 2);
});
test('capability denial keeps native actions unavailable', async () => {
  let called = false;
  const h = new BridgeHost(origin, [], new IntakeInbox(), { ready() {}, emit() {}, async download() { called = true; }, async openExternal() { called = true; } });
  h.activate();
  assert.equal(await h.receive({ v: 1, type: 'openExternal', url: 'https://example.org/' }, origin), false);
  assert.equal(await h.receive({ v: 1, type: 'download', id: 'd', filename: 'a', mime: '', base64: 'YQ==' }, origin), false);
  assert.equal(called, false);
});
test('close returns to the App list only right after a tap, and only when the shell offers it', async () => {
  let closed = 0;
  const h = new BridgeHost(origin, [], new IntakeInbox(), { ready() {}, emit() {}, async download() {}, async openExternal() {}, close() { closed++; } });
  assert.equal(await h.receive({ v: 1, type: 'close' }, origin), false);
  h.activate(); assert.equal(await h.receive({ v: 1, type: 'close' }, 'https://other.example.com'), false);
  assert.equal(await h.receive({ v: 1, type: 'close', extra: 1 }, origin), false);
  assert.equal(await h.receive({ v: 1, type: 'close' }, origin), true);
  // One tap closes once
  assert.equal(await h.receive({ v: 1, type: 'close' }, origin), false);
  assert.equal(closed, 1);
  const none = new BridgeHost(origin, [], new IntakeInbox(), { ready() {}, emit() {}, async download() {}, async openExternal() {} });
  none.activate(); assert.equal(await none.receive({ v: 1, type: 'close' }, origin), false);
});
test('the bridge lists close beside caps, so older SDKs that check caps strictly still accept it', () => {
  const vmPage = (features?: string[]) => {
    const window: Record<string, unknown> = { SynoPkgTransport: { postMessage() {} } }; window.top = window;
    vm.runInNewContext(bridgeScript(origin, { ...description, ...(features ? { features } : {}) }), { window, location: { origin }, navigator: {}, document: { addEventListener() {} } });
    return window.SynoPkgNative as NativeBridge;
  };
  assert.deepEqual([...vmPage(['close']).features ?? []], ['close']);
  assert.equal(vmPage().features, undefined);
  assert.deepEqual(Object.keys(vmPage(['close']).caps).sort(), ['camera', 'download', 'intake', 'openExternal']);
});
