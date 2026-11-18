import test from 'node:test';
import assert from 'node:assert/strict';
import { SESSION, SignInFlow, deviceLabel, ssoDefault, loginBody, outcome, passwordless, transportError, type NativeReply, type SignInFields } from '../src/core/session/native-sign-in.ts';

const fields: SignInFields = { account: 'alice', password: 'p&ss=word', keepSignedIn: true, deviceName: 'Pixel 8 - Package Land', mobileId: 'a'.repeat(32) };
const params = (body: string) => Object.fromEntries(new URLSearchParams(body));

test('request: password sign-in carries every Auth.login field and always registers the device', () => {
  assert.deepEqual(params(loginBody(fields)), {
    api: 'SYNO.API.Auth', version: '6', method: 'login', session: SESSION, format: 'cookie',
    account: 'alice', passwd: 'p&ss=word', enable_device_token: 'yes', device_name: 'Pixel 8 - Package Land',
    mobile_id: 'a'.repeat(32), client: 'mobile', rememberme: '1', enable_syno_token: 'yes',
  });
  assert.equal(SESSION, 'webui', 'DSM answers 402 to unknown session names');
  assert.equal(params(loginBody({ ...fields, keepSignedIn: false })).rememberme, '0');
  assert.equal(params(loginBody(fields)).otp_code, undefined);
  assert.equal(params(loginBody({ ...fields, code: '012345' })).otp_code, '012345');
  assert.equal(params(loginBody({ ...fields, code: '012345' })).passwd, 'p&ss=word', 'the second step repeats the password, not the 300 s token');
});
test('request: the device label is the phone name and the App name, bounded and without control characters', () => {
  assert.equal(deviceLabel('Redmi Note 12', 'Package Land'), 'Redmi Note 12 - Package Land');
  assert.equal(deviceLabel(' \u0000 ', 'Package Land'), 'Android - Package Land');
  assert.equal(deviceLabel('x'.repeat(100), 'App').length, 64);
});

const fail = (code: number, types: string[] = []): NativeReply => ({ success: false, status: 200, code, types });
test('errors: DSM codes map to fixable messages', () => {
  const cases: Array<[number, string]> = [[400, 'wrongPassword'], [401, 'accountDisabled'], [411, 'accountDisabled'], [402, 'noPermission'], [412, 'noPermission'],
    [404, 'wrongCode'], [407, 'blocked'], [498, 'unavailable'], [499, 'unavailable'], [105, 'failed']];
  for (const [code, error] of cases) assert.deepEqual(outcome(fail(code), 'password'), { kind: 'error', error, code }, String(code));
  assert.deepEqual(outcome({ success: false, status: 502, code: 0, types: [] }, 'password'), { kind: 'error', error: 'failed', code: 502 });
  assert.equal(transportError('certificate'), 'certificate');
  for (const cause of ['dns', 'refused', 'unreachable', 'timeout', 'network']) assert.equal(transportError(cause), 'unreachable');
  assert.equal(transportError('tls'), 'failed');
  assert.equal(transportError('cancelled'), null);
});
test('fallback: second factors and account states the App does not build go to the DSM page', () => {
  assert.deepEqual(outcome(fail(403, ['otp']), 'password'), { kind: 'code' });
  assert.deepEqual(outcome(fail(403, ['authenticator', 'otp']), 'password'), { kind: 'code' }, 'a code works when the account also has one');
  assert.deepEqual(outcome(fail(403, ['fido']), 'password'), { kind: 'fallback', reason: 'passkey' });
  assert.deepEqual(outcome(fail(403, ['authenticator']), 'password'), { kind: 'fallback', reason: 'approve' });
  assert.deepEqual(outcome(fail(403, []), 'password'), { kind: 'fallback', reason: 'other' });
  for (const code of [414, 416, 419]) assert.deepEqual(outcome(fail(code), 'password'), { kind: 'fallback', reason: 'approve' });
  assert.deepEqual(outcome(fail(406), 'password'), { kind: 'fallback', reason: 'otpSetup' });
  for (const code of [408, 409, 410]) assert.deepEqual(outcome(fail(code), 'password'), { kind: 'fallback', reason: 'passwordChange' });
  assert.equal(passwordless('{"success":true,"data":[{"type":"fido"}]}'), true);
  assert.equal(passwordless('{"success":true,"data":[{"type":"fido"},{"type":"passwd"}]}'), false);
  assert.equal(passwordless('{"success":false}'), false);
  assert.equal(passwordless('not json'), false);
});

