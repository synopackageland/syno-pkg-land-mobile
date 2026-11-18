import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
const port = Number(process.env.PORT || 8787);
// FIXTURE_APPS=N adds N generated desktop Apps to test long launcher lists
const extra = Math.max(0, Math.min(500, Number(process.env.FIXTURE_APPS || 0)));
const words = ['Audio', 'Backup', 'Calendar', 'Contacts', 'Docs', 'Files', 'Games', 'Home', 'Logs', 'Mail', 'Maps', 'Media', 'Notes', 'Photos', 'Radio', 'Sheets', 'Sync', 'Tasks', 'Video', 'Wiki'];
const fixture = readFileSync(new URL('../tests/fixtures/bridge.html', import.meta.url));
// Long form with the approval field at the bottom; shows what the page sees while the keyboard opens
const form = '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Form fixture</title>' +
  '<style>body{margin:0;font:16px system-ui}main{padding:16px}label{display:block;margin:14px 0 4px}input,textarea{width:100%;box-sizing:border-box;font:inherit;padding:10px;border:1px solid #9aa5b1;border-radius:8px}' +
  '#viewport{position:sticky;top:0;background:#E8F1FD;padding:8px 16px;font-size:13px}button{width:100%;margin:16px 0;padding:12px;font:600 16px system-ui;border:0;border-radius:22px;background:#1D6FE8;color:#fff}</style>' +
  '<div id="viewport"></div><main><h1>Form fixture</h1>' + Array.from({ length: 8 }, (_, i) => `<label>Field ${i + 1}</label><input name="f${i}">`).join('') +
  '<label>Notes</label><textarea rows="4"></textarea><h2>Approve this update</h2><label>Password</label><input type="password" id="password"><button type="button">Approve</button></main>' +
  '<script>const v=document.querySelector("#viewport");function show(){v.textContent="innerHeight "+innerHeight+" · visualViewport "+Math.round(visualViewport.height)}show();addEventListener("resize",show);visualViewport.addEventListener("resize",show);</script>';
const frame = '<!doctype html><meta charset="utf-8"><p id="result"></p><script>document.querySelector("#result").textContent=window.SynoPkgNative?"FAIL: bridge in subframe":"PASS: no bridge";</script>';
function generated() {
  const app = i => ({ jsID: `gen${i}`, jsBaseURL: `webman/3rdparty/Gen${i}`, type: 'url', title: `${words[i % words.length]} ${Math.floor(i / words.length) + 1}`, url: '/', grantPrivilege: 'all' });
  return Object.fromEntries(Array.from({ length: extra }, (_, i) => [`gen${i}`, app(i)]));
}
function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  const path = new URL(req.url, 'http://fixture.example').pathname;
  const query = new URL(req.url, 'http://fixture.example').searchParams;
  const json = value => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(value)); };
  if (path === '/webapi/query.cgi') {
    json({ success: true, data: { 'SYNO.API.Auth': { path: 'entry.cgi', minVersion: 1, maxVersion: 7 } } });
  } else if (path === '/webman/login.cgi') {
    json({ success: true, SynoToken: 'fixture-token' });
  } else if (path === '/webapi/entry.cgi') {
    if (query.get('api') === 'SYNO.Core.AppPortal') { json({ success: false, error: { code: 105 } }); return; }
    if (query.get('api') === 'SYNO.Core.Package') { json({ success: true, data: { packages: [] } }); return; }
    const app = (id, title, folder) => ({ jsID: id, jsBaseURL: `webman/3rdparty/${folder}`, type: 'url', title, url: `/${folder === 'ShellFixture' ? 'webman/3rdparty/ShellFixture/app/entry.html' : ''}`, grantPrivilege: 'all' });
    json({ success: true, data: {
      Session: { isLogined: true, is_admin: false, domainUser: 'false' },
      AppPrivilege: { fixture: true, desktop: true, ...Object.fromEntries(Object.keys(generated()).map(id => [id, true])) },
      JSConfig: { source: { fixture: app('fixture', 'Shell fixture', 'ShellFixture'), desktop: app('desktop', 'Desktop fixture', 'DesktopFixture'), denied: app('denied', 'Denied fixture', 'DeniedFixture'), ...generated() } },
    } });
  } else if (path === '/webman/3rdparty/ShellFixture/app/mobile.json') {
    json({ schema: 1, package: 'ShellFixture', version: '1.0', build: 'fixture', name: { en: 'Shell fixture' }, icon: 'icons/mobile-72.png', entry: 'entry.html', start: '/', capabilities: ['download', 'open-external', 'camera'], status: false, minShell: 1, intake: { route: '/add', accept: [{ kind: 'url', schemes: ['http', 'https', 'magnet', 'ed2k'] }, { kind: 'text' }, { kind: 'file', types: ['.torrent'], max_bytes: 524288 }] } });
  } else if (path.endsWith('/mobile.json')) {
    res.writeHead(404); res.end('No registration');
  } else if (path.endsWith('/icons/mobile-72.png')) {
    res.setHeader('Content-Type', 'image/png'); res.end(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l4QAAAAASUVORK5CYII=', 'base64'));
  } else if (path === '/download') {
    res.setHeader('Content-Type', 'text/plain'); res.setHeader('Content-Disposition', 'attachment; filename="fixture.txt"');
    res.setHeader('Set-Cookie', 'fixture=shared; HttpOnly; SameSite=Lax; Path=/'); res.end('Package Land\n');
  } else if (path === '/redirect') {
    const target = new URL('/download', `http://${req.headers.host}`); target.port = String(port + 1);
    res.writeHead(302, { Location: target.href }); res.end();
  } else if (path === '/frame') res.end(frame);
  else if (path === '/form') res.end(form);
  else if (path === '/next') res.end('<!doctype html><h1>Next page</h1><p>Use the Android back gesture</p>');
  else { res.setHeader('Set-Cookie', 'id=fixture-session; HttpOnly; SameSite=Lax; Path=/'); res.end(fixture); }
}
for (const p of [port, port + 1]) createServer(handler).listen(p, () => console.log(`Fixture listening on port ${p}`));
