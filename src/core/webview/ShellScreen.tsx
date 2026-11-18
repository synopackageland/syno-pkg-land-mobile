import { useCallback, useEffect, useMemo, useRef, useState, type ComponentRef, type ReactNode } from 'react';
import { Alert, BackHandler, Dimensions, Linking, PermissionsAndroid, Platform, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as SplashScreen from 'expo-splash-screen';
import { WebView } from 'react-native-webview';
import Native from '../../../modules/webview-cookies';
import type { AppTarget, Launch, NasProfile, ShellConfig } from '../config';
import { BridgeHost } from '../bridge/host';
import { MAX_BASE64, type NativeBridge, type NativeEvent } from '../bridge/contract';
import { bridgeScript, eventScript } from '../bridge/injection';
import { intakeInbox } from '../intake/inbox';
import { launchUrl, sameOrigin } from '../profiles/url';
import { download } from '../transfers/download';
import { EntryRecovery, contentProbe } from './recovery';
import { COVER_DELAY, COVER_SLOW, FIT_WAIT, HOST_WAIT, cover, keyboardOverlap, type CoverEvent, type CoverPhase } from './cover';
import { LaunchCover } from './LaunchCover';
import { desktopPreset, mobilePreset, navigation } from './policy';
import { fitApp, fitCallScript, fitLaunchScript, hostedApp, mobileFitOn, mobileFitScript, type FitApp } from './mobile-fit';
import { runtimeProbe, runtimeValues } from '../discovery/runtime';
import { strings } from '../i18n/strings';
import { SignInSession, signInScript } from '../session/sign-in';
import { storageResetScript } from '../session/storage-reset';

const shortSide = () => { const { width, height } = Dimensions.get('screen'); return Math.min(width, height); };
export type ShellScreenProps = {
  config: ShellConfig; profile: NasProfile; target: AppTarget;
  active?: boolean; launch?: Launch; onExit?: () => void;
  safeAreaEdges?: Array<'top' | 'bottom'>;
  onCreated?: () => void;
  onAuthenticated?: () => void;
  onRuntimeVisibility?: (scope: string, values: Record<string, boolean>) => void;
  /** Launch cover: App name, icon slot and color */
  title?: string; icon?: ReactNode; tint?: string;
  /** Mobile fit, single-App mode: the App on screen changed */
  onFitApp?: (app: FitApp) => void;
  /** The time of the shell's back press: goes back once, like the Android back button (presses before this screen became active are ignored) */
  backRequest?: number;
  /** The time of the App menu press: toggles the App's side menu (single-App mode) */
  menuRequest?: number;
  /** Loads the page while hidden (the warm DSM page) */
  preload?: boolean;
  /**
   * The warm DSM page: while active, it shows this DSM App, opened inside the loaded page
   * (dsm-fit.js launch()); a new request opens it again. Leaving closes it and keeps the page.
   */
  host?: { app: string; request: number };
  /** The warm page could not open the App (no such App, a dead page, too slow): open it on its own */
  onHostFailed?: (request: number) => void;
};
/** Keep mounted to resume warm; no AppState reload or request abort */
export function ShellScreen({ config, profile, target, active = true, launch, onExit, safeAreaEdges = ['top', 'bottom'], onCreated, onAuthenticated, onRuntimeVisibility, title, icon, tint, onFitApp, backRequest, menuRequest, host: warm, onHostFailed }: ShellScreenProps) {
  const t = strings();
  const web = useRef<WebView<{}>>(null);
  const createdCallback = useRef(onCreated); createdCallback.current = onCreated;
  const attachWeb = useCallback((instance: WebView<{}> | null) => { web.current = instance; if (instance) createdCallback.current?.(); }, []);
  // A warm retained view also acknowledges a new launcher request.
  useEffect(() => { if (web.current) onCreated?.(); }, [onCreated]);
  const viewId = useRef<number | null>(null);
  const signIn = useRef(new SignInSession(profile.origin));
  useEffect(() => {
    if (!onAuthenticated || !active) return;
    const sub = Native.addListener('onSignIn', event => {
      if (signIn.current.accept(event, viewId.current, Native.sessionKey(profile.origin))) onAuthenticated();
    });
    return () => sub.remove();
  }, [active, onAuthenticated, profile.origin]);
  const currentUrl = useRef('about:blank');
  const historyReset = useRef(false), pageReady = useRef(false);
  const queuedLaunch = useRef<Launch | undefined>(undefined);
  const bound = useRef(false), splashHidden = useRef(false), fitBound = useRef(false);
  // Single-App mode: back steps the page reported (dialogs, menus, stacked Apps)
  const fitSteps = useRef(0);
  // A single-App page is ready when it reports its App window, not when its document has content.
  // The warm page (host) opens each DSM App inside it once the fit says it can (fitReady).
  const waitFit = target.preset === 'desktop' && Boolean(warm || hostedApp(target.url, profile.origin));
  // fitBusy: the App's window is up, still under DSM's loading mask
  const fitSeen = useRef(false), fitReady = useRef(false), fitBusy = useRef(false);
  const hosting = useRef({ launched: 0, at: 0, failed: 0 });
  const live = useRef({ host: warm, onHostFailed, active }); live.current = { host: warm, onHostFailed, active };
  const goBack = useRef<() => void>(() => {});
  const recovery = useRef(new EntryRecovery());
  const [attempt, setAttempt] = useState(0);
  const mountedAttempt = useRef(0);
  const [phase, setPhase] = useState<CoverPhase>('pending');
  const step = (event: CoverEvent) => setPhase(previous => cover(previous, event));
  const frame = useRef<ComponentRef<typeof View>>(null);
  const [keyboard, setKeyboard] = useState({ frameBottom: 0, top: null as number | null });
  const [uri, setUri] = useState('about:blank');
  const [error, setError] = useState('');
  const [progress, setProgress] = useState(0);
  const [transfers, setTransfers] = useState<Record<string, number | null>>({});
  const safety = useRef<ReturnType<typeof setTimeout>[]>([]);
  const transferIds = useRef(new Set<string>());
  const enabled = target.registered && target.preset === 'mobile';
  const description = useMemo<Omit<NativeBridge, 'post'>>(() => ({
    protocol: 1, shell: { name: config.name, version: config.version, platform: Platform.OS === 'ios' ? 'ios' : 'android' },
    caps: {
      download: { base64: target.capabilities.includes('download'), url: target.capabilities.includes('download'), maxBase64: MAX_BASE64 },
      openExternal: target.capabilities.includes('open-external'), intake: true,
      camera: !target.capabilities.includes('camera') ? false : profile.origin.startsWith('https:') ? 'live' : 'capture',
    },
    // The page may ask to go back to the App list (the UI kit's Back in its phone bar)
    ...(onExit ? { features: ['close'] } : {}),
  }), [config.name, config.version, profile.origin, target.capabilities, Boolean(onExit)]);
  const hideSplash = () => {
    if (!splashHidden.current) { splashHidden.current = true; SplashScreen.hideAsync().catch(() => {}); }
  };
  const failHost = (request: number) => {
    if (!request || hosting.current.failed === request) return;
    hosting.current.failed = request;
    live.current.onHostFailed?.(request);
  };
  /** The warm page: open the App asked for once the fit can host it */
  const launchHosted = () => {
    const request = live.current.host?.request || 0, app = live.current.host?.app;
    if (!live.current.active || !app || !request || !fitBound.current || !fitReady.current || hosting.current.launched === request) return;
    hosting.current.launched = request; hosting.current.at = Date.now(); fitSeen.current = false; fitBusy.current = false;
    web.current?.injectJavaScript(fitLaunchScript(profile.origin, app));
  };
  const emit = (event: NativeEvent) => { web.current?.injectJavaScript(eventScript(profile.origin, event)); };
  const ready = () => {
    recovery.current.content(recovery.current.attempt, true);
    if (recovery.current.phase !== 'ready') return;
    pageReady.current = true;
    if (!waitFit || fitSeen.current || !fitBound.current) { step('ready'); hideSplash(); }
    else if (!warm) safety.current.push(setTimeout(() => { if (!fitSeen.current) { step('ready'); hideSplash(); } }, FIT_WAIT));
    if (queuedLaunch.current) { emit({ v: 1, type: 'launch', ...queuedLaunch.current }); queuedLaunch.current = undefined; }
  };
  const exit = useRef(onExit); exit.current = onExit;
  const shown = useRef(active); shown.current = active;
  const host = useMemo(() => new BridgeHost(profile.origin, target.capabilities, intakeInbox, {
    ready, emit,
    // Only the App on screen may leave; a warm App in the background is ignored
    close: onExit ? () => { if (shown.current) exit.current?.(); } : undefined,
    openExternal: async url => { await Linking.openURL(url); },
    download: async message => {
      const id = message.id || `transfer-${Date.now()}`;
      transferIds.current.add(id);
      setTransfers(previous => ({ ...previous, [id]: 0 }));
      try { await download(message, profile.origin, id, emit); }
      finally { transferIds.current.delete(id); setTransfers(previous => { const next = { ...previous }; delete next[id]; return next; }); }
    },
  }), [profile.origin, target.capabilities, Boolean(onExit)]);

  useEffect(() => {
    safety.current.push(setTimeout(hideSplash, 10000)); // Splash safety only; never cancels a request
    let listening = true, pendingBack = false;
    const back = () => {
      if (!active) return false;
      if (pendingBack) return true;
      // Single-App mode: the page closes its own steps first (not WebView history, see dsm-fit.js)
      if (fitBound.current && fitSteps.current > 0) {
        fitSteps.current--;
        web.current?.injectJavaScript(fitCallScript(profile.origin, 'back'));
        return true;
      }
      const id = viewId.current;
      if (id === null) { if (onExit) { onExit(); return true; } return false; }
      pendingBack = true;
      // Native history is authoritative after clearHistory and pushState.
      void Native.goBackIfPossible(id).then(moved => {
        if (listening && !moved) { if (onExit) onExit(); else BackHandler.exitApp(); }
      }).catch(() => { if (listening) setError(t.backFailed); })
        .finally(() => { pendingBack = false; });
      return true;
    };
    goBack.current = () => { back(); };
    const sub = BackHandler.addEventListener('hardwareBackPress', back);
    return () => { listening = false; goBack.current = () => {}; sub.remove(); safety.current.forEach(clearTimeout); };
  }, [active, onExit]);
  useEffect(() => {
    const sub = Native.addListener('onBridgeMessage', event => {
      if (!enabled || event.viewId !== viewId.current || event.origin !== profile.origin) return;
      let envelope: { internal?: string; id?: string; message?: unknown };
      try { envelope = JSON.parse(event.data); } catch { return; }
      if (envelope.internal === 'camera' && target.capabilities.includes('camera') && event.userActivated) {
        const id = envelope.id;
        PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.CAMERA).then(result => {
          web.current?.injectJavaScript(`if(location.origin===${JSON.stringify(profile.origin)} && window.__synoCameraDone)window.__synoCameraDone(${JSON.stringify(id)},${result === 'granted'});true;`);
        }).catch(() => {});
        return;
      }
      if (event.userActivated) host.activate();
      void host.receive(envelope.message, event.origin);
    });
    const transfers = Native.addListener('onTransfer', event => {
      if (transferIds.current.has(event.id)) {
        const fraction = event.total > 0 ? Math.min(1, event.received / event.total) : null;
        setTransfers(previous => ({ ...previous, [event.id]: fraction }));
        emit({ v: 1, type: 'transfer', id: event.id, state: 'downloading', ...(fraction !== null ? { progress: fraction } : {}) });
      }
    });
    return () => { sub.remove(); transfers.remove(); };
  }, [enabled, profile.origin, target.capabilities, host]);
  useEffect(() => () => { if (viewId.current !== null) Native.unbindBridge(viewId.current).catch(() => {}); }, []);
  useEffect(() => {
    const sub = Native.addListener('onDocument', event => {
      if (event.viewId !== viewId.current) return;
      if (event.stage === 'start') {
        pageReady.current = false; fitSteps.current = 0; recovery.current.restart();
        fitSeen.current = false; fitBusy.current = false; fitReady.current = false; hosting.current.launched = 0;
        step('start'); setError('');
      } else web.current?.injectJavaScript(contentProbe(profile.origin, recovery.current.attempt));
    });
    return () => sub.remove();
  }, [profile.origin]);
  useEffect(() => {
    if (phase !== 'pending' && phase !== 'shown') return;
    const timer = setTimeout(() => step(phase === 'pending' ? 'delay' : 'slow'), phase === 'pending' ? COVER_DELAY : COVER_SLOW - COVER_DELAY);
    return () => clearTimeout(timer);
  }, [phase]);
  // Edge-to-edge windows do not resize for the keyboard: shrink the page above it so the
  // viewport (innerHeight/visualViewport) shrinks and the focused field scrolls into view
  useEffect(() => {
    const sub = Native.addListener('onKeyboard', event => {
      const top = event.top >= 0 ? event.top : null;
      if (top === null) { setKeyboard(previous => previous.top === null ? previous : { ...previous, top }); return; }
      if (frame.current?.measureInWindow) frame.current.measureInWindow((_x: number, y: number, _width: number, height: number) => setKeyboard({ frameBottom: y + height, top }));
      else setKeyboard(previous => ({ ...previous, top }));
    });
    return () => sub.remove();
  }, []);
  // The shell's own back button and the App menu button (desktop Apps). A warm screen gets
  // the latest press time when it becomes active again; only presses after that count.
  const activeSince = useRef(0), wasActive = useRef(false);
  if (active && !wasActive.current) activeSince.current = Date.now();
  wasActive.current = active;
  useEffect(() => {
    if (active && backRequest && backRequest > activeSince.current) goBack.current();
  }, [backRequest]);
  useEffect(() => {
    if (active && menuRequest && menuRequest > activeSince.current && fitBound.current) web.current?.injectJavaScript(fitCallScript(profile.origin, 'menu'));
  }, [menuRequest]);
  // A warm screen shown again reports the App on screen again for the title row
  useEffect(() => {
    if (active && fitBound.current && !warm) web.current?.injectJavaScript(fitCallScript(profile.origin, 'sync'));
  }, [active, launch]);
  const lastLaunch = useRef(launch);
  useEffect(() => {
    if (launch && launch !== lastLaunch.current && enabled) {
      if (pageReady.current) emit({ v: 1, type: 'launch', ...launch }); else queuedLaunch.current = launch;
    }
    lastLaunch.current = launch;
  }, [launch, enabled]);

  // A warm-page request: the cover shows until the App it hosts reports its window; leaving closes it
  const hostRequest = active ? warm?.request || 0 : 0;
  useEffect(() => {
    if (!warm) return;
    fitSeen.current = false; fitBusy.current = false;
    if (hostRequest) {
      hosting.current.at = Date.now();
      if (hosting.current.failed === hostRequest) return;
      step('start'); fitSteps.current = 0;
      if (error) { failHost(hostRequest); return; }
      launchHosted();
      return;
    }
    hosting.current.launched = 0;
    if (fitBound.current) web.current?.injectJavaScript(fitCallScript(profile.origin, 'home'));
    step('start'); fitSteps.current = 0;
  }, [hostRequest]);
  useEffect(() => {
    if (!hostRequest) return;
    const timer = setInterval(() => {
      if (fitSeen.current) return;
      // The App's window is up but its loading mask stays: shown as it is after the wait
      if (fitBusy.current) { if (Date.now() - hosting.current.at > FIT_WAIT) { fitSeen.current = true; step('ready'); hideSplash(); } return; }
      // Too slow, or a page that cannot host Apps (a sign-in page, an older DSM): the App opens on its own
      if (Date.now() - hosting.current.at > HOST_WAIT && (hosting.current.launched === hostRequest || pageReady.current)) failHost(hostRequest);
    }, 250);
    return () => clearInterval(timer);
  }, [hostRequest]);

  const retry = () => {
    if (warm && hostRequest) { failHost(hostRequest); return; }
    if (viewId.current !== null) void Native.unbindBridge(viewId.current).catch(() => {});
    recovery.current.restart();
    bound.current = false; fitBound.current = false; fitSteps.current = 0; viewId.current = null;
    pageReady.current = false; historyReset.current = false;
    signIn.current = new SignInSession(profile.origin);
    currentUrl.current = 'about:blank';
    setError(''); step('start'); setProgress(0); setUri('about:blank');
    mountedAttempt.current++;
    setAttempt(mountedAttempt.current);
  };
  const initialize = async (id: number) => {
    if (attempt !== mountedAttempt.current || bound.current) return;
    bound.current = true; viewId.current = id;
    const initializing = recovery.current.attempt;
    try {
      await Native.zeroWebViewInsets();
      if (initializing !== recovery.current.attempt) return;
      const ok = await Native.bindBridge(id, profile.origin, enabled ? bridgeScript(profile.origin, description) : '', target.capabilities.includes('camera'), onAuthenticated ? signInScript(profile.origin) : '', storageResetScript(profile.origin, Native.storageReset(profile.origin)));
      if (initializing !== recovery.current.attempt) { void Native.unbindBridge(id).catch(() => {}); return; }
      if (!ok && (enabled || onAuthenticated)) { setError(t.webviewUpdate); hideSplash(); return; }
      // Fit desktop DSM Apps to the phone (presentation only); a per-NAS setting, on by default on phones
      if (target.preset === 'desktop' && mobileFitOn(profile, shortSide())) fitBound.current = await Native.bindFit(id, profile.origin, mobileFitScript(profile.origin)).catch(() => false);
      if (!sameOrigin(target.url, profile.origin)) throw new Error('Invalid target');
      setUri(enabled ? launchUrl(target.url, launch) : target.url);
    } catch { if (initializing === recovery.current.attempt) { setError(t.webviewFailed); hideSplash(); } }
  };
  const external = (url: string) => { if (/^https?:/.test(url)) Linking.openURL(url).catch(() => Alert.alert(t.linkFailed)); };
  return <SafeAreaView style={styles.root} edges={safeAreaEdges}><View ref={frame} style={[styles.root, { paddingBottom: active ? keyboardOverlap(keyboard.frameBottom, keyboard.top) : 0 }]}>
    {progress > 0 && progress < 1 ? <View style={[styles.progress, { width: `${progress * 100}%` }]} /> : null}
    <WebView<{}>
      key={attempt} ref={attachWeb} source={{ uri }} {...(target.preset === 'desktop' ? desktopPreset : mobilePreset)}
      applicationNameForUserAgent={`SynoPkgLand/${config.version}`}
      onLoadEnd={event => {
        if (attempt !== mountedAttempt.current) return;
        if (event.nativeEvent.url === 'about:blank' && 'target' in event.nativeEvent && typeof event.nativeEvent.target === 'number') { void initialize(event.nativeEvent.target); return; }
        if (event.nativeEvent.url === 'about:blank') return;
        recovery.current.loaded();
        web.current?.injectJavaScript(contentProbe(profile.origin, recovery.current.attempt));
        if (onRuntimeVisibility) web.current?.injectJavaScript(runtimeProbe(profile.origin, Native.sessionKey(profile.origin)));
        if (!historyReset.current) { historyReset.current = true; web.current?.clearHistory?.(); }
        safety.current.push(setTimeout(hideSplash, 4000));
      }}
      onLoadStart={event => {
        if (attempt !== mountedAttempt.current) return;
        currentUrl.current = event.nativeEvent.url;
        // Android also emits this for pushState/hash changes. Only the native
        // onPageStarted event above starts a new document/recovery attempt.
      }}
      onMessage={event => {
        if (attempt !== mountedAttempt.current) return;
        if (!sameOrigin(event.nativeEvent.url, profile.origin)) return;
        try {
          const message = JSON.parse(event.nativeEvent.data);
          if (message.internal === 'runtimeVisibility' && message.origin === profile.origin && typeof message.scope === 'string' && message.scope === Native.sessionKey(profile.origin)) {
            const values = runtimeValues(message.values);
            if (values) onRuntimeVisibility?.(message.scope, values);
            return;
          }
          // Single-App mode reports (presentation only): the App on screen, or that it closed itself
          if (fitBound.current && message.origin === profile.origin && ['fitApp', 'fitClosed', 'fitReady', 'fitLaunch'].includes(message.internal)) {
            if (message.internal === 'fitReady') { fitReady.current = true; launchHosted(); return; }
            if (!active) return;
            if (message.internal === 'fitLaunch') { if (message.ok === false) failHost(live.current.host?.request || 0); return; }
            if (message.internal === 'fitClosed') { fitSteps.current = 0; onExit?.(); }
            else {
              const app = fitApp(message.app);
              if (!app || warm && !hosting.current.launched) return;
              fitSteps.current = app.back; onFitApp?.(app);
              // DSM's own loading mask stays under the cover; the page reports again once it is gone
              if (app.busy) { fitBusy.current = true; return; }
              if (!fitSeen.current) { fitSeen.current = true; if (pageReady.current || warm) { step('ready'); hideSplash(); } }
            }
            return;
          }
          if (message.internal !== 'content' || message.origin !== profile.origin) return;
          recovery.current.content(message.attempt, true);
          if (recovery.current.phase === 'ready') ready();
        } catch { /* Content observations never authorize native actions */ }
      }}
      onLoadProgress={event => setProgress(event.nativeEvent.progress)}
      onNavigationStateChange={state => { if (attempt === mountedAttempt.current) currentUrl.current = state.url; }}
      onError={() => { if (attempt !== mountedAttempt.current) return; recovery.current.failed(); setError(t.connectFailed); hideSplash(); failHost(hostRequest); }}
      onHttpError={event => {
        if (attempt !== mountedAttempt.current) return;
        if (event.nativeEvent.url === currentUrl.current && event.nativeEvent.statusCode >= 400) {
          recovery.current.failed(); setError(t.loadFailed); hideSplash(); failHost(hostRequest);
        }
      }}
      onRenderProcessGone={() => { if (attempt === mountedAttempt.current) retry(); }}
      onShouldStartLoadWithRequest={request => {
        const action = navigation(request.url, profile.origin, request.isTopFrame !== false);
        if (action === 'external') external(request.url);
        return action === 'allow';
      }}
      onOpenWindow={event => {
        const url = event.nativeEvent.targetUrl;
        if (sameOrigin(url, profile.origin)) web.current?.injectJavaScript(`location.href=${JSON.stringify(url)};true;`);
        else external(url);
      }}
      onFileDownload={event => {
        const url = event.nativeEvent.downloadUrl;
        if (sameOrigin(url, profile.origin)) void download({ v: 1, type: 'download', id: `file_${Date.now()}`, filename: 'download', mime: 'application/octet-stream', url }, profile.origin, `file-${Date.now()}`).catch(() => Alert.alert(t.downloadFailed));
      }}
      sharedCookiesEnabled thirdPartyCookiesEnabled={false} webviewDebuggingEnabled
      javaScriptCanOpenWindowsAutomatically={false} setSupportMultipleWindows
      allowFileAccess={false} allowUniversalAccessFromFileURLs={false} mixedContentMode="never"
      geolocationEnabled={false} mediaPlaybackRequiresUserAction style={styles.root}
    />
    {Object.keys(transfers).length ? <View style={styles.transfers} accessibilityLiveRegion="polite">
      {Object.entries(transfers).map(([id, fraction]) => <Text key={id}>{t.downloading}{fraction === null ? '' : ` ${Math.round(fraction * 100)}%`}</Text>)}
    </View> : null}
    <LaunchCover phase={phase} title={title} icon={icon} tint={tint} message={error || undefined}
      labels={{ loading: t.loadingApp, slow: t.openingSlow, reopen: t.reopen, back: t.back }}
      onReopen={retry} onBack={onExit} onFaded={() => step('faded')} />
  </View></SafeAreaView>;
}
const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#fff' },
  progress: { position: 'absolute', top: 0, height: 2, backgroundColor: '#1D6FE8', zIndex: 2 },
  transfers: { position: 'absolute', bottom: 24, left: 16, right: 16, padding: 12, borderRadius: 12, backgroundColor: '#E8F1FD' },
});
