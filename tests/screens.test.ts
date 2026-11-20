import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { component } from './component.ts';
import { NasProber, certState, formatFingerprint, needsTrust, hostName, mainCause, type ProbeResponse } from '../src/core/profiles/probe.ts';
import { parseNasQr, qrGroup, NasQrError } from '../src/core/profiles/qr.ts';
import { normalizeServer } from '../src/core/profiles/url.ts';
import { causeText, fill, locales } from '../src/core/i18n/strings.ts';
import { LauncherModel, intakeChoice } from '../src/core/launcher/model.ts';
import { IntakeInbox } from '../src/core/intake/inbox.ts';
import { moveApp, orderApps } from '../src/core/launcher/order.ts';
import type { DiscoveredApp } from '../src/core/discovery/schema.ts';
import type { NasProfile } from '../src/core/config.ts';
import { hostedApp, mobileFitOn, warmUrl } from '../src/core/webview/mobile-fit/index.ts';
import * as upgradeModule from '../src/core/status/modules/upgrade.ts';
import type { Discovery } from '../src/core/discovery/client.ts';

const t = locales.en;
const qrFixture = JSON.parse(readFileSync('tests/qr-v1-fixture.json', 'utf8'));
const dsm = JSON.stringify({ success: true, data: { 'SYNO.API.Auth': { path: 'entry.cgi', minVersion: 1, maxVersion: 7 } } });
const selfSigned = { sha256: 'b'.repeat(64), trusted: false, chainTrusted: false, hostnameMatch: false, expired: false };
const flush = async () => { for (let i = 0; i < 5; i++) await new Promise(done => setImmediate(done)); };
// Values built inside the component sandbox come from another realm
const plain = (value: unknown) => JSON.parse(JSON.stringify(value));
// UI primitives are rendered as named elements so tests read their props directly
const ui = Object.fromEntries(['Banner', 'Icon', 'IconButton', 'PrimaryButton', 'Row', 'Separator', 'TextButton', 'TopBar', 'Chevron', 'ConfirmSheet', 'Section', 'Sheet', 'EmptyState', 'Skeleton', 'TabBar', 'BarContent', 'TextField'].map(name => [name, name]));
const uiStub = { ...ui, useBlurTarget: () => ({ current: null }), useBarInsets: () => ({ top: 44, bottom: 52, rawBottom: 0 }), useCollapsingBar: () => ({ hidden: false, onScroll() {} }) };
const certStub = { CertBadge: 'CertBadge', TrustSheet: 'TrustSheet', certIcon: () => 'lock', certColor: () => '#000', savedCert: (origin: string, sha256?: string) => origin.startsWith('http:') ? 'http' : sha256 ? 'pinned' : 'trusted' };
const i18n = { strings: () => t, fill, causeText };

function prober(answers: Record<string, ProbeResponse | Promise<ProbeResponse>>) {
  const cancelled: string[] = [];
  let id = 0;
  const instance = new NasProber(async url => answers[url] ?? { error: 'refused' }, probeId => cancelled.push(probeId), () => `probe-${++id}`);
  return { instance, cancelled };
}
function addScreen(answers: Record<string, ProbeResponse | Promise<ProbeResponse>>, props: Record<string, unknown> = {}, camera = { granted: false, request: false }) {
  const p = prober(answers);
  let requests = 0;
  const saved: unknown[] = [], qrs: unknown[] = [];
  const page = component('variants/land/AddDevice.tsx', {
    'expo-camera': { CameraView: 'CameraView', useCameraPermissions: () => [{ granted: camera.granted }, async () => { requests++; return { granted: camera.request }; }] },
    'react-native': { ...Object.fromEntries(['View', 'Text', 'Pressable', 'ScrollView', 'TextInput', 'ActivityIndicator', 'KeyboardAvoidingView'].map(n => [n, n])), Linking: { openSettings: async () => {} } },
    '../../src/core/profiles/url': { normalizeServer }, '../../src/core/profiles/qr': { parseNasQr, qrGroup, NasQrError },
    '../../src/core/profiles/probe': { certState, hostName, mainCause, needsTrust, formatFingerprint }, '../../src/core/i18n/strings': i18n,
    './ui': uiStub, './cert': certStub, './theme': themeStub,
  });
  const render = () => page.render('AddDevice', { prober: p.instance, profiles: [], onSave: (value: unknown) => { saved.push(value); }, onQr: async (value: unknown) => { qrs.push(value); }, onShowExisting() {}, onClose() {}, ...props });
  const primary = () => page.elements('PrimaryButton')[0]?.props;
  const text = () => page.elements('Text').map(e => e.props.children).flat(3).filter(v => typeof v === 'string').join(' | ');
  const submit = async (value: string) => {
    page.elements('TextField')[0].props.onChangeText(value); render();
    page.elements('TextField')[0].props.onSubmitEditing(); await flush(); render(); render();
  };
  return { page, render, primary, text, submit, saved, qrs, cancelled: p.cancelled, prober: p.instance, requests: () => requests };
}
const themeStub = { tiles: [{ bg: '#fff', fg: '#000' }], colors: new Proxy({}, { get: () => '#000' }), layout: { topBar: 44, tabBar: 52, hit: 44, gutter: 16, appIcon: 44, appColumn: 76, row: 48, block: 8 }, radius: new Proxy({}, { get: () => 8 }), spacing: new Proxy({}, { get: () => 8 }), type: new Proxy({}, { get: () => ({}) }) };

test('typing never probes; Test connection starts a cancellable probe that ignores late answers', async () => {
  let answer!: (value: ProbeResponse) => void;
  const s = addScreen({ 'https://nas.example.com:5001/webapi/query.cgi?api=SYNO.API.Info&version=1&method=query&query=SYNO.API.Auth': new Promise(done => { answer = done; }) });
  s.render();
  s.page.elements('TextField')[0].props.onChangeText('nas.example.com'); s.render();
  s.page.timers(); s.render();
  assert.equal(s.prober.state.phase, 'idle');
  assert.equal(s.primary().title, t.testConnection);
  s.primary().onPress(); s.render();
  assert.equal(s.prober.state.phase, 'probing');
  assert.equal(s.primary(), undefined);
  assert.ok(s.text().includes(fill(t.probing, { host: 'nas.example.com' })));
  const cancel = s.page.elements('TextButton').find(e => e.props.title === t.cancel);
  assert.ok(cancel); cancel.props.onPress(); s.render();
  assert.ok(s.cancelled.length > 0); assert.notEqual(s.prober.state.phase, 'probing');
  answer({ status: 200, body: dsm, tls: selfSigned }); await flush();
  assert.equal(s.prober.state.best, undefined);
  assert.equal(s.primary(), undefined);
});

test('self-signed HTTPS opens the certificate for review; Allow saves the fingerprint with the DSM name', async () => {
  const s = addScreen({});
  s.prober['probe'] = async (url: string) => {
    if (url.startsWith('https://192.0.2.10:5001/webapi/')) return { status: 200, body: dsm, tls: selfSigned };
    if (url === 'https://192.0.2.10:5001/') return { status: 200, body: '<title>Vault - Synology NAS</title>', tls: selfSigned };
    return { error: 'refused' };
  };
  s.render();
  await s.submit('192.0.2.10'); s.render();
  const sheet = () => s.page.elements('TrustSheet')[0]?.props;
  assert.equal(sheet()?.visible, true, 'the review opens without a tap');
  assert.equal(sheet().origin, 'https://192.0.2.10:5001');
  assert.equal(sheet().state, 'untrusted');
  assert.equal(sheet().tls.sha256, selfSigned.sha256);
  // Cancel keeps the result; the trust row opens the same review again
  sheet().onClose(); s.render();
  assert.equal(sheet().visible, false);
  assert.equal(s.primary().disabled, true);
  s.page.elements('Row').find(e => e.props.title === t.trustThis)!.props.onPress(); s.render();
  assert.equal(sheet().visible, true);
  sheet().onAllow(); await flush(); s.render();
  assert.deepEqual(plain(s.saved), [{ name: 'Vault', origin: 'https://192.0.2.10:5001', sha256: 'b'.repeat(64) }]);
});

test('an expired certificate blocks HTTPS with its own explanation', async () => {
  const s = addScreen({});
  s.prober['probe'] = async (url: string) => url.startsWith('https://192.0.2.12:5001/webapi/') ? { status: 200, body: dsm, tls: { ...selfSigned, expired: true } } : { error: 'refused' };
  s.render();
  await s.submit('https://192.0.2.12:5001'); s.render();
  assert.ok(s.page.elements('Banner').some(e => e.props.title === t.cert_expired && e.props.detail === t.cert_expiredDetail));
  assert.equal(s.primary().disabled, true);
  assert.equal(s.page.elements('TrustSheet').length, 0);
});

