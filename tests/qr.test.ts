import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseNasQr, qrGroup, NasQrError } from '../src/core/profiles/qr.ts';
import { LauncherModel, type SavedLauncher } from '../src/core/launcher/model.ts';
const fixture = JSON.parse(readFileSync('tests/qr-v1-fixture.json', 'utf8'));
const link = (payload: unknown) => 'synopkgland://add-nas#' + Buffer.from(JSON.stringify(payload)).toString('base64url');
const payload = (url = 'https://nas.example.com') => ({ v: 1, name: 'NAS', urls: [{ url, kind: 'lan' }] });
test('shared v1 fixture matches UTF-8 JSON and exact unpadded base64url wire bytes', () => {
  assert.equal(link(fixture.payload), fixture.qr);
  assert.deepEqual(parseNasQr(fixture.qr), fixture.payload);
  assert.equal(parseNasQr(link({ ...payload(), name: '家裡的 NAS 🏡', future: 'ignored', urls: [{ ...payload().urls[0], future: true }] })).name, '家裡的 NAS 🏡');
  assert.equal(parseNasQr(link(payload('http://[fd00::1]:5000'))).urls[0].url, 'http://[fd00::1]:5000');
});
test('reject paths, queries, fragments, credentials, parser normalization tricks and invalid schemes', () => {
  for (const url of ['https://nas/', 'https://nas/path', 'https://nas?token=x', 'https://nas#x', 'https://u:p@nas', 'https://@nas', 'https://nas\\x', 'https://nas\nx', 'https://nas:99999', 'file://nas', 'ftp://nas', '//nas', 'https://']) {
    assert.throws(() => parseNasQr(link(payload(url))), NasQrError, url);
  }
});
test('validate version, name, size, strict URL kind, leaf pin and address count', () => {
  for (const bad of [null, [], {}, { ...payload(), v: '1' }, { ...payload(), name: '' }, { ...payload(), name: 'a\u0000b' }, { ...payload(), urls: [] }, { ...payload(), urls: Array(9).fill(payload().urls[0]) }, { ...payload(), urls: [payload().urls[0], payload().urls[0]] }, { ...payload(), urls: [{ url: 'https://nas', kind: ['lan'] }] }, { ...payload(), urls: [{ url: 'https://nas', kind: 'bad' }] }, { ...payload(), urls: [{ url: 'https://nas', kind: 'lan', sha256: 'A'.repeat(64) }] }, { ...payload(), urls: [{ url: 'http://nas', kind: 'lan', sha256: 'a'.repeat(64) }] }]) assert.throws(() => parseNasQr(link(bad)), NasQrError);
  for (const v of [0, 2, -1]) assert.throws(() => parseNasQr(link({ ...payload(), v })), (e: unknown) => e instanceof NasQrError && e.code === 'updateApp');
  assert.throws(() => parseNasQr(link({ ...payload(), name: '家'.repeat(700) })), (e: unknown) => e instanceof NasQrError && e.code === 'qrTooLarge');
  // Exactly 2 KiB decoded is accepted; the next byte is rejected.
  const base = JSON.stringify({ ...payload(), extra: '' });
  const boundary = base.replace('"extra":""', '"extra":"' + 'x'.repeat(2048 - Buffer.byteLength(base)) + '"');
  assert.equal(Buffer.byteLength(boundary), 2048);
  assert.equal(parseNasQr('synopkgland://add-nas#' + Buffer.from(boundary).toString('base64url')).name, 'NAS');
});
test('reject malformed base64, padding, noncanonical bits and malformed UTF-8', () => {
  for (const data of ['', '=', 'abc=', 'a', '%%%%', '_w', 'eyJ2IjoxfR']) assert.throws(() => parseNasQr('synopkgland://add-nas#' + data), NasQrError);
  for (const prefix of ['https://add-nas#', 'synopkgland://add-nas/#', 'synopkgland://add-nas?x#', 'synopkgland://other#']) assert.throws(() => parseNasQr(prefix + fixture.qr.split('#')[1]), NasQrError);
});
test('rescan migrates legacy profiles in place, updates group, preserves unchanged snapshots and isolates same names', () => {
  const origin = fixture.payload.urls[0].url;
  let saved: SavedLauncher = { profiles: [{ id: 'legacy', name: 'Old', origin }, { id: 'unrelated', name: 'DiskStation', origin: 'https://unrelated.example' }], active: 'legacy', snapshots: { legacy: { scope: 'session', apps: [], updated: 123 } } };
  const model = new LauncherModel({ read: () => saved, write: v => { saved = v; } }, () => 'session', async () => [], () => {});
  let id = 0; const nextId = () => `new-${++id}`;
  const profiles = model.importQr(parseNasQr(fixture.qr), nextId);
  assert.equal(profiles[0].id, 'legacy'); assert.equal(model.profile?.id, 'legacy');
  assert.equal(saved.snapshots.legacy.updated, 123);
  assert.equal(saved.profiles.length, 4); assert.equal(qrGroup(saved.profiles, parseNasQr(fixture.qr)).length, 3);
  const again = model.importQr(parseNasQr(fixture.qr), nextId);
  assert.deepEqual(again, profiles); assert.equal(saved.profiles.length, 4);
  const changed = { ...fixture.payload, name: 'Renamed', urls: fixture.payload.urls.slice(1) };
  model.importQr(parseNasQr(link(changed)), nextId);
  assert.equal(saved.profiles.length, 3); assert.equal(saved.profiles[0].id, 'unrelated');
  assert.equal(saved.snapshots.legacy, undefined);
  assert.equal(model.profile?.name, 'Renamed');
});
