import { textFiles } from '../files';
import type { NasProfile, AppTarget } from '../config';
export type SavedSession = { profile: NasProfile; target: AppTarget };
const files = textFiles();
export function readSession(): SavedSession | null {
  try {
    const value = JSON.parse(files.read('shell-session.json') ?? '') as SavedSession;
    if (!value.profile?.origin || !value.target?.url) return null;
    const origin = new URL(value.profile.origin);
    if (!/^https?:$/.test(origin.protocol) || origin.username || origin.password || new URL(value.target.url).origin !== origin.origin) return null;
    return value;
  } catch { return null; }
}
export function writeSession(value: SavedSession): void {
  files.write('shell-session.json', JSON.stringify(value));
}
/** Per-install id sent as DSM's mobile_id: 32 hex characters, created once */
export function installId(create: () => string): string {
  try {
    const saved = files.read('install-id')?.trim();
    if (saved && /^[0-9a-f]{32}$/.test(saved)) return saved;
    const value = create().replace(/-/g, '').toLowerCase();
    files.write('install-id', value);
    return value;
  } catch { return create().replace(/-/g, '').toLowerCase(); }
}
