import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { lookupQuickConnect, md5, parseQuickConnect, quickConnectCandidates, relayOrigin } from '../src/core/profiles/quickconnect.ts';
import { NasProber, mainCause, type ProbeResponse } from '../src/core/profiles/probe.ts';

// Fixtures use a made-up ID and documentation/private addresses only
const ID = 'example-qc', SERVER = '000000001', EZID = createHash('md5').update(SERVER).digest('hex');
const info = (https: boolean, extra: Record<string, unknown> = {}) => ({
  command: 'get_server_info', errno: 0, version: 1,
  env: { control_host: 'cc1.quickconnect.to', relay_region: 'xx1' },
  server: { serverID: SERVER, ddns: 'example.synology.me', fqdn: 'NULL', external: { ip: '198.51.100.7' }, interface: [{ ip: '192.168.1.20', ipv6: [{ address: 'fe80::1', scope: 'link' }] }] },
  service: { port: https ? 5001 : 5000, ext_port: https ? 15001 : 0 },
  smartdns: { host: `${ID}.direct.quickconnect.to`, lan: [`192-168-1-20.${ID}.direct.quickconnect.to`] },
  ...extra,
});

test('QuickConnect IDs and both URL forms are recognised; other addresses are not', () => {
  assert.deepEqual(parseQuickConnect('Example-QC'), { id: ID, explicit: false });
  for (const value of [`https://${ID}.quickconnect.to`, `https://${ID}.quickconnect.to/`, `https://quickconnect.to/${ID}`, `https://quickconnect.to/${ID}/`, `quickconnect.to/${ID}/webman/index.cgi`, `http://${ID}.quickconnect.to/`, `${ID}.xx1.quickconnect.to`, ` "https://QuickConnect.cn/${ID}" `]) {
    assert.deepEqual(parseQuickConnect(value), { id: ID, explicit: true }, value);
  }
  for (const value of ['nas.example.com', '192.0.2.10', '192.0.2.10:5000', 'http://nas.example.com:5000', 'https://quickconnect.to/', 'global.quickconnect.to', 'https://quickconnect.to:8443/x', '9lives', 'user@quickconnect.to/x', 'example.com/quickconnect.to']) {
    assert.equal(parseQuickConnect(value), undefined, value);
  }
});

test('md5 matches RFC 1321 vectors and Node across block boundaries', () => {
  assert.equal(md5(''), 'd41d8cd98f00b204e9800998ecf8427e');
  assert.equal(md5('abc'), '900150983cd24fb0d6963f7d28e17f72');
  assert.equal(md5('The quick brown fox jumps over the lazy dog'), '9e107d9d372bb6826bd81d3542a419d6');
  for (const text of ['x'.repeat(55), 'x'.repeat(56), 'x'.repeat(64), 'y'.repeat(200), '名稱'.repeat(30)]) assert.equal(md5(text), createHash('md5').update(text).digest('hex'), String(text.length));
});

test('candidates follow the portal order: LAN, outside, then HTTP; link-local and NULL are skipped', () => {
  const list = quickConnectCandidates([info(true), info(false)]);
  assert.deepEqual(list.map(c => [c.origin, c.kind]), [
    [`https://192-168-1-20.${ID}.direct.quickconnect.to:5001`, 'lan'],
    ['https://192.168.1.20:5001', 'lan'],
    ['https://example.synology.me:5001', 'wan'], ['https://example.synology.me:15001', 'wan'],
    [`https://${ID}.direct.quickconnect.to:5001`, 'wan'], [`https://${ID}.direct.quickconnect.to:15001`, 'wan'],
    ['https://198.51.100.7:5001', 'wan'], ['https://198.51.100.7:15001', 'wan'],
    ['http://192.168.1.20:5000', 'lan'], ['http://example.synology.me:5000', 'wan'], ['http://198.51.100.7:5000', 'wan'],
  ]);
  assert.equal(relayOrigin(ID, 'xx1', 'cc1.quickconnect.to'), `https://${ID}.xx1.quickconnect.to`);
  assert.equal(relayOrigin(ID, 'bad region', 'cc1.quickconnect.to'), undefined);
});

