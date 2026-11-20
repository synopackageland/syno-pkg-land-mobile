import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { DSM_BLUE, DSM_ICON_SIZES, DSM_TOUCH_ICON, DSM_VECTOR_ICON, HOME_ICON_SIZES, drawHomeIcons, dsmIcon, homeManifest, sampledColor, type DrawEnv } from '../src/core/install/dsm-icons.ts';

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

test('web page: added to a home screen it opens like an App, with its own name', () => {
  const manifest = JSON.parse(readFileSync(new URL('../public/manifest.webmanifest', import.meta.url), 'utf8'));
  assert.equal(manifest.display, 'standalone');
  for (const key of ['id', 'name', 'short_name', 'start_url', 'scope', 'theme_color', 'background_color']) assert.ok(manifest[key], key);
  assert.ok(manifest.short_name.length <= 12, 'short_name fits under a home screen icon');
  for (const name of ['apple-mobile-web-app-capable', 'mobile-web-app-capable', 'apple-mobile-web-app-title', 'apple-mobile-web-app-status-bar-style']) assert.match(page, new RegExp(`<meta name="${name}" content="[^"]+"`), name);
  assert.match(page, /viewport-fit=cover/);
  const root = [...page.matchAll(/#root\s*\{([^}]*)\}/g)].map(match => match[1]).join(';');
  assert.match(root, /padding-left:\s*env\(safe-area-inset-left/);
  assert.match(root, /padding-right:\s*env\(safe-area-inset-right/);
});

test("web page: the tab, home screen and install card show DSM's own icon, from DSM's origin", () => {
  const manifest = JSON.parse(readFileSync(new URL('../public/manifest.webmanifest', import.meta.url), 'utf8'));
  // Exactly what DSM's login page lists (DSM 7.1.1 to 7.4.1), as absolute paths on DSM's origin
  assert.deepEqual(manifest.icons, [{ src: DSM_TOUCH_ICON, sizes: '96x96', type: 'image/png', purpose: 'any' }]);
  const links = [...page.matchAll(/<link rel="(icon|apple-touch-icon|mask-icon)"[^>]*>/g)].map(match => match[0]);
  assert.deepEqual(links.map(link => [link.match(/rel="([^"]+)"/)![1], link.match(/sizes="([^"]+)"/)?.[1], link.match(/href="([^"]+)"/)![1]]), [
    ['icon', undefined, '/webman/favicon.ico'],
    ...[...DSM_ICON_SIZES].reverse().map(size => ['icon', `${size}x${size}`, dsmIcon(size)]),
    ['apple-touch-icon', undefined, DSM_TOUCH_ICON],
    ['mask-icon', undefined, '/webman/safari_pin_icon.svg'],
  ]);
  // No icon of the shell's own brand is left in the page or its build
  assert.equal(existsSync(new URL('../public/icons', import.meta.url)), false);
  const hint = readFileSync(new URL('../variants/land/InstallHint.web.tsx', import.meta.url), 'utf8');
  assert.match(hint, /applyDrawnHomeIcons\(document/);
  assert.match(hint, /let homeIcon = DSM_TOUCH_ICON;/);
});

test("home screen: the drawn icons replace the manifest's, and its own URLs become absolute for the blob: copy", () => {
  // As a host serves it: Connect points start_url and scope at its fixed address
  const served = { id: './', name: 'Package Land', start_url: '/webman/3rdparty/Pkg/m/index.html', scope: '/webman/3rdparty/Pkg/', display: 'standalone', icons: [{ src: DSM_TOUCH_ICON, sizes: '96x96' }] };
  const icons = HOME_ICON_SIZES.map(size => ({ size, url: `data:image/png;base64,${size}` }));
  const copy = homeManifest(served, 'https://nas.example:5001/webman/3rdparty/Pkg/abc123/m/manifest.webmanifest', icons);
  assert.equal(copy.id, 'https://nas.example:5001/webman/3rdparty/Pkg/abc123/m/');
  assert.equal(copy.start_url, 'https://nas.example:5001/webman/3rdparty/Pkg/m/index.html');
  assert.equal(copy.scope, 'https://nas.example:5001/webman/3rdparty/Pkg/');
  assert.equal(copy.name, 'Package Land');
  // Chrome installs a page only with an icon of at least 144 px; 180 px is iOS's apple-touch-icon
  assert.deepEqual(copy.icons, [
    { src: 'data:image/png;base64,192', sizes: '192x192', type: 'image/png', purpose: 'any' },
    { src: 'data:image/png;base64,512', sizes: '512x512', type: 'image/png', purpose: 'any' },
  ]);
  assert.deepEqual(served.icons, [{ src: DSM_TOUCH_ICON, sizes: '96x96' }], 'the original is left alone');
});

test("home screen: DSM's icon is drawn from DSM's own vector icon in the blue of its 96 px icon, or not at all", async () => {
  assert.equal(sampledColor([5, 127, 235, 255]), 'rgb(5, 127, 235)');
  assert.equal(sampledColor([0, 0, 0, 0]), DSM_BLUE);
  const drawn: string[] = [];
  const fetched: string[] = [];
  const env = (body: string, ok = true): DrawEnv => ({
    fetch: (async (url: string) => { fetched.push(url); return { ok, text: async () => body }; }) as unknown as typeof fetch,
    image: async src => ({ src }) as unknown as CanvasImageSource,
    canvas: () => {
      const ops: string[] = [];
      const g = { fillStyle: '', globalCompositeOperation: '', fillRect: () => ops.push('fill'), drawImage: (image: { src: string }) => ops.push(image.src?.startsWith('data:image/svg+xml') ? 'vector' : 'png'), getImageData: () => ({ data: [5, 127, 235, 255] }) };
      return { width: 0, height: 0, getContext: () => g as unknown as CanvasRenderingContext2D, toDataURL() { drawn.push(`${this.width}`); return `data:image/png;base64,${this.width}`; } };
    },
  });
  const svg = '<svg version="1.1" viewBox="0 0 64 64"><path d="M0 0"/></svg>';
  const icons = await drawHomeIcons(env(svg));
  assert.deepEqual(icons?.map(icon => icon.size), [...HOME_ICON_SIZES]);
  assert.deepEqual(drawn, ['180', '192', '512']);
  assert.deepEqual(fetched, [DSM_VECTOR_ICON]);
  // Not DSM's icon (an error page, another shape) or not there: the static 96 px icons stay
  assert.equal(await drawHomeIcons(env('<html>Not found</html>')), undefined);
  assert.equal(await drawHomeIcons(env('<svg viewBox="0 0 100 100"></svg>')), undefined);
  assert.equal(await drawHomeIcons(env(svg, false)), undefined);
});
