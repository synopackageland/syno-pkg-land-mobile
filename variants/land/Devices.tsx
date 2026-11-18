import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { ActivityIndicator, Animated, Dimensions, Pressable, ScrollView, Switch, Text, TextInput, View } from 'react-native';
import Native from '../../modules/webview-cookies';
import type { NasProfile } from '../../src/core/config';
import { certState, type NasProber } from '../../src/core/profiles/probe';
import { mobileFitOn } from '../../src/core/webview/mobile-fit';
import { causeText, fill, strings, type Strings } from '../../src/core/i18n/strings';
import type { StatusSnapshot } from '../../src/core/status/model';
import { statusStorage } from '../../src/core/status/storage';
import { Banner, Chevron, ConfirmSheet, Icon, IconButton, PrimaryButton, Row, Section, Separator, Sheet, TextButton, TopBar, noWebOutline, useBarInsets, useCollapsingBar, BarContent, useBlurTarget, type BlurTarget, type IconName } from './ui';
import { CertBadge, certColor, certIcon, savedCert } from './cert';
import { colors, layout, radius, spacing, type } from './theme';
import { singleNas } from '../../src/core/platform';

const hostPort = (origin: string) => new URL(origin).host;
export function profileSubtitle(profile: NasProfile) {
  const t = strings();
  // Manually added NAS have no network kind; only QR groups label LAN, Cloudflare and so on
  return profile.kind ? `${t[`kind_${profile.kind}`]} · ${hostPort(profile.origin)}` : hostPort(profile.origin);
}
export function DeviceIcon({ profile, size = 40 }: { profile: NasProfile; size?: number }) {
  const cert = savedCert(profile.origin, profile.sha256);
  return <View>
    <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: colors.accentSoft, alignItems: 'center', justifyContent: 'center' }}><Icon name="dns" size={size * 0.5} color={colors.accent} /></View>
    <View style={{ position: 'absolute', right: -2, bottom: -2, width: 18, height: 18, borderRadius: 9, backgroundColor: colors.background, alignItems: 'center', justifyContent: 'center' }}>
      <Icon name={certIcon(cert)} size={13} color={certColor(cert)} />
    </View>
  </View>;
}

type ListProps = { profiles: NasProfile[]; active?: string; signedIn(profile: NasProfile): boolean; onOpen(id: string): void; onActions(id: string): void; onAdd(): void; onScan(): void; onBack?: () => void; blurTarget?: BlurTarget };
/** Every NAS on this phone; pushed onto the current tab from the switcher's "Manage NAS" */
export function Devices({ profiles, active, signedIn, onOpen, onActions, onAdd, onScan, onBack, blurTarget }: ListProps) {
  const t = strings();
  const ownTarget = useBlurTarget(), target = blurTarget ?? ownTarget;
  const bars = useBarInsets();
  const { hidden, onScroll } = useCollapsingBar();
  return <View style={{ flex: 1, backgroundColor: colors.background }}>
    <BarContent target={target}><Animated.ScrollView onScroll={onScroll} scrollEventThrottle={16} contentContainerStyle={{ paddingTop: bars.top, paddingBottom: bars.rawBottom + spacing.xl }}>
      {profiles.map((profile, index) => <View key={profile.id}>
        {index ? <Separator inset={layout.gutter + 40 + spacing.lg} /> : null}
        <Row onPress={() => onOpen(profile.id)} onLongPress={() => { Native.haptic('long'); onActions(profile.id); }} label={`${profile.name}, ${profileSubtitle(profile)}`} selected={profile.id === active}
          title={<View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
            <Text style={[type.headline, { flexShrink: 1 }]}>{profile.name}</Text>
            {profile.id === active ? <Text style={[type.caption, { color: colors.accent, backgroundColor: colors.accentSoft, paddingHorizontal: spacing.sm, borderRadius: radius.full, overflow: 'hidden' }]}>{t.current}</Text> : null}
          </View>}
          subtitle={<Text style={type.subhead}>{`${profileSubtitle(profile)} · ${signedIn(profile) ? t.signedIn : t.signedOut}`}</Text>}
          trailing={<Chevron />} leading={<DeviceIcon profile={profile} />} />
      </View>)}
      {profiles.length ? <Separator /> : null}
      <Row icon="qr-code-scanner" iconColor={colors.accent} title={<Text style={[type.headline, { color: colors.accent }]}>{t.scanQr}</Text>} onPress={onScan} label={t.scanQr} />
    </Animated.ScrollView></BarContent>
    <TopBar blurTarget={target} hidden={hidden} left={onBack ? <IconButton icon="arrow-back" label={t.back} onPress={onBack} /> : undefined} title={t.manageNas} right={<IconButton icon="add" label={t.addNas} onPress={onAdd} />} />
  </View>;
}

