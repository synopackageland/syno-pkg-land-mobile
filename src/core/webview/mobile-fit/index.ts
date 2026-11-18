import type { NasProfile } from '../../config';
import { fitSource } from './fit.gen.ts';

/** Phones get the fit unless the user turned it off for this NAS; tablets (short side 600 dp or more) keep the desktop */
export const TABLET = 600;
export function mobileFitOn(profile: Pick<NasProfile, 'mobileFit'>, shortSide: number): boolean {
  return profile.mobileFit ?? shortSide < TABLET;
}

/** The fit script for one NAS. It does nothing on any other origin */
export function mobileFitScript(origin: string): string {
  const allowed = new URL(origin).origin;
  return `if (location.origin === ${JSON.stringify(allowed)}) {\n${fitSource}\n}`;
}

/** The App on screen in single-App mode, as the fit script reports it */
/** The App on screen in single-App mode; `back` counts the steps back closes inside the page */
/** `busy`: the App window still shows DSM's own loading mask */
export type FitApp = { id: string; title: string; page: string; menu: boolean; back: number; icon?: string; busy?: boolean };
const text = (value: unknown, max: number) => typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, max) : '';
/**
 * Page messages are untrusted: keep short plain text and a small raster data URL only.
 * An App's own page (no DSM App window) reports no title, and a package page's list of its Apps
 * (an embedded DSM desktop) no id either: the bar keeps the launched App's name
 */
export function fitApp(value: unknown): FitApp | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const app = value as Record<string, unknown>;
  const title = text(app.title, 80), id = text(app.id, 200);
  // (A page's own list of Apps reports no id or title, only its back steps)
  if (!title && !id && !Number.isInteger(app.back)) return undefined;
  const icon = typeof app.icon === 'string' && app.icon.length <= 90_000 && /^data:image\/(png|jpeg|gif|webp);base64,[A-Za-z0-9+/=]+$/.test(app.icon) ? app.icon : undefined;
  const back = Number.isInteger(app.back) ? Math.min(Math.max(app.back as number, 0), 50) : 0;
  return { id, title, page: text(app.page, 80), menu: app.menu === true, back, ...(icon ? { icon } : {}), ...(app.busy === true ? { busy: true } : {}) };
}
const calls = { menu: '__splFitMenu', sync: '__splFitSync', back: '__splFitBack', home: '__splFitHome' } as const;
/** Asks the page (single-App mode) to toggle the App's side menu, report the App on screen again, close its top back step, or close every App it hosts */
export function fitCallScript(origin: string, call: keyof typeof calls): string {
  const name = calls[call];
  return `if (location.origin === ${JSON.stringify(new URL(origin).origin)} && typeof window.${name} === 'function') window.${name}();true;`;
}

/**
 * The warm DSM page: one single-App page stays loaded and opens each DSM App inside it with
 * DSM's own AppLaunch (dsm-fit.js launch()), instead of booting DSM again for every App.
 * Its first App is one every account has; it stays loaded underneath, out of sight.
 */
export const WARM_BOOT = 'SYNO.SDS.App.PersonalSettings.Instance';
export const warmUrl = (origin: string) => `${new URL(origin).origin}/?launchApp=${encodeURIComponent(WARM_BOOT)}`;
/** The DSM App a target opens by DSM's launch ID alone (`/?launchApp=<id>`), which the warm page can host */
export function hostedApp(url: string, origin: string): string | undefined {
  try {
    const u = new URL(url), base = new URL(origin);
    if (u.origin !== base.origin || u.pathname !== '/' || u.hash || [...u.searchParams.keys()].join() !== 'launchApp') return undefined;
    const id = u.searchParams.get('launchApp') || '';
    return /^[A-Za-z0-9_.]{1,200}$/.test(id) ? id : undefined;
  } catch { return undefined; }
}
/** Opens a DSM App in the warm page; the page reports it like any single App, or `fitLaunch` false */
export function fitLaunchScript(origin: string, id: string): string {
  return `if (location.origin === ${JSON.stringify(new URL(origin).origin)}) { var ok = typeof window.__splFitLaunch === 'function' && window.__splFitLaunch(${JSON.stringify(id)}); if (!ok && window.ReactNativeWebView) window.ReactNativeWebView.postMessage(JSON.stringify({ internal: 'fitLaunch', ok: false, origin: location.origin })); }true;`;
}