test('lookup follows the control server to the NAS region and names unknown or offline IDs', async () => {
  const asked: string[] = [];
  const found = await lookupQuickConnect(ID, async url => {
    asked.push(url);
    return url.includes('global.') ? [{ errno: 4, suberrno: 2, sites: ['cc1.quickconnect.to'] }] : [info(true), info(false)];
  });
  assert.deepEqual(asked, ['https://global.quickconnect.to/Serv.php', 'https://cc1.quickconnect.to/Serv.php']);
  assert.ok(found.ok && found.ezid === EZID && found.candidates.length === 11);
  assert.deepEqual(await lookupQuickConnect(ID, async () => [{ errno: 4, suberrno: 1 }]), { ok: false, code: 'qcNotFound' });
  assert.deepEqual(await lookupQuickConnect(ID, async () => [{ errno: 4, suberrno: 0, sites: [] }]), { ok: false, code: 'qcOffline' });
  assert.deepEqual(await lookupQuickConnect(ID, async () => { throw new Error('offline'); }), { ok: false, code: 'qcFailed' });
  // Only Synology's own control servers are followed
  const redirected: string[] = [];
  await lookupQuickConnect(ID, async url => { redirected.push(url); return [{ errno: 4, suberrno: 2, sites: ['evil.example.com'] }]; });
  assert.deepEqual(redirected, ['https://global.quickconnect.to/Serv.php']);
});

const pingpong = (ezid = EZID) => ({ status: 200, body: JSON.stringify({ success: true, boot_done: true, ezid }) });
const trusted = { sha256: 'a'.repeat(64), trusted: true, chainTrusted: true, hostnameMatch: true, expired: false };
const tick = () => new Promise(resolve => setTimeout(resolve, 0));
type Gate = { promise: Promise<ProbeResponse>; resolve(value: ProbeResponse): void };
const gate = (): Gate => { let resolve!: Gate['resolve']; const promise = new Promise<ProbeResponse>(r => { resolve = r; }); return { promise, resolve }; };

function qcProber(answers: Record<string, ProbeResponse | Gate>, graceMs = 50) {
  const calls: string[] = [], cancelled: string[] = [], byId = new Map<string, string>();
  let n = 0;
  const post = async (url: string, body: unknown) => {
    const command = (body as { command: string }[])[0].command;
    return command === 'request_tunnel' ? [info(true, { service: { port: 5001, ext_port: 0, relay_ip: '203.0.113.1', relay_port: 443 } })] : [info(true), info(false)];
  };
  const p = new NasProber(async (url, id) => {
    calls.push(url); byId.set(id, url);
    const answer = answers[url.replace(/\/webman\/pingpong\.cgi.*$|\/webapi\/query\.cgi.*$/, '')];
    if (!answer) return { error: 'refused' };
    return 'promise' in answer ? answer.promise : answer;
  }, id => cancelled.push(byId.get(id) || id), () => `p${++n}`, { post, graceMs });
  return { p, calls, cancelled };
}
const lanSmart = `https://192-168-1-20.${ID}.direct.quickconnect.to:5001`, wanDdns = 'https://example.synology.me:5001', relay = `https://${ID}.xx1.quickconnect.to`;

test('all addresses are probed at once and the best one wins as soon as nothing can beat it', async () => {
  const lan = gate(), wan = gate();
  const { p, calls, cancelled } = qcProber({ [lanSmart]: lan, [wanDdns]: wan, [relay]: { ...pingpong(), tls: trusted } });
  p.start(`https://quickconnect.to/${ID}`);
  for (let i = 0; i < 5; i++) await tick();
  // Every reported address and the relay are already in flight
  assert.equal(calls.filter(u => u.includes('pingpong')).length, 12);
  assert.equal(p.state.best, undefined, 'the relay answered but a LAN address could still beat it');
  lan.resolve({ ...pingpong(), tls: trusted }); await tick(); await tick();
  assert.equal(p.state.best, lanSmart);
  assert.equal(p.state.settled, true);
  assert.ok(cancelled.some(u => u.startsWith(wanDdns)), 'lesser probes are stopped');
  assert.equal(p.quickConnectId(), ID);
});

