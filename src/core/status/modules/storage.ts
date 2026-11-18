/**
 * D. Storage, read only: pools, volumes and the drives in each pool from
 * SYNO.Storage.CGI.Storage load_info (administrators; normal users get 105).
 * Repair, expansion and checks stay in Storage Manager.
 */
import { record } from '../../discovery/schema.ts';
import { mapStorage } from '../mappers.ts';
import { dsmApps, type StatusModule } from './types.ts';

export type Level = 'normal' | 'warning' | 'danger' | 'unknown';
export type Pool = {
  id: string; order: number; raid?: string; level: Level;
  /** DSM's status word when it is not plain "normal", shown as is */
  raw?: string;
  total?: number; used?: number;
  /** Drive ids (sata1) and volume ids (volume_1) in this pool */
  disks: string[]; volumes: string[];
};
const num = (value: unknown) => { const n = typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Number(value) : NaN; return Number.isFinite(n) ? n : undefined; };
const strings = (value: unknown) => Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
/** RAID names the way Storage Manager writes them */
export function raidName(value: unknown): string | undefined {
  if (typeof value !== 'string' || !value) return undefined;
  const v = value.toLowerCase();
  if (v === 'basic') return 'Basic';
  if (v === 'jbod') return 'JBOD';
  if (/^shr_?2$/.test(v)) return 'SHR-2';
  if (v === 'shr') return 'SHR';
  const raid = /^raid_?(\w+)$/.exec(v);
  return raid ? `RAID ${raid[1].toUpperCase()}` : value;
}
/** A status word this App does not know is "unknown", never "normal" */
export function levelOf(value: unknown): { level: Level; raw?: string } {
  const s = typeof value === 'string' ? value : '';
  if (!s || /^normal$/i.test(s)) return { level: s ? 'normal' : 'unknown' };
  if (/crash|danger|fail|damage/i.test(s)) return { level: 'danger', raw: s };
  if (/degrad|warn|attention|abnormal|repair|expand|build|sync|scrub/i.test(s)) return { level: 'warning', raw: s };
  return { level: 'unknown', raw: s };
}
export function mapPools(data: unknown): Pool[] {
  const list = (v: unknown) => Array.isArray(v) ? v.map(record) : [];
  return list(record(data).storagePools).map((row, index) => {
    const size = record(row.size);
    const { level, raw } = levelOf(row.summary_status ?? row.status);
    return {
      id: String(row.id ?? row.pool_path ?? index), order: num(row.num_id) ?? index + 1, raid: raidName(row.device_type), level, ...(raw ? { raw } : {}),
      total: num(size.total), used: num(size.used),
      disks: strings(row.disks), volumes: list(row.pool_child).map(child => String(child.id ?? '')).filter(Boolean),
    };
  }).sort((a, b) => a.order - b.order);
}

export const storage: StatusModule = {
  id: 'storage', requires: { api: 'SYNO.Storage.CGI.Storage', min: 1, max: 1 }, params: { method: 'load_info' }, missing: 'fallback', dsmApp: dsmApps.storage,
  apply: (_snapshot, data) => ({ volumes: mapStorage(data), pools: mapPools(data) }),
};
