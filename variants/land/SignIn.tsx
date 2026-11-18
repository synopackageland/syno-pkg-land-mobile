import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type ComponentRef } from 'react';
import { BackHandler, KeyboardAvoidingView, Pressable, ScrollView, Switch, Text, TextInput, View } from 'react-native';
import { uuid } from 'expo';
import Native from '../../modules/webview-cookies';
import type { NasProfile } from '../../src/core/config';
import { SESSION_DATA_PATH, SignInFlow, deviceLabel, type FallbackReason } from '../../src/core/session/native-sign-in';
import { installId } from '../../src/core/session/storage';
import { desktopPreset } from '../../src/core/webview/policy';
import { fill, strings, type Strings } from '../../src/core/i18n/strings';
import { Banner, BarContent, Icon, IconButton, PrimaryButton, TextButton, TopBar, useBarInsets, useBlurTarget } from './ui';
import { DeviceIcon } from './Devices';
import { colors, layout, radius, spacing, type } from './theme';
import { landConfig } from './config';

type Props = {
  profile: NasProfile;
  onClose(): void;
  /** DSM accepted the sign-in and the session cookies are in the WebView jar */
  onSignedIn(): void;
  onWeb(): void;
  onDetails(): void;
};
const hostPort = (origin: string) => new URL(origin).host;
const fallbackText = (t: Strings, reason: FallbackReason) => t[`web_${reason}`];