test('self-signed HTTPS needs an explicit trust and saves the fingerprint with the DSM name', async () => {
  const s = addScreen({});
  const answers: Record<string, ProbeResponse> = {};
  s.prober['probe'] = async (url: string) => {
    if (url.startsWith('https://192.0.2.10:5001/webapi/')) return { status: 200, body: dsm, tls: selfSigned };
    if (url === 'https://192.0.2.10:5001/') return { status: 200, body: '<title>Vault&nbsp;-&nbsp;Synology&nbsp;NAS</title>', tls: selfSigned };
    return answers[url] ?? { error: 'refused' };
  };
  s.render();
  await s.submit('192.0.2.10');
  assert.equal(s.prober.state.best, 'https://192.0.2.10:5001');
  assert.equal(s.page.elements('TextField').find(e => e.props.accessibilityLabel === t.name)!.props.value, 'Vault');
  assert.equal(s.primary().disabled, true);
  const trust = s.page.elements('Row').find(e => e.props.title === t.trustThis);
  assert.ok(trust, 'trust row'); assert.ok(s.page.elements('Row').some(e => e.props.title === t.fingerprint && e.props.subtitle.startsWith('BB:BB')));
  trust.props.onPress(); s.render();
  s.page.elements('TrustSheet')[0].props.onClose(); s.render();
  assert.equal(s.primary().disabled, true, 'closing the review without Allow does not trust');
  trust.props.onPress(); s.render();
  s.page.elements('TrustSheet')[0].props.onAllow(); await flush(); s.render();
  assert.deepEqual(plain(s.saved), [{ name: 'Vault', origin: 'https://192.0.2.10:5001', sha256: 'b'.repeat(64) }]);
});

test('plain HTTP is allowed with a warning and never stores a pin', async () => {
  const s = addScreen({});
  s.prober['probe'] = async (url: string) => url.startsWith('http://192.0.2.11:5000/webapi/') ? { status: 200, body: dsm } : { error: 'refused' };
  s.render();
  await s.submit('http://192.0.2.11:5000');
  assert.ok(s.page.elements('Banner').some(e => e.props.title === t.cert_http));
  assert.equal(s.primary().disabled, false);
  await s.primary().onPress();
  assert.deepEqual(plain(s.saved), [{ name: '192.0.2.11', origin: 'http://192.0.2.11:5000' }]);
});

test('an address that never answers offers Try again and Use this address anyway', async () => {
  const s = addScreen({});
  s.render(); await s.submit('nas.example.com');
  // One line names the main cause and the next step; each address's result is behind Show details
  assert.ok(s.page.elements('Banner').some(e => e.props.title === fill(t.why_refused, { host: 'nas.example.com' }) && e.props.detail === t.fix_refused));
  s.page.elements('TextButton').find(e => e.props.title === t.showDetails)!.props.onPress(); s.render();
  assert.ok(s.page.elements('TextButton').some(e => e.props.title === t.hideDetails));
  s.page.elements('TextButton').find(e => e.props.title === t.useAnyway)!.props.onPress(); s.render();
  await s.primary().onPress();
  assert.deepEqual(plain(s.saved), [{ name: 'nas', origin: 'https://nas.example.com' }]);
});

test('QR: the camera stays off until Scan QR; deep links show a confirmation before any save', async () => {
  const s = addScreen({}, {}, { granted: false, request: true });
  s.render(); assert.equal(s.requests(), 0); assert.equal(s.page.elements('CameraView').length, 0);
  await s.page.elements('IconButton').find(e => e.props.label === t.scanQr)!.props.onPress(); s.render();
  assert.equal(s.requests(), 1);
  const camera = s.page.elements('CameraView')[0]; assert.ok(camera);
  camera.props.onBarcodeScanned({ data: qrFixture.qr }); camera.props.onBarcodeScanned({ data: qrFixture.qr }); s.render();
  assert.equal(s.page.elements('CameraView').length, 0); assert.equal(s.qrs.length, 0);
  assert.ok(s.page.elements('Row').some(e => JSON.stringify(e.props.title).includes(qrFixture.payload.urls[0].url)));
  await s.primary().onPress(); assert.equal(s.qrs.length, 1);
  const link = addScreen({}, { initialLink: 'synopkgland://add-nas#bad' }); link.render(); link.render();
  assert.ok(link.page.elements('Banner').some(e => e.props.title === t.invalidQr || Object.values(t).includes(e.props.title)));
  assert.equal(link.qrs.length, 0);
});

const profile: NasProfile = { id: 'nas', name: 'Vault', origin: 'https://nas.example.com:5001', kind: 'lan', sha256: 'c'.repeat(64) };
function detail(signedIn = true, size = { width: 393, height: 852 }, saved: Partial<NasProfile> = {}) {
  const calls: string[] = [];
  const p = prober({});
  const page = component('variants/land/Devices.tsx', {
    'react-native': { ...Object.fromEntries(['View', 'Text', 'ScrollView', 'TextInput', 'ActivityIndicator', 'Pressable', 'Switch'].map(n => [n, n])), Animated: { ScrollView: 'Animated.ScrollView' }, Dimensions: { get: () => size } },
    '../../modules/webview-cookies': { default: { haptic() {} } },
    '../../src/core/profiles/probe': { certState }, '../../src/core/webview/mobile-fit': { mobileFitOn }, '../../src/core/status/storage': { statusStorage: { read: () => undefined } }, '../../src/core/i18n/strings': i18n, './ui': uiStub, './cert': certStub, './theme': themeStub,
  });
  const handlers = Object.fromEntries(['onActions', 'onBack', 'onUse', 'onSignIn', 'onSignOut', 'onRemove', 'onChangeAddress'].map(name => [name, () => calls.push(name)]));
  const render = () => page.render('DeviceDetail', { profile: { ...profile, ...saved }, active: true, signedIn, busy: false, prober: p.instance, ...handlers, onRename: (name: string) => calls.push(`rename:${name}`), onTrust: (sha: string) => calls.push(`trust:${sha}`), onMobileFit: (value: boolean) => calls.push(`fit:${value}`) });
  const sheet = (title: string) => page.elements('ConfirmSheet').find(e => e.props.title === title)!.props;
  return { page, render, calls, sheet };
}
test('device detail: remove and sign out need a red confirmation; rename commits trimmed text', () => {
  const d = detail(); d.render();
  assert.equal(d.sheet(fill(t.removeTitle, { name: 'Vault' })).visible, false);
  d.page.elements('Row').find(e => e.props.title === t.remove)!.props.onPress(); d.render();
  const remove = d.sheet(fill(t.removeTitle, { name: 'Vault' }));
  assert.equal(remove.visible, true); assert.notEqual(remove.destructive, false); assert.deepEqual(d.calls, []);
  remove.onConfirm(); assert.deepEqual(d.calls, ['onRemove']);
  d.render(); d.page.elements('Row').find(e => e.props.title === t.signedIn)!.props.trailing.props.onPress(); d.render();
  d.sheet(fill(t.signOutTitle, { name: 'Vault' })).onConfirm(); assert.deepEqual(d.calls, ['onRemove', 'onSignOut']);
  d.render(); d.page.elements('IconButton').find(e => e.props.label === t.rename)!.props.onPress(); d.render();
  const field = d.page.elements('TextInput')[0]; field.props.onChangeText('  Lab  '); d.render(); d.page.elements('TextInput')[0].props.onSubmitEditing();
  assert.equal(d.calls.at(-1), 'rename:Lab');
  assert.ok(d.page.elements('Row').some(e => e.props.title === t.fingerprint && e.props.subtitle.startsWith('CC:CC')));
});
test('device detail: the address row opens change address and a signed-out device offers one Sign in', () => {
  const d = detail(false); d.render();
  d.page.elements('Row').find(e => e.props.label === t.editAddress)!.props.onPress();
  assert.deepEqual(d.calls, ['onChangeAddress']);
  assert.equal(d.page.elements('PrimaryButton').length, 1);
  assert.equal(d.page.elements('PrimaryButton')[0].props.title, t.signIn);
});
test('device detail: the mobile fit switch defaults on for phones, off for tablets, and follows the saved setting', () => {
  const fit = (d: ReturnType<typeof detail>) => d.page.elements('Row').find(e => e.props.title === t.mobileFit)!.props.trailing.props;
  const phone = detail(); phone.render();
  assert.equal(fit(phone).value, true); assert.equal(fit(phone).accessibilityLabel, t.mobileFit);
  fit(phone).onValueChange(false); assert.deepEqual(phone.calls, ['fit:false']);
  const tablet = detail(true, { width: 1280, height: 800 }); tablet.render(); assert.equal(fit(tablet).value, false);
  const off = detail(true, undefined, { mobileFit: false }); off.render(); assert.equal(fit(off).value, false);
});

