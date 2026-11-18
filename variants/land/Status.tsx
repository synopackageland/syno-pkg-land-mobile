import { useEffect, useState } from 'react';
import { ActivityIndicator, BackHandler, ScrollView, Text, View } from 'react-native';
import type { NasProfile } from '../../src/core/config';
import { fill, type Strings } from '../../src/core/i18n/strings';
import { statusStrings } from '../../src/core/i18n/status-strings';
import { moduleState, type StatusState } from '../../src/core/status/model';
import type { Disk } from '../../src/core/status/mappers';
import { formatBytes, formatRate, percent, usedOfTotal } from '../../src/core/status/format';
import { readouts } from '../../src/core/status/calm';
import { dsmApps } from '../../src/core/status/modules';
import { HISTORY_RANGES, type HistoryRange } from '../../src/core/status/modules/history';
import { ageOf, NasLine, OfflineLine, temperatureOf, trendOf } from './HomeCards';
import { AttentionBlock, BackupSection, FallbackRow, OpenInDsm, SecuritySection, StorageSection, type GlancePage, type OpenApp } from './Glance';
import { LIVE, scaleOf } from '../../src/core/status/live';
import { BigStat, Dot, LiveSpark, SectionTitle, Segments, Spark, Stat, ReadoutText } from './StatusParts';
import { Icon, IconButton, Separator, Sheet, TopBar, useBarInsets } from './ui';
import { chart, colors, layout, spacing, type } from './theme';
import { PullRefresh } from './PullRefresh';

/** Where the status opens; 'drives' (the home storage tile) opens the storage page */
export type StatusTab = 'overview' | 'cpu' | 'memory' | 'network' | 'drives' | GlancePage;
type Page = 'cpu' | 'memory' | 'network' | GlancePage;
type Props = {
  profile: NasProfile; state: StatusState; t: Strings; locale: string; now: number; onBack(): void; onRefresh(): void; initialTab?: StatusTab;
  /** A DSM App by its launchApp id; rows that change settings go there */
  onOpenApp?: OpenApp;
  /** Reads DSM's own resource history for a range */
  onHistory?(range: HistoryRange): void;
};
const pageOf = (tab: StatusTab | undefined): Page | undefined => tab === 'drives' ? 'storage' : tab === 'overview' || !tab ? undefined : tab;
const pad = { paddingHorizontal: layout.gutter };
const linkId = (id: string) => id.replace(/^ovs_/, '');

/**
 * U9. The NAS status as one page of sections: summary and attention, CPU,
 * memory, network, storage, drives, security and backup. A section opens its
 * detail page; the hardware back key returns to the sections first.
 */
export function StatusScreen({ profile, state, t, locale, now, onBack, onRefresh, initialTab, onOpenApp, onHistory }: Props) {
  const bars = useBarInsets();
  const st = statusStrings(t);
  const [page, setPage] = useState<Page | undefined>(pageOf(initialTab));
  const [disk, setDisk] = useState<Disk>();
  useEffect(() => {
    if (!page) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => { setPage(undefined); return true; });
    return () => sub.remove();
  }, [page]);
  const titles: Record<Page, string> = { cpu: t.cpu, memory: t.memory, network: t.network, storage: t.storage, security: st.app_security, backup: st.backup };
  const common = { state, t, now, locale, onOpenApp };
  const body = page === 'cpu' || page === 'memory' ? <ResourcePage kind={page} {...common} onHistory={onHistory} />
    : page === 'network' ? <NetworkPage state={state} t={t} />
    : page === 'storage' ? <StorageSection {...common} full onDisk={setDisk} age={ageOf(state, ['storage', 'health'], 'status', now, t, locale)} />
    : page === 'security' ? <SecuritySection {...common} full age={ageOf(state, 'security', 'status', now, t, locale)} />
    : page === 'backup' ? <BackupSection {...common} full age={ageOf(state, 'backup', 'status', now, t, locale)} />
    : <Sections {...common} onPage={setPage} onDisk={setDisk} />;
  return <View style={{ flex: 1, backgroundColor: colors.background }}>
    <ScrollView contentContainerStyle={{ paddingTop: bars.top + spacing.sm, paddingBottom: bars.bottom + spacing.xl, gap: spacing.md }}
      refreshControl={<PullRefresh busy={state.refreshing} onRefresh={onRefresh} offset={bars.top} />}>
      <OfflineLine state={state} t={t} locale={locale} onRetry={onRefresh} />
      {body}
    </ScrollView>
    <TopBar left={<IconButton icon="arrow-back" label={t.back} onPress={() => page ? setPage(undefined) : onBack()} />} title={page ? titles[page] : profile.name} />
    <DiskSheet disk={disk} state={state} t={t} onClose={() => setDisk(undefined)} />
  </View>;
}