/** Relative age of saved data: just now, 3 min ago, 2 h ago, 4 d ago */
export function ageText(t: Strings, at: number, now: number) {
  const minutes = Math.floor(Math.max(0, now - at) / 60_000);
  if (minutes < 1) return t.justNow;
  if (minutes < 60) return fill(t.minutesAgo, { count: minutes });
  if (minutes < 24 * 60) return fill(t.hoursAgo, { count: Math.floor(minutes / 60) });
  return fill(t.daysAgo, { count: Math.floor(minutes / 1440) });
}
/** Last known state of a NAS from its own status cache: never wakes another NAS's polling */
export function savedStatus(snapshot: StatusSnapshot | undefined): { attention: boolean; at: number } | undefined {
  const at = snapshot ? Math.max(0, ...Object.values(snapshot.times).filter((v): v is number => typeof v === 'number')) : 0;
  if (!snapshot || !at) return undefined;
  const h = snapshot.health, o = snapshot.overview;
  const attention = Boolean(o?.tempWarning || h?.tempWarning || h?.crashed || h?.disks.some(d => d.status !== 'normal') || snapshot.volumes?.some(v => v.state));
  return { attention, at };
}
/** A NAS row's state line and dot; the browser build describes its other NAS by reachability */
export type RowState = { text: string; dot: string; badge?: { icon: IconName; label: string } };
type SheetProps = {
  visible: boolean; profiles: NasProfile[]; active?: string; signedIn(profile: NasProfile): boolean; onSelect(id: string): void; onAdd(): void; onClose(): void;
  /** Manage NAS; the browser build has no NAS pages */
  onManage?: () => void;
  /** Overrides the state of a row, such as a NAS this page only links to */
  describe?: (profile: NasProfile) => RowState | undefined;
  /** Remove for every NAS but the current one */
  onRemove?: (id: string) => void;
};
/** NAS switcher from the bar title: each NAS with its last known state, then Add NAS and Manage NAS */
export function DeviceSheet({ visible, profiles, active, signedIn, onSelect, onAdd, onManage, onClose, describe, onRemove }: SheetProps) {
  const t = strings();
  // Read once per opening; the cache files are small and only this NAS's own polling writes them
  const saved = useMemo(() => visible ? new Map(profiles.map(p => [p.id, savedStatus(statusStorage.read(p.id)?.snapshot)])) : new Map(), [visible, profiles]);
  const now = Date.now();
  return <Sheet visible={visible} onClose={onClose} label={t.close}>
    <Text style={[type.title, { paddingHorizontal: layout.gutter, paddingBottom: spacing.xs }]} accessibilityRole="header">{t.switchNas}</Text>
    <ScrollView style={{ maxHeight: 420 }}>
      {profiles.map(profile => {
        const status = saved.get(profile.id), signed = signedIn(profile);
        const kind = profile.kind ? t[`kind_${profile.kind}`] : new URL(profile.origin).host;
        const own = describe?.(profile);
        const state = own ? own.text : !signed ? t.needsSignIn : status ? `${status.attention ? t.nasAttention : t.nasHealthy} · ${ageText(t, status.at, now)}` : t.noStatusYet;
        const dot = own ? own.dot : !signed ? colors.tertiary : !status ? colors.separator : status.attention ? colors.warning : colors.success;
        const current = profile.id === active;
        const badge = own?.badge;
        return <Row key={profile.id} onPress={() => onSelect(profile.id)} label={[profile.name, badge?.label, kind, state].filter(Boolean).join(', ')} selected={current}
          leading={<View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: dot }} />}
          title={badge ? <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.xs }}>
            <Text style={[type.headline, { flexShrink: 1 }]} numberOfLines={1}>{profile.name}</Text>
            <Icon name={badge.icon} size={16} color={colors.secondary} />
          </View> : <Text style={type.headline} numberOfLines={1}>{profile.name}</Text>} subtitle={<Text style={type.caption} numberOfLines={1}>{`${kind} · ${state}`}</Text>}
          trailing={current ? <Icon name="check" color={colors.accent} /> : onRemove ? <IconButton icon="close" label={fill(t.removeFromList, { name: profile.name })} color={colors.tertiary} onPress={() => onRemove(profile.id)} /> : null} />;
      })}
    </ScrollView>
    <Separator />
    <Row icon="add" iconColor={colors.accent} title={<Text style={[type.headline, { color: colors.accent }]}>{t.addNas}</Text>} onPress={onAdd} label={t.addNas} />
    {onManage ? <Row icon="settings" iconColor={colors.accent} title={<Text style={[type.headline, { color: colors.accent }]}>{t.manageNas}</Text>} onPress={onManage} label={t.manageNas} trailing={<Chevron />} /> : null}
  </Sheet>;
}