const apps = (count: number, registered = false): DiscoveredApp[] => Array.from({ length: count }, (_, i) => ({ id: `a${i}`, package: `A${i}`, name: `App ${i}`, registered, preset: registered ? 'mobile' : 'desktop', url: 'https://nas.example.com/', capabilities: [] }));
const failedOf = (state: { error?: string }, p?: NasProfile) => Boolean(p && state.error && state.error !== 'SIGN_IN_REQUIRED');
const tabParts = { Gate: 'Gate', NasTitle: 'NasTitle', Notices: 'Notices', failedOf };
const launcherBase = { profiles: [], snapshots: {}, apps: [], intakeApps: [], refreshing: false, signIn: false };
/** The Apps tab with its FlatList items rendered */
function appsTab(state: Record<string, unknown>, withProfile = true, extra: Record<string, unknown> = {}) {
  const calls: string[] = [];
  const page = component('variants/land/AppsTab.tsx', {
    'react-native': { ...Object.fromEntries(['View', 'Text', 'Pressable', 'Image', 'TextInput'].map(n => [n, n])), Animated: { FlatList: 'FlatList' }, BackHandler: { addEventListener: () => ({ remove() {} }) }, RefreshControl: 'RefreshControl', useWindowDimensions: () => ({ width: 360, height: 800 }) },
    '../../src/core/i18n/strings': i18n, './ui': uiStub, './theme': themeStub,
    './AppGrid': { AppGrid: 'AppGrid', TILE_HEIGHT: 84 }, '../../src/core/launcher/order': { orderApps, moveApp }, './TabParts': tabParts,
  });
  const handlers = Object.fromEntries(['onAdd', 'onScan', 'onSignIn', 'onRefresh', 'onSwitch', 'onDetails', 'onOpen', 'onPressIn', 'onPressOut', 'onDismissNotice'].map(name => [name, () => calls.push(name)]));
  const arranged: string[][] = [];
  page.render('AppsTab', { state: { ...launcherBase, ...state }, profile: withProfile ? profile : undefined, busy: false, shareWaiting: false, language: 'en', onArrange: (ids: string[]) => arranged.push(ids), ...handlers, ...extra });
  const list = page.elements('FlatList')[0].props;
  const rendered = list.data.map((item: unknown) => list.renderItem({ item }));
  const grids = () => rendered.filter((node: any) => node?.props?.children?.type === 'AppGrid').map((node: any) => node.props.children.props);
  return { list, rendered, grids, calls, arranged, page, bar: () => page.elements('TopBar')[0].props };
}
/** What the Overview and Apps tabs show before there is anything to show */
function gate(state: Record<string, unknown>, withProfile = true) {
  const page = component('variants/land/TabParts.tsx', {
    'react-native': { Image: 'Image', Text: 'Text', View: 'View' }, '../../src/core/i18n/strings': i18n, './ui': uiStub, './theme': themeStub, '../../assets/brand/package-land.png': 1,
  });
  return page.render('Gate', { state: { ...launcherBase, ...state }, profile: withProfile ? profile : undefined, busy: false, onAdd() {}, onScan() {}, onSignIn() {}, onRefresh() {}, onDetails() {} });
}
test('apps tab: no device shows Add NAS and Scan QR as quiet text actions', () => {
  const h = appsTab({}, false);
  assert.equal(h.rendered.length, 1); assert.equal(h.rendered[0].type, 'Gate');
  const empty = gate({}, false);
  assert.equal(empty.type, 'EmptyState'); assert.equal(empty.props.art.type, 'Image');
  const children = empty.props.children;
  assert.equal(children.filter((c: any) => c?.type === 'PrimaryButton').length, 0, 'no framed button');
  assert.ok(children.some((c: any) => c?.type === 'TextButton' && c.props.title === t.addNas));
  assert.ok(children.some((c: any) => c?.type === 'TextButton' && c.props.title === t.scanQr));
});
test('apps tab: offline without a list shows the cause with Retry; with a list it keeps the Apps and a banner', () => {
  const offline = appsTab({ error: 'timeout' });
  assert.equal(offline.rendered[0].type, 'Gate');
  const cause = gate({ error: 'timeout' });
  assert.equal(cause.props.title, fill(t.unreachableTitle, { name: 'Vault' }));
  assert.ok(cause.props.detail.startsWith(t.cause_timeout));
  assert.ok(cause.props.children.some((c: any) => c?.props?.title === t.retry));
  const cached = appsTab({ error: 'timeout', apps: apps(3, true) });
  assert.equal(cached.list.ListHeaderComponent.props.offline, true);
  assert.ok(cached.list.data.some((item: any) => item.kind === 'grid'));
});
test('apps tab: search lives in the top bar; sections and a dense grid', () => {
  const few = appsTab({ apps: apps(3, true) });
  assert.equal(few.bar().right.props.label, t.searchApps);
  assert.equal(appsTab({}).bar().right, null, 'nothing to search before the list');
  const many = appsTab({ apps: [...apps(4, true), ...apps(100)] });
  assert.deepEqual(plain(many.list.data.filter((item: any) => item.kind === 'header').map((item: any) => item.title)), [t.mobileApps, t.desktopApps]);
  assert.deepEqual(plain(many.grids().map((grid: any) => grid.apps.length)), [4, 100]);
  assert.ok(many.grids().every((grid: any) => grid.columns === 4));
});
test('apps tab: sections follow DSM order, and dragging within a section saves a full custom order', () => {
  const list = [...apps(3, true), ...apps(2).map((a, i) => ({ ...a, id: `d${i}`, name: `Desk ${i}` }))];
  list[2].dsmRank = 0;
  const h = appsTab({ apps: list });
  const grids = h.grids();
  assert.deepEqual(grids[0].apps.map((a: DiscoveredApp) => a.id), ['a2', 'a0', 'a1']);
  assert.equal(grids[0].mixed, false, 'no kind badge inside a section');
  grids[0].onReorder(0, 2);
  assert.deepEqual(h.arranged, [['a0', 'a1', 'a2', 'd0', 'd1']]);
  const custom = appsTab({ apps: list, order: { nas: ['a1', 'a0'] } });
  assert.deepEqual(custom.grids()[0].apps.map((a: DiscoveredApp) => a.id), ['a1', 'a0', 'a2'], 'custom order wins; new Apps go last');
});
function overview(state: Record<string, unknown>, extra: Record<string, unknown> = {}) {
  const calls: string[] = [];
  const page = component('variants/land/Overview.tsx', {
    'react-native': { ...Object.fromEntries(['View', 'Text', 'Pressable', 'ScrollView'].map(n => [n, n])), RefreshControl: 'RefreshControl' },
    '../../src/core/i18n/strings': i18n, './ui': uiStub, './theme': themeStub, './TabParts': tabParts,
    './HomeCards': { NasLine: 'NasLine', OfflineLine: 'OfflineLine', ResourceCard: 'ResourceCard', ageOf: () => undefined },
    './Glance': { AttentionBlock: 'AttentionBlock', StorageSection: 'StorageSection', BackupSection: 'BackupSection' },
    './InstallHint': { InstallHint: 'InstallHint' }, './LanSwitch': { LanSwitch: 'LanSwitch' }, './config': { landConfig: { name: 'Package Land' } },
  });
  const handlers = Object.fromEntries(['onAdd', 'onScan', 'onSignIn', 'onRefresh', 'onSwitch', 'onDetails', 'onDismissNotice', 'onStatus', 'onStorage', 'onAccount'].map(name => [name, () => calls.push(name)]));
  page.render('Overview', { state: { ...launcherBase, ...state }, profile, busy: false, shareWaiting: false, now: 0, language: 'en', ...handlers, ...extra });
  return { page, calls, bar: () => page.elements('TopBar')[0].props };
}
test('overview: the browser\'s Add to Home Screen card sits in the scrolled content, signed in or not, never over it', () => {
  const status = { history: {}, read: { before: 0, ids: [] }, refreshing: false, signedOut: false, loadingMore: false, snapshot: { scope: 's', times: {}, denied: [], user: { user: 'alex' } } };
  for (const o of [overview({ apps: apps(3, true) }, { status, language: 'zh-TW' }), overview({ signIn: true }, { status: undefined, language: 'zh-TW' })]) {
    const hint = o.page.elements('InstallHint');
    assert.equal(hint.length, 1);
    assert.equal(hint[0].props.name, 'Package Land');
    assert.equal(hint[0].props.locale, 'zh-TW', 'the card speaks the language the page is written in');
    const scroll = o.page.elements('ScrollView')[0];
    assert.ok(scroll.props.children.some((c: any) => c?.type === 'InstallHint'), 'a child of the scroll view');
  }
});
test('overview: the browser\'s switch-to-local-network card sits in the scrolled content before the Home Screen card', () => {
  const status = { history: {}, read: { before: 0, ids: [] }, refreshing: false, signedOut: false, loadingMore: false, snapshot: { scope: 's', times: {}, denied: [], user: { user: 'alex' } } };
  const o = overview({ apps: apps(3, true) }, { status, language: 'ja' });
  const lan = o.page.elements('LanSwitch');
  assert.equal(lan.length, 1);
  assert.equal(lan[0].props.locale, 'ja');
  const children = o.page.elements('ScrollView')[0].props.children as any[];
  const at = (type: string) => children.findIndex(c => c?.type === type);
  assert.ok(at('LanSwitch') >= 0 && at('LanSwitch') < at('InstallHint'));
});
test('overview: one line, then attention, resources, storage and backup; the bar holds the NAS switcher and the account', () => {
  const status = { history: {}, read: { before: 0, ids: [] }, refreshing: false, signedOut: false, loadingMore: false, snapshot: { scope: 's', times: {}, denied: [], user: { user: 'alex' } } };
  const o = overview({ apps: apps(3, true) }, { status });
  const order = ['NasLine', 'OfflineLine', 'AttentionBlock', 'ResourceCard', 'StorageSection', 'BackupSection'];
  const found = o.page.elements('View').find(e => Array.isArray(e.props.children) && e.props.children.some((c: any) => c?.type === 'NasLine'))!;
  assert.deepEqual(plain(found.props.children.filter(Boolean).map((c: any) => c.type)), order);
  assert.equal(o.page.elements('Gate').length, 0);
  const bar = o.bar();
  assert.equal(bar.titleLabel, t.switchNas); bar.onTitlePress(); assert.deepEqual(o.calls, ['onSwitch']);
  assert.equal(bar.right.props.accessibilityLabel, t.accountMenu);
  assert.ok(JSON.stringify(bar.right).includes('"A"'), 'the account initial');
  bar.right.props.onPress(); assert.deepEqual(o.calls, ['onSwitch', 'onAccount']);
  // Signed out: the sign-in gate, no status cards
  const out = overview({ signIn: true }, { status: undefined });
  assert.equal(out.page.elements('Gate').length, 1);
  assert.equal(out.page.elements('NasLine').length, 0);
});