function Sections({ state, t, now, locale, onOpenApp, onPage, onDisk }: { state: StatusState; t: Strings; now: number; locale: string; onOpenApp?: OpenApp; onPage(page: Page): void; onDisk(disk: Disk): void }) {
  const s = state.snapshot, util = s?.util, temp = temperatureOf(s);
  const common = { state, t, now, locale, onOpenApp };
  const cpu = trendOf(s, 'cpu'), memory = trendOf(s, 'memory'), rx = trendOf(s, 'rx'), tx = trendOf(s, 'tx');
  const utilFallback = moduleState(s, 'util');
  const waiting = !s?.health && !util;
  return <>
    <NasLine state={state} t={t} now={now} locale={locale} />
    <AttentionBlock {...common} onPage={onPage} />
    {waiting ? <View style={{ alignItems: 'center', paddingVertical: spacing.xl }}><ActivityIndicator color={colors.accent} /></View> : null}
    {util?.cpu || util?.memory ? <View style={[pad, { gap: spacing.xs }]}>
      <SectionTitle title={t.resources} age={ageOf(state, 'util', 'status', now, t, locale)} />
      <View style={{ flexDirection: 'row', gap: spacing.lg }}>
        {util.cpu ? <BigStat label={t.cpu} value={percent(util.cpu.percent)} amount={util.cpu.percent} readout={readouts.percent} points={cpu} max={100} color={chart.cpu} onPress={() => onPage('cpu')} /> : null}
        {util.memory ? <BigStat label={t.memory} value={percent(util.memory.percent)} amount={util.memory.percent} readout={readouts.percent} sub={usedOfTotal(util.memory.used, util.memory.total)} points={memory} max={100} color={chart.memory} onPress={() => onPage('memory')} /> : null}
      </View>
    </View> : utilFallback === 'unsupported' ? <FallbackRow title={t.resources} reason="unsupported" app={dsmApps.resource} t={t} onOpenApp={onOpenApp} /> : null}
    {util?.network ? <View style={[pad, { gap: spacing.xs }]}>
      <SectionTitle title={t.network} onPress={() => onPage('network')} />
      <View style={{ flexDirection: 'row', gap: spacing.lg }}>
        <BigStat label={`↑ ${t.upload}`} value={formatRate(util.network.tx)} amount={util.network.tx} readout={readouts.rate} points={tx} color={chart.up} onPress={() => onPage('network')} />
        <BigStat label={`↓ ${t.download}`} value={formatRate(util.network.rx)} amount={util.network.rx} readout={readouts.rate} points={rx} color={chart.down} onPress={() => onPage('network')} />
      </View>
    </View> : null}
    {util?.disk || temp.value !== undefined ? <View style={pad}>
      {util?.disk ? <Stat label={`${t.drives} · ${t.read} / ${t.write}`} value={`${formatRate(util.disk.read)} / ${formatRate(util.disk.write)}`} /> : null}
      {temp.value !== undefined ? <Stat label={t.temperature} value={`${temp.value} °C${temp.warning ? ` · ${t.tempHigh}` : ''}`} /> : null}
    </View> : null}
    {/* Volumes and drives as a fixed-height summary; the storage page lists them all */}
    <StorageSection {...common} onPage={onPage} onDisk={onDisk} age={ageOf(state, ['storage', 'health'], 'status', now, t, locale)} />
    <SecuritySection {...common} onPage={onPage} age={ageOf(state, 'security', 'status', now, t, locale)} />
    <BackupSection {...common} onPage={onPage} age={ageOf(state, 'backup', 'status', now, t, locale)} />
  </>;
}

type Range = 'live' | HistoryRange;
/**
 * CPU or memory: the live trend (saved with times, so it continues across
 * visits as one unbroken, steadily scrolling line) or DSM's own history for
 * a week to a year.
 */
