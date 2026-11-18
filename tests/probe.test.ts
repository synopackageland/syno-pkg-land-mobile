import test from 'node:test';
import assert from 'node:assert/strict';
import { AddressError, NasProber, candidateOrigins, certState, hostName, parseAddress, redirectPorts, serverName, type ProbeResponse } from '../src/core/profiles/probe.ts';

const dsm = JSON.stringify({ success: true, data: { 'SYNO.API.Auth': { path: 'entry.cgi', minVersion: 1, maxVersion: 7 } } });
const trusted = { sha256: 'a'.repeat(64), trusted: true, chainTrusted: true, hostnameMatch: true, expired: false };
const selfSigned = { sha256: 'b'.repeat(64), trusted: false, chainTrusted: false, hostnameMatch: false, expired: false };
const redirectPage = '<input type="hidden" id="http" name="http" value="5080">\n<input type="hidden" id="https" name="https" value="5443">';

test('addresses need no scheme and keep typed ports, IPv6 and URLs', () => {
  assert.deepEqual(parseAddress('nas.example.com'), { host: 'nas.example.com' });
  assert.deepEqual(parseAddress(' 192.0.2.10 '), { host: '192.0.2.10' });
  assert.deepEqual(parseAddress('https://NAS.example.com:5001/webman/index.cgi?x#y'), { host: 'nas.example.com', port: 5001, scheme: 'https' });
  assert.deepEqual(parseAddress('nas.example.com:80'), { host: 'nas.example.com', port: 80 });
  assert.deepEqual(parseAddress('http://nas.example.com:80'), { host: 'nas.example.com', port: 80, scheme: 'http' });
  assert.deepEqual(parseAddress('[2001:db8::1]:5001'), { host: '[2001:db8::1]', port: 5001 });
  assert.deepEqual(parseAddress('mynas'), { host: 'mynas' });
  for (const [value, code] of [['', 'empty'], ['  ', 'empty'], ['ftp://nas', 'scheme'], ['user:pw@nas.example.com', 'credentials'], ['nas example', 'invalid'], ['nas:99999', 'invalid']] as const) {
    assert.throws(() => parseAddress(value), (e: unknown) => e instanceof AddressError && e.code === code, value);
  }
});

test('candidate origins cover the typed port, DSM defaults and proxy ports', () => {
  assert.deepEqual(candidateOrigins(parseAddress('nas.example.com')), ['https://nas.example.com:5001', 'http://nas.example.com:5000', 'https://nas.example.com', 'http://nas.example.com']);
  assert.deepEqual(candidateOrigins(parseAddress('nas.example.com:80')), ['https://nas.example.com:80', 'http://nas.example.com', 'https://nas.example.com:5001', 'http://nas.example.com:5000']);
  assert.deepEqual(candidateOrigins(parseAddress('http://192.0.2.10:5000')), ['http://192.0.2.10:5000', 'https://192.0.2.10:5001']);
});

test('server names come from the DSM sign-in title; generic titles fall back to the host', () => {
  assert.equal(serverName('<title>EXAMPLE-NAS&nbsp;-&nbsp;Synology&nbsp;NAS</title>'), 'EXAMPLE-NAS');
  assert.equal(serverName('<title>Home Vault - Synology DiskStation</title>'), 'Home Vault');
  assert.equal(serverName('<title>DSM mobile - EXAMPLE-NAS</title>'), 'EXAMPLE-NAS');
  assert.equal(serverName('<title>Synology NAS</title>'), undefined);
  assert.equal(serverName('<html></html>'), undefined);
  assert.equal(hostName('nas.example.com'), 'nas');
  assert.equal(hostName('192.0.2.10'), '192.0.2.10');
  assert.deepEqual(redirectPorts(redirectPage), { http: 5080, https: 5443 });
});

