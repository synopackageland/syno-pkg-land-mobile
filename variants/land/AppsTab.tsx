import { useEffect, useMemo, useRef, useState } from 'react';
import { AppGrid, TILE_HEIGHT, type Scroller } from './AppGrid';
import { moveApp, orderApps } from '../../src/core/launcher/order';
import { Animated, BackHandler, Text, TextInput, View, useWindowDimensions } from 'react-native';
import type { NasProfile } from '../../src/core/config';
import type { DiscoveredApp } from '../../src/core/discovery/schema';
import type { LauncherState } from '../../src/core/launcher/model';
import { fill, strings } from '../../src/core/i18n/strings';
import { BarContent, EmptyState, IconButton, Skeleton, TextButton, TopBar, useBarInsets, useBlurTarget, useCollapsingBar, type BlurTarget } from './ui';
import { colors, layout, radius, spacing, type } from './theme';
import { Gate, NasTitle, Notices, failedOf } from './TabParts';
import { PullRefresh } from './PullRefresh';

type Item = { kind: 'header'; title: string; key: string } | { kind: 'grid'; apps: DiscoveredApp[]; key: string; arrange: boolean } | { kind: 'empty' };
type Props = {
  state: LauncherState; profile?: NasProfile; busy: boolean; notice?: string; shareWaiting: boolean;
  onAdd(): void; onScan(): void; onSignIn(): void; onRefresh(): void; onSwitch(): void; onDetails(): void;
  onOpen(app: DiscoveredApp): void; onPressIn(): void; onPressOut(): void; onDismissNotice(): void;
  /** Saves a custom order (every App id) for this NAS on this phone */
  onArrange(ids: string[]): void;
  /** Locale for alphabetical fallback ordering */
  language: string;
  /** Shared with the tab bar so both bars blur this list */
  blurTarget?: BlurTarget;
  /** Changes when the selected tab is pressed again: scroll to the top and close search */
  top?: number;
};