/** Records what the launcher asks of the NAS status model */
class FakeStatus {
  state = { history: { cpu: [], memory: [], rx: [], tx: [] }, read: { before: 0, ids: [] }, refreshing: false, signedOut: false, loadingMore: false };
  calls: string[] = []; unread = 0;
  subscribe = () => () => {}; getState = () => this.state;
  select(profile?: string, _origin?: string, scope?: string) { this.calls.push(`select:${profile}:${scope}`); }
  setMode(mode: string) { this.calls.push(`mode:${mode}`); }
  setForeground(value: boolean) { this.calls.push(`foreground:${value}`); }
  refresh() { this.calls.push('refresh'); return Promise.resolve(); }
  forget(id: string) { this.calls.push(`forget:${id}`); }
  loadStrings(lang: string) { this.calls.push(`strings:${lang}`); return Promise.resolve(); }
  loadMoreNotices() { this.calls.push('more'); return Promise.resolve(); }
  loadHistory(range: string) { this.calls.push(`history:${range}`); return Promise.resolve(); }
  markRead(ids: number | number[]) { this.calls.push(`read:${[ids].flat().join(',')}`); }
  markAllRead() { this.calls.push('readAll'); }
}
function app(options: { reduced?: boolean; tablet?: boolean; restored?: unknown; web?: boolean; remote?: unknown } = {}) {
  const nasApps: DiscoveredApp[] = [
    { id: 'mobile', package: 'Mobile', name: 'Mobile', registered: true, preset: 'mobile', url: profile.origin + '/entry', capabilities: [] },
    { id: 'desk', package: 'Desk', name: 'Desk', registered: false, preset: 'desktop', url: profile.origin + '/', capabilities: [] },
  ];
  const pins: unknown[] = [], cleared: string[] = [], keeps: boolean[] = [], depths: number[] = [], screens: unknown[] = [];
  let uuid = 0, key = 'session';
  const iconCalls: string[] = [];
  const icons = { sync: async (p: NasProfile, _apps: DiscoveredApp[], revalidate = false) => { iconCalls.push(`sync:${p.id}:${revalidate}`); }, beginRound() { iconCalls.push('round'); }, retainApps() {}, retainProfiles: (ids: string[]) => { iconCalls.push(`retain:${ids.join(',')}`); }, refresh: async (p: NasProfile) => { iconCalls.push(`refresh:${p.id}`); } };
  let discover: Discovery = async () => nasApps;
  const status = new FakeStatus();
  const appState = { currentState: 'active', listeners: [] as ((next: string) => void)[], addEventListener(_: string, fn: (next: string) => void) { appState.listeners.push(fn); return { remove() { appState.listeners = appState.listeners.filter(l => l !== fn); } }; } };
  // Hardware back: the newest listener answers first, like Android's BackHandler
  let backs: (() => boolean)[] = [];
  const backHandler = { addEventListener: (_: string, fn: () => boolean) => { backs.push(fn); return { remove() { backs = backs.filter(l => l !== fn); } }; } };
  // Animations finish at once; each records its target
  const animations: { to: number; finish(): void }[] = [];
  class Value { value: number; constructor(value: number) { this.value = value; } setValue(value: number) { this.value = value; } }
  const animated = { Value, View: 'Animated.View', timing: (value: Value, config: { toValue: number }) => ({ start(done?: () => void) { animations.push({ to: config.toValue, finish() { value.value = config.toValue; done?.(); } }); } }) };
  const model = new LauncherModel({ read: () => ({ profiles: [profile], active: profile.id, snapshots: { nas: { scope: 'session', apps: nasApps, updated: 1 } } }), write() {} }, () => key, (...args) => discover(...args), () => {});
  const page = component('variants/land/App.tsx', {
    expo: { uuid: { v4: () => `uuid-${++uuid}` } }, 'expo-status-bar': { StatusBar: 'StatusBar' },
    'react-native-safe-area-context': { SafeAreaProvider: 'SafeAreaProvider', useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) },
    '../../modules/webview-cookies': { default: { setCertificatePins: async (value: unknown) => { pins.push(value); }, clearSession: async (origin: string, keep: boolean) => { cleared.push(origin); keeps.push(keep); }, sessionKey: () => key, logOpen() {}, logSignIn() {}, addListener: () => ({ remove() {} }), takePendingIntake: async () => ({ items: [] }), readJson: async () => ({}), probe: async () => ({ error: 'refused' }), cancelProbe() {} } },
    '../../src/core/webview/ShellPool': { ShellPool: 'ShellPool' }, '../../src/core/webview/ShellScreen': { ShellScreen: 'ShellScreen' },
    '../../src/core/webview/LaunchCover': { LaunchCover: 'LaunchCover', useReducedMotion: () => Boolean(options.reduced) },
    '../../src/core/discovery/client': { createDiscovery: () => {} }, '../../src/core/status/modules/upgrade': upgradeModule,
    '../../src/core/launcher/model': { LauncherModel: class { constructor() { return model; } }, intakeChoice },
    '../../src/core/launcher/storage': { launcherStorage: {} }, '../../src/core/intake/inbox': { intakeInbox: new IntakeInbox() },
    '../../src/core/transfers/download': { cleanupDownloads() {} }, '../../src/core/profiles/qr': { qrGroup },
    '../../src/core/profiles/probe': { NasProber }, '../../src/core/i18n/strings': i18n,
    './AddDevice': { AddDevice: 'AddDevice' }, './SignIn': { SignIn: 'SignIn' }, './Overview': { Overview: 'Overview' }, './AppsTab': { AppsTab: 'AppsTab' },
    './Stack': { Stack: 'Stack', SLIDE: 200 }, './TabParts': { Gate: 'Gate' },
    './Devices': { Devices: 'Devices', DeviceDetail: 'DeviceDetail', DeviceSheet: 'DeviceSheet', DeviceMenu: 'DeviceMenu', ageText: () => 'now' },
    './AddRemote': { AddRemote: 'AddRemote' }, '../../src/core/profiles/remote': { remoteNas: options.remote },
    './AppIcon': { AppIcon: 'AppIcon', tileOf: () => ({ bg: '#E8F1FD', fg: '#1D6FE8' }) }, '../../src/core/icons/store': { iconCache: icons },
    './ui': { ...uiStub, TabBarShown: { Provider: 'TabBarShown.Provider' }, badgeText: (count: number, more = false) => `${count}${more ? '+' : ''}` }, './theme': themeStub, './config': { landConfig: { name: 'Shell', version: '0.1.0' } },
    'react-native': { ...Object.fromEntries(['View', 'Text', 'ScrollView', 'Image'].map(n => [n, n])), StyleSheet: { absoluteFill: { position: 'absolute' } }, Animated: animated, Platform: { OS: options.web ? 'web' : 'android' }, Dimensions: { get: () => options.tablet ? { width: 800, height: 1280 } : { width: 360, height: 800 } }, Easing: { out: (f: unknown) => f, in: (f: unknown) => f, cubic: 'cubic' }, useWindowDimensions: () => ({ width: 360, height: 800 }), BackHandler: backHandler, AppState: appState },
    '../../src/core/status/model': { StatusModel: class { constructor() { return status; } }, dsmLang: () => 'enu', unreadCount: () => status.unread, moreUnread: () => false },
    '../../src/core/status/storage': { statusStorage: {} }, './Status': { StatusScreen: 'StatusScreen' }, './Notifications': { Notifications: 'Notifications' },
    '../../src/core/back': { BackHandler: backHandler, restoredScreen: () => options.restored, useBackDepth: (depth: number) => { depths.push(depth); }, useBackScreen: (screen: unknown) => { screens.push(screen); } },
    '../../src/core/webview/mobile-fit': { hostedApp, warmUrl, mobileFitOn },
  });
  const render = () => page.render('Launcher');
  const one = (type: string) => page.elements(type)[0]?.props;
  const tabBar = () => one('TabBar');
  /** Hardware back as Android delivers it: newest listener first; true when handled */
  const back = () => { for (const fn of [...backs].reverse()) if (fn()) return true; return false; };
  return { page, render, one, tabBar, back, depths, screens, animations, model, status, appState, pins, cleared, keeps, nasApps, iconCalls, setDiscovery: (next: Discovery) => { discover = next; }, signOut: () => { key = ''; } };
}
const lastMode = (calls: string[]) => calls.filter(c => c.startsWith('mode:')).at(-1);
test('app: registered and DSM-layout Apps open on the first tap, with no confirmation', async () => {
  const a = app(); a.render(); await flush(); a.render();
  a.one('AppsTab').onOpen(a.nasApps[0]); a.render();
  assert.equal(a.one('ShellPool').target.id, 'mobile');
  const a2 = app(); a2.render(); await flush(); a2.render();
  a2.one('AppsTab').onOpen(a2.nasApps[1]); a2.render();
  assert.equal(a2.one('ShellPool').target.id, 'desk');
  assert.equal(a2.page.elements('ConfirmSheet').length, 0);
});
test('app: the DSM update tag opens Control Panel at Update & Restore, only for an account with Control Panel', async () => {
  const a = app(); a.render(); await flush(); a.render();
  assert.equal(a.one('Overview').onUpdate, undefined, 'no Control Panel, no button');
  const b = app();
  b.nasApps.push({ id: 'SYNO.SDS.AdminCenter.Application', package: 'AdminCenter', name: 'Control Panel', registered: false, preset: 'desktop', url: profile.origin + '/?launchApp=SYNO.SDS.AdminCenter.Application', capabilities: [], builtin: true });
  b.render(); await flush(); b.render();
  b.one('Overview').onUpdate(); b.render();
  const target = b.one('ShellPool').target;
  // Its own target: a Control Panel already open on another page is not reused
  assert.equal(target.id, 'SYNO.SDS.AdminCenter.Application:update');
  assert.equal(target.name, 'Control Panel');
  const url = new URL(target.url);
  assert.equal(url.origin, profile.origin);
  assert.equal(url.searchParams.get('launchApp'), 'SYNO.SDS.AdminCenter.Application');
  assert.equal(url.searchParams.get('launchParam'), 'fn=SYNO.SDS.AdminCenter.Update_Reset.Main');
});
test('app: the native sign-in form replaces the DSM page and closes as soon as DSM accepts the sign-in', async () => {
  const a = app(); a.render(); await flush(); a.render();
  a.one('Overview').onSignIn(); a.render();
  assert.equal(a.page.elements('SignIn').length, 1);
  assert.equal(a.page.elements('ShellScreen').length, 0, 'no DSM web page behind the native form');
  let refreshes = 0;
  a.model.refresh = () => { refreshes++; return new Promise(() => {}); };
  a.one('SignIn').onSignedIn(); a.render();
  assert.equal(a.page.elements('SignIn').length, 0);
  assert.equal(refreshes, 1);
  // Signed in: the retained DSM view loads hidden and reports runtime visibility
  assert.equal(a.one('ShellScreen').active, false);
  assert.equal(a.one('ShellScreen').onAuthenticated, undefined);
});
test('app: the DSM web sign-in fallback keeps the verified relay and retains its view', async () => {
  const a = app(); a.render(); await flush(); a.render();
  a.one('Overview').onSignIn(); a.render();
  a.one('SignIn').onWeb(); a.render();
  assert.equal(a.page.elements('SignIn').length, 0);
  const dsm = a.page.elements('ShellScreen')[0], key = dsm.key;
  let refreshes = 0;
  a.model.refresh = () => { refreshes++; return new Promise(() => {}); };
  assert.equal(dsm.props.active, true);
  dsm.props.onAuthenticated(); a.render();
  assert.equal(a.one('ShellScreen').active, false);
  assert.equal(a.page.elements('ShellScreen')[0].key, key, 'do not reload the DSM desktop to detect success');
  assert.equal(refreshes, 1);
  // The next sign-in starts with the native form again
  a.one('Overview').onSignIn(); a.render();
  assert.equal(a.page.elements('SignIn').length, 1);
});
test('app: sign-out keeps the trusted-device cookie and removing the NAS clears it', async () => {
  const a = app(); a.render(); await flush(); a.render();
  a.one('Overview').onDetails(); a.render();
  await a.one('DeviceDetail').onSignOut(); await flush();
  assert.deepEqual(plain(a.cleared), [profile.origin]); assert.deepEqual(plain(a.keeps), [true]);
  a.render();
  if (!a.page.elements('DeviceDetail').length) { a.one('Overview').onDetails(); a.render(); }
  await a.one('DeviceDetail').onRemove(); await flush(); a.render();
  assert.deepEqual(plain(a.keeps), [true, false]);
  assert.equal(a.page.elements('DeviceDetail').length, 0, 'the removed NAS leaves every stack');
});
test('app: background sign-in refresh revalidates icons and preserves DSM ranks and custom order', async () => {
  const a = app(); a.render(); await flush(); a.render();
  a.model.setOrder(profile.id, ['mobile', 'desk']);
  let complete!: (apps: DiscoveredApp[]) => void;
  a.setDiscovery(() => new Promise(resolve => { complete = resolve; }));
  a.one('Overview').onSignIn(); a.render();
  a.iconCalls.length = 0;
  a.one('SignIn').onSignedIn(); a.render();
  assert.equal(a.page.elements('SignIn').length, 0);
  assert.equal(a.model.state.refreshing, true);
  assert.ok(a.iconCalls.includes('round'));
  assert.ok(!a.iconCalls.includes('sync:nas:true'), 'wait for the completed list before revalidation');
  complete(a.nasApps.map((app, index) => ({ ...app, dsmRank: 1 - index })));
  await flush(); a.render();
  assert.equal(a.model.state.refreshing, false);
  assert.equal(a.iconCalls.filter(call => call === 'sync:nas:true').length, 1);
  const apps = a.one('AppsTab').state.apps as DiscoveredApp[];
  assert.deepEqual(orderApps(apps, 'en').map(app => app.id), ['desk', 'mobile']);
  assert.deepEqual(orderApps(apps, 'en', a.model.state.order?.nas).map(app => app.id), ['mobile', 'desk']);
});
test('app: adding a self-signed NAS installs its pin before saving and goes straight to sign-in', async () => {
  const a = app(); a.render(); await flush(); a.render();
  a.one('Overview').onAdd(); a.render();
  const add = a.page.elements('AddDevice')[0];
  assert.ok(add, 'add device sheet');
  await add.props.onSave({ name: 'Lab', origin: 'https://192.0.2.20:5001', sha256: 'd'.repeat(64) }); a.render();
  assert.deepEqual(plain(a.pins.at(-1)), [{ origin: profile.origin, sha256: profile.sha256 }, { origin: 'https://192.0.2.20:5001', sha256: 'd'.repeat(64) }]);
  assert.equal(a.model.profile?.name, 'Lab');
  assert.equal(a.page.elements('AddDevice').length, 0);
  assert.equal(a.page.elements('SignIn').length, 1);
});
test('app: changing the address of a device clears the old origin session and re-pins it', async () => {
  const a = app(); a.render(); await flush(); a.render();
  a.one('Overview').onDetails(); a.render();
  a.one('DeviceDetail').onChangeAddress(); a.render();
  await a.one('AddDevice').onSave({ name: 'Vault', origin: 'https://nas2.example.com:5001' }); a.render();
  assert.deepEqual(plain(a.cleared), [profile.origin]);
  assert.deepEqual(plain(a.pins.at(-1)), []);
  assert.equal(a.model.profile?.id, 'nas'); assert.equal(a.model.profile?.origin, 'https://nas2.example.com:5001');
});
test('app: three tabs stay mounted; the tab bar blurs the active tab\'s list, and a solid bar over pushed pages', async () => {
  const a = app(); a.render(); await flush(); a.render();
  assert.deepEqual(plain(a.tabBar().tabs.map((tab: any) => tab.key)), ['overview', 'apps', 'notifications']);
  for (const type of ['Overview', 'AppsTab', 'Notifications']) assert.equal(a.page.elements(type).length, 1, type);
  assert.ok(a.tabBar().blurTarget); assert.equal(a.tabBar().blurTarget, a.one('Overview').blurTarget);
  a.tabBar().onChange('apps'); a.render();
  assert.equal(a.tabBar().active, 'apps');
  assert.equal(a.tabBar().blurTarget, a.one('AppsTab').blurTarget);
  assert.notEqual(a.tabBar().blurTarget, a.one('Overview').blurTarget);
  a.tabBar().onChange('notifications'); a.render();
  assert.equal(a.tabBar().blurTarget, undefined);
  // A page pushed onto the Overview stack keeps the tab bar, without blur
  a.tabBar().onChange('overview'); a.render();
  a.one('Overview').onStatus(); a.render();
  assert.equal(a.page.elements('StatusScreen').length, 1);
  assert.equal(a.tabBar().blurTarget, undefined);
});
test('app: each tab keeps its own stack; pressing the selected tab again empties it and scrolls to the top', async () => {
  const a = app(); a.render(); await flush(); a.render();
  a.one('Overview').onStatus(); a.render();
  a.tabBar().onChange('apps'); a.render();
  a.one('DeviceSheet').onManage(); a.render();
  const stacks = () => a.page.elements('Stack').map(s => s.props.pages.length);
  assert.deepEqual(stacks(), [1, 1, 0], 'Manage NAS opens on the current tab');
  assert.equal(a.page.elements('Devices').length, 1);
  a.tabBar().onChange('overview'); a.render();
  assert.equal(a.page.elements('StatusScreen').length, 1, 'Overview kept its page');
  const top = a.one('Overview').top;
  a.tabBar().onChange('overview'); a.render();
  assert.deepEqual(stacks(), [0, 1, 0]);
  a.tabBar().onChange('overview'); a.render();
  assert.equal(a.one('Overview').top, top + 2);
  // Changing NAS clears every stack
  a.one('DeviceSheet').onSelect('other'); a.render();
  assert.deepEqual(stacks(), [0, 0, 0]);
});
test('app: hardware back closes Add NAS, pops the stack, returns to Overview, then leaves', async () => {
  const a = app(); a.render(); await flush(); a.render();
  a.tabBar().onChange('apps'); a.render();
  a.one('DeviceSheet').onManage(); a.render();
  a.one('Devices').onOpen('nas'); a.render();
  a.one('DeviceDetail').onChangeAddress(); a.render();
  assert.equal(a.page.elements('AddDevice').length, 1);
  assert.equal(a.depths.at(-1), 4, 'one browser history step per back step: tab, two pages, Add NAS');
  assert.equal(a.back(), true); a.render();
  assert.equal(a.page.elements('AddDevice').length, 0);
  assert.equal(a.depths.at(-1), 3);
  assert.equal(a.back(), true); a.render();
  assert.equal(a.page.elements('DeviceDetail').length, 0);
  assert.equal(a.back(), true); a.render();
  assert.equal(a.page.elements('Devices').length, 0);
  assert.equal(a.tabBar().active, 'apps');
  assert.equal(a.back(), true); a.render();
  assert.equal(a.tabBar().active, 'overview');
  assert.equal(a.back(), false, 'the system takes the last back');
});
test('app: the App bar goes home in one tap; an open App and the tab are a saved screen restored on reload', async () => {
  const a = app(); a.render(); await flush(); a.render();
  a.tabBar().onChange('apps'); a.render();
  a.one('AppsTab').onOpen(a.nasApps[1]); a.render();
  assert.equal(a.depths.at(-1), 2, 'the tab and the open App');
  assert.deepEqual(plain(a.screens.at(-1)), { tab: 'apps', stacks: { overview: [], apps: [], notifications: [] }, app: 'desk' });
  a.one('DesktopBar').onHome(); a.render();
  assert.equal(a.depths.at(-1), 1, 'back on the launcher, on the tab it came from');
  assert.equal(a.tabBar().active, 'apps');
  const r = app({ restored: { tab: 'apps', stacks: { overview: [], apps: [], notifications: [] }, app: 'desk' } }); r.render(); await flush(); r.render();
  r.render();
  assert.equal(r.tabBar().active, 'apps');
  assert.equal(r.one('ShellPool').target.id, 'desk', 'the App open before the reload opens again');
  const bad = app({ restored: { tab: 'nowhere', stacks: { apps: [{ kind: 'x' }] } } }); bad.render(); await flush(); bad.render();
  assert.equal(bad.tabBar().active, 'overview', 'an unknown saved screen is ignored');
});
test('app: an opened App slides in over the launcher and slides out when it closes', async () => {
  const a = app(); a.render(); await flush(); a.render();
  const layer = () => a.page.elements('Animated.View')[0];
  const launcherHidden = () => a.page.elements('View')[1].props.style.some((s: any) => s && s.display === 'none');
  a.one('AppsTab').onOpen(a.nasApps[0]); a.render();
  assert.equal(a.animations.at(-1)!.to, 0, 'slides in to its place');
  assert.ok(layer().props.style.some((s: any) => s?.transform), 'moves while sliding');
  assert.equal(launcherHidden(), false, 'the launcher stays drawn under the sliding App');
  a.animations.at(-1)!.finish(); a.render();
  assert.ok(!layer().props.style.some((s: any) => s?.transform), 'no transform once in place');
  assert.equal(launcherHidden(), true);
  // Back from the App: the launcher returns under it and the App slides out to the right
  a.one('ShellPool').onExit(); a.render();
  assert.equal(launcherHidden(), false);
  assert.equal(a.animations.at(-1)!.to, 360);
  assert.ok(layer().props.style.some((s: any) => s?.transform));
  assert.ok(!layer().props.style.some((s: any) => s?.display === 'none'), 'still drawn while it leaves');
  a.animations.at(-1)!.finish(); a.render();
  assert.ok(layer().props.style.some((s: any) => s?.display === 'none'), 'hidden once gone; the WebView is retained');
  // In a browser the App layer keeps its size while hidden: DSM would lay every window out again
  const w = app({ web: true }); w.render(); await flush(); w.render();
  w.one('AppsTab').onOpen(w.nasApps[1]); w.render(); w.animations.at(-1)!.finish(); w.render();
  w.one('ShellPool').onExit(); w.render(); w.animations.at(-1)!.finish(); w.render();
  const hiddenLayer = w.page.elements('Animated.View')[0].props.style;
  assert.ok(hiddenLayer.some((s: any) => s?.visibility === 'hidden'));
  assert.ok(!hiddenLayer.some((s: any) => s?.display === 'none'));
  // Remove animations: no slide either way
  const r = app({ reduced: true }); r.render(); await flush(); r.render();
  r.one('AppsTab').onOpen(r.nasApps[0]); r.render(); r.one('ShellPool').onExit(); r.render();
  assert.equal(r.animations.length, 0);
});
test('app: long-press menu refreshes this NAS\'s icons with a spinner and resets a custom order', async () => {
  const a = app(); a.render(); await flush(); a.render();
  assert.ok(a.iconCalls.some(call => call.startsWith('sync:nas')), 'icons load with the list');
  a.one('AppsTab').onArrange(['desk', 'mobile']);
  assert.deepEqual(plain(a.model.state.order?.nas), ['desk', 'mobile']);
  a.one('DeviceSheet').onManage(); a.render();
  a.one('Devices').onActions('nas'); a.render();
  const menu = () => a.one('DeviceMenu');
  assert.equal(menu().profile.id, 'nas'); assert.equal(menu().custom, true);
  const pending = menu().onRefreshIcons(); a.render();
  assert.equal(menu().refreshing, true);
  await pending; await flush(); a.render();
  assert.ok(a.iconCalls.includes('refresh:nas')); assert.equal(menu().refreshing, false); assert.equal(menu().refreshed, true);
  menu().onResetOrder(); a.render();
  assert.equal(a.model.state.order?.nas, undefined); assert.equal(menu().custom, false);
});
test('device menu: reset order asks first in the app dialog style; nothing to reset is disabled', () => {
  const page = component('variants/land/Devices.tsx', {
    'react-native': { ...Object.fromEntries(['View', 'Text', 'ScrollView', 'TextInput', 'ActivityIndicator', 'Pressable'].map(n => [n, n])), Animated: { ScrollView: 'Animated.ScrollView' } },
    '../../modules/webview-cookies': { default: { haptic() {} } },
    '../../src/core/profiles/probe': { certState }, '../../src/core/webview/mobile-fit': { mobileFitOn }, '../../src/core/status/storage': { statusStorage: { read: () => undefined } }, '../../src/core/i18n/strings': i18n, './ui': uiStub, './cert': certStub, './theme': themeStub,
  });
  const calls: string[] = [];
  const render = (custom: boolean) => page.render('DeviceMenu', { profile, custom, refreshing: false, refreshed: false, onRefreshIcons: () => calls.push('icons'), onResetOrder: () => calls.push('reset'), onClose: () => calls.push('close') });
  render(false);
  assert.equal(page.elements('Row').find(e => e.props.title === t.resetOrder)!.props.onPress, undefined);
  render(true);
  page.elements('Row').find(e => e.props.title === t.refreshIcons)!.props.onPress();
  page.elements('Row').find(e => e.props.title === t.resetOrder)!.props.onPress(); render(true);
  const confirm = page.elements('ConfirmSheet').find(e => e.props.title === fill(t.resetOrderTitle, { name: 'Vault' }))!.props;
  assert.equal(confirm.visible, true); assert.deepEqual(calls, ['icons']);
  confirm.onConfirm();
  assert.deepEqual(calls, ['icons', 'reset', 'close']);
  for (const text of [t.refreshIcons, t.resetOrder]) assert.ok(!/(\.\.\.|…)/.test(text));
});
test('app: NAS status polls only for the visible surface and only in the foreground', async () => {
  const a = app(); a.render(); await flush(); a.render();
  const s = a.status;
  assert.ok(s.calls.includes('select:nas:session'), 'the active NAS and account are selected');
  assert.equal(lastMode(s.calls), 'mode:home');
  assert.ok(s.calls.includes('foreground:true'));
  // Backgrounding the App stops polling; returning resumes it
  a.appState.listeners.forEach(fn => fn('background'));
  assert.equal(s.calls.at(-1), 'foreground:false');
  a.appState.listeners.forEach(fn => fn('active'));
  assert.equal(s.calls.at(-1), 'foreground:true');
  // The resources card opens the status page, which polls faster
  a.one('Overview').onStatus(); a.render();
  assert.equal(a.page.elements('StatusScreen').length, 1);
  assert.equal(lastMode(s.calls), 'mode:status');
  assert.equal(a.one('StatusScreen').initialTab, undefined);
  a.one('StatusScreen').onBack(); a.render();
  assert.equal(lastMode(s.calls), 'mode:home');
  // The storage section opens the status page at its drives
  a.one('Overview').onStorage(); a.render();
  assert.equal(a.one('StatusScreen').initialTab, 'drives');
  assert.equal(lastMode(s.calls), 'mode:status');
  a.one('StatusScreen').onBack(); a.render();
  // The notifications tab loads the catalog for the phone's language
  a.tabBar().onChange('notifications'); a.render();
  assert.ok(s.calls.includes('strings:enu'));
  const list = a.one('Notifications');
  list.onRead([7]); list.onReadAll(); list.onMore();
  assert.deepEqual(s.calls.slice(-3), ['read:7', 'readAll', 'more']);
  assert.equal(lastMode(s.calls), 'mode:notifications');
  // Away from the overview only notifications poll, for the tab badge
  a.tabBar().onChange('apps'); a.render();
  assert.equal(lastMode(s.calls), 'mode:notifications');
  // Pull to refresh on the Apps tab refreshes the status too
  s.calls.length = 0; a.one('AppsTab').onRefresh();
  assert.ok(s.calls.includes('refresh'));
  // An open App stops polling
  a.one('AppsTab').onOpen(a.nasApps[0]); a.render();
  assert.equal(lastMode(s.calls), 'mode:off');
});
test('app: the notifications tab shows the unread count', async () => {
  const a = app(); a.status.unread = 3; a.render(); await flush(); a.render();
  assert.equal(a.tabBar().tabs.find((tab: any) => tab.key === 'notifications').count, '3');
  a.status.unread = 0; a.render();
  assert.equal(a.tabBar().tabs.find((tab: any) => tab.key === 'notifications').count, undefined);
});
test('app: a signed-out NAS selects no account scope', async () => {
  const a = app(); a.signOut(); a.render(); await flush(); a.render();
  assert.ok(a.status.calls.includes('select:nas:'));
  assert.equal(lastMode(a.status.calls), 'mode:off');
  assert.equal(a.one('Overview').status, undefined);
  assert.equal(a.page.elements('Notifications').length, 0, 'the notifications tab asks to sign in');
});
test('manage NAS: adding a NAS is the top bar + alone', () => {
  const d = detail(); const calls: string[] = [];
  d.page.render('Devices', { profiles: [profile], active: profile.id, signedIn: () => true, onOpen() {}, onActions() {}, onAdd: () => calls.push('add'), onScan() {}, onBack() {} });
  assert.equal(d.page.elements('Row').filter(e => e.props.label === t.addNas).length, 0);
  assert.ok(d.page.elements('Row').some(e => e.props.label === t.scanQr));
  const add = d.page.elements('TopBar')[0].props.right.props;
  assert.equal(add.label, t.addNas); add.onPress();
  assert.deepEqual(calls, ['add']);
});