function transport(replies: Array<NativeReply | Error>, types = '{"success":true,"data":[{"type":"passwd"}]}') {
  const sent: Record<string, string>[] = [], cancelled: string[] = [];
  return {
    sent, cancelled,
    value: {
      signIn: async (body: string) => { sent.push(params(body)); const next = replies.shift()!; if (next instanceof Error) throw next; return next; },
      cancel: (id: string) => { cancelled.push(id); },
      authTypes: async () => types,
    },
  };
}
let ids = 0;
const id = () => `id-${++ids}`;
test('2FA: the code step repeats the sign-in with otp_code and finishes with the session scope', async () => {
  const t = transport([fail(403, ['otp']), fail(404), { success: true, scope: 'scope' }]);
  const flow = new SignInFlow(t.value, id);
  assert.equal(await flow.submit(fields), null);
  assert.equal(flow.state.step, 'code'); assert.equal(flow.state.error, undefined);
  assert.equal(t.sent[0].otp_code, undefined);
  assert.equal(await flow.submit({ ...fields, code: '111111' }), null);
  assert.deepEqual(flow.state.error, { error: 'wrongCode', code: 404 });
  assert.equal(flow.state.step, 'code');
  flow.dismiss(); assert.equal(flow.state.error, undefined);
  assert.equal(await flow.submit({ ...fields, code: '222222' }), 'scope');
  assert.equal(t.sent[2].otp_code, '222222');
  assert.ok(t.sent.every(body => body.enable_device_token === 'yes'));
});
test('trusted device: DSM skips the code for a trusted phone, and a revoked phone is asked again', async () => {
  // The did cookie travels in the native cookie jar; DSM decides whether the code step is needed
  const trusted = transport([{ success: true, scope: 'scope' }]);
  assert.equal(await new SignInFlow(trusted.value, id).submit(fields), 'scope');
  assert.equal(trusted.sent.length, 1);
  const revoked = transport([fail(403, ['otp'])]);
  const flow = new SignInFlow(revoked.value, id);
  await flow.submit(fields);
  assert.equal(flow.state.step, 'code');
  flow.back(); assert.equal(flow.state.step, 'password');
});
test('sign-in: a wrong password on a passwordless account hands over to the DSM page', async () => {
  const flow = new SignInFlow(transport([fail(400)], '{"success":true,"data":[{"type":"fido"}]}').value, id);
  await flow.submit(fields);
  assert.equal(flow.state.fallback, 'passkey'); assert.equal(flow.state.error, undefined);
  const normal = new SignInFlow(transport([fail(400)]).value, id);
  await normal.submit(fields);
  assert.deepEqual(normal.state.error, { error: 'wrongPassword', code: 400 });
});
test('sign-in: transport failures, cancellation and double taps', async () => {
  const unreachable = new SignInFlow(transport([Object.assign(new Error('x'), { code: 'timeout' })]).value, id);
  await unreachable.submit(fields);
  assert.deepEqual(unreachable.state.error, { error: 'unreachable', code: undefined });
  let release!: (value: NativeReply) => void;
  const cancelled: string[] = [];
  const slow = new SignInFlow({ signIn: () => new Promise(resolve => { release = resolve; }), cancel: value => { cancelled.push(value); }, authTypes: async () => '' }, () => 'slow');
  const first = slow.submit(fields);
  assert.equal(slow.state.busy, true);
  assert.equal(await slow.submit(fields), null, 'a second tap while busy sends nothing');
  slow.cancel();
  assert.deepEqual(cancelled, ['slow']); assert.equal(slow.state.busy, false);
  release({ success: true, scope: 'late' });
  assert.equal(await first, null, 'a cancelled attempt never completes the sign-in');
});
test('fallback: a NAS whose default sign-in is SSO goes to the DSM page before any password is sent', async () => {
  const script = (sso: boolean, dflt: boolean) => `SYNO.SDS.Session = {\n   "oidc_sso_enable" : ${sso},\n   "saml_sso_enable" : false,\n   "sso_default_login" : ${dflt},\n   "sso_support" : false\n}\n;`;
  assert.equal(ssoDefault(script(true, true)), true);
  assert.equal(ssoDefault(script(true, false)), false, 'SSO as an option keeps the password form');
  assert.equal(ssoDefault(script(false, true)), false, 'a stale default without an SSO server keeps the form');
  assert.equal(ssoDefault('<html>'), false);
  const t = transport([]);
  const flow = new SignInFlow(t.value, id);
  flow.sessionData(script(true, true));
  assert.equal(flow.state.fallback, 'sso'); assert.equal(t.sent.length, 0);
  const coding = new SignInFlow(transport([fail(403, ['otp'])]).value, id);
  await coding.submit(fields); coding.sessionData(script(true, true));
  assert.equal(coding.state.fallback, undefined, 'a late answer never interrupts the code step');
});
