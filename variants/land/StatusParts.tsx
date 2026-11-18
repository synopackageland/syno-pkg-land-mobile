import { useState, type ReactNode } from 'react';
import { Pressable, Text, View } from 'react-native';
import type { LivePoint } from '../../src/core/status/live';
import { LiveSpark } from './LiveSpark';
import type { Readout } from '../../src/core/status/calm';
import { useReadout } from './motion';
import { Icon, type IconName } from './ui';
import { colors, radius, spacing, type } from './theme';

export { LiveSpark };
/** A live number that counts calmly to each new value; `readout` writes it (`readouts.percent`, `.rate`, `.celsius`) */
export function ReadoutText({ value, readout, style }: { value: number | undefined; readout: Readout; style?: object }) {
  return <Text style={style} numberOfLines={1}>{useReadout(value, readout)}</Text>;
}

/**
 * Progress ring without a background track: two half-discs clipped to each
 * half of the square, each a bordered circle with two coloured sides rotated
 * into place. No SVG dependency.
 */
export function Ring({ value, size = 76, width = 6, color, children, label }: { value: number | undefined; size?: number; width?: number; color: string; children?: ReactNode; label?: string }) {
  const p = Math.max(0, Math.min(100, value ?? 0));
  const right = Math.min(p, 50) * 3.6 - 135, left = Math.max(p - 50, 0) * 3.6 - 135;
  const arc = { position: 'absolute' as const, top: 0, width: size, height: size, borderRadius: size / 2, borderWidth: width, borderColor: 'transparent' };
  return <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }} accessibilityLabel={label} accessible={Boolean(label)}>
    {p > 0 ? <View style={{ position: 'absolute', top: 0, left: size / 2, width: size / 2, height: size, overflow: 'hidden' }}>
      <View style={[arc, { left: -size / 2, borderTopColor: color, borderRightColor: color, transform: [{ rotate: `${right}deg` }] }]} />
    </View> : null}
    {p > 50 ? <View style={{ position: 'absolute', top: 0, left: 0, width: size / 2, height: size, overflow: 'hidden' }}>
      <View style={[arc, { left: 0, borderBottomColor: color, borderLeftColor: color, transform: [{ rotate: `${left}deg` }] }]} />
    </View> : null}
    {children}
  </View>;
}
/** Value in the ring's centre: big number, small unit */
export function RingValue({ value, unit }: { value: string; unit?: string }) {
  return <View style={{ alignItems: 'center' }}>
    <Text style={[type.headline, { fontVariant: ['tabular-nums'] }]}>{value}</Text>
    {unit ? <Text style={[type.caption, { lineHeight: 14 }]}>{unit}</Text> : null}
  </View>;
}
/** A ring with its label under it */
export function Gauge({ value, color, label, center, size, sub }: { value: number | undefined; color: string; label: string; center: ReactNode; size?: number; sub?: string }) {
  return <View style={{ alignItems: 'center', gap: spacing.xs }}>
    <Ring value={value} color={color} size={size} label={sub ? `${label} ${sub}` : label}>{center}</Ring>
    <View style={{ alignItems: 'center' }}>
      <Text style={type.caption}>{label}</Text>
      {sub ? <Text style={[type.caption, { color: colors.tertiary, fontVariant: ['tabular-nums'] }]} numberOfLines={1}>{sub}</Text> : null}
    </View>
  </View>;
}
/** Small tile: icon and title, then up to three value lines; a line with `amount` and `readout` counts calmly to each new value */
export function Tile({ icon, title, lines, onPress, label }: { icon: IconName; title: string; lines: { icon?: IconName; color?: string; text: string; amount?: number; readout?: Readout; tone?: 'danger' }[]; onPress?: () => void; label?: string }) {
  const body = <>
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.xs }}>
      <Icon name={icon} size={15} color={colors.secondary} />
      <Text style={type.section} numberOfLines={1}>{title}</Text>
    </View>
    {lines.map((line, index) => <View key={index} style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.xxs }}>
      {line.icon ? <Icon name={line.icon} size={13} color={line.color ?? colors.secondary} /> : null}
      {line.amount !== undefined && line.readout ? <ReadoutText value={line.amount} readout={line.readout} style={[type.subhead, { color: line.tone === 'danger' ? colors.danger : colors.label, fontVariant: ['tabular-nums'] }]} />
        : <Text style={[type.subhead, { color: line.tone === 'danger' ? colors.danger : colors.label, fontVariant: ['tabular-nums'] }]} numberOfLines={1}>{line.text}</Text>}
    </View>)}
  </>;
  const style = { flex: 1, minWidth: 0, padding: spacing.sm, gap: spacing.xxs, borderRadius: radius.sm, backgroundColor: colors.grouped };
  return onPress ? <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={label ?? title} style={({ pressed }) => [style, pressed && { backgroundColor: colors.pressed }]}>{body}</Pressable> : <View style={style} accessibilityLabel={label}>{body}</View>;
}
/**
 * Capacity tile: title with an optional "+N" badge, a big value with a short
 * note beside it, a small detail line and a thin fill bar (no track). It takes
 * a wider share of the row than the rate tiles so "21.2 GB / 3.5 TB" fits on
 * a 360 dp phone; a nearly empty volume still shows a short bar, not a speck.
 */