test('certificate state separates trusted, self-signed, wrong name, expired, changed and HTTP', () => {
  assert.equal(certState('http://nas.example.com:5000', null), 'http');
  assert.equal(certState('https://nas.example.com', trusted), 'trusted');
  assert.equal(certState('https://192.0.2.10:5001', selfSigned), 'untrusted');
  assert.equal(certState('https://192.0.2.10:5001', selfSigned, selfSigned.sha256), 'trusted');
  assert.equal(certState('https://192.0.2.10:5001', selfSigned, 'c'.repeat(64)), 'changed');
  assert.equal(certState('https://192.0.2.10', { ...trusted, trusted: false, hostnameMatch: false }), 'mismatch');
  assert.equal(certState('https://192.0.2.10', { ...trusted, expired: true }), 'expired');
});

function prober(answers: Record<string, ProbeResponse | Promise<ProbeResponse>>) {
  const calls: string[] = [], cancelled: string[] = [];
  let id = 0;
  const p = new NasProber(async url => { calls.push(url); return answers[url] ?? { error: 'refused' }; }, id => cancelled.push(id), () => `p${++id}`);
  return { p, calls, cancelled };
}
const settle = () => new Promise(resolve => setTimeout(resolve, 0));
const info = '/webapi/query.cgi?api=SYNO.API.Info&version=1&method=query&query=SYNO.API.Auth';

test('a bare host prefers verified HTTPS and reads the server name', async () => {
  const { p } = prober({
    [`https://nas.example.com${info}`]: { status: 200, body: dsm, tls: trusted },
    [`http://nas.example.com:5000${info}`]: { status: 200, body: dsm },
    [`https://nas.example.com:5001${info}`]: { error: 'refused' },
    'https://nas.example.com/': { status: 200, body: '<title>Vault - Synology NAS</title>' },
  });
  p.start('nas.example.com'); await settle(); await settle();
  assert.equal(p.state.phase, 'done');
  assert.equal(p.state.best, 'https://nas.example.com');
  assert.equal(p.defaultName(), 'Vault');
  assert.equal(p.state.candidates.find(c => c.origin === 'https://nas.example.com:5001')?.cause, 'refused');
});

test('a wrong port follows the DSM redirect page to its real ports', async () => {
  const { p } = prober({
    [`http://nas.example.com${info}`]: { status: 200, body: redirectPage },
    [`https://nas.example.com:80${info}`]: { error: 'tls' },
    [`https://nas.example.com:5443${info}`]: { status: 200, body: dsm, tls: selfSigned },
    [`http://nas.example.com:5080${info}`]: { status: 200, body: dsm },
  });
  p.start('nas.example.com:80'); for (let i = 0; i < 6; i++) await settle();
  assert.equal(p.state.best, 'https://nas.example.com:5443');
  assert.equal(p.defaultName(), 'nas');
  // Nothing pending could beat it, so the lesser HTTP probe was stopped and is not offered
  assert.equal(p.state.settled, true);
  p.choose('http://nas.example.com:9'); assert.equal(p.state.best, 'https://nas.example.com:5443');
});

test('slow probes have no deadline; cancel closes them and ignores late answers', async () => {
  let release!: (value: ProbeResponse) => void;
  const slow = new Promise<ProbeResponse>(resolve => { release = resolve; });
  const { p, cancelled } = prober({ [`https://nas.example.com:5001${info}`]: slow });
  p.start('nas.example.com'); await settle();
  assert.equal(p.state.phase, 'probing');
  p.cancel();
  assert.equal(p.state.phase, 'done'); assert.ok(cancelled.length >= 1);
  release({ status: 200, body: dsm, tls: trusted }); await settle();
  assert.equal(p.state.best, undefined);
  assert.equal(p.state.candidates.find(c => c.origin === 'https://nas.example.com:5001')?.state, 'cancelled');
});

test('invalid input reports a code without probing', () => {
  const { p, calls } = prober({});
  p.start('ftp://nas'); assert.equal(p.state.error, 'scheme'); assert.equal(calls.length, 0);
});
