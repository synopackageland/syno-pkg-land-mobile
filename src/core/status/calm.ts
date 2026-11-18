/**
 * Calm readouts: how a live number (CPU %, memory %, a rate, a temperature)
 * moves from one poll's value to the next.
 *
 * Easing the raw value and writing every frame made the numbers look like
 * noise: the last digit changed on every frame, a rate crossed units on its
 * way (2.1 MB/s to 1.6 KB/s passed through hundreds of KB/s), and trailing
 * decimals came and went, so the text changed width. A readout here instead
 *
 * - moves only when the value really changed by more than a couple of the
 *   steps it is written in, and never across a unit (it switches at once);
 * - starts on the text already shown and writes every step after it in the
 *   new value's unit and decimals;
 * - counts in a few round steps (about `CALM.steps` of them) that start and
 *   settle gently over `CALM.duration`, then lands on the exact text;
 * - with the system's reduced motion setting it shows the new value at once.
 *
 * The sense that the NAS is live comes from the trend lines scrolling, not
 * from the digits.
 */
import { byteScale, formatRate, percent } from './format.ts';

export const CALM = { duration: 500, small: 2, steps: 6 } as const;

/**
 * Ease in and out (half a cosine): the count starts and settles gently, so no
 * step flashes by in a single frame at the start, as an ease-out would.
 */
export const calmEase = (p: number) => { const q = Math.max(0, Math.min(1, p)); return (1 - Math.cos(Math.PI * q)) / 2; };
/** The value at `elapsed` ms into a change; the end value from `duration` on */
export const calmValue = (from: number, to: number, elapsed: number, duration: number = CALM.duration) =>
  duration <= 0 || elapsed >= duration ? to : from + (to - from) * calmEase(elapsed / duration);

/** The unit a value is written in, what one of that unit is, and its decimals */
export type Scale = { unit: string; divisor: number; decimals: number };
/**
 * A kind of number on screen: `text` writes a value exactly as it rests,
 * `scale` says how it is written (none for a value it writes as "-"), and
 * `write` puts digits in that scale's unit into the same shape as `text`.
 */
export type Readout = {
  text(value: number | undefined): string;
  scale(value: number): Scale | undefined;
  write(digits: string, scale: Scale): string;
};

const whole = (unit: string): Scale => ({ unit, divisor: 1, decimals: 0 });
const finite = (value: number) => Number.isFinite(value) && value >= 0;
export const readouts = {
  percent: { text: percent, scale: value => Number.isFinite(value) ? whole('%') : undefined, write: digits => `${digits}%` },
  rate: { text: formatRate, scale: value => finite(value) ? byteScale(value, 1, false) : undefined, write: (digits, scale) => `${digits} ${scale.unit}/s` },
  celsius: {
    text: value => value === undefined || !Number.isFinite(value) ? '-' : `${Math.round(value)} °C`,
    scale: value => Number.isFinite(value) ? whole('°C') : undefined,
    write: (digits, scale) => `${digits} ${scale.unit}`,
  },
} satisfies Record<string, Readout>;

/** 1, 2 or 5 times a power of ten, the smallest one not under `raw` */
export function roundStep(raw: number): number {
  if (!(raw > 0) || !Number.isFinite(raw)) return 1;
  const power = 10 ** Math.floor(Math.log10(raw));
  for (const m of [1, 2, 5, 10]) if (m * power >= raw - power * 1e-9) return m * power;
  return 10 * power;
}

/**
 * Whether a change from `from` to `to` moves at all: not the first value,
 * not under reduced motion, not across a unit, and not a change of
 * `CALM.small` written steps or less (9% to 10% simply switches).
 */
export function calmMoves(from: number | undefined, to: number | undefined, readout: Readout, reduced = false): boolean {
  if (reduced || from === undefined || to === undefined || from === to) return false;
  const a = readout.scale(from), b = readout.scale(to);
  if (!a || !b || a.unit !== b.unit || a.divisor !== b.divisor) return false;
  if (readout.text(from) === readout.text(to)) return false;
  return Math.abs(to - from) / b.divisor * 10 ** b.decimals > CALM.small;
}

/**
 * The text at `elapsed` ms into a change from `from` to `to`. Every frame is
 * written in `to`'s unit and decimals, on a round step between the two, and
 * the last frame is `to`'s own text.
 */
export function calmText(from: number | undefined, to: number | undefined, readout: Readout, elapsed: number, duration: number = CALM.duration, reduced = false): string {
  if (to === undefined || elapsed >= duration || !calmMoves(from, to, readout, reduced)) return readout.text(to);
  const scale = readout.scale(to)!;
  const a = from! / scale.divisor, b = to / scale.divisor;
  const step = Math.max(10 ** -scale.decimals, roundStep(Math.abs(b - a) / CALM.steps));
  // The stops: where it was, the round steps between (none within half a step of either end), and the new value
  const lo = Math.min(a, b), hi = Math.max(a, b), stops = [a];
  for (let m = Math.ceil(lo / step) * step; m < hi; m += step) if (m - lo >= step / 2 && hi - m >= step / 2) stops.push(m);
  stops.push(b);
  if (b < a) stops.splice(1, stops.length - 2, ...stops.slice(1, -1).reverse());
  // The frame shows the stop nearest to where the value is now
  const v = calmValue(a, b, elapsed, duration);
  let index = 0;
  for (let i = 1; i < stops.length; i++) if (Math.abs(stops[i] - v) < Math.abs(stops[index] - v)) index = i;
  // The ends are each value's own text; the steps between are in the new value's decimals
  if (index === 0) return readout.text(from);
  return index === stops.length - 1 ? readout.text(to) : readout.write(stops[index].toFixed(scale.decimals), scale);
}
