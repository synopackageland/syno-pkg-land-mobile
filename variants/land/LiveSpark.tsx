import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Animated, Easing, View } from 'react-native';
import { chartPoints, LIVE, liveWindow, scaleOf, type LivePoint } from '../../src/core/status/live';
import { useReducedMotion } from './motion';

export type LiveSparkProps = {
  /** The gap-free line (live.ts continuous) */
  points: LivePoint[];
  color: string;
  /** Top of the scale; without it the scale follows the visible values */
  max?: number;
  height?: number;
  thickness?: number;
  /** Time the chart shows, ms */
  span?: number;
};
/** How far past the right edge the line is drawn, so it can glide for that long */
const LEAD = LIVE.period * 2;

/**
 * Android: no SVG module in the App, so the line is thin rotated Views whose
 * rounded ends overlap into one unbroken stroke, drawn once per sample (and
 * once per period while no sample comes). Between those, one native-driver
 * Animated translation scrolls it at the chart's time rate; each redraw
 * moves the window by exactly the distance scrolled, so the motion is
 * continuous. Reduced motion: no scrolling, the window ends at the newest sample.
 */
export function LiveSpark({ points, color, max, height = 28, thickness = 1.5, span = LIVE.span }: LiveSparkProps) {
  const reduced = useReducedMotion();
  const [width, setWidth] = useState(0);
  const [anchor, setAnchor] = useState(() => Date.now());
  const shift = useRef(new Animated.Value(0)).current;
  const newest = points[points.length - 1]?.t;
  // A new sample, or a period without one, redraws the window at the current time
  useEffect(() => { setAnchor(Date.now()); }, [newest, points.length]);
  useEffect(() => {
    if (reduced) return;
    const timer = setInterval(() => setAnchor(Date.now()), LIVE.period);
    return () => clearInterval(timer);
  }, [reduced]);
  const lead = reduced ? 0 : LEAD;
  const full = width * (span + lead) / span;
  useEffect(() => {
    shift.setValue(0);
    if (reduced || !width) return;
    const run = Animated.timing(shift, { toValue: -width * lead / span, duration: lead, easing: Easing.linear, useNativeDriver: true });
    run.start();
    return () => run.stop();
  }, [anchor, width, reduced, lead, span, shift]);
  const view = liveWindow(anchor, newest, reduced, span);
  const corners = chartPoints(points, view.from, view.to + lead, { width: full, height, thickness, max: max ?? scaleOf(points, view.from) });
  const segments: ReactNode[] = [];
  for (let i = 1; i < corners.length; i++) {
    const a = corners[i - 1], b = corners[i];
    const length = Math.hypot(b.x - a.x, b.y - a.y);
    if (length < 0.1) continue;
    const angle = Math.atan2(b.y - a.y, b.x - a.x), reach = length + thickness;
    segments.push(<View key={i} style={{ position: 'absolute', left: (a.x + b.x) / 2 - reach / 2, top: (a.y + b.y) / 2 - thickness / 2, width: reach, height: thickness, borderRadius: thickness / 2, backgroundColor: color, transform: [{ rotate: `${angle}rad` }] }} />);
  }
  return <View style={{ height, alignSelf: 'stretch', overflow: 'hidden' }} onLayout={event => setWidth(event.nativeEvent.layout.width)} importantForAccessibility="no-hide-descendants">
    {width > 0 ? <Animated.View style={{ position: 'absolute', top: 0, left: 0, width: full, height, transform: [{ translateX: shift }] }}>{segments}</Animated.View> : null}
  </View>;
}
