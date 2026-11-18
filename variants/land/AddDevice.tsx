import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Linking, ScrollView, Text, TextInput, View } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import type { NasProfile } from '../../src/core/config';
import { normalizeServer } from '../../src/core/profiles/url';
import { NasQrError, parseNasQr, qrGroup, type NasQr } from '../../src/core/profiles/qr';
import { certState, hostName, mainCause, type CertState, type NasProber } from '../../src/core/profiles/probe';
import { causeText, fill, strings } from '../../src/core/i18n/strings';
import { Banner, BarContent, Icon, IconButton, PrimaryButton, Row, Separator, TextButton, TopBar, useBarInsets, useBlurTarget } from './ui';
import { CertBadge, certIcon } from './cert';
import { colors, layout, radius, spacing, type } from './theme';

/** quickconnect: the ID the origin came from; each later connection looks it up again */
export type SaveResult = { name: string; origin: string; sha256?: string; quickconnect?: string };
type Props = {
  prober: NasProber; profiles: NasProfile[];
  /** Change the address of a saved NAS instead of adding one */
  editing?: NasProfile;
  initialLink?: string;
  /** Opened from a Scan QR action */
  startScan?: boolean;
  onSave(result: SaveResult): Promise<void> | void;
  onQr(qr: NasQr): Promise<void>;
  onShowExisting(id: string): void;
  onClose(): void;
};
const needsTrust = (state: CertState) => state === 'untrusted' || state === 'mismatch' || state === 'changed';

