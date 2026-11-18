import type { AppTarget } from '../config.ts';
import type { IntakeDeclaration, IntakeRule } from '../intake/accept.ts';
import { sameOrigin } from '../profiles/url.ts';

export type DiscoveredApp = AppTarget & {
  name: string; icon?: string; package: string; reason?: string;
  /** Absolute DSM icon URL with {0} for the pixel size */
  iconTemplate?: string;
  /** Package version: part of the icon cache key */
  version?: string;
  /** Position in the user's DSM main menu */
  dsmRank?: number;
  /** A DSM built-in App (a DSM module or a tool bundled with DSM): never registers mobile.json */
  builtin?: boolean;
  /** Needs a hardware flag that only the live DSM runtime can confirm */
  runtimeOnly?: boolean;
};
export const record = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const capabilities = ['download', 'open-external', 'camera'];
function intake(value: unknown): IntakeDeclaration | undefined {
  if (value === undefined) return undefined;
  const v = record(value);
  if (typeof v.route !== 'string' || !v.route.startsWith('/') || !Array.isArray(v.accept) || !v.accept.length) throw new Error('Invalid intake');
  const accept: IntakeRule[] = v.accept.map(value => {
    const r = record(value);
    if (r.kind === 'text') return { kind: 'text' };
    if (r.kind === 'url' && Array.isArray(r.schemes) && r.schemes.length && r.schemes.every(s => typeof s === 'string' && /^[a-z][a-z0-9+.-]*$/.test(s))) return { kind: 'url', schemes: r.schemes };
    if (r.kind === 'file' && Array.isArray(r.types) && r.types.length && r.types.every(t => typeof t === 'string' && /^(\.[\w.-]+|[\w.+-]+\/(?:[\w.+-]+|\*))$/.test(t)) && Number.isSafeInteger(r.max_bytes) && Number(r.max_bytes) > 0 && Number(r.max_bytes) <= 8 * 1024 * 1024) return { kind: 'file', types: r.types, max_bytes: Number(r.max_bytes) };
    throw new Error('Invalid intake rule');
  });
  return { route: v.route, accept };
}
/** A malformed or future registration never enables a native bridge */
export function registeredTarget(value: unknown, app: DiscoveredApp, origin: string, language = 'en'): DiscoveredApp | null {
  try {
    const v = record(value);
    if (v.schema !== 1 || v.package !== app.package || typeof v.version !== 'string' || typeof v.build !== 'string' || !Number.isInteger(v.minShell) || Number(v.minShell) > 1 || Number(v.minShell) < 1 || typeof v.status !== 'boolean') return null;
    if (typeof v.entry !== 'string' || !v.entry || !Array.isArray(v.capabilities) || !v.capabilities.every(c => capabilities.includes(c)) || typeof v.start !== 'string' || !v.start.startsWith('/')) return null;
    const base = `${origin}/webman/3rdparty/${encodeURIComponent(app.package)}/app/`;
    const url = new URL(v.entry, base);
    if (!sameOrigin(url.href, origin) || !url.pathname.startsWith(`/webman/3rdparty/${app.package}/`) || url.hash || url.search) return null;
    const names = record(v.name);
    if (!Object.values(names).length || !Object.values(names).every(n => typeof n === 'string' && n.trim())) return null;
    const name = names[language] || names[language.split('-')[0]] || names.en || Object.values(names)[0];
    const icon = typeof v.icon === 'string' ? new URL(v.icon, base).href : undefined;
    if (!icon || !sameOrigin(icon, origin)) return null;
    return { ...app, name: String(name), icon, iconTemplate: undefined, url: url.href, preset: 'mobile', registered: true, capabilities: v.capabilities as AppTarget['capabilities'], intake: intake(v.intake), start: v.start, reason: undefined };
  } catch { return null; }
}