export const CAPACITY_FLEX = 1.4;
export function CapacityTile({ icon, title, value, note, detail, fill, color, tone, badge, onPress, label }: {
  icon: IconName; title: string; value: string; note?: string; detail: string; fill: number; color: string; tone?: string; badge?: string; onPress?: () => void; label: string;
}) {
  return <Pressable onPress={onPress} disabled={!onPress} accessibilityRole="button" accessibilityLabel={label}
    style={({ pressed }) => ({ flex: CAPACITY_FLEX, minWidth: 0, padding: spacing.sm, gap: spacing.xxs, borderRadius: radius.sm, backgroundColor: pressed ? colors.pressed : colors.grouped })}>
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.xs }}>
      <Icon name={icon} size={15} color={colors.secondary} />
      <Text style={[type.section, { flex: 1 }]} numberOfLines={1}>{title}</Text>
      {badge ? <View style={{ paddingHorizontal: spacing.xs, borderRadius: radius.full, backgroundColor: colors.background }}>
        <Text style={[type.caption, { lineHeight: 15, fontVariant: ['tabular-nums'] }]}>{badge}</Text>
      </View> : null}
    </View>
    <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: spacing.xs }}>
      <Text style={[type.headline, { color: tone ?? colors.label, fontVariant: ['tabular-nums'], flexShrink: 0 }]} numberOfLines={1}>{value}</Text>
      {note ? <Text style={[type.caption, { flexShrink: 1 }]} numberOfLines={1}>{note}</Text> : null}
    </View>
    <Text style={[type.caption, { fontVariant: ['tabular-nums'] }]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.85}>{detail}</Text>
    <Meter value={fill} color={color} height={4} min={8} />
  </Pressable>;
}
/** Recent samples as thin bars, newest on the right; idle or tiny samples draw nothing, so no dotted baseline */
export function Bars({ values, color, max, height = 40, count = 40 }: { values: number[]; color: string; max?: number; height?: number; count?: number }) {
  const top = max ?? Math.max(1, ...values);
  const padded = [...Array(Math.max(0, count - values.length)).fill(undefined), ...values.slice(-count)] as (number | undefined)[];
  // Bars under 4 px read as dashes or dots along the baseline; they draw nothing instead
  const bar = (value: number | undefined) => { const h = value ? Math.round(value / top * height) : 0; return h < 4 ? 0 : h; };
  return <View style={{ height, flexDirection: 'row', alignItems: 'flex-end', gap: 2 }} importantForAccessibility="no-hide-descendants">
    {padded.map((value, index) => <View key={index} style={{ flex: 1, height: bar(value), borderRadius: 1, backgroundColor: color, opacity: 0.85 }} />)}
  </View>;
}
/** Usage bar: filled part only, rounded; the empty part is plain background */
export function Meter({ value, color, height = 6, min = 0 }: { value: number; color: string; height?: number; min?: number }) {
  const p = Math.max(0, Math.min(100, value));
  return <View style={{ height, borderRadius: height / 2, overflow: 'hidden', flexDirection: 'row' }} importantForAccessibility="no-hide-descendants">
    {p > 0 ? <View style={{ width: `${p}%`, minWidth: min, borderRadius: height / 2, backgroundColor: color }} /> : null}
  </View>;
}
/** Label and value on one line */
export function Stat({ label, value, color }: { label: string; value: string; color?: string }) {
  return <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: 28 }}>
    {color ? <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: color }} /> : null}
    <Text style={[type.subhead, { flex: 1 }]} numberOfLines={1}>{label}</Text>
    <Text style={[type.body, { fontVariant: ['tabular-nums'] }]} numberOfLines={1} selectable>{value}</Text>
  </View>;
}
/**
 * Static sparkline for DSM's own history (evenly spaced values) without SVG:
 * each segment is a thin rotated View. No grid, no track. Missing values
 * (null: no history there) leave the line open; segments lying on zero at
 * both ends are left out, so an idle NAS draws no dotted baseline. The live
 * charts use LiveSpark, which never breaks.
 */
