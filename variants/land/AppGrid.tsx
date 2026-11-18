import { useLayoutEffect, useMemo, useRef, useState, type ComponentRef } from 'react';
import { Animated, PanResponder, Text, View, useWindowDimensions, type GestureResponderEvent, type PanResponderGestureState } from 'react-native';
import Native from '../../modules/webview-cookies';
import type { DiscoveredApp } from '../../src/core/discovery/schema';
import { fill, strings } from '../../src/core/i18n/strings';
import { AppIcon } from './AppIcon';
import { Icon } from './ui';
import { colors, radius, spacing, type } from './theme';

/** Fixed tile height keeps slot positions computable while dragging */
export const TILE_HEIGHT = 84;
const LONG_PRESS = 380, SLOP = 8, EDGE = 72;
export type Scroller = { autoScroll(delta: number): number };
type Props = {
  apps: DiscoveredApp[]; columns: number; profile?: string;
  onOpen(app: DiscoveredApp): void; onPressIn(): void; onPressOut(): void;
  /** Absent while searching: results mix sections, so they cannot be arranged */
  onReorder?: (from: number, to: number) => void;
  onDragging?: (dragging: boolean) => void;
  scroller?: Scroller;
  /** Search results mix mobile and desktop Apps: only then do desktop Apps carry a badge */
  mixed?: boolean;
};
type Drag = { index: number; target: number; scroll: number; lastX: number; lastY: number };

/**
 * One section of the launcher grid. Tap opens; long-press lifts the App with a
 * haptic, then dragging moves it within the section while its neighbors move
 * aside, like a home screen. A single responder hit-tests by position, so tiles
 * that are still animating can never take the wrong tap.
 */
