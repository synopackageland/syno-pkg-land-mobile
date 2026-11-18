/**
 * Glance modules (report §4): needs attention (A), Security Advisor (B),
 * Hyper Backup (C) and storage with pools and drives (D). Each one reads the
 * status snapshot only, so the overview and the status page can both import
 * it. Anything that changes a setting opens the DSM App instead.
 */
import { Pressable, Text, View } from 'react-native';
import { fill, type Strings } from '../../src/core/i18n/strings';
import { statusStrings, type StatusStrings } from '../../src/core/i18n/status-strings';
import { attentionOf, type Attention } from '../../src/core/status/attention';
import { ageLabel, formatBytes, percent, whenLabel } from '../../src/core/status/format';
import type { Disk, Volume } from '../../src/core/status/mappers';
import { moduleState, type Item, type StatusState } from '../../src/core/status/model';
import { dsmApps, type Unavailable } from '../../src/core/status/modules';
import type { BackupTask } from '../../src/core/status/modules/backup';
import { FAIL_KINDS, type SecurityLevel } from '../../src/core/status/modules/security';
import type { Level, Pool } from '../../src/core/status/modules/storage';
import { disksByNeed, storageSummary, volumesByNeed } from '../../src/core/status/storage-summary';
import { capacityColor, volumePercent } from './HomeCards';
import { Dot, InlineAction, Meter, SectionTitle } from './StatusParts';
import { Icon, Separator, type IconName } from './ui';
import { chart, colors, layout, spacing, type } from './theme';

/** Pages a glance row can open on the status screen */
export type GlancePage = 'storage' | 'security' | 'backup';
/**
 * The DSM App with this launchApp id, as an action; undefined when the
 * account has no such App (then no "Open in DSM" link is shown)
 */
export type OpenApp = (id: string) => (() => void) | undefined;
type Common = { state: StatusState; t: Strings; now: number; locale: string; onOpenApp?: OpenApp };
const appName = (st: StatusStrings, id: string) => id === dsmApps.storage ? st.app_storage : id === dsmApps.security ? st.app_security : id === dsmApps.backup ? st.app_backup : id === dsmApps.resource ? st.app_resource : '';
const levelColor = (level: 'danger' | 'warning' | 'normal' | 'unknown') => level === 'danger' ? colors.danger : level === 'warning' ? colors.warning : level === 'unknown' ? colors.tertiary : colors.success;
const pad = { paddingHorizontal: layout.gutter };

/** "Open <App> in DSM" as borderless accent text */
export function OpenInDsm({ app, t, onOpenApp }: { app: string; t: Strings; onOpenApp?: OpenApp }) {
  const open = onOpenApp?.(app);
  if (!open) return null;
  const st = statusStrings(t);
  return <View style={pad}><InlineAction title={fill(st.openInDsm, { app: appName(st, app) })} onPress={open} /></View>;
}
/**
 * A module this DSM does not offer, or a feature switched off in DSM: one
 * row with the reason and the way to DSM, never an empty card
 */
export function FallbackRow({ title, reason, app, t, onOpenApp }: { title: string; reason: Unavailable; app?: string; t: Strings; onOpenApp?: OpenApp }) {
  const st = statusStrings(t), open = app ? onOpenApp?.(app) : undefined;
  return <View style={[pad, { gap: spacing.xxs }]}>
    <SectionTitle title={title} />
    <Text style={type.subhead}>{reason === 'disabled' ? st.historyOff : st.unsupported}</Text>
    {app && open ? <InlineAction title={fill(st.openInDsm, { app: appName(st, app) })} onPress={open} /> : null}
  </View>;
}
/** The fallback row for an item when it is unavailable; undefined when the module shows normally */
export function fallbackFor(state: StatusState, item: Item, title: string, app: string, t: Strings, onOpenApp?: OpenApp) {
  const m = moduleState(state.snapshot, item);
  return m === 'unsupported' || m === 'disabled' ? <FallbackRow title={title} reason={m} app={app} t={t} onOpenApp={onOpenApp} /> : undefined;
}

