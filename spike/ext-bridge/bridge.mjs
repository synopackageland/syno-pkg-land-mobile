/*
 * Spike: draw a live Ext component tree with @synopackageland/ui components.
 *
 * Ext stays the source of truth. The bridge reads the tree once, renders a
 * Vue 3 view in a shadow root over the Ext element, and then:
 *   - Ext -> view: listens to field, store and button events;
 *   - view -> Ext: calls setValue / selectRow / the button's own click.
 * It never calls a WebAPI, never submits a form and never presses Apply.
 * Unknown components are counted and listed as "kept as Ext" (the CSS
 * fallback keeps drawing them in a real build).
 */
import { createApp, h, reactive, ref } from 'vue';
import { AppRoot, Button, Checkbox, Input, ListItem, RadioGroup, Select, SettingsRow, SettingsSection, Tabs } from '@synopackageland/ui';
import themeCss from '@synopackageland/ui/theme.css?inline';

const Ext = () => window.Ext;
const isA = (c, name) => { const k = name.split('.').reduce((o, p) => o && o[p], window); return !!k && c instanceof k; };
const text = html => { const d = document.createElement('div'); d.innerHTML = html == null ? '' : String(html); return (d.textContent || '').replace(/\s+/g, ' ').trim(); };
const label = c => text(c.fieldLabel || c.boxLabel || c.title || c.text || '').replace(/:$/, '');

/* ---------- Ext -> model ---------- */
function read(c, stats) {
  if (!c || c.hidden || (c.rendered && c.el && c.el.dom && c.el.dom.offsetParent === null && !isA(c, 'Ext.Panel'))) return null;
  if (isA(c, 'SYNO.ux.TabPanel') || isA(c, 'Ext.TabPanel')) {
    stats.mapped++;
    return { kind: 'tabs', c, items: c.items.items.map(t => ({ value: t.id, label: text(t.title), node: () => read(t, stats) })) };
  }
  if (isA(c, 'Ext.grid.GridPanel')) { stats.mapped++; return { kind: 'list', c }; }
  if (isA(c, 'Ext.form.FieldSet')) {
    stats.mapped++;
    return { kind: 'section', title: text(c.title), children: kids(c, stats) };
  }
  if (isA(c, 'Ext.form.Radio')) { stats.mapped++; return { kind: 'radio', c }; }
  if (isA(c, 'Ext.form.Checkbox')) { stats.mapped++; return { kind: 'check', c }; }
  if (isA(c, 'Ext.form.ComboBox')) { stats.mapped++; return { kind: 'select', c }; }
  if (isA(c, 'Ext.form.DisplayField')) { stats.mapped++; return { kind: 'display', c }; }
  if (isA(c, 'Ext.form.TextField')) { stats.mapped++; return { kind: 'text', c }; }
  if (isA(c, 'Ext.Button')) { stats.mapped++; return { kind: 'button', c }; }
  if (isA(c, 'Ext.form.CompositeField')) { stats.mapped++; return { kind: 'group', label: label(c), children: kids(c, stats) }; }
  // Plain layout containers are flattened; their children are what we draw
  if (c.items && c.items.each && (c.constructor === Ext().Container || c.constructor === Ext().Panel || isA(c, 'Ext.form.FormPanel') || isA(c, 'Ext.Panel'))) {
    stats.layout++;
    return { kind: 'group', children: kids(c, stats) };
  }
  if (isA(c, 'Ext.Toolbar.TextItem') || isA(c, 'Ext.Toolbar.Fill') || isA(c, 'Ext.Toolbar.Spacer') || isA(c, 'Ext.Spacer')) return null;
  stats.kept.push(window.__cname ? window.__cname(c) : c.getXType());
  return { kind: 'kept', c };
}
function kids(c, stats) { return (c.items && c.items.items ? c.items.items : []).map(i => read(i, stats)).filter(Boolean); }

/* ---------- live state shared by Ext and the view ---------- */
function useField(c) {
  const s = reactive({ value: c.getValue ? c.getValue() : undefined, disabled: !!c.disabled, hidden: !!c.hidden, invalid: false });
  const sync = () => { s.value = c.getValue(); s.disabled = !!c.disabled; s.hidden = !!c.hidden; };
  ['change', 'check', 'select', 'enable', 'disable', 'show', 'hide'].forEach(e => c.on(e, sync));
  // Ext 3 setValue/reset on a text field fires no event: intercept the method
  ['setValue', 'reset', 'setRawValue'].forEach(m => {
    const original = c[m];
    if (typeof original === 'function') c[m] = function () { const r = original.apply(this, arguments); sync(); return r; };
  });
  c.on('valid', () => { s.invalid = false; }); c.on('invalid', () => { s.invalid = true; });
  return s;
}
// A view edit goes through the field's own API, so DSM's dirty tracking,
// validation and linked enable/disable rules all run as if the user typed.
function write(c, value) {
  const old = c.getValue();
  c.setValue(value);
  if (c.validate) c.validate();
  if (isA(c, 'Ext.form.Checkbox')) return; // setValue already fired "check"
  c.fireEvent('change', c, c.getValue(), old);
  c.fireEvent('keyup', c, Ext().EventObject);
}

