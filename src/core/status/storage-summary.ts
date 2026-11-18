/**
 * What the storage glance shows on a NAS with many volumes and drives: a
 * fixed number of rows however many there are, problems first. The storage
 * page lists everything, in the same problems-first order.
 */
import type { Disk, Volume } from './mappers.ts';

/** Rows the overview shows at most, for volumes and for drives with a problem */
export const SUMMARY_ROWS = 3;
const filled = (v: Volume) => v.total > 0 ? v.used / v.total : 0;
const volumeRank = (v: Volume) => v.state === 'crashed' ? 5 : v.state === 'degraded' ? 4 : v.state === 'readonly' ? 3 : v.status === 'danger' ? 2 : v.status === 'warning' ? 1 : 0;
const diskRank = (d: Disk) => d.status === 'danger' ? 2 : d.status === 'warning' ? 1 : 0;

/** Volumes with a problem first, then the fullest */
export function volumesByNeed(volumes: Volume[]): Volume[] {
  return [...volumes].sort((a, b) => volumeRank(b) - volumeRank(a) || filled(b) - filled(a));
}
/** Failing drives, then drives that need attention, then the rest; each in bay order */
export function disksByNeed(disks: Disk[]): Disk[] {
  return [...disks].sort((a, b) => diskRank(b) - diskRank(a) || a.order - b.order);
}
export type StorageSummary = {
  volumes: Volume[]; moreVolumes: number;
  /** All drives, and the ones with a problem shown (at most SUMMARY_ROWS) */
  disks: number; bad: Disk[]; moreBad: number; badCount: number;
};
export function storageSummary(volumes: Volume[], disks: Disk[], rows = SUMMARY_ROWS): StorageSummary {
  const sorted = volumesByNeed(volumes), bad = disksByNeed(disks).filter(d => d.status !== 'normal');
  return {
    volumes: sorted.slice(0, rows), moreVolumes: Math.max(0, sorted.length - rows),
    disks: disks.length, bad: bad.slice(0, rows), moreBad: Math.max(0, bad.length - rows), badCount: bad.length,
  };
}
