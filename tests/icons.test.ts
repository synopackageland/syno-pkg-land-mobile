import test from 'node:test';
import assert from 'node:assert/strict';
import { filterApps } from '../src/core/discovery/filter.ts';
import { registeredTarget, type DiscoveredApp } from '../src/core/discovery/schema.ts';
import { IconCache, WebIcons, iconSizes, iconSource, type IconFetch, type IconFiles, type IconResponse } from '../src/core/icons/cache.ts';

const origin = 'https://nas.example.com';
const profile = { id: 'nas', name: 'NAS', origin };
const other = { id: 'other', name: 'Other', origin: 'https://other.example.com' };
const session = { isLogined: true, is_admin: true, domainUser: 'false' };
function discovered(icon: string, pkg = 'Example', id = `SYNO.SDS.${pkg}.Instance`, version = '1.0-0001') {
  return filterApps({ JSConfig: { source: { [id]: { jsID: id, jsBaseURL: `webman/3rdparty/${pkg}`, type: 'app', title: pkg, icon } } }, Session: session, AppPrivilege: { 'SYNO.ALLOW.ALL.APPLICATIONS': true },
    Packages: [{ id: pkg, version, additional: { status: 'running', dsm_apps: id } }] }, origin)[0];
}

test('DSM package and built-in icon templates resolve with sizes, 1x folders and stamps', () => {
  const pkg = discovered('images/app_0123_{0}.png', 'SynoPkgReclaim');
  assert.equal(pkg.icon, `${origin}/webman/3rdparty/SynoPkgReclaim/images/app_0123_72.png`);
  assert.equal(pkg.iconTemplate, `${origin}/webman/3rdparty/SynoPkgReclaim/images/app_0123_{0}.png`);
  assert.equal(pkg.version, '1.0-0001');
  // Package Land icons ship 72 and 256 only: a dense screen asks 256 first, then falls back
  assert.deepEqual(iconSource(pkg, 143)!.urls.map(url => url.split('_').pop()), ['256.png', '128.png', '72.png', '64.png', '48.png']);
  assert.deepEqual(iconSizes(143), [256, 128, 72, 64, 48]);
  assert.deepEqual(iconSizes(72), [72, 128, 256, 64, 48]);
  const builtIn = discovered('images/{1}/SupportCenter_{0}.png', 'HyperBackup');
  assert.equal(builtIn.icon, `${origin}/webman/3rdparty/HyperBackup/images/1x/SupportCenter_72.png`);
  const stamped = discovered('images/_Favicon/document_{0}.png&v=0003', 'Docs');
  assert.equal(stamped.icon, `${origin}/webman/3rdparty/Docs/images/_Favicon/document_72.png?v=0003`);
  const fixed = discovered('images/package-32.png', 'Fixed');
  assert.equal(fixed.iconTemplate, undefined);
  assert.deepEqual(iconSource(fixed, 143)!.urls, [`${origin}/webman/3rdparty/Fixed/images/package-32.png`]);
  assert.equal(discovered('https://example.org/icon_{0}.png', 'Foreign').icon, undefined);
  const manifest = { schema: 1, package: 'SynoPkgReclaim', version: '1.0', build: 'b1', name: { en: 'Reclaim' }, icon: './icons/mobile-192.png?v=b1', entry: 'index.html', start: '/', capabilities: [], status: true, minShell: 1 };
  const registered = registeredTarget(manifest, pkg, origin)!;
  assert.equal(registered.iconTemplate, undefined);
  assert.deepEqual(iconSource(registered, 143)!.urls, [`${origin}/webman/3rdparty/SynoPkgReclaim/app/icons/mobile-192.png?v=b1`]);
});

test('the cache key changes with the package version or the icon stamp', () => {
  const app = discovered('images/app_{0}.png');
  const key = iconSource(app, 143)!.key;
  assert.equal(iconSource({ ...app }, 143)!.key, key);
  assert.notEqual(iconSource({ ...app, version: '1.0-0002' }, 143)!.key, key);
  const mobile: DiscoveredApp = { ...app, registered: true, preset: 'mobile', iconTemplate: undefined, icon: `${origin}/webman/3rdparty/Example/app/icons/mobile-192.png?v=b1` };
  assert.notEqual(iconSource({ ...mobile, icon: mobile.icon!.replace('v=b1', 'v=b2') }, 143)!.key, iconSource(mobile, 143)!.key);
});

