/**
 * NAS status for the home page, the status detail and the notification list.
 *
 * - One compound SYNO.Entry.Request per refresh carries every item that is due.
 * - Polls only while a status surface is on screen and the App is in the
 *   foreground; the next refresh is scheduled after the previous one answers,
 *   so a slow NAS never gets overlapping requests and is never declared failed
 *   by a clock: the last values stay on screen with their time.
 * - Cached values per NAS profile and account appear before the first answer.
 * - An item DSM refuses (non-administrators, or a missing API) is remembered and
 *   hidden; it is asked again once per App run.
 */
import { record } from '../discovery/schema.ts';
import { capsFresh, mapApiInfo, pick, type Capabilities } from './capabilities.ts';
import { mapNotifications, mapNoticeStrings, type Health, type NoticeString, type Notifications, type Overview, type UserInfo, type Utilization, type Volume } from './mappers.ts';
import type { Backups } from './modules/backup.ts';
import { LIVE, type LiveSample } from './live.ts';
import { mapHistory, type HistoryRange, type ResourceHistory } from './modules/history.ts';
import { modules, type Unavailable } from './modules/index.ts';
import type { Security } from './modules/security.ts';
import type { Upgrade } from './modules/upgrade.ts';
import type { Pool } from './modules/storage.ts';
import { MAX_NOTICES } from './modules/system.ts';

export type Item = 'util' | 'overview' | 'health' | 'storage' | 'user' | 'upgrade' | 'notify' | 'lastRead' | 'security' | 'backup' | 'history';
export type Mode = 'off' | 'home' | 'status' | 'notifications';
type Call = { api: string; version: number; method: string; [key: string]: unknown };
/** Each item's call at its lowest tested version; the model picks the version DSM offers */
export const calls = Object.fromEntries(Object.values(modules).map(m => [m.id, { api: m.requires.api, version: m.requires.min, ...m.params }])) as Record<Item, Call>;
const second = 1000, minute = 60 * second;
/** Refresh period of each item per surface; history is read when a range is picked. Utilization feeds the live charts (live.ts) */
export const periods: Record<Mode, Partial<Record<Item, number>>> = {
  off: {},
  // DSM answers the update check from its own stored result; an hour keeps the tag current without asking more
  home: { util: LIVE.period, overview: minute, health: minute, storage: minute, user: 24 * 60 * minute, upgrade: 60 * minute, notify: minute, lastRead: minute, security: 5 * minute, backup: 5 * minute },
  status: { util: LIVE.period, overview: minute, health: 30 * second, storage: minute, user: 24 * 60 * minute, security: 5 * minute, backup: 5 * minute },
  notifications: { notify: minute, lastRead: minute, user: 24 * 60 * minute },
};
/** Inner codes meaning "not for this account or not on this DSM": hide, don't show an error */
const DENIED = new Set([102, 103, 104, 105, 1006]);
/** Outer codes meaning the session or SynoToken is gone */
const SESSION = new Set([105, 106, 107, 119]);
/** Inner code for "no such API": the capability table is read again once */
const NO_API = 102;

/** One live sample with its time; the chart draws one continuous line through them (live.ts) */
export type TrendPoint = LiveSample;
export type StatusSnapshot = {
  scope: string; util?: Utilization; overview?: Overview; health?: Health; volumes?: Volume[]; user?: UserInfo; notices?: Notifications; lastRead?: number;
  pools?: Pool[]; security?: Security; upgrade?: Upgrade; backups?: Backups; history?: ResourceHistory; trend?: TrendPoint[];
  /** When each item last answered, epoch ms */
  times: Partial<Record<Item, number>>;
  /** Hidden: DSM refused the account, or the API is absent (e.g. a package not installed) */
  denied: Item[];
  /** Shown as one "Open in DSM" row: the DSM lacks a version we support, or the feature is off */
  unavailable?: Partial<Record<Item, Unavailable>>;
};
export type ReadState = { before: number; ids: number[] };
export type StatusState = {
  profile?: string; snapshot?: StatusSnapshot; read: ReadState;
  refreshing: boolean; error?: string; failedAt?: number; signedOut: boolean; loadingMore: boolean;
  strings?: Record<string, NoticeString>;
  /** Items that answered since this NAS was selected; others show cached values with their time */
  live: Item[];
  historyLoading: boolean;
};
export type StatusStorage = {
  read(profile: string): { snapshot?: StatusSnapshot; read?: ReadState } | null;
  write(profile: string, value: { snapshot?: StatusSnapshot; read?: ReadState }): void;
  readStrings(profile: string, lang: string): { time: number; strings: Record<string, NoticeString> } | null;
  writeStrings(profile: string, lang: string, value: { time: number; strings: Record<string, NoticeString> }): void;
  readCaps?(profile: string): Capabilities | null;
  writeCaps?(profile: string, value: Capabilities): void;
  remove(profile: string): void;
};
export type ReadJson = (url: string, origin: string) => Promise<{ status: number; body: string }>;
export type StatusDeps = {
  read: ReadJson; storage: StatusStorage; now?: () => number;
  setTimer?: (fn: () => void, ms: number) => unknown; clearTimer?: (handle: unknown) => void;
};
class StatusError extends Error {
  code: string;
  constructor(code: string) { super('Status request failed'); this.code = code; }
}
const MAX_READ_IDS = 500, STRINGS_AGE = 7 * 24 * 60 * minute;

