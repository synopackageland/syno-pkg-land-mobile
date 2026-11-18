import type { NasProfile } from '../config.ts';
import type { DiscoveredApp } from '../discovery/schema.ts';
import { ICON_SIZES } from '../discovery/filter.ts';

/** One conditional icon request; the native side writes dest only on a 200 image */
export type IconResponse = { status: number; etag?: string | null; lastModified?: string | null; size?: number };
export type IconFetch = (url: string, origin: string, dest: string, etag?: string, lastModified?: string) => Promise<IconResponse>;
/** Disk access, kept outside so the cache logic runs in plain Node tests */
export type IconFiles = {
  readIndex(): string | null;
  writeIndex(text: string): void;
  /** Absolute path for a new file in this profile's folder */
  path(profile: string, name: string): string;
  uri(path: string): string;
  remove(path: string): void;
  removeProfile(profile: string): void;
  /** Every cached image path, to drop files the index no longer names */
  list(): string[];
};
export type IconEntry = {
  key: string; url?: string; file?: string; etag?: string; lastModified?: string; bytes?: number;
  used: number; checked?: number; failures?: number; retryAt?: number; failedKey?: string;
};
export type IconSource = { key: string; urls: string[] };

/** Sizes that cover the target first (smallest first), then smaller ones (largest first) */
export function iconSizes(pixels: number): number[] {
  const sizes = [...ICON_SIZES].sort((a, b) => a - b);
  return [...sizes.filter(size => size >= pixels), ...sizes.filter(size => size < pixels).reverse()];
}
function stamp(url: string): string {
  try { return new URL(url).searchParams.get('v') || ''; } catch { return ''; }
}
/**
 * Candidate URLs and the cache key. The key changes with the package version or
 * the URL's own ?v= stamp: Package Land icons have a fixed mtime, so their
 * ETag alone cannot show a changed image.
 */
export function iconSource(app: DiscoveredApp, pixels: number): IconSource | undefined {
  if (app.iconTemplate && !app.registered) {
    return { key: `${app.iconTemplate}|${app.version || stamp(app.iconTemplate)}`, urls: iconSizes(pixels).map(size => app.iconTemplate!.replaceAll('{0}', String(size))) };
  }
  if (!app.icon) return undefined;
  return { key: `${app.icon}|${stamp(app.icon) || app.version || ''}`, urls: [app.icon] };
}
const entryKey = (profile: string, app: string) => `${profile}\u0000${app}`;

/**
 * Icons the browser loads itself, from the same origin: each App starts at the size that covers
 * the tile and moves to its next size when the image fails, so an App whose DSM folder lacks a
 * size (many have no 256 px icon) shows its next one instead of the letter tile.
 */
export class WebIcons {
  private next = new Map<string, number>();
  private listeners = new Set<() => void>();
  private pixels: number;
  constructor(pixels: number) { this.pixels = pixels; }
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private key(profile: string | undefined, app: DiscoveredApp, source: IconSource) { return `${entryKey(profile || '', app.id)}\u0000${source.key}`; }
  uri(profile: string | undefined, app: DiscoveredApp): string | undefined {
    const source = iconSource(app, this.pixels);
    return source?.urls[this.next.get(this.key(profile, app, source)) || 0];
  }
  /** The shown URL failed: the App moves on to its next size, once per URL; past the last, no icon */
  failed(profile: string | undefined, app: DiscoveredApp, uri: string) {
    const source = iconSource(app, this.pixels);
    if (!source) return;
    const key = this.key(profile, app, source), index = this.next.get(key) || 0;
    if (source.urls[index] !== uri) return;
    this.next.set(key, index + 1);
    this.listeners.forEach(listener => listener());
  }
}
const BACKOFF = 60_000, MAX_BACKOFF = 6 * 60 * 60_000;
function hash(value: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < value.length; i++) h = Math.imul(h ^ value.charCodeAt(i), 0x01000193) >>> 0;
  return h.toString(36);
}