/** The Apps tab: Apps with a mobile page, then DSM's desktop Apps. Search lives in the top bar only */
export function AppsTab({ state, profile, busy, notice, shareWaiting, onAdd, onScan, onSignIn, onRefresh, onSwitch, onDetails, onOpen, onPressIn, onPressOut, onDismissNotice, onArrange, language, blurTarget, top }: Props) {
  const t = strings();
  const ownTarget = useBlurTarget(), target = blurTarget ?? ownTarget;
  const bars = useBarInsets();
  const { hidden, onScroll } = useCollapsingBar();
  const { width } = useWindowDimensions();
  const columns = Math.max(4, Math.floor((width - spacing.md * 2) / layout.appColumn));
  const [query, setQuery] = useState('');
  // The bar turns into the search field, so search works from any scroll position
  const [searching, setSearching] = useState(false);
  const closeSearch = () => { setSearching(false); setQuery(''); };
  useEffect(() => {
    if (!searching) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => { closeSearch(); return true; });
    return () => sub.remove();
  }, [searching]);
  const list = useRef<{ scrollToOffset(params: { offset: number; animated?: boolean }): void } | null>(null);
  useEffect(() => { if (top) { closeSearch(); list.current?.scrollToOffset({ offset: 0, animated: true }); } }, [top]);
  // Custom order on this phone, else DSM's main menu order, else alphabetical
  const custom = profile ? state.order?.[profile.id] : undefined;
  const apps = useMemo(() => orderApps(state.apps, language, custom), [state.apps, language, custom]);
  const [dragging, setDragging] = useState(false);
  const scroll = useRef({ y: 0, content: 0, viewport: 0 });
  const scroller = useMemo<Scroller>(() => ({
    autoScroll(delta) {
      const s = scroll.current, next = Math.max(0, Math.min(s.content - s.viewport, s.y + delta));
      const moved = next - s.y;
      if (moved) { s.y = next; list.current?.scrollToOffset({ offset: next, animated: false }); }
      return moved;
    },
  }), []);
  const loadingFirst = Boolean(profile && !state.signIn && !apps.length && state.refreshing && !state.updated);
  const failed = failedOf(state, profile);
  const ready = Boolean(profile && !state.signIn && apps.length);
  const items = useMemo<Item[]>(() => {
    if (!ready) return [{ kind: 'empty' }];
    const result: Item[] = [];
    const needle = query.trim().toLowerCase();
    const matches = needle ? apps.filter(app => app.name.toLowerCase().includes(needle)) : apps;
    const groups: [string, DiscoveredApp[]][] = needle ? [['', matches]] : [[t.mobileApps, matches.filter(a => a.registered)], [t.desktopApps, matches.filter(a => !a.registered)]];
    for (const [title, group] of groups) {
      if (!group.length) continue;
      if (title) result.push({ kind: 'header', title, key: `h-${title}` });
      result.push({ kind: 'grid', apps: group, key: `g-${title}`, arrange: !needle });
    }
    if (needle && !matches.length) result.push({ kind: 'empty' });
    return result;
  }, [apps, ready, query, t]);

  const empty = () => {
    if (!profile || state.signIn) return <Gate state={state} profile={profile} busy={busy} onAdd={onAdd} onScan={onScan} onSignIn={onSignIn} onRefresh={onRefresh} onDetails={onDetails} />;
    if (loadingFirst) return <View style={{ flexDirection: 'row', flexWrap: 'wrap', paddingTop: spacing.sm, paddingHorizontal: spacing.md }} accessibilityLabel={t.loadingApp}>
      {Array.from({ length: columns * 3 }, (_, i) => <View key={i} style={{ width: `${100 / columns}%`, height: TILE_HEIGHT, alignItems: 'center', paddingTop: spacing.sm, gap: spacing.xs }}>
        <Skeleton style={{ width: layout.appIcon, height: layout.appIcon, borderRadius: radius.md }} /><Skeleton style={{ width: 40, height: 10 }} />
      </View>)}
    </View>;
    if (failed && !apps.length) return <Gate state={state} profile={profile} busy={busy} onAdd={onAdd} onScan={onScan} onSignIn={onSignIn} onRefresh={onRefresh} onDetails={onDetails} />;
    if (query.trim()) return <EmptyState icon="search-off" tone="neutral" title={fill(t.noMatches, { query: query.trim() })} />;
    return <EmptyState icon="apps" tone="neutral" title={t.noAppsTitle} detail={fill(t.noAppsDetail, { name: profile.name })}>
      <TextButton title={t.refresh} icon="refresh" onPress={onRefresh} />
    </EmptyState>;
  };
  const render = ({ item }: { item: Item }) => {
    if (item.kind === 'empty') return empty();
    if (item.kind === 'header') return <Text style={[type.section, { paddingHorizontal: layout.gutter, paddingTop: layout.block, paddingBottom: spacing.xxs }]} accessibilityRole="header">{item.title}</Text>;
    const section = item.apps.map(app => app.id);
    return <View style={{ paddingHorizontal: spacing.md }}>
      <AppGrid apps={item.apps} columns={columns} profile={profile?.id} onOpen={onOpen} onPressIn={onPressIn} onPressOut={onPressOut} scroller={scroller} onDragging={setDragging} mixed={!item.arrange}
        onReorder={item.arrange ? (from, to) => onArrange(moveApp(apps.map(app => app.id), section, from, to)) : undefined} />
    </View>;
  };
  const startSearch = () => { list.current?.scrollToOffset({ offset: 0, animated: false }); setSearching(true); };
  return <View style={{ flex: 1, backgroundColor: colors.background }}>
    <BarContent target={target}><Animated.FlatList ref={list as never} data={items} renderItem={render} keyExtractor={(item, index) => 'key' in item ? item.key : `${item.kind}-${index}`}
      onScroll={event => { const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent; scroll.current = { y: contentOffset.y, content: contentSize.height, viewport: layoutMeasurement.height }; onScroll(event); }}
      scrollEventThrottle={16} scrollEnabled={!dragging} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag"
      contentContainerStyle={{ paddingTop: bars.top + spacing.xs, paddingBottom: bars.bottom + spacing.xl, flexGrow: 1 }}
      ListHeaderComponent={<Notices notice={notice} shareWaiting={shareWaiting} offline={failed && ready} error={state.error} refreshing={state.refreshing} onDismiss={onDismissNotice} onRetry={onRefresh} />}
      refreshControl={profile && !state.signIn ? <PullRefresh enabled={!dragging} busy={state.refreshing} onRefresh={onRefresh} offset={bars.top} /> : undefined}
      initialNumToRender={6} windowSize={7} /></BarContent>
    {searching ? <TopBar blurTarget={target} fill left={<IconButton icon="arrow-back" label={t.back} onPress={closeSearch} />}
      title={<TextInput value={query} onChangeText={setQuery} autoFocus placeholder={`${t.searchApps} · ${fill(t.appCount, { count: apps.length })}`} placeholderTextColor={colors.tertiary} accessibilityLabel={t.searchApps}
        style={[type.input, { flex: 1, minHeight: layout.hit, paddingVertical: 0 }]} autoCorrect={false} returnKeyType="search" />}
      right={query ? <IconButton icon="cancel" label={t.clearSearch} color={colors.tertiary} onPress={() => setQuery('')} /> : null} />
      : <TopBar blurTarget={target} hidden={hidden} title={<NasTitle state={state} profile={profile} fallback={t.apps} />} onTitlePress={profile ? onSwitch : undefined} titleLabel={t.switchNas}
        right={ready ? <IconButton icon="search" label={t.searchApps} onPress={startSearch} /> : null} />}
  </View>;
}
