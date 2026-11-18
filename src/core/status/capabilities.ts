/**
 * What this DSM offers: SYNO.API.Info query=all, trimmed to version ranges.
 *
 * - Read once per DSM build and kept in files/status/<profile>-caps.json.
 * - Read again when the build changes, when a module's call answers 102 (no
 *   such API, e.g. a package was removed), or after a day (a package installed
 *   since adds its API without changing the build).
 * - Modules declare the versions they were tested with; `pick` returns the
 *   highest version both sides support.
 */
import { record } from '../discovery/schema.ts';

export type ApiRange = { min: number; max: number };
export type Capabilities = { build?: string; time: number; apis: Record<string, ApiRange> };
export type Requirement = { api: string; min: number; max: number };
/** Re-read the table after this long even when the build is the same */
export const CAPS_AGE = 24 * 60 * 60 * 1000;

/** SYNO.API.Info query=all: `{ "<api>": { minVersion, maxVersion, path } }` */
export function mapApiInfo(data: unknown, build: string | undefined, time: number): Capabilities {
  const apis: Record<string, ApiRange> = {};
  for (const [api, value] of Object.entries(record(data))) {
    const entry = record(value), min = Number(entry.minVersion), max = Number(entry.maxVersion);
    if (Number.isInteger(min) && Number.isInteger(max) && min <= max) apis[api] = { min, max };
  }
  return { build, time, apis };
}
export type Pick = { version: number } | { missing: true } | { unsupported: true };
/**
 * The version to call: the highest both DSM and the module support. Without a
 * table yet (first run, or the read failed) the module's lowest version is
 * used, which is what every caller did before the table existed.
 */
export function pick(caps: Capabilities | undefined, need: Requirement): Pick {
  if (!caps) return { version: need.min };
  const range = caps.apis[need.api];
  if (!range) return { missing: true };
  const version = Math.min(range.max, need.max);
  return version >= Math.max(range.min, need.min) ? { version } : { unsupported: true };
}
/** The table is still good for this build */
export function capsFresh(caps: Capabilities | undefined, build: string | undefined, now: number): boolean {
  if (!caps) return false;
  if (build && caps.build !== build) return false;
  return now - caps.time < CAPS_AGE;
}