export type IconCacheOptions = { pixels: number; maxEntries?: number; maxBytes?: number; concurrency?: number; now?: () => number };
/**
 * Persistent App icons per NAS profile and App, stale-while-revalidate:
 * a cached icon shows at once, and each launcher refresh revalidates it at most
 * once with If-None-Match / If-Modified-Since. Failures keep the last good icon
 * (or the letter tile) and back off instead of retrying in a loop.
 */
export class IconCache {
  private index: Record<string, IconEntry> = {};
  /** Rounds are timestamps, so a round checked in an earlier process never matches a new one */
  private round: number;
  private listeners = new Set<() => void>();
  private inflight = new Map<string, { generation: number; task: Promise<void> }>();
  private generation = new Map<string, number>();
  private active = 0;
  private waiting: (() => void)[] = [];
  private files: IconFiles; private fetch: IconFetch; private options: Required<IconCacheOptions>;
  constructor(files: IconFiles, fetch: IconFetch, options: IconCacheOptions) {
    this.files = files; this.fetch = fetch;
    this.options = { maxEntries: 400, maxBytes: 24 * 1024 * 1024, concurrency: 4, now: () => Date.now(), ...options };
    this.round = this.options.now();
    try {
      const value = JSON.parse(files.readIndex() || '{}');
      if (value && value.version === 1 && value.entries && typeof value.entries === 'object') this.index = value.entries;
    } catch { this.index = {}; }
    // Files left behind by an interrupted write are not in the index
    try {
      const named = new Set(Object.values(this.index).map(entry => entry.file).filter(Boolean));
      for (const path of files.list()) if (!named.has(path)) files.remove(path);
    } catch { /* A cleanup failure never blocks the launcher */ }
  }
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private emit() { this.listeners.forEach(listener => listener()); }
  private save() { try { this.files.writeIndex(JSON.stringify({ version: 1, entries: this.index })); } catch { /* Next save retries */ } }

  /** Cached file URI, available synchronously on the first render */
  uri(profile: string | undefined, app: DiscoveredApp): string | undefined {
    const file = profile ? this.index[entryKey(profile, app.id)]?.file : undefined;
    return file ? this.files.uri(file) : undefined;
  }
  entry(profile: string, app: string): IconEntry | undefined { return this.index[entryKey(profile, app)]; }
  /** A cached file that does not decode: the next launcher refresh revalidates it */
  failed(_profile: string | undefined, _app: DiscoveredApp, _uri: string) {}
  /** A new launcher refresh: each icon may be revalidated once more */
  beginRound() { this.round = Math.max(this.round + 1, this.options.now()); }

  private async slot<T>(work: () => Promise<T>): Promise<T> {
    if (this.active >= this.options.concurrency) await new Promise<void>(resolve => this.waiting.push(resolve));
    this.active++;
    try { return await work(); } finally { this.active--; this.waiting.shift()?.(); }
  }

  /** Fetch missing or changed icons; revalidate cached ones when asked */
  async sync(profile: NasProfile, apps: DiscoveredApp[], revalidate = false, force = false): Promise<void> {
    const now = this.options.now();
    const work: Promise<void>[] = [];
    for (const app of apps) {
      const source = iconSource(app, this.options.pixels);
      if (!source) continue;
      const key = entryKey(profile.id, app.id);
      const entry = this.index[key];
      if (entry) entry.used = now;
      // A request from before a clear is ignored when it answers, so it cannot stand in for a new one
      const running = this.inflight.get(key);
      if (running && running.generation === (this.generation.get(profile.id) || 0)) { work.push(running.task); continue; }
      const changed = !entry || entry.key !== source.key || !entry.file;
      if (!force) {
        // A failure backs off for that same source; a new version or stamp tries at once
        if (entry?.failedKey === source.key && (entry.checked === this.round || (entry.retryAt || 0) > now)) continue;
        if (!changed && (!revalidate || entry.checked === this.round)) continue;
      }
      const current = { generation: this.generation.get(profile.id) || 0, task: undefined as unknown as Promise<void> };
      current.task = this.slot(() => this.load(profile, app.id, source, changed || force ? undefined : entry))
        .finally(() => { if (this.inflight.get(key) === current) this.inflight.delete(key); });
      this.inflight.set(key, current);
      const task = current.task;
      work.push(task);
    }
    await Promise.all(work);
    this.evict();
    this.save();
  }