function parse(response: { status: number; body: string }): Record<string, unknown> {
  if (response.status !== 200) throw new StatusError(`HTTP_${response.status}`);
  try { return record(JSON.parse(response.body)); } catch { throw new StatusError('INVALID_JSON'); }
}
/** Unread: newer than DSM's read mark and this phone's, and not opened on this phone */
export function unreadCount(snapshot: StatusSnapshot | undefined, read: ReadState): number {
  const notices = snapshot?.notices;
  if (!notices) return 0;
  const before = Math.max(snapshot.lastRead ?? 0, read.before);
  const opened = new Set(read.ids);
  return notices.items.filter(item => item.time > before && !opened.has(item.id)).length;
}
/** DSM holds older notifications than the phone loaded and the oldest loaded one is still unread: more may be unread */
export function moreUnread(snapshot: StatusSnapshot | undefined, read: ReadState): boolean {
  const notices = snapshot?.notices, oldest = notices?.items[notices.items.length - 1];
  return Boolean(notices && oldest && notices.total > notices.items.length && oldest.time > Math.max(snapshot.lastRead ?? 0, read.before));
}
export function isUnread(snapshot: StatusSnapshot | undefined, read: ReadState, item: { id: number; time: number }) {
  return item.time > Math.max(snapshot?.lastRead ?? 0, read.before) && !read.ids.includes(item.id);
}
/** What a screen does with a module: show it, leave it out, or offer DSM instead */
export function moduleState(snapshot: StatusSnapshot | undefined, item: Item): 'ok' | 'hidden' | Unavailable {
  if (!snapshot) return 'ok';
  const unavailable = snapshot.unavailable?.[item];
  if (unavailable) return unavailable;
  return snapshot.denied.includes(item) ? 'hidden' : 'ok';
}

