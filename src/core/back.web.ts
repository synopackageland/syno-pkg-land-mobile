/**
 * The browser's back runs the same handlers as Android's back button, through real history
 * entries: see web-history.ts. Screens add their steps with useBackDepth; a sheet adds one with
 * useBackStep. Back with no step left leaves the page, as on Android.
 */
import { useEffect, useRef } from 'react';
import { WebHistory, ownEntryBack, type BackHandlerFn, type Navigation } from './web-history';

const KEY = 'spl:history';
const reloaded = () => { try { return (performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined)?.type === 'reload'; } catch { return false; } };

function create(): WebHistory {
  if (typeof window === 'undefined') return new WebHistory({ state: () => null, push() {}, replace() {}, back() {}, load: () => null, save() {}, reloaded: false, later() {} });
  let settle = 0;
  const sync = new WebHistory({
    state: () => history.state,
    push: state => history.pushState(state, ''),
    replace: state => history.replaceState(state, ''),
    back(steps) {
      const nav = (window as unknown as { navigation?: Navigation }).navigation;
      const target = ownEntryBack(nav, steps);
      if (target) nav!.traverseTo(target.key).finished.catch(() => {}); else history.go(-steps);
      clearTimeout(settle);
      settle = window.setTimeout(() => sync.settle(history.state), 1500);
    },
    load: () => { try { return sessionStorage.getItem(KEY); } catch { return null; } },
    save: value => { try { sessionStorage.setItem(KEY, value); } catch { /* Private mode */ } },
    reloaded: reloaded(),
    later: run => { window.setTimeout(run, 0); },
  });
  window.addEventListener('popstate', event => { clearTimeout(settle); sync.moved(event.state); });
  return sync;
}
const shared = create();

export const BackHandler = {
  addEventListener(_event: 'hardwareBackPress', handler: BackHandlerFn) {
    return { remove: shared.addHandler(handler) };
  },
  /** Leaving the App: the page before this one */
  exitApp() { history.back(); },
};
/** This screen holds `depth` steps back while mounted */
export function useBackDepth(depth: number): void {
  const owner = useRef({}).current;
  useEffect(() => { shared.setDepth(owner, depth); }, [owner, depth]);
  useEffect(() => () => shared.setDepth(owner, 0), [owner]);
}
/** A sheet or dialog: one step back while open, and back closes it */
export function useBackStep(open: boolean, close: () => void): void {
  const latest = useRef(close); latest.current = close;
  useBackDepth(open ? 1 : 0);
  useEffect(() => {
    if (!open) return;
    return shared.addHandler(() => { latest.current(); return true; });
  }, [open]);
}
/** The screen to show again after a reload; written with useBackScreen */
export const restoredScreen = (): unknown => shared.restored;
export function useBackScreen(screen: unknown): void {
  const text = JSON.stringify(screen ?? null);
  useEffect(() => { shared.setScreen(JSON.parse(text)); }, [text]);
}