/* ---------- model -> view ---------- */
function field(n) {
  const c = n.c, s = useField(c);
  return () => {
    if (s.hidden) return null;
    if (n.kind === 'check') return h(Checkbox, { modelValue: !!s.value, disabled: s.disabled, label: text(c.boxLabel), 'onUpdate:modelValue': v => write(c, v) });
    if (n.kind === 'radio') return h(RadioGroup, { modelValue: s.value ? 'on' : '', disabled: s.disabled, options: [{ label: text(c.boxLabel), value: 'on' }], 'onUpdate:modelValue': () => write(c, true) });
    const row = control => h(SettingsRow, { label: label(c) || ' ' }, () => control);
    if (n.kind === 'display') return row(h('span', { class: 'spl-display' }, text(s.value)));
    if (n.kind === 'select') {
      const store = c.getStore(), vf = c.valueField, df = c.displayField;
      const options = store.getRange().map(r => ({ value: String(r.get(vf)), label: text(r.get(df)) }));
      return row(h(Select, { modelValue: s.value == null ? '' : String(s.value), options, disabled: s.disabled, 'onUpdate:modelValue': v => { const r = store.getAt(store.findExact(vf, isNaN(+v) ? v : +v)) || store.getAt(store.find(vf, v)); write(c, r ? r.get(vf) : v); if (r) c.fireEvent('select', c, r, store.indexOf(r)); } }));
    }
    return row(h(Input, { modelValue: s.value == null ? '' : String(s.value), disabled: s.disabled, invalid: s.invalid, type: isA(c, 'Ext.form.NumberField') ? 'number' : (c.inputType === 'password' ? 'password' : 'text'), 'onUpdate:modelValue': v => write(c, v) }));
  };
}
function button(c) {
  const s = reactive({ disabled: !!c.disabled, hidden: !!c.hidden, text: text(c.text) });
  ['enable', 'disable', 'show', 'hide'].forEach(e => c.on(e, () => { s.disabled = !!c.disabled; s.hidden = !!c.hidden; s.text = text(c.text); }));
  // A DOM click on the Ext button runs its own path: menu, handler, events
  const press = () => { if (c.menu && c.showMenu) c.showMenu(); else if (c.btnEl) c.btnEl.dom.click(); };
  return () => s.hidden ? null : h(Button, { disabled: s.disabled, onClick: press }, () => s.text);
}
function list(grid) {
  const store = grid.getStore(), cm = grid.getColumnModel(), sm = grid.getSelectionModel();
  const tick = ref(0), bump = () => { tick.value++; };
  ['load', 'datachanged', 'update', 'add', 'remove', 'clear'].forEach(e => store.on(e, bump));
  sm.on('selectionchange', bump);
  const cols = () => cm.config.map((col, i) => ({ col, i })).filter(x => !cm.isHidden(x.i) && x.col.dataIndex);
  const cell = (r, x, row) => text(x.col.renderer ? x.col.renderer.call(x.col.scope || grid, r.get(x.col.dataIndex), {}, r, row, x.i, store) : r.get(x.col.dataIndex));
  const tb = grid.getTopToolbar && grid.getTopToolbar();
  const actions = tb ? tb.items.items.filter(i => isA(i, 'Ext.Button')).map(button) : [];
  return () => {
    void tick.value;
    const c = cols();
    return h('div', { class: 'spl-list' }, [
      actions.length ? h('div', { class: 'spl-actions' }, actions.map(a => a())) : null,
      h('div', { role: 'list' }, store.getRange().map((r, row) => h('div', {
        class: ['spl-row', sm.isSelected(row) ? 'is-selected' : ''],
        onClick: () => sm.selectRow(row),
      }, [h(ListItem, { title: cell(r, c[0], row), description: c.slice(1).map(x => cell(r, x, row)).filter(Boolean).join(' · ') })]))),
    ]);
  };
}
function node(n) {
  if (!n) return () => null;
  if (n.kind === 'button') return button(n.c);
  if (n.kind === 'list') return list(n.c);
  if (['text', 'check', 'radio', 'select', 'display'].includes(n.kind)) return field(n);
  if (n.kind === 'kept') return () => h('div', { class: 'spl-kept' }, `Kept as Ext: ${window.__cname ? window.__cname(n.c) : n.c.getXType()}`);
  if (n.kind === 'tabs') {
    const active = ref(n.c.getActiveTab() ? n.c.getActiveTab().id : n.items[0] && n.items[0].value);
    n.c.on('tabchange', (_tp, t) => { active.value = t.id; });
    const panes = {};
    return () => h(Tabs, { modelValue: active.value, items: n.items.map(i => ({ value: i.value, label: i.label })), 'onUpdate:modelValue': v => { n.c.setActiveTab(v); active.value = v; } },
      Object.fromEntries(n.items.map(i => [`panel-${i.value}`, () => { panes[i.value] = panes[i.value] || node(i.node()); return panes[i.value](); }])));
  }
  const children = (n.children || []).map(node);
  if (n.kind === 'section') return () => h(SettingsSection, { title: n.title || ' ', collapsible: false }, () => children.map(f => f()));
  return () => h('div', { class: 'spl-group' }, children.map(f => f()));
}

