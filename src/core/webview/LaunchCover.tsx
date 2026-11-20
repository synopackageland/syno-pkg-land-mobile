import { useEffect, useRef, useState, type ReactNode } from 'react';
import { AccessibilityInfo, Animated, Easing, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { COVER_FADE, type CoverPhase } from './cover';

export type LaunchCoverProps = {
  phase: CoverPhase;
  /** App name; the cover shows only the arc without it */
  title?: string;
  /** App icon slot inside the arc; a letter tile stands in when it is missing */
  icon?: ReactNode;
  /** App color for the arc and the letter tile */
  tint?: string;
  /** A failure message shows the cover at once with recovery actions */
  message?: string;
  labels: { loading: string; slow: string; reopen: string; back: string };
  onReopen(): void; onBack?: () => void; onFaded(): void;
};
const accent = '#1D6FE8';
export const ARC_PERIOD = 1100;
/**
 * In the browser, an App's same-origin frame runs its script on the launcher's own thread, and a
 * DSM page keeps that thread busy for seconds. The cover's motion is then plain CSS on transform and
 * opacity, which the compositor runs without that thread.
 */
const css = Platform.OS === 'web';
/**
 * react-native-web writes keyframes only for a StyleSheet style: an inline style drops
 * animationKeyframes, which left the arc standing still
 */
const motion = StyleSheet.create({
  spin: {
    animationKeyframes: [{ '0%': { transform: 'rotate(0deg)' }, '100%': { transform: 'rotate(360deg)' } }],
    animationDuration: `${ARC_PERIOD}ms`, animationIterationCount: 'infinite', animationTimingFunction: 'cubic-bezier(0.5, 0.15, 0.5, 0.85)', willChange: 'transform',
  } as object,
});

/** Follows the system "remove animations" setting */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    let live = true;
    AccessibilityInfo.isReduceMotionEnabled().then(value => { if (live) setReduced(value); }).catch(() => {});
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduced);
    return () => { live = false; sub.remove(); };
  }, []);
  return reduced;
}

/** An arc in the App color orbiting the icon; no track. Reduced motion keeps it still. */
export function Arc({ tint, size, spinning }: { tint: string; size: number; spinning: boolean }) {
  const turn = useRef(new Animated.Value(0)).current;
  // Every arc keeps one phase, so a cover that takes over from another does not jump
  const delay = useRef(-(Date.now() % ARC_PERIOD)).current;
  useEffect(() => {
    if (!spinning || css) { turn.setValue(0); return; }
    const loop = Animated.loop(Animated.timing(turn, { toValue: 1, duration: ARC_PERIOD, easing: Easing.bezier(0.5, 0.15, 0.5, 0.85), useNativeDriver: true }));
    loop.start();
    return () => loop.stop();
  }, [spinning, turn]);
  if (css) {
    return <View pointerEvents="none" style={[styles.arc, { width: size, height: size, borderRadius: size / 2, borderTopColor: tint, borderRightColor: tint }, spinning ? [motion.spin, { animationDelay: `${delay}ms` } as object] : null]} />;
  }
  const rotate = turn.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });
  return <Animated.View pointerEvents="none" style={[styles.arc, { width: size, height: size, borderRadius: size / 2, borderTopColor: tint, borderRightColor: tint, transform: [{ rotate }] }]} />;
}

/**
 * Centered launch state over a WebView that keeps loading underneath. Slow is a hint, never a
 * deadline: the App keeps opening and shows itself once drawn, so slow offers only Back. Reopen is
 * offered only when the page failed (a load or HTTP error)
 */
export function LaunchCover({ phase, title, icon, tint = accent, message, labels, onReopen, onBack, onFaded }: LaunchCoverProps) {
  const failed = Boolean(message);
  const visible = failed || phase === 'shown' || phase === 'slow';
  const reduced = useReducedMotion();
  const opacity = useRef(new Animated.Value(failed ? 1 : 0)).current;
  const faded = useRef(onFaded); faded.current = onFaded;
  useEffect(() => {
    // Shown at once: the page slides in with the cover already on it
    if (visible) opacity.setValue(1);
    else if (phase === 'leaving' && css) { const timer = setTimeout(() => faded.current(), COVER_FADE); return () => clearTimeout(timer); }
    else if (phase === 'leaving') Animated.timing(opacity, { toValue: 0, duration: COVER_FADE, useNativeDriver: true }).start(({ finished }) => { if (finished) faded.current(); });
    else opacity.setValue(0);
  }, [visible, failed, phase, opacity]);
  if (!visible && phase !== 'leaving') return null;
  const tile = icon ?? (title ? <View style={[styles.tile, { backgroundColor: `${tint}1F` }]}><Text style={[styles.letter, { color: tint }]}>{[...title][0]?.toUpperCase()}</Text></View> : null);
  const ring = tile ? 100 : 40;
  const fade = css ? { opacity: visible ? 1 : 0, transitionProperty: 'opacity', transitionDuration: `${COVER_FADE}ms` } as object : { opacity };
  return <Animated.View style={[styles.cover, fade]} pointerEvents={visible ? 'auto' : 'none'} accessibilityLiveRegion="polite">
    <View style={styles.center}>
      <View style={[styles.orbit, { width: ring, height: ring }]} accessibilityRole="progressbar" accessibilityLabel={failed ? undefined : labels.loading}>
        {failed ? null : <Arc tint={tint} size={ring} spinning={!reduced} />}
        {tile}
      </View>
      {title ? <Text style={styles.title} numberOfLines={2}>{title}</Text> : null}
      <View style={styles.footer}>
        {failed || phase === 'slow' ? <Text style={styles.status}>{failed ? message : labels.slow}</Text> : null}
        <View style={styles.actions}>
          {failed ? <Pressable onPress={onReopen} accessibilityRole="button" style={[styles.primary, { backgroundColor: tint }]}>
            <Text style={styles.primaryText}>{labels.reopen}</Text>
          </Pressable> : null}
          {(failed || phase === 'slow') && onBack ? <Pressable onPress={onBack} accessibilityRole="button" style={styles.quiet}><Text style={[styles.quietText, { color: tint }]}>{labels.back}</Text></Pressable> : null}
        </View>
      </View>
    </View>
  </Animated.View>;
}
const styles = StyleSheet.create({
  cover: { ...StyleSheet.absoluteFill, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center', padding: 32, zIndex: 3 },
  // The footer keeps its height so the icon never moves when the slow hint appears
  center: { alignItems: 'center', gap: 12, maxWidth: 320, width: '100%' },
  orbit: { alignItems: 'center', justifyContent: 'center' },
  arc: { position: 'absolute', top: 0, left: 0, borderWidth: 3, borderColor: 'transparent' },
  tile: { width: 72, height: 72, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  letter: { fontSize: 32, lineHeight: 38, fontWeight: '600' },
  title: { fontSize: 17, lineHeight: 22, fontWeight: '700', color: '#0F1419', textAlign: 'center' },
  footer: { minHeight: 96, alignItems: 'center', gap: 4 },
  status: { fontSize: 14, lineHeight: 20, color: '#536471', textAlign: 'center' },
  actions: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  primary: { minHeight: 44, borderRadius: 22, paddingHorizontal: 22, justifyContent: 'center' },
  primaryText: { fontSize: 15, fontWeight: '600', color: '#fff' },
  quiet: { minHeight: 44, paddingHorizontal: 12, justifyContent: 'center' },
  quietText: { fontSize: 15, fontWeight: '600' },
});
