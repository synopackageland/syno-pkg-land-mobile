/**
 * The live resource charts: one small ring buffer of timed samples, a
 * continuous line through them and the numbers that ease to each new value.
 *
 * - The chart shows a fixed span of time that ends one poll period behind
 *   now, so the newest sample is already known when the line reaches it and
 *   the x axis can scroll at a steady rate between polls.
 * - The line never breaks: a missing value is interpolated between its
 *   neighbours, and after the newest sample the last value carries on. A slow
 *   or failed poll therefore keeps the line scrolling at the last value.
 * - Nothing here reads DSM's own history; the samples are the ones the App
 *   polled itself (SYNO.Core.System.Utilization get, one per tick).
 */

/** How often the visible surface polls utilization, and what the charts show */
export const LIVE = { period: 5_000, span: 60_000, delay: 5_000, ease: 800 } as const;

/** One polled sample with its time; a measure DSM did not give is left out */
export type LiveSample = { t: number; cpu?: number; memory?: number; rx?: number; tx?: number; read?: number; write?: number };
export type LiveKey = Exclude<keyof LiveSample, 't'>;
export type LivePoint = { t: number; v: number };

/** Appends a sample and keeps the newest `capacity`; a sample older than the last replaces nothing and is dropped */
export function pushSample<T extends { t: number }>(buffer: readonly T[] | undefined, sample: T, capacity: number): T[] {
  const list = buffer ?? [];
  const last = list[list.length - 1];
  if (last && sample.t < last.t) return [...list];
  const next = last && sample.t === last.t ? [...list.slice(0, -1), sample] : [...list, sample];
  return next.slice(-Math.max(1, capacity));
}

/**
 * One measure as a gap-free line: samples without the value are filled by
 * linear interpolation between the known neighbours by time; samples before
 * the first known value are dropped (there is nothing to carry yet). Time
 * gaps between samples are bridged, never left open.
 */
export function continuous(samples: readonly LiveSample[] | undefined, key: LiveKey): LivePoint[] {
  const list = (samples ?? []).filter(s => Number.isFinite(s.t));
  const known = list.map((s, i) => ({ i, v: s[key] })).filter((k): k is { i: number; v: number } => typeof k.v === 'number' && Number.isFinite(k.v));
  if (!known.length) return [];
  const out: LivePoint[] = [];
  let k = 0;
  for (let i = known[0].i; i < list.length; i++) {
    while (k + 1 < known.length && known[k + 1].i <= i) k++;
    const a = known[k], b = known[k + 1];
    const t = list[i].t;
    if (a.i === i || !b) { out.push({ t, v: a.v }); continue; }
    const ta = list[a.i].t, tb = list[b.i].t;
    const p = tb > ta ? (t - ta) / (tb - ta) : 0;
    out.push({ t, v: a.v + (b.v - a.v) * p });
  }
  return out;
}

/** The line's value at a time: interpolated inside, the first value before and the last value after */
export function valueAt(points: readonly LivePoint[], t: number): number | undefined {
  if (!points.length) return undefined;
  if (t <= points[0].t) return points[0].v;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i];
    if (t <= b.t) return b.t > a.t ? a.v + (b.v - a.v) * (t - a.t) / (b.t - a.t) : b.v;
  }
  return points[points.length - 1].v;
}

/** Ease-out cubic on 0..1 */
export const ease = (p: number) => { const q = Math.max(0, Math.min(1, p)); return 1 - (1 - q) ** 3; };

/** A number on its way from one value to the next; reduced motion or no previous value lands at once */
export function tween(from: number | undefined, to: number, elapsed: number, duration: number, reduced = false): number {
  if (from === undefined || reduced || duration <= 0 || elapsed >= duration || !Number.isFinite(from)) return to;
  return from + (to - from) * ease(elapsed / duration);
}

/**
 * The newest point eases in: for `duration` after it arrived its value moves
 * from the value the line carried there to its own, so the right end of the
 * line bends into place instead of jumping.
 */
export function easeIn(points: readonly LivePoint[], arrived: number, now: number, duration: number, reduced = false): LivePoint[] {
  if (points.length < 2 || reduced) return [...points];
  const last = points[points.length - 1], previous = points[points.length - 2];
  const v = tween(previous.v, last.v, now - arrived, duration);
  return v === last.v ? [...points] : [...points.slice(0, -1), { t: last.t, v }];
}

export type ChartBox = { width: number; height: number; max: number; thickness: number };
/**
 * The line's corners in pixels for the time window [from, to]: the value at
 * `from`, every sample inside, and the value at `to` (the last value carried
 * when no sample reaches it). Empty without samples or width; the line starts
 * at the first sample when that lies inside the window.
 */
export function chartPoints(points: readonly LivePoint[], from: number, to: number, box: ChartBox): { x: number; y: number }[] {
  if (!points.length || box.width <= 0 || to <= from) return [];
  const x = (t: number) => (t - from) / (to - from) * box.width;
  const top = box.max > 0 ? box.max : 1;
  const y = (v: number) => box.height - box.thickness - Math.max(0, Math.min(1, v / top)) * (box.height - box.thickness * 2);
  const start = Math.max(from, points[0].t);
  if (start >= to) return [];
  const out = [{ x: x(start), y: y(valueAt(points, start)!) }];
  for (const p of points) if (p.t > start && p.t < to) out.push({ x: x(p.t), y: y(p.v) });
  out.push({ x: box.width, y: y(valueAt(points, to)!) });
  return out;
}

/** One SVG path through the corners, rounded to tenths of a pixel */
export function pathOf(corners: readonly { x: number; y: number }[]): string {
  const r = (n: number) => Math.round(n * 10) / 10;
  return corners.map((c, i) => `${i ? 'L' : 'M'}${r(c.x)} ${r(c.y)}`).join(' ');
}

/** The window a live chart shows at `now`: a fixed span ending one period behind, or at the newest sample with reduced motion */
export function liveWindow(now: number, newest: number | undefined, reduced: boolean, span: number = LIVE.span, delay: number = LIVE.delay): { from: number; to: number } {
  const to = reduced && newest !== undefined ? newest : now - delay;
  return { from: to - span, to };
}

/** Top of an automatic scale (network rates): the highest value from `from` on, with headroom; never 0 */
export function scaleOf(points: readonly LivePoint[], from: number): number {
  let top = 0;
  for (let i = 0; i < points.length; i++) if (points[i].t >= from || points[i + 1]?.t > from) top = Math.max(top, points[i].v);
  return top > 0 ? top * 1.15 : 1;
}
