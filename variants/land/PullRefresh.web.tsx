import { useEffect, useRef } from 'react';
import { View } from 'react-native';
import { colors } from './theme';
import { PULL, PullGesture, pullProgress, usePulled } from './pull';
import type { PullRefreshProps } from './PullRefresh';

const R = 9, C = 2 * Math.PI * R;
const ease = 'cubic-bezier(0.2, 0, 0, 1)';

/**
 * Browser pull to refresh. react-native-web's ScrollView renders its
 * `refreshControl` around itself with the scroller's style, so this wraps the
 * scroller: its first element child. Touch only, like the phone it imitates:
 * - a pull starts only from the very top of the list, after a small downward
 *   move that is more vertical than sideways; anything else scrolls as usual;
 * - the indicator follows the finger with rubber-band damping; releasing past
 *   the threshold refreshes, earlier releases spring back;
 * - while pulling, the page's own scrolling and the browser's pull-to-reload
 *   are held off (preventDefault on touchmove, overscroll-behavior on the
 *   scroller); a press under the finger is cancelled the way a scroll cancels it.
 * The indicator is a Material disc with an accent arc and no track. It is
 * drawn by writing styles directly, without a React render per touch move.
 */
export function PullRefresh({ busy, onRefresh, offset = 0, enabled = true, style, children }: PullRefreshProps) {
  const pull = usePulled({ busy, onRefresh });
  const host = useRef<HTMLElement | null>(null), mark = useRef<HTMLDivElement | null>(null);
  const turn = useRef<SVGSVGElement | null>(null), arc = useRef<SVGCircleElement | null>(null);
  const spin = useRef<Animation | null>(null);
  const live = useRef({ enabled, refreshing: pull.refreshing, start: pull.start });
  live.current = { enabled: enabled !== false, refreshing: pull.refreshing, start: pull.start };

  const draw = (distance: number, settle: boolean, length = C * (0.06 + 0.66 * pullProgress(distance))) => {
    const m = mark.current, a = arc.current, s = turn.current;
    if (!m || !a || !s) return;
    m.style.transition = settle ? `transform 220ms ${ease}, opacity 220ms ${ease}` : 'none';
    m.style.transform = `translateY(${distance}px)`;
    m.style.opacity = String(Math.min(1, distance / PULL.size));
    a.style.strokeDasharray = `${length} ${C}`;
    a.style.opacity = pullProgress(distance) >= 1 || live.current.refreshing ? '1' : '0.5';
    s.style.transform = `rotate(${pullProgress(distance) * 270}deg)`;
  };

  useEffect(() => {
    const node = host.current;
    if (!node) return;
    const scroller = () => node.firstElementChild as HTMLElement | null;
    const first = scroller();
    // The browser's own pull-to-reload and bounce never start from this list
    if (first) first.style.overscrollBehaviorY = 'contain';
    const gesture = new PullGesture();
    const ready = () => live.current.enabled && !live.current.refreshing;
    const atTop = () => (scroller()?.scrollTop ?? 1) <= 0;
    const start = (e: TouchEvent) => gesture.start(e.touches[0]?.clientX ?? 0, e.touches[0]?.clientY ?? 0, ready() && e.touches.length === 1 && atTop());
    const move = (e: TouchEvent) => {
      const step = gesture.move(e.touches[0]?.clientX ?? 0, e.touches[0]?.clientY ?? 0, ready() && e.touches.length === 1, atTop());
      if (step.kind === 'scroll') { if (step.drawn) draw(0, true); return; }
      // Still deciding, or pulling: the list itself must not move
      if (e.cancelable) e.preventDefault();
      if (step.kind === 'wait') return;
      // As a native scroll does: the press or long press under the finger ends here
      if (step.began) scroller()?.dispatchEvent(new Event('scroll'));
      draw(step.distance, false);
    };
    const end = (e: TouchEvent) => {
      const result = gesture.end(e.type === 'touchend', ready());
      if (result === 'refresh') live.current.start();
      else if (result === 'spring') draw(0, true);
    };
    node.addEventListener('touchstart', start, { passive: true });
    node.addEventListener('touchmove', move, { passive: false });
    node.addEventListener('touchend', end);
    node.addEventListener('touchcancel', end);
    return () => {
      node.removeEventListener('touchstart', start);
      node.removeEventListener('touchmove', move);
      node.removeEventListener('touchend', end);
      node.removeEventListener('touchcancel', end);
    };
  }, []);

  // Refreshing: rest below the bar and spin; done: shrink away, then reset out of sight
  useEffect(() => {
    const m = mark.current, s = turn.current;
    if (!m || !s) return;
    if (pull.refreshing) {
      draw(PULL.rest, true, C * 0.72);
      if (!spin.current && typeof s.animate === 'function') {
        const slow = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
        spin.current = s.animate([{ transform: 'rotate(0deg)' }, { transform: 'rotate(360deg)' }], { duration: slow ? 2400 : 900, iterations: Infinity });
      }
      return;
    }
    if (!spin.current) return;
    m.style.transition = `transform 200ms ${ease}, opacity 200ms ${ease}`;
    m.style.transform = `translateY(${PULL.rest}px) scale(0)`;
    m.style.opacity = '0';
    const timer = setTimeout(() => { spin.current?.cancel(); spin.current = null; draw(0, false); }, 220);
    return () => clearTimeout(timer);
  }, [pull.refreshing]);

  useEffect(() => () => spin.current?.cancel(), []);

  return <View ref={host as never} style={[style, { position: 'relative', overflow: 'hidden' }]} aria-busy={pull.refreshing}>
    {children}
    <div ref={mark} aria-hidden="true" style={{
      position: 'absolute', top: offset - PULL.size, left: '50%', marginLeft: -PULL.size / 2, width: PULL.size, height: PULL.size, borderRadius: PULL.size / 2,
      backgroundColor: colors.background, boxShadow: '0 1px 3px rgba(15, 20, 25, 0.2), 0 2px 8px rgba(15, 20, 25, 0.12)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', opacity: 0, pointerEvents: 'none', zIndex: 1, willChange: 'transform, opacity',
    }}>
      <svg ref={turn} width={24} height={24} viewBox="0 0 24 24" style={{ display: 'block' }}>
        <circle ref={arc} cx={12} cy={12} r={R} fill="none" stroke={colors.accent} strokeWidth={2.5} strokeLinecap="round" transform="rotate(-90 12 12)" style={{ strokeDasharray: `0 ${C}` }} />
      </svg>
    </div>
  </View>;
}
