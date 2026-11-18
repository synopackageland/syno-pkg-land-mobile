import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { fitApp, mobileFitOn, mobileFitScript } from '../src/core/webview/mobile-fit/index.ts';
import { generate } from '../scripts/gen-mobile-fit.mjs';

test('generated mobile fit source matches dsm-fit.js and dsm-fit.css', () => {
  assert.equal(readFileSync('src/core/webview/mobile-fit/fit.gen.ts', 'utf8'), generate(), 'Run node scripts/gen-mobile-fit.mjs');
});

test('mobile fit defaults to on for phones and off for tablets; the NAS setting wins', () => {
  assert.equal(mobileFitOn({}, 393), true);
  assert.equal(mobileFitOn({}, 599), true);
  assert.equal(mobileFitOn({}, 600), false);
  assert.equal(mobileFitOn({ mobileFit: false }, 393), false);
  assert.equal(mobileFitOn({ mobileFit: true }, 800), true);
});

test('mobile fit script runs only on its own origin and only in the top frame', () => {
  const script = mobileFitScript('https://nas.example.com:5001/path');
  assert.match(script, /^if \(location\.origin === "https:\/\/nas\.example\.com:5001"\)/);
  assert.doesNotThrow(() => new vm.Script(script));
  assert.ok(!script.includes('__SPL_FIT_CSS__'));
  assert.ok(!script.includes('SynoPkgTransport'));
  // Another origin: nothing happens and nothing is touched
  const other = { location: { origin: 'https://evil.example.com' } } as Record<string, unknown>;
  vm.runInNewContext(script, other);
  assert.equal(other.__splFit, undefined);
  // A child frame of the right origin: the script returns at once
  const frame = { location: { origin: 'https://nas.example.com:5001' }, top: {} } as Record<string, unknown>;
  frame.window = frame;
  vm.runInNewContext(script, frame);
  assert.equal(frame.__splFit, undefined);
});

