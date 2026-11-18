/** Display formatting for NAS status: 1024-based sizes labelled the DSM way (KB, MB, GB, TB) */
const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
/** How a byte count is written: its unit, what one of that unit is and how many decimals it shows */
export type ByteScale = { unit: string; divisor: number; decimals: number };
/**
 * The unit and decimals for a byte count: whole bytes, whole numbers from 100
 * up, else `digits` decimals. With `trim` a value whose decimals round to zero
 * drops them (8 GB, not 8.0 GB).
 */
export function byteScale(bytes: number, digits = 1, trim = true): ByteScale {
  let value = bytes, unit = 0;
  while (value >= 1024 && unit < units.length - 1) { value /= 1024; unit++; }
  const decimals = unit === 0 || value >= 100 || (trim && /\.0+$/.test(value.toFixed(digits))) ? 0 : digits;
  return { unit: units[unit], divisor: 1024 ** unit, decimals };
}
export function formatBytes(bytes: number | undefined, digits = 1, trim = true): string {
  if (bytes === undefined || !Number.isFinite(bytes) || bytes < 0) return '-';
  const scale = byteScale(bytes, digits, trim);
  return `${(bytes / scale.divisor).toFixed(scale.decimals)} ${scale.unit}`;
}
/**
 * A transfer rate. Below 100 of a unit it always shows one decimal (2.0 KB/s,
 * not 2 KB/s), so a rate that changes every poll keeps its width.
 */
export const formatRate = (bytesPerSecond: number | undefined) => bytesPerSecond === undefined ? '-' : `${formatBytes(bytesPerSecond, 1, false)}/s`;
/** Split value and unit for large ring labels */
export function bytesParts(bytes: number | undefined): { value: string; unit: string } {
  const [value, unit = ''] = formatBytes(bytes).split(' ');
  return { value, unit };
}
/** Used and total with one shared unit when they match: 7.6 / 15.6 GB */
export function usedOfTotal(used: number | undefined, total: number | undefined): string {
  const a = bytesParts(used), b = bytesParts(total);
  return a.unit === b.unit ? `${a.value} / ${b.value} ${b.unit}` : `${formatBytes(used)} / ${formatBytes(total)}`;
}
export const percent = (value: number | undefined) => value === undefined ? '-' : `${Math.round(value)}%`;
/** Days, hours, minutes and seconds as compact parts; the labels come from the locale */
export function uptimeParts(seconds: number) {
  const s = Math.max(0, Math.floor(seconds));
  return { days: Math.floor(s / 86400), hours: Math.floor(s % 86400 / 3600), minutes: Math.floor(s % 3600 / 60), seconds: s % 60 };
}
/** Local calendar day key for grouping notifications */
export function dayKey(unixSeconds: number): string {
  const d = new Date(unixSeconds * 1000);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
export type DayGroup<T> = { key: string; items: T[] };
/** Items are newest first; groups keep that order */
export function groupByDay<T extends { time: number }>(items: T[]): DayGroup<T>[] {
  const groups: DayGroup<T>[] = [];
  for (const item of items) {
    const key = dayKey(item.time);
    const last = groups[groups.length - 1];
    if (last?.key === key) last.items.push(item); else groups.push({ key, items: [item] });
  }
  return groups;
}
/** Today, Yesterday or the locale's date */
export function dayLabel(key: string, now: Date, labels: { today: string; yesterday: string }, locale: string): string {
  if (key === dayKey(now.getTime() / 1000)) return labels.today;
  if (key === dayKey(now.getTime() / 1000 - 86400)) return labels.yesterday;
  const [y, m, d] = key.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  try { return date.toLocaleDateString(locale, { month: 'short', day: 'numeric', ...(y !== now.getFullYear() ? { year: 'numeric' } : {}) }); } catch { return key; }
}
export function timeLabel(unixSeconds: number, locale: string): string {
  const d = new Date(unixSeconds * 1000);
  try { return d.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' }); } catch { return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; }
}
/**
 * How old a value is: "just now", "3 min ago", "2 h ago"; after a day the
 * date and time, so an old cache never reads as recent
 */
export function ageLabel(at: number, now: number, words: { justNow: string; minutesAgo: string; hoursAgo: string }, locale: string): string {
  const minutes = Math.floor(Math.max(0, now - at) / 60_000);
  if (minutes < 1) return words.justNow;
  if (minutes < 60) return words.minutesAgo.replace('{count}', String(minutes));
  if (minutes < 24 * 60) return words.hoursAgo.replace('{count}', String(Math.floor(minutes / 60)));
  const d = new Date(at);
  try { return d.toLocaleString(locale, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }); } catch { return `${dayKey(at / 1000)} ${timeLabel(at / 1000, locale)}`; }
}
/** A future or past DSM time as "Today 03:00", "Tomorrow 03:00" or a date */
export function whenLabel(unixSeconds: number, now: number, labels: { today: string; yesterday: string; tomorrow?: string }, locale: string): string {
  const key = dayKey(unixSeconds), time = timeLabel(unixSeconds, locale);
  if (key === dayKey(now / 1000)) return `${labels.today} ${time}`;
  if (key === dayKey(now / 1000 - 86400)) return `${labels.yesterday} ${time}`;
  if (labels.tomorrow && key === dayKey(now / 1000 + 86400)) return `${labels.tomorrow} ${time}`;
  return `${dayLabel(key, new Date(now), { today: labels.today, yesterday: labels.yesterday }, locale)} ${time}`;
}