export class StatusModel {
  state: StatusState = { read: { before: 0, ids: [] }, refreshing: false, signedOut: false, loadingMore: false, live: [], historyLoading: false };
  private listeners = new Set<() => void>();
  private deps: Required<Omit<StatusDeps, 'storage'>> & { storage: StatusStorage };
  private origin = '';
  private generation = 0;
  private mode: Mode = 'off';
  private foreground = true;
  private timer: unknown;
  private inFlight = false;
  private token = '';
  private retried = new Set<string>();
  private failures = 0;
  /** The capability table for the selected NAS, and whether a 102 asked to read it again */
  private caps?: Capabilities;
  private capsTried?: string;
  private capsStale = false;
  private capsReread = false;
  constructor(deps: StatusDeps) {
    this.deps = { now: Date.now, setTimer: (fn, ms) => setTimeout(fn, ms), clearTimer: handle => clearTimeout(handle as ReturnType<typeof setTimeout>), ...deps };
  }
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  getState = () => this.state;
  private set(patch: Partial<StatusState>, save = false) {
    this.state = { ...this.state, ...patch };
    if (save && this.state.profile) this.deps.storage.write(this.state.profile, { snapshot: this.state.snapshot, read: this.state.read });
    this.listeners.forEach(listener => listener());
  }
  get active() { return this.foreground && this.mode !== 'off' && Boolean(this.state.profile) && !this.state.signedOut; }
  /**
   * Switches to a NAS profile and account. Cached values for that pair appear
   * at once; values cached for another account on the same NAS are dropped.
   */
  select(profile: string | undefined, origin: string, scope: string) {
    if (profile === this.state.profile && scope === this.state.snapshot?.scope && origin === this.origin && !this.state.signedOut) return;
    this.generation++; this.token = ''; this.origin = origin; this.failures = 0; this.inFlight = false;
    this.caps = undefined; this.capsTried = undefined; this.capsStale = false; this.capsReread = false;
    this.cancelTimer();
    const reset = { refreshing: false, error: undefined, failedAt: undefined, strings: undefined, live: [], historyLoading: false };
    if (!profile || !scope) { this.set({ profile, snapshot: undefined, read: { before: 0, ids: [] }, signedOut: Boolean(profile), ...reset }); return; }
    const saved = this.deps.storage.read(profile);
    const snapshot = saved?.snapshot?.scope === scope ? saved.snapshot : { scope, times: {}, denied: [] };
    const read = saved?.snapshot?.scope === scope && saved.read ? saved.read : { before: 0, ids: [] };
    this.caps = this.deps.storage.readCaps?.(profile) ?? undefined;
    this.set({ profile, snapshot, read, signedOut: false, ...reset });
    this.schedule(0);
  }
  /** Which surface is visible; 'off' when none is */
  setMode(mode: Mode) {
    if (mode === this.mode) return;
    this.mode = mode;
    this.cancelTimer();
    if (this.active) this.schedule(0);
  }
  setForeground(foreground: boolean) {
    if (foreground === this.foreground) return;
    this.foreground = foreground;
    this.cancelTimer();
    if (this.active) this.schedule(0);
  }
  /** Removing a NAS forgets its cached status */
  forget(profile: string) { this.deps.storage.remove(profile); }
  private cancelTimer() { if (this.timer !== undefined) { this.deps.clearTimer(this.timer); this.timer = undefined; } }
  private schedule(ms: number) {
    this.cancelTimer();
    if (!this.active || this.inFlight) return;
    this.timer = this.deps.setTimer(() => { this.timer = undefined; void this.tick(); }, ms);
  }
  /** Items due now and the wait until the next one */
  private due(force: Item[] = []): { items: Item[]; wait: number } {
    const snapshot = this.state.snapshot;
    if (!snapshot) return { items: [], wait: Infinity };
    const now = this.deps.now();
    const items: Item[] = [];
    let wait = Infinity;
    for (const [item, period] of Object.entries(periods[this.mode]) as [Item, number][]) {
      const key = `${snapshot.scope}:${item}`;
      // Refused or unavailable items are asked once per App run, then left alone
      const parked = snapshot.denied.includes(item) || Boolean(snapshot.unavailable?.[item]);
      if (parked && this.retried.has(key)) continue;
      const left = force.includes(item) || parked ? 0 : (snapshot.times[item] ?? -Infinity) + period - now;
      if (left <= 0) items.push(item); else wait = Math.min(wait, left);
    }
    for (const item of force) if (!items.includes(item)) items.push(item);
    return { items, wait };
  }
  /** Pull to refresh: every item of the visible surface now */
  refresh() {
    if (!this.state.profile || this.inFlight) return Promise.resolve();
    return this.tick(Object.keys(periods[this.mode]) as Item[]);
  }
  private async api(params: Record<string, string>, generation: number) {
    const query = (token: string) => new URLSearchParams({ ...params, SynoToken: token }).toString();
    for (let attempt = 0; attempt < 2; attempt++) {
      if (!this.token) {
        const login = parse(await this.deps.read(new URL('/webman/login.cgi?enable_syno_token=yes', this.origin).href, this.origin));
        if (generation !== this.generation) throw new StatusError('STALE');
        if (login.success !== true || typeof login.SynoToken !== 'string' || !login.SynoToken) throw new StatusError('SIGN_IN_REQUIRED');
        this.token = login.SynoToken;
      }
      const value = parse(await this.deps.read(new URL(`/webapi/entry.cgi?${query(this.token)}`, this.origin).href, this.origin));
      if (generation !== this.generation) throw new StatusError('STALE');
      if (value.success === true) return record(value.data);
      const code = Number(record(value.error).code);
      if (!SESSION.has(code)) throw new StatusError(`API_${code || 'ERROR'}`);
      // A stale SynoToken gets one fresh token; a lost session means sign in again
      this.token = '';
      if (attempt === 1 || code !== 119) throw new StatusError('SIGN_IN_REQUIRED');
    }
    throw new StatusError('SIGN_IN_REQUIRED');
  }
  /** Several calls in one SYNO.Entry.Request; each answer keeps its own success and error */
  private async compound(entries: Call[], generation: number) {
    const data = await this.api({ api: 'SYNO.Entry.Request', version: '1', method: 'request', stop_when_error: 'false', compound: JSON.stringify(entries) }, generation);
    return Array.isArray(data.result) ? data.result.map(record) : [];
  }
  /**
   * Reads SYNO.API.Info once per DSM build (and per day, and once more after a
   * 102). A failed read keeps the old table; modules then use their lowest
   * tested version, as before the table existed.
   */
  private async ensureCaps(generation: number) {
    const profile = this.state.profile!, build = this.state.snapshot?.user?.build, now = this.deps.now();
    if (this.caps && !this.caps.build && build) { this.caps = { ...this.caps, build }; this.deps.storage.writeCaps?.(profile, this.caps); }
    if (!this.capsStale && capsFresh(this.caps, build, now)) return;
    const attempt = `${build ?? ''}:${this.capsStale}`;
    if (this.capsTried === attempt) return;
    this.capsTried = attempt;
    try {
      const data = await this.api({ api: 'SYNO.API.Info', version: '1', method: 'query', query: 'all' }, generation);
      this.caps = mapApiInfo(data, build, this.deps.now());
      this.deps.storage.writeCaps?.(profile, this.caps);
    } catch (error) {
      const code = error instanceof StatusError ? error.code : '';
      if (code === 'STALE' || code === 'SIGN_IN_REQUIRED') throw error;
    } finally { this.capsStale = false; }
  }
  private async tick(force: Item[] = []) {
    if (this.inFlight || !this.state.profile || this.state.signedOut || (!this.active && !force.length)) return;
    const { items, wait } = this.due(force);
    if (!items.length) { if (wait < Infinity) this.schedule(wait); return; }
    const generation = this.generation, scope = this.state.snapshot!.scope;
    this.inFlight = true;
    this.set({ refreshing: true });
    try {
      await this.ensureCaps(generation);
      if (generation !== this.generation) return;
      const now = this.deps.now();
      let snapshot: StatusSnapshot = { ...this.state.snapshot!, times: { ...this.state.snapshot!.times }, denied: [...this.state.snapshot!.denied], unavailable: { ...this.state.snapshot!.unavailable } };
      const unavailable = snapshot.unavailable!;
      const hide = (item: Item) => { if (!snapshot.denied.includes(item)) snapshot.denied.push(item); delete unavailable[item]; };
      const sent: Item[] = [], entries: Call[] = [];
      for (const item of items) {
        const module = modules[item], choice = pick(this.caps, module.requires);
        this.retried.add(`${scope}:${item}`);
        if ('missing' in choice) { if (module.missing === 'hide') hide(item); else { unavailable[item] = 'unsupported'; snapshot.denied = snapshot.denied.filter(v => v !== item); } continue; }
        if ('unsupported' in choice) { unavailable[item] = 'unsupported'; snapshot.denied = snapshot.denied.filter(v => v !== item); continue; }
        sent.push(item); entries.push({ api: module.requires.api, version: choice.version, ...module.params } as Call);
      }
      const results = entries.length ? await this.compound(entries, generation) : [];
      const live = new Set(this.state.live);
      sent.forEach((item, index) => {
        const result = results[index], module = modules[item];
        if (!result) return;
        if (result.success !== true) {
          const code = Number(record(result.error).code);
          if (module.disabled?.includes(code)) { unavailable[item] = 'disabled'; snapshot.denied = snapshot.denied.filter(v => v !== item); }
          else if (DENIED.has(code)) hide(item);
          if (code === NO_API && !this.capsReread) { this.capsReread = true; this.capsStale = true; }
          return;
        }
        snapshot.denied = snapshot.denied.filter(value => value !== item);
        delete unavailable[item];
        snapshot.times[item] = now;
        snapshot = { ...snapshot, ...module.apply(snapshot, result.data, now) };
        live.add(item);
      });
      if (generation !== this.generation) return;
      this.failures = 0;
      this.set({ snapshot, live: [...live], error: undefined, failedAt: undefined }, true);
    } catch (error) {
      if (generation !== this.generation) return;
      const code = error instanceof StatusError ? error.code : String((error as { code?: unknown })?.code ?? 'failed');
      if (code === 'STALE') return;
      if (code === 'SIGN_IN_REQUIRED') { this.set({ signedOut: true, error: code }); return; }
      this.failures++;
      this.set({ error: code, failedAt: this.deps.now() });
    } finally {
      if (generation === this.generation) {
        this.inFlight = false;
        this.set({ refreshing: false });
        // After failures, back off up to a minute; a slow answer already spaced the requests
        if (this.failures) this.schedule(Math.min(minute, 5 * second * 2 ** (this.failures - 1)));
        else { const { items, wait } = this.due(); this.schedule(items.length ? 0 : wait); }
      }
    }
  }
  /**
   * DSM's own resource history for a range. Answers 1008 while "Usage history"
   * is off in Resource Monitor: the module then shows why and offers DSM.
   */
  async loadHistory(range: HistoryRange) {
    const profile = this.state.profile, module = modules.history;
    if (!profile || !this.state.snapshot || this.state.historyLoading || this.state.signedOut) return;
    const generation = this.generation;
    this.set({ historyLoading: true });
    try {
      await this.ensureCaps(generation);
      const choice = pick(this.caps, module.requires);
      const current = () => this.state.snapshot!;
      const patch = (fn: (s: StatusSnapshot) => StatusSnapshot) => { if (generation === this.generation) this.set({ snapshot: fn(current()) }, true); };
      if (!('version' in choice)) { patch(s => ({ ...s, unavailable: { ...s.unavailable, history: 'unsupported' } })); return; }
      const [result] = await this.compound([{ api: module.requires.api, version: choice.version, ...module.params, time_range: range } as unknown as Call], generation);
      if (!result) return;
      if (result.success !== true) {
        const code = Number(record(result.error).code);
        if (module.disabled?.includes(code)) patch(s => ({ ...s, unavailable: { ...s.unavailable, history: 'disabled' } }));
        else if (DENIED.has(code)) patch(s => ({ ...s, denied: s.denied.includes('history') ? s.denied : [...s.denied, 'history'] }));
        return;
      }
      const value = mapHistory(result.data, range);
      const now = this.deps.now();
      patch(s => {
        const unavailable = { ...s.unavailable }; delete unavailable.history;
        return { ...s, history: value, times: { ...s.times, history: now }, unavailable, denied: s.denied.filter(v => v !== 'history') };
      });
    } catch (error) {
      const code = error instanceof StatusError ? error.code : '';
      if (code === 'SIGN_IN_REQUIRED' && generation === this.generation) this.set({ signedOut: true, error: code });
    } finally { if (generation === this.generation) this.set({ historyLoading: false }); }
  }
  /** Older notifications for the list's end */
  async loadMoreNotices() {
    const snapshot = this.state.snapshot, notices = snapshot?.notices;
    if (!snapshot || !notices || this.state.loadingMore || notices.items.length >= Math.min(notices.total, MAX_NOTICES)) return;
    const generation = this.generation;
    this.set({ loadingMore: true });
    try {
      const data = await this.api({ ...stringify(calls.notify), offset: String(notices.items.length), limit: '30' }, generation);
      const page = mapNotifications(data);
      const current = this.state.snapshot!;
      const known = new Set(current.notices?.items.map(item => item.id));
      const items = [...(current.notices?.items ?? []), ...page.items.filter(item => !known.has(item.id))].slice(0, MAX_NOTICES);
      this.set({ snapshot: { ...current, notices: { ...(current.notices ?? page), items, total: page.total } } }, true);
    } catch { /* The list keeps what it has; scrolling again retries */ }
    finally { if (generation === this.generation) this.set({ loadingMore: false }); }
  }
  /** The notification catalog (about 150 KB) is read once a week per NAS and language */
  async loadStrings(lang: string) {
    const profile = this.state.profile;
    if (!profile) return;
    const cached = this.deps.storage.readStrings(profile, lang);
    if (cached) this.set({ strings: cached.strings });
    if (cached && this.deps.now() - cached.time < STRINGS_AGE) return;
    const generation = this.generation;
    try {
      const data = await this.api({ api: 'SYNO.Core.DSMNotify.Strings', version: '1', method: 'get', pkgName: '', lang }, generation);
      const strings = mapNoticeStrings(data);
      this.deps.storage.writeStrings(profile, lang, { time: this.deps.now(), strings });
      if (generation === this.generation) this.set({ strings });
    } catch { /* Titles fall back to the event tag */ }
  }
  /** DSM keeps one read mark per account; opening an item marks it read on this phone only */
  /** Marks one notice, or every notice of a collapsed group, read on the phone */
  markRead(ids: number | number[]) {
    const fresh = [ids].flat().filter(id => !this.state.read.ids.includes(id));
    if (!fresh.length) return;
    this.set({ read: { ...this.state.read, ids: [...this.state.read.ids, ...fresh].slice(-MAX_READ_IDS) } }, true);
  }
  markAllRead() {
    const newest = this.state.snapshot?.notices?.newest ?? 0;
    this.set({ read: { before: Math.max(this.state.read.before, newest), ids: [] } }, true);
  }
}
const stringify = (call: Call) => Object.fromEntries(Object.entries(call).map(([key, value]) => [key, String(value)]));
/** DSM language codes for the App's locales */
export function dsmLang(locale: string): string {
  const l = locale.toLowerCase();
  if (l.startsWith('zh')) return /hans|cn|sg/.test(l) ? 'chs' : 'cht';
  return 'enu';
}
