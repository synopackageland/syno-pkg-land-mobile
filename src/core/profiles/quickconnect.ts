/**
 * QuickConnect: Synology's directory from a QuickConnect ID to the NAS's current addresses.
 * The same steps as the public quickconnect.to page: ask the control server for the NAS's
 * addresses, probe them all at once, prefer LAN, then outside addresses, then Synology's relay.
 * Every answer must carry the NAS's own ID fingerprint, so a LAN address that belongs to
 * another network's NAS is never taken.
 */
export type QcKind = 'lan' | 'wan' | 'relay';
/** order: the portal's preference, lower is better */
export type QcCandidate = { origin: string; kind: QcKind; order: number };
export type QcFailure = 'qcNotFound' | 'qcOffline' | 'qcFailed';
export type QcLookup =
  | { ok: true; serverID: string; ezid: string; controlHost: string; relayRegion?: string; tunnel: boolean; https: boolean; candidates: QcCandidate[] }
  | { ok: false; code: QcFailure };
/** POSTs JSON and returns the parsed reply; throws on network errors */
export type QcPost = (url: string, body: unknown) => Promise<unknown>;

const ID = /^[a-z][a-z\d-]{0,62}$/i;
/** A saved QuickConnect ID (lower case) */
export const QC_ID = /^[a-z][a-z\d-]{0,62}$/;
const QC_HOST = /^(?:([a-z][a-z\d-]*)\.)?(?:[a-z]{2}\d+\.)?quickconnect\.(to|cn)$/i;
const RESERVED = new Set(['global', 'www', 'direct', 'ukc', 'checkport']);

/**
 * A QuickConnect ID, or a quickconnect.to/ID or ID.quickconnect.to address with any path.
 * explicit: the input can only mean QuickConnect; a bare word could also be a LAN host name.
 */
