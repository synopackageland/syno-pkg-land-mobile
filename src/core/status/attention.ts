/**
 * A. "Needs attention": one list from every module's answer. Each entry is
 * DSM-free; the screen words it. Danger first, then warnings.
 */
import type { StatusSnapshot, Item } from './model.ts';
import type { BackupResult } from './modules/backup.ts';
import { securityLevel, type SecurityLevel } from './modules/security.ts';

export type Attention =
  | { kind: 'system'; level: 'danger' }
  | { kind: 'temperature'; level: 'warning'; value?: number }
  | { kind: 'volume'; level: 'danger' | 'warning'; id: string; name: string; state?: 'crashed' | 'degraded' | 'readonly'; percent?: number }
  | { kind: 'pool'; level: 'danger' | 'warning'; id: string; order: number; raw?: string }
  | { kind: 'disk'; level: 'danger' | 'warning'; id: string; name: string }
  | { kind: 'security'; level: 'danger' | 'warning'; issues: number; severity: SecurityLevel; summary?: true }
  | { kind: 'backup'; level: 'danger' | 'warning'; id: string; name: string; result: BackupResult; time?: number };
/** A volume this full is listed, the same level that turns its bar red */
export const FULL = 90;

export function attentionOf(snapshot: StatusSnapshot | undefined): { items: Attention[]; checked: boolean; time?: number } {
  if (!snapshot) return { items: [], checked: false };
  const items: Attention[] = [];
  const health = snapshot.health;
  if (health?.crashed) items.push({ kind: 'system', level: 'danger' });
  if (health?.tempWarning || snapshot.overview?.tempWarning) items.push({ kind: 'temperature', level: 'warning', value: snapshot.overview?.temp });
  for (const pool of snapshot.pools ?? []) {
    if (pool.level === 'normal') continue;
    // DSM's own word is shown only when it is not one the App knows
    items.push({ kind: 'pool', level: pool.level === 'danger' ? 'danger' : 'warning', id: pool.id, order: pool.order, ...(pool.level === 'unknown' && pool.raw ? { raw: pool.raw } : {}) });
  }
  for (const volume of snapshot.volumes ?? []) {
    const percent = volume.total > 0 ? Math.round(volume.used / volume.total * 100) : 0;
    if (!volume.state && volume.status === 'normal' && percent < FULL) continue;
    items.push({ kind: 'volume', level: volume.state === 'crashed' || volume.status === 'danger' || percent >= FULL ? 'danger' : 'warning', id: volume.id, name: volume.name, state: volume.state, percent });
  }
  for (const disk of health?.disks ?? []) if (disk.status !== 'normal') items.push({ kind: 'disk', level: disk.status, id: disk.id, name: disk.name });
  // Normal users get no Security Advisor details (105), but systemHealth carries its last verdict
  const security = snapshot.security ?? (health?.security ? { ...securityLevel(health.security), issues: 0 } : undefined);
  if (security && ['danger', 'risk', 'warning', 'outOfDate'].includes(security.level)) {
    // A verdict without details has no page to open, and the advisor itself is admin-only
    items.push({ kind: 'security', level: security.level === 'danger' ? 'danger' : 'warning', issues: security.issues, severity: security.level, ...(snapshot.security ? {} : { summary: true as const }) });
  }
  for (const task of snapshot.backups?.tasks ?? []) {
    if (task.result !== 'failed' && task.result !== 'partial') continue;
    items.push({ kind: 'backup', level: task.result === 'failed' ? 'danger' : 'warning', id: task.id, name: task.name, result: task.result, time: task.last });
  }
  items.sort((a, b) => (a.level === 'danger' ? 0 : 1) - (b.level === 'danger' ? 0 : 1));
  // "All clear" is only as fresh as the oldest source it rests on
  const sources: Item[] = ['health', 'storage', 'security', 'backup'];
  const times = sources.map(item => snapshot.times[item]).filter((t): t is number => typeof t === 'number');
  return { items, checked: times.length > 0, time: times.length ? Math.min(...times) : undefined };
}
