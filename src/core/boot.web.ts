import { useEffect, useState } from 'react';
import { refreshSession } from '../../modules/webview-cookies/index.web';
import { loadServerName } from './platform.web';
import { loadLauncherPath, startRemote } from './profiles/remote.web';

/**
 * crypto.randomUUID exists only in secure contexts, and a NAS on the LAN is often plain HTTP. Expo's
 * uuid.v4 (sign-in handles, the install ID) needs it, so build it from getRandomValues, which every
 * context has.
 */
if (typeof crypto !== 'undefined' && typeof crypto.randomUUID !== 'function' && typeof crypto.getRandomValues === 'function') {
  (crypto as { randomUUID: () => string }).randomUUID = () => {
    const b = crypto.getRandomValues(new Uint8Array(16));
    b[6] = (b[6] & 0x0f) | 0x40; b[8] = (b[8] & 0x3f) | 0x80;
    const h = Array.from(b, x => x.toString(16).padStart(2, '0')).join('');
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
  };
}
/**
 * The browser build first learns whether this browser is signed in to DSM, so the right snapshot
 * shows, and takes over the NAS list a switch from another NAS handed over
 */
let booted = false;
const boot = Promise.all([refreshSession(), loadServerName(), loadLauncherPath()]).then(() => { startRemote(); booted = true; });
export function useBooted(): boolean {
  const [ready, setReady] = useState(booted);
  useEffect(() => { if (!ready) void boot.then(() => setReady(true)); }, [ready]);
  return ready;
}
