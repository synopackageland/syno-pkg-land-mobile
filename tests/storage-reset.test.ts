import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { RESET_MARKER, storageResetScript } from '../src/core/session/storage-reset.ts';

const origin = 'https://nas.example.com:5001';
function page(store: Map<string, string>, at = origin) {
  const localStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => { store.set(k, v); }, removeItem: (k: string) => { store.delete(k); } };
  return (script: string) => vm.runInNewContext(script, { location: { origin: at }, window: { localStorage } });
}
test('storage reset: each nonce removes the DSM resume key once, so the next account is not resumed', () => {
  const store = new Map([['lastHS', '{"account":"a"}'], ['crossPortData', '{"currentLoginUser":"a","_HSID":"t"}'], ['other', 'kept']]);
  const load = page(store);
  load(storageResetScript(origin, 'n1'));
  assert.equal(store.has('lastHS'), false, 'the first document after a sign-out drops the old key');
  assert.equal(store.has('crossPortData'), false, 'and the account and authtok that SYNO.SDS.HandShake resumes from');
  assert.equal(store.get('other'), 'kept');
  assert.equal(store.get(RESET_MARKER), 'n1');
  store.set('lastHS', '{"account":"b"}');
  load(storageResetScript(origin, 'n1'));
  assert.equal(store.get('lastHS'), '{"account":"b"}', 'one-shot: later documents keep what DSM wrote for the new account');
  load(storageResetScript(origin, 'n2'));
  assert.equal(store.has('lastHS'), false, 'the next sign-out or native sign-in resets again');
  assert.equal(store.get(RESET_MARKER), 'n2');
});
test('storage reset: no nonce installs nothing; another origin and a throwing storage are untouched', () => {
  assert.equal(storageResetScript(origin, ''), '');
  const store = new Map([['lastHS', 'x']]);
  page(store, 'https://other.example.com')(storageResetScript(origin, 'n1'));
  assert.equal(store.get('lastHS'), 'x');
  assert.doesNotThrow(() => vm.runInNewContext(storageResetScript(origin, 'n1'), { location: { origin }, window: { get localStorage() { throw new Error('denied'); } } }));
  const odd = '"});throw 1;//', quoted = new Map<string, string>();
  page(quoted)(storageResetScript(origin, odd));
  assert.equal(quoted.get(RESET_MARKER), odd, 'the nonce is a string literal, never code');
});
