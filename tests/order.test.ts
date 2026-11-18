import test from 'node:test';
import assert from 'node:assert/strict';
import { dsmOrder, filterApps } from '../src/core/discovery/filter.ts';
import type { DiscoveredApp } from '../src/core/discovery/schema.ts';
import { moveApp, orderApps, pruneOrder } from '../src/core/launcher/order.ts';
import { LauncherModel, type SavedLauncher } from '../src/core/launcher/model.ts';
import type { Discovery } from '../src/core/discovery/client.ts';

const origin = 'https://nas.example.com';
const make = (id: string, name: string, extra: Partial<DiscoveredApp> = {}): DiscoveredApp => ({ id, name, package: id, url: `${origin}/?launchApp=${id}`, preset: 'desktop', registered: false, capabilities: [], ...extra });
const ids = (apps: DiscoveredApp[]) => apps.map(app => app.id);

test('DSM main-menu order: the drag order first, then the order DSM last showed', () => {
  assert.deepEqual(dsmOrder({ UserSettings: { Desktop: { appview_order: ['b', 'a'], valid_appview_order: ['a', 'c', 'b', 'd'] } } }), ['b', 'a', 'c', 'd']);
  assert.deepEqual(dsmOrder({ UserSettings: { Desktop: { valid_appview_order: ['c', 7, 'a'] } } }), ['c', 'a']);
  assert.deepEqual(dsmOrder({ UserSettings: {} }), []);
  assert.deepEqual(dsmOrder(null), []);
  const config = (id: string) => ({ jsID: id, jsBaseURL: `webman/3rdparty/${id}`, type: 'app', title: id });
  const apps = filterApps({ JSConfig: { s: { A: config('A'), B: config('B'), C: config('C') } }, Session: { isLogined: true, is_admin: true }, AppPrivilege: { 'SYNO.ALLOW.ALL.APPLICATIONS': true },
    UserSettings: { Desktop: { appview_order: ['C', 'Unknown', 'A'] } } }, origin);
  assert.deepEqual(apps.map(app => [app.id, app.dsmRank]), [['A', 2], ['B', undefined], ['C', 0]]);
});

test('ordering follows DSM ranks; partial lists and unknown ids fall back alphabetically after', () => {
  const apps = [make('x', 'Zeta', { dsmRank: 1 }), make('y', 'alpha'), make('z', 'Beta'), make('w', 'Mid', { dsmRank: 0 })];
  assert.deepEqual(ids(orderApps(apps, 'en')), ['w', 'x', 'y', 'z']);
  assert.deepEqual(ids(orderApps(apps.map(app => ({ ...app, dsmRank: undefined })), 'en')), ['y', 'z', 'w', 'x']);
});

test('alphabetical fallback is locale-aware for CJK and Latin names', () => {
  const apps = [make('1', '影音'), make('2', 'apple'), make('3', 'Banana'), make('4', '備份'), make('5', 'App 10'), make('6', 'App 9')];
  const en = ids(orderApps(apps, 'en'));
  assert.deepEqual(en.slice(0, 4), ['6', '5', '2', '3'], 'case-insensitive with numeric segments');
  const zh = ids(orderApps(apps, 'zh-Hant-TW'));
  assert.deepEqual(zh, [...zh].sort((a, b) => new Intl.Collator('zh-Hant-TW', { sensitivity: 'base', numeric: true }).compare(apps[+a - 1].name, apps[+b - 1].name)));
  assert.equal(ids(orderApps(apps, 'not a locale')).length, 6, 'invalid locales fall back');
});

test('a custom order wins; new Apps append, removed Apps are pruned, sections move independently', () => {
  const apps = [make('a', 'A', { dsmRank: 0 }), make('b', 'B', { dsmRank: 1 }), make('c', 'C', { dsmRank: 2 }), make('n', 'New')];
  assert.deepEqual(ids(orderApps(apps, 'en', ['c', 'a', 'b'])), ['c', 'a', 'b', 'n']);
  assert.deepEqual(pruneOrder(['c', 'gone', 'a', 'b'], apps), ['c', 'a', 'b']);
  // Moving within the first section leaves the other section's ids in place
  assert.deepEqual(moveApp(['m1', 'd1', 'm2', 'm3', 'd2'], ['m1', 'm2', 'm3'], 2, 0), ['m3', 'd1', 'm1', 'm2', 'd2']);
  assert.deepEqual(moveApp(['a', 'b', 'c'], ['a', 'b', 'c'], 0, 9), ['b', 'c', 'a']);
});

const profile = { id: 'one', name: 'One', origin }, other = { id: 'two', name: 'Two', origin: 'https://two.example.com' };
function model(discovery: Discovery, saved?: SavedLauncher) {
  let persisted: SavedLauncher = saved || { profiles: [profile, other], active: profile.id, snapshots: {} };
  const m = new LauncherModel({ read: () => persisted, write: value => { persisted = value; } }, () => 'user', discovery, () => {});
  return { m, persisted: () => persisted };
}

test('custom order persists across restart, is per profile, prunes after discovery and resets', async () => {
  let apps = [make('a', 'A'), make('b', 'B'), make('c', 'C')];
  const first = model(async () => apps);
  first.m.setOrder(profile.id, ['c', 'a', 'b']);
  const restarted = model(async () => apps, first.persisted());
  assert.deepEqual(restarted.m.state.order?.[profile.id], ['c', 'a', 'b']);
  assert.equal(restarted.m.state.order?.[other.id], undefined, 'other NAS keeps DSM order');
  apps = [make('a', 'A'), make('c', 'C'), make('d', 'D')];
  await restarted.m.refresh();
  assert.deepEqual(restarted.m.state.order?.[profile.id], ['c', 'a']);
  assert.deepEqual(ids(orderApps(restarted.m.state.apps, 'en', restarted.m.state.order?.[profile.id])), ['c', 'a', 'd']);
  restarted.m.resetOrder(profile.id);
  assert.equal(restarted.persisted().order?.[profile.id], undefined);
  restarted.m.setOrder(other.id, ['x']);
  restarted.m.remove(other.id);
  assert.equal(restarted.persisted().order?.[other.id], undefined, 'removing a NAS drops its order');
});

test('a failed refresh keeps the custom order intact', async () => {
  const f = model(async () => { throw new Error('offline'); });
  f.m.setOrder(profile.id, ['b', 'a']);
  await f.m.refresh();
  assert.deepEqual(f.persisted().order?.[profile.id], ['b', 'a']);
});