export function Spark({ values, color, max, height = 28, thickness = 1.5 }: { values: (number | null | undefined)[]; color: string; max?: number; height?: number; thickness?: number }) {
  const [width, setWidth] = useState(0);
  const known = values.filter((v): v is number => typeof v === 'number');
  const top = max ?? Math.max(1, ...known);
  const n = values.length;
  const x = (i: number) => n > 1 ? i / (n - 1) * width : width;
  const y = (v: number) => height - thickness - Math.max(0, Math.min(1, v / top)) * (height - thickness * 2);
  const segments: ReactNode[] = [];
  if (width > 0) for (let i = 1; i < n; i++) {
    const a = values[i - 1], b = values[i];
    if (typeof a !== 'number' || typeof b !== 'number' || (a === 0 && b === 0)) continue;
    const x1 = x(i - 1), y1 = y(a), x2 = x(i), y2 = y(b);
    const length = Math.hypot(x2 - x1, y2 - y1) + thickness, angle = Math.atan2(y2 - y1, x2 - x1);
    segments.push(<View key={i} style={{ position: 'absolute', left: (x1 + x2) / 2 - length / 2, top: (y1 + y2) / 2 - thickness / 2, width: length, height: thickness, borderRadius: thickness / 2, backgroundColor: color, transform: [{ rotate: `${angle}rad` }] }} />);
  }
  return <View style={{ height, alignSelf: 'stretch' }} onLayout={event => setWidth(event.nativeEvent.layout.width)} importantForAccessibility="no-hide-descendants">{segments}</View>;
}
/**
 * Big value with its label and a live sparkline under it (U8). With `amount`
 * and `readout` the value counts calmly to each new sample; `value` stays the
 * label read out and the value without motion.
 */
export function BigStat({ label, value, amount, readout, sub, points, color, max, onPress }: { label: string; value: string; amount?: number; readout?: Readout; sub?: string; points: LivePoint[]; color: string; max?: number; onPress?: () => void }) {
  const big = { fontSize: 22, lineHeight: 26, fontWeight: '600' as const, color: colors.label, fontVariant: ['tabular-nums' as const] };
  const body = <>
    <Text style={type.caption} numberOfLines={1}>{label}</Text>
    <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: spacing.xs }}>
      {amount !== undefined && readout ? <ReadoutText value={amount} readout={readout} style={big} /> : <Text style={big} numberOfLines={1}>{value}</Text>}
      {sub ? <Text style={[type.caption, { flexShrink: 1, fontVariant: ['tabular-nums'] }]} numberOfLines={1}>{sub}</Text> : null}
    </View>
    <LiveSpark points={points} color={color} max={max} />
  </>;
  const style = { flex: 1, minWidth: 0, gap: spacing.xxs };
  return onPress ? <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={`${label} ${value}${sub ? ` ${sub}` : ''}`} style={({ pressed }) => [style, { opacity: pressed ? 0.6 : 1 }]}>{body}</Pressable>
    : <View style={style} accessible accessibilityLabel={`${label} ${value}`}>{body}</View>;
}
/** Section title with an optional age caption on the right and a chevron when it opens a page */
export function SectionTitle({ title, age, onPress, label }: { title: string; age?: string; onPress?: () => void; label?: string }) {
  const body = <>
    <Text style={[type.section, { flex: 1 }]} accessibilityRole="header" numberOfLines={1}>{title}</Text>
    {age ? <Text style={[type.caption, { color: colors.tertiary }]} numberOfLines={1}>{age}</Text> : null}
    {onPress ? <Icon name="chevron-right" size={18} color={colors.tertiary} /> : null}
  </>;
  const style = { minHeight: 32, flexDirection: 'row' as const, alignItems: 'center' as const, gap: spacing.xs };
  return onPress ? <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={label ?? title} hitSlop={4} style={({ pressed }) => [style, { opacity: pressed ? 0.6 : 1 }]}>{body}</Pressable> : <View style={style}>{body}</View>;
}
/** Borderless accent text for inline actions such as "Open in DSM" or "Retry" */
export function InlineAction({ title, onPress }: { title: string; onPress(): void }) {
  return <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={title} hitSlop={8} style={({ pressed }) => ({ alignSelf: 'flex-start', minHeight: 32, justifyContent: 'center', opacity: pressed ? 0.6 : 1 })}>
    <Text style={[type.headline, { color: colors.accent }]}>{title}</Text>
  </Pressable>;
}
/** Small status dot */
export const Dot = ({ color, size = 8 }: { color: string; size?: number }) => <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: color }} />;
/** Text-only segmented choice; the selected one is accent and bold */
export function Segments<K extends string>({ items, value, onChange }: { items: { key: K; label: string }[]; value: K; onChange(key: K): void }) {
  return <View style={{ flexDirection: 'row', gap: spacing.md }} accessibilityRole="tablist">
    {items.map(item => {
      const selected = item.key === value;
      return <Pressable key={item.key} onPress={() => onChange(item.key)} accessibilityRole="tab" accessibilityState={{ selected }} hitSlop={6} style={{ minHeight: 32, justifyContent: 'center' }}>
        <Text style={[type.subhead, selected && { color: colors.accent, fontWeight: '600' }]}>{item.label}</Text>
      </Pressable>;
    })}
  </View>;
}