function attentionText(item: Attention, t: Strings, st: StatusStrings, now: number, locale: string): { icon: IconName; title: string; detail: string } {
  const icon: IconName = item.level === 'danger' ? 'error' : 'warning';
  switch (item.kind) {
    case 'system': return { icon, title: t.nasStatus, detail: st.att_system };
    case 'temperature': return { icon, title: t.temperature, detail: item.value !== undefined ? `${item.value} °C · ${st.att_temperature}` : st.att_temperature };
    case 'volume': return { icon, title: item.name, detail: item.state ? t[`vol_${item.state}`] : fill(st.att_full, { percent: item.percent ?? 0 }) };
    case 'pool': return { icon, title: fill(st.att_pool, { order: item.order }), detail: item.raw ? fill(st.unknownStatus, { raw: item.raw }) : st[`pool_${item.level}`] };
    case 'disk': return { icon, title: item.name, detail: item.level === 'danger' ? st.att_diskDanger : st.att_disk };
    case 'security': return { icon, title: st.app_security, detail: item.issues ? item.issues === 1 ? st.att_securityOne : fill(st.att_security, { count: item.issues }) : st[`sec_${item.severity}`] };
    case 'backup': return { icon, title: item.name, detail: [item.result === 'failed' ? st.att_backupFailed : st.att_backupPartial, item.time ? whenLabel(item.time, now, { today: t.today, yesterday: t.yesterday }, locale) : ''].filter(Boolean).join(' · ') };
  }
}
const pageOf = (item: Attention): GlancePage | undefined => item.kind === 'security' ? item.summary ? undefined : 'security' : item.kind === 'backup' ? 'backup' : item.kind === 'volume' || item.kind === 'pool' || item.kind === 'disk' ? 'storage' : undefined;

/**
 * A. Needs attention, for the top of the overview. With nothing wrong it is
 * one line, "All clear · 3 min ago": the verdict is only as good as its age.
 * A row opens the native page when there is one, else the DSM App.
 */
