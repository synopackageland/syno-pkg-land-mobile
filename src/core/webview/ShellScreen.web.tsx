/**
 * The browser build's App view. The launcher page and every App share the DSM origin, so an App
 * opens in a same-origin iframe: the browser sends DSM's session cookies itself, and the shell
 * reaches the App's document directly instead of through a native WebView binding.
 *
 * - Registered Apps run as an SDK browser host: the SDK only trusts a native bridge in a top frame,
 *   and its browser fallbacks (downloads, external links) are what a phone browser offers anyway.
 * - Desktop DSM Apps get the same mobile fit script as the Android App, added as soon as each new
 *   document exists. With the fit off, the desktop layout is drawn at desktop width and scaled down.
 * - The frame stays hidden under the launch cover until the App is ready: a DSM App once its window
 *   shows (the fit reports it), any other page once it has drawn something.
 * - The warm DSM page (`host`) stays loaded and opens each DSM App inside it, see mobile-fit.
 * - A registered App's frame is named for the UI kit (shell-frame.ts): its top-left Home posts
 *   `close` to this page, which leaves the App like the Android bridge's `close`.
 * - Back (the browser's back or Android's gesture) closes the fit's steps first, then leaves the
 *   App. Each step is a history entry (back.web.ts); the frame's own pages are entries of their own,
 *   which the browser goes back through before the shell's.
 */
import { useEffect, useRef, useState } from 'react';
import { Dimensions, StyleSheet, View } from 'react-native';
import { BackHandler, useBackDepth } from '../back.web';
import { launchUrl, sameOrigin } from '../profiles/url';
import { COVER_DELAY, COVER_SLOW, FIT_WAIT, HOST_WAIT, cover, type CoverEvent, type CoverPhase } from './cover';
import { LaunchCover } from './LaunchCover';
import { fitApp, hostedApp, mobileFitOn, mobileFitScript } from './mobile-fit';
import { initialFrameState, noticedDocument } from './frame-state';
import { SHELL_FRAME_NAME, isFrameHome } from './shell-frame';
import { strings } from '../i18n/strings';
import Native, { refreshSession } from '../../../modules/webview-cookies/index.web';
// Types only: './ShellScreen' is this file in the browser build
import type { ShellScreenProps } from './ShellScreen';

/** Desktop width a DSM App is laid out at when the phone fit is off */
const DESKTOP = 1280;
type FrameWindow = Window & {
  ReactNativeWebView?: { postMessage(data: string): void }; __splFitFrame?: boolean;
  __splFitBack?: () => void; __splFitMenu?: () => void; __splFitSync?: () => void; __splFitLaunch?: (id: string) => boolean; __splFitHome?: () => void;
  eval(code: string): unknown;
};
/** Something drawn: text, an image or a sized element below the body */
function drawn(doc: Document): boolean {
  const body = doc.body;
  if (!body) return false;
  if ((body.innerText || '').trim()) return true;
  return Boolean(body.querySelector('img, svg, canvas, video, input, button'));
}

