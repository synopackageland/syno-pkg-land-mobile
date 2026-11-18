/**
 * F. Resource history kept by DSM: SYNO.Core.System.Utilization get
 * type=history (administrators). DSM answers 1008 until "Usage history" is
 * switched on in Resource Monitor; then the module shows why and offers DSM.
 *
 * Measured answer (DSM 7.4.1): `{ time, interval: 60, data_size, cpu:
 * { user_load: [], system_load: [], other_load: [] }, memory: { real_usage: [] } }`,
 * one value per interval ending at `time`. Minutes before history was
 * switched on read 0, so a sample whose memory use is 0 counts as missing.
 */
import { record } from '../../discovery/schema.ts';
import { dsmApps, type StatusModule } from './types.ts';

export const HISTORY_RANGES = ['week', 'month', 'half_year', 'year'] as const;
export type HistoryRange = typeof HISTORY_RANGES[number];
export type ResourceHistory = {
  range: HistoryRange;
  /** Time of the last bucket and the width of each bucket, epoch seconds and seconds */
  end: number; step: number;
  /** Bucket averages, null where DSM has no data */
  cpu: (number | null)[]; memory: (number | null)[];
};
/** Buckets drawn per chart; a week of minutes is 10 081 values */
export const HISTORY_POINTS = 120;
const nums = (value: unknown) => Array.isArray(value) ? value.map(v => typeof v === 'number' && Number.isFinite(v) ? v : undefined) : [];

export function mapHistory(data: unknown, range: HistoryRange, points = HISTORY_POINTS): ResourceHistory | undefined {
  const d = record(data), cpu = record(d.cpu), memory = record(d.memory);
  const user = nums(cpu.user_load), system = nums(cpu.system_load), other = nums(cpu.other_load), real = nums(memory.real_usage);
  const size = Math.max(user.length, real.length);
  const end = Number(d.time), interval = Number(d.interval);
  if (!size || !Number.isFinite(end) || !(interval > 0)) return undefined;
  const per = Math.max(1, Math.ceil(size / points));
  const buckets = Math.ceil(size / per);
  const cpuOut: (number | null)[] = [], memOut: (number | null)[] = [];
  // Buckets end at the newest sample, so the right edge is "now"
  for (let b = 0; b < buckets; b++) {
    const to = size - (buckets - 1 - b) * per, from = Math.max(0, to - per);
    let c = 0, m = 0, n = 0;
    for (let i = from; i < to; i++) {
      // Memory never reads 0 on a running NAS: a 0 is a minute without data
      if (!real[i]) continue;
      c += (user[i] ?? 0) + (system[i] ?? 0) + (other[i] ?? 0); m += real[i]!; n++;
    }
    cpuOut.push(n ? Math.min(100, c / n) : null); memOut.push(n ? m / n : null);
  }
  return { range, end, step: per * interval, cpu: cpuOut, memory: memOut };
}

export const history: StatusModule = {
  id: 'history', requires: { api: 'SYNO.Core.System.Utilization', min: 1, max: 1 },
  params: { method: 'get', type: 'history', resource: ['cpu', 'memory'], time_range: 'week' }, missing: 'fallback', dsmApp: dsmApps.resource, disabled: [1008],
  apply: (_snapshot, data) => {
    const value = mapHistory(data, 'week');
    return value ? { history: value } : {};
  },
};
