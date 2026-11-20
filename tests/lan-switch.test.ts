import test from 'node:test';
import assert from 'node:assert/strict';
import { answerSdp, candidateOk, connectEndpoint, findLan, lanLauncher, privateIPv4, readProbe, shouldProbe, type LanProbe, type Peer } from '../src/core/lan-switch/check.ts';
import { lanSwitchLocales, lanSwitchStrings } from '../src/core/lan-switch/strings.ts';

const probe = (over: Partial<LanProbe> = {}): LanProbe => ({ enabled: true, ufrag: 'abcdefgh', pwd: 'abcdefghijklmnopqrstuvwxyz', https: false, candidates: [
  { address: '192.168.1.10', port: 45001, url: 'http://192.168.1.10:5000' },
  { address: '10.0.0.5', port: 45001, url: 'http://10.0.0.5:5000' },
], ...over });

/** A fake peer: connects (or fails) after a delay when its remote answer names an address */
type Plan = Record<string, { state: 'connected' | 'failed' | 'never'; ms: number }>;
function peers(plan: Plan) {
  const made: (Peer & { closed: boolean })[] = [];
  const make = () => {
    const peer = {
      iceConnectionState: 'new', oniceconnectionstatechange: null as (() => void) | null, closed: false,
      createDataChannel: () => ({}),
      createOffer: async () => ({ type: 'offer', sdp: 'v=0' }),
      setLocalDescription: async () => undefined,
      async setRemoteDescription(d: { sdp: string }) {
        const address = d.sdp.split('a=candidate:1 1 tcp 1518280447 ')[1]?.split(' ')[0] ?? '';
        const p = plan[address] ?? { state: 'never', ms: 0 };
        if (p.state !== 'never') setTimeout(() => { if (peer.closed) return; peer.iceConnectionState = p.state; peer.oniceconnectionstatechange?.(); }, p.ms);
      },
      close() { peer.closed = true; peer.iceConnectionState = 'closed'; },
    };
    made.push(peer);
    return peer;
  };
  return { made, make };
}

test('lan switch: only an https page on a DNS name checks', () => {
  assert.equal(shouldProbe({ protocol: 'https:', hostname: 'nas.example.com' }), true);
  assert.equal(shouldProbe({ protocol: 'https:', hostname: 'abc.trycloudflare.com' }), true);
  for (const [protocol, hostname] of [['http:', 'nas.example.com'], ['https:', '192.168.1.10'], ['https:', '[fd00::1]'], ['https:', 'diskstation'], ['https:', 'diskstation.local'], ['https:', 'nas.example.com.']])
    assert.equal(shouldProbe({ protocol, hostname }), false, hostname);
});

test('lan switch: a candidate is a private IPv4 origin on its own address', () => {
  for (const a of ['10.1.2.3', '172.17.0.1', ...[16, 31].map(n => `172.${n}.0.1`), '192.168.0.1']) assert.equal(privateIPv4(a), true, a);
  for (const a of ['100.64.0.1', '172.32.0.1', '8.8.8.8', '192.169.0.1', '010.0.0.1', '1.2.3', '256.1.1.1']) assert.equal(privateIPv4(a), false, a);
  assert.equal(candidateOk({ address: '192.168.1.10', port: 45001, url: 'https://192.168.1.10:5001' }), true);
  for (const url of ['http://192.168.1.11:5000', 'http://192.168.1.10:5000/x', 'http://192.168.1.10:5000?q', 'http://u:p@192.168.1.10:5000', 'ftp://192.168.1.10', 'javascript:alert(1)'])
    assert.equal(candidateOk({ address: '192.168.1.10', port: 45001, url }), false, url);
  assert.equal(candidateOk({ address: '192.168.1.10', port: 0, url: 'http://192.168.1.10:5000' }), false);
});

test('lan switch: the answer offers one passive TCP host candidate with the issued credentials', () => {
  const sdp = answerSdp('abcdefgh', 'pw', { address: '192.168.1.10', port: 45001, url: 'http://192.168.1.10:5000' });
  assert.ok(sdp.includes('a=ice-lite'));
  assert.ok(sdp.includes('a=ice-ufrag:abcdefgh\r\na=ice-pwd:pw'));
  assert.ok(sdp.includes('a=candidate:1 1 tcp 1518280447 192.168.1.10 45001 typ host tcptype passive'));
  assert.equal(sdp.match(/a=candidate/g)?.length, 1);
});

test('lan switch: the first address to connect wins and every other check stops', async () => {
  const { made, make } = peers({ '192.168.1.10': { state: 'connected', ms: 40 }, '10.0.0.5': { state: 'connected', ms: 10 } });
  const found = await findLan(probe(), { make });
  assert.equal(found?.url, 'http://10.0.0.5:5000');
  assert.equal(found?.https, false);
  assert.equal(made.length, 2);
  assert.ok(made.every(p => p.closed));
});

