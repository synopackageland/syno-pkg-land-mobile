/** Address entry and DSM discovery before sign-in. Pure logic; the native probe is injected. */
import { PINGPONG_PATH, RELAY_ORDER, lookupQuickConnect, parseQuickConnect, pingpongMatches, requestTunnel, type QcFailure, type QcKind, type QcPost } from './quickconnect.ts';
export type ParsedAddress = { host: string; port?: number; scheme?: 'http' | 'https' };
export type AddressErrorCode = 'empty' | 'invalid' | 'credentials' | 'scheme';
export class AddressError extends Error {
  code: AddressErrorCode;
  constructor(code: AddressErrorCode) { super(code); this.code = code; }
}
export type ProbeTls = { sha256: string; trusted: boolean; chainTrusted: boolean; hostnameMatch: boolean; selfSigned?: boolean; expired: boolean; subject?: string; issuer?: string; notAfter?: number };
export type ProbeResponse = { status?: number; body?: string; location?: string | null; error?: string; tls?: ProbeTls | null };
export type ProbeFn = (url: string, id: string) => Promise<ProbeResponse>;

/** Accept host, host:port, IPv4/IPv6 and http(s) URLs; ignore paths. No scheme is required. */
export function parseAddress(input: string): ParsedAddress {
  const value = input.trim().replace(/^[\s"'<]+|[\s"'>]+$/g, '');
  if (!value) throw new AddressError('empty');
  const scheme = /^([a-z][a-z\d+.-]*):\/\//i.exec(value)?.[1]?.toLowerCase();
  if (scheme && scheme !== 'http' && scheme !== 'https') throw new AddressError('scheme');
  const rest = scheme ? value.slice(scheme.length + 3) : value;
  const authority = rest.split(/[/?#]/)[0];
  if (authority.includes('@')) throw new AddressError('credentials');
  if (!authority || /[\s\\]/.test(authority)) throw new AddressError('invalid');
  const typedPort = /^(?:\[[^\]]+\]|[^:]+):(\d{1,5})$/.exec(authority)?.[1];
  let url: URL;
  try { url = new URL(`http://${authority}`); } catch { throw new AddressError('invalid'); }
  const host = url.hostname.toLowerCase();
  if (!host || host.endsWith('.') && host.length === 1) throw new AddressError('invalid');
  const port = typedPort ? Number(typedPort) : undefined;
  if (port !== undefined && (port < 1 || port > 65535)) throw new AddressError('invalid');
  return { host, ...(port ? { port } : {}), ...(scheme ? { scheme: scheme as 'http' | 'https' } : {}) };
}

export function originOf(scheme: 'http' | 'https', host: string, port: number): string {
  return new URL(`${scheme}://${host}:${port}`).origin;
}
const defaultPort = (scheme: 'http' | 'https') => scheme === 'https' ? 443 : 80;

/** DSM defaults plus what was typed. Ports 80/443 stay in the set because reverse proxies serve DSM there. */
export function candidateOrigins(address: ParsedAddress): string[] {
  const { host, port, scheme } = address;
  const list: string[] = [];
  const add = (s: 'http' | 'https', p: number) => { const o = originOf(s, host, p); if (!list.includes(o)) list.push(o); };
  if (scheme) add(scheme, port ?? defaultPort(scheme));
  else if (port) { add('https', port); add('http', port); }
  add('https', 5001); add('http', 5000);
  if (!port) { add('https', 443); add('http', 80); }
  return list;
}

const probePath = '/webapi/query.cgi?api=SYNO.API.Info&version=1&method=query&query=SYNO.API.Auth';
export function isDsmInfo(body: string | undefined): boolean {
  try {
    const value = JSON.parse(body || '');
    return value?.success === true && Boolean(value.data?.['SYNO.API.Auth']);
  } catch { return false; }
}
/** DSM's port 80/443 redirect page lists its real HTTP/HTTPS ports */
export function redirectPorts(body: string | undefined): { http?: number; https?: number } {
  const read = (id: string) => {
    const match = new RegExp(`id=["']${id}["'][^>]*value=["'](\\d{1,5})["']`, 'i').exec(body || '');
    const port = match ? Number(match[1]) : NaN;
    return port > 0 && port < 65536 ? port : undefined;
  };
  return { http: read('http'), https: read('https') };
}
const entities: Record<string, string> = { nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", '#39': "'" };
/** The sign-in page title is "<server name> - Synology NAS" (DSM 7) or "- Synology DiskStation" (DSM 6) */
export function serverName(html: string | undefined): string | undefined {
  const raw = /<title[^>]*>([^<]*)<\/title>/i.exec(html || '')?.[1];
  if (!raw) return undefined;
  const text = raw.replace(/&(#\d+|#x[\da-f]+|[a-z]+\d*);/gi, (all, code: string) => {
    const lower = code.toLowerCase();
    if (lower.startsWith('#x')) return String.fromCodePoint(parseInt(lower.slice(2), 16));
    if (lower.startsWith('#') && lower !== '#39') return String.fromCodePoint(Number(lower.slice(1)));
    return entities[lower] ?? all;
  }).replace(/\s+/g, ' ').trim();
  // Desktop pages use "NAME - Synology NAS"; the mobile page uses "DSM mobile - NAME"
  const name = text.replace(/^DSM mobile\s+-\s+/i, '').split(/\s+-\s+Synology\b/i)[0].trim();
  if (!name || /^(synology( nas| diskstation)?|diskstation)$/i.test(name) || name.length > 64 || /[\u0000-\u001f]/.test(name)) return undefined;
  return name;
}
/** Short default when DSM does not publish a server name */
export function hostName(host: string): string {
  if (/^[\d.]+$/.test(host) || host.includes(':')) return host;
  return host.split('.')[0] || host;
}

export type CertState = 'http' | 'trusted' | 'untrusted' | 'mismatch' | 'expired' | 'changed';
/** Pinned: the leaf the user already trusted for this exact origin */
export function certState(origin: string, tls: ProbeTls | null | undefined, pinned?: string): CertState {
  if (origin.startsWith('http:')) return 'http';
  if (!tls) return 'untrusted';
  if (pinned && tls.sha256 !== pinned) return 'changed';
  if (tls.expired) return 'expired';
  if (tls.trusted || pinned === tls.sha256) return 'trusted';
  return tls.chainTrusted && !tls.hostnameMatch ? 'mismatch' : 'untrusted';
}

export type CandidateState = 'pending' | 'dsm' | 'other' | 'failed' | 'cancelled';
/** qc: an address QuickConnect reported, with the portal's preference (lower is better) */
export type Candidate = { origin: string; state: CandidateState; typed: boolean; cause?: string; status?: number; tls?: ProbeTls | null; qc?: { kind: QcKind; order: number } };
export type QuickConnectState = { id: string; explicit: boolean; state: 'pending' | 'done' | 'failed'; cause?: QcFailure; ezid?: string };
export type ProbeState = {
  phase: 'idle' | 'probing' | 'done';
  input: string; host?: string; error?: AddressErrorCode;
  candidates: Candidate[]; best?: string; name?: string; nameLoaded: boolean;
  /** No pending address could beat best: the rest were stopped */
  settled: boolean;
  quickconnect?: QuickConnectState;
};
const TRUSTED: ProbeTls = { sha256: '', trusted: true, chainTrusted: true, hostnameMatch: true, expired: false };
/**
 * Higher is better. Typed addresses: verified HTTPS, then HTTPS needing a trust decision, then plain
 * HTTP; the typed port wins ties. QuickConnect addresses rank above them in the portal's order (LAN,
 * outside, relay); one whose certificate is not trusted drops below the plain HTTP addresses.
 */
export function rank(candidate: Candidate, address?: ParsedAddress): number {
  if (candidate.state !== 'dsm') return -1;
  const https = candidate.origin.startsWith('https:');
  const tls = candidate.tls;
  const verified = Boolean(tls?.trusted && !tls.expired);
  if (candidate.qc) return 100 - (https && !verified && candidate.qc.order < RELAY_ORDER ? candidate.qc.order + 9.5 : candidate.qc.order);
  let score = https ? (verified ? 40 : 30) : 10;
  const port = Number(new URL(candidate.origin).port) || (https ? 443 : 80);
  if (address?.port && port === address.port) score += 5;
  if (address?.scheme && candidate.origin.startsWith(`${address.scheme}:`)) score += 2;
  if (port === 5001 || port === 5000) score += 1;
  return score;
}
/** The best rank a pending candidate could still reach */
export function potential(candidate: Candidate, address?: ParsedAddress): number {
  return candidate.state === 'pending' ? rank({ ...candidate, state: 'dsm', tls: TRUSTED }, address) : -1;
}
export function bestCandidate(candidates: Candidate[], address?: ParsedAddress): Candidate | undefined {
  return candidates.filter(c => c.state === 'dsm').sort((a, b) => rank(b, address) - rank(a, address))[0];
}
/** Whether a better result could still arrive from a pending address or lookup */
export function couldImprove(state: ProbeState, address?: ParsedAddress): boolean {
  const best = state.candidates.find(c => c.origin === state.best);
  const floor = best ? rank(best, address) : -1;
  return state.quickconnect?.state === 'pending' || state.candidates.some(c => potential(c, address) > floor);
}

/** Why nothing answered: the most telling cause first, so one line can name it */
const CAUSES = ['qcNotFound', 'qcOffline', 'wrongNas', 'other', 'certificate', 'tls', 'refused', 'timeout', 'unreachable', 'network', 'dns', 'qcFailed', 'invalid', 'failed'];
export type FailureCause = 'dns' | 'refused' | 'unreachable' | 'timeout' | 'certificate' | 'other' | 'wrongNas' | 'network' | QcFailure;
export function mainCause(state: ProbeState): FailureCause | undefined {
  if (state.best || state.candidates.some(c => c.state === 'pending' || c.state === 'dsm')) return undefined;
  const qc = state.quickconnect;
  // An ID the directory does not know only matters when the input could only mean QuickConnect
  if (qc?.state === 'failed' && (qc.explicit || state.candidates.every(c => c.cause === 'dns'))) {
    if (qc.explicit || qc.cause !== 'qcNotFound') return qc.cause;
  }
  const causes = state.candidates.map(c => c.state === 'other' ? (c.cause === 'wrongNas' ? 'wrongNas' : 'other') : c.state === 'failed' ? c.cause || 'failed' : undefined).filter((c): c is string => Boolean(c));
  if (!causes.length) return qc?.state === 'failed' ? qc.cause : undefined;
  // DNS only explains the failure when no address got further
  const found = CAUSES.find(cause => cause !== 'dns' && causes.includes(cause)) ?? (causes.every(c => c === 'dns') ? 'dns' : undefined);
  const value = found === 'tls' ? 'certificate' : found === 'invalid' || found === 'failed' || !found ? 'network' : found;
  return value as FailureCause;
}

const GRACE_MS = 2500;
/**
 * Every address is probed at once, without deadlines. The best answer is taken as soon as no pending
 * address could beat it, and the rest are stopped; while a better one is still pending, a lesser
 * answer is shown only after a short grace, and is replaced if the better one answers. cancel()
 * ignores late answers and closes sockets.
 */
export class NasProber {
  state: ProbeState = { phase: 'idle', input: '', candidates: [], nameLoaded: false, settled: false };
  private run = 0;
  private ids = new Set<string>();
  private probes = new Map<string, string>();
  private listeners = new Set<() => void>();
  private address?: ParsedAddress;
  private grace?: ReturnType<typeof setTimeout>;
  private graceOver = false;
  private probe: ProbeFn; private cancelNative: (id: string) => void; private nextId: () => string;
  private post?: QcPost; private graceMs: number;
  constructor(probe: ProbeFn, cancelNative: (id: string) => void, nextId: () => string, options: { post?: QcPost; graceMs?: number } = {}) {
    this.probe = probe; this.cancelNative = cancelNative; this.nextId = nextId;
    this.post = options.post; this.graceMs = options.graceMs ?? GRACE_MS;
  }
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  getState = () => this.state;
  private set(patch: Partial<ProbeState>) { this.state = { ...this.state, ...patch }; this.listeners.forEach(l => l()); }
  private stopGrace() { clearTimeout(this.grace); this.grace = undefined; }
  cancel() {
    this.run++; this.stopGrace();
    this.ids.forEach(id => this.cancelNative(id)); this.ids.clear(); this.probes.clear();
    if (this.state.phase === 'probing') this.set({ phase: 'done', candidates: this.state.candidates.map(c => c.state === 'pending' ? { ...c, state: 'cancelled' } : c),
      ...(this.state.quickconnect?.state === 'pending' ? { quickconnect: { ...this.state.quickconnect, state: 'done' } } : {}) });
  }
  reset() { this.cancel(); this.set({ phase: 'idle', input: '', host: undefined, error: undefined, candidates: [], best: undefined, name: undefined, nameLoaded: false, settled: false, quickconnect: undefined }); }
  /** Choose a different answering origin */
  choose(origin: string) { if (this.state.candidates.some(c => c.origin === origin && c.state === 'dsm')) this.set({ best: origin }); }
  /** A QuickConnect ID or address, a host, an IP or a URL */
  start(input: string) {
    this.cancel();
    const qc = this.post ? parseQuickConnect(input) : undefined;
    let address: ParsedAddress | undefined;
    if (!qc?.explicit) {
      try { address = parseAddress(input); }
      catch (error) { this.set({ phase: 'idle', input, error: error instanceof AddressError ? error.code : 'invalid', candidates: [], best: undefined, name: undefined, nameLoaded: false, settled: false, quickconnect: undefined }); return; }
    }
    this.address = address; this.graceOver = false;
    const run = ++this.run;
    let candidates: Candidate[] = [];
    if (address) {
      const typed = candidateOrigins({ ...address, port: address.port ?? (address.scheme ? defaultPort(address.scheme) : undefined) });
      candidates = candidateOrigins(address).map(origin => ({ origin, state: 'pending', typed: (address.port !== undefined || address.scheme !== undefined) && typed.slice(0, address.scheme ? 1 : 2).includes(origin) }));
    }
    this.set({ phase: 'probing', input, host: qc?.explicit ? qc.id : address!.host, error: undefined, best: undefined, name: undefined, nameLoaded: false, settled: false, candidates,
      quickconnect: qc ? { id: qc.id, explicit: qc.explicit, state: 'pending' } : undefined });
    candidates.forEach(c => this.check(run, c.origin));
    if (qc) void this.resolve(run, qc.id);
  }
  private async resolve(run: number, id: string) {
    const lookup = await lookupQuickConnect(id, this.post!).catch(() => ({ ok: false as const, code: 'qcFailed' as const }));
    if (run !== this.run) return;
    const current = this.state.quickconnect!;
    if (!lookup.ok) { this.set({ quickconnect: { ...current, state: 'failed', cause: lookup.code } }); this.decide(run); return; }
    // The relay is opened alongside the direct probes, and is only taken when nothing direct answers
    const relay: Candidate = { origin: `relay:${id}`, state: 'pending', typed: false, qc: { kind: 'relay', order: RELAY_ORDER } };
    this.set({ quickconnect: { ...current, state: 'done', ezid: lookup.ezid },
      candidates: [...this.state.candidates, ...lookup.candidates.filter(c => !this.state.candidates.some(o => o.origin === c.origin)).map(c => ({ origin: c.origin, state: 'pending' as const, typed: false, qc: { kind: c.kind, order: c.order } })), relay] });
    for (const c of lookup.candidates) this.check(run, c.origin);
    const origin = await requestTunnel(id, lookup, this.post!);
    if (run !== this.run) return;
    const others = this.state.candidates.filter(c => c.origin !== relay.origin);
    if (!origin || others.some(c => c.origin === origin)) { this.set({ candidates: others }); this.decide(run); return; }
    this.set({ candidates: this.state.candidates.map(c => c.origin === relay.origin ? { ...c, origin } : c) });
    this.check(run, origin);
  }
  /** Take the best answer once nothing pending could beat it, or after the grace; stop the rest */
  private decide(run: number) {
    if (run !== this.run) return;
    const candidates = this.state.candidates;
    const best = bestCandidate(candidates, this.address);
    const floor = best ? rank(best, this.address) : -1;
    const better = this.state.quickconnect?.state === 'pending' || candidates.some(c => potential(c, this.address) > floor);
    if (best && !better) {
      this.stopGrace();
      for (const c of candidates) if (c.state === 'pending') { const id = this.probes.get(c.origin); if (id) { this.cancelNative(id); this.ids.delete(id); this.probes.delete(c.origin); } }
      const patch: Partial<ProbeState> = { phase: 'done', settled: true, best: best.origin, candidates: candidates.filter(c => c.state !== 'pending') };
      this.set(patch);
    } else if (best && better) {
      if (this.graceOver) this.set({ best: best.origin });
      else this.grace ??= setTimeout(() => { this.grace = undefined; if (run !== this.run) return; this.graceOver = true; this.decide(run); }, this.graceMs);
    } else if (!candidates.some(c => c.state === 'pending') && this.state.quickconnect?.state !== 'pending') {
      this.stopGrace(); this.set({ phase: 'done' });
    }
    const chosen = this.state.candidates.find(c => c.origin === this.state.best);
    if (chosen && !this.state.nameLoaded) this.loadName(run, chosen.origin);
  }
  private update(run: number, origin: string, patch: Partial<Candidate>) {
    if (run !== this.run) return;
    this.probes.delete(origin);
    this.set({ candidates: this.state.candidates.map(c => c.origin === origin ? { ...c, ...patch } : c) });
    this.decide(run);
  }
  private addCandidate(run: number, origin: string) {
    if (run !== this.run || this.state.candidates.some(c => c.origin === origin)) return;
    this.set({ phase: 'probing', candidates: [...this.state.candidates, { origin, state: 'pending', typed: false }] });
    this.check(run, origin);
  }
  private async request(run: number, url: string, origin?: string): Promise<ProbeResponse | undefined> {
    const id = this.nextId(); this.ids.add(id);
    if (origin) this.probes.set(origin, id);
    try { const response = await this.probe(url, id); return run === this.run && (!origin || this.probes.get(origin) === id) ? response : undefined; }
    catch { return run === this.run && (!origin || this.probes.get(origin) === id) ? { error: 'failed' } : undefined; }
    finally { this.ids.delete(id); }
  }
  private async check(run: number, origin: string) {
    const qc = this.state.candidates.find(c => c.origin === origin)?.qc;
    // A QuickConnect address must prove it is this NAS: DSM's pingpong page carries its ID fingerprint
    const response = await this.request(run, origin + (qc ? PINGPONG_PATH : probePath), origin);
    if (!response) return;
    if (response.error) { this.update(run, origin, { state: response.error === 'cancelled' ? 'cancelled' : 'failed', cause: response.error, tls: response.tls }); return; }
    if (qc) {
      const same = response.status === 200 ? pingpongMatches(response.body, this.state.quickconnect?.ezid || '') : undefined;
      this.update(run, origin, same ? { state: 'dsm', status: 200, tls: response.tls } : { state: 'other', status: response.status, tls: response.tls, ...(same === false ? { cause: 'wrongNas' } : {}) });
      return;
    }
    if (response.status === 200 && isDsmInfo(response.body)) { this.update(run, origin, { state: 'dsm', status: 200, tls: response.tls }); return; }
    // Follow DSM's own hints: redirect page ports and same-host redirects
    const host = new URL(origin).hostname;
    const ports = redirectPorts(response.body);
    if (ports.https) this.addCandidate(run, originOf('https', host, ports.https));
    if (ports.http) this.addCandidate(run, originOf('http', host, ports.http));
    if (response.status && response.status >= 300 && response.status < 400 && response.location) {
      try {
        const next = new URL(response.location, origin);
        if (next.hostname === host && /^https?:$/.test(next.protocol)) this.addCandidate(run, next.origin);
      } catch { /* Ignore malformed redirects */ }
    }
    this.update(run, origin, { state: 'other', status: response.status, tls: response.tls });
  }
  private async loadName(run: number, origin: string) {
    if (this.naming === `${run}:${origin}`) return;
    this.naming = `${run}:${origin}`;
    const response = await this.request(run, origin + '/');
    // A failed read lets the next answering origin try; any page read settles the name
    if (!response || run !== this.run || response.error) return;
    const name = serverName(response.body);
    if (!this.state.nameLoaded) this.set({ name, nameLoaded: true });
  }
  private naming = '';
  /** The QuickConnect ID behind the chosen address, kept so the next connection resolves it again */
  quickConnectId(): string | undefined {
    const best = this.state.candidates.find(c => c.origin === this.state.best);
    return best?.qc && this.state.quickconnect?.state === 'done' ? this.state.quickconnect.id : undefined;
  }
  defaultName(): string { return this.state.name || hostName(this.state.host || ''); }
}
