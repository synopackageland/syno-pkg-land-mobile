import type { NasAddress, NasProfile } from '../config.ts';
export type NasQr = { v: 1; name: string; urls: NasAddress[] };
export type QrErrorCode = 'invalidQr' | 'updateApp' | 'qrTooLarge';
export class NasQrError extends Error {
  code: QrErrorCode;
  constructor(code: QrErrorCode) { super(code); this.code = code; }
}
const invalid = (): never => { throw new NasQrError('invalidQr'); };
/** Strict origin syntax, before URL normalization can erase credentials, paths or controls */
export function qrAddress(value: unknown): NasAddress {
  if (!value || typeof value !== 'object') return invalid();
  const item = value as Record<string, unknown>;
  if (typeof item.url !== 'string' || !/^https?:\/\/[^/?#@\s\\]+$/.test(item.url)) return invalid();
  let url: URL;
  try { url = new URL(item.url); } catch { return invalid(); }
  if (url.username || url.password || !url.hostname || (typeof item.kind !== 'string' || !['lan', 'cf', 'netbird', 'other'].includes(item.kind))) return invalid();
  if (item.sha256 !== undefined && (url.protocol !== 'https:' || typeof item.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(item.sha256))) return invalid();
  return { url: url.origin, kind: item.kind as NasAddress['kind'], ...(item.sha256 !== undefined ? { sha256: item.sha256 as string } : {}) };
}
/** No Buffer dependency: the same decoder runs in Hermes and the Node gates */
export function parseNasQr(input: string): NasQr {
  const prefix = 'synopkgland://add-nas#';
  if (!input.startsWith(prefix)) return invalid();
  const encoded = input.slice(prefix.length);
  if (encoded.length > Math.ceil(2048 * 4 / 3)) throw new NasQrError('qrTooLarge');
  if (!encoded || !/^[A-Za-z0-9_-]+$/.test(encoded) || encoded.length % 4 === 1) return invalid();
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  const bytes: number[] = []; let bits = 0, buffer = 0;
  for (const c of encoded) {
    buffer = (buffer << 6) | alphabet.indexOf(c); bits += 6;
    if (bits >= 8) { bits -= 8; bytes.push((buffer >> bits) & 255); }
  }
  if ((buffer & ((1 << bits) - 1)) !== 0) return invalid();
  if (bytes.length > 2048) throw new NasQrError('qrTooLarge');
  let data: Record<string, unknown>;
  try { data = JSON.parse(decodeURIComponent(bytes.map(b => '%' + b.toString(16).padStart(2, '0')).join(''))); } catch { return invalid(); }
  if (!data || typeof data !== 'object' || Array.isArray(data)) return invalid();
  if (typeof data.v !== 'number') return invalid();
  if (data.v !== 1) throw new NasQrError('updateApp');
  if (typeof data.name !== 'string' || !data.name.trim() || /[\u0000-\u001f\u007f]/.test(data.name) || !Array.isArray(data.urls) || data.urls.length < 1 || data.urls.length > 8) return invalid();
  const urls = data.urls.map(qrAddress);
  if (new Set(urls.map(u => u.url)).size !== urls.length) return invalid();
  return { v: 1, name: data.name.trim(), urls };
}
/** Format has no NAS UUID: only overlapping origins establish a saved NAS identity */
export function qrGroup(profiles: NasProfile[], qr: NasQr): NasProfile[] {
  const matching = profiles.filter(p => qr.urls.some(u => u.url === p.origin));
  const groups = new Set(matching.map(p => p.group || p.id));
  return profiles.filter(p => groups.has(p.group || p.id));
}
