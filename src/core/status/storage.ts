import { textFiles } from '../files';
import type { StatusStorage } from './model';

/** Status cache per NAS profile under files/status; never holds credentials */
const files = textFiles('status');
const safe = (value: string) => value.replace(/[^A-Za-z0-9_-]/g, '_');
function readJson(name: string): unknown {
  try { const text = files.read(name); return text === null ? null : JSON.parse(text); } catch { return null; }
}
function writeJson(name: string, value: unknown) {
  try { files.write(name, JSON.stringify(value)); } catch { /* A cache that can't be written only costs the instant first paint */ }
}
export const statusStorage: StatusStorage = {
  read(profile) {
    const value = readJson(`${safe(profile)}.json`) as ReturnType<StatusStorage['read']>;
    return value && typeof value === 'object' && (!value.snapshot || typeof value.snapshot.scope === 'string' && Array.isArray(value.snapshot.denied) && value.snapshot.times && typeof value.snapshot.times === 'object') ? value : null;
  },
  write(profile, value) { writeJson(`${safe(profile)}.json`, value); },
  readStrings(profile, lang) {
    const value = readJson(`${safe(profile)}-strings-${safe(lang)}.json`) as ReturnType<StatusStorage['readStrings']>;
    return value && typeof value.time === 'number' && value.strings && typeof value.strings === 'object' ? value : null;
  },
  writeStrings(profile, lang, value) { writeJson(`${safe(profile)}-strings-${safe(lang)}.json`, value); },
  /** SYNO.API.Info per NAS, kept until the DSM build changes */
  readCaps(profile) {
    const value = readJson(`${safe(profile)}-caps.json`) as ReturnType<NonNullable<StatusStorage['readCaps']>>;
    return value && typeof value.time === 'number' && value.apis && typeof value.apis === 'object' ? value : null;
  },
  writeCaps(profile, value) { writeJson(`${safe(profile)}-caps.json`, value); },
  remove(profile) {
    try { for (const name of files.list()) if (name === `${safe(profile)}.json` || name.startsWith(`${safe(profile)}-strings-`) || name === `${safe(profile)}-caps.json`) files.remove(name); } catch { /* best effort */ }
  },
};
