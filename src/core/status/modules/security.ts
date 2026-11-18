/**
 * B. Security Advisor summary: SYNO.Core.SecurityScan.Status system_get
 * (administrators; normal users get 105). Scanning and ignoring rules stay
 * in DSM.
 */
import { record } from '../../discovery/schema.ts';
import { dsmApps, type StatusModule } from './types.ts';

export type SecurityLevel = 'safe' | 'info' | 'outOfDate' | 'warning' | 'risk' | 'danger' | 'unknown';
export const FAIL_KINDS = ['danger', 'risk', 'warning', 'outOfDate', 'info'] as const;
export type FailKind = typeof FAIL_KINDS[number];
export type SecurityCategory = { id: string; level: SecurityLevel; raw?: string; counts: Record<FailKind, number>; total?: number };
export type Security = {
  level: SecurityLevel; raw?: string;
  /** Last finished scan, epoch seconds */
  lastScan?: number;
  running: boolean;
  categories: SecurityCategory[];
  /** Failed checks worth attention (danger, risk, warning, out of date), summed from the categories */
  issues: number;
};
const rank: Record<SecurityLevel, number> = { safe: 0, info: 1, outOfDate: 2, warning: 3, risk: 4, danger: 5, unknown: -1 };
const known = new Set(Object.keys(rank));
/** An unknown word stays "unknown" with the word itself, never "safe" */
export function securityLevel(value: unknown): { level: SecurityLevel; raw?: string } {
  if (typeof value !== 'string' || !value) return { level: 'unknown' };
  return known.has(value) && value !== 'unknown' ? { level: value as SecurityLevel } : { level: 'unknown', raw: value };
}
const num = (value: unknown) => { const n = typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Number(value) : NaN; return Number.isFinite(n) ? n : undefined; };
/** Categories in the order Security Advisor lists them */
const ORDER = ['malware', 'systemCheck', 'userInfo', 'network', 'update'];
export function mapSecurity(data: unknown): Security {
  const d = record(data);
  const categories = Object.entries(record(d.items)).map(([id, value]): SecurityCategory => {
    const row = record(value), fail = record(row.fail);
    const counts = Object.fromEntries(FAIL_KINDS.map(kind => [kind, Math.max(0, num(fail[kind]) ?? 0)])) as Record<FailKind, number>;
    const { level, raw } = securityLevel(row.failSeverity);
    return { id: String(row.category ?? id), level, ...(raw ? { raw } : {}), counts, total: num(row.total) };
  }).sort((a, b) => (ORDER.indexOf(a.id) + 1 || 99) - (ORDER.indexOf(b.id) + 1 || 99));
  // The details win over the summary when they disagree
  const worst = categories.reduce<SecurityLevel>((w, c) => rank[c.level] > rank[w] ? c.level : w, 'safe');
  const summary = securityLevel(d.sysStatus);
  const level = categories.length && rank[worst] > rank[summary.level] ? worst : summary.level;
  const issues = categories.reduce((sum, c) => sum + c.counts.danger + c.counts.risk + c.counts.warning + c.counts.outOfDate, 0);
  const lastScan = num(d.lastScanTime);
  const progress = num(d.sysProgress);
  return {
    level, ...(level === summary.level && summary.raw ? { raw: summary.raw } : {}),
    lastScan: lastScan && lastScan > 0 ? lastScan : undefined, running: progress !== undefined && progress < 100, categories, issues,
  };
}

export const security: StatusModule = {
  id: 'security', requires: { api: 'SYNO.Core.SecurityScan.Status', min: 1, max: 1 }, params: { method: 'system_get' }, missing: 'fallback', dsmApp: dsmApps.security,
  apply: (_snapshot, data) => ({ security: mapSecurity(data) }),
};