test('lan switch: nothing is offered when no check connects in time, and a late success is ignored', async () => {
  const none = peers({ '192.168.1.10': { state: 'never', ms: 0 }, '10.0.0.5': { state: 'failed', ms: 5 } });
  assert.equal(await findLan(probe(), { make: none.make, timeoutMs: 60 }), undefined);
  assert.ok(none.made.every(p => p.closed));
  const late = peers({ '192.168.1.10': { state: 'connected', ms: 120 } });
  assert.equal(await findLan(probe({ candidates: [probe().candidates[0]] }), { make: late.make, timeoutMs: 40 }), undefined);
});

test('lan switch: anything uncertain offers nothing', async () => {
  const { make } = peers({ '192.168.1.10': { state: 'connected', ms: 1 }, '10.0.0.5': { state: 'connected', ms: 1 } });
  assert.equal(await findLan(undefined, { make }), undefined);
  assert.equal(await findLan(probe({ enabled: false }), { make }), undefined);
  assert.equal(await findLan(probe({ ufrag: 'short' }), { make }), undefined);
  assert.equal(await findLan(probe({ pwd: 'has space in it padded out' }), { make }), undefined);
  assert.equal(await findLan(probe({ candidates: [{ address: '8.8.8.8', port: 45001, url: 'http://8.8.8.8:5000' }] }), { make }), undefined);
  assert.equal(await findLan(probe(), { make: () => { throw new Error('no WebRTC'); } }), undefined);
  const stop = new AbortController(); stop.abort();
  assert.equal(await findLan(probe(), { make, signal: stop.signal }), undefined);
});

test('lan switch: the probe comes from Connect on this origin with the session token, and any failure is nothing', async () => {
  assert.equal(connectEndpoint('/webman/3rdparty/SynoPkgConnect/app/m/index.html'), '/webman/3rdparty/SynoPkgConnect/cgi/api.cgi');
  assert.equal(connectEndpoint('/m'), '/webman/3rdparty/SynoPkgConnect/cgi/api.cgi');
  const calls: { url: string; init?: { method?: string; headers?: Record<string, string>; body?: string } }[] = [];
  const reply = (value: unknown, ok = true) => Promise.resolve({ ok, json: async () => value });
  const fetchOk = (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string }) => {
    calls.push({ url, init });
    return url.includes('login.cgi') ? reply({ success: true, SynoToken: 'tok' }) : reply({ success: true, data: probe() });
  };
  const got = await readProbe(fetchOk, 'https://nas.example.com', '/webman/3rdparty/SynoPkgConnect/app/m/index.html');
  assert.deepEqual(got, probe());
  assert.equal(calls[0].url, 'https://nas.example.com/webman/login.cgi?enable_syno_token=yes');
  assert.equal(calls[1].url, 'https://nas.example.com/webman/3rdparty/SynoPkgConnect/cgi/api.cgi');
  assert.equal(calls[1].init?.headers?.['X-SYNO-TOKEN'], 'tok');
  assert.deepEqual(JSON.parse(calls[1].init?.body ?? ''), { method: 'phone.lanprobe', params: {} });
  const signedOut = () => reply({ success: false });
  assert.equal(await readProbe(signedOut, 'https://nas.example.com', '/m'), undefined);
  const refused = (url: string) => url.includes('login.cgi') ? reply({ success: true, SynoToken: 'tok' }) : reply({ success: false, error: { code: 'forbidden' } });
  assert.equal(await readProbe(refused, 'https://nas.example.com', '/m'), undefined);
  const broken = () => Promise.reject(new Error('network'));
  assert.equal(await readProbe(broken, 'https://nas.example.com', '/m'), undefined);
});

test('lan switch: the launcher opens at the same path on the local address', () => {
  const page = 'https://nas.example.com/webman/3rdparty/SynoPkgConnect/app/m/index.html';
  assert.equal(lanLauncher({ url: 'http://192.168.1.10:5000', https: false, ms: 1 }, page), 'http://192.168.1.10:5000/webman/3rdparty/SynoPkgConnect/app/m/index.html');
  assert.equal(lanLauncher({ url: 'https://192.168.1.10:5001', https: true, ms: 1 }, page), 'https://192.168.1.10:5001/webman/3rdparty/SynoPkgConnect/app/m/index.html');
  assert.equal(lanLauncher({ url: 'not a url', https: false, ms: 1 }, page), undefined);
});

test('lan switch copy: nine locales, every key, no trailing periods or ellipses', () => {
  const keys = Object.keys(lanSwitchLocales.en).sort();
  assert.deepEqual(Object.keys(lanSwitchLocales).sort(), ['de', 'en', 'es', 'fr', 'it', 'ja', 'ko', 'zh-CN', 'zh-TW']);
  for (const [name, table] of Object.entries(lanSwitchLocales)) {
    assert.deepEqual(Object.keys(table).sort(), keys, name);
    for (const [key, text] of Object.entries(table)) {
      assert.ok(text, `${name}.${key} is empty`);
      assert.ok(!/[.。]$/.test(text), `${name}.${key} ends with a period`);
      assert.ok(!/(\.\.\.|…)/.test(text), `${name}.${key} contains an ellipsis`);
    }
  }
  assert.equal(lanSwitchStrings('zh-Hant-TW'), lanSwitchLocales['zh-TW']);
  assert.equal(lanSwitchStrings('pt-BR'), lanSwitchLocales.en);
});