test('mobile fit rules are scoped to the class only the script adds', () => {
  const css = readFileSync('src/core/webview/mobile-fit/dsm-fit.css', 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
    // (Animations named with the fit's prefix hold no selectors)
    .replace(/@keyframes spl-fit-[\w-]+\s*\{(?:[^{}]*\{[^{}]*\})*\s*\}/g, '');
  const selectors = css.replace(/@media[^{]*\{/, '').split('}').map(block => block.split('{')[0].trim()).filter(Boolean);
  assert.ok(selectors.length > 10);
  // (A default the App's own colors override is scoped too, with no weight: :where(html.spl-fit …))
  for (const group of selectors.map(g => g.replace(/:where\(([^()]*)\)/g, (m, inner: string) => m.replace(/,/g, '\u0000'))))
    for (const one of group.split(',')) assert.match(one.trim(), /^(html\.spl-fit(\.spl-fit-modal)?:not\(#spl-fit-id\) |:where\(html\.spl-fit )/, one);
});

// ---- When the fit hooks Ext -------------------------------------------------
// The fit script runs at document start, long before DSM's Ext scripts. On a
// slow NAS Ext can take a minute or more to appear. These tests run the real
// dsm-fit.js in a fake page with a fake clock.

type Listener = { type: string; fn: () => void; capture: boolean };
function page() {
  let now = 0, nextId = 1, intervals = 0;
  const timers = new Map<number, { at: number; fn: () => void }>();
  const listeners: Listener[] = [];
  const target = () => ({
    addEventListener(type: string, fn: () => void, capture?: boolean | { capture?: boolean }) { listeners.push({ type, fn, capture: typeof capture === 'object' ? !!capture.capture : !!capture }); },
    removeEventListener(type: string, fn: () => void, capture?: boolean | { capture?: boolean }) {
      const c = typeof capture === 'object' ? !!capture.capture : !!capture;
      const i = listeners.findIndex(l => l.type === type && l.fn === fn && l.capture === c);
      if (i >= 0) listeners.splice(i, 1);
    },
  });
  const element = () => ({ classList: new Set<string>(), appendChild() {}, style: {} });
  const root = { ...element(), classList: { list: new Set<string>(), contains(c: string) { return this.list.has(c); }, add(c: string) { this.list.add(c); } } };
  const document = Object.assign(target(), {
    readyState: 'loading', documentElement: root, head: null as unknown,
    querySelectorAll: () => [], querySelector: () => null, createElement: element,
  });
  const ctx: Record<string, any> = Object.assign(target(), {
    location: { origin: 'https://nas.example.com:5001' }, document, screen: { width: 393 }, innerWidth: 393, innerHeight: 800,
    MutationObserver: class { observe() {} disconnect() {} },
    getComputedStyle: () => ({ paddingLeft: '0', paddingRight: '0' }),
    setTimeout(fn: () => void, ms = 0) { const id = nextId++; timers.set(id, { at: now + ms, fn }); return id; },
    clearTimeout(id: number) { timers.delete(id); },
    setInterval() { intervals++; return nextId++; },
    clearInterval() {},
  });
  ctx.window = ctx; ctx.top = ctx;
  vm.createContext(ctx);
  const env = {
    ctx, listeners,
    get intervals() { return intervals; },
    get pending() { return timers.size; },
    get now() { return now; },
    run(code: string) { return vm.runInContext(code, ctx); },
    /** Advance the clock, firing due timers in order */
    advance(ms: number) {
      const end = now + ms;
      for (;;) {
        const due = [...timers.entries()].filter(([, t]) => t.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
        if (!due) break;
        timers.delete(due[0]); now = Math.max(now, due[1].at); due[1].fn();
      }
      now = end;
    },
    /** A <script> finished loading: its load event reaches capture listeners on document */
    scriptLoaded() { for (const l of listeners.filter(x => x.type === 'load' && x.capture)) l.fn(); },
    contentLoaded() { document.readyState = 'interactive'; for (const l of listeners.filter(x => x.type === 'DOMContentLoaded')) l.fn(); },
    pageLoaded() { document.readyState = 'complete'; for (const l of listeners.filter(x => x.type === 'load' && !x.capture)) l.fn(); },
  };
  return env;
}
const fitJs = () => readFileSync('src/core/webview/mobile-fit/dsm-fit.js', 'utf8').replace('__SPL_FIT_CSS__', '""');

/** A minimal Ext 3: the classes the fit hooks, window managers and one App window */
function fakeExt() {
  const observed: string[] = [], hooks: Record<string, any> = {};
  class BoxComponent {} class Container extends BoxComponent {} class Panel extends Container {} class Window extends Panel {} class GridPanel extends Panel {}
  const names = new Map<unknown, string>([[BoxComponent, 'BoxComponent'], [Container, 'Container'], [Window, 'Window'], [GridPanel, 'GridPanel']]);
  const windows: any[] = [];
  const core = {
    util: { Observable: { observeClass(c: unknown, l: unknown) { observed.push(names.get(c) ?? '?'); hooks[names.get(c) ?? '?'] = l; } } },
    layout: {}, BoxComponent, Container, Panel,
    WindowMgr: { each(fn: (w: unknown) => void) { windows.forEach(fn); } },
    ComponentMgr: { all: { each() {} } },
  };
  const classes = { Window, grid: { GridPanel } };
  /** An open File Station-like window: 1010 px wide at x = -650 */
  const open = () => {
    const win: any = Object.assign(Object.create(Window.prototype), {
      rendered: true, hidden: false, minWidth: 912, minHeight: 400, size: [1010, 600], xy: [-650, 40], classes: new Set<string>(),
      getWidth() { return this.size[0]; }, getHeight() { return this.size[1]; },
      setSize(w: number, h: number) { this.size = [w, h]; }, setPagePosition(x: number, y: number) { this.xy = [x, y]; },
    });
    win.el = { dom: { offsetWidth: 1010, querySelector: () => null }, addClass(c: string) { win.classes.add(c); }, hasClass(c: string) { return win.classes.has(c); }, getXY: () => win.xy };
    windows.push(win);
    return win;
  };
  return { core, classes, full: { ...core, ...classes }, observed, hooks, open };
}

test('the fit hooks Ext at once when Ext is already there', () => {
  const p = page(), ext = fakeExt();
  p.ctx.Ext = ext.full;
  p.run(fitJs());
  assert.deepEqual(ext.observed, ['BoxComponent', 'Container', 'Window', 'GridPanel']);
  assert.equal(p.intervals, 0);
});

test('a tap on a drawer item ends as one click, and a tap on a text field focuses it in the tap itself (iOS)', () => {
  const p = page();
  const fired: string[] = [];
  p.ctx.MouseEvent = class { type: string; constructor(type: string) { this.type = type; } };
  const el = (tag: string, menu: boolean, extra: Record<string, unknown> = {}) => ({
    tagName: tag, isConnected: true, getAttribute: () => 'text',
    closest: (sel: string) => (menu && sel.includes('.module-list-layout')) || (tag === 'INPUT' && sel.includes('input')) ? {} : null,
    dispatchEvent: (e: { type: string }) => { fired.push(e.type); return true; }, ...extra,
  });
  p.run(fitJs());
  const on = (type: string) => p.listeners.find(l => l.type === type && l.capture)!.fn as unknown as (e: object) => void;
  const tap = (target: object, x = 10) => {
    let prevented = false;
    on('touchstart')({ target, touches: [{ clientX: 10, clientY: 10 }] });
    on('touchend')({ target, touches: [], changedTouches: [{ clientX: x, clientY: 10 }], preventDefault: () => { prevented = true; } });
    return prevented;
  };
  assert.equal(tap(el('DIV', true)), true, "the browser's own mouse events are held back");
  assert.deepEqual(fired, ['mousedown', 'mouseup', 'click']);
  fired.length = 0;
  assert.equal(tap(el('DIV', true), 40), false, 'a drag is not a tap');
  assert.deepEqual(fired, []);
  assert.equal(tap(el('DIV', false)), false, "outside the menus, taps are the browser's");
  let focused = 0;
  const field = el('INPUT', false);
  (field as Record<string, unknown>).closest = (sel: string) => sel.includes('input') ? field : null;
  (field as Record<string, unknown>).focus = () => { focused++; };
  assert.equal(tap(field), false, 'a field keeps its own click');
  assert.equal(focused, 1);
});

for (const seconds of [0, 35, 120]) {
  test(`the fit hooks Ext that a page script defines after ${seconds} s, without polling`, () => {
    const p = page(), ext = fakeExt();
    p.run(fitJs());
    p.contentLoaded();
    p.advance(seconds * 1000);
    assert.deepEqual(ext.observed, []);
    assert.equal(p.intervals, 0, 'no polling');
    assert.equal(p.pending, 0, 'no timer waits for Ext');
    // DSM's Ext script runs (a page-side global assignment) and its load event fires
    p.ctx.__ext = ext.full;
    p.run('Ext = __ext;');
    p.scriptLoaded();
    p.advance(1000);
    assert.deepEqual(ext.observed, ['BoxComponent', 'Container', 'Window', 'GridPanel']);
    // window.Ext is a plain data property again: DSM sees its own object
    assert.equal(p.run('Ext'), ext.full);
    const d = Object.getOwnPropertyDescriptor(p.ctx, 'Ext')!;
    assert.equal(d.value, ext.full); assert.equal(d.writable, true);
    assert.equal(p.pending, 0, 'nothing keeps running');
  });
}

test('the fit waits for Ext classes that load after Ext itself', () => {
  const p = page(), ext = fakeExt();
  p.run(fitJs());
  // ext-base: Ext and its core, but no Window yet
  p.ctx.__core = ext.core;
  p.run('Ext = __core;');
  p.scriptLoaded();
  p.advance(1000);
  assert.deepEqual(ext.observed, []);
  // ext-all defines the classes, here through code with no load event (eval)
  p.ctx.__classes = ext.classes;
  p.run('Ext.grid = __classes.grid; Ext.Window = __classes.Window;');
  p.advance(0);
  assert.deepEqual(ext.observed, ['BoxComponent', 'Container', 'Window', 'GridPanel']);
  assert.equal(p.ctx.Ext.Window, ext.classes.Window);
  const d = Object.getOwnPropertyDescriptor(p.ctx.Ext, 'Window')!;
  assert.equal(d.value, ext.classes.Window); assert.equal(d.writable, true);
});

test('the fit also hooks after a later script load when no trap fires', () => {
  const p = page(), ext = fakeExt();
  p.run(fitJs());
  // A page that defines Ext with defineProperty bypasses the setter
  p.ctx.__ext = ext.core;
  p.run("Object.defineProperty(window, 'Ext', { value: __ext, writable: true, configurable: true, enumerable: true });");
  Object.assign(ext.core, ext.classes);
  p.advance(60_000);
  assert.deepEqual(ext.observed, []);
  p.scriptLoaded();
  assert.deepEqual(ext.observed, ['BoxComponent', 'Container', 'Window', 'GridPanel']);
});

test('windows already open when the fit hooks Ext are fitted', () => {
  const p = page(), ext = fakeExt();
  p.run(fitJs());
  p.advance(60_000);
  const win = ext.open();
  p.ctx.__ext = ext.full;
  p.run('Ext = __ext;');
  p.scriptLoaded();
  p.advance(1000);
  assert.deepEqual(win.size, [393, 800]);
  assert.deepEqual(win.xy, [0, 0]);
  assert.ok(win.minWidth <= 393);
  assert.ok(win.classes.has('spl-fit-full'));
});

test('the fit hooks Ext only once and then stops listening', () => {
  const p = page(), ext = fakeExt();
  p.run(fitJs());
  const before = p.listeners.length;
  p.ctx.__ext = ext.full;
  p.run('Ext = __ext;');
  p.scriptLoaded(); p.scriptLoaded(); p.contentLoaded(); p.pageLoaded();
  p.run('Ext = __ext;');
  p.advance(1000);
  p.scriptLoaded();
  assert.deepEqual(ext.observed, ['BoxComponent', 'Container', 'Window', 'GridPanel']);
  // Only the fit's own listeners stay: resize, head/class, the toolbar edges
  // (scroll, tap) and the grid rows' detail button (tap, scroll, resize)
  assert.ok(!p.listeners.some(l => l.type === 'load'), 'load listeners removed');
  assert.ok(p.listeners.filter(l => l.type !== 'scroll' && l.type !== 'click' && l.type !== 'resize').length <= before);
  assert.equal(p.listeners.filter(l => l.type === 'scroll' || l.type === 'click').length, 4);
  // Running the script a second time does nothing
  p.run(fitJs());
  p.scriptLoaded(); p.advance(1000);
  assert.equal(ext.observed.length, 4);
});

test('with the NAS switch off the fit script is never added, so nothing hooks Ext', () => {
  // ShellScreen binds the script only when mobileFitOn is true (see shell-screen.test.ts)
  assert.equal(mobileFitOn({ mobileFit: false }, 393), false);
});

// ---- Single-App mode ---------------------------------------------------------
// /?launchApp=<id> is DSM's own standalone page. These tests run the real
// dsm-fit.js against a fake DSM: SYNO.SDS.init/initFramework, its window list
// (Vue windows), Ext's window manager (Ext windows), history and the shell.

/** A DOM element with what the fit reads from window roots */
function el(extra: Record<string, unknown> = {}) {
  const classes = new Set<string>();
  return {
    nodeType: 1, offsetWidth: 393, style: {} as Record<string, string>, children: [] as unknown[], textContent: '',
    classList: { contains: (c: string) => classes.has(c), add: (c: string) => { classes.add(c); }, remove: (c: string) => { classes.delete(c); }, has: (c: string) => classes.has(c) },
    querySelector: (_selector: string): unknown => null,
    ...extra,
  };
}
type Opts = { app?: string; type?: string; native?: boolean; enabled?: boolean; width?: number; late?: boolean };
function dsmPage({ app = 'SYNO.SDS.AdminCenter.Application', type = 'app', native = false, enabled = true, width = 393, late = false }: Opts = {}) {
  const p = page(), ext = fakeExt();
  const observers: (() => void)[] = [], posts: any[] = [];
  let entries = 0, z = 10;
  p.ctx.screen.width = width; p.ctx.innerWidth = width;
  p.ctx.location.search = `?launchApp=${encodeURIComponent(app)}`;
  p.ctx.location.href = `https://nas.example.com:5001/${p.ctx.location.search}`;
  p.ctx.URL = URL; p.ctx.URLSearchParams = URLSearchParams;
  p.ctx.MutationObserver = class { constructor(fn: () => void) { observers.push(fn); } observe() {} disconnect() {} };
  p.ctx.getComputedStyle = (node: any) => ({ display: node?.style?.display ?? '', visibility: '', zIndex: node?.style?.zIndex ?? '', paddingLeft: '0', paddingRight: '0', backgroundImage: '' });
  p.ctx.ReactNativeWebView = { postMessage: (text: string) => posts.push(JSON.parse(text)) };
  const desk = el();
  p.ctx.document.body = el(); p.ctx.document.getElementById = (id: string) => id === 'sds-desktop' ? desk : null;
  const popstate = () => { for (const l of p.listeners.filter(x => x.type === 'popstate')) l.fn(); };
  p.ctx.history = {
    pushState() { entries++; },
    go(k: number) { p.ctx.setTimeout(() => { entries = Math.max(0, entries + k); popstate(); }, 0); },
  };
  const windowList: any[] = [];
  let redirected = false, standaloneDesktop = 0;
  // DSM's framework, as SYNO.SDS.init reads it
  const sds: any = {
    Config: {}, Session: {}, StatusNotifier: { isAppEnabled: (id: string) => id === app && enabled },
    WindowMgr: { windowList, getContainerEl: () => ({ dom: desk }) },
  };
  sds.initFramework = function () { sds.Config.FnMap = { [app]: { config: { type, ...(native ? { allowStandalone: true } : {}) } } }; };
  const init = function () {
    sds.initFramework();
    const config = sds.Config.FnMap[app].config;
    if (config.type === 'standalone' || config.allowStandalone === true) { sds.Session.standalone = true; standaloneDesktop++; } else redirected = true;
  };
  class AppWindow extends (ext.classes.Window as any) {}
  sds.AppWindow = AppWindow;
  const env = {
    p, ext, posts, desk, windowList, sds, init,
    /** Back steps the page last reported to the shell */
    get steps() { return env.apps().at(-1)?.back ?? 0; },
    /** History entries the page pushed (single-App mode pushes none) */
    get entries() { return entries; },
    get redirected() { return redirected; }, get standaloneDesktop() { return standaloneDesktop; },
    /** DSM defines SYNO (and Ext) */
    defineDsm() {
      p.ctx.__ext = ext.full; p.run('Ext = __ext;'); p.scriptLoaded();
      p.ctx.__sds = sds; p.run('SYNO = { SDS: __sds };'); p.scriptLoaded();
      // Later bundles define init again
      p.ctx.__init = () => {}; p.run('SYNO.SDS.init = __init;'); p.scriptLoaded();
      p.ctx.__init = init; p.run('SYNO.SDS.init = __init;'); p.scriptLoaded();
    },
    /** DSM starts: SYNO.SDS.init() */
    start() { p.run('SYNO.SDS.init();'); p.advance(0); },
    /** DOM changes the fit watches (a window shows, hides or restyles) */
    changed() { observers.forEach(fn => fn()); p.advance(100); },
    /** The page inserts nodes (records as a MutationObserver delivers them), before any timer runs */
    inserted(nodes: unknown[]) { observers.forEach(fn => (fn as (r: unknown) => void)([{ addedNodes: nodes }])); },
    /** An Ext window: an App (SYNO.SDS.AppWindow) unless it is a dialog */
    extWindow({ title = 'Storage Manager', id = 'SYNO.SDS.StorageManager.Instance', root = false, dialog = false } = {}) {
      const win = ext.open();
      if (!dialog) Object.setPrototypeOf(win, AppWindow.prototype);
      win.el.dom = el({ style: { zIndex: String(z++) } });
      win.size = [800, 600];
      if (root) win.classes.add('sds-standalone-main-window');
      Object.assign(win, { title, closed: 0, appInstance: { getJsConfig: () => ({ jsID: id }) }, close() { win.hidden = true; win.closed++; win.el.dom.offsetWidth = 0; } });
      return win;
    },
    /** A Vue window in SYNO.SDS.WindowMgr.windowList */
    vueWindow({ title = 'Control Panel', id = 'SYNO.SDS.AdminCenter.Application', root = false, name = 'PageListAppWindow', modal = false, menu = false, vue3 = false } = {}) {
      const items: Record<string, any> = {
        '.v-window-header-title': { textContent: title },
        '.app-window-header-hamburger': menu ? {} : null,
      };
      const watchers: Record<string, () => void> = {};
      const c: any = {
        // As DSM's: every Vue App window in a standalone page is isStandalone, and refuses to close while it is
        _isVue: true, $options: { name }, modal, isStandaloneMainWindow: root, isStandalone: !modal, closed: 0, visible: true,
        appInstance: modal ? undefined : { getJsConfig: () => ({ jsID: id }) },
        innerShowModules: false, selectedVal: '',
        isVisible() { return c.visible; }, close() { if (c.isStandalone) return; c.visible = false; c.closed++; c.$el.offsetWidth = 0; },
        getTitle: () => 'tree:leaf_key',
        onClickHamburgerIcon() { c.innerShowModules = !c.innerShowModules; },
        onClickModuleListMask() { c.innerShowModules = false; },
        $watch(key: string, fn: () => void) { watchers[key] = fn; },
        /** Open a module page from the App's home grid */
        select(page: string) { c.selectedVal = page; items['.module-list-layout .module-item-option.activated .module-item-text'] = { textContent: page }; items['.module-list-layout [class*="-home"]'] = { click() { c.select(''); } }; },
      };
      // A Vue 3 component proxy has no _isVue: its internal instance is `$`
      if (vue3) { delete c._isVue; c.$ = {}; }
      c.$el = el({ style: { zIndex: String(z++) }, querySelector: (s: string) => (s.includes('.activated') || s.includes('-home')) && !c.selectedVal ? null : items[s] ?? null });
      windowList.push({ id: String(windowList.length), component: c });
      return c;
    },
    /** Android or shell back, as ShellScreen does it: the page closes its top step while it reports one, else the shell leaves the App */
    back() { if (!env.steps) return false; p.run('__splFitBack()'); p.advance(100); return true; },
    apps() { return posts.filter(m => m.internal === 'fitApp').map(m => m.app); },
    closed() { return posts.filter(m => m.internal === 'fitClosed').length; },
  };
  if (!late) { p.ctx.__ext = ext.full; p.run('Ext = __ext;'); }
  return env;
}
function startDsm(opts: Opts = {}) {
  const d = dsmPage(opts);
  d.p.run(fitJs());
  d.defineDsm(); d.start();
  return d;
}

test('single-App: DSM opens its standalone page for a launched App it reports enabled, only on a phone', () => {
  const on = startDsm();
  assert.equal(on.standaloneDesktop, 1); assert.equal(on.redirected, false);
  assert.equal(on.sds.Config.FnMap['SYNO.SDS.AdminCenter.Application'].config.allowStandalone, true);
  // A disabled App keeps DSM's own path (it sends the page home)
  const disabled = startDsm({ enabled: false });
  assert.equal(disabled.standaloneDesktop, 0); assert.equal(disabled.redirected, true);
  // A tablet keeps the desktop
  const tablet = startDsm({ width: 800 });
  assert.equal(tablet.standaloneDesktop, 0);
  // Apps that are standalone already are left as DSM made them
  const native = startDsm({ app: 'SYNO.SDS.App.FileStation3.Instance', native: true });
  assert.equal(native.standaloneDesktop, 1);
  const portal = startDsm({ app: 'SYNO.SDS.Drive.Application', type: 'standalone' });
  assert.equal(portal.standaloneDesktop, 1); assert.equal(portal.sds.Config.FnMap['SYNO.SDS.Drive.Application'].config.allowStandalone, undefined);
});

test('single-App: a page without launchApp, or DSM not standalone, keeps today\'s fit untouched', () => {
  for (const setup of ['no-launch', 'not-standalone']) {
    const d = dsmPage({ enabled: setup !== 'not-standalone' });
    if (setup === 'no-launch') d.p.ctx.location.search = '';
    d.p.run(fitJs()); d.defineDsm(); d.start();
    const win = d.extWindow({ root: true }); d.changed();
    assert.equal(win.classes.has('spl-single-app'), false, setup);
    assert.equal(d.steps, 0, setup); assert.deepEqual(d.posts, [], setup);
    assert.equal(d.p.ctx.__splFitMenu, undefined, setup);
  }
});

test('single-App: an Ext App window fills the screen with no title row and reports itself', () => {
  const d = startDsm({ app: 'SYNO.SDS.StorageManager.Instance' });
  const win = d.extWindow({ root: true }); d.changed();
  assert.ok(win.classes.has('spl-single-app')); assert.ok(win.classes.has('spl-fit-full'));
  assert.deepEqual(win.size, [393, 800]); assert.deepEqual(win.xy, [0, 0]);
  assert.deepEqual(d.apps(), [{ id: 'SYNO.SDS.StorageManager.Instance', title: 'Storage Manager', page: '', menu: false, icon: '', back: 0, busy: false }]);
  // Nothing to go back to inside the App: back leaves it
  assert.equal(d.steps, 0); assert.equal(d.back(), false);
});

test('single-App: an App still under DSM\'s loading mask reports busy until the mask goes', () => {
  const d = startDsm({ app: 'SYNO.SDS.StorageManager.Instance' });
  const win = d.extWindow({ root: true });
  const mask = { offsetWidth: 120, offsetHeight: 40 };
  let masks: unknown[] = [mask];
  win.el.dom.querySelectorAll = (s: string) => /ext-el-mask-msg/.test(s) && /x-mask-loading/.test(s) ? masks : [];
  d.changed();
  assert.equal(d.apps().at(-1).busy, true);
  // The mask leaves inside the App's content, which no window watcher sees: the page looks again by itself
  masks = [];
  d.p.advance(300);
  assert.equal(d.apps().at(-1).busy, false);
  // A mask with no size (not displayed) is not loading; one Ext has added but not yet shown is
  masks = [{ offsetWidth: 0, offsetHeight: 0 }]; d.changed();
  assert.equal(d.apps().at(-1).busy, false);
});

test('single-App: turned sideways, the App stays a single App filling the page, and the shell hears of it', () => {
  const d = startDsm({ app: 'SYNO.SDS.StorageManager.Instance' });
  const win = d.extWindow({ root: true }); d.changed();
  const posts = d.apps().length;
  Object.assign(d.p.ctx, { innerWidth: 800, innerHeight: 360 }); d.p.ctx.screen.width = 800;
  for (const l of d.p.listeners.filter(x => x.type === 'resize')) l.fn();
  d.p.advance(400);
  assert.ok(win.classes.has('spl-single-app')); assert.deepEqual(win.size, [800, 360]); assert.deepEqual(win.xy, [0, 0]);
  assert.ok(d.apps().length > posts, 'reported again after the turn');
  // The rules that hide the title row hold at any width, unlike the phone-only fit
  const css = readFileSync('src/core/webview/mobile-fit/dsm-fit.css', 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
    // (Animations named with the fit's prefix hold no selectors)
    .replace(/@keyframes spl-fit-[\w-]+\s*\{(?:[^{}]*\{[^{}]*\})*\s*\}/g, '');
  const media = css.slice(css.indexOf('@media'), css.lastIndexOf('}', css.indexOf('.spl-single-app')));
  assert.ok(!media.includes('spl-single-app'));
  assert.match(css, /\.spl-single-app > \.x-window-tl,[^{]*\{ display: none/);
  // A window that is not a single App keeps the phone-only fit
  const dialog = d.extWindow({ dialog: true }); d.changed();
  assert.deepEqual(dialog.size, [800, 600]);
});

test('single-App: a Vue App window (Control Panel) loses its title row, and back steps through menu, page, then the App', () => {
  const d = startDsm();
  const cp = d.vueWindow({ root: true, menu: true }); d.changed();
  assert.ok(cp.$el.classList.has('spl-single-app'));
  assert.deepEqual(d.apps().at(-1), { id: 'SYNO.SDS.AdminCenter.Application', title: 'Control Panel', page: '', menu: true, icon: '', back: 0, busy: false });
  // A module page, then the module menu from the shell's menu button
  cp.select('Network'); d.changed();
  assert.equal(d.apps().at(-1).page, 'Network'); assert.equal(d.steps, 1);
  d.p.run('__splFitMenu()'); d.p.advance(100);
  assert.equal(cp.innerShowModules, true); assert.equal(d.steps, 2);
  assert.equal(d.back(), true); assert.equal(cp.innerShowModules, false); assert.equal(cp.selectedVal, 'Network');
  assert.equal(d.back(), true); assert.equal(cp.selectedVal, '');
  assert.equal(d.apps().at(-1).page, '');
  assert.equal(d.back(), false); // the shell returns to the launcher
  assert.equal(cp.closed, 0);
  // Steps are counted for the shell, never pushed to history: Chromium's back skips
  // entries pushed without a tap in the page, and the shell's buttons are not one
  assert.equal(d.entries, 0);
});

test('single-App: an App opened from the App stacks on top, the title follows it, and back returns to the first', () => {
  const d = startDsm({ app: 'SYNO.SDS.App.FileStation3.Instance', native: true });
  const fs = d.extWindow({ root: true, title: 'File Station', id: 'SYNO.SDS.App.FileStation3.Instance' }); d.changed();
  const editor = d.extWindow({ title: 'Text Editor', id: 'SYNO.SDS.TextEditor.Application' }); d.changed();
  assert.ok(editor.classes.has('spl-single-app')); assert.deepEqual(editor.size, [393, 800]);
  assert.equal(d.apps().at(-1).title, 'Text Editor'); assert.equal(d.steps, 1);
  assert.equal(d.back(), true);
  assert.equal(editor.closed, 1); assert.equal(fs.hidden, false);
  d.changed();
  assert.equal(d.apps().at(-1).title, 'File Station'); assert.equal(d.steps, 0);
  assert.equal(d.closed(), 0, 'never an empty desktop');
});

test('single-App: a Vue App opened from the App (Control Panel over DNS Server) closes on back, though DSM marks it standalone', () => {
  const d = startDsm({ app: 'SYNO.SDS.DNS.Instance' });
  const dns = d.extWindow({ root: true, title: 'DNS Server', id: 'SYNO.SDS.DNS.Instance' }); d.changed();
  const cp = d.vueWindow(); d.changed();
  assert.equal(d.apps().at(-1).title, 'Control Panel'); assert.equal(d.steps, 1);
  cp.select('Info Center'); d.changed(); assert.equal(d.steps, 2);
  assert.equal(d.back(), true); assert.equal(cp.selectedVal, '');
  assert.equal(d.back(), true); assert.equal(cp.closed, 1); assert.equal(dns.closed, 0);
  d.changed();
  assert.equal(d.apps().at(-1).title, 'DNS Server'); assert.equal(d.steps, 0);
  // The App on screen first stays standalone: DSM keeps it open
  const root = startDsm(); const main = root.vueWindow({ root: true }); root.changed();
  assert.equal(main.isStandalone, true);
});

test('single-App mixed: a Vue dialog over an Ext App and an Ext dialog over a Vue App close first and stay dialogs', () => {
  // Storage Manager: an Ext App window with Vue content opens a Vue message box
  const sm = startDsm({ app: 'SYNO.SDS.StorageManager.Instance' });
  const win = sm.extWindow({ root: true }); sm.changed();
  const box = sm.vueWindow({ name: 'MessageBoxWindow', modal: true }); sm.changed();
  assert.equal(box.$el.classList.has('spl-single-app'), false);
  assert.equal(sm.apps().at(-1).title, 'Storage Manager'); assert.equal(sm.steps, 1);
  assert.equal(sm.back(), true); assert.equal(box.closed, 1); assert.equal(win.closed, 0);
  sm.changed(); assert.equal(sm.steps, 0);
  // Control Panel: a Vue App window opens an Ext dialog
  const cp = startDsm();
  const app = cp.vueWindow({ root: true }); cp.changed();
  const dialog = cp.extWindow({ dialog: true, title: 'Edit' }); dialog.size = [300, 200]; cp.changed();
  assert.equal(dialog.classes.has('spl-single-app'), false, 'dialogs stay centered');
  assert.equal(cp.apps().at(-1).title, 'Control Panel'); assert.equal(cp.steps, 1);
  assert.equal(cp.back(), true); assert.equal(dialog.closed, 1); assert.equal(app.closed, 0);
});

test('single-App: an App that closes itself returns to the launcher instead of an empty desktop', () => {
  const d = startDsm({ app: 'SYNO.SDS.StorageManager.Instance' });
  const win = d.extWindow({ root: true }); d.changed();
  // Briefly hidden and shown again (DSM re-renders): nothing happens
  win.hidden = true; d.changed(); win.hidden = false; d.changed(); d.p.advance(1000);
  assert.equal(d.closed(), 0);
  win.close(); d.changed(); d.p.advance(400);
  assert.equal(d.closed(), 1);
});

test('single-App: the shell can ask the page to report the App again (a warm screen shown again)', () => {
  const d = startDsm();
  d.vueWindow({ root: true }); d.changed();
  const before = d.apps().length;
  d.changed(); assert.equal(d.apps().length, before, 'unchanged state is not posted twice');
  d.p.run('__splFitSync()'); d.p.advance(100);
  assert.equal(d.apps().length, before + 1);
});

for (const seconds of [0, 35, 120]) {
  test(`single-App works when Ext, SYNO and the windows arrive ${seconds} s late, Vue and Ext alike`, () => {
    const d = dsmPage({ late: true, app: 'SYNO.SDS.StorageManager.Instance' });
    d.p.run(fitJs());
    d.p.contentLoaded();
    d.p.advance(seconds * 1000);
    assert.equal(d.p.intervals, 0, 'no polling');
    d.defineDsm();
    d.p.advance(seconds * 1000);
    d.start();
    assert.equal(d.standaloneDesktop, 1);
    d.p.advance(seconds * 1000);
    const win = d.extWindow({ root: true }); d.changed();
    assert.ok(win.classes.has('spl-single-app'));
    const box = d.vueWindow({ name: 'MessageBoxWindow', modal: true }); d.changed();
    assert.equal(d.steps, 1);
    assert.equal(d.back(), true); assert.equal(box.closed, 1);
    assert.equal(d.apps().at(-1).title, 'Storage Manager');
  });
}

test('single-App works when DSM\'s window list arrives late too (a Vue-only App)', () => {
  const d = dsmPage({ late: true });
  d.p.run(fitJs());
  d.defineDsm(); d.p.pageLoaded(); d.start();
  d.p.advance(60_000);
  const cp = d.vueWindow({ root: true, menu: true }); d.changed();
  assert.ok(cp.$el.classList.has('spl-single-app'));
  assert.equal(d.apps().at(-1).title, 'Control Panel');
});

// ---- Prototype fixes: toolbars, splitbars, collapsed strips -----------------
/** A toolbar row: the buttons are `content` px wide in `width` px */
function toolbar(content: number, width: number, kind: 'ext' | 'vue') {
  const classes = new Set<string>();
  return {
    kind, scrollWidth: content, clientWidth: width, scrollLeft: 0,
    classList: { contains: (c: string) => classes.has(c), toggle: (c: string) => { if (classes.has(c)) classes.delete(c); else classes.add(c); }, has: (c: string) => classes.has(c), add: (c: string) => { classes.add(c); } },
    matches: (s: string) => s.split(',').some(one => one.trim() === (kind === 'ext' ? '.x-toolbar' : '.v-toolbar > .main-wrapper')),
  };
}
test('toolbars wider than the phone, Ext and Vue, fade at the edge where more buttons are', () => {
  const d = startDsm({ app: 'SYNO.SDS.StorageManager.Instance' });
  const ext = toolbar(468, 393, 'ext'), vue = toolbar(537, 361, 'vue'), fits = toolbar(394, 393, 'ext');
  const rows = [ext, fits];
  d.p.ctx.document.querySelectorAll = (s: string) => s.includes('toolbar') ? rows : [];
  // A layout or a tap triggers a look; the Vue row renders later (a page switch)
  d.extWindow({ root: true }); d.changed(); d.p.advance(200);
  assert.ok(ext.classList.has('spl-fit-more-end')); assert.ok(!ext.classList.has('spl-fit-more-start'));
  assert.ok(!fits.classList.has('spl-fit-more-end'), 'a 1 px overflow is not "more"');
  rows.push(vue);
  for (const l of d.p.listeners.filter(x => x.type === 'click')) l.fn();
  d.p.advance(1000);
  assert.ok(vue.classList.has('spl-fit-more-end'));
  // Scrolled to the end: the start fades instead
  vue.scrollLeft = 176;
  for (const l of d.p.listeners.filter(x => x.type === 'scroll' && x.capture)) (l.fn as any)({ target: vue });
  assert.ok(vue.classList.has('spl-fit-more-start')); assert.ok(!vue.classList.has('spl-fit-more-end'));
});

test('toolbars scroll sideways, menu splitbars are hidden, and collapsed panels stay reachable', () => {
  const css = readFileSync('src/core/webview/mobile-fit/dsm-fit.css', 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
    // (Animations named with the fit's prefix hold no selectors)
    .replace(/@keyframes spl-fit-[\w-]+\s*\{(?:[^{}]*\{[^{}]*\})*\s*\}/g, '');
  const rule = (selector: string) => new RegExp(selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '[^{]*\\{([^}]*)\\}').exec(css)?.[1] ?? '';
  assert.match(rule('.x-toolbar {'.slice(0, -2)), /overflow-x: auto/);
  assert.match(rule('.v-toolbar > .main-wrapper'), /overflow-x: auto/);
  assert.match(rule('.spl-fit-nav-split'), /display: none/);
  // A collapsed panel (File Station's task monitor) is a feature: its bar is never hidden
  assert.ok(!/x-layout-collapsed[^{]*\{[^}]*display: none/.test(css));
  assert.match(rule('.spl-fit-more-end'), /mask-image/);
  // The splitbar marked is the one of the region that became the menu
  assert.match(fitJs(), /getElementById\(west\.id \+ '-xsplit'\)[\s\S]{0,80}spl-fit-nav-split/);
});

test('the content beside a side menu is one stacking layer, so rows with their own z-index stay under the open menu', () => {
  const css = readFileSync('src/core/webview/mobile-fit/dsm-fit.css', 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
    // (Animations named with the fit's prefix hold no selectors)
    .replace(/@keyframes spl-fit-[\w-]+\s*\{(?:[^{}]*\{[^{}]*\})*\s*\}/g, '');
  // Ext (Security Advisor's category rows use z-index 100) and Vue page lists alike
  assert.match(css, /\.spl-fit-nav-main, html\.spl-fit:not\(#spl-fit-id\) \.spl-fit-nav \.v-sm-main \{ isolation: isolate; \}/);
  // Every region but the menu is marked
  assert.match(fitJs(), /i !== west && i\.el\) i\.el\.addClass\('spl-fit-nav-main'\)/);
});

test('single-App: a warm App shown again opens on its content, with its side menu closed', () => {
  const d = startDsm();
  const cp = d.vueWindow({ root: true, menu: true }); d.changed();
  d.p.run('__splFitMenu()'); d.p.advance(100);
  assert.equal(cp.innerShowModules, true);
  d.p.run('__splFitSync()'); d.p.advance(100);
  assert.equal(cp.innerShowModules, false);
  assert.equal(d.steps, 0);
});

test('a collapsed panel keeps its bar, flush with the content and the screen edge on a phone only', () => {
  for (const width of [393, 800]) {
    const p = page(), ext = fakeExt();
    p.ctx.screen.width = width; p.ctx.innerWidth = width;
    let layouts = 0;
    class BorderLayout { south: any; east: any; onLayout() { layouts++; this.south ||= { cmargins: { top: 5, right: 5, bottom: 5, left: 5 }, isCollapsed: true }; this.east ||= { cmargins: { top: 0, right: 0, bottom: 0, left: 5 }, isCollapsed: false }; return 'laid out'; } }
    (ext.core.layout as any).BorderLayout = BorderLayout;
    p.ctx.Ext = ext.full;
    p.run(fitJs());
    const layout = new BorderLayout();
    assert.equal(layout.onLayout(), 'laid out');
    if (width === 393) {
      assert.deepEqual({ ...layout.south.cmargins }, { top: 0, right: 0, bottom: 0, left: 0 });
      assert.deepEqual({ ...layout.east.cmargins }, { top: 0, right: 0, bottom: 0, left: 0 });
      assert.equal(layouts, 2, 'a collapsed region is laid out again once');
      layout.onLayout(); assert.equal(layouts, 3);
    } else {
      assert.equal(layout.south.cmargins.top, 5, 'tablets keep DSM\'s layout'); assert.equal(layouts, 1);
    }
  }
});

test('an expand or collapse button an App draws no image for gets a plain arrow, so it is never an invisible tap target', () => {
  const p = page(), ext = fakeExt();
  const tool = (image: string) => { const classes = new Set<string>(); return { image, classes, classList: { toggle(c: string, on: boolean) { if (on) classes.add(c); else classes.delete(c); } } }; };
  // File Station's task monitor opened on top of another App: DSM styles its button only for its standalone main window
  const bare = tool('none'), drawn = tool('url("grid_bt_expand.png")'), header = tool('none');
  p.ctx.getComputedStyle = (node: any) => ({ backgroundImage: node.image, paddingLeft: '0', paddingRight: '0' });
  const holder = (tools: unknown[]) => ({ dom: { querySelectorAll: (s: string) => (/x-tool-expand-south/.test(s) && /x-tool-collapse-south/.test(s) ? tools : []) } });
  class BorderLayout { south = { cmargins: { top: 0, right: 0, bottom: 0, left: 0 }, isCollapsed: true, collapsedEl: holder([bare, drawn]), panel: { el: holder([header]) } }; onLayout() { return 'laid out'; } }
  (ext.core.layout as any).BorderLayout = BorderLayout;
  p.ctx.Ext = ext.full;
  p.run(fitJs());
  const layout = new BorderLayout();
  layout.onLayout();
  assert.ok(bare.classes.has('spl-fit-tool-mark')); assert.ok(header.classes.has('spl-fit-tool-mark'));
  assert.equal(drawn.classes.has('spl-fit-tool-mark'), false, 'an App\'s own image stays');
  // Once DSM draws it (File Station back as the main window), the arrow goes
  bare.image = 'url("grid_bt_expand.png")'; layout.onLayout();
  assert.equal(bare.classes.has('spl-fit-tool-mark'), false);
  const css = readFileSync('src/core/webview/mobile-fit/dsm-fit.css', 'utf8');
  assert.match(css, /\.spl-fit-tool-mark::before \{[^}]*border-top: 2px solid/);
  assert.match(css, /\.spl-fit-tool-mark\.x-tool-collapse-south::before \{ transform: rotate\(225deg\)/);
});

// ---- Oversized content in single-App mode -----------------------------------
// A small DOM with fixed layout boxes: enough for the fit to measure, scale,
// reflow and hit-test. Boxes are the layout (untransformed) boxes; the visual
// box of a scaled element follows its transform, as in a browser.
type Box = { left: number; top: number; width: number; height: number };
const matchOne = (n: FakeNode, sel: string): boolean => {
  const m = /^([a-zA-Z0-9*]*)((?:\.[\w-]+|\[[^\]]+\])*)$/.exec(sel.trim());
  if (!m) return false; // descendant selectors: not used by the content rules
  if (m[1] && m[1] !== '*' && m[1].toLowerCase() !== n.tagName.toLowerCase()) return false;
  for (const part of m[2].match(/\.[\w-]+|\[[^\]]+\]/g) ?? []) {
    if (part[0] === '.') { if (!n.cls.has(part.slice(1))) return false; continue; }
    const a = /^\[([\w-]+)(?:(\*?=)"?([^"]*)"?)?\]$/.exec(part)!;
    const value = a[1] === 'class' ? [...n.cls].join(' ') : n.attrs[a[1]];
    if (value === undefined) return false;
    if (a[2] === '=' && value !== a[3]) return false;
    if (a[2] === '*=' && !value.includes(a[3])) return false;
  }
  return true;
};
/** A selector with descendant (`a b`) and child (`a > b`) steps, matched right to left */
const matchComplex = (n: FakeNode, sel: string): boolean => {
  const parts = sel.trim().replace(/\s*>\s*/g, ' > ').split(/\s+/);
  const from = (node: FakeNode | null, i: number): boolean => {
    if (!node || !matchOne(node, parts[i])) return false;
    if (i === 0) return true;
    if (parts[i - 1] === '>') return from(node.parentElement, i - 2);
    for (let a = node.parentElement; a; a = a.parentElement) if (from(a, i - 1)) return true;
    return false;
  };
  return from(n, parts.length - 1);
};
class FakeNode {
  nodeType = 1; tagName: string; cls = new Set<string>(); attrs: Record<string, string> = {}; kids: FakeNode[] = []; parentElement: FakeNode | null = null;
  box: Box; cs: Record<string, string>; text: string; hidden = false; listeners: Record<string, ((e: any) => void)[]> = {};
  vars: Record<string, string> = {}; style: any; classAdds = 0; classRemoves = 0; connected = false; moved?: Box;
  constructor(tag: string, opts: { cls?: string; box?: Box; cs?: Record<string, string>; text?: string; attrs?: Record<string, string> } = {}) {
    this.tagName = tag.toUpperCase(); this.box = opts.box ?? { left: 0, top: 0, width: 0, height: 0 };
    this.cs = { position: 'static', display: tag === 'span' ? 'inline' : 'block', ...opts.cs }; this.text = opts.text ?? ''; this.attrs = { ...opts.attrs };
    for (const c of (opts.cls ?? '').split(/\s+/).filter(Boolean)) this.cls.add(c);
    const vars = this.vars;
    this.style = { getPropertyValue: (k: string) => vars[k] ?? '', setProperty: (k: string, v: string) => { vars[k] = v; }, removeProperty: (k: string) => { delete vars[k]; } };
    const node = this;
    this.classList = {
      contains: (c: string) => node.cls.has(c), has: (c: string) => node.cls.has(c),
      add: (c: string) => { node.cls.add(c); node.classAdds++; }, remove: (c: string) => { if (node.cls.delete(c)) node.classRemoves++; },
      toggle: (c: string, on?: boolean) => { const v = on ?? !node.cls.has(c); if (v) node.cls.add(c); else node.cls.delete(c); return v; },
    };
  }
  classList: any;
  get className() { return [...this.cls].join(' '); }
  set className(v: string) { this.cls = new Set(v.split(/\s+/).filter(Boolean)); }
  get children() { return this.kids; }
  get parentNode() { return this.parentElement; }
  get isConnected(): boolean { return this.connected || !!this.parentElement?.isConnected; }
  get firstChild() { return this.text ? { nodeType: 3, nodeValue: this.text, nextSibling: null, owner: this } : null; }
  /** Where the text runs when it is longer than its box (cut off by an ellipsis) */
  textBox?: Box;
  get textContent(): string { return this.text + this.kids.map(k => k.textContent).join(''); }
  set textContent(v: string) { this.text = String(v); this.kids = []; }
  get shown(): boolean { return !this.hidden && this.cs.display !== 'none' && (!this.parentElement || this.parentElement.shown); }
  get layout(): Box { return this.cls.has('spl-fit-reflow') && this.moved ? this.moved : this.box; }
  get offsetWidth() { return this.shown ? this.layout.width : 0; }
  get offsetHeight() { return this.shown ? this.layout.height : 0; }
  get clientWidth() { return this.offsetWidth; }
  get offsetTop() { return this.shown ? this.layout.top : 0; }
  clientLeft = 0;
  /** Width its content needs: wider than its box, it overflows (scrollWidth) */
  naturalWidth?: number;
  get scrollWidth() { return Math.max(this.naturalWidth ?? 0, this.clientWidth); }
  get clientHeight() { return this.offsetHeight; }
  /** Height its content reaches: past its box, it spills out of the bottom (scrollHeight) */
  naturalHeight?: number;
  get scrollHeight() { return Math.max(this.naturalHeight ?? 0, this.clientHeight); }
  get firstElementChild() { return this.kids[0] ?? null; }
  get nextElementSibling(): FakeNode | null { const k = this.parentElement?.kids ?? []; return k[k.indexOf(this) + 1] ?? null; }
  scrollLeft = 0;
  get offsetParent(): FakeNode | null { for (let a = this.parentElement; a; a = a.parentElement) if (a.cs.position !== 'static' || !a.parentElement) return a; return null; }
  getBoundingClientRect() {
    const b = this.layout;
    let left = b.left, top = b.top, width = b.width, height = b.height;
    for (let a: FakeNode | null = this; a; a = a.parentElement) {
      if (!a.cls.has('spl-fit-scaled')) continue;
      // An ancestor's (or its own) transform: translateX(x) scale(s), origin top-left
      const s = parseFloat(a.vars['--spl-fit-s'] ?? '1'), x = parseFloat(a.vars['--spl-fit-x'] ?? '0'), o = a.layout;
      left = o.left + x + (left - o.left) * s; top = o.top + (top - o.top) * s; width *= s; height *= s;
    }
    return { left, top, width, height, right: left + width, bottom: top + height, x: left, y: top };
  }
  getClientRects() { return this.shown ? [this.getBoundingClientRect()] : []; }
  matches(sel: string) { return sel.split(',').some(s => matchComplex(this, s)); }
  closest(sel: string) { for (let a: FakeNode | null = this; a; a = a.parentElement) if (a.matches(sel)) return a; return null; }
  all(): FakeNode[] { return this.kids.flatMap(k => [k, ...k.all()]); }
  querySelectorAll(sel: string) { return this.all().filter(n => n.matches(sel)); }
  querySelector(sel: string) { return this.querySelectorAll(sel)[0] ?? null; }
  contains(n: FakeNode | null) { for (let a = n; a; a = a.parentElement) if (a === this) return true; return false; }
  appendChild(n: FakeNode) { n.parentElement?.removeChild(n); n.parentElement = this; this.kids.push(n); return n; }
  removeChild(n: FakeNode) { this.kids = this.kids.filter(k => k !== n); n.parentElement = null; return n; }
  insertBefore(n: FakeNode, ref: FakeNode | null) { n.parentElement = this; const i = ref ? this.kids.indexOf(ref) : -1; if (i < 0) this.kids.push(n); else this.kids.splice(i, 0, n); return n; }
  setAttribute(k: string, v: string) { this.attrs[k] = String(v); }
  getAttribute(k: string) { return this.attrs[k] ?? null; }
  removeAttribute(k: string) { delete this.attrs[k]; }
  addEventListener(type: string, fn: (e: any) => void) { (this.listeners[type] ||= []).push(fn); }
  fire(type: string, e: any = {}) { for (const fn of this.listeners[type] ?? []) fn({ stopPropagation() {}, preventDefault() {}, ...e }); }
  cloneNode(deep: boolean): FakeNode {
    const c = new FakeNode(this.tagName.toLowerCase(), { box: { ...this.box }, cs: { ...this.cs }, text: this.text, attrs: { ...this.attrs } });
    c.cls = new Set(this.cls); Object.assign(c.vars, this.vars);
    if (deep) for (const k of this.kids) c.appendChild(k.cloneNode(true));
    return c;
  }
}
const node = (tag: string, opts: ConstructorParameters<typeof FakeNode>[1] = {}, kids: FakeNode[] = []) => { const n = new FakeNode(tag, opts); kids.forEach(k => n.appendChild(k)); return n; };

/** Storage Manager's overview at 360 px: a disk bay drawn 358 px wide in a card with 264 px for it */
function bayCard(bayWidth = 358) {
  const slots = [0, 1, 2, 3].map(i => node('div', { cls: 'slot', box: { left: 92 + i * 66, top: 464, width: 60, height: 20 }, text: String(i + 1) }));
  const machine = node('div', { cls: 'machine', box: { left: 62, top: 422, width: bayWidth - 40, height: 64 }, cs: { position: 'relative', backgroundImage: 'url("rack.png")' } }, slots);
  const bay = node('div', { cls: 'bay', box: { left: 62, top: 398, width: bayWidth, height: 112 }, cs: { display: 'inline-block', marginRight: '0px', marginBottom: '0px' } }, [node('div', { box: { left: 62, top: 398, width: bayWidth, height: 20 }, text: 'Model' }), machine]);
  const card = node('div', { cls: 'card', box: { left: 34, top: 384, width: 292, height: 140 }, cs: { paddingLeft: '14px', paddingRight: '14px' } }, [bay]);
  return { card, bay, machine, slots };
}
/** A pool header: title and description in flow, the capacity drawn at a desktop column over them */
function poolHeader() {
  const title = node('span', { cls: 'item-title', box: { left: 88, top: 65, width: 61, height: 48 }, text: 'Storage Pool 1' });
  const desc = node('span', { cls: 'item-desc', box: { left: 153, top: 77, width: 155, height: 24 }, text: '- RAID Type: Basic' });
  const cap = node('div', { cls: 'pool-total-capacity', box: { left: 143, top: 65, width: 167, height: 24 }, cs: { position: 'absolute' } },
    [node('span', { box: { left: 143, top: 69, width: 81, height: 17 }, text: '3.6 TB used' }), node('span', { box: { left: 235, top: 69, width: 75, height: 17 }, text: '0 Bytes free' })]);
  cap.moved = { left: 88, top: 139, width: 220, height: 24 };
  const toggle = node('div', { cls: 'item-toggle', box: { left: 256, top: 64, width: 24, height: 24 }, cs: { position: 'absolute' }, attrs: { role: 'button' } });
  const summary = node('div', { cls: 'item-summary', box: { left: 16, top: 52, width: 328, height: 75 }, cs: { position: 'relative' } }, [
    node('div', { cls: 'title-wrapper', box: { left: 88, top: 52, width: 220, height: 61 }, cs: { display: 'flex' } }, [title, desc]),
    node('div', { box: { left: 88, top: 139, width: 220, height: 0 } }, [toggle]),
    node('div', { box: { left: 88, top: 139, width: 220, height: 0 } }, [cap]),
  ]);
  return { summary, title, desc, cap, toggle };
}
/** Volume header: a usage bar and its text, both at the desktop column, over the title */
function volumeHeader() {
  const title = node('span', { cls: 'item-title', box: { left: 138, top: 486, width: 40, height: 48 }, text: 'Volume 1' });
  const bar = node('div', { cls: 'sm-usage-bg', box: { left: 143, top: 494, width: 200, height: 8 }, cs: { position: 'absolute' } });
  const usage = node('div', { cls: 'sm-usage', box: { left: 143, top: 510, width: 200, height: 24 }, cs: { position: 'absolute' }, text: '21.1 GB | 3.5 TB free' });
  const summary = node('div', { cls: 'item-summary', box: { left: 16, top: 473, width: 328, height: 75 }, cs: { position: 'relative' } }, [
    node('div', { box: { left: 138, top: 473, width: 200, height: 61 }, cs: { display: 'flex' } }, [title]),
    node('div', { cls: 'sm-usage-wrapper', box: { left: 138, top: 548, width: 200, height: 0 } }, [bar, usage]),
  ]);
  return { summary, title, bar, usage };
}
/** A single-App page whose App window holds `content`; the content rules have run */
function contentPage(content: FakeNode[], opts: Opts = {}) {
  return contentPageOn(dsmPage({ app: 'SYNO.SDS.StorageManager.Instance', ...opts }), content);
}
function contentPageOn(d: ReturnType<typeof dsmPage>, content: FakeNode[]) {
  const ctx = d.p.ctx;
  const base = ctx.getComputedStyle;
  ctx.getComputedStyle = (n: any) => n instanceof FakeNode
    ? { paddingLeft: '0', paddingRight: '0', marginRight: '0px', marginBottom: '0px', overflowX: 'visible', overflowY: 'visible', backgroundImage: 'none', visibility: 'visible', zIndex: n.style.zIndex ?? '', ...n.cs }
    : base(n);
  const body = node('body'); body.connected = true;
  Object.assign(ctx.document, {
    body, createElement: (tag: string) => new FakeNode(tag), createElementNS: (_ns: string, tag: string) => new FakeNode(tag),
    // Hit test: the deepest shown App node under the point (the fit's own layer is on top in a browser, and the fit skips it)
    elementsFromPoint: (x: number, y: number) => root.all().filter(n => { const r = n.getBoundingClientRect(); return n.shown && x >= r.left && x < r.right && y >= r.top && y < r.bottom; }).reverse().concat([root]),
  });
  ctx.document.getElementById = (id: string) => id === 'sds-desktop' ? d.desk : null;
  const takes: number[] = [];
  const Observer = ctx.MutationObserver;
  ctx.MutationObserver = class extends Observer { takeRecords() { takes.push(1); return []; } };
  d.p.run(fitJs()); d.defineDsm(); d.start();
  const win = d.extWindow({ root: true });
  const root = node('div', { cls: 'x-window', box: { left: 0, top: 0, width: ctx.innerWidth, height: 800 } }, content);
  root.style.zIndex = '10'; root.connected = true;
  win.el.dom = root;
  d.changed(); d.p.advance(400);
  return { d, root, body, win, takes, layer: () => body.kids.find(k => k.cls.has('spl-fit-layer')), viewer: () => body.kids.find(k => k.cls.has('spl-fit-viewer')) };
}

test('oversized graphic: scaled with transform to fit its box, centered, its footprint shrunk with it', () => {
  const { card, bay } = bayCard();
  const { d } = contentPage([card]);
  assert.ok(bay.cls.has('spl-fit-scaled'));
  const s = parseFloat(bay.vars['--spl-fit-s']);
  assert.equal(s, Math.floor(264 / 358 * 1000) / 1000);
  const r = bay.getBoundingClientRect();
  assert.ok(r.left >= 48 - 0.5 && r.right <= 312 + 0.5, `inside the card's content box: ${r.left}..${r.right}`);
  // The layout footprint is the visual size: nothing below overlaps, no gap is left
  assert.ok(Math.abs(358 + parseFloat(bay.vars['--spl-fit-mr']) - r.width) <= 1);
  assert.ok(Math.abs(112 + parseFloat(bay.vars['--spl-fit-mb']) - r.height) <= 1);
  const css = readFileSync('src/core/webview/mobile-fit/dsm-fit.css', 'utf8');
  assert.match(css, /\.spl-fit-scaled \{[^}]*transform: translateX\(var\(--spl-fit-x, 0px\)\) scale\(var\(--spl-fit-s, 1\)\) !important; transform-origin: 0 0 !important;[^}]*margin-right: var\(--spl-fit-mr[^}]*margin-bottom: var\(--spl-fit-mb/);
  assert.equal(d.steps, 0, 'scaling adds no back step');
});

test('oversized graphic: below half size it keeps its size and its box scrolls sideways', () => {
  const { card, bay } = bayCard(800);
  const { layer } = contentPage([card]);
  assert.equal(bay.cls.has('spl-fit-scaled'), false);
  assert.ok(card.cls.has('spl-fit-pan'));
  assert.equal(layer()?.kids.length, 1, 'still expandable');
  assert.match(readFileSync('src/core/webview/mobile-fit/dsm-fit.css', 'utf8'), /\.spl-fit-pan \{ overflow-x: auto !important;/);
});

test('oversized graphic: taps land on the slot under the finger, on DSM\'s own elements', () => {
  const { card, bay, machine, slots } = bayCard();
  let picked = '';
  slots.forEach(slot => slot.addEventListener('click', () => { picked = slot.text; }));
  const { root } = contentPage([card]);
  assert.ok(bay.cls.has('spl-fit-scaled'));
  // Same nodes, same listeners, nothing cloned or moved, nothing made untappable
  assert.equal(card.kids[0], bay); assert.equal(bay.kids[1], machine); assert.deepEqual(machine.kids, slots);
  assert.equal(Object.keys(bay.style).includes('pointerEvents'), false);
  // A browser hit-tests the transformed boxes: tap the center of each slot as drawn
  for (const slot of slots) {
    const r = slot.getBoundingClientRect();
    const top = (root.all().filter(n => { const b = n.getBoundingClientRect(); const x = r.left + r.width / 2, y = r.top + r.height / 2; return n.shown && x >= b.left && x < b.right && y >= b.top && y < b.bottom; }).pop())!;
    top.fire('click');
    assert.equal(picked, slot.text);
  }
});

test('oversized graphic: the expand button opens a viewer that back closes first, and DSM\'s element is untouched', () => {
  const { card, bay } = bayCard();
  const { d, layer, viewer } = contentPage([card]);
  const button = layer()!.kids[0];
  assert.equal(button.tagName, 'BUTTON'); assert.equal(button.hidden, false);
  assert.equal(button.getAttribute('aria-label'), 'Expand'); assert.equal(button.textContent, '', 'icon only');
  assert.ok(button.kids[0].tagName === 'SVG');
  const r = bay.getBoundingClientRect();
  assert.ok(parseFloat(button.style.left) + 28 <= r.right && parseFloat(button.style.top) >= r.top, 'at the graphic\'s top-right corner');
  assert.equal(d.steps, 0);
  button.fire('click'); d.p.advance(100);
  const v = viewer()!;
  assert.ok(v); assert.equal(v.getAttribute('role'), 'dialog');
  assert.equal(d.steps, 1, 'the viewer is one back step');
  // A copy at native size, inside copies of its ancestors so the App's styles match it; not for tapping
  const copy = v.querySelector('.spl-fit-viewer-copy')!;
  assert.ok(copy && copy !== bay); assert.equal(copy.cls.has('spl-fit-scaled'), false); assert.equal(copy.vars['--spl-fit-s'], undefined);
  assert.ok(v.querySelector('.card.spl-fit-chain'), 'ancestor classes kept');
  assert.equal(v.querySelector('.spl-fit-viewer-stage')!.getAttribute('inert'), '');
  assert.equal(v.querySelector('.spl-fit-viewer-close')!.getAttribute('aria-label'), 'Close');
  assert.equal(button.hidden, true, 'the expand button hides under the viewer');
  // Back: the viewer closes, DSM's App stays as it was
  assert.equal(d.back(), true);
  assert.equal(viewer(), undefined); assert.equal(d.steps, 0);
  assert.ok(bay.cls.has('spl-fit-scaled')); assert.equal(card.kids[0], bay);
  d.p.advance(100); assert.equal(button.hidden, false);
  // The close button does the same
  button.fire('click'); d.p.advance(100); assert.ok(viewer());
  viewer()!.querySelector('.spl-fit-viewer-close')!.fire('click'); d.p.advance(100);
  assert.equal(viewer(), undefined); assert.equal(d.steps, 0);
});

test('oversized graphic: re-evaluated when the phone turns, without polling', () => {
  const { card, bay } = bayCard();
  const { d, layer } = contentPage([card]);
  assert.ok(bay.cls.has('spl-fit-scaled'));
  const turn = (width: number, cardWidth: number) => {
    Object.assign(d.p.ctx, { innerWidth: width }); d.p.ctx.screen.width = width; card.box.width = cardWidth;
    for (const l of d.p.listeners.filter(x => x.type === 'resize')) l.fn();
    d.p.advance(400);
  };
  turn(800, 700);
  assert.equal(bay.cls.has('spl-fit-scaled'), false, 'sideways it fits');
  assert.equal(bay.vars['--spl-fit-s'], undefined); assert.equal(layer()!.kids.length, 0);
  turn(360, 292);
  assert.ok(bay.cls.has('spl-fit-scaled')); assert.equal(layer()!.kids.length, 1);
  assert.equal(d.p.intervals, 0);
});

test('oversized content: rows of text, tables, toolbars and fields are never scaled', () => {
  const wide = (cls: string, kids: FakeNode[] = [], text = '') => node('div', { cls, box: { left: 20, top: 100, width: 600, height: 80 }, cs: { backgroundImage: 'url("x.png")' }, text }, kids);
  const items = [
    wide('row', [], 'a long line of text that is wider than the phone and is not a picture at all, so it must keep its size and wrap or scroll as the App made it, which is more than 160 characters'),
    wide('x-toolbar'), node('table', { box: { left: 20, top: 200, width: 600, height: 80 }, cs: { backgroundImage: 'url("x.png")' } }),
    wide('form', [node('input', { box: { left: 20, top: 300, width: 600, height: 30 } })]),
    // An icon in a narrow row: small, not a graphic to expand
    node('div', { box: { left: 0, top: 0, width: 20, height: 40 } }, [node('div', { cls: 'icon', box: { left: 10, top: 0, width: 24, height: 24 }, cs: { backgroundImage: 'url("i.png")' } })]),
    // A row with a small icon and text: the picture covers little of it
    node('div', { cls: 'usage-row', box: { left: 20, top: 400, width: 434, height: 72 } }, [node('div', { box: { left: 20, top: 400, width: 32, height: 32 }, cs: { backgroundImage: 'url("v.png")' } }), node('span', { box: { left: 60, top: 400, width: 200, height: 20 }, text: 'Volume 1' })]),
  ];
  const card = node('div', { box: { left: 0, top: 0, width: 360, height: 800 } }, items);
  const { root, layer } = contentPage([card]);
  assert.deepEqual(root.querySelectorAll('.spl-fit-scaled'), []);
  assert.equal(layer(), undefined);
});

/** Package Center's detail header at 360 px: a stylesheet height of 178 px, and the wrapped title column needs 246 */
function detailHeader({ inline = false, overflow = 'visible', below = true } = {}) {
  const icon = node('div', { cls: 'icon', box: { left: 40, top: 85, width: 128, height: 128 }, cs: { backgroundImage: 'url("icon.png")' } });
  const basic = node('div', { cls: 'basic', box: { left: 200, top: 26, width: 130, height: 246 } }, [
    node('div', { box: { left: 200, top: 26, width: 130, height: 104 }, text: 'Snapshot Replication' }),
    node('div', { cls: 'button', box: { left: 200, top: 230, width: 124, height: 28 }, attrs: { role: 'button' }, text: 'Update' }),
  ]);
  const header = node('div', { cls: 'status', box: { left: 16, top: 60, width: 308, height: 178 }, cs: { display: 'inline-flex', overflowY: overflow } }, [icon, basic]);
  header.naturalHeight = 212;
  if (inline) header.style.height = '178px';
  const shot = node('div', { cls: 'screenshot', box: { left: 16, top: below ? 246 : 320, width: 308, height: 394 }, cs: { position: 'relative', overflowX: 'hidden', overflowY: 'hidden' } });
  const wrapper = node('div', { box: { left: 16, top: 60, width: 308, height: 700 } }, [header, shot]);
  return { wrapper, header, shot };
}

test('spilled box: a stylesheet height its content outgrows grows to the content when what follows covers it', () => {
  const { wrapper, header } = detailHeader();
  const { d } = contentPage([wrapper]);
  assert.ok(header.cls.has('spl-fit-grow'));
  assert.equal(header.vars['--spl-fit-min'], '178px', 'never smaller than DSM made it');
  assert.match(readFileSync('src/core/webview/mobile-fit/dsm-fit.css', 'utf8'), /\.spl-fit-grow \{ height: auto !important; min-height: var\(--spl-fit-min, 0px\) !important; \}/);
  assert.equal(d.steps, 0);
});

test('spilled box: Ext-managed sizes, boxes that clip and spills nothing covers are left alone', () => {
  const ext = detailHeader({ inline: true }), clip = detailHeader({ overflow: 'hidden' }), free = detailHeader({ below: false });
  const { root } = contentPage([ext.wrapper, clip.wrapper, free.wrapper]);
  assert.deepEqual(root.querySelectorAll('.spl-fit-grow'), []);
});

/**
 * A usage table drawn as rows of inline blocks at 390 px (High Availability's overview): three
 * cells a row, each a stylesheet height of 28 px with a 28 px line-height. The label and the
 * values of the second row wrap onto a second line, over the row under it; those of the last
 * row wrap over the box that follows the table.
 */
function usageTable({ extSized = false } = {}) {
  const cell = (left: number, top: number, text: string, spill: boolean, value = false) => {
    const opts = { box: { left, top, width: 75, height: 28 }, cs: { display: 'inline-block' } };
    if (!value) {
      const c = node('div', { ...opts, cls: 'cell', text });
      if (spill) { c.naturalHeight = 56; c.textBox = { left, top, width: 75, height: 56 }; }
      if (extSized) c.style.height = '28px';
      return c;
    }
    const c = node('div', { ...opts, cls: 'cell value' }, [node('span', { box: { left, top, width: 75, height: spill ? 56 : 28 }, text })]);
    if (spill) c.naturalHeight = 57;
    return c;
  };
  const row = (top: number, label: string, a: string, b: string, spill: boolean) => [cell(42, top, label, spill), cell(151, top, a, spill, true), cell(261, top, b, spill, true)];
  const first = row(408, 'CPU', '3%', '12%', false), load = row(440, 'CPU load average', '0.22 / 1 min', '1.05 / 1 min', true), last = row(472, 'CPU load average', '0.26 / 15 min', '0.92 / 15 min', true);
  const table = node('div', { cls: 'table', box: { left: 42, top: 400, width: 307, height: 104 } }, [...first, ...load, ...last]);
  const after = node('div', { cls: 'after', box: { left: 42, top: 504, width: 307, height: 40 } }, [node('div', { box: { left: 42, top: 512, width: 75, height: 28 }, text: 'Memory' })]);
  const card = node('div', { box: { left: 21, top: 400, width: 349, height: 144 } }, [table, after]);
  return { card, first, load, last };
}
function usagePage(content: FakeNode[]) {
  const d = dsmPage({ app: 'SYNO.SDS.HA.Instance' });
  // Lines of text where they wrap: a text node's client rects (the fake's text box)
  d.p.ctx.document.createRange = () => { let owner: FakeNode; return { selectNodeContents(n: any) { owner = n.owner; }, getClientRects() { const b = owner.textBox ?? owner.layout; return [{ ...b, right: b.left + b.width, bottom: b.top + b.height }]; } }; };
  return contentPageOn(d, content);
}

test('spilled cell: a one-line inline cell whose text wraps over the next line of cells, or past its row, grows', () => {
  const { card, first, load, last } = usageTable();
  usagePage([card]);
  for (const c of [...load, ...last]) {
    assert.ok(c.cls.has('spl-fit-grow'), `${c.textContent} grows`);
    assert.equal(c.vars['--spl-fit-min'], '28px', 'never smaller than DSM made it');
  }
  for (const c of first) assert.equal(c.cls.has('spl-fit-grow'), false, `${c.textContent} fits its line`);
});

test('spilled cell: Ext-managed cells and spills nothing is drawn over are left alone', () => {
  const ext = usageTable({ extSized: true });
  // A cell alone on its line, its row tall enough for its two lines
  const lone = node('div', { cls: 'cell', box: { left: 42, top: 700, width: 75, height: 28 }, cs: { display: 'inline-block' }, text: 'CPU load average' });
  lone.naturalHeight = 56; lone.textBox = { left: 42, top: 700, width: 75, height: 56 };
  const beside = node('div', { cls: 'cell', box: { left: 151, top: 700, width: 75, height: 28 }, cs: { display: 'inline-block' }, text: '3%' });
  const roomy = node('div', { box: { left: 42, top: 700, width: 307, height: 64 } }, [lone, beside]);
  const { root } = usagePage([ext.card, roomy, node('div', { box: { left: 42, top: 764, width: 307, height: 40 }, text: 'Next' })]);
  assert.deepEqual(root.querySelectorAll('.cell').filter(c => c.cls.has('spl-fit-grow')).map(c => c.textContent), ['0.22 / 1 min', '1.05 / 1 min', '0.26 / 15 min', '0.92 / 15 min'],
    'only the value cells, which Ext did not size, grow');
});

test('oversized graphic: an image wider than the carousel box that clips it is scaled to the box', () => {
  const img = node('img', { box: { left: 16, top: 70, width: 600, height: 360 }, cs: { marginRight: '0px', marginBottom: '21px' } });
  const carousel = node('div', { cls: 'carousel', box: { left: 16, top: 60, width: 308, height: 394 }, cs: { position: 'relative', overflowX: 'hidden', overflowY: 'hidden' } }, [img]);
  const { layer } = contentPage([carousel]);
  assert.ok(img.cls.has('spl-fit-scaled'));
  assert.equal(parseFloat(img.vars['--spl-fit-s']), Math.floor(308 / 600 * 1000) / 1000);
  const r = img.getBoundingClientRect();
  assert.ok(r.left >= 16 - 0.5 && r.right <= 324 + 0.5, `inside the carousel: ${r.left}..${r.right}`);
  assert.equal(layer()?.kids.length, 1, 'expandable to full size');
});

test('a hidden App window keeps out of the page\'s scroll width', () => {
  const css = readFileSync('src/core/webview/mobile-fit/dsm-fit.css', 'utf8');
  assert.match(css, /html\.spl-fit:not\(#spl-fit-id\) \.sds-standalone-desktop > \.x-window\[style\*="visibility: hidden"\] \{ position: fixed !important; \}/);
});

test('overlapping text: desktop-column text over a header\'s title moves onto its own line, buttons stay', () => {
  const pool = poolHeader(), volume = volumeHeader();
  const { d } = contentPage([pool.summary, volume.summary]);
  assert.ok(pool.cap.cls.has('spl-fit-reflow')); assert.ok(pool.summary.cls.has('spl-fit-reflow-grow'));
  assert.equal(pool.toggle.cls.has('spl-fit-reflow'), false, 'a button over the title is not text');
  assert.equal(pool.title.cls.has('spl-fit-reflow') || pool.desc.cls.has('spl-fit-reflow'), false, 'text in flow stays');
  // The usage bar drawn with the text moves with it
  assert.ok(volume.usage.cls.has('spl-fit-reflow')); assert.ok(volume.bar.cls.has('spl-fit-reflow'));
  const css = readFileSync('src/core/webview/mobile-fit/dsm-fit.css', 'utf8');
  assert.match(css, /\.spl-fit-reflow \{\s*position: static !important; left: auto !important; top: auto !important;/);
  assert.match(css, /\.spl-fit-reflow-grow \{ height: auto !important; \}/);
  assert.equal(d.steps, 0);
});

test('overlapping text: only short text in a header row; Ext layouts, tall panels and text that does not overlap are left alone', () => {
  const free = poolHeader(); free.cap.box = { left: 200, top: 120, width: 100, height: 20 }; // below the title: no overlap
  const ext = poolHeader(); ext.cap.parentElement!.cls.add('x-box-inner');
  const tall = poolHeader(); tall.summary.box.height = 400;
  const long = poolHeader(); long.cap.kids[0].text = 'x'.repeat(200);
  const { root } = contentPage([free.summary, ext.summary, tall.summary, long.summary]);
  assert.deepEqual(root.querySelectorAll('.spl-fit-reflow'), []);
});

test('overlapping text: no loop when the page keeps rewriting inline styles or takes the class back', () => {
  const pool = poolHeader();
  const { d, takes } = contentPage([pool.summary]);
  assert.ok(pool.cap.cls.has('spl-fit-reflow'));
  const adds = pool.cap.classAdds, removes = pool.cap.classRemoves, passes = takes.length;
  // DSM recalculates its column and writes it inline, again and again
  for (let i = 0; i < 100; i++) { pool.cap.attrs.style = `left: ${120 + i}px`; d.changed(); d.p.advance(300); }
  assert.ok(pool.cap.cls.has('spl-fit-reflow'));
  assert.equal(pool.cap.classAdds, adds, 'no flicker: the class is never taken off and put back');
  assert.equal(pool.cap.classRemoves, removes);
  assert.ok(takes.length - passes <= 41, `passes are capped (${takes.length - passes})`);
  // A page that takes the class off every time: put back a few times, then left to the page
  const fresh = poolHeader();
  const second = contentPage([fresh.summary]);
  for (let i = 0; i < 30; i++) { fresh.cap.cls.delete('spl-fit-reflow'); second.d.changed(); second.d.p.advance(300); }
  assert.ok(fresh.cap.classAdds <= 6, `re-added ${fresh.cap.classAdds} times`);
  // A tap starts a new budget
  for (const l of d.p.listeners.filter(x => x.type === 'click' && x.capture)) l.fn();
  d.p.advance(300);
  assert.ok(pool.cap.cls.has('spl-fit-reflow'));
});

test('overlapping text: content re-rendered after a burst of changes is fitted again once the page is quiet, without a tap', () => {
  const pool = poolHeader();
  const { d, takes } = contentPage([pool.summary]);
  assert.ok(pool.cap.cls.has('spl-fit-reflow'));
  // A slow NAS fills in a list: status updates in a burst use up the passes
  for (let i = 0; i < 60; i++) { d.changed(); d.p.advance(30); }
  // Then DSM draws the rows again, without the fit's class, and goes quiet
  pool.cap.cls.delete('spl-fit-reflow');
  d.changed();
  d.p.advance(1000);
  const passes = takes.length;
  d.p.advance(2000);
  assert.ok(pool.cap.cls.has('spl-fit-reflow'), 'fitted again once quiet');
  assert.ok(takes.length - passes <= 2, `one pass, not a loop (${takes.length - passes})`);
  // A page that keeps rewriting itself waits longer each time: no steady passes
  const before = takes.length;
  for (let i = 0; i < 40; i++) { d.changed(); d.p.advance(1000); }
  assert.ok(takes.length - before <= 45, `passes stay capped (${takes.length - before})`);
});

/** A package list row: its name and its button side by side in a flex row, the button past the phone's edge */
function packageRow(top = 100) {
  const name = node('div', { box: { left: 16, top, width: 300, height: 40 }, text: 'Container Manager' });
  const button = node('button', { box: { left: 316, top, width: 80, height: 32 }, text: 'Update' });
  return node('div', { cls: 'item', box: { left: 16, top, width: 344, height: 40 }, cs: { display: 'flex', flexDirection: 'row', flexWrap: 'nowrap' } }, [name, button]);
}

test('flex rows past their edge wrap, and rows the page draws again wrap before they are painted', () => {
  const first = packageRow();
  const list = node('div', { cls: 'list', box: { left: 0, top: 0, width: 360, height: 400 } }, [first]);
  const { d } = contentPage([list], { width: 360 });
  assert.ok(first.cls.has('spl-fit-wrap'));
  // A status refresh draws the row again, without the class: wrapped in the
  // mutation callback itself, with no timer in between
  list.removeChild(first);
  const again = packageRow();
  list.appendChild(again);
  d.inserted([again]);
  assert.ok(again.cls.has('spl-fit-wrap'), 'wrapped at once');
  // A row that fits is left alone
  const fits = packageRow(200);
  fits.kids[0].box.width = 200; fits.kids[1].box.left = 216;
  list.appendChild(fits);
  d.inserted([fits]);
  assert.ok(!fits.cls.has('spl-fit-wrap'));
});

test('DSM\'s own scroller (fleXcroll) stuck at a zero-high or too-wide box gets the scroller\'s size back and measures again', () => {
  const stuck = node('div', { cls: 'mcontentwrapper', box: { left: 0, top: 0, width: 300, height: 0 } });
  const scroller = node('div', { cls: 'x-grid3-scroller flexcrollactive', box: { left: 0, top: 0, width: 300, height: 400 } }, [stuck]);
  const fine = node('div', { cls: 'mcontentwrapper', box: { left: 0, top: 0, width: 300, height: 200 } });
  const other = node('div', { cls: 'flexcrollactive', box: { left: 0, top: 400, width: 300, height: 200 } }, [fine]);
  let measured = 0;
  (scroller as any).fleXcroll = { updateScrollBars: () => { measured++; } };
  (other as any).fleXcroll = { updateScrollBars: () => { measured += 100; } };
  contentPage([scroller, other], { width: 360 });
  assert.equal(stuck.style.height, '400px');
  assert.ok(measured % 100 >= 1, 'the stuck one measures again');
  assert.equal(fine.style.height, undefined, 'a measured box is left alone');
  // A box measured before a side panel squeezed the grid: as wide as the scroller again
  const wideBox = node('div', { cls: 'mcontentwrapper', box: { left: 0, top: 0, width: 361, height: 446 } });
  // Its scroll bar box, measured at zero height: it stops measuring at all
  const bars = node('div', { cls: 'scrollwrapper', box: { left: 0, top: 0, width: 361, height: 0 } });
  const squeezed = node('div', { cls: 'x-grid3-scroller flexcrollactive', box: { left: 0, top: 0, width: 155, height: 491 } }, [wideBox, bars]);
  let again = 0;
  (squeezed as any).fleXcroll = { updateScrollBars: () => { again++; } };
  contentPage([squeezed], { width: 360 });
  assert.equal(wideBox.style.width, '155px');
  assert.equal(wideBox.style.height, '491px', 'short of the scroller by more than a scroll bar: its height too');
  assert.equal(bars.style.width, '155px');
  assert.equal(bars.style.height, '491px');
  assert.ok(again >= 1, 'and it measures again');
  // A content box measured smaller than its scroller (the page laid out beside a side menu that
  // then moved aside): a few rows over an empty list. It gets the scroller's size back; a box
  // short of it by a scroll bar only is measured right and left alone.
  const small = node('div', { cls: 'mcontentwrapper', box: { left: 0, top: 0, width: 120, height: 100 } });
  const wide = node('div', { cls: 'x-grid3-scroller flexcrollactive', box: { left: 0, top: 0, width: 360, height: 600 } }, [small]);
  const barred = node('div', { cls: 'mcontentwrapper', box: { left: 0, top: 0, width: 346, height: 586 } });
  const right = node('div', { cls: 'flexcrollactive', box: { left: 0, top: 600, width: 360, height: 600 } }, [barred]);
  let remeasured = 0;
  (wide as any).fleXcroll = { updateScrollBars: () => { remeasured++; } };
  (right as any).fleXcroll = { updateScrollBars: () => { remeasured += 100; } };
  contentPage([wide, right], { width: 360 });
  assert.equal(small.style.width, '360px'); assert.equal(small.style.height, '600px');
  assert.equal(barred.style.width, undefined); assert.equal(barred.style.height, undefined);
  assert.ok(remeasured >= 1 && remeasured < 100);
});

test('oversized content: outside single-App mode (no launched App, a tablet) nothing is touched', () => {
  for (const opts of [{ launch: false }, { width: 800 }] as const) {
    const { card, bay } = bayCard(), pool = poolHeader();
    const d = dsmPage({ app: 'SYNO.SDS.StorageManager.Instance', width: 'width' in opts ? opts.width : 393 });
    if ('launch' in opts) d.p.ctx.location.search = '';
    const body = node('body'); body.connected = true; d.p.ctx.document.body = body;
    d.p.run(fitJs()); d.defineDsm(); d.start();
    const win = d.extWindow({ root: true });
    const root = node('div', { box: { left: 0, top: 0, width: 360, height: 800 } }, [card, pool.summary]); root.connected = true;
    win.el.dom = root; d.changed(); d.p.advance(1000);
    assert.equal(bay.cls.has('spl-fit-scaled'), false); assert.equal(card.cls.has('spl-fit-pan'), false);
    assert.equal(pool.cap.cls.has('spl-fit-reflow'), false); assert.equal(body.kids.length, 0);
  }
});

test('overlapping text: text cut off by an ellipsis only counts where it shows', () => {
  for (const overflow of ['hidden', 'visible']) {
    // HDD/SSD: "Drive 1 - H…" ends before the capacity column; its full text would run under it
    const title = node('span', { cls: 'item-title', box: { left: 80, top: 61, width: 40, height: 20 }, text: 'Drive 1' });
    const desc = node('span', { cls: 'item-desc', box: { left: 120, top: 61, width: 40, height: 20 }, cs: { overflowX: overflow }, text: '- HGST HDN724040ALE640 (HDD)' });
    desc.textBox = { left: 120, top: 63, width: 210, height: 17 };
    const cap = node('div', { cls: 'disk-total-capacity', box: { left: 165, top: 61, width: 39, height: 20 }, cs: { position: 'absolute' }, text: '3.6 TB' });
    const summary = node('div', { cls: 'item-summary', box: { left: 0, top: 49, width: 360, height: 50 }, cs: { position: 'relative' } }, [
      node('div', { cls: 'title-wrapper', box: { left: 80, top: 61, width: 80, height: 20 }, cs: { display: 'flex' } }, [title, desc]), cap]);
    const d = dsmPage({ app: 'SYNO.SDS.StorageManager.Instance' });
    d.p.ctx.document.createRange = () => { let owner: FakeNode; return { selectNodeContents(n: any) { owner = n.owner; }, getClientRects() { const b = owner.textBox ?? owner.layout; return [{ ...b, right: b.left + b.width, bottom: b.top + b.height }]; } }; };
    const page = contentPageOn(d, [summary]);
    assert.equal(cap.cls.has('spl-fit-reflow'), overflow === 'visible', overflow); void page;
  }
});

// ---- Keep a readable width ----------------------------------------------------
// Hyper Backup's task page at 360 px: two cards side by side, each a column of
// labels and a column of values, cut to "共用…" "239.2…". A fake Ext layout
// lays the cards out at whatever width the host's layout reports.
type CardsOpts = { vw?: number; label?: number; value?: number; declared?: number; nav?: boolean; tall?: boolean };
function cardsApp({ vw = 360, label = 80, value = 100, declared = 1000, nav = false, tall = false }: CardsOpts = {}) {
  const leaves: { node: FakeNode; cell: FakeNode; col: 'label' | 'value'; card: number; row: number; natural: number }[] = [];
  const cards = [0, 1].map(card => node('div', { cls: 'card', box: { left: 0, top: 0, width: 0, height: 400 } }, [0, 1, 2, 3, 4].flatMap(row => (['label', 'value'] as const).map(col => {
    const n = node('div', { cls: col, cs: { overflowX: 'hidden' }, text: col === 'label' ? '共用資料夾:' : '239.2 MB' });
    const natural = col === 'label' ? label : value;
    n.naturalWidth = natural;
    // A row one line high that hides what does not fit (Resource Monitor's values under a chart)
    const cell = node('div', { cls: 'cell', cs: tall ? { overflowY: 'hidden' } : {} }, [n]);
    leaves.push({ node: n, cell, col, card, row, natural });
    return cell;
  }))));
  const content = node('div', { cls: 'cards', box: { left: 0, top: 0, width: vw, height: 400 } }, cards);
  const body = node('div', { cls: 'x-window-body', box: { left: 0, top: 40, width: vw, height: 700 } }, [content]);
  const header = node('div', { cls: 'x-window-header', box: { left: 0, top: 0, width: vw, height: 40 }, text: 'Hyper Backup' });
  const footer = node('div', { cls: 'x-window-footer', box: { left: 0, top: 740, width: vw, height: 40 } }, [node('button', { text: 'OK', box: { left: 300, top: 740, width: 50, height: 30 } })]);
  const d = dsmPage({ app: 'SYNO.SDS.Backup.Application', width: vw });
  const page = contentPageOn(d, [header, body, footer]);
  const { win } = page;
  let layouts = 0;
  /** The App's layout: each card gets half the width, labels 40% of a card and values 60% */
  const lay = (w: number) => {
    layouts++;
    content.box.width = w;
    const card = w / 2 - 30;
    cards.forEach((c, i) => { c.box = { left: i * (w / 2), top: 40, width: card, height: 400 }; });
    for (const l of leaves) {
      const width = l.col === 'label' ? card * 0.4 : card * 0.6, left = l.card * (w / 2) + (l.col === 'label' ? 0 : card * 0.4);
      l.node.box = { left, top: 60 + l.row * 30, width, height: 20 };
      l.cell.box = { ...l.node.box };
      // Too narrow, the text wraps onto a second line its row cuts off
      if (tall) { l.node.box.height = l.natural > width + 1 ? 40 : 20; l.node.naturalWidth = 0; }
    }
  };
  const host: any = nav ? { rendered: true, region: 'center' } : win;
  host.layout = { getLayoutTargetSize: () => ({ width: vw, height: 700 }) };
  host.getLayoutTarget = () => ({ dom: body });
  host.doLayout = () => lay(host.layout.getLayoutTargetSize().width);
  if (nav) win.splSplit = { ct: { items: { each: (fn: (i: unknown) => void) => [{ region: 'west' }, host].forEach(fn) } } };
  win.initialConfig = { width: declared - 10 }; win.splMinWidth = declared;
  lay(vw);
  const pass = () => { d.changed(); d.p.advance(400); };
  const clipped = () => leaves.filter(l => l.node.naturalWidth! > l.node.box.width + 1 || l.node.box.height > 20).length;
  return { ...page, d, host, body, header, footer, content, leaves, pass, clipped, get layouts() { return layouts; } };
}

test('keep a readable width: squeezed side-by-side cards keep the narrowest width that shows their texts, and scroll sideways', () => {
  const app = cardsApp();
  assert.equal(app.clipped(), 20, 'at 360 px every label and value is cut off');
  app.pass();
  // Labels need 80 px at 40% of a card: cards of 200 px, a width of 460 px (20 px steps)
  assert.ok(app.host.splNeed >= 460 && app.host.splNeed <= 480, `need ${app.host.splNeed}`);
  assert.equal(app.clipped(), 0);
  assert.equal(app.host.layout.getLayoutTargetSize().width, app.host.splNeed, 'the App lays out its content at that width');
  assert.ok(app.body.cls.has('spl-fit-wide'), 'its body is the sideways scroller');
  // A body that did not scroll up and down still does not: no vertical scrollbar from scrolling sideways
  assert.equal(app.body.vars['overflow-y'], 'hidden');
  // Title and footer buttons are outside the scroller: they stay on screen
  assert.ok(!app.body.contains(app.header) && !app.body.contains(app.footer));
  // Never wider than the App declared
  assert.ok(app.host.splNeed <= 1000);
  const css = readFileSync('src/core/webview/mobile-fit/dsm-fit.css', 'utf8');
  assert.match(css, /\.spl-fit-wide \{ overflow-x: auto !important;/);
});

test('keep a readable width: a page that fits the phone (short texts, a form with labels above) is left as it is', () => {
  const app = cardsApp({ label: 40, value: 50 });
  const before = app.layouts;
  app.pass();
  assert.equal(app.clipped(), 0);
  assert.ok(!app.host.splNeed, 'no width kept');
  assert.ok(!app.body.cls.has('spl-fit-wide'));
  assert.equal(app.layouts, before, 'not even laid out again');
});

test('keep a readable width: one cut-off text is not a squeezed page', () => {
  // A single long value (a path) stays cut off with an ellipsis, as on the desktop
  const app = cardsApp({ label: 40, value: 50 });
  app.leaves[1].node.naturalWidth = 400;
  app.pass();
  assert.ok(!app.host.splNeed);
});

test('keep a readable width: nothing is widened when the App\'s own width would not show more', () => {
  // Values that are cut off even at the width the App declared (long paths)
  const app = cardsApp({ label: 40, value: 2000 });
  app.pass();
  assert.ok(!app.host.splNeed, `need ${app.host.splNeed}`);
  assert.ok(!app.body.cls.has('spl-fit-wide'));
});

test('keep a readable width: text wrapped onto a line its box cuts off counts as cut off', () => {
  // Resource Monitor: three charts side by side, each value under its chart wraps and loses its second line
  const app = cardsApp({ tall: true });
  assert.ok(app.clipped() > 2);
  app.pass();
  assert.ok(app.host.splNeed > 360);
  assert.equal(app.clipped(), 0);
});

test('keep a readable width: next to a side menu only the content scrolls; the menu and the window frame stay', () => {
  const app = cardsApp({ nav: true });
  app.pass();
  assert.notEqual(app.host, app.win);
  assert.ok(app.host.splNeed >= 460, 'the center next to the menu is the content host');
  assert.ok(!app.win.splNeed, 'the window itself keeps the screen width');
  assert.ok(app.body.cls.has('spl-fit-wide'));
});

test('keep a readable width: decided again when the content changes, never in a loop, and dropped sideways', () => {
  const app = cardsApp();
  app.pass();
  const need = app.host.splNeed, layouts = app.layouts;
  // The page rewrites itself (a progress update) with the same texts: nothing to decide
  app.pass(); app.pass();
  assert.equal(app.layouts, layouts);
  assert.equal(app.host.splNeed, need);
  // Data loads: longer labels need more room
  for (const l of app.leaves) if (l.col === 'label') l.node.naturalWidth = 120;
  app.host.doLayout();
  app.pass();
  assert.ok(app.host.splNeed > need, `${app.host.splNeed} > ${need}`);
  assert.equal(app.clipped(), 0);
  // Sideways the App has room: DSM's own layout again
  app.d.p.ctx.innerWidth = 800; app.d.p.ctx.screen.width = 800;
  app.win.fire?.('resize');
  for (const l of app.d.p.listeners.filter(x => x.type === 'resize')) l.fn();
  app.d.p.advance(400); app.pass();
  assert.ok(!app.host.splNeed);
  assert.ok(!app.body.cls.has('spl-fit-wide'));
  assert.equal(app.body.vars['overflow-y'], undefined);
});

test('keep a readable width: content kept wide is never shrunk back to the screen by the clamp', () => {
  const p = page(), ext = fakeExt();
  const win = ext.open();
  const wide = { className: 'x-panel-body spl-fit-wide', clientWidth: 393, classList: { contains: (c: string) => c === 'spl-fit-wide' } };
  const narrowParent = { className: 'x-panel-body', clientWidth: 393, classList: { contains: () => false } };
  const kept = { rendered: true, el: { dom: { offsetWidth: 480, className: 'x-panel', parentNode: wide } }, widths: [] as number[], setWidth(w: number) { this.widths.push(w); } };
  const other = { rendered: true, el: { dom: { offsetWidth: 480, className: 'x-panel', parentNode: narrowParent } }, widths: [] as number[], setWidth(w: number) { this.widths.push(w); } };
  win.cascade = (fn: (c: unknown) => void) => [win, kept, other].forEach(fn);
  p.ctx.Ext = ext.full;
  p.run(fitJs());
  p.advance(1000);
  assert.deepEqual(kept.widths, [], 'inside the scroller: kept');
  assert.deepEqual(other.widths, [393], 'elsewhere: clamped as before');
});

test('keep a readable width: a Vue App window squeezed by DSM\'s own narrow layout gets wider, and the page area scrolls', () => {
  // Container Manager's overview: a status card squeezed to one character per line next to the images card
  const vw = 360;
  const texts = [0, 1, 2, 3].map(i => { const n = node('div', { cls: 'row-text', cs: { overflowX: 'hidden' }, text: '容器 ' + i }); n.naturalWidth = 120; return n; });
  const card = node('div', { cls: 'status' }, texts);
  const body = node('div', { cls: 'v-window-body', box: { left: 0, top: 40, width: vw, height: 700 } }, [card]);
  const $el = node('div', { cls: 'v-window', box: { left: 0, top: 0, width: vw, height: 800 } }, [body]);
  const desk = node('div', { cls: 'sds-desktop', box: { left: 0, top: 0, width: vw, height: 800 } }, [$el]);
  // DSM lays the window out from its own width
  const lay = () => {
    const w = parseFloat($el.vars['width'] ?? '0') || vw;
    $el.box.width = w; body.box.width = w;
    // The status card gets a quarter of the row
    card.box = { left: 0, top: 60, width: w / 4, height: 300 };
    texts.forEach((t, i) => { t.box = { left: 0, top: 60 + i * 30, width: w / 4, height: 20 }; });
  };
  const setProperty = $el.style.setProperty, removeProperty = $el.style.removeProperty;
  $el.style.setProperty = (k: string, v: string) => { setProperty(k, v); lay(); };
  $el.style.removeProperty = (k: string) => { removeProperty(k); lay(); };
  lay();
  const d = dsmPage({ app: 'SYNO.SDS.ContainerManager.Application' });
  const { root } = contentPageOn(d, []);
  const c = d.vueWindow({ title: 'Container Manager', id: 'SYNO.SDS.ContainerManager.Application', root: true, name: 'AppWindow' });
  // DSM declares it as a string
  c.minWidth = '1200'; c.width = 300;
  $el.style.zIndex = '20'; desk.connected = true;
  c.$el = $el;
  d.changed(); d.p.advance(400); d.changed(); d.p.advance(400);
  assert.ok($el.cls.has('spl-single-app'));
  const need = parseFloat($el.vars['width']);
  // 120 px texts in a quarter of the row: 480 px
  assert.ok(need >= 480 && need <= 500, `width ${need}`);
  assert.ok(desk.cls.has('spl-fit-wide'));
  assert.equal($el.cls.has('spl-fit-wide'), false);
  assert.equal(texts.filter(t => t.naturalWidth! > t.box.width + 1).length, 0);
  // DSM re-renders and drops the width: kept again
  $el.style.removeProperty('width');
  d.changed(); d.p.advance(400);
  assert.equal(parseFloat($el.vars['width']), need);
  // The side menu opens at the left edge
  desk.scrollLeft = 100;
  d.p.run('__splFitMenu()');
  assert.equal(desk.scrollLeft, 0);
  void root;
});

test('keep a readable width: a row crushed at the screen\'s width wraps first, and a row that wraps is no reason to widen', () => {
  // Tiering's legend: four entries squeezed into a row, each title cut to a few characters
  const vw = 360;
  const texts = [0, 1, 2, 3].map(i => { const n = node('div', { cs: { overflowX: 'hidden' }, text: 'Hot data ' + i }); n.naturalWidth = 60; return n; });
  const entries = texts.map(t => node('div', { cs: { display: 'flex' } }, [t]));
  const row = node('div', { cs: { display: 'flex', flexDirection: 'row', flexWrap: 'nowrap' } }, entries);
  const body = node('div', { cls: 'v-window-body', box: { left: 0, top: 40, width: vw, height: 700 } }, [row]);
  const $el = node('div', { cls: 'v-window', box: { left: 0, top: 0, width: vw, height: 800 } }, [body]);
  const desk = node('div', { cls: 'sds-desktop', box: { left: 0, top: 0, width: vw, height: 800 } }, [$el]);
  // Wrapped, each entry takes its width; in one line, a twelfth of the window each
  const lay = () => {
    const w = parseFloat($el.vars['width'] ?? '0') || vw, wrapped = row.cls.has('spl-fit-wrap');
    $el.box.width = w; body.box.width = w;
    row.box = { left: 0, top: 60, width: w, height: wrapped ? 60 : 30 };
    entries.forEach((e, i) => {
      const width = wrapped ? 60 : w / 12, left = wrapped ? (i % 2) * 70 : i * width, top = wrapped ? 60 + Math.floor(i / 2) * 30 : 60;
      e.box = { left, top, width, height: 20 }; texts[i].box = { left, top, width, height: 20 };
    });
  };
  const add = row.classList.add;
  row.classList.add = (c: string) => { add(c); lay(); };
  const setProperty = $el.style.setProperty, removeProperty = $el.style.removeProperty;
  $el.style.setProperty = (k: string, v: string) => { setProperty(k, v); lay(); };
  $el.style.removeProperty = (k: string) => { removeProperty(k); lay(); };
  lay();
  const d = dsmPage({ app: 'SYNO.SDS.ContainerManager.Application' });
  contentPageOn(d, []);
  const c = d.vueWindow({ title: 'Tiering', id: 'SYNO.SDS.ContainerManager.Application', root: true, name: 'AppWindow' });
  c.minWidth = '1200'; c.width = 300;
  $el.style.zIndex = '20'; desk.connected = true;
  c.$el = $el;
  d.changed(); d.p.advance(400); d.changed(); d.p.advance(400);
  assert.ok($el.cls.has('spl-single-app'));
  assert.ok(row.cls.has('spl-fit-wrap'), 'the crushed row wraps');
  assert.equal($el.vars['width'], undefined, 'not widened');
  assert.ok(!desk.cls.has('spl-fit-wide'));
});

// ---- Generic rules only -----------------------------------------------------
// The fit works from DSM's shared components, never from one App's classes:
// a rule for one App's page would have to be repeated for every other App.
test('the fit stylesheet uses only DSM\'s shared component classes, never an App\'s own', () => {
  const css = readFileSync('src/core/webview/mobile-fit/dsm-fit.css', 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
    // (Animations named with the fit's prefix hold no selectors)
    .replace(/@keyframes spl-fit-[\w-]+\s*\{(?:[^{}]*\{[^{}]*\})*\s*\}/g, '');
  const selectors = css.replace(/\{[^{}]*\}/g, '\n');
  const used = new Set([...selectors.matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)].map(m => m[1]));
  // Ext (x-), DSM's Vue components (v-), SYNO.ux (syno-ux-), DSM's window framework (sds-), the fit's own (spl-)
  const shared = /^(x|v|syno-ux|sds|spl)-/;
  // Parts of shared components that carry no prefix of their own
  const parts = new Set([
    'item-summary', 'item-icon', 'item-title', 'item-toggle', 'item-wrap', // SYNO.ux.ExpandableListView rows
    'mobile-row-card-wrapper', 'field-wrapper', 'field-align-vertical', 'mobile-label', 'mobile-value', // DSM Vue's table as cards on a phone
    'actions-wrapper', // v-card's header
    'main-wrapper', 'right-wrapper', // v-toolbar
    'module-list-layout', 'layout-module-list-panel', // DSM's Vue page-list window
    'body', 'cancel-icon', // DSM's Vue tour and dialog boxes
    'mcontentwrapper', 'contentwrapper', // DSM's own scroller (fleXcroll), in every Ext grid
    'spl-fit', // the class the script puts on <html>
  ]);
  const other = [...used].filter(c => !shared.test(c) && !parts.has(c));
  assert.deepEqual(other, [], 'An App\'s own class in dsm-fit.css: write the rule for the shared structure it uses');
  assert.ok(!/syno-(?!ux-)|synopkg|iscsi/.test(selectors), 'no App prefixes');
});

test('the fit script names no App\'s own classes either', () => {
  // syno-id is the attribute DSM's own desktop puts on every App icon, not an App's class
  assert.ok(!/['".]\.?(syno-(?!ux-|id['\]])|synopkg|iscsi)/.test(readFileSync('src/core/webview/mobile-fit/dsm-fit.js', 'utf8')));
});

/** Ext 3's box layouts as the fit sees them: a row of four 69 px cards with 10 px spacers between, 154 px high */
function cardRow({ width = 393, cards = 4, text = 'LUN 3', panel = true } = {}) {
  const p = page(), ext = fakeExt();
  class BoxLayout { onLayout() {} }
  class HBoxLayout extends BoxLayout {
    calculateChildBoxes(items: any[], size: { width: number; height: number }) {
      let left = 0;
      const boxes = items.map(c => { const w = c.gap ? 10 : 69, box = { component: c, left, top: 0, width: w, height: size.height }; left += w; return box; });
      return { boxes, meta: { maxHeight: size.height } };
    }
  }
  class VBoxLayout extends BoxLayout {}
  (ext.full as any).layout = { BoxLayout, HBoxLayout, VBoxLayout };
  p.ctx.innerWidth = width; p.ctx.screen.width = width;
  p.ctx.Ext = ext.full;
  p.run(fitJs());
  const classList = () => { const set = new Set<string>(); return { set, toggle: (c: string, on: boolean) => { if (on) set.add(c); else set.delete(c); } }; };
  const item = (gap: boolean) => Object.assign(Object.create((panel || gap ? ext.core.Panel : ext.core.BoxComponent).prototype), { gap, el: { dom: { textContent: gap ? '' : text, querySelector: () => null, querySelectorAll: () => [], classList: classList() } } });
  const items: any[] = [];
  for (let i = 0; i < cards; i++) { if (i) items.push(item(true)); items.push(item(false)); }
  const owner = { layouts: 0, doLayout() { this.layouts++; } };
  const ct: any = {
    el: { hasClass: () => false }, height: 154, ownerCt: owner,
    getHeight() { return this.height; }, getLayoutTarget: () => ({ getHeight: () => 154 }), setHeight(h: number) { this.set = h; },
  };
  const layout = Object.assign(Object.create(HBoxLayout.prototype), { container: ct, align: 'stretch', padding: { top: 0, left: 0, right: 0, bottom: 0 } });
  const lay = (w = 308) => layout.calculateChildBoxes(items, { width: w, height: 154 });
  return { p, ct, owner, items, lay };
}

/** A grid of packages: a name column and a description column whose text runs past its cell */
function packageGrid() {
  const td = (col: string, left: number, width: number, text: string, natural = 0, head = false) => {
    const inner = node('div', { cls: head ? 'x-grid3-hd-inner' : 'x-grid3-cell-inner', box: { left, top: head ? 100 : 130, width, height: head ? 30 : 40 }, text });
    if (natural) inner.naturalWidth = natural;
    return node('td', { cls: (head ? 'x-grid3-hd ' : 'x-grid3-cell ') + 'x-grid3-td-' + col, box: { left, top: head ? 100 : 130, width, height: head ? 30 : 40 } }, [inner]);
  };
  const header = node('div', { cls: 'x-grid3-header', box: { left: 0, top: 100, width: 360, height: 30 } }, [
    node('div', { cls: 'x-grid3-hd-row', box: { left: 0, top: 100, width: 360, height: 30 } }, [td('name', 0, 120, 'Name', 0, true), td('desc', 120, 240, 'Description', 0, true)]),
  ]);
  const name = td('name', 0, 120, 'Hybrid Share');
  const desc = td('desc', 120, 240, 'Keeps a shared folder in the cloud and its recent files on the NAS', 600);
  const row = node('div', { cls: 'x-grid3-row', box: { left: 0, top: 130, width: 360, height: 40 } }, [name, desc]);
  const scroller = node('div', { cls: 'x-grid3-scroller', box: { left: 0, top: 130, width: 360, height: 270 } }, [node('div', { cls: 'x-grid3-body', box: { left: 0, top: 130, width: 360, height: 40 } }, [row])]);
  const grid = node('div', { cls: 'x-grid3', box: { left: 0, top: 100, width: 360, height: 300 } }, [header, scroller]);
  return { grid, row, name, desc };
}

test('grid row details: a tapped row with cut-off cells gets a details button; its sheet lists every column, and back closes it', () => {
  const g = packageGrid();
  const page = contentPage([g.grid], { width: 360 });
  const { d, body } = page;
  const tap = (target: FakeNode) => { for (const l of d.p.listeners.filter(x => x.type === 'click' && x.capture)) (l.fn as (e: unknown) => void)({ target }); d.p.advance(100); };
  const info = () => page.layer()?.kids.find(k => k.cls.has('spl-fit-rowinfo'));
  // The row's own tap goes on to DSM as before: the fit only notes the row
  tap(g.name.kids[0]);
  assert.ok(info() && !info()!.hidden, 'a details button on the row');
  const steps = d.steps;
  info()!.fire('click');
  const sheet = body.kids.find(k => k.cls.has('spl-fit-rowsheet'));
  assert.ok(sheet, 'the sheet opens');
  const dl = sheet!.kids.find(k => k.tagName === 'DL')!;
  assert.deepEqual(dl.kids.map(k => k.textContent), ['Name', 'Hybrid Share', 'Description', 'Keeps a shared folder in the cloud and its recent files on the NAS']);
  assert.ok(info()!.hidden, 'no button over the sheet');
  d.p.advance(400);
  assert.equal(d.steps, steps + 1, 'the sheet is a back step');
  d.back();
  assert.ok(!body.kids.some(k => k.cls.has('spl-fit-rowsheet')), 'back closes the sheet');
  // A row whose cells all show gets no button
  g.desc.kids[0].naturalWidth = 0;
  tap(g.name.kids[0]);
  assert.ok(info()!.hidden);
});

// ---- Grids on a phone ---------------------------------------------------------
// One rule for every Ext grid, from its column model and its rendered cells.
// Text widths here: 8 px a character (the fit's measure without a canvas).
type Col = { id: string; head: string; values: string[]; fixed?: boolean; width?: number };
/** The colours behind a grid: its rows' and header's card, and DSM's tint for each row state */
type Paint = { row: string; head: string; tints: Record<string, string> };
function grid(cols: Col[], { width = 360, oneLine = false, screen = 393, paint, scroller }: { width?: number; oneLine?: boolean; screen?: number; paint?: Paint; scroller?: any } = {}) {
  const p = page(), ext = fakeExt();
  p.ctx.innerWidth = screen; p.ctx.screen.width = screen;
  const styles: any[] = [];
  Object.assign(p.ctx.document, { head: { appendChild: (n: any) => { styles.push(n); } }, getElementById: (id: string) => styles.find(n => n.id === id) ?? null });
  p.ctx.Ext = ext.full;
  p.run(fitJs());
  /** A cell's inner box: max-content, it is as wide as its text */
  const inner = (text: string) => {
    const e: any = { textContent: text, firstChild: text ? {} : null, style: {} as Record<string, string>, querySelector: () => null };
    Object.defineProperty(e, 'offsetWidth', { get: () => e.style.width === 'max-content' ? text.length * 8 : 0 });
    return e;
  };
  const widths = cols.map(c => c.width ?? 100), set: number[][] = [];
  const cls = new Set<string>();
  const cm = {
    config: cols.map(c => (c.fixed ? { fixed: true } : {})),
    getColumnCount: () => cols.length, isHidden: () => false, getColumnId: (i: number) => cols[i].id,
    getColumnWidth: (i: number) => widths[i], setColumnWidth(i: number, w: number) { widths[i] = w; set.push([i, w]); },
  };
  const rows = Array.from({ length: Math.max(...cols.map(c => c.values.length)) }, (_, rowIndex) => ({ rowIndex }));
  let originals = 0, syncs = 0;
  let mainBody: any = {}, mainHd: any;
  if (paint) {
    // See-through rows and header on a solid card; DSM's stylesheet tints rows by state
    const box = (bg: string, parentElement: any = null) => ({ nodeType: 1, bg, parentElement });
    const body: any = box('rgba(0, 0, 0, 0)', box('rgba(0, 0, 0, 0)', box(paint.row)));
    body.appendChild = (n: any) => { n.parentElement = body; };
    body.removeChild = (n: any) => { n.parentElement = null; };
    mainBody = { dom: body };
    mainHd = { dom: box('transparent', box(paint.head)) };
    p.ctx.getComputedStyle = (n: any) => ({ paddingLeft: '0', paddingRight: '0',
      backgroundColor: n.bg ?? (String(n.className).split(' ').map(c => paint.tints[c]).filter(Boolean).pop() || 'rgba(0, 0, 0, 0)') });
  }
  const view: any = {
    cm, mainBody, mainHd, getRows: () => rows, getScrollOffset: () => 0,
    getHeaderCell: (i: number) => ({ querySelector: () => inner(cols[i].head) }),
    getCell: (r: number, i: number) => ({ querySelector: () => inner(cols[i].values[r] ?? '') }),
    updateAllColumnWidths() {}, syncHeaderScroll() { syncs++; },
    on() {}, fitColumns() { originals++; return 'desktop'; },
  };
  if (oneLine) view.rowHeight = 28;
  if (scroller) view.scroller = { dom: scroller };
  view.grid = {
    el: { dom: { id: 'grid-1', classList: { remove: (c: string) => cls.delete(c), add: (c: string) => cls.add(c), toggle: (c: string, on: boolean) => on ? cls.add(c) : cls.delete(c) } } },
    getGridEl: () => ({ getWidth: () => width }),
  };
  ext.hooks.GridPanel.beforerender({ getView: () => view });
  // (The fit's own stylesheet goes to <head> too)
  return { fit: () => view.fitColumns(), widths, cls, get styles() { return styles.filter(n => String(n.id).startsWith('spl-fit-grid-pin-')); }, get originals() { return originals; }, get syncs() { return syncs; } };
}
const advisor = (): Col[] => [
  { id: 'status', head: 'Status', values: ['', '', ''].map(() => '!!') },
  { id: 'severity', head: 'Severity', values: ['High', 'Medium', 'Info'] },
  { id: 'event', head: 'Event', values: ['The SSH port is the default port, which is easy to guess for attackers'.slice(0, 40), 'Admin account enabled', 'Malicious commands found in your system'] },
  { id: 'updated', head: 'Last update', values: ['1 hour(s)', '2 hour(s)', '1 hour(s)'] },
];

test('grids on a phone: each column keeps its header or its usual value, and the text column takes what is left and wraps', () => {
  const g = grid(advisor());
  assert.equal(g.fit(), false, 'sized by the fit');
  assert.equal(g.originals, 0);
  // Status: its header (6 × 8 + 14); Severity: "Severity"; Last update: its value "1 hour(s)" (72 + 6)
  const [status, severity, event, updated] = g.widths;
  assert.deepEqual([status, severity, updated], [62, 78, 78]);
  assert.equal(status + severity + event + updated, 360, 'the event column takes the rest');
  assert.ok(event > 96);
  assert.ok(g.cls.has('spl-fit-gridwrap') && g.cls.has('spl-fit-gridhead'));
  assert.ok(!g.cls.has('spl-fit-hscroll'));
  assert.equal(g.styles.length, 0, 'nothing pinned');
});

test('grids on a phone: a short Chinese header keeps its characters together; a long one breaks once, in the middle', () => {
  // Active Backup's Portal: "大小" and "類型" were one character wide, "大" over "小"
  const g = grid([
    { id: 'name', head: '名稱', values: ['Documents', 'report.pdf'] },
    { id: 'size', head: '大小', values: ['', ''] },
    { id: 'type', head: '類型', values: ['', ''] },
    { id: 'mtime', head: '變更時間', values: ['', ''] },
    { id: 'long', head: '最後一次備份時間', values: ['', ''] },
  ], { width: 400 });
  g.fit();
  const [, size, type, mtime, long] = g.widths;
  // 8 px a character, plus the header's 14 px; no column is under 32 px
  assert.deepEqual([size, type, mtime, long], [32, 32, 4 * 8 + 14, 4 * 8 + 14]);
  // Too narrow for every header whole: the grid scrolls sideways instead, its first column pinned
  const narrow = grid([
    { id: 'name', head: '名稱', values: ['Documents'] },
    { id: 'size', head: '大小', values: [''] },
    { id: 'type', head: '類型', values: [''] },
    { id: 'mtime', head: '變更時間', values: [''] },
  ], { width: 120 });
  narrow.fit();
  assert.deepEqual(narrow.widths.slice(1), [32, 32, 46]);
  assert.ok(narrow.cls.has('spl-fit-hscroll'));
  assert.match(narrow.styles[0].textContent, /td-name\{position:sticky;left:0px;/);
});

test('grids on a phone: too many columns scroll sideways in the grid with the first column pinned; a check box column takes the next with it', () => {
  const cols: Col[] = [
    { id: 'name', head: 'Name', values: ['Container Manager', 'Directory Server'] },
    { id: 'version', head: 'Version', values: ['24.0.2-1707', '6.0.1-0098'] },
    { id: 'status', head: 'Status', values: ['Update available', 'Running normally'] },
    { id: 'path', head: 'Location', values: ['/volume1/@appstore/ContainerManager', '/volume1/@appstore/DirectoryServer'] },
  ];
  const g = grid(cols, { width: 300 });
  g.fit();
  assert.ok(g.cls.has('spl-fit-hscroll'));
  assert.ok(g.widths.reduce((a, b) => a + b) > 300);
  assert.match(g.styles[0].textContent, /^html\.spl-fit #grid-1 \.x-grid3-td-name\{position:sticky;left:0px;/);
  const checked = grid([{ id: 'checker', head: '', values: [], fixed: true, width: 24 }, ...cols], { width: 300 });
  checked.fit();
  assert.equal(checked.widths[0], 24, 'the check box column keeps its width');
  assert.match(checked.styles[0].textContent, /td-checker\{position:sticky;left:0px;.*td-name\{position:sticky;left:24px;/);
});

test('grids on a phone: pinned cells are solid, in the card\'s colour, with DSM\'s tint for hovered and selected rows, so nothing shows through', () => {
  const cols: Col[] = [
    { id: 'date', head: 'Date', values: ['2026-11-17', '2026-11-17'] },
    { id: 'time', head: 'Time', values: ['13:49:07', '13:48:55'] },
    { id: 'host', head: 'Host name', values: ['nas', 'nas'] },
    { id: 'msg', head: 'Message', values: ['User [admin] from [127.0.0.1] signed in to [DSM] successfully via [password].', 'System started'] },
  ];
  const paint = { row: 'rgb(255, 255, 255)', head: 'rgb(248, 249, 250)', tints: { 'x-grid3-row-over': 'rgba(5, 127, 235, 0.04)', 'x-grid3-row-selected': 'rgba(5, 127, 235, 0.1)' } };
  const g = grid(cols, { width: 200, paint });
  g.fit();
  assert.ok(g.cls.has('spl-fit-hscroll'));
  const css = g.styles[0].textContent as string;
  assert.match(css, /#grid-1 \.x-grid3-td-date\{position:sticky;left:0px;z-index:1;/);
  assert.ok(!css.includes('inherit'), 'never the see-through colour of the row');
  assert.match(css, /#grid-1 \.x-grid3-row \.x-grid3-td-date\{background-color:rgb\(255, 255, 255\);\}/);
  assert.match(css, /#grid-1 \.x-grid3-hd-row \.x-grid3-td-date\{background-color:rgb\(248, 249, 250\);z-index:2;\}/);
  assert.match(css, /\.x-grid3-row-over \.x-grid3-td-date\{background-image:linear-gradient\(rgba\(5, 127, 235, 0\.04\),/);
  assert.match(css, /\.x-grid3-row-selected \.x-grid3-td-date\{background-image:linear-gradient\(rgba\(5, 127, 235, 0\.1\),/);
  // Selected comes after hovered, so a selected row under the finger stays selected
  assert.ok(css.indexOf('row-selected') > css.indexOf('row-over'));
  assert.ok(!css.includes('row-alt'), 'a state without a tint adds no rule');
  // Without a solid colour anywhere above, white
  const bare = grid(cols, { width: 200 });
  bare.fit();
  assert.match(bare.styles[0].textContent, /\.x-grid3-row \.x-grid3-td-date\{background-color:#fff;\}/);
});

test('grids on a phone: DSM\'s own scroller (fleXcroll) measures the new widths, or a wide grid would not scroll sideways', () => {
  let measured = 0;
  const scroller = { offsetHeight: 300, clientHeight: 300, children: [], fleXcroll: { updateScrollBars: () => { measured++; } } };
  const g = grid(advisor(), { width: 200, scroller });
  g.fit();
  assert.ok(g.cls.has('spl-fit-hscroll'));
  assert.equal(measured, 1);
});

test('grids on a phone: a grid scrolling sideways takes its header along, also where DSM\'s scroller only draws rows', () => {
  let drawn = 0;
  const scroller: any = { offsetHeight: 300, clientHeight: 300, children: [], fleXcroll: { updateScrollBars() {} }, onfleXcroll: () => { drawn++; return 'drawn'; } };
  const g = grid(advisor(), { width: 200, scroller });
  const synced = g.syncs;
  g.fit();
  assert.ok(g.cls.has('spl-fit-hscroll'));
  const before = g.syncs;
  assert.equal(scroller.onfleXcroll(), 'drawn', 'DSM\'s own handler still runs');
  assert.equal(drawn, 1);
  assert.equal(g.syncs, before + 1, 'and the header follows');
  g.fit();
  scroller.onfleXcroll();
  assert.equal(drawn, 2, 'hooked once');
  assert.ok(synced >= 0);
  // A grid that fits keeps DSM's handler as it is
  const plain: any = { offsetHeight: 300, clientHeight: 300, children: [], onfleXcroll: () => 'drawn' };
  const own = plain.onfleXcroll;
  grid(advisor(), { width: 393, scroller: plain }).fit();
  assert.equal(plain.onfleXcroll, own);
});

test('grids on a phone: a grid with fixed row heights keeps one line per cell and shows its usual values whole', () => {
  const log: Col[] = [
    { id: 'date', head: 'Date', values: ['2026-11-17', '2026-11-17'] },
    { id: 'time', head: 'Time', values: ['12:28:37', '12:20:01'] },
    { id: 'event', head: 'Event', values: ['System successfully registered [10.0.0.2] to [example.synology.me]', 'User [admin] signed in from [10.0.0.3]'] },
  ];
  const g = grid(log, { oneLine: true });
  g.fit();
  assert.ok(!g.cls.has('spl-fit-gridwrap'), 'no wrapping in a virtual grid');
  assert.ok(g.cls.has('spl-fit-gridhead'), 'headers still break onto two lines');
  assert.ok(g.cls.has('spl-fit-hscroll'));
  assert.equal(g.widths[2], Math.round(360 * 0.7), 'the long value up to most of the grid');
});

test('grids on a wide screen keep DSM\'s own column fitting', () => {
  const g = grid(advisor(), { screen: 1024 });
  assert.equal(g.fit(), 'desktop');
  assert.equal(g.originals, 1);
  assert.deepEqual(g.widths, [100, 100, 100, 100]);
  assert.equal(g.cls.size, 0);
});

/** Log Center's overview: a row of a chart (83 px of a 307 px desktop row) and its legend, which DSM hides on a narrow window */
function chartRow({ width = 393, chart = true, legend = false, flex = 0 } = {}) {
  const p = page(), ext = fakeExt();
  class BoxLayout { onLayout() {} }
  class HBoxLayout extends BoxLayout {
    calculateChildBoxes(items: any[], size: { width: number; height: number }) {
      let left = 0;
      const boxes = items.map(c => { const w = c.legend ? 224 : 83, box = { component: c, left, top: 0, width: w, height: size.height }; left += w; return box; });
      return { boxes, meta: { maxHeight: size.height } };
    }
  }
  class VBoxLayout extends BoxLayout {}
  (ext.full as any).layout = { BoxLayout, HBoxLayout, VBoxLayout };
  p.ctx.innerWidth = width; p.ctx.screen.width = width; p.ctx.document.documentElement.clientWidth = width;
  p.ctx.Ext = ext.full;
  p.run(fitJs());
  // (Plain components: rows of panels are the card grid's)
  const item = (isLegend: boolean) => Object.assign(Object.create(ext.core.BoxComponent.prototype), {
    legend: isLegend, hidden: isLegend && !legend, flex: isLegend ? 0 : flex,
    el: { hasClass: () => false, dom: { textContent: isLegend ? 'Info Warning Error' : '', querySelector: (sel: string) => !isLegend && chart && sel.includes('canvas') ? {} : null, querySelectorAll: (sel: string) => !isLegend && chart && sel.includes('canvas') ? [{}] : [], classList: { toggle() {} } } },
  });
  const all = [item(false), item(true)];
  const ct: any = { el: { hasClass: () => false }, items: { getCount: () => all.length, items: all }, getHeight: () => 264, getLayoutTarget: () => ({ getHeight: () => 264 }), setHeight() {} };
  const layout = Object.assign(Object.create(HBoxLayout.prototype), { container: ct, align: 'stretch', padding: { top: 0, left: 0, right: 0, bottom: 0 } });
  // Ext passes the shown items only
  const lay = (w = 307) => layout.calculateChildBoxes(all.filter(c => !c.hidden), { width: w, height: 264 });
  return { lay };
}

test('a chart alone in its row (its legend hidden) takes the row on a phone', () => {
  const { boxes } = chartRow().lay();
  assert.deepEqual(boxes.map((b: any) => [b.left, b.width, !!b.dirtySize]), [[0, 307, true]]);
});

test('a lone chart: rows with their legend shown, without a chart, with a flexed item, on a wide screen or still at desktop width keep their layout', () => {
  assert.deepEqual(chartRow({ legend: true }).lay().boxes.map((b: any) => b.width), [83, 224]);
  assert.deepEqual(chartRow({ chart: false }).lay().boxes.map((b: any) => b.width), [83]);
  assert.deepEqual(chartRow({ flex: 1 }).lay().boxes.map((b: any) => b.width), [83]);
  assert.deepEqual(chartRow({ width: 1024 }).lay().boxes.map((b: any) => b.width), [83]);
  // Laid out before the window fits the phone: widened later, at the phone's width
  assert.deepEqual(chartRow().lay(675).boxes.map((b: any) => b.width), [83]);
});

test('card rows: panels an hbox squeezes under a card\'s width form a grid, the row grows, spacers drop out', () => {
  const { p, ct, owner, items, lay } = cardRow();
  const { boxes, meta } = lay();
  const cards = boxes.filter((b: any) => !b.component.gap);
  assert.deepEqual(cards.map((b: any) => [b.left, b.top, b.width, b.height]), [[0, 0, 148, 154], [160, 0, 148, 154], [0, 166, 148, 154], [160, 166, 148, 154]]);
  assert.ok(boxes.filter((b: any) => b.component.gap).every((b: any) => b.left < -1000 && b.width === 0), 'spacers out of sight');
  assert.equal(meta.maxHeight, 320);
  assert.equal(ct.height, 320, 'two rows of 154 and a gap');
  p.advance(0);
  assert.equal(ct.set, 320);
  assert.equal(owner.layouts, 1, 'the owner lays the taller row out');
  // Laid out again at the same size: nothing changes, nothing loops
  lay(); p.advance(0);
  assert.equal(owner.layouts, 1);
  assert.equal(items.length, 7);
});

test('card rows: a tall card takes the full width rather than a strip', () => {
  const { lay } = cardRow({ cards: 3 });
  const { boxes } = lay(400);
  // 154 px high: a card is at least 140 px wide, so two of 194 fit in 400; the third wraps
  assert.deepEqual(boxes.filter((b: any) => !b.component.gap).map((b: any) => [b.left, b.top]), [[0, 0], [206, 0], [0, 166]]);
});

test('card rows: rows of buttons, rows that fit, and wide screens keep the desktop layout', () => {
  const buttons = cardRow({ panel: false }).lay();
  assert.deepEqual(buttons.boxes.filter((b: any) => !b.component.gap).map((b: any) => b.left), [0, 79, 158, 237]);
  const two = cardRow({ cards: 1 });
  assert.equal(two.lay().boxes[0].width, 69);
  const wide = cardRow({ width: 800 });
  assert.equal(wide.lay().boxes[0].width, 69);
  assert.equal(wide.ct.height, 154);
});

test('card rows: turned to a wider screen, the row gets its own height back', () => {
  const { p, ct, owner, lay } = cardRow();
  lay(); p.advance(0);
  assert.equal(ct.height, 320);
  p.ctx.innerWidth = 800; p.ctx.screen.width = 800;
  const { boxes } = lay(760);
  assert.equal(boxes[0].width, 69);
  assert.equal(ct.height, 154);
  p.advance(0);
  assert.equal(owner.layouts, 2);
});

/**
 * Log Center's overview on a NAS with several hosts: a line chart whose box Ext sizes from its content
 * (83 px before ECharts draws its canvas, as wide as the row after), and beside it a 200 px pie chart
 * with its host labels. The row sits in a plain panel of a fixed 325 px.
 */
function twoChartRow({ width = 393, drawn = false, chart = true } = {}) {
  const p = page(), ext = fakeExt();
  class BoxLayout { onLayout() {} }
  class HBoxLayout extends BoxLayout {
    calculateChildBoxes(items: any[], size: { width: number; height: number }) {
      let left = 0;
      const boxes = items.map(c => { const w = c.pie ? 200 : drawn ? size.width : 83, box = { component: c, left, top: 0, width: w, height: size.height }; left += w; return box; });
      return { boxes, meta: { maxHeight: size.height } };
    }
  }
  class VBoxLayout extends BoxLayout {}
  (ext.full as any).layout = { BoxLayout, HBoxLayout, VBoxLayout };
  p.ctx.innerWidth = width; p.ctx.screen.width = width; p.ctx.document.documentElement.clientWidth = width;
  p.ctx.Ext = ext.full;
  p.run(fitJs());
  // The line chart's box has no text; ECharts marks it before its canvas is drawn
  const item = (pie: boolean) => Object.assign(Object.create(ext.core.Panel.prototype), {
    pie,
    el: { hasClass: () => false, dom: { textContent: pie ? 'NAS-A: 95% NAS-B: 2%' : chart ? '' : 'Summary', querySelector: (sel: string) => chart && sel.includes('_echarts_instance_') ? {} : null, querySelectorAll: (sel: string) => chart && sel.includes('_echarts_instance_') ? [{}] : [], classList: { toggle() {} } } },
  });
  const items = [item(false), item(true)];
  const top = { layouts: 0, doLayout() { this.layouts++; } };
  const owner: any = { height: 325, layout: {}, ownerCt: top, setHeight(h: number) { this.set = h; } };
  const ct: any = {
    el: { hasClass: () => false }, height: 264, ownerCt: owner,
    getHeight() { return this.height; }, getLayoutTarget: () => ({ getHeight: () => 264 }), setHeight(h: number) { this.set = h; },
  };
  const layout = Object.assign(Object.create(HBoxLayout.prototype), { container: ct, align: 'top', padding: { top: 0, left: 0, right: 0, bottom: 0 } });
  const lay = (w = 307) => layout.calculateChildBoxes(items, { width: w, height: 264 });
  return { p, ct, owner, top, lay };
}

test('chart rows: a chart beside another chart (a pie with its labels) stacks on a phone, each full width, also before its canvas is drawn', () => {
  for (const drawn of [false, true]) {
    const { boxes } = twoChartRow({ drawn }).lay();
    assert.deepEqual(boxes.map((b: any) => [b.left, b.top, b.width, b.height]), [[0, 0, 307, 264], [0, 276, 307, 264]], drawn ? 'drawn: the row ran past its edge' : 'not yet drawn: the empty chart box is a card');
  }
});

test('chart rows: the plain panel of a fixed height around a stacked row grows with it, and gets its height back on a wider screen', () => {
  const { p, ct, owner, top, lay } = twoChartRow({ drawn: true });
  lay(); p.advance(0);
  assert.equal(ct.height, 540);
  assert.equal(owner.height, 601, 'grown by the row\'s 276 px, or it cuts off the pie and what follows');
  assert.equal(owner.set, 601);
  assert.equal(top.layouts, 1, 'the panel around it lays out again');
  lay(); p.advance(0);
  assert.equal(owner.height, 601, 'laid out again at the same size: no further growth');
  p.ctx.innerWidth = 1024; p.ctx.screen.width = 1024; p.ctx.document.documentElement.clientWidth = 1024;
  lay(984); p.advance(0);
  assert.equal(ct.height, 264);
  assert.equal(owner.height, 325);
});

test('chart rows: wide screens keep a chart beside a chart', () => {
  assert.deepEqual(twoChartRow({ drawn: true, width: 1024 }).lay(984).boxes.map((b: any) => [b.left, b.top]), [[0, 0], [984, 0]]);
});

/**
 * The menus under Log Center's overview chart on a NAS with several hosts: three panels of a fixed
 * 150 px, each holding a menu to pick a host, side by side in a 307 px row (the third starts past
 * its edge), with empty boxes between them. On a NAS with one host DSM hides the menus.
 */
function menuRow({ width = 393, hidden = false } = {}) {
  const p = page(), ext = fakeExt();
  class BoxLayout { onLayout() {} }
  class HBoxLayout extends BoxLayout {
    calculateChildBoxes(items: any[], size: { width: number; height: number }) {
      let left = 0;
      const boxes = items.map(c => { const w = c.gap ? 6 : 150, box = { component: c, left, top: 0, width: w, height: c.gap ? 7 : 28 }; left += w; return box; });
      return { boxes, meta: { maxHeight: 28 } };
    }
  }
  class VBoxLayout extends BoxLayout {}
  (ext.full as any).layout = { BoxLayout, HBoxLayout, VBoxLayout };
  p.ctx.innerWidth = width; p.ctx.screen.width = width; p.ctx.document.documentElement.clientWidth = width;
  p.ctx.Ext = ext.full;
  p.run(fitJs());
  // A menu: its text box inside the field's wrap, which Ext hides with a class
  const menus = { hidden };
  const item = (gap: boolean) => {
    const dom: any = { textContent: '', classList: { toggle() {}, contains: () => false }, style: {} };
    const wrap = { classList: { contains: (c: string) => c === 'x-hide-display' && menus.hidden }, style: {}, parentElement: dom };
    const field = { classList: { contains: () => false }, style: {}, parentElement: wrap };
    const menu = (sel: string) => !gap && /\binput\b/.test(sel);
    Object.assign(dom, { querySelector: (sel: string) => menu(sel) ? field : null, querySelectorAll: (sel: string) => menu(sel) ? [field] : [] });
    return Object.assign(Object.create((gap ? ext.core.BoxComponent : ext.core.Panel).prototype), { gap, el: { hasClass: () => false, dom } });
  };
  const items = [item(true), item(false), item(true), item(false), item(true), item(false)];
  const top = { layouts: 0, doLayout() { this.layouts++; } };
  const owner: any = { height: 325, layout: {}, ownerCt: top, setHeight(h: number) { this.set = h; } };
  const ct: any = {
    el: { hasClass: () => false }, height: 30, ownerCt: owner,
    // (Ext measures the element: what setHeight last gave it)
    getHeight() { return this.set ?? this.height; }, getLayoutTarget: () => ({ getHeight: () => 28 }), setHeight(h: number) { this.set = h; },
  };
  const layout = Object.assign(Object.create(HBoxLayout.prototype), { container: ct, align: 'top', padding: { top: 0, left: 0, right: 0, bottom: 0 } });
  const lay = (w = 307) => layout.calculateChildBoxes(items, { width: w, height: 30 });
  return { p, ct, owner, menus, lay };
}

test('card rows: panels of a fixed width that run past the row\'s edge (menus under a chart) stack, each column as wide as the widest', () => {
  const { p, ct, owner, lay } = menuRow();
  const { boxes } = lay();
  assert.deepEqual(boxes.filter((b: any) => !b.component.gap).map((b: any) => [b.left, b.top, b.width, b.height]), [[0, 0, 307, 28], [0, 40, 307, 28], [0, 80, 307, 28]], 'one column: two 150 px menus and a gap do not fit in 307 px');
  assert.ok(boxes.filter((b: any) => b.component.gap).every((b: any) => b.left < -1000), 'the empty boxes drop out of sight');
  p.advance(0);
  assert.equal(ct.height, 110);
  assert.equal(owner.height, 405, 'the panel around grows by the row\'s 80 px, or the last menu is cut off');
  // Laid out again: it grows once, not on every layout
  lay(); p.advance(0); lay(); p.advance(0);
  assert.equal(owner.height, 405);
});

test('card rows: a row whose menus the App hides (one host) is no grid, and leaves the grid when they are hidden later', () => {
  assert.deepEqual(menuRow({ hidden: true }).lay().boxes.map((b: any) => b.top), [0, 0, 0, 0, 0, 0]);
  const { p, ct, owner, menus, lay } = menuRow();
  lay(); p.advance(0);
  assert.equal(owner.height, 405);
  // DSM hides the menus and sizes the row's element at its own height again, before it leaves the grid
  menus.hidden = true; ct.set = 30;
  lay(); p.advance(0);
  assert.equal(ct.height, 30);
  assert.equal(owner.height, 325, 'the panel around gets its own height back, no blank space left');
  const wide = menuRow({ width: 1024 });
  assert.deepEqual(wide.lay(984).boxes.map((b: any) => b.top), [0, 0, 0, 0, 0, 0]);
});

/** Log Center's overview chart: blank boxes over the axis' ends, placed for the chart's desktop width (83 px) */
function maskedChart({ width = 393, chartWidth = 307 } = {}) {
  const box = (left: number, w: number) => ({ left, top: 258, width: w, height: 16 });
  const blank = (left: number, cs: Record<string, string> = {}, text = '') => node('div', { box: box(left, 24), cs: { position: 'absolute', backgroundColor: 'rgb(255, 255, 255)', ...cs }, text });
  const chart = node('div', { box: { left: 0, top: 17, width: chartWidth, height: 264 }, attrs: { _echarts_instance_: 'ec_1' } }, [node('canvas', { box: { left: 0, top: 17, width: chartWidth, height: 264 } })]);
  const left = blank(12), right = blank(89), label = blank(150, {}, 'Info'), clear = blank(200, { backgroundColor: 'rgba(0, 0, 0, 0)' });
  const body = node('div', { cls: 'x-panel-body', box: { left: 0, top: 0, width: 307, height: 325 }, cs: { position: 'relative' } }, [
    left, right, label, clear,
    node('div', { box: { left: 0, top: 17, width: 307, height: 264 } }, [node('div', { box: { left: 0, top: 17, width: chartWidth, height: 264 } }, [chart])]),
  ]);
  const { d } = contentPage([body], { width });
  return { d, left, right, label, clear };
}

test('chart masks: a blank box the App placed for a narrower chart moves to the widened chart\'s right edge; boxes at an edge, with text or see-through stay', () => {
  const { left, right, label, clear } = maskedChart();
  assert.equal(right.style.left, '283px', 'over the axis\' end again, not over a label mid-axis ("14:3")');
  assert.equal(right.style.right, 'auto');
  assert.equal(left.style.left, undefined, 'already at the left edge');
  assert.equal(label.style.left, undefined);
  assert.equal(clear.style.left, undefined);
});

test('chart masks: wide screens keep the App\'s placement', () => {
  const { right } = maskedChart({ width: 1024 });
  assert.equal(right.style.left, undefined);
});

/**
 * Ext 3's hbox as the fit sees it: items with a number width keep it, flexed items share the rest.
 * A summary row like a client count: four flexed info boxes with 40 px empty spacers between them
 */
function gapRow({ width = 393, flexed = 4, gap = 40, text = 'ShareSync' } = {}) {
  const p = page(), ext = fakeExt();
  class BoxLayout { onLayout() {} }
  class HBoxLayout extends BoxLayout {
    calculateChildBoxes(items: any[], size: { width: number; height: number }) {
      const fixed = items.reduce((sum, c) => sum + (typeof c.width === 'number' ? c.width : 0), 0);
      const flex = items.reduce((sum, c) => sum + (typeof c.width === 'number' ? 0 : c.flex || 0), 0);
      let left = 0;
      const boxes = items.map(c => {
        const w = typeof c.width === 'number' ? c.width : Math.floor((size.width - fixed) * (c.flex || 0) / flex);
        const box = { component: c, left, top: 0, width: w, height: size.height }; left += w; return box;
      });
      return { boxes, meta: { maxHeight: size.height } };
    }
  }
  class VBoxLayout extends BoxLayout {}
  (ext.full as any).layout = { BoxLayout, HBoxLayout, VBoxLayout };
  p.ctx.innerWidth = width; p.ctx.screen.width = width;
  p.ctx.Ext = ext.full;
  p.run(fitJs());
  const box = (content: string, config: Record<string, unknown>) => Object.assign(Object.create(ext.core.Container.prototype), config, { el: { dom: { textContent: content, querySelector: () => null, querySelectorAll: () => [], classList: { toggle() {} } } } });
  const items: any[] = [box('', { flex: 1, width: gap / 2 })];
  for (let i = 0; i < flexed; i++) { if (i) items.push(box('', { flex: 1, width: gap })); items.push(box(text, { flex: 1 })); }
  items.push(box('', { flex: 1, width: gap / 2 }));
  const ct: any = { el: { hasClass: () => false }, height: 151, getHeight() { return this.height; }, getLayoutTarget: () => ({ getHeight: () => 151 }) };
  const layout = Object.assign(Object.create(HBoxLayout.prototype), { container: ct, align: 'stretch', padding: { top: 0, left: 0, right: 0, bottom: 0 } });
  const lay = (w = 310) => layout.calculateChildBoxes(items, { width: w, height: 151 });
  return { items, lay };
}

test('gaps between squeezed items: empty boxes give their room to the flexed items and drop out of sight', () => {
  const { items, lay } = gapRow();
  // Desktop pixels: 160 px of gaps leave each of four items 37 px
  const { boxes } = lay();
  const shown = [...boxes].filter((b: any) => b.component.el.dom.textContent);
  assert.deepEqual(shown.map((b: any) => [b.left, b.width]), [[0, 77], [77, 77], [154, 77], [231, 77]]);
  assert.ok(boxes.filter((b: any) => !b.component.el.dom.textContent).every((b: any) => b.left < -1000 && b.width === 0), 'gaps out of sight');
  assert.equal(boxes.length, items.length);
  assert.deepEqual([...boxes].map((b: any) => b.component), items, 'boxes keep the order of the items');
  // The App's own configuration is untouched
  assert.deepEqual(items.filter(c => !c.el.dom.textContent).map(c => c.width), [20, 40, 40, 40, 20]);
});

test('gaps between squeezed items: rows that fit, rows that push one item aside, and wide screens keep their gaps', () => {
  // Items wide enough already
  const roomy = gapRow({ flexed: 2, gap: 10 }).lay(400);
  assert.deepEqual(roomy.boxes.map((b: any) => b.width), [5, 190, 10, 190, 5]);
  // One flexed item next to its gaps: a layout choice, not a squeeze
  const one = gapRow({ flexed: 1 }).lay();
  assert.deepEqual(one.boxes.map((b: any) => b.width), [20, 270, 20]);
  const wide = gapRow({ width: 800 }).lay();
  assert.equal(wide.boxes[1].width, 37);
});

test('expandable list rows grow to their content and stack their columns on a phone', () => {
  const css = readFileSync('src/core/webview/mobile-fit/dsm-fit.css', 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
    // (Animations named with the fit's prefix hold no selectors)
    .replace(/@keyframes spl-fit-[\w-]+\s*\{(?:[^{}]*\{[^{}]*\})*\s*\}/g, '');
  const media = css.slice(css.indexOf('@media'), css.indexOf('.spl-single-app'));
  // An App may lay the summary out as a flex row (VMM's overview): it becomes a block so its columns stack
  assert.match(media, /\.syno-ux-expandable-listview \.item-summary \{ display: block !important; height: auto !important;/);
  // An App's fixed row height would leave the grown summary over the next row's separator
  assert.match(media, /\.syno-ux-expandable-listview \.item-wrap \{ height: auto !important; \}/);
  assert.match(media, /\.item-summary > :not\(\.item-icon\):not\(\.item-toggle\) > \* \{[^}]*float: none !important;[^}]*display: flow-root;[^}]*width: auto !important;/);
});

/**
 * A status header at 390 px (Drive's overview): a vbox, packed in the middle of its 106 px, of
 * a title one line high (28 px, its line-height 28 px, measured by Ext before it had its width),
 * a 4 px spacer and a description. At 260 px the title's text wraps onto a second line.
 */
class LinesNode extends FakeNode {
  /** Its lines at a width, as the browser lays them out with its height free */
  lines = (width: number) => (width < 300 ? 56 : 28);
  get offsetHeight() { return this.style.height === 'auto' ? this.lines(parseFloat(this.style.width)) : super.offsetHeight; }
}
function statusHeader({ title = 'Synology Drive Server is healthy', overflow = 'visible', whiteSpace = 'normal', configured = false } = {}) {
  const p = page(), ext = fakeExt();
  class BoxLayout { onLayout() {} }
  class HBoxLayout extends BoxLayout { calculateChildBoxes() { return { boxes: [], meta: {} }; } }
  // Ext 3's vbox, as far as these items need it: config or measured heights, minHeight past a shortfall, pack center
  class VBoxLayout extends BoxLayout {
    pack = 'center';
    calculateChildBoxes(items: any[], size: { width: number; height: number }) {
      const heights = items.map(c => (typeof c.height === 'number' ? c.height : c.getSize().height));
      const total = heights.reduce((a, b) => a + b, 0), short = items.reduce((a, c, i) => a + (c.minHeight || heights[i]), 0) > size.height;
      let top = Math.max(0, (size.height - total) / 2);
      const boxes = items.map((c, i) => { const height = short ? c.minHeight || heights[i] : heights[i]; const box = { component: c, left: 0, top, width: size.width, height, dirtySize: false }; top += height; return box; });
      return { boxes, meta: { nonFlexHeight: total } };
    }
  }
  (ext.full as any).layout = { BoxLayout, HBoxLayout, VBoxLayout };
  p.ctx.innerWidth = 390; p.ctx.screen.width = 390;
  p.ctx.getComputedStyle = (n: any) => ({ paddingLeft: '0', paddingRight: '0', overflowX: overflow, overflowY: overflow, whiteSpace, ...(n?.cs ?? {}) });
  p.ctx.Ext = ext.full;
  p.run(fitJs());
  const item = (dom: FakeNode, h: number): any => ({ el: { dom }, getSize: () => ({ height: h }), ...(configured && dom.text === title ? { height: h } : {}) });
  const titleDom = new LinesNode('div', { box: { left: 0, top: 0, width: 260, height: 28 }, text: title });
  const descDom = new FakeNode('div', { box: { left: 0, top: 0, width: 260, height: 17 }, text: 'The server is running.' });
  const spacerDom = new FakeNode('div', { box: { left: 0, top: 0, width: 260, height: 4 } });
  const items = [item(titleDom, 28), item(spacerDom, 4), item(descDom, 17)];
  const ct: any = { el: { hasClass: () => false } };
  const layout = Object.assign(Object.create(VBoxLayout.prototype), { container: ct, pack: 'center' });
  const lay = (width = 260, height = 106) => layout.calculateChildBoxes(items, { width, height });
  return { p, ct, items, lay, layout, titleDom };
}

test('wrapped text in a vbox: a one-line text item takes the height of its lines and the column stacks again from it', () => {
  const { lay, titleDom, ct } = statusHeader();
  const { boxes } = lay();
  assert.deepEqual(boxes.map((b: any) => [b.top, b.height]), [[14.5, 56], [70.5, 4], [74.5, 17]], 'the description below the second line, the column centred again');
  assert.equal(boxes[0].dirtySize, true, 'Ext sets the title\'s new height');
  assert.equal(boxes[2].dirtySize, false, 'items that fit keep the size Ext gives them');
  assert.equal(titleDom.style.height, undefined, 'measured with its height free, then put back');
  assert.equal(ct.splTextIn, false, 'the column fits: no scrolling');
});

test('wrapped text in a vbox: a configured height grows too, and the column scrolls when it no longer fits', () => {
  const { lay, items, layout, ct } = statusHeader({ configured: true });
  const result = lay(260, 60);
  assert.deepEqual(result.boxes.map((b: any) => [b.top, b.height]), [[0, 56], [56, 4], [60, 17]]);
  const target = { cls: new Set<string>(), getHeight: () => 60, hasClass(c: string) { return this.cls.has(c); }, toggleClass(c: string, on: boolean) { if (on) this.cls.add(c); else this.cls.delete(c); } };
  ct.getLayoutTarget = () => target;
  Object.assign(layout, { childBoxCache: result, innerCt: { h: 0, setHeight(h: number) { this.h = h; } } });
  layout.onLayout();
  assert.ok(target.cls.has('spl-fit-vscroll'), 'the vbox scrolls');
  assert.equal(layout.innerCt.h, 77, 'over the whole column');
  assert.equal(items[0].height, 28, 'the item\'s own config is put back');
  assert.equal(items[0].minHeight, undefined);
});

test('wrapped text in a vbox: text that fits, clips, does not wrap or sits on a wide screen is left as Ext lays it out', () => {
  const fits = statusHeader().lay(320);
  assert.deepEqual(fits.boxes.map((b: any) => [b.top, b.height]), [[28.5, 28], [56.5, 4], [60.5, 17]]);
  for (const opts of [{ overflow: 'hidden' }, { whiteSpace: 'nowrap' }]) assert.equal(statusHeader(opts).lay().boxes[0].height, 28, JSON.stringify(opts));
  const wide = statusHeader();
  wide.p.ctx.innerWidth = 800; wide.p.ctx.screen.width = 800;
  assert.equal(wide.lay().boxes[0].height, 28);
});

test('wrapped text in a vbox: turned to a wider screen, the title gets its one-line height back', () => {
  const { p, lay, titleDom, ct } = statusHeader();
  assert.equal(lay().boxes[0].height, 56);
  // Ext now measures the 56 px it set: laid out again, the title keeps its lines
  titleDom.box = { ...titleDom.box, height: 56 };
  assert.deepEqual(lay().boxes.map((b: any) => [b.top, b.height]), [[14.5, 56], [70.5, 4], [74.5, 17]]);
  assert.equal(ct.splTextIn, false);
  // The screen turns and the text fits on one line
  p.ctx.innerWidth = 800; p.ctx.screen.width = 800;
  const { boxes } = lay(600);
  assert.deepEqual([boxes[0].height, boxes[0].dirtySize], [28, true]);
  // Laid out again: nothing left to put back
  titleDom.box = { ...titleDom.box, height: 28 };
  assert.equal(lay(600).boxes[0].dirtySize, false);
});

test('card rows: a card\'s content set wider than the card in a stylesheet stays inside it, border included', () => {
  const { p, items, lay } = cardRow();
  lay();
  const card = (c: any) => c.el.dom.classList.set.has('spl-fit-card');
  assert.deepEqual(items.map(card), [true, false, true, false, true, false, true], 'the cards, not the spacers');
  const css = readFileSync('src/core/webview/mobile-fit/dsm-fit.css', 'utf8');
  assert.match(css, /\.spl-fit-card \.x-panel-body > \*, html\.spl-fit:not\(#spl-fit-id\) \.spl-fit-card \.x-panel-body > \* > \*:not\(\.x-form-field-wrap > \*\) \{ max-width: 100% !important; min-width: 0 !important; box-sizing: border-box !important; \}/);
  // A menu's text box keeps DSM's box sizing: as tall as its button, not shorter by its padding
  // Turned to a wider screen: the desktop row, the App's own widths
  p.ctx.innerWidth = 800; p.ctx.screen.width = 800;
  lay(760);
  assert.deepEqual(items.map(card), items.map(() => false));
});

// ---- Nested side navigation, warm launches that fail, desktop gutters, floated cards ----

/**
 * Synology Drive and Active Backup's Portal: the category tree is the west region of a split that
 * sits beside a narrow icon rail (Drive) or inside a padded main panel (Portal), never the window's
 * outermost full-width split.
 */
function nestedSplit({ share = 333, rail = true } = {}) {
  const d = startDsm({ app: 'SYNO.SDS.Drive.Application', type: 'standalone' });
  class BorderLayout { onLayout() { return 'laid out'; } }
  class TreePanel {}
  Object.assign(d.ext.full as any, { layout: { ...(d.ext.full as any).layout, BorderLayout }, tree: { TreePanel } });
  d.p.ctx.document.createElement = (tag: string) => new FakeNode(tag);
  d.p.ctx.document.createElementNS = (_ns: string, tag: string) => new FakeNode(tag);
  const items = (list: any[]) => ({ each: (fn: (i: any) => void) => list.forEach(fn), items: list, getCount: () => list.length });
  const comp = (width: number, extra: Record<string, unknown> = {}) => {
    const dom = new FakeNode('div', { box: { left: 0, top: 0, width, height: 700 } });
    return { rendered: true, hidden: false, el: { dom, addClass: (c: string) => dom.classList.add(c) }, ...extra };
  };
  const tree = Object.assign(Object.create(TreePanel.prototype), comp(240));
  const west = comp(240, { id: 'category', region: 'west', findBy: () => [tree] });
  const center = comp(share - 240, { region: 'center', getWidth: () => share - 240, setPosition() {}, setSize() {}, y: 0 });
  const inner = comp(share, { region: 'center', layout: new BorderLayout(), doLayout() {}, items: items([west, center]) });
  const icons = comp(60, { region: 'west', findBy: () => [] });
  const outer = comp(393, { layout: new BorderLayout(), doLayout() {}, items: items(rail ? [icons, inner] : [inner]) });
  const win = d.extWindow({ root: true, title: 'Synology Drive', id: 'SYNO.SDS.Drive.Application' });
  const order = [win, outer, ...(rail ? [icons] : []), inner, west, tree, center];
  win.cascade = (fn: (c: unknown) => unknown) => { for (const c of order) if (fn(c) === false) return; };
  win.body = { dom: node('div', { box: { left: 0, top: 0, width: 393, height: 700 } }) };
  win.header = { dom: node('div', { box: { left: 0, top: 0, width: 393, height: 48 } }) };
  d.changed();
  return { d, win, west, icons };
}

test('side navigation: a tree split nested beside an icon rail, or in a padded main panel, becomes the menu', () => {
  // Drive: the tree's split beside a 60 px rail, 333 of 393 px
  const drive = nestedSplit();
  assert.ok(drive.west.el.dom.cls.has('spl-fit-nav-side'));
  assert.ok(!drive.icons.el.dom.cls.has('spl-fit-nav-side'), 'the rail is no menu');
  assert.ok(drive.win.classes.has('spl-fit-nav'));
  // Portal: the split in a main panel padded for a desktop, 270 of 393 px
  assert.ok(nestedSplit({ share: 270, rail: false }).west.el.dom.cls.has('spl-fit-nav-side'));
  // A tree beside content in a small part of the window is the App's own (a picker): no menu
  const small = nestedSplit({ share: 200 });
  assert.ok(!small.west.el.dom.cls.has('spl-fit-nav-side'));
  assert.ok(!small.win.classes.has('spl-fit-nav'));
});

/** The warm page asked to open `app`; DSM's launch adds its window, or stops on a script error */
function warmLaunch(opens: boolean) {
  const d = startDsm({ app: 'SYNO.SDS.App.PersonalSettings.Instance' });
  d.vueWindow({ root: true, title: 'Personal', id: 'SYNO.SDS.App.PersonalSettings.Instance' }); d.changed();
  const portal = 'SYNO.SDS.ActiveBackupPortal.Application';
  d.sds.Config.FnMap[portal] = { config: { type: 'app' } };
  d.sds.AppLaunch = () => {};
  const error = () => { for (const l of d.p.listeners.filter(x => x.type === 'error')) l.fn(); };
  const launches = () => d.posts.filter(m => m.internal === 'fitLaunch');
  assert.equal(d.p.run(`__splFitLaunch(${JSON.stringify(portal)})`), true);
  if (opens) { d.vueWindow({ title: 'Portal', id: portal }); d.changed(); }
  error(); d.p.advance(1500);
  return { d, launches };
}

test('warm page: an App that stops on a script error before its window tells the shell at once', () => {
  const failed = warmLaunch(false);
  assert.deepEqual(failed.launches().map(m => m.ok), [false]);
  // Reported once, not again on later errors
  for (const l of failed.d.p.listeners.filter(x => x.type === 'error')) l.fn();
  failed.d.p.advance(1500);
  assert.equal(failed.launches().length, 1);
  // An error once the App's window is up is the App's own
  assert.deepEqual(warmLaunch(true).launches(), []);
});

test('desktop gutters: a main panel padded for a desktop window keeps phone gutters and the full width', () => {
  const padded = node('div', { cls: 'main', box: { left: 30, top: 0, width: 333, height: 600 }, cs: { paddingLeft: '30px', paddingRight: '30px', marginLeft: '30px', marginRight: '30px' } },
    [node('div', { box: { left: 60, top: 16, width: 273, height: 40 }, text: 'Restore' })]);
  const plain = node('div', { cls: 'plain', box: { left: 0, top: 600, width: 393, height: 100 }, cs: { paddingLeft: '20px', paddingRight: '20px' } }, [node('div', { box: { left: 20, top: 600, width: 353, height: 20 }, text: 'Status' })]);
  const side = node('div', { cls: 'side', box: { left: 0, top: 700, width: 200, height: 100 }, cs: { paddingLeft: '30px', paddingRight: '30px' } }, [node('div', { box: { left: 30, top: 700, width: 140, height: 20 }, text: 'Card' })]);
  contentPage([padded, plain, side]);
  assert.ok(padded.cls.has('spl-fit-gutter'));
  assert.ok(!plain.cls.has('spl-fit-gutter'), '20 px is a phone gutter already');
  assert.ok(!side.cls.has('spl-fit-gutter'), 'a box in part of the window keeps its padding');
  const css = readFileSync('src/core/webview/mobile-fit/dsm-fit.css', 'utf8');
  assert.match(css, /\.spl-fit-gutter \{ padding-left: 12px !important; padding-right: 12px !important; margin-left: 0 !important; margin-right: 0 !important; width: auto !important;/);
});

/**
 * Active Backup's overview: cards floated side by side at 167 px of a 366 px row, sized by the App.
 * The calendar card holds a week label and seven 32 px day boxes, floated: they wrap at 167 px.
 */
function floatedCards({ days = 8 } = {}) {
  const day = (i: number) => node('div', { box: { left: 9 + (i % 4) * 40, top: 60 + Math.floor(i / 4) * 30, width: 40, height: 24 }, cs: { float: 'left' }, text: String(i) });
  const week = node('div', { cls: 'line', box: { left: 9, top: 60, width: 160, height: days > 4 ? 60 : 30 } }, Array.from({ length: days }, (_, i) => day(i)));
  const body = node('div', { cls: 'card-body', box: { left: 9, top: 0, width: 167, height: 300 } }, [week]);
  body.style.width = '167px'; body.attrs.style = 'width: 167px';
  const placed = node('div', { box: { left: 9, top: 0, width: 167, height: 30 }, cs: { position: 'absolute' } });
  placed.style.width = '167px'; placed.attrs.style = 'width: 167px';
  const calendar = node('div', { cls: 'card', box: { left: 9, top: 0, width: 167, height: 300 }, cs: { float: 'left' } }, [body, placed]);
  const devices = node('div', { cls: 'card', box: { left: 190, top: 0, width: 167, height: 300 }, cs: { float: 'left' } }, [node('div', { box: { left: 190, top: 0, width: 167, height: 40 }, text: 'Devices' })]);
  const row = node('div', { cls: 'row', box: { left: 9, top: 0, width: 366, height: 600 } }, [calendar, devices]);
  return { row, calendar, devices, body, placed };
}

test('floated cards: a row of cards whose content wraps at its share stacks, each at the row\'s width', () => {
  const { row, calendar, devices, body, placed } = floatedCards();
  contentPage([row]);
  assert.ok(calendar.cls.has('spl-fit-fill')); assert.ok(devices.cls.has('spl-fit-fill'));
  // What the App sized to the old card width fills the card; a box it places itself keeps its width
  assert.ok(body.cls.has('spl-fit-fill-in'));
  assert.ok(!placed.cls.has('spl-fit-fill-in'));
  const css = readFileSync('src/core/webview/mobile-fit/dsm-fit.css', 'utf8');
  assert.match(css, /\.spl-fit-fill \{ float: none !important; width: auto !important;/);
  assert.match(css, /\.spl-fit-fill \.spl-fit-fill-in \{ width: auto !important; \}/);
});

test('floated cards: cards whose content fits their share stay side by side', () => {
  const { row, calendar, devices } = floatedCards({ days: 4 });
  contentPage([row]);
  assert.ok(!calendar.cls.has('spl-fit-fill')); assert.ok(!devices.cls.has('spl-fit-fill'));
});

/**
 * Active Backup's backup calendar in a 318 px card: rows of a 116 px week label and seven 32 px day boxes,
 * floated (340 px). Each row wraps its last box onto a line of its own, so the columns no longer line up.
 */
function fixedRows({ room = 318, rows = 3 } = {}) {
  const row = (r: number) => {
    const top = r * 60, boxes = [node('div', { box: { left: 0, top, width: 116, height: 30 }, cs: { float: 'left' }, text: 'Week ' + r })];
    for (let i = 0; i < 7; i++) {
      const left = 116 + i * 32, wraps = left + 32 > room;
      boxes.push(node('div', { box: { left: wraps ? 0 : left, top: wraps ? top + 30 : top, width: 32, height: 30 }, cs: { float: 'left' }, text: String(i) }));
    }
    return node('div', { cls: 'line', box: { left: 0, top, width: room, height: 60 } }, boxes);
  };
  const lines = Array.from({ length: rows }, (_, r) => row(r));
  const body = node('div', { cls: 'calendar', box: { left: 0, top: 0, width: room, height: rows * 60 } }, lines);
  return { body, lines };
}

test('fixed rows: rows of fixed boxes that line up as a table and wrap keep their width, scaled to the room', () => {
  const { body, lines } = fixedRows();
  contentPage([body]);
  for (const l of lines) {
    assert.ok(l.cls.has('spl-fit-rows-row'));
    assert.equal(l.vars['--spl-fit-row'], '340px');
    assert.equal(l.vars['--spl-fit-zoom'], '0.935');
  }
  assert.ok(!body.cls.has('spl-fit-rows-scroll'), 'scaled: nothing to scroll');
  const css = readFileSync('src/core/webview/mobile-fit/dsm-fit.css', 'utf8');
  assert.match(css, /\.spl-fit-rows-row \{ min-width: var\(--spl-fit-row\) !important;[^}]*zoom: var\(--spl-fit-zoom, 1\);/);
  assert.match(css, /\.spl-fit-rows-scroll \{ overflow-x: auto !important;/);
});

test('fixed rows: far too narrow to scale, the rows keep their width and the box they sit in scrolls sideways', () => {
  const { body, lines } = fixedRows({ room: 200 });
  contentPage([body]);
  assert.ok(body.cls.has('spl-fit-rows-scroll'));
  for (const l of lines) { assert.ok(l.cls.has('spl-fit-rows-row')); assert.equal(l.vars['--spl-fit-zoom'], undefined); }
});

test('fixed rows: a lone wrapped row (icons that wrap on purpose) and rows that fit are left alone', () => {
  const lone = fixedRows({ rows: 1 }), fit = fixedRows({ room: 360 });
  contentPage([lone.body, fit.body]);
  assert.ok(!lone.lines[0].cls.has('spl-fit-rows-row'));
  for (const l of fit.lines) assert.ok(!l.cls.has('spl-fit-rows-row'));
});

test('dialog columns: an item of an Ext vbox the App sized wider than the screen is capped at it, and the column lays out again', () => {
  // Drive's first-run dialog: its picture (500 px), title and text (560 px) in a centred vbox make the window 560 px wide
  const p = page(), ext = fakeExt();
  const win = ext.open();
  const vw = p.ctx.innerWidth;
  const item = (w: number) => {
    const dom = new FakeNode('div', { cls: 'x-box-item', box: { left: 0, top: 0, width: w, height: 30 } });
    return { rendered: true, el: { dom }, setWidth() {}, ownerCt: null as any };
  };
  const picture = item(500), text = item(560), button = item(200);
  const column = { rendered: true, layout: { type: 'vbox' }, layouts: 0, doLayout() { this.layouts++; }, el: { dom: new FakeNode('div', { cls: 'x-box-layout-ct', box: { left: 0, top: 0, width: vw, height: 700 } }) } };
  for (const i of [picture, text, button]) i.ownerCt = column;
  const hbox = item(560); hbox.ownerCt = { layout: { type: 'hbox' }, el: column.el };
  win.cascade = (fn: (c: unknown) => void) => [win, column, picture, text, button, hbox].forEach(fn);
  p.ctx.Ext = ext.full;
  p.run(fitJs());
  p.advance(1000);
  for (const i of [picture, text]) { assert.ok(i.el.dom.cls.has('spl-fit-col')); assert.equal(i.el.dom.vars['--spl-fit-cap'], vw + 'px'); }
  assert.ok(!button.el.dom.cls.has('spl-fit-col'), 'fits: left alone');
  assert.ok(!hbox.el.dom.cls.has('spl-fit-col'), 'a row (hbox) is not a column');
  assert.ok(column.layouts > 0);
  const css = readFileSync('src/core/webview/mobile-fit/dsm-fit.css', 'utf8');
  assert.match(css, /\.spl-fit-col \{ max-width: var\(--spl-fit-cap, 100vw\) !important;/);
});

test('wide boxes: a banner holding a toolbar over a background picture, set to a desktop min-width, is capped', () => {
  // Active Backup's Portal: its header bar has a stylesheet min-width of 1024 px
  const tools = node('div', { cls: 'x-toolbar', box: { left: 700, top: 10, width: 300, height: 40 } }, [node('div', { box: { left: 700, top: 10, width: 80, height: 40 }, text: 'Sign out' })]);
  const banner = node('div', { cls: 'banner', box: { left: 0, top: 0, width: 1024, height: 64 }, cs: { backgroundImage: 'url("header.png")' } }, [node('div', { box: { left: 16, top: 10, width: 300, height: 40 }, text: 'Active Backup' }), tools]);
  contentPage([banner]);
  assert.ok(banner.cls.has('spl-fit-cap'));
  assert.equal(banner.vars['--spl-fit-cap'], '393px');
});

const fitCss = () => readFileSync('src/core/webview/mobile-fit/dsm-fit.css', 'utf8');
const phoneCss = () => { const css = fitCss(); return css.slice(css.indexOf('@media'), css.indexOf('.spl-single-app')); };

test('label/value cards: each label and its value share a line, the label column at most 40%, the value left-aligned and wrapping', () => {
  // DSM Vue's table on a phone (Container Manager's projects): the vertical variant stacks each label over its value
  const media = phoneCss();
  assert.match(media, /\.mobile-row-card-wrapper \.field-wrapper\.field-align-vertical \{ grid-template-columns: fit-content\(40%\) minmax\(0, 1fr\) !important;/);
  assert.match(media, /\.field-align-vertical \.mobile-label \{ grid-column: 1 \/ 2 !important;[^}]*height: auto !important;[^}]*overflow-wrap: anywhere;/);
  assert.match(media, /\.field-align-vertical \.mobile-value \{ grid-column: 2 \/ 3 !important;[^}]*height: auto !important;[^}]*text-align: left;[^}]*justify-content: flex-start;[^}]*overflow-wrap: anywhere;/);
  // A status dot the stacked layout centred: at the start of the label's line
  assert.match(media, /\.mobile-value:has\(> :empty:only-child\) \{ display: flex !important; align-items: center;/);
  assert.match(media, /\.mobile-value > :empty:only-child \{ margin-left: 0 !important; margin-right: 0 !important; \}/);
});

test('card headers: a menu beside a card\'s title gives up its desktop width and the title keeps its words', () => {
  const media = phoneCss();
  assert.match(media, /\.v-card-header \.v-card-title \{ flex-shrink: 0;/);
  assert.match(media, /\.v-card-header \.actions-wrapper \{ flex: 1 1 auto; min-width: 0;/);
  assert.match(media, /\.v-card-header \.actions-wrapper \.v-select2-wrapper \{ width: auto !important; max-width: 100%; min-width: 0 !important; \}/);
});

/** A chart legend (Tiering's): two entries, each a title over a number and its unit, beside a summary */
function legendRow({ crushed = true } = {}) {
  const entry = (left: number, width: number, natural: number) => {
    const e = node('div', { box: { left, top: 900, width, height: 60 }, cs: { display: 'flex' }, text: 'Hot 12 KB' });
    e.naturalWidth = natural;
    return e;
  };
  const a = crushed ? entry(33, 28, 50) : entry(33, 110, 110), b = crushed ? entry(85, 34, 56) : entry(150, 120, 120);
  const summary = node('div', { box: { left: crushed ? 144 : 280, top: 900, width: crushed ? 225 : 80, height: 28 }, text: 'Moved (2.7 GB in all)' });
  return node('div', { box: { left: 33, top: 900, width: 336, height: 60 }, cs: { display: 'flex', flexDirection: 'row', flexWrap: 'nowrap' } }, [a, b, summary]);
}

test('flex rows: a row that fits only by crushing an item below what it holds wraps', () => {
  const crushed = legendRow();
  contentPage([crushed]);
  assert.ok(crushed.cls.has('spl-fit-wrap'));
  const fits = legendRow({ crushed: false });
  contentPage([fits]);
  assert.ok(!fits.cls.has('spl-fit-wrap'), 'items at their width: left alone');
  // A name cut by its own ellipsis at a readable width is the App's choice: a list row stays one line
  const name = node('div', { box: { left: 16, top: 100, width: 200, height: 40 }, cs: { overflowX: 'hidden' }, text: 'Container Manager project' });
  name.naturalWidth = 260;
  const row = node('div', { box: { left: 16, top: 100, width: 344, height: 40 }, cs: { display: 'flex', flexDirection: 'row', flexWrap: 'nowrap' } }, [name, node('button', { box: { left: 216, top: 100, width: 80, height: 32 }, text: 'Open' })]);
  contentPage([row]);
  assert.ok(!row.cls.has('spl-fit-wrap'));
  // The entry's own box fits it, a box inside cuts its text: crushed all the same
  const cut = node('div', { box: { left: 42, top: 900, width: 19, height: 60 }, cs: { overflowX: 'hidden' }, text: 'Hot data 12 KB' });
  cut.naturalWidth = 41;
  const entry = node('div', { box: { left: 33, top: 900, width: 28, height: 60 }, cs: { display: 'flex' } }, [cut]);
  const legend = node('div', { box: { left: 33, top: 900, width: 336, height: 60 }, cs: { display: 'flex', flexDirection: 'row', flexWrap: 'nowrap' } }, [entry, node('div', { box: { left: 144, top: 900, width: 225, height: 28 }, text: 'Moved (2.7 GB in all)' })]);
  contentPage([legend]);
  assert.ok(legend.cls.has('spl-fit-wrap'));
  // A number beside its unit, cut off: the pair is never wrapped apart
  const size = node('div', { box: { left: 0, top: 0, width: 30, height: 20 }, cs: { display: 'flex', flexDirection: 'row', flexWrap: 'nowrap' } }, [node('div', { box: { left: 0, top: 0, width: 20, height: 20 }, text: '12' }), node('div', { box: { left: 24, top: 0, width: 17, height: 20 }, text: 'KB' })]);
  contentPage([size]);
  assert.ok(!size.cls.has('spl-fit-wrap'));
});

/** A dashboard card's header (Container Manager's overview): a title beside a CPU / Memory / Network switch */
function cardHeader({ title = 'CPU usage (%)', titleHeight = 56, buttonRows = 2 } = {}) {
  const t = node('div', { box: { left: 41, top: 427, width: 106, height: titleHeight }, cs: { lineHeight: '28px' }, text: title });
  // Its text's line boxes, one per line
  (t as any).lines = Array.from({ length: Math.round(titleHeight / 28) }, (_, i) => ({ left: 41, top: 427 + i * 28, width: 100, height: 28, right: 141, bottom: 455 + i * 28 }));
  const buttons = ['CPU', 'Memory', 'Network'].map((label, i) => node('button', { cls: 'v-btn', box: { left: 147 + (i % 2) * 83, top: 427 + (buttonRows > 1 ? Math.floor(i / 2) * 28 : 0), width: 83, height: 28 }, cs: { display: 'inline-block' }, text: label }));
  const group = node('div', { box: { left: 147, top: 427, width: 202, height: buttonRows * 28 }, cs: { display: 'flex' } }, [node('div', { cls: 'v-btn-group', box: { left: 147, top: 427, width: 202, height: buttonRows * 28 } }, buttons)]);
  return node('div', { box: { left: 41, top: 427, width: 308, height: Math.max(titleHeight, buttonRows * 28) }, cs: { display: 'flex', flexDirection: 'row', flexWrap: 'nowrap' } }, [t, group]);
}

/** A page whose text nodes report their line boxes (a node's `lines`, or its one box) */
function linesPage(content: FakeNode[]) {
  const d = dsmPage({ app: 'SYNO.SDS.StorageManager.Instance' });
  d.p.ctx.document.createRange = () => { let owner: FakeNode; return { selectNodeContents(n: any) { owner = n.owner; }, getClientRects() { const b = owner.layout; return (owner as any).lines ?? [{ ...b, right: b.left + b.width, bottom: b.top + b.height }]; } }; };
  return contentPageOn(d, content);
}

test('flex rows: a card header that breaks its title over two lines, or its switch over two rows, wraps', () => {
  const contentPage = linesPage;
  // Both squeezed (Container Manager's CPU card at 390 px)
  const both = cardHeader();
  contentPage([both]);
  assert.ok(both.cls.has('spl-fit-wrap'));
  // Only the buttons on two rows; only the title on two lines
  const buttons = cardHeader({ titleHeight: 28 });
  contentPage([buttons]);
  assert.ok(buttons.cls.has('spl-fit-wrap'), 'the switch on two rows');
  const title = cardHeader({ buttonRows: 1 });
  contentPage([title]);
  assert.ok(title.cls.has('spl-fit-wrap'), 'the title on two lines');
  // Title on one line, the buttons on one row: left alone
  const fits = cardHeader({ titleHeight: 28, buttonRows: 1 });
  contentPage([fits]);
  assert.ok(!fits.cls.has('spl-fit-wrap'));
  // A paragraph beside a button is text that wraps on purpose, not a title
  const text = cardHeader({ title: 'Images not used by any container take up space on the volume.', buttonRows: 1 });
  contentPage([text]);
  assert.ok(!text.cls.has('spl-fit-wrap'));
});

/** Two dashboard cards in a row that runs past its edge; once it wraps, each card is on a line of its own */
function dashboardRow() {
  const row = node('div', { cls: 'row', box: { left: 20, top: 16, width: 350, height: 228 }, cs: { display: 'flex', flexDirection: 'row', flexWrap: 'nowrap' } });
  const wrapped = () => row.cls.has('spl-fit-wrap');
  // The status card spreads its icon over its height with a part that grows; its desktop height is the row's
  const status = node('div', { box: { left: 45, top: 17, width: 300, height: 52 }, cs: { display: 'flex', flexGrow: '1' } }, [node('div', { box: { left: 113, top: 17, width: 232, height: 28 }, text: 'Healthy' })]);
  const rows = node('div', { box: { left: 45, top: 69, width: 300, height: 71 }, cs: { flexGrow: '0' }, text: '6 containers are running' });
  const info = node('div', { box: { left: 20, top: 16, width: 350, height: 228 }, cs: { display: 'flex', flexDirection: 'column' } }, [status, rows]);
  const image = node('div', { box: { left: 386, top: 16, width: 320, height: 228 }, text: '15 images' });
  Object.defineProperty(info, 'box', { get: () => wrapped() ? { left: 20, top: 16, width: 350, height: 149 } : { left: 20, top: 16, width: 350, height: 228 } });
  Object.defineProperty(image, 'box', { get: () => wrapped() ? { left: 20, top: 173, width: 320, height: 221 } : { left: 386, top: 16, width: 320, height: 228 } });
  row.appendChild(info); row.appendChild(image);
  return { row, info, image };
}

test('flex rows: cards of a wrapped row each fill their line, and a card that spread its content over its height keeps it', () => {
  const { row, info, image } = dashboardRow();
  contentPage([row]);
  assert.ok(row.cls.has('spl-fit-wrap'));
  assert.ok(row.cls.has('spl-fit-wrap-fill'), 'each card on a line of its own fills it');
  assert.ok(info.cls.has('spl-fit-tall'));
  assert.equal(info.vars['--spl-fit-tall'], '228px', 'its desktop height');
  assert.ok(!image.cls.has('spl-fit-tall'), 'a block card that is its content\'s height: as it is');
  // Small items that wrapped (a legend) keep their own widths
  const legend = legendRow();
  contentPage([legend]);
  assert.ok(legend.cls.has('spl-fit-wrap'));
  assert.ok(!legend.cls.has('spl-fit-wrap-fill'));
  const css = fitCss();
  assert.match(css, /\.spl-fit-wrap-fill > \* \{ flex: 1 1 100% !important; width: auto !important; max-width: 100% !important; min-width: 0 !important; box-sizing: border-box !important; \}/);
  assert.match(css, /\.spl-fit-tall \{ min-height: var\(--spl-fit-tall, 0px\) !important; \}/);
});

test('clipped pages: a page-sized box that hides its content running past its bottom scrolls, and the page in it grows', () => {
  // Container Manager's overview: cards stacked on a phone, 1057 px of them in an 800 px box that hides overflow
  const make = (overflowY: string) => {
    const pageBox = node('div', { box: { left: 0, top: 0, width: 393, height: 800 }, cs: { display: 'flex', flexDirection: 'column' } }, [node('div', { box: { left: 20, top: 16, width: 350, height: 300 }, text: 'Healthy' })]);
    pageBox.naturalHeight = 1057;
    const box = node('div', { cls: 'container', box: { left: 0, top: 0, width: 393, height: 800 }, cs: { overflowY } }, [pageBox]);
    box.naturalHeight = 1057;
    return { box, pageBox };
  };
  const clipped = make('hidden');
  contentPage([clipped.box]);
  assert.ok(clipped.box.cls.has('spl-fit-page-scroll'));
  assert.ok(clipped.pageBox.cls.has('spl-fit-grow'));
  assert.equal(clipped.pageBox.vars['--spl-fit-min'], '800px');
  // A box that already scrolls, or one whose content fits: left alone
  const scrolls = make('auto');
  contentPage([scrolls.box]);
  assert.ok(!scrolls.box.cls.has('spl-fit-page-scroll'));
  const fits = make('hidden');
  fits.box.naturalHeight = 810; fits.pageBox.naturalHeight = 810;
  contentPage([fits.box]);
  assert.ok(!fits.box.cls.has('spl-fit-page-scroll'), 'within a few pixels');
  // A small box (a carousel strip) that hides what overflows is the App's own
  const strip = make('hidden');
  strip.box.box = { left: 0, top: 0, width: 393, height: 120 };
  contentPage([strip.box]);
  assert.ok(!strip.box.cls.has('spl-fit-page-scroll'));
  assert.match(fitCss(), /\.spl-fit-page-scroll \{ overflow-y: auto !important;/);
});

test('label/value cards: a column with no title loses its "undefined:" label, and a label with an empty value goes', () => {
  const label = (text: string) => node('div', { cls: 'mobile-label', box: { left: 16, top: 65, width: 78, height: 28 }, text });
  const blank = label('undefined\uff1a'), named = label('Name:'), empty = label('');
  const card = node('div', { cls: 'mobile-row-card-wrapper', box: { left: 16, top: 53, width: 358, height: 83 } }, [
    node('div', { cls: 'field-wrapper field-align-vertical', box: { left: 16, top: 65, width: 358, height: 58 }, cs: { display: 'grid' } }, [
      blank, node('div', { cls: 'mobile-value', box: { left: 106, top: 65, width: 268, height: 54 }, text: 'nginx' }),
      named, node('div', { cls: 'mobile-value', box: { left: 106, top: 97, width: 268, height: 28 }, text: 'ovis' }),
      empty, node('div', { cls: 'mobile-value', box: { left: 106, top: 129, width: 268, height: 28 }, text: 'x' }),
    ]),
  ]);
  contentPage([card]);
  assert.ok(blank.cls.has('spl-fit-nolabel'));
  assert.ok(empty.cls.has('spl-fit-nolabel'), 'a label with no text at all');
  assert.ok(!named.cls.has('spl-fit-nolabel'));
  const media = phoneCss();
  assert.match(media, /\.field-align-vertical \.mobile-label\.spl-fit-nolabel \{ display: none !important; \}/);
  assert.match(media, /\.field-align-vertical \.spl-fit-nolabel \+ \.mobile-value \{ grid-column: 1 \/ -1 !important; \}/);
  // An action column that shows its buttons only on a desktop's hover: label and empty value go
  assert.match(media, /\.field-align-vertical \.mobile-value:empty,\s*html\.spl-fit:not\(#spl-fit-id\) \.mobile-row-card-wrapper \.field-wrapper\.field-align-vertical \.mobile-label:has\(\+ \.mobile-value:empty\) \{ display: none !important; \}/);
});

test('vue toolbars: the buttons take what they need and the search and filter fields share the rest', () => {
  // Container Manager's log: a 250 px filter menu and a 242 px search box crushed its Clear and Export buttons to nothing
  const media = phoneCss();
  assert.match(media, /\.v-toolbar > \.main-wrapper \{ flex: 0 1 auto !important; \}/);
  assert.match(media, /\.v-toolbar > \.right-wrapper \{ flex: 1 1 0 !important; min-width: 40% !important; \}/);
  assert.match(media, /\.v-toolbar > \.right-wrapper > \.v-textfield-wrapper,\s*html\.spl-fit:not\(#spl-fit-id\) \.v-toolbar > \.right-wrapper > \.v-select2-wrapper \{ flex: 1 1 0 !important; width: auto !important; min-width: 0 !important; \}/);
});

/** Panes side by side drawn with flex boxes (Surveillance Station's Monitor Center): a fixed tree beside a growing view */
function paneRow({ tree = 220, height = 700 } = {}) {
  const side = node('div', { box: { left: 0, top: 0, width: tree, height }, cs: { flexGrow: '0' } }, [node('div', { box: { left: 0, top: 0, width: tree, height: 30 }, text: 'Layouts' })]);
  const view = node('div', { box: { left: tree, top: 0, width: 393 - tree, height }, cs: { flexGrow: '1' } }, [node('div', { box: { left: tree, top: 300, width: 393 - tree, height: 30 }, text: 'Drag and drop devices' })]);
  const row = node('div', { box: { left: 0, top: 0, width: 393, height }, cs: { display: 'flex', flexDirection: 'row', flexWrap: 'nowrap' } }, [side, view]);
  return { row, side, view };
}

test('panes: a fixed pane that leaves the growing one too little folds to a bar with its text, opened by a tap', () => {
  const { row, side, view } = paneRow();
  contentPage([row]);
  assert.ok(row.cls.has('spl-fit-panes'));
  assert.ok(view.cls.has('spl-fit-pane-main'));
  assert.ok(side.cls.has('spl-fit-pane'));
  assert.equal(side.getAttribute('data-spl-pane'), 'Layouts');
  assert.equal(side.getAttribute('aria-expanded'), 'false');
  assert.ok(!row.cls.has('spl-fit-wrap'), 'a column, not a wrapped row');
  // A tap on the bar opens it, another folds it again
  side.fire('click', { clientY: 10 });
  assert.ok(side.cls.has('spl-fit-pane-open')); assert.equal(side.getAttribute('aria-expanded'), 'true');
  side.fire('click', { clientY: 400 });
  assert.ok(side.cls.has('spl-fit-pane-open'), 'a tap in its content is the content\'s own');
  side.fire('click', { clientY: 10 });
  assert.ok(!side.cls.has('spl-fit-pane-open'));
  const css = fitCss();
  assert.match(css, /\.spl-fit-panes \{ flex-direction: column !important;/);
  assert.match(css, /\.spl-fit-pane::before \{\s*content: attr\(data-spl-pane\)/);
  // A growing pane with room, or a short row (a toolbar), keeps its layout
  for (const setup of [{ tree: 120 }, { height: 200 }]) {
    const other = paneRow(setup);
    contentPage([other.row]);
    assert.ok(!other.row.cls.has('spl-fit-panes'), JSON.stringify(setup));
  }
});

test('numbers and units: a box holding only a number and its unit never breaks between them', () => {
  const size = node('span', { box: { left: 200, top: 50, width: 60, height: 20 }, cs: { display: 'inline-block' }, text: '1.2 TB' });
  const parts = node('div', { box: { left: 200, top: 80, width: 80, height: 20 } }, [node('span', { box: { left: 200, top: 80, width: 40, height: 20 }, text: '505.0' }), node('span', { box: { left: 244, top: 80, width: 20, height: 20 }, text: ' GB' })]);
  const share = node('span', { box: { left: 200, top: 110, width: 40, height: 20 }, text: '35 %' });
  const prose = node('div', { box: { left: 0, top: 140, width: 300, height: 20 }, text: 'Free after the move: 2.7 GB' });
  const bare = node('span', { box: { left: 0, top: 170, width: 30, height: 20 }, text: '1200' });
  contentPage([node('div', { box: { left: 0, top: 0, width: 393, height: 300 } }, [size, parts, share, prose, bare])]);
  for (const e of [size, parts, share]) assert.ok(e.cls.has('spl-fit-unit'), e.textContent);
  assert.ok(!prose.cls.has('spl-fit-unit'), 'a sentence wraps as usual');
  assert.ok(!bare.cls.has('spl-fit-unit'), 'a lone number has nothing to break');
  assert.match(phoneCss(), /\.spl-fit-unit \{ white-space: nowrap !important; \}/);
});

test('wide boxes: a box set wider than its room is capped though WebKit reports its right margin as negative', () => {
  // WebKit reports an over-constrained block's used right margin: a 1024 px bar in a 393 px box, -631 px
  const bar = node('div', { box: { left: 0, top: 0, width: 1024, height: 64 }, cs: { marginRight: '-631px' } }, [node('div', { box: { left: 16, top: 10, width: 300, height: 40 }, text: 'Active Backup' })]);
  contentPage([bar]);
  assert.ok(bar.cls.has('spl-fit-cap'));
  assert.equal(bar.vars['--spl-fit-cap'], '393px');
});

test('a component whose desktop width was dropped fills its container, unless its layout sizes it', () => {
  const p = page(), ext = fakeExt();
  p.ctx.Ext = ext.full;
  p.run(fitJs());
  const comp = (width: number) => {
    const c: any = { width, handlers: {} as Record<string, () => void>, on(ev: string, fn: () => void) { this.handlers[ev] = fn; } };
    c.el = { dom: { style: { width: '' } as Record<string, string> } };
    return c;
  };
  // A search box set 600 px wide, rendered in a plain container (Chat's admin console)
  const search = comp(600);
  ext.hooks.BoxComponent.beforerender(search);
  assert.equal(search.width, undefined);
  search.handlers.render();
  assert.equal(search.el.dom.style.width, '100%');
  assert.equal(search.el.dom.style.maxWidth, '100%');
  // A layout already gave it a width: kept
  const laid = comp(600);
  ext.hooks.BoxComponent.beforerender(laid);
  laid.el.dom.style.width = '380px';
  laid.handlers.render();
  assert.equal(laid.el.dom.style.width, '380px');
  // A minimum width wider than the phone (Chat's message box, at least 536 px) is dropped too
  const box = comp(0); delete box.width; box.boxMinWidth = 536;
  ext.hooks.BoxComponent.beforerender(box);
  assert.equal(box.boxMinWidth, undefined);
  const fine = comp(0); delete fine.width; fine.boxMinWidth = 120;
  ext.hooks.BoxComponent.beforerender(fine);
  assert.equal(fine.boxMinWidth, 120);
  // Narrow enough for the phone: untouched
  const small = comp(200);
  ext.hooks.BoxComponent.beforerender(small);
  assert.equal(small.width, 200);
  assert.equal(small.handlers.render, undefined);
});

test('floating layers: a popover on the page that runs past the screen is narrowed to it and moved inside', () => {
  const { d, body } = contentPage([node('div', { box: { left: 0, top: 0, width: 393, height: 300 }, text: 'Search' })]);
  const vw = d.p.ctx.innerWidth;
  // Chat's search options: 524 px wide, aligned to a field at 200 px
  const wide = node('div', { cls: 'x-panel', box: { left: 200, top: 120, width: 524, height: 300 }, cs: { position: 'absolute', left: '200px' } });
  // A smaller one past the right edge: moved, not narrowed
  const small = node('div', { cls: 'x-panel', box: { left: 300, top: 120, width: 200, height: 100 }, cs: { position: 'absolute', left: '300px' } });
  // A backdrop covering the screen, a window and one inside the screen: left alone
  const mask = node('div', { box: { left: 0, top: 0, width: 1024, height: 900 }, cs: { position: 'absolute', left: '0px' } });
  const win = node('div', { cls: 'x-window', box: { left: 300, top: 0, width: 600, height: 400 }, cs: { position: 'absolute', left: '300px' } });
  const inside = node('div', { cls: 'x-panel', box: { left: 20, top: 120, width: 200, height: 100 }, cs: { position: 'absolute', left: '20px' } });
  // Ext parks a hidden panel out of sight: it stays there
  const parked = node('div', { cls: 'x-panel', box: { left: -10000, top: -10000, width: 536, height: 98 }, cs: { position: 'absolute', left: '-10000px' } });
  for (const n of [wide, small, mask, win, inside, parked]) body.appendChild(n);
  // A standalone App's panel: on DSM's desktop
  const onDesk = node('div', { cls: 'x-panel', box: { left: 33, top: 378, width: 524, height: 334 }, cs: { position: 'absolute', left: '33px' } });
  onDesk.connected = true; (d.desk.children as unknown[]).push(onDesk);
  // The page moves boxes by their style; the fit sees it as it lays them out
  const place = (n: FakeNode) => { const w = parseFloat(n.vars.width ?? ''); if (w) n.box.width = w; const l = parseFloat(n.vars.left ?? ''); if (!isNaN(l)) n.box.left = l; };
  d.changed(); d.p.advance(400);
  [wide, small, mask, win, inside, onDesk].forEach(place);
  assert.equal(wide.vars.width, vw - 16 + 'px');
  assert.equal(onDesk.vars.width, vw - 16 + 'px');
  d.changed(); d.p.advance(400);
  [wide, small, onDesk].forEach(place);
  assert.equal(wide.box.left, 8);
  assert.equal(onDesk.box.left, 8);
  assert.equal(small.box.left, vw - 8 - 200);
  assert.equal(small.vars.width, undefined);
  for (const n of [mask, win, inside, parked]) { assert.equal(n.vars.left, undefined); assert.equal(n.vars.width, undefined); }
});

/** Chat: a list of channels (Ext DataViews) in the west region of the window's split, 250 of 393 px */
function listSplit({ west = 250, lists = true } = {}) {
  const d = startDsm({ app: 'SYNO.SDS.Drive.Application', type: 'standalone' });
  class BorderLayout { onLayout() { return 'laid out'; } }
  class DataView {}
  Object.assign(d.ext.full as any, { layout: { ...(d.ext.full as any).layout, BorderLayout }, DataView });
  d.p.ctx.document.createElement = (tag: string) => new FakeNode(tag);
  d.p.ctx.document.createElementNS = (_ns: string, tag: string) => new FakeNode(tag);
  const items = (list: any[]) => ({ each: (fn: (i: any) => void) => list.forEach(fn), items: list, getCount: () => list.length });
  const comp = (width: number, extra: Record<string, unknown> = {}): any => {
    const dom = new FakeNode('div', { box: { left: 0, top: 0, width, height: 700 } });
    return { rendered: true, hidden: false, el: { dom, addClass: (c: string) => dom.classList.add(c) }, ...extra };
  };
  const selected = node('div', { text: 'General' });
  const view = (sel: FakeNode | null) => Object.assign(Object.create(DataView.prototype), comp(west), {
    handlers: {} as Record<string, () => void>, on(ev: string, fn: () => void) { this.handlers[ev] = fn; }, getSelectedNodes: () => (sel ? [sel] : []),
  });
  const channels = view(null), direct = view(selected);
  const westPanel = comp(west, { id: 'channels', region: 'west', findBy: (fn: (c: unknown) => boolean) => (lists ? [channels, direct] : []).filter(fn) });
  const center = comp(393 - west, { region: 'center', getWidth: () => 393 - west, getHeight: () => 700, setPosition() {}, setSize() {}, y: 0 });
  // Its top bar: 50 px, its search box wrapped onto a second line (to 95 px)
  const search = node('div', { box: { left: 45, top: 61, width: 309, height: 34 }, cs: { position: 'relative' } });
  const north = comp(393, { region: 'north', height: 50 });
  north.el.dom.box.height = 50; north.el.dom.appendChild(search);
  const split = comp(393, { layout: new BorderLayout(), layouts: 0, doLayout(this: { layouts: number }) { this.layouts++; }, items: items([north, westPanel, center]) });
  const win = d.extWindow({ root: true, title: 'Chat', id: 'SYNO.SDS.Drive.Application' });
  const order = [win, split, north, westPanel, channels, direct, center];
  win.cascade = (fn: (c: unknown) => unknown) => { for (const c of order) if (fn(c) === false) return; };
  win.body = { dom: node('div', { box: { left: 0, top: 0, width: 393, height: 700 } }) };
  win.el.removeClass = (c: string) => win.classes.delete(c);
  const head = node('div', { box: { left: 0, top: 0, width: 393, height: 48 } }, [node('span', { cls: 'x-window-header-text', text: 'Chat' })]);
  win.header = { dom: head };
  d.changed();
  return { d, win, westPanel, channels, direct, head, split, north };
}

test('side navigation: a list of the App\'s items beside its content, taking much of a phone, becomes the menu', () => {
  const chat = listSplit();
  assert.ok(chat.westPanel.el.dom.cls.has('spl-fit-nav-side'));
  assert.ok(chat.win.classes.has('spl-fit-nav'));
  // The selected item names the page
  const page = chat.head.all().find(n => n.cls.has('spl-fit-nav-page'));
  assert.equal(page?.textContent, 'General');
  // Opening an item closes the menu
  chat.win.splNavOpen(true);
  chat.channels.handlers.click();
  chat.d.p.advance(200);
  assert.equal(chat.win.splNavOpen(), false);
  // The top bar grows to its wrapped search box, and the split lays out again
  const before = chat.split.layouts;
  chat.split.layout.onLayout();
  chat.d.p.advance(10);
  assert.equal(chat.north.height, 95);
  assert.ok(chat.split.layouts > before);
  // An App that sets its height back: grown once more, then left alone (no layout loop)
  for (let k = 0; k < 4; k++) { chat.north.height = 50; chat.split.layout.onLayout(); }
  assert.equal(chat.north.height, 50);
  // A narrow list leaves the content room: no menu; a west region without a list is no menu either
  assert.ok(!listSplit({ west: 100 }).westPanel.el.dom.cls.has('spl-fit-nav-side'));
  assert.ok(!listSplit({ lists: false }).westPanel.el.dom.cls.has('spl-fit-nav-side'));
});

/**
 * A package App in its own theme: its outermost tab panel, whose stylesheet lays the strip of
 * tabs out as a dark 240 px column beside the pages, and whose onResize gives the pages the
 * width less that column.
 */
function sideTabPanel({ column = 240, tabs = 3 } = {}) {
  const d = startDsm({ app: 'SYNO.SDS.Drive.Application', type: 'standalone', width: 360 });
  class BorderLayout { onLayout() { return 'laid out'; } }
  class TabPanel {}
  Object.assign(d.ext.full as any, { layout: { ...(d.ext.full as any).layout, BorderLayout }, TabPanel });
  d.p.ctx.document.createElement = (tag: string) => new FakeNode(tag);
  d.p.ctx.document.createElementNS = (_ns: string, tag: string) => new FakeNode(tag);
  d.p.ctx.getComputedStyle = (n: any) => ({ display: '', visibility: '', zIndex: '', paddingLeft: '0', paddingRight: '0', backgroundImage: '', backgroundColor: n?.cs?.backgroundColor ?? 'rgba(0, 0, 0, 0)' });
  const handlers: Record<string, () => void> = {};
  const pages = Array.from({ length: tabs }, (_, k) => ({ title: ['Users', 'Groups', 'Advanced'][k] ?? `Tab ${k}`, rendered: true }));
  const frame = node('div', { box: { left: 0, top: 0, width: 360, height: 700 }, cs: { backgroundColor: 'rgb(37, 40, 45)' } });
  const head = node('div', { box: { left: 0, top: 0, width: column, height: 700 } });
  const bwrap = node('div', { box: { left: column, top: 0, width: 360 - column, height: 700 } });
  const body = node('div', { box: { left: column, top: 0, width: 360 - column, height: 700 } });
  frame.appendChild(head); frame.appendChild(bwrap); bwrap.appendChild(body);
  let layouts = 0;
  const tp: any = Object.assign(Object.create(TabPanel.prototype), {
    rendered: true, hidden: false, activeTab: pages[0],
    el: { dom: frame, addClass: (c: string) => frame.classList.add(c) },
    header: { dom: head }, bwrap: { dom: bwrap, addClass: (c: string) => bwrap.classList.add(c) },
    body: { dom: body, setWidth: (w: number) => { body.box.width = w; } },
    items: { each: (fn: (i: any) => void) => pages.forEach(fn), getCount: () => pages.length },
    on: (ev: string, fn: () => void) => { handlers[ev] = fn; },
    doLayout: () => { layouts++; },
    // The App's own: the pages get the panel's width less the column of tabs
    onResize: () => { body.box.width = 360 - column; },
  });
  const win = d.extWindow({ root: true, title: 'Users', id: 'SYNO.SDS.Drive.Application' });
  win.cascade = (fn: (c: unknown) => unknown) => { for (const c of [win, tp]) if (fn(c) === false) return; };
  win.el.removeClass = (c: string) => win.classes.delete(c);
  win.body = { dom: node('div', { box: { left: 0, top: 0, width: 360, height: 700 } }) };
  const title = node('div', { box: { left: 0, top: 0, width: 360, height: 48 } }, [node('span', { cls: 'x-window-header-text', text: 'Users' })]);
  win.header = { dom: title };
  d.changed();
  return { d, win, tp, head, bwrap, body, frame, title, pages, handlers, layouts: () => layouts };
}

test('side navigation: a tab panel whose tabs a package\'s theme lays out as a column beside its pages becomes the menu', () => {
  const t = sideTabPanel();
  assert.ok(t.head.cls.has('spl-fit-nav-side'), 'the column of tabs is the menu');
  assert.ok(t.win.classes.has('spl-fit-nav'));
  assert.ok(t.frame.cls.has('spl-fit-nav-tabs')); assert.ok(t.bwrap.cls.has('spl-fit-nav-main'));
  // The menu keeps the App's own (dark) colors
  assert.equal(t.head.vars['--spl-fit-nav-bg'], 'rgb(37, 40, 45)');
  // The pages take the whole width, also after the App sizes them again
  assert.equal(t.body.box.width, 360); assert.ok(t.layouts() >= 1);
  t.tp.onResize(); assert.equal(t.body.box.width, 360);
  // The open tab names the page; another tab closes the menu and names it
  const page = () => t.title.all().find(n => n.cls.has('spl-fit-nav-page'))?.textContent;
  assert.equal(page(), 'Users');
  t.win.splNavOpen(true);
  t.tp.activeTab = t.pages[1]; t.handlers.tabchange();
  t.d.p.advance(200);
  assert.equal(t.win.splNavOpen(), false);
  assert.equal(page(), 'Groups');
  // Tabs along the top (a narrow strip), or a single tab, are the App's own: no menu
  for (const setup of [{ column: 60 }, { tabs: 1 }]) {
    const other = sideTabPanel(setup);
    assert.ok(!other.head.cls.has('spl-fit-nav-side'), JSON.stringify(setup));
    assert.equal(other.body.box.width, 360 - (setup.column ?? 240));
  }
});

/** A split with a side region (a filter list) beside its content, laid out by Ext's border layout */
function sideRegion({ side = 'east', width = 78, set = 200, screen = 360 } = {}) {
  const d = dsmPage({ app: 'SYNO.SDS.Drive.Application', type: 'standalone', width: screen });
  class BorderLayout { onLayout() { return 'laid out'; } }
  class GridPanel {}
  (d.ext.core.layout as any).BorderLayout = BorderLayout;
  Object.assign(d.ext.full as any, { grid: { GridPanel } });
  d.p.run(fitJs()); d.defineDsm(); d.start();
  d.p.ctx.document.createElement = (tag: string) => new FakeNode(tag);
  d.p.ctx.getComputedStyle = () => ({ display: '', visibility: '', zIndex: '', paddingLeft: '4px', paddingRight: '4px', backgroundImage: '' });
  const comp = (w: number, extra: Record<string, unknown> = {}): any => {
    const dom = new FakeNode('div', { box: { left: 0, top: 10, width: w, height: 700 } });
    const c: any = {
      rendered: true, hidden: false, el: { dom, hasClass: (k: string) => dom.cls.has(k) }, sized: [] as number[][], placed: [] as number[][],
      getWidth: () => dom.box.width, getHeight: () => dom.box.height,
      setWidth: (v: number) => { dom.box.width = v; c.sized.push([v]); },
      setSize: (a: number, b: number) => { dom.box.width = a; dom.box.height = b; c.sized.push([a, b]); },
      setPosition: (x: number, y: number) => { c.placed.push([x, y]); }, ...extra,
    };
    return c;
  };
  const grid = Object.assign(Object.create(GridPanel.prototype), comp(width - 8));
  const panel = comp(width, { initialConfig: set ? { width: set } : {}, items: { each: (fn: (i: any) => void) => [grid].forEach(fn) } });
  panel.body = { dom: panel.el.dom }; // Ext sizes its body with it
  const center = comp(screen - width);
  const target = new FakeNode('div', { box: { left: 0, top: 0, width: screen, height: 710 } });
  let relaid = 0;
  const layout: any = new BorderLayout();
  Object.assign(layout, {
    container: { getLayoutTarget: () => ({ dom: target, getHeight: () => 710 }), doLayout: () => { relaid++; } },
    center: { panel: center }, [side]: { panel, isCollapsed: false, splitEl: { dom: new FakeNode('div') } },
  });
  return { d, layout, panel, center, grid, target, lay: () => { layout.onLayout(); d.p.advance(10); }, relaid: () => relaid };
}

test('side regions: a filter column squeezed or crushing the content on a phone lies across it, folded to a bar below (east) or above (west)', () => {
  // East, set to 200 px and squeezed to 78: the content takes the width, the column folds to a bar below it
  const east = sideRegion();
  east.panel.title = 'Filter by status';
  east.layout.container.doLayout = () => { east.layout.onLayout(); };
  east.lay();
  assert.ok(east.panel.el.dom.cls.has('spl-fit-stacked'));
  assert.ok(east.panel.el.dom.cls.has('spl-fit-side-folded'), 'folded at first');
  assert.deepEqual(east.center.sized.at(-1), [360, 660]); assert.deepEqual(east.center.placed.at(-1), [0, 10]);
  const bar = east.target.children.find((n: any) => n.cls.has('spl-fit-side-bar')) as any;
  assert.ok(bar, 'a bar for it');
  assert.equal(bar.textContent, 'Filter by status');
  assert.equal(bar.style.top, '670px'); assert.equal(bar.style.width, '360px');
  assert.ok(east.layout.east.splitEl.dom.cls.has('spl-fit-nav-split'), 'its splitbar is out of sight');
  // Tapped: the column opens, 35% of the height below its bar
  bar.fire('click'); east.d.p.advance(10);
  assert.ok(!east.panel.el.dom.cls.has('spl-fit-side-folded'));
  assert.deepEqual(east.center.sized.at(-1), [360, 415]);
  assert.equal(bar.style.top, '425px'); assert.equal(bar.getAttribute('aria-expanded'), 'true');
  assert.deepEqual(east.panel.sized.at(-1), [360, 245]); assert.deepEqual(east.panel.placed.at(-1), [0, 465]);
  assert.equal(east.grid.getWidth(), 352, 'its list takes the new width, less the padding');
  // Laid out again: stays stacked and open; tapped again: folded
  east.lay(); assert.ok(east.panel.el.dom.cls.has('spl-fit-stacked')); assert.deepEqual(east.center.sized.at(-1), [360, 415]);
  bar.fire('click'); east.d.p.advance(10);
  assert.ok(east.panel.el.dom.cls.has('spl-fit-side-folded')); assert.deepEqual(east.center.sized.at(-1), [360, 660]);
  // West, 200 of 360 px: the content left 160 px, under 60%: its bar goes above the content
  const west = sideRegion({ side: 'west', width: 200, set: 0 });
  west.lay();
  assert.deepEqual(west.center.placed.at(-1), [0, 50]);
  west.panel.splSideOpen = true; west.lay();
  assert.deepEqual(west.panel.placed.at(-1), [0, 50]); assert.deepEqual(west.center.placed.at(-1), [0, 295]);
  // Turned to a wide screen: back beside the content at its own width, and the split lays out again
  east.d.p.ctx.innerWidth = 800; east.d.p.ctx.screen.width = 800;
  east.lay();
  assert.ok(!east.panel.el.dom.cls.has('spl-fit-stacked'));
  assert.ok(!east.panel.el.dom.cls.has('spl-fit-side-folded')); assert.equal(bar.style.display, 'none');
  assert.deepEqual(east.panel.sized.at(-1), [78]);
});

test('side regions: a column that fits its set width and leaves the content room, and wide screens, keep the layout', () => {
  for (const [name, setup] of [['fits', { width: 100, set: 110 }], ['no width set, no cut text', { width: 100, set: 0 }], ['wide screen', { screen: 800, width: 78 }]] as const) {
    const r = sideRegion(setup);
    r.lay();
    assert.ok(!r.panel.el.dom.cls.has('spl-fit-stacked'), name);
    assert.equal(r.center.sized.length, 0, name);
  }
});

test('card rows: cards an App fills in after the row is laid out (counts a request brings) form the grid once filled', () => {
  const observers: { fn: (r: unknown[]) => void; on: boolean }[] = [];
  const { p, ct, items, lay } = cardRow({ text: '' });
  items.forEach((c: any) => { if (!c.gap) c.flex = 1; });
  p.ctx.MutationObserver = class { fn: (r: unknown[]) => void; on = false; constructor(fn: (r: unknown[]) => void) { this.fn = fn; observers.push(this); } observe() { this.on = true; } disconnect() { this.on = false; } };
  let relaid = 0;
  ct.el.dom = {}; ct.doLayout = () => { relaid++; lay(); };
  // Empty at layout time: no grid yet, and the row waits for its content
  assert.equal(lay().boxes[0].width, 69);
  assert.equal(ct.height, 154);
  assert.equal(observers.filter(o => o.on).length, 1);
  lay(); assert.equal(observers.length, 1, 'waits once');
  // One card filled is not a row of cards yet
  items[0].el.dom.textContent = 'Host 1';
  observers[0].fn([]); p.advance(0);
  assert.equal(relaid, 0);
  // Filled: laid out again, now as a grid
  items.filter((c: any) => !c.gap).forEach((c: any) => { c.el.dom.textContent = 'Host 1'; });
  observers[0].fn([]); p.advance(0);
  assert.equal(relaid, 1); assert.equal(observers[0].on, false);
  assert.equal(ct.height, 320);
  // Rows of buttons and wide screens never wait
  const buttons = cardRow({ panel: false, text: '' });
  const seen: unknown[] = []; buttons.p.ctx.MutationObserver = class { constructor() { seen.push(1); } observe() {} disconnect() {} };
  buttons.ct.el.dom = {}; buttons.lay();
  const wide = cardRow({ width: 800, text: '' });
  wide.p.ctx.MutationObserver = class { constructor() { seen.push(1); } observe() {} disconnect() {} };
  wide.ct.el.dom = {}; wide.lay();
  assert.equal(seen.length, 0);
});

/**
 * A package's page that runs DSM's desktop inside it (Surveillance Station): no launchApp, the
 * desktop and taskbar of DSM's own framework, an app view of the package's Apps, and an older
 * window manager (a `list` of windows by id, the App's id in its instance's jsConfig).
 */
function embeddedDesk({ path = '/webman/3rdparty/Cams/', taskbar = true, width = 393, appview = true, icons = [] as { id: string; title: string; image: string }[] } = {}) {
  const d = dsmPage({ app: 'SYNO.Cams.Desk', width });
  d.p.ctx.location.search = ''; d.p.ctx.location.pathname = path;
  d.p.ctx.location.href = `https://nas.example.com:5001${path}`;
  const bar = el(), made: any[] = [];
  const cmps: Record<string, any> = {};
  // DSM's app view: its items are components, drawn only when it first opens (an App, then the same App in its search results)
  const item = (jsID: string, title: string) => ({ jsID, title, icon: `images/${jsID}.png?v=1`, rendered: false });
  const items = [{ id: 'panel' }, item('SYNO.Cams.Camera', 'Cameras'), item('SYNO.Cams.Log', 'Log'), item('SYNO.Cams.Unknown', 'Gone'), item('SYNO.Cams.Camera', 'Cameras')];
  if (appview) cmps['sds-appview'] = { cascade(fn: (c: unknown) => void) { [cmps['sds-appview'], ...items].forEach(fn); } };
  const ids: Record<string, unknown> = { 'sds-desktop': d.desk, 'sds-taskbar': taskbar ? bar : null };
  d.p.ctx.document.getElementById = (id: string) => ids[id] ?? null;
  // Nodes the fit makes: the list and its rows
  d.p.ctx.document.createElement = (tag: string) => {
    const handlers: Record<string, () => void> = {};
    const n: any = el({ tagName: tag.toUpperCase(), hidden: false, attrs: {} as Record<string, string>, handlers,
      appendChild(c: unknown) { n.children.push(c); return c; },
      setAttribute(k: string, v: string) { n.attrs[k] = v; },
      addEventListener(type: string, fn: () => void) { handlers[type] = fn; },
      replaceChildren(...c: unknown[]) { n.children = c; }, matches: () => false,
      remove() { const body = d.p.ctx.document.body as any; body.children = body.children.filter((c: unknown) => c !== n); n.removed = true; } });
    n.className = '';
    made.push(n);
    return n;
  };
  d.p.ctx.document.body = el({ appendChild(c: unknown) { (d.p.ctx.document.body as any).children.push(c); return c; } });
  // Newer desktops: icons without components, each carrying its App's id, title and image
  (d.p.ctx.document as any).querySelectorAll = (selector: string) => selector === 'li.launch-icon[syno-id]' ? icons.map(i => ({
    getAttribute: (k: string) => k === 'syno-id' ? i.id : k === 'aria-label' ? i.title : null, textContent: i.title,
    querySelector: (q: string) => q === '.image' ? { style: { backgroundImage: `url("${i.image}")` } } : null })) : [];
  const launched: string[] = [];
  d.sds.AppLaunch = (id: string) => { launched.push(id); };
  d.sds.WindowMgr = { list: {} as Record<string, unknown> };
  d.p.run(fitJs());
  d.defineDsm();
  (d.ext.full as Record<string, unknown>).getCmp = (id: string) => cmps[id];
  // The package's own Apps, as DSM's App map holds them
  d.sds.initFramework = function () { d.sds.Config.FnMap = { 'SYNO.Cams.Camera': { config: { type: 'app' } }, 'SYNO.Cams.Log': { config: { type: 'app' } }, 'SYNO.Cams.Desk': { config: { type: 'app' } } }; };
  d.p.run('SYNO.SDS.init = function () { SYNO.SDS.initFramework(); };'); d.p.scriptLoaded();
  d.start();
  /** An App window in the older window manager */
  const open = (id: string, title: string, dialog = false) => {
    const win = d.extWindow({ id, title, dialog });
    win.appInstance = dialog ? undefined : { jsConfig: { jsID: id } };
    (d.sds.WindowMgr.list as Record<string, unknown>)[`w${Object.keys(d.sds.WindowMgr.list).length}`] = win;
    d.changed();
    return win;
  };
  const list = () => (d.p.ctx.document.body as any).children.find((n: any) => /spl-fit-launcher/.test(n.className));
  const rows = () => list().children.filter((n: any) => n.tagName === 'BUTTON');
  const cover = () => (d.p.ctx.document.body as any).children.find((n: any) => n.className === 'spl-fit-opening');
  return { d, bar, made, launched, open, list, rows, cover };
}

test('embedded desktop: a package page running DSM\'s desktop becomes a list of its Apps instead of a shrunken desktop', () => {
  const e = embeddedDesk();
  e.d.changed();
  assert.equal(e.d.p.ctx.__splFitBack !== undefined, true, 'the shell can step back in it');
  assert.ok(e.d.p.ctx.document.body.classList.has('spl-fit-desk'), 'taskbar, desktop and app view out of sight');
  assert.equal(e.list().hidden, false);
  // Each App of the app view once, in its order, with its icon and title
  assert.deepEqual(e.rows().map((r: any) => r.children.find((n: any) => n.tagName === 'SPAN').textContent), ['Cameras', 'Log']);
  assert.equal(e.rows()[0].children.find((n: any) => n.tagName === 'IMG').src, 'https://nas.example.com:5001/webman/3rdparty/Cams/images/SYNO.Cams.Camera.png?v=1');
  // The list reports the package itself: the shell keeps its name, and back leaves
  assert.deepEqual(e.d.apps().at(-1), { id: '', title: '', page: '', menu: false, icon: '', back: 0 });
  // A row opens the App in this page with DSM's AppLaunch, as one full-screen App. The tap shows the App's
  // icon in a turning arc and its name at once; DSM builds the App after that has been drawn
  e.rows()[1].handlers.click();
  const cover = e.cover();
  assert.equal(cover.attrs.role, 'progressbar'); assert.equal(cover.attrs['aria-label'], 'Log');
  const orbit = cover.children[0];
  assert.deepEqual(orbit.children.map((n: any) => n.className || n.tagName), ['spl-fit-opening-arc', 'IMG']);
  assert.equal(orbit.children[1].src, 'https://nas.example.com:5001/webman/3rdparty/Cams/images/SYNO.Cams.Log.png?v=1');
  assert.equal(cover.children[1].textContent, 'Log');
  assert.deepEqual(e.launched, [], 'not before the cover has been drawn');
  e.d.p.advance(20);
  assert.deepEqual(e.launched, ['SYNO.Cams.Log']);
  // However long DSM takes, the cover stays: no time limit; back would cancel it (one step)
  e.d.p.advance(60000);
  assert.equal(e.cover(), cover); assert.equal(e.d.steps, 1);
  const log = e.open('SYNO.Cams.Log', 'Log');
  // The window is up: the cover fades out, then goes
  assert.ok(cover.classList.has('spl-fit-opening-out'));
  e.d.p.advance(200);
  assert.equal(e.cover(), undefined); assert.equal(cover.removed, true);
  assert.ok(log.classes.has('spl-single-app')); assert.deepEqual(log.size, [393, 800]);
  assert.equal(e.list().hidden, true);
  assert.equal(e.d.apps().at(-1).title, 'Log'); assert.equal(e.d.steps, 1);
  // Back closes the App and returns to the list, never to the launcher
  assert.equal(e.d.back(), true); assert.equal(log.closed, 1);
  e.d.p.advance(1000);
  assert.equal(e.d.closed(), 0);
  assert.equal(e.list().hidden, false);
  assert.equal(e.d.steps, 0); assert.equal(e.d.back(), false);
});

test('embedded desktop: a desktop drawn without components (Surveillance Station 9) lists its icons\' Apps', () => {
  const e = embeddedDesk({ appview: false, icons: [
    { id: 'SYNO.Cams.Camera', title: 'Cameras', image: 'modules/Camera/images/2x/Camera_256.png?v=1' },
    { id: 'SYNO.Cams.Unknown', title: 'Gone', image: '' },
    { id: 'SYNO.Cams.Log', title: 'Log', image: 'https://elsewhere.example.com/log.png' },
  ] });
  e.d.changed();
  assert.ok(e.d.p.ctx.document.body.classList.has('spl-fit-desk'));
  assert.deepEqual(e.rows().map((r: any) => r.children.find((n: any) => n.tagName === 'SPAN').textContent), ['Cameras', 'Log']);
  assert.equal(e.rows()[0].children.find((n: any) => n.tagName === 'IMG').src, 'https://nas.example.com:5001/webman/3rdparty/Cams/modules/Camera/images/2x/Camera_256.png?v=1');
  assert.equal(e.rows()[1].children.some((n: any) => n.tagName === 'IMG'), false, 'no image from another origin');
  e.rows()[0].handlers.click();
  e.d.p.advance(20);
  assert.deepEqual(e.launched, ['SYNO.Cams.Camera']);
});

test('embedded desktop: when its Apps can\'t be read, the desktop shows as it is instead of an empty backdrop', () => {
  const e = embeddedDesk({ appview: false });
  e.d.changed();
  assert.ok(e.d.p.ctx.document.body.classList.has('spl-fit-desk'), 'still looking');
  e.d.p.advance(25_000); e.d.changed();
  assert.equal(e.d.p.ctx.document.body.classList.has('spl-fit-desk'), false);
  assert.equal(e.list(), undefined);
  e.d.changed(); e.d.p.advance(1000);
  assert.equal(e.d.p.ctx.document.body.classList.has('spl-fit-desk'), false, 'and stays that way');
});

test('embedded desktop: a Vue 3 App window (Surveillance Station 9\'s Event Center) ends the opening like any App', () => {
  const e = embeddedDesk();
  (e.d.sds.WindowMgr as any).windowList = e.d.windowList;
  e.d.changed();
  e.rows()[0].handlers.click();
  e.d.p.advance(20);
  const win = e.d.vueWindow({ title: 'Cameras', id: 'SYNO.Cams.Camera', vue3: true });
  assert.equal(win._isVue, undefined);
  // Its framework tells the page nothing: the cover looks again while it is up
  e.d.p.advance(400);
  assert.ok(!e.cover() || e.cover().classList.has('spl-fit-opening-out'), 'the window is the App: the cover fades');
  assert.ok(win.$el.classList.has('spl-single-app'));
  assert.equal(e.list().hidden, true);
  assert.equal(e.d.apps().at(-1).id, 'SYNO.Cams.Camera');
});

test('embedded desktop: a window still under DSM\'s loading mask shows after a moment, the mask being the feedback', () => {
  const e = embeddedDesk();
  e.d.changed();
  e.rows()[0].handlers.click();
  e.d.p.advance(20);
  const mask = el({ offsetWidth: 80, offsetHeight: 20 });
  const make = e.d.extWindow;
  e.d.extWindow = (o: any) => { const w = make(o); w.el.dom.querySelectorAll = (q: string) => /mask/.test(q) ? [mask] : []; return w; };
  e.open('SYNO.Cams.Camera', 'Cameras');
  e.d.p.advance(300);
  assert.ok(e.cover() && !e.cover().classList.has('spl-fit-opening-out'), 'held while DSM builds it');
  e.d.p.advance(1600);
  assert.ok(!e.cover() || e.cover().classList.has('spl-fit-opening-out'), 'then DSM\'s own mask shows');
});

test('embedded desktop: back while an App opens cancels it, and its window is closed when it comes', () => {
  const e = embeddedDesk();
  e.d.changed();
  e.rows()[0].handlers.click();
  e.d.p.advance(100);
  assert.deepEqual(e.launched, ['SYNO.Cams.Camera']);
  assert.equal(e.d.steps, 1, 'the shell\'s back comes to the page');
  assert.equal(e.d.back(), true);
  assert.equal(e.cover(), undefined, 'the cover goes at once');
  assert.equal(e.list().hidden, false);
  assert.equal(e.d.steps, 0);
  // DSM finishes the cancelled App later: its window is closed, the list stays
  const late = e.open('SYNO.Cams.Camera', 'Cameras');
  assert.equal(late.closed, 1);
  assert.equal(e.list().hidden, false);
  // Opened again, it opens normally
  e.rows()[0].handlers.click();
  e.d.p.advance(20);
  const again = e.open('SYNO.Cams.Camera', 'Cameras');
  assert.equal(again.closed ?? 0, 0);
  assert.ok(again.classes.has('spl-single-app'));
});

test('embedded desktop: the opening cover follows reduced motion and keeps every rule scoped', () => {
  const e = embeddedDesk();
  e.d.p.ctx.matchMedia = (q: string) => ({ matches: q === '(prefers-reduced-motion: reduce)' });
  e.d.changed();
  e.rows()[0].handlers.click();
  assert.ok(e.cover().classList.has('spl-fit-opening-still'));
  const css = readFileSync('src/core/webview/mobile-fit/dsm-fit.css', 'utf8');
  // The arc colours two edges of a transparent ring: no grey track
  assert.match(css, /\.spl-fit-opening-arc \{[^}]*border: 3px solid transparent; border-top-color: #1d6fe8; border-right-color: #1d6fe8;/);
  assert.match(css, /\.spl-fit-opening-still \.spl-fit-opening-arc \{ animation: none; transition: none; \}/);
});

test('embedded desktop: a desktop helper (a tour window) is out of sight and no App; dialogs over the list close on back', () => {
  const e = embeddedDesk();
  const tour = e.open('SYNO.Cams.WelcomeTip', '');
  assert.ok(tour.el.dom.classList.has('spl-fit-under'));
  assert.equal(tour.classes.has('spl-single-app'), false);
  assert.equal(e.list().hidden, false); assert.equal(e.d.steps, 0);
  const notice = e.open('', 'Notice', true);
  assert.equal(e.list().hidden, false);
  assert.equal(e.d.steps, 1);
  assert.equal(e.d.back(), true); assert.equal(notice.closed, 1);
  // An App opened from an App on screen is an App, though the list does not offer it
  e.rows()[0].handlers.click();
  e.open('SYNO.Cams.Camera', 'Cameras');
  const child = e.open('SYNO.Cams.Player', 'Player');
  assert.ok(child.classes.has('spl-single-app'));
  assert.equal(e.d.apps().at(-1).title, 'Player'); assert.equal(e.d.steps, 2);
});

test('embedded desktop: DSM\'s own desktop, a single-App page, a page without a taskbar and a tablet keep their fit', () => {
  for (const [name, setup] of [['root', { path: '/' }], ['index', { path: '/webman/index.cgi' }], ['no taskbar', { taskbar: false }], ['tablet', { width: 800 }]] as const) {
    const e = embeddedDesk(setup);
    e.d.changed();
    assert.equal(e.d.p.ctx.__splFitBack, undefined, name);
    assert.equal(e.list(), undefined, name);
    assert.ok(!e.d.p.ctx.document.body.classList.has('spl-fit-desk'), name);
  }
});

test('embedded desktop: DSM\'s own desktop parts keep their widths, so the package starts in full; App windows start at the top', () => {
  const e = embeddedDesk();
  e.d.changed();
  const comp = (width: number, ownerCt: unknown) => ({ width, ownerCt, on() {}, el: { dom: { style: {} } } });
  // An App panel of DSM's app view, out of sight on this page: its 688 px stay, or its drag and drop
  // plugin finds no element and SYNO.SDS.init stops before the package's own start-up
  const appView = { id: 'sds-appview' };
  const panel = comp(688, { id: 'x', ownerCt: appView });
  e.d.ext.hooks.BoxComponent.beforerender(panel);
  assert.equal(panel.width, 688);
  const bar = comp(600, { id: 'sds-taskbar' });
  e.d.ext.hooks.BoxComponent.beforerender(bar);
  assert.equal(bar.width, 600);
  // The package's own panels are fitted as anywhere
  const own = comp(600, { id: 'cams-main' });
  e.d.ext.hooks.BoxComponent.beforerender(own);
  assert.equal(own.width, undefined);
  // The desktop, placed below DSM's taskbar, starts at the top once the taskbar is out of sight: no dark band
  const css = readFileSync('src/core/webview/mobile-fit/dsm-fit.css', 'utf8');
  assert.match(css, /body\.spl-fit-desk #sds-desktop \{ top: 0 !important; height: 100% !important; \}/);
});

test('the shell takes a report of the page\'s own App (no id or title): it keeps the launched App\'s name', () => {
  assert.deepEqual(fitApp({ id: '', title: '', page: '', menu: false, back: 0 }), { id: '', title: '', page: '', menu: false, back: 0 });
  assert.equal(fitApp({ id: '', title: '' }), undefined, 'nothing reported');
  assert.equal(fitApp(null), undefined);
});

/**
 * A welcome dialog laid out for a desktop at 360 px: it fits the screen, but its picture and
 * its text sit side by side, the text past the dialog's right edge. A pager pinned near its
 * bottom and a close button pinned at its top.
 */
function welcomeDialog() {
  const picture = node('div', { cls: 'picture', box: { left: 16, top: 40, width: 326, height: 300 } });
  const title = node('div', { cls: 'title', box: { left: 342, top: 60, width: 300, height: 28 }, text: 'Welcome' });
  const words = node('div', { cls: 'words', box: { left: 342, top: 220, width: 300, height: 100 }, text: 'What the App does' });
  const column = node('div', { cls: 'column', box: { left: 342, top: 40, width: 300, height: 300 } }, [title, words]);
  const row = node('div', { cls: 'row', box: { left: 16, top: 40, width: 328, height: 300 }, cs: { display: 'flex', flexDirection: 'row' } }, [picture, column]);
  const body = node('div', { cls: 'body', box: { left: 16, top: 40, width: 328, height: 300 } }, [row]);
  const pager = node('div', { cls: 'pager', box: { left: 342, top: 300, width: 90, height: 24 }, cs: { position: 'absolute' } }, [node('span', { box: { left: 372, top: 305, width: 30, height: 14 }, text: '1 / 2' })]);
  const close = node('div', { cls: 'close', box: { left: 600, top: 60, width: 24, height: 24 }, cs: { position: 'absolute' } });
  const dialog = node('div', { cls: 'dialog', box: { left: 16, top: 40, width: 328, height: 300 }, cs: { position: 'absolute' } }, [body, pager, close]);
  const mask = node('div', { cls: 'tutorial-mask', box: { left: 0, top: 0, width: 393, height: 800 }, cs: { position: 'fixed' } }, [dialog]);
  return { mask, dialog, body, row, column, words, pager, close };
}
function showDialog(mask: FakeNode) {
  const page = contentPage([]);
  page.body.appendChild(mask);
  page.d.p.ctx.document.querySelectorAll = (sel: string) => page.body.querySelectorAll(sel);
  page.d.changed(); page.d.p.advance(400);
  return page;
}

test('dialog wrap: a dialog that fits the screen but whose row runs past its edge becomes a flowing sheet; the row wraps', () => {
  const w = welcomeDialog();
  showDialog(w.mask);
  assert.ok(w.dialog.cls.has('spl-fit-sheet'), 'a sheet');
  assert.ok(w.dialog.cls.has('spl-fit-sheet-flow'), 'its content flows');
  assert.ok(w.row.cls.has('spl-fit-wrap'), 'the row that runs past the edge wraps');
  // Every box from the row up to the dialog lets the content grow; the dialog itself scrolls
  assert.ok(w.row.cls.has('spl-fit-sheet-chain') && w.body.cls.has('spl-fit-sheet-chain'));
  assert.equal(w.dialog.cls.has('spl-fit-sheet-chain'), false);
  assert.equal(w.column.cls.has('spl-fit-wrap'), false, 'only the row with two boxes or more');
  const css = fitCss();
  assert.match(css, /\.spl-fit-sheet-flow \.spl-fit-sheet-chain \{ height: auto !important; max-height: none !important; overflow: visible !important; max-width: 100% !important; min-width: 0 !important; \}/);
  assert.match(css, /\.spl-fit-sheet-flow \.spl-fit-wrap > \* \{ max-width: 100% !important; min-width: 0 !important; flex-shrink: 1 !important; \}/);
});

test('dialog wrap: the row stays wrapped after the first content pass (not a repair a new width undoes)', () => {
  const w = welcomeDialog();
  const page = showDialog(w.mask);
  page.d.changed(); page.d.p.advance(1000);
  assert.ok(w.row.cls.has('spl-fit-wrap'));
  assert.ok(w.dialog.cls.has('spl-fit-sheet-flow'));
});

test('dialog wrap: a small box pinned over the lower half that the flowed text runs under joins the flow; one at the top stays', () => {
  const w = welcomeDialog();
  showDialog(w.mask);
  assert.ok(w.pager.cls.has('spl-fit-sheet-static'), 'the pager over the last line of text');
  assert.equal(w.close.cls.has('spl-fit-sheet-static'), false, 'the close button at the top stays pinned');
  assert.match(fitCss(), /\.spl-fit-sheet-flow \.spl-fit-sheet-static \{ position: static !important;/);
});

test('dialog wrap: a dialog whose content stays inside it is left as the page drew it', () => {
  const w = welcomeDialog();
  w.column.box = { left: 180, top: 40, width: 160, height: 300 };
  w.words.box = { left: 180, top: 220, width: 160, height: 60 };
  w.pager.box = { left: 180, top: 300, width: 90, height: 24 };
  w.close.box = { left: 316, top: 48, width: 24, height: 24 };
  w.column.kids[0].box = { left: 180, top: 60, width: 160, height: 28 };
  w.row.kids[0].box = { left: 16, top: 40, width: 160, height: 300 };
  showDialog(w.mask);
  assert.equal(w.dialog.cls.has('spl-fit-sheet'), false);
  assert.equal(w.row.cls.has('spl-fit-wrap'), false);
  assert.equal(w.pager.cls.has('spl-fit-sheet-static'), false);
});