export function AppGrid({ apps, columns, profile, onOpen, onPressIn, onPressOut, onReorder, onDragging, scroller, mixed }: Props) {
  const t = strings();
  const { height: windowHeight } = useWindowDimensions();
  const view = useRef<ComponentRef<typeof View>>(null);
  const [width, setWidth] = useState(0);
  const [pressed, setPressed] = useState<string>();
  const [lifted, setLifted] = useState<string>();
  const offsets = useRef(new Map<string, Animated.ValueXY>()).current;
  const scale = useRef(new Animated.Value(1)).current;
  const ids = apps.map(app => app.id).join('\n');
  const offset = (id: string) => { let value = offsets.get(id); if (!value) offsets.set(id, value = new Animated.ValueXY()); return value; };
  // A new order is committed by the parent; slots move, so animation offsets return to zero before paint
  useLayoutEffect(() => { offsets.forEach(value => value.setValue({ x: 0, y: 0 })); }, [ids, offsets]);
  const cell = width / columns;
  const slot = (index: number) => ({ x: (index % columns) * cell, y: Math.floor(index / columns) * TILE_HEIGHT });
  const live = useRef({ apps, onOpen, onPressIn, onPressOut, onReorder, onDragging, scroller, cell, columns, windowHeight });
  live.current = { apps, onOpen, onPressIn, onPressOut, onReorder, onDragging, scroller, cell, columns, windowHeight };

  const responder = useMemo(() => {
    let origin = { x: 0, y: 0 }, start = -1, moved = false, timer: ReturnType<typeof setTimeout> | undefined;
    // The touch's tile is known once the grid's position is measured, which can come after the finger
    // lifts: the browser runs the input event before the measuring timer when the page is busy, and a
    // synthetic tap ends at once. Such a tap opens its App when the measurement arrives
    let touch = 0, released = false, tapPending = false;
    let drag: Drag | undefined, frame: number | undefined;
    const indexAt = (x: number, y: number) => {
      const { apps, cell, columns } = live.current;
      if (cell <= 0) return -1;
      const col = Math.min(columns - 1, Math.max(0, Math.floor(x / cell))), row = Math.max(0, Math.floor(y / TILE_HEIGHT));
      return Math.min(apps.length - 1, row * columns + col);
    };
    const layoutDrag = () => {
      if (!drag) return;
      const { apps, cell, columns } = live.current;
      const order = apps.map((_, i) => i);
      order.splice(drag.target, 0, order.splice(drag.index, 1)[0]);
      order.forEach((original, position) => {
        if (original === drag!.index) return;
        const from = { x: (original % columns) * cell, y: Math.floor(original / columns) * TILE_HEIGHT };
        const to = { x: (position % columns) * cell, y: Math.floor(position / columns) * TILE_HEIGHT };
        Animated.spring(offset(apps[original].id), { toValue: { x: to.x - from.x, y: to.y - from.y }, useNativeDriver: true, speed: 22, bounciness: 4 }).start();
      });
    };
    const follow = (pageX: number, pageY: number) => {
      if (!drag) return;
      const { apps, cell, columns } = live.current;
      const home = { x: (drag.index % columns) * cell, y: Math.floor(drag.index / columns) * TILE_HEIGHT };
      const x = pageX - origin.x, y = pageY - origin.y + drag.scroll;
      offset(apps[drag.index].id).setValue({ x: x - home.x - cell / 2, y: y - home.y - TILE_HEIGHT / 2 });
      const target = indexAt(x, y);
      if (target >= 0 && target !== drag.target) { drag.target = target; Native.haptic('tick'); layoutDrag(); }
    };
    // Near the top or bottom edge the list scrolls under the lifted App
    const autoScroll = () => {
      frame = undefined;
      if (!drag || !live.current.scroller) return;
      const { windowHeight } = live.current;
      const delta = drag.lastY < EDGE * 2 ? -10 : drag.lastY > windowHeight - EDGE * 2 ? 10 : 0;
      if (delta) {
        const moved = live.current.scroller.autoScroll(delta);
        if (moved) { drag.scroll += moved; follow(drag.lastX, drag.lastY); }
      }
      frame = requestAnimationFrame(autoScroll);
    };
    const end = (commit: boolean) => {
      clearTimeout(timer); timer = undefined;
      if (frame !== undefined) cancelAnimationFrame(frame); frame = undefined;
      const finished = drag; drag = undefined;
      setPressed(undefined); setLifted(undefined);
      Animated.spring(scale, { toValue: 1, useNativeDriver: true }).start();
      if (finished) {
        live.current.onDragging?.(false);
        if (commit && finished.target !== finished.index) { Native.haptic('confirm'); live.current.onReorder?.(finished.index, finished.target); }
        else offsets.forEach(value => Animated.spring(value, { toValue: { x: 0, y: 0 }, useNativeDriver: true }).start());
      }
      live.current.onPressOut();
    };
    return PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      // Scrolling stays native until an App is lifted
      onShouldBlockNativeResponder: () => false,
      onPanResponderTerminationRequest: () => !drag,
      onPanResponderGrant: (event: GestureResponderEvent) => {
        const { pageX, pageY } = event.nativeEvent;
        const id = ++touch;
        moved = false; start = -1; released = false; tapPending = false;
        live.current.onPressIn();
        view.current?.measureInWindow((x, y) => {
          if (id !== touch) return;
          origin = { x, y };
          start = indexAt(pageX - x, pageY - y);
          if (start < 0) return;
          if (!released) { if (!moved) setPressed(live.current.apps[start].id); return; }
          const app = tapPending ? live.current.apps[start] : undefined;
          tapPending = false;
          if (app) live.current.onOpen(app);
        });
        timer = setTimeout(() => {
          timer = undefined;
          if (moved || start < 0 || !live.current.onReorder) return;
          drag = { index: start, target: start, scroll: 0, lastX: pageX, lastY: pageY };
          Native.haptic('long');
          setLifted(live.current.apps[start].id); setPressed(undefined);
          live.current.onDragging?.(true);
          Animated.spring(scale, { toValue: 1.12, useNativeDriver: true, speed: 30 }).start();
          follow(pageX, pageY);
          frame = requestAnimationFrame(autoScroll);
        }, LONG_PRESS);
      },
      onPanResponderMove: (event: GestureResponderEvent, gesture: PanResponderGestureState) => {
        if (drag) { drag.lastX = event.nativeEvent.pageX; drag.lastY = event.nativeEvent.pageY; follow(drag.lastX, drag.lastY); return; }
        if (!moved && Math.hypot(gesture.dx, gesture.dy) > SLOP) { moved = true; clearTimeout(timer); timer = undefined; setPressed(undefined); }
      },
      onPanResponderRelease: () => {
        const tap = !drag && !moved && timer !== undefined;
        const app = tap && start >= 0 ? live.current.apps[start] : undefined;
        released = true; tapPending = tap && start < 0;
        end(true);
        if (app) live.current.onOpen(app);
      },
      onPanResponderTerminate: () => { released = true; tapPending = false; end(false); },
    });
  }, [offsets, scale]);

  const rows = Math.ceil(apps.length / columns);
  return <View ref={view} onLayout={event => setWidth(event.nativeEvent.layout.width)} style={{ height: rows * TILE_HEIGHT }} {...responder.panHandlers}>
    {width ? apps.map((app, index) => {
      const at = slot(index), value = offset(app.id), up = lifted === app.id;
      return <Animated.View key={app.id} accessible accessibilityRole="button" accessibilityLabel={fill(t.openApp, { name: app.name })} accessibilityHint={app.registered ? undefined : t.desktopBadge}
        accessibilityActions={[{ name: 'activate' }]} onAccessibilityAction={event => { if (event.nativeEvent.actionName === 'activate') onOpen(app); }}
        style={{ position: 'absolute', left: at.x, top: at.y, width: cell, height: TILE_HEIGHT, zIndex: up ? 2 : 1, elevation: up ? 6 : 0,
          transform: [{ translateX: value.x }, { translateY: value.y }, { scale: up ? scale : 1 }] }}>
        <View style={{ flex: 1, alignItems: 'center', paddingTop: spacing.sm, paddingHorizontal: spacing.xxs, gap: spacing.xs, borderRadius: radius.md, backgroundColor: pressed === app.id ? colors.pressed : 'transparent' }}>
          <View style={up ? { borderRadius: radius.md, boxShadow: '0 6px 14px rgba(15,20,25,0.25)' } : undefined}>
            <AppIcon app={app} profile={profile} />
            {mixed && !app.registered ? <View style={{ position: 'absolute', right: -4, bottom: -4, width: 18, height: 18, borderRadius: 9, backgroundColor: colors.background, alignItems: 'center', justifyContent: 'center', boxShadow: '0 1px 2px rgba(0,0,0,0.15)' }}>
              <Icon name="desktop-windows" size={11} color={colors.secondary} />
            </View> : null}
          </View>
          <Text style={[type.caption, { color: colors.label, textAlign: 'center', opacity: up ? 0 : 1 }]} numberOfLines={1}>{app.name}</Text>
        </View>
      </Animated.View>;
    }) : null}
  </View>;
}
