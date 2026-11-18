/**
 * C. Hyper Backup status: SYNO.Backup.Task list with the last result and the
 * next run (administrators; normal users get 105). DSM without Hyper Backup
 * has no such API, so the section is hidden there.
 */
import { record } from '../../discovery/schema.ts';
import { dsmApps, type StatusModule } from './types.ts';

export type BackupResult = 'success' | 'failed' | 'partial' | 'cancelled' | 'running' | 'never' | 'unknown';
export type BackupTask = {
  id: string; name: string; result: BackupResult;
  /** DSM's own result word when this App does not know it */
  raw?: string;
  /** Last run end (or start), next scheduled run: epoch seconds, phone's clock zone */
  last?: number; next?: number;
  running: boolean;
};
export type Backups = { tasks: BackupTask[] };
/** "2026/10/11 11:03:37" or "2026-11-13 03:00" */
export function parseDsmTime(value: unknown): number | undefined {
  if (typeof value !== 'string') return undefined;
  const m = /^(\d{4})[/-](\d{1,2})[/-](\d{1,2})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?/.exec(value.trim());
  if (!m) return undefined;
  const time = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]), Number(m[6] ?? 0)).getTime();
  return Number.isFinite(time) ? Math.floor(time / 1000) : undefined;
}
export function backupResult(value: unknown): { result: BackupResult; raw?: string } {
  const s = typeof value === 'string' ? value.toLowerCase() : '';
  if (!s || s === 'none') return { result: 'never' };
  if (/^(done|success|succeed|complete)/.test(s)) return { result: 'success' };
  if (/fail|error/.test(s)) return { result: 'failed', raw: String(value) };
  if (/partial|warn/.test(s)) return { result: 'partial', raw: String(value) };
  if (/cancel|suspend|discard|abort/.test(s)) return { result: 'cancelled', raw: String(value) };
  if (/backingup|running|progress/.test(s)) return { result: 'running' };
  return { result: 'unknown', raw: String(value) };
}
export function mapBackups(data: unknown): Backups {
  const list = (v: unknown) => Array.isArray(v) ? v.map(record) : [];
  const tasks = list(record(data).task_list).map((row, index): BackupTask => {
    const schedule = record(row.schedule), inner = record(schedule.schedule);
    const status = typeof row.status === 'string' ? row.status : '';
    const { result, raw } = backupResult(row.last_bkp_result);
    const running = /backup|running|prepar|waiting|resum|detect/i.test(status) || result === 'running';
    const next = schedule.schedule_enable === true ? parseDsmTime(inner.next_trigger_time) ?? parseDsmTime(row.next_bkp_time) : parseDsmTime(row.next_bkp_time);
    return {
      id: String(row.task_id ?? index), name: typeof row.name === 'string' && row.name ? row.name : String(row.task_id ?? index), result, ...(raw ? { raw } : {}),
      last: parseDsmTime(row.last_bkp_end_time) ?? parseDsmTime(row.last_bkp_time), next, running,
    };
  });
  return { tasks };
}

export const backup: StatusModule = {
  id: 'backup', requires: { api: 'SYNO.Backup.Task', min: 1, max: 1 },
  params: { method: 'list', additional: ['last_bkp_time', 'last_bkp_result', 'next_bkp_time', 'schedule'] }, missing: 'hide', dsmApp: dsmApps.backup,
  apply: (_snapshot, data) => ({ backups: mapBackups(data) }),
};
