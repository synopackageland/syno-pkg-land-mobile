import test from 'node:test';
import assert from 'node:assert/strict';
import { LauncherModel, errorCode, intakeChoice, type SavedLauncher } from '../src/core/launcher/model.ts';
import type { Discovery } from '../src/core/discovery/client.ts';
import { DiscoveryError } from '../src/core/discovery/client.ts';
import type { DiscoveredApp } from '../src/core/discovery/schema.ts';
import { IntakeInbox } from '../src/core/intake/inbox.ts';
const profile = { id: 'one', name: 'One', origin: 'https://one.example.com' };
const other = { id: 'two', name: 'Two', origin: 'https://two.example.com' };
const app: DiscoveredApp = { id: 'example', name: 'Example', package: 'Example', url: profile.origin + '/entry.html', preset: 'mobile', registered: true, capabilities: [], intake: { route: '/add', accept: [{ kind: 'url', schemes: ['magnet'] }] } };
const initial = (): SavedLauncher => ({ profiles: [profile, other], active: profile.id, snapshots: { one: { scope: 'user-a', apps: [app], updated: 123 } } });
function fixture(discovery: Discovery, saved = initial(), scope = 'user-a') {
  let writes = saved, key = scope, clears = 0;
  const model = new LauncherModel({ read: () => saved, write: value => { writes = value; } }, () => key, discovery, () => { clears++; });
  return { model, persisted: () => writes, key: (value: string) => { key = value; }, clears: () => clears };
}
test('cold-start state renders the persisted user snapshot before any network work', async () => {
  let requests = 0, resolve!: (apps: DiscoveredApp[]) => void;
  const { model } = fixture(async () => { requests++; return new Promise(done => { resolve = done; }); });
  assert.equal(requests, 0); assert.deepEqual(model.getState().apps, [app]); assert.equal(model.getState().updated, 123);
  const refresh = model.refresh();
  assert.equal(requests, 1); assert.equal(model.state.refreshing, true); assert.deepEqual(model.state.apps, [app]);
  resolve([{ ...app, name: 'Fresh' }]); await refresh;
  assert.equal(model.state.apps[0].name, 'Fresh'); assert.equal(model.state.refreshing, false);
});
test('offline refresh retains the visible snapshot; authentication errors clear it and the inbox', async () => {
  const offline = fixture(async () => { throw new Error('offline'); });
  await offline.model.refresh(); assert.deepEqual(offline.model.state.apps, [app]); assert.ok(offline.model.state.error);
  const expired = fixture(async () => { throw new DiscoveryError(105); });
  await expired.model.refresh(); assert.deepEqual(expired.model.state.apps, []); assert.equal(expired.model.state.signIn, true); assert.equal(expired.clears(), 1); assert.deepEqual(expired.persisted().snapshots, {});
});
test('snapshots are isolated by NAS and session identity, including a changed user on the same NAS', async () => {
  const f = fixture(async () => []);
  f.key('user-b'); await f.model.refresh(); assert.deepEqual(f.model.state.apps, []);
  assert.deepEqual(fixture(async () => [], initial(), 'user-b').model.state.apps, []);
  f.model.select(other.id); assert.deepEqual(f.model.state.apps, []); assert.equal(f.clears(), 1);
});
test('a late discovery response cannot restore a signed-out, removed or switched profile', async () => {
  for (const action of ['signOut', 'remove', 'select'] as const) {
    let resolve!: (apps: DiscoveredApp[]) => void;
    const f = fixture(async (_profile, publish) => { await new Promise<DiscoveredApp[]>(done => { resolve = done; }); publish([app]); return [app]; });
    const refresh = f.model.refresh();
    f.model[action](action === 'select' ? other.id : profile.id);
    resolve([app]); await refresh;
    assert.deepEqual(f.model.state.apps, []);
    if (action !== 'select') assert.equal(f.persisted().snapshots.one, undefined);
  }
});
test('sign-out and removal clear inbox handles', () => {
  for (const action of ['signOut', 'remove'] as const) {
    const inbox = new IntakeInbox(); inbox.put('handle', profile.origin, [{ kind: 'url', url: 'magnet:?xt=test' }]);
    let saved = initial();
    const model = new LauncherModel({ read: () => saved, write: value => { saved = value; } }, () => 'user-a', async () => [], () => inbox.clear());
    model[action](profile.id); assert.deepEqual(inbox.take('handle', profile.origin), []); assert.equal(saved.snapshots.one, undefined);
  }
});
test('intake opens one match, asks with several matches and rejects unsupported/desktop targets', () => {
  const items = [{ kind: 'url', url: 'magnet:?xt=test' }] as const;
  assert.equal(intakeChoice([...items], [app]).kind, 'open');
  const multiple = intakeChoice([...items], [app, { ...app, id: 'second' }]);
  assert.equal(multiple.kind, 'picker'); assert.deepEqual(multiple.matches.map(a => a.id), ['example', 'second']);
  assert.equal(intakeChoice([{ kind: 'text', text: 'unsupported' }], [app]).kind, 'none');
  assert.equal(intakeChoice([...items], [{ ...app, registered: false, preset: 'desktop' }]).kind, 'none');
  assert.equal(intakeChoice([], [app]).kind, 'none');
});
test('intake selection uses the completed registration set rather than one early probe', async () => {
  let finish!: () => void;
  const f = fixture(async (_profile, publish) => {
    publish([{ ...app, id: 'new' }]);
    await new Promise<void>(resolve => { finish = resolve; });
    return [{ ...app, id: 'new' }, { ...app, id: 'second' }];
  }, { ...initial(), snapshots: {} });
  const refreshing = f.model.refresh(); assert.equal(intakeChoice([{ kind: 'url', url: 'magnet:?xt=test' }], f.model.state.intakeApps).kind, 'none');
  finish(); await refreshing;
  assert.equal(intakeChoice([{ kind: 'url', url: 'magnet:?xt=test' }], f.model.state.intakeApps).kind, 'picker');
});
test('profile add normalizes URLs, refuses duplicates and removes only the selected profile', () => {
  const f = fixture(async () => []);
  f.model.add('new', 'Office', 'office.example.com:5001');
  assert.equal(f.model.profile?.origin, 'https://office.example.com:5001');
  assert.throws(() => f.model.add('duplicate', 'Duplicate', 'https://office.example.com:5001'));
  f.model.remove('new'); assert.equal(f.model.state.profiles.length, 2); assert.equal(f.model.profile?.id, profile.id);
});
test('runtime denials filter current and persisted lists, late probes cannot restore them, and scope is checked', async () => {
  let publish!: (apps: DiscoveredApp[]) => void, finish!: () => void;
  const f = fixture(async (_profile, callback) => { publish = callback; await new Promise<void>(resolve => { finish = resolve; }); return [app]; });
  const refresh = f.model.refresh();
  f.model.applyRuntime(profile.id, 'wrong-user', { [app.id]: false });
  assert.equal(f.model.state.apps.length, 1);
  f.model.applyRuntime(other.id, 'user-a', { [app.id]: false });
  assert.equal(f.model.state.apps.length, 1);
  f.model.applyRuntime(profile.id, 'user-a', { [app.id]: false });
  assert.deepEqual(f.model.state.apps, []);
  assert.deepEqual(f.persisted().snapshots.one.apps, []);
  publish([app]); assert.deepEqual(f.model.state.apps, []);
  finish(); await refresh;
  assert.deepEqual(f.model.state.intakeApps, []);
  f.model.applyRuntime(profile.id, 'user-a', { [app.id]: true });
  assert.deepEqual(f.model.state.apps, [app]);
  f.model.signOut(profile.id);
  f.key('');
  f.model.applyRuntime(profile.id, 'user-a', { [app.id]: true });
  assert.deepEqual(f.model.state.apps, []);
});
test('a hardware-gated App appears only when the live DSM runtime confirms it', async () => {
  const gated: DiscoveredApp = { id: 'SYNO.SDS.HA.Instance', name: 'High Availability', package: 'HighAvailability', url: profile.origin + '/?launchApp=SYNO.SDS.HA.Instance', preset: 'desktop', registered: false, capabilities: [], runtimeOnly: true };
  const f = fixture(async () => [app, gated]);
  await f.model.refresh();
  assert.deepEqual(f.model.state.apps.map(a => a.id), [app.id]);
  f.model.applyRuntime(profile.id, 'user-a', { [app.id]: true });
  assert.deepEqual(f.model.state.apps.map(a => a.id), [app.id]);
  f.model.applyRuntime(profile.id, 'user-a', { [app.id]: true, [gated.id]: true });
  assert.deepEqual(f.model.state.apps.map(a => a.id), [app.id, gated.id]);
  assert.deepEqual(f.persisted().snapshots.one.apps.map(a => a.id), [app.id, gated.id]);
  f.model.applyRuntime(profile.id, 'user-a', { [app.id]: true, [gated.id]: false });
  assert.deepEqual(f.model.state.apps.map(a => a.id), [app.id]);
});
test('App names are cached per language and a refresh in a new language replaces only that language', async () => {
  let language = 'cht', name = '控制台';
  const panel: DiscoveredApp = { id: 'SYNO.SDS.AdminCenter.Application', name: 'Control Panel', package: 'AdminCenter', url: profile.origin + '/?launchApp=SYNO.SDS.AdminCenter.Application', preset: 'desktop', registered: false, capabilities: [], builtin: true };
  let saved = initial();
  const storage = { read: () => saved, write: (value: SavedLauncher) => { saved = value; } };
  const make = () => new LauncherModel(storage, () => 'user-a', async () => [{ ...panel, name }], () => {}, () => language);
  const model = make();
  await model.refresh();
  assert.equal(model.state.apps[0].name, '控制台');
  // The phone switches to English: the last list shows until the next refresh brings English names
  language = 'enu';
  assert.equal(make().state.apps[0].name, '控制台');
  name = 'Control Panel';
  const english = make(); await english.refresh();
  assert.equal(english.state.apps[0].name, 'Control Panel');
  assert.deepEqual(saved.snapshots.one.names, { cht: { [panel.id]: '控制台' }, enu: { [panel.id]: 'Control Panel' } });
  // Back to Chinese: the cached Chinese names show before any refresh
  language = 'cht';
  assert.equal(make().state.apps[0].name, '控制台');
});
test('in-progress registration probes retain cached mobile cards until a probe explicitly rejects them', async () => {
  const observed: DiscoveredApp[][] = [];
  const f = fixture(async (_profile, publish) => {
    publish([{ ...app, registered: false, preset: 'desktop', capabilities: [], intake: undefined }]);
    observed.push(f.model.state.apps);
    const rejected = { ...app, registered: false, preset: 'desktop' as const, reason: 'Registration rejected' };
    publish([rejected]); observed.push(f.model.state.apps);
    return [rejected];
  });
  await f.model.refresh();
  assert.deepEqual(observed[0], [app]);
  // Later progress is coalesced, then the final discovery result always lands
  assert.deepEqual(observed[1], [app]);
  assert.equal(f.model.state.apps[0].registered, false);
});
test('progressive discovery updates are coalesced instead of re-rendering once per App', async () => {
  let renders = 0;
  const f = fixture(async (_profile, publish) => {
    for (let i = 0; i < 50; i++) publish([{ ...app, name: `Example ${i}` }]);
    await new Promise(done => setTimeout(done, 300));
    return [{ ...app, name: 'Final' }];
  });
  f.model.subscribe(() => { renders++; });
  await f.model.refresh();
  assert.ok(renders < 8, `renders=${renders}`);
  assert.equal(f.model.state.apps[0].name, 'Final');
});
test('refresh publications and runtime changes cannot move a held card; release applies the latest scoped list', async () => {
  let finish!: () => void;
  const f = fixture(async (_profile, publish) => {
    publish([{ ...app, name: 'Intermediate' }]);
    publish([{ ...app, name: 'Latest' }]);
    await new Promise<void>(resolve => { finish = resolve; });
    return [{ ...app, name: 'Latest' }];
  });
  f.model.holdList();
  const refresh = f.model.refresh();
  f.model.applyRuntime(profile.id, 'user-a', { [app.id]: false });
  assert.deepEqual(f.model.state.apps, [app]);
  f.model.releaseList(); assert.deepEqual(f.model.state.apps, []);
  finish(); await refresh;
  f.model.applyRuntime(profile.id, 'user-a', { [app.id]: true });
  assert.equal(f.model.getState().apps[0].name, 'Latest');
});
test('returning to the same NAS retains its live runtime decisions through another refresh', async () => {
  const f = fixture(async () => [app]);
  f.model.applyRuntime(profile.id, 'user-a', { [app.id]: false });
  f.model.select(profile.id); await f.model.refresh();
  assert.deepEqual(f.model.state.apps, []);
  f.model.select(other.id);
  f.model.applyRuntime(profile.id, 'user-a', { [app.id]: false });
  assert.deepEqual(f.model.state.apps, []);
});
test('changing the session cannot reuse the previous user registration during discovery', async () => {
  const raw = { ...app, name: 'Current user app', registered: false, preset: 'desktop' as const };
  let observed: DiscoveredApp[] = [];
  const f = fixture(async (_profile, publish) => { publish([raw]); observed = f.model.state.apps; return [raw]; });
  f.model.applyRuntime(profile.id, 'user-a', { [app.id]: false });
  f.key('user-b'); await f.model.refresh();
  assert.deepEqual(observed, [raw]);
  assert.deepEqual(f.model.state.apps, [raw]);
});