function ResourcePage({ kind, state, t, now, locale, onOpenApp, onHistory }: { kind: 'cpu' | 'memory'; state: StatusState; t: Strings; now: number; locale: string; onOpenApp?: OpenApp; onHistory?(range: HistoryRange): void }) {
  const st = statusStrings(t), s = state.snapshot;
  const [range, setRange] = useState<Range>('live');
  const cpu = s?.util?.cpu, m = s?.util?.memory, o = s?.overview;
  const value = kind === 'cpu' ? cpu?.percent : m?.percent;
  const color = kind === 'cpu' ? chart.cpu : chart.memory;
  const live = trendOf(s, kind);
  const history = s?.history?.range === range ? s.history : undefined;
  const historyState = moduleState(s, 'history');
  const pickRange = (next: Range) => { setRange(next); if (next !== 'live') onHistory?.(next); };
  const ranges: { key: Range; label: string }[] = [{ key: 'live', label: st.live }, ...(onHistory ? HISTORY_RANGES.map(key => ({ key, label: st[`range_${key}`] })) : [])];
  if (value === undefined) return <View style={{ alignItems: 'center', paddingVertical: spacing.xl }}><ActivityIndicator color={colors.accent} /></View>;
  return <>
    <View style={[pad, { gap: spacing.sm }]}>
      <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: spacing.sm }}>
        <ReadoutText value={value} readout={readouts.percent} style={{ fontSize: 34, lineHeight: 40, fontWeight: '600', color: colors.label, fontVariant: ['tabular-nums'] }} />
        {kind === 'memory' && m ? <Text style={type.subhead}>{usedOfTotal(m.used, m.total)}</Text> : null}
        <Text style={[type.caption, { flex: 1, textAlign: 'right', color: colors.tertiary }]}>{ageOf(state, 'util', 'status', now, t, locale) ?? ''}</Text>
      </View>
      {ranges.length > 1 ? <Segments items={ranges} value={range} onChange={pickRange} /> : null}
      {range === 'live' ? <LiveSpark points={live} max={100} color={color} height={72} thickness={2} span={LIVE.span * 2} />
        : historyState === 'disabled' || historyState === 'unsupported' ? <FallbackRow title={st[`range_${range}`]} reason={historyState} app={dsmApps.resource} t={t} onOpenApp={onOpenApp} />
        : history ? <>
          <Spark values={history[kind]} max={100} color={color} height={72} thickness={1.5} />
          {history[kind].every(v => v === null) ? <Text style={type.caption}>{st.noHistory}</Text> : null}
        </> : state.historyLoading ? <ActivityIndicator color={colors.accent} /> : <View style={{ height: 72 }} />}
    </View>
    <View style={pad}>
      {kind === 'cpu' && cpu ? <>
        <Stat label={t.userLoad} value={percent(cpu.user)} />
        <Stat label={t.systemLoad} value={percent(cpu.system)} />
        <Stat label={t.otherLoad} value={percent(cpu.other)} />
        {cpu.load1 !== undefined ? <Stat label={t.loadAverage} value={[cpu.load1, cpu.load5, cpu.load15].map(v => v?.toFixed(2) ?? '-').join(' · ')} /> : null}
        {o?.cpuName ? <Stat label={t.model} value={o.cores ? `${o.cpuName} · ${fill(t.cores, { count: o.cores })}` : o.cpuName} /> : null}
      </> : null}
      {kind === 'memory' && m ? <>
        <Stat label={t.used} value={formatBytes(m.used)} color={chart.memory} />
        <Stat label={t.total} value={formatBytes(m.total)} />
        {m.cached ? <Stat label={t.cached} value={formatBytes(m.cached)} /> : null}
        {m.buffer ? <Stat label={t.buffer} value={formatBytes(m.buffer)} /> : null}
        {m.swapTotal ? <Stat label={t.swap} value={`${percent(m.swapPercent)} · ${formatBytes(m.swapTotal)}`} /> : null}
      </> : null}
    </View>
    <OpenInDsm app={dsmApps.resource} t={t} onOpenApp={onOpenApp} />
  </>;
}

