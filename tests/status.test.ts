import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { formatNotice, mapHealth, mapLastRead, mapNoticeStrings, mapNotifications, mapOverview, mapStorage, mapUser, mapUtilization, parseUptime } from '../src/core/status/mappers.ts';
import { formatBytes, formatRate, groupByDay, dayLabel, uptimeParts, usedOfTotal } from '../src/core/status/format.ts';
import { modules } from '../src/core/status/modules/index.ts';
import { dsmLabel, mapUpgrade, pendingUpdate, releaseShort, updatePageUrl } from '../src/core/status/modules/upgrade.ts';
import { StatusModel, calls, dsmLang, isUnread, moreUnread, unreadCount, type StatusStorage, type StatusSnapshot, type ReadState } from '../src/core/status/model.ts';

const nas = JSON.parse(readFileSync('tests/fixtures/status/nas.json', 'utf8'));
const origin = 'https://nas.example.com:5001';
/** SYNO.Core.Upgrade.Server check v4 as DSM 7.4.1 answers it with a nano update waiting */
const upgradeAnswer = {
  promotion: { available: false, rss_result: 'success' },
  security_version: { available: true, rss_result: 'success', type: 'nano', version: 'DSM 7.4.1-90080 Update 2', version_details: { buildnumber: 90080, isSecurityVersion: true, major: 7, micro: 1, minor: 4, nano: 2, os_name: 'DSM' } },
  update: { available: true, reboot: 'now', restart: 'some', rss_result: 'success', type: 'nano', version: 'DSM 7.4.1-90080 Update 2', version_details: { buildnumber: 90080, isSecurityVersion: true, major: 7, micro: 1, minor: 4, nano: 2, os_name: 'DSM' } },
};