type DetailProps = {
  profile: NasProfile; active: boolean; signedIn: boolean; busy: boolean; prober: NasProber;
  onBack(): void; onUse(): void; onSignIn(): void; onSignOut(): void; onRemove(): void; onRename(name: string): void; onChangeAddress(): void; onTrust(sha256: string): void;
  onMobileFit(value: boolean): void; onActions(): void;
};
export function DeviceDetail({ profile, active, signedIn, busy, prober, onBack, onUse, onSignIn, onSignOut, onRemove, onRename, onChangeAddress, onTrust, onMobileFit, onActions }: DetailProps) {
  const t = strings();
  const bars = useBarInsets();
  const probe = useSyncExternalStore(prober.subscribe, prober.getState);
  const [editing, setEditing] = useState(false), [name, setName] = useState(profile.name);
  const [confirm, setConfirm] = useState<'remove' | 'signOut' | 'trust'>();
  const target = useBlurTarget();
  useEffect(() => () => prober.reset(), [prober]);
  useEffect(() => { setName(profile.name); }, [profile.name]);
  const saved = savedCert(profile.origin, profile.sha256);
  const fit = mobileFitOn(profile, Math.min(Dimensions.get('screen').width, Dimensions.get('screen').height));
  const checked = probe.input === profile.origin ? probe.candidates.find(c => c.origin === profile.origin) : undefined;
  const live = checked && checked.state !== 'pending' && checked.tls !== undefined ? certState(profile.origin, checked.tls, profile.sha256) : undefined;
  const commitName = () => { setEditing(false); if (name.trim() && name.trim() !== profile.name) onRename(name.trim()); else setName(profile.name); };
  const check = () => {
    if (!checked || checked.state === 'pending') return <Row icon="sync" iconColor={colors.accent} title={<Text style={[type.body, { color: colors.accent }]}>{t.checkConnection}</Text>} label={t.checkConnection}
      onPress={checked ? undefined : () => prober.start(profile.origin)} trailing={checked ? <ActivityIndicator color={colors.accent} /> : null} />;
    if (checked.state === 'dsm') return <Row icon="check-circle" iconColor={colors.success} title={t.reachable} subtitle={live ? <CertBadge state={live} pinned={Boolean(profile.sha256)} /> : undefined}
      trailing={<TextButton title={t.retry} onPress={() => prober.start(profile.origin)} />} />;
    return <Row icon="error-outline" iconColor={colors.warning} title={checked.state === 'other' ? t.cause_other : causeText(t, checked.cause)} subtitle={profile.origin}
      trailing={<TextButton title={t.retry} onPress={() => prober.start(profile.origin)} />} />;
  };
  return <View style={{ flex: 1, backgroundColor: colors.grouped }}>
    <BarContent target={target} background={colors.grouped}><ScrollView contentContainerStyle={{ paddingTop: bars.top + spacing.lg, paddingBottom: bars.rawBottom + spacing.xxl, gap: spacing.lg }} keyboardShouldPersistTaps="handled">
      <View style={{ alignItems: 'center', gap: spacing.sm, paddingHorizontal: layout.gutter }}>
        <Pressable onLongPress={() => { Native.haptic('long'); onActions(); }} accessibilityRole="button" accessibilityLabel={t.more} hitSlop={8}><DeviceIcon profile={profile} size={64} /></Pressable>
        {editing ? <TextInput value={name} onChangeText={setName} onSubmitEditing={commitName} onBlur={commitName} autoFocus accessibilityLabel={t.name} returnKeyType="done"
          style={[type.hero, { minWidth: 200, textAlign: 'center', borderBottomWidth: 2, borderBottomColor: colors.accent, paddingVertical: spacing.xs }, noWebOutline]} />
          : <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <Text style={[type.hero, { textAlign: 'center', flexShrink: 1 }]} selectable>{profile.name}</Text>
            {singleNas ? null : <IconButton icon="edit" label={t.rename} color={colors.secondary} onPress={() => setEditing(true)} />}
          </View>}
        <Text style={type.subhead} selectable>{profileSubtitle(profile)}</Text>
        <View style={{ marginTop: spacing.sm, alignSelf: 'stretch' }}>
          {!signedIn ? <PrimaryButton title={t.signIn} icon="login" onPress={onSignIn} disabled={busy} /> : !active ? <PrimaryButton title={t.useThisNas} icon="apps" onPress={onUse} disabled={busy} /> : null}
        </View>
      </View>
      {live === 'changed' && checked?.tls ? <View style={{ paddingHorizontal: spacing.md }}><Banner tone="danger" title={t.cert_changed} detail={t.cert_changedDetail} action={t.trustNew} onAction={() => setConfirm('trust')} /></View> : null}
      {(live === 'untrusted' || live === 'mismatch') && checked?.tls && !profile.sha256 ? <View style={{ paddingHorizontal: spacing.md }}><Banner tone="warning" icon="gpp-maybe" title={t[`cert_${live}`]} detail={t.cert_untrustedDetail} action={t.trustThis} onAction={() => setConfirm('trust')} /></View> : null}
      {/* The web build's NAS is the page's own DSM: no address, certificate or removal to manage */}
      {singleNas ? null : <Section title={t.connection}>
        <Row icon="dns" title={<Text style={type.body} selectable>{profile.origin}</Text>} subtitle={t.address} label={t.editAddress} onPress={onChangeAddress} trailing={<Icon name="edit" size={20} color={colors.tertiary} />} />
        <Separator inset={layout.gutter + 22 + spacing.lg} />
        <Row icon={certIcon(saved)} iconColor={certColor(saved)} title={<CertBadge state={saved} />} subtitle={saved === 'http' ? t.cert_httpDetail : undefined} />
        {profile.sha256 ? <><Separator inset={layout.gutter + 22 + spacing.lg} /><Row icon="fingerprint" title={t.fingerprint} subtitle={profile.sha256.replace(/(..)(?=.)/g, '$1:').toUpperCase()} mono /></> : null}
        <Separator inset={layout.gutter + 22 + spacing.lg} />
        {check()}
      </Section>}
      <Section title={t.account}>
        <Row icon={signedIn ? 'account-circle' : 'person-outline'} iconColor={signedIn ? colors.success : colors.tertiary} title={signedIn ? t.signedIn : t.signedOut}
          trailing={signedIn ? <TextButton title={t.signOut} onPress={() => setConfirm('signOut')} disabled={busy} /> : <TextButton title={t.signIn} onPress={onSignIn} disabled={busy} />} />
      </Section>
      <Section>
        <Row icon="smartphone" title={t.mobileFit} subtitle={t.mobileFitDetail}
          trailing={<Switch value={fit} onValueChange={onMobileFit} accessibilityLabel={t.mobileFit} trackColor={{ true: colors.accent }} />} />
      </Section>
      {singleNas ? null : <Section>
        <Row icon="delete-outline" title={t.remove} label={t.remove} onPress={() => setConfirm('remove')} disabled={busy} />
      </Section>}
    </ScrollView></BarContent>
    <TopBar blurTarget={target} left={<IconButton icon="arrow-back" label={t.back} onPress={onBack} />} title={profile.name} right={<IconButton icon="tune" label={t.more} onPress={onActions} />} />
    <ConfirmSheet visible={confirm === 'remove'} title={fill(t.removeTitle, { name: profile.name })} message={t.removeMessage} detail={`${profileSubtitle(profile)}\n${profile.origin}`}
      confirm={t.removeConfirm} cancel={t.cancel} onClose={() => setConfirm(undefined)} onConfirm={() => { setConfirm(undefined); onRemove(); }} />
    <ConfirmSheet visible={confirm === 'signOut'} title={fill(t.signOutTitle, { name: profile.name })} message={t.signOutMessage} detail={`${profileSubtitle(profile)}\n${profile.origin}`}
      confirm={t.signOutConfirm} cancel={t.cancel} onClose={() => setConfirm(undefined)} onConfirm={() => { setConfirm(undefined); onSignOut(); }} />
    <ConfirmSheet visible={confirm === 'trust'} title={live === 'changed' ? t.trustNewTitle : t.trustThis} message={live === 'changed' ? fill(t.trustNewMessage, { name: profile.name }) : t.trustHelp}
      detail={`${t.fingerprint}\n${(checked?.tls?.sha256 ?? '').replace(/(..)(?=.)/g, '$1:').toUpperCase()}`} destructive={live === 'changed'}
      confirm={live === 'changed' ? t.trustNew : t.trustThis} cancel={t.cancel} onClose={() => setConfirm(undefined)} onConfirm={() => { setConfirm(undefined); if (checked?.tls) onTrust(checked.tls.sha256); }} />
  </View>;
}