export function AttentionBlock({ state, t, now, locale, onOpenApp, onPage }: Common & { onPage?(page: GlancePage): void }) {
  const st = statusStrings(t);
  const { items, checked, time } = attentionOf(state.snapshot);
  if (!checked) return null;
  if (!items.length) {
    const age = time ? ageLabel(time, now, st, locale) : undefined;
    return <View style={[pad, { minHeight: 32, flexDirection: 'row', alignItems: 'center', gap: spacing.sm }]} accessible accessibilityLabel={age ? fill(st.allClearAge, { age }) : st.allClear}>
      <Dot color={colors.success} />
      <Text style={type.subhead}>{age ? fill(st.allClearAge, { age }) : st.allClear}</Text>
    </View>;
  }
  return <View>
    <View style={pad}><SectionTitle title={st.attention} /></View>
    {items.map((item, index) => {
      const text = attentionText(item, t, st, now, locale);
      const page = pageOf(item);
      const app = item.kind === 'security' ? item.summary ? undefined : dsmApps.security : item.kind === 'backup' ? dsmApps.backup : item.kind === 'temperature' || item.kind === 'system' ? undefined : dsmApps.storage;
      const open = page && onPage ? () => onPage(page) : app ? onOpenApp?.(app) : undefined;
      const color = levelColor(item.level);
      const body = <>
        <Icon name={text.icon} size={20} color={color} />
        <Text style={[type.body, { flexShrink: 1 }]} numberOfLines={1}>{text.title}</Text>
        {/* A long detail such as a failed backup's time wraps between its parts rather than losing its end */}
        <View style={{ flex: 1, flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
          {text.detail.split(' · ').map((part, i, parts) => <Text key={i} style={[type.subhead, { color }]}>{i < parts.length - 1 ? `${part} · ` : part}</Text>)}
        </View>
        {open ? <Icon name="chevron-right" size={18} color={colors.tertiary} /> : null}
      </>;
      const style = { minHeight: 44, paddingHorizontal: layout.gutter, paddingVertical: spacing.xs, flexDirection: 'row' as const, alignItems: 'center' as const, gap: spacing.sm };
      return <View key={`${item.kind}-${'id' in item ? item.id : index}`}>
        {index ? <Separator inset={layout.gutter + 28} /> : null}
        {open ? <Pressable onPress={open} accessibilityRole="button" accessibilityLabel={`${text.title}, ${text.detail}`} style={({ pressed }) => [style, { backgroundColor: pressed ? colors.pressed : 'transparent' }]}>{body}</Pressable>
          : <View style={style} accessible accessibilityLabel={`${text.title}, ${text.detail}`}>{body}</View>}
      </View>;
    })}
  </View>;
}

/** U10. Volume: name and fill on top, a bar across the whole row under it (no track) */
export function VolumeRow({ volume, t }: { volume: Volume; t: Strings }) {
  const state = volume.state ? t[`vol_${volume.state}`] : undefined;
  const p = volumePercent(volume), color = capacityColor(volume);
  return <View style={[pad, { gap: spacing.xs, paddingVertical: spacing.xs }]} accessible accessibilityLabel={`${volume.name}${state ? `, ${state}` : ''}, ${percent(p)}, ${formatBytes(volume.used)} / ${formatBytes(volume.total)}`}>
    <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: spacing.sm }}>
      <Text style={[type.body, { flexShrink: 1 }]} numberOfLines={1}>{volume.name}</Text>
      {state ? <Text style={[type.caption, { color: colors.danger }]}>{state}</Text> : null}
      <Text style={[type.headline, { color: color === colors.accent ? colors.label : color, fontVariant: ['tabular-nums'] }]}>{percent(p)}</Text>
      <Text style={[type.caption, { flex: 1, textAlign: 'right', fontVariant: ['tabular-nums'] }]} numberOfLines={1}>{`${formatBytes(volume.used)} / ${formatBytes(volume.total)}`}</Text>
    </View>
    <Meter value={p} color={color} height={4} min={4} />
  </View>;
}
const HOT = 60;
/** U11. Drive: "1 · WD5003ABYX · 466 GB · 34 °C · ● Healthy" on one line; reads and writes stay in the detail */
export function DiskRow({ disk, t, onPress }: { disk: Disk; t: Strings; onPress?(): void }) {
  const color = disk.status === 'danger' ? colors.danger : disk.status === 'warning' ? colors.warning : colors.success;
  const parts = [disk.model ?? disk.name, formatBytes(disk.size)];
  const label = [disk.order, ...parts, disk.temp !== undefined ? `${disk.temp} °C` : '', t[`disk_${disk.status}`]].filter(Boolean).join(', ');
  const body = <>
    <Text style={[type.caption, { width: 16, textAlign: 'center', fontVariant: ['tabular-nums'] }]}>{disk.order}</Text>
    <Text style={[type.body, { flex: 1 }]} numberOfLines={1}>{parts.join(' · ')}</Text>
    {disk.temp !== undefined ? <Text style={[type.subhead, { fontVariant: ['tabular-nums'] }, disk.temp >= HOT && { color: chart.hot }]}>{`${disk.temp} °C`}</Text> : null}
    <Dot color={color} />
    <Text style={[type.subhead, disk.status !== 'normal' && { color }]} numberOfLines={1}>{t[`disk_${disk.status}`]}</Text>
    {onPress ? <Icon name="chevron-right" size={18} color={colors.tertiary} /> : null}
  </>;
  const style = { minHeight: 44, paddingHorizontal: layout.gutter, flexDirection: 'row' as const, alignItems: 'center' as const, gap: spacing.sm };
  return onPress ? <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={label} style={({ pressed }) => [style, { backgroundColor: pressed ? colors.pressed : 'transparent' }]}>{body}</Pressable>
    : <View style={style} accessible accessibilityLabel={label}>{body}</View>;
}
/** Every drive, problems first (the storage page) */
export function DiskRows({ state, t, onDisk }: { state: StatusState; t: Strings; onDisk?(disk: Disk): void }) {
  return <DiskList disks={disksByNeed(state.snapshot?.health?.disks ?? [])} t={t} onDisk={onDisk} />;
}
function DiskList({ disks, t, onDisk }: { disks: Disk[]; t: Strings; onDisk?(disk: Disk): void }) {
  return <>{disks.map((disk, index) => <View key={disk.id}>{index ? <Separator inset={layout.gutter + 24} /> : null}<DiskRow disk={disk} t={t} onPress={onDisk ? () => onDisk(disk) : undefined} /></View>)}</>;
}
/** "N more" under a shortened list; opens the full list */
function MoreRow({ text, onPress }: { text: string; onPress?(): void }) {
  const body = <><Text style={[type.subhead, { flex: 1, color: onPress ? colors.accent : colors.secondary }]} numberOfLines={1}>{text}</Text>{onPress ? <Icon name="chevron-right" size={18} color={colors.tertiary} /> : null}</>;
  const style = { minHeight: 36, paddingHorizontal: layout.gutter, flexDirection: 'row' as const, alignItems: 'center' as const, gap: spacing.sm };
  return onPress ? <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={text} style={({ pressed }) => [style, { backgroundColor: pressed ? colors.pressed : 'transparent' }]}>{body}</Pressable>
    : <View style={style}>{body}</View>;
}

