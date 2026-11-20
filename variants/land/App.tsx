import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { AppState, Animated, Dimensions, Easing, Image, Platform, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import { uuid } from 'expo';
import { StatusBar } from 'expo-status-bar';
import * as SplashScreen from 'expo-splash-screen';
import Native from '../../modules/webview-cookies';
import { BackHandler, restoredScreen, useBackDepth, useBackScreen } from '../../src/core/back';
import { useBooted } from '../../src/core/boot';
import { remoteNas } from '../../src/core/profiles/remote';
import type { NasLink } from '../../src/core/profiles/nas-links';
import { ShellPool } from '../../src/core/webview/ShellPool';
import { ShellScreen } from '../../src/core/webview/ShellScreen';
import { createDiscovery } from '../../src/core/discovery/client';
import type { DiscoveredApp } from '../../src/core/discovery/schema';
import { LauncherModel, intakeChoice } from '../../src/core/launcher/model';
import { launcherStorage } from '../../src/core/launcher/storage';
import { intakeInbox } from '../../src/core/intake/inbox';
import { cleanupDownloads } from '../../src/core/transfers/download';
import type { Launch, NasProfile } from '../../src/core/config';
import { hostedApp, mobileFitOn, warmUrl, type FitApp } from '../../src/core/webview/mobile-fit';
import { updateApp, updatePageUrl } from '../../src/core/status/modules/upgrade';
import type { NativeIntakeItem } from '../../src/core/bridge/contract';
import { NasProber, certState } from '../../src/core/profiles/probe';
import type { QcPost } from '../../src/core/profiles/quickconnect';
import { qrGroup } from '../../src/core/profiles/qr';
import { fill, strings } from '../../src/core/i18n/strings';
import { AddDevice, type SaveResult } from './AddDevice';
import { SignIn } from './SignIn';
import { Overview } from './Overview';
import { AppsTab } from './AppsTab';
import { Stack, SLIDE, type Page } from './Stack';
import { Gate } from './TabParts';
import { LaunchCover, useReducedMotion } from '../../src/core/webview/LaunchCover';
import { DeviceDetail, DeviceMenu, DeviceSheet, Devices, ageText, type RowState } from './Devices';
import { AddRemote } from './AddRemote';
import { AppIcon, tileOf } from './AppIcon';
import { iconCache } from '../../src/core/icons/store';
import { ConfirmSheet, IconButton, Row, Sheet, TabBar, TabBarShown, TextButton, TopBar, badgeText, useBarInsets, useBlurTarget } from './ui';
import { colors, layout, spacing, type } from './theme';
import { landConfig } from './config';
import { StatusModel, dsmLang, moreUnread, unreadCount, type Mode } from '../../src/core/status/model';
import { statusStorage } from '../../src/core/status/storage';
import { StatusScreen, type StatusTab } from './Status';
import { Notifications } from './Notifications';
SplashScreen.preventAutoHideAsync().catch(() => {});

type OpenApp = { target: DiscoveredApp; launch: Launch; request: number };
/** Bottom tabs; each keeps its own stack of native pages, and the tab bar stays on screen over them */
type TabKey = 'overview' | 'apps' | 'notifications';
type Route = { kind: 'detail'; id: string } | { kind: 'status'; tab?: StatusTab } | { kind: 'devices' };
type Stacks = Record<TabKey, Route[]>;
const emptyStacks = (): Stacks => ({ overview: [], apps: [], notifications: [] });
const routeKey = (route: Route, index: number) => `${index}:${route.kind}:${route.kind === 'detail' ? route.id : route.kind === 'status' ? route.tab ?? '' : ''}`;
type Adding = { link?: string; scan?: boolean; edit?: string } | undefined;
const language = Intl.DateTimeFormat().resolvedOptions().locale;
/** Read on every refresh, like strings(), so App names follow a changed phone language */
const currentLocale = () => Intl.DateTimeFormat().resolvedOptions().locale;
/** The screen a reload (or a step back into an entry from before one) opens again, in the browser build */
type SavedScreen = { tab: TabKey; stacks: Stacks; app?: string };
const tabKeys: TabKey[] = ['overview', 'apps', 'notifications'];
const statusTabs = new Set<string>(['overview', 'cpu', 'memory', 'network', 'drives', 'storage', 'security', 'backup'] satisfies StatusTab[]);
function savedScreen(value: unknown): SavedScreen | undefined {
  const saved = value as Partial<SavedScreen> | null;
  if (!saved || !tabKeys.includes(saved.tab as TabKey)) return undefined;
  const route = (r: Route): Route | undefined => r?.kind === 'devices' ? { kind: 'devices' } : r?.kind === 'detail' && typeof r.id === 'string' ? { kind: 'detail', id: r.id }
    : r?.kind === 'status' ? (typeof r.tab === 'string' && statusTabs.has(r.tab) ? { kind: 'status', tab: r.tab } : { kind: 'status' }) : undefined;
  const stacks = emptyStacks();
  for (const key of tabKeys) stacks[key] = (Array.isArray(saved.stacks?.[key]) ? saved.stacks[key] : []).slice(0, 8).map(route).filter((r): r is Route => Boolean(r));
  return { tab: saved.tab as TabKey, stacks, ...(typeof saved.app === 'string' && saved.app ? { app: saved.app } : {}) };
}
/**
 * Hides a layer that holds App pages. In a browser a frame with display none has no size, and DSM
 * lays every window out again when it gets one back, which holds the page for a second or more, so
 * the frame keeps its size there and is only not drawn.
 */
const hiddenApps = (Platform.OS === 'web' ? { visibility: 'hidden' } : { display: 'none' }) as object;
const noRemote = () => () => {};
const noLinks = { links: [] as NasLink[], checking: [] as string[] };
const pinsOf = (profiles: NasProfile[]) => profiles.filter(p => p.sha256).map(p => ({ origin: p.origin, sha256: p.sha256! }));

/** QuickConnect's directory answers the App directly; a browser page cannot ask it (no CORS) */
const qcPost: QcPost | undefined = Platform.OS === 'web' ? undefined : async (url, body) => {
  const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), credentials: 'omit' });
  if (!response.ok) throw new Error(`HTTP_${response.status}`);
  return response.json();
};
export default function App() {
  const booted = useBooted();
  return <SafeAreaProvider><StatusBar style="dark" />{booted ? <Launcher /> : null}</SafeAreaProvider>;
}
export function Launcher() {
  const t = strings();
  const insets = useSafeAreaInsets();
  const [model] = useState(() => new LauncherModel(launcherStorage, p => Native.sessionKey(p.origin), createDiscovery((url, origin, accept) => Native.readJson(url, origin, accept), currentLocale), () => intakeInbox.clear(), () => dsmLang(currentLocale())));
  const prober = useMemo(() => new NasProber((url, id) => Native.probe(url, id), id => Native.cancelProbe(id), () => uuid.v4(), { post: qcPost }), []);
  // A NAS added by QuickConnect ID is looked up again on each connection: at home its LAN address, away the outside one or the relay
  const resolver = useMemo(() => new NasProber((url, id) => Native.probe(url, id), id => Native.cancelProbe(id), () => uuid.v4(), { post: qcPost }), []);
  const resolving = useRef<{ id: string; stop(): void }>(undefined);
  useEffect(() => () => { resolving.current?.stop(); resolver.reset(); }, [resolver]);
  const relocate = (target: NasProfile | undefined) => {
    if (!target?.quickconnect || !qcPost || resolving.current?.id === target.id) return;
    resolving.current?.stop();
    const { id, quickconnect } = target;
    const unsubscribe = resolver.subscribe(() => {
      const found = resolver.state;
      // The best answer, once nothing better is pending or after the grace; or nothing at all
      if (!found.best && found.phase !== 'done') return;
      stop();
      const best = found.candidates.find(c => c.origin === found.best);
      const current = model.state.profiles.find(p => p.id === id);
      if (!best || !current || current.quickconnect !== quickconnect || best.origin === current.origin) return;
      // A certificate that needs the user's decision is never accepted in the background
      const cert = certState(best.origin, best.tls);
      if (cert !== 'trusted' && cert !== 'http' || model.state.profiles.some(p => p.id !== id && p.origin === best.origin)) return;
      model.changeAddress(id, best.origin);
      void Native.setCertificatePins(pinsOf(model.state.profiles)).catch(() => {}).then(() => { if (model.profile?.id === id) void model.refresh(); });
    });
    const stop = () => { unsubscribe(); if (resolving.current?.id === id) resolving.current = undefined; resolver.cancel(); };
    resolving.current = { id, stop };
    resolver.start(`https://quickconnect.to/${quickconnect}`);
  };
  const relocateRef = useRef(relocate); relocateRef.current = relocate;
  useEffect(() => {
    const sub = AppState.addEventListener('change', next => { if (next === 'active') relocateRef.current(model.profile); });
    return () => sub.remove();
  }, [model]);
  const [trustReady, setTrustReady] = useState(() => !model.state.profiles.some(p => p.sha256));
  const state = useSyncExternalStore(model.subscribe, model.getState);
  const [status] = useState(() => new StatusModel({ read: (url, origin) => Native.readJson(url, origin), storage: statusStorage }));
  const statusState = useSyncExternalStore(status.subscribe, status.getState);
  const [screen, setScreen] = useState<'launcher' | 'app' | 'login'>('launcher');
  const previousScreen = useRef(screen);
  useEffect(() => {
    if (previousScreen.current === 'login' && screen === 'launcher') Native.logSignIn('launcher_shown');
    previousScreen.current = screen;
  }, [screen]);
  const [saved] = useState(() => savedScreen(restoredScreen()));
  const [tab, setTab] = useState<TabKey>(saved?.tab ?? 'overview');
  const [stacks, setStacks] = useState<Stacks>(() => saved?.stacks ?? emptyStacks());
  // An App open before a reload opens again once the App list is known
  const [restoring, setRestoring] = useState(saved?.app);
  // Bumped when the selected tab is pressed again: that tab scrolls to its top
  const [tops, setTops] = useState<Record<TabKey, number>>({ overview: 0, apps: 0, notifications: 0 });
  const route: Route | undefined = stacks[tab][stacks[tab].length - 1];
  const tabRef = useRef(tab); tabRef.current = tab;
  const push = (next: Route) => setStacks(current => ({ ...current, [tabRef.current]: [...current[tabRef.current], next] }));
  const pop = () => setStacks(current => ({ ...current, [tabRef.current]: current[tabRef.current].slice(0, -1) }));
  /** Show a tab at its first page; the other tabs' stacks are cleared too, as after a NAS change */
  const goTab = (key: TabKey) => { setStacks(emptyStacks()); setTab(key); };
  const selectTab = (key: TabKey) => {
    if (key === 'notifications') void status.loadStrings(dsmLang(language));
    if (key !== tab) { setTab(key); return; }
    setStacks(current => current[key].length ? { ...current, [key]: [] } : current);
    setTops(current => ({ ...current, [key]: current[key] + 1 }));
  };
  const [shell, setShell] = useState<OpenApp>();
  // Desktop Apps in single-App mode: the App on screen, and the top bar's menu presses
  const [fit, setFit] = useState<FitApp & { request: number }>();
  const [menuRequest, setMenuRequest] = useState(0);
  const [adding, setAdding] = useState<Adding>();
  const [switching, setSwitching] = useState(false);
  // The browser build's other NAS, each on its own origin (see nas-links.ts)
  const remote = useSyncExternalStore(remoteNas?.subscribe ?? noRemote, remoteNas?.getState ?? (() => noLinks));
  const [addingRemote, setAddingRemote] = useState(false);
  const [removing, setRemoving] = useState<NasLink>();
  const [pending, setPending] = useState<NativeIntakeItem[]>([]);
  const [picker, setPicker] = useState<DiscoveredApp[] | null>(null);
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [menu, setMenu] = useState<string>();
  const [iconRefresh, setIconRefresh] = useState<{ id: string; done: boolean }>();
  const sequence = useRef(0), createdRequest = useRef(0), contextEpoch = useRef(0);
  const requested = useRef(0);
  const [createdShown, setCreated] = useState(0);
  /** A screen exists for this open request: the page's own cover takes over from the launcher's */
  const created = (request: number) => () => {
    if (requested.current !== request || createdRequest.current === request) return;
    createdRequest.current = request; Native.logOpen('webview_created', request); setCreated(request); setOpeningSlow(false);
  };
  // Each tab's list is the blur source for its own top bar and for the shared tab bar
  const overviewTarget = useBlurTarget(), appsTarget = useBlurTarget();
  const reduced = useReducedMotion();
  const { width } = useWindowDimensions();
  // A launched App slides in from the right and back out to the right; the launcher stays drawn under it while it moves
  const slide = useRef(new Animated.Value(0)).current;
  const [sliding, setSliding] = useState(false);
  const slideRun = useRef(0);
  const slideTo = (from: number, to: number, easing: (value: number) => number) => {
    const run = ++slideRun.current;
    slide.setValue(from); setSliding(true);
    // An interrupted slide (an App opened while the last one leaves) must not end the new one
    Animated.timing(slide, { toValue: to, duration: SLIDE + 60, easing, useNativeDriver: true }).start(() => { if (slideRun.current === run) setSliding(false); });
  };
  const [openingSlow, setOpeningSlow] = useState(false);
  const [shellEpoch, setShellEpoch] = useState(0);
  const [dsmEpoch, setDsmEpoch] = useState(0);
  /** The DSM web sign-in page replaces the native form until the next sign-in */
  const [web, setWeb] = useState(false);
  const profile = model.profile;
  // DSM Apps open in one warm DSM page on phones (mobile fit on); a page that fails falls back to its own screen
  const fitOn = Boolean(profile && mobileFitOn(profile, Math.min(Dimensions.get('screen').width, Dimensions.get('screen').height)));
  const sessionScope = profile ? Native.sessionKey(profile.origin) : '';
  const hosted = shell && profile && fitOn && !shell.target.registered ? hostedApp(shell.target.url, profile.origin) : undefined;
  const [warmFailed, setWarmFailed] = useState(0), [warmEpoch, setWarmEpoch] = useState(0);
  const warmOn = Boolean(hosted && warmFailed !== shell?.request);
  // Loaded in the background once the signed-in home page is up
  const [preload, setPreload] = useState(false);
  const warmReady = Boolean(trustReady && profile && fitOn && sessionScope && !state.signIn && !busy);
  useEffect(() => {
    if (!warmReady || preload) return;
    const timer = setTimeout(() => setPreload(true), 1500);
    return () => clearTimeout(timer);
  }, [warmReady, preload]);
  const warmMounted = warmReady && (preload || warmOn);
  // NAS status follows the active NAS and account; nothing is asked before the certificate pins are set
  const statusScope = profile && trustReady && !state.signIn ? Native.sessionKey(profile.origin) : '';
  useEffect(() => { status.select(profile?.id, profile?.origin ?? '', statusScope); }, [status, profile?.id, profile?.origin, statusScope]);
  // Polling runs only for the status surface on screen, and only in the foreground
  // Elsewhere notifications keep polling for the tab badge
  const statusMode: Mode = screen !== 'launcher' || adding || !profile || state.signIn ? 'off'
    : route?.kind === 'status' ? 'status' : !route && tab === 'overview' ? 'home' : 'notifications';
  useEffect(() => { status.setMode(statusMode); }, [status, statusMode]);
  useEffect(() => {
    status.setForeground(AppState.currentState === 'active');
    const sub = AppState.addEventListener('change', next => status.setForeground(next === 'active'));
    return () => sub.remove();
  }, [status]);
  // Icons: fetch missing ones as the list arrives; revalidate once per completed launcher refresh.
  // Not before the certificate pins reach the native side, or a self-signed NAS fails the first batch.
  useEffect(() => { if (trustReady && profile && state.apps.length) void iconCache.sync(profile, state.apps); }, [trustReady, profile?.id, state.apps]);
  const wasRefreshing = useRef(false);
  useEffect(() => {
    if (state.refreshing && !wasRefreshing.current) iconCache.beginRound();
    if (!state.refreshing && wasRefreshing.current && profile && !state.error && !state.signIn) {
      iconCache.retainApps(profile.id, state.apps.map(app => app.id));
      void iconCache.sync(profile, state.apps, true);
    }
    wasRefreshing.current = state.refreshing;
  }, [state.refreshing]);
  // Removing a NAS removes its icons
  useEffect(() => { iconCache.retainProfiles(state.profiles.map(p => p.id)); }, [state.profiles]);
  const refreshIcons = async (id: string) => {
    const target = model.state.profiles.find(p => p.id === id);
    if (!target || iconRefresh && !iconRefresh.done) return;
    setIconRefresh({ id, done: false });
    try {
      // The active NAS also re-reads its App list and DSM main-menu order
      if (id === model.profile?.id) await model.refresh();
      const apps = id === model.profile?.id ? model.state.apps : model.state.snapshots[id]?.apps || [];
      await iconCache.refresh(target, apps);
    } finally { setIconRefresh({ id, done: true }); }
  };
  const pendingRef = useRef(pending); pendingRef.current = pending;
  const receive = (items: NativeIntakeItem[], error?: string, addNas?: string) => {
    if (addNas) { setAdding({ link: addNas }); return; }
    if (busy) return;
    if (error) { setNotice(error === 'intakeUnreadable' ? t.shareUnreadable : t.shareFailed); return; }
    if (!items.length) return;
    // Keep one pending handoff in memory; no shared bytes enter storage or logs
    setPending(items); setPicker(null); setScreen('launcher'); goTab('apps'); setNotice('');
  };
  const receiveRef = useRef(receive); receiveRef.current = receive;
  useEffect(() => {
    SplashScreen.hideAsync().catch(() => {});
    cleanupDownloads();
    const sub = Native.addListener('onIntake', event => receiveRef.current(event.items, event.error, event.addNas));
    Native.takePendingIntake().then(event => receiveRef.current(event.items, event.error, event.addNas)).catch(() => setNotice(t.shareFailed));
    const pins = pinsOf(model.state.profiles);
    Native.setCertificatePins(pins).then(() => { setTrustReady(true); if (pins.length) void model.refresh(); relocateRef.current(model.profile); }).catch(() => setNotice(t.failed));
    if (!pins.length) void model.refresh();
    return () => sub.remove();
  }, [model]);
  useEffect(() => {
    if (!shell) return;
    setOpeningSlow(false);
    const timer = setTimeout(() => {
      if (createdRequest.current === shell.request) return;
      Native.logOpen('open_waiting', shell.request); setOpeningSlow(true);
    }, 3000);
    return () => clearTimeout(timer);
  }, [shell]);
  const clearHandoff = (preservePending = false) => { contextEpoch.current++; requested.current = 0; if (!preservePending) setPending([]); setPicker(null); setNotice(''); setOpeningSlow(false); setShell(undefined); setScreen('launcher'); };
  const open = (target: DiscoveredApp, items?: NativeIntakeItem[]) => {
    const request = ++sequence.current;
    Native.logOpen(items?.length ? 'intake_received' : 'tap_received', request);
    if (!profile || busy) { Native.logOpen('open_rejected', request); setNotice(t.openFailed); return; }
    const selected = profile.id, epoch = contextEpoch.current;
    let launch: Launch = { link: target.start };
    if (items?.length) {
      const id = uuid.v4();
      try { intakeInbox.put(id, profile.origin, items); }
      catch { setNotice(t.shareFailed); setPending([]); setPicker(null); return; }
      launch = { intake: id, link: target.intake!.route };
      setPending([]); setPicker(null);
    }
    if (model.profile?.id !== selected || contextEpoch.current !== epoch) { Native.logOpen('open_rejected', request); return; }
    Native.logOpen('open_requested', request);
    requested.current = request;
    setOpeningSlow(false); setShell({ target, launch, request }); setScreen('app');
    if (!reduced) slideTo(width, 0, Easing.out(Easing.cubic));
  };
  const openRef = useRef(open); openRef.current = open;
  useEffect(() => {
    if (!pending.length || !profile || picker) return;
    const choice = intakeChoice(pending, state.intakeApps);
    // Cached registrations are available immediately; otherwise wait for discovery
    if (choice.kind === 'open') openRef.current(choice.matches[0], pending);
    else if (choice.kind === 'picker') setPicker(choice.matches);
    else if (!state.refreshing && !state.signIn) { setNotice(t.shareNone); setPending([]); }
  }, [pending, state.intakeApps, state.refreshing, state.signIn, profile, picker]);
  const changeProfile = (id: string) => {
    // No tab may stay on another NAS's page
    setStacks(emptyStacks());
    clearHandoff(true); model.select(id); void model.refresh();
    relocate(model.profile);
  };
  const signIn = (id?: string) => {
    if (id && id !== model.profile?.id) changeProfile(id);
    setWeb(false); setDsmEpoch(value => value + 1); setScreen('login'); setShell(undefined);
  };
  const webSignIn = () => { setWeb(true); setDsmEpoch(value => value + 1); };
  const finishLogin = (verified?: true) => {
    // Back to the tab and page the sign-in started from
    setScreen('launcher'); setShell(undefined);
    // Manual Done/Back discards an unfinished exchange; verified success keeps DSM warm.
    if (verified !== true) setDsmEpoch(value => value + 1);
    // Session cookies now select the correct per-user snapshot
    if (profile) model.select(profile.id);
    Native.logSignIn('refresh_started');
    void model.refresh().then(() => Native.logSignIn('refresh_finished'), () => Native.logSignIn('refresh_failed'));
  };
  const backToLauncher = () => {
    setScreen('launcher');
    if (shell && !reduced) slideTo(0, width, Easing.in(Easing.cubic));
    if (profile) {
      if (state.snapshots[profile.id]?.scope !== Native.sessionKey(profile.origin)) setShell(undefined);
      model.select(profile.id);
      void model.refresh();
    }
  };
  const clearProfile = async (selected: NasProfile, remove: boolean) => {
    if (busy) return;
    setBusy(true); if (selected.id === model.profile?.id) clearHandoff(); model.signOut(selected.id);
    try {
      await Native.takePendingIntake();
      // Sign-out keeps DSM's trusted-device cookie; removing the NAS forgets this phone
      await Native.clearSession(selected.origin, !remove);
      if (remove) { status.forget(selected.id); model.remove(selected.id); setStacks(current => ({ overview: current.overview.filter(r => r.kind !== 'detail' || r.id !== selected.id), apps: current.apps.filter(r => r.kind !== 'detail' || r.id !== selected.id), notifications: current.notifications.filter(r => r.kind !== 'detail' || r.id !== selected.id) })); await Native.setCertificatePins(pinsOf(model.state.profiles)); void model.refresh(); }
    } catch { setNotice(t.clearFailed); }
    finally { setBusy(false); }
  };
  const save = async (result: SaveResult) => {
    const editing = adding?.edit ? state.profiles.find(p => p.id === adding.edit) : undefined;
    if (editing) {
      if (editing.origin !== result.origin) await Native.clearSession(editing.origin, false);
      await Native.setCertificatePins(pinsOf(state.profiles.map(p => p.id === editing.id ? { ...p, origin: result.origin, sha256: result.sha256 } : p)));
      model.changeAddress(editing.id, result.origin, result.sha256);
      model.setQuickConnect(editing.id, result.quickconnect);
      if (result.name !== editing.name) model.rename(editing.id, result.name);
      setAdding(undefined);
      if (editing.origin !== result.origin || !Native.sessionKey(result.origin)) { model.select(editing.id); clearHandoff(true); setWeb(false); setDsmEpoch(v => v + 1); setScreen('login'); }
      return;
    }
    const id = uuid.v4();
    if (result.sha256) await Native.setCertificatePins([...pinsOf(state.profiles), { origin: result.origin, sha256: result.sha256 }]);
    model.add(id, result.name, result.origin, result.sha256, result.quickconnect);
    clearHandoff(true); setAdding(undefined); goTab('overview'); setWeb(false); setDsmEpoch(v => v + 1); setScreen('login');
  };
  const importQr = async (qr: Parameters<typeof qrGroup>[1]) => {
    const previous = qrGroup(model.state.profiles, qr);
    // Clear only removed origins; unchanged origin sessions and snapshots survive rescanning.
    for (const old of previous) if (!qr.urls.some(address => address.url === old.origin)) await Native.clearSession(old.origin, false);
    const replacing = new Set(previous.map(p => p.id));
    await Native.setCertificatePins(pinsOf([...model.state.profiles.filter(p => !replacing.has(p.id)), ...qr.urls.map(a => ({ id: '', name: '', origin: a.url, sha256: a.sha256 }))]));
    model.importQr(qr, () => uuid.v4()); clearHandoff(true); setAdding(undefined); goTab('overview'); setWeb(false); setScreen('login');
  };
  const trust = async (target: NasProfile, sha256: string) => {
    await Native.setCertificatePins(pinsOf(state.profiles.map(p => p.id === target.id ? { ...p, sha256 } : p)));
    model.changeAddress(target.id, target.origin, sha256);
    if (target.id === model.profile?.id) void model.refresh();
  };
  // Hardware back: close Add NAS, then pop this tab's stack, then return to Overview, then leave.
  // In an App, the WebView's own history goes first (ShellScreen handles it while the App is on screen).
  useEffect(() => {
    if (screen !== 'launcher' && !adding) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (adding) { setAdding(undefined); return true; }
      if (route) { if (route.kind === 'detail') prober.reset(); pop(); return true; }
      if (tab !== 'overview') { setTab('overview'); return true; }
      return false;
    });
    return () => sub.remove();
  }, [screen, route, tab, prober, adding]);

  // Browser history: one entry per back step above (see web-history.ts); a no-op on Android
  useBackDepth((tab !== 'overview' ? 1 : 0) + stacks[tab].length + (screen !== 'launcher' || restoring ? 1 : 0) + (adding ? 1 : 0));
  useBackScreen({ tab, stacks, ...(screen === 'app' && shell ? { app: shell.target.id } : {}) });
  useEffect(() => {
    if (!restoring || !trustReady) return;
    const app = state.apps.find(a => a.id === restoring);
    if (app && profile && !state.signIn) { setRestoring(undefined); open(app); }
    else if (state.signIn || !state.refreshing && state.updated) setRestoring(undefined);
  }, [restoring, trustReady, state.apps, state.signIn, state.refreshing]);

  const now = Date.now();
  const signedIn = (p: NasProfile) => Boolean(Native.sessionKey(p.origin));
  const editingProfile = adding?.edit ? state.profiles.find(p => p.id === adding.edit) : undefined;
  const unread = unreadCount(statusState.snapshot, statusState.read);
  const tabStatus = profile && !state.signIn ? statusState : undefined;
  // The browser build's switcher: this page's NAS (its live profile) first, then each other NAS as a link
  const switcherProfiles: NasProfile[] = remoteNas ? [
    ...state.profiles,
    ...remote.links.filter(l => !l.removed && l.origin !== remoteNas!.self).map(l => ({ id: l.origin, name: l.name, origin: l.origin })),
  ] : state.profiles;
  const describeRemote = (p: NasProfile): RowState | undefined => {
    const link = p.origin !== remoteNas?.self ? remote.links.find(l => l.origin === p.origin) : undefined;
    if (!link) return undefined;
    // A NAS without a launcher opens its DSM; a small mark says so instead of a sentence
    const mark = link.dsm ? { badge: { icon: 'open-in-new' as const, label: t.dsmOnly } } : {};
    if (remote.checking.includes(link.origin) && link.reachable === undefined) return { text: t.checking, dot: colors.separator, ...mark };
    if (link.reachable === undefined) return { text: t.nasNotChecked, dot: colors.separator, ...mark };
    const seen = link.seen ? ` · ${ageText(t, link.seen, now)}` : '';
    return link.reachable ? { text: `${t.nasReachable}${seen}`, dot: colors.success, ...mark } : { text: `${t.nasUnreachable}${seen}`, dot: colors.warning, ...mark };
  };
  const common = {
    state, profile, busy, notice, shareWaiting: Boolean(pending.length && (!profile || state.signIn)),
    onAdd: () => setAdding({}), onScan: () => setAdding({ scan: true }), onSignIn: () => signIn(), onRefresh: () => { void model.refresh(); void status.refresh(); },
    onSwitch: () => { setSwitching(true); remoteNas?.check(); }, onDetails: () => profile && push({ kind: 'detail', id: profile.id }), onDismissNotice: () => setNotice(''),
  };
  /** A DSM App by its launchApp id, for the status modules' "Open in DSM"; undefined when this account has none */
  const openApp = (id: string) => { const app = state.apps.find(a => a.id === id); return app ? () => open(app) : undefined; };
  /** Control Panel at Update & Restore: its own target, so it never reuses a Control Panel already open on another page */
  const controlPanel = state.apps.find(a => a.id === updateApp);
  const openUpdate = controlPanel && profile ? () => open({ ...controlPanel, id: `${controlPanel.id}:update`, url: updatePageUrl(profile.origin), start: undefined }) : undefined;
  /** A native page pushed onto a tab; the tab bar stays below it */
  const page = (next: Route): ReactNode => {
    if (next.kind === 'status') return profile ? <StatusScreen key={profile.id} initialTab={next.tab} profile={profile} state={statusState} t={t} locale={language} now={now} onBack={pop} onRefresh={() => void status.refresh()}
      onOpenApp={openApp} onHistory={range => void status.loadHistory(range)} /> : null;
    if (next.kind === 'devices') return <Devices profiles={state.profiles} active={state.active} signedIn={signedIn} onBack={pop} onOpen={id => push({ kind: 'detail', id })} onActions={setMenu} onAdd={() => setAdding({})} onScan={() => setAdding({ scan: true })} />;
    const detail = state.profiles.find(p => p.id === next.id);
    if (!detail) return null;
    return <DeviceDetail key={detail.id} profile={detail} active={detail.id === state.active} signedIn={signedIn(detail)} busy={busy} prober={prober}
      onBack={() => { prober.reset(); pop(); }} onUse={() => changeProfile(detail.id)} onSignIn={() => signIn(detail.id)}
      onSignOut={() => void clearProfile(detail, false)} onRemove={() => void clearProfile(detail, true)} onRename={name => model.rename(detail.id, name)}
      onChangeAddress={() => { prober.reset(); setAdding({ edit: detail.id }); }} onTrust={sha256 => void trust(detail, sha256).catch(() => setNotice(t.failed))} onMobileFit={value => model.setMobileFit(detail.id, value)} onActions={() => setMenu(detail.id)} />;
  };
  const pages = (key: TabKey): Page[] => stacks[key].map((next, index) => ({ key: routeKey(next, index), node: page(next) }));
  const roots: Record<TabKey, ReactNode> = {
    overview: <Overview {...common} blurTarget={overviewTarget} top={tops.overview} status={tabStatus} now={now} language={language}
      onStatus={() => push({ kind: 'status' })} onStorage={() => push({ kind: 'status', tab: 'drives' })} onAccount={() => profile && push({ kind: 'detail', id: profile.id })}
      onStatusPage={tab => push({ kind: 'status', tab })} onOpenApp={openApp} onUpdate={openUpdate} />,
    apps: <AppsTab {...common} blurTarget={appsTarget} top={tops.apps} onOpen={app => open(app)} language={language} onArrange={ids => { if (profile) model.setOrder(profile.id, ids); }}
      onPressIn={() => { Native.logOpen('press_started', sequence.current + 1); model.holdList(); }}
      onPressOut={() => { Native.logOpen('press_released', sequence.current + 1); setTimeout(() => model.releaseList(), 0); }} />,
    notifications: profile && !state.signIn ? <Notifications key={`${profile.id}:${tops.notifications}`} state={statusState} t={t} locale={language} now={now}
      onRefresh={() => status.refresh()} onMore={() => void status.loadMoreNotices()} onRead={ids => status.markRead(ids)} onReadAll={() => status.markAllRead()}
      apps={state.apps} onOpenApp={app => open(app)} />
      : <SignedOutTab title={t.notifications}><Gate {...common} /></SignedOutTab>,
  };
  const tabs: TabKey[] = ['overview', 'apps', 'notifications'];
  return <View style={{ flex: 1, backgroundColor: colors.background }}>
    <View style={[{ flex: 1 }, screen !== 'launcher' && !sliding && { display: 'none' }]} importantForAccessibility={adding || screen !== 'launcher' ? 'no-hide-descendants' : 'auto'}>
      <TabBarShown.Provider value>
        {tabs.map(key => <View key={key} style={[{ flex: 1 }, tab !== key && { display: 'none' }]}><Stack root={roots[key]} pages={pages(key)} /></View>)}
      </TabBarShown.Provider>
      {/* Pushed pages have their own blur source; over them the bar is a solid surface */}
      <TabBar blurTarget={route ? undefined : tab === 'overview' ? overviewTarget : tab === 'apps' ? appsTarget : undefined} active={tab} onChange={key => selectTab(key as TabKey)} tabs={[
        { key: 'overview', icon: 'dashboard', label: t.tab_overview },
        { key: 'apps', icon: 'apps', label: t.apps },
        { key: 'notifications', icon: 'notifications-none', activeIcon: 'notifications', label: t.notifications, count: tabStatus && unread ? badgeText(unread, moreUnread(statusState.snapshot, statusState.read)) : undefined },
      ]} />
    </View>
    {trustReady && profile && (shell || warmMounted) ? <Animated.View style={[StyleSheet.absoluteFill, { zIndex: 5, paddingTop: insets.top, paddingBottom: insets.bottom, backgroundColor: colors.background }, sliding && { transform: [{ translateX: slide }] }, screen !== 'app' && !sliding && hiddenApps]} pointerEvents={screen === 'app' ? 'auto' : 'none'}
      accessibilityElementsHidden={screen !== 'app'} importantForAccessibility={screen === 'app' ? 'auto' : 'no-hide-descendants'}>
      {shell && !shell.target.registered ? <DesktopBar target={shell.target} profile={profile.id} app={fit?.request === shell.request ? fit : undefined}
        onHome={backToLauncher} onMenu={() => setMenuRequest(value => Math.max(value + 1, Date.now()))} /> : null}
      <View style={{ flex: 1 }}>
        {shell && !warmOn ? <ShellPool key={`${profile.id}:${shellEpoch}`} config={landConfig} profile={profile} target={shell.target} launch={shell.launch} active={screen === 'app'} onExit={backToLauncher} safeAreaEdges={[]}
          title={shell.target.name} icon={<AppIcon app={shell.target} profile={profile.id} size={72} />} tint={tileOf(shell.target.package || shell.target.name).fg}
          menuRequest={menuRequest} onFitApp={app => { const request = shell.request; setFit({ ...app, request }); }} onCreated={created(shell.request)} /> : null}
        {/* One warm DSM page hosts every DSM App (see mobile-fit warmUrl): loaded once, hidden until an App opens in it */}
        {warmMounted ? <View style={[StyleSheet.absoluteFill, !warmOn && hiddenApps]} pointerEvents={warmOn ? 'auto' : 'none'}>
          <ShellScreen key={`${profile.id}:warm:${sessionScope}:${warmEpoch}`} config={landConfig} profile={profile} safeAreaEdges={[]} preload
            target={{ id: 'dsm-warm', url: warmUrl(profile.origin), registered: false, preset: 'desktop', capabilities: [] }}
            active={screen === 'app' && Boolean(warmOn)} host={warmOn && shell && hosted ? { app: hosted, request: shell.request } : undefined}
            onHostFailed={request => { if (shell?.request === request) setWarmFailed(request); setWarmEpoch(value => value + 1); }}
            onExit={backToLauncher} title={shell?.target.name} icon={shell ? <AppIcon app={shell.target} profile={profile.id} size={72} /> : undefined} tint={shell ? tileOf(shell.target.package || shell.target.name).fg : undefined}
            menuRequest={menuRequest} onFitApp={app => { if (shell) setFit({ ...app, request: shell.request }); }} onCreated={shell && warmOn ? created(shell.request) : undefined} />
        </View> : null}
        {/* The launch cover shows from the tap until the page's own cover takes over */}
        {shell && createdShown !== shell.request ? <LaunchCover phase={openingSlow ? 'slow' : 'shown'} title={shell.target.name} icon={<AppIcon app={shell.target} profile={profile.id} size={72} />} tint={tileOf(shell.target.package || shell.target.name).fg}
          labels={{ loading: t.loadingApp, slow: t.openingSlow, reopen: t.retry, back: t.back }} onFaded={() => {}} onBack={backToLauncher}
          onReopen={() => { Native.logOpen('open_retry', shell.request); requested.current = ++sequence.current; Native.logOpen('open_requested', requested.current); setShellEpoch(value => value + 1); setShell({ ...shell, request: requested.current }); }} /> : null}
      </View>
    </Animated.View> : null}
    {/* The DSM web page signs in only as a fallback; once signed in the same retained view reports DSM's runtime App visibility */}
    {trustReady && profile && !busy && (screen === 'login' ? web : !state.signIn) ? <View style={[{ flex: 1, paddingTop: insets.top + layout.topBar, paddingBottom: insets.bottom }, screen !== 'login' && { display: 'none' }]} pointerEvents={screen === 'login' ? 'auto' : 'none'} accessibilityElementsHidden={screen !== 'login'} importantForAccessibility={screen === 'login' ? 'auto' : 'no-hide-descendants'}>
      <ShellScreen key={`${profile.id}:${dsmEpoch}`} config={landConfig} profile={profile} active={screen === 'login'} target={{ id: 'dsm-sign-in', url: profile.origin + '/', registered: false, preset: 'desktop', capabilities: [] }} onExit={finishLogin} onAuthenticated={web ? () => finishLogin(true) : undefined} safeAreaEdges={[]} onRuntimeVisibility={(scope, values) => model.applyRuntime(profile.id, scope, values)} />
    </View> : null}
    {screen === 'login' && profile && web ? <TopBar left={<IconButton icon="close" label={t.close} onPress={finishLogin} />} title={fill(t.signInTitle, { name: profile.name })} right={<TextButton title={t.done} onPress={finishLogin} />} /> : null}
    {screen === 'login' && profile && !web && trustReady ? <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, zIndex: 15, backgroundColor: colors.background }}>
      <SignIn key={`${profile.id}:${dsmEpoch}`} profile={profile} onClose={finishLogin} onSignedIn={() => finishLogin(true)} onWeb={webSignIn}
        onDetails={() => { finishLogin(); setTab('overview'); setStacks({ ...emptyStacks(), overview: [{ kind: 'detail', id: profile.id }] }); }} />
    </View> : null}
    {adding ? <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, zIndex: 20, backgroundColor: colors.background }}>
      <AddDevice key={adding.link || adding.edit || (adding.scan ? 'scan' : 'manual')} prober={prober} profiles={state.profiles} editing={editingProfile} initialLink={adding.link} startScan={adding.scan}
        onClose={() => setAdding(undefined)} onSave={save} onQr={importQr}
        onShowExisting={id => { setAdding(undefined); changeProfile(id); setTab('overview'); }} />
    </View> : null}
    {remoteNas ? <>
      {/* The browser build: this NAS, then the others it links to. Picking one opens that NAS's own launcher with the
          sheet still open: closing it would walk the history back and cancel the navigation */}
      <DeviceSheet visible={switching} profiles={switcherProfiles} active={state.active} signedIn={signedIn} onClose={() => setSwitching(false)} describe={describeRemote}
        onSelect={id => { if (id === state.active) setSwitching(false); else if (!remoteNas!.switchTo(id)) setSwitching(false); }} onAdd={() => { setSwitching(false); setAddingRemote(true); }}
        onRemove={id => { setSwitching(false); setRemoving(remote.links.find(l => l.origin === id)); }} />
      <AddRemote visible={addingRemote} remote={remoteNas} onClose={() => setAddingRemote(false)} onAdded={() => { setAddingRemote(false); setSwitching(true); remoteNas!.check(); }} />
      <ConfirmSheet visible={Boolean(removing)} title={fill(t.removeTitle, { name: removing?.name ?? '' })} message={t.removeLinkMessage} detail={removing?.origin}
        confirm={t.removeConfirm} cancel={t.cancel} onClose={() => setRemoving(undefined)} onConfirm={() => { if (removing) remoteNas!.remove(removing.origin); setRemoving(undefined); setSwitching(true); }} />
    </> : <DeviceSheet visible={switching} profiles={state.profiles} active={state.active} signedIn={signedIn} onClose={() => setSwitching(false)}
      onSelect={id => { setSwitching(false); if (id !== state.active) changeProfile(id); }} onAdd={() => { setSwitching(false); setAdding({}); }}
      onManage={() => { setSwitching(false); push({ kind: 'devices' }); }} />}
    <DeviceMenu profile={menu ? state.profiles.find(p => p.id === menu) : undefined} custom={Boolean(menu && state.order?.[menu]?.length)}
      refreshing={Boolean(iconRefresh && iconRefresh.id === menu && !iconRefresh.done)} refreshed={Boolean(iconRefresh && iconRefresh.id === menu && iconRefresh.done)}
      onRefreshIcons={() => { if (menu) void refreshIcons(menu); }} onResetOrder={() => { if (menu) model.resetOrder(menu); }}
      onClose={() => { setMenu(undefined); if (iconRefresh?.done) setIconRefresh(undefined); }} />
    <Sheet visible={Boolean(picker)} onClose={() => { setPicker(null); setPending([]); }} label={t.cancel}>
      <Text style={[type.title, { paddingHorizontal: layout.gutter, paddingBottom: spacing.sm }]} accessibilityRole="header">{t.shareChoose}</Text>
      <ScrollView style={{ maxHeight: 420 }}>{picker?.map(app => <Row key={app.id} leading={<AppIcon app={app} profile={profile?.id} size={32} />} title={app.name} label={fill(t.openApp, { name: app.name })} onPress={() => open(app, pendingRef.current)} />)}</ScrollView>
    </Sheet>
  </View>;
}

