import { useEffect, useRef, useState } from 'react';
import { View } from 'react-native';
import { chartPoints, easeIn, LIVE, liveWindow, pathOf, scaleOf } from '../../src/core/status/live';
import type { LiveSparkProps } from './LiveSpark';
import { useReducedMotion } from './motion';

/**
 * Browser: one SVG path. A requestAnimationFrame loop moves the time window
 * and writes the path's `d` directly, without a React render; the browser
 * pauses the loop while the tab is hidden. The newest point eases in.
 * Reduced motion: no loop, the path is drawn once per sample and ends at it.
 */
export function LiveSpark({ points, color, max, height = 28, thickness = 1.5, span = LIVE.span }: LiveSparkProps) {
  const reduced = useReducedMotion();
  const [width, setWidth] = useState(0);
  const path = useRef<SVGPathElement | null>(null);
  const newest = points[points.length - 1]?.t;
  const latest = useRef({ points, max, newest, arrived: 0 });
  // A new newest sample restarts its ease-in; cached samples shown first do not ease
  if (latest.current.points !== points || latest.current.max !== max) {
    const arrived = latest.current.newest === newest ? latest.current.arrived : latest.current.newest === undefined ? 0 : Date.now();
    latest.current = { points, max, newest, arrived };
  }
  useEffect(() => {
    if (!width) return;
    let frame = 0;
    const draw = () => {
      const { points, max, newest, arrived } = latest.current, now = Date.now();
      const line = easeIn(points, arrived, now, LIVE.ease, reduced);
      const view = liveWindow(now, newest, reduced, span);
      const corners = chartPoints(line, view.from, view.to, { width, height, thickness, max: max ?? scaleOf(line, view.from) });
      path.current?.setAttribute('d', pathOf(corners));
      if (!reduced) frame = requestAnimationFrame(draw);
    };
    draw();
    return () => cancelAnimationFrame(frame);
  }, [width, height, thickness, span, reduced, reduced ? points : undefined]);
  return <View style={{ height, alignSelf: 'stretch' }} onLayout={event => setWidth(event.nativeEvent.layout.width)} importantForAccessibility="no-hide-descendants">
    {width > 0 ? <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} style={{ display: 'block', overflow: 'visible' }} aria-hidden="true">
      <path ref={path} fill="none" stroke={color} strokeWidth={thickness} strokeLinecap="round" strokeLinejoin="round" />
    </svg> : null}
  </View>;
}
