/*
 * DSM mobile fit (a per-NAS setting). Runs at document start in the
 * top frame of a desktop DSM App page. It only changes presentation:
 *  1. the viewport becomes device-width, so DSM's own Vue windows switch to
 *     their built-in narrow ("fit") layout;
 *  2. html gets the `spl-fit` class, and every rule in dsm-fit.css is scoped
 *     to it;
 *  3. Ext windows and dialogs are resized to the screen when they show and
 *     when the screen turns; wizard steps fill the screen; an App's side
 *     navigation becomes a menu behind a title-bar hamburger. No store,
 *     field, validation or handler is touched. Long-press and double-tap
 *     need nothing here: DSM's own Vue components already map them.
 * The build replaces the CSS placeholder below with the stylesheet text.
 */
(function () {
  // A top frame only, or the web shell's App frame, which marks it before adding this script
  if (window !== window.top && !window.__splFitFrame || window.__splFit) return;
  window.__splFit = 1;
  var NARROW = 600;
  var css = __SPL_FIT_CSS__;
  var narrow = function () { return Math.min(screen.width, window.innerWidth) < NARROW; };
  // A DSM Vue window: DSM's own (Vue 2, `_isVue`) or a package's newer framework (Vue 3, such as
  // Surveillance Station 9: a component proxy with its internal instance `$` and its element `$el`)
  var isVue = function (c) { return !!c && (c._isVue === true || (!!c.$ && !!c.$el && typeof c.$el === 'object')); };
  var viewport = 'width=device-width,initial-scale=1';

  var fixViewport = function () {
    // The last viewport meta wins, and DSM ships an empty one: set every one
    var metas = document.querySelectorAll('meta[name=viewport]');
    if (!metas.length && document.head) { var meta = document.createElement('meta'); meta.name = 'viewport'; document.head.appendChild(meta); metas = [meta]; }
    for (var i = 0; i < metas.length; i++) if (metas[i].content !== viewport) metas[i].content = viewport;
  };
  var style;
  var addStyle = function () {
    var root = document.documentElement;
    if (!root) return; // document start can run before <html> exists
    // DSM rewrites html.className during start-up
    if (!root.classList.contains('spl-fit')) root.classList.add('spl-fit');
    if (!style) { style = document.createElement('style'); style.id = 'spl-fit-style'; style.textContent = css; }
    var parent = document.head || root;
    if (style.parentNode !== parent || parent.lastElementChild !== style && document.readyState !== 'loading') parent.appendChild(style);
  };
  var both = function () { fixViewport(); addStyle(); };
  both();
  // Until the head is parsed, watch the document; then only the head and the root class
  var early = new MutationObserver(both);
  early.observe(document, { subtree: true, childList: true, attributes: true, attributeFilter: ['content', 'class'] });
  document.addEventListener('DOMContentLoaded', function () {
    early.disconnect(); both();
    var late = new MutationObserver(both);
    late.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    if (document.head) late.observe(document.head, { subtree: true, childList: true, attributes: true, attributeFilter: ['content'] });
  });

  // Ext windows compute their own pixel size and position. Fit them to the
  // screen: full screen when they do not fit, otherwise clamp and center.
  var fitting = false;
  var fit = function (win) {
    if (fitting || !win || !win.rendered || win.hidden || !win.el || !win.el.dom) return;
    // A single App stays one when the phone turns sideways; other windows are fitted on a phone only
    if (!narrow() && !(singleOn && isApp(win))) return;
    if (win.el.dom.offsetWidth === 0) return;
    var vw = window.innerWidth, vh = window.innerHeight;
    var w = win.getWidth(), h = win.getHeight();
    fitting = true;
    try {
      // The frame fits the screen; the width the App declared still bounds its content (keepWide)
      if (win.splMinWidth === undefined) win.splMinWidth = win.minWidth || 0;
      win.minWidth = Math.min(win.minWidth || 0, vw);
      win.minHeight = Math.min(win.minHeight || 0, vh);
      // Single-App mode: every App window fills the screen with no title row
      if (singleOn && isApp(win) && !win.el.hasClass('spl-single-app')) {
        win.splFull = true; win.el.addClass('spl-single-app');
        win.lastSize = null; // the frame lost its header: lay the body out again
      }
      if (w > vw - 16 || h > vh - 16 || win.splFull) {
        win.splFull = true;
        win.el.addClass('spl-fit-full');
        if (w !== vw || h !== vh || !win.lastSize) win.setSize(vw, vh);
        win.setPagePosition(0, 0);
      } else {
        var xy = win.el.getXY();
        var x = Math.max(8, Math.min(xy[0], vw - w - 8)), y = Math.max(8, Math.min(xy[1], vh - h - 8));
        if (x !== xy[0] || y !== xy[1]) win.setPagePosition(x, y);
      }
      if (win.splFull) drawer(win);
      clamp(win);
      fillSteps(win);
    } catch (e) { /* presentation only; never break the page */ }
    fitting = false;
    if (win.splFull) wideSoon(win);
  };
  // Some panels set their pixel width after render. Top-down, shrink any
  // component that is wider than the element it sits in.
  // A column (an Ext vbox) lays each item out at the item's own width: a
  // dialog's picture, title and text the App's stylesheet sets 500-560 px
  // wide make the column, and the window with it, wider than the screen. An
  // item of a column wider than the screen is capped at the screen (less
  // the column's distance from its edges); the column lays it out again.
  var COL_MIN = 120;
  var capColumn = function (c, dom) {
    var ct = c.ownerCt, layout = ct && ct.layout;
    if (!layout || layout.type !== 'vbox' || !/x-box-item/.test(dom.className)) return null;
    var r = ct.el.dom.getBoundingClientRect(), room = Math.floor(window.innerWidth - 2 * Math.max(0, r.left));
    if (room < COL_MIN) return null;
    if (dom.classList.contains('spl-fit-col')) {
      if (dom.style.getPropertyValue('--spl-fit-cap') === room + 'px') return null;
    } else if (dom.offsetWidth <= room + 2) return null;
    dom.style.setProperty('--spl-fit-cap', room + 'px');
    dom.classList.add('spl-fit-col');
    return ct;
  };
  var clamp = function (root) {
    if (!root || !root.cascade) return;
    if (!narrow()) {
      // The screen turned sideways: the App's own widths come back
      if (root.el && root.el.dom) Array.prototype.forEach.call(root.el.dom.querySelectorAll('.spl-fit-col'), function (e) { e.classList.remove('spl-fit-col'); e.style.removeProperty('--spl-fit-cap'); });
      return;
    }
    var columns = [];
    root.cascade(function (c) {
      if (c === root || !c.rendered || c.hidden || c.floating || !c.el || !c.el.dom || !c.setWidth) return;
      var dom = c.el.dom, parent = dom.parentNode;
      var col = capColumn(c, dom);
      if (col && columns.indexOf(col) < 0) columns.push(col);
      // Content kept at its readable width scrolls sideways in its host (keepWide): never shrink it back
      if (!parent || !dom.offsetWidth || /x-box-item/.test(dom.className) || /x-box-inner/.test(parent.className) || parent.classList.contains('spl-fit-wide')) return;
      var cs = getComputedStyle(parent);
      var avail = parent.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
      if (avail > 0 && dom.offsetWidth > avail + 2) { try { c.setWidth(Math.floor(avail)); } catch (e) { /* ignore */ } }
    });
    columns.forEach(function (ct) { try { ct.doLayout(false, true); } catch (e) { /* its own layout */ } });
  };
  // ---- Keep a readable width ------------------------------------------------
  // Squeezing a desktop layout to the phone works for most pages (labels
  // above fields, one column, grids that scroll). Some cannot shrink: side by
  // side cards or label/value columns end up cut to "共用…" "239.2…". Rule,
  // decided from the rendered page, never from App names:
  //  - squeezed: at least SQUEEZE_MIN visible texts are cut off (see
  //    cutOff), crushed into a column one character wide (see crushed) or
  //    drawn over another text, and they are at least SQUEEZE_SHARE of the
  //    visible texts. Texts in grids, toolbars, tab strips and menus do not count:
  //    those scroll sideways on their own.
  //  - then the content is laid out at the narrowest width (STEP px apart)
  //    that cuts no more than SLACK of the texts beyond what the App's own
  //    width cuts. That width is searched between the screen and what the App
  //    declared: its window minWidth or width; WIDE_FALLBACK when it declared
  //    nothing wider than the screen, never more than WIDE_CAP.
  // The content host (the window, or the center next to a side menu) keeps
  // the screen width; only what it lays out gets wider, and its body is the
  // one sideways scroller. Title, toolbars, footer buttons and the side menu
  // sit outside that body and stay on screen. Not squeezed: nothing changes.
  // WIDE_FALLBACK is 800, for a window that declares nothing wider than the
  // screen: just under the narrowest App window minWidth on DSM 7.2 (Package
  // Center 880; File Station 912, Hyper Backup 1000, Control Panel 1020, Log
  // Center 1070, Storage Manager 1200), so it is never wider than an App that
  // declares its size. WIDE_CAP bounds a declared size.
  var SQUEEZE_MIN = 2, SQUEEZE_SHARE = 0.15, SLACK = 0.1, STEP = 20, WIDE_FALLBACK = 800, WIDE_CAP = 1280, LEAF_CAP = 4000;
  // (A pane folded to its bar: its texts are hidden on purpose, foldPanes())
  var LEAF_SKIP = '.x-grid3, [role=grid], .x-toolbar, .v-toolbar, .x-tab-strip-wrap, .spl-fit-nav-side, .x-menu, .spl-fit-hscroll, .spl-fit-pane:not(.spl-fit-pane-open)';
  /**
   * A text is cut off when its own box hides what overflows (an ellipsis),
   * when it reaches past the side of a box around it that hides overflow, or
   * straddles its bottom edge (too narrow, it wrapped onto a line the box
   * cannot show). A box that scrolls stops the check: what is past its edge
   * can be scrolled to.
   */
  var cutOff = function (e, root, style) {
    if (e.clientWidth > 0 && e.scrollWidth > e.clientWidth + 1 && style(e).overflowX !== 'visible') return true;
    var r = e.getBoundingClientRect();
    for (var a = e.parentElement; a && a !== root; a = a.parentElement) {
      var o = style(a).overflowX;
      if (o === 'auto' || o === 'scroll') return false;
      var oy = style(a).overflowY;
      if (o === 'hidden' || o === 'clip' || oy === 'hidden' || oy === 'clip') {
        var b = a.getBoundingClientRect();
        if ((o === 'hidden' || o === 'clip') && (r.right > b.right + 1 || r.left < b.left - 1)) return true;
        if ((oy === 'hidden' || oy === 'clip') && r.top < b.bottom - 1 && r.bottom > b.bottom + 1) return true;
      }
    }
    return false;
  };
  /** Text crushed into a column: under 2.5 characters wide and over 3 lines high (one character per line) */
  var crushed = function (e, r, style) {
    if (String(e.textContent || '').replace(/\s+/g, '').length < 4) return false;
    var size = px(style(e).fontSize) || 12;
    return r.width < size * 2.5 && r.height > size * 3;
  };
  /** Visible texts in a box, and how many of them are cut off, crushed or drawn over another */
  var clipStats = function (root) {
    var leaves = 0, clipped = 0, overlap = 0, rects = [], all = root.querySelectorAll('*'), styles = typeof Map === 'function' ? new Map() : null;
    var style = function (n) {
      if (!styles) return getComputedStyle(n);
      var s = styles.get(n);
      if (!s) { s = getComputedStyle(n); styles.set(n, s); }
      return s;
    };
    for (var i = 0; i < all.length && i < LEAF_CAP; i++) {
      var e = all[i];
      if (e.firstElementChild || !/\S/.test(e.textContent || '')) continue;
      var r = e.getBoundingClientRect();
      // Too small to read (focus traps), or moved out of the way (Ext hides by offsets)
      if (r.width < 4 || r.height < 4 || r.right < -100 || r.left > 20000 || (e.closest && e.closest(LEAF_SKIP))) continue;
      leaves++;
      if (cutOff(e, root, style) || crushed(e, r, style)) clipped++;
      else rects.push(r);
    }
    // Texts drawn over each other (a line that wrapped into the next row)
    rects.sort(function (a, b) { return a.top - b.top; });
    for (var j = 0; j < rects.length; j++) {
      for (var k = j + 1; k < rects.length && rects[k].top < rects[j].bottom - 3; k++) {
        if (Math.min(rects[j].right, rects[k].right) - Math.max(rects[j].left, rects[k].left) > 3) { overlap++; break; }
      }
    }
    return { leaves: leaves, clipped: clipped + overlap, overlap: overlap };
  };
  var squeezed = function (s) { return s.clipped >= SQUEEZE_MIN && s.clipped >= s.leaves * SQUEEZE_SHARE; };
  /** The box the App's content is laid out in: the center next to a side menu, or the window */
  var hostOf = function (win) {
    var c = null, split = win.splSplit;
    if (split && split.tabs) c = split.tabs.activeTab;
    else if (split && split.ct.items) split.ct.items.each(function (i) { if (i.region === 'center') c = i; });
    return c && c.rendered ? c : win;
  };
  /** Its layout gives children at least splNeed px, whatever room the host has */
  var wrapWide = function (h) {
    var layout = h.layout;
    if (layout.splWide) return;
    var original = layout.getLayoutTargetSize;
    layout.splWide = true;
    layout.getLayoutTargetSize = function () {
      var s = original.apply(this, arguments);
      if (s && typeof s.width === 'number') {
        layout.splBase = s.width;
        // Wider than the host: its sideways scrollbar takes from the height
        if (h.splNeed && s.width < h.splNeed) s = { width: h.splNeed, height: Math.max(0, s.height - (h.splBar || 0)) };
      }
      return s;
    };
  };
  /**
   * The width a box's content keeps: 0 when it is not squeezed. `at(w)` lays
   * the content out at least w px wide (0: as the App does) and measures it;
   * `natural` is the width it has, `declared` the window width the App asked for.
   */
  var decideWidth = function (box, at, natural, declared, now) {
    var base = box.splNeed ? at(0) : now;
    if (!squeezed(base)) return 0;
    var vw = window.innerWidth, frame = Math.max(0, vw - natural);
    var top = Math.min(WIDE_CAP, declared > vw ? declared : WIDE_FALLBACK) - frame;
    if (top <= natural + STEP) return 0;
    var goal = at(top), most = goal.clipped + Math.floor(goal.leaves * SLACK);
    // Only when the width the App declared shows clearly more of its texts
    if (!squeezed({ leaves: goal.leaves, clipped: base.clipped - goal.clipped })) return 0;
    // Cut-off texts only get fewer as the width grows: the narrowest good width.
    // A few may stay cut off (SLACK), but none drawn over another
    var lo = natural, hi = top, good = function (s) { return s.clipped <= most && s.overlap <= goal.overlap; };
    while (hi - lo > STEP) { var mid = Math.round((lo + hi) / 2); if (good(at(mid))) hi = mid; else lo = mid; }
    return hi;
  };
  /**
   * The sideways scroller. It scrolls up and down only if it did before: a box
   * whose content overflowed it by a few pixels (hidden by a box around it)
   * should not get a vertical scrollbar because it now scrolls sideways.
   */
  var wideClass = function (scroller, on) {
    if (on === scroller.classList.contains('spl-fit-wide')) return;
    if (on) {
      var oy = getComputedStyle(scroller).overflowY;
      if (oy !== 'auto' && oy !== 'scroll') scroller.style.setProperty('overflow-y', 'hidden', 'important');
    } else scroller.style.removeProperty('overflow-y');
    scroller.classList.toggle('spl-fit-wide', on);
  };
  /** Decide (again, when the content changed) and apply; box.splNeed is what applies now */
  var widening = false;
  var widen = function (box, at, natural, declared, scroller) {
    scroller = scroller || box;
    if (!narrow()) {
      // Sideways: the App has room again
      if (box.splNeed) { at(0); wideClass(scroller, false); }
      box.splSig = null;
      return;
    }
    // Decide again only when the content changed (more texts once data loads, another page).
    // Rows crushed at the screen's width wrap first (wrapRows): a row that wraps is no reason to widen
    if (!box.splNeed) step(function () { wrapRows(box); });
    var now = clipStats(box), sig = window.innerWidth + '|' + now.leaves + '|' + now.clipped;
    if (box.splSig === sig) return;
    var scroll = scroller.scrollLeft, need = decideWidth(box, at, natural, declared, now);
    wideClass(scroller, need > 0);
    if ((box.splNeed || 0) !== need) at(need);
    if (need) scroller.scrollLeft = scroll;
    var after = clipStats(box);
    box.splSig = window.innerWidth + '|' + after.leaves + '|' + after.clipped;
  };
  /** Ext: the host's layout lays its children out wider; its body scrolls */
  var keepWide = function (win) {
    if (widening || !win || !win.splFull || !win.rendered || win.hidden || !win.el || !win.el.dom || !win.el.dom.offsetWidth) return;
    var h = hostOf(win), layout = h.layout, target = h.getLayoutTarget && h.getLayoutTarget();
    if (!layout || typeof layout.getLayoutTargetSize !== 'function' || !target || !target.dom || !target.dom.offsetWidth) return;
    var box = target.dom;
    widening = true;
    try {
      wrapWide(h);
      var at = function (w) {
        box.splNeed = h.splNeed = w;
        h.doLayout(false, true);
        if (!w) step(function () { wrapRows(box); });
        if (w) {
          // Its sideways scrollbar takes from the height: lay out again without it
          var cs = getComputedStyle(box), bar = box.offsetHeight - box.clientHeight - px(cs.borderTopWidth) - px(cs.borderBottomWidth);
          bar = bar > 0 && box.classList.contains('spl-fit-wide') ? Math.round(bar) : 0;
          if (bar !== (h.splBar || 0)) { h.splBar = bar; h.doLayout(false, true); }
        }
        return clipStats(box);
      };
      var ic = win.initialConfig || {};
      widen(box, at, layout.splBase || box.clientWidth, Math.max(win.splMinWidth || 0, typeof ic.width === 'number' ? ic.width : 0));
    } catch (e) { /* keep DSM's layout */ }
    finally { widening = false; }
  };
  /**
   * Vue: DSM lays a window out with CSS from the window's own width (its
   * narrow layout), so the window itself gets wider and the page area it
   * sits in scrolls. Its title row is the shell's; the back step, the side
   * menu and dialogs bring the scroll back to the start (wideHome).
   */
  var num = function (v) { var n = parseFloat(v); return isNaN(n) ? 0 : n; };
  var keepWideVue = function (c) {
    if (widening || !c || !isVue(c) || !c.$el || !c.$el.classList.contains('spl-single-app')) return;
    var box = c.$el, scroller = box.parentElement;
    if (!scroller || !box.offsetWidth) return;
    widening = true;
    try {
      var at = function (w) {
        box.splNeed = w;
        if (w) box.style.setProperty('width', w + 'px', 'important'); else { box.style.removeProperty('width'); step(function () { wrapRows(box); }); }
        return clipStats(box);
      };
      // A width DSM's own re-render dropped: decide again
      if (box.splNeed && !box.style.getPropertyValue('width')) box.splSig = null;
      var was = box.splNeed || 0;
      widen(box, at, scroller.clientWidth || window.innerWidth, Math.max(num(c.minWidth), num(c.width)), scroller);
      // Charts size themselves on the page's resize: tell them the window changed
      if ((box.splNeed || 0) !== was) setTimeout(function () { try { window.dispatchEvent(new Event('resize')); } catch (e) { /* no charts */ } }, 0);
    } catch (e) { /* keep DSM's layout */ }
    finally { widening = false; }
  };
  /** A menu or a dialog over a widened Vue App opens at the screen's left edge: scroll back there */
  var wideHome = function () {
    windows().forEach(function (w) {
      var el = isVue(w) && w.$el && w.$el.parentElement;
      if (el && el.scrollLeft && el.classList.contains('spl-fit-wide')) el.scrollLeft = 0;
    });
  };
  var wideSoon = function (win) {
    clearTimeout(win.splWideTimer);
    win.splWideTimer = setTimeout(function () { keepWide(win); }, 60);
  };
  // A full-screen wizard keeps each step's form at its desktop pixel height
  // and scrolls inside it, which leaves a blank band above the buttons.
  // Grow the form to what the step title leaves; DSM then sizes the step.
  var fillStep = function (ct) {
    if (!narrow() || !ct.rendered || ct.hidden || !ct.items || !ct.getStep) return;
    var panel = ct.getStep(), used = 0;
    if (!panel || !panel.rendered || !panel.items || panel.items.getCount() !== 1) return;
    ct.items.each(function (i) { if (i !== panel && i.rendered && !i.hidden) used += i.getHeight(); });
    var form = panel.items.first(), avail = ct.getHeight() - used - (panel.getFrameHeight ? panel.getFrameHeight() : 0);
    if (!form.rendered || typeof form.height !== 'number' || avail <= form.getHeight() + 1) return;
    try { form.setHeight(avail); if (ct.fitStepHeight) ct.fitStepHeight(); } catch (e) { /* ignore */ }
  };
  var fillSteps = function (win) {
    if (!win.splFull || !win.el.hasClass('sds-wizard-window')) return;
    win.items.each(function (ct) {
      if (!ct.getStep) return;
      if (!ct.splFill) { ct.splFill = true; ct.on('afterlayout', function () { setTimeout(function () { fillStep(ct); }, 0); }); }
      fillStep(ct);
    });
  };
  // Side navigation becomes a menu, like DSM's own Vue page-list windows:
  // a hamburger in the title bar opens it over the content, the content gets
  // the full width, and the current page name sits next to the App title.
  // Ext: any window whose west region is a SYNO.ux.ModuleList (the base of
  // SYNO.SDS.PageListAppWindow). Vue: Storage Manager's tree sidebar.
  var SVG = 'http://www.w3.org/2000/svg';
  var hamburger = function () {
    var icon = document.createElement('i'), svg = document.createElementNS(SVG, 'svg');
    icon.className = 'spl-fit-nav-toggle v-icon icon-set13';
    icon.setAttribute('role', 'button'); icon.setAttribute('tabindex', '0'); icon.setAttribute('aria-label', 'Menu');
    svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('width', '24'); svg.setAttribute('height', '24'); svg.setAttribute('fill', 'currentColor');
    [6, 11, 16].forEach(function (y) { var r = document.createElementNS(SVG, 'rect'); r.setAttribute('x', '4'); r.setAttribute('y', String(y)); r.setAttribute('width', '16'); r.setAttribute('height', '2'); r.setAttribute('rx', '1'); svg.appendChild(r); });
    icon.appendChild(svg);
    return icon;
  };
  // The window's main split: the outermost BorderLayout container in the
  // window whose west region is navigation, a SYNO.ux.ModuleList or a tree
  // such as File Station's folders, and which holds most of the window
  // (SPLIT_SHARE of its width and height). It may sit beside a narrow rail
  // of its own (Drive's icon column) or inside a padded main panel (Active
  // Backup's Portal): the window itself need not be the split. A tree in a
  // smaller part of the window (a panel of a page) stays where it is.
  // Or the outermost tab panel of that size whose tabs a stylesheet lays out as a column beside
  // its pages (a package App's own theme): the column of tabs is the menu, the pages take the width.
  var SPLIT_SHARE = 0.6, LIST_SHARE = 0.3, NORTH_GROWS = 2;
  /** A tab panel whose strip of tabs stands beside its pages, LIST_SHARE or more of the window wide */
  var sideTabs = function (tp, fullW) {
    var head = tp.header && tp.header.dom, pages = tp.bwrap && tp.bwrap.dom;
    if (!head || !pages || !tp.items || tp.items.getCount() < 2 || !head.getBoundingClientRect) return false;
    var h = head.getBoundingClientRect(), b = pages.getBoundingClientRect();
    return h.width >= fullW * LIST_SHARE && h.height >= tp.el.dom.offsetHeight * SPLIT_SHARE && h.right <= b.left + 2;
  };
  var navSplit = function (win) {
    var List = window.SYNO && SYNO.ux && SYNO.ux.ModuleList, Tree = Ext.tree && Ext.tree.TreePanel, View = Ext.DataView, Tabs = Ext.TabPanel, result = null;
    var body = win.body && win.body.dom, fullW = body ? body.clientWidth : 0, fullH = body ? body.clientHeight : 0;
    if (!fullW || !win.cascade) return null;
    win.cascade(function (ct) {
      if (result) return false;
      var tabs = Tabs && ct instanceof Tabs;
      if (!ct.items || !(tabs || ct.layout instanceof Ext.layout.BorderLayout) || !ct.rendered || ct.hidden || !ct.el || !ct.el.dom) return;
      var d = ct.el.dom;
      if (d.offsetWidth < fullW * SPLIT_SHARE || d.offsetHeight < fullH * SPLIT_SHARE) return;
      if (tabs) { if (sideTabs(ct, fullW)) result = { ct: ct, west: null, tree: null, tabs: ct }; return; }
      ct.items.each(function (i) {
        if (result || i.region !== 'west' || !i.rendered || i.hidden) return;
        var tree = (List && i instanceof List) || (Tree && i instanceof Tree) ? i : (Tree && i.findBy ? i.findBy(function (c) { return c instanceof Tree; })[0] : null);
        if (tree) { result = { ct: ct, west: i, tree: tree }; return; }
        // A list of the App's items (a chat's channels, in DataViews) that takes LIST_SHARE or more
        // of a phone: what is beside it is crushed to a strip. The list becomes the menu
        var lists = View && i.findBy && i.el && i.el.dom && i.el.dom.offsetWidth >= fullW * LIST_SHARE ? i.findBy(function (c) { return c instanceof View && c.rendered; }) : [];
        if (lists.length) result = { ct: ct, west: i, tree: null, lists: lists };
      });
    });
    return result;
  };
  /**
   * Taps that iOS WebKit may not finish. It plays a tap as hover first (mouseover, mousemove) and
   * drops the click when the page reacts to it, may hold it for a double-tap, and shows the
   * keyboard only for a focus made during the touch itself.
   * - In a side menu, a finger lifted where it went down is ended here (no emulated mouse events
   *   follow) and clicked directly: DSM's menus react to hover, so an item took several taps.
   * - On a text field, the field takes the focus as the finger lifts, so the keyboard shows on the
   *   first tap; the tap then goes on as usual (DSM's own handlers, the caret).
   */
  var MENUS = '.spl-fit-nav-side, .module-list-layout';
  var TYPED = /^(|text|search|email|url|tel|password|number)$/i;
  var editable = function (t) {
    var f = t && t.closest && t.closest('input, textarea, [contenteditable="true"]');
    if (!f || f.disabled || f.readOnly) return null;
    return f.tagName !== 'INPUT' || TYPED.test(f.getAttribute('type') || '') ? f : null;
  };
  var hookTaps = function () {
    if (!document.addEventListener) return;
    var start = null;
    var inMenu = function (t) { return t && t.closest && t.closest(MENUS) && !t.closest('input, textarea, select, [contenteditable="true"]'); };
    document.addEventListener('touchstart', function (e) {
      var p = e.touches.length === 1 && e.touches[0], field = p && editable(e.target);
      start = p && (field || inMenu(e.target)) ? { el: e.target, field: field, x: p.clientX, y: p.clientY, at: Date.now() } : null;
    }, { capture: true, passive: true });
    document.addEventListener('touchmove', function (e) {
      var p = e.touches[0];
      if (start && (!p || Math.abs(p.clientX - start.x) > 10 || Math.abs(p.clientY - start.y) > 10)) start = null;
    }, { capture: true, passive: true });
    document.addEventListener('touchcancel', function () { start = null; }, { capture: true, passive: true });
    document.addEventListener('touchend', function (e) {
      var s = start, p = e.changedTouches && e.changedTouches[0];
      start = null;
      if (!s || !p || e.touches.length || Date.now() - s.at > 700 || !s.el.isConnected) return;
      if (Math.abs(p.clientX - s.x) > 10 || Math.abs(p.clientY - s.y) > 10) return;
      if (s.field) { if (document.activeElement !== s.field) { try { s.field.focus(); } catch (err) { /* the tap focuses it as usual */ } } return; }
      e.preventDefault();
      ['mousedown', 'mouseup', 'click'].forEach(function (type) {
        try { s.el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window, detail: 1, button: 0, clientX: p.clientX, clientY: p.clientY, screenX: p.screenX, screenY: p.screenY })); } catch (err) { /* the next tap tries again */ }
      });
    }, { capture: true, passive: false });
  };
  hookTaps();
  /** Where what a box holds ends: the lowest bottom of what is shown in it */
  var contentBottom = function (el) {
    var bottom = el.getBoundingClientRect().bottom, all = el.querySelectorAll('*');
    for (var i = 0; i < all.length && i < 400; i++) {
      var r = all[i].getBoundingClientRect();
      if (r.width && r.height && r.bottom > bottom && all[i].offsetParent !== null && getComputedStyle(all[i]).visibility !== 'hidden') bottom = r.bottom;
    }
    return bottom;
  };
  /** The first background color drawn at or behind an element */
  var backdrop = function (el) {
    for (var e = el; e && e.nodeType === 1; e = e.parentElement) {
      var c = getComputedStyle(e).backgroundColor;
      if (c && c !== 'transparent' && !/^rgba\([^)]*,\s*0\)$/.test(c)) return c;
    }
    return '';
  };
  var drawer = function (win) {
    if (win.splNav || (win.splNavTries || 0) > 20) return;
    var split = navSplit(win), west = split && split.west, tree = split && split.tree, lists = split && split.lists, tabs = split && split.tabs;
    var nav = west ? west.el.dom : tabs ? tabs.header.dom : win.el.dom.querySelector('.v-sm-sidebar'), head = win.header && win.header.dom, body = win.body && win.body.dom;
    // Content may render after the window: look again on later layouts
    if (!nav || !head || !body) { win.splNavTries = (win.splNavTries || 0) + 1; return; }
    win.splNav = nav; win.splSplit = split;
    // The menu lies over the content in the App's own colors (a dark theme stays dark)
    var paint = backdrop(nav);
    if (paint) nav.style.setProperty('--spl-fit-nav-bg', paint);
    win.el.addClass('spl-fit-nav');
    nav.classList.add('spl-fit-nav-side');
    // The region's splitbar stays where the region ended: a line through the content
    var bar = west && document.getElementById(west.id + '-xsplit');
    if (bar) bar.classList.add('spl-fit-nav-split');
    // The content beside the menu is its own stacking layer: an App's positioned
    // rows (Security Advisor's categories use z-index 100) stay under the menu
    if (west) split.ct.items.each(function (i) { if (i !== west && i.el) i.el.addClass('spl-fit-nav-main'); });
    if (tabs) { tabs.el.addClass('spl-fit-nav-tabs'); tabs.bwrap.addClass('spl-fit-nav-main'); }
    var button = hamburger(), page = document.createElement('span'), mask = document.createElement('div');
    page.className = 'spl-fit-nav-page'; mask.className = 'spl-fit-nav-mask';
    head.insertBefore(button, head.firstChild);
    var title = head.querySelector('.x-window-header-text');
    if (title) title.parentNode.insertBefore(page, title.nextSibling); else head.appendChild(page);
    (nav.parentNode || body).appendChild(mask);
    var isOpen = false, pushed = false;
    var open = function (value) {
      if (value === isOpen) return;
      isOpen = value;
      win.el[value ? 'addClass' : 'removeClass']('spl-fit-nav-open');
      button.setAttribute('aria-expanded', value ? 'true' : 'false');
      // Single-App mode keeps one back stack for menus, dialogs and Apps
      if (singleOn) { schedule(); return; }
      // The Android back gesture goes back in WebView history: give it an entry to close the menu
      if (value) { try { history.pushState({ splNav: 1 }, ''); pushed = true; } catch (e) { pushed = false; } }
      else if (pushed) { pushed = false; history.back(); }
    };
    win.splNavOpen = function (value) { if (value === undefined) return isOpen; open(value); };
    win.splPage = page;
    window.addEventListener('popstate', function () { if (isOpen && !singleOn) { pushed = false; open(false); } });
    var stop = function (e) { e.stopPropagation(); };
    button.addEventListener('mousedown', stop); // Ext starts a window drag on mousedown in the header
    button.addEventListener('click', function (e) { e.stopPropagation(); open(!isOpen); });
    mask.addEventListener('mousedown', stop);
    mask.addEventListener('click', function (e) { e.stopPropagation(); open(false); });
    var close = function () { setTimeout(function () { open(false); }, 150); };
    // A page choice closes the menu; expanding a group keeps it open. Ext
    // trees close on a selection change, the Vue sidebar on a page click.
    if (!west && !tabs) nav.addEventListener('click', function (e) {
      var t = e.target;
      if (t.closest && !t.closest('.v-tree-panel-arrow') && t.closest('.v-tree-panel-node-content-wrapper')) close();
    });
    var name = function () {
      var text = '';
      if (tabs) text = tabs.activeTab ? tabs.activeTab.title || '' : '';
      else if (tree) { var n = tree.getSelectionModel && tree.getSelectionModel().getSelectedNode && tree.getSelectionModel().getSelectedNode(); text = n ? (n.text || '') : ''; }
      else if (lists) lists.some(function (v) { var s = v.getSelectedNodes ? v.getSelectedNodes()[0] : null; if (s) text = s.textContent || ''; return !!s; });
      else { var v = nav.querySelector('.v-tree-panel-node-selected .v-tree-panel-title'); text = v ? v.textContent : ''; }
      text = plain(text);
      if (page.textContent !== text) { page.textContent = text; if (singleOn) schedule(); }
    };
    if (tree && tree.getSelectionModel) tree.getSelectionModel().on('selectionchange', function () { setTimeout(name, 0); });
    // Ext fires a tree "click" for a node, not for its expand arrow. ModuleList
    // groups only expand; any other node (File Station folders) opens a page.
    var List = window.SYNO && SYNO.ux && SYNO.ux.ModuleList;
    if (tree && tree.on) tree.on('click', function (node) { if (isOpen && (node.isLeaf() || !(List && tree instanceof List))) close(); });
    // A tab opens its page: the menu closes, the tab's title is the page's
    else if (tabs) tabs.on('tabchange', function () { if (isOpen) close(); setTimeout(name, 0); });
    // An item of a list opens it: the menu closes, its name is the page's
    else if (lists) lists.forEach(function (v) {
      if (!v.on) return;
      v.on('click', function () { if (isOpen) close(); });
      v.on('selectionchange', function () { setTimeout(name, 0); });
    });
    else new MutationObserver(name).observe(nav, { subtree: true, attributes: true, attributeFilter: ['class'] });
    name();
    if (tabs) {
      // The App sizes the pages to its width less the column of tabs: give them the whole width
      var resize = tabs.onResize, full = function () {
        if (!narrow() || !tabs.body || !tabs.el || !tabs.el.dom) return;
        var w = tabs.el.dom.clientWidth;
        if (!w || tabs.body.dom.offsetWidth >= w - 2) return;
        tabs.body.setWidth(w); tabs.doLayout(false, true);
        // Its scrollers measured the pages at their old width
        var pages = tabs.body.dom;
        setTimeout(function () { Array.prototype.forEach.call(pages.querySelectorAll('.flexcrollactive'), unstickScroller); }, 0);
      };
      tabs.onResize = function () {
        var r = resize.apply(this, arguments);
        try { full(); } catch (e) { /* keep the App's layout */ }
        return r;
      };
      try { full(); } catch (e) { /* keep the App's layout */ }
    }
    if (west) {
      // Give the center region the whole width after every border layout
      var ct = split.ct, layout = ct.layout, original = layout.onLayout;
      var widen = function () {
        if (!narrow()) return;
        var grew = false, grownBars = [];
        ct.items.each(function (i) {
          // A top bar whose items wrapped onto a second line at the phone's width (a search box
          // beside the App's name and buttons) runs under the content: it takes the height of
          // what it holds, and the split lays out again: at most NORTH_GROWS times a width, so an
          // App that sets its height back never starts a layout loop
          if (i.region === 'north' && i.rendered && i.el && i.el.dom && i.el.dom.offsetHeight) {
            if (i.splGrowW !== window.innerWidth) { i.splGrowW = window.innerWidth; i.splGrows = 0; }
            var need = Math.ceil(contentBottom(i.el.dom) - i.el.dom.getBoundingClientRect().top);
            if (i.splGrows < NORTH_GROWS && need > i.el.dom.offsetHeight + 4 && need < window.innerHeight / 3) { i.splGrows++; i.height = need; grew = true; if (i.setHeight) grownBars.push([i, need]); }
          }
          if (i.region !== 'center' || !i.rendered) return;
          // Some Apps size the body from the split themselves (Log Center); resize it too
          var w = (ct.body || ct.el).dom.clientWidth, inner = w - (i.getFrameWidth ? i.getFrameWidth() : 0);
          if (i.getWidth() !== w || i.el.dom.offsetLeft !== 0 || (i.body && i.body.dom.offsetWidth < inner - 2)) {
            i.setPosition(0, i.y || 0); i.lastSize = {}; i.setSize(w, i.getHeight());
            if (i.doLayout) i.doLayout();
          }
        });
        if (grew) setTimeout(function () {
          try { grownBars.forEach(function (g) { g[0].setHeight(g[1]); }); ct.doLayout(false, true); } catch (e) { /* keep DSM's layout */ }
        }, 0);
      };
      layout.onLayout = function () {
        var r = original.apply(this, arguments);
        try { widen(); } catch (e) { /* keep DSM's layout */ }
        return r;
      };
      // A page switch can resize the center without a border layout
      if (tree && tree.getSelectionModel) tree.getSelectionModel().on('selectionchange', function () {
        setTimeout(function () { try { widen(); } catch (e) {} }, 0);
      });
      ct.doLayout(false, true);
    }
  };
  var fitAll = function () {
    if (!window.Ext || !Ext.WindowMgr) return;
    var all = [];
    // DSM keeps App and modal windows in more than one manager
    [Ext.WindowMgr, window.SYNO && SYNO.SDS && SYNO.SDS.WindowMgr].forEach(function (mgr) { if (mgr && mgr.each) mgr.each(function (w) { all.push(w); }); });
    Ext.ComponentMgr.all.each(function (c) { if (c instanceof Ext.Window && all.indexOf(c) < 0) all.push(c); });
    all.forEach(fit);
  };
  var hooked = false;
  var hook = function () {
    if (hooked || !window.Ext || !Ext.Window || !Ext.util || !Ext.util.Observable || !Ext.util.Observable.observeClass) return false;
    hooked = true;
    // Panels and fields configured wider than the phone: drop the pixel width
    // and anchor them to their container instead. Windows are handled by fit().
    // On an embedded desktop, DSM's own desktop parts (its app view and taskbar, out of sight
    // there) keep their widths: laid out otherwise, the package's start-up can stop half-way.
    var deskPart = function (c) { for (var p = c, n = 0; p && n < 50; p = p.ownerCt, n++) if (p.id === 'sds-appview' || p.id === 'sds-taskbar') return true; return false; };
    Ext.util.Observable.observeClass(Ext.BoxComponent, {
      beforerender: function (c) {
        if (!narrow() || c.floating || c instanceof Ext.Window || (Ext.menu && c instanceof Ext.menu.Menu)) return;
        if (deskPage && deskPart(c)) return;
        // A minimum width wider than the phone (a message box set to at least 536 px) holds the
        // box past the screen whatever its layout gives it: dropped too
        if (typeof c.boxMinWidth === 'number' && c.boxMinWidth > window.innerWidth - 24) { c.splBoxMinWidth = c.boxMinWidth; delete c.boxMinWidth; }
        if (typeof c.width === 'number' && c.width > window.innerWidth - 24) {
          c.splWidth = c.width; delete c.width;
          if (!c.anchor) c.anchor = '100%';
          // Outside an anchor or form layout the anchor does nothing: the box takes the width of
          // its container instead (an inline-block of positioned parts, a search box, would
          // shrink to nothing). A layout that sizes it sets its own width over this one.
          if (c.on) c.on('render', function () { if (c.el && c.el.dom && !c.el.dom.style.width) { c.el.dom.style.width = '100%'; c.el.dom.style.maxWidth = '100%'; c.el.dom.style.boxSizing = 'border-box'; } }, null, { single: true });
        }
      },
    });
    // Labels above fields: let Ext size fields for the full width. Hook the
    // base class first; subclass hooks then wrap it.
    Ext.util.Observable.observeClass(Ext.Container, {
      beforerender: function (c) {
        if (!narrow()) return;
        var layout = c.layout;
        if (layout === 'form' || (layout && layout.type === 'form') || (Ext.layout.FormLayout && layout instanceof Ext.layout.FormLayout) || (!layout && Ext.form && (c instanceof Ext.form.FormPanel || c instanceof Ext.form.FieldSet))) c.labelAlign = 'top';
      },
    });
    var later = function (win) { setTimeout(function () { fit(win); }, 0); setTimeout(function () { fit(win); }, 300); };
    Ext.util.Observable.observeClass(Ext.Window, {
      show: function (win) { later(win); if (singleOn) schedule(); },
      hide: function () { if (singleOn) schedule(); },
      close: function () { if (singleOn) schedule(); },
      resize: function (win) { if (!fitting) later(win); },
      move: function (win) { if (!fitting && win.splFull) later(win); },
      afterlayout: function (win) { if (!fitting && win.splFull) setTimeout(function () { drawer(win); clamp(win); fillSteps(win); wideSoon(win); }, 0); },
    });
    var timer;
    window.addEventListener('resize', function () { clearTimeout(timer); timer = setTimeout(fitAll, 150); });
    hookGrid();
    hookRows();
    hookCards();
    hookRegions();
    hookEdges();
    fitAll();
    startSingle();
    return true;
  };
  // Force-fit grids squeeze every column into a phone width. When the
  // configured widths need much more room, keep them and let the grid scroll
  // sideways instead.
  var wrapFit = function (view) {
    if (!view || view.splFit || typeof view.fitColumns !== 'function') return;
    var original = view.fitColumns, expand = view.autoExpand;
    view.splFit = true;
    view.fitColumns = function () {
      try { if (narrow() && sizeGrid(this)) return false; } catch (e) { /* fall back to the original behaviour */ }
      return original.apply(this, arguments);
    };
    // A grid without forceFit: its auto-expanding column would take back the room
    if (typeof expand === 'function') view.autoExpand = function () {
      try { if (narrow() && sizeGrid(this)) return; } catch (e) { /* fall back to the original behaviour */ }
      return expand.apply(this, arguments);
    };
    // Column widths follow the values: size again once rows are in
    var again = function () { if (!narrow() || view.splSizing) return; clearTimeout(view.splSizeTimer); view.splSizeTimer = setTimeout(function () { try { sizeGrid(view); } catch (e) { /* the widths stay */ } }, 0); };
    if (view.on) { view.on('refresh', again); view.on('rowsinserted', again); }
  };

  // ---- Grids on a phone ------------------------------------------------------
  // One rule for every Ext grid, from its column model and rendered cells:
  //  1. Each column gets at least its header on two lines, its words whole
  //     (a short Chinese or Japanese header is one word), or its usual value
  //     (an icon, a short level word, a date) on one line.
  //  2. What is left goes to the widest text column, whose cells wrap to at
  //     most three lines instead of one cut-off line.
  //  3. When the least widths are still wider than the grid, the grid scrolls
  //     sideways in its own box with its first column pinned; the page never
  //     gets wider.
  // Grids that keep fixed row heights (virtual scrolling) keep one line per
  // cell; their row detail still shows everything (rowSheet below).
  var GRID_SHORT = 140, GRID_TEXT_MIN = 96, GRID_SAMPLE = 40, GRID_PAD = 6, GRID_HEAD_PAD = 14;
  var measureCtx = null;
  var textWidth = function (text, el) {
    if (!measureCtx) { try { measureCtx = document.createElement('canvas').getContext('2d'); } catch (e) { return text.length * 8; } }
    var cs = getComputedStyle(el);
    measureCtx.font = cs.fontStyle + ' ' + cs.fontWeight + ' ' + cs.fontSize + ' ' + cs.fontFamily;
    return measureCtx.measureText(text).width;
  };
  /** The width of a cell's content on one line */
  var padX = function (el) { var cs = getComputedStyle(el); return px(cs.paddingLeft) + px(cs.paddingRight); };
  var lineWidth = function (el) {
    if (!el || !el.firstChild) return 0;
    // Its content's own width (max-content), whatever the cell's width now
    var ws = el.style.whiteSpace, wd = el.style.width, w;
    el.style.whiteSpace = 'nowrap'; el.style.width = 'max-content';
    w = /\S/.test(el.textContent || '') || el.querySelector('img, svg, canvas, [class*=icon]') ? el.offsetWidth : 0;
    el.style.whiteSpace = ws; el.style.width = wd;
    return w;
  };
  /**
   * A header's least width: its longest word whole, or half of the header when it breaks onto two
   * lines. Chinese and Japanese text has no spaces: a run of up to GRID_HEAD_RUN characters is one
   * word ("大小", "變更時間" never break into single characters); a longer run breaks once, in the middle.
   */
  var GRID_HEAD_RUN = 4, CJK_RUN = /[⺀-鿿豈-﫿＀-￯]+/g;
  var headWidth = function (inner) {
    var text = String(inner.textContent || '').replace(/\s+/g, ' ').trim();
    if (!text) return 0;
    var longest = 0, runs = text.match(CJK_RUN) || [];
    text.replace(CJK_RUN, ' ').split(' ').forEach(function (w) { if (w) longest = Math.max(longest, textWidth(w, inner)); });
    runs.forEach(function (r) {
      var chars = Array.from ? Array.from(r) : r.split(''), unit = chars.length <= GRID_HEAD_RUN ? chars.length : Math.ceil(chars.length / 2);
      longest = Math.max(longest, textWidth(chars.slice(0, unit).join(''), inner), textWidth(chars.slice(chars.length - unit).join(''), inner));
    });
    return Math.ceil(Math.max(longest, textWidth(text, inner) / 2)) + padX(inner) + GRID_HEAD_PAD;
  };
  var GRID_STYLE = 'spl-fit-grid-pin-';
  // DSM's grid rows are see-through: their colour comes from the card far
  // above, and a hovered or selected row only adds a light tint. A pinned
  // cell slides over the cells next to it, so it needs a solid colour.
  var solidBehind = function (e) {
    for (; e && e.nodeType === 1; e = e.parentElement) {
      var c = getComputedStyle(e).backgroundColor, m = /rgba?\(([^)]*)\)/.exec(c || '');
      if (!m) continue;
      var parts = m[1].split(',');
      if (parts.length < 4 || parseFloat(parts[3]) >= 1) return c;
    }
    return '#fff';
  };
  var ROW_STATES = ['x-grid3-row-alt', 'x-grid3-row-over', 'x-grid3-row-selected'];
  /** The tint DSM's stylesheet gives a row in each state, read from a hidden sample row */
  var rowTints = function (body) {
    var tints = {};
    if (!body || !body.appendChild) return tints;
    ROW_STATES.forEach(function (state) {
      var probe = document.createElement('div');
      probe.className = 'x-grid3-row ' + state;
      probe.style.cssText = 'position:absolute;visibility:hidden;height:0;';
      body.appendChild(probe);
      var c = getComputedStyle(probe).backgroundColor;
      body.removeChild(probe);
      if (c && c !== 'transparent' && !/,\s*0\)$/.test(c)) tints[state] = c;
    });
    return tints;
  };
  var pinColumns = function (view, cols) {
    var el = view.grid.el.dom, id = el.id, sheet = document.getElementById(GRID_STYLE + id);
    if (!cols) { if (sheet) sheet.parentNode.removeChild(sheet); return; }
    if (!sheet) { sheet = document.createElement('style'); sheet.id = GRID_STYLE + id; document.head.appendChild(sheet); }
    var body = view.mainBody && view.mainBody.dom, head = view.mainHd && view.mainHd.dom;
    var rowBase = solidBehind(body || el), headBase = solidBehind(head || el), tints = rowTints(body);
    var css = '', left = 0;
    cols.forEach(function (c, n) {
      var td = ' .x-grid3-td-' + String(c.id).replace(/[^\w-]/g, '\\$&'), grid = 'html.spl-fit #' + id;
      var edge = n === cols.length - 1 ? 'box-shadow:1px 0 0 rgba(0,0,0,.08);' : '';
      css += grid + td + '{position:sticky;left:' + left + 'px;z-index:1;' + edge + '}';
      css += grid + ' .x-grid3-row' + td + '{background-color:' + rowBase + ';}';
      css += grid + ' .x-grid3-hd-row' + td + '{background-color:' + headBase + ';z-index:2;}';
      // Later states win, as in DSM's own stylesheet: selected over hovered over striped
      ROW_STATES.forEach(function (state) {
        if (tints[state]) css += grid + ' .' + state + td + '{background-image:linear-gradient(' + tints[state] + ',' + tints[state] + ');}';
      });
      left += c.w;
    });
    if (sheet.textContent !== css) sheet.textContent = css;
  };
  /**
   * DSM's fleXcroll keeps the size its boxes had when it last measured: boxes
   * measured at zero height or width stay at zero (no rows show, and it stops
   * measuring), content boxes measured smaller than their scroller stay smaller
   * (a page laid out beside a side menu before the menu moved aside: a few rows
   * show over an empty list), and boxes measured before a side panel squeezed the grid stay
   * wider than it (the rest is cut off and nothing scrolls). Its content box
   * and its scroll bar box get the scroller's size again; it then measures
   * and sizes them itself.
   */
  var BAR_ROOM = 24;
  var unstickScroller = function (scroller) {
    if (!scroller || !scroller.clientHeight || !scroller.clientWidth || !scroller.fleXcroll || !scroller.fleXcroll.updateScrollBars) return;
    var stuck = [];
    Array.prototype.forEach.call(scroller.children || [], function (c) {
      if (!c.classList || !(c.classList.contains('mcontentwrapper') || c.classList.contains('scrollwrapper'))) return;
      // Its content box is its viewport: as large as the scroller, less at most a scroll bar
      var content = c.classList.contains('mcontentwrapper');
      if (!c.offsetHeight || c.offsetWidth > scroller.clientWidth + 1 || (content && (c.offsetWidth < scroller.clientWidth - BAR_ROOM || c.offsetHeight < scroller.clientHeight - BAR_ROOM))) stuck.push(c);
    });
    if (!stuck.length) return;
    stuck.forEach(function (c) {
      var content = c.classList.contains('mcontentwrapper');
      if (!c.offsetHeight || (content && c.offsetHeight < scroller.clientHeight - BAR_ROOM)) c.style.height = scroller.clientHeight + 'px';
      if (content && c.offsetWidth < scroller.clientWidth - BAR_ROOM) c.style.width = scroller.clientWidth + 'px';
      if (c.offsetWidth > scroller.clientWidth + 1) c.style.width = scroller.clientWidth + 'px';
    });
    try { scroller.fleXcroll.updateScrollBars(); } catch (e) { /* its own bars stay */ }
  };
  // Some DSM grid views (row buffers) answer their scroller's moves by
  // drawing rows only: their header never followed sideways, since on a
  // desktop such grids fit their columns. A grid scrolling sideways takes its
  // header along.
  var followHeader = function (view, scroller) {
    if (!scroller || scroller.splHeader || typeof scroller.onfleXcroll !== 'function' || !view.syncHeaderScroll) return;
    var moved = scroller.onfleXcroll;
    scroller.splHeader = true;
    scroller.onfleXcroll = function () {
      var out = moved.apply(this, arguments);
      try { view.syncHeaderScroll(); } catch (e) { /* the header stays */ }
      return out;
    };
  };
  var sizeGrid = function (view) {
    var cm = view.cm, grid = view.grid;
    if (!cm || !grid || !grid.el || !grid.getGridEl || view.splSizing) return false;
    var avail = grid.getGridEl().getWidth(true) - (view.getScrollOffset ? view.getScrollOffset() : 0);
    if (!(avail >= 100)) return false;
    var scroller = view.scroller && view.scroller.dom;
    var el = grid.el.dom, oneLine = typeof view.rowHeight === 'number' || !!view.isRowRendered;
    view.splSizing = true;
    try {
      el.classList.remove('spl-fit-gridwrap');
      var rows = view.mainBody && view.getRows ? Array.prototype.slice.call(view.getRows(), 0, GRID_SAMPLE) : [], cols = [], fixed = 0;
      for (var i = 0; i < cm.getColumnCount(); i++) {
        if (cm.isHidden(i)) continue;
        var conf = cm.config[i] || {}, now = cm.getColumnWidth(i), col = { i: i, id: cm.getColumnId(i), w: now };
        if (conf.fixed || conf.resizable === false && now <= 40) { col.min = now; col.fixed = true; cols.push(col); fixed += now; continue; }
        var hd = view.getHeaderCell ? view.getHeaderCell(i) : null, inner = hd && (hd.querySelector('.x-grid3-hd-inner') || hd);
        var head = inner ? headWidth(inner) : 0, values = [];
        rows.forEach(function (row) {
          var td = view.getCell ? view.getCell(row.rowIndex, i) : null, ci = td && (td.querySelector('.x-grid3-cell-inner') || td);
          var w = ci ? lineWidth(ci) : 0;
          if (w > 0) values.push(w);
        });
        values.sort(function (a, b) { return a - b; });
        // The usual value: most rows' width (a few long ones wrap or scroll)
        var usual = values.length ? values[Math.min(values.length - 1, Math.floor(values.length * 0.9))] + GRID_PAD : 0;
        col.usual = usual;
        col.text = usual > GRID_SHORT;
        // Cells that cannot wrap (fixed row heights) show their usual value whole, up to most of the grid
        col.min = Math.max(head, col.text ? (oneLine ? Math.min(usual, Math.round(avail * 0.7)) : Math.min(usual, GRID_TEXT_MIN)) : usual, 32);
        cols.push(col);
      }
      if (!cols.length) return false;
      var sum = 0, widest = null;
      cols.forEach(function (c) {
        c.w = c.min; sum += c.min;
        if (!c.fixed && (!widest || (c.text && !widest.text) || (c.text === widest.text && c.usual > widest.usual))) widest = c;
      });
      var scroll = sum > avail + 1;
      if (widest) {
        // The text column takes what is left, or a readable share while the grid scrolls
        if (!scroll) widest.w += avail - sum;
        else if (widest.text) widest.w = Math.max(widest.w, Math.min(widest.usual, Math.round(avail * 0.6)));
      }
      cols.forEach(function (c) { if (!c.fixed && cm.getColumnWidth(c.i) !== c.w) cm.setColumnWidth(c.i, c.w, true); });
      if (view.updateAllColumnWidths) view.updateAllColumnWidths();
      el.classList.toggle('spl-fit-hscroll', scroll);
      el.classList.toggle('spl-fit-gridwrap', !oneLine);
      // Headers are never virtual: they break onto two lines in every grid
      el.classList.add('spl-fit-gridhead');
      el.classList.add('spl-fit-gridsized');
      // The first column stays in view: a check box column takes the next one with it
      var pin = scroll ? cols.slice(0, cols[0].fixed && cols.length > 2 ? 2 : 1) : null;
      pinColumns(view, pin);
      if (view.syncHeaderScroll) view.syncHeaderScroll();
      // DSM's own scroller (fleXcroll) measured the old widths and heights:
      // without measuring again it does not scroll sideways at all
      unstickScroller(scroller);
      if (scroll) followHeader(view, scroller);
      if (scroller && scroller.fleXcroll && scroller.fleXcroll.updateScrollBars) {
        try { scroller.fleXcroll.updateScrollBars(); } catch (e) { /* its own bars stay */ }
      }
      return true;
    } finally {
      view.splSizing = false;
    }
  };
  // Grid views come in several subclasses that override fitColumns, so wrap
  // each grid's own view before it renders.
  // Toolbars wider than the phone scroll sideways (dsm-fit.css), Ext and
  // Vue alike. Their edge fades where more buttons are, so a cut-off button
  // reads as "scroll". (DSM's Vue v-overflow-list moves extra buttons into a
  // "more" menu, but Ext's equivalent cannot hold DSM's toolbar fields, such
  // as File Station's path box, so it is not used.)
  var TOOLBARS = '.x-toolbar, .v-toolbar > .main-wrapper';
  var edges = function (el) {
    if (!el || !el.classList || !narrow()) return;
    var room = el.scrollWidth - el.clientWidth, more = room > 2 && el.clientWidth > 0;
    if (el.classList.contains('spl-fit-more-start') !== (more && el.scrollLeft > 2)) el.classList.toggle('spl-fit-more-start');
    if (el.classList.contains('spl-fit-more-end') !== (more && el.scrollLeft < room - 2)) el.classList.toggle('spl-fit-more-end');
  };
  var edgeTimer = null;
  var scanEdges = function () {
    clearTimeout(edgeTimer);
    edgeTimer = setTimeout(function () {
      var all = document.querySelectorAll(TOOLBARS);
      for (var i = 0; i < all.length; i++) edges(all[i]);
    }, 120);
  };
  var hookEdges = function () {
    // scroll does not bubble: catch it on the way down
    document.addEventListener('scroll', function (e) { var t = e.target; if (t && t.matches && t.matches(TOOLBARS)) edges(t); }, { capture: true, passive: true });
    // Pages render after a tap, layouts and turns of the screen
    document.addEventListener('click', function () { scanEdges(); setTimeout(scanEdges, 600); }, true);
    window.addEventListener('resize', scanEdges);
    if (Ext.Toolbar) Ext.util.Observable.observeClass(Ext.Toolbar, { afterlayout: scanEdges });
    scanEdges();
  };
  // A collapsed region (File Station's task monitor, any App's side or
  // bottom panel) stays as DSM's own bar with its expand button, but flush
  // with the content and the screen edge: Ext keeps 5 px collapsed margins.
  var NONE = { top: 0, right: 0, bottom: 0, left: 0 }, REGION_MAX = 0.7, grownRegions = [];
  /** Content laid out again after its border layout (Ext forms do): lay the regions out again */
  var regrowRegions = function () {
    grownRegions = grownRegions.filter(function (l) {
      var ct = l.container;
      if (!ct || ct.isDestroyed || !ct.rendered) return false;
      var off = ['north', 'south'].some(function (k) {
        var p = l[k] && l[k].panel, b = p && p.rendered && !p.hidden && p.body && p.body.dom;
        return !!b && b.offsetHeight > 0 && Math.abs(b.scrollHeight - b.clientHeight) > 2 && !b.classList.contains('spl-fit-region-scroll');
      });
      if (off) { try { ct.doLayout(false, true); } catch (e) { /* keep DSM's layout */ } }
      return true;
    });
  };
  // Apps draw their expand and collapse buttons with their own images, and
  // some only for their standalone main window (File Station's task monitor
  // opened on top of another App has none): draw a plain arrow on a button
  // that has no image, so it never becomes an invisible tap target.
  var TOOLS = '.x-tool-expand-north, .x-tool-expand-south, .x-tool-expand-east, .x-tool-expand-west, .x-tool-collapse-north, .x-tool-collapse-south, .x-tool-collapse-east, .x-tool-collapse-west';
  var markTools = function (el) {
    if (!el || !el.querySelectorAll) return;
    Array.prototype.forEach.call(el.querySelectorAll(TOOLS), function (tool) {
      var bare = false;
      try { bare = getComputedStyle(tool).backgroundImage === 'none'; } catch (e) { bare = false; }
      tool.classList.toggle('spl-fit-tool-mark', bare);
    });
  };
  // A side region (a filter list, a details panel) on a phone that leaves the content under
  // SIDE_ROOM of the row, or is itself squeezed under SIDE_SQUEEZE of the width it was set to,
  // or under SIDE_NARROW px with its texts cut (a rail of icons has no text): the content takes the whole width, and the region lies across it, a west
  // one above it and an east one below, SIDE_SHARE of the height (it scrolls inside). Only in a
  // split that takes most of the screen, and not the side menu, which drawer() has made.
  var SIDE_ROOM = 0.6, SIDE_MIN = 0.25, SIDE_SQUEEZE = 0.75, SIDE_NARROW = 160, SIDE_SCREEN = 0.6, SIDE_SHARE = 0.35;
  /** A text in the box that is cut off (cutOff()) */
  var cutText = function (box) {
    var all = box.querySelectorAll('*'), style = function (n) { return getComputedStyle(n); };
    for (var i = 0; i < all.length && i < 400; i++) {
      var e = all[i];
      if (!e.firstElementChild && /\S/.test(e.textContent || '') && e.offsetWidth > 0 && cutOff(e, box, style)) return true;
    }
    return false;
  };
  var SIDE_BAR = 40;
  /** The region's own label: its title, the value of its first field (a filter pick) or its first text */
  var sideLabel = function (p) {
    if (p.title) return String(p.title);
    var d = p.el.dom, field = d.querySelector && d.querySelector('input');
    if (field && field.value) return field.value;
    var all = d.querySelectorAll ? d.querySelectorAll('*') : [];
    for (var i = 0; i < all.length && i < 200; i++) if (!all[i].firstElementChild && /\S/.test(all[i].textContent || '')) return all[i].textContent.trim();
    return '';
  };
  /** The bar a stacked side region folds to: tapped, it opens the region or folds it again */
  var sideBar = function (layout, p, t) {
    var bar = p.splSideBar;
    if (!bar) {
      bar = p.splSideBar = document.createElement('button');
      bar.type = 'button'; bar.className = 'spl-fit-side-bar';
      var text = bar.splText = document.createElement('span'); text.className = 'spl-fit-side-bar-text'; bar.appendChild(text);
      bar.addEventListener('click', function (e) {
        e.stopPropagation(); p.splSideOpen = !p.splSideOpen;
        try { layout.container.doLayout(false, true); } catch (err) { /* its own layout */ }
      });
    }
    if (bar.parentNode !== t) t.appendChild(bar);
    bar.style.display = '';
    bar.splText.textContent = sideLabel(p);
    return bar;
  };
  var stackSides = function (layout) {
    var c = layout.center && layout.center.panel, target = layout.container && layout.container.getLayoutTarget && layout.container.getLayoutTarget();
    var t = target && target.dom;
    ['east', 'west'].forEach(function (k) {
      var r = layout[k], p = r && r.panel;
      if (!p || !p.el || !p.el.dom) return;
      var was = p.el.dom.classList.contains('spl-fit-stacked');
      var on = narrow() && !!c && !!t && c.rendered && !c.hidden && !r.isCollapsed && p.rendered && !p.hidden && !p.el.hasClass('spl-fit-nav-side');
      var W = on ? t.clientWidth : 0;
      if (on && !was) {
        var pw = p.getWidth(), set = (p.initialConfig && p.initialConfig.width) || 0;
        var crushes = pw >= W * SIDE_MIN && c.getWidth() < W * SIDE_ROOM, squeezed = (typeof set === 'number' && pw < set * SIDE_SQUEEZE) || (pw < SIDE_NARROW && cutText(p.el.dom));
        on = W >= window.innerWidth * SIDE_SCREEN && (crushes || squeezed);
        if (on) p.splSideW = pw;
      }
      on = on && W > 0;
      p.el.dom.classList.toggle('spl-fit-stacked', on);
      if (!on) { p.el.dom.classList.remove('spl-fit-side-folded'); if (p.splSideBar) p.splSideBar.style.display = 'none'; p.splSideCh = null; }
      var bar = r.splitEl && r.splitEl.dom;
      if (bar) bar.classList.toggle('spl-fit-nav-split', on);
      // Back beside the content (a wider screen): its own width again, and the split lays out again
      if (!on) {
        if (was && p.splSideW) setTimeout(function () { try { p.setWidth(p.splSideW); layout.container.doLayout(false, true); } catch (e) { /* its own layout */ } }, 0);
        return;
      }
      // Folded to a bar with its own label until tapped, so the content keeps the screen
      // (Ext sizes the content to the whole height again on each layout; one it left as set keeps the old height)
      var top = c.el.dom.offsetTop, ch = c.getHeight(), open = !!p.splSideOpen;
      if (p.splSideCh && Math.abs(ch - p.splSideCh.content) <= 2) ch = p.splSideCh.all;
      var h = open ? Math.round(ch * SIDE_SHARE) : 0, bar = sideBar(layout, p, t);
      var rest = ch - SIDE_BAR - h, barTop = k === 'west' ? top : top + rest;
      bar.style.top = barTop + 'px'; bar.style.width = W + 'px';
      bar.classList.toggle('spl-fit-side-open', open);
      bar.setAttribute('aria-expanded', open ? 'true' : 'false');
      c.setPosition(0, k === 'west' ? top + SIDE_BAR + h : top); c.setSize(W, rest);
      p.splSideCh = { content: rest, all: ch };
      p.el.dom.classList.toggle('spl-fit-side-folded', !open);
      if (!open) return;
      p.setPosition(0, k === 'west' ? top + SIDE_BAR : top + rest + SIDE_BAR); p.setSize(W, h);
      // A list in it sized for the narrow column takes its new width
      var inner = p.body && p.body.dom, cs = inner && getComputedStyle(inner), room = inner ? inner.clientWidth - px(cs.paddingLeft) - px(cs.paddingRight) : 0;
      if (room > 0 && p.items && p.items.each && Ext.grid && Ext.grid.GridPanel) p.items.each(function (i) {
        if (i instanceof Ext.grid.GridPanel && i.rendered && !i.hidden && i.getWidth() < room - 2) i.setWidth(room);
      });
    });
  };
  var hookRegions = function () {
    var Border = Ext.layout.BorderLayout;
    if (!Border || !Border.prototype.onLayout || Border.prototype.onLayout.splRegions) return;
    var original = Border.prototype.onLayout;
    var wrapped = function () {
      var result = original.apply(this, arguments), again = false, self = this, regions = [];
      if (narrow()) ['north', 'south', 'east', 'west'].forEach(function (k) {
        var r = self[k], m = r && r.cmargins;
        if (!r) return;
        regions.push(r);
        if (m && (m.top || m.right || m.bottom || m.left)) { r.cmargins = NONE; if (r.isCollapsed) again = true; }
      });
      if (again) result = original.apply(this, arguments);
      // A top or bottom region sized for the desktop whose content grew (labels above
      // fields, wrapped text) hides that content under the center: it grows to its
      // content, at most REGION_MAX of the layout, and scrolls past that
      again = false;
      if (narrow()) ['north', 'south'].forEach(function (k) {
        var r = self[k], p = r && r.panel, target = self.container && self.container.getLayoutTarget && self.container.getLayoutTarget();
        if (!p || r.isCollapsed || !p.rendered || p.hidden || !p.body || !p.body.dom || !target) return;
        var b = p.body.dom;
        if (p.splHeight === undefined) {
          if (b.scrollHeight <= b.clientHeight + 2) return;
          p.splHeight = p.getHeight();
          if (grownRegions.indexOf(self) < 0) grownRegions.push(self);
        }
        // Where its content ends (scrollHeight never drops below the box): the height that holds it
        var top = b.getBoundingClientRect().top - b.scrollTop, end = 0;
        Array.prototype.forEach.call(b.children, function (c) {
          if (!inFlow(c)) return;
          end = Math.max(end, c.getBoundingClientRect().bottom - top + px(getComputedStyle(c).marginBottom));
        });
        var h = p.getHeight(), want = h - b.clientHeight + end + px(getComputedStyle(b).paddingBottom);
        var most = Math.round(target.getHeight(true) * REGION_MAX), next = Math.max(p.splHeight, Math.min(want, most));
        b.classList.toggle('spl-fit-region-scroll', want > most);
        if (Math.abs(next - h) <= 2) return;
        p.setHeight(next);
        again = true;
      });
      if (again) result = original.apply(this, arguments);
      stackSides(self);
      regions.forEach(function (r) {
        markTools(r.collapsedEl && r.collapsedEl.dom);
        markTools(r.panel && r.panel.el && r.panel.el.dom);
      });
      return result;
    };
    wrapped.splRegions = true;
    Border.prototype.onLayout = wrapped;
  };
  // ---- Card rows ------------------------------------------------------------
  // Ext's hbox layout puts panels side by side at shares of the row: summary
  // cards, chart boxes, info panels. On a phone each one gets a sliver and
  // its content is cut. Rule, decided from the layout, never from App names:
  // a row of at least two panels (spacer boxes aside) whose boxes come out
  // narrower than a card may be lays them out as a grid instead, as many
  // columns as fit, each row at the row's own height. A card is at least
  // CARD_MIN wide, and at least CARD_ASPECT of its height (a tall chart
  // box takes the full width rather than a strip). The row then grows to hold
  // the grid, and the vbox it sits in scrolls when its content no longer fits.
  // Rows of buttons or fields, toolbars and composite fields are not cards.
  // A row is also a grid when its boxes run past its edge, cut off by it: a
  // chart Ext sizes from its content (as wide as its canvas) next to a box of
  // fixed width, such as a pie chart with its labels beside a line chart, or
  // panels of fixed width, such as menus to pick a host under a chart.
  var CARD_MIN = 140, CARD_ASPECT = 0.6, CARD_GAP = 12;
  // A box with nothing in it (an empty panel or box between the cards, or one
  // whose only content is hidden, such as a menu an App shows only when there
  // is something to pick). A chart's box before its canvas is drawn is not empty.
  var SHOWN = 'img, svg, canvas, input, button, [style*="background-image"], [class*=icon], [_echarts_instance_]';
  // (Hidden inside the box, by Ext or a style: the box itself may not be shown yet)
  var hiddenIn = function (e, d) {
    for (; e && e !== d; e = e.parentElement) {
      if ((e.style && e.style.display === 'none') || (e.classList && (e.classList.contains('x-hide-display') || e.classList.contains('x-hide-offsets') || e.classList.contains('x-hide-visibility')))) return true;
    }
    return false;
  };
  var spacer = function (c) { var d = c.el && c.el.dom; return !!d && !/\S/.test(d.textContent || '') && !Array.prototype.some.call(d.querySelectorAll(SHOWN), function (e) { return !hiddenIn(e, d); }); };
  var holdsChart = function (c) { var d = c && c.el && c.el.dom; return !!d && !!d.querySelector(CHART); };
  // A card of the grid: its content, set wider in a stylesheet (a desktop
  // min-width), stays inside the card with its border, never cut off by it
  var cardClass = function (c, on) { var d = c.el && c.el.dom; if (d && d.classList) d.classList.toggle('spl-fit-card', on); };
  // Cards an App fills in after the row is laid out (summary counts a request
  // brings) are empty boxes at layout time, and Ext does not lay the row out
  // again when their content comes: a row of at least two empty flexed panels
  // squeezed under a card's width watches its own content, once, and is laid
  // out again when two of them hold something (the grid then decides).
  var waitFilled = function (ct, items) {
    var d = ct.el && ct.el.dom;
    if (ct.splWaitFill || !d || !window.MutationObserver) return;
    ct.splWaitFill = true;
    var watch = new MutationObserver(function () {
      var filled = items.filter(function (c) { return c instanceof Ext.Panel && !spacer(c); }).length;
      if (filled < 2) return;
      watch.disconnect(); ct.splWaitFill = false;
      setTimeout(function () { try { if (!ct.isDestroyed) ct.doLayout(false, true); } catch (e) { /* its own layout */ } }, 0);
    });
    watch.observe(d, { subtree: true, childList: true, characterData: true });
  };
  var cardGrid = function (layout, items, size, result) {
    var ct = layout.container, boxes = result.boxes, cards = [], empty = 0, i;
    if (!narrow() || !ct || !ct.el || (Ext.Toolbar && ct instanceof Ext.Toolbar) || ct.el.hasClass('x-form-composite') || !(size.width > 0)) return false;
    for (i = 0; i < items.length; i++) {
      if (spacer(items[i])) { if (items[i].flex && items[i] instanceof Ext.Panel && (boxes[i].width || 0) < CARD_MIN) empty++; continue; }
      if (items[i] instanceof Ext.Panel) cards.push(i); else return false;
    }
    if (cards.length + empty >= 2 && cards.length < 2) waitFilled(ct, items);
    if (cards.length < 2) return false;
    var pad = layout.padding || { top: 0, left: 0, right: 0, bottom: 0 }, room = size.width - (layout.scrollOffset || 0) - pad.left - pad.right;
    // The row's own height before it changes (not yet laid out: nothing to decide)
    if (!ct.splRowH) {
      var tall = 0;
      cards.forEach(function (j) { tall = Math.max(tall, boxes[j].height || 0); });
      ct.splRowH = /stretch/.test(layout.align || '') ? size.height - pad.top - pad.bottom : tall;
    }
    var rowH = ct.splRowH, least = Math.max(CARD_MIN, rowH * CARD_ASPECT), narrowest = Infinity, right = 0;
    cards.forEach(function (j) { narrowest = Math.min(narrowest, boxes[j].width || 0); right = Math.max(right, (boxes[j].left || 0) + (boxes[j].width || 0)); });
    var over = right > pad.left + room + 1;
    if (!(rowH > 0) || (narrowest >= least && !over)) return false;
    var cols = Math.max(1, Math.min(cards.length, Math.floor((room + CARD_GAP) / (least + CARD_GAP))));
    // (Run past the edge: no column narrower than the widest box, which may
    // hold content of a fixed width, such as a menu; at most the full width)
    if (over) { var widest = 0; cards.forEach(function (j) { widest = Math.max(widest, boxes[j].width || 0); }); cols = Math.min(cols, Math.max(1, Math.floor((room + CARD_GAP) / (Math.min(widest, room) + CARD_GAP)))); }
    if (cols >= cards.length) return false;
    var w = Math.floor((room - CARD_GAP * (cols - 1)) / cols), rows = Math.ceil(cards.length / cols);
    for (i = 0; i < boxes.length; i++) if (cards.indexOf(i) < 0) { boxes[i].left = -10000; boxes[i].top = 0; boxes[i].width = 0; boxes[i].dirtySize = true; }
    cards.forEach(function (j, k) {
      var box = boxes[j], m = items[j].margins || { left: 0, right: 0, top: 0, bottom: 0 };
      cardClass(items[j], true);
      box.left = pad.left + (k % cols) * (w + CARD_GAP);
      box.top = pad.top + Math.floor(k / cols) * (rowH + CARD_GAP);
      box.width = w - m.left - m.right; box.height = rowH - m.top - m.bottom; box.dirtySize = true;
    });
    return pad.top + pad.bottom + rows * rowH + (rows - 1) * CARD_GAP;
  };
  // ---- Gaps between squeezed items ---------------------------------------------
  // An hbox spaces its items with empty boxes (Ext spacers, blank containers,
  // a separator line) at desktop pixel widths, and shares what is left among
  // its flexed items. On a phone the gaps keep their pixels while the items
  // get a sliver and their text is cut ("Share…"). Rule, from the layout
  // alone: in a row of at least two flexed items with an empty box (spacer())
  // among them, when a flexed item comes out narrower than a card may be
  // (CARD_MIN), the row is laid out again without its empty boxes, which drop
  // out of sight as they do in a card grid. Rows that push an item to the side
  // (one empty flexed box between items of their own width) have fewer than
  // two flexed items and keep their layout; nothing changes on a wide screen.
  // The card grid then decides on the boxes this leaves.
  var dropGaps = function (layout, calc, items, size, result) {
    if (!narrow() || !(size.width > 0)) return result;
    var kept = [], gaps = 0, flexed = 0, narrowest = Infinity, i;
    for (i = 0; i < items.length; i++) {
      if (spacer(items[i])) { gaps++; continue; }
      kept.push(items[i]);
      if (!items[i].flex) continue;
      flexed++;
      narrowest = Math.min(narrowest, (result.boxes[i] && result.boxes[i].width) || 0);
    }
    if (flexed < 2 || !gaps || narrowest >= CARD_MIN) return result;
    var inner = calc.call(layout, kept, size), boxes = [], k = 0;
    for (i = 0; i < items.length; i++) {
      boxes.push(kept[k] === items[i] ? inner.boxes[k++] : { component: items[i], left: -10000, top: 0, width: 0, height: 0, dirtySize: true });
    }
    inner.boxes = boxes;
    return inner;
  };
  // The row's own height follows its grid; its owner lays out again. An owner
  // of a fixed height that does not stack its items (a plain panel) grows by
  // as much as the row, or it would cut off the grid's lower cards and what
  // follows the row; it gets its height back with the row's.
  var cardHeight = function (ct, inner) {
    // Header, borders and padding around the grid: measured once, before the row changes
    if (ct.splFrame === undefined) ct.splFrame = Math.max(0, ct.getHeight() - ct.getLayoutTarget().getHeight(true));
    var was = ct.getHeight();
    var want = inner === false ? ct.splH0 : inner + ct.splFrame;
    if (inner === false) { if (!ct.splGridded) return; ct.splGridded = false; ct.splRowH = ct.splFrame = undefined; ct.flex = ct.splFlex; ct.height = ct.splH0; }
    else {
      if (!ct.splGridded) { ct.splGridded = true; ct.splH0 = ct.height; ct.splFlex = ct.flex; ct.splWas = was; }
      if (ct.height === want) return;
      ct.height = want; ct.flex = 0;
    }
    setTimeout(function () {
      try {
        if (typeof want === 'number') ct.setHeight(want);
        // What the row adds to its owner: its growth over its height before the
        // grid, kept per row, so that layouts in between never add up wrong
        var owner = ct.ownerCt, gave = ct.splGave || 0, grow = (ct.splGridded ? (typeof want === 'number' ? want : ct.getHeight()) - (ct.splWas || was) : 0) - gave;
        if (!ct.splGridded) ct.splWas = undefined;
        if (owner && grow && typeof owner.height === 'number' && !(owner.layout instanceof Ext.layout.BoxLayout)) {
          ct.splGave = gave + grow || undefined;
          owner.splGrown = (owner.splGrown || 0) + grow; owner.height += grow; owner.setHeight(owner.height);
          if (!owner.splGrown) owner.splGrown = undefined;
          owner = owner.ownerCt || owner;
        }
        if (owner && owner.doLayout) { owner.splCardsIn = true; owner.doLayout(); }
      } catch (e) { /* the row keeps its layout */ }
    }, 0);
  };
  // ---- Wrapped text in a vbox -------------------------------------------------
  // A vbox stacks its items at fixed tops, each as high as its config says or
  // as Ext measured it, often before the item had its final width. A text item
  // one line high (a status title, its line-height the same) keeps that height
  // when its text wraps at phone width: the second line is drawn over the item
  // under it (the description). Such a text item takes the height of its
  // lines, and the vbox stacks again from it, with its own pack and margins.
  // When the column is then taller than the vbox, the vbox scrolls. Only short
  // text that shows past its box (no clipping, no ellipsis). When it fits again
  // (a wider screen) it gets its own height back.
  /** The height of a text item's lines at a width (0: not a text item the fit sizes) */
  var linesHeight = function (c, width) {
    var e = c.el && c.el.dom;
    if (!e || !e.offsetHeight || c.flex || !textOnly(e)) return 0;
    var cs = getComputedStyle(e);
    if (cs.overflowY !== 'visible' || cs.overflowX !== 'visible' || /nowrap|pre$/.test(cs.whiteSpace)) return 0;
    var ow = e.style.width, oh = e.style.height;
    e.style.width = (width || e.offsetWidth) + 'px'; e.style.height = 'auto';
    var h = e.offsetHeight;
    e.style.width = ow; e.style.height = oh;
    return h;
  };
  var growText = function (layout, calc, items, size, result) {
    var ct = layout.container, set = [], grown = false, i;
    if (!ct) return result;
    for (i = 0; i < items.length; i++) {
      var c = items[i], box = result.boxes[i], was = c.splTextH;
      if (!narrow() && !was) continue;
      var h = linesHeight(c, box.width), wraps = narrow() && h > (box.height || 0) + 2;
      // Sized for its wrapped text before (Ext now measures the height the fit
      // gave it): its config height, or its lines again
      var lines = wraps || (was && h && typeof c.height !== 'number');
      c.splTextH = lines && narrow() ? h : undefined;
      if (c.splTextH) grown = true;
      if (lines) set.push({ i: i, c: c, h: h, height: c.height, min: c.minHeight });
      else if (was) box.dirtySize = true;
    }
    ct.splTextIn = false;
    if (!set.length) return result;
    set.forEach(function (g) { g.c.height = g.h; g.c.minHeight = g.h; });
    try { result = calc.call(layout, items, size); } finally { set.forEach(function (g) { g.c.height = g.height; g.c.minHeight = g.min; }); }
    set.forEach(function (g) { result.boxes[g.i].dirtySize = true; });
    // Scrolls only while the column is taller than the vbox it was laid out in
    var pad = layout.padding || { top: 0, bottom: 0 };
    ct.splTextIn = grown && result.meta.nonFlexHeight + pad.top + pad.bottom > size.height + 1;
    return result;
  };
  // A row of a chart and its legend whose legend is hidden (DSM hides it on
  // a narrow window): the chart keeps its share of the desktop row (Log
  // Center's overview: 83 of 307 px). On a phone the lone chart takes the row.
  var CHART = '[_echarts_instance_], canvas';
  var loneChart = function (layout, items, size, result) {
    // (Ext passes the visible items only; the row's own items include the hidden legend)
    var all = layout.container && layout.container.items;
    if (!narrow() || !items || !all || !all.getCount || all.getCount() < 2 || !result || !result.boxes) return;
    var shown = [];
    items.forEach(function (c, i) { if (!c.hidden && !(c.el && c.el.hasClass && c.el.hasClass('x-hide-display'))) shown.push(i); });
    if (shown.length !== 1) return;
    var i = shown[0], c = items[i], box = result.boxes[i], pad = layout.padding || { left: 0, right: 0 };
    if (!box || c.flex || !c.el || !c.el.dom || !c.el.dom.querySelector(CHART)) return;
    var room = size.width - (box.left || 0) - (pad.right || 0) - (c.margins ? c.margins.right || 0 : 0);
    // (Not while the row still has its desktop width: the chart would keep the column that wide)
    if (box.width >= room * 0.6 || size.width > document.documentElement.clientWidth) return;
    box.width = room; box.dirtySize = true;
  };
  /** Charts drawn for another width (ECharts keeps its canvas size): draw them again */
  var redrawCharts = function (root) {
    var ec = window.echarts;
    if (!root || !ec || typeof ec.getInstanceByDom !== 'function') return;
    Array.prototype.forEach.call(root.querySelectorAll('[_echarts_instance_]'), function (dom) {
      var chart = ec.getInstanceByDom(dom);
      if (!chart || !dom.clientWidth || chart.isDisposed && chart.isDisposed()) return;
      if (Math.abs(chart.getWidth() - dom.clientWidth) > 2 || Math.abs(chart.getHeight() - dom.clientHeight) > 2) { try { chart.resize(); } catch (e) { /* its own size */ } }
    });
  };
  /** A chart row laid out before its chart appeared or its legend was hidden
   * (hiding an item does not lay its row out again): lay the row out again
   * while its lone chart is still narrow, or, in a row of several boxes not
   * yet a grid, while a chart is narrower than a card or the boxes run past
   * the row's edge, a few times per row */
  var chartRows = function (root) {
    if (!root || !narrow() || !window.Ext || !Ext.getCmp || !Ext.layout || !Ext.layout.HBoxLayout) return;
    Array.prototype.forEach.call(root.querySelectorAll(CHART), function (dom) {
      for (var a = dom.parentElement, n = 0; a && n < 12; a = a.parentElement, n++) {
        var c = a.id && Ext.getCmp(a.id);
        if (!c || !(c.layout instanceof Ext.layout.HBoxLayout) || !c.items || !c.items.getCount || c.items.getCount() < 2) continue;
        var shown = c.items.items.filter(function (i) { return !i.hidden; });
        var box = c.el && c.el.dom, width = box ? box.clientWidth : 0;
        var squeezed = shown.length === 1 ? shown[0].el && shown[0].el.dom.offsetWidth < width * 0.6
          : !c.splGridded && shown.some(function (i) {
            var e = i.el && i.el.dom;
            return !!e && (e.offsetLeft + e.offsetWidth > width + 1 || (holdsChart(i) && e.offsetWidth < Math.max(CARD_MIN, e.offsetHeight * CARD_ASPECT)));
          });
        if (shown.length && width && width <= document.documentElement.clientWidth && squeezed && (c.splChartTries || 0) < 3) {
          c.splChartTries = (c.splChartTries || 0) + 1;
          try { c.doLayout(false, true); } catch (e) { /* its layout */ }
        }
        return;
      }
    });
    redrawCharts(root);
  };
  /** A grid whose cards an App emptied after it was laid out (it hides the
   * menus of a row when there is nothing to pick, which does not lay the row
   * out again): lay the row out again, which leaves the grid once fewer than
   * two cards hold anything, a few times per row */
  var staleGrids = function (root) {
    if (!root || !window.Ext || !Ext.getCmp) return;
    var rows = [];
    Array.prototype.forEach.call(root.querySelectorAll('.spl-fit-card'), function (e) {
      var c = e.id && Ext.getCmp(e.id), ct = c && c.ownerCt;
      if (ct && ct.splGridded && rows.indexOf(ct) < 0) rows.push(ct);
    });
    rows.forEach(function (ct) {
      var full = ct.items.items.filter(function (i) { return !i.hidden && !spacer(i); });
      if (full.length >= 2 || (ct.splStaleTries || 0) >= 3) return;
      ct.splStaleTries = (ct.splStaleTries || 0) + 1;
      try { ct.doLayout(false, true); } catch (e) { /* its layout */ }
    });
  };
  // ---- Masks over a widened chart ----------------------------------------------
  // An App may hide the axis labels that slide out of a live chart with small
  // blank boxes over the chart's edges, placed for the chart's desktop width
  // (a right offset that assumes the box beside the chart). Once the fit
  // widens the chart, such a box sits inside it and cuts a label in half
  // ("14:3" for "14:35"). Rule, from the page alone: on a phone, a small empty
  // box of a solid colour placed absolutely over a chart, away from both of
  // its edges, goes to the chart's right edge. A box at an edge stays. Its own
  // place comes back on a wider screen.
  var MASK_MAX = 60, MASK_EDGE = 30;
  var masks = [];
  var chartMasks = function (root) {
    if (!narrow()) { masks.forEach(function (k) { k.el.style.left = k.left; k.el.style.right = k.right; }); masks = []; return; }
    Array.prototype.forEach.call(root.querySelectorAll('[_echarts_instance_]'), function (dom) {
      var c = dom.getBoundingClientRect();
      if (!c.width) return;
      for (var a = dom.parentElement, n = 0; a && n < 12; a = a.parentElement, n++) {
        Array.prototype.forEach.call(a.children, function (e) {
          if (e.contains(dom) || e.splMask || /\S/.test(e.textContent || '') || e.children.length) return;
          var cs = getComputedStyle(e), b = e.getBoundingClientRect();
          if (cs.position !== 'absolute' || !b.width || b.width > MASK_MAX || b.height > MASK_MAX || /transparent|rgba\([^)]*,\s*0\)/.test(cs.backgroundColor) || cs.backgroundColor === '') return;
          if (b.top < c.top || b.bottom > c.bottom || b.left - c.left < MASK_EDGE || c.right - b.right < MASK_EDGE) return;
          var parent = e.offsetParent && e.offsetParent.getBoundingClientRect();
          if (!parent) return;
          e.splMask = true; masks.push({ el: e, left: e.style.left, right: e.style.right });
          e.style.left = Math.round(c.right - parent.left - b.width) + 'px'; e.style.right = 'auto';
        });
      }
    });
  };
  var hookCards = function () {
    var L = Ext.layout, H = L && L.HBoxLayout, V = L && L.VBoxLayout, B = L && L.BoxLayout;
    if (!H || !V || !B || H.prototype.splCards) return;
    var calc = H.prototype.calculateChildBoxes, vcalc = V.prototype.calculateChildBoxes;
    if (vcalc) V.prototype.calculateChildBoxes = function (items, size) {
      var result = vcalc.apply(this, arguments);
      try { result = growText(this, vcalc, items, size, result); } catch (e) { /* desktop layout */ }
      return result;
    };
    H.prototype.splCards = true;
    H.prototype.calculateChildBoxes = function (items, size) {
      var result = calc.apply(this, arguments);
      try { result = dropGaps(this, calc, items, size, result); } catch (e) { /* desktop layout */ }
      try { loneChart(this, items, size, result); } catch (e) { /* desktop layout */ }
      try {
        var grid = cardGrid(this, items, size, result), ct = this.container;
        if (grid) { result.meta.maxHeight = ct.splGrid = grid; cardHeight(ct, grid); } else if (ct && ct.splGridded) { items.forEach(function (c) { cardClass(c, false); }); cardHeight(ct, false); }
      } catch (e) { /* desktop layout */ }
      return result;
    };
    // A row its owner cannot grow (a border region) scrolls its grid; a vbox
    // holding grown rows scrolls when its content is taller than it
    var onLayout = B.prototype.onLayout;
    B.prototype.onLayout = function () {
      var out = onLayout.apply(this, arguments);
      var self = this;
      if (narrow() && window.echarts) setTimeout(function () { try { redrawCharts(self.innerCt && self.innerCt.dom); } catch (e) { /* its own size */ } }, 0);
      try {
        var ct = this.container, calcs = this.childBoxCache, target = ct && this.innerCt && ct.getLayoutTarget(), need = 0;
        if (!target) return out;
        if (this instanceof H && ct.splGridded) need = ct.splGrid;
        else if (this instanceof V && (ct.splCardsIn || ct.splTextIn) && calcs) need = calcs.meta.nonFlexHeight + (this.padding ? this.padding.top + this.padding.bottom : 0);
        else if (!target.hasClass('spl-fit-vscroll')) return out;
        var over = narrow() && need > target.getHeight(true) + 1;
        target.toggleClass('spl-fit-vscroll', over);
        if (over) this.innerCt.setHeight(need);
      } catch (e) { /* desktop layout */ }
      return out;
    };
  };
  var hookGrid = function () {
    if (!Ext.grid || !Ext.grid.GridPanel) return;
    Ext.util.Observable.observeClass(Ext.grid.GridPanel, { beforerender: function (grid) { try { wrapFit(grid.getView()); } catch (e) { /* ignore */ } } });
  };
  // ---- Single-App mode -----------------------------------------------------
  // DSM has its own single-App page: /?launchApp=<id> opens a "standalone
  // desktop" (no taskbar, desktop or widgets; one maximized App) for any App
  // whose config allows it (File Station, Text Editor, Drive…). DSM reads that
  // config in SYNO.SDS.init(), right after initFramework() builds its App
  // map. For the launched App only, and only when DSM itself reports the App
  // enabled, allow it there too; DSM then takes its own standalone path.
  // On top of that page the shell's top bar is the only title row: App
  // windows lose their header, the shell shows the App on screen (posted to
  // it), and back (shell or Android) closes, in order, dialogs, menus, Apps
  // opened from the App, then the App itself. The page tells the shell how
  // many back steps it has, and the shell asks it to close the top one. (Not
  // through history: Chromium skips pushState entries made without a tap in
  // the page, and the shell's own buttons are not one.)
  var launchApp = (function () { try { return new URLSearchParams(location.search || '').get('launchApp'); } catch (e) { return null; } })();
  var plain = function (html) {
    try { return (new DOMParser().parseFromString(String(html || ''), 'text/html').body.textContent || '').trim(); } catch (e) { return String(html || '').replace(/<[^>]*>/g, '').trim(); }
  };
  var allowStandalone = function () {
    var S = window.SYNO && SYNO.SDS, framework = S && S.initFramework;
    if (typeof framework !== 'function') return;
    S.initFramework = function () {
      S.initFramework = framework;
      var result = framework.apply(this, arguments);
      try {
        var entry = S.Config.FnMap[launchApp], config = entry && entry.config;
        if (narrow() && config && config.type === 'app' && config.allowStandalone !== true && S.StatusNotifier.isAppEnabled(launchApp)) config.allowStandalone = true;
      } catch (e) { /* DSM keeps its own path */ }
      return result;
    };
  };
  var wrapInit = function (fn) {
    if (typeof fn !== 'function' || fn.splInit) return fn;
    var wrapped = function () {
      try { allowStandalone(); } catch (e) { /* ignore */ }
      try { return fn.apply(this, arguments); } finally { setTimeout(startSingle, 0); }
    };
    wrapped.splInit = true;
    return wrapped;
  };
  // DSM defines SYNO.SDS.init more than once while its bundles load: keep
  // wrapping whatever it assigns. Looked for on the same script-load events
  // as Ext; no polling.
  var initHost = null;
  var watchInit = function () {
    var S = window.SYNO && SYNO.SDS;
    if (!(launchApp || deskPage) || !S || typeof S !== 'object' || S === initHost) return;
    try {
      var d = Object.getOwnPropertyDescriptor(S, 'init');
      if (d && !d.configurable) return;
      var current = wrapInit(S.init);
      Object.defineProperty(S, 'init', { configurable: true, enumerable: true, get: function () { return current; }, set: function (v) { current = wrapInit(v); } });
      initHost = S;
    } catch (e) { /* the page keeps DSM's desktop */ }
  };
  var standalone = function () { var S = window.SYNO && SYNO.SDS; return !!(S && S.Session && S.Session.standalone === true); };
  // ---- Embedded desktop ----------------------------------------------------
  // A package can run DSM's desktop framework in a page of its own
  // (Surveillance Station): its own taskbar, desktop and app view ("main
  // menu") of the package's Apps. On a phone that is a shrunken desktop under
  // the app view's dark backdrop. Rule, from DSM's own structure, never from
  // App names: a page of the NAS that is not DSM's root page (and not a
  // single-App page), with DSM's desktop and taskbar in it, is an embedded
  // desktop. Its taskbar, desktop and app view go out of sight; the app view's
  // Apps become a list; a tap opens the App in this page with DSM's
  // AppLaunch, as a single App with the shell's back; back past the App
  // returns to the list, and back on the list leaves the page.
  var DSM_ROOT = /^\/(webman\/)?(index\.cgi)?$/;
  var deskPage = !launchApp && !DSM_ROOT.test((window.location && location.pathname) || '/');
  var embeddedDesk = function () { var S = window.SYNO && SYNO.SDS; return deskPage && !!S && typeof S.AppLaunch === 'function' && !standalone() && !!document.getElementById('sds-desktop') && !!document.getElementById('sds-taskbar'); };
  var embedded = false;

  var singleOn = false, timer = null, closing = null, seen = false, last = '', icons = {};
  var schedule = function () { if (!singleOn) return; clearTimeout(timer); timer = setTimeout(sync, 60); };
  var dom = function (c) { return isVue(c) ? c.$el : c.el && c.el.dom; };
  var shown = function (c) {
    try {
      var el = dom(c);
      if (!el || !el.offsetWidth || (isVue(c) ? c.isVisible && !c.isVisible() : !c.rendered || c.hidden)) return false;
      var cs = getComputedStyle(el);
      return cs.display !== 'none' && cs.visibility !== 'hidden';
    } catch (e) { return false; }
  };
  // DSM's own App windows (Ext SYNO.SDS.AppWindow, Vue windows of an App), not its dialogs
  var isApp = function (c) {
    if (!c) return false;
    if (isVue(c)) return !!c.appInstance && c.modal !== true && !/MessageBox|Modal|Dialog/i.test((c.$options && c.$options.name) || '');
    var App = window.SYNO && SYNO.SDS && SYNO.SDS.AppWindow;
    return !!(App && c instanceof App);
  };
  var isRoot = function (c) { return isVue(c) ? c.isStandaloneMainWindow === true : !!(c.el && c.el.hasClass('sds-standalone-main-window')); };
  var z = function (c) { var v = parseInt(getComputedStyle(dom(c)).zIndex, 10); return isNaN(v) ? 0 : v; };
  /** Every DSM window, shown or not */
  var allWindows = function () {
    var list = [], mgr = window.SYNO && SYNO.SDS && SYNO.SDS.WindowMgr;
    if (mgr && mgr.windowList && mgr.windowList.forEach) mgr.windowList.forEach(function (e) { if (e && e.component && list.indexOf(e.component) < 0) list.push(e.component); });
    // (An older DSM framework, as a package ships it: its windows by id)
    else if (mgr && mgr.list && typeof mgr.list === 'object') Object.keys(mgr.list).forEach(function (k) { var e = mgr.list[k], c = e && e.component || e; if (c && (isVue(c) || c.el) && list.indexOf(c) < 0) list.push(c); });
    if (window.Ext && Ext.WindowMgr) Ext.WindowMgr.each(function (w) { if (list.indexOf(w) < 0) list.push(w); });
    return list;
  };
  /** Every shown DSM window, topmost first */
  var windows = function () {
    return allWindows().filter(function (c) { return !c.splDesk && shown(c); }).map(function (c, i) { return { c: c, z: z(c), i: i }; })
      .sort(function (a, b) { return b.z - a.z || b.i - a.i; }).map(function (x) { return x.c; });
  };
  // Back steps inside one App window: its open menu, then (Control Panel
  // style) a page opened from the App's home grid
  var vueHome = function (c) {
    if (!isVue(c) || !c.selectedVal || !c.$el) return null;
    return c.$el.querySelector('.module-list-layout [class*="-home"]');
  };
  var inner = function (c) {
    var steps = [];
    if (isVue(c)) {
      if (c.innerShowModules === true) steps.push({ kind: 'menu', close: function () { if (c.onClickModuleListMask) c.onClickModuleListMask(); else c.innerShowModules = false; } });
      var home = vueHome(c);
      if (home) steps.push({ kind: 'home', close: function () { home.click(); } });
      if (!c.splWatch && c.$watch) {
        c.splWatch = true;
        c.$watch('innerShowModules', schedule); c.$watch('selectedVal', schedule);
      }
    } else if (c.splNavOpen && c.splNavOpen()) steps.push({ kind: 'menu', close: function () { c.splNavOpen(false); } });
    var nav = foundNav(dom(c));
    if (nav && nav.isOpen()) steps.unshift({ kind: 'menu', close: function () { nav.open(false); } });
    return steps;
  };
  /** What back closes, first step first */
  var stack = function (list) {
    // The full-screen viewer of an oversized graphic covers everything
    var steps = viewer ? [{ kind: 'viewer', close: function () { closeViewer(); } }] : [];
    // A grid row's detail sheet covers its App
    if (sheet) steps.unshift({ kind: 'sheet', close: function () { closeSheet(); } });
    var under = false;
    list.forEach(function (c) {
      if (under) return;
      if (!isApp(c)) { steps.push({ kind: 'dialog', close: function () { c.close(); } }); return; }
      steps = steps.concat(inner(c));
      // A hosted App is the page's App: back past it leaves to the shell, and nothing under it counts
      if (hosted && c === hosted) { under = true; return; }
      // DSM marks every Vue App window in a standalone page isStandalone, and such a
      // window refuses to close; only the first App needs that, so let an App opened
      // on top of it close through DSM's own path (unsaved-change prompts included)
      if (!isRoot(c)) steps.push({ kind: 'app', close: function () { if (isVue(c) && c.isStandalone) c.isStandalone = false; c.close(); } });
    });
    // An App's own page (no DSM App window): its side menu
    var nav = !list.some(isApp) && foundNav(pageRoot());
    if (nav && nav.isOpen()) steps.push({ kind: 'menu', close: function () { nav.open(false); } });
    return steps;
  };
  var post = function (message) {
    var rn = window.ReactNativeWebView;
    message.origin = location.origin;
    try { if (rn && rn.postMessage) rn.postMessage(JSON.stringify(message)); } catch (e) { /* no shell */ }
  };
  var iconUrl = function (c) {
    var url = '';
    if (isVue(c)) url = c.iconUrl || (c.getIcon && c.getIcon()) || '';
    else if (c.header && c.header.dom) { var m = /url\(["']?([^"')]+)/.exec(getComputedStyle(c.header.dom).backgroundImage || ''); url = m ? m[1] : ''; }
    try { url = url ? new URL(String(url), location.href).href : ''; } catch (e) { url = ''; }
    return url && new URL(url).origin === location.origin ? url : '';
  };
  // The shell cannot load NAS images itself (pinned certificates): send a data URL
  var iconData = function (url) {
    if (!url || icons[url] !== undefined || !window.fetch || !window.FileReader) return;
    icons[url] = '';
    fetch(url, { credentials: 'same-origin' }).then(function (r) { return r.ok ? r.blob() : null; }).then(function (blob) {
      if (!blob || blob.size > 65536 || !/^image\//.test(blob.type)) return;
      var reader = new FileReader();
      reader.onload = function () { icons[url] = String(reader.result || ''); schedule(); };
      reader.readAsDataURL(blob);
    }).catch(function () {});
  };
  var title = function (c) {
    try {
      if (!isVue(c)) return plain(c.title);
      // getTitle() can be DSM's string key ("tree:leaf_control_panel"); the header shows the text
      var shownTitle = c.$el && c.$el.querySelector('.v-window-header-title');
      return plain(shownTitle && shownTitle.textContent.trim() ? shownTitle.textContent : c.formalTitle || c.currentTitle || (c.getTitle ? c.getTitle() : c.title));
    } catch (e) { return ''; }
  };
  var page = function (c) {
    var nav = foundNav(dom(c));
    if (nav) return nav.page();
    if (!isVue(c)) return c.splPage ? c.splPage.textContent || '' : '';
    // The page list keeps the open page's entry marked, even with the menu closed
    var item = c.$el && c.selectedVal && c.$el.querySelector('.module-list-layout .module-item-option.activated .module-item-text');
    return item ? plain(item.textContent) : '';
  };
  // The Ext side navigation is a menu at phone width only; sideways it sits beside the content
  var hasMenu = function (c) { return !!foundNav(dom(c)) || (isVue(c) ? !!(c.$el && c.$el.querySelector('.app-window-header-hamburger')) : !!c.splNav && narrow()); };
  /** A side menu found in a window or page (sideNav()), while it is on screen */
  var foundNav = function (el) { var n = el && el.splPnav; return n && n.row.isConnected && narrow() ? n : null; };
  /** The page of an App that shows no DSM App window (its own page in the standalone desktop) */
  var pageRoot = function () { return document.querySelector('.sds-standalone-desktop') || document.body; };
  var appId = function (c) {
    try {
      var a = c.appInstance;
      return String((a && a.getJsConfig ? a.getJsConfig() : a && a.jsConfig ? a.jsConfig : c.getJsConfig ? c.getJsConfig() : {}).jsID || '');
    } catch (e) { return ''; }
  };
  /**
   * The App window still shows DSM's own loading mask ("Loading" over its content): the shell keeps
   * its cover up until it goes. Its removal is inside the App's content, which the window watchers
   * do not see, so the page looks again shortly while it lasts.
   */
  var busyTimer = null;
  var busy = function (app) {
    var el = dom(app), masks = el && el.querySelectorAll ? el.querySelectorAll('.ext-el-mask-msg, .x-mask-loading') : [];
    for (var i = 0; i < masks.length; i++) {
      var m = masks[i];
      // Ext adds the mask hidden and shows it a moment later; unmask removes it, so any sized one counts
      if (m.offsetWidth && m.offsetHeight) {
        clearTimeout(busyTimer); busyTimer = setTimeout(schedule, 120);
        return true;
      }
    }
    return false;
  };
  var report = function (app, back) {
    if (!app) return;
    var id = appId(app);
    var url = iconUrl(app);
    iconData(url);
    var state = { id: String(id), title: title(app), page: page(app), menu: hasMenu(app), icon: (url && icons[url]) || '', back: back, busy: busy(app) };
    var text = JSON.stringify(state);
    if (text !== last) { last = text; post({ internal: 'fitApp', app: state }); }
  };
  /** An App's own page: the shell keeps the launched App's name and icon; the page adds its menu */
  var reportPage = function (list) {
    var root = pageRoot(), nav = foundNav(root);
    watchContent(root);
    if (!nav) return;
    var state = { id: String(launchApp || ''), title: '', page: nav.page(), menu: true, icon: '', back: stack(list).length };
    var text = JSON.stringify(state);
    if (text !== last) { last = text; post({ internal: 'fitApp', app: state }); }
  };
  var sync = function () {
    if (!singleOn) return;
    var list = windows(), apps = list.filter(isApp);
    if (embedded) {
      apps = deskApps(dropCancelled(apps));
      list = list.filter(function (c) { return !c.splDesk; });
      if (!apps.length) { seen = false; showDesk(list); return; }
      if (deskList) deskList.hidden = true;
      openingShown(apps[0]);
    }
    if (hostedId) {
      // The page's first App stays loaded under a hosted App, out of sight
      var hide = apps.filter(function (c) { return isRoot(c) && c !== hosted && appId(c) !== hostedId; });
      hide.forEach(function (c) { dom(c).classList.add('spl-fit-under'); });
      if (hide.length) { list = list.filter(function (c) { return hide.indexOf(c) < 0; }); apps = apps.filter(function (c) { return hide.indexOf(c) < 0; }); }
      if (!hosted) {
        // Still opening: nothing is reported until the App's window shows
        hosted = apps.filter(function (c) { return appId(c) === hostedId; })[0] || apps.filter(function (c) { return !isRoot(c) && hostBefore.indexOf(c) < 0; })[0] || null;
        if (!hosted) {
          // An App DSM shows again keeps the size it had while the page was hidden (none): lay it out again
          var again = allWindows().filter(function (c) { return !isVue(c) && isApp(c) && appId(c) === hostedId && c.rendered && !c.hidden && c.el && c.el.dom && !c.el.dom.offsetWidth; })[0];
          if (again) { try { if (again.maximized && again.fitContainer) again.fitContainer(); else again.setSize(window.innerWidth, window.innerHeight); } catch (e) { /* Found on a later pass or by the shell's wait */ } schedule(); }
          return;
        }
        if (isRoot(hosted)) dom(hosted).classList.remove('spl-fit-under');
      }
    }
    apps.forEach(function (c) {
      if (isVue(c)) { if (!c.$el.classList.contains('spl-single-app')) c.$el.classList.add('spl-single-app'); }
      else if (!c.el.hasClass('spl-single-app')) fit(c);
    });
    if (apps.length) { seen = true; clearTimeout(closing); closing = null; }
    else if (seen && !closing) {
      // The App closed itself: return to the launcher, unless an App shows again at once
      closing = setTimeout(function () { closing = null; if (seen && !windows().filter(isApp).length) { seen = false; hosted = null; hostedId = ''; post({ internal: 'fitClosed' }); } }, 400);
    }
    if (!apps.length) { if (!seen) reportPage(list); return; }
    // A dialog on top of a widened Vue App: it is placed in the scrolled page area
    if (list[0] !== apps[0] && isVue(apps[0]) && apps[0].$el && apps[0].$el.splNeed) wideHome();
    sheets(list);
    layers();
    scanEdges();
    watchContent(dom(apps[0]));
    report(apps[0], stack(list).length);
  };
  // The embedded desktop's list of Apps (see embeddedDesk)
  var deskList = null, deskIds = [], deskKey = '', deskTries = 0, deskLaunched = '', deskFailed = false;
  /**
   * The app view's Apps, each once, in its order. DSM builds the app view's items as components
   * and draws them only when the app view first opens: read the components (each holds its App's id,
   * title and icon), never the screen.
   */
  var deskItems = function () {
    var out = [], seen = {}, map = (SYNO.SDS.Config && SYNO.SDS.Config.FnMap) || {}, view = Ext.getCmp && Ext.getCmp('sds-appview');
    var add = function (id, title, src) {
      if (!id || typeof id !== 'string' || seen[id] || !map[id]) return;
      seen[id] = 1;
      var icon = '';
      try { icon = src ? new URL(String(src), location.href).href : ''; } catch (e) { icon = ''; }
      out.push({ id: id, title: plain(title || id), icon: icon && new URL(icon).origin === location.origin ? icon : '' });
    };
    if (view && view.cascade) view.cascade(function (c) { if (c) add(c.jsID, c.title || c.plaintitle, c.icon); });
    if (out.length) return out;
    // Newer desktops (Surveillance Station 9) draw the app view and desktop icons without
    // components: each icon carries its App's id, title and icon image
    try {
      Array.prototype.forEach.call(document.querySelectorAll('li.launch-icon[syno-id]'), function (li) {
        var image = li.querySelector && li.querySelector('.image');
        var bg = image && image.style && image.style.backgroundImage || '';
        var src = /url\(["']?([^"')]+)["']?\)/.exec(bg);
        add(li.getAttribute('syno-id'), li.getAttribute('aria-label') || li.textContent, src ? src[1] : '');
      });
    } catch (e) { /* No icons drawn yet */ }
    return out;
  };
  // ---- Opening an App from the list ---------------------------------------
  // DSM loads an App's scripts before its window exists, seconds in which the
  // page would not change. Like DSM, a tap shows the App at once: its icon with
  // a turning arc and its name (dsm-fit.css), until its window shows without
  // DSM's loading mask. No time limit decides anything; a window still under
  // its mask after OPEN_MASK_WAIT shows as it is, as on DSM's desktop, DSM's
  // own mask being the feedback from then on (a long recording list). Back
  // cancels: the App's window is closed when it comes.
  var OPEN_MASK_WAIT = 1500, OPEN_FADE = 160;
  var opening = null, cancelled = {};
  var showOpening = function (it) {
    endOpening(true);
    var el = document.createElement('div');
    el.className = 'spl-fit-opening';
    try { if (window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches) el.classList.add('spl-fit-opening-still'); } catch (e) { /* motion stays on */ }
    el.setAttribute('role', 'progressbar');
    el.setAttribute('aria-label', it.title || '');
    var orbit = document.createElement('div');
    orbit.className = 'spl-fit-opening-orbit';
    var arc = document.createElement('div');
    arc.className = 'spl-fit-opening-arc';
    orbit.appendChild(arc);
    if (it.icon) { var icon = document.createElement('img'); icon.src = it.icon; icon.alt = ''; orbit.appendChild(icon); }
    el.appendChild(orbit);
    var name = document.createElement('div');
    name.className = 'spl-fit-opening-title';
    name.textContent = it.title || '';
    el.appendChild(name);
    document.body.appendChild(el);
    var mine = opening = { id: it.id, el: el, masked: 0, poll: 0 };
    // Not every window framework tells the page when its window shows (a package's own Vue 3 or a
    // late Ext render): while the cover is up, look again a few times a second
    var poll = function () { if (opening !== mine) return; schedule(); mine.poll = setTimeout(poll, 250); };
    mine.poll = setTimeout(poll, 250);
  };
  /** The App is on screen (or the opening was cancelled): fade the cover out, or drop it at once */
  var endOpening = function (now) {
    if (!opening) return;
    var el = opening.el;
    clearTimeout(opening.masked); clearTimeout(opening.poll);
    opening = null;
    if (now) { el.remove(); return; }
    el.classList.add('spl-fit-opening-out');
    setTimeout(function () { el.remove(); }, OPEN_FADE);
  };
  /** The App asked for has its window up: done once DSM's own loading mask is gone */
  var openingShown = function (app) {
    if (!opening) return;
    // Its panes fold under the cover: the cover fades onto the phone layout, not the desktop one
    step(function () { var root = dom(app); if (root && narrow()) foldPanes(root); });
    if (!busy(app)) { endOpening(); return; }
    var mine = opening;
    if (!mine.masked) mine.masked = setTimeout(function () { if (opening === mine) endOpening(); }, OPEN_MASK_WAIT);
    clearTimeout(busyTimer); busyTimer = setTimeout(schedule, 250);
  };
  var cancelOpening = function () {
    if (!opening) return false;
    cancelled[opening.id] = 1; deskLaunched = '';
    endOpening(true);
    last = ''; schedule();
    return true;
  };
  /** A window of an App whose opening was cancelled: closed as it comes */
  var dropCancelled = function (apps) {
    return apps.filter(function (c) {
      var id = appId(c);
      if (!cancelled[id] || c.splSeen) return true;
      delete cancelled[id];
      try { c.close(); } catch (e) { dom(c).classList.add('spl-fit-under'); }
      return false;
    });
  };
  var openFromDesk = function (it) {
    deskLaunched = it.id;
    delete cancelled[it.id];
    showOpening(it);
    last = ''; schedule();
    // DSM builds the App on this thread: launch once the cover has been painted
    var go = function () {
      if (!opening || opening.id !== it.id) return;
      try { SYNO.SDS.AppLaunch(it.id); } catch (e) { deskLaunched = ''; endOpening(true); }
      schedule();
    };
    if (window.requestAnimationFrame) requestAnimationFrame(function () { requestAnimationFrame(function () { setTimeout(go, 0); }); });
    else setTimeout(go, 16);
  };
  var drawDesk = function () {
    var items = deskItems(), key = JSON.stringify(items);
    if (!items.length) {
      // The app view fills in after the desktop starts: look again shortly, for a while. A desktop
      // whose Apps can't be read shows as it is, instead of an empty backdrop
      if (deskTries++ < 40) setTimeout(schedule, 500);
      else { deskFailed = true; if (document.body) document.body.classList.remove('spl-fit-desk'); }
      return;
    }
    if (key === deskKey && deskList) return;
    deskKey = key; deskIds = items.map(function (it) { return it.id; });
    if (!deskList) {
      deskList = document.createElement('div');
      deskList.className = 'spl-fit-launcher';
      deskList.setAttribute('role', 'list');
      document.body.appendChild(deskList);
    }
    var rows = items.map(function (it) {
      var row = document.createElement('button');
      row.className = 'spl-fit-launcher-item'; row.type = 'button'; row.setAttribute('role', 'listitem');
      if (it.icon) { var icon = document.createElement('img'); icon.src = it.icon; icon.alt = ''; row.appendChild(icon); }
      var label = document.createElement('span'); label.textContent = it.title; row.appendChild(label);
      row.addEventListener('click', function () { openFromDesk(it); });
      return row;
    });
    deskList.replaceChildren.apply(deskList, rows);
  };
  /**
   * The list shows when no App does. An App window the list does not offer that
   * shows while the list is up is a desktop helper (a tour of the desktop): out of
   * sight, and no App. Apps opened from an App on screen are Apps.
   */
  var deskApps = function (apps) {
    var open = apps.filter(function (c) { return c.splSeen && !c.splDesk; }).length;
    apps.forEach(function (c) {
      if (c.splSeen) return;
      c.splSeen = true;
      var id = appId(c);
      if (!open && id !== deskLaunched && deskIds.indexOf(id) < 0) { c.splDesk = true; dom(c).classList.add('spl-fit-under'); }
    });
    return apps.filter(function (c) { return !c.splDesk; });
  };
  var showDesk = function (list) {
    var body = document.body;
    if (!deskFailed && body && !body.classList.contains('spl-fit-desk')) body.classList.add('spl-fit-desk');
    deskLaunched = '';
    if (!deskFailed) drawDesk();
    if (deskList) deskList.hidden = false;
    // While an App opens, back cancels it (one step)
    var state = { id: '', title: '', page: '', menu: false, icon: '', back: stack(list).length + (opening ? 1 : 0) };
    var text = JSON.stringify(state);
    if (text !== last) { last = text; post({ internal: 'fitApp', app: state }); }
  };
  // ---- Warm page (hosted Apps) ---------------------------------------------
  // Booting DSM costs seconds of API calls and script per page, so the shell
  // keeps one single-App page loaded and opens each DSM App inside it with
  // DSM's own AppLaunch. The page's first App stays loaded underneath, out of
  // sight. The hosted App is the App on screen: back never closes it (the
  // shell leaves instead), and when it closes itself the shell is told.
  var hosted = null, hostedId = '', hostBefore = [], launchedAt = 0, failTimer = null;
  // An App that cannot open inside another App's page (Active Backup's Portal
  // stops on a script error before its window exists) would hold the shell's
  // cover for its whole wait. A script error while the hosted App has no window
  // yet, and still none a moment later, tells the shell at once: it opens the
  // App in a page of its own. Errors after the window shows are the App's own.
  var LAUNCH_ERROR_WAIT = 1000, LAUNCH_ERROR_WINDOW = 8000;
  var launchError = function () {
    if (!hostedId || hosted || !launchedAt || Date.now() - launchedAt > LAUNCH_ERROR_WINDOW || failTimer) return;
    var id = hostedId;
    failTimer = setTimeout(function () {
      failTimer = null;
      if (hostedId !== id || hosted) return;
      sync();
      if (hostedId !== id || hosted) return;
      hostedId = ''; launchedAt = 0;
      post({ internal: 'fitLaunch', ok: false });
    }, LAUNCH_ERROR_WAIT);
  };
  window.addEventListener('error', launchError);
  window.addEventListener('unhandledrejection', launchError);
  /** Closes every window over the page's first App: the hosted App, Apps opened from it and dialogs */
  var home = function () {
    hosted = null; hostedId = ''; hostBefore = []; seen = false; last = ''; launchedAt = 0;
    clearTimeout(failTimer); failTimer = null;
    clearTimeout(closing); closing = null;
    windows().forEach(function (c) {
      if (isRoot(c)) return;
      try { if (isVue(c) && c.isStandalone) c.isStandalone = false; c.close(); } catch (e) { /* DSM keeps it */ }
    });
  };
  /** Opens a DSM App in this page; false when this DSM has no such App */
  var launch = function (id) {
    var S = window.SYNO && SYNO.SDS;
    id = String(id || '');
    if (!id || !S || typeof S.AppLaunch !== 'function' || !S.Config || !S.Config.FnMap || !S.Config.FnMap[id]) return false;
    home();
    hostedId = id; launchedAt = Date.now();
    hostBefore = windows();
    var root = hostBefore.filter(function (c) { return isApp(c) && isRoot(c); })[0];
    if (root && appId(root) === id) { hosted = root; dom(root).classList.remove('spl-fit-under'); }
    else {
      if (root) dom(root).classList.add('spl-fit-under');
      try { S.AppLaunch(id); } catch (e) { hostedId = ''; return false; }
    }
    schedule();
    return true;
  };
  /** Back from the shell: close the top step (a dialog, a menu, a page, an App opened from the App) */
  var back = function () {
    if (cancelOpening()) return;
    var steps = stack(windows());
    if (steps.length) { try { steps[0].close(); } catch (e) { /* the next report says what is left */ } }
    last = ''; schedule();
  };
  /** Closes the side menu of every App on screen (Ext drawer() menus and DSM's Vue page lists) */
  /**
   * Floating boxes laid out for a desktop: a tour's intro (DSM's tutorial mask) and Vue dialogs.
   * One that does not fit the phone becomes a centered sheet with gutters, never wider or taller
   * than the screen, scrolling inside, its images scaled to it. While one is open the App's side
   * menu is closed, so it is never open or tappable behind the dialog.
   */
  var sheetOpen = false;
  var floating = function (list) {
    var found = [].slice.call(document.querySelectorAll('.tutorial-mask > *'));
    (list || windows()).forEach(function (c) { if (isVue(c) && c.modal && c.$el) found.push(c.$el); });
    return found.filter(function (el) {
      if (!el.offsetWidth || !el.isConnected) return false;
      var cs = getComputedStyle(el);
      return cs.visibility !== 'hidden' && (cs.position === 'absolute' || cs.position === 'fixed');
    });
  };
  /** The flex row of two or more boxes in a box whose content runs past the box's right edge */
  var spillOf = function (el) {
    var right = el.getBoundingClientRect().right + 2, all = el.querySelectorAll('*');
    for (var i = 0; i < all.length && i < 300; i++) {
      var e = all[i], row = e.parentElement;
      if (!e.offsetWidth || e.getBoundingClientRect().right <= right || !row || row === el || e.closest(LEAF_SKIP)) continue;
      var cs = getComputedStyle(row);
      if (/flex/.test(cs.display) && /^row/.test(cs.flexDirection) && flowKids(row).length >= 2) return row;
    }
    return null;
  };
  /** Small boxes the sheet pins over its lower half (a pager at the bottom of a welcome page)
   * that the flowed text now runs under: they leave the overlay for the flow, after the text */
  var PINNED_MAX = 80;
  var unpin = function (el) {
    var sr = el.getBoundingClientRect(), all = el.querySelectorAll('*'), pinned = [], texts = [];
    for (var i = 0; i < all.length && i < 400; i++) {
      var e = all[i];
      if (!e.offsetWidth || e.closest(LEAF_SKIP)) continue;
      var pos = getComputedStyle(e).position;
      if (pos === 'absolute') {
        var r = e.getBoundingClientRect();
        if (!e.classList.contains('spl-fit-sheet-static') && r.height <= PINNED_MAX && r.top > sr.top + sr.height / 2) pinned.push({ e: e, r: r });
      } else if (!e.firstElementChild && /\S/.test(e.textContent || '')) texts.push(e);
    }
    pinned.forEach(function (p) {
      var under = texts.some(function (t) {
        if (p.e.contains(t) || t.closest('.spl-fit-sheet-static')) return false;
        var tr = t.getBoundingClientRect();
        return tr.bottom > p.r.top + 1 && tr.top < p.r.bottom - 1 && tr.right > p.r.left + 1 && tr.left < p.r.right - 1;
      });
      if (under) p.e.classList.add('spl-fit-sheet-static');
    });
  };
  var sheets = function (list) {
    if (!narrow()) return;
    var vw = window.innerWidth, vh = window.innerHeight, boxes = floating(list);
    boxes.forEach(function (el) {
      // (One that fits the screen but whose content runs past its own edge, such as a welcome
      // page's picture beside its text, also becomes a sheet: its row wraps and the sheet scrolls)
      var spill = el.classList.contains('spl-fit-sheet-flow') ? null : spillOf(el);
      if (!el.classList.contains('spl-fit-sheet')) {
        var r = el.getBoundingClientRect();
        if (!spill && r.left >= 8 && r.right <= vw - 8 && r.top >= 0 && r.bottom <= vh) return;
        el.classList.add('spl-fit-sheet');
        if (el.parentElement && el.parentElement.classList.contains('tutorial-mask')) el.classList.add('spl-fit-sheet-pad');
      }
      if (spill) {
        el.classList.add('spl-fit-sheet-flow');
        // (Wrapped for as long as it is a sheet, not as a repair a new width undoes)
        spill.classList.add('spl-fit-wrap');
        for (var a = spill; a && a !== el; a = a.parentElement) a.classList.add('spl-fit-sheet-chain');
      }
      if (el.classList.contains('spl-fit-sheet-flow')) unpin(el);
      // Centered in what it is placed in; a tall one starts at the top gutter and scrolls inside
      var room = el.offsetParent ? el.offsetParent.clientHeight : vh;
      var top = Math.max(16, Math.round((Math.min(room, vh) - el.offsetHeight) / 2)) + 'px';
      if (el.style.getPropertyValue('--spl-fit-top') !== top) el.style.setProperty('--spl-fit-top', top);
    });
    if (boxes.length && !sheetOpen) closeMenus();
    sheetOpen = boxes.length > 0;
    // A tour can hold DSM's page list open as a panel: out of sight and out of reach under it
    var html = document.documentElement;
    if (html.classList.contains('spl-fit-modal') !== sheetOpen) html.classList[sheetOpen ? 'add' : 'remove']('spl-fit-modal');
  };
  /**
   * Floating layers past the screen: a popover an App aligns to a field near the right edge (a
   * search's options panel, 524 px wide) runs off a phone. Rule: a box the page lays over
   * everything, a direct child of <body> or of DSM's desktop placed absolute or fixed (not a DSM
   * window), that reaches past a side of
   * the screen is narrowed to the screen less LAYER_EDGE px a side and moved inside it. Windows,
   * masks, menus, tips, shadows and the fit's own boxes are not layers; a box covering the screen
   * is a backdrop. An Ext component is sized and moved through Ext, so its layout and shadow follow.
   */
  var LAYER_EDGE = 8;
  var NOT_LAYER = '.x-window, .x-shadow, .x-shim, .x-mask, .ext-el-mask, .ext-el-mask-msg, .x-menu, .x-tip, .x-dd-drag-proxy, .spl-fit-sheet, .spl-single-app';
  var layers = function () {
    if (!narrow() || !document.body || !document.body.children) return;
    var vw = window.innerWidth, vh = window.innerHeight, room = vw - 2 * LAYER_EDGE, found = [];
    // On <body> or on DSM's desktop, where Ext renders a floating panel of a standalone App
    [document.body, document.getElementById('sds-desktop')].forEach(function (host) { if (host && host.children) Array.prototype.forEach.call(host.children, function (el) { found.push(el); }); });
    var wins = [];
    allWindows().forEach(function (c) { try { var d = dom(c); if (d) wins.push(d); } catch (e) { /* not drawn */ } });
    found.forEach(function (el) {
      if (!el.offsetWidth || wins.indexOf(el) >= 0 || ours(el) || el.matches(NOT_LAYER) || /^spl-fit-/.test(el.className || '')) return;
      var cs = getComputedStyle(el);
      if (!/absolute|fixed/.test(cs.position) || cs.visibility === 'hidden') return;
      var r = el.getBoundingClientRect();
      // Inside the screen; parked out of sight (Ext hides a panel at -10000 px); or a backdrop
      if ((r.right <= vw + 1 && r.left >= -1) || r.right <= 0 || r.left >= vw || (r.width >= vw && r.height >= vh * 0.9)) return;
      var cmp = el.id && window.Ext && Ext.getCmp && Ext.getCmp(el.id);
      if (r.width > room + 1) {
        if (cmp && cmp.setWidth) cmp.setWidth(room); else el.style.setProperty('width', room + 'px', 'important');
        r = el.getBoundingClientRect();
      }
      var left = Math.max(LAYER_EDGE, Math.min(r.left, vw - LAYER_EDGE - r.width)), dx = left - r.left;
      if (Math.abs(dx) < 1) return;
      if (cmp && cmp.el && cmp.el.setX) cmp.el.setX(Math.round(left + (window.pageXOffset || 0)));
      else el.style.setProperty('left', Math.round(px(cs.left) + dx) + 'px', 'important');
    });
  };
  var closeMenus = function () {
    var page = foundNav(pageRoot());
    if (page) page.open(false);
    windows().filter(isApp).forEach(function (c) {
      try {
        var nav = foundNav(dom(c));
        if (nav) nav.open(false);
        if (isVue(c)) { if (c.innerShowModules === true) { if (c.onClickModuleListMask) c.onClickModuleListMask(); else c.innerShowModules = false; } }
        else if (c.splNavOpen && c.splNavOpen()) c.splNavOpen(false);
      } catch (e) { /* the next report says what is open */ }
    });
  };
  /** The shell's menu button: the top App's side navigation */
  var toggleMenu = function () {
    var app = windows().filter(isApp)[0], nav = foundNav(app ? dom(app) : pageRoot());
    if (nav) { if (app) wideHome(); nav.open(!nav.isOpen()); schedule(); return; }
    if (!app) return;
    if (isVue(app)) { wideHome(); if (app.onClickHamburgerIcon) app.onClickHamburgerIcon(); }
    else if (app.splNavOpen) app.splNavOpen(!app.splNavOpen());
    schedule();
  };
  var startSingle = function () {
    if (singleOn || !narrow() || !window.Ext || !(standalone() || embeddedDesk())) return;
    singleOn = true;
    embedded = !standalone();
    window.__splFitMenu = toggleMenu;
    // The shell shows a kept App again: it opens on its content, with the menu closed
    window.__splFitSync = function () { closeMenus(); last = ''; schedule(); };
    window.__splFitBack = back;
    window.__splFitLaunch = launch;
    window.__splFitHome = home;
    // Turning the phone changes the width: windows are fitted again (fitAll), and the menu may come or go
    window.addEventListener('resize', function () { last = ''; schedule(); contentResized(); });
    hookContent();
    // Vue windows show and hide by style; Ext windows also report through their events
    var desk = (SYNO.SDS.WindowMgr && SYNO.SDS.WindowMgr.getContainerEl && SYNO.SDS.WindowMgr.getContainerEl()) || document.getElementById('sds-desktop');
    if (desk && desk.dom) desk = desk.dom;
    var watch = new MutationObserver(schedule);
    [desk, document.body].forEach(function (el) { if (el && el.nodeType === 1) watch.observe(el, { childList: true, attributes: true, attributeFilter: ['style', 'class'] }); });
    var children = new MutationObserver(schedule), observed = [];
    // Windows on the desktop, and layers on <body> (a popover placed by style: layers())
    var follow = function () {
      [desk, document.body].forEach(function (ct) {
        if (!ct || !ct.children) return;
        for (var i = 0; i < ct.children.length; i++) {
          var el = ct.children[i];
          if (observed.indexOf(el) < 0) { observed.push(el); children.observe(el, { attributes: true, attributeFilter: ['style', 'class'] }); }
        }
      });
      observed = observed.filter(function (el) { return el.isConnected; });
    };
    var parents = new MutationObserver(follow);
    [desk, document.body].forEach(function (el) { if (el && el.nodeType === 1) parents.observe(el, { childList: true }); });
    follow();
    fitAll();
    schedule();
    // The shell may now open DSM Apps in this page
    post({ internal: 'fitReady' });
  };

  // ---- Oversized content (single-App mode only) ----------------------------
  // Two generic rules for desktop layouts that do not fit a phone, decided
  // from the rendered page, never from App names. Both run on the App window
  // on screen, after DSM's own (re)renders, seen by one MutationObserver.
  //  1. Fit or expand: a graphic wider than the box it sits in (Storage
  //     Manager's disk bay) is scaled down to fit, with transform, so the
  //     element and its click targets stay DSM's own. Its layout footprint
  //     shrinks with it (negative margins), so nothing below overlaps or
  //     leaves a gap. Below MIN_SCALE it keeps its size and its box scrolls
  //     sideways instead. A small button opens a full-screen viewer at
  //     native size with pan and pinch; back closes the viewer first.
  //  2. Reflow: short absolutely positioned text (a desktop column) that
  //     lands on the text of the header it sits in moves into normal flow,
  //     on its own line, and the header grows to hold it.
  var MIN_SCALE = 0.5, CAP = 3000;
  // Never a graphic: fields and editable content, tables and grids (they
  // scroll sideways), toolbars and tab strips (they scroll and fade), forms
  var NOT_GRAPHIC = 'input, textarea, select, [contenteditable=""], [contenteditable="true"], table, [role=grid], [role=table], [role=toolbar], .x-grid3, .x-toolbar, .v-toolbar, .x-tab-strip-wrap, .x-form-item, .x-panel, iframe';
  // Not looked into: content that scrolls sideways by design, menus, the fit's own nodes
  var NO_SCAN = 'table, [role=grid], [role=table], [role=toolbar], .x-grid3, .x-toolbar, .v-toolbar, .x-tab-strip-wrap, .spl-fit-hscroll, .spl-fit-nav-side, .x-menu, svg, canvas, iframe, img, .spl-fit-scaled';
  // Positioned by a layout manager, or floating: never reflowed
  var NO_REFLOW = '.x-box-inner, .x-column-inner, .x-abs-layout-container, .x-toolbar, .x-grid3, table, [role=grid], [role=toolbar], [role=tooltip], [class*=tooltip], [class*=popover], .x-layer, .x-tip, .x-menu, .x-form-item, svg';
  var CONTROL = 'input, textarea, select, button, [role=button], [contenteditable=""], [contenteditable="true"]';
  var PHRASING = /^(SPAN|A|B|STRONG|EM|I|SMALL|FONT|SUB|SUP|BR)$/;
  var px = function (v) { var n = parseFloat(v); return isNaN(n) ? 0 : n; };
  var visible = function (e) { return !!(e && e.getClientRects && e.getClientRects().length && e.offsetWidth); };
  /** The room an element has: the narrowest box around it up to the App window, and the screen */
  var roomOf = function (e, root) {
    var room = window.innerWidth;
    for (var a = e.parentElement; a && a !== document.body; a = a.parentElement) {
      if (a.clientWidth) room = Math.min(room, a.clientWidth);
      if (a === root) break;
    }
    return room;
  };
  /** Content that scrolls sideways on purpose (a carousel): its own overflow-x scrolls, overflow-y does not */
  var sideways = function (e) {
    var cs = getComputedStyle(e);
    return (cs.overflowX === 'auto' || cs.overflowX === 'scroll') && cs.overflowY === 'hidden' && !/\bps\b/.test(String(e.className));
  };
  /** Mostly picture: images, drawings and background images cover at least 30% of it */
  var picture = function (e) {
    var area = e.offsetWidth * e.offsetHeight, covered = 0;
    var all = [e].concat(Array.prototype.slice.call(e.querySelectorAll('*'), 0, 120));
    for (var i = 0; i < all.length && covered < area * 0.3; i++) {
      var n = all[i], drawn = /^(IMG|svg|SVG|CANVAS)$/.test(n.tagName);
      if (!drawn && String(getComputedStyle(n).backgroundImage || '').indexOf('url(') < 0) continue;
      var r = n.getBoundingClientRect();
      covered = Math.max(covered, r.width * r.height);
    }
    return area > 0 && covered >= area * 0.3;
  };
  /** Graphic-like: a picture with little text and nothing to type into */
  var graphic = function (e) {
    if (e.offsetWidth < 64 || e.offsetHeight < 24 || e.matches(NOT_GRAPHIC) || e.querySelector(NOT_GRAPHIC)) return false;
    if (String(e.textContent || '').replace(/\s+/g, ' ').trim().length > 160) return false;
    return picture(e);
  };

  var fits = [], fitState = typeof WeakMap === 'function' ? new WeakMap() : null;
  var setVar = function (e, name, value) { if (e.style.getPropertyValue(name) !== value) e.style.setProperty(name, value); };
  var unfit = function (rec) {
    var e = rec.el;
    e.classList.remove('spl-fit-scaled');
    ['--spl-fit-s', '--spl-fit-x', '--spl-fit-mr', '--spl-fit-mb'].forEach(function (n) { e.style.removeProperty(n); });
    if (rec.pan) rec.pan.classList.remove('spl-fit-pan');
    if (rec.button && rec.button.parentNode) rec.button.parentNode.removeChild(rec.button);
    fitState.delete(e);
  };
  /** Scale (or let scroll) one oversized element; false when it fits again */
  var fitOne = function (rec, root) {
    var e = rec.el;
    if (!e.isConnected || !root.contains(e)) return false;
    if (!visible(e)) return true; // a page switched away: keep the decision for later
    // Measured without its own scaling: the negative margin that shrinks its footprint
    // also widens a box of auto width, which would then always look too wide
    var was = e.classList.contains('spl-fit-scaled');
    if (was) e.classList.remove('spl-fit-scaled');
    var w = e.offsetWidth, h = e.offsetHeight, parent = e.parentElement, cs = getComputedStyle(parent);
    if (was) e.classList.add('spl-fit-scaled');
    // Fit the content box of its parent, never more than the narrowest box around it
    var pr = parent.getBoundingClientRect(), left = pr.left + (parent.clientLeft || 0) + px(cs.paddingLeft);
    var inner = parent.clientWidth - px(cs.paddingLeft) - px(cs.paddingRight), most = roomOf(e, root);
    if (inner < 40 || inner > most) inner = most;
    var room = { left: Math.max(0, left), right: Math.min(window.innerWidth, Math.max(0, left) + inner) };
    var s = (room.right - room.left) / w;
    if (s >= 0.995) return false;
    if (!rec.margins) { var own = getComputedStyle(e); rec.margins = [px(own.marginRight), px(own.marginBottom)]; }
    if (s < MIN_SCALE) {
      // Too small to read: native size, and its box scrolls sideways
      if (e.classList.contains('spl-fit-scaled')) { e.classList.remove('spl-fit-scaled'); }
      rec.pan = parent; rec.scale = 1;
      if (!parent.classList.contains('spl-fit-pan')) parent.classList.add('spl-fit-pan');
      return true;
    }
    if (rec.pan) { rec.pan.classList.remove('spl-fit-pan'); rec.pan = null; }
    s = Math.floor(s * 1000) / 1000;
    rec.scale = s;
    setVar(e, '--spl-fit-s', String(s));
    setVar(e, '--spl-fit-mr', Math.round(rec.margins[0] - w * (1 - s)) + 'px');
    setVar(e, '--spl-fit-mb', Math.round(rec.margins[1] - h * (1 - s)) + 'px');
    if (!e.style.getPropertyValue('--spl-fit-x')) e.style.setProperty('--spl-fit-x', '0px');
    if (!e.classList.contains('spl-fit-scaled')) e.classList.add('spl-fit-scaled');
    // Where it shows now: keep it inside its box, centered when there is room
    var r = e.getBoundingClientRect(), x = px(e.style.getPropertyValue('--spl-fit-x'));
    var want = room.left + Math.max(0, (room.right - room.left - r.width) / 2);
    var next = Math.round(x + want - r.left);
    if (Math.abs(next - x) >= 1) setVar(e, '--spl-fit-x', next + 'px');
    return true;
  };
  /** Find elements wider than every box around them, top-down */
  var findOversized = function (root) {
    var found = [], seen = 0;
    var walk = function (parent, lim, depth) {
      var kids = parent.children || [];
      for (var i = 0; i < kids.length && seen < CAP; i++) {
        var c = kids[i]; seen++;
        if (!visible(c) || c.classList.contains('spl-fit-layer') || fitState.has(c)) continue;
        var w = c.getBoundingClientRect().width;
        // An image wider than the box that clips it (a screenshot carousel): the image itself
        if (c.tagName === 'IMG') { if (w > lim + 2 && graphic(c)) found.push(c); continue; }
        if (c.matches(NO_SCAN)) continue;
        if (w > lim + 2 && graphic(c)) { found.push(c); continue; }
        if (depth < 60 && c.children && c.children.length && !sideways(c)) walk(c, c.clientWidth ? Math.min(lim, c.clientWidth) : lim, depth + 1);
      }
    };
    walk(root, Math.min(window.innerWidth, root.clientWidth || window.innerWidth), 0);
    return found;
  };

  // The expand button: an icon in a layer of the fit's own, over the App,
  // placed at the graphic's top-right corner, shown only while that corner
  // is the graphic itself (not covered by a dialog, a menu or the screen edge).
  var layer = null, placing = false;
  var EXPAND = 'M4 4h6v2H7.4l3.3 3.3-1.4 1.4L6 7.4V10H4V4zm16 0v6h-2V7.4l-3.3 3.3-1.4-1.4L16.6 6H14V4h6zM4 20v-6h2v2.6l3.3-3.3 1.4 1.4L7.4 18H10v2H4zm16 0h-6v-2h2.6l-3.3-3.3 1.4-1.4 3.3 3.3V14h2v6z';
  var CLOSE = 'M6.4 5 12 10.6 17.6 5 19 6.4 13.4 12 19 17.6 17.6 19 12 13.4 6.4 19 5 17.6 10.6 12 5 6.4z';
  var icon = function (path) {
    var svg = document.createElementNS(SVG, 'svg'), p = document.createElementNS(SVG, 'path');
    svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('width', '18'); svg.setAttribute('height', '18'); svg.setAttribute('fill', 'currentColor');
    p.setAttribute('d', path); svg.appendChild(p);
    return svg;
  };
  var button = function (label, path, cls) {
    var b = document.createElement('button');
    b.type = 'button'; b.className = cls; b.setAttribute('aria-label', label);
    b.appendChild(icon(path));
    // Ext and DSM act on mousedown (window drags, menus closing): the button is the fit's own
    b.addEventListener('mousedown', function (ev) { ev.stopPropagation(); });
    return b;
  };
  var ours = function (n) { for (; n; n = n.parentNode) if (n === layer || (viewer && n === viewer.el) || (sheet && (n === sheet.box || n === sheet.back))) return true; return false; };
  var place = function () {
    placing = false;
    if (!layer) return;
    fits.forEach(function (rec) {
      var b = rec.button;
      if (!b) return;
      var show = false;
      if (!viewer && visible(rec.el)) {
        var r = (rec.pan || rec.el).getBoundingClientRect(), x = Math.min(r.right, window.innerWidth) - 36, y = Math.max(r.top, 0) + 6;
        var hit = document.elementsFromPoint ? document.elementsFromPoint(x + 14, y + 14) : [];
        var top = null;
        for (var i = 0; i < hit.length; i++) if (!ours(hit[i])) { top = hit[i]; break; }
        show = !!top && (rec.el.contains(top) || (!!rec.pan && rec.pan.contains(top))) && y + 28 <= r.bottom;
        if (show) { b.style.left = Math.round(x) + 'px'; b.style.top = Math.round(y) + 'px'; }
      }
      if (b.hidden === show) b.hidden = !show;
    });
  };
  var placeSoon = function () {
    if (placing || !fits.length) return;
    placing = true;
    (window.requestAnimationFrame || setTimeout)(place);
  };

  // The viewer: a copy, not DSM's element. Moving the live element out of
  // its App would break DSM's Vue patching (it inserts next to the element
  // it remembers) and the App's descendant styles, and would need DSM's
  // state put back exactly on close. The copy keeps every style: it sits
  // in shallow copies of its ancestors (classes, attributes), so the App's
  // selectors match it as they match the original. It is for looking at;
  // actions stay on the fitted original, which this never touches.
  var viewer = null;
  var copyOf = function (e) {
    var copy = e.cloneNode(true), from = e.querySelectorAll('canvas'), to = copy.querySelectorAll('canvas');
    for (var i = 0; i < from.length && i < to.length; i++) { try { to[i].getContext('2d').drawImage(from[i], 0, 0); } catch (err) { /* tainted or empty */ } }
    copy.classList.remove('spl-fit-scaled');
    ['--spl-fit-s', '--spl-fit-x', '--spl-fit-mr', '--spl-fit-mb'].forEach(function (n) { copy.style.removeProperty(n); });
    copy.removeAttribute('id');
    Array.prototype.forEach.call(copy.querySelectorAll('[id]'), function (n) { n.removeAttribute('id'); });
    copy.classList.add('spl-fit-viewer-copy');
    copy.style.width = e.offsetWidth + 'px';
    return copy;
  };
  var openViewer = function (rec) {
    if (viewer || !visible(rec.el)) return;
    var e = rec.el, w = e.offsetWidth, h = e.offsetHeight, zoom = 1, pinch = null;
    var v = document.createElement('div'), pan = document.createElement('div'), sizer = document.createElement('div'), stage = document.createElement('div');
    v.className = 'spl-fit-viewer'; v.setAttribute('role', 'dialog'); v.setAttribute('aria-modal', 'true');
    pan.className = 'spl-fit-viewer-pan'; sizer.className = 'spl-fit-viewer-sizer'; stage.className = 'spl-fit-viewer-stage';
    var chain = [];
    for (var a = e.parentElement; a && a !== document.body && a !== document.documentElement; a = a.parentElement) chain.unshift(a);
    var holder = stage;
    chain.forEach(function (n) {
      var c = n.cloneNode(false);
      c.removeAttribute('id'); c.removeAttribute('style'); c.classList.add('spl-fit-chain');
      holder.appendChild(c); holder = c;
    });
    holder.appendChild(copyOf(e));
    stage.setAttribute('inert', ''); stage.setAttribute('aria-hidden', 'true');
    stage.style.width = w + 'px';
    sizer.appendChild(stage); pan.appendChild(sizer); v.appendChild(pan);
    var close = button('Close', CLOSE, 'spl-fit-viewer-close');
    close.addEventListener('click', function (ev) { ev.stopPropagation(); closeViewer(); });
    v.appendChild(close);
    var least = function () { return Math.min(1, (window.innerWidth - 32) / w, (window.innerHeight - 32) / h); };
    var zoomTo = function (z, cx, cy) {
      z = Math.max(least(), Math.min(4, z));
      var x = (pan.scrollLeft + cx) / zoom, y = (pan.scrollTop + cy) / zoom;
      zoom = z;
      stage.style.transform = 'scale(' + z + ')';
      sizer.style.width = Math.ceil(w * z) + 'px'; sizer.style.height = Math.ceil(h * z) + 'px';
      pan.scrollLeft = x * z - cx; pan.scrollTop = y * z - cy;
    };
    var spread = function (t) { return Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY) || 1; };
    // One finger pans (native scrolling); two fingers zoom around their midpoint
    pan.addEventListener('touchstart', function (ev) { if (ev.touches.length === 2) { pinch = { d: spread(ev.touches), z: zoom }; ev.preventDefault(); } }, { passive: false });
    pan.addEventListener('touchmove', function (ev) {
      if (!pinch || ev.touches.length !== 2) return;
      ev.preventDefault();
      var r = pan.getBoundingClientRect(), t = ev.touches;
      zoomTo(pinch.z * spread(t) / pinch.d, (t[0].clientX + t[1].clientX) / 2 - r.left, (t[0].clientY + t[1].clientY) / 2 - r.top);
    }, { passive: false });
    pan.addEventListener('touchend', function (ev) { if (ev.touches.length < 2) pinch = null; });
    // Double tap: native size or the whole graphic
    pan.addEventListener('dblclick', function (ev) {
      var r = pan.getBoundingClientRect();
      zoomTo(zoom < 1 ? 1 : least(), ev.clientX - r.left, ev.clientY - r.top);
    });
    viewer = { el: v, rec: rec, fit: function () { zoomTo(zoom, 0, 0); } };
    document.body.appendChild(v);
    zoomTo(1, 0, 0);
    pan.scrollLeft = Math.max(0, (w - pan.clientWidth) / 2);
    place();
    last = ''; schedule();
  };
  var closeViewer = function () {
    if (!viewer) return;
    var v = viewer.el;
    viewer = null;
    if (v.parentNode) v.parentNode.removeChild(v);
    placeSoon();
    last = ''; schedule();
  };

  // A grid row's detail. Tapping a row stays DSM's own (select, double-tap
  // to open, its menus); the fit only adds a small button at the end of the
  // tapped row, and only when part of that row is cut off (a clamped or
  // clipped cell, or a column scrolled out of the grid's box). The button
  // opens a sheet from the bottom listing every column as header and value,
  // read from the grid's header and the row's cells. Back closes it.
  var INFO = 'M11 7h2v2h-2zm0 4h2v6h-2zm1-9C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8z';
  var sheet = null, infoRow = null, infoButton = null, infoPlacing = false;
  var cellText = function (el) {
    if (!el) return '';
    var t = String(el.innerText || el.textContent || '').replace(/[ \t ]+/g, ' ').replace(/\s*\n\s*/g, '\n').trim();
    if (t) return t;
    var tip = el.querySelector('[ext\\:qtip], [data-qtip], [title], img[alt], [aria-label]');
    var from = [el, tip].filter(Boolean);
    for (var i = 0; i < from.length; i++) {
      var v = from[i].getAttribute('ext:qtip') || from[i].getAttribute('data-qtip') || from[i].getAttribute('title') || from[i].getAttribute('alt') || from[i].getAttribute('aria-label');
      if (v && v.trim()) return v.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
    }
    return '';
  };
  var colOf = function (td) { var m = /(?:^|\s)x-grid3-td-(\S+)/.exec(td.className); return m ? m[1] : null; };
  /** Every column of a row, as [header, value], in the grid's order */
  var rowFields = function (row) {
    var grid = row.closest('.x-grid3'), heads = {}, out = [];
    if (grid) Array.prototype.forEach.call(grid.querySelectorAll('.x-grid3-header .x-grid3-hd-row > td'), function (td) {
      var id = colOf(td); if (id) heads[id] = cellText(td.querySelector('.x-grid3-hd-inner') || td);
    });
    Array.prototype.forEach.call(row.querySelectorAll('td.x-grid3-cell'), function (td) {
      if (getComputedStyle(td).display === 'none' || /x-grid3-(td-checker|td-numberer)/.test(td.className)) return;
      var value = cellText(td.querySelector('.x-grid3-cell-inner') || td), head = heads[colOf(td)] || '';
      if (value || head) out.push([head, value || '–']);
    });
    // The row body some grids show under the cells
    var body = row.querySelector('.x-grid3-row-body');
    if (body && cellText(body)) out.push(['', cellText(body)]);
    return out;
  };
  /** Part of the row is not shown: a cut cell, or a cell outside the grid's box */
  var rowCut = function (row) {
    var sc = row.closest('.x-grid3-scroller'), sr = sc && sc.getBoundingClientRect();
    var cells = row.querySelectorAll('td.x-grid3-cell');
    for (var i = 0; i < cells.length; i++) {
      var td = cells[i];
      if (!td.offsetWidth) continue;
      var inner = td.querySelector('.x-grid3-cell-inner') || td;
      if (inner.scrollWidth > inner.clientWidth + 1 || inner.scrollHeight > inner.clientHeight + 1) return true;
      var r = td.getBoundingClientRect();
      if (sr && (r.right > sr.right + 1 || r.left < sr.left - 1)) return true;
    }
    return false;
  };
  var placeInfo = function () {
    infoPlacing = false;
    if (!infoButton) return;
    var show = false, row = infoRow;
    if (row && !sheet && !viewer && narrow() && row.isConnected && visible(row)) {
      var sc = row.closest('.x-grid3-scroller'), sr = sc ? sc.getBoundingClientRect() : row.getBoundingClientRect(), r = row.getBoundingClientRect();
      var top = Math.max(r.top, sr.top), bottom = Math.min(r.bottom, sr.bottom);
      var x = Math.min(r.right, sr.right, window.innerWidth) - 34, y = Math.round((top + bottom) / 2) - 14;
      if (bottom - top >= 20 && rowCut(row)) {
        var hit = document.elementsFromPoint ? document.elementsFromPoint(x + 14, y + 14) : [], first = null;
        for (var i = 0; i < hit.length; i++) if (!ours(hit[i])) { first = hit[i]; break; }
        show = !!first && !!sc && sc.contains(first);
        if (show) { infoButton.style.left = Math.round(x) + 'px'; infoButton.style.top = y + 'px'; }
      }
    }
    if (infoButton.hidden === show) infoButton.hidden = !show;
  };
  var placeInfoSoon = function () {
    if (infoPlacing || !infoRow) return;
    infoPlacing = true;
    (window.requestAnimationFrame || setTimeout)(placeInfo);
  };
  var openSheet = function (row) {
    if (sheet || !row || !row.isConnected) return;
    var fields = rowFields(row);
    if (!fields.length) return;
    var back = document.createElement('div'), box = document.createElement('div'), grip = document.createElement('div'), list = document.createElement('dl');
    back.className = 'spl-fit-rowsheet-back';
    box.className = 'spl-fit-rowsheet'; box.setAttribute('role', 'dialog'); box.setAttribute('aria-modal', 'true');
    grip.className = 'spl-fit-rowsheet-grip';
    fields.forEach(function (f) {
      var dt = document.createElement('dt'), dd = document.createElement('dd');
      dt.textContent = f[0]; dd.textContent = f[1];
      list.appendChild(dt); list.appendChild(dd);
    });
    var close = button('Close', CLOSE, 'spl-fit-rowsheet-close');
    close.addEventListener('click', function (ev) { ev.stopPropagation(); closeSheet(); });
    box.appendChild(grip); box.appendChild(close); box.appendChild(list);
    // The sheet is the fit's own: DSM never sees its taps
    [back, box].forEach(function (n) {
      ['mousedown', 'mouseup', 'click', 'dblclick', 'contextmenu', 'touchstart', 'touchend'].forEach(function (t) { n.addEventListener(t, function (ev) { ev.stopPropagation(); }); });
    });
    back.addEventListener('click', function () { closeSheet(); });
    sheet = { back: back, box: box, row: row };
    document.body.appendChild(back); document.body.appendChild(box);
    placeInfo();
    last = ''; schedule();
  };
  var closeSheet = function () {
    if (!sheet) return;
    var s = sheet;
    sheet = null;
    [s.back, s.box].forEach(function (n) { if (n.parentNode) n.parentNode.removeChild(n); });
    placeInfoSoon();
    last = ''; schedule();
  };
  var rowTapped = function (ev) {
    var t = ev && ev.target;
    if (!narrow() || !t || !t.closest || ours(t)) return;
    var row = t.closest('.x-grid3-row');
    infoRow = row && row.closest('.x-grid3-body') ? row : null;
    if (!infoRow) { if (infoButton) infoButton.hidden = true; return; }
    if (!infoButton) {
      if (!layer) { layer = document.createElement('div'); layer.className = 'spl-fit-layer'; document.body.appendChild(layer); }
      infoButton = button('Details', INFO, 'spl-fit-rowinfo');
      infoButton.hidden = true;
      infoButton.addEventListener('click', function (e) { e.stopPropagation(); openSheet(infoRow); });
      layer.appendChild(infoButton);
    }
    // After DSM's own answer to the tap (selection restyles the row)
    setTimeout(placeInfo, 60);
  };
  var rowsHooked = false;
  var hookRows = function () {
    if (rowsHooked) return;
    rowsHooked = true;
    document.addEventListener('click', rowTapped, true);
    document.addEventListener('scroll', placeInfoSoon, { capture: true, passive: true });
    window.addEventListener('resize', placeInfoSoon);
  };

  /** Text of the element itself (not of its children) */
  var ownText = function (e) {
    for (var n = e.firstChild; n; n = n.nextSibling) if (n.nodeType === 3 && /\S/.test(n.nodeValue)) return true;
    return false;
  };
  /** Short text only: phrasing children, nothing to press or type into */
  var textOnly = function (e) {
    var text = String(e.textContent || '').replace(/\s+/g, ' ').trim();
    if (!text || text.length > 120 || e.matches(CONTROL) || e.querySelector(CONTROL)) return false;
    var all = e.querySelectorAll('*');
    for (var i = 0; i < all.length; i++) if (!PHRASING.test(all[i].tagName) || !/^inline/.test(getComputedStyle(all[i]).display)) return false;
    return true;
  };
  var meets = function (a, b) { return Math.min(a.right, b.right) - Math.max(a.left, b.left) > 3 && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 3; };
  /** Boxes of the in-flow text in a header as shown: its own lines, cut where a box hides overflow (an ellipsis) */
  var flowText = function (cb) {
    var boxes = [], all = cb.querySelectorAll('*');
    for (var i = 0; i < all.length && i < 300; i++) {
      var t = all[i];
      if (!ownText(t) || !visible(t)) continue;
      var flow = true, clip = null;
      for (var a = t; a && a !== cb; a = a.parentElement) {
        var cs = getComputedStyle(a);
        if (cs.position === 'absolute' || cs.position === 'fixed') { flow = false; break; }
        if (cs.overflowX && cs.overflowX !== 'visible') {
          var c = a.getBoundingClientRect();
          clip = clip ? { left: Math.max(clip.left, c.left), right: Math.min(clip.right, c.right), top: Math.max(clip.top, c.top), bottom: Math.min(clip.bottom, c.bottom) } : { left: c.left, right: c.right, top: c.top, bottom: c.bottom };
        }
      }
      if (!flow) continue;
      var lines = [];
      if (document.createRange) {
        for (var n = t.firstChild; n; n = n.nextSibling) {
          if (n.nodeType !== 3 || !/\S/.test(n.nodeValue)) continue;
          var range = document.createRange(); range.selectNodeContents(n);
          Array.prototype.push.apply(lines, Array.prototype.slice.call(range.getClientRects()));
        }
      } else lines.push(t.getBoundingClientRect());
      lines.forEach(function (r) {
        if (clip) r = { left: Math.max(r.left, clip.left), right: Math.min(r.right, clip.right), top: Math.max(r.top, clip.top), bottom: Math.min(r.bottom, clip.bottom) };
        if (r.right > r.left && r.bottom > r.top) boxes.push(r);
      });
    }
    return boxes;
  };
  var reflowed = [], reflowState = typeof WeakMap === 'function' ? new WeakMap() : null, reflowWidth = 0;
  var unflow = function (rec) {
    rec.group.forEach(function (g) { g.classList.remove('spl-fit-reflow'); reflowState.delete(g); });
    if (rec.row) rec.row.classList.remove('spl-fit-reflow-row');
    rec.cb.classList.remove('spl-fit-reflow-grow');
  };
  var flow = function (rec) {
    rec.group.forEach(function (g) { if (!g.classList.contains('spl-fit-reflow')) g.classList.add('spl-fit-reflow'); });
    if (rec.row && !rec.row.classList.contains('spl-fit-reflow-row')) rec.row.classList.add('spl-fit-reflow-row');
    if (!rec.cb.classList.contains('spl-fit-reflow-grow')) rec.cb.classList.add('spl-fit-reflow-grow');
  };
  // A box whose height comes from a stylesheet (Package Center's detail
  // header) holds more lines once its text column is narrow: the content
  // spills out of its bottom and what follows is drawn over it. Such a box
  // grows to its content, never below its own height. Ext sets the sizes it
  // manages inline, so those boxes are left alone.
  // The same happens to a cell of a table drawn as a row of inline blocks, each
  // a stylesheet height with its line-height the same (one line of text): its
  // text wraps onto a second line, drawn over the cell under it on the next
  // line, or over what follows the row when the cell is on its last line.
  var grown = [];
  var ungrow = function (e) { e.classList.remove('spl-fit-grow'); e.style.removeProperty('--spl-fit-min'); };
  var inFlowBox = function (n) { return n.offsetHeight && !/absolute|fixed/.test(getComputedStyle(n).position); };
  /** Whether a box in the flow after e is drawn over its spilled part (r: its box, bottom: where its content ends) */
  var spillCovered = function (e, r, bottom, inline) {
    for (var a = e, depth = 0; a && depth < 4; a = a.parentElement, depth++) {
      for (var next = a.nextElementSibling; next; next = next.nextElementSibling) {
        if (!inFlowBox(next)) continue;
        var nr = next.getBoundingClientRect();
        // An inline block: the boxes on its own line sit beside it, the next lines are under it
        if (inline && a === e && nr.top < r.bottom - 2) continue;
        if (nr.top >= bottom - 2) break;
        if (nr.right > r.left && nr.left < r.right) return true;
        if (!(inline && a === e)) break;
      }
      // A block stops at what follows it; an inline block's row may end before its spill does
      if (!inline || !a.parentElement || a.parentElement.getBoundingClientRect().bottom >= bottom - 2) return false;
    }
    return false;
  };
  /** Where a box's own lines of text end (they wrap past its height when it is narrow) */
  var textBottom = function (e) {
    var bottom = -Infinity;
    for (var n = e.firstChild; n; n = n.nextSibling) {
      if (n.nodeType !== 3 || !/\S/.test(n.nodeValue)) continue;
      if (!document.createRange) return e.getBoundingClientRect().top + e.scrollHeight;
      var range = document.createRange(); range.selectNodeContents(n);
      Array.prototype.forEach.call(range.getClientRects(), function (l) { bottom = Math.max(bottom, l.bottom); });
    }
    return bottom;
  };
  var findSpills = function (root) {
    var found = [], all = root.querySelectorAll('div, form');
    for (var i = 0; i < all.length && i < CAP; i++) {
      var e = all[i];
      // Cheap first: scrollHeight counts content spilling out of a visible box
      if (!e.offsetHeight || e.scrollHeight <= e.clientHeight + 2 || e.style.height || e.classList.contains('spl-fit-grow')) continue;
      if (!e.firstElementChild && !/\S/.test(e.textContent || '')) continue;
      var cs = getComputedStyle(e);
      if (cs.overflowY !== 'visible' || cs.position === 'absolute' || cs.position === 'fixed' || (e.closest && e.closest(LEAF_SKIP))) continue;
      var r = e.getBoundingClientRect(), top = Infinity, bottom = -Infinity;
      for (var c = e.firstElementChild; c; c = c.nextElementSibling) {
        var s = getComputedStyle(c);
        if (s.position === 'absolute' || s.position === 'fixed' || !c.offsetHeight) continue;
        var cr = c.getBoundingClientRect();
        top = Math.min(top, cr.top - px(s.marginTop)); bottom = Math.max(bottom, cr.bottom + px(s.marginBottom));
      }
      var inline = /^inline-/.test(cs.display), lines = inline ? textBottom(e) : -Infinity;
      if (lines > r.bottom + 2) { top = Math.min(top, r.top); bottom = Math.max(bottom, lines); }
      if (bottom - top <= e.clientHeight + 2 || bottom <= r.bottom + 2) continue;
      // Only when what comes next in the flow is drawn over the spilled part
      if (!spillCovered(e, r, bottom, inline)) continue;
      e.style.setProperty('--spl-fit-min', Math.round(r.height) + 'px');
      found.push(e);
    }
    return found;
  };
  /** Absolutely positioned text over the in-flow text of the header it sits in */
  var findOverlaps = function (root) {
    var found = [], all = root.querySelectorAll('*');
    for (var i = 0; i < all.length && i < CAP; i++) {
      var e = all[i];
      if (reflowState.has(e) || getComputedStyle(e).position !== 'absolute' || !visible(e) || e.closest(NO_REFLOW) || !textOnly(e)) continue;
      // The header: its containing block, a row of the App, not a page
      var cb = e.offsetParent;
      if (!cb || cb === root || !root.contains(cb) || cb.offsetHeight > 160) continue;
      var text = flowText(cb), mine = e.getBoundingClientRect();
      if (!text.some(function (r) { return meets(r, mine); })) continue;
      // Positioned siblings drawn with it (a usage bar over the same title) move with it
      var group = [], parent = e.parentElement;
      Array.prototype.forEach.call(parent.children, function (s) {
        if (s === e) { group.push(s); return; }
        if (reflowState.has(s) || getComputedStyle(s).position !== 'absolute' || !visible(s) || s.matches(CONTROL) || s.querySelector(CONTROL) || s.offsetHeight > 40) return;
        var r = s.getBoundingClientRect();
        if (text.some(function (t) { return meets(t, r); })) group.push(s);
      });
      var display = getComputedStyle(parent).display;
      var rec = { group: group, cb: cb, row: /flex/.test(display) ? parent : null, n: 0 };
      group.forEach(function (g) { reflowState.set(g, rec); });
      found.push(rec);
    }
    return found;
  };

  // ---- Squeezed layouts (single-App mode) -----------------------------------
  // Desktop layouts put boxes side by side at fixed widths: a 300 px menu
  // column, a 180 px label column, a 520 px text block next to an icon, a row
  // of legend items. On a phone the box next to them gets almost nothing.
  // Six generic repairs, decided from the rendered page, never from App
  // names, each undone when the width changes (DSM's layout comes back first):
  //  a. Side navigation (a column of menu items) that leaves the content next
  //     to it under 60% of the screen: a menu behind the shell's menu button,
  //     as drawer() does for Ext windows. For pages and windows DSM gives no
  //     menu of its own (an App's own page outside DSM's window manager).
  //  b. A flex row whose items run past its edge wraps onto more lines.
  //  c. A box set wider than the room it has (a stylesheet or inline width)
  //     is capped at that room; next to an icon on the same line, at the room
  //     beside the icon, so it stays on that line.
  //  d. Text crushed into a column (one character per line) or squeezed to
  //     nothing beside another box (a fixed label column): the row it sits in
  //     stacks its boxes, label above value. Kept only when the text is then
  //     readable; otherwise the next row up is tried.
  //  e. Floated cards side by side stack (see floatCards).
  //  f. Rows of fixed boxes that line up as a table scale or scroll (see fixedRows).
  // What is still squeezed after these keeps a readable width (keepWide).
  var NAV_ROLE = 'nav, [role=navigation], [role=tree], [role=menu], [role=menubar], [role=tablist]';
  var NAV_ITEM = '[role=menuitem], [role=treeitem], [role=tab], [role=option], [role=link], a[href], li';
  var NAV_SELECTED = '[aria-selected=true], [aria-current]:not([aria-current=false]), .activated, .selected, .active, .is-active';
  // Not repaired: what scrolls sideways on purpose (grids, toolbars, DSM's perfect-scrollbar rows that scroll), graphics, the fit's own
  var NO_REPAIR = LEAF_SKIP + ', .ps--active-x, .x-form-item-label, svg, canvas, iframe, img, video, .spl-fit-scaled, .spl-fit-wide';
  var repairs = [];
  var keep = function (el, cls) { repairs.push({ el: el, cls: cls }); };
  // The variable a repair's class reads its size from
  var REPAIR_VAR = { 'spl-fit-cap': ['--spl-fit-cap'], 'spl-fit-pad': ['--spl-fit-pad'], 'spl-fit-meter': ['--spl-fit-h'], 'spl-fit-grow': ['--spl-fit-min'], 'spl-fit-rows-row': ['--spl-fit-row', '--spl-fit-zoom'] };
  var drop = function (r) { r.el.classList.remove(r.cls); (REPAIR_VAR[r.cls] || []).forEach(function (v) { r.el.style.removeProperty(v); }); };
  var undoRepairs = function () {
    repairs.forEach(drop);
    repairs = [];
  };
  var inFlow = function (c) { return visible(c) && !/absolute|fixed/.test(getComputedStyle(c).position); };
  var flowKids = function (e) { return Array.prototype.filter.call(e.children, inFlow); };

  // a. Side navigation
  var navLike = function (n) {
    if (n.querySelectorAll('input, textarea, select').length > 1) return false;
    if (n.matches(NAV_ROLE) || n.querySelector(NAV_ROLE)) return true;
    return n.querySelectorAll('[role=menuitem], [role=treeitem], [role=tab]').length >= 2;
  };
  var findSideNav = function (root) {
    var vw = window.innerWidth, all = root.querySelectorAll('div, section, main, aside, nav');
    for (var i = 0; i < all.length && i < CAP; i++) {
      var row = all[i];
      if (row.offsetWidth < vw * 0.85 || row.offsetHeight < 160 || row.closest(LEAF_SKIP)) continue;
      var cs = getComputedStyle(row);
      if (!/flex/.test(cs.display) || !/^row/.test(cs.flexDirection)) continue;
      var kids = flowKids(row);
      if (kids.length < 2 || kids.length > 3) continue;
      for (var j = 0; j < kids.length; j += kids.length - 1) {
        var nav = kids[j], main = null;
        kids.forEach(function (c) { if (c !== nav && (!main || c.offsetWidth > main.offsetWidth)) main = c; });
        var mr = main.getBoundingClientRect(), shown = Math.min(mr.right, vw) - Math.max(mr.left, 0);
        if (nav.offsetWidth >= row.clientWidth * 0.3 && shown < vw * 0.6 && nav.offsetHeight >= main.offsetHeight * 0.6 && navLike(nav)) return { row: row, nav: nav, main: main };
      }
    }
    return null;
  };
  /** The menu on a content root: the row it lives in, open and close, the page it shows */
  var makeNav = function (root, f) {
    var row = f.row, nav = f.nav, main = f.main, isOpen = false;
    row.classList.add('spl-fit-nav', 'spl-fit-nav-row'); nav.classList.add('spl-fit-nav-side'); main.classList.add('spl-fit-nav-main');
    var open = function (value) {
      if (value === isOpen) return;
      isOpen = value;
      row.classList.toggle('spl-fit-nav-open', value);
      schedule();
    };
    // A page choice closes the menu; a group that only expands keeps it open
    var onNav = function (e) {
      var t = e.target;
      if (!isOpen || !t.closest || t.closest('[aria-expanded], [class*=arrow], [class*=expand]')) return;
      if (t.closest(NAV_ITEM)) setTimeout(function () { open(false); }, 150);
    };
    // The dimmed content next to the open menu (the row's ::after) closes it
    var onRow = function (e) { if (isOpen && e.target === row) { e.stopPropagation(); open(false); } };
    nav.addEventListener('click', onNav);
    row.addEventListener('click', onRow, true);
    var watch = new MutationObserver(schedule);
    watch.observe(nav, { subtree: true, attributes: true, attributeFilter: ['class', 'aria-selected', 'aria-current'] });
    var ctl = {
      row: row,
      isOpen: function () { return isOpen; },
      open: open,
      page: function () {
        var items = nav.querySelectorAll(NAV_ITEM);
        for (var i = 0; i < items.length; i++) if (items[i].matches(NAV_SELECTED) || items[i].querySelector(NAV_SELECTED)) return plain(items[i].textContent).slice(0, 80);
        return '';
      },
      drop: function () {
        watch.disconnect();
        nav.removeEventListener('click', onNav);
        row.removeEventListener('click', onRow, true);
        row.classList.remove('spl-fit-nav', 'spl-fit-nav-row', 'spl-fit-nav-open'); nav.classList.remove('spl-fit-nav-side'); main.classList.remove('spl-fit-nav-main');
        if (root.splPnav === ctl) root.splPnav = null;
      },
    };
    root.splPnav = ctl;
    return ctl;
  };
  var navs = [];
  /** Ext windows get drawer(); DSM's Vue page-list windows have their own menu */
  var ownMenu = function (root) { return root.classList.contains('spl-fit-nav') || !!root.querySelector('.app-window-header-hamburger'); };
  var sideNav = function (root) {
    navs = navs.filter(function (n) {
      if (n.row.isConnected && narrow()) return true;
      n.drop(); return false;
    });
    if (!narrow() || (root.splPnav && root.splPnav.row.isConnected) || ownMenu(root)) return;
    var found = findSideNav(root);
    if (found) { navs.push(makeNav(root, found)); last = ''; schedule(); }
  };

  // b. Panes side by side (an App drawn with flex boxes, not Ext's border layout): a row that
  // takes most of the screen, where panes of a fixed width (a tree of devices, a list of alerts)
  // leave the pane that grows under PANE_ROOM of the row, turns into a column like stackSides():
  // the growing pane takes the height, each fixed pane folds to a bar with its first text, and a
  // tap on the bar opens it to PANE_SHARE of the column (dsm-fit.css) or folds it again.
  var PANE_ROOM = 0.6, PANE_MIN = 120, PANE_BAR = 40;
  var paneLabel = function (p) {
    var all = p.querySelectorAll('*');
    for (var i = 0; i < all.length && i < 300; i++) {
      var e = all[i];
      if (!e.firstElementChild && e.offsetWidth && /\S/.test(e.textContent || '')) return plain(e.textContent).slice(0, 60);
    }
    var tip = p.querySelector('[title], [aria-label]');
    return tip ? (tip.getAttribute('title') || tip.getAttribute('aria-label') || '').slice(0, 60) : '';
  };
  /** The colour under a pane, for its bar to cover the folded content */
  var paneBack = function (p) {
    for (var e = p; e && e.nodeType === 1; e = e.parentElement) {
      var c = getComputedStyle(e).backgroundColor;
      if (c && c !== 'transparent' && !/rgba\(.*,\s*0\)$/.test(c)) return c;
    }
    return '#fff';
  };
  var foldPane = function (p) {
    p.style.setProperty('--spl-fit-pane-bg', paneBack(p));
    if (p.splPane) return;
    p.splPane = true;
    // The bar takes the tap before the pane's own content under it
    p.addEventListener('click', function (e) {
      if (!p.classList.contains('spl-fit-pane')) return;
      var open = p.classList.contains('spl-fit-pane-open');
      if (open && e.clientY > p.getBoundingClientRect().top + PANE_BAR) return;
      e.stopPropagation(); e.preventDefault();
      p.classList.toggle('spl-fit-pane-open', !open);
      p.setAttribute('aria-expanded', open ? 'false' : 'true');
      // The App measures its boxes again (a grid of videos, a scrolled list)
      setTimeout(function () { try { window.dispatchEvent(new Event('resize')); } catch (err) { /* its own size */ } schedule(); }, 0);
    }, true);
  };
  var foldPanes = function (root) {
    var vw = window.innerWidth, vh = window.innerHeight, all = [root].concat(Array.prototype.slice.call(root.querySelectorAll('div, section, main, aside'), 0, CAP));
    for (var i = 0; i < all.length; i++) {
      var row = all[i];
      if (row.classList.contains('spl-fit-panes') || row.offsetWidth < vw * 0.85 || row.offsetHeight < vh * 0.5 || row.closest(LEAF_SKIP) || row.classList.contains('spl-fit-nav-row') || row.closest('.spl-fit-nav-side')) continue;
      var cs = getComputedStyle(row);
      if (!/flex/.test(cs.display) || !/^row/.test(cs.flexDirection)) continue;
      var kids = flowKids(row), main = null, sides = [];
      if (kids.length < 2 || kids.length > 3) continue;
      kids.forEach(function (c) { if ((parseFloat(getComputedStyle(c).flexGrow) || 0) > 0 && (!main || c.offsetWidth > main.offsetWidth)) main = c; });
      if (!main) continue;
      kids.forEach(function (c) { if (c !== main && c.offsetWidth >= PANE_MIN && c.offsetHeight >= main.offsetHeight * 0.6) sides.push(c); });
      var mr = main.getBoundingClientRect(), shown = Math.min(mr.right, vw) - Math.max(mr.left, 0);
      if (!sides.length || shown >= row.clientWidth * PANE_ROOM) continue;
      row.classList.remove('spl-fit-wrap');
      row.classList.add('spl-fit-panes'); keep(row, 'spl-fit-panes');
      main.classList.add('spl-fit-pane-main'); keep(main, 'spl-fit-pane-main');
      sides.forEach(function (p) {
        p.classList.add('spl-fit-pane'); keep(p, 'spl-fit-pane');
        p.setAttribute('data-spl-pane', paneLabel(p));
        if (p.getAttribute('aria-expanded') === null) p.setAttribute('aria-expanded', 'false');
        foldPane(p);
      });
    }
  };

  // c. Flex rows that run past their edge
  // An item under CRUSHED_ITEM px with text, its content (or a box in it) wider than it
  var CRUSHED_ITEM = 80, CRUSHED_LOOK = 12;
  var crushedItem = function (c) {
    if (c.offsetWidth >= CRUSHED_ITEM || !/\S/.test(c.textContent || '')) return false;
    if (c.scrollWidth > c.clientWidth + 4) return true;
    var inside = c.querySelectorAll('*');
    for (var i = 0; i < inside.length && i < CRUSHED_LOOK; i++) if (inside[i].clientWidth && inside[i].scrollWidth > inside[i].clientWidth + 4) return true;
    return false;
  };
  var wrapOne = function (e) {
    if (!e.firstElementChild || !e.firstElementChild.nextElementSibling || e.classList.contains('spl-fit-wrap') || e.classList.contains('spl-fit-nav-row') || e.classList.contains('spl-fit-panes') || !e.offsetWidth) return;
    // A number and its unit stay on one line (units())
    if (numUnit(e)) return;
    var cs = getComputedStyle(e);
    if (!/flex/.test(cs.display) || !/^row/.test(cs.flexDirection) || cs.flexWrap !== 'nowrap' || cs.overflowX === 'auto' || cs.overflowX === 'scroll') return;
    if (e.matches('[role=toolbar], [role=tablist], [role=menubar]') || e.closest(NO_REPAIR)) return;
    var kids = flowKids(e);
    if (kids.length < 2) return;
    var r = e.getBoundingClientRect(), left = r.left + px(cs.borderLeftWidth) + px(cs.paddingLeft), right = r.right - px(cs.borderRightWidth) - px(cs.paddingRight), out = false;
    kids.forEach(function (c) { var cr = c.getBoundingClientRect(); if (cr.right > right + 2 || cr.left < left - 2) out = true; });
    // Or the row fits only by crushing an item below what it holds: a legend entry shrunk to a
    // few characters, its title cut and its number and unit spilling out. Wrapped, each item keeps its width
    if (!out) kids.forEach(function (c) { if (!out && crushedItem(c)) out = true; });
    // Or a header squeezes its title or its controls onto more lines (see squeezedHeader)
    if (!out) out = squeezedHeader(kids);
    if (!out) return;
    var before = kids.map(function (c) { return c.getBoundingClientRect().height; });
    e.classList.add('spl-fit-wrap'); keep(e, 'spl-fit-wrap');
    wrappedCards(e, kids, before);
  };
  // A card header: a short title beside a group of controls (a CPU / Memory / Network switch).
  // At a phone's width the row keeps both side by side by breaking the title over two lines or
  // the buttons over two rows. Rule: in a flex row of a text-only item and an item of controls,
  // when the title (at most HEADER_TEXT characters) takes more than one line, or the controls
  // more than one row, the row wraps: the title on its line, the controls together on the next
  var HEADER_TEXT = 40, CONTROL = 'button, [role=button], [role=radio], [role=tab], select, input, .v-btn';
  /** How many lines a box's text takes: its text's line boxes at distinct heights */
  var textLines = function (e) {
    if (!document.createRange) return 1;
    var tops = [];
    var walk = function (el) {
      for (var n = el.firstChild; n; n = n.nextSibling) {
        if (n.nodeType !== 3 || !/\S/.test(n.nodeValue)) continue;
        var range = document.createRange(); range.selectNodeContents(n);
        Array.prototype.forEach.call(range.getClientRects(), function (r) {
          if (r.width > 0 && !tops.some(function (t) { return Math.abs(t - r.top) < r.height / 2; })) tops.push(r.top);
        });
      }
      Array.prototype.forEach.call(el.children, walk);
    };
    walk(e);
    return tops.length;
  };
  var squeezedHeader = function (kids) {
    var title = null, controls = null;
    kids.forEach(function (c) {
      if (c.querySelector(CONTROL) || c.matches(CONTROL)) controls = controls || c;
      else if (/\S/.test(c.textContent || '')) title = title || c;
    });
    if (!title || !controls) return false;
    var text = String(title.textContent || '').trim();
    if (text.length > HEADER_TEXT) return false;
    // (A name the App keeps on one line, cut by its ellipsis, is not a title broken over lines)
    var ts = getComputedStyle(title), oneLine = /nowrap|pre$/.test(ts.whiteSpace) || title.scrollWidth > title.clientWidth + 1;
    if (!oneLine && textLines(title) > 1) return true;
    // Controls on more than one row: their tops differ by more than half a control
    var tops = Array.prototype.map.call(controls.querySelectorAll(CONTROL), function (b) { var r = b.getBoundingClientRect(); return r.height ? { top: r.top, h: r.height } : null; }).filter(Boolean);
    return tops.some(function (t) { return Math.abs(t.top - tops[0].top) > tops[0].h / 2; });
  };
  // A dashboard's row of cards that wrapped, so each card takes a line of its own:
  //  - each card fills its line, though the App set it a desktop width (320 px of 350);
  //  - a card that spread its content over its desktop height (a status icon centred by
  //    a part of the card that grows, the card with no top padding of its own) takes its
  //    content's height instead, which brings its icon up against its top edge. It gets a
  //    top padding like its other sides (CARD_PAD_MIN to CARD_PAD_MAX px), and the part that
  //    grew keeps a gap (CARD_GAP px) from what follows it.
  //  A card is a box at least WRAP_CARD_W of the row wide and WRAP_CARD_H high
  var WRAP_CARD_W = 0.6, WRAP_CARD_H = 60, CARD_PAD_MIN = 12, CARD_PAD_MAX = 24, CARD_GAP = 12;
  var wrappedCards = function (e, kids, before) {
    var rects = kids.map(function (c) { return c.getBoundingClientRect(); }), inner = e.clientWidth;
    var alone = rects.every(function (r, i) { return rects.every(function (o, j) { return i === j || Math.min(r.bottom, o.bottom) - Math.max(r.top, o.top) <= 2; }); });
    var cards = rects.every(function (r) { return r.width >= inner * WRAP_CARD_W && r.height >= WRAP_CARD_H; });
    if (!alone || !cards) return;
    e.classList.add('spl-fit-wrap-fill'); keep(e, 'spl-fit-wrap-fill');
    kids.forEach(function (c, i) {
      var cs = getComputedStyle(c);
      if (!/flex/.test(cs.display) || !/^column/.test(cs.flexDirection) || c.getBoundingClientRect().height >= before[i] - 8) return;
      var parts = flowKids(c), grew = parts.filter(function (k) { return (parseFloat(getComputedStyle(k).flexGrow) || 0) > 0; })[0];
      if (!grew) return;
      var pad = Math.min(CARD_PAD_MAX, Math.max(CARD_PAD_MIN, px(cs.paddingBottom), px(cs.paddingLeft), px(cs.paddingRight)));
      if (px(cs.paddingTop) < pad) {
        c.style.setProperty('--spl-fit-pad', Math.round(pad) + 'px');
        c.classList.add('spl-fit-pad'); keep(c, 'spl-fit-pad');
      }
      if (grew !== parts[parts.length - 1]) { grew.classList.add('spl-fit-gap'); keep(grew, 'spl-fit-gap'); }
    });
  };
  var wrapRows = function (root) {
    var all = root.querySelectorAll('*');
    for (var i = 0; i < all.length && i < CAP; i++) wrapOne(all[i]);
  };
  /** Rows the page has just drawn again (a list's status refresh): wrapped
   * before they are painted, so the cut-off row never shows. The inserted
   * nodes themselves first, then what is inside them, up to a budget (a whole
   * page drawn at once waits for the content pass) */
  var ADDED_CAP = 200, ADDED_INSIDE = 600;
  var wrapAdded = function (records) {
    if (!singleOn || !narrow() || !records) return false;
    var before = repairs.length, nodes = [];
    for (var i = 0; i < records.length && nodes.length < ADDED_CAP; i++) {
      var added = records[i].addedNodes;
      for (var j = 0; added && j < added.length && nodes.length < ADDED_CAP; j++) {
        var e = added[j];
        if (e.nodeType === 1 && e.isConnected && !ours(e)) nodes.push(e);
      }
    }
    // A pane row the App just drew folds before it is painted: the side-by-side layout never shows
    var vw = window.innerWidth, vh = window.innerHeight;
    nodes.forEach(function (n) { if (n.offsetWidth >= vw * 0.85 && n.offsetHeight >= vh * 0.5) step(function () { foldPanes(n); }); });
    nodes.forEach(function (n) { step(function () { wrapOne(n); }); });
    var left = ADDED_INSIDE;
    nodes.forEach(function (n) {
      var inside = n.querySelectorAll('*');
      if (!inside.length || inside.length > left) return;
      left -= inside.length;
      step(function () { for (var k = 0; k < inside.length; k++) wrapOne(inside[k]); });
    });
    return repairs.length !== before;
  };

  // b2. Desktop gutters: a page's main panel padded and centred for a desktop
  //     window (Active Backup's Portal: 30 px of padding inside 30 px of
  //     margin a side) keeps less than 70% of a phone for its content. Rule:
  //     a block in the flow that spans the window, with GUTTER px or more of
  //     padding on both sides, keeps 12 px a side, no side margins
  //     and the full width; an Ext panel lays its items out again.
  var GUTTER = 24, GUTTER_SPAN = 0.8;
  var gutters = function (root) {
    var vw = window.innerWidth, all = root.querySelectorAll('div, section, main, form');
    for (var i = 0; i < all.length && i < CAP; i++) {
      var e = all[i];
      if (e.classList.contains('spl-fit-gutter')) { regutter(e); continue; }
      if (!e.offsetWidth || e.closest(NO_REPAIR)) continue;
      var cs = getComputedStyle(e);
      if (px(cs.paddingLeft) < GUTTER || px(cs.paddingRight) < GUTTER || cs.display !== 'block' || /absolute|fixed/.test(cs.position)) continue;
      if (e.offsetWidth + px(cs.marginLeft) + px(cs.marginRight) < vw * GUTTER_SPAN) continue;
      e.classList.add('spl-fit-gutter'); keep(e, 'spl-fit-gutter');
      // What the repairs did inside at the old width is decided again
      unsqueeze(e);
      regutter(e);
    }
  };
  // The App may size its panel's items to the old width again after the layout: a few more layouts, no more
  var GUTTER_LAYOUTS = 3;
  var regutter = function (e) {
    var cmp = e.id && window.Ext && Ext.getCmp && Ext.getCmp(e.id);
    if (!cmp || !cmp.doLayout || !cmp.layout || !cmp.items || !cmp.items.each || relaid.indexOf(cmp) >= 0) return;
    var inner = e.clientWidth - px(getComputedStyle(e).paddingLeft) - px(getComputedStyle(e).paddingRight), off = false;
    cmp.items.each(function (k) { if (k.rendered && !k.hidden && k.el && k.el.dom && k.el.dom.offsetWidth && Math.abs(k.el.dom.offsetWidth - inner) > 2) off = true; });
    if (!off && e.splGutterLayouts) return;
    e.splGutterLayouts = (e.splGutterLayouts || 0) + 1;
    // Ext lays the items out in the panel's style width, which the App set for the desktop
    if (e.splGutterLayouts <= GUTTER_LAYOUTS && /px$/.test(e.style.width)) e.style.removeProperty('width');
    if (e.splGutterLayouts <= GUTTER_LAYOUTS) relaid.push(cmp);
  };

  // c. Boxes wider than their room
  var INLINE = /^inline-(block|flex|grid|table)$/;
  // The moving parts of DSM's scrollers (fleXcroll, perfect-scrollbar, Vue v-scrollbar): never capped
  var SCROLLER_PART = '.mcontentwrapper, .contentwrapper, .ps, .v-scrollbar-view, .v-scrollbar-inner';
  var capWide = function (root) {
    var all = root.querySelectorAll('*');
    for (var i = 0; i < all.length && i < CAP; i++) {
      var e = all[i], parent = e.parentElement;
      if (!parent || !e.offsetWidth || e.classList.contains('spl-fit-cap')) continue;
      var cs = getComputedStyle(e);
      // An empty box (a progress bar's track) only where the box around it cuts it off
      if (!/\S/.test(e.textContent || '') && (e.children.length > 3 || e.querySelector('img, svg, canvas, video, iframe, input') || !/hidden|clip/.test(getComputedStyle(parent).overflowX))) continue;
      if (/absolute|fixed/.test(cs.position) || cs.display === 'inline' || cs.display === 'table-cell' || cs.display === 'table-row' || e.matches(SCROLLER_PART) || e.closest(NO_REPAIR)) continue;
      var pcs = getComputedStyle(parent);
      if (pcs.overflowX === 'auto' || pcs.overflowX === 'scroll' || /flex|grid/.test(pcs.display)) continue;
      // Only margins that take room: WebKit reports an over-wide block's used right margin as
      // negative (a 1024 px bar in a 402 px box: -622 px), which is no room at all
      var inner = parent.clientWidth - px(pcs.paddingLeft) - px(pcs.paddingRight), margins = Math.max(0, px(cs.marginLeft)) + Math.max(0, px(cs.marginRight));
      if (inner < 60) continue;
      var room = inner - margins;
      // Inline boxes before it on the same line (an icon): the room beside them, when there is enough
      if (INLINE.test(cs.display)) {
        var beside = 0;
        for (var s = e.previousElementSibling; s; s = s.previousElementSibling) {
          var ss = getComputedStyle(s);
          if (/absolute|fixed/.test(ss.position) || ss.display === 'none') continue;
          if (!INLINE.test(ss.display) && ss.display !== 'inline') break;
          beside += s.offsetWidth + px(ss.marginLeft) + px(ss.marginRight) + 4;
        }
        if (beside && room - beside >= Math.max(120, inner * 0.4)) room -= beside;
      }
      // A graphic is scaled or expanded instead (fitOne). A box that holds
      // controls is never one, even over a background picture (a banner
      // with its toolbar, set to a desktop min-width): it is capped.
      if (e.offsetWidth <= room + 4 || graphic(e)) continue;
      e.style.setProperty('--spl-fit-cap', Math.floor(room) + 'px');
      e.classList.add('spl-fit-cap'); keep(e, 'spl-fit-cap');
      // An Ext container laid its items out at the old width: lay them out at the new one
      var cmp = e.id && window.Ext && Ext.getCmp && Ext.getCmp(e.id);
      if (cmp && cmp.doLayout && cmp.layout && relaid.indexOf(cmp) < 0) relaid.push(cmp);
    }
    if (relaid.length) setTimeout(function () {
      relaid.forEach(function (c) { try { if (c.rendered && !c.isDestroyed) c.doLayout(false, true); } catch (err) { /* its own layout */ } });
      relaid = [];
    }, 0);
  };
  var relaid = [];

  // d. Crushed text: stack the row it sits in
  var STACKS = { flex: 'spl-fit-stack-flex', grid: 'spl-fit-stack-grid', other: 'spl-fit-stack' };
  var squashed = function (e) {
    var r = e.getBoundingClientRect(), cs = getComputedStyle(e);
    if (r.height < 4 || cs.visibility === 'hidden') return false;
    return crushed(e, r, function () { return cs; }) || (r.width < 4 && String(e.textContent || '').trim().length > 2);
  };
  var sideBySide = function (a, b) {
    return Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 2 && (b.right <= a.left + 2 || b.left >= a.right - 2);
  };
  var stackRows = function (root) {
    var all = root.querySelectorAll('*'), tried = 0;
    for (var i = 0; i < all.length && i < LEAF_CAP && tried < 20; i++) {
      var leaf = all[i];
      if (leaf.firstElementChild || !/\S/.test(leaf.textContent || '') || leaf.closest(NO_REPAIR) || !squashed(leaf)) continue;
      tried++;
      for (var a = leaf, depth = 0; a && a !== root && depth < 6; a = a.parentElement, depth++) {
        var p = a.parentElement;
        if (!p || p.closest(NO_REPAIR)) break;
        var ar = a.getBoundingClientRect(), beside = flowKids(p).some(function (s) { return s !== a && sideBySide(ar, s.getBoundingClientRect()); });
        if (!beside) continue;
        var d = getComputedStyle(p).display, cls = /flex/.test(d) ? STACKS.flex : /grid/.test(d) ? STACKS.grid : STACKS.other;
        if (p.classList.contains(cls)) break;
        p.classList.add(cls);
        if (!squashed(leaf)) { keep(p, cls); break; }
        p.classList.remove(cls);
      }
    }
  };
  // e. Floated cards: a dashboard that floats its cards side by side, each set
  //    to a share of the row by the App (Active Backup's overview: 167 px of a
  //    366 px row). A card holding content of a fixed width that cannot shrink
  //    (a calendar of 32 px day boxes beside a week label, a row of device
  //    icons over their counts) wraps it into a jumble, and the repairs above
  //    cut, stack and scale it. Rule, from the page alone: in a row of two or
  //    more floated boxes side by side, each at least FLOAT_CARD_H high, when a
  //    card's content needs more than its width (a row of three or more floated
  //    or inline-block boxes that wrapped, which together fit the row; or a
  //    repair made inside it) the cards of that row stack, each the row's full
  //    width, and an Ext panel that filled a card fills it again. What the
  //    other repairs did inside is decided again at the new width. Kept until
  //    the width changes, so a repair it undoes never makes it flip back.
  var FLOAT_CARD_H = 100;
  var SQUEEZED = '.spl-fit-cap, .spl-fit-rows-row, .spl-fit-stack, .spl-fit-stack-flex, .spl-fit-stack-grid, .spl-fit-scaled, .spl-fit-pan, .spl-fit-wrap';
  var floated = function (e) { var f = getComputedStyle(e).float; return !!f && f !== 'none'; };
  /** A row of three or more floated or inline-block boxes: their widths, their sum and how many lines they take; or null */
  var boxes = function (e) {
    var kids = flowKids(e);
    if (kids.length < 3) return null;
    var sum = 0, top = null, lines = 1, widths = [];
    for (var i = 0; i < kids.length; i++) {
      var c = kids[i], cs = getComputedStyle(c);
      if ((!cs.float || cs.float === 'none') && !/^inline-(block|flex)$/.test(cs.display)) return null;
      if (top === null) top = c.offsetTop; else if (Math.abs(c.offsetTop - top) > 2) { lines++; top = c.offsetTop; }
      var w = c.offsetWidth + px(cs.marginLeft) + px(cs.marginRight);
      widths.push(w); sum += w;
    }
    return { widths: widths, sum: sum, lines: lines };
  };
  /** The width of a row of fixed boxes that wrapped onto more than one line, or 0 */
  var boxRow = function (e) { var b = boxes(e); return b && b.lines > 1 ? b.sum : 0; };
  /** What a card's content needs: its widest wrapped row of boxes, or more than it has when a repair changed it */
  var cardNeed = function (card) {
    var need = 0, w = card.offsetWidth, all = card.querySelectorAll('*');
    for (var i = 0; i < all.length && i < CAP; i++) {
      var e = all[i];
      if (!e.offsetWidth || e.closest(NO_REPAIR)) continue;
      var row = boxRow(e);
      if (row) need = Math.max(need, Math.ceil(row + w - e.clientWidth));
    }
    if (card.querySelector(SQUEEZED)) need = Math.max(need, w + 1);
    return need;
  };
  var filled = [], fillWidth = 0;
  /**
   * What the App sized to the card's old width (an Ext panel's body, the panel inside it) fills the
   * card again. A class, not an Ext size: the App sets its cards' widths again on each layout.
   */
  var refill = function (rec) {
    var changed = false, all = rec.el.querySelectorAll('[style*="width"]');
    for (var i = 0; i < all.length && i < CAP; i++) {
      var e = all[i];
      // A box the App places itself (absolute) keeps its width: auto would shrink it to its content
      if (e.classList.contains('spl-fit-fill-in') || Math.abs(px(e.style.width) - rec.was) > 2 || e.closest(NO_REPAIR) || /^(absolute|fixed)$/.test(getComputedStyle(e).position)) continue;
      e.classList.add('spl-fit-fill-in'); rec.inner.push(e); changed = true;
    }
    // What the other repairs did inside at the old width is decided again
    if (changed) unsqueeze(rec.el);
    return changed;
  };
  var unsqueeze = function (c) {
    repairs = repairs.filter(function (r) { if (!c.contains(r.el) || r.cls === 'spl-fit-gutter') return true; drop(r); return false; });
    fits = fits.filter(function (rec) { if (!c.contains(rec.el)) return true; unfit(rec); return false; });
  };
  var floatCards = function (root) {
    if (window.innerWidth !== fillWidth) {
      filled.forEach(function (rec) { rec.el.classList.remove('spl-fit-fill'); rec.inner.forEach(function (e) { e.classList.remove('spl-fit-fill-in'); }); });
      filled = []; fillWidth = window.innerWidth;
    }
    filled = filled.filter(function (rec) { return rec.el.isConnected; });
    var refilled = false;
    filled.forEach(function (rec) { if (refill(rec)) refilled = true; });
    var all = root.querySelectorAll('div'), rows = [];
    for (var i = 0; i < all.length && i < CAP; i++) {
      var p = all[i];
      if (rows.indexOf(p) >= 0 || p.closest(NO_REPAIR)) continue;
      var cards = flowKids(p).filter(function (c) { return floated(c) && c.offsetHeight >= FLOAT_CARD_H && !c.classList.contains('spl-fit-fill'); });
      if (cards.length < 2 || !cards.some(function (a) { return cards.some(function (b) { return a !== b && Math.abs(a.offsetTop - b.offsetTop) <= 2; }); })) continue;
      var room = p.clientWidth - px(getComputedStyle(p).paddingLeft) - px(getComputedStyle(p).paddingRight);
      if (!cards.some(function (c) { var need = cardNeed(c); return need > c.offsetWidth && Math.min(need, room) > c.offsetWidth + 2; })) continue;
      rows.push(p);
    }
    rows.forEach(function (p) {
      flowKids(p).filter(floated).forEach(function (c) {
        var rec = { el: c, was: c.offsetWidth, inner: [] };
        c.classList.add('spl-fit-fill');
        // What the other repairs and the graphic fit did in the narrow card is decided again
        unsqueeze(c);
        filled.push(rec); refill(rec);
      });
    });
    return rows.length > 0 || refilled;
  };
  // f. Fixed rows: a table drawn as rows of fixed boxes (a calendar: a week
  //    label and seven 32 px day boxes per row, the row before it the day
  //    names). Too narrow, each row wraps on its own and the columns no longer
  //    line up. Rule, from the page alone: two or more sibling rows of three
  //    or more floated or inline-block boxes whose widths match box by box
  //    (within 2 px), at least one of them wrapped. Each such row keeps the
  //    width its boxes need, so it stays on one line, and is scaled down to
  //    the room it has when that loses no more than ROWS_ZOOM_MIN; otherwise
  //    the box they sit in scrolls them sideways. A lone wrapped row
  //    (a list of icons that wraps on purpose) is left alone. Kept until the
  //    width changes.
  var ROWS_ZOOM_MIN = 0.8;
  var sameBoxes = function (a, b) {
    if (a.widths.length !== b.widths.length) return false;
    for (var i = 0; i < a.widths.length; i++) if (Math.abs(a.widths[i] - b.widths[i]) > 2) return false;
    return true;
  };
  var fixedRows = function (root) {
    var all = root.querySelectorAll('div');
    for (var i = 0; i < all.length && i < CAP; i++) {
      var p = all[i];
      if (p.closest('.spl-fit-rows-row, .spl-fit-rows-scroll') || Array.prototype.some.call(p.children, function (c) { return c.classList.contains('spl-fit-rows-row'); }) || p.closest(NO_REPAIR)) continue;
      var kids = flowKids(p), rows = [];
      for (var k = 0; k < kids.length; k++) { var b = kids[k].offsetWidth && boxes(kids[k]); if (b) rows.push({ el: kids[k], b: b }); }
      if (rows.length < 2) continue;
      var group = null;
      for (var a = 0; a < rows.length && !group; a++) {
        var same = rows.filter(function (r) { return sameBoxes(r.b, rows[a].b); });
        if (same.length >= 2 && same.some(function (r) { return r.b.lines > 1; })) group = same;
      }
      if (!group) continue;
      var pcs = getComputedStyle(p), room = p.clientWidth - px(pcs.paddingLeft) - px(pcs.paddingRight);
      var need = Math.ceil(Math.max.apply(null, group.map(function (r) { var cs = getComputedStyle(r.el); return r.b.sum + px(cs.paddingLeft) + px(cs.paddingRight) + px(cs.borderLeftWidth) + px(cs.borderRightWidth); })));
      if (room < 60 || need <= room) continue;
      // zoom scales the row's own width too: the row is need px wide, drawn room px wide
      var zoom = Math.floor(room / need * 1000) / 1000;
      group.forEach(function (r) {
        r.el.style.setProperty('--spl-fit-row', need + 'px');
        if (zoom >= ROWS_ZOOM_MIN) r.el.style.setProperty('--spl-fit-zoom', String(zoom));
        r.el.classList.add('spl-fit-rows-row'); keep(r.el, 'spl-fit-rows-row');
      });
      if (zoom < ROWS_ZOOM_MIN) { p.classList.add('spl-fit-rows-scroll'); keep(p, 'spl-fit-rows-scroll'); }
    }
  };
  // g. A number and its unit ("1.2 TB", "505.0 GB", "35 %") in a box of their own never break
  //    apart: squeezed, a value wrapped into "1.2" over "TB" under its label
  var NUM_UNIT = /^[-+]?\d[\d.,]*\s*(%|[KMGTPE]i?B|B|bytes?|[KMGT]?bps|[KMG]?Hz|°[CF]|ms|s|min)(\/s)?$/i;
  var numUnit = function (e) {
    if (e.children.length > 2) return false;
    var t = String(e.textContent || '').replace(/\s+/g, ' ').trim();
    // In one text it breaks only at a space; in boxes of their own, between the boxes
    return t.length <= 24 && (e.children.length > 0 || /\s/.test(t)) && NUM_UNIT.test(t);
  };
  var units = function (root) {
    var all = root.querySelectorAll('*');
    for (var i = 0; i < all.length && i < CAP; i++) {
      var e = all[i];
      if (e.classList.contains('spl-fit-unit') || !numUnit(e)) continue;
      e.classList.add('spl-fit-unit'); keep(e, 'spl-fit-unit');
    }
  };
  // g. A page that cuts off its own content: a desktop dashboard sized to its window
  //    (Container Manager's overview: a column of cards in a box that hides what
  //    overflows) fits a desktop, but its cards, stacked on a phone, run past the
  //    bottom with nothing to scroll. Rule: a box about the size of the page (at least
  //    CLIP_PAGE_W of the screen wide and CLIP_PAGE_H high) that hides what overflows,
  //    when its content in the flow runs more than CLIP_OVER px past its bottom and no
  //    box around it scrolls, scrolls itself, and the page inside grows to its content
  var CLIP_PAGE_W = 0.85, CLIP_PAGE_H = 0.5, CLIP_OVER = 24;
  var clippedPages = function (root) {
    var vw = window.innerWidth, vh = window.innerHeight, all = [root].concat(Array.prototype.slice.call(root.querySelectorAll('div, section, main'), 0, CAP));
    for (var i = 0; i < all.length; i++) {
      var e = all[i];
      if (e.offsetWidth < vw * CLIP_PAGE_W || e.offsetHeight < vh * CLIP_PAGE_H || e.scrollHeight <= e.clientHeight + CLIP_OVER || e.classList.contains('spl-fit-page-scroll')) continue;
      var cs = getComputedStyle(e);
      if (!/hidden|clip/.test(cs.overflowY) || e.matches(SCROLLER_PART) || e.closest(NO_REPAIR)) continue;
      var r = e.getBoundingClientRect(), bottom = -Infinity;
      flowKids(e).forEach(function (c) {
        var cr = c.getBoundingClientRect(), tall = getComputedStyle(c).overflowY === 'visible' ? Math.max(c.scrollHeight, c.offsetHeight) : c.offsetHeight;
        bottom = Math.max(bottom, cr.top + tall + px(getComputedStyle(c).marginBottom));
      });
      if (bottom <= r.bottom + CLIP_OVER) continue;
      var scrolls = false;
      for (var a = e.parentElement; a && !scrolls; a = a.parentElement) scrolls = /auto|scroll/.test(getComputedStyle(a).overflowY) && a.scrollHeight > a.clientHeight + 2;
      if (scrolls) continue;
      e.classList.add('spl-fit-page-scroll'); keep(e, 'spl-fit-page-scroll');
      // The page inside, set to the box's height, grows to its content: its background goes down with it
      flowKids(e).forEach(function (c) {
        if (getComputedStyle(c).overflowY !== 'visible' || c.scrollHeight <= c.offsetHeight + 2 || c.classList.contains('spl-fit-grow')) return;
        c.style.setProperty('--spl-fit-min', c.offsetHeight + 'px');
        c.classList.add('spl-fit-grow'); keep(c, 'spl-fit-grow');
      });
    }
  };
  // h. Label/value cards (DSM Vue's table on a phone) label each value with its column's title;
  //    a column with no title (a column of rich items, like a registry's search results) is
  //    labelled "undefined:". Such a label goes, and its value takes the card's width
  var BLANK_LABEL = /^\s*(undefined|null)?\s*[:\uff1a]?\s*$/;
  var blankLabels = function (root) {
    Array.prototype.forEach.call(root.querySelectorAll('.mobile-row-card-wrapper .mobile-label'), function (e) {
      if (e.classList.contains('spl-fit-nolabel') || e.children.length || !BLANK_LABEL.test(e.textContent || '')) return;
      e.classList.add('spl-fit-nolabel'); keep(e, 'spl-fit-nolabel');
    });
  };
  // i. Meter rows: a row of a name, a meter (a thin bar and its fill) and its value, with
  //    the meter and value placed at a fixed spot beside the name, in a box that scrolls
  //    sideways (a volume's usage: a 434 px row in a 325 px card, its "1.5 TB" cut off).
  //    Rule: a box that scrolls a row wider than itself sideways, when the row holds a
  //    meter inside a block placed absolutely beside text in the flow, and that block
  //    alone fits the box. The block joins the flow under the name, keeping its own size,
  //    the row and the name take the box's width, and the box, and the boxes around it
  //    set to its old height, grow to the row's height instead of scrolling. Kept until the width changes.
  var METER_H = 16, METER_W = 48;
  var meterBar = function (e) {
    if (e.matches('progress, [role=progressbar]')) return true;
    var h = e.offsetHeight, w = e.offsetWidth;
    if (h < 2 || h > METER_H || w < METER_W || e.children.length !== 1 || String(e.textContent || '').trim()) return false;
    var f = e.children[0];
    return !f.children.length && Math.abs(f.offsetHeight - h) <= 2 && f.offsetWidth <= w;
  };
  var meterRows = function (root) {
    var all = root.querySelectorAll('div');
    for (var i = 0; i < all.length && i < CAP; i++) {
      var box = all[i];
      if (box.classList.contains('spl-fit-meter-box') || !box.offsetWidth || box.scrollWidth <= box.clientWidth + 2 || getComputedStyle(box).overflowX === 'visible' || box.closest('svg, .spl-fit-scaled, .spl-fit-wide')) continue;
      flowKids(box).forEach(function (row) {
        if (row.offsetWidth <= box.clientWidth + 2) return;
        var bar = Array.prototype.filter.call(row.querySelectorAll('*'), meterBar)[0];
        if (!bar) return;
        var block = null;
        for (var a = bar; a && a !== row; a = a.parentElement) if (/absolute/.test(getComputedStyle(a).position)) block = a;
        if (!block || block.offsetWidth > box.clientWidth || !/\d/.test(block.textContent || '')) return;
        var name = String(row.textContent || '').replace(block.textContent || '', '');
        if (!name.trim()) return;
        // The boxes around it, and the name beside it (sized to what the block left), take the row's width
        var wide = flowKids(block.parentElement);
        block.style.setProperty('--spl-fit-h', block.offsetHeight + 'px');
        block.classList.add('spl-fit-meter'); keep(block, 'spl-fit-meter');
        for (var b = block.parentElement; b && b !== row; b = b.parentElement) wide.push(b);
        wide.forEach(function (w) { w.classList.add('spl-fit-meter-in'); keep(w, 'spl-fit-meter-in'); });
        row.classList.add('spl-fit-meter-row'); keep(row, 'spl-fit-meter-row');
        box.classList.add('spl-fit-meter-box'); keep(box, 'spl-fit-meter-box');
        box.scrollLeft = 0;
        // Boxes around it set to the old height grow with it, up to one that holds it or scrolls
        for (var up = box.parentElement; up && up !== document.body && getComputedStyle(up).overflowY === 'visible' && up.scrollHeight > up.clientHeight + 1; up = up.parentElement) {
          up.classList.add('spl-fit-meter-up'); keep(up, 'spl-fit-meter-up');
        }
      });
    }
  };
  var step = function (f) { try { f(); } catch (e) { /* presentation only */ } };
  var repairWidth = 0;
  var repair = function (root) {
    if (window.innerWidth !== repairWidth) { undoRepairs(); repairWidth = window.innerWidth; }
    var before = repairs.length;
    // Each repair on its own: one that fails in a browser leaves the others
    step(function () { sideNav(root); });
    step(function () { foldPanes(root); });
    step(function () { units(root); });
    step(function () { blankLabels(root); });
    step(function () { wrapRows(root); });
    step(function () { gutters(root); });
    step(function () { capWide(root); });
    step(function () { stackRows(root); });
    var stacked = false;
    step(function () { stacked = floatCards(root); });
    // Rows are measured in the cards' final width: after they stacked
    if (!stacked) step(function () { fixedRows(root); });
    step(function () { meterRows(root); });
    // Cards that stacked: their content is measured again at the new width
    if (stacked) contentSoon(false);
    // DSM's own scrollbars (fleXcroll) measured the content before: measure again
    // A content box it measured at zero height stays at zero: give it the height back
    Array.prototype.forEach.call(root.querySelectorAll('.flexcrollactive'), function (el) {
      if (repairs.length === before) return unstickScroller(el);
      try { if (el.fleXcroll && el.fleXcroll.updateScrollBars) el.fleXcroll.updateScrollBars(); } catch (e) { /* its own bars stay */ }
      unstickScroller(el);
    });
  };

  var contentRoot = null, contentTimer = null, contentObserver = null, budget = { start: 0, count: 0 }, paused = false, quietTimer = null, quietWait = 1500;
  var contentPass = function () {
    contentTimer = null;
    var root = contentRoot;
    if (!singleOn || !root || !fitState || !root.isConnected || !root.querySelectorAll) return;
    try {
      // 2. Reflow first: it changes heights the graphics sit in. A decision
      // stays until the width changes, so DSM rewriting a style never makes
      // it flip; an element DSM keeps taking the class from is let go.
      var width = window.innerWidth;
      if (width !== reflowWidth) {
        // A new width (the phone turned): decide again from DSM's own layout
        reflowed.forEach(unflow); reflowed = [];
        fits.forEach(unfit); fits = [];
        grown.forEach(ungrow); grown = [];
        reflowWidth = width;
      }
      // Side menus, rows and widths first: what spills or is cut off is measured after
      step(sheets);
      step(function () { repair(root); });
      step(regrowRegions);
      step(function () { chartRows(root); });
      step(function () { staleGrids(root); });
      step(function () { chartMasks(root); });
      // Boxes that spill over what follows grow first: the rest is measured after
      grown = grown.filter(function (e) { return e.isConnected && e.classList.contains('spl-fit-grow'); });
      findSpills(root).forEach(function (e) { e.classList.add('spl-fit-grow'); grown.push(e); });
      // A page that cuts off what now runs past its bottom scrolls: measured once the boxes grew
      step(function () { clippedPages(root); });
      reflowed = reflowed.filter(function (rec) {
        if (!rec.group[0].isConnected) { unflow(rec); return false; }
        if (rec.group.every(function (g) { return g.classList.contains('spl-fit-reflow'); }) && rec.cb.classList.contains('spl-fit-reflow-grow')) return true;
        if (++rec.n > 5) { unflow(rec); rec.group.forEach(function (g) { reflowState.set(g, rec); }); return false; }
        flow(rec); return true;
      });
      findOverlaps(root).forEach(function (rec) { flow(rec); reflowed.push(rec); });
      // Content that data filled in may now be cut off: keep a readable width
      windows().forEach(function (w) { if (isVue(w)) keepWideVue(w); else keepWide(w); });
      // 1. Fit or expand
      // (graphics in an App underneath keep their state until it is on top again)
      fits = fits.filter(function (rec) { if (rec.root !== root) return true; var keep = fitOne(rec, root); if (!keep) unfit(rec); return keep; });
      findOversized(root).forEach(function (e) {
        var rec = { el: e, root: root };
        fitState.set(e, rec);
        if (fitOne(rec, root)) fits.push(rec); else fitState.delete(e);
      });
      if (fits.length && !layer) {
        layer = document.createElement('div'); layer.className = 'spl-fit-layer';
        document.body.appendChild(layer);
      }
      fits.forEach(function (rec) {
        if (rec.button) return;
        rec.button = button('Expand', EXPAND, 'spl-fit-expand');
        rec.button.addEventListener('click', function (ev) { ev.stopPropagation(); openViewer(rec); });
        rec.button.hidden = true;
        layer.appendChild(rec.button);
      });
      place();
      if (viewer) viewer.fit();
    } catch (e) { /* presentation only */ }
    // The pass's own changes are not DSM re-rendering
    if (contentObserver) contentObserver.takeRecords();
  };
  var contentSoon = function (fromPage) {
    if (!singleOn) return;
    if (fromPage) {
      // A page that keeps rewriting itself in answer to the fit: stop after a
      // few passes, until the next tap or turn of the screen
      var now = Date.now();
      if (now - budget.start > 10000) budget = { start: now, count: 0 };
      if (paused || ++budget.count > 40) {
        // Content a slow NAS fills in after the burst still gets its pass once
        // the page is quiet, waiting longer each time it rewrites itself again
        paused = true;
        clearTimeout(quietTimer);
        quietTimer = setTimeout(function () { quietWait = Math.min(quietWait * 2, 60000); paused = false; budget = { start: Date.now(), count: 0 }; contentSoon(false); }, quietWait);
        return;
      }
    }
    clearTimeout(contentTimer);
    contentTimer = setTimeout(contentPass, 200);
  };
  var contentResized = function () { paused = false; quietWait = 1500; clearTimeout(quietTimer); budget = { start: 0, count: 0 }; contentSoon(false); };
  var watchContent = function (root) {
    if (!root || root === contentRoot || !window.MutationObserver) return;
    contentRoot = root;
    if (!contentObserver) contentObserver = new MutationObserver(function (records) {
      // (The classes it adds are not the page changing)
      if (wrapAdded(records) && contentObserver.takeRecords) contentObserver.takeRecords();
      contentSoon(true);
    });
    else contentObserver.disconnect();
    contentObserver.observe(root, { subtree: true, childList: true, attributes: true, attributeFilter: ['style', 'class'] });
    contentSoon(false);
  };
  var contentHooked = false;
  var hookContent = function () {
    if (contentHooked) return;
    contentHooked = true;
    // The buttons follow their graphic when a page scrolls; a tap may open a page with new content
    document.addEventListener('scroll', placeSoon, { capture: true, passive: true });
    document.addEventListener('click', function () { if (paused) { paused = false; quietWait = 1500; clearTimeout(quietTimer); budget = { start: 0, count: 0 }; } contentSoon(false); }, true);
  };

  // Ext arrives late on a slow NAS (a minute or more), so wait for it with
  // no time limit and no polling. Try again whenever something may have
  // defined it: a script finishing loading (load events reach document in the
  // capture phase), the DOM and page becoming ready, and the first assignment
  // of window.Ext and of Ext.Window. Those two are one-shot setter traps that
  // turn back into plain data properties at the first assignment. A trap
  // retries on the next task, after the defining script has run to its end.
  // Once hooked, every listener and remaining trap is removed.
  var traps = [];
  var untrap = function (obj, name) {
    try {
      var d = Object.getOwnPropertyDescriptor(obj, name);
      if (d && d.set && d.set.splTrap) Object.defineProperty(obj, name, { value: undefined, writable: true, configurable: true, enumerable: true });
    } catch (e) { /* ignore */ }
  };
  var trap = function (obj, name, then) {
    try {
      var d = Object.getOwnPropertyDescriptor(obj, name);
      if (d && (!d.configurable || d.get || d.set || d.value !== undefined)) return;
      var set = function (value) {
        Object.defineProperty(obj, name, { value: value, writable: true, configurable: true, enumerable: true });
        then(value);
      };
      set.splTrap = true;
      Object.defineProperty(obj, name, { get: function () { return undefined; }, set: set, configurable: true, enumerable: true });
      traps.push([obj, name]);
    } catch (e) { /* a page we cannot trap still gets the event retries */ }
  };
  var done = false;
  var retry = function () {
    if (done) return;
    if (hook()) { done = true; stop(); return; }
    if (window.Ext && !Ext.Window && typeof Ext === 'object') trap(Ext, 'Window', soon);
  };
  var soon = function () { setTimeout(retry, 0); };
  var stop = function () {
    document.removeEventListener('load', retry, true);
    document.removeEventListener('DOMContentLoaded', retry);
    window.removeEventListener('load', retry);
    traps.forEach(function (t) { untrap(t[0], t[1]); });
    traps = [];
  };
  retry();
  if (!done) {
    document.addEventListener('load', retry, true);
    document.addEventListener('DOMContentLoaded', retry);
    window.addEventListener('load', retry);
    if (!window.Ext) trap(window, 'Ext', function () { retry(); soon(); });
  }
  // The launched App's single-App page, or a package page that may run DSM's
  // desktop (embeddedDesk): watch for DSM's init on the same events
  if (launchApp || deskPage) {
    var stopInit = function () {
      document.removeEventListener('load', watchInit, true);
      document.removeEventListener('DOMContentLoaded', watchInit);
    };
    watchInit();
    document.addEventListener('load', watchInit, true);
    document.addEventListener('DOMContentLoaded', watchInit);
    window.addEventListener('load', stopInit);
    // (A desktop DSM builds after its init is there once the page has loaded)
    if (deskPage) window.addEventListener('load', function () { setTimeout(startSingle, 0); });
  }
})();
