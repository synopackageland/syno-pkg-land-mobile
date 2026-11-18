/**
 * The browser build's NAS list. Each NAS serves its own launcher on its own origin, so switching
 * NAS opens the other launcher's page. Every origin keeps the list in its own storage, and a switch
 * hands it over in the URL fragment, which the next page merges: the list follows the user from NAS
 * to NAS with no server. Entries carry names and addresses only, never credentials.
 *
 * Each entry has the time it last changed. A merge keeps the newer one per origin, and a removed NAS
 * stays as a dated tombstone, so a NAS removed on one page is not brought back by an older list.
 */
export type NasLink = {
  origin: string;
  name: string;
  /** The launcher page on that origin */
  launcher: string;
  /** When the entry last changed (added, renamed or removed), in ms */
  at: number;
  removed?: true;
  /**
   * No launcher answered there when it was added: switching opens that NAS's DSM instead. A NAS
   * does not need Connect to be on the list; the launcher's full pages are used once it has one.
   */
  dsm?: true;
  /** Last background check, kept on this origin only: reachable, and when it last was */
  reachable?: boolean;
  seen?: number;
};
export const FRAGMENT_KEY = 'spl-nas';
const MAX_LIVE = 32, MAX_ENTRIES = 64, MAX_NAME = 80;
/** Tombstones older than this are dropped */
export const TOMBSTONE_MS = 180 * 24 * 3600_000;

const httpOrigin = (value: unknown): string | undefined => {
  if (typeof value !== 'string' || value.length > 300) return undefined;
  try {
    const url = new URL(value);
    return /^https?:$/.test(url.protocol) && !url.username && !url.password && url.origin === value ? value : undefined;
  } catch { return undefined; }
};
/** The launcher URL, when it is an http(s) page on the given origin with no query or fragment */
export function launcherOn(origin: string, value: unknown): string | undefined {
  if (typeof value !== 'string' || value.length > 600) return undefined;
  try {
    const url = new URL(value);
    if (url.origin !== origin || url.username || url.password || url.search || url.hash || !url.pathname.startsWith('/')) return undefined;
    return url.href;
  } catch { return undefined; }
}
export function cleanName(value: unknown): string {
  return typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, MAX_NAME) : '';
}
/** One entry read from storage or a fragment, or undefined when any field is wrong */
export function linkOf(value: unknown, now: number): NasLink | undefined {
  const raw = value as Record<string, unknown> | null;
  if (!raw || typeof raw !== 'object') return undefined;
  const origin = httpOrigin(raw.origin), name = cleanName(raw.name);
  const launcher = origin ? launcherOn(origin, raw.launcher) : undefined;
  const at = typeof raw.at === 'number' && Number.isFinite(raw.at) && raw.at > 0 ? Math.min(raw.at, now) : undefined;
  if (!origin || !launcher || !name || !at) return undefined;
  const link: NasLink = { origin, name, launcher, at };
  if (raw.removed === true) link.removed = true;
  if (raw.dsm === true) link.dsm = true;
  if (typeof raw.reachable === 'boolean') link.reachable = raw.reachable;
  if (typeof raw.seen === 'number' && Number.isFinite(raw.seen) && raw.seen > 0) link.seen = Math.min(raw.seen, now);
  return link;
}
export function readLinks(value: unknown, now: number): NasLink[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>(), out: NasLink[] = [];
  for (const item of value.slice(0, MAX_ENTRIES)) {
    const link = linkOf(item, now);
    if (link && !seen.has(link.origin)) { seen.add(link.origin); out.push(link); }
  }
  return out;
}
/** Drops old tombstones and keeps at most MAX_LIVE NAS */
export function prune(links: NasLink[], now: number): NasLink[] {
  let live = 0;
  return links.filter(link => link.removed ? now - link.at < TOMBSTONE_MS : ++live <= MAX_LIVE).slice(0, MAX_ENTRIES);
}
/** The fields a list hands to other origins; check results stay local */
const shared = ({ origin, name, launcher, at, removed, dsm }: NasLink): NasLink => ({ origin, name, launcher, at, ...(removed ? { removed } : {}), ...(dsm ? { dsm } : {}) });
/**
 * The newer entry wins per origin; on a tie the local one stays. Local check results stay with
 * the local entry. New origins are added after the local ones, in the order they came.
 */
