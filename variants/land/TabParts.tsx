import { Image, Text, View } from 'react-native';
import type { NasProfile } from '../../src/core/config';
import type { LauncherState } from '../../src/core/launcher/model';
import { causeText, fill, strings } from '../../src/core/i18n/strings';
import { Banner, EmptyState, Icon, TextButton } from './ui';
import { colors, layout, spacing, type } from './theme';

const brand = require('../../assets/brand/package-land.png');
const sessionCodes = new Set(['SIGN_IN_REQUIRED']);
/** A refresh failed for a reason other than a lost session */
export const failedOf = (state: LauncherState, profile?: NasProfile) => Boolean(profile && state.error && !sessionCodes.has(state.error));

/** Title of the Overview and Apps bars: the NAS name opens the switcher */
export function NasTitle({ state, profile, fallback }: { state: LauncherState; profile?: NasProfile; fallback: string }) {
  const failed = failedOf(state, profile);
  return <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.xs, paddingHorizontal: spacing.sm }}>
    {profile ? <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: state.signIn ? colors.tertiary : failed ? colors.warning : colors.success }} /> : null}
    <Text style={[type.title, { flexShrink: 1 }]} numberOfLines={1} accessibilityRole="header">{profile ? profile.name : fallback}</Text>
    {profile ? <Icon name="expand-more" size={20} color={colors.secondary} /> : null}
  </View>;
}

type GateProps = { state: LauncherState; profile?: NasProfile; busy: boolean; onAdd(): void; onScan(): void; onSignIn(): void; onRefresh(): void; onDetails(): void };
/** What both tabs show before there is anything to show: no NAS, signed out, or unreachable with nothing saved */
export function Gate({ state, profile, busy, onAdd, onScan, onSignIn, onRefresh, onDetails }: GateProps) {
  const t = strings();
  if (!profile) return <EmptyState icon="dns" art={<Image source={brand} style={{ width: 88, height: 88, marginBottom: spacing.sm }} accessibilityIgnoresInvertColors />} title={t.emptyTitle} detail={t.emptyDetail}>
    <TextButton title={t.addNas} icon="add" onPress={onAdd} />
    <TextButton title={t.scanQr} icon="qr-code-scanner" onPress={onScan} />
  </EmptyState>;
  if (state.signIn) return <EmptyState icon="login" title={fill(t.signInTitle, { name: profile.name })} detail={t.signInDetail}>
    <TextButton title={t.signIn} onPress={onSignIn} disabled={busy} />
  </EmptyState>;
  return <EmptyState icon={state.error === 'certificate' ? 'gpp-bad' : 'cloud-off'} tone="warning" title={fill(t.unreachableTitle, { name: profile.name })} detail={`${causeText(t, state.error)}\n${profile.origin}`}>
    <TextButton title={t.retry} icon="refresh" onPress={onRefresh} disabled={state.refreshing} />
    <TextButton title={t.checkNas} onPress={onDetails} />
  </EmptyState>;
}

/** Notices above a tab's content: a dismissable notice, a waiting share and a failed refresh over saved data */
export function Notices({ notice, shareWaiting, offline, error, refreshing, onDismiss, onRetry }: { notice?: string; shareWaiting: boolean; offline: boolean; error?: string; refreshing: boolean; onDismiss(): void; onRetry(): void }) {
  const t = strings();
  if (!notice && !shareWaiting && !offline) return null;
  return <View style={{ paddingHorizontal: spacing.md, paddingBottom: layout.block, gap: spacing.xs }}>
    {notice ? <Banner tone="warning" title={notice} action={t.close} onAction={onDismiss} /> : null}
    {shareWaiting ? <Banner tone="info" icon="share" title={t.shareWaiting} /> : null}
    {offline ? <Banner tone="warning" icon="cloud-off" title={t.offlineCached} detail={causeText(t, error)} action={t.retry} onAction={onRetry} busy={refreshing} /> : null}
  </View>;
}