export function AddDevice({ prober, profiles, editing, initialLink, startScan, onSave, onQr, onShowExisting, onClose }: Props) {
  const t = strings();
  const probe = useSyncExternalStore(prober.subscribe, prober.getState);
  const bars = useBarInsets();
  const [input, setInput] = useState(editing ? editing.origin : '');
  const [name, setName] = useState(editing?.name ?? ''), [nameEdited, setNameEdited] = useState(Boolean(editing));
  const [trust, setTrust] = useState(false), [choosing, setChoosing] = useState(false), [anyway, setAnyway] = useState(false), [details, setDetails] = useState(false);
  const [slow, setSlow] = useState(false), [saving, setSaving] = useState(false), [error, setError] = useState('');
  const [scanning, setScanning] = useState(false), [denied, setDenied] = useState(false), [qr, setQr] = useState<NasQr>();
  const [permission, requestPermission] = useCameraPermissions();
  const reading = useRef(false), mounted = useRef(true), blurTarget = useBlurTarget();
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; prober.reset(); }; }, [prober]);
  useEffect(() => { if (editing) prober.start(editing.origin); }, [editing, prober]);

  const best = probe.candidates.find(c => c.origin === probe.best);
  const answered = probe.candidates.filter(c => c.state === 'dsm');
  const pin = editing && best?.origin === editing.origin ? editing.sha256 : undefined;
  const cert = best ? certState(best.origin, best.tls, pin) : undefined;
  const duplicate = best ? profiles.find(p => p.origin === best.origin && p.id !== editing?.id) : undefined;
  // Default name: DSM server name, then host; never overwrite what the user typed
  useEffect(() => {
    if (nameEdited || !probe.host) return;
    if (probe.best || probe.nameLoaded || probe.phase === 'done') setName(probe.name || hostName(probe.host));
  }, [probe.best, probe.name, probe.nameLoaded, probe.phase, probe.host, nameEdited]);
  useEffect(() => { setTrust(false); setChoosing(false); }, [probe.best]);
  useEffect(() => { setDetails(false); }, [probe.input]);
  useEffect(() => {
    setSlow(false);
    if (probe.phase !== 'probing') return;
    const timer = setTimeout(() => setSlow(true), 6000);
    return () => clearTimeout(timer);
  }, [probe.phase, probe.input]);

  const change = (value: string) => {
    setInput(value); setAnyway(false); setError('');
    // Results belong to the address that was tested; Test connection or Enter starts a new probe
    if (probe.phase !== 'idle' || probe.error) prober.reset();
  };
  const submitAddress = () => { if (input.trim() && (input.trim() !== probe.input || probe.phase === 'idle')) prober.start(input.trim()); };
  const tested = probe.phase !== 'idle' && probe.input === input.trim();
  const read = (value: string) => {
    if (reading.current) return;
    reading.current = true; setScanning(false); setError('');
    try { setQr(parseNasQr(value)); } catch (e) { setError(t[e instanceof NasQrError ? e.code : 'invalidQr']); }
  };
  useEffect(() => { if (initialLink) { reading.current = false; read(initialLink); } }, [initialLink]);
  const typeAddress = () => { setScanning(false); setDenied(false); setQr(undefined); setError(''); reading.current = false; };
  const scan = async () => {
    reading.current = false; setError(''); setDenied(false); prober.cancel();
    try {
      const result = permission?.granted ? permission : await requestPermission();
      if (!mounted.current) return;
      if (result.granted) setScanning(true); else setDenied(true);
    } catch { if (mounted.current) setError(t.cameraFailed); }
  };
  useEffect(() => { if (startScan && !initialLink) void scan(); }, []);
  let fallback: string | undefined;
  // A QuickConnect address has no direct fallback: the directory decides where the NAS is
  if (!probe.quickconnect?.explicit) try { fallback = normalizeServer(input).origin; } catch { /* Shown as an address error */ }
  const target = anyway ? fallback : best?.origin;
  const blocked = !target || !name.trim() || Boolean(duplicate) || (!anyway && cert !== undefined && needsTrust(cert) && !trust);
  const save = async () => {
    if (blocked || saving || !target) return;
    setSaving(true); setError('');
    try {
      const sha256 = !anyway && best?.tls && target.startsWith('https:') && cert && (needsTrust(cert) || pin === best.tls.sha256) ? best.tls.sha256 : undefined;
      const quickconnect = anyway ? undefined : prober.quickConnectId();
      await onSave({ name: name.trim(), origin: target, ...(sha256 ? { sha256 } : {}), ...(quickconnect ? { quickconnect } : {}) });
    } catch { if (mounted.current) { setError(t.failed); setSaving(false); } }
  };
  const updating = qr && qrGroup(profiles, qr).length > 0;
  const title = qr ? t.confirm : editing ? t.editAddressTitle : t.addTitle;

  const status = () => {
    if (anyway && fallback) return <Banner tone={fallback.startsWith('http:') ? 'warning' : 'info'} icon={fallback.startsWith('http:') ? 'no-encryption' : 'info-outline'} title={fallback} detail={fallback.startsWith('http:') ? t.cert_httpDetail : undefined} />;
    if (probe.error) return <Text style={[type.subhead, { color: colors.warning, paddingHorizontal: spacing.xs }]} accessibilityLiveRegion="polite">{t[`err_${probe.error}`]}</Text>;
    if (probe.phase === 'probing' && !best) return <View style={{ gap: spacing.sm }} accessibilityLiveRegion="polite">
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md, minHeight: layout.hit }}>
        <ActivityIndicator color={colors.accent} />
        <Text style={[type.body, { flex: 1 }]}>{fill(probe.quickconnect?.explicit ? t.probingQc : t.probing, { host: probe.host || '' })}</Text>
        <TextButton title={t.cancel} tone="neutral" onPress={() => prober.cancel()} />
      </View>
      {slow ? <Text style={type.subhead}>{t.probingSlow}</Text> : null}
      <Candidates />
    </View>;
    if (probe.phase === 'done' && !best && (probe.candidates.length || probe.quickconnect)) {
      const stopped = probe.candidates.some(c => c.state === 'cancelled'), cause = stopped ? undefined : mainCause(probe), host = probe.host || '';
      // One line names the main cause and the next step; each address's own result is one tap away
      return <View style={{ gap: spacing.md }}>
      {stopped ? <Banner tone="info" icon="pause-circle-outline" title={fill(t.probeStopped, { host })} />
        : cause ? <Banner tone="warning" icon={cause === 'dns' || cause === 'qcNotFound' ? 'search-off' : 'cloud-off'} title={fill(t[`why_${cause}`], { host })} detail={t[`fix_${cause}`]} />
        : <Banner tone="warning" icon="search-off" title={fill(t.notFound, { host })} />}
      {details || stopped ? <Candidates /> : null}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
        <TextButton title={t.tryAgain} icon="refresh" onPress={() => prober.start(input)} />
        {!stopped && probe.candidates.length ? <TextButton title={details ? t.hideDetails : t.showDetails} tone="neutral" onPress={() => setDetails(!details)} /> : null}
        {fallback ? <TextButton title={t.useAnyway} tone="neutral" onPress={() => { prober.cancel(); setAnyway(true); }} /> : null}
      </View>
    </View>;
    }
    if (!best || !cert) return null;
    return <View style={{ gap: spacing.lg }}>
      <View style={{ gap: spacing.xs }}>
        <Text style={type.section}>{t.name}</Text>
        <TextInput accessibilityLabel={t.name} value={name} onChangeText={value => { setName(value); setNameEdited(true); }} placeholder={t.namePlaceholder} placeholderTextColor={colors.tertiary}
          style={[type.input, { minHeight: 48, paddingHorizontal: spacing.md, borderRadius: radius.md, backgroundColor: colors.grouped }]} returnKeyType="done" />
      </View>
      <View style={{ gap: spacing.xs }}>
        <Text style={type.section}>{t.connection}</Text>
        <View style={{ borderRadius: radius.md, backgroundColor: colors.grouped, overflow: 'hidden' }}>
          <Row icon={certIcon(cert)} iconColor={cert === 'trusted' ? colors.success : cert === 'changed' ? colors.danger : colors.warning}
            title={<Text style={type.body} selectable>{best.origin}</Text>} subtitle={<CertBadge state={cert} pinned={Boolean(pin)} />}
            trailing={answered.length > 1 ? <TextButton title={t.change} onPress={() => setChoosing(!choosing)} /> : null} />
          {choosing ? answered.filter(c => c.origin !== best.origin).map(c => <View key={c.origin}><Separator inset={layout.gutter} />
            <Row icon="radio-button-unchecked" iconColor={colors.tertiary} title={c.origin} subtitle={<CertBadge state={certState(c.origin, c.tls)} />} label={c.origin} onPress={() => { prober.choose(c.origin); }} />
          </View>) : null}
          {best.tls && cert !== 'http' && cert !== 'trusted' || pin ? <><Separator inset={layout.gutter} /><Row title={t.fingerprint} subtitle={(best.tls?.sha256 ?? '').replace(/(..)(?=.)/g, '$1:').toUpperCase()} mono /></> : null}
          {needsTrust(cert) ? <><Separator inset={layout.gutter} />
            <Row icon={trust ? 'check-box' : 'check-box-outline-blank'} iconColor={trust ? colors.accent : colors.secondary} title={cert === 'changed' ? t.trustNew : t.trustThis} subtitle={t.trustHelp}
              label={t.trustThis} selected={trust} onPress={() => setTrust(!trust)} />
          </> : null}
        </View>
        {probe.phase === 'probing' ? <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingTop: spacing.xs }}><ActivityIndicator size="small" color={colors.tertiary} /><Text style={type.caption}>{t.checkingHttps}</Text></View> : null}
      </View>
      {cert === 'changed' ? <Banner tone="danger" title={t.cert_changed} detail={t.cert_changedDetail} /> : null}
      {cert === 'http' ? <Banner tone="warning" icon="no-encryption" title={t.cert_http} detail={t.cert_httpDetail} /> : null}
      {duplicate ? <Banner tone="info" title={fill(t.alreadyAdded, { name: duplicate.name })} action={t.openSaved} onAction={() => onShowExisting(duplicate.id)} /> : null}
    </View>;
  };
  function Candidates() {
    const qc = probe.quickconnect;
    const row = (key: string, pending: boolean, ok: boolean, label: string, cause?: string) => <View key={key} style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: 24 }}>
      {pending ? <ActivityIndicator size="small" color={colors.tertiary} /> : <Icon name={ok ? 'check-circle' : 'remove-circle-outline'} size={16} color={ok ? colors.success : colors.tertiary} />}
      <Text style={[type.caption, { flex: 1 }]} selectable>{label}</Text>
      {cause ? <Text style={type.caption}>{cause}</Text> : null}
    </View>;
    return <View style={{ gap: spacing.xxs }}>
      {qc && (qc.explicit || qc.state !== 'failed' || qc.cause !== 'qcNotFound') ? row('qc', qc.state === 'pending', qc.state === 'done', fill(t.viaQc, { id: qc.id }), qc.state === 'failed' && qc.cause ? fill(t[`why_${qc.cause}`], { host: qc.id }) : undefined) : null}
      {probe.candidates.map(c => row(c.origin, c.state === 'pending', c.state === 'dsm', c.origin.startsWith('relay:') ? t.kind_relay : c.qc ? `${c.origin} · ${t[`kind_${c.qc.kind}`]}` : c.origin,
        c.state !== 'pending' && c.state !== 'dsm' ? (c.cause === 'wrongNas' ? t.why_wrongNas : c.state === 'other' ? (c.status && c.status !== 200 ? causeText(t, `HTTP_${c.status}`) : t.cause_other) : causeText(t, c.state === 'cancelled' ? 'cancelled' : c.cause)) : undefined))}
    </View>;
  }

  const body = qr ? <View style={{ gap: spacing.lg }}>
    <Text style={type.hero} selectable>{qr.name}</Text>
    {updating ? <Banner tone="warning" title={t.updating} /> : null}
    <View style={{ borderRadius: radius.md, backgroundColor: colors.grouped, overflow: 'hidden' }}>
      {qr.urls.map((address, index) => <View key={address.url}>{index ? <Separator inset={layout.gutter} /> : null}
        <Row icon={address.url.startsWith('http:') ? 'no-encryption' : address.sha256 ? 'gpp-maybe' : 'lock'} iconColor={address.url.startsWith('http:') || address.sha256 ? colors.warning : colors.success}
          title={<Text style={type.body} selectable>{address.url}</Text>}
          subtitle={<View style={{ gap: spacing.xxs }}>
            <Text style={type.subhead}>{`${t[`kind_${address.kind}`]} · ${address.url.startsWith('http:') ? t.cert_http : address.sha256 ? t.pin : t.system}`}</Text>
            {address.sha256 ? <Text style={type.mono} selectable>{`SHA-256 ${address.sha256}`}</Text> : null}
          </View>} />
      </View>)}
    </View>
    {qr.urls.some(a => a.url.startsWith('http:')) ? <Banner tone="warning" icon="no-encryption" title={t.cert_http} detail={t.cert_httpDetail} /> : null}
    {qr.urls.length > 1 ? <Text style={type.subhead}>{t.grouped}</Text> : null}
  </View> : scanning ? <View style={{ gap: spacing.md }}>
    <Text style={type.subhead}>{t.scanning}</Text>
    <CameraView style={{ height: 320, borderRadius: radius.lg, overflow: 'hidden' }} facing="back" barcodeScannerSettings={{ barcodeTypes: ['qr'] }} onBarcodeScanned={({ data }) => read(data)} onMountError={() => { setScanning(false); setError(t.cameraFailed); }} />
  </View> : <View style={{ gap: spacing.lg }}>
    <View style={{ gap: spacing.xs }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', minHeight: 48, paddingLeft: spacing.md, borderRadius: radius.md, backgroundColor: colors.grouped }}>
        <Icon name="dns" size={20} color={colors.secondary} />
        <TextInput accessibilityLabel={t.address} value={input} onChangeText={change} onSubmitEditing={submitAddress} autoFocus={!editing} autoCapitalize="none" autoCorrect={false}
          keyboardType="url" returnKeyType="go" placeholder={t.addressPlaceholder} placeholderTextColor={colors.tertiary} style={[type.input, { flex: 1, minHeight: 48, paddingHorizontal: spacing.md }]} />
        {input ? <IconButton icon="cancel" label={t.clearAddress} color={colors.tertiary} onPress={() => change('')} /> : null}
        {!editing ? <IconButton icon="qr-code-scanner" label={t.scanQr} color={colors.accent} onPress={scan} /> : null}
      </View>
      {!input && probe.phase === 'idle' ? <Text style={[type.caption, { paddingHorizontal: spacing.xs }]}>{t.addressHint}</Text> : null}
    </View>
    {denied ? <Banner tone="warning" icon="no-photography" title={t.cameraDenied} action={t.cameraSettings} onAction={() => { void Linking.openSettings().catch(() => setError(t.cameraFailed)); }} /> : null}
    {status()}
  </View>;

  const primary = qr ? <PrimaryButton title={updating ? t.update : t.addQr} busy={saving} onPress={async () => { if (saving) return; setSaving(true); try { await onQr(qr); } catch { if (mounted.current) { setError(t.failed); setSaving(false); } } }} />
    : scanning ? null
    : (best || anyway) ? <PrimaryButton title={editing ? t.saveAndSignIn : t.add} disabled={blocked} busy={saving} onPress={save} />
    : input.trim() && !tested && !probe.error ? <PrimaryButton title={t.testConnection} icon="network-check" onPress={submitAddress} /> : null;
  // Edge-to-edge Android does not resize for the keyboard; keep the primary button above it
  return <KeyboardAvoidingView behavior="padding" style={{ flex: 1, backgroundColor: colors.background }}>
    <TopBar blurTarget={blurTarget} left={<IconButton icon={qr || scanning ? 'arrow-back' : 'close'} label={qr || scanning ? t.back : t.close} onPress={qr || scanning ? typeAddress : onClose} />} title={title} />
    <BarContent target={blurTarget}><ScrollView contentContainerStyle={{ paddingTop: bars.top + spacing.lg, paddingHorizontal: layout.gutter, paddingBottom: spacing.xxl, gap: spacing.lg }} keyboardShouldPersistTaps="handled">
      {body}
      {error ? <Banner tone="warning" title={error} /> : null}
      {qr || scanning || denied ? <TextButton title={t.typeAddress} onPress={typeAddress} /> : null}
    </ScrollView></BarContent>
    {primary ? <View style={{ paddingHorizontal: layout.gutter, paddingTop: spacing.sm, paddingBottom: bars.rawBottom + spacing.sm, backgroundColor: colors.background }}>{primary}</View> : null}
  </KeyboardAvoidingView>;
}
