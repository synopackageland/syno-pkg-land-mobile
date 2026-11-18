import { Text, View } from 'react-native';
import { commonName, formatFingerprint, type CertState, type ProbeTls } from '../../src/core/profiles/probe';
import { fill, strings } from '../../src/core/i18n/strings';
import { Icon, PrimaryButton, Sheet, TextButton, type IconName } from './ui';
import { colors, spacing, type } from './theme';

export function certIcon(state: CertState | 'pinned' | 'unknown'): IconName {
  return state === 'trusted' ? 'lock' : state === 'pinned' ? 'gpp-good' : state === 'http' ? 'no-encryption' : state === 'changed' ? 'gpp-bad' : state === 'unknown' ? 'help-outline' : 'gpp-maybe';
}
export function certColor(state: CertState | 'pinned' | 'unknown'): string {
  return state === 'trusted' || state === 'pinned' ? colors.success : state === 'changed' ? colors.danger : state === 'unknown' ? colors.tertiary : colors.warning;
}
export function certLabel(state: CertState | 'pinned' | 'unknown', pinned = false): string {
  const t = strings();
  if (state === 'trusted' && pinned || state === 'pinned') return t.cert_pinned;
  return t[`cert_${state}`];
}
/** Compact certificate status: icon plus label, coloured by risk */
export function CertBadge({ state, pinned }: { state: CertState | 'pinned' | 'unknown'; pinned?: boolean }) {
  const color = certColor(state);
  return <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.xs }}>
    <Icon name={certIcon(pinned && state === 'trusted' ? 'pinned' : state)} size={14} color={color} />
    <Text style={[type.subhead, { color: state === 'trusted' || state === 'pinned' || state === 'unknown' ? colors.secondary : color }]}>{certLabel(state, pinned)}</Text>
  </View>;
}
/** Saved-profile security without a network check: pinned leaf, system trust or plain HTTP */
export function savedCert(origin: string, sha256?: string): CertState | 'pinned' {
  return origin.startsWith('http:') ? 'http' : sha256 ? 'pinned' : 'trusted';
}

/**
 * Asks before the App accepts a leaf it cannot verify: the address, who it is issued to and by,
 * the expiry and the SHA-256 fingerprint, so the user can compare it with DSM before allowing it
 */
export function TrustSheet({ visible, origin, state, tls, onAllow, onClose }: { visible: boolean; origin: string; state: CertState; tls: ProbeTls; onAllow(): void; onClose(): void }) {
  const t = strings();
  const host = new URL(origin).host, subject = commonName(tls.subject), issuer = commonName(tls.issuer) || tls.issuer;
  const why = state === 'changed' ? fill(t.trustWhy_changed, { host }) : state === 'mismatch' ? fill(subject ? t.trustWhy_mismatch : t.trustWhy_mismatchUnnamed, { host, name: subject || '' }) : fill(t.trustWhy_untrusted, { host });
  const field = (label: string, value: string | undefined, mono = false) => value ? <View style={{ gap: spacing.xxs }}>
    <Text style={type.caption}>{label}</Text>
    <Text style={mono ? type.mono : type.body} selectable>{value}</Text>
  </View> : null;
  return <Sheet visible={visible} onClose={onClose} label={t.cancel}>
    <View style={{ paddingHorizontal: spacing.xl, paddingBottom: spacing.sm, gap: spacing.md }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
        <Icon name={certIcon(state)} size={28} color={certColor(state)} />
        <Text style={[type.hero, { flex: 1 }]} accessibilityRole="header">{state === 'changed' ? t.trustNewTitle : t.trustTitle}</Text>
      </View>
      <Text style={type.body}>{why}</Text>
      {field(t.certAddress, origin)}
      {field(t.certIssuedTo, subject)}
      {field(t.certIssuer, issuer && issuer !== subject ? issuer : undefined)}
      {field(t.certExpires, tls.notAfter ? new Date(tls.notAfter).toLocaleDateString() : undefined)}
      {field(t.fingerprint, formatFingerprint(tls.sha256), true)}
      <Text style={type.subhead}>{t.trustAllowHelp}</Text>
      <View style={{ gap: spacing.xs, marginTop: spacing.xs }}>
        <PrimaryButton title={t.allow} tone={state === 'changed' ? 'danger' : 'accent'} onPress={onAllow} />
        <TextButton title={t.cancel} tone="neutral" onPress={onClose} />
      </View>
    </View>
  </Sheet>;
}