function poolLevelText(pool: Pool, st: StatusStrings) {
  return pool.raw && pool.level === 'unknown' ? fill(st.unknownStatus, { raw: pool.raw }) : pool.level === 'unknown' ? st.unknown : st[`pool_${pool.level as Exclude<Level, 'unknown'>}`];
}
/** Overall storage verdict: the worst of pools, volumes and drives */
function storageLevel(state: StatusState): 'normal' | 'warning' | 'danger' {
  const s = state.snapshot;
  const levels = [...(s?.pools ?? []).map(p => p.level === 'unknown' ? 'warning' : p.level), ...(s?.volumes ?? []).map(v => v.state ? 'danger' : v.status), ...(s?.health?.disks ?? []).map(d => d.status)];
  return levels.includes('danger') ? 'danger' : levels.includes('warning') ? 'warning' : 'normal';
}
const levelRank = (level: Level) => level === 'danger' ? 3 : level === 'warning' ? 2 : level === 'unknown' ? 1 : 0;
/**
 * D. Storage. The overview keeps a fixed height however many volumes and
 * drives there are: the verdict, up to three volumes (problems first, then
 * the fullest), "N drives · all healthy" or the drives with a problem (up to
 * three), and "N more" rows that open the storage page. `full` is that page:
 * each pool with its volumes, then every drive, problems first in both.
 */
export function StorageSection({ state, t, onOpenApp, onPage, onDisk, full, age }: Common & { onPage?(page: GlancePage): void; onDisk?(disk: Disk): void; full?: boolean; age?: string }) {
  const st = statusStrings(t), s = state.snapshot;
  const fallback = fallbackFor(state, 'storage', t.storage, dsmApps.storage, t, onOpenApp);
  const volumes = s?.volumes ?? [], pools = s?.pools ?? [], disks = s?.health?.disks ?? [];
  if (fallback && !disks.length) return fallback;
  if (!volumes.length && !disks.length) return null;
  const level = storageLevel(state);
  const verdict = <View style={[pad, { flexDirection: 'row', alignItems: 'center', gap: spacing.sm }]}>
    <Dot color={levelColor(level)} />
    <Text style={type.subhead} numberOfLines={1}>{[t[`disk_${level}`], !pools.length ? '' : full ? (pools.length === 1 ? fill(st.poolSummaryOne, { disks: disks.length }) : fill(st.poolSummary, { pools: pools.length, disks: disks.length })) : pools.length === 1 ? st.poolsOne : fill(st.poolsCount, { count: pools.length })].filter(Boolean).join(' · ')}</Text>
  </View>;
  if (!full) {
    const sum = storageSummary(volumes, disks), page = onPage ? () => onPage('storage') : undefined;
    const worst = sum.bad[0]?.status ?? 'normal';
    const drives = [sum.disks === 1 ? st.drivesOne : fill(st.drivesCount, { count: sum.disks }), sum.badCount ? fill(st.drivesBad, { count: sum.badCount }) : sum.disks === 1 ? t.disk_normal : st.drivesGood].join(' · ');
    return <View style={{ gap: spacing.xs }}>
      <View style={pad}><SectionTitle title={t.storage} age={age} onPress={page} /></View>
      {verdict}
      {sum.volumes.map(volume => <VolumeRow key={volume.id} volume={volume} t={t} />)}
      {sum.moreVolumes ? <MoreRow text={fill(st.moreVolumesShort, { count: sum.moreVolumes })} onPress={page} /> : null}
      {fallback}
      {sum.disks ? <View>
        <View style={[pad, { minHeight: 32, flexDirection: 'row', alignItems: 'center', gap: spacing.sm }]} accessible accessibilityLabel={drives}>
          <Dot color={levelColor(worst)} />
          <Text style={type.subhead} numberOfLines={1}>{drives}</Text>
        </View>
        <DiskList disks={sum.bad} t={t} onDisk={onDisk} />
        {sum.moreBad ? <MoreRow text={fill(st.moreDrives, { count: sum.moreBad })} onPress={page} /> : null}
      </View> : null}
    </View>;
  }
  const grouped = [...pools].sort((x, y) => levelRank(y.level) - levelRank(x.level) || x.order - y.order)
    .map(pool => ({ pool, volumes: volumesByNeed(volumes.filter(v => v.pool === pool.id || pool.volumes.includes(v.id))) }));
  const loose = volumesByNeed(volumes.filter(v => !grouped.some(g => g.volumes.includes(v))));
  return <View style={{ gap: spacing.xs }}>
    {verdict}
    {grouped.map(({ pool, volumes: list }) => <View key={pool.id} style={{ gap: spacing.xxs }}>
      <Text style={[type.caption, pad, { paddingTop: spacing.xs }]} numberOfLines={1}>
        {[fill(st.pool, { order: pool.order }), pool.raid, pool.level !== 'normal' ? poolLevelText(pool, st) : ''].filter(Boolean).join(' · ')}
      </Text>
      {list.map(volume => <VolumeRow key={volume.id} volume={volume} t={t} />)}
    </View>)}
    {loose.map(volume => <VolumeRow key={volume.id} volume={volume} t={t} />)}
    {fallback}
    {disks.length ? <View style={{ paddingTop: spacing.sm }}>
      <View style={pad}><SectionTitle title={t.drives} /></View>
      <DiskRows state={state} t={t} onDisk={onDisk} />
    </View> : null}
    <View style={{ paddingTop: spacing.sm, gap: spacing.xxs }}>
      <Text style={[type.caption, pad]}>{st.storageInDsm}</Text>
      <OpenInDsm app={dsmApps.storage} t={t} onOpenApp={onOpenApp} />
    </View>
  </View>;
}

