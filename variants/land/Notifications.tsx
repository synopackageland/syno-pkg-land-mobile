import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, Text, View } from 'react-native';
import { causeText, fill, type Strings } from '../../src/core/i18n/strings';
import { isUnread, unreadCount, type StatusState } from '../../src/core/status/model';
import { formatNotice, noticeApp, type Notice } from '../../src/core/status/mappers';
import { dayKey, dayLabel, timeLabel } from '../../src/core/status/format';
import { EmptyState, Icon, IconButton, TextButton, TopBar, useBarInsets, type IconName } from './ui';
import { colors, layout, radius, spacing, type } from './theme';
import { PullRefresh } from './PullRefresh';
import { OfflineLine } from './HomeCards';

type Level = Notice['level'];
export type NoticeFilter = 'all' | Level;
type LauncherApp = { id: string; name: string };
/** An item row: one notice, or the same notice repeated on one day, collapsed under the newest */
type Item<A> = { kind: 'item'; key: string; notice: Notice; notices: Notice[]; title: string; message: string; level: Level; unread: boolean; app?: A };
type Entry<A> = { kind: 'section'; key: string; label: string } | Item<A>;
const levelIcon: Record<Level, { icon: IconName; color: string; bg: string }> = {
  error: { icon: 'error-outline', color: colors.danger, bg: colors.dangerSoft },
  warning: { icon: 'warning-amber', color: colors.warning, bg: colors.warningSoft },
  info: { icon: 'notifications-none', color: colors.accent, bg: colors.accentSoft },
};
const filters: NoticeFilter[] = ['all', 'error', 'warning', 'info'];
const noApps: readonly never[] = [];
/** Member times of a collapsed row, equal minutes merged: 23:12 · 23:05 ×13 */
export function runTimes(notices: Notice[], locale: string): string {
  const runs: { label: string; count: number }[] = [];
  for (const n of notices) {
    const label = timeLabel(n.time, locale), last = runs[runs.length - 1];
    if (last?.label === label) last.count++; else runs.push({ label, count: 1 });
  }
  return runs.map(r => r.count > 1 ? `${r.label} ×${r.count}` : r.label).join(' · ');
}
type Props<A extends LauncherApp> = {
  state: StatusState; t: Strings; locale: string; now: number; apps?: readonly A[];
  onBack?: () => void; onRefresh(): Promise<void> | void; onMore(): void; onRead(ids: number[]): void; onReadAll(): void; onOpenApp?(app: A): void;
};

/**
 * DSM's notification list, newest first: New (after the read mark) and Earlier, filtered by level.
 * The same notice repeated on one day shares one row (×N); an opened row shows the full text and,
 * when the account can open it, the App that raised it
 */
