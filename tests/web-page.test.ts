import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const page = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');

test('web page: sliding screens are clipped so a phone browser never lays the page out wider than the screen', () => {
  const root = page.match(/#root\s*\{([^}]*)\}/)?.[1] ?? '';
  assert.match(root, /overflow:\s*hidden/);
});

test('web page: the on-screen keyboard shrinks the layout so the focused form and its button stay above it', () => {
  const viewport = page.match(/<meta name="viewport" content="([^"]*)"/)?.[1] ?? '';
  assert.match(viewport, /width=device-width/);
  assert.match(viewport, /interactive-widget=resizes-content/);
});

test('web page: added to a home screen it opens like an App, with its own name and icons', () => {
  const manifest = JSON.parse(readFileSync(new URL('../public/manifest.webmanifest', import.meta.url), 'utf8'));
  assert.equal(manifest.display, 'standalone');
  for (const key of ['id', 'name', 'short_name', 'start_url', 'scope', 'theme_color', 'background_color']) assert.ok(manifest[key], key);
  assert.ok(manifest.short_name.length <= 12, 'short_name fits under a home screen icon');
  const sizes = manifest.icons.map((icon: { sizes: string; purpose: string }) => `${icon.sizes} ${icon.purpose}`);
  assert.deepEqual(sizes, ['192x192 any', '512x512 any', '512x512 maskable']);
  for (const icon of manifest.icons) assert.ok(readFileSync(new URL(`../public/${icon.src}`, import.meta.url)).length > 0, icon.src);
  assert.match(page, /<link rel="apple-touch-icon" sizes="180x180" href="icons\/apple-touch-icon.png" \/>/);
  for (const name of ['apple-mobile-web-app-capable', 'mobile-web-app-capable', 'apple-mobile-web-app-title', 'apple-mobile-web-app-status-bar-style']) assert.match(page, new RegExp(`<meta name="${name}" content="[^"]+"`), name);
  assert.match(page, /viewport-fit=cover/);
  const root = [...page.matchAll(/#root\s*\{([^}]*)\}/g)].map(match => match[1]).join(';');
  assert.match(root, /padding-left:\s*env\(safe-area-inset-left/);
  assert.match(root, /padding-right:\s*env\(safe-area-inset-right/);
});