test('utilization maps CPU, memory (KiB to bytes), network and disk rates', () => {
  const u = mapUtilization(nas.util);
  assert.equal(u.cpu?.percent, 2);
  assert.equal(u.cpu?.load1, 0.33);
  assert.equal(u.memory?.percent, 50);
  assert.equal(u.memory?.total, 1988008 * 1024);
  assert.equal(u.memory?.used, Math.round(1988008 * 0.5) * 1024);
  assert.deepEqual([u.network?.rx, u.network?.tx], [4544, 1927]);
  assert.equal(u.network?.interfaces.length, 4);
  assert.ok(!u.network?.interfaces.some(i => i.id === 'total'));
  assert.deepEqual(u.disk?.disks[0], { id: 'sata1', busy: 0, read: 43756, write: 58415 });
  assert.equal(u.disk?.read, 43756);
  // Missing sections stay undefined rather than zero
  assert.deepEqual(mapUtilization({}), { time: undefined });
  assert.deepEqual(mapUtilization(null), { time: undefined });
});
test('overview, health, storage and account map with tolerant parsing', () => {
  const o = mapOverview(nas.overview);
  assert.equal(o.model, 'RS822+');
  assert.equal(o.cpuName, 'AMD Ryzen V1500B');
  assert.equal(o.cores, 4);
  assert.equal(o.temp, 42);
  assert.equal(o.uptime, 114 * 3600 + 33 * 60 + 5);
  const h = mapHealth(nas.health);
  assert.equal(h.disks.length, 1);
  assert.deepEqual({ ...h.disks[0] }, { id: 'sata1', name: 'Drive 1', order: 1, model: 'HDN724040ALE640', vendor: 'HGST', firmware: 'MJAOA5E0', size: 4000787030016, temp: 42, ssd: false, status: 'normal', type: 'SATA', location: 'Main' });
  assert.equal(h.model, 'RS822+');
  assert.ok(h.uptime! > 0);
  assert.equal(h.links.filter(l => l.up).length, 1);
  assert.equal(h.links.find(l => l.up)?.speed, 1000);
  assert.deepEqual(mapHealth({ disks: [{ id: 'sata2', order: 2, overview_status: 'crashed' }, { id: 'sata1', order: 1, smart_status: 'warning' }] }).disks.map(d => [d.id, d.status]), [['sata1', 'warning'], ['sata2', 'danger']]);
  const v = mapStorage(nas.storage);
  assert.equal(v[0].name, 'volume1');
  assert.equal(v[0].total, 3830198149120);
  assert.equal(v[0].status, 'normal');
  assert.equal(v[0].state, undefined);
  // Crashed, degraded and read-only volumes carry their state; read-only comes from is_writable or the status
  const size = { total: '100', used: '10' };
  assert.deepEqual(mapStorage({ volumes: [
    { id: 'volume_1', vol_path: '/volume1', size, status: 'crashed', summary_status: 'crashed' },
    { id: 'volume_2', vol_path: '/volume2', size, status: 'degrade', summary_status: 'degrade' },
    { id: 'volume_3', vol_path: '/volume3', size, status: 'normal', summary_status: 'normal', is_writable: false },
    { id: 'volume_4', vol_path: '/volume4', size, status: 'read_only', summary_status: 'attention' },
    { id: 'volume_5', vol_path: '/volume5', size, status: 'normal', summary_status: 'normal', is_writable: true },
  ] }).map(x => [x.name, x.status, x.state]), [['volume1', 'danger', 'crashed'], ['volume2', 'warning', 'degraded'], ['volume3', 'warning', 'readonly'], ['volume4', 'warning', 'readonly'], ['volume5', 'normal', undefined]]);
  assert.deepEqual(mapUser(nas.user), { user: 'normal-user', admin: false, hostname: 'nas-example', dsm: undefined, update: undefined, build: undefined });
  // The DSM build keys the capability table: product version, full version and small fix
  assert.deepEqual(mapUser({ Session: { user: 'a', productversion: '7.4.1', fullversion: '90080', smallfixnumber: 1 } }).build, '7.4.1-90080-1');
  // The build number for the version label: `version`, else the digits of `fullversion`
  assert.equal(mapUser({ Session: { productversion: '7.4.1', version: '90080', fullversion: '90080-s0' } }).buildNumber, 90080);
  assert.equal(mapUser({ Session: { productversion: '7.3.2', fullversion: '86009-s3' } }).buildNumber, 86009);
  assert.equal(parseUptime('1:2:3'), 3723);
  assert.equal(parseUptime('bad'), undefined);
  assert.equal(parseUptime(5), undefined);
});
test('DSM update: check v1 to v4 map to the release DSM offers, never an error or noise', () => {
  const next = mapUpgrade(upgradeAnswer).available!;
  assert.deepEqual(next, { version: 'DSM 7.4.1-90080 Update 2', kind: 'update', security: true, major: 7, minor: 4, micro: 1, build: 90080, nano: 2 });
  // v1 answers the update alone, unnested
  assert.deepEqual(mapUpgrade(upgradeAnswer.update).available, next);
  // Up to date, a failed server check (rss_result) or an odd answer: nothing to offer
  assert.equal(mapUpgrade({ update: { available: false, rss_result: 'success' }, promotion: { available: false } }).available, undefined);
  assert.equal(mapUpgrade({ update: { available: false, rss_result: 'server_error' } }).available, undefined);
  assert.equal(mapUpgrade({ update: { available: true } }).available, undefined, 'no version, no tag');
  assert.equal(mapUpgrade(null).available, undefined);
  // A new major version when no update of this one is waiting
  const promotion = mapUpgrade({ update: { available: false }, promotion: { available: true, version: 'DSM 8.0-10000', version_details: { major: 8, minor: 0, micro: 0, buildnumber: 10000, nano: 0 } } }).available!;
  assert.equal(promotion.kind, 'promotion');
});
test('DSM update: the version label, and an offer only while it is newer than DSM now', () => {
  const user = { dsm: '7.4.1', buildNumber: 90080, update: 1 };
  assert.equal(dsmLabel(user), 'DSM 7.4.1-90080 Update 1');
  assert.equal(dsmLabel({ dsm: '7.4.1', buildNumber: 90080 }), 'DSM 7.4.1-90080');
  assert.equal(dsmLabel({ dsm: '7.4.1' }), 'DSM 7.4.1');
  assert.equal(dsmLabel({}), undefined);
  const offer = mapUpgrade(upgradeAnswer);
  assert.ok(pendingUpdate(offer, user));
  assert.ok(pendingUpdate(offer, { dsm: '7.4.1', buildNumber: 90080 }));
  // Installed since DSM stored the answer, or an older one: no offer
  assert.equal(pendingUpdate(offer, { ...user, update: 2 }), undefined);
  assert.equal(pendingUpdate(offer, { dsm: '7.4.2', buildNumber: 90100 }), undefined);
  // The current version unknown yet: DSM's answer stands
  assert.ok(pendingUpdate(offer, undefined));
  assert.equal(pendingUpdate(undefined, user), undefined);
  // The tag's short name: "Update 2" on this build, else DSM's version without "DSM"
  assert.equal(releaseShort(offer.available!, user), 'Update 2');
  assert.equal(releaseShort(offer.available!, { dsm: '7.3.2', buildNumber: 86009 }), '7.4.1-90080 Update 2');
  assert.equal(updatePageUrl('https://nas.example.com:5001/'), 'https://nas.example.com:5001/?launchApp=SYNO.SDS.AdminCenter.Application&launchParam=fn%3DSYNO.SDS.AdminCenter.Update_Reset.Main');
});
test('DSM update: read from DSM\'s stored result once an hour on Home; normal users see only the version', async () => {
  const { model, nas: n, clock: c } = setup();
  model.select('p1', origin, 'scope-a'); model.setMode('home');
  await c.advance(0);
  const checks = () => n.requests.flatMap(r => r.items).filter(i => i.startsWith('SYNO.Core.Upgrade.Server'));
  assert.equal(checks().length, 1);
  // Never a fresh online check, a download or an install
  const call = JSON.parse(new URL(n.requests[0].url).searchParams.get('compound')!).find((x: { api: string }) => x.api === 'SYNO.Core.Upgrade.Server');
  assert.equal(call.method, 'check'); assert.equal(call.ignore_cache, undefined); assert.equal(call.user_reading, undefined);
  assert.equal(model.state.snapshot?.upgrade?.available?.version, 'DSM 7.4.1-90080 Update 2');
  await c.advance(59 * 60_000);
  assert.equal(checks().length, 1);
  await c.advance(2 * 60_000);
  assert.equal(checks().length, 2);
  // Normal users: DSM answers 105; the item is hidden without an error
  const normal = setup('normal');
  normal.model.select('p1', origin, 'scope-n'); normal.model.setMode('home');
  await normal.clock.advance(0);
  assert.ok(normal.model.state.snapshot?.denied.includes('upgrade'));
  assert.equal(normal.model.state.snapshot?.upgrade, undefined);
  assert.equal(normal.model.state.error, undefined);
});
test('sizes are 1024-based and labelled GB the DSM way', () => {
  assert.equal(formatBytes(1024 ** 3), '1 GB');
  assert.equal(formatBytes(1.5 * 1024 ** 3), '1.5 GB');
  assert.equal(formatBytes(3830198149120), '3.5 TB');
  assert.equal(formatBytes(512), '512 B');
  assert.equal(usedOfTotal(4 * 1024 ** 3, 16 * 1024 ** 3), '4 / 16 GB');
  assert.equal(usedOfTotal(512 * 1024 ** 2, 2 * 1024 ** 3), '512 MB / 2 GB');
  assert.equal(formatBytes(250 * 1024 ** 2), '250 MB');
  assert.equal(formatBytes(undefined), '-');
  assert.equal(formatRate(4544), '4.4 KB/s');
  assert.deepEqual(uptimeParts(129 * 86400 + 14 * 60 + 43), { days: 129, hours: 0, minutes: 14, seconds: 43 });
});
test('notifications map newest first and fill catalog templates', () => {
  const list = mapNotifications(nas.notify);
  assert.equal(list.items.length, 4);
  assert.ok(list.items.every((item, i, all) => !i || all[i - 1].time >= item.time));
  assert.equal(list.newest, nas.notify.newestMsgTime);
  const strings = mapNoticeStrings(nas.strings);
  const first = formatNotice(list.items[0], strings);
  assert.equal(first.title, 'Container Manager');
  assert.equal(first.message, 'Container app-db-1 stopped unexpectedly. Go to Container Manager for more information');
  assert.equal(first.level, 'error');
  // Without the catalog: humanized tag and the parameter values, never the raw JSON
  const bare = formatNotice(list.items[0], undefined);
  assert.equal(bare.title, 'docker container unexpected exit');
  assert.equal(bare.message, 'app-db-1');
  // Nested parameters and markup
  const nested = formatNotice({ id: 1, time: 1, tag: 'x', level: 'info', className: '', params: { '%A%': '<b>%B%</b>', '%B%': 'disk 2' } }, { x: { title: 'Storage', msg: 'Check %A%.' } });
  assert.equal(nested.message, 'Check disk 2');
  // A package's own bracketed string key never reaches the screen; an error code in words stays
  const keyed = formatNotice({ id: 1, time: 1, tag: 'x', level: 'error', className: '', params: { '%R%': '[COMPOSE_PROJECT_RECOVERY_HINT] Repair the App\n', '%C%': '[OK] (Error code: COMPOSE_IMAGE_TLS_TRUST)' } }, { x: { title: 'Package Center', msg: 'Failed. %R%. %C%' } });
  assert.equal(keyed.message, 'Failed. Repair the App. [OK] (Error code: COMPOSE_IMAGE_TLS_TRUST)');
  assert.equal(mapLastRead(nas.lastRead), nas.notify.items[2].time);
  assert.equal(mapLastRead({}), 0);
  assert.equal(mapNotifications({ items: [{ notifyId: 1 }, 'x'] }).items.length, 0);
});
test('notifications group by local day with Today and Yesterday labels', () => {
  const now = new Date(2026, 10, 11, 9, 0, 0);
  const at = (d: number, h: number) => new Date(2026, 10, d, h).getTime() / 1000;
  const groups = groupByDay([{ time: at(11, 8) }, { time: at(11, 1) }, { time: at(10, 22) }, { time: at(3, 12) }]);
  assert.deepEqual(groups.map(g => g.items.length), [2, 1, 1]);
  const labels = { today: 'Today', yesterday: 'Yesterday' };
  assert.equal(dayLabel(groups[0].key, now, labels, 'en'), 'Today');
  assert.equal(dayLabel(groups[1].key, now, labels, 'en'), 'Yesterday');
  assert.match(dayLabel(groups[2].key, now, labels, 'en'), /Nov|11/);
  assert.equal(dsmLang('zh-Hant-TW'), 'cht');
  assert.equal(dsmLang('zh-CN'), 'chs');
  assert.equal(dsmLang('en-US'), 'enu');
});