const flat = { includeFontPadding: false, textAlignVertical: 'center' } as const;

/** A tab with nothing to show until a NAS is added or signed in */
function SignedOutTab({ title, children }: { title: string; children: ReactNode }) {
  const bars = useBarInsets();
  return <View style={{ flex: 1, backgroundColor: colors.background }}>
    <ScrollView contentContainerStyle={{ paddingTop: bars.top, paddingBottom: bars.bottom + spacing.xl }}>{children}</ScrollView>
    <TopBar title={title} />
  </View>;
}

/**
 * The title row of a desktop DSM App: Home, the App on screen and its menu.
 * Home always leaves the App for the launcher; stepping back inside the App is
 * the back gesture's job. In single-App mode the page reports the App on screen
 * (it can open another App, such as Text Editor from File Station); otherwise
 * it is the launched App.
 */
export function DesktopBar({ target, profile, app, onHome, onMenu }: { target: DiscoveredApp; profile: string; app?: FitApp; onHome(): void; onMenu(): void }) {
  const t = strings();
  const other = app && app.id && app.id !== target.id;
  const icon = !other ? <AppIcon app={target} profile={profile} size={24} /> : app.icon ? <Image source={{ uri: app.icon }} fadeDuration={0} style={{ width: 24, height: 24 }} /> : null;
  // Home's icon ends 15px from the App icon and the title starts 10px after it; Android's font padding
  // is off so the title's line box, the 24px icon and the Home icon share one centre line
  return <View style={{ height: layout.topBar, flexDirection: 'row', alignItems: 'center', paddingRight: spacing.xs, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.separator, backgroundColor: colors.background }}>
    <IconButton icon="home" label={t.home} onPress={onHome} />
    {icon ? <View style={{ width: 24, height: 24, marginRight: 10 }} importantForAccessibility="no-hide-descendants">{icon}</View> : <View style={{ width: spacing.xs }} />}
    <View style={{ flex: 1, minWidth: 0, justifyContent: 'center' }}>
      <Text style={[type.title, flat]} numberOfLines={1} accessibilityRole="header">{app?.title || target.name}</Text>
      {app?.page ? <Text style={[type.caption, flat]} numberOfLines={1}>{app.page}</Text> : null}
    </View>
    {app?.menu ? <IconButton icon="menu" label={t.appMenu} onPress={onMenu} /> : null}
  </View>;
}