/** Fewer rows than this (sections included) load the next page without a scroll */
const FILL_ROWS = 12;
export function Notifications<A extends LauncherApp>({ state, t, locale, now, apps = noApps, onBack, onRefresh, onMore, onRead, onReadAll, onOpenApp }: Props<A>) {
  const bars = useBarInsets();
  const [open, setOpen] = useState<number>();
  const [filter, setFilter] = useState<NoticeFilter>('all');
  const s = state.snapshot, notices = s?.notices;
  const today = dayKey(now / 1000);
  const entries = useMemo<Entry<A>[]>(() => {
    // The read mark DSM and this phone share; rows opened on the phone stay under New until the mark moves
    const mark = Math.max(s?.lastRead ?? 0, state.read.before);
    const sections: Record<'new' | 'earlier', Item<A>[]> = { new: [], earlier: [] };
    const rows = new Map<string, Item<A>>();
    for (const notice of notices?.items ?? []) {
      const text = formatNotice(notice, state.strings);
      if (filter !== 'all' && text.level !== filter) continue;
      const section = notice.time > mark ? 'new' : 'earlier', unread = isUnread(s, state.read, notice);
      const key = [section, dayKey(notice.time), notice.tag, text.title, text.message].join('\u0000');
      const row = rows.get(key);
      if (row) { row.notices.push(notice); row.unread ||= unread; continue; }
      const app = noticeApp(notice, state.strings, apps);
      const item: Item<A> = { kind: 'item', key: `n-${notice.id}`, notice, notices: [notice], ...text, title: text.title || app?.name || 'DSM', unread, ...(app ? { app } : {}) };
      rows.set(key, item); sections[section].push(item);
    }
    const result: Entry<A>[] = [];
    if (sections.new.length) result.push({ kind: 'section', key: 's-new', label: t.noticesNew }, ...sections.new);
    if (sections.earlier.length) result.push({ kind: 'section', key: 's-earlier', label: t.noticesEarlier }, ...sections.earlier);
    return result;
  }, [notices, state.strings, state.read, s?.lastRead, filter, apps, t]);
  // Repeats collapse many notices into a few rows; a list that does not fill the screen never scrolls to its end, so ask for older pages here
  const rowCount = entries.length;
  useEffect(() => { if (notices && rowCount < FILL_ROWS) onMore(); }, [notices?.items.length, rowCount]);
  const unread = unreadCount(s, state.read);
  const when = (notice: Notice) => dayKey(notice.time) === today ? timeLabel(notice.time, locale) : dayLabel(dayKey(notice.time), new Date(now), t, locale);
  const filterLabel: Record<NoticeFilter, string> = { all: t.filterAll, error: t.filterErrors, warning: t.filterWarnings, info: t.filterInfo };
  // A failed refresh keeps the saved list under the status page's offline line, with Retry
  const offline = <OfflineLine state={state} t={t} locale={locale} onRetry={() => void onRefresh()} />;
  const filterBar = notices?.items.length ? <View style={{ flexDirection: 'row', gap: spacing.xs, paddingHorizontal: layout.gutter - spacing.sm, paddingVertical: spacing.xs }} accessibilityRole="tablist">
    {filters.map(value => {
      const selected = filter === value;
      return <Pressable key={value} onPress={() => { setFilter(value); setOpen(undefined); }} accessibilityRole="tab" accessibilityState={{ selected }} accessibilityLabel={filterLabel[value]}
        style={({ pressed }) => ({ minHeight: 32, paddingHorizontal: spacing.md, justifyContent: 'center', borderRadius: radius.full, backgroundColor: selected ? colors.accentSoft : pressed ? colors.pressed : 'transparent' })}>
        <Text style={[type.subhead, { color: selected ? colors.accent : colors.secondary, fontWeight: selected ? '600' : '400' }]}>{filterLabel[value]}</Text>
      </Pressable>;
    })}
  </View> : undefined;
  const header = <View>{offline}{filterBar}</View>;
  const render = ({ item }: { item: Entry<A> }) => {
    if (item.kind === 'section') return <Text style={[type.section, { paddingHorizontal: layout.gutter, paddingTop: spacing.md, paddingBottom: spacing.xs }]} accessibilityRole="header">{item.label}</Text>;
    const level = levelIcon[item.level];
    const expanded = open === item.notice.id;
    const count = item.notices.length, app = item.app;
    const day = dayKey(item.notice.time) === today ? '' : `${dayLabel(dayKey(item.notice.time), new Date(now), t, locale)} `;
    return <Pressable onPress={() => { onRead(item.notices.map(n => n.id)); setOpen(expanded ? undefined : item.notice.id); }} accessibilityRole="button" accessibilityState={{ expanded }}
      accessibilityLabel={[item.title, item.message, when(item.notice), count > 1 ? `×${count}` : ''].filter(Boolean).join(', ')}
      style={({ pressed }) => ({ flexDirection: 'row', gap: spacing.md, paddingHorizontal: layout.gutter, paddingVertical: spacing.sm, backgroundColor: pressed ? colors.pressed : 'transparent' })}>
      <View style={{ width: 32, height: 32, borderRadius: radius.full, backgroundColor: level.bg, alignItems: 'center', justifyContent: 'center' }}>
        <Icon name={level.icon} size={18} color={level.color} />
      </View>
      <View style={{ flex: 1, minWidth: 0, gap: spacing.xxs }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
          <Text style={[item.unread ? type.headline : type.body, { flex: 1 }]} numberOfLines={1}>{item.title}</Text>
          {count > 1 ? <View style={{ paddingHorizontal: 6, borderRadius: radius.full, backgroundColor: colors.grouped }}><Text style={[type.caption, { fontVariant: ['tabular-nums'] }]}>{`×${count}`}</Text></View> : null}
          <Text style={type.caption}>{when(item.notice)}</Text>
          {item.unread ? <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: colors.accent }} /> : null}
        </View>
        {item.message ? <Text style={[type.subhead, { color: item.unread ? colors.label : colors.secondary }]} numberOfLines={expanded ? undefined : 2} selectable={expanded}>{item.message}</Text> : null}
        {expanded && (count > 1 || day) ? <Text style={[type.caption, { fontVariant: ['tabular-nums'] }]}>{day + runTimes(item.notices, locale)}</Text> : null}
        {expanded && app && onOpenApp ? <View style={{ marginLeft: -spacing.md, alignSelf: 'flex-start' }}>
          <TextButton title={fill(t.openInDsm, { name: app.name })} align="start" onPress={() => onOpenApp?.(app)} />
        </View> : null}
      </View>
    </Pressable>;
  };
  const empty = !notices && state.refreshing ? <View style={{ paddingTop: spacing.xxl }}><ActivityIndicator color={colors.accent} /></View>
    : !notices && state.error && !state.signedOut ? <EmptyState icon="cloud-off" tone="warning" title={t.noticesFailed} detail={causeText(t, state.error)}>
      <TextButton title={t.retry} icon="refresh" onPress={() => void onRefresh()} />
    </EmptyState>
    : <EmptyState icon="notifications-none" tone="neutral" title={notices?.items.length ? t.noFilteredNotifications : t.noNotifications} />;
  return <View style={{ flex: 1, backgroundColor: colors.background }}>
    <FlatList data={entries} renderItem={render} keyExtractor={item => item.key} ListHeaderComponent={header}
      contentContainerStyle={{ paddingTop: bars.top, paddingBottom: bars.rawBottom + spacing.xl, flexGrow: 1 }}
      refreshControl={<PullRefresh busy={state.refreshing} onRefresh={onRefresh} offset={bars.top} />}
      onEndReached={onMore} onEndReachedThreshold={0.5}
      ListEmptyComponent={empty}
      ListFooterComponent={state.loadingMore ? <View style={{ padding: spacing.lg }}><ActivityIndicator color={colors.accent} /></View> : undefined} />
    <TopBar left={onBack ? <IconButton icon="arrow-back" label={t.back} onPress={onBack} /> : undefined} title={t.notifications}
      right={unread ? <TextButton title={t.markAllRead} onPress={onReadAll} /> : null} />
  </View>;
}