const pin = 'a'.repeat(64);
test('rename trims, ignores blanks and control characters, and persists', () => {
  const { model, persisted } = fixture(async () => []);
  model.rename('one', '  Vault  '); assert.equal(persisted().profiles[0].name, 'Vault');
  model.rename('one', '   '); model.rename('one', 'bad\u0007name'); assert.equal(model.state.profiles[0].name, 'Vault');
});
test('the mobile fit setting is stored per NAS', () => {
  const { model, persisted } = fixture(async () => []);
  model.setMobileFit('one', false);
  assert.equal(persisted().profiles[0].mobileFit, false);
  assert.equal(persisted().profiles.find((p: { id: string }) => p.id !== 'one')?.mobileFit, undefined);
  model.setMobileFit('one', true); assert.equal(model.state.profiles[0].mobileFit, true);
});
test('changing the address keeps identity, drops origin-bound state and replaces the pin', () => {
  const saved = { ...initial(), profiles: [{ ...profile, sha256: pin }, other] };
  const { model, persisted, clears } = fixture(async () => [], saved);
  model.changeAddress('one', 'https://one.example.com', 'b'.repeat(64));
  assert.equal(model.state.profiles[0].sha256, 'b'.repeat(64)); assert.ok(model.state.snapshots.one);
  model.changeAddress('one', 'https://one.example.com:5443');
  const moved = persisted().profiles[0];
  assert.equal(moved.id, 'one'); assert.equal(moved.origin, 'https://one.example.com:5443'); assert.equal(moved.sha256, undefined);
  assert.equal(persisted().snapshots.one, undefined); assert.ok(clears() >= 1);
  assert.throws(() => model.changeAddress('one', other.origin), /DUPLICATE/);
  assert.throws(() => model.changeAddress('one', 'http://one.example.com:5000', pin), /INVALID_PIN/);
});
test('add rejects duplicates and pins on plain HTTP', () => {
  const { model } = fixture(async () => []);
  assert.throws(() => model.add('x', 'Dup', profile.origin), /DUPLICATE/);
  assert.throws(() => model.add('x', 'Plain', 'http://192.0.2.10:5000', pin), /INVALID_PIN/);
  model.add('x', 'Lab', 'https://192.0.2.10:5001', pin);
  assert.equal(model.state.active, 'x'); assert.equal(model.profile?.sha256, pin);
});
test('error codes are short, safe identifiers', () => {
  assert.equal(errorCode(new DiscoveryError(119)), 'API_119');
  assert.equal(errorCode(Object.assign(new Error('x'), { code: 'timeout' })), 'timeout');
  assert.equal(errorCode(Object.assign(new Error('x'), { code: '<script>' })), 'failed');
  assert.equal(errorCode('boom'), 'failed');
});
