import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { sameOrigin } from '../src/core/profiles/url.ts';
import { qrAddress } from '../src/core/profiles/qr.ts';
import { record } from '../src/core/discovery/schema.ts';
function storage(initial: unknown, fixed?: (saved?: { mobileFit?: boolean }) => unknown) {
  let saved = JSON.stringify(initial);
  const module = { exports: {} as any };
  const dependencies: Record<string, unknown> = {
    '../files': { textFiles: () => ({ read: () => saved, write: (_name: string, s: string) => { saved = s; } }) },
    '../platform': { fixedProfile: fixed || (() => undefined) },
    '../discovery/schema': { record }, '../profiles/url': { sameOrigin }, '../profiles/qr': { qrAddress },
  };
  const source = ts.transpileModule(readFileSync('src/core/launcher/storage.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(source, { module, exports: module.exports, require: (id: string) => dependencies[id], URL });
  return module.exports.launcherStorage;
}
test('legacy single-origin files round-trip without losing profile IDs or snapshots, and drop old desktop approvals', () => {
  const profile = { id: 'legacy', name: 'NAS', origin: 'https://nas.example' };
  const app = { id: 'app', name: 'App', url: profile.origin + '/entry', registered: true, preset: 'mobile', capabilities: [] };
  const initial = { visibilityPolicy: 3, profiles: [profile], active: profile.id, snapshots: { legacy: { scope: 'session', apps: [app], updated: 123 } }, approved: { legacy: ['app'] } };
  const store = storage(initial);
  const saved = store.read();
  assert.equal(saved.profiles[0].id, profile.id); assert.equal(saved.snapshots.legacy.apps[0].url, app.url); assert.equal('approved' in saved, false);
  store.write(saved);
  assert.equal(JSON.stringify(store.read()), JSON.stringify(saved));
});
test('QR groups and pins round-trip, and invalid saved trust exceptions are refused', () => {
  const profile = { id: 'p', name: 'NAS', origin: 'https://nas.example', group: 'g', kind: 'lan', sha256: 'a'.repeat(64) };
  const initial = { visibilityPolicy: 3, profiles: [profile], snapshots: {} };
  const store = storage(initial); store.write(store.read());
  assert.equal(store.read().profiles[0].sha256, profile.sha256); assert.equal(store.read().profiles[0].group, 'g');
  for (const bad of [{ ...profile, sha256: 'bad' }, { ...profile, origin: 'http://nas.example' }, { ...profile, group: {} }, { ...profile, mobileFit: 'yes' }]) assert.equal(storage({ ...initial, profiles: [bad] }).read(), null);
});

test('the web build always shows its own DSM, keeping that origin\'s snapshot, order and fit switch', () => {
  const own = { id: 'old', name: 'Old name', origin: 'https://nas.example', mobileFit: false };
  const other = { id: 'other', name: 'Other', origin: 'https://other.example' };
  const app = { id: 'app', name: 'App', url: own.origin + '/entry', registered: false, preset: 'desktop', capabilities: [] };
  const initial = { visibilityPolicy: 3, profiles: [own, other], active: other.id, snapshots: { old: { scope: 's', apps: [app], updated: 1 } }, order: { old: ['app'], other: ['x'] } };
  const web = (saved?: { mobileFit?: boolean }) => ({ id: 'web', name: 'NAS', origin: own.origin, ...(saved?.mobileFit !== undefined ? { mobileFit: saved.mobileFit } : {}) });
  const read = JSON.parse(JSON.stringify(storage(initial, web).read()));
  assert.deepEqual(read.profiles, [{ id: 'web', name: 'NAS', origin: own.origin, mobileFit: false }]);
  assert.equal(read.active, 'web');
  assert.deepEqual(Object.keys(read.snapshots), ['web']);
  assert.deepEqual(read.order, { web: ['app'] });
  // Nothing saved yet: still the one NAS
  assert.deepEqual(JSON.parse(JSON.stringify(storage(null, web).read().profiles)), [{ id: 'web', name: 'NAS', origin: own.origin }]);
});
