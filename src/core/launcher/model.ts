import type { NasProfile } from '../config.ts';
import type { NativeIntakeItem } from '../bridge/contract.ts';
import { acceptsIntake } from '../intake/accept.ts';
import type { Discovery } from '../discovery/client.ts';
import { DiscoveryError } from '../discovery/client.ts';
import type { DiscoveredApp } from '../discovery/schema.ts';
import { qrGroup, type NasQr } from '../profiles/qr.ts';
import { normalizeServer } from '../profiles/url.ts';
import { QC_ID } from '../profiles/quickconnect.ts';
import { pruneOrder } from './order.ts';

/** names: App names per DSM language, so a language switch never shows another language's cached names */
export type Snapshot = { scope: string; apps: DiscoveredApp[]; updated: number; names?: Record<string, Record<string, string>> };
/** The snapshot's Apps under their names in this language, where cached */
export function localized(snapshot: Snapshot, language: string): DiscoveredApp[] {
  const names = snapshot.names && typeof snapshot.names === 'object' ? snapshot.names[language] : undefined;
  return snapshot.apps.map(app => {
    const name = names && typeof names === 'object' ? names[app.id] : undefined;
    return typeof name === 'string' && name ? { ...app, name } : app;
  });
}
/** Replace this language's names; other languages keep names for Apps still listed */
export function withNames(previous: Snapshot['names'], language: string, apps: DiscoveredApp[]): Snapshot['names'] {
  const ids = new Set(apps.map(app => app.id)), names: Record<string, Record<string, string>> = {};
  for (const [lang, map] of Object.entries(previous && typeof previous === 'object' ? previous : {})) {
    if (lang === language || !map || typeof map !== 'object') continue;
    const kept = Object.fromEntries(Object.entries(map).filter(([id, name]) => ids.has(id) && typeof name === 'string'));
    if (Object.keys(kept).length) names[lang] = kept;
  }
  names[language] = Object.fromEntries(apps.map(app => [app.id, app.name]));
  return names;
}
/** order: App ids the user arranged on this phone, per NAS profile; never written to the NAS */
export type SavedLauncher = { profiles: NasProfile[]; active?: string; snapshots: Record<string, Snapshot>; order?: Record<string, string[]> };
export type LauncherState = SavedLauncher & { apps: DiscoveredApp[]; intakeApps: DiscoveredApp[]; updated?: number; refreshing: boolean; error?: string; signIn: boolean };
export type LauncherStorage = { read(): SavedLauncher | null; write(value: SavedLauncher): void };
export function intakeTargets(items: NativeIntakeItem[], apps: DiscoveredApp[]): DiscoveredApp[] {
  return apps.filter(app => app.registered && app.preset === 'mobile' && app.intake && acceptsIntake(items, app.intake));
}
export function intakeChoice(items: NativeIntakeItem[], apps: DiscoveredApp[]) {
  const matches = intakeTargets(items, apps);
  return { kind: matches.length === 1 ? 'open' as const : matches.length ? 'picker' as const : 'none' as const, matches };
}
/** Stable failure code for display: native network causes, HTTP status or DSM API code */
/** Minimum gap between progressive discovery updates */
export const PUBLISH_INTERVAL = 250;
export function errorCode(error: unknown): string {
  const code = error && typeof error === 'object' ? (error as { code?: unknown }).code : undefined;
  if (typeof code === 'number') return `API_${code}`;
  return typeof code === 'string' && /^[A-Za-z0-9_]{1,40}$/.test(code) ? code : 'failed';
}
/** State is read synchronously before the caller can start any network work */
export class LauncherModel {
  state: LauncherState;
  private generation = 0;
  private listeners = new Set<() => void>();
  private storage: LauncherStorage;
  private scope: (profile: NasProfile) => string;
  private discovery: Discovery;
  private clearInbox: () => void;
  private language: () => string;
  private candidates: DiscoveredApp[] = [];
  private runtime?: { profile: string; scope: string; values: Record<string, boolean> };
  private holdingList = false;
  private pendingList?: () => void;
  /** language: the DSM language code App names are shown in, read at each load and refresh */
  constructor(storage: LauncherStorage, scope: (profile: NasProfile) => string, discovery: Discovery, clearInbox: () => void, language: () => string = () => 'enu') {
    this.storage = storage; this.scope = scope; this.discovery = discovery; this.clearInbox = clearInbox; this.language = language;
    const saved = storage.read() || { profiles: [], snapshots: {} };
    this.state = { ...saved, order: saved.order || {}, apps: [], intakeApps: [], refreshing: false, signIn: false };
    this.loadActive();
  }
  get profile() { return this.state.profiles.find(profile => profile.id === this.state.active); }
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  getState = () => this.state;
  private commit(patch: Partial<LauncherState>) {
    this.state = { ...this.state, ...patch };
    const { profiles, active, snapshots, order } = this.state;
    this.storage.write({ profiles, active, snapshots, order });
    this.listeners.forEach(listener => listener());
  }
  private loadActive() {
    const profile = this.profile;
    const scope = profile ? this.scope(profile) : '';
    const snapshot = profile && scope ? this.state.snapshots[profile.id] : undefined;
    const apps = snapshot?.scope === scope ? localized(snapshot, this.language()) : [];
    this.candidates = apps;
    if (this.runtime?.profile !== profile?.id || this.runtime?.scope !== scope) this.runtime = undefined;
    this.holdingList = false; this.pendingList = undefined;
    this.state = { ...this.state, apps, intakeApps: apps, updated: snapshot?.scope === scope ? snapshot.updated : undefined, refreshing: false, error: undefined, signIn: Boolean(profile && !scope) };
  }
  /** sha256 is a leaf the user explicitly trusted for this exact origin */
  add(id: string, name: string, server: string, sha256?: string, quickconnect?: string) {
    const { origin } = normalizeServer(server);
    if (this.state.profiles.some(p => p.origin === origin)) throw new Error('DUPLICATE');
    if (sha256 !== undefined && (!origin.startsWith('https:') || !/^[a-f0-9]{64}$/.test(sha256))) throw new Error('INVALID_PIN');
    this.commit({ profiles: [...this.state.profiles, { id, name: name.trim() || new URL(origin).host, origin, ...(sha256 ? { sha256 } : {}), ...(quickconnect && QC_ID.test(quickconnect) ? { quickconnect } : {}) }] });
    this.select(id);
  }
  /** The QuickConnect ID this NAS is looked up by; undefined when its address was typed */
  setQuickConnect(id: string, quickconnect?: string) {
    const value = quickconnect && QC_ID.test(quickconnect) ? quickconnect : undefined;
    this.commit({ profiles: this.state.profiles.map(p => {
      if (p.id !== id) return p;
      const { quickconnect: _old, ...rest } = p;
      return value ? { ...rest, quickconnect: value } : rest;
    }) });
  }
  rename(id: string, name: string) {
    const value = name.trim();
    if (!value || /[\u0000-\u001f\u007f]/.test(value)) return;
    this.commit({ profiles: this.state.profiles.map(p => p.id === id ? { ...p, name: value.slice(0, 80) } : p) });
  }
  /** Fit desktop DSM Apps to the screen for this NAS; see mobileFitOn for the default */
  setMobileFit(id: string, value: boolean) {
    this.commit({ profiles: this.state.profiles.map(p => p.id === id ? { ...p, mobileFit: value } : p) });
  }
  /** A new origin keeps the profile identity but never inherits the old origin's sessions or snapshot */
  changeAddress(id: string, server: string, sha256?: string) {
    const { origin } = normalizeServer(server);
    const current = this.state.profiles.find(p => p.id === id);
    if (!current) return;
    if (this.state.profiles.some(p => p.id !== id && p.origin === origin)) throw new Error('DUPLICATE');
    if (sha256 !== undefined && (!origin.startsWith('https:') || !/^[a-f0-9]{64}$/.test(sha256))) throw new Error('INVALID_PIN');
    const { sha256: _old, ...rest } = current;
    const changed = origin !== current.origin;
    const snapshots = { ...this.state.snapshots };
    if (changed) delete snapshots[id];
    this.generation++; this.clearInbox();
    this.state = { ...this.state, snapshots, profiles: this.state.profiles.map(p => p.id === id ? { ...rest, origin, ...(sha256 ? { sha256 } : {}) } : p) };
    if (this.state.active === id) this.loadActive();
    this.commit({});
  }
  importQr(qr: NasQr, nextId: () => string) {
    const previous = qrGroup(this.state.profiles, qr);
    const group = previous[0]?.group || previous[0]?.id || nextId();
    const profiles = qr.urls.map(address => {
      const existing = previous.find(p => p.origin === address.url);
      return { id: existing?.id || nextId(), group, name: qr.name, origin: address.url, kind: address.kind, ...(address.sha256 ? { sha256: address.sha256 } : {}) };
    });
    const removed = new Set(previous.filter(p => !profiles.some(next => next.id === p.id)).map(p => p.id));
    const snapshots = Object.fromEntries(Object.entries(this.state.snapshots).filter(([id]) => !removed.has(id)));
    const order = Object.fromEntries(Object.entries(this.state.order || {}).filter(([id]) => !removed.has(id)));
    const previousIds = new Set(previous.map(p => p.id));
    this.commit({ profiles: [...this.state.profiles.filter(p => !previousIds.has(p.id)), ...profiles], snapshots, order });
    this.select(profiles[0].id);
    return profiles;
  }
  select(id: string) {
    if (!this.state.profiles.some(profile => profile.id === id)) return;
    this.generation++; this.clearInbox();
    this.state = { ...this.state, active: id };
    this.loadActive(); this.commit({});
  }
  remove(id: string) {
    this.generation++; this.clearInbox();
    const snapshots = { ...this.state.snapshots };
    delete snapshots[id];
    const order = { ...this.state.order }; delete order[id];
    const profiles = this.state.profiles.filter(profile => profile.id !== id);
    this.state = { ...this.state, profiles, snapshots, order, active: this.state.active === id ? profiles[0]?.id : this.state.active };
    this.loadActive(); this.commit({});
  }
  signOut(id: string) {
    this.generation++; this.clearInbox();
    this.candidates = []; this.runtime = undefined;
    this.holdingList = false; this.pendingList = undefined;
    const snapshots = { ...this.state.snapshots };
    delete snapshots[id];
    this.commit({ snapshots, apps: [], intakeApps: [], updated: undefined, refreshing: false, signIn: true, error: undefined });
  }
  /** A custom order replaces DSM's main-menu order for this NAS on this phone */
  setOrder(id: string, ids: string[]) {
    if (!this.state.profiles.some(p => p.id === id)) return;
    this.commit({ order: { ...this.state.order, [id]: [...new Set(ids.filter(value => typeof value === 'string'))] } });
  }
  resetOrder(id: string) {
    const order = { ...this.state.order }; delete order[id];
    this.commit({ order });
  }
  /** A background refresh must not move a card between press-in and press. */
  holdList() { this.holdingList = true; }
  releaseList() {
    this.holdingList = false;
    const pending = this.pendingList; this.pendingList = undefined;
    pending?.();
  }
  private visible(apps: DiscoveredApp[]) {
    const runtime = this.runtime;
    // A hardware-gated App waits for DSM's live runtime to confirm it
    if (!runtime || runtime.profile !== this.profile?.id || runtime.scope !== this.scope(this.profile)) return apps.filter(app => !app.runtimeOnly);
    return apps.filter(app => app.runtimeOnly ? runtime.values[app.id] === true : runtime.values[app.id] !== false);
  }
  applyRuntime(profile: string, scope: string, values: Record<string, boolean>) {
    if (!scope || this.profile?.id !== profile || this.scope(this.profile) !== scope) return;
    this.runtime = { profile, scope, values };
    const apply = () => {
      if (this.profile?.id !== profile || this.scope(this.profile) !== scope) return;
      const apps = this.visible(this.candidates);
      const snapshot = this.state.snapshots[profile];
      this.commit({ apps, intakeApps: this.visible(this.state.intakeApps), ...(snapshot ? { snapshots: { ...this.state.snapshots, [profile]: { ...snapshot, apps } } } : {}) });
    };
    if (this.holdingList) this.pendingList ||= apply; else apply();
  }
  async refresh() {
    const profile = this.profile;
    if (!profile) return;
    const generation = ++this.generation, scope = this.scope(profile), language = this.language();
    const current = () => generation === this.generation && this.profile?.id === profile.id && this.scope(profile) === scope;
    if (!scope) { this.commit({ apps: [], intakeApps: [], updated: undefined, signIn: true, refreshing: false }); return; }
    // If DSM changed users, discard the previous user's view before requesting anything
    const changedUser = this.state.snapshots[profile.id]?.scope !== scope;
    if (changedUser) {
      this.candidates = [];
      if (this.runtime?.profile !== profile.id || this.runtime?.scope !== scope) this.runtime = undefined;
      this.holdingList = false; this.pendingList = undefined;
    }
    this.commit({ refreshing: true, error: undefined, signIn: false, ...(changedUser ? { apps: [], intakeApps: [], updated: undefined } : {}) });
    let shown = false, latest: (() => void) | undefined, timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const publish = (apps: DiscoveredApp[], final = false) => {
        if (!current()) return;
        const apply = () => {
          if (!current()) return;
          // A raw candidate is still awaiting mobile.json; do not demote a
          // known registration until its own probe actually rejects it.
          this.candidates = apps.map(app => {
            const cached = this.candidates.find(previous => previous.id === app.id);
            return !app.registered && !app.reason && cached?.registered ? cached : app;
          }).sort((a, b) => a.name.localeCompare(b.name));
          const visible = this.visible(this.candidates);
          const snapshot = { scope, apps: visible, updated: Date.now(), names: withNames(this.state.snapshots[profile.id]?.scope === scope ? this.state.snapshots[profile.id].names : undefined, language, visible) };
          this.commit({ apps: snapshot.apps, intakeApps: this.visible(this.state.intakeApps.filter(cached => apps.some(app => app.id === cached.id))), updated: snapshot.updated, snapshots: { ...this.state.snapshots, [profile.id]: snapshot } });
        };
        const deliver = () => { if (this.holdingList) this.pendingList = apply; else apply(); };
        // The first list shows at once; later registration updates are coalesced so a NAS
        // with many Apps does not re-render and rewrite storage once per App
        if (!shown || final) { shown = true; clearTimeout(timer); timer = undefined; latest = undefined; deliver(); return; }
        latest = deliver;
        timer ??= setTimeout(() => { timer = undefined; const run = latest; latest = undefined; run?.(); }, PUBLISH_INTERVAL);
      };
      const apps = await this.discovery(profile, apps => publish(apps));
      if (current()) {
        publish(apps, true);
        // Only a complete list may drop uninstalled Apps from a custom order
        const custom = this.state.order?.[profile.id];
        const order = custom ? { ...this.state.order, [profile.id]: pruneOrder(custom, apps) } : this.state.order;
        this.commit({ refreshing: false, intakeApps: this.visible(apps), order });
      }
    } catch (error) {
      clearTimeout(timer);
      if (!current()) return;
      if (error instanceof DiscoveryError && ['SIGN_IN_REQUIRED', 105, 106, 107, 119].includes(error.code)) {
        this.signOut(profile.id);
      } else this.commit({ refreshing: false, error: errorCode(error) });
    }
  }
}
