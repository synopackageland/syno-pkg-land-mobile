import { Text, View } from 'react-native';
import type { CertState } from '../../src/core/profiles/probe';
import { strings } from '../../src/core/i18n/strings';
import { Icon, type IconName } from './ui';
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
