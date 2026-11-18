import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { Animated, Easing, StyleSheet, View, useWindowDimensions } from 'react-native';
import { useReducedMotion } from '../../src/core/webview/LaunchCover';
import { colors } from './theme';

/** Push and pop slide time; "remove animations" switches pages at once */
export const SLIDE = 200;
export type Page = { key: string; node: ReactNode };

/** One pushed page: slides in from the right when it mounts, out to the right when it leaves */
function Slide({ children, leaving, animate, covered, onGone }: { children: ReactNode; leaving: boolean; animate: boolean; covered: boolean; onGone(): void }) {
  const { width } = useWindowDimensions();
  const x = useRef(new Animated.Value(animate && !leaving ? width : 0)).current;
  const gone = useRef(onGone); gone.current = onGone;
  // Fabric hit-tests the committed layout, not a native-driven transform: once in place, the page drops its transform
  const [settled, setSettled] = useState(!animate || leaving);
  useEffect(() => {
    if (animate && !leaving) Animated.timing(x, { toValue: 0, duration: SLIDE, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start(() => setSettled(true));
  }, [animate, x]);
  useEffect(() => {
    if (!leaving) return;
    if (!animate) { gone.current(); return; }
    Animated.timing(x, { toValue: width, duration: SLIDE, easing: Easing.in(Easing.cubic), useNativeDriver: true }).start(() => gone.current());
  }, [leaving, animate, width, x]);
  return <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: colors.background, transform: settled && !leaving ? [] : [{ translateX: x }] }]} pointerEvents={leaving ? 'none' : 'auto'}
    importantForAccessibility={covered || leaving ? 'no-hide-descendants' : 'auto'} accessibilityElementsHidden={covered || leaving}>
    {children}
  </Animated.View>;
}

/**
 * A tab's navigation stack: the root stays mounted (and keeps its scroll position)
 * under the pushed pages. A popped page stays on screen until it has slid away.
 */
export function Stack({ root, pages }: { root: ReactNode; pages: Page[] }) {
  const reduced = useReducedMotion();
  const [leaving, setLeaving] = useState<Page[]>([]);
  const previous = useRef<Page[]>(pages);
  const mounted = useRef(false);
  useLayoutEffect(() => {
    const keys = new Set(pages.map(page => page.key));
    const gone = previous.current.filter(page => !keys.has(page.key));
    previous.current = pages;
    if (gone.length && !reduced) setLeaving(list => [...list.filter(page => !keys.has(page.key)), ...gone]);
  }, [pages, reduced]);
  useEffect(() => { mounted.current = true; }, []);
  const top = pages.length - 1;
  return <View style={{ flex: 1 }}>
    <View style={{ flex: 1 }} importantForAccessibility={pages.length ? 'no-hide-descendants' : 'auto'} accessibilityElementsHidden={pages.length > 0}>{root}</View>
    {pages.map((page, index) => <Slide key={page.key} animate={mounted.current && !reduced} leaving={false} covered={index < top} onGone={() => {}}>{page.node}</Slide>)}
    {leaving.map(page => <Slide key={`leaving:${page.key}`} animate={!reduced} leaving covered={false} onGone={() => setLeaving(list => list.filter(item => item !== page))}>{page.node}</Slide>)}
  </View>;
}