// A fake NAS that answers the compound request item by item
type Account = 'admin' | 'normal';
function fakeNas(account: Account) {
  const requests: { url: string; items: string[] }[] = [];
  const pending: (() => void)[] = [];
  let hold = false, signedIn = true, failNext = 0, info = 0;
  const answer = (call: Record<string, unknown>) => {
    const ok = (data: unknown) => ({ ...call, success: true, data });
    const denied = (code: number) => ({ ...call, success: false, error: { code } });
    const key = `${call.api}:${call.method}:${call.type ?? ''}`;
    if (key === 'SYNO.Core.System.Utilization:get:') return account === 'admin' ? ok(nas.util) : denied(105);
    if (key === 'SYNO.Core.System:info:overview') return account === 'admin' ? ok(nas.overview) : denied(1006);
    if (key === 'SYNO.Core.System:info:systemHealth') return ok(nas.health);
    if (key === 'SYNO.Storage.CGI.Storage:load_info:') return account === 'admin' ? ok(nas.storage) : denied(105);
    if (key === 'SYNO.Core.Desktop.Initdata:get_user_service:') return ok(nas.user);
    if (key === 'SYNO.Core.DSMNotify:notify:') return ok(nas.notify);
    if (key === 'SYNO.Core.UserSettings:get:') return ok(nas.lastRead);
    if (key === 'SYNO.Core.SecurityScan.Status:system_get:') return account === 'admin' ? ok({ sysStatus: 'safe', items: {} }) : denied(105);
    if (key === 'SYNO.Backup.Task:list:') return account === 'admin' ? ok({ task_list: [] }) : denied(105);
    if (key === 'SYNO.Core.Upgrade.Server:check:') return account === 'admin' ? ok(upgradeAnswer) : denied(105);
    return denied(102);
  };
  const read = async (url: string) => {
    if (hold) await new Promise<void>(done => pending.push(done));
    if (failNext) { failNext--; throw Object.assign(new Error('x'), { code: 'timeout' }); }
    const u = new URL(url);
    if (u.pathname === '/webman/login.cgi') return { status: 200, body: JSON.stringify(signedIn ? { success: true, SynoToken: 'tok' } : { success: false }) };
    if (!signedIn) return { status: 200, body: JSON.stringify({ success: false, error: { code: 119 } }) };
    const params = u.searchParams;
    if (params.get('api') === 'SYNO.Entry.Request') {
      const compound = JSON.parse(params.get('compound')!) as Record<string, unknown>[];
      requests.push({ url, items: compound.map(c => `${c.api}:${c.method}:${c.type ?? ''}`) });
      return { status: 200, body: JSON.stringify({ success: true, data: { has_fail: false, result: compound.map(answer) } }) };
    }
    // The capability table: every API the modules use, at their tested versions
    if (params.get('api') === 'SYNO.API.Info') {
      info++;
      const apis = Object.fromEntries(Object.values(modules).map(m => [m.requires.api, { path: 'entry.cgi', minVersion: m.requires.min, maxVersion: m.requires.max }]));
      return { status: 200, body: JSON.stringify({ success: true, data: apis }) };
    }
    if (params.get('api') === 'SYNO.Core.DSMNotify.Strings') return { status: 200, body: JSON.stringify({ success: true, data: nas.strings }) };
    requests.push({ url, items: [`${params.get('api')}:${params.get('method')}:offset=${params.get('offset')}`] });
    return { status: 200, body: JSON.stringify({ success: true, data: { items: [], total: 4, newestMsgTime: nas.notify.newestMsgTime } }) };
  };
  return { read, requests, pending, get info() { return info; }, set hold(v: boolean) { hold = v; }, set signedIn(v: boolean) { signedIn = v; }, set failNext(v: number) { failNext = v; } };
}
function memoryStorage(initial: Record<string, { snapshot?: StatusSnapshot; read?: ReadState }> = {}) {
  const data = { ...initial };
  const strings: Record<string, { time: number; strings: Record<string, { title: string; msg: string }> }> = {};
  const storage: StatusStorage = {
    read: profile => data[profile] ?? null, write: (profile, value) => { data[profile] = JSON.parse(JSON.stringify(value)); },
    readStrings: (profile, lang) => strings[`${profile}:${lang}`] ?? null, writeStrings: (profile, lang, value) => { strings[`${profile}:${lang}`] = value; },
    remove: profile => { delete data[profile]; },
  };
  return { storage, data, strings };
}
function clock() {
  let now = 1_800_000_000_000, id = 0;
  const timers = new Map<number, { at: number; fn: () => void }>();
  return {
    now: () => now,
    setTimer: (fn: () => void, ms: number) => { timers.set(++id, { at: now + ms, fn }); return id; },
    clearTimer: (handle: unknown) => { timers.delete(handle as number); },
    pending: () => timers.size,
    /** Advances time and fires due timers in order */
    async advance(ms: number) {
      const end = now + ms;
      for (;;) {
        const next = [...timers.entries()].sort((a, b) => a[1].at - b[1].at)[0];
        if (!next || next[1].at > end) break;
        timers.delete(next[0]); now = Math.max(now, next[1].at); next[1].fn(); await flush();
      }
      now = end;
    },
  };
}
const flush = async () => { for (let i = 0; i < 10; i++) await new Promise(done => setImmediate(done)); };
function setup(account: Account = 'admin', initial?: Record<string, { snapshot?: StatusSnapshot; read?: ReadState }>) {
  const n = fakeNas(account), c = clock(), s = memoryStorage(initial);
  const model = new StatusModel({ read: n.read, storage: s.storage, now: c.now, setTimer: c.setTimer, clearTimer: c.clearTimer });
  return { model, nas: n, clock: c, store: s };
}

