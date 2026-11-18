import { Pressable, Text, View } from 'react-native';
import type { NasProfile } from '../../src/core/config';
import type { Strings } from '../../src/core/i18n/strings';
import { fill } from '../../src/core/i18n/strings';
import { continuous, type LiveKey, type LivePoint } from '../../src/core/status/live';
import { periods, type Item, type Mode, type StatusSnapshot, type StatusState } from '../../src/core/status/model';
import { ageLabel, formatRate, percent, timeLabel, uptimeParts, usedOfTotal } from '../../src/core/status/format';
import type { Volume, VolumeState } from '../../src/core/status/mappers';
import { statusStrings } from '../../src/core/i18n/status-strings';
import { readouts } from '../../src/core/status/calm';
import { BigStat, CapacityTile, InlineAction, Tile } from './StatusParts';
import { Icon, Skeleton, type IconName } from './ui';
import { chart, colors, layout, radius, spacing, type } from './theme';

const privateHost = (host: string) => /^(10\.|127\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.)/.test(host) || /^\[?(fe80|fd|fc)/i.test(host) || host.endsWith('.local') || host.endsWith('.lan') || !host.includes('.');
/** How the phone reaches this NAS: the QR kind when known, else read from the address */
export function connectionOf(profile: NasProfile, t: Strings): { label: string; icon: IconName } {
  const host = new URL(profile.origin).hostname;
  if (profile.kind && profile.kind !== 'other') return { label: t[`kind_${profile.kind}`], icon: profile.kind === 'lan' ? 'lan' : 'public' };
  if (/quickconnect\.(to|cn)$/i.test(host)) return { label: t.conn_quickconnect, icon: 'public' };
  return privateHost(host) ? { label: t.kind_lan, icon: 'lan' } : { label: t.conn_internet, icon: 'public' };
}
export const modelOf = (snapshot?: StatusSnapshot) => snapshot?.overview?.model ?? snapshot?.health?.model;
/** Highest known temperature: the system sensor, else the hottest drive */
export function temperatureOf(snapshot?: StatusSnapshot): { value?: number; warning: boolean } {
  const drives = snapshot?.health?.disks.map(d => d.temp).filter((v): v is number => typeof v === 'number') ?? [];
  const value = snapshot?.overview?.temp ?? (drives.length ? Math.max(...drives) : undefined);
  return { value, warning: Boolean(snapshot?.overview?.tempWarning || snapshot?.health?.tempWarning) };
}
/** Fill level from which a volume's bar and value turn warning, then danger */
export const FULL_WARNING = 80, FULL_DANGER = 90;
export const volumePercent = (volume: Volume) => volume.total > 0 ? Math.max(0, Math.min(100, volume.used / volume.total * 100)) : 0;
/** Bar colour for a volume: its state first, then how full it is */
export function capacityColor(volume: Volume): string {
  // Rounded like the percentage on screen, so "90%" is never shown in warning colour
  const p = Math.round(volumePercent(volume));
  return volume.state || volume.status === 'danger' || p >= FULL_DANGER ? colors.danger : volume.status === 'warning' || p >= FULL_WARNING ? colors.warning : colors.accent;
}
const severity: Record<VolumeState, number> = { crashed: 3, degraded: 2, readonly: 1 };
/**
 * The volume the home tile shows, answering "am I running out of space?":
 * a crashed, degraded or read-only volume first (worst state wins), else the
 * fullest one. `others` counts the remaining volumes. Undefined without
 * storage data, e.g. for normal users, whom DSM refuses the storage API.
 */
export function storageOf(snapshot?: StatusSnapshot): { volume: Volume; percent: number; others: number } | undefined {
  const volumes = snapshot?.volumes ?? [];
  if (!volumes.length) return undefined;
  const rank = (v: Volume) => v.state ? severity[v.state] : 0;
  const volume = volumes.reduce((best, v) => rank(v) > rank(best) || rank(v) === rank(best) && volumePercent(v) > volumePercent(best) ? v : best);
  return { volume, percent: volumePercent(volume), others: volumes.length - 1 };
}
export function uptimeText(seconds: number | undefined, t: Strings, withSeconds = false): string | undefined {
  if (seconds === undefined) return undefined;
  const u = uptimeParts(seconds);
  const parts = [u.days ? `${u.days} ${t.unit_day}` : '', u.days || u.hours ? `${u.hours} ${t.unit_hour}` : '', `${u.minutes} ${t.unit_minute}`, withSeconds ? `${u.seconds} ${t.unit_second}` : ''];
  return parts.filter(Boolean).join(' ');
}
/** Uptime advanced by the time since DSM reported it */
export function liveUptime(snapshot: StatusSnapshot | undefined, now: number) {
  const base = snapshot?.health?.uptime ?? snapshot?.overview?.uptime;
  const at = snapshot?.health?.uptime !== undefined ? snapshot?.times.health : snapshot?.times.overview;
  return base === undefined ? undefined : base + Math.max(0, (now - (at ?? now)) / 1000);
}
/**
 * The time of the last answer, shown only when values are old: after a failed
 * refresh, or when no answer came for three refresh periods. Normally nothing.
 */
export function staleTime(state: StatusState, mode: 'home' | 'status', now: number, locale: string): string | undefined {
  const s = state.snapshot;
  if (!s) return undefined;
  const item = s.denied.includes('util') ? 'health' : 'util';
  const at = s.times[item];
  if (!at) return undefined;
  const period = periods[mode][item] ?? 60_000;
  if (!state.error && state.live.includes(item) && now - at < period * 3) return undefined;
  return timeLabel(at / 1000, locale);
}
/**
 * U13. The age of a section's data ("3 min ago"), shown only when it is not
 * live: read from the cache and not answered yet in this run, after a failed
 * refresh, or older than three refresh periods. Live data shows nothing.
 */
export function ageOf(state: StatusState, items: Item | Item[], mode: Mode, now: number, t: Strings, locale: string): string | undefined {
  const s = state.snapshot;
  if (!s) return undefined;
  const list = [items].flat().filter(item => s.times[item]);
  if (!list.length) return undefined;
  const at = Math.min(...list.map(item => s.times[item]!));
  const period = Math.max(...list.map(item => periods[mode][item] ?? periods.status[item] ?? 60_000));
  const live = list.every(item => state.live.includes(item));
  if (!state.error && live && now - at < period * 3) return undefined;
  return ageLabel(at, now, statusStrings(t), locale);
}
/** One measure of the saved live trend as one unbroken line: missing samples are interpolated, the last value carries on */
export function trendOf(snapshot: StatusSnapshot | undefined, key: LiveKey): LivePoint[] {
  return continuous(snapshot?.trend, key);
}
/**
 * U7. One line instead of the NAS card: model · DSM 7.4.1 · up 11 d. The
 * data age follows only when the values are not live.
 */
export function NasLine({ state, t, now, locale }: { state: StatusState; t: Strings; now: number; locale: string }) {
  const s = state.snapshot, st = statusStrings(t);
  const user = s?.user, up = liveUptime(s, now);
  // Only the largest unit: a line that ticks every minute reads as noise
  const u = up === undefined ? undefined : uptimeParts(up);
  const uptime = !u ? undefined : u.days ? `${u.days} ${t.unit_day}` : u.hours ? `${u.hours} ${t.unit_hour}` : `${u.minutes} ${t.unit_minute}`;
  const dsm = user?.dsm ? fill(st.dsmVersion, { version: user.update ? `${user.dsm} Update ${user.update}` : user.dsm }) : undefined;
  const age = ageOf(state, ['health'], 'home', now, t, locale);
  const parts = [modelOf(s), dsm, uptime ? fill(st.upFor, { time: uptime }) : undefined, age].filter(Boolean);
  if (!parts.length) return null;
  // A quiet one-line caption with room under the top bar, on the sections' gutter
  return <Text style={[type.caption, { color: colors.tertiary, paddingHorizontal: layout.gutter, paddingTop: spacing.sm }]} numberOfLines={1} selectable>{parts.join(' · ')}</Text>;
}
/**
 * §5.2 offline: the page keeps its cached values; one line says since when,
 * with a borderless retry
 */
export function OfflineLine({ state, t, locale, onRetry }: { state: StatusState; t: Strings; locale: string; onRetry(): void }) {
  const s = state.snapshot;
  if (!state.error || state.signedOut || !s) return null;
  const times = Object.values(s.times).filter((v): v is number => typeof v === 'number');
  const time = times.length ? timeLabel(Math.max(...times) / 1000, locale) : '-';
  return <View style={{ marginHorizontal: spacing.lg, flexDirection: 'row', alignItems: 'center', gap: spacing.sm }} accessibilityLiveRegion="polite">
    <Icon name="cloud-off" size={16} color={colors.warning} />
    <Text style={[type.subhead, { flex: 1, color: colors.warning }]} numberOfLines={1}>{fill(statusStrings(t).offline, { time })}</Text>
    <InlineAction title={t.retry} onPress={onRetry} />
  </View>;
}

type CardProps = { profile: NasProfile; state: StatusState; t: Strings; onStatus(): void; onSwitch(): void; healthy: boolean };
/** NAS name, connection and model; the name switches NAS, the rest opens the status */
export function NasCard({ profile, state, t, onStatus, onSwitch, healthy }: CardProps) {
  const connection = connectionOf(profile, t);
  const model = modelOf(state.snapshot);
  const warning = temperatureOf(state.snapshot).warning || state.snapshot?.health?.crashed || state.snapshot?.health?.disks.some(d => d.status !== 'normal') || state.snapshot?.volumes?.some(v => v.state);
  return <Pressable onPress={onStatus} accessibilityRole="button" accessibilityLabel={`${t.nasStatus}, ${profile.name}`}
    style={({ pressed }) => ({ marginHorizontal: spacing.md, padding: spacing.md, paddingRight: spacing.sm, borderRadius: radius.md, backgroundColor: pressed ? colors.pressed : colors.grouped, flexDirection: 'row', alignItems: 'center', gap: spacing.md })}>
    <View style={{ flex: 1, minWidth: 0, gap: spacing.xxs }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.xs }}>
        <Icon name={connection.icon} size={14} color={colors.secondary} />
        <Text style={type.caption} numberOfLines={1}>{model ? `${connection.label} · ${model}` : connection.label}</Text>
      </View>
      <Pressable onPress={onSwitch} accessibilityRole="button" accessibilityLabel={t.switchNas} hitSlop={6} style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.xs, alignSelf: 'flex-start', maxWidth: '100%' }}>
        <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: !healthy ? colors.warning : warning ? colors.danger : colors.success }} />
        <Text style={[type.hero, { flexShrink: 1 }]} numberOfLines={1}>{profile.name}</Text>
        <Icon name="expand-more" size={20} color={colors.secondary} />
      </Pressable>
    </View>
    <View style={{ width: 52, height: 52, borderRadius: radius.md, backgroundColor: colors.background, alignItems: 'center', justifyContent: 'center' }}>
      <Icon name="dns" size={30} color={colors.accent} />
    </View>
    <Icon name="chevron-right" size={20} color={colors.tertiary} />
  </Pressable>;
}

