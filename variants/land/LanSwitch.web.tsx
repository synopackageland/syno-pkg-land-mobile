import { useEffect, useState, useSyncExternalStore } from 'react';
import { Pressable, Text, View } from 'react-native';
import { findLan, lanLauncher, readProbe, shouldProbe, type LanFound } from '../../src/core/lan-switch/check';
import { lanSwitchStrings } from '../../src/core/lan-switch/strings';
import { remoteNas } from '../../src/core/profiles/remote';
import type { LanSwitchProps } from './LanSwitch';
import { Icon } from './ui';
import { colors, layout, radius, spacing, type } from './theme';

/**
 * One check per page load, started the first time the home page shows: Connect issues the
 * credentials only for a signed-in administrator, and only while its option is on
 */
let found: LanFound | undefined;
let started = false, dismissed = false;
const listeners = new Set<() => void>();
const changed = () => listeners.forEach(listener => listener());
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
const current = () => (dismissed ? undefined : found);
function start() {
  if (started || typeof window === 'undefined' || !shouldProbe(window.location)) return;
  started = true;
  void readProbe((url, init) => window.fetch(url, init), window.location.origin, window.location.pathname)
    .then(probe => findLan(probe))
    .then(result => { if (result) { found = result; changed(); } }, () => undefined);
}

/**
 * A card in the home page's content when this browser has just proved it reaches this NAS on the
 * local network. Switching opens this launcher on DSM's local address, handing the NAS list over
 * like any NAS switch; there the visitor signs in again (and, on HTTPS, accepts DSM's certificate)
 */
export function LanSwitch({ locale }: LanSwitchProps) {
  const lan = useSyncExternalStore(subscribe, current, () => undefined);
  const [busy, setBusy] = useState(false);
  useEffect(() => { start(); }, []);
  if (!lan) return null;
  const t = lanSwitchStrings(locale);
  const close = () => { dismissed = true; changed(); };
  const open = () => {
    if (busy) return;
    const self = remoteNas?.getState().links.find(link => link.origin === window.location.origin && !link.removed);
    const launcher = lanLauncher(lan, self?.launcher ?? window.location.href);
    if (!launcher) return;
    const origin = new URL(launcher).origin;
    setBusy(true);
    if (remoteNas) {
      remoteNas.add({ origin, launcher, name: self?.name || new URL(launcher).host });
      if (remoteNas.switchTo(origin)) return;
    }
    window.location.assign(launcher);
  };
  return <View style={{ marginHorizontal: spacing.md, marginBottom: layout.block, padding: spacing.md, paddingTop: spacing.sm, paddingRight: spacing.xs, gap: spacing.sm, borderRadius: radius.lg, backgroundColor: colors.accentSoft }} testID="lan-switch">
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
      <Icon name="lan" size={28} color={colors.accent} />
      <View style={{ flex: 1, gap: spacing.xxs }}>
        <Text style={type.headline} accessibilityRole="header">{t.title}</Text>
        <Text style={type.subhead}>{t.detail}</Text>
        {lan.https ? <Text style={type.subhead}>{t.certificate}</Text> : null}
      </View>
      <Pressable onPress={close} accessibilityRole="button" accessibilityLabel={t.close} hitSlop={4}
        style={({ pressed }) => ({ width: layout.hit, height: layout.hit, alignSelf: 'flex-start', alignItems: 'center', justifyContent: 'center', borderRadius: radius.full, backgroundColor: pressed ? 'rgba(0,0,0,0.06)' : 'transparent' })}>
        <Icon name="close" size={20} color={colors.secondary} />
      </Pressable>
    </View>
    <Pressable onPress={open} disabled={busy} accessibilityRole="button" accessibilityLabel={t.open} testID="lan-switch-open"
      style={({ pressed }) => ({ alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: spacing.xs, minHeight: 36, paddingHorizontal: spacing.md, borderRadius: radius.full, backgroundColor: pressed ? colors.accentPressed : colors.accent })}>
      <Icon name="swap-horiz" size={18} color={colors.onAccent} />
      <Text style={[type.headline, { color: colors.onAccent }]}>{t.open}</Text>
    </Pressable>
  </View>;
}
