import { useEffect, useRef } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import type { NasProfile } from '../../src/core/config';
import type { LauncherState } from '../../src/core/launcher/model';
import type { StatusState } from '../../src/core/status/model';
import { strings } from '../../src/core/i18n/strings';
import { BarContent, Icon, TopBar, useBarInsets, useBlurTarget, useCollapsingBar, type BlurTarget } from './ui';
import { colors, layout, spacing, type } from './theme';
import { Gate, NasTitle, Notices, failedOf } from './TabParts';
import { NasLine, OfflineLine, ResourceCard, ageOf } from './HomeCards';
import { AttentionBlock, BackupSection, StorageSection, type GlancePage, type OpenApp } from './Glance';
import { InstallHint } from './InstallHint';
import { PullRefresh } from './PullRefresh';
import { landConfig } from './config';

type Props = {
  state: LauncherState; profile?: NasProfile; busy: boolean; notice?: string; shareWaiting: boolean;
  /** NAS status for the cards; absent while signed out */
  status?: StatusState; now: number; language: string;
  onAdd(): void; onScan(): void; onSignIn(): void; onRefresh(): void; onSwitch(): void; onDetails(): void; onDismissNotice(): void;
  onStatus(): void; onStorage(): void; onAccount(): void;
  /** Opens a status page (storage, security, backup) from a glance row */
  onStatusPage?(page: GlancePage): void;
  /** A DSM App by launchApp id for "Open in DSM" */
  onOpenApp?: OpenApp;
  /** Control Panel › Update & Restore; absent when this account has no Control Panel */
  onUpdate?(): void;
  blurTarget?: BlurTarget;
  /** Changes when the selected tab is pressed again: scroll to the top */
  top?: number;
};

/**
 * The Overview tab: how this NAS is doing. The status modules are laid out here in
 * order; what each card shows lives with the card.
 */
export function Overview({ state, profile, busy, notice, shareWaiting, status, now, language, onAdd, onScan, onSignIn, onRefresh, onSwitch, onDetails, onDismissNotice, onStatus, onStorage, onAccount, onStatusPage, onOpenApp, onUpdate, blurTarget, top }: Props) {
  const t = strings();
  const ownTarget = useBlurTarget(), target = blurTarget ?? ownTarget;
  const bars = useBarInsets();
  const { hidden, onScroll } = useCollapsingBar();
  const scroll = useRef<React.ComponentRef<typeof ScrollView>>(null);
  useEffect(() => { if (top) scroll.current?.scrollTo({ y: 0, animated: true }); }, [top]);
  const failed = failedOf(state, profile);
  const ready = Boolean(profile && !state.signIn && status);
  const user = status?.snapshot?.user?.user;
  return <View style={{ flex: 1, backgroundColor: colors.background }}>
    <BarContent target={target}><ScrollView ref={scroll} onScroll={onScroll} scrollEventThrottle={16}
      contentContainerStyle={{ paddingTop: bars.top + spacing.xs, paddingBottom: bars.bottom + spacing.xl, flexGrow: 1 }}
      refreshControl={profile && !state.signIn ? <PullRefresh busy={Boolean(state.refreshing || status?.refreshing)} onRefresh={onRefresh} offset={bars.top} /> : undefined}>
      <Notices notice={notice} shareWaiting={shareWaiting} offline={failed && ready} error={state.error} refreshing={state.refreshing} onDismiss={onDismissNotice} onRetry={onRefresh} />
      {/* Browser build only: in the page's content, so it never covers the NAS status */}
      <InstallHint name={landConfig.name} locale={language} />
      {ready && profile && status ? <View style={{ gap: layout.block }}>
        {/* The DSM version and one line, then what needs attention, resources, storage and backup (report §2.1) */}
        <NasLine state={status} t={t} now={now} locale={language} onUpdate={onUpdate} />
        {!failed ? <OfflineLine state={status} t={t} locale={language} onRetry={onRefresh} /> : null}
        <AttentionBlock state={status} t={t} now={now} locale={language} onOpenApp={onOpenApp} onPage={onStatusPage} />
        <ResourceCard state={status} t={t} locale={language} now={now} onStatus={onStatus} onStorage={onStorage} storage={false} />
        <StorageSection state={status} t={t} now={now} locale={language} onOpenApp={onOpenApp} onPage={onStatusPage ?? (() => onStorage())} age={ageOf(status, 'storage', 'home', now, t, language)} />
        <BackupSection state={status} t={t} now={now} locale={language} onOpenApp={onOpenApp} onPage={onStatusPage} age={ageOf(status, 'backup', 'home', now, t, language)} limit={3} />
      </View> : <Gate state={state} profile={profile} busy={busy} onAdd={onAdd} onScan={onScan} onSignIn={onSignIn} onRefresh={onRefresh} onDetails={onDetails} />}
    </ScrollView></BarContent>
    <TopBar blurTarget={target} hidden={hidden} title={<NasTitle state={state} profile={profile} fallback={t.tab_overview} />} onTitlePress={profile ? onSwitch : undefined} titleLabel={t.switchNas}
      right={profile ? <Pressable onPress={onAccount} accessibilityRole="button" accessibilityLabel={t.accountMenu} hitSlop={4} style={{ width: layout.hit, height: layout.hit, alignItems: 'center', justifyContent: 'center' }}>
        <View style={{ width: 28, height: 28, borderRadius: 14, backgroundColor: colors.accentSoft, alignItems: 'center', justifyContent: 'center' }}>
          {user ? <Text style={[type.headline, { color: colors.accent }]}>{user.slice(0, 1).toUpperCase()}</Text> : <Icon name="person" size={18} color={colors.accent} />}
        </View>
      </Pressable> : null} />
  </View>;
}
