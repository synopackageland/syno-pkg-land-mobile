import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { component } from './component.ts';
import { causeText, fill, locales } from '../src/core/i18n/strings.ts';
import * as status from '../src/core/status/model.ts';
import * as mappers from '../src/core/status/mappers.ts';
import * as format from '../src/core/status/format.ts';
import * as statusStringsModule from '../src/core/i18n/status-strings.ts';
import * as attention from '../src/core/status/attention.ts';
import * as modules from '../src/core/status/modules/index.ts';
import * as security from '../src/core/status/modules/security.ts';
import * as history from '../src/core/status/modules/history.ts';
import * as summaryModule from '../src/core/status/storage-summary.ts';
import * as live from '../src/core/status/live.ts';
import * as calm from '../src/core/status/calm.ts';
import type { StatusState, StatusSnapshot } from '../src/core/status/model.ts';

const t = locales.en;
const nas = JSON.parse(readFileSync('tests/fixtures/status/nas.json', 'utf8'));
const plain = (value: unknown) => JSON.parse(JSON.stringify(value));
const native = Object.fromEntries(['View', 'Text', 'Pressable', 'ScrollView', 'FlatList', 'RefreshControl', 'ActivityIndicator'].map(n => [n, n]));
const parts = { ...Object.fromEntries(['Gauge', 'RingValue', 'Tile', 'Ring', 'Bars', 'Meter', 'Stat', 'CapacityTile', 'BigStat', 'InlineAction', 'Dot', 'SectionTitle', 'Segments', 'Spark', 'LiveSpark', 'ReadoutText'].map(n => [n, n])) };
const ui = { ...Object.fromEntries(['Icon', 'IconButton', 'Row', 'Separator', 'Sheet', 'TopBar', 'Skeleton', 'EmptyState', 'TextButton'].map(n => [n, n])), useBarInsets: () => ({ top: 44, bottom: 52, rawBottom: 0 }) };
const proxy = (value: unknown) => new Proxy({}, { get: () => value });
const theme = { colors: proxy('#000'), chart: proxy('#111'), radius: proxy(8), spacing: proxy(8), layout: { topBar: 44, tabBar: 52, hit: 44, gutter: 16, appIcon: 52 }, type: proxy({}) };
const libs = {
  'react-native': native, './StatusParts': parts, './ui': ui, './theme': theme,
  '../../src/core/i18n/strings': { fill }, '../../src/core/status/model': status, '../../src/core/status/mappers': mappers, '../../src/core/status/format': format,
  '../../src/core/i18n/status-strings': statusStringsModule, '../../src/core/status/attention': attention, '../../src/core/status/modules': modules,
  '../../src/core/status/modules/security': security, '../../src/core/status/modules/history': history,
  '../../src/core/status/storage-summary': summaryModule, '../../src/core/status/live': live,
  '../../src/core/status/calm': calm,
};
const st = statusStringsModule.statusStrings(t);
/** The tree of a hook-free inner component, by calling it */
const inner = (element: { type: unknown; props: unknown }) => (element.type as (props: unknown) => unknown)(element.props);
/** Elements of a type in a tree, including trees returned by calling hook-free inner components */
function find(node: any, name: string, found: any[] = []): any[] {
  if (!node) return found;
  if (Array.isArray(node)) { node.forEach(n => find(n, name, found)); return found; }
  if (node.type === name || (typeof node.type === 'function' && node.type.name === name)) found.push(node);
  if (node.props) find(node.props.children, name, found);
  return found;
}
const profile = { id: 'nas', name: 'Vault', origin: 'https://192.168.1.20:5001' };
const now = 1_800_000_000_000;
function snapshotOf(account: 'admin' | 'normal'): StatusSnapshot {
  const times = { util: now, health: now, overview: now, storage: now };
  return account === 'admin'
    ? { scope: 's', times, denied: [], util: mappers.mapUtilization(nas.util), overview: mappers.mapOverview(nas.overview), health: mappers.mapHealth(nas.health), volumes: mappers.mapStorage(nas.storage) }
    : { scope: 's', times: { health: now }, denied: ['util', 'overview', 'storage'], health: mappers.mapHealth(nas.health) };
}
const stateOf = (snapshot?: StatusSnapshot, extra: Partial<StatusState> = {}): StatusState => ({ snapshot, live: [], historyLoading: false, read: { before: 0, ids: [] }, refreshing: false, signedOut: false, loadingMore: false, ...extra });
const texts = (node: unknown): string => JSON.stringify(node);

