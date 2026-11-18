import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Text, TextInput, View } from 'react-native';
import type { FindResult, RemoteNas } from '../../src/core/profiles/remote';
import { hostOf } from '../../src/core/profiles/nas-links';
import { fill, strings } from '../../src/core/i18n/strings';
import { Banner, IconButton, PrimaryButton, Sheet, TextButton } from './ui';
import { colors, layout, radius, spacing, type } from './theme';

type Props = { visible: boolean; remote: RemoteNas; onAdded(origin: string): void; onClose(): void };
/**
 * Add NAS in the browser build: one address, then a check that the launcher answers there. A NAS
 * without one is still added, and switching to it opens its DSM in a new tab. When nothing answers,
 * the likely cause is a certificate this browser does not trust yet, which it refuses silently in the
 * background: Open DSM lets the user accept it, and coming back to this page checks again. The name
 * starts as the host and becomes the DSM server name once that NAS's own launcher hands the list back.
 */
export function AddRemote({ visible, remote, onAdded, onClose }: Props) {
  const t = strings();
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<FindResult>();
  const run = useRef<AbortController | undefined>(undefined);
  const stop = () => { run.current?.abort(); run.current = undefined; setBusy(false); };
  useEffect(() => { if (!visible) { stop(); setInput(''); setResult(undefined); } }, [visible]);
  useEffect(() => () => run.current?.abort(), []);
  /** Set by Open DSM after a failed check: the next return to this page checks again */
  const recheck = useRef(false);
  const change = (value: string) => { stop(); recheck.current = false; setInput(value); setResult(undefined); };
  const add = (origin: string, launcher: string, flags: { dsm?: boolean; unanswered?: boolean } = {}) => { remote.add({ origin, launcher, name: hostOf(origin), ...flags }); onAdded(origin); };
  const find = async () => {
    recheck.current = false;
    if (!input.trim() || run.current) return;
    stop();
    const controller = new AbortController(); run.current = controller;
    setBusy(true); setResult(undefined);
    const found = await remote.find(input.trim(), controller.signal);
    if (run.current !== controller) return;
    run.current = undefined; setBusy(false);
    if (found.kind === 'found') add(found.origin, found.launcher); else setResult(found);
  };
  const findRef = useRef(find); findRef.current = find;
  useEffect(() => {
    if (!visible || typeof document === 'undefined') return;
    const back = () => { if (recheck.current && document.visibilityState === 'visible') void findRef.current(); };
    document.addEventListener('visibilitychange', back); window.addEventListener('focus', back);
    return () => { document.removeEventListener('visibilitychange', back); window.removeEventListener('focus', back); };
  }, [visible]);
  const openDsm = (origin: string) => { recheck.current = true; remote.openDsm(origin); };
  let host = '';
  try { host = hostOf(new URL(/^[a-z][a-z\d+.-]*:\/\//i.test(input.trim()) ? input.trim() : `http://${input.trim()}`).origin); } catch { /* Shown by the check */ }
  /** The launcher's path on this NAS; the same package serves it at the same path on the other one */
  const launcherOf = (origin: string) => new URL(new URL(remote.getState().links.find(l => l.origin === remote.self)?.launcher || origin).pathname, origin).href;
  return <Sheet visible={visible} onClose={onClose} label={t.close}>
    <View style={{ paddingHorizontal: layout.gutter, paddingBottom: spacing.sm, gap: spacing.md }}>
      <Text style={type.title} accessibilityRole="header">{t.addTitle}</Text>
      <View style={{ flexDirection: 'row', alignItems: 'center', borderRadius: radius.md, backgroundColor: colors.grouped }}>
        <TextInput accessibilityLabel={t.address} value={input} onChangeText={change} onSubmitEditing={() => void find()} autoFocus autoCapitalize="none" autoCorrect={false}
          keyboardType="url" returnKeyType="go" placeholder={t.webAddressPlaceholder} placeholderTextColor={colors.tertiary} style={[type.input, { flex: 1, minHeight: 48, paddingHorizontal: spacing.md }]} />
        {input ? <IconButton icon="cancel" label={t.clearAddress} color={colors.tertiary} onPress={() => change('')} /> : null}
      </View>
      <Text style={type.caption}>{t.webAddressHint}</Text>
      {busy ? <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md, minHeight: layout.hit }} accessibilityLiveRegion="polite">
        <ActivityIndicator color={colors.accent} />
        <Text style={[type.body, { flex: 1 }]} numberOfLines={2}>{fill(t.findingLauncher, { host })}</Text>
        <TextButton title={t.cancel} tone="neutral" onPress={stop} />
      </View> : null}
      {result?.kind === 'invalid' && (result.code === 'mixed' || result.code === 'quickconnect') ? <Banner tone="warning" icon={result.code === 'mixed' ? 'no-encryption' : 'info-outline'}
        title={result.code === 'mixed' ? t.webMixed : t.webQc} detail={result.code === 'mixed' ? t.webMixedDetail : t.webQcDetail} />
      : result?.kind === 'invalid' ? <Text style={[type.subhead, { color: colors.warning }]} accessibilityLiveRegion="polite">{result.code === 'scheme' && /^http:/i.test(input.trim()) ? t.webHttps : t[`err_${result.code}` as 'err_invalid'] ?? t.err_invalid}</Text> : null}
      {result?.kind === 'noLauncher' ? <View style={{ gap: spacing.sm }}>
        <Banner tone="info" icon="open-in-new" title={fill(t.noLauncherTitle, { host: hostOf(result.origin) })} detail={t.noLauncherDetail} />
        <PrimaryButton title={t.addToList} icon="add" onPress={() => add(result.origin, launcherOf(result.origin), { dsm: true })} />
      </View> : null}
      {result?.kind === 'unreachable' ? <View style={{ gap: spacing.sm }}>
        <Banner tone="warning" icon="cloud-off" title={fill(t.unreachableHost, { host: result.origin ? hostOf(result.origin) : host })} detail={result.origin ? t.unreachableDetail : undefined} />
        {result.origin ? <>
          <PrimaryButton title={t.openDsm} icon="open-in-new" onPress={() => openDsm(result.origin!)} />
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center' }}>
            <TextButton title={t.retry} icon="refresh" onPress={() => void find()} />
            <TextButton title={t.addAnyway} tone="neutral" onPress={() => add(result.origin!, launcherOf(result.origin!), { dsm: true, unanswered: true })} />
          </View>
        </> : <TextButton title={t.retry} icon="refresh" onPress={() => void find()} />}
      </View> : null}
      {!busy && !result ? <PrimaryButton title={t.testConnection} icon="search" onPress={() => void find()} disabled={!input.trim()} /> : null}
    </View>
  </Sheet>;
}
