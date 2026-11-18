import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ComponentRef, type ReactNode, type RefObject } from 'react';
import { ActivityIndicator, Animated, LayoutAnimation, Modal, PanResponder, Platform, Pressable, StyleSheet, Text, View, type NativeScrollEvent, type NativeSyntheticEvent, type StyleProp, type ViewProps, type ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { BlurTargetView, BlurView } from 'expo-blur';
import { colors, layout, radius, spacing, type } from './theme';
import { backArrowStrokes, type BackArrow } from '../../src/core/icons/back-arrow';
import backArrow from '../../src/core/icons/back-arrow.json';
import { useBackStep } from '../../src/core/back';

export type IconName = React.ComponentProps<typeof MaterialIcons>['name'];
export function Icon({ name, size = 22, color = colors.label }: { name: IconName; size?: number; color?: string }) {
  return <MaterialIcons name={name} size={size} color={color} accessibilityElementsHidden importantForAccessibility="no" />;
}

/** Content that scrolls under the bars. Android blurs only a BlurTargetView, and a bar must sit outside its target */
export type BlurTarget = RefObject<ComponentRef<typeof View> | null>;
export const useBlurTarget = () => useRef<ComponentRef<typeof View>>(null);
const androidBlur = Platform.OS === 'android' && Number(Platform.Version) >= 31;
export function BarContent({ target, background = colors.background, children }: { target: BlurTarget; background?: string; children: ReactNode }) {
  // The target must paint its own background: transparent areas blur to grey
  const style = { flex: 1, backgroundColor: background };
  return androidBlur ? <BlurTargetView ref={target} style={style}>{children}</BlurTargetView> : <View style={style}>{children}</View>;
}
/** Translucent bar material: system blur on iOS, RenderNode blur on Android 12+, else a 94% solid surface */
function BarSurface({ target, style, children, ...props }: { target?: BlurTarget; style: StyleProp<ViewStyle>; children: ReactNode } & Omit<ViewProps, 'style' | 'children'>) {
  if (Platform.OS === 'ios') return <BlurView tint="systemChromeMaterialLight" intensity={100} style={style} {...props}>{children}</BlurView>;
  // White wash at 0.75 × intensity over a radius of intensity / 4
  if (androidBlur && target) return <BlurView blurMethod="dimezisBlurViewSdk31Plus" blurTarget={target} tint="systemChromeMaterial" intensity={90} style={style} {...props}>{children}</BlurView>;
  return <View style={[style, { backgroundColor: colors.bar }]} {...props}>{children}</View>;
}

/**
 * Top bar that slides away on downward scroll and returns on upward scroll.
 * Visibility is React state animated by LayoutAnimation: Fabric hit-tests the
 * committed layout, and Animated transforms are not committed, so a bar moved by
 * Animated would keep taking (or losing) taps at its old position.
 */
export function useCollapsingBar() {
  const [hidden, setHidden] = useState(false);
  const last = useRef(0);
  const onScroll = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const y = event.nativeEvent.contentOffset.y, delta = y - last.current;
    last.current = y;
    const next = y <= layout.topBar ? false : delta > 8 ? true : delta < -8 ? false : undefined;
    if (next === undefined) return;
    setHidden(current => {
      if (current !== next) LayoutAnimation.configureNext(LayoutAnimation.create(160, 'easeInEaseOut', 'opacity'));
      return next;
    });
  }, []);
  return { hidden, onScroll };
}