test('home cards: administrators get CPU and memory with sparklines and tiles; normal users only what DSM gives them', () => {
  const cards = component('variants/land/HomeCards.tsx', libs);
  const live = { live: ['util', 'health', 'overview', 'storage'] as status.Item[] };
  const admin = cards.render('ResourceCard', { state: stateOf(snapshotOf('admin'), live), t, locale: 'en', now, onStatus() {} });
  assert.deepEqual(plain(cards.elements('BigStat').map(g => g.props.label)), [t.cpu, t.memory]);
  // Both read the same way: the percentage as the big value; memory adds used / total beside it
  const memory = cards.elements('BigStat')[1].props, mem = snapshotOf('admin').util!.memory!;
  assert.equal(memory.value, `${Math.round(mem.percent)}%`);
  assert.match(memory.sub, /^[\d.]+ \/ [\d.]+ (GB|MB|TB)$|^[\d.]+ (GB|MB|TB) \/ [\d.]+ (GB|MB|TB)$/);
  assert.equal(memory.max, 100);
  // The numbers count calmly to each sample through the shared percent readout; the sparkline gets one unbroken line, not values with breaks
  assert.equal(memory.amount, mem.percent);
  assert.equal(memory.readout, calm.readouts.percent);
  assert.equal(memory.readout.text(34.6), '35%');
  assert.ok(Array.isArray(memory.points) && !('breaks' in memory) && !('values' in memory));
  const network = cards.elements('Tile')[0].props.lines;
  assert.ok(network.every((line: { amount?: number; readout?: unknown }) => typeof line.amount === 'number' && line.readout === calm.readouts.rate));
  // The third tile is storage for administrators; temperature leaves the home card
  assert.deepEqual(plain(cards.elements('Tile').map(g => g.props.title)), [t.network, t.drives]);
  assert.equal(cards.elements('StorageTile').length, 1);
  const shown = () => JSON.stringify(cards.elements('Text').map(e => e.props.children));
  assert.ok(!shown().includes('°C'));
  assert.ok(admin && !shown().includes(st.justNow), 'live values show no age');
  // The overview lists volumes in their own section: then the third tile is the temperature
  cards.render('ResourceCard', { state: stateOf(snapshotOf('admin'), live), t, locale: 'en', now, onStatus() {}, storage: false });
  assert.equal(cards.elements('StorageTile').length, 0);
  assert.deepEqual(plain(cards.elements('Tile').map(g => g.props.title)), [t.network, t.drives, t.temperature]);
  // Normal users have no storage data: temperature keeps the slot
  const normal = cards.render('ResourceCard', { state: stateOf(snapshotOf('normal')), t, locale: 'en', now, onStatus() {} });
  assert.equal(cards.elements('BigStat').length, 0);
  assert.equal(cards.elements('StorageTile').length, 0);
  assert.deepEqual(plain(cards.elements('Tile').map(g => g.props.title)), [t.temperature]);
  assert.ok(texts(normal).includes('42 °C'));
  // Nothing allowed and nothing known: no card, no error
  assert.equal(cards.render('ResourceCard', { state: stateOf({ scope: 's', times: {}, denied: ['util', 'overview', 'health'] }), t, locale: 'en', now, onStatus() {} }), null);
  // Before the first answer: placeholders, not a blocking spinner
  cards.render('ResourceCard', { state: stateOf({ scope: 's', times: {}, denied: [] }, { refreshing: true }), t, locale: 'en', now, onStatus() {} });
  assert.equal(cards.elements('Skeleton').length, 2);
  // Old values carry their age; cached values not answered in this run and a failed refresh do too
  const stale = cards.render('ResourceCard', { state: stateOf(snapshotOf('admin'), live), t, locale: 'en', now: now + 120_000, onStatus() {} });
  assert.ok(texts(stale).includes(st.minutesAgo.replace('{count}', '2')));
  const cached = cards.render('ResourceCard', { state: stateOf(snapshotOf('admin')), t, locale: 'en', now, onStatus() {} });
  assert.ok(texts(cached).includes(st.justNow));
  const failed = cards.render('ResourceCard', { state: stateOf(snapshotOf('admin'), { ...live, error: 'timeout' }), t, locale: 'en', now, onStatus() {} });
  assert.ok(texts(failed).includes(st.justNow));
});
test('home: one status line with model, DSM version and uptime; the age only when not live', () => {
  const cards = component('variants/land/HomeCards.tsx', libs);
  const snapshot = { ...snapshotOf('admin'), user: { user: 'a', dsm: '7.4.1', update: 1 } };
  const line = cards.render('NasLine', { state: stateOf(snapshot, { live: ['health'] }), t, now, locale: 'en' });
  const text = line.props.children as string;
  assert.ok(text.startsWith('RS822+ · DSM 7.4.1 Update 1 · '), text);
  assert.ok(text.includes(fill(st.upFor, { time: '' }).trim()));
  // One quiet line; the uptime keeps only its largest unit
  assert.equal(line.props.numberOfLines, 1);
  assert.match(text.split(' · ')[2], /^up \d+ (d|h|min)$/);
  assert.ok(!text.endsWith(st.justNow));
  assert.ok((cards.render('NasLine', { state: stateOf(snapshot), t, now, locale: 'en' }).props.children as string).endsWith(st.justNow));
  assert.equal(cards.render('NasLine', { state: stateOf({ scope: 's', times: {}, denied: [] }), t, now, locale: 'en' }), null);
});
const GB = 1024 ** 3, TB = 1024 ** 4;
const vol = (name: string, used: number, total: number, extra: Partial<mappers.Volume> = {}): mappers.Volume => ({ id: name, name, used, total, status: 'normal', ...extra });
const withVolumes = (volumes: mappers.Volume[]): StatusSnapshot => ({ ...snapshotOf('admin'), volumes });
// Colours resolve to their token names so the tile's tone can be checked
type Storage = { volume: mappers.Volume; percent: number; others: number };
const storageOf = (cards: ReturnType<typeof component>, snapshot: StatusSnapshot) => cards.render('storageOf', snapshot) as unknown as Storage | undefined;
const named = { ...libs, './theme': { ...theme, colors: new Proxy({}, { get: (_, key) => String(key) }) } };
test('storage tile: one volume shows used %, used / total and a bar, no name and no badge', () => {
  const cards = component('variants/land/HomeCards.tsx', named);
  const storage = storageOf(cards, withVolumes([vol('volume1', 1.2 * TB, 3.5 * TB)]))!;
  assert.equal(storage.volume.name, 'volume1'); assert.equal(storage.others, 0);
  cards.render('StorageTile', { storage, t, onPress() {} });
  const tile = cards.elements('CapacityTile')[0].props;
  assert.equal(tile.title, t.storage);
  assert.equal(tile.value, '34%');
  assert.equal(tile.detail, '1.2 / 3.5 TB');
  assert.equal(tile.note, undefined); assert.equal(tile.badge, undefined);
  assert.equal(Math.round(tile.fill), 34);
  assert.equal(tile.color, 'accent'); assert.equal(tile.tone, undefined);
  // The bar and value turn warning from 80 % and danger from 90 %
  const at = (p: number) => { cards.render('StorageTile', { storage: storageOf(cards, withVolumes([vol('v', p * GB, 100 * GB)])), t, onPress() {} }); return cards.elements('CapacityTile')[0].props; };
  assert.equal(at(79).color, 'accent');
  assert.deepEqual([at(80).color, at(80).tone], ['warning', 'warning']);
  assert.deepEqual([at(90).color, at(90).tone], ['danger', 'danger']);
});
test('storage tile: with several volumes the fullest wins and names itself, "+N" counts the rest', () => {
  const cards = component('variants/land/HomeCards.tsx', named);
  const storage = storageOf(cards, withVolumes([vol('volume1', 1 * TB, 3.5 * TB), vol('volume2', 3.1 * TB, 3.5 * TB), vol('volume3', 100 * GB, 200 * GB)]))!;
  assert.equal(storage.volume.name, 'volume2'); assert.equal(storage.others, 2);
  cards.render('StorageTile', { storage, t, onPress() {} });
  const tile = cards.elements('CapacityTile')[0].props;
  assert.equal(tile.value, '89%'); assert.equal(tile.note, 'volume2'); assert.equal(tile.detail, '3.1 / 3.5 TB'); assert.equal(tile.badge, '+2');
  assert.match(tile.label, /volume2/); assert.ok(tile.label.includes(fill(t.moreVolumes, { count: 2 })));
  // A smaller volume that is fuller in percent wins over a bigger one with more bytes used
  assert.equal(storageOf(cards, withVolumes([vol('big', 5 * TB, 10 * TB), vol('small', 95 * GB, 100 * GB)]))!.volume.name, 'small');
  // No volumes: no storage tile data
  assert.equal(storageOf(cards, withVolumes([])), undefined);
  assert.equal(storageOf(cards, snapshotOf('normal')), undefined);
});
test('storage tile: a crashed, degraded or read-only volume wins over the fullest and shows its state in danger colour', () => {
  const cards = component('variants/land/HomeCards.tsx', named);
  const full = vol('volume1', 99 * GB, 100 * GB);
  const readonly = vol('volume2', 10 * GB, 100 * GB, { status: 'warning', state: 'readonly' });
  const degraded = vol('volume3', 20 * GB, 100 * GB, { status: 'warning', state: 'degraded' });
  const crashed = vol('volume4', 5 * GB, 100 * GB, { status: 'danger', state: 'crashed' });
  assert.equal(storageOf(cards, withVolumes([full, readonly]))!.volume.name, 'volume2');
  assert.equal(storageOf(cards, withVolumes([full, readonly, degraded]))!.volume.name, 'volume3');
  const storage = storageOf(cards, withVolumes([full, readonly, degraded, crashed]))!;
  assert.equal(storage.volume.name, 'volume4');
  cards.render('StorageTile', { storage, t, onPress() {} });
  const tile = cards.elements('CapacityTile')[0].props;
  assert.equal(tile.value, t.vol_crashed); assert.equal(tile.tone, 'danger'); assert.equal(tile.color, 'danger');
  assert.equal(tile.note, 'volume4'); assert.equal(tile.badge, '+3');
  // One read-only volume alone also shows its state rather than a percentage
  cards.render('StorageTile', { storage: storageOf(cards, withVolumes([readonly])), t, onPress() {} });
  assert.deepEqual([cards.elements('CapacityTile')[0].props.value, cards.elements('CapacityTile')[0].props.tone], [t.vol_readonly, 'danger']);
  // The NAS card's health dot turns danger too
  cards.render('NasCard', { profile, state: stateOf(withVolumes([crashed])), t, onStatus() {}, onSwitch() {}, healthy: true });
  assert.ok(texts(cards.render('NasCard', { profile, state: stateOf(withVolumes([crashed])), t, onStatus() {}, onSwitch() {}, healthy: true })).includes('"backgroundColor":"danger"'));
});
test('storage tile: tapping opens the storage section, not the general status', () => {
  const cards = component('variants/land/HomeCards.tsx', libs);
  const calls: string[] = [];
  cards.render('ResourceCard', { state: stateOf(snapshotOf('admin')), t, locale: 'en', now, onStatus: () => calls.push('status'), onStorage: () => calls.push('storage') });
  cards.elements('StorageTile')[0].props.onPress();
  assert.deepEqual(calls, ['storage']);
});
test('home cards: the NAS card shows connection and model, switches NAS from the name and opens status elsewhere', () => {
  const cards = component('variants/land/HomeCards.tsx', libs);
  const calls: string[] = [];
  const card = cards.render('NasCard', { profile, state: stateOf(snapshotOf('normal')), t, healthy: true, onStatus: () => calls.push('status'), onSwitch: () => calls.push('switch') });
  assert.ok(texts(card).includes(`${t.kind_lan} · RS822+`));
  card.props.onPress();
  cards.elements('Pressable').find(p => p.props.accessibilityLabel === t.switchNas)!.props.onPress();
  assert.deepEqual(calls, ['status', 'switch']);
  const conn = (origin: string, kind?: string) => cards.render('NasCard', { profile: { ...profile, origin, kind }, state: stateOf(), t, healthy: true, onStatus() {}, onSwitch() {} });
  assert.ok(texts(conn('https://nas.example.com:5001')).includes(t.conn_internet));
  assert.ok(texts(conn('https://x.quickconnect.to')).includes(t.conn_quickconnect));
  assert.ok(texts(conn('https://nas.example.com', 'netbird')).includes(t.kind_netbird));
});
test('status detail: one page of sections that open detail pages; back returns to the sections first', () => {
  const homeCards = { ageOf: () => undefined, NasLine: 'NasLine', OfflineLine: 'OfflineLine', temperatureOf: () => ({ value: 42, warning: false }), trendOf: () => [] };
  const glance = Object.fromEntries(['AttentionBlock', 'BackupSection', 'DiskRows', 'FallbackRow', 'OpenInDsm', 'SecuritySection', 'StorageSection'].map(n => [n, n]));
  const back: (() => boolean)[] = [];
  const reactNative = { ...native, BackHandler: { addEventListener: (_: string, fn: () => boolean) => { back.push(fn); return { remove() { back.splice(back.indexOf(fn), 1); } }; } } };
  const make = () => component('variants/land/Status.tsx', { ...libs, 'react-native': reactNative, './HomeCards': homeCards, './Glance': glance });
  const calls: string[] = [];
  const props = { profile, t, locale: 'en', now, onBack: () => calls.push('back'), onRefresh() {} };
  const screen = make();
  const render = (account: 'admin' | 'normal' = 'admin', extra = {}) => screen.render('StatusScreen', { ...props, state: stateOf(snapshotOf(account)), ...extra });
  render();
  assert.equal(screen.elements('TopBar')[0].props.title, 'Vault');
  const sections = screen.elements('Sections')[0];
  assert.ok(sections, 'the sections page');
  // Sections has no hooks: its tree can be read by calling it
  const tree = inner(sections);
  assert.deepEqual(plain(find(tree, 'BigStat').map((b: any) => b.props.label)), [t.cpu, t.memory, `↑ ${t.upload}`, `↓ ${t.download}`]);
  assert.deepEqual(['NasLine', 'AttentionBlock', 'StorageSection', 'SecuritySection', 'BackupSection'].map(name => find(tree, name).length), [1, 1, 1, 1, 1]);
  // Drives are part of the storage summary, not a list of their own
  assert.equal(find(tree, 'DiskRows').length, 0); assert.equal(find(tree, 'StorageSection')[0].props.full, undefined);
  assert.ok(texts(find(tree, 'Stat')).includes('42 °C'));
  // A section opens its page; back returns to the sections, then leaves
  find(tree, 'BigStat')[0].props.onPress(); render();
  assert.equal(screen.elements('TopBar')[0].props.title, t.cpu);
  assert.equal(screen.elements('ResourcePage')[0].props.kind, 'cpu');
  // The hardware back key closes the page too
  assert.equal(back.length, 1); assert.equal(back[0](), true); render();
  assert.equal(screen.elements('Sections').length, 1);
  assert.equal(back.length, 0, 'the sections leave hardware back to the tab stack');
  find(inner(screen.elements('Sections')[0]), 'BigStat')[2].props.onPress(); render();
  assert.equal(screen.elements('TopBar')[0].props.title, t.network);
  screen.elements('TopBar')[0].props.left.props.onPress(); render();
  assert.equal(screen.elements('Sections').length, 1);
  assert.deepEqual(calls, []);
  screen.elements('TopBar')[0].props.left.props.onPress();
  assert.deepEqual(calls, ['back']);
  // A normal user: no resources, the drives and the rest of what DSM gives
  const normal = make();
  normal.render('StatusScreen', { ...props, state: stateOf(snapshotOf('normal')) });
  const own = normal.elements('Sections')[0];
  const ownTree = inner(own);
  assert.equal(find(ownTree, 'BigStat').length, 0);
  assert.equal(find(ownTree, 'StorageSection').length, 1);
  // The home storage tile opens the storage page with drives
  const storage = make();
  storage.render('StatusScreen', { ...props, state: stateOf(snapshotOf('admin')), initialTab: 'drives' });
  assert.equal(storage.elements('TopBar')[0].props.title, t.storage);
  assert.equal(storage.elements('StorageSection')[0].props.full, true);
});
test('drives: one line with model, size, temperature and status; the detail keeps reads and writes', () => {
  const glance = component('variants/land/Glance.tsx', { ...libs, './HomeCards': { capacityColor: () => '#000', volumePercent: () => 50 } });
  const admin = snapshotOf('admin'), disk = admin.health!.disks[0];
  const row = glance.render('DiskRow', { disk, t });
  assert.ok(texts(row).includes('HDN724040ALE640 · 3.6 TB'));
  assert.ok(texts(row).includes('42 °C'));
  assert.ok(texts(row).includes(t.disk_normal));
  assert.ok(!texts(row).includes('KB/s'), 'reads and writes stay in the detail');
  const opened: { id: string }[] = [];
  const list = glance.render('DiskRows', { state: stateOf(snapshotOf('normal')), t, onDisk: (d: { id: string }) => opened.push(d) });
  find(inner(list), 'DiskRow')[0].props.onPress();
  assert.equal(opened[0].id, 'sata1');
  const screen = component('variants/land/Status.tsx', { ...libs, 'react-native': { ...native, BackHandler: { addEventListener: () => ({ remove() {} }) } }, './HomeCards': {}, './Glance': {} });
  const sheet = screen.render('DiskSheet', { disk: opened[0], state: stateOf(snapshotOf('normal')), t, onClose() {} });
  assert.equal(sheet.props.visible, true);
  assert.ok(texts(sheet).includes('HDN724040ALE640'));
  assert.ok(texts(sheet).includes(t.disk_normal));
  assert.ok(!texts(sheet).includes(t.busy), 'no activity without utilization');
  const full = screen.render('DiskSheet', { disk: opened[0], state: stateOf(admin), t, onClose() {} });
  assert.ok(texts(full).includes('42.7 KB/s'));
});
test('notifications: New and Earlier around the read mark, repeats on a day collapse into one row (×N), tap marks the whole row read', () => {
  const page = component('variants/land/Notifications.tsx', { ...libs, './HomeCards': { OfflineLine: 'OfflineLine' } });
  const calls: string[] = [];
  const notices = mappers.mapNotifications(nas.notify);
  const snapshot: StatusSnapshot = { scope: 's', times: {}, denied: [], notices, lastRead: mappers.mapLastRead(nas.lastRead) };
  const apps = [{ id: 'SYNO.SDS.ContainerManager.Application', name: 'Container Manager' }];
  const props = { t, locale: 'en', now: notices.newest * 1000 + 3_600_000, apps, onRefresh: () => { calls.push('refresh'); }, onMore: () => calls.push('more'), onRead: (ids: number[]) => calls.push(`read:${ids.join(',')}`), onReadAll: () => calls.push('all'), onOpenApp: (app: { name: string }) => calls.push(`open:${app.name}`) };
  const first = { ...props, state: stateOf(snapshot, { strings: mappers.mapNoticeStrings(nas.strings) }) };
  page.render('Notifications', first);
  const list = page.elements('FlatList')[0].props;
  // Two rows cannot fill the screen, so the end is never reached by scrolling: ask for older pages now
  assert.deepEqual(calls.splice(0), ['more']);
  // The fixture is one container stopping four times on one day; DSM's read mark is the third
  assert.deepEqual(plain(list.data.filter((e: any) => e.kind === 'section').map((e: any) => e.label)), [t.noticesNew, t.noticesEarlier]);
  let items = list.data.filter((e: any) => e.kind === 'item');
  assert.deepEqual(plain(items.map((e: any) => e.notices.length)), [2, 2]);
  assert.equal(items[0].notice.id, notices.items[0].id);
  assert.deepEqual(plain(items.map((e: any) => e.unread)), [true, false]);
  assert.equal(items[0].title, 'Container Manager');
  assert.equal(items[0].app.id, 'SYNO.SDS.ContainerManager.Application');
  const row = list.renderItem({ item: items[0] });
  assert.ok(texts(row).includes('×2'));
  assert.equal(texts(row).split(' · ').length, 1, 'collapsed rows list no times');
  assert.equal(find(row, 'TextButton').length, 0, 'Open in DSM only when expanded');
  row.props.onPress();
  assert.deepEqual(calls, [`read:${notices.items.slice(0, 2).map(n => n.id).join(',')}`]);
  // Expanded, the row lists every time in the run and opens the App that raised it
  page.render('Notifications', first);
  const open = page.elements('FlatList')[0].props;
  const expanded = open.renderItem({ item: open.data.find((e: any) => e.kind === 'item') });
  assert.equal(expanded.props.accessibilityState.expanded, true);
  assert.equal(texts(expanded).split(' · ').length, 2);
  const openInDsm = find(expanded, 'TextButton')[0].props;
  assert.equal(openInDsm.title, fill(t.openInDsm, { name: 'Container Manager' }));
  assert.ok(!/(\.\.\.|…|\.)$/.test(openInDsm.title));
  openInDsm.onPress();
  assert.equal(calls.at(-1), 'open:Container Manager');
  // Equal minutes merge so a burst reads as one time with a count
  const at = (time: number) => ({ ...notices.items[0], time });
  const runs = page.render('runTimes', [at(7200), at(7210), at(7220), at(60)]) as unknown as string;
  assert.equal(runs.split(' · ').length, 2);
  assert.match(runs, /^\S.* ×3 · \S/);

  // Different text breaks the row: the second notice names another container
  const mixed = { ...notices, items: notices.items.map((n, i) => i === 1 ? { ...n, params: { ...n.params, '%1%': 'app-web-1' } } : n) };
  page.render('Notifications', { ...props, state: stateOf({ ...snapshot, notices: mixed }, { strings: mappers.mapNoticeStrings(nas.strings) }) });
  items = page.elements('FlatList')[0].props.data.filter((e: any) => e.kind === 'item');
  assert.deepEqual(plain(items.map((e: any) => e.notices.length)), [1, 1, 2]);
  // Read state covers the whole row: unread while any member is unread
  assert.deepEqual(plain(items.map((e: any) => e.unread)), [true, true, false]);
  const bar = page.elements('TopBar')[0].props;
  assert.equal(bar.title, t.notifications);
  assert.equal(bar.left, undefined, 'a tab root has no back arrow');
  bar.right.props.onPress();
  assert.equal(calls.at(-1), 'all');
  list.onEndReached(); list.refreshControl.props.onRefresh();
  assert.deepEqual(calls.slice(-2), ['more', 'refresh']);
  // Filters: errors keep the rows, info leaves an empty list with its own message
  const filters = () => page.elements('FlatList')[0].props.ListHeaderComponent;
  assert.deepEqual(plain(find(filters(), 'Pressable').map((e: any) => e.props.accessibilityLabel)), [t.filterAll, t.filterErrors, t.filterWarnings, t.filterInfo]);
  find(filters(), 'Pressable')[3].props.onPress();
  page.render('Notifications', { ...props, state: stateOf(snapshot, { strings: mappers.mapNoticeStrings(nas.strings) }) });
  assert.equal(page.elements('FlatList')[0].props.data.length, 0);
  assert.equal(page.elements('FlatList')[0].props.ListEmptyComponent.props.title, t.noFilteredNotifications);
  find(filters(), 'Pressable')[1].props.onPress();
  page.render('Notifications', { ...props, state: stateOf(snapshot, { strings: mappers.mapNoticeStrings(nas.strings) }) });
  assert.equal(page.elements('FlatList')[0].props.data.filter((e: any) => e.kind === 'item').length, 2);
  // All read: no mark-all button
  page.render('Notifications', { ...props, state: stateOf(snapshot, { read: { before: notices.newest, ids: [] } }) });
  assert.equal(page.elements('TopBar')[0].props.right, null);
  // Empty list: a quiet empty state, no hint text
  page.render('Notifications', { ...props, state: stateOf({ scope: 's', times: {}, denied: [], notices: { items: [], total: 0, newest: 0 } }) });
  assert.equal(page.elements('FlatList')[0].props.ListEmptyComponent.props.title, t.noNotifications);
  assert.equal(page.elements('FlatList')[0].props.ListEmptyComponent.props.detail, undefined);
});