export function parseQuickConnect(input: string): { id: string; explicit: boolean } | undefined {
  const value = input.trim().replace(/^[\s"'<]+|[\s"'>]+$/g, '');
  if (ID.test(value)) return { id: value.toLowerCase(), explicit: false };
  let url: URL;
  try { url = new URL(/^[a-z][a-z\d+.-]*:\/\//i.test(value) ? value : `https://${value}`); } catch { return undefined; }
  if (!/^https?:$/.test(url.protocol) || url.username || url.password || url.port) return undefined;
  const match = QC_HOST.exec(url.hostname);
  if (!match) return undefined;
  const id = match[1] && !RESERVED.has(match[1].toLowerCase()) ? match[1] : url.pathname.split('/').filter(Boolean)[0];
  return id && ID.test(id) && !RESERVED.has(id.toLowerCase()) ? { id: id.toLowerCase(), explicit: true } : undefined;
}

/** The portal asks for the HTTPS and the HTTP DSM service in one request */
export function serverInfoRequest(id: string, command = 'get_server_info') {
  return ['dsm_portal_https', 'dsm_portal'].map(service => ({ version: 1, command, stop_when_error: false, stop_when_success: false, id: service, serverID: id, is_gofile: false, path: '' }));
}

type Info = {
  errno?: number; suberrno?: number; sites?: string[];
  env?: { control_host?: string; relay_region?: string };
  server?: { serverID?: string; ddns?: string; fqdn?: string; external?: { ip?: string; ipv6?: string }; interface?: { ip?: string; ipv6?: { address?: string; scope?: string }[] }[] };
  service?: { port?: number; ext_port?: number | string; relay_ip?: string; relay_port?: number };
  smartdns?: { host?: string; lan?: string[]; lanv6?: string[] };
};
const obj = (value: unknown): Info | undefined => value && typeof value === 'object' && !Array.isArray(value) ? value as Info : undefined;
const valid = (info: Info | undefined): info is Info & { server: NonNullable<Info['server']>; service: NonNullable<Info['service']>; env: NonNullable<Info['env']> } =>
  info?.errno === 0 && Array.isArray(info.server?.interface) && typeof info.server?.serverID === 'string' && typeof info.service?.port === 'number' && typeof info.env?.control_host === 'string';

/** The quickconnect.to page's order: HTTPS before HTTP, LAN before outside addresses, the relay last */
const ORDER = ['https:smart_lan_ipv4', 'https:smart_lan_ipv6', 'https:lan_ipv4', 'https:lan_ipv6', 'https:fqdn', 'https:ddns', 'https:smart_host', 'https:smart_wan_ipv6', 'https:smart_wan_ipv4', 'https:wan_ipv6', 'https:wan_ipv4',
  'http:lan_ipv4', 'http:lan_ipv6', 'http:fqdn', 'http:ddns', 'http:wan_ipv6', 'http:wan_ipv4', 'https:tun', 'http:tun'];
const privateV4 = (ip: string) => /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.|100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.)/.test(ip);
const hostOf = (host: string) => host.includes(':') ? `[${host}]` : host;
const usable = (host: unknown): host is string => typeof host === 'string' && host !== '' && host !== 'NULL' && !/^127\.|^0\.0\.0\.0$|^::1?$/.test(host) && /^[\w.:-]+$/.test(host);

/** Every address the NAS reported, in preference order; the same address is listed once */
export function quickConnectCandidates(infos: unknown[]): QcCandidate[] {
  const list: QcCandidate[] = [];
  infos.forEach((raw, index) => {
    const info = obj(raw);
    if (!valid(info)) return;
    const scheme = index === 0 ? 'https' : 'http';
    const port = info.service.port!;
    const ext = Number(info.service.ext_port);
    const extra = ext > 0 && ext < 65536 && ext !== port ? ext : undefined;
    const add = (type: string, host: unknown, withExt = true) => {
      if (!usable(host)) return;
      const order = ORDER.indexOf(`${scheme}:${type}`);
      if (order < 0) return;
      const kind: QcKind = type.includes('lan') ? 'lan' : 'wan';
      for (const p of withExt && extra ? [port, extra] : [port]) {
        let origin: string;
        try { origin = new URL(`${scheme}://${hostOf(host)}:${p}`).origin; } catch { continue; }
        const same = list.find(c => c.origin === origin);
        if (!same) list.push({ origin, kind, order });
        else if (order < same.order) Object.assign(same, { kind, order });
      }
    };
    // Synology's DNS names for the NAS's LAN and outside addresses carry a valid certificate
    if (scheme === 'https' && info.smartdns) {
      for (const host of info.smartdns.lan ?? []) add(String(host).startsWith('syn4-') ? 'smart_wan_ipv4' : 'smart_lan_ipv4', host, String(host).startsWith('syn4-'));
      for (const host of info.smartdns.lanv6 ?? []) add(String(host).startsWith('syn6-') ? 'smart_wan_ipv6' : 'smart_lan_ipv6', host, String(host).startsWith('syn6-'));
      add('smart_host', info.smartdns.host);
    }
    for (const nic of info.server.interface ?? []) {
      if (usable(nic?.ip)) privateV4(nic.ip) ? add('lan_ipv4', nic.ip, false) : add('wan_ipv4', nic.ip);
      // Link-local IPv6 needs an interface zone, which a URL cannot carry
      for (const v6 of nic?.ipv6 ?? []) if (v6?.scope !== 'link' && usable(v6?.address)) add('wan_ipv6', v6.address);
    }
    add('fqdn', info.server.fqdn); add('ddns', info.server.ddns);
    add('wan_ipv4', info.server.external?.ip);
  });
  return list.sort((a, b) => a.order - b.order);
}

/** The relay address the portal opens: ID.REGION.quickconnect.TLD */
export function relayOrigin(id: string, region: string, controlHost: string): string | undefined {
  if (!/^[a-z]{2}\d+$/i.test(region)) return undefined;
  const tld = controlHost.split('.').pop();
  return tld && /^(to|cn)$/.test(tld) ? `https://${id}.${region.toLowerCase()}.quickconnect.${tld}` : undefined;
}
export const RELAY_ORDER = ORDER.indexOf('https:tun');

const failure = (infos: Info[]): QcFailure =>
  infos.some(i => i.errno === 4 && i.suberrno === 1) ? 'qcNotFound' : infos.some(i => i.errno === 4 && i.suberrno === 0) ? 'qcOffline' : 'qcFailed';

/** Asks the control servers for the NAS's addresses, following their redirect to the NAS's region */
export async function lookupQuickConnect(id: string, post: QcPost, site = 'global.quickconnect.to'): Promise<QcLookup> {
  const sites = [site], tried = new Set<string>();
  let last: QcFailure = 'qcFailed';
  while (sites.length && tried.size < 4) {
    const host = sites.shift()!;
    if (tried.has(host) || !/^[\w.-]+\.quickconnect\.(to|cn)$/i.test(host)) continue;
    tried.add(host);
    let reply: unknown;
    try { reply = await post(`https://${host}/Serv.php`, serverInfoRequest(id)); } catch { continue; }
    const infos = (Array.isArray(reply) ? reply : [reply]).map(obj).filter((i): i is Info => Boolean(i));
    const ok = infos.map(i => valid(i) ? i : undefined);
    const first = ok.find(Boolean);
    if (first && valid(first)) {
      const serverID = first.server.serverID!;
      return {
        ok: true, serverID, ezid: md5(serverID), controlHost: first.env.control_host!, relayRegion: first.env.relay_region,
        tunnel: Boolean(first.service.relay_ip && first.service.relay_port), https: Boolean(ok[0]),
        candidates: quickConnectCandidates(infos.length === 1 ? [infos[0]] : infos),
      };
    }
    last = failure(infos);
    for (const info of infos) for (const next of info.sites ?? []) if (typeof next === 'string') sites.push(next);
  }
  return { ok: false, code: last };
}

/** Opens Synology's relay for this NAS; resolves to the relay origin, or undefined when the relay is off */
export async function requestTunnel(id: string, lookup: Extract<QcLookup, { ok: true }>, post: QcPost): Promise<string | undefined> {
  const direct = lookup.relayRegion ? relayOrigin(id, lookup.relayRegion, lookup.controlHost) : undefined;
  if (lookup.tunnel && direct) return direct;
  if (!/^[\w.-]+\.quickconnect\.(to|cn)$/i.test(lookup.controlHost)) return undefined;
  try {
    const reply = await post(`https://${lookup.controlHost}/Serv.php`, [serverInfoRequest(id, 'request_tunnel')[lookup.https ? 0 : 1]]);
    for (const raw of Array.isArray(reply) ? reply : [reply]) {
      const info = obj(raw);
      if (valid(info) && info.env.relay_region) return relayOrigin(id, info.env.relay_region, info.env.control_host!);
    }
  } catch { /* No relay */ }
  return undefined;
}

/** The fingerprint DSM's pingpong page returns: md5 of the QuickConnect server ID */
export function pingpongMatches(body: string | undefined, ezid: string): boolean | undefined {
  try {
    const value = JSON.parse(body || '');
    if (value?.success !== true || typeof value.ezid !== 'string') return undefined;
    return value.ezid.toLowerCase() === ezid;
  } catch { return undefined; }
}
export const PINGPONG_PATH = '/webman/pingpong.cgi?action=cors&quickconnect=true';

/** MD5 (RFC 1321) of UTF-8 text; small enough to avoid a crypto dependency for one fingerprint */
export function md5(text: string): string {
  const bytes = Array.from(unescape(encodeURIComponent(text)), c => c.charCodeAt(0));
  const length = bytes.length;
  bytes.push(0x80);
  while (bytes.length % 64 !== 56) bytes.push(0);
  for (let i = 0; i < 8; i++) bytes.push(i < 4 ? (length * 8 >>> (8 * i)) & 255 : i === 4 ? Math.floor(length / 0x20000000) & 255 : 0);
  const K = Array.from({ length: 64 }, (_, i) => Math.floor(Math.abs(Math.sin(i + 1)) * 2 ** 32) >>> 0);
  const S = [7, 12, 17, 22, 5, 9, 14, 20, 4, 11, 16, 23, 6, 10, 15, 21];
  let a0 = 0x67452301, b0 = 0xefcdab89, c0 = 0x98badcfe, d0 = 0x10325476;
  for (let chunk = 0; chunk < bytes.length; chunk += 64) {
    const M = Array.from({ length: 16 }, (_, i) => bytes[chunk + i * 4] | bytes[chunk + i * 4 + 1] << 8 | bytes[chunk + i * 4 + 2] << 16 | bytes[chunk + i * 4 + 3] << 24);
    let a = a0, b = b0, c = c0, d = d0;
    for (let i = 0; i < 64; i++) {
      const round = i >> 4;
      const f = round === 0 ? (b & c) | (~b & d) : round === 1 ? (d & b) | (~d & c) : round === 2 ? b ^ c ^ d : c ^ (b | ~d);
      const g = round === 0 ? i : round === 1 ? (5 * i + 1) % 16 : round === 2 ? (3 * i + 5) % 16 : (7 * i) % 16;
      const sum = (a + f + K[i] + M[g]) | 0;
      a = d; d = c; c = b;
      b = (b + (sum << S[round * 4 + i % 4] | sum >>> 32 - S[round * 4 + i % 4])) | 0;
    }
    a0 = (a0 + a) | 0; b0 = (b0 + b) | 0; c0 = (c0 + c) | 0; d0 = (d0 + d) | 0;
  }
  return [a0, b0, c0, d0].map(v => Array.from({ length: 4 }, (_, i) => ((v >>> 8 * i) & 255).toString(16).padStart(2, '0')).join('')).join('');
}
