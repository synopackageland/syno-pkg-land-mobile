import { useEffect, useRef, useState } from 'react';

/**
 * Pull to refresh, shared by the Android and browser controls. Distances are
 * in px of indicator travel, after damping. Release past `threshold` refreshes;
 * the indicator then rests at `rest` until the refresh ends.
 */
export const PULL = { threshold: 72, max: 160, rest: 64, size: 40, slop: 8, drag: 0.9 } as const;

/** Rubber-band damping: the indicator follows the finger at first, then ever more slowly up to `max` */
export function pullDistance(finger: number): number {
  if (!(finger > 0)) return 0;
  return PULL.max * (1 - 1 / (finger * PULL.drag / PULL.max + 1));
}

/** 0 → 1 as the indicator reaches the release threshold */
export const pullProgress = (distance: number) => Math.max(0, Math.min(1, distance / PULL.threshold));

/** What a touch move means for a pull: nothing yet, an indicator distance, or give the gesture back to scrolling */
export type PullStep = { kind: 'wait' } | { kind: 'pull'; distance: number; began: boolean } | { kind: 'scroll'; drawn: boolean };

/**
 * One touch's pull, from plain numbers so it behaves the same wherever it runs.
 * A pull starts only at the top of the list, after `slop` px of a move that is
 * more down than sideways. Moving back above the start hands the touch back
 * to scrolling. Releasing at or past the threshold refreshes.
 */
export class PullGesture {
  private touch?: { x: number; y: number; active: boolean; distance: number };
  /** `ready`: enabled, not refreshing, one finger, list at its top */
  start(x: number, y: number, ready: boolean) { this.touch = ready ? { x, y, active: false, distance: 0 } : undefined; }
  move(x: number, y: number, ready: boolean, atTop: boolean): PullStep {
    const t = this.touch;
    if (!t) return { kind: 'scroll', drawn: false };
    if (!ready) return this.drop();
    const dx = x - t.x, dy = y - t.y;
    let began = false;
    if (!t.active) {
      if (dy < 0 || Math.abs(dx) > Math.abs(dy) || !atTop) return this.drop();
      if (dy < PULL.slop) return { kind: 'wait' };
      t.active = began = true; t.y += PULL.slop;
    }
    const finger = y - t.y;
    if (finger <= 0 && !began) return this.drop();
    t.distance = pullDistance(finger);
    return { kind: 'pull', distance: t.distance, began };
  }
  /** `released`: the finger lifted (not a cancelled touch) */
  end(released: boolean, ready: boolean): 'refresh' | 'spring' | 'none' {
    const t = this.touch;
    this.touch = undefined;
    if (!t?.active) return 'none';
    return released && ready && t.distance >= PULL.threshold ? 'refresh' : 'spring';
  }
  private drop(): PullStep {
    const drawn = Boolean(this.touch?.active);
    this.touch = undefined;
    return { kind: 'scroll', drawn };
  }
}

/** How long a pull waits for the refresh it asked for to show up before it gives up its spinner */
export const PULL_START_WAIT = 1500;

/**
 * The refreshing flag of a pull control. Background refreshes stay quiet: the
 * spinner only answers a pull, and stays until that refresh (or one already
 * running) ends. Earlier data stays on screen meanwhile.
 */
export function usePulled({ busy, onRefresh }: { busy: boolean; onRefresh(): unknown }): { refreshing: boolean; start(): void } {
  const [pulled, setPulled] = useState(false);
  // Whether the refresh this pull waits for has been seen running
  const seen = useRef(false);
  useEffect(() => {
    if (!pulled) return;
    if (busy) { seen.current = true; return; }
    if (seen.current) { setPulled(false); return; }
    // Nothing started (a refresh that ended at once, or none needed): do not spin forever
    const timer = setTimeout(() => setPulled(false), PULL_START_WAIT);
    return () => clearTimeout(timer);
  }, [pulled, busy]);
  return {
    refreshing: pulled,
    start() {
      seen.current = busy;
      setPulled(true);
      try { void Promise.resolve(onRefresh()).catch(() => {}); } catch { /* The screen's own error state reports failures */ }
    },
  };
}