test('a lesser answer is shown after the grace and replaced when a better one answers', async () => {
  const lan = gate();
  const { p } = qcProber({ [lanSmart]: lan, [wanDdns]: { ...pingpong(), tls: trusted } }, 300);
  p.start(ID);
  for (let i = 0; i < 5; i++) await tick();
  assert.equal(p.state.best, undefined);
  await new Promise(resolve => setTimeout(resolve, 450));
  assert.equal(p.state.best, wanDdns); assert.equal(p.state.settled, false); assert.equal(p.state.phase, 'probing');
  lan.resolve({ ...pingpong(), tls: trusted }); await tick(); await tick();
  assert.equal(p.state.best, lanSmart); assert.equal(p.state.settled, true);
});

test('an address that answers with another NAS fingerprint is never taken', async () => {
  const { p } = qcProber({ 'https://192.168.1.20:5001': { ...pingpong('f'.repeat(32)), tls: trusted } });
  p.start(`${ID}.quickconnect.to`);
  for (let i = 0; i < 8; i++) await tick();
  assert.equal(p.state.best, undefined);
  assert.equal(p.state.candidates.find(c => c.origin === 'https://192.168.1.20:5001')?.cause, 'wrongNas');
  assert.equal(mainCause(p.state), 'wrongNas');
});

test('when every address fails, one main cause names it', async () => {
  const fail = (cause: string) => new NasProber(async () => ({ error: cause }), () => {}, (() => { let n = 0; return () => `x${++n}`; })());
  for (const [cause, expected] of [['dns', 'dns'], ['refused', 'refused'], ['timeout', 'timeout'], ['certificate', 'certificate'], ['tls', 'certificate']] as const) {
    const p = fail(cause); p.start('nas.example.com');
    for (let i = 0; i < 4; i++) await tick();
    assert.equal(p.state.phase, 'done'); assert.equal(mainCause(p.state), expected, cause);
  }
  // An address that got further explains more than names that did not resolve
  const mixed = new NasProber(async url => url.startsWith('http://nas.example.com:5000') ? { error: 'refused' } : { error: 'dns' }, () => {}, () => String(Math.random()));
  mixed.start('nas.example.com'); for (let i = 0; i < 4; i++) await tick();
  assert.equal(mainCause(mixed.state), 'refused');
  // Something answered, but not DSM
  const other = new NasProber(async () => ({ status: 404, body: 'nginx' }), () => {}, () => String(Math.random()));
  other.start('nas.example.com'); for (let i = 0; i < 4; i++) await tick();
  assert.equal(mainCause(other.state), 'other');
});

test('a QuickConnect ID the directory does not know, or a NAS that is offline, is named', async () => {
  for (const [errno, expected] of [[1, 'qcNotFound'], [0, 'qcOffline']] as const) {
    const p = new NasProber(async () => ({ error: 'dns' }), () => {}, () => String(Math.random()), { post: async () => [{ errno: 4, suberrno: errno, sites: [] }] });
    p.start(`https://quickconnect.to/${ID}`); for (let i = 0; i < 4; i++) await tick();
    assert.equal(p.state.phase, 'done'); assert.equal(mainCause(p.state), expected);
  }
  // A bare word is also a LAN host name: an unknown ID does not hide why the host failed
  const bare = new NasProber(async () => ({ error: 'refused' }), () => {}, () => String(Math.random()), { post: async () => [{ errno: 4, suberrno: 1 }] });
  bare.start('mynas'); for (let i = 0; i < 6; i++) await tick();
  assert.equal(mainCause(bare.state), 'refused');
});