test('app (browser build): the switcher lists this NAS, then the NAS it links to; picking one opens its launcher', async () => {
  const calls: string[] = [];
  let links = [
    { origin: 'https://nas.example.com:5001', name: 'NAS', launcher: 'https://nas.example.com:5001/m/index.html', at: 1 },
    { origin: 'https://b.example', name: 'B', launcher: 'https://b.example/m/index.html', at: 2, reachable: true, seen: 5 },
    { origin: 'https://c.example', name: 'C', launcher: 'https://c.example/m/index.html', at: 3, removed: true },
    { origin: 'https://d.example', name: 'D', launcher: 'https://d.example/m/index.html', at: 4 },
  ];
  const remote = {
    self: 'https://nas.example.com:5001', subscribe: () => () => {}, getState: () => ({ links, checking: ['https://d.example'] }),
    check: () => calls.push('check'), switchTo: (origin: string) => calls.push(`switch:${origin}`), remove: (origin: string) => { calls.push(`remove:${origin}`); links = links.filter(l => l.origin !== origin); },
  };
  const a = app({ web: true, remote }); a.render(); await flush(); a.render();
  a.one('Overview').onSwitch(); a.render();
  assert.deepEqual(calls, ['check'], 'opening the switcher checks the other NAS in the background');
  const sheet = a.one('DeviceSheet');
  assert.equal(sheet.visible, true);
  assert.equal(sheet.onManage, undefined, 'no NAS pages in the browser build');
  assert.deepEqual([...sheet.profiles.map((p: { id: string }) => p.id)], ['nas', 'https://b.example', 'https://d.example'], 'removed NAS are left out; this NAS is its live profile');
  assert.equal(sheet.describe(sheet.profiles[0]), undefined, 'this NAS keeps its sign-in and status line');
  assert.equal(sheet.describe(sheet.profiles[1]).text, `${t.nasReachable} · now`);
  assert.equal(sheet.describe(sheet.profiles[2]).text, t.checking);
  sheet.onSelect('nas'); a.render();
  assert.deepEqual(calls, ['check'], 'picking this NAS only closes the sheet');
  a.one('Overview').onSwitch(); a.render();
  a.one('DeviceSheet').onSelect('https://b.example'); a.render();
  assert.equal(calls.at(-1), 'switch:https://b.example');
  assert.equal(a.one('DeviceSheet').visible, true, 'the sheet stays: closing it would walk the history back and cancel the navigation');
  a.one('DeviceSheet').onClose(); a.render();
  // Remove asks first, then reopens the switcher
  a.one('Overview').onSwitch(); a.render();
  a.one('DeviceSheet').onRemove('https://d.example'); a.render();
  const confirm = a.page.elements('ConfirmSheet').find(e => e.props.visible)!.props;
  assert.equal(confirm.detail, 'https://d.example');
  confirm.onConfirm(); a.render();
  assert.equal(calls.at(-1), 'remove:https://d.example');
  assert.equal(a.one('DeviceSheet').visible, true);
  // Add NAS opens the address sheet; a found NAS shows in the switcher
  a.one('DeviceSheet').onAdd(); a.render();
  assert.equal(a.one('AddRemote').visible, true);
  a.one('AddRemote').onAdded('https://e.example'); a.render();
  assert.equal(a.one('AddRemote').visible, false);
  assert.equal(a.one('DeviceSheet').visible, true);
});