test('history bars: idle and tiny samples draw nothing, so no dashed baseline', () => {
  const page = component('variants/land/StatusParts.tsx', { 'react-native': native, './ui': ui, './theme': theme, './LiveSpark': { LiveSpark: 'LiveSpark' }, './motion': { useReadout: (v: number | undefined, readout: calm.Readout) => readout.text(v) } });
  const bars = page.render('Bars', { values: [0, 1, 4, 50, 100], max: 100, height: 40, count: 6, color: '#111' });
  const heights = plain(bars.props.children.map((bar: any) => bar.props.style.height));
  // One empty slot of history, then 0 %, 1 % (0.4 px) and 4 % (2 px) stay flat; 50 % and 100 % draw
  assert.deepEqual(heights, [0, 0, 0, 0, 20, 40]);
});
test('glance: the Security, Storage and Backup pages drop the title the top bar already shows; attention details wrap', () => {
  const glance = component('variants/land/Glance.tsx', { ...libs, './HomeCards': { capacityColor: () => '#000', volumePercent: () => 50 } });
  const admin = snapshotOf('admin');
  const security = { level: 'risk' as const, running: false, categories: [], issues: 2 };
  const state = stateOf({ ...admin, security });
  const titles = (tree: unknown) => find(tree, 'SectionTitle').map((e: any) => e.props.title);
  assert.deepEqual(titles(glance.render('SecuritySection', { state, t, now, locale: 'en', onPage() {} })), [st.app_security]);
  assert.deepEqual(titles(glance.render('SecuritySection', { state, t, now, locale: 'en', full: true })), []);
  // Storage and Backup pages likewise: the section title stays on the overview only
  assert.ok(titles(glance.render('StorageSection', { state, t, now, locale: 'en', onPage() {} })).includes(t.storage));
  assert.ok(!titles(glance.render('StorageSection', { state, t, now, locale: 'en', full: true })).includes(t.storage));
  const done = { tasks: [{ id: 'b', name: 'Nightly', result: 'success', last: now / 1000 - 3600, running: false }] };
  const withBackup = stateOf({ ...admin, backups: done } as never);
  assert.deepEqual(titles(glance.render('BackupSection', { state: withBackup, t, now, locale: 'en', onPage() {} })), [st.backup]);
  assert.deepEqual(titles(glance.render('BackupSection', { state: withBackup, t, now, locale: 'en', full: true })), []);
  const block = glance.render('AttentionBlock', { state, t, now, locale: 'en' });
  const detail = find(block, 'Text').find((e: any) => e.props.children === fill(st.att_security, { count: 2 }));
  assert.ok(detail, 'the security issues detail');
  assert.equal(detail.props.numberOfLines, undefined);
  // Parts wrap whole: a failed backup's time never splits from itself
  const backups = { tasks: [{ id: 't', name: 'Nightly', result: 'failed', last: now / 1000 - 86400 * 30, running: false }] };
  const parts = find(glance.render('AttentionBlock', { state: stateOf({ ...admin, backups } as never), t, now, locale: 'en' }), 'Text').map((e: any) => e.props.children);
  assert.ok(parts.includes(`${st.att_backupFailed} · `));
});

