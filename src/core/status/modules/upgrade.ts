/**
 * DSM update: SYNO.Core.Upgrade.Server check, the read behind Control Panel ›
 * Update & Restore (administrators; normal users get 105 and see only the
 * version). Without `ignore_cache` DSM answers from its stored result and asks
 * Synology's server only when it has none; the App never downloads or installs.
 */
import { record } from '../../discovery/schema.ts';
import type { UserInfo } from '../mappers.ts';
import { dsmApps, type StatusModule } from './types.ts';

/** One DSM release DSM offers: a minor update (`update`) or a new major version (`promotion`) */
export type DsmRelease = {
  /** DSM's own label, e.g. "DSM 7.4.1-90080 Update 2" */
  version: string;
  major?: number; minor?: number; micro?: number; build?: number; nano?: number;
  kind: 'update' | 'promotion';
  security: boolean;
};
export type Upgrade = { available?: DsmRelease };

const num = (value: unknown) => { const n = typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Number(value) : NaN; return Number.isFinite(n) ? n : undefined; };
function release(value: unknown, kind: DsmRelease['kind']): DsmRelease | undefined {
  const r = record(value), d = record(r.version_details);
  if (r.available !== true || typeof r.version !== 'string' || !r.version.trim()) return undefined;
  return {
    version: r.version.trim(), kind, security: d.isSecurityVersion === true,
    major: num(d.major), minor: num(d.minor), micro: num(d.micro), build: num(d.buildnumber), nano: num(d.nano),
  };
}
/** check v2–v4 nest `update` and `promotion`; v1 answers the update alone */
export function mapUpgrade(data: unknown): Upgrade {
  const d = record(data);
  const nested = 'update' in d || 'promotion' in d;
  return { available: nested ? release(d.update, 'update') ?? release(d.promotion, 'promotion') : release(d, 'update') };
}

/** DSM's version as one readable label: "DSM 7.4.1-90080 Update 1" */
export function dsmLabel(user?: UserInfo): string | undefined {
  if (!user?.dsm) return undefined;
  return `DSM ${user.dsm}${user.buildNumber ? `-${user.buildNumber}` : ''}${user.update ? ` Update ${user.update}` : ''}`;
}
/**
 * The release to offer, or undefined. A stored answer can be older than an
 * update installed since: it is offered only while it is newer than the
 * version DSM reports now.
 */
export function pendingUpdate(upgrade: Upgrade | undefined, user: UserInfo | undefined): DsmRelease | undefined {
  const next = upgrade?.available;
  if (!next) return undefined;
  const parts = user?.dsm?.split('.').map(Number);
  if (!parts || parts.some(n => !Number.isFinite(n)) || next.major === undefined) return next;
  const now = [parts[0] ?? 0, parts[1] ?? 0, parts[2] ?? 0, user?.buildNumber ?? 0, user?.update ?? 0];
  const then = [next.major, next.minor ?? 0, next.micro ?? 0, next.build ?? 0, next.nano ?? 0];
  for (let i = 0; i < now.length; i++) if (then[i] !== now[i]) return then[i] > now[i] ? next : undefined;
  return undefined;
}
/** The short name of the release for the tag: "Update 2" for an update of this build, else its version */
export function releaseShort(next: DsmRelease, user?: UserInfo): string {
  const same = user?.buildNumber !== undefined && next.build === user.buildNumber && next.nano;
  if (same) return `Update ${next.nano}`;
  return next.version.replace(/^DSM\s+/, '');
}

/** Control Panel › Update & Restore, by DSM's launch parameter */
export const updateApp = dsmApps.info;
export const UPDATE_PAGE = 'SYNO.SDS.AdminCenter.Update_Reset.Main';
export function updatePageUrl(origin: string): string {
  const url = new URL('/', origin);
  url.searchParams.set('launchApp', updateApp);
  url.searchParams.set('launchParam', `fn=${UPDATE_PAGE}`);
  return url.href;
}

export const upgrade: StatusModule = {
  id: 'upgrade', requires: { api: 'SYNO.Core.Upgrade.Server', min: 2, max: 4 }, params: { method: 'check', need_promotion: true }, missing: 'hide', dsmApp: dsmApps.info,
  apply: (_snapshot, data) => ({ upgrade: mapUpgrade(data) }),
};
