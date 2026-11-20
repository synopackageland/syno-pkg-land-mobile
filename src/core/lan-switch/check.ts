/**
 * Switch to the local network (browser build). When this page came through Cloudflare (an https
 * page on a DNS name) and Connect's "local network" option is on, Connect lists DSM's LAN
 * addresses with one-use ICE credentials (phone.lanprobe). This browser then runs a WebRTC
 * connectivity check (ICE over TCP, RFC 6544) against every address in parallel. Only Connect's
 * responder on that NAS holds the password, so a check completes only when this browser reaches
 * that NAS at that address. The first to complete wins and the rest stop; anything uncertain (no
 * WebRTC, no answer in time, an error) offers nothing and the page stays where it is. Unlike a
 * fetch, an ICE check does not make Chrome ask for local network access, and it is not mixed
 * content, nor stopped by DSM's self-signed certificate.
 */
export type LanCandidate = { address: string; port: number; url: string };
export type LanProbe = { enabled: boolean; ufrag?: string; pwd?: string; https?: boolean; candidates: LanCandidate[] };
export type LanFound = { url: string; https: boolean; ms: number };

/** The whole check gives up after this long */
export const LAN_PROBE_TIMEOUT_MS = 5000;
const ICE = /^[a-z2-7]{8}$/, PWD = /^[a-z2-7]{22,64}$/;

/** Worth checking: an https page on a DNS name (not an IP address, a single label or .local) */
export function shouldProbe(loc: { protocol: string; hostname: string }): boolean {
  const host = loc.hostname.toLowerCase();
  if (loc.protocol !== 'https:' || !host.includes('.') || host.endsWith('.local') || host.endsWith('.')) return false;
  return !/^[\d.]+$/.test(host) && !host.includes(':') && !host.startsWith('[');
}

/** A private IPv4 address: 10/8, 172.16/12 or 192.168/16 */
export function privateIPv4(a: string): boolean {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(a);
  if (!m) return false;
  const parts = m.slice(1);
  if (parts.some(o => Number(o) > 255 || (o.length > 1 && o.startsWith('0')))) return false;
  const [o1, o2] = parts.map(Number);
  return o1 === 10 || (o1 === 172 && o2 >= 16 && o2 <= 31) || (o1 === 192 && o2 === 168);
}

/** Only an http(s) origin on the candidate's own private IPv4 address is offered */
export function candidateOk(c: LanCandidate): boolean {
  if (!c || !privateIPv4(c.address) || !Number.isInteger(c.port) || c.port < 1 || c.port > 65535) return false;
  try {
    const u = new URL(c.url);
    return (u.protocol === 'http:' || u.protocol === 'https:') && u.hostname === c.address && u.pathname === '/' && !u.search && !u.hash && !u.username && !u.password;
  } catch { return false; }
}

/** The answer an ICE-lite peer would send: one passive TCP host candidate. Nothing past ICE is used */
export function answerSdp(ufrag: string, pwd: string, c: LanCandidate): string {
  const fp = Array.from({ length: 32 }, (_, i) => ((i * 7 + 16) & 255).toString(16).padStart(2, '0').toUpperCase()).join(':');
  return ['v=0', 'o=- 1 2 IN IP4 0.0.0.0', 's=-', 't=0 0', 'a=ice-lite', 'a=group:BUNDLE 0',
    'm=application 9 UDP/DTLS/SCTP webrtc-datachannel', 'c=IN IP4 0.0.0.0', 'a=mid:0',
    `a=ice-ufrag:${ufrag}`, `a=ice-pwd:${pwd}`, `a=fingerprint:sha-256 ${fp}`, 'a=setup:passive', 'a=sctp-port:5000',
    `a=candidate:1 1 tcp 1518280447 ${c.address} ${c.port} typ host tcptype passive`, 'a=end-of-candidates', ''].join('\r\n');
}

/** The part of RTCPeerConnection the check uses */
export type Peer = {
  iceConnectionState: string;
  oniceconnectionstatechange: (() => void) | null;
  createDataChannel(label: string): unknown;
  createOffer(): Promise<{ type: string; sdp?: string }>;
  setLocalDescription(d: { type: string; sdp?: string }): Promise<void>;
  setRemoteDescription(d: { type: string; sdp: string }): Promise<void>;
  close(): void;
};
export type PeerFactory = () => Peer;

