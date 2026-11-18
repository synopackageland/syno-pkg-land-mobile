import { textFiles } from '../files';
import { fixedProfile } from '../platform';
import type { LauncherStorage, SavedLauncher } from './model';
import { record } from '../discovery/schema';
import { qrAddress } from '../profiles/qr';
import { sameOrigin } from '../profiles/url';
import { QC_ID } from '../profiles/quickconnect';
const files = textFiles();
/** The web build always shows its one NAS, keeping that NAS's saved switches and snapshot */
function fixed(value: SavedLauncher): SavedLauncher {
  const only = fixedProfile(value.profiles.find(p => p.origin === fixedProfile()?.origin));
  if (!only) return value;
  const previous = value.profiles.find(p => p.origin === only.origin);
  const snapshot = previous ? value.snapshots[previous.id] : undefined;
  return { profiles: [only], active: only.id, snapshots: snapshot ? { [only.id]: snapshot } : {}, order: previous && value.order?.[previous.id] ? { [only.id]: value.order[previous.id] } : {} };
}
export const launcherStorage: LauncherStorage = {
  read() {
    try {
      const text = files.read('launcher.json');
      if (text === null) return fixed({ profiles: [], snapshots: {} });
      const value = JSON.parse(text) as SavedLauncher & { visibilityPolicy?: number };
      if (!Array.isArray(value.profiles) || !value.profiles.every(p => typeof p.id === 'string' && typeof p.name === 'string' && sameOrigin(p.origin, p.origin) && new URL(p.origin).origin === p.origin)) return null;
      for (const profile of value.profiles) {
        if (profile.group !== undefined && typeof profile.group !== 'string') return null;
        if (profile.mobileFit !== undefined && typeof profile.mobileFit !== 'boolean') return null;
        if (profile.quickconnect !== undefined && (typeof profile.quickconnect !== 'string' || !QC_ID.test(profile.quickconnect))) return null;
        if (profile.kind !== undefined || profile.sha256 !== undefined) qrAddress({ url: profile.origin, kind: profile.kind || 'other', sha256: profile.sha256 });
      }
      const snapshots: SavedLauncher['snapshots'] = {};
      for (const profile of value.profiles) {
        const snapshot = value.snapshots?.[profile.id];
        if (value.visibilityPolicy === 3 && snapshot && typeof snapshot.scope === 'string' && Array.isArray(snapshot.apps) && snapshot.apps.every(app => typeof app.id === 'string' && typeof app.name === 'string' && sameOrigin(app.url, profile.origin) && (app.registered === true && app.preset === 'mobile' || app.registered === false && app.preset === 'desktop') && Array.isArray(app.capabilities))) snapshots[profile.id] = snapshot;
      }
      const order = Object.fromEntries(Object.entries(record(value.order)).filter(([id, ids]) => value.profiles.some(p => p.id === id) && Array.isArray(ids) && ids.every(app => typeof app === 'string'))) as Record<string, string[]>;
      return fixed({ profiles: value.profiles, active: value.active, snapshots, order });
    } catch { return fixedProfile() ? fixed({ profiles: [], snapshots: {} }) : null; }
  },
  write(value) { files.write('launcher.json', JSON.stringify({ ...value, visibilityPolicy: 3 })); },
};