export function mergeLinks(local: NasLink[], incoming: NasLink[], now: number): NasLink[] {
  const byOrigin = new Map(incoming.map(link => [link.origin, link]));
  const out = local.map(mine => {
    const theirs = byOrigin.get(mine.origin);
    byOrigin.delete(mine.origin);
    if (!theirs || theirs.at <= mine.at) return mine;
    const { reachable, seen } = mine;
    return { ...shared(theirs), ...(reachable !== undefined ? { reachable } : {}), ...(seen ? { seen } : {}) };
  });
  for (const theirs of byOrigin.values()) out.push(shared(theirs));
  return prune(out, now);
}
/** This page's own NAS is always in its list, live, under the DSM server name */
export function withSelf(links: NasLink[], self: { origin: string; name: string; launcher: string }, now: number): NasLink[] {
  const index = links.findIndex(link => link.origin === self.origin);
  const mine = links[index];
  if (mine && !mine.removed && mine.name === self.name && mine.launcher === self.launcher) return links;
  const entry: NasLink = { ...(mine?.reachable !== undefined ? { reachable: mine.reachable } : {}), ...(mine?.seen ? { seen: mine.seen } : {}), origin: self.origin, name: self.name, launcher: self.launcher, at: Math.max(now, (mine?.at ?? 0) + 1) };
  return index < 0 ? [entry, ...links] : links.map((link, i) => i === index ? entry : link);
}
export function addLink(links: NasLink[], link: { origin: string; name: string; launcher: string; dsm?: boolean }, now: number): NasLink[] {
  const index = links.findIndex(l => l.origin === link.origin);
  const at = Math.max(now, (links[index]?.at ?? 0) + 1);
  const dsm = link.dsm ? { dsm: true as const } : {};
  if (index < 0) return prune([...links, { origin: link.origin, name: link.name, launcher: link.launcher, at, ...dsm }], now);
  // Adding again revives a removed NAS and keeps its name unless one was given
  return links.map((l, i) => i === index ? { origin: l.origin, name: l.removed ? link.name : l.name, launcher: link.launcher, at, ...dsm } : l);
}
export function removeLink(links: NasLink[], origin: string, now: number): NasLink[] {
  return prune(links.map(link => link.origin === origin ? { origin: link.origin, name: link.name, launcher: link.launcher, at: Math.max(now, link.at + 1), removed: true as const } : link), now);
}
/** A DSM-only NAS whose launcher now answers: switching opens the launcher from now on */
export function withLauncher(links: NasLink[], origin: string, now: number): NasLink[] {
  return links.map(link => {
    if (link.origin !== origin || !link.dsm) return link;
    const { dsm: _, ...rest } = link;
    return { ...rest, at: Math.max(now, link.at + 1) };
  });
}
export function setReach(links: NasLink[], origin: string, reachable: boolean, now: number): NasLink[] {
  return links.map(link => link.origin === origin ? { ...link, reachable, ...(reachable ? { seen: now } : {}) } : link);
}

const toBase64Url = (text: string) => {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};
const fromBase64Url = (value: string) => {
  const binary = atob(value.replace(/-/g, '+').replace(/_/g, '/'));
  return new TextDecoder().decode(Uint8Array.from(binary, c => c.charCodeAt(0)));
};
/** The fragment a switch adds to the next launcher's URL: names, addresses and times only */
export function encodeFragment(links: NasLink[]): string {
  const list = links.map(({ origin, name, launcher, at, removed, dsm }) => ({ o: origin, n: name, l: launcher, t: at, ...(removed ? { r: 1 } : {}), ...(dsm ? { d: 1 } : {}) }));
  return `${FRAGMENT_KEY}=${toBase64Url(JSON.stringify({ v: 1, list }))}`;
}
/** The list in a fragment (with or without its #), or undefined when there is none or it is not valid */
export function decodeFragment(hash: string, now: number): NasLink[] | undefined {
  const params = new URLSearchParams(hash.replace(/^#/, ''));
  const value = params.get(FRAGMENT_KEY);
  if (!value || value.length > 24_000) return undefined;
  try {
    const data = JSON.parse(fromBase64Url(value)) as { v?: unknown; list?: unknown };
    if (data?.v !== 1 || !Array.isArray(data.list)) return undefined;
    return readLinks(data.list.map(item => {
      const raw = item as Record<string, unknown> | null;
      return raw && { origin: raw.o, name: raw.n, launcher: raw.l, at: raw.t, ...(raw.r === 1 ? { removed: true } : {}), ...(raw.d === 1 ? { dsm: true } : {}) };
    }), now);
  } catch { return undefined; }
}
/** The fragment without the list, so a reload or a shared link does not carry it */
export function withoutFragment(hash: string): string {
  const params = new URLSearchParams(hash.replace(/^#/, ''));
  if (!params.has(FRAGMENT_KEY)) return hash;
  params.delete(FRAGMENT_KEY);
  const rest = params.toString();
  return rest ? `#${rest}` : '';
}

/**
 * Where to look for the launcher of a typed address (a DSM URL, a host, or a relay domain): the
 * candidate origins of the App's Add NAS (probe.ts candidateOrigins), in order. A page on HTTPS
 * cannot check plain HTTP addresses (the browser blocks mixed content), so those are left out there.
 */
export function launcherPages(origins: string[], path: string, pageProtocol: string): string[] {
  return origins.filter(origin => pageProtocol !== 'https:' || origin.startsWith('https:')).map(origin => new URL(path, origin).href);
}
/** A short host for display: the host, with the port when it is not the scheme's default */
export const hostOf = (origin: string) => new URL(origin).host;


/**
 * A refused certificate or port fails within a moment; a NAS off this network leaves the request
 * waiting. The browser hides which it was, so only the speed tells a likely certificate problem
 */
export const QUICK_FAILURE_MS = 3000;
export const quickFailure = (ms: number) => ms < QUICK_FAILURE_MS;