/**
 * U8. CPU and memory as big values with a live sparkline of the saved trend
 * (one unbroken line that scrolls steadily, live.ts), then network, drive and
 * storage tiles; the numbers ease to each new sample. Parts DSM refuses are
 * left out.
 * Without storage data (normal users) the third tile is the temperature.
 */
export function ResourceCard({ state, t, locale, now, onStatus, onStorage, storage: withStorage = true }: { state: StatusState; t: Strings; locale: string; now: number; onStatus(): void; onStorage?(): void; storage?: boolean }) {
  const s = state.snapshot;
  const util = s?.util, denied = new Set(s?.denied ?? []);
  // The overview lists volumes in their own section; then the third tile is the temperature
  const storage = withStorage ? storageOf(s) : undefined;
  const temp = temperatureOf(s);
  const waiting = !util && !denied.has('util') && !s?.health && !storage;
  const age = ageOf(state, util ? 'util' : 'health', 'home', now, t, locale);
  if (!waiting && !util && !storage && temp.value === undefined) return null;
  const cpu = trendOf(s, 'cpu'), memory = trendOf(s, 'memory');
  return <Pressable onPress={onStatus} accessibilityRole="button" accessibilityLabel={t.nasStatus}
    style={({ pressed }) => ({ marginHorizontal: spacing.md, padding: spacing.md, gap: spacing.sm, borderRadius: radius.md, borderWidth: 0.5, borderColor: colors.separator, backgroundColor: pressed ? colors.pressed : colors.background })}>
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.xs }}>
      <Text style={[type.section, { flex: 1 }]} accessibilityRole="header">{t.resources}</Text>
      {age ? <Text style={[type.caption, { color: colors.tertiary }]}>{age}</Text> : null}
      <Icon name="chevron-right" size={18} color={colors.tertiary} />
    </View>
    {waiting ? <View style={{ flexDirection: 'row', gap: spacing.lg }}>
      {[0, 1].map(i => <Skeleton key={i} style={{ flex: 1, height: 56, borderRadius: radius.sm }} />)}
    </View> : util?.cpu || util?.memory ? <View style={{ flexDirection: 'row', gap: spacing.lg }}>
      {util.cpu ? <BigStat label={t.cpu} value={percent(util.cpu.percent)} amount={util.cpu.percent} readout={readouts.percent} points={cpu} max={100} color={chart.cpu} /> : null}
      {util.memory ? <BigStat label={t.memory} value={percent(util.memory.percent)} amount={util.memory.percent} readout={readouts.percent} sub={usedOfTotal(util.memory.used, util.memory.total)} points={memory} max={100} color={chart.memory} /> : null}
    </View> : null}
    {!waiting ? <View style={{ flexDirection: 'row', gap: spacing.sm }}>
      {util?.network ? <Tile icon="swap-vert" title={t.network} lines={[{ icon: 'arrow-upward', color: chart.up, text: formatRate(util.network.tx), amount: util.network.tx, readout: readouts.rate }, { icon: 'arrow-downward', color: chart.down, text: formatRate(util.network.rx), amount: util.network.rx, readout: readouts.rate }]}
        label={`${t.network}, ${t.upload} ${formatRate(util.network.tx)}, ${t.download} ${formatRate(util.network.rx)}`} /> : null}
      {util?.disk ? <Tile icon="storage" title={t.drives} lines={[{ icon: 'file-download', color: chart.read, text: formatRate(util.disk.read), amount: util.disk.read, readout: readouts.rate }, { icon: 'file-upload', color: chart.write, text: formatRate(util.disk.write), amount: util.disk.write, readout: readouts.rate }]}
        label={`${t.drives}, ${t.read} ${formatRate(util.disk.read)}, ${t.write} ${formatRate(util.disk.write)}`} /> : null}
      {storage ? <StorageTile storage={storage} t={t} onPress={onStorage ?? onStatus} />
        : temp.value !== undefined ? <Tile icon="device-thermostat" title={t.temperature} lines={[{ text: `${temp.value} °C`, amount: temp.value, readout: readouts.celsius, tone: temp.warning ? 'danger' : undefined }]}
          label={`${t.temperature} ${temp.value} °C${temp.warning ? `, ${t.tempHigh}` : ''}`} /> : null}
    </View> : null}
  </Pressable>;
}

/**
 * The home storage tile: used % of the volume closest to trouble, used / total
 * under it and a thin bar. A crashed, degraded or read-only volume shows its
 * state in danger colour instead of the percentage. With several volumes the
 * name sits beside the value (a third of the card has no room for it in the
 * detail line) and "+N" counts the others.
 */
export function StorageTile({ storage, t, onPress }: { storage: NonNullable<ReturnType<typeof storageOf>>; t: Strings; onPress(): void }) {
  const { volume, others } = storage;
  const color = capacityColor(volume);
  const value = volume.state ? t[`vol_${volume.state}`] : percent(storage.percent);
  const detail = usedOfTotal(volume.used, volume.total);
  const name = others ? volume.name : undefined;
  return <CapacityTile icon="pie-chart-outline" title={t.storage} value={value} note={name} detail={detail} fill={storage.percent} color={color}
    tone={volume.state || Math.round(storage.percent) >= FULL_WARNING ? color : undefined} badge={others ? `+${others}` : undefined} onPress={onPress}
    label={[t.storage, name, value, `${t.used} ${detail}`, others ? fill(t.moreVolumes, { count: others }) : ''].filter(Boolean).join(', ')} />;
}