function NetworkPage({ state, t }: { state: StatusState; t: Strings }) {
  const s = state.snapshot, net = s?.util?.network;
  if (!net) return <View style={{ alignItems: 'center', paddingVertical: spacing.xl }}><ActivityIndicator color={colors.accent} /></View>;
  const links = new Map((s?.health?.links ?? []).map(link => [linkId(link.id), link]));
  const rx = trendOf(s, 'rx'), tx = trendOf(s, 'tx');
  // One scale for both directions, over the samples kept
  const max = Math.max(scaleOf(rx, -Infinity), scaleOf(tx, -Infinity));
  return <>
    <View style={[pad, { flexDirection: 'row', gap: spacing.lg }]}>
      <BigStat label={`↑ ${t.upload}`} value={formatRate(net.tx)} amount={net.tx} readout={readouts.rate} points={tx} max={max} color={chart.up} />
      <BigStat label={`↓ ${t.download}`} value={formatRate(net.rx)} amount={net.rx} readout={readouts.rate} points={rx} max={max} color={chart.down} />
    </View>
    <View>
      <View style={pad}><SectionTitle title={t.interfaces} /></View>
      {net.interfaces.map((row, index) => {
        const link = links.get(row.id);
        return <View key={row.id}>
          {index ? <Separator inset={layout.gutter} /> : null}
          <View style={{ minHeight: 48, paddingHorizontal: layout.gutter, flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
            <Dot color={link?.up === false ? colors.tertiary : colors.success} />
            <View style={{ flex: 1 }}>
              <Text style={type.body}>{row.id}</Text>
              {link?.up === false || link?.speed ? <Text style={type.caption}>{link?.up === false ? t.linkDown : `${link!.speed! >= 1000 ? `${link!.speed! / 1000} Gbps` : `${link!.speed} Mbps`}`}</Text> : null}
            </View>
            <View style={{ alignItems: 'flex-end' }}>
              <Text style={[type.caption, { color: colors.label, fontVariant: ['tabular-nums'] }]}>↑ {formatRate(row.tx)}</Text>
              <Text style={[type.caption, { color: colors.label, fontVariant: ['tabular-nums'] }]}>↓ {formatRate(row.rx)}</Text>
            </View>
          </View>
        </View>;
      })}
    </View>
  </>;
}

/** U12. Drive detail: every label on its own row with its value, status and interface apart */
export function DiskSheet({ disk, state, t, onClose }: { disk?: Disk; state: StatusState; t: Strings; onClose(): void }) {
  const st = statusStrings(t);
  const live = disk ? state.snapshot?.health?.disks.find(d => d.id === disk.id) ?? disk : undefined;
  const rw = live ? state.snapshot?.util?.disk?.disks.find(row => row.id === live.id) : undefined;
  return <Sheet visible={Boolean(disk)} onClose={onClose} label={t.close}>
    {live ? <View style={{ paddingHorizontal: layout.gutter, paddingBottom: spacing.md, gap: spacing.xs }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingBottom: spacing.sm }}>
        <Icon name={live.ssd ? 'sd-storage' : 'album'} size={28} color={colors.accent} />
        <Text style={[type.title, { flex: 1 }]} accessibilityRole="header">{live.name}</Text>
      </View>
      <Stat label={st.status} value={t[`disk_${live.status}`]} color={live.status === 'normal' ? colors.success : live.status === 'warning' ? colors.warning : colors.danger} />
      {live.model ? <Stat label={t.model} value={live.model} /> : null}
      <Stat label={t.size} value={formatBytes(live.size)} />
      {live.type ? <Stat label={st.type} value={live.type} /> : null}
      {live.temp !== undefined ? <Stat label={t.temperature} value={`${live.temp} °C`} /> : null}
      {live.vendor ? <Stat label={t.vendor} value={live.vendor} /> : null}
      {live.firmware ? <Stat label={t.firmware} value={live.firmware} /> : null}
      {live.location ? <Stat label={t.location} value={live.location} /> : null}
      {rw ? <Stat label={t.busy} value={percent(rw.busy)} /> : null}
      {rw ? <Stat label={t.read} value={formatRate(rw.read)} color={chart.read} /> : null}
      {rw ? <Stat label={t.write} value={formatRate(rw.write)} color={chart.write} /> : null}
    </View> : null}
  </Sheet>;
}
