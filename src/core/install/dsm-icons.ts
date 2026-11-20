/**
 * The browser page shows DSM's own icon, so it reads as part of DSM, not as another brand. A package
 * serves the page from DSM's origin (webman/3rdparty/<package>/...), where DSM's icon files exist on
 * every DSM 7 (7.1.1 to 7.4.1 serve the same files). They are used from there, not copied, so they
 * follow the DSM version.
 *
 * - The tab: DSM's favicon.ico and icon_dsm_16 to 96 px, as DSM's login page lists them
 *   (public/index.html).
 * - The home screen: DSM's largest PNG is 96 px, and Chrome offers to install a page only with an
 *   icon of at least 144 px. So the page draws DSM's icon at 180, 192 and 512 px from DSM's own
 *   vector icon (its Safari pinned-tab SVG: the rounded square with the letters cut out), filled with
 *   the blue of DSM's 96 px icon and with white behind the letters. It then points the manifest link
 *   at a copy of the page's manifest with those icons, and apple-touch-icon at the 180 px one.
 *   Until then, or when DSM's files can't be read, the static files name DSM's 96 px icon.
 *
 * tests/web-page.test.ts checks public/index.html and public/manifest.webmanifest against this.
 */
export const DSM_ICON_DIR = '/webman/resources/images/';
/** The sizes DSM lists on its own pages, as icon_dsm_<size>.png */
export const DSM_ICON_SIZES = [16, 32, 48, 64, 96] as const;
export const dsmIcon = (size: (typeof DSM_ICON_SIZES)[number]) => `${DSM_ICON_DIR}icon_dsm_${size}.png`;
/** DSM's own apple-touch-icon, and the largest PNG it has */
export const DSM_TOUCH_ICON = dsmIcon(96);
/** DSM's vector icon (mask-icon): one path on a 64 × 64 view box */
export const DSM_VECTOR_ICON = '/webman/safari_pin_icon.svg';
/** The colour DSM gives its mask-icon, when its 96 px icon can't be read */
export const DSM_BLUE = '#0086E5';
/** Drawn sizes: iOS's apple-touch-icon, and the two Chrome wants in a manifest */
export const HOME_ICON_SIZES = [180, 192, 512] as const;

type Manifest = Record<string, unknown>;
export type HomeIcon = { size: number; url: string };

/**
 * The page's manifest with the drawn icons. The copy is loaded from a blob: URL, so its own URLs
 * become absolute against where the original was read (a host may have rewritten them)
 */
export function homeManifest(manifest: Manifest, manifestUrl: string, icons: HomeIcon[]): Manifest {
  const absolute = (value: unknown) => typeof value === 'string' ? new URL(value, manifestUrl).href : value;
  const copy: Manifest = { ...manifest };
  for (const key of ['id', 'start_url', 'scope']) if (key in copy) copy[key] = absolute(copy[key]);
  copy.icons = icons.filter(icon => icon.size !== 180).map(icon => ({ src: icon.url, sizes: `${icon.size}x${icon.size}`, type: 'image/png', purpose: 'any' }));
  return copy;
}

/** A sampled pixel as a CSS colour; DSM's blue when it is not an opaque colour */
export function sampledColor(pixel: ArrayLike<number>): string {
  const [r, g, b, a] = [pixel[0], pixel[1], pixel[2], pixel[3]];
  return a === 255 ? `rgb(${r}, ${g}, ${b})` : DSM_BLUE;
}

type Canvas = { width: number; height: number; getContext(kind: '2d'): CanvasRenderingContext2D | null; toDataURL(type: string): string };
export type DrawEnv = { fetch: typeof fetch; canvas(): Canvas; image(src: string): Promise<CanvasImageSource> };

/** DSM's icon at one size: white where the letters are cut out, the vector shape over it in DSM's blue */
function draw(env: DrawEnv, vector: CanvasImageSource, color: string, size: number): string {
  const canvas = env.canvas(); canvas.width = canvas.height = size;
  const shape = env.canvas(); shape.width = shape.height = size;
  const g = canvas.getContext('2d'), s = shape.getContext('2d');
  if (!g || !s) throw new Error('no 2d canvas');
  const unit = size / 64;
  // Under the letters only: inside the shape's rounded corners (radius 8), around the letters (x 3 to 61)
  g.fillStyle = '#FFFFFF'; g.fillRect(3 * unit, 3 * unit, 58 * unit, 58 * unit);
  s.drawImage(vector, 0, 0, size, size);
  s.globalCompositeOperation = 'source-in'; s.fillStyle = color; s.fillRect(0, 0, size, size);
  g.drawImage(shape as unknown as CanvasImageSource, 0, 0);
  return canvas.toDataURL('image/png');
}

/** DSM's icon drawn at HOME_ICON_SIZES from DSM's own files, or undefined when they can't be read */
export async function drawHomeIcons(env: DrawEnv): Promise<HomeIcon[] | undefined> {
  try {
    const response = await env.fetch(DSM_VECTOR_ICON, { credentials: 'same-origin' });
    const svg = response.ok ? await response.text() : '';
    if (!/<svg[\s>]/.test(svg) || !/viewBox="0 0 64 64"/.test(svg)) return undefined;
    // A size of its own, so every browser scales the whole view box (without one, some use 300 × 150)
    const sized = /<svg[^>]*\swidth=/.test(svg) ? svg : svg.replace(/<svg(?=[\s>])/, '<svg width="64" height="64"');
    const vector = await env.image(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(sized)}`);
    let color = DSM_BLUE;
    try {
      const probe = env.canvas(); probe.width = probe.height = 96;
      const g = probe.getContext('2d');
      if (g) { g.drawImage(await env.image(DSM_TOUCH_ICON), 0, 0); color = sampledColor(g.getImageData(48, 6, 1, 1).data); }
    } catch { /* Keep the mask-icon's colour */ }
    return HOME_ICON_SIZES.map(size => ({ size, url: draw(env, vector, color, size) }));
  } catch { return undefined; }
}

/**
 * In the browser page: draws the icons, then points the manifest link and apple-touch-icon at them.
 * Resolves with the 180 px icon, or undefined when the static DSM icons stay
 */
export async function applyDrawnHomeIcons(doc: Document, env: DrawEnv): Promise<string | undefined> {
  const link = doc.querySelector<HTMLLinkElement>('link[rel="manifest"]');
  if (!link) return undefined;
  const manifestUrl = link.href;
  const [icons, manifest] = await Promise.all([
    drawHomeIcons(env),
    env.fetch(manifestUrl, { credentials: 'same-origin' }).then(r => r.ok ? r.json() as Promise<Manifest> : undefined).catch(() => undefined),
  ]);
  if (!icons || !manifest || typeof manifest !== 'object') return undefined;
  link.href = URL.createObjectURL(new Blob([JSON.stringify(homeManifest(manifest, manifestUrl, icons))], { type: 'application/manifest+json' }));
  const touch = icons.find(icon => icon.size === 180)!.url;
  const apple = doc.querySelector<HTMLLinkElement>('link[rel="apple-touch-icon"]');
  if (apple) { apple.href = touch; apple.setAttribute('sizes', '180x180'); }
  return touch;
}