test('app (browser build): a NAS without a launcher carries a small mark and opens its DSM, closing the switcher', async () => {
  const calls: string[] = [];
  const links = [
    { origin: 'https://nas.example.com:5001', name: 'NAS', launcher: 'https://nas.example.com:5001/m/index.html', at: 1 },
    { origin: 'https://b.example', name: 'B', launcher: 'https://b.example/m/index.html', at: 2, reachable: true, seen: 5 },
    { origin: 'https://f.example', name: 'F', launcher: 'https://f.example/m/index.html', at: 3, reachable: true, seen: 5, dsm: true },
  ];
  const remote = {
    self: 'https://nas.example.com:5001', subscribe: () => () => {}, getState: () => ({ links, checking: [] }), check() {}, remove() {},
    // Only a launcher navigates this page away; a DSM-only NAS opens in a new tab
    switchTo: (origin: string) => { calls.push(`switch:${origin}`); return !links.find(l => l.origin === origin)?.dsm; },
  };
  const a = app({ web: true, remote }); a.render(); await flush(); a.render();
  a.one('Overview').onSwitch(); a.render();
  const sheet = a.one('DeviceSheet');
  assert.equal(sheet.describe(sheet.profiles[1]).badge, undefined, 'a NAS with a launcher has no mark');
  assert.deepEqual(plain(sheet.describe(sheet.profiles[2]).badge), { icon: 'open-in-new', label: t.dsmOnly });
  assert.equal(sheet.describe(sheet.profiles[2]).text, `${t.nasReachable} · now`, 'reachability shows as for any NAS');
  sheet.onSelect('https://f.example'); a.render();
  assert.equal(calls.at(-1), 'switch:https://f.example');
  assert.equal(a.one('DeviceSheet').visible, false, 'this page stays, so the switcher closes');
});

