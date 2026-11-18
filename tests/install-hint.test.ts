import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DISMISSED_KEY, installKind, iosSafari, isDismissed, rememberDismissed, type InstallEnv } from '../src/core/install/hint.ts';
import { installLocale, installLocales, installStrings } from '../src/core/install/strings.ts';

const iphone = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1';
const ipad = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Safari/605.1.15';
const iosChrome = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/138.0.7204.119 Mobile/15E148 Safari/604.1';
const inAppView = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148';
const android = 'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Mobile Safari/537.36';
const env = (patch: Partial<InstallEnv>): InstallEnv => ({ userAgent: iphone, maxTouchPoints: 5, standalone: false, framed: false, canPrompt: false, dismissed: false, ...patch });

test('install hint: iPhone and iPad Safari get the Share steps, other iOS browsers and web views do not', () => {
  assert.equal(iosSafari(iphone), true);
  assert.equal(iosSafari(ipad, 5), true);
  assert.equal(iosSafari(ipad, 0), false, 'a real Mac is not an iPad');
  assert.equal(iosSafari(iosChrome), false);
  assert.equal(iosSafari(inAppView), false);
  assert.equal(iosSafari(android), false);
  assert.equal(installKind(env({})), 'ios');
  assert.equal(installKind(env({ userAgent: iosChrome })), null);
});
test('install hint: never once added, inside a frame or after it was closed', () => {
  assert.equal(installKind(env({ standalone: true })), null);
  assert.equal(installKind(env({ framed: true })), null);
  assert.equal(installKind(env({ dismissed: true })), null);
  assert.equal(installKind(env({ userAgent: android, canPrompt: true, standalone: true })), null);
});
test('install hint: other browsers get the button only when they offer their install prompt', () => {
  assert.equal(installKind(env({ userAgent: android })), null);
  assert.equal(installKind(env({ userAgent: android, canPrompt: true })), 'prompt');
  assert.equal(installKind(env({ userAgent: android, canPrompt: true, dismissed: true })), null);
});
test('install hint: closing it is remembered, and blocked storage never throws', () => {
  const map = new Map<string, string>();
  const store = { getItem: (key: string) => map.get(key) ?? null, setItem: (key: string, value: string) => { map.set(key, value); } };
  assert.equal(isDismissed(store), false);
  rememberDismissed(store, 1);
  assert.equal(map.get(DISMISSED_KEY), '1');
  assert.equal(isDismissed(store), true);
  const blocked = { getItem: () => { throw new Error('SecurityError'); }, setItem: () => { throw new Error('QuotaExceededError'); } };
  assert.equal(isDismissed(blocked), false);
  assert.doesNotThrow(() => rememberDismissed(blocked));
  assert.equal(isDismissed(undefined), false);
});
test('install hint copy: nine locales, every key, no trailing periods or ellipses', () => {
  const keys = Object.keys(installLocales.en).sort();
  assert.deepEqual(Object.keys(installLocales).sort(), ['de', 'en', 'es', 'fr', 'it', 'ja', 'ko', 'zh-CN', 'zh-TW']);
  for (const [name, table] of Object.entries(installLocales)) {
    assert.deepEqual(Object.keys(table).sort(), keys, name);
    for (const [key, text] of Object.entries(table)) {
      assert.ok(text, `${name}.${key} is empty`);
      assert.ok(!/[.。]$/.test(text), `${name}.${key} ends with a period`);
      assert.ok(!/(\.\.\.|…)/.test(text), `${name}.${key} contains an ellipsis`);
      assert.ok(!/android/i.test(text), `${name}.${key} names Android`);
    }
    assert.ok(table.title.includes('{name}'), `${name}.title names the App`);
  }
});
test('install hint copy: browser languages map to the nine locales like the launcher splits Chinese', () => {
  assert.equal(installLocale('zh-TW'), 'zh-TW');
  assert.equal(installLocale('zh-HK'), 'zh-TW');
  assert.equal(installLocale('zh-Hant-TW'), 'zh-TW');
  assert.equal(installLocale('zh-CN'), 'zh-CN');
  assert.equal(installLocale('zh-Hans-SG'), 'zh-CN');
  assert.equal(installLocale('ja-JP'), 'ja');
  assert.equal(installLocale('de_CH'), 'de');
  assert.equal(installLocale('pt-BR'), 'en');
  assert.equal(installLocale(), 'en');
  assert.equal(installStrings('fr-CA'), installLocales.fr);
});
test('install hint copy: the card follows the App\'s language, never the browser\'s first preferred one', () => {
  // A browser can prefer en-US while the page itself is in Traditional Chinese
  const web = readFileSync(new URL('../variants/land/InstallHint.web.tsx', import.meta.url), 'utf8');
  assert.doesNotMatch(web, /navigator\.language/);
  assert.match(web, /installStrings\(locale\)/);
  assert.equal(installStrings('zh-TW'), installLocales['zh-TW']);
});
test('install hint: the native App renders nothing', () => {
  const native = readFileSync(new URL('../variants/land/InstallHint.tsx', import.meta.url), 'utf8');
  assert.match(native, /return null;/);
});