/** `fill` lets the title take the whole width between left and right, as a search field does */
export function TopBar({ left, title, right, hidden, collapsible = hidden !== undefined, onTitlePress, titleLabel, blurTarget, fill }: { left?: ReactNode; title?: ReactNode; right?: ReactNode; hidden?: boolean; collapsible?: boolean; onTitlePress?: () => void; titleLabel?: string; blurTarget?: BlurTarget; fill?: boolean }) {
  const insets = useSafeAreaInsets();
  const heading = typeof title === 'string' ? <Text style={[type.title, { flexShrink: 1 }]} numberOfLines={1} accessibilityRole="header">{title}</Text> : title;
  return <>
    <BarSurface target={blurTarget} style={{ position: 'absolute', top: hidden ? -layout.topBar - 1 : 0, left: 0, right: 0, zIndex: 10, paddingTop: insets.top, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.barBorder }} importantForAccessibility={hidden ? 'no-hide-descendants' : 'auto'}>
      <View style={{ height: layout.topBar, flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.xs, gap: spacing.xs }}>
        {left ?? <View style={{ width: spacing.md }} />}
        {onTitlePress ? <Pressable onPress={onTitlePress} accessibilityRole="button" accessibilityLabel={titleLabel} style={{ flexShrink: 1, minHeight: layout.hit, justifyContent: 'center' }}>{heading}</Pressable> : <View style={{ flexShrink: 1, flexGrow: 1, flexDirection: fill ? 'row' : 'column' }}>{heading}</View>}
        {fill ? null : <View style={{ flexGrow: 1 }} />}
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>{right}</View>
      </View>
    </BarSurface>
    {/* The status bar strip stays put; a hidden bar slides behind it */}
    {collapsible ? <View pointerEvents="none" style={{ position: 'absolute', top: 0, left: 0, right: 0, height: insets.top, zIndex: 11, backgroundColor: colors.background }} /> : null}
  </>;
}
/** True inside a tab's stack: the tab bar stays on screen over pushed pages too */
export const TabBarShown = createContext(false);
/** `bottom` always clears a tab bar; `rawBottom` clears one only where the tab bar is shown */
export function useBarInsets() {
  const insets = useSafeAreaInsets();
  const tabs = useContext(TabBarShown);
  return { top: insets.top + layout.topBar, bottom: insets.bottom + layout.tabBar, rawBottom: insets.bottom + (tabs ? layout.tabBar : 0) };
}

/** `arrow-back` draws the shared back arrow (the UI kit's), so every Back in the App looks the same */
export function IconButton({ icon, label, onPress, color = colors.label, disabled }: { icon: IconName; label: string; onPress(): void; color?: string; disabled?: boolean }) {
  return <Pressable onPress={onPress} disabled={disabled} accessibilityRole="button" accessibilityLabel={label} hitSlop={4}
    style={({ pressed }) => ({ width: layout.hit, height: layout.hit, alignItems: 'center', justifyContent: 'center', borderRadius: radius.full, backgroundColor: pressed ? colors.pressed : 'transparent', opacity: disabled ? 0.4 : 1 })}>
    {icon === 'arrow-back' ? <BackGlyph color={color} /> : <Icon name={icon} color={color} />}
  </Pressable>;
}
/** The shared back arrow at `size` px, drawn from its stroke geometry (no SVG renderer in this App) */
export function BackGlyph({ size = 24, color = colors.label, arrow = backArrow }: { size?: number; color?: string; arrow?: BackArrow }) {
  return <View style={{ width: size, height: size }} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
    {backArrowStrokes(size, arrow).map((box, index) => <View key={index} style={{ position: 'absolute', left: box.left, top: box.top, width: box.width, height: box.height, borderRadius: box.radius, backgroundColor: color, transform: [{ rotate: `${box.rotate}deg` }] }} />)}
  </View>;
}

/** Unread count for a badge; "30+" when DSM holds older notifications that may be unread too */
export function badgeText(unread: number, more = false) {
  return unread > 99 ? '99+' : more ? `${unread}+` : String(unread);
}
/** `badge` is a dot; `count` a number badge, which wins over the dot */
export type Tab = { key: string; icon: IconName; activeIcon?: IconName; label: string; badge?: boolean; count?: string };
/** Icon-only tabs. Pressing the selected tab again calls `onChange` with the same key, which returns that tab to its top */
export function TabBar({ tabs, active, onChange, blurTarget }: { tabs: Tab[]; active: string; onChange(key: string): void; blurTarget?: BlurTarget }) {
  const insets = useSafeAreaInsets();
  return <BarSurface target={blurTarget} style={{ position: 'absolute', left: 0, right: 0, bottom: 0, zIndex: 10, paddingBottom: insets.bottom, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.barBorder, flexDirection: 'row' }} accessibilityRole="tablist">
    {tabs.map(tab => {
      const selected = tab.key === active;
      return <Pressable key={tab.key} onPress={() => onChange(tab.key)} accessibilityRole="tab" accessibilityLabel={tab.count ? `${tab.label}, ${tab.count}` : tab.label} accessibilityState={{ selected }}
        style={({ pressed }) => ({ flex: 1, height: layout.tabBar, alignItems: 'center', justifyContent: 'center', opacity: pressed ? 0.6 : 1 })}>
        <Icon name={selected ? tab.activeIcon ?? tab.icon : tab.icon} size={24} color={selected ? colors.label : colors.tertiary} />
        {tab.count ? <View style={{ position: 'absolute', top: 8, left: '50%', marginLeft: 6, minWidth: 16, height: 16, paddingHorizontal: 4, borderRadius: 8, backgroundColor: colors.danger, alignItems: 'center', justifyContent: 'center' }}>
          <Text style={{ color: colors.onAccent, fontSize: 10, lineHeight: 12, fontWeight: '700' }}>{tab.count}</Text>
        </View> : tab.badge ? <View style={{ position: 'absolute', top: 12, marginLeft: 22, width: 8, height: 8, borderRadius: 4, backgroundColor: colors.accent }} /> : null}
      </Pressable>;
    })}
  </BarSurface>;
}