type Call = { url: string; dest: string; etag?: string; lastModified?: string };
function fixture(answer: (call: Call) => IconResponse | Promise<IconResponse>, index: string | null = null, options = {}) {
  const disk = new Set<string>(), removed: string[] = [], calls: Call[] = [];
  let saved = index, clock = 1_000_000;
  const files: IconFiles = {
    readIndex: () => saved, writeIndex: text => { saved = text; },
    path: (p, name) => `/icons/${p}/${name}`, uri: path => `file://${path}`,
    remove: path => { disk.delete(path); removed.push(path); },
    removeProfile: p => { for (const path of [...disk]) if (path.startsWith(`/icons/${p}/`)) disk.delete(path); },
    list: () => [...disk],
  };
  const fetch: IconFetch = async (url, _origin, dest, etag, lastModified) => {
    const call = { url, dest, etag, lastModified }; calls.push(call);
    const response = await answer(call);
    if (response.status === 200) disk.add(dest);
    return response;
  };
  const cache = new IconCache(files, fetch, { pixels: 143, now: () => clock, ...options });
  return { cache, calls, disk, removed, saved: () => saved, files, fetch, tick: (ms: number) => { clock += ms; } };
}
const app = discovered('images/app_{0}.png');

test('missing sizes fall back, and a relaunch shows the cached icon before any request', async () => {
  const f = fixture(({ url }) => url.endsWith('_256.png') ? { status: 404 } : { status: 200, etag: '"a"', lastModified: 'Mon', size: 10 });
  assert.equal(f.cache.uri(profile.id, app), undefined);
  await f.cache.sync(profile, [app]);
  assert.deepEqual(f.calls.map(c => c.url.split('_').pop()), ['256.png', '128.png']);
  const uri = f.cache.uri(profile.id, app)!;
  assert.match(uri, /^file:\/\/\/icons\/nas\//);
  const relaunch = fixture(() => { throw new Error('no network on first render'); }, f.saved());
  // The index names the file; the disk fake is empty, so list() returns nothing to prune
  assert.equal(relaunch.cache.uri(profile.id, app), uri);
  assert.equal(relaunch.calls.length, 0);
});

test('revalidation sends validators once per launcher refresh: 304 keeps, 200 replaces', async () => {
  let reply: IconResponse = { status: 200, etag: '"a"', lastModified: 'Mon', size: 10 };
  const f = fixture(() => reply);
  await f.cache.sync(profile, [app]);
  const first = f.cache.uri(profile.id, app);
  await f.cache.sync(profile, [app], true);
  assert.equal(f.calls.length, 1, 'already checked in this round');
  f.cache.beginRound(); reply = { status: 304 };
  await f.cache.sync(profile, [app], true);
  assert.equal(f.calls.length, 2);
  assert.equal(f.calls[1].etag, '"a"'); assert.equal(f.calls[1].lastModified, 'Mon');
  assert.equal(f.calls[1].url, f.calls[0].url, 'revalidates the size that worked');
  assert.equal(f.cache.uri(profile.id, app), first);
  f.cache.beginRound(); reply = { status: 200, etag: '"b"', size: 12 };
  await f.cache.sync(profile, [app], true);
  const replaced = f.cache.uri(profile.id, app);
  assert.notEqual(replaced, first, 'a new file name busts the image cache');
  assert.ok(f.removed.includes(first!.replace('file://', '')));
  assert.equal(f.cache.entry(profile.id, app.id)?.etag, '"b"');
});

test('a new version refetches without validators and keeps the old icon until it arrives', async () => {
  const f = fixture(() => ({ status: 200, etag: '"a"', size: 10 }));
  await f.cache.sync(profile, [app]);
  const first = f.cache.uri(profile.id, app);
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const g = fixture(async () => { await gate; return { status: 200, size: 11 }; }, f.saved());
  const pending = g.cache.sync(profile, [{ ...app, version: '2.0-0001' }]);
  assert.equal(g.cache.uri(profile.id, app), first);
  release(); await pending;
  assert.equal(g.calls[0].etag, undefined);
  assert.notEqual(g.cache.uri(profile.id, app), first);
});

test('failures keep the placeholder or last good icon and back off instead of looping', async () => {
  let fail = true;
  const f = fixture(() => { if (fail) throw new Error('certificate'); return { status: 200, size: 5 }; });
  await f.cache.sync(profile, [app]);
  assert.equal(f.cache.uri(profile.id, app), undefined, 'letter tile stays');
  await f.cache.sync(profile, [app]); await f.cache.sync(profile, [app], true);
  assert.equal(f.calls.length, 1, 'no retry in the same refresh');
  f.cache.beginRound();
  await f.cache.sync(profile, [app]);
  assert.equal(f.calls.length, 1, 'still backing off');
  f.tick(61_000); fail = false;
  await f.cache.sync(profile, [app]);
  assert.ok(f.cache.uri(profile.id, app));
  const good = f.cache.uri(profile.id, app);
  f.cache.beginRound(); fail = true;
  await f.cache.sync(profile, [app], true);
  assert.equal(f.cache.uri(profile.id, app), good, 'last good icon survives a failed revalidation');
  const missing = fixture(() => ({ status: 404 }));
  await missing.cache.sync(profile, [app]);
  assert.equal(missing.calls.length, 5); assert.equal(missing.cache.uri(profile.id, app), undefined);
});

test('removing a NAS, uninstalled Apps and the size bound evict entries and files', async () => {
  const f = fixture(() => ({ status: 200, size: 10 }), null, { maxEntries: 3 });
  const apps = ['A', 'B', 'C'].map(name => discovered('images/i_{0}.png', name));
  await f.cache.sync(profile, apps);
  await f.cache.sync(other, apps.slice(0, 1));
  assert.equal(f.disk.size, 3, 'oldest entry evicted at the bound');
  f.cache.retainProfiles([other.id]);
  assert.equal(f.cache.uri(profile.id, apps[2]), undefined);
  assert.ok(f.cache.uri(other.id, apps[0]));
  f.cache.retainApps(other.id, []);
  assert.equal(f.cache.uri(other.id, apps[0]), undefined);
  assert.equal(f.disk.size, 0);
});

test('long-press refresh clears the NAS and refetches; a late answer cannot repopulate a cleared NAS', async () => {
  const f = fixture(() => ({ status: 200, etag: '"a"', size: 10 }));
  await f.cache.sync(profile, [app]);
  await f.cache.refresh(profile, [app]);
  assert.equal(f.calls.length, 2); assert.equal(f.calls[1].etag, undefined);
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const g = fixture(async () => { await gate; return { status: 200, size: 10 }; });
  const pending = g.cache.sync(profile, [app]);
  g.cache.clearProfile(profile.id);
  release(); await pending;
  assert.equal(g.cache.uri(profile.id, app), undefined);
  assert.equal(g.disk.size, 0);
});

test('a refresh that clears during a revalidation fetches anew instead of waiting on the stale request', async () => {
  let gate: Promise<void> | undefined, release!: () => void;
  const f = fixture(async () => { if (gate) await gate; return { status: 200, etag: '"a"', size: 10 }; });
  await f.cache.sync(profile, [app]);
  gate = new Promise<void>(resolve => { release = resolve; });
  f.cache.beginRound();
  const revalidating = f.cache.sync(profile, [app], true);
  const refreshing = f.cache.refresh(profile, [app]);
  release(); await Promise.all([revalidating, refreshing]);
  assert.equal(f.calls.length, 3, 'the refresh sent its own request');
  assert.ok(f.cache.uri(profile.id, app), 'the refreshed icon is stored');
});

test('a failure checked in an earlier process is retried after its backoff on the next launch', async () => {
  const f = fixture(() => { throw new Error('certificate'); });
  await f.cache.sync(profile, [app]);
  assert.equal(f.cache.uri(profile.id, app), undefined);
  const later = fixture(() => ({ status: 200, size: 5 }), f.saved(), { now: () => 2_000_000 });
  await later.cache.sync(profile, [app]);
  assert.equal(later.calls.length, 1);
  assert.ok(later.cache.uri(profile.id, app));
});

test('the browser build moves an App to its next size when DSM lacks one (a 3x phone asks for 256 px)', () => {
  const app = discovered('images/{1}/ControlPanel_{0}.png', 'Example');
  const icons = new WebIcons(156);
  let changes = 0;
  icons.subscribe(() => changes++);
  const url = (size: number) => `${origin}/webman/3rdparty/Example/images/1x/ControlPanel_${size}.png`;
  assert.equal(icons.uri('nas', app), url(256));
  icons.failed('nas', app, url(256));
  assert.equal(icons.uri('nas', app), url(128), 'the next size that covers the tile, not the letter tile');
  assert.equal(changes, 1);
  icons.failed('nas', app, url(256));
  assert.equal(icons.uri('nas', app), url(128), 'a late error for a URL already left behind changes nothing');
  assert.equal(changes, 1);
  assert.equal(icons.uri('other', app), url(256), 'each NAS keeps its own place');
  for (const size of [128, 72, 64, 48]) icons.failed('nas', app, url(size));
  assert.equal(icons.uri('nas', app), undefined, 'past the last size the letter tile stays');
});
