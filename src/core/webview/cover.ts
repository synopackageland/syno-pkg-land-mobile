/**
 * Launch cover timing: the cover shows on the first tick, since a DSM App never paints
 * sooner and a delay only adds a white page; a quiet slow hint, never a deadline
 */
export const COVER_DELAY = 0, COVER_SLOW = 8000, COVER_FADE = 220;
/** How long a loaded warm page may take to show the App it was asked for */
export const HOST_WAIT = 8000;
/** A fresh single-App page shows its App within this time after loading, or is shown as it is */
export const FIT_WAIT = 10000;
/**
 * pending: loading but not shown yet; shown/slow: centered cover; leaving: fading out; hidden: page visible.
 * Failures are shown at once from the shell's error message, whatever the phase.
 */
export type CoverPhase = 'pending' | 'shown' | 'slow' | 'leaving' | 'hidden';
export type CoverEvent = 'start' | 'delay' | 'slow' | 'ready' | 'faded';
export function cover(phase: CoverPhase, event: CoverEvent): CoverPhase {
  switch (event) {
    case 'start': return 'pending';
    case 'delay': return phase === 'pending' ? 'shown' : phase;
    case 'slow': return phase === 'shown' ? 'slow' : phase;
    case 'ready': return phase === 'pending' ? 'hidden' : phase === 'shown' || phase === 'slow' ? 'leaving' : phase;
    case 'faded': return phase === 'leaving' ? 'hidden' : phase;
  }
}

/**
 * Part of a frame covered by the keyboard. Both values are in window coordinates (dp);
 * `keyboardTop` is null while no keyboard is shown.
 */
export function keyboardOverlap(frameBottom: number, keyboardTop: number | null): number {
  if (keyboardTop === null || !Number.isFinite(keyboardTop) || !Number.isFinite(frameBottom)) return 0;
  return Math.max(0, Math.round(frameBottom - keyboardTop));
}