test('one compound request per refresh, only while visible and in the foreground', async () => {
  const { model, nas: n, clock: c } = setup();
  model.select('p1', origin, 'scope-a');
  await c.advance(0);
  assert.equal(n.requests.length, 0, 'nothing is polled before a surface is visible');
  model.setMode('home');
  await c.advance(0);
  assert.equal(n.requests.length, 1);
  assert.deepEqual(n.requests[0].items.sort(), ['SYNO.Backup.Task:list:', 'SYNO.Core.DSMNotify:notify:', 'SYNO.Core.Desktop.Initdata:get_user_service:', 'SYNO.Core.SecurityScan.Status:system_get:', 'SYNO.Core.System.Utilization:get:', 'SYNO.Core.System:info:overview', 'SYNO.Core.System:info:systemHealth', 'SYNO.Core.Upgrade.Server:check:', 'SYNO.Core.UserSettings:get:', 'SYNO.Storage.CGI.Storage:load_info:'].sort());
  // The capability table is read once before the first compound request, not on every refresh
  assert.equal(n.info, 1);
  assert.equal(model.state.snapshot?.overview?.model, 'RS822+');
  // Five seconds later only the CPU and memory are due
  await c.advance(5_000);
  assert.equal(n.requests.length, 2);
  assert.deepEqual(n.requests[1].items, ['SYNO.Core.System.Utilization:get:']);
  // Backgrounded: no timers, no requests
  model.setForeground(false);
  assert.equal(c.pending(), 0);
  await c.advance(120_000);
  assert.equal(n.requests.length, 2);
  // Back in the foreground: the overdue items go out together at once
  model.setForeground(true);
  await c.advance(0);
  assert.equal(n.requests.length, 3);
  assert.ok(n.requests[2].items.length >= 4);
  // Leaving the screen stops polling as well
  model.setMode('off');
  await c.advance(120_000);
  assert.equal(n.requests.length, 3);
  // The status detail polls faster and adds volumes
  model.setMode('status');
  await c.advance(0);
  assert.ok(n.requests[3].items.includes('SYNO.Storage.CGI.Storage:load_info:'));
  await c.advance(5_000);
  assert.deepEqual(n.requests[4].items, ['SYNO.Core.System.Utilization:get:']);
  assert.equal(model.state.snapshot?.trend?.length, 5);
  assert.equal(n.info, 1);
});
test('home: volumes ride the same compound request once a minute, never on their own', async () => {
  const { model, nas: n, clock: c } = setup();
  model.select('p1', origin, 'scope-a'); model.setMode('home');
  await c.advance(0);
  const storage = 'SYNO.Storage.CGI.Storage:load_info:';
  assert.ok(n.requests[0].items.includes(storage));
  assert.equal(model.state.snapshot?.volumes?.length, 1);
  // The 5-second refreshes in between carry only utilization
  await c.advance(55_000);
  assert.equal(n.requests.length, 12);
  for (const request of n.requests.slice(1)) assert.deepEqual(request.items, ['SYNO.Core.System.Utilization:get:']);
  // At one minute volumes are due again and join that refresh: still one request
  await c.advance(5_000);
  assert.equal(n.requests.length, 13);
  assert.ok(n.requests[12].items.includes(storage) && n.requests[12].items.includes('SYNO.Core.System.Utilization:get:'));
  assert.equal(n.requests.filter(r => r.items.includes(storage)).length, 2);
  // Off the home page nothing is asked, volumes included
  model.setMode('off');
  await c.advance(5 * 60_000);
  assert.equal(n.requests.length, 13);
});
test('home: utilization every 5 seconds and never faster; hidden or backgrounded pauses it', async () => {
  const { model, nas: n, clock: c } = setup();
  model.select('p1', origin, 'scope-a'); model.setMode('home');
  await c.advance(0);
  const util = () => n.requests.filter(r => r.items.includes('SYNO.Core.System.Utilization:get:')).length;
  await c.advance(4_999);
  assert.equal(util(), 1, 'not before 5 seconds');
  await c.advance(1);
  assert.equal(util(), 2);
  await c.advance(30_000);
  assert.equal(util(), 8, 'one utilization call per 5-second tick');
  assert.ok(n.requests.slice(1).every(r => r.items.length === 1), 'nothing else rides along within the minute');
  // The page is hidden (AppState follows document visibility on the web): no timer, no request
  model.setForeground(false);
  assert.equal(c.pending(), 0);
  await c.advance(60_000);
  assert.equal(util(), 8);
  // Visible again: one refresh at once, then the 5-second rhythm
  model.setForeground(true);
  await c.advance(0);
  assert.equal(util(), 9);
  await c.advance(5_000);
  assert.equal(util(), 10);
  // The trend is a ring buffer of samples with their times
  const trend = model.state.snapshot!.trend!;
  assert.equal(trend.length, 10);
  assert.ok(trend.every((p, i) => i === 0 || p.t > trend[i - 1].t));
});
test('home: a normal user is refused volumes once and never asked again', async () => {
  const { model, nas: n, clock: c } = setup('normal');
  model.select('p1', origin, 'scope-b'); model.setMode('home');
  await c.advance(0);
  assert.ok(model.state.snapshot!.denied.includes('storage'));
  await c.advance(3 * 60_000);
  assert.equal(n.requests.filter(r => r.items.includes('SYNO.Storage.CGI.Storage:load_info:')).length, 1);
});
test('a slow NAS keeps the last values and is never asked twice at once', async () => {
  const { model, nas: n, clock: c } = setup();
  model.select('p1', origin, 'scope-a'); model.setMode('home');
  await c.advance(0);
  const before = model.state.snapshot!.times.util;
  n.hold = true;
  await c.advance(10_000);
  assert.equal(model.state.refreshing, true);
  // Minutes pass without an answer: no failure, no second request, values stay
  await c.advance(5 * 60_000);
  assert.equal(n.requests.length, 1);
  assert.equal(model.state.error, undefined);
  assert.equal(model.state.snapshot?.util?.cpu?.percent, 2);
  assert.equal(model.state.snapshot!.times.util, before);
  n.hold = false; n.pending.splice(0).forEach(go => go());
  await flush();
  assert.equal(model.state.refreshing, false);
  assert.ok(model.state.snapshot!.times.util! > before!);
});
test('network failures keep values and retry with backoff; a lost session stops polling', async () => {
  const { model, nas: n, clock: c } = setup();
  model.select('p1', origin, 'scope-a'); model.setMode('home');
  await c.advance(0);
  n.failNext = 2;
  await c.advance(10_000);
  assert.equal(model.state.error, 'timeout');
  assert.ok(model.state.snapshot?.util);
  await c.advance(5_000);
  assert.equal(model.state.error, 'timeout');
  await c.advance(10_000);
  assert.equal(model.state.error, undefined);
  n.signedIn = false;
  await c.advance(60_000);
  assert.equal(model.state.signedOut, true);
  const count = n.requests.length;
  await c.advance(10 * 60_000);
  assert.equal(n.requests.length, count);
  assert.equal(c.pending(), 0);
});
test('cached values per profile and account render before the first answer', async () => {
  const first = setup();
  first.model.select('p1', origin, 'scope-a'); first.model.setMode('home');
  await first.clock.advance(0);
  const saved = first.store.data;
  // A new App run: the cache is on screen synchronously, before any request returns
  const second = setup('admin', saved);
  second.nas.hold = true;
  second.model.setMode('home');
  second.model.select('p1', origin, 'scope-a');
  assert.equal(second.model.state.snapshot?.util?.cpu?.percent, 2);
  assert.equal(second.model.state.snapshot?.overview?.model, 'RS822+');
  // Another account on the same NAS never sees it
  const third = setup('normal', saved);
  third.model.select('p1', origin, 'scope-b');
  assert.equal(third.model.state.snapshot?.util, undefined);
  assert.deepEqual(third.model.state.snapshot?.denied, []);
});
test('items DSM refuses to a normal user are hidden and not asked again', async () => {
  const { model, nas: n, clock: c } = setup('normal');
  model.select('p1', origin, 'scope-b'); model.setMode('status');
  await c.advance(0);
  const snap = model.state.snapshot!;
  assert.deepEqual([...snap.denied].sort(), ['backup', 'overview', 'security', 'storage', 'util']);
  assert.equal(snap.health?.disks.length, 1);
  assert.equal(model.state.error, undefined);
  await c.advance(60_000);
  for (const request of n.requests.slice(1)) assert.ok(!request.items.some(item => /Utilization|overview|load_info|SecurityScan|Backup/.test(item)), request.items.join());
  // The compound answer of a normal user from a real NAS maps the same way
  assert.deepEqual(nas.compoundNormal.result.map((r: { error?: { code: number } }) => r.error?.code), [105, 1006, 105]);
});
test('switching profiles drops answers that arrive for the previous NAS', async () => {
  const { model, nas: n, clock: c } = setup();
  model.select('p1', origin, 'scope-a'); model.setMode('home');
  n.hold = true;
  await c.advance(0);
  model.select('p2', 'https://other.example.com', 'scope-c');
  n.hold = false; n.pending.splice(0).forEach(go => go());
  await flush();
  assert.equal(model.state.profile, 'p2');
  await c.advance(0);
  assert.equal(model.state.snapshot?.scope, 'scope-c');
  assert.ok(n.requests.at(-1)!.url.startsWith('https://other.example.com/'));
});
test('unread count, mark one read, mark all read, and older pages', async () => {
  const { model, nas: n, clock: c, store } = setup();
  model.select('p1', origin, 'scope-a'); model.setMode('notifications');
  await c.advance(0);
  const snap = model.state.snapshot!;
  // DSM's read mark is the third item's time: the two newer ones are unread
  assert.equal(unreadCount(snap, model.state.read), 2);
  const newest = snap.notices!.items[0];
  model.markRead(newest.id);
  assert.equal(unreadCount(model.state.snapshot, model.state.read), 1);
  assert.equal(isUnread(model.state.snapshot, model.state.read, newest), false);
  assert.deepEqual(store.data.p1.read?.ids, [newest.id]);
  // All four loaded; with older ones on DSM and the oldest loaded still unread, more may be unread
  assert.equal(moreUnread(snap, model.state.read), false);
  const deeper = { ...snap, notices: { ...snap.notices!, total: 50 } };
  assert.equal(moreUnread(deeper, model.state.read), false, 'the oldest loaded item is older than the read mark');
  assert.equal(moreUnread({ ...deeper, lastRead: 0 }, model.state.read), true);
  model.markAllRead();
  assert.equal(unreadCount(model.state.snapshot, model.state.read), 0);
  assert.deepEqual(store.data.p1.read, { before: snap.notices!.newest, ids: [] });
  // Nothing is written to DSM: every request is a read
  assert.ok(n.requests.every(r => r.items.every(item => !/:set|apply|delete/.test(item))));
  // DSM reports the real total only when asked for a page explicitly
  assert.deepEqual([calls.notify.offset, calls.notify.limit], [0, 30]);
  await model.loadMoreNotices();
  assert.ok(n.requests.at(-1)!.items[0].endsWith('offset=4'));
  await model.loadStrings('enu');
  assert.equal(model.state.strings?.docker_container_unexpected_exit.title, 'Container Manager');
  assert.ok(store.strings['p1:enu']);
});
test('pull to refresh asks every item of the surface even when fresh', async () => {
  const { model, nas: n, clock: c } = setup();
  model.select('p1', origin, 'scope-a'); model.setMode('home');
  await c.advance(0);
  await c.advance(1000);
  assert.equal(n.requests.length, 1);
  await model.refresh();
  assert.equal(n.requests.length, 2);
  assert.ok(n.requests[1].items.length >= 6);
  assert.equal(calls.notify.action, 'load');
});
