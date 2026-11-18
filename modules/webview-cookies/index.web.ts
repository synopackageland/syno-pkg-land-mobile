/**
 * The browser build of the native module. The page is served by the NAS's own DSM, so the
 * browser already holds the DSM session cookies for this origin: requests are same-origin
 * fetches, sign-in is DSM's own Auth.login and certificates are the browser's. Android-only
 * pieces (WebView binding, pins, intake, haptics) are inert here.
 */
import type NativeModule from './index';
import type { NativeIntakeItem as NativeIntake } from '../../src/core/bridge/contract';
type Native = typeof NativeModule;

/** One-way fingerprint of DSM's per-session SynoToken; the session cookie itself is HttpOnly */
function fingerprint(value: string): string {
  let a = 0x811c9dc5, b = 0x01000193;
  for (let i = 0; i < value.length; i++) { const c = value.charCodeAt(i); a = Math.imul(a ^ c, 0x01000193) >>> 0; b = Math.imul(b ^ c, 0x5bd1e995) >>> 0; }
  return `w${a.toString(36)}${b.toString(36)}`;
}
let session = '';
function observeToken(body: string): void {
  try {
    const value = JSON.parse(body) as { success?: boolean; SynoToken?: string };
    session = value.success === true && typeof value.SynoToken === 'string' && value.SynoToken ? fingerprint(value.SynoToken) : '';
  } catch { /* Not DSM's reply: keep the last state */ }
}
const sameOrigin = (url: string) => { try { return new URL(url, location.href).origin === location.origin; } catch { return false; } };
/** Reads whether this browser is signed in to DSM; runs before the launcher's first render */
export async function refreshSession(): Promise<string> {
  try {
    const reply = await fetch('/webman/login.cgi?enable_syno_token=yes', { credentials: 'same-origin', cache: 'no-store' });
    if (reply.ok) observeToken(await reply.text()); else session = '';
  } catch { /* Offline keeps the last state */ }
  return session;
}
const signIns = new Map<string, AbortController>();
const cause = (error: unknown) => Object.assign(new Error('Sign-in failed'), { code: (error as Error)?.name === 'AbortError' ? 'cancelled' : 'unreachable' });
const inert = async () => {};
const unavailable = () => Promise.reject(new Error('Unavailable in the browser'));

const web = {
  addListener: () => ({ remove() {} }),
  sessionKey: (_origin: string) => session,
  cookieHeader: () => '',
  async readJson(url: string, _origin: string, language?: string) {
    if (!sameOrigin(url)) throw new Error('Cross-origin read');
    const reply = await fetch(url, { credentials: 'same-origin', cache: 'no-store', headers: language ? { 'Accept-Language': language } : undefined });
    const body = await reply.text();
    if (new URL(url, location.href).pathname === '/webman/login.cgi') observeToken(body);
    return { status: reply.status, body };
  },
  async signIn(origin: string, body: string, _userAgent: string, id: string) {
    const controller = new AbortController();
    signIns.set(id, controller);
    try {
      const reply = await fetch(`${origin}/webapi/entry.cgi`, { method: 'POST', credentials: 'same-origin', cache: 'no-store', signal: controller.signal,
        headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' }, body });
      const text = await reply.text();
      let value: { success?: boolean; data?: { synotoken?: string }; error?: { code?: number; errors?: { types?: Array<{ type?: string }> } } } = {};
      try { value = JSON.parse(text); } catch { /* Mapped below */ }
      if (reply.status === 200 && value.success === true) {
        if (value.data?.synotoken) session = fingerprint(value.data.synotoken); else await refreshSession();
        return { success: true as const, scope: session };
      }
      const types = (value.error?.errors?.types || []).map(item => item?.type).filter((type): type is string => Boolean(type));
      return { success: false as const, status: reply.status, code: value.error?.code || 0, types };
    } catch (error) { throw cause(error); }
    finally { signIns.delete(id); }
  },
  cancelSignIn(id: string) { signIns.get(id)?.abort(); },
  /** Signing out ends this browser's DSM session; DSM keeps its trusted-device cookie */
  async clearSession(origin: string) {
    session = '';
    await fetch(`${origin}/webapi/entry.cgi?api=SYNO.API.Auth&version=6&method=logout&session=webui`, { credentials: 'same-origin', cache: 'no-store' }).catch(() => {});
  },
  deviceName() {
    const agent = navigator.userAgent;
    return /Android/.test(agent) ? 'Android browser' : /iPhone|iPad/.test(agent) ? 'iPhone browser' : 'Browser';
  },
  storageReset: () => '',
  takePendingIntake: async () => ({ items: [] as NativeIntake[] }),
  setCertificatePins: inert,
  haptic(kind: 'long' | 'tick' | 'confirm') { try { navigator.vibrate?.(kind === 'tick' ? 5 : 12); } catch { /* No vibration */ } },
  logOpen() {}, logSignIn() {},
  zeroWebViewInsets: async () => 0,
  goBackIfPossible: async () => false,
  bindBridge: async () => false, unbindBridge: inert, bindFit: async () => false,
  probe: unavailable, cancelProbe() {}, releaseProbe() {},
  fetchIcon: unavailable, download: unavailable, saveToDownloads: unavailable,
};
export default web as unknown as Native;