test('storage: a NAS with 24 drives and 8 volumes keeps a fixed-height summary; the storage page lists all, problems first', () => {
  const glance = component('variants/land/Glance.tsx', { ...libs, './HomeCards': { capacityColor: () => '#000', volumePercent: () => 50 } });
  const disks: mappers.Disk[] = Array.from({ length: 24 }, (_, i) => ({ id: `sata${i + 1}`, name: `Drive ${i + 1}`, order: i + 1, model: 'WD5003ABYX-01WERA1-LONG-MODEL-NAME', size: 4e12, temp: 34, ssd: false, status: 'normal' as const }));
  const volumes = Array.from({ length: 8 }, (_, i) => ({ id: `volume_${i + 1}`, name: `volume${i + 1}`, total: 1000, used: 100 * (i + 1), status: 'normal' as const, pool: i < 4 ? 'p1' : 'p2' }));
  const pools = [{ id: 'p1', order: 1, level: 'normal' as const, disks: [], volumes: [] }, { id: 'p2', order: 2, level: 'normal' as const, disks: [], volumes: [] }];
  const base = snapshotOf('admin');
  const stateWith = (d: mappers.Disk[]) => stateOf({ ...base, volumes, pools, health: { ...base.health!, disks: d } } as never);
  const pages: string[] = [];
  // All healthy: the three fullest volumes, "5 more", one drives line and no drive rows
  let tree = glance.render('StorageSection', { state: stateWith(disks), t, now, locale: 'en', onPage: (p: string) => pages.push(p) });
  assert.deepEqual(find(tree, 'VolumeRow').map((e: any) => e.props.volume.name), ['volume8', 'volume7', 'volume6']);
  assert.ok(texts(tree).includes(fill(st.moreVolumesShort, { count: 5 })));
  assert.ok(texts(tree).includes(`${fill(st.drivesCount, { count: 24 })} · ${st.drivesGood}`));
  assert.equal(find(tree, 'DiskList')[0].props.disks.length, 0);
  // Five drives with problems: the failing ones first, three rows, "2 more"
  const bad = disks.map((d, i) => i === 3 ? { ...d, status: 'danger' as const } : [1, 9, 12, 20].includes(i) ? { ...d, status: 'warning' as const } : d);
  tree = glance.render('StorageSection', { state: stateWith(bad), t, now, locale: 'en', onPage: (p: string) => pages.push(p) });
  assert.deepEqual(find(tree, 'DiskList')[0].props.disks.map((d: any) => d.id), ['sata4', 'sata2', 'sata10']);
  assert.ok(texts(tree).includes(`${fill(st.drivesCount, { count: 24 })} · ${fill(st.drivesBad, { count: 5 })}`));
  const more = find(tree, 'MoreRow').map((e: any) => e.props);
  assert.deepEqual(more.map((p: any) => p.text), [fill(st.moreVolumesShort, { count: 5 }), fill(st.moreDrives, { count: 2 })]);
  more[1].onPress(); assert.deepEqual(pages, ['storage']);
  // The storage page: every volume under its pool and every drive, problems first
  tree = glance.render('StorageSection', { state: stateWith(bad), t, now, locale: 'en', full: true });
  assert.equal(find(tree, 'VolumeRow').length, 8);
  assert.equal(find(tree, 'MoreRow').length, 0);
  const rows = inner(find(tree, 'DiskRows')[0]);
  assert.deepEqual(find(rows, 'DiskList')[0].props.disks.slice(0, 6).map((d: any) => d.id), ['sata4', 'sata2', 'sata10', 'sata13', 'sata21', 'sata1']);
  // A long model is cut off; the temperature and status keep their place
  const row = glance.render('DiskRow', { disk: bad[3], t });
  const model = find(row, 'Text').find((e: any) => String(e.props.children).includes('WD5003'));
  assert.equal(model.props.numberOfLines, 1);
  assert.ok(texts(row).includes('34 °C')); assert.ok(texts(row).includes(t.disk_danger));
});
test('storage summary: volumes with a problem come before fuller ones; counts never go negative', () => {
  const v = (name: string, used: number, extra = {}) => ({ id: name, name, total: 100, used, status: 'normal' as const, ...extra });
  const sum = summaryModule.storageSummary([v('a', 95), v('b', 10, { state: 'degraded' }), v('c', 50)], []);
  assert.deepEqual(sum.volumes.map(x => x.name), ['b', 'a', 'c']);
  assert.equal(sum.moreVolumes, 0); assert.equal(sum.disks, 0); assert.equal(sum.moreBad, 0);
});
test('big stat: the value counts through ReadoutText and the live line goes to LiveSpark', () => {
  const page = component('variants/land/StatusParts.tsx', { 'react-native': native, './ui': ui, './theme': theme, './LiveSpark': { LiveSpark: 'LiveSpark' }, './motion': { useReadout: (v: number | undefined, readout: calm.Readout) => readout.text(v) } });
  const points = [{ t: 0, v: 10 }, { t: 5000, v: 20 }];
  const stat = page.render('BigStat', { label: 'CPU', value: '20%', amount: 20, readout: calm.readouts.percent, points, color: '#111', max: 100 });
  const tween = find(stat, 'ReadoutText')[0], spark = find(stat, 'LiveSpark')[0];
  assert.equal(tween.props.value, 20);
  assert.equal(spark.props.points, points);
  assert.equal(spark.props.max, 100);
  // Without an amount the plain value shows
  const plainStat = page.render('BigStat', { label: 'CPU', value: '20%', points, color: '#111' });
  assert.equal(find(plainStat, 'ReadoutText').length, 0);
  assert.ok(texts(plainStat).includes('20%'));
});
test('notifications: a pull keeps the saved list; a failed refresh shows the offline line, or a cause with Retry when nothing is saved', () => {
  const calls: string[] = [];
  const page = component('variants/land/Notifications.tsx', { ...libs, './HomeCards': { OfflineLine: 'OfflineLine' }, '../../src/core/i18n/strings': { fill, causeText } });
  const notices = mappers.mapNotifications(nas.notify);
  const props = { t, locale: 'en', now: notices.newest * 1000, onRefresh: () => { calls.push('refresh'); }, onMore() {}, onRead() {}, onReadAll() {} };
  const saved = { scope: 's', times: {}, denied: [], notices } as StatusSnapshot;
  page.render('Notifications', { ...props, state: stateOf(saved, { refreshing: true }) });
  let list = page.elements('FlatList')[0].props;
  assert.ok(list.data.length > 0, 'rows stay while refreshing');
  assert.equal(list.refreshControl.type, 'PullRefresh');
  assert.equal(list.refreshControl.props.busy, true);
  page.render('Notifications', { ...props, state: stateOf(saved, { error: 'timeout' }) });
  list = page.elements('FlatList')[0].props;
  assert.ok(list.data.length > 0);
  const offline = list.ListHeaderComponent.props.children[0];
  assert.equal(offline.type, 'OfflineLine'); assert.equal(offline.props.state.error, 'timeout');
  offline.props.onRetry();
  assert.deepEqual(calls, ['refresh']);
  page.render('Notifications', { ...props, state: stateOf(undefined, { error: 'timeout' }) });
  const empty = page.elements('FlatList')[0].props.ListEmptyComponent;
  assert.equal(empty.props.title, t.noticesFailed);
  assert.equal(empty.props.detail, t.cause_timeout);
  const retry = [empty.props.children].flat().find((c: any) => c?.props?.title === t.retry);
  retry.props.onPress();
  assert.deepEqual(calls, ['refresh', 'refresh']);
});
