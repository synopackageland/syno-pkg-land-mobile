import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeServer, launchUrl } from '../src/core/profiles/url.ts';
import { navigation, warmKeys } from '../src/core/webview/policy.ts';
test('normalization uses LAN HTTP with a warning and rejects URL credentials', () => {
  assert.deepEqual(normalizeServer('storage.local:5000'), { origin: 'http://storage.local:5000', insecure: true });
  assert.equal(normalizeServer('nas.example.com').origin, 'https://nas.example.com');
  assert.throws(() => normalizeServer('https://admin:secret@nas.example.com'));
  assert.throws(() => normalizeServer('file:///etc/passwd'));
});
test('navigation keeps NAS pages, routes external top frames, and blocks special schemes', () => {
  const origin = 'https://nas.example.com';
  assert.equal(navigation(origin + '/app', origin), 'allow');
  assert.equal(navigation('https://example.org/', origin), 'external');
  assert.equal(navigation('https://example.org/frame', origin, false), 'allow');
  for (const url of ['javascript:alert(1)', 'file:///secret', 'intent://launch', 'data:text/html,test']) assert.equal(navigation(url, origin), 'block');
});
test('launch URLs carry opaque handles; warm pool retains at most two targets', () => {
  const u = new URL(launchUrl('https://nas.example.com/entry.html', { intake: 'opaque', link: '/add' }));
  assert.equal(u.searchParams.get('intake'), 'opaque'); assert.equal(u.searchParams.get('link'), '/add');
  assert.ok(u.searchParams.get('launch'));
  assert.deepEqual(warmKeys(warmKeys(['a', 'b'], 'a'), 'c'), ['a', 'c']);
});