function addRemoteSheet(find: (input: string) => Promise<unknown>) {
  const calls: string[] = [];
  const added: unknown[] = [];
  const listeners = new Map<string, () => void>();
  const target = { addEventListener: (name: string, fn: () => void) => listeners.set(name, fn), removeEventListener: (name: string) => listeners.delete(name) };
  const doc = { ...target, visibilityState: 'visible' };
  const page = component('variants/land/AddRemote.tsx', {
    'react-native': Object.fromEntries(['View', 'Text', 'TextInput', 'ActivityIndicator'].map(n => [n, n])),
    '../../src/core/profiles/nas-links': { hostOf: (url: string) => new URL(url).host }, '../../src/core/i18n/strings': i18n,
    './ui': uiStub, './theme': themeStub,
  }, { document: doc, window: target, AbortController });
  const remote = {
    self: 'https://nas.example.com:5001', getState: () => ({ links: [{ origin: 'https://nas.example.com:5001', launcher: 'https://nas.example.com:5001/m/index.html' }] }),
    find: (input: string) => { calls.push(`find:${input}`); return find(input); },
    add: (link: unknown) => added.push(plain(link)), openDsm: (origin: string) => calls.push(`open:${origin}`),
  };
  const onAdded = (origin: string) => calls.push(`added:${origin}`);
  const render = () => page.render('AddRemote', { visible: true, remote, onAdded, onClose() {} });
  const type = async (value: string) => { render(); page.elements('TextField')[0].props.onChangeText(value); render(); page.elements('PrimaryButton')[0].props.onPress(); await flush(); render(); };
  const button = (type: string, title: string) => { const found = page.elements(type).find(e => e.props.title === title); assert.ok(found, title); return found.props; };
  return { page, render, type, button, calls, added, doc, listeners };
}

