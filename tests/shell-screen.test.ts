import test from 'node:test';
import assert from 'node:assert/strict';
import { component } from './component.ts';
import { EntryRecovery, contentProbe } from '../src/core/webview/recovery.ts';
import * as coverState from '../src/core/webview/cover.ts';
import { runtimeProbe, runtimeValues } from '../src/core/discovery/runtime.ts';
import { BridgeHost } from '../src/core/bridge/host.ts';
import { bridgeScript, eventScript } from '../src/core/bridge/injection.ts';
import { MAX_BASE64 } from '../src/core/bridge/contract.ts';
import { IntakeInbox } from '../src/core/intake/inbox.ts';
import { launchUrl, sameOrigin } from '../src/core/profiles/url.ts';
import { desktopPreset, mobilePreset, navigation } from '../src/core/webview/policy.ts';
import { locales } from '../src/core/i18n/strings.ts';
import { SignInSession, signInScript } from '../src/core/session/sign-in.ts';
import { storageResetScript } from '../src/core/session/storage-reset.ts';
import { fitApp, fitCallScript, fitLaunchScript, hostedApp, mobileFitOn, warmUrl } from '../src/core/webview/mobile-fit/index.ts';
const origin = 'https://nas.example.com';
const props = { config: { name: 'Shell', version: '0.1.0' }, profile: { id: 'one', name: 'NAS', origin }, target: { id: 'app', registered: true, preset: 'mobile', url: origin + '/entry', capabilities: [] } };
function fixture(extra = {}, moves: boolean[] = [], overrides: Record<string, unknown> = {}) {
  const listeners = new Map<string, (event: any) => void>(), scripts: string[] = [], fits: string[] = [], bindings: unknown[][] = [], backs: number[] = [];
  const view = { injectJavaScript: (script: string) => scripts.push(script), clearHistory() {} };
  const native = { addListener: (name: string, fn: (event: any) => void) => { listeners.set(name, fn); return { remove() {} }; }, zeroWebViewInsets: async () => 1, bindBridge: async (...args: unknown[]) => { bindings.push(args); return true; }, unbindBridge: async () => {}, sessionKey: () => 'user-a', storageReset: () => 'nonce-1', bindFit: async (_id: number, fitOrigin: string) => { fits.push(fitOrigin); return true; }, goBackIfPossible: async (id: number) => { backs.push(id); return moves.shift() ?? false; }, ...overrides };
  const page = component('src/core/webview/ShellScreen.tsx', {
    'react-native-webview': { WebView: 'WebView' }, '../../../modules/webview-cookies': { default: native },
    '../bridge/host': { BridgeHost }, '../bridge/contract': { MAX_BASE64 }, '../bridge/injection': { bridgeScript, eventScript },
    '../intake/inbox': { intakeInbox: new IntakeInbox() }, '../profiles/url': { launchUrl, sameOrigin },
    '../transfers/download': { download: async () => {} }, './recovery': { EntryRecovery, contentProbe }, './cover': coverState, './LaunchCover': { LaunchCover: 'LaunchCover' },
    './policy': { desktopPreset, mobilePreset, navigation }, '../discovery/runtime': { runtimeProbe, runtimeValues },
    '../i18n/strings': { strings: () => locales.en },
    '../session/sign-in': { SignInSession, signInScript },
    './mobile-fit': { fitApp, fitCallScript, fitLaunchScript, hostedApp, mobileFitOn, mobileFitScript: () => 'fit' },
    '../session/storage-reset': { storageResetScript },
  });
  const render = () => page.render('ShellScreen', { ...props, ...extra });
  render();
  const web = () => page.elements('WebView')[0].props;
  const ref = web().ref;
  if (typeof ref === 'function') ref(view); else ref.current = view;
  const cover = () => page.elements('LaunchCover')[0].props;
  return { page, render, web, listeners, scripts, fits, bindings, backs, cover, async bind() {
    web().onLoadEnd({ nativeEvent: { url: 'about:blank', target: 42 } });
    await new Promise(resolve => setImmediate(resolve)); render();
  } };
}
test('bridge FCP dismisses loading; subsequent SPA history starts do not restore it', async () => {
  const f = fixture(); await f.bind();
  f.listeners.get('onDocument')?.({ viewId: 42, stage: 'start' }); f.render();
  assert.equal(f.cover().phase, 'pending');
  f.listeners.get('onBridgeMessage')!({ viewId: 42, origin, userActivated: false, data: JSON.stringify({ message: { v: 1, type: 'ready', fcp: 2096 } }) });
  f.render(); assert.equal(f.cover().phase, 'hidden');
  f.web().onLoadStart({ nativeEvent: { url: origin + '/entry#/tabs' } });
  f.render(); assert.equal(f.cover().phase, 'hidden');
  f.listeners.get('onDocument')!({ viewId: 42, stage: 'start' });
  f.render(); assert.equal(f.cover().phase, 'pending');
});
test('committed documents are probed before load-end and stale or failed observations cannot dismiss recovery', async () => {
  const f = fixture(); await f.bind();
  f.listeners.get('onDocument')!({ viewId: 42, stage: 'start' });
  f.listeners.get('onDocument')!({ viewId: 42, stage: 'visible' });
  assert.ok(f.scripts.some(script => script.includes("internal:'content'")));
  const content = (attempt: number) => f.web().onMessage({ nativeEvent: { url: origin + '/entry', data: JSON.stringify({ internal: 'content', origin, attempt }) } });
  f.render(); f.page.timers(); f.render(); assert.equal(f.cover().phase, 'shown');
  content(0); f.render(); assert.equal(f.cover().phase, 'shown');
  content(1); f.render(); assert.equal(f.cover().phase, 'leaving');
  f.cover().onFaded(); f.render(); assert.equal(f.cover().phase, 'hidden');
  f.listeners.get('onDocument')!({ viewId: 42, stage: 'start' }); f.web().onError();
  content(2); f.render();
  assert.equal(f.cover().message, locales.en.connectFailed);
  assert.equal(typeof f.cover().onReopen, 'function');
});
test('the cover appears after a delay, turns slow later and reopen starts a fresh attempt', async () => {
  const f = fixture({ title: 'Reclaim', tint: '#0B8A5A' }); await f.bind();
  assert.equal(f.cover().phase, 'pending');
  f.page.timers(); f.render(); assert.equal(f.cover().phase, 'shown');
  f.page.timers(); f.render(); assert.equal(f.cover().phase, 'slow');
  assert.equal(f.cover().title, 'Reclaim'); assert.equal(f.cover().tint, '#0B8A5A');
  f.cover().onReopen(); f.render();
  assert.equal(f.cover().phase, 'pending'); assert.equal(f.web().source.uri, 'about:blank');
});
test('the launch cover and keyboard inset stay inside the shell frame', () => {
  const f = fixture(), tree = f.render();
  const frame = tree.props.children;
  const children = frame.props.children.filter(Boolean);
  assert.ok(children.findIndex((child: any) => child.type === 'LaunchCover') > children.findIndex((child: any) => child.type === 'WebView'));
  const padding = () => Object.assign({}, ...[f.render().props.children.props.style].flat()).paddingBottom;
  assert.equal(padding(), 0);
  // Without a measured frame the inset stays 0; a measured frame is lifted above the keyboard
  frame.props.ref.current = { measureInWindow: (fn: (...args: number[]) => void) => fn(0, 40, 360, 700) };
  f.listeners.get('onKeyboard')!({ top: 460 }); assert.equal(padding(), 280);
  f.listeners.get('onKeyboard')!({ top: -1 }); assert.equal(padding(), 0);
  f.listeners.get('onKeyboard')!({ top: 460 });
  assert.equal(Object.assign({}, ...[f.page.render('ShellScreen', { ...props, active: false }).props.children.props.style].flat()).paddingBottom, 0);
});
test('runtime reports must match both source origin and current session fingerprint', () => {
  const reports: unknown[] = [];
  const f = fixture({ onRuntimeVisibility: (...args: unknown[]) => reports.push(args) });
  for (const [url, scope, values] of [[origin, 'wrong', { app: false }], ['https://other.example.com', 'user-a', { app: false }], [origin, 'user-a', { app: 'false' }], [origin, 'user-a', { app: false }]]) {
    f.web().onMessage({ nativeEvent: { url, data: JSON.stringify({ internal: 'runtimeVisibility', origin, scope, values }) } });
  }
  assert.deepEqual(reports, [['user-a', { app: false }]]);
});
test('sign-in completion is bound to the current native view, origin and committed session', async () => {
  let completed = 0;
  const f = fixture({ onAuthenticated: () => completed++ }); await f.bind();
  const event = f.listeners.get('onSignIn')!;
  event({ viewId: 99, origin, scope: 'user-a' });
  event({ viewId: 42, origin: 'https://other.example.com', scope: 'user-a' });
  event({ viewId: 42, origin, scope: 'old-session' });
  assert.equal(completed, 0);
  event({ viewId: 42, origin, scope: 'user-a' });
  event({ viewId: 42, origin, scope: 'user-a' });
  assert.equal(completed, 1);
});
test('desktop Apps get the mobile fit on a phone unless the NAS turned it off; mobile Apps never do', async () => {
  const desktop = { ...props.target, registered: false, preset: 'desktop' };
  const on = fixture({ target: desktop }); await on.bind();
  assert.deepEqual(on.fits, [origin]);
  const off = fixture({ target: desktop, profile: { ...props.profile, mobileFit: false } }); await off.bind();
  assert.deepEqual(off.fits, []);
  const mobile = fixture({ profile: { ...props.profile, mobileFit: true } }); await mobile.bind();
  assert.deepEqual(mobile.fits, []);
});
test('every WebView binds the one-shot storage reset for its origin, bridge or not', async () => {
  const f = fixture(); await f.bind();
  assert.equal(f.bindings[0][5], storageResetScript(origin, 'nonce-1'));
});
test('single-App mode: the page reports the App on screen or closes it, only from the bound origin of the active screen', async () => {
  const apps: unknown[] = []; let exits = 0;
  const extra = { target: { ...props.target, registered: false, preset: 'desktop' }, onFitApp: (app: unknown) => apps.push(app), onExit: () => exits++ };
  const f = fixture(extra);
  const send = (data: unknown) => f.web().onMessage({ nativeEvent: { url: origin + '/', data: JSON.stringify(data) } });
  const app = { id: 'SYNO.SDS.App.FileStation3.Instance', title: 'File Station', page: '', menu: false, back: 0 };
  send({ internal: 'fitApp', origin, app }); assert.deepEqual(apps, []); // before the fit is bound
  await f.bind();
  send({ internal: 'fitApp', origin: 'https://other.example.com', app });
  // A report naming nothing, not even its back steps, is dropped
  send({ internal: 'fitApp', origin, app: { title: '', id: '', page: '', menu: false } });
  assert.deepEqual(apps, []);
  // An icon that is not an image data URL is dropped; the App still shows
  send({ internal: 'fitApp', origin, app: { ...app, icon: 'https://nas.example.com/icon.png' } });
  const icon = 'data:image/png;base64,iVBORw0KGgo=';
  send({ internal: 'fitApp', origin, app: { ...app, icon } });
  assert.deepEqual(apps, [app, { ...app, icon }]);
  // An App's own page names no title: the bar keeps the launched App's name
  send({ internal: 'fitApp', origin, app: { ...app, title: '', menu: true } });
  assert.deepEqual(apps.at(-1), { ...app, title: '', menu: true });
  // A package page's list of its Apps names no App, only its back steps
  send({ internal: 'fitApp', origin, app: { ...app, id: '', title: '' } });
  assert.deepEqual(apps.at(-1), { ...app, id: '', title: '' });
  f.page.render('ShellScreen', { ...props, ...extra, active: false });
  send({ internal: 'fitClosed', origin }); assert.equal(exits, 0);
  f.render(); send({ internal: 'fitClosed', origin }); assert.equal(exits, 1);
});
test('the shell top bar goes back and opens the App menu only for presses after the screen became active', async () => {
  const extra = { target: { ...props.target, registered: false, preset: 'desktop' }, onExit: () => {} };
  const f = fixture({ ...extra, backRequest: 1, menuRequest: 1 }); await f.bind();
  assert.deepEqual(f.backs, []); assert.ok(!f.scripts.some(script => script.includes('__splFitMenu')));
  // A warm screen shown again asks the page to report the App on screen again
  f.page.render('ShellScreen', { ...props, ...extra, active: false });
  const syncs = () => f.scripts.filter(script => script.includes('__splFitSync')).length, before = syncs();
  f.render(); assert.equal(syncs(), before + 1);
  const now = Date.now() + 1000;
  f.page.render('ShellScreen', { ...props, ...extra, backRequest: now, menuRequest: now });
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(f.backs, [42]);
  assert.equal(f.scripts.filter(script => script.includes('__splFitMenu')).length, 1);
  assert.equal(fitCallScript(origin + '/x', 'menu'), "if (location.origin === \"https://nas.example.com\" && typeof window.__splFitMenu === 'function') window.__splFitMenu();true;");
});
test('single-App back closes the steps the page reports before WebView history, which skips script-made entries', async () => {
  let exits = 0;
  const extra = { target: { ...props.target, registered: false, preset: 'desktop' }, onExit: () => exits++, onFitApp: () => {} };
  const f = fixture(extra); await f.bind();
  const send = (back: unknown) => f.web().onMessage({ nativeEvent: { url: origin + '/', data: JSON.stringify({ internal: 'fitApp', origin, app: { id: 'a', title: 'DNS Server', page: '', menu: true, back } }) } });
  const backs = () => f.scripts.filter(script => script.includes('__splFitBack')).length;
  let at = Date.now() + 1000;
  const press = async () => { f.page.render('ShellScreen', { ...props, ...extra, backRequest: at++ }); await new Promise(resolve => setImmediate(resolve)); };
  send(2);
  await press(); await press();
  assert.equal(backs(), 2); assert.deepEqual(f.backs, [], 'WebView history untouched while the page has steps');
  // Out of steps (the page has not reported yet): the shell's own path
  await press();
  assert.equal(backs(), 2); assert.deepEqual(f.backs, [42]); assert.equal(exits, 1);
  // A page report wins over the local count; nonsense counts are none
  send(1); await press(); assert.equal(backs(), 3);
  send('9'); await press(); assert.equal(backs(), 3);
});
test('the warm DSM page opens the App asked for once the fit can host it, and hands it on when it cannot', async () => {
  const failed: number[] = [], apps: unknown[] = [];
  const warm = { ...props.target, id: 'dsm-warm', registered: false, preset: 'desktop', url: origin + '/?launchApp=SYNO.SDS.App.PersonalSettings.Instance' };
  const base = { target: warm, preload: true, onHostFailed: (request: number) => failed.push(request), onFitApp: (app: unknown) => apps.push(app), onExit: () => {} };
  const f = fixture({ ...base, active: false }); await f.bind();
  const send = (data: object) => f.web().onMessage({ nativeEvent: { url: origin + '/', data: JSON.stringify({ origin, ...data }) } });
  const launches = () => f.scripts.filter(script => script.includes('__splFitLaunch'));
  const app = { id: 'SYNO.SDS.StorageManager.Instance', title: 'Storage Manager', page: '', menu: false, back: 0 };
  // Preloaded and hidden: the page's own App is never reported
  send({ internal: 'fitReady' });
  send({ internal: 'fitApp', app: { ...app, id: 'SYNO.SDS.App.PersonalSettings.Instance' } });
  assert.deepEqual(apps, []); assert.equal(launches().length, 0);
  // Asked for an App: launched once inside the page; the cover stays until its window is reported
  f.page.render('ShellScreen', { ...props, ...base, active: true, host: { app: app.id, request: 3 } }); await new Promise(resolve => setImmediate(resolve));
  f.page.render('ShellScreen', { ...props, ...base, active: true, host: { app: app.id, request: 3 } });
  assert.equal(launches().length, 1);
  assert.ok(launches()[0].includes(JSON.stringify(app.id)));
  assert.notEqual(f.cover().phase, 'hidden');
  // The window is up but DSM still shows its loading mask: the cover stays over it
  const again = () => f.page.render('ShellScreen', { ...props, ...base, active: true, host: { app: app.id, request: 3 } });
  send({ internal: 'fitApp', app: { ...app, busy: true } }); again();
  assert.ok(!['leaving', 'hidden'].includes(f.cover().phase), 'still covered');
  send({ internal: 'fitApp', app }); again();
  assert.ok(['leaving', 'hidden'].includes(f.cover().phase), 'the mask is gone: the cover goes');
  assert.deepEqual(apps, [{ ...app, busy: true }, app]);
  // This DSM has no such App: the shell opens it on a page of its own
  f.page.render('ShellScreen', { ...props, ...base, active: true, host: { app: 'SYNO.SDS.Missing', request: 4 } }); await new Promise(resolve => setImmediate(resolve));
  f.page.render('ShellScreen', { ...props, ...base, active: true, host: { app: 'SYNO.SDS.Missing', request: 4 } });
  send({ internal: 'fitLaunch', ok: false });
  send({ internal: 'fitLaunch', ok: false });
  assert.deepEqual(failed, [4], 'once per request');
});
test('only a plain single-App DSM address on the NAS origin can open in the warm page', () => {
  assert.equal(warmUrl(origin + '/x?y'), origin + '/?launchApp=SYNO.SDS.App.PersonalSettings.Instance');
  assert.equal(hostedApp(origin + '/?launchApp=SYNO.SDS.StorageManager.Instance', origin), 'SYNO.SDS.StorageManager.Instance');
  for (const url of [
    'https://other.example.com/?launchApp=SYNO.SDS.StorageManager.Instance', origin + '/webman/?launchApp=SYNO.SDS.X',
    origin + '/?launchApp=SYNO.SDS.X&launchParam=a', origin + '/?launchApp=SYNO.SDS.X#y', origin + '/?launchApp=a%22b', origin + '/', 'not a url',
  ]) assert.equal(hostedApp(url, origin), undefined, url);
  const script = fitLaunchScript(origin, 'SYNO.SDS.X');
  assert.ok(script.startsWith(`if (location.origin === ${JSON.stringify(origin)}`));
  assert.ok(script.includes('__splFitLaunch("SYNO.SDS.X")'));
});
test('an SDK App\'s back goes through the WebView\'s history (its sub-pages) before leaving the App', async () => {
  let exits = 0;
  // Two sub-pages the App pushed, then nothing left: the third back leaves
  const f = fixture({ onExit: () => exits++ }, [true, true, false]); await f.bind();
  let at = Date.now() + 1000;
  const press = async () => { f.page.render('ShellScreen', { ...props, onExit: () => exits++, backRequest: at++ }); await new Promise(resolve => setImmediate(resolve)); };
  await press(); assert.equal(exits, 0);
  await press(); assert.equal(exits, 0);
  await press(); assert.equal(exits, 1);
  assert.deepEqual(f.backs, [42, 42, 42]);
});
test('a new App view sets up its insets, bridge and fit in one round trip before its entry starts', async () => {
  const calls: string[] = [];
  let insetsDone!: () => void;
  const desktop = { ...props.target, registered: false, preset: 'desktop', url: origin + '/?launchApp=SYNO.SDS.X' };
  const f = fixture({ target: desktop, profile: { ...props.profile, mobileFit: true } }, [], {
    zeroWebViewInsets: () => { calls.push('insets'); return new Promise<void>(resolve => { insetsDone = resolve; }); },
    bindBridge: async () => { calls.push('bridge'); return true; },
    bindFit: async () => { calls.push('fit'); return true; },
  });
  f.web().onLoadEnd({ nativeEvent: { url: 'about:blank', target: 42 } });
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(calls, ['insets', 'bridge', 'fit'], 'all three asked at once, none waits for another');
  f.render(); assert.equal(f.web().source.uri, 'about:blank', 'the entry waits for all three');
  insetsDone(); await new Promise(resolve => setImmediate(resolve)); f.render();
  assert.equal(f.web().source.uri, desktop.url);
});
test('the warm page keeps a slow App it has started under the cover, which turns slow and offers back (hostWait decides the rest)', async () => {
  const failed: number[] = [];
  const warm = { ...props.target, id: 'dsm-warm', registered: false, preset: 'desktop', url: origin + '/?launchApp=SYNO.SDS.App.PersonalSettings.Instance' };
  const base = { target: warm, preload: true, onHostFailed: (request: number) => failed.push(request), onExit: () => {} };
  const f = fixture({ ...base, active: false }); await f.bind();
  const send = (data: object) => f.web().onMessage({ nativeEvent: { url: origin + '/', data: JSON.stringify({ origin, ...data }) } });
  send({ internal: 'fitReady' });
  const show = () => f.page.render('ShellScreen', { ...props, ...base, active: true, host: { app: 'SYNO.SS.Slow', request: 7 } });
  show(); await new Promise(resolve => setImmediate(resolve)); show();
  assert.ok(f.scripts.some(script => script.includes('__splFitLaunch')));
  for (let i = 0; i < 4; i++) { f.page.timers(); show(); }
  assert.deepEqual(failed, []);
  assert.equal(f.cover().phase, 'slow');
  assert.ok(f.cover().onBack, 'back is offered while it waits');
});