/** Long-press actions for one NAS: App icons and App order */
export function DeviceMenu({ profile, custom, refreshing, refreshed, onRefreshIcons, onResetOrder, onClose }: { profile?: NasProfile; custom: boolean; refreshing: boolean; refreshed: boolean; onRefreshIcons(): void; onResetOrder(): void; onClose(): void }) {
  const t = strings();
  const [confirm, setConfirm] = useState(false);
  useEffect(() => { if (!profile) setConfirm(false); }, [profile]);
  return <>
    <Sheet visible={Boolean(profile) && !confirm} onClose={onClose} label={t.close}>
      <View style={{ paddingHorizontal: layout.gutter, paddingBottom: spacing.sm, gap: spacing.xxs }}>
        <Text style={type.title} accessibilityRole="header" numberOfLines={1}>{profile?.name}</Text>
        {profile ? <Text style={type.subhead} numberOfLines={1}>{profileSubtitle(profile)}</Text> : null}
      </View>
      <Row icon="image" iconColor={colors.accent} title={t.refreshIcons} subtitle={refreshed && !refreshing ? t.refreshIconsDone : undefined} label={t.refreshIcons} onPress={refreshing ? undefined : onRefreshIcons}
        trailing={refreshing ? <ActivityIndicator color={colors.accent} /> : refreshed ? <Icon name="check" color={colors.success} /> : null} />
      <Separator inset={layout.gutter + 22 + spacing.lg} />
      <Row icon="sort" iconColor={custom ? colors.accent : colors.tertiary} title={t.resetOrder} subtitle={custom ? t.orderCustom : t.orderDsm} label={t.resetOrder} onPress={custom ? () => setConfirm(true) : undefined} />
    </Sheet>
    <ConfirmSheet visible={Boolean(profile) && confirm} destructive={false} title={fill(t.resetOrderTitle, { name: profile?.name ?? '' })} message={t.resetOrderMessage}
      confirm={t.resetOrderConfirm} cancel={t.cancel} onClose={() => setConfirm(false)} onConfirm={() => { setConfirm(false); onResetOrder(); onClose(); }} />
  </>;
}