export function TextButton({ title, onPress, icon, tone = 'accent', disabled, align = 'center' }: { title: string; onPress(): void; icon?: IconName; tone?: 'accent' | 'neutral'; disabled?: boolean; align?: 'center' | 'start' }) {
  const color = tone === 'accent' ? colors.accent : colors.label;
  return <Pressable onPress={onPress} disabled={disabled} accessibilityRole="button" accessibilityLabel={title} accessibilityState={{ disabled }}
    style={({ pressed }) => ({ minHeight: layout.hit, paddingHorizontal: spacing.md, flexDirection: 'row', alignItems: 'center', justifyContent: align === 'center' ? 'center' : 'flex-start', gap: spacing.xs, borderRadius: radius.full, backgroundColor: pressed ? colors.accentSoft : 'transparent', opacity: disabled ? 0.4 : 1 })}>
    {icon ? <Icon name={icon} size={20} color={color} /> : null}
    <Text style={[type.headline, { color }]}>{title}</Text>
  </Pressable>;
}

export function PrimaryButton({ title, onPress, disabled, busy, tone = 'accent', icon }: { title: string; onPress(): void; disabled?: boolean; busy?: boolean; tone?: 'accent' | 'danger'; icon?: IconName }) {
  const base = tone === 'danger' ? colors.danger : colors.accent;
  return <Pressable onPress={onPress} disabled={disabled || busy} accessibilityRole="button" accessibilityLabel={title} accessibilityState={{ disabled: disabled || busy, busy }}
    style={({ pressed }) => ({ minHeight: layout.hit, paddingHorizontal: spacing.xl, borderRadius: radius.full, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: spacing.sm, backgroundColor: disabled ? colors.separator : pressed && tone === 'accent' ? colors.accentPressed : base, opacity: pressed && tone === 'danger' ? 0.85 : 1 })}>
    {busy ? <ActivityIndicator color={colors.onAccent} /> : icon ? <Icon name={icon} size={20} color={disabled ? colors.tertiary : colors.onAccent} /> : null}
    <Text style={[type.headline, { color: disabled ? colors.tertiary : colors.onAccent }]}>{title}</Text>
  </Pressable>;
}