  private async load(profile: NasProfile, app: string, source: IconSource, cached?: IconEntry) {
    const key = entryKey(profile.id, app);
    const generation = this.generation.get(profile.id) || 0;
    const urls = cached?.url ? [cached.url] : source.urls;
    let failed = true;
    for (const url of urls) {
      const dest = this.files.path(profile.id, `${hash(app)}-${this.options.now().toString(36)}${Math.random().toString(36).slice(2, 6)}.png`);
      let response: IconResponse;
      try { response = await this.fetch(url, profile.origin, dest, cached?.etag, cached?.lastModified); } catch { break; }
      // A cleared profile must not be repopulated by a request that started earlier
      if ((this.generation.get(profile.id) || 0) !== generation) { if (response.status === 200) this.files.remove(dest); return; }
      const current = this.index[key];
      if (response.status === 304 && current) {
        this.index[key] = { ...current, checked: this.round, failures: 0, retryAt: undefined, failedKey: undefined };
        failed = false; break;
      }
      if (response.status === 200) {
        if (current?.file && current.file !== dest) this.files.remove(current.file);
        this.index[key] = { key: source.key, url, file: dest, etag: response.etag || undefined, lastModified: response.lastModified || undefined, bytes: response.size || 0, used: this.options.now(), checked: this.round, failures: 0 };
        failed = false; this.emit(); break;
      }
      // Another size may exist; any other answer ends this attempt
      if (response.status !== 404) break;
    }
    if (failed) {
      const current = this.index[key];
      const failures = current?.failedKey === source.key ? (current.failures || 0) + 1 : 1;
      this.index[key] = { ...(current || { key: '', used: this.options.now() }), checked: this.round, failures, failedKey: source.key, retryAt: this.options.now() + Math.min(BACKOFF * 2 ** (failures - 1), MAX_BACKOFF) };
    }
  }

  private evict() {
    const entries = Object.entries(this.index).sort(([, a], [, b]) => a.used - b.used);
    let bytes = entries.reduce((sum, [, entry]) => sum + (entry.bytes || 0), 0), count = entries.length;
    for (const [key, entry] of entries) {
      if (count <= this.options.maxEntries && bytes <= this.options.maxBytes) break;
      if (entry.file) this.files.remove(entry.file);
      delete this.index[key]; count--; bytes -= entry.bytes || 0;
    }
  }
  private drop(match: (key: string) => boolean) {
    let changed = false;
    for (const [key, entry] of Object.entries(this.index)) if (match(key)) {
      if (entry.file) this.files.remove(entry.file);
      delete this.index[key]; changed = true;
    }
    return changed;
  }
  /** Removing a NAS removes its icons */
  clearProfile(profile: string) {
    this.generation.set(profile, (this.generation.get(profile) || 0) + 1);
    this.drop(key => key.startsWith(`${profile}\u0000`));
    try { this.files.removeProfile(profile); } catch { /* Index no longer names the files */ }
    this.save(); this.emit();
  }
  retainProfiles(profiles: string[]) {
    const keep = new Set(profiles);
    const gone = new Set(Object.keys(this.index).map(key => key.split('\u0000')[0]).filter(id => !keep.has(id)));
    gone.forEach(id => this.clearProfile(id));
  }
  /** After a complete discovery: Apps no longer offered lose their icons */
  retainApps(profile: string, apps: string[]) {
    const keep = new Set(apps.map(app => entryKey(profile, app)));
    if (this.drop(key => key.startsWith(`${profile}\u0000`) && !keep.has(key))) { this.save(); this.emit(); }
  }
  /** Long-press refresh: clear this NAS's icons and fetch them again */
  async refresh(profile: NasProfile, apps: DiscoveredApp[]) {
    this.clearProfile(profile.id);
    this.beginRound();
    await this.sync(profile, apps, false, true);
  }
}
