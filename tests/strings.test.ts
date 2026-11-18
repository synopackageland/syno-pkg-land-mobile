import test from 'node:test';
import assert from 'node:assert/strict';
import { causeText, fill, locales, strings } from '../src/core/i18n/strings.ts';

test('every locale has every key and follows the UI copy rules', () => {
  const keys = Object.keys(locales.en).sort();
  for (const [name, table] of Object.entries(locales)) {
    assert.deepEqual(Object.keys(table).sort(), keys, name);
    for (const [key, text] of Object.entries(table)) {
      assert.ok(text, `${name}.${key} is empty`);
      assert.ok(!/[.。]$/.test(text), `${name}.${key} ends with a period`);
      assert.ok(!/(\.\.\.|…)/.test(text), `${name}.${key} contains an ellipsis`);
    }
  }
});
test('locale selection falls back to English and splits Chinese scripts', () => {
  assert.equal(strings('en-US'), locales.en);
  assert.equal(strings('zh-TW'), locales.zh);
  assert.equal(strings('zh-Hant-HK'), locales.zh);
  assert.equal(strings('zh-CN'), locales.hans);
  assert.equal(strings('fr-FR'), locales.en);
});
test('placeholders and error causes render readable text', () => {
  assert.equal(fill('{a} and {b}', { a: 1, b: 'x' }), '1 and x');
  const t = locales.en;
  assert.equal(causeText(t, 'dns'), t.cause_dns);
  assert.ok(causeText(t, 'HTTP_503').includes('503'));
  assert.ok(causeText(t, 'API_119').includes('119'));
  assert.equal(causeText(t, 'INVALID_PACKAGES'), `${t.cause_failed} (INVALID_PACKAGES)`);
  assert.equal(causeText(t, 'failed'), t.cause_failed);
});