const securityColor = (level: SecurityLevel) => level === 'danger' ? colors.danger : level === 'risk' || level === 'warning' || level === 'outOfDate' ? colors.warning : level === 'unknown' ? colors.tertiary : colors.success;
/**
 * B. Security Advisor: the verdict and the last scan; `full` lists each
 * category. Scanning and ignoring rules stay in DSM.
 */
export function SecuritySection({ state, t, now, locale, onOpenApp, onPage, full, age }: Common & { onPage?(page: GlancePage): void; full?: boolean; age?: string }) {
  const st = statusStrings(t), sec = state.snapshot?.security;
  const fallback = fallbackFor(state, 'security', st.app_security, dsmApps.security, t, onOpenApp);
  if (fallback) return fallback;
  if (!sec || moduleState(state.snapshot, 'security') === 'hidden') return null;
  const verdict = sec.raw ? fill(st.unknownStatus, { raw: sec.raw }) : st[`sec_${sec.level}`];
  const detail = [sec.running ? st.scanning : sec.issues ? (sec.issues === 1 ? st.att_securityOne : fill(st.att_security, { count: sec.issues })) : '', sec.lastScan ? fill(st.lastScan, { age: ageLabel(sec.lastScan * 1000, now, st, locale) }) : ''].filter(Boolean).join(' · ');
  return <View style={{ gap: spacing.xs }}>
    {/* On its own page the top bar already names it; the same holds for Storage and Backup */}
    {full ? null : <View style={pad}><SectionTitle title={st.app_security} age={age} onPress={onPage ? () => onPage('security') : undefined} /></View>}
    <View style={[pad, { flexDirection: 'row', alignItems: 'center', gap: spacing.sm }]}>
      <Dot color={securityColor(sec.level)} />
      <Text style={[type.body, { flexShrink: 0 }]}>{verdict}</Text>
      {detail ? <Text style={[type.subhead, { flex: 1 }]} numberOfLines={1}>{detail}</Text> : null}
    </View>
    {full ? <View style={{ paddingTop: spacing.xs }}>
      {sec.categories.map((cat, index) => {
        const fails = FAIL_KINDS.filter(kind => cat.counts[kind] > 0).map(kind => fill(st[`fail_${kind}`], { count: cat.counts[kind] }));
        const name = st[`cat_${cat.id}` as keyof StatusStrings] ?? cat.id;
        const text = fails.length ? fails.join(' · ') : cat.level === 'unknown' ? (cat.raw ? fill(st.unknownStatus, { raw: cat.raw }) : st.unknown) : st.catClear;
        return <View key={cat.id}>
          {index ? <Separator inset={layout.gutter} /> : null}
          <View style={{ minHeight: 44, paddingHorizontal: layout.gutter, flexDirection: 'row', alignItems: 'center', gap: spacing.sm }} accessible accessibilityLabel={`${name}, ${text}`}>
            <Text style={[type.body, { flex: 1 }]} numberOfLines={1}>{name}</Text>
            <Text style={[type.subhead, fails.length ? { color: securityColor(cat.level) } : null]} numberOfLines={1}>{text}</Text>
          </View>
        </View>;
      })}
      <View style={{ paddingTop: spacing.sm }}><OpenInDsm app={dsmApps.security} t={t} onOpenApp={onOpenApp} /></View>
    </View> : null}
  </View>;
}