export function Row({ leading, icon, iconColor, title, subtitle, trailing, onPress, onLongPress, label, disabled, selected, mono }: { leading?: ReactNode; icon?: IconName; iconColor?: string; title: ReactNode; subtitle?: ReactNode; trailing?: ReactNode; onPress?: () => void; onLongPress?: () => void; label?: string; disabled?: boolean; selected?: boolean; mono?: boolean }) {
  const content = <>
    {leading ?? (icon ? <Icon name={icon} color={iconColor ?? colors.secondary} /> : null)}
    <View style={{ flex: 1, gap: spacing.xxs }}>
      {typeof title === 'string' ? <Text style={type.body} selectable={!onPress}>{title}</Text> : title}
      {typeof subtitle === 'string' ? <Text style={mono ? type.mono : type.subhead} selectable={!onPress}>{subtitle}</Text> : subtitle}
    </View>
    {trailing}
  </>;
  const style = { minHeight: layout.row, paddingHorizontal: layout.gutter, paddingVertical: spacing.sm, flexDirection: 'row' as const, alignItems: 'center' as const, gap: spacing.lg };
  if (!onPress) return <View style={style}>{content}</View>;
  return <Pressable onPress={onPress} onLongPress={onLongPress} disabled={disabled} accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled, selected }}
    style={({ pressed }) => [style, { backgroundColor: pressed ? colors.pressed : 'transparent', opacity: disabled ? 0.4 : 1 }]}>{content}</Pressable>;
}
export const Chevron = () => <Icon name="chevron-right" color={colors.tertiary} />;
export function Separator({ inset = 0 }: { inset?: number }) {
  return <View style={{ height: 0.5, backgroundColor: colors.separator, marginLeft: inset }} />;
}
/** Grouped section: background contrast and hairlines, not boxed cards */
export function Section({ title, children, footer }: { title?: string; children: ReactNode; footer?: ReactNode }) {
  return <View style={{ gap: spacing.xs }}>
    {title ? <Text style={[type.section, { paddingHorizontal: layout.gutter, paddingTop: layout.block }]} accessibilityRole="header">{title}</Text> : null}
    <View style={{ backgroundColor: colors.background, borderRadius: radius.md, marginHorizontal: spacing.md, overflow: 'hidden' }}>{children}</View>
    {footer ? <View style={{ paddingHorizontal: layout.gutter }}>{footer}</View> : null}
  </View>;
}

type Tone = 'info' | 'warning' | 'danger' | 'success';
const tones: Record<Tone, { fg: string; bg: string; icon: IconName }> = {
  info: { fg: colors.accent, bg: colors.accentSoft, icon: 'info-outline' },
  warning: { fg: colors.warning, bg: colors.warningSoft, icon: 'warning-amber' },
  danger: { fg: colors.danger, bg: colors.dangerSoft, icon: 'gpp-bad' },
  success: { fg: colors.success, bg: colors.successSoft, icon: 'check-circle' },
};
export function Banner({ tone = 'warning', icon, title, detail, action, onAction, busy, onDismiss, dismissLabel }: { tone?: Tone; icon?: IconName; title: string; detail?: string; action?: string; onAction?: () => void; busy?: boolean; onDismiss?: () => void; dismissLabel?: string }) {
  const t = tones[tone];
  // Same shape as EmptyState: icon, one sentence, optional detail, a borderless action in the tone colour
  return <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingLeft: spacing.md, paddingRight: action || onDismiss ? spacing.xxs : spacing.md, paddingVertical: spacing.xs, minHeight: layout.hit, borderRadius: radius.md, backgroundColor: t.bg }} accessibilityLiveRegion="polite">
    {busy ? <ActivityIndicator size="small" color={t.fg} /> : <Icon name={icon ?? t.icon} size={18} color={t.fg} />}
    <View style={{ flex: 1, gap: spacing.xxs }}>
      <Text style={[type.subhead, { color: t.fg, fontWeight: '600' }]} selectable>{title}</Text>
      {detail ? <Text style={[type.caption, { color: colors.label }]} selectable>{detail}</Text> : null}
    </View>
    {action && onAction ? <Pressable onPress={onAction} accessibilityRole="button" accessibilityLabel={action} style={({ pressed }) => ({ minHeight: layout.hit, paddingHorizontal: spacing.md, justifyContent: 'center', borderRadius: radius.full, backgroundColor: pressed ? 'rgba(0,0,0,0.06)' : 'transparent' })}>
      <Text style={[type.headline, { color: t.fg }]}>{action}</Text>
    </Pressable> : null}
    {onDismiss ? <Pressable onPress={onDismiss} accessibilityRole="button" accessibilityLabel={dismissLabel} hitSlop={4} style={({ pressed }) => ({ width: 36, height: 36, alignItems: 'center', justifyContent: 'center', borderRadius: radius.full, backgroundColor: pressed ? 'rgba(0,0,0,0.06)' : 'transparent' })}>
      <Icon name="close" size={18} color={colors.secondary} />
    </Pressable> : null}
  </View>;
}

/**
 * Empty and error states share one shape: a small icon, one sentence, an optional
 * detail line and borderless accent actions (TextButton). Never a whole-page spinner.
 */
