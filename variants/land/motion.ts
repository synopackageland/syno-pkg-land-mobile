import { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo } from 'react-native';
import { CALM, calmMoves, calmText, calmValue, type Readout } from '../../src/core/status/calm';

/** The system "reduce motion" setting; prefers-reduced-motion in the browser */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    let mounted = true;
    AccessibilityInfo.isReduceMotionEnabled?.().then(value => { if (mounted) setReduced(Boolean(value)); }).catch(() => {});
    const sub = AccessibilityInfo.addEventListener?.('reduceMotionChanged', value => setReduced(Boolean(value)));
    return () => { mounted = false; sub?.remove(); };
  }, []);
  return reduced;
}

/**
 * The text of a live number (`readouts` in core/status/calm): it counts to
 * each new value in a few round steps with one requestAnimationFrame loop
 * that stops when it lands, and only when the value really changed. The
 * first value, a unit change, a small change and every change under reduced
 * motion show at once.
 */
export function useReadout(value: number | undefined, readout: Readout, duration: number = CALM.duration): string {
  const reduced = useReducedMotion();
  const [text, setText] = useState(() => readout.text(value));
  const current = useRef(value);
  useEffect(() => {
    const from = current.current;
    if (!calmMoves(from, value, readout, reduced)) { current.current = value; setText(readout.text(value)); return; }
    const start = Date.now();
    let frame = 0;
    const step = () => {
      const elapsed = Date.now() - start;
      current.current = calmValue(from!, value!, elapsed, duration);
      setText(calmText(from, value, readout, elapsed, duration));
      if (elapsed < duration) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [value, readout, duration, reduced]);
  return text;
}