test('add NAS (browser): a NAS without a launcher is added, not blocked, and switching opens its DSM', async () => {
  const s = addRemoteSheet(async () => ({ kind: 'noLauncher', origin: 'https://10.0.0.9:5001' }));
  await s.type('10.0.0.9:5001');
  const banner = s.page.elements('Banner')[0].props;
  assert.equal(banner.tone, 'info', 'a NAS without Connect is not a warning');
  assert.equal(banner.title, fill(t.noLauncherTitle, { host: '10.0.0.9:5001' }));
  s.button('PrimaryButton', t.addToList).onPress();
  assert.deepEqual(s.added, [{ origin: 'https://10.0.0.9:5001', launcher: 'https://10.0.0.9:5001/m/index.html', name: '10.0.0.9:5001', dsm: true }]);
  assert.equal(s.calls.at(-1), 'added:https://10.0.0.9:5001');
});

test('add NAS (browser): nothing answered, so Open DSM lets the user accept the certificate and coming back checks again', async () => {
  let answer: unknown = { kind: 'unreachable', origin: 'https://10.0.0.9:5001' };
  const s = addRemoteSheet(async () => answer);
  await s.type('10.0.0.9:5001');
  assert.equal(s.page.elements('Banner')[0].props.detail, t.webTimeoutDetail);
  // Returning to the page before Open DSM does not check again
  s.listeners.get('visibilitychange')!(); await flush();
  assert.equal(s.calls.filter(c => c.startsWith('find:')).length, 1);
  s.button('PrimaryButton', fill(t.openInTab, { origin: 'https://10.0.0.9:5001' })).onPress();
  assert.equal(s.calls.at(-1), 'open:https://10.0.0.9:5001');
  // Hidden while the DSM tab is open: no check yet
  s.doc.visibilityState = 'hidden'; s.listeners.get('visibilitychange')!(); await flush();
  assert.equal(s.calls.filter(c => c.startsWith('find:')).length, 1);
  answer = { kind: 'noLauncher', origin: 'https://10.0.0.9:5001' };
  s.doc.visibilityState = 'visible'; s.listeners.get('visibilitychange')!(); s.listeners.get('focus')!(); await flush(); s.render();
  assert.equal(s.calls.filter(c => c.startsWith('find:')).length, 2, 'one check on return, even when focus also fires');
  assert.equal(s.page.elements('Banner')[0].props.title, fill(t.noLauncherTitle, { host: '10.0.0.9:5001' }));
  // Retry checks on request; Add anyway keeps it, marked DSM-only and not reachable yet
  answer = { kind: 'unreachable', origin: 'https://10.0.0.9:5001' };
  await s.type('10.0.0.9:5001');
  s.button('TextButton', t.retry).onPress(); await flush(); s.render();
  assert.equal(s.calls.filter(c => c.startsWith('find:')).length, 4);
  s.button('TextButton', t.addAnyway).onPress();
  assert.deepEqual(s.added, [{ origin: 'https://10.0.0.9:5001', launcher: 'https://10.0.0.9:5001/m/index.html', name: '10.0.0.9:5001', dsm: true, unanswered: true }]);
});

test('add NAS (browser): a certificate the browser refused is named as such, with the address to open and accept', async () => {
  const s = addRemoteSheet(async () => ({ kind: 'unreachable', origin: 'https://10.0.0.9:5001', certificate: true }));
  await s.type('10.0.0.9');
  const banner = s.page.elements('Banner')[0].props;
  assert.equal(banner.title, fill(t.webCertTitle, { host: '10.0.0.9:5001' }));
  assert.equal(banner.detail, t.webCertDetail);
  s.button('PrimaryButton', fill(t.openInTab, { origin: 'https://10.0.0.9:5001' })).onPress();
  assert.equal(s.calls.at(-1), 'open:https://10.0.0.9:5001');
  s.button('TextButton', t.retry);
});

test('add NAS (browser): the copy never makes Connect a requirement', () => {
  for (const [name, table] of Object.entries(locales)) {
    for (const key of ['webAddressHint', 'noLauncherTitle', 'noLauncherDetail', 'webCertDetail', 'webTimeoutDetail', 'webMixedDetail', 'webQcDetail'] as const) {
      assert.doesNotMatch(table[key], /Connect|遠端網域|远程域名/, `${name}.${key}`);
    }
  }
});

test('add NAS: the browser sheet never invites a QuickConnect ID, which a browser cannot use; the App still does', () => {
  // A browser page cannot ask QuickConnect's directory (no CORS), so its placeholder offers only an address
  const page = component('variants/land/AddRemote.tsx', {
    'react-native': Object.fromEntries(['View', 'Text', 'TextInput', 'ActivityIndicator'].map(n => [n, n])),
    '../../src/core/profiles/nas-links': { hostOf: (url: string) => url }, '../../src/core/i18n/strings': i18n,
    './ui': uiStub, './theme': themeStub,
  });
  page.render('AddRemote', { visible: true, remote: { find: async () => ({ kind: 'invalid' }) }, onAdded() {}, onClose() {} });
  assert.equal(page.elements('TextField')[0].props.placeholder, t.webAddressPlaceholder);
  for (const [name, table] of Object.entries(locales)) {
    assert.ok(table.webAddressPlaceholder, `${name}.webAddressPlaceholder`);
    assert.doesNotMatch(table.webAddressPlaceholder, /QuickConnect/i, name);
    assert.match(table.addressPlaceholder, /QuickConnect/, `${name}: the App keeps the ID in its placeholder`);
  }
  const s = addScreen({});
  s.render();
  assert.equal(s.page.elements('TextField').find(e => e.props.keyboardType === 'url')?.props.placeholder, t.addressPlaceholder);
});
