import test from 'node:test';
import assert from 'node:assert/strict';
import { filterApps } from '../src/core/discovery/filter.ts';
import { registeredTarget } from '../src/core/discovery/schema.ts';
import { apiData, createDiscovery, DiscoveryError, hedge, scriptObject } from '../src/core/discovery/client.ts';
const origin = 'https://nas.example.com';
const profile = { id: 'nas', name: 'NAS', origin };
const id = 'SYNO.SDS.Example.Instance';
const config = { jsID: id, jsBaseURL: 'webman/3rdparty/Example', type: 'standalone', title: 'app:title', grantPrivilege: 'all', allUsers: true, icon: 'images/icon_{0}.png' };
const data = (admin = false, privileges = {}) => ({ JSConfig: { 'webman/3rdparty/Example/app.js': { [id]: config } }, AppPrivilege: privileges, Session: { isLogined: true, is_admin: admin, domainUser: 'false' }, Strings: { [id]: { app: { title: 'Example app' } } } });
const manifest = { schema: 1, package: 'Example', version: '1.0', build: 'hash', name: { en: 'Example mobile', 'zh-TW': '行動 App' }, icon: 'icons/mobile-72.png?v=hash', entry: 'entry.html', start: '/', capabilities: ['download', 'open-external'], status: false, minShell: 1, intake: { route: '/add', accept: [{ kind: 'url', schemes: ['https', 'magnet'] }, { kind: 'file', types: ['.torrent'], max_bytes: 524288 }] } };
const response = (value: unknown, status = 200) => ({ status, body: JSON.stringify(value) });
test('the same JSConfig is filtered by AppPrivilege for admin and normal users', () => {
  assert.equal(filterApps(data(false), origin).length, 0);
  assert.equal(filterApps(data(true, { 'SYNO.ALLOW.ALL.APPLICATIONS': true }), origin).length, 1);
  const allowed = filterApps(data(false, { [id]: true }), origin);
  assert.equal(allowed.length, 1); assert.equal(allowed[0].name, 'Example app');
  assert.equal(allowed[0].icon, origin + '/webman/3rdparty/Example/images/icon_72.png');
  assert.equal(allowed[0].preset, 'desktop'); assert.equal(allowed[0].registered, false);
});
test('grantAppPrivilege, user type, domain scope, admin-only and launch conditions apply', () => {
  const fixture = (patch: Record<string, unknown>, admin = false, privileges = {}) => ({ ...data(admin, privileges), JSConfig: { source: { [id]: { ...config, ...patch } } } });
  assert.equal(filterApps(fixture({ grantAppPrivilege: 'different' }, false, { different: true }), origin).length, 1);
  assert.equal(filterApps(fixture({ grantAppPrivilege: 'different' }, false, { [id]: true }), origin).length, 0);
  for (const patch of [{ grantPrivilegeUserType: 'admin' }, { grantPrivilege: 'domain' }, { hidden: true }, { launchable: false }, { canLaunch: { is_admin: true } }, { type: 'lib' }]) assert.equal(filterApps(fixture(patch, false, { [id]: true }), origin).length, 0);
  assert.equal(filterApps(fixture({ grantPrivilege: undefined, allUsers: false }), origin).length, 0);
  assert.equal(filterApps(fixture({ grantPrivilege: undefined, allUsers: false }, true), origin).length, 1);
  assert.equal(filterApps({ ...fixture({}, true, { [id]: true }), ServiceStatus: { [id]: false } }, origin).length, 0);
});
test('DSM built-in modules and bundled tools are listed with their own icons, names and launch IDs', () => {
  const value = { ...data(true, { 'SYNO.ALLOW.ALL.APPLICATIONS': true }), Session: { isLogined: true, is_admin: true, domainUser: 'false', fullversion: '90080-s0' },
    UIStrings: { tree: { leaf_control_panel: 'Control Panel' } }, JSConfig: { source: {
    'SYNO.SDS.AdminCenter.Application': { type: 'app', jsBaseURL: 'webman/modules/AdminCenter', title: 'tree:leaf_control_panel', allUsers: false, icon: 'images/{1}/ControlPanel_{0}.png' },
    'SYNO.SDS.App.FileStation3.Instance': { ...config, jsID: undefined, jsBaseURL: 'webman/3rdparty/FileBrowser', title: 'File Station', icon: 'images/icon/FileStation_{0}.png' },
    external: { ...config, jsID: 'external', type: 'url', url: 'https://example.org/app' },
    direct: { ...config, jsID: 'direct', type: 'url', url: '/webman/3rdparty/Example/sso/open.cgi' },
  } } };
  const apps = filterApps(value, origin);
  assert.equal(apps.length, 4);
  const panel = apps.find(a => a.id === 'SYNO.SDS.AdminCenter.Application')!;
  assert.equal(panel.name, 'Control Panel'); assert.equal(panel.builtin, true); assert.equal(panel.version, '90080-s0');
  assert.equal(panel.iconTemplate, origin + '/webman/modules/AdminCenter/images/1x/ControlPanel_{0}.png');
  assert.equal(panel.url, origin + '/?launchApp=SYNO.SDS.AdminCenter.Application'); assert.equal(panel.preset, 'desktop');
  const files = apps.find(a => a.id === 'SYNO.SDS.App.FileStation3.Instance')!;
  assert.equal(files.builtin, true); assert.equal(files.iconTemplate, origin + '/webman/3rdparty/FileBrowser/images/icon/FileStation_{0}.png');
  assert.equal(apps.find(a => a.id === 'direct')?.url, origin + '/webman/3rdparty/Example/sso/open.cgi');
  assert.equal(apps.find(a => a.id === 'direct')?.builtin, undefined);
  assert.equal(apps.find(a => a.id === 'external')?.url, origin + '/?launchApp=external');
});
test('DSM Help and Support Center are left out of the App list', () => {
  const app = (base: string) => ({ type: 'app', jsBaseURL: base, title: 'x', allUsers: true, grantPrivilege: 'all', icon: 'images/icon_{0}.png' });
  const value = { ...data(true, { 'SYNO.ALLOW.ALL.APPLICATIONS': true }), JSConfig: { source: {
    'SYNO.SDS.HelpBrowser.Application': app('webman/modules/HelpBrowser'),
    'SYNO.SDS.SupportForm.Application': app('webman/3rdparty/SupportForm'),
    'SYNO.PKG.SupportForm.Application': app('webman/3rdparty/SupportForm'),
    'SYNO.SDS.AdminCenter.Application': app('webman/modules/AdminCenter'),
  } } };
  assert.deepEqual(filterApps(value, origin).map(a => a.id), ['SYNO.SDS.AdminCenter.Application']);
});
test('Control Panel follows DSM grants: admin, normal, ActionPrivilege and domain users', () => {
  const panel = { type: 'app', jsBaseURL: 'webman/modules/AdminCenter', title: 'Control Panel', allUsers: false };
  const files = { type: 'app', jsBaseURL: 'webman/3rdparty/FileBrowser', title: 'File Station', grantPrivilege: 'all', allUsers: true };
  const usb = { type: 'app', jsBaseURL: 'webman/3rdparty/USBCopy', title: 'USB Copy', grantPrivilege: 'undefined', allUsers: false };
  const downloads = { type: 'app', jsBaseURL: 'webman/3rdparty/DownloadStation', title: 'Download Station', grantPrivilege: 'local', allUsers: true };
  const fixture = (session: Record<string, unknown>, privileges: Record<string, boolean> = {}, actions: string[] = []) => ({
    Session: { isLogined: true, ...session }, AppPrivilege: privileges, ActionPrivilege: actions,
    JSConfig: { source: { 'SYNO.SDS.AdminCenter.Application': panel, 'SYNO.SDS.App.FileStation3.Instance': files, 'SYNO.SDS.USBCopy.Application': usb, 'SYNO.SDS.DownloadStation.Application': downloads } } });
  const ids = (value: unknown) => filterApps(value, origin).map(a => a.id).sort();
  assert.deepEqual(ids(fixture({ is_admin: true, domainUser: 'false' }, { 'SYNO.ALLOW.ALL.APPLICATIONS': true })), ['SYNO.SDS.AdminCenter.Application', 'SYNO.SDS.App.FileStation3.Instance', 'SYNO.SDS.DownloadStation.Application', 'SYNO.SDS.USBCopy.Application']);
  assert.deepEqual(ids(fixture({ is_admin: false, domainUser: 'false' }, { 'SYNO.SDS.App.FileStation3.Instance': true, 'SYNO.SDS.DownloadStation.Application': true })), ['SYNO.SDS.App.FileStation3.Instance', 'SYNO.SDS.DownloadStation.Application']);
  assert.deepEqual(ids(fixture({ is_admin: false, domainUser: 'false' })), []);
  // A delegated administrator gets Control Panel through DSM's ActionPrivilege
  assert.deepEqual(ids(fixture({ is_admin: false, domainUser: 'false' }, {}, ['SYNO.SDS.AdminCenter.Application'])), ['SYNO.SDS.AdminCenter.Application']);
  // A domain user is outside a local-only grant; DSM then falls back to allUsers for local-scope Apps only
  assert.deepEqual(ids(fixture({ is_admin: false, domainUser: 'true' }, { 'SYNO.SDS.App.FileStation3.Instance': true, 'SYNO.SDS.DownloadStation.Application': true })), ['SYNO.SDS.App.FileStation3.Instance']);
});
test('stopped packages and disabled services stay hidden, including bundled tools', () => {
  const value = { ...data(true, { 'SYNO.ALLOW.ALL.APPLICATIONS': true }), ServiceStatus: { 'SYNO.SDS.App.FileStation3.Instance': false },
    Packages: [{ id: 'StorageManager', version: '1.0', additional: { status: 'stop', dsm_apps: 'SYNO.SDS.StorageManager.Instance' } }],
    JSConfig: { source: {
      'SYNO.SDS.App.FileStation3.Instance': { ...config, jsID: undefined, jsBaseURL: 'webman/3rdparty/FileBrowser' },
      'SYNO.SDS.StorageManager.Instance': { ...config, jsID: undefined, jsBaseURL: 'webman/3rdparty/StorageManager' },
      'SYNO.SDS.LogCenter.BuiltIn': { ...config, jsID: undefined, jsBaseURL: 'webman/modules/LogCenter' },
    } } };
  assert.deepEqual(filterApps(value, origin).map(a => a.id), ['SYNO.SDS.LogCenter.BuiltIn']);
});
test('supportKey follows DSM Defs, then DSM\'s own main menu, then the live runtime', () => {
  const storage = [{ key: 'usbstation', value: '' }, { key: 'support_storage_mgr', value: 'yes' }];
  const monitor = [{ key: 'support_hyper_converged', value: 'no' }, { cond: 'or', key: 'support_hyper_converged', value: '' }];
  const fixture = (extra: Record<string, unknown>) => ({ ...data(true, { 'SYNO.ALLOW.ALL.APPLICATIONS': true }), ...extra, JSConfig: { source: {
    storage: { ...config, jsID: 'storage', type: 'app', supportKey: storage },
    monitor: { ...config, jsID: 'monitor', type: 'app', supportKey: monitor },
    ha: { ...config, jsID: 'ha', type: 'app', supportKey: { key: 'support_ha' } },
    portal: { ...config, jsID: 'portal', type: 'standalone', supportKey: { key: 'never' } },
  } } });
  const shown = (value: unknown) => filterApps(value, origin).map(a => `${a.id}${a.runtimeOnly ? '?' : ''}`).sort();
  assert.deepEqual(shown(fixture({ Defs: { support_storage_mgr: 'yes', support_ha: 'yes' } })), ['ha', 'monitor', 'portal', 'storage']);
  assert.deepEqual(shown(fixture({ Defs: { support_storage_mgr: 'no', usbstation: '', support_hyper_converged: 'yes' } })), ['portal']);
  assert.deepEqual(shown(fixture({ Defs: { usbstation: 'yes', support_storage_mgr: 'yes', support_hyper_converged: 'no' } })), ['monitor', 'portal']);
  // Without Defs: DSM's last main menu answered it; anything else waits for the DSM runtime
  assert.deepEqual(shown(fixture({ UserSettings: { Desktop: { valid_appview_order: ['storage'] } } })), ['ha?', 'monitor?', 'portal', 'storage']);
  assert.deepEqual(shown(fixture({ Defs: { support_ha: 'yes' }, Session: { isLogined: true, is_admin: true, ha_safemode: true } })), []);
});
test('DSM getjs objects are read without evaluating the script', () => {
  assert.deepEqual(scriptObject('_SYNOINFODEF={"a":"}","b":"x\\"y"}; function _D(s, d) {}', '_SYNOINFODEF'), { a: '}', b: 'x"y' });
  assert.deepEqual(scriptObject('SYNO_WebManager_Strings={"tree":{"leaf":"{"}}\n;\nfunction _T(g, s) {}', 'SYNO_WebManager_Strings'), { tree: { leaf: '{' } });
  for (const body of ['<html>', '_SYNOINFODEF=alert(1);', '_SYNOINFODEF={"a":'] ) assert.throws(() => scriptObject(body, '_SYNOINFODEF'));
});
test('registration checks identity, schema, same-origin entry, capabilities and max_bytes', () => {
  const app = filterApps(data(false, { [id]: true }), origin)[0];
  const registered = registeredTarget(manifest, app, origin, 'zh-TW');
  assert.equal(registered?.name, '行動 App'); assert.equal(registered?.preset, 'mobile');
  assert.equal(registered?.intake?.accept[1].kind, 'file');
  for (const patch of [{ schema: 2 }, { package: 'Different' }, { minShell: 2 }, { entry: 'https://example.org/entry.html' }, { entry: '../../Other/app/entry.html' }, { capabilities: ['unknown'] }, { intake: { route: '/add', accept: [{ kind: 'file', types: ['.torrent'], max_bytes: 8388609 }] } }, { success: false, schema: undefined }]) assert.equal(registeredTarget({ ...manifest, ...patch }, app, origin), null);
});
test('HTTP 200 JSON errors are rejected, including 105 and expired identity', () => {
  for (const code of [105, 106, 119]) assert.throws(() => apiData(response({ success: false, error: { code } })), (error: unknown) => error instanceof DiscoveryError && error.code === code);
  assert.throws(() => apiData({ status: 200, body: '<html>sign in</html>' }));
  assert.throws(() => filterApps({ ...data(), Session: { isLogined: false } }, origin));
});
test('normal user discovers registered apps without relying on the portal API that returns 105', async () => {
  const requests: string[] = [];
  const discover = createDiscovery(async url => {
    requests.push(url);
    if (url.includes('SYNO.Core.Package')) return response({ success: true, data: { packages: [] } });
    if (url.includes('AppPortal')) return response({ success: false, error: { code: 105 } });
    if (url.includes('login.cgi')) return response({ success: true, SynoToken: 'test-token' });
    if (url.includes('Initdata')) return response({ success: true, data: data(false, { [id]: true }) });
    return response(manifest);
  });
  const publications: number[] = [];
  const apps = await discover(profile, values => publications.push(values.filter(a => a.registered).length));
  assert.deepEqual(publications, [0, 1]); assert.equal(apps[0].registered, true);
  assert.equal(apps[0].url, origin + '/webman/3rdparty/Example/app/entry.html');
  assert.equal(requests.some(url => url.includes('AppPortal')), false);
  for (const method of ['get_user_service', 'get_ui_config']) assert.equal(requests.some(url => new URL(url).searchParams.get('method') === method), true);
  assert.equal(JSON.stringify(apps).includes('test-token'), false);
});
test('missing, invalid or HTTP 200 JSON-error registrations stay desktop-only', async () => {
  for (const registration of [response({}, 404), response({ success: false, error: { code: 105 } }), { status: 200, body: 'invalid' }]) {
    const discover = createDiscovery(async url => url.includes('SYNO.Core.Package') ? response({ success: true, data: { packages: [] } }) : url.includes('login.cgi') ? response({ success: true, SynoToken: 'token' }) : url.includes('Initdata') ? response({ success: true, data: data(false, { [id]: true }) }) : registration);
    const apps = await discover(profile, () => {});
    assert.equal(apps[0].registered, false); assert.equal(apps[0].preset, 'desktop'); assert.deepEqual(apps[0].capabilities, []);
  }
});
test('names follow the App language: Accept-Language and UIString lang, then the account language, then English', async () => {
  const panel = { type: 'app', jsBaseURL: 'webman/modules/AdminCenter', title: 'tree:leaf_control_panel', allUsers: false };
  const run = async (locale: string, failing: string[] = []) => {
    const seen: { accept?: string; lang?: string }[] = [];
    let current = locale;
    const discover = createDiscovery(async (url, _origin, accept) => {
      const query = new URL(url).searchParams;
      seen.push({ accept, lang: query.get('lang') || undefined });
      if (url.includes('login.cgi')) return response({ success: true, SynoToken: 'token' });
      if (url.includes('SYNO.Core.Package')) return response({ success: true, data: { packages: [] } });
      if (query.get('method') === 'get_user_service') return response({ success: true, data: { Session: { isLogined: true, is_admin: true, domainUser: 'false', lang: 'chs' } } });
      if (query.get('method') === 'get_ui_config') return response({ success: true, data: { JSConfig: { source: { 'SYNO.SDS.AdminCenter.Application': panel } } } });
      if (query.get('api') === 'SYNO.Core.Desktop.UIString') {
        const lang = query.get('lang')!;
        if (failing.includes(lang)) return response({}, 500);
        return { status: 200, body: `SYNO_WebManager_Strings={"tree":{"leaf_control_panel":"${{ cht: '控制台', chs: '控制面板', enu: 'Control Panel' }[lang]}"}}\n;` };
      }
      return response({}, 404);
    }, () => current);
    const apps = await discover(profile, () => {});
    current = 'en-US';
    return { name: apps[0].name, seen };
  };
  const zh = await run('zh-Hant-TW');
  assert.equal(zh.name, '控制台');
  assert.ok(zh.seen.every(read => read.accept === 'zh-TW'));
  assert.equal(zh.seen.find(read => read.lang && read.lang !== 'cht'), undefined);
  assert.equal((await run('zh-Hans-CN')).name, '控制面板');
  assert.equal((await run('en-US')).seen[0].accept, 'en-US');
  // The App language is unavailable: the account language (chs here), then English
  assert.equal((await run('zh-Hant-TW', ['cht'])).name, '控制面板');
  assert.equal((await run('zh-Hant-TW', ['cht', 'chs'])).name, 'Control Panel');
});
test('slow request is hedged without aborting or waiting for the first request', async () => {
  let calls = 0, finish!: (value: string) => void;
  const pending = hedge(() => ++calls === 1 ? new Promise<string>(resolve => { finish = resolve; }) : Promise.resolve('hedge'), 1);
  assert.equal(await pending, 'hedge'); assert.equal(calls, 2);
  finish('original');
});
test('DSM package status hides stopped apps by dsm_apps IDs, independently of grants and folder names', async () => {
  const states = ['stop', 'NA', 'non_installed', 'running', 'starting', 'broken'];
  for (const status of states) {
    const packages = { packages: [{ id: 'DifferentPackageID', additional: { status, dsm_apps: `other ${id}` } }] };
    const requests: string[] = [], publications: number[] = [];
    const discover = createDiscovery(async url => {
      requests.push(url);
      if (url.includes('login.cgi')) return response({ success: true, SynoToken: 'token' });
      if (url.includes('Initdata')) return response({ success: true, data: data(false, { [id]: true }) });
      if (url.includes('SYNO.Core.Package')) return response({ success: true, data: packages });
      return response(manifest);
    });
    const apps = await discover(profile, list => publications.push(list.length));
    const expected = ['stop', 'NA', 'non_installed'].includes(status) ? 0 : 1;
    assert.equal(apps.length, expected, status);
    assert.ok(publications.every(n => n === expected), 'never publish a stopped app before checking packages');
    assert.equal(requests.some(url => url.includes('SYNO.Core.Package') && new URL(url).searchParams.get('additional') === '["status","dsm_apps"]'), true);
  }
});
test('unavailable package state cannot publish an unverified app list', async () => {
  const discover = createDiscovery(async url => url.includes('login.cgi') ? response({ success: true, SynoToken: 'token' }) : url.includes('Initdata') ? response({ success: true, data: data(false, { [id]: true }) }) : response({ success: false, error: { code: 105 } }));
  let published = false;
  await assert.rejects(discover(profile, () => { published = true; }));
  assert.equal(published, false);
});
test('DSM ActionPrivilege is an array and an explicitly non-true service is disabled', () => {
  const fixture = { ...data(), JSConfig: { source: { [id]: { ...config, grantPrivilege: undefined, allUsers: false } } }, ActionPrivilege: [id] };
  assert.equal(filterApps(fixture, origin).length, 1);
  assert.equal(filterApps({ ...fixture, ServiceStatus: { [id]: null } }, origin).length, 0);
});
test('DSM uses the first JSConfig definition, including hidden definitions', () => {
  const fixture = { ...data(false, { [id]: true }), JSConfig: { first: { [id]: { ...config, hidden: true } }, second: { [id]: config } } };
  assert.deepEqual(filterApps(fixture, origin), []);
});