function taskText(task: BackupTask, t: Strings, st: StatusStrings, now: number, locale: string) {
  const labels = { today: t.today, yesterday: t.yesterday, tomorrow: st.tomorrow };
  const result = task.running ? st.bk_running : task.result === 'unknown' && task.raw ? fill(st.unknownStatus, { raw: task.raw }) : st[`bk_${task.result}`];
  const last = task.last && !task.running ? whenLabel(task.last, now, labels, locale) : '';
  const next = task.next ? fill(st.nextRun, { time: whenLabel(task.next, now, labels, locale) }) : '';
  return { result, detail: [last, next].filter(Boolean).join(' · ') };
}
const taskColor = (task: BackupTask) => task.running ? colors.accent : task.result === 'failed' ? colors.danger : task.result === 'partial' || task.result === 'unknown' ? colors.warning : task.result === 'success' ? colors.success : colors.tertiary;
const taskIcon = (task: BackupTask): IconName => task.running ? 'sync' : task.result === 'failed' ? 'cancel' : task.result === 'success' ? 'check-circle' : task.result === 'never' ? 'radio-button-unchecked' : 'error-outline';
/**
 * C. Hyper Backup: one row per task with its last result and next run. Only
 * on a NAS with Hyper Backup; the overview shows at most `limit` tasks.
 */
export function BackupSection({ state, t, now, locale, onOpenApp, onPage, full, age, limit = 4 }: Common & { onPage?(page: GlancePage): void; full?: boolean; age?: string; limit?: number }) {
  const st = statusStrings(t), tasks = state.snapshot?.backups?.tasks;
  const fallback = fallbackFor(state, 'backup', st.backup, dsmApps.backup, t, onOpenApp);
  if (fallback) return fallback;
  if (!tasks?.length || moduleState(state.snapshot, 'backup') === 'hidden') return null;
  // Failures first, so a long task list never hides one
  const rank = (task: BackupTask) => task.result === 'failed' ? 0 : task.result === 'partial' ? 1 : task.running ? 2 : 3;
  const shown = full ? tasks : [...tasks].sort((a, b) => rank(a) - rank(b)).slice(0, limit);
  return <View style={{ gap: spacing.xxs }}>
    {full ? null : <View style={pad}><SectionTitle title={st.backup} age={age} onPress={onPage && tasks.length > shown.length ? () => onPage('backup') : undefined} /></View>}
    {shown.map((task, index) => {
      const text = taskText(task, t, st, now, locale), color = taskColor(task);
      return <View key={task.id}>
        {index ? <Separator inset={layout.gutter + 28} /> : null}
        <View style={{ minHeight: 44, paddingHorizontal: layout.gutter, paddingVertical: spacing.xs, flexDirection: 'row', alignItems: 'center', gap: spacing.sm }} accessible accessibilityLabel={`${task.name}, ${text.result}${text.detail ? `, ${text.detail}` : ''}`}>
          <Icon name={taskIcon(task)} size={20} color={color} />
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={type.body} numberOfLines={1}>{task.name}</Text>
            <Text style={type.caption} numberOfLines={1}><Text style={{ color }}>{text.result}</Text>{text.detail ? ` · ${text.detail}` : ''}</Text>
          </View>
        </View>
      </View>;
    })}
    <OpenInDsm app={dsmApps.backup} t={t} onOpenApp={onOpenApp} />
  </View>;
}