export function EmptyState({ icon, art, tone = 'accent', title, detail, children }: { icon: IconName; art?: ReactNode; tone?: 'accent' | 'warning' | 'neutral'; title: string; detail?: string; children?: ReactNode }) {
  const fg = tone === 'warning' ? colors.warning : tone === 'neutral' ? colors.tertiary : colors.accent;
  return <View style={{ alignItems: 'center', paddingHorizontal: spacing.xl, paddingVertical: spacing.xl, gap: spacing.xs }}>
    {art ?? <View style={{ marginBottom: spacing.xs }}><Icon name={icon} size={36} color={fg} /></View>}
    <Text style={[type.headline, { textAlign: 'center' }]} accessibilityRole="header">{title}</Text>
    {detail ? <Text style={[type.subhead, { textAlign: 'center' }]} selectable>{detail}</Text> : null}
    {children ? <View style={{ alignItems: 'center', gap: spacing.xxs, marginTop: spacing.xs, alignSelf: 'stretch' }}>{children}</View> : null}
  </View>;
}

/** Bottom sheet: drag handle, swipe down, scrim tap and back all dismiss */
export function Sheet({ visible, onClose, children, label }: { visible: boolean; onClose(): void; children: ReactNode; label?: string }) {
  const insets = useSafeAreaInsets();
  const drag = useRef(new Animated.Value(0)).current;
  const close = useRef(onClose); close.current = onClose;
  useEffect(() => { if (visible) drag.setValue(0); }, [visible, drag]);
  // The browser's back closes it too (Android's back reaches the Modal itself)
  useBackStep(visible, () => close.current());
  const responder = useMemo(() => PanResponder.create({
    onMoveShouldSetPanResponder: (_e, g) => g.dy > 6 && Math.abs(g.dy) > Math.abs(g.dx),
    onPanResponderMove: (_e, g) => drag.setValue(Math.max(0, g.dy)),
    onPanResponderRelease: (_e, g) => {
      if (g.dy > 80 || g.vy > 1) close.current();
      else Animated.spring(drag, { toValue: 0, useNativeDriver: true }).start();
    },
  }), [drag]);
  return <Modal visible={visible} transparent animationType="fade" statusBarTranslucent navigationBarTranslucent onRequestClose={onClose}>
    <View style={{ flex: 1, justifyContent: 'flex-end' }}>
      <Pressable style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: colors.scrim }} onPress={onClose} accessibilityRole="button" accessibilityLabel={label} />
      <Animated.View {...responder.panHandlers} style={{ backgroundColor: colors.background, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, paddingBottom: insets.bottom + spacing.sm, maxHeight: '85%', transform: [{ translateY: drag }] }}>
        <View style={{ alignItems: 'center', paddingVertical: spacing.sm }}><View style={{ width: 36, height: 4, borderRadius: 2, backgroundColor: colors.separator }} /></View>
        {children}
      </Animated.View>
    </View>
  </Modal>;
}

export function ConfirmSheet({ visible, title, message, detail, confirm, cancel, destructive = true, onConfirm, onClose }: { visible: boolean; title: string; message?: string; detail?: string; confirm: string; cancel: string; destructive?: boolean; onConfirm(): void; onClose(): void }) {
  return <Sheet visible={visible} onClose={onClose} label={cancel}>
    <View style={{ paddingHorizontal: spacing.xl, paddingBottom: spacing.sm, gap: spacing.sm }}>
      <Text style={type.hero} accessibilityRole="header">{title}</Text>
      {message ? <Text style={type.body} selectable>{message}</Text> : null}
      {detail ? <Text style={type.mono} selectable>{detail}</Text> : null}
      <View style={{ gap: spacing.xs, marginTop: spacing.md }}>
        <PrimaryButton title={confirm} tone={destructive ? 'danger' : 'accent'} onPress={onConfirm} />
        <TextButton title={cancel} tone="neutral" onPress={onClose} />
      </View>
    </View>
  </Sheet>;
}

export function Skeleton({ style }: { style?: StyleProp<ViewStyle> }) {
  return <View style={[{ backgroundColor: colors.skeleton, borderRadius: radius.sm }, style]} />;
}
