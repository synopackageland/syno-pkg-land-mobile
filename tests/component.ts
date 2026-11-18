import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

type Element = { type: string; props: Record<string, any>; key?: unknown };
/** Execute production component handlers with native surfaces replaced by inert elements. */
export function component(path: string, dependencies: Record<string, unknown>, globals: Record<string, unknown> = {}) {
  const slots: any[] = [], effects: (() => void)[] = [];
  const timers = new Map<number, () => void>();
  let cursor = 0, timer = 0;
  const equal = (left: unknown[] | undefined, right: unknown[] | undefined) => left && right && left.length === right.length && left.every((value, index) => value === right[index]);
  const memo = (factory: () => any, deps?: unknown[]) => {
    const id = cursor++;
    if (!slots[id] || !equal(slots[id].deps, deps)) slots[id] = { value: factory(), deps };
    return slots[id].value;
  };
  const react = {
    useRef(value: unknown) { const id = cursor++; return slots[id] ||= { current: value }; },
    useState(value: unknown) {
      const id = cursor++;
      if (!(id in slots)) slots[id] = typeof value === 'function' ? value() : value;
      return [slots[id], (next: unknown) => { slots[id] = typeof next === 'function' ? next(slots[id]) : next; }];
    },
    useMemo: memo,
    useCallback: (fn: () => any, deps: unknown[]) => memo(() => fn, deps),
    useEffect(fn: () => void, deps?: unknown[]) {
      const id = cursor++;
      if (!slots[id] || !equal(slots[id].deps, deps)) {
        const previous = slots[id]; slots[id] = { deps };
        effects.push(() => { previous?.cleanup?.(); slots[id].cleanup = fn(); });
      }
    },
    useLayoutEffect: (fn: () => void, deps?: unknown[]) => react.useEffect(fn, deps),
    useSyncExternalStore: (_subscribe: unknown, get: () => unknown) => get(),
  };
  const native = Object.fromEntries(['View', 'Text', 'Pressable', 'ScrollView', 'ActivityIndicator', 'Image', 'TextInput', 'Modal'].map(name => [name, name]));
  const common = {
    react,
    'react/jsx-runtime': { jsx: (type: string, props: Element['props'], key?: unknown) => ({ type, props, key }), jsxs: (type: string, props: Element['props'], key?: unknown) => ({ type, props, key }) },
    'react-native': { ...native, StyleSheet: { create: (value: unknown) => value, absoluteFill: { position: 'absolute' } }, Platform: { OS: 'android' }, Dimensions: { get: () => ({ width: 393, height: 852 }) }, BackHandler: { addEventListener: () => ({ remove() {} }) } },
    'react-native-safe-area-context': { SafeAreaView: 'SafeAreaView', SafeAreaProvider: 'SafeAreaProvider' },
    'expo-splash-screen': { hideAsync: () => Promise.resolve(), preventAutoHideAsync: () => Promise.resolve() },
    // The Android build's platform switches
    '../../src/core/platform': { singleNas: false, fixedProfile: () => undefined },
    '../../src/core/back': { BackHandler: { addEventListener: () => ({ remove() {} }) }, useBackStep() {}, useBackDepth() {}, useBackScreen() {}, restoredScreen: () => undefined },
    '../../src/core/boot': { useBooted: () => true },
    // Pull to refresh is rendered as a named element; tests/pull-refresh.test.ts drives the real control
    './PullRefresh': { PullRefresh: 'PullRefresh' },
    ...dependencies,
  };
  const module = { exports: {} as Record<string, any> };
  const output = ts.transpileModule(readFileSync(path, 'utf8'), { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(output, {
    module, exports: module.exports, URL,
    require: (id: string) => {
      if (!(id in common)) throw new Error(`Unstubbed import ${id}`);
      const value = common[id as keyof typeof common];
      return value && typeof value === 'object' && 'default' in value ? { ...value, __esModule: true } : value;
    },
    setTimeout: (fn: () => void) => { timers.set(++timer, fn); return timer; }, clearTimeout: (id: number) => timers.delete(id),
    // Intervals never fire on their own; tests drive time explicitly
    setInterval: () => ++timer, clearInterval: () => {},
    ...globals,
  }, { filename: path });
  let tree: Element;
  return {
    render(name: string, props: unknown = {}) {
      cursor = 0; tree = module.exports[name](props);
      while (effects.length) effects.shift()!();
      return tree;
    },
    elements(type: string): Element[] {
      const found: Element[] = [];
      const walk = (node: any) => {
        if (!node) return;
        if (Array.isArray(node)) { node.forEach(walk); return; }
        if (node.type === type || (typeof node.type === 'function' && node.type.name === type)) found.push(node);
        if (!node.props) return;
        walk(node.props.children);
        // A tab Stack holds its root and pushed pages outside children
        // A TextField holds its trailing buttons outside children
        if (node.type === 'TextField') walk(node.props.trailing);
        if (node.type === 'Stack') { walk(node.props.root); (node.props.pages || []).forEach((page: { node: unknown }) => walk(page.node)); }
      };
      walk(tree); return found;
    },
    timers() { const callbacks = [...timers.values()]; timers.clear(); callbacks.forEach(fn => fn()); },
  };
}