/** One candidate: true only when ICE connects */
function check(make: PeerFactory, ufrag: string, pwd: string, c: LanCandidate, signal: AbortSignal): Promise<boolean> {
  return new Promise(resolve => {
    let pc: Peer | undefined, done = false;
    const finish = (ok: boolean) => {
      if (done) return;
      done = true; signal.removeEventListener('abort', abort);
      try { pc?.close(); } catch { /* Already closed */ }
      resolve(ok);
    };
    const abort = () => finish(false);
    if (signal.aborted) { finish(false); return; }
    signal.addEventListener('abort', abort);
    try {
      const peer = make();
      pc = peer;
      peer.oniceconnectionstatechange = () => {
        const s = peer.iceConnectionState;
        if (s === 'connected' || s === 'completed') finish(true);
        else if (s === 'failed' || s === 'closed') finish(false);
      };
      peer.createDataChannel('lan');
      void peer.createOffer()
        .then(offer => peer.setLocalDescription(offer))
        .then(() => peer.setRemoteDescription({ type: 'answer', sdp: answerSdp(ufrag, pwd, c) }))
        .catch(() => finish(false));
    } catch { finish(false); }
  });
}

/** Checks every candidate in parallel: the first that connects, or undefined when none does in time */
export async function findLan(probe: LanProbe | undefined, opts: { make?: PeerFactory; timeoutMs?: number; signal?: AbortSignal } = {}): Promise<LanFound | undefined> {
  if (!probe?.enabled || !ICE.test(probe.ufrag ?? '') || !PWD.test(probe.pwd ?? '')) return undefined;
  const candidates = (Array.isArray(probe.candidates) ? probe.candidates : []).filter(candidateOk).slice(0, 8);
  const RTC = (globalThis as { RTCPeerConnection?: new (config: object) => Peer }).RTCPeerConnection;
  const make = opts.make ?? (typeof RTC === 'function' ? () => new RTC({ iceServers: [] }) : undefined);
  if (!candidates.length || !make || opts.signal?.aborted) return undefined;
  const stop = new AbortController();
  const onOuter = () => stop.abort();
  opts.signal?.addEventListener('abort', onOuter);
  const timer = setTimeout(() => stop.abort(), opts.timeoutMs ?? LAN_PROBE_TIMEOUT_MS);
  const start = Date.now();
  try {
    return await new Promise<LanFound | undefined>(resolve => {
      let left = candidates.length;
      for (const c of candidates) {
        void check(make, probe.ufrag!, probe.pwd!, c, stop.signal).then(ok => {
          if (ok && !stop.signal.aborted) { stop.abort(); resolve({ url: c.url, https: c.url.startsWith('https:'), ms: Date.now() - start }); }
          else if (--left === 0 || stop.signal.aborted) resolve(undefined);
        });
      }
    });
  } finally { clearTimeout(timer); opts.signal?.removeEventListener('abort', onOuter); stop.abort(); }
}

/** Connect's App endpoint for this page: the package folder the launcher is served from */
export function connectEndpoint(pathname: string): string {
  const m = /^\/webman\/3rdparty\/([A-Za-z0-9_.-]+)\//.exec(pathname);
  return `/webman/3rdparty/${m ? m[1] : 'SynoPkgConnect'}/cgi/api.cgi`;
}

type Fetch = (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string; credentials?: 'same-origin'; cache?: 'no-store'; signal?: AbortSignal }) => Promise<{ ok: boolean; json(): Promise<unknown> }>;
/**
 * Asks Connect on this page's own origin for the probe, with this session's DSM token. Any failure
 * (signed out, not an administrator, Connect without the option, an older Connect) is undefined
 */
export async function readProbe(fetchImpl: Fetch, origin: string, pathname: string, signal?: AbortSignal): Promise<LanProbe | undefined> {
  try {
    const tokenReply = await fetchImpl(new URL('/webman/login.cgi?enable_syno_token=yes', origin).href, { credentials: 'same-origin', cache: 'no-store', signal });
    const token = (await tokenReply.json()) as { success?: unknown; SynoToken?: unknown };
    if (token?.success !== true || typeof token.SynoToken !== 'string' || !token.SynoToken) return undefined;
    const reply = await fetchImpl(new URL(connectEndpoint(pathname), origin).href, {
      method: 'POST', credentials: 'same-origin', cache: 'no-store', signal,
      headers: { 'Content-Type': 'application/json', 'X-SYNO-TOKEN': token.SynoToken },
      body: JSON.stringify({ method: 'phone.lanprobe', params: {} }),
    });
    if (!reply.ok) return undefined;
    const body = (await reply.json()) as { success?: unknown; data?: unknown };
    if (body?.success !== true || !body.data || typeof body.data !== 'object') return undefined;
    return body.data as LanProbe;
  } catch { return undefined; }
}

/** This launcher's page on the local address: same path, the local origin */
export function lanLauncher(found: LanFound, launcher: string): string | undefined {
  try {
    const page = new URL(launcher);
    const target = new URL(found.url);
    return new URL(page.pathname, target.origin).href;
  } catch { return undefined; }
}
