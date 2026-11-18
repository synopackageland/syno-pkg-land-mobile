import { addLink, quickFailure, decodeFragment, encodeFragment, launcherOn, launcherPages, mergeLinks, readLinks, removeLink, setReach, withLauncher, withoutFragment, withSelf, type NasLink } from './nas-links';
import { AddressError, candidateOrigins, parseAddress } from './probe';
import { fixedProfile } from '../platform';
import { parseQuickConnect } from './quickconnect';
import type { FindResult, RemoteNas, RemoteState } from './remote';

const KEY = 'spl:nas-links';
/** The query a launcher answers inside a probe frame (see public/index.html) */
const PROBE = 'spl-probe=1';
const PROBE_MS = 10_000, PING_MS = 8_000, RECHECK_MS = 30_000;
/** A launcher answers as soon as its page runs; once every frame has loaded, this long is enough */
const LOADED_MS = 2_000;

const read = (): NasLink[] => { try { return readLinks(JSON.parse(window.localStorage.getItem(KEY) || '[]'), Date.now()); } catch { return []; } };
const write = (links: NasLink[]) => { try { window.localStorage.setItem(KEY, JSON.stringify(links)); } catch { /* Private mode or full: the list lives for this page only */ } };

let launcherPath = '';
/**
 * The address of this launcher that survives updates: the manifest's start page, which a package
 * that serves the build from a versioned folder points at its fixed page. Other NAS run the same
 * package, so their launcher is at the same path.
 */
export async function loadLauncherPath(): Promise<void> {
  try {
    const link = document.querySelector<HTMLLinkElement>('link[rel="manifest"]');
    if (link?.href) {
      const manifest = await (await fetch(link.href, { credentials: 'same-origin' })).json() as { start_url?: unknown };
      if (typeof manifest.start_url === 'string') {
        const url = new URL(manifest.start_url, link.href);
        if (url.origin === location.origin) { launcherPath = url.pathname; return; }
      }
    }
  } catch { /* The page's own address below */ }
  launcherPath = location.pathname;
}

let state: RemoteState = { links: [], checking: [] };
const listeners = new Set<() => void>();
const publish = (links: NasLink[], checking = state.checking) => { state = { links, checking }; listeners.forEach(listener => listener()); };
const save = (links: NasLink[]) => { write(links); publish(links); };
const checked = new Map<string, number>();

/** Run once at boot, after the server name and launcher path are known */
export function startRemote(): void {
  const now = Date.now();
  let links = read();
  const handed = decodeFragment(location.hash, now);
  if (handed) {
    links = mergeLinks(links, handed, now);
    // The list is not kept in the address: a reload or a shared link must not carry it
    try { history.replaceState(history.state, '', location.pathname + location.search + withoutFragment(location.hash)); } catch { /* Kept */ }
  }
  const self = fixedProfile();
  const launcher = launcherOn(location.origin, new URL(launcherPath || location.pathname, location.origin).href);
  if (self && launcher) links = withSelf(links, { origin: location.origin, name: self.name, launcher }, now);
  save(links);
}

/**
 * Whether something answered at that page: an opaque reply is enough, its content is never read.
 * refused: the browser gave up quickly instead of waiting, which for HTTPS usually means it
 * rejected the certificate (a page is never told why)
 */
async function ping(url: string): Promise<{ ok: boolean; refused: boolean }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PING_MS);
  const started = Date.now();
  try { await fetch(url, { mode: 'no-cors', credentials: 'omit', cache: 'no-store', referrerPolicy: 'no-referrer', signal: controller.signal }); return { ok: true, refused: false }; }
  catch { return { ok: false, refused: !controller.signal.aborted && quickFailure(Date.now() - started) }; }
  finally { clearTimeout(timer); }
}
const answers = async (url: string) => (await ping(url)).ok;
/**
 * Whether a listed NAS answers. A DSM-only one is also asked for a launcher, so a NAS that gained
 * one since it was added opens the launcher's full pages from then on.
 */
async function reach(link: NasLink): Promise<{ ok: boolean; launcher?: boolean }> {
  if (!link.dsm) return { ok: await answers(link.launcher) };
  if (await probeLaunchers([link.launcher], new AbortController().signal)) return { ok: true, launcher: true };
  return { ok: await answers(`${link.origin}/`) };
}
/** Mixed content: an HTTPS page cannot reach a plain HTTP address in the background */
const checkable = (origin: string) => location.protocol !== 'https:' || origin.startsWith('https:');

/**
 * Loads each page in a hidden frame and waits for a launcher's answer. Only a launcher posts it
 * (public/index.html), with no data; nothing is read from the frame and no other message counts.
 */