export function SignIn({ profile, onClose, onSignedIn, onWeb, onDetails }: Props) {
  const t = strings();
  const bars = useBarInsets();
  const blurTarget = useBlurTarget();
  const flow = useMemo(() => new SignInFlow({
    signIn: (body, id) => Native.signIn(profile.origin, body, desktopPreset.userAgent, id),
    cancel: id => Native.cancelSignIn(id),
    authTypes: account => Native.readJson(`${profile.origin}/webapi/entry.cgi?api=SYNO.API.Auth.Type&version=1&method=get&account=${encodeURIComponent(account)}`, profile.origin).then(reply => reply.body),
  }, () => uuid.v4()), [profile.origin]);
  const state = useSyncExternalStore(flow.subscribe, flow.getState);
  const [account, setAccount] = useState(''), [password, setPassword] = useState(''), [code, setCode] = useState('');
  const [keep, setKeep] = useState(true), [reveal, setReveal] = useState(false);
  const passwordRef = useRef<ComponentRef<typeof TextInput>>(null), codeRef = useRef<ComponentRef<typeof TextInput>>(null);
  useEffect(() => () => flow.cancel(), [flow]);
  // Never blocks the form; an SSO-default NAS switches to the DSM page's button when DSM answers
  useEffect(() => { let live = true; Native.readJson(`${profile.origin}${SESSION_DATA_PATH}`, profile.origin).then(reply => { if (live) flow.sessionData(reply.body); }, () => {}); return () => { live = false; }; }, [flow, profile.origin]);
  // A failed code is cleared for the next one
  useEffect(() => { if (state.error?.error === 'wrongCode') setCode(''); }, [state.error]);

  const submit = async (value = code) => {
    if (!account.trim() || !password || state.busy) return;
    if (state.step === 'code' && value.length !== 6) return;
    const scope = await flow.submit({
      account: account.trim(), password, code: state.step === 'code' ? value : undefined, keepSignedIn: keep,
      deviceName: deviceLabel(Native.deviceName(), landConfig.name), mobileId: installId(() => uuid.v4()),
    });
    if (scope) { setPassword(''); setCode(''); onSignedIn(); }
  };
  const changeCode = (value: string) => {
    const digits = value.replace(/\D/g, '').slice(0, 6);
    setCode(digits); flow.dismiss();
    if (digits.length === 6) void submit(digits);
  };
  const back = () => { flow.back(); setCode(''); };
  const backRef = useRef(() => {}); backRef.current = state.step === 'code' ? back : onClose;
  useEffect(() => { const sub = BackHandler.addEventListener('hardwareBackPress', () => { backRef.current(); return true; }); return () => sub.remove(); }, []);

  const error = state.error ? (() => {
    const e = state.error.error;
    const action = e === 'certificate' ? { action: t.nasDetails, onAction: onDetails } : e === 'unreachable' || e === 'unavailable' ? { action: t.retry, onAction: () => void submit() } : {};
    const detail = e === 'failed' && state.error.code ? `${t.fix_failed} · ${fill(t.errCode, { code: state.error.code })}` : t[`fix_${e}`];
    return <Banner tone={e === 'unavailable' ? 'warning' : 'danger'} icon={e === 'certificate' ? 'gpp-bad' : 'error-outline'} title={t[`err_${e}`]} detail={detail} {...action} onDismiss={() => flow.dismiss()} dismissLabel={t.close} />;
  })() : null;
  const fallback = state.fallback ? <Banner tone="warning" title={fallbackText(t, state.fallback)} detail={t.webDetail} /> : null;
  const invalid = state.error?.error === 'wrongPassword';
  const field = (focusColor: boolean) => ({ flexDirection: 'row' as const, alignItems: 'center' as const, minHeight: 48, paddingLeft: spacing.md, borderRadius: radius.md, backgroundColor: colors.grouped, borderWidth: 2, borderColor: focusColor ? colors.danger : 'transparent' });

  const header = (icon?: 'phonelink-lock') => <View style={{ alignItems: 'center', gap: spacing.sm, paddingBottom: spacing.sm }}>
    {icon ? <View style={{ width: 64, height: 64, borderRadius: 32, backgroundColor: colors.accentSoft, alignItems: 'center', justifyContent: 'center' }}><Icon name={icon} size={32} color={colors.accent} /></View> : <DeviceIcon profile={profile} size={64} />}
    <Text style={[type.hero, { textAlign: 'center' }]} accessibilityRole="header">{icon ? t.codeHeading : profile.name}</Text>
    {icon ? <Text style={[type.subhead, { textAlign: 'center' }]}>{fill(t.codeDetail, { account: account.trim(), name: profile.name })}</Text>
      : <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.xs, paddingHorizontal: spacing.md, paddingVertical: spacing.xs, borderRadius: radius.full, backgroundColor: colors.grouped }}>
        <Icon name={profile.origin.startsWith('https:') ? 'lock' : 'no-encryption'} size={16} color={profile.origin.startsWith('https:') ? colors.success : colors.warning} />
        <Text style={type.subhead} selectable>{hostPort(profile.origin)}</Text>
      </View>}
  </View>;

  const passwordStep = <View style={{ gap: spacing.md }}>
    {header()}
    {fallback}{error}
    <View style={field(false)}>
      <Icon name="person-outline" size={20} color={colors.secondary} />
      <TextInput accessibilityLabel={t.accountField} placeholder={t.accountField} placeholderTextColor={colors.tertiary} value={account} onChangeText={value => { setAccount(value); flow.dismiss(); }}
        autoFocus={!account} autoCapitalize="none" autoCorrect={false} autoComplete="username" textContentType="username" returnKeyType="next" editable={!state.busy}
        onSubmitEditing={() => passwordRef.current?.focus()} submitBehavior="submit" style={[type.input, { flex: 1, minHeight: 48, paddingHorizontal: spacing.md }]} />
    </View>
    <View style={field(invalid)}>
      <Icon name="lock-outline" size={20} color={colors.secondary} />
      <TextInput ref={passwordRef} accessibilityLabel={t.password} placeholder={t.password} placeholderTextColor={colors.tertiary} value={password} onChangeText={value => { setPassword(value); flow.dismiss(); }}
        secureTextEntry={!reveal} autoCapitalize="none" autoCorrect={false} autoComplete="current-password" textContentType="password" returnKeyType="go" editable={!state.busy}
        onSubmitEditing={() => void submit()} style={[type.input, { flex: 1, minHeight: 48, paddingHorizontal: spacing.md }]} />
      <IconButton icon={reveal ? 'visibility-off' : 'visibility'} label={reveal ? t.hidePassword : t.showPassword} color={colors.tertiary} onPress={() => setReveal(value => !value)} />
    </View>
    <Pressable onPress={() => setKeep(value => !value)} accessibilityRole="switch" accessibilityState={{ checked: keep }} accessibilityLabel={t.keepSignedIn}
      style={{ minHeight: layout.hit, flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.xs }}>
      <Text style={[type.body, { flex: 1 }]}>{t.keepSignedIn}</Text>
      <Switch value={keep} onValueChange={setKeep} trackColor={{ true: colors.accent, false: colors.separator }} thumbColor={colors.background} importantForAccessibility="no" />
    </Pressable>
  </View>;

  const boxes = Array.from({ length: 6 }, (_, i) => code[i] ?? '');
  const wrongCode = state.error?.error === 'wrongCode';
  const codeStep = <View style={{ gap: spacing.lg }}>
    {header('phonelink-lock')}
    {error}
    <Pressable onPress={() => codeRef.current?.focus()} accessibilityLabel={t.code} style={{ flexDirection: 'row', justifyContent: 'center', gap: spacing.sm }}>
      {boxes.map((digit, i) => <View key={i} style={{ width: 44, height: 52, borderRadius: radius.md, backgroundColor: colors.grouped, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: wrongCode ? colors.danger : i === code.length && !state.busy ? colors.accent : 'transparent' }}>
        <Text style={[type.hero, { fontSize: 22 }]}>{digit}</Text>
      </View>)}
      {/* One real input under the boxes keeps paste and SMS/autofill codes working */}
      <TextInput ref={codeRef} value={code} onChangeText={changeCode} autoFocus keyboardType="number-pad" autoComplete="one-time-code" textContentType="oneTimeCode" maxLength={6} editable={!state.busy}
        accessibilityLabel={t.code} caretHidden selectionColor="transparent" underlineColorAndroid="transparent"
        style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, opacity: 0.02, color: 'transparent', fontSize: type.input.fontSize }} />
    </Pressable>
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.xs }}>
      <Icon name="verified-user" size={16} color={colors.success} />
      <Text style={[type.caption, { flexShrink: 1 }]}>{t.trustNote}</Text>
    </View>
  </View>;

  const coding = state.step === 'code';
  const primary = state.fallback
    ? <PrimaryButton title={t.useWebSignIn} icon="language" onPress={onWeb} />
    : <PrimaryButton title={coding ? t.verify : t.signIn} busy={state.busy} disabled={coding ? code.length !== 6 : !account.trim() || !password} onPress={() => void submit()} />;
  // Edge-to-edge Android does not resize for the keyboard; keep the primary button above it
  return <KeyboardAvoidingView behavior="padding" style={{ flex: 1, backgroundColor: colors.background }}>
    <TopBar blurTarget={blurTarget} left={<IconButton icon={coding ? 'arrow-back' : 'close'} label={coding ? t.back : t.close} onPress={coding ? back : onClose} />} title={coding ? t.codeTitle : t.signIn} />
    <BarContent target={blurTarget}><ScrollView contentContainerStyle={{ paddingTop: bars.top + spacing.lg, paddingHorizontal: layout.gutter, paddingBottom: spacing.xl }} keyboardShouldPersistTaps="handled">
      {coding ? codeStep : passwordStep}
    </ScrollView></BarContent>
    <View style={{ paddingHorizontal: layout.gutter, paddingTop: spacing.sm, paddingBottom: bars.rawBottom + spacing.sm, backgroundColor: colors.background }}>
      {primary}
      {state.fallback ? null : <TextButton title={t.useWebSignIn} icon="language" tone="neutral" onPress={() => { flow.cancel(); onWeb(); }} />}
    </View>
  </KeyboardAvoidingView>;
}
