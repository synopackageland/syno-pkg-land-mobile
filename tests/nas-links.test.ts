import test from 'node:test';
import assert from 'node:assert/strict';
import { addLink, decodeFragment, encodeFragment, launcherOn, launcherPages, linkOf, mergeLinks, prune, readLinks, removeLink, setReach, withLauncher, withoutFragment, withSelf, quickFailure, TOMBSTONE_MS, type NasLink } from '../src/core/profiles/nas-links.ts';
import { candidateOrigins, parseAddress } from '../src/core/profiles/probe.ts';

const path = '/webman/3rdparty/SynoPkgConnect/m/index.html';
const link = (host: string, at: number, extra: Partial<NasLink> = {}): NasLink => ({ origin: `https://${host}`, name: host, launcher: `https://${host}${path}`, at, ...extra });

test('a switch hands the list over in the fragment: names, addresses and times only', () => {
  const now = 1_000_000;
  const links = [link('a.example', 10, { reachable: true, seen: 9 }), link('b.example', 20, { removed: true })];
  const hash = `#${encodeFragment(links)}`;
  assert.ok(!hash.includes('reachable') && !hash.includes('seen'));
  assert.deepEqual(decodeFragment(hash, now), [link('a.example', 10), link('b.example', 20, { removed: true })]);
  // Non-ASCII names survive
  assert.equal(decodeFragment(encodeFragment([link('c.example', 1, { name: '家裡的 NAS' })]), now)![0].name, '家裡的 NAS');
  assert.equal(withoutFragment(hash), '');
  assert.equal(withoutFragment(`${hash}&x=1`), '#x=1');
  assert.equal(withoutFragment('#other'), '#other');
});
test('a fragment that is not a valid list is ignored, entry by entry', () => {
  const now = 1_000;
  for (const bad of ['', '#spl-nas=', '#spl-nas=%%%', `#spl-nas=${Buffer.from('{"v":2,"list":[]}').toString('base64url')}`]) assert.equal(decodeFragment(bad, now), undefined, bad);
  const raw = (list: unknown[]) => `#spl-nas=${Buffer.from(JSON.stringify({ v: 1, list })).toString('base64url')}`;
  const good = { o: 'https://a.example', n: 'A', l: `https://a.example${path}`, t: 5 };
  const decoded = decodeFragment(raw([
    good,
    { ...good, o: 'https://user:pw@b.example', l: `https://user:pw@b.example${path}` },
    { ...good, o: 'javascript:alert(1)' },
    { ...good, o: 'https://c.example', l: `https://evil.example${path}` },
    { ...good, o: 'https://d.example', l: `https://d.example${path}?token=x` },
    { ...good, o: 'https://e.example/', l: `https://e.example${path}` },
    { ...good, o: 'https://f.example', l: `https://f.example${path}`, n: '' },
    { ...good, o: 'https://g.example', l: `https://g.example${path}`, t: 'x' },
    { ...good, o: 'https://h.example', l: `https://h.example${path}`, n: 'H\u0000\nname', t: 1e15 },
    good,
  ]), now)!;
  assert.deepEqual(decoded.map(l => l.origin), ['https://a.example', 'https://h.example'], 'one entry per origin; bad entries dropped');
  assert.equal(decoded[1].name, 'H name'); assert.equal(decoded[1].at, now, 'future times are clamped');
});
test('merging keeps the newer entry per origin and this origin\'s check results; tombstones win when newer', () => {
  const now = 10_000;
  const local = [link('a.example', 10, { reachable: false, seen: 3 }), link('b.example', 50), link('c.example', 30)];
  const incoming = [link('a.example', 20, { name: 'A renamed' }), link('b.example', 40, { removed: true }), link('c.example', 60, { removed: true }), link('d.example', 5)];
  const merged = mergeLinks(local, incoming, now);
  assert.deepEqual(merged, [
    { origin: 'https://a.example', name: 'A renamed', launcher: `https://a.example${path}`, at: 20, reachable: false, seen: 3 },
    link('b.example', 50),
    link('c.example', 60, { removed: true }),
    link('d.example', 5),
  ]);
  // A NAS removed here is not brought back by an older list from another NAS
  const removed = removeLink(merged, 'https://d.example', now);
  assert.equal(mergeLinks(removed, [link('d.example', 5)], now).find(l => l.origin === 'https://d.example')!.removed, true);
  // Adding it again revives it
  const back = addLink(removed, { origin: 'https://d.example', name: 'D', launcher: `https://d.example${path}` }, now);
  assert.equal(back.find(l => l.origin === 'https://d.example')!.removed, undefined);
});
test('this page\'s NAS is always listed under its server name, and a new name is dated so it travels', () => {
  const now = 500;
  const self = { origin: 'https://a.example', name: 'Vault', launcher: `https://a.example${path}` };
  // Added elsewhere under its host, with a later time than this NAS ever wrote
  const listed = withSelf([link('b.example', 1), link('a.example', 900, { removed: true })], self, now);
  const mine = listed.find(l => l.origin === self.origin)!;
  assert.equal(mine.name, 'Vault'); assert.equal(mine.removed, undefined); assert.ok(mine.at > 900);
  assert.equal(withSelf(listed, self, now + 1), listed, 'unchanged: no new time');
  assert.equal(withSelf([], self, now)[0].origin, self.origin);
});
test('old tombstones are dropped and the list is bounded', () => {
  const now = TOMBSTONE_MS + 100;
  assert.deepEqual(prune([link('a.example', 50, { removed: true }), link('b.example', now - 10, { removed: true })], now).map(l => l.origin), ['https://b.example']);
  const many = Array.from({ length: 40 }, (_, i) => link(`n${i}.example`, i + 1));
  assert.equal(prune(many, now).length, 32);
  assert.equal(readLinks(Array.from({ length: 100 }, (_, i) => link(`n${i}.example`, i + 1)), now).length, 64);
});
test('check results stay local; a failed check keeps the last time it answered', () => {
  const links = setReach([link('a.example', 1)], 'https://a.example', true, 77);
  assert.deepEqual([links[0].reachable, links[0].seen], [true, 77]);
  const failed = setReach(links, 'https://a.example', false, 99);
  assert.deepEqual([failed[0].reachable, failed[0].seen], [false, 77]);
  assert.deepEqual(linkOf({ ...failed[0] }, 100), failed[0]);
});
test('a typed address becomes launcher pages on DSM\'s usual ports; an HTTPS page skips plain HTTP', () => {
  const origins = candidateOrigins(parseAddress('nas.example'));
  assert.deepEqual(launcherPages(origins, path, 'http:'), origins.map(o => `${o}${path}`));
  assert.deepEqual(launcherPages(origins, path, 'https:'), [`https://nas.example:5001${path}`, `https://nas.example${path}`]);
  assert.deepEqual(launcherPages(candidateOrigins(parseAddress('https://relay.example/some/page')), path, 'https:')[0], `https://relay.example${path}`);
  assert.equal(launcherOn('https://a.example', `https://a.example${path}#x`), undefined);
  assert.equal(launcherOn('https://a.example', `https://a.example${path}`), `https://a.example${path}`);
});
test('a NAS without a launcher stays DSM-only through storage, a switch and a merge, until its launcher answers', () => {
  const now = 1_000_000;
  const dsm = link('d.example', 10, { dsm: true });
  assert.deepEqual(readLinks(JSON.parse(JSON.stringify([dsm])), now), [dsm]);
  assert.deepEqual(decodeFragment(encodeFragment([dsm, link('e.example', 11)]), now), [dsm, link('e.example', 11)]);
  // A newer entry from another page carries the mark; local check results stay
  assert.deepEqual(mergeLinks([link('d.example', 5, { reachable: true, seen: 4 })], [dsm], now), [{ ...dsm, reachable: true, seen: 4 }]);
  assert.deepEqual(mergeLinks([], [dsm], now), [dsm]);
  // Adding it again after a launcher was found clears the mark, and the other way round
  const added = addLink([], { origin: dsm.origin, name: dsm.name, launcher: dsm.launcher, dsm: true }, 20);
  assert.equal(added[0].dsm, true);
  assert.equal(addLink(added, { origin: dsm.origin, name: dsm.name, launcher: dsm.launcher }, 30)[0].dsm, undefined);
  // A launcher found in the background clears it with a newer time, so the change travels
  const upgraded = withLauncher([{ ...dsm, reachable: false }, link('e.example', 11)], dsm.origin, 50);
  assert.deepEqual(upgraded, [{ origin: dsm.origin, name: dsm.name, launcher: dsm.launcher, at: 50, reachable: false }, link('e.example', 11)]);
  assert.deepEqual(withLauncher([link('e.example', 11)], 'https://e.example', 50), [link('e.example', 11)], 'a NAS that already has a launcher is unchanged');
  // This page's own NAS always has a launcher
  assert.equal(withSelf([dsm], { origin: dsm.origin, name: 'D', launcher: dsm.launcher }, now)[0].dsm, undefined);
});

test('a browser that gives up at once points at the certificate; a wait points at the network', () => {
  assert.equal(quickFailure(40), true);
  assert.equal(quickFailure(8000), false);
});