function probeLaunchers(pages: string[], signal: AbortSignal): Promise<{ origin: string; launcher: string } | undefined> {
  return new Promise(resolve => {
    const frames: { frame: HTMLIFrameElement; origin: string; launcher: string }[] = [];
    let done = false;
    const finish = (value?: { origin: string; launcher: string }) => {
      if (done) return;
      done = true; clearTimeout(timer); window.removeEventListener('message', onMessage); signal.removeEventListener('abort', onAbort);
      for (const { frame } of frames) frame.remove();
      resolve(value);
    };
    const onMessage = (event: MessageEvent) => {
      const hit = frames.find(f => event.source === f.frame.contentWindow && event.origin === f.origin);
      if (hit && (event.data as Record<string, unknown> | null)?.['spl-launcher'] === 1) finish({ origin: hit.origin, launcher: hit.launcher });
    };
    const onAbort = () => finish();
    let timer = setTimeout(() => finish(), PROBE_MS), loaded = 0;
    window.addEventListener('message', onMessage);
    signal.addEventListener('abort', onAbort);
    for (const launcher of pages) {
      const frame = document.createElement('iframe');
      frame.setAttribute('aria-hidden', 'true'); frame.tabIndex = -1;
      frame.referrerPolicy = 'no-referrer';
      frame.setAttribute('sandbox', 'allow-scripts allow-same-origin');
      frame.style.cssText = 'position:absolute;width:1px;height:1px;left:-10px;top:-10px;border:0;visibility:hidden';
      // A page that loaded without answering is not a launcher: stop soon after the last one loads
      frame.addEventListener('load', () => { if (++loaded === pages.length && !done) { clearTimeout(timer); timer = setTimeout(() => finish(), LOADED_MS); } }, { once: true });
      frame.src = `${launcher}?${PROBE}`;
      frames.push({ frame, origin: new URL(launcher).origin, launcher });
      document.body.appendChild(frame);
    }
    if (signal.aborted) finish();
  });
}

export const remoteNas: RemoteNas = {
  get self() { return location.origin; },
  subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; },
  getState: () => state,
  check() {
    const now = Date.now();
    const due = state.links.filter(link => !link.removed && link.origin !== location.origin && checkable(link.origin) && now - (checked.get(link.origin) ?? 0) > RECHECK_MS);
    if (!due.length) return;
    for (const link of due) checked.set(link.origin, now);
    publish(state.links, [...state.checking, ...due.map(link => link.origin)]);
    for (const link of due) void reach(link).then(({ ok, launcher }) => {
      let links = setReach(state.links, link.origin, ok, Date.now());
      if (launcher) links = withLauncher(links, link.origin, Date.now());
      write(links); publish(links, state.checking.filter(origin => origin !== link.origin));
    });
  },
  switchTo(origin) {
    const link = state.links.find(l => l.origin === origin && !l.removed);
    if (!link) return false;
    if (link.dsm) { remoteNas.openDsm(origin); return false; }
    write(state.links);
    // Replaces the entry of the open switcher, so back from the other NAS returns to this one's page
    location.replace(`${link.launcher}#${encodeFragment(state.links)}`);
    return true;
  },
  remove(origin) { if (origin !== location.origin) save(removeLink(state.links, origin, Date.now())); },
  async find(input, signal): Promise<FindResult> {
    // QuickConnect's directory does not answer browser pages (no CORS); the Android App can use it
    if (parseQuickConnect(input)?.explicit) return { kind: 'invalid', code: 'quickconnect' };
    let origins: string[];
    try {
      const address = parseAddress(input);
      // An HTTPS page may not load an HTTP address (mixed content); say so instead of trying only HTTPS
      if (address.scheme === 'http' && location.protocol === 'https:') return { kind: 'invalid', code: 'mixed' };
      origins = candidateOrigins(address);
    } catch (e) { return { kind: 'invalid', code: e instanceof AddressError ? e.code : 'invalid' }; }
    const pages = launcherPages(origins, launcherPath || location.pathname, location.protocol);
    if (!pages.length) return { kind: 'invalid', code: 'scheme' };
    // Each address is also pinged at once: when none answers at all, no launcher can, so the
    // frames stop instead of waiting out their timeout
    const frames = new AbortController();
    const stop = () => frames.abort();
    signal.addEventListener('abort', stop);
    const pinged = Promise.all(pages.map(page => ping(new URL('/', page).href)));
    void pinged.then(results => { if (!results.some(r => r.ok)) stop(); });
    const found = await probeLaunchers(pages, frames.signal);
    signal.removeEventListener('abort', stop);
    if (found) return { kind: 'found', ...found };
    if (signal.aborted) return { kind: 'unreachable' };
    // No launcher answered: tell a DSM without Connect from an address that does not answer at all
    const reached = await pinged;
    const index = reached.findIndex(r => r.ok);
    if (index >= 0) return { kind: 'noLauncher', origin: new URL(pages[index]).origin };
    // Name the HTTPS address the browser turned away at once: that is where a certificate needs accepting
    const refused = reached.findIndex((r, i) => r.refused && pages[i].startsWith('https:'));
    return { kind: 'unreachable', origin: new URL(pages[Math.max(refused, 0)]).origin, certificate: refused >= 0 };
  },
  add(link) {
    const launcher = launcherOn(link.origin, link.launcher);
    if (!launcher) return;
    const links = addLink(state.links, { origin: link.origin, name: link.name, launcher, dsm: link.dsm }, Date.now());
    // One added although nothing answered is checked the next time the switcher opens
    if (link.unanswered) { checked.delete(link.origin); save(links); return; }
    checked.set(link.origin, Date.now());
    save(setReach(links, link.origin, true, Date.now()));
  },
  openDsm(origin) { window.open(`${origin}/`, '_blank', 'noopener'); },
};
