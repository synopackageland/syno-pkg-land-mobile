import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { signInScript, SignInSession } from '../src/core/session/sign-in.ts';

const origin = 'https://nas.example.com:5001';
const auth = origin + '/webapi/entry.cgi?api=SYNO.API.Auth';
const body = 'api=SYNO.API.Auth&version=7&method=login&session=webui&__cIpHeRtExT=encrypted';
function fixture(main = true, withFetch = false) {
  const messages: any[] = [], sent: any[] = [];
  const fetched: any[] = [];
  class Xhr extends EventTarget {
    readyState = 0; status = 0; responseText = ''; responseType = ''; withCredentials = false; timeout = 0;
    headers: Record<string, string> = {}; method = ''; url = ''; async = true; onreadystatechange?: () => void;
    open(method: string, url: string, async = true) { this.method = method; this.url = url; this.async = async; this.headers = {}; this.readyState = 1; }
    setRequestHeader(name: string, value: string) { this.headers[name] = value; }
    send(value?: unknown) { sent.push({ xhr: this, method: this.method, url: this.url, body: value, headers: { ...this.headers } }); }
    abort() { this.readyState = 0; this.dispatchEvent(new Event('abort')); }
    respond(status: number, text: string) { this.status = status; this.responseText = text; this.readyState = 4; this.onreadystatechange?.(); this.dispatchEvent(new Event('load')); }
  }
  const window: any = { XMLHttpRequest: Xhr, SynoPkgSignIn: { postMessage: (data: string) => messages.push(JSON.parse(data)) } };
  if (withFetch) {
    window.Request = Request;
    window.fetch = async (input: string | Request, init: unknown) => {
      fetched.push(input instanceof Request ? { url: input.url, init, body: await input.text() } : { url: input, init });
      return new Response('{"success":false,"error":{"code":403}}', { status: 200 });
    };
  }
  window.window = window; window.top = main ? window : {};
  const context = vm.createContext({ window, location: { origin, href: origin + '/' }, URL, URLSearchParams, Map, WeakMap, Object, JSON, Event, EventTarget, DOMException });
  vm.runInContext(signInScript(origin), context);
  return { window, Xhr, messages, sent, fetched, runAgain: () => vm.runInContext(signInScript(origin), context) };
}
test('Auth POST uses a prepared native route while keeping a real XHR and its listeners', () => {
  const f = fixture(), xhr = new f.Xhr();
  let loaded = 0;
  xhr.open('POST', auth); xhr.setRequestHeader('Content-Type', 'application/x-www-form-urlencoded');
  xhr.responseType = 'json'; xhr.withCredentials = true;
  xhr.addEventListener('load', () => loaded++); xhr.send(body);
  assert.equal(f.sent.length, 0, 'do not submit to the stalled WebView Auth transport');
  assert.equal(f.messages.length, 1); assert.equal(f.messages[0].url, auth); assert.equal(f.messages[0].body, body);
  const route = origin + '/.synopkg-sign-in/opaque';
  f.window.__synoSignInReady(f.messages[0].id, route);
  assert.equal(f.sent.length, 1); assert.equal(f.sent[0].method, 'GET'); assert.equal(f.sent[0].url, route);
  assert.equal(f.sent[0].body, undefined, 'credentials never enter the transport URL');
  assert.equal(xhr.responseType, 'json'); assert.equal(xhr.withCredentials, true);
  assert.equal((xhr as any).responseURL, auth);
  xhr.respond(200, '{"success":false,"error":{"code":403}}');
  assert.equal(loaded, 1, '2FA/wrong-password replies still reach DSM through real XHR events');
  assert.equal(xhr.status, 200); assert.match(xhr.responseText, /403/);
});
test('unrelated APIs, other origins, synchronous XHR and child frames keep the original transport', () => {
  const f = fixture();
  for (const [url, value, async] of [
    [origin + '/webapi/entry.cgi', 'api=SYNO.Core.Package&method=list', true],
    ['https://other.example.com/webapi/entry.cgi', body, true],
    [auth, body, false],
    [auth, 'api=SYNO.API.Auth&method=logout', true],
  ] as const) {
    const xhr = new f.Xhr(); xhr.open('POST', url, async); xhr.send(value);
  }
  assert.equal(f.sent.length, 4); assert.equal(f.messages.length, 0);
  const frame = fixture(false), xhr = new frame.Xhr(); xhr.open('POST', auth); xhr.send(body);
  assert.equal(frame.messages.length, 0); assert.equal(frame.sent.length, 1);
});
test('abort/reuse discards prepared credentials and ignores late native handshakes', () => {
  const f = fixture(), xhr = new f.Xhr();
  xhr.open('POST', auth); xhr.send(body);
  const id = f.messages[0].id;
  xhr.abort(); f.window.__synoSignInReady(id, origin + '/.synopkg-sign-in/late');
  assert.equal(f.sent.length, 0); assert.equal(f.messages.at(-1).type, 'cancel');
  xhr.open('POST', auth); xhr.send(body); const next = f.messages.at(-1).id;
  xhr.open('GET', origin + '/other'); f.window.__synoSignInReady(next, origin + '/.synopkg-sign-in/late');
  xhr.send(); assert.equal(f.sent.length, 1); assert.equal(f.sent[0].url, origin + '/other');
});
test('document-start installation is idempotent and native errors preserve the XHR failure path', () => {
  const f = fixture(); f.runAgain();
  const xhr = new f.Xhr(); let errors = 0;
  xhr.addEventListener('error', () => errors++);
  xhr.open('POST', auth); xhr.send(body);
  assert.equal(f.messages.length, 1);
  f.window.__synoSignInReady(f.messages[0].id, null);
  assert.equal(errors, 1); assert.equal(f.sent.length, 0);
});
test('only a current origin/view/session completion closes sign-in, once, without a URL or timer', () => {
  const session = new SignInSession(origin);
  const event = { viewId: 7, origin, scope: 'new-session' };
  assert.equal(session.accept(event, 8, 'new-session'), false);
  assert.equal(session.accept({ ...event, origin: 'https://other.example.com' }, 7, 'new-session'), false);
  assert.equal(session.accept(event, 7, ''), false);
  assert.equal(session.accept(event, 7, 'replaced-session'), false);
  assert.equal(session.accept(event, 7, 'new-session'), true);
  assert.equal(session.accept(event, 7, 'new-session'), false);
});
test('fetch keeps DSM challenge replies and abort cancels a prepared native exchange', async () => {
  const f = fixture(true, true);
  const result = f.window.fetch(auth, { method: 'POST', body, headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
  await new Promise(done => setImmediate(done));
  assert.equal(f.fetched.length, 0); assert.equal(f.messages.length, 1);
  f.window.__synoSignInReady(f.messages[0].id, origin + '/.synopkg-sign-in/opaque');
  const response = await result;
  assert.equal(response.url, auth); assert.equal(response.status, 200);
  assert.equal((await response.json()).error.code, 403);
  const controller = new AbortController();
  const aborted = f.window.fetch(auth, { method: 'POST', body, headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, signal: controller.signal });
  await new Promise(done => setImmediate(done));
  const id = f.messages.at(-1).id;
  controller.abort();
  await assert.rejects(aborted, { name: 'AbortError' });
  f.window.__synoSignInReady(id, origin + '/.synopkg-sign-in/late');
  assert.equal(f.fetched.length, 1); assert.equal(f.messages.at(-1).type, 'cancel');
});
test('duplicate sends fail like XHR and unrelated fetch uploads never wait for a cloned body', async () => {
  const f = fixture(true, true), xhr = new f.Xhr();
  xhr.open('POST', auth); xhr.send(body);
  assert.throws(() => xhr.send(body), { name: 'InvalidStateError' });
  assert.equal(f.messages.length, 1);
  await f.window.fetch(origin + '/upload', { method: 'POST', body: 'upload' });
  assert.equal(f.fetched.length, 1); assert.equal(f.fetched[0].url, origin + '/upload');
});
test('fetch Request inputs keep upload and non-login API bodies usable by the original transport', async () => {
  const f = fixture(true, true);
  for (const [url, body, contentType] of [
    [origin + '/upload', 'upload', 'text/plain'],
    [origin + '/webapi/entry.cgi', '{"api":"Other"}', 'application/json'],
    [auth, 'api=SYNO.Core.Package&method=list', 'application/x-www-form-urlencoded'],
  ]) {
    const input = new Request(url, { method: 'POST', body, headers: { 'Content-Type': contentType } });
    await f.window.fetch(input);
    assert.equal(f.fetched.at(-1).body, body);
    assert.equal(f.fetched.at(-1).url, url);
  }
  assert.equal(f.messages.length, 0);
});