export function ShellScreen({ profile, target, active = true, preload, host, onHostFailed, launch, onExit, onCreated, onAuthenticated, title, icon, tint, onFitApp, menuRequest }: ShellScreenProps) {
  const t = strings();
  const frame = useRef<HTMLIFrameElement | null>(null);
  // A retained screen that was never shown loads nothing (the hidden DSM sign-in view), unless preloaded
  const [started, setStarted] = useState(active || Boolean(preload));
  useEffect(() => { if (active || preload) setStarted(true); }, [active, preload]);
  // With no cover delay the cover is up from the first render, so nothing white shows between covers
  const first: CoverPhase = COVER_DELAY ? 'pending' : 'shown';
  const [phase, setPhase] = useState<CoverPhase>(first);
  const step = (event: CoverEvent) => setPhase(previous => event === 'start' ? first : cover(previous, event));
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [size, setSize] = useState({ width: 0, height: 0 });
  // Hidden under the cover until the App is ready, so a half-built page never shows
  const [shown, setShown] = useState(false);
  // The fit's back steps inside the App (dialogs, menus, pages), each one a history entry while active
  const [steps, setSteps] = useState(0);
  useBackDepth(active ? steps : 0);
  const fit = target.preset === 'desktop' && mobileFitOn(profile, Math.min(Dimensions.get('screen').width, Dimensions.get('screen').height));
  const scaled = target.preset === 'desktop' && !fit;
  // A single-App page reports its App window: that is when it is ready
  const waitFit = fit && Boolean(host || hostedApp(target.url, profile.origin));
  // The first URL only: a warm App keeps its page when it is opened again
  const [src] = useState(() => target.registered && target.preset === 'mobile' ? launchUrl(target.url, launch) : target.url);
  const live = useRef({ active, onExit, onFitApp, host, onHostFailed }); live.current = { active, onExit, onFitApp, host, onHostFailed };
  // Readiness of the current document and of the App asked for
  const state = useRef(initialFrameState());
  const win = () => { try { const w = frame.current?.contentWindow as FrameWindow | null; return w && w.location.origin === profile.origin ? w : null; } catch { return null; } };

  useEffect(() => { if (started && active) onCreated?.(); }, [started, active, onCreated]);
  useEffect(() => {
    if (phase !== 'pending' && phase !== 'shown') return;
    const timer = setTimeout(() => step(phase === 'pending' ? 'delay' : 'slow'), phase === 'pending' ? COVER_DELAY : COVER_SLOW - COVER_DELAY);
    return () => clearTimeout(timer);
  }, [phase]);

  /** The App has drawn: show the frame after the page paints twice, then fade the cover */
  const ready = () => {
    const s = state.current;
    if (s.ready) return;
    s.ready = true;
    const w = win(), paint = (w?.requestAnimationFrame || window.requestAnimationFrame).bind(w || window);
    paint(() => paint(() => { if (state.current.ready) { setShown(true); step('ready'); } }));
  };
  const fail = (request: number) => {
    const s = state.current;
    if (s.failed === request) return;
    s.failed = request;
    live.current.onHostFailed?.(request);
  };
  /** The warm page: open the App asked for once the page can host it */
  const launchHosted = () => {
    const s = state.current, request = live.current.host?.request || 0, app = live.current.host?.app;
    if (!live.current.active || !app || !request || s.launched === request) return;
    const w = win();
    if (!w || typeof w.__splFitLaunch !== 'function') return;
    // DSM builds the App on this page's main thread, which would hold the slide and the cover's first
    // paint: launch once the frame is in place and the cover has been drawn
    const left = frame.current?.getBoundingClientRect().left ?? 0;
    if (Math.abs(left) > 1) { s.placedAt = 0; return; }
    if (!s.placedAt) { s.placedAt = Date.now(); return; }
    if (Date.now() - s.placedAt < 32) return;
    s.launched = request; s.launchedAt = Date.now(); s.reported = false; s.busy = false; s.ready = false;
    let ok = false;
    try { ok = w.__splFitLaunch(app) === true; } catch { ok = false; }
    if (!ok) fail(request);
  };

  // Each new same-origin document gets the reporting channel, then the fit, before DSM builds its windows
  useEffect(() => {
    if (!started) return;
    let seen: Document | null = null, timer = 0;
    const receive = (data: string) => {
      let message: { internal?: string; origin?: string; app?: unknown; ok?: boolean };
      try { message = JSON.parse(data); } catch { return; }
      if (message.origin !== profile.origin || !live.current.active) return;
      const s = state.current;
      if (message.internal === 'fitClosed') { setSteps(0); live.current.onExit?.(); }
      // The App could not open in the warm page (a script error before its window): a page of its own, now
      else if (message.internal === 'fitLaunch') { if (message.ok === false && live.current.host && s.launched && !s.ready) fail(s.launched); }
      else if (message.internal === 'fitApp') {
        const app = fitApp(message.app);
        if (!app) return;
        if (live.current.host && !s.launched) return;
        s.reported = true; s.busy = app.busy === true; setSteps(app.back); live.current.onFitApp?.(app);
        // DSM's own loading mask stays under the cover; the page reports again once it is gone
        if ((s.loaded || live.current.host) && !s.busy) ready();
      }
    };
    const prepare = () => {
      const w = win(), doc = w?.document;
      if (w && doc && doc !== seen && doc.URL !== 'about:blank') {
        seen = doc; setSteps(0);
        // A page that loaded before this poll saw it has already fired the frame's load event
        state.current = noticedDocument(state.current, doc.readyState, Date.now(), Boolean(live.current.host));
        try { Object.defineProperty(w, 'ReactNativeWebView', { value: Object.freeze({ postMessage: (data: string) => receive(String(data)) }), configurable: true }); } catch { /* Reports are optional */ }
        try { if (fit) { w.__splFitFrame = true; w.eval(mobileFitScript(profile.origin)); } } catch { /* The page keeps its own layout */ }
      }
      if (live.current.host) launchHosted();
      timer = window.setTimeout(prepare, 16);
    };
    prepare();
    return () => clearTimeout(timer);
  }, [started, attempt, fit, profile.origin]);

  // Not ready in time: a fresh page shows as it is; the warm page hands the App to a page of its own
  useEffect(() => {
    if (!active || !started) return;
    const timer = setInterval(() => {
      const s = state.current, now = Date.now(), request = live.current.host?.request || 0;
      if (live.current.host) {
        if (s.ready || !request) return;
        // The App's window is up but DSM still shows its loading mask: shown as it is after the wait
        if (s.launched === request && s.reported) { if (now - s.launchedAt > FIT_WAIT) ready(); return; }
        if (s.launched === request ? now - s.launchedAt > HOST_WAIT : s.loaded && now - s.launchedAt > HOST_WAIT) fail(request);
        return;
      }
      if (s.ready || !s.loaded) return;
      const doc = win()?.document;
      // A sign-in page instead of the App (an expired session) shows at once
      if (doc?.querySelector('input[type=password]')) ready();
      else if (!waitFit && doc && drawn(doc)) ready();
      else if (now - s.launchedAt > (waitFit ? FIT_WAIT : 5000)) ready();
    }, 100);
    return () => clearInterval(timer);
  }, [active, started, waitFit]);

  // A warm-page request: hide the frame under the cover until the App it hosts shows
  const hostRequest = active ? host?.request || 0 : 0;
  useEffect(() => {
    if (!host) return;
    if (hostRequest) {
      const s = state.current;
      s.ready = false; s.launchedAt = Date.now(); s.placedAt = 0;
      if (s.failed === hostRequest) return;
      setShown(false); step('start'); setSteps(0);
      if (error) { fail(hostRequest); return; }
      launchHosted();
      return;
    }
    // Left the App: close it in the page and keep the page for the next one
    const s = state.current;
    s.launched = 0; s.ready = false;
    try { win()?.__splFitHome?.(); } catch { /* The next launch closes it */ }
    setShown(false); step('start'); setSteps(0);
  }, [hostRequest]);

  // The DSM web sign-in page: done once this browser holds a DSM session
  useEffect(() => {
    if (!onAuthenticated || !active || !started) return;
    const timer = setInterval(() => { void refreshSession().then(key => { if (key) onAuthenticated(); }); }, 1500);
    return () => clearInterval(timer);
  }, [onAuthenticated, active, started]);

  const stepsRef = useRef(steps); stepsRef.current = steps;
  const back = () => {
    if (!live.current.active) return false;
    const w = win();
    if (fit && stepsRef.current > 0 && typeof w?.__splFitBack === 'function') { setSteps(value => Math.max(0, value - 1)); w.__splFitBack(); return true; }
    if (live.current.onExit) { live.current.onExit(); return true; }
    return false;
  };
  useEffect(() => {
    if (!active) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', back);
    return () => sub.remove();
  }, [active]);
  // The App's own Home: back to the launcher, like the Android bridge's close
  useEffect(() => {
    if (!active || !target.registered || !onExit) return;
    const receive = (event: MessageEvent) => {
      const activated = (navigator as Navigator & { userActivation?: { isActive: boolean } }).userActivation?.isActive ?? true;
      if (isFrameHome(event, frame.current?.contentWindow, profile.origin, activated)) live.current.onExit?.();
    };
    window.addEventListener('message', receive);
    return () => window.removeEventListener('message', receive);
  }, [active, target.registered, Boolean(onExit), profile.origin]);
  const activeSince = useRef(0), wasActive = useRef(false);
  if (active && !wasActive.current) activeSince.current = Date.now();
  wasActive.current = active;
  useEffect(() => { if (active && menuRequest && menuRequest > activeSince.current) win()?.__splFitMenu?.(); }, [menuRequest]);
  useEffect(() => {
    if (active) { if (!host) win()?.__splFitSync?.(); return; }
    // A hidden App must not keep the focus
    if (frame.current && document.activeElement === frame.current) frame.current.blur();
  }, [active]);

  const retry = () => {
    if (host && hostRequest) { fail(hostRequest); return; }
    setError(''); step('start'); setShown(false); setSteps(0); setAttempt(value => value + 1);
  };
  const scale = scaled && size.width ? size.width / DESKTOP : 1;
  const hidden = !shown && !error ? { opacity: 0, pointerEvents: 'none' as const } : {};
  return <View style={styles.root} onLayout={event => setSize({ width: event.nativeEvent.layout.width, height: event.nativeEvent.layout.height })}>
    {started && sameOrigin(src, profile.origin) ? <iframe key={attempt} ref={frame} src={src} title={title || target.id} name={target.registered && onExit ? SHELL_FRAME_NAME : undefined}
      allow="fullscreen; clipboard-read; clipboard-write" referrerPolicy="same-origin"
      onLoad={() => {
        if (!win()) { setError(t.loadFailed); Native.logOpen('open_rejected', 0); if (live.current.host?.request && live.current.active) fail(live.current.host.request); return; }
        const s = state.current;
        s.loaded = true; if (!live.current.host) s.launchedAt = Date.now();
        if (s.reported && !s.busy && !live.current.host) ready();
      }}
      style={{ border: 0, display: 'block', ...(scaled && size.width ? { width: DESKTOP, height: size.height / scale, transform: `scale(${scale})`, transformOrigin: '0 0' } : { width: '100%', height: '100%' }), ...hidden }} /> : null}
    <LaunchCover phase={phase} title={title} icon={icon} tint={tint} message={error || undefined}
      labels={{ loading: t.loadingApp, slow: t.openingSlow, reopen: t.reopen, back: t.back }}
      onReopen={retry} onBack={onExit} onFaded={() => step('faded')} />
  </View>;
}
const styles = StyleSheet.create({ root: { flex: 1, backgroundColor: '#fff', overflow: 'hidden' } });
