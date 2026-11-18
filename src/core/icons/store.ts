import { Directory, File, Paths } from 'expo-file-system';
import { PixelRatio } from 'react-native';
import Native from '../../../modules/webview-cookies';
import { IconCache, type IconFiles } from './cache';

const root = () => new Directory(Paths.document, 'app-icons');
const toPath = (uri: string) => decodeURIComponent(uri.replace(/^file:\/\//, ''));
/** Profile ids are UUIDs; anything else is reduced to a safe folder name */
const folder = (profile: string) => /^[A-Za-z0-9-]{1,64}$/.test(profile) ? profile : encodeURIComponent(profile).replace(/[^A-Za-z0-9-]/g, '_').slice(0, 64);
const files: IconFiles = {
  readIndex() { const file = new File(root(), 'index.json'); return file.exists ? file.textSync() : null; },
  writeIndex(text) {
    const dir = root(); if (!dir.exists) dir.create({ intermediates: true });
    const file = new File(dir, 'index.json'); if (!file.exists) file.create(); file.write(text);
  },
  path(profile, name) { return toPath(new File(root(), folder(profile), name).uri); },
  uri(path) { return `file://${path}`; },
  remove(path) { try { const file = new File(`file://${path}`); if (file.exists) file.delete(); } catch { /* Already gone */ } },
  removeProfile(profile) { const dir = new Directory(root(), folder(profile)); if (dir.exists) dir.delete(); },
  list() {
    const dir = root();
    if (!dir.exists) return [];
    return dir.list().flatMap(item => item instanceof Directory ? item.list().filter(file => file instanceof File && !file.name.endsWith('.part')).map(file => toPath(file.uri)) : []);
  },
};
/** Launcher tile size in device pixels picks 72, 128 or 256 from DSM */
export const ICON_DP = 52;
export const iconCache = new IconCache(files, (url, origin, dest, etag, lastModified) => Native.fetchIcon(url, origin, dest, etag ?? null, lastModified ?? null), { pixels: Math.round(ICON_DP * PixelRatio.get()) });
