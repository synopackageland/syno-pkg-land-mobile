/**
 * "Add to Home Screen" for the browser build. A phone browser that has not added the page yet gets a
 * small card on the home page: iPhone and iPad Safari get the Share › Add to Home Screen steps, a
 * browser that offers its own install prompt (Chrome on Android) gets a button for it, and every
 * other browser gets nothing. Added pages (standalone), frames and the native App never show it.
 */
export type InstallKind = 'ios' | 'prompt';
export type InstallEnv = {
  userAgent: string;
  /** navigator.maxTouchPoints: iPadOS Safari reports itself as a Mac */
  maxTouchPoints?: number;
  /** Opened from the home screen: navigator.standalone (iOS) or a display-mode media query */
  standalone: boolean;
  /** The page runs inside another page's frame */
  framed: boolean;
  /** The browser fired beforeinstallprompt and the event is kept */
  canPrompt: boolean;
  dismissed: boolean;
};

export const DISMISSED_KEY = 'spl:install-hint-dismissed';

/** Safari on iPhone, iPod or iPad; not Chrome, Firefox, Edge or another App's web view on iOS */
export function iosSafari(userAgent: string, maxTouchPoints = 0): boolean {
  const ios = /\b(iPhone|iPod|iPad)\b/.test(userAgent) || /\bMacintosh\b/.test(userAgent) && maxTouchPoints > 1;
  if (!ios || !/\bSafari\//.test(userAgent) || !/\bVersion\//.test(userAgent)) return false;
  return !/\b(CriOS|FxiOS|EdgiOS|OPiOS|OPT|YaBrowser|DuckDuckGo|GSA|FBAN|FBAV|Instagram|Line|MicroMessenger)\b/.test(userAgent);
}

/** Which card to show, if any */
export function installKind(env: InstallEnv): InstallKind | null {
  if (env.standalone || env.framed || env.dismissed) return null;
  if (iosSafari(env.userAgent, env.maxTouchPoints)) return 'ios';
  return env.canPrompt ? 'prompt' : null;
}

type Store = Pick<Storage, 'getItem' | 'setItem'>;
export function isDismissed(store: Store | undefined): boolean {
  try { return Boolean(store?.getItem(DISMISSED_KEY)); } catch { return false; }
}
/** Remembered in this browser: the card never returns, also after a reload */
export function rememberDismissed(store: Store | undefined, now = Date.now()): void {
  try { store?.setItem(DISMISSED_KEY, String(now)); } catch { /* Private mode: hidden for this visit only */ }
}