/* ---------- mount ---------- */
const EXTRA = `
:host { all: initial; display: block; }
.spl-scroll { height: 100%; overflow: auto; padding: 8px 16px 24px; box-sizing: border-box; -webkit-overflow-scrolling: touch; }
.spl-display { color: var(--ui-text-secondary, #555); word-break: break-word; }
.spl-actions { display: flex; gap: 8px; overflow-x: auto; padding: 8px 0; }
.spl-actions > * { flex-shrink: 0; }
.spl-row { border-bottom: 1px solid var(--ui-border, #e5e5e5); padding: 0 8px; }
.spl-row.is-selected { background: var(--ui-selected-bg, #e8f1fd); }
.spl-kept { font: 12px sans-serif; color: #a15c00; background: #fff4e5; padding: 6px 8px; margin: 4px 0; border-radius: 4px; }
.spl-badge { position: sticky; top: 0; z-index: 2; font: 11px sans-serif; background: #1d6fe8; color: #fff; padding: 2px 8px; display: inline-block; border-radius: 0 0 6px 0; }
`;
function mount(root, opts = {}) {
  if (!root || !root.el) throw new Error('No Ext root');
  const stats = { mapped: 0, layout: 0, kept: [] };
  const model = read(root, stats);
  const host = document.createElement('div');
  host.className = 'spl-bridge-host';
  const target = root.el.dom;
  const rect = target.getBoundingClientRect();
  Object.assign(host.style, { position: 'absolute', left: '0', top: '0', width: rect.width + 'px', height: rect.height + 'px', zIndex: 5, background: '#fff' });
  target.parentNode.style.position = target.parentNode.style.position || 'relative';
  host.style.left = target.offsetLeft + 'px'; host.style.top = target.offsetTop + 'px';
  target.parentNode.appendChild(host);
  const shadow = host.attachShadow({ mode: 'open' });
  const style = document.createElement('style');
  // Tokens are declared for :root; inside a shadow tree they belong on :host
  // @property is ignored inside shadow trees, so Tailwind's initial values
  // (border style, ring widths, ...) must be declared as plain properties
  const initial = [...themeCss.matchAll(/@property\s+(--[\w-]+)\s*\{[^}]*?initial-value:\s*([^;}]+)/g)].map(m => `${m[1]}:${m[2].trim()}`).join(';');
  style.textContent = themeCss.replace(/:root\b/g, ':host') + `:host,*,::before,::after,::backdrop{${initial}}` + EXTRA;
  shadow.appendChild(style);
  const mountEl = document.createElement('div');
  mountEl.style.height = '100%';
  shadow.appendChild(mountEl);
  const view = node(model);
  const app = createApp({ render: () => h(AppRoot, { fullPage: false, modalScope: 'app' }, () => h('div', { class: 'spl-scroll' }, [opts.badge === false ? null : h('span', { class: 'spl-badge' }, 'UI SDK bridge (spike)'), view()])) });
  app.config.idPrefix = 'spl-bridge';
  app.mount(mountEl);
  return { stats, unmount() { app.unmount(); host.remove(); } };
}
window.__splBridge = { mount, read: c => { const s = { mapped: 0, layout: 0, kept: [] }; read(c, s); return s; } };
