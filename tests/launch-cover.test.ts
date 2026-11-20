import test from 'node:test';
import assert from 'node:assert/strict';
import { component } from './component.ts';
import * as coverState from '../src/core/webview/cover.ts';

function fixture(reduced = false, platform = 'android') {
  const loops: { started: boolean; stopped: boolean }[] = [], fades: { toValue: number; duration: number; done?: (r: { finished: boolean }) => void }[] = [];
  let motion: ((value: boolean) => void) | undefined;
  class Value { value: number; constructor(v: number) { this.value = v; } setValue(v: number) { this.value = v; } interpolate(config: unknown) { return { interpolated: config }; } }
  const Animated = {
    View: 'Animated.View', Value,
    timing: (_value: Value, config: { toValue: number; duration: number }) => { const entry: (typeof fades)[number] = { ...config }; fades.push(entry); return { start(done?: (r: { finished: boolean }) => void) { entry.done = done; } }; },
    loop: () => { const entry = { started: false, stopped: false }; loops.push(entry); return { start() { entry.started = true; }, stop() { entry.stopped = true; } }; },
  };
  const native = Object.fromEntries(['View', 'Text', 'Pressable'].map(name => [name, name]));
  const page = component('src/core/webview/LaunchCover.tsx', {
    'react-native': {
      ...native, Animated, Platform: { OS: platform }, Easing: { bezier: () => (t: number) => t },
      StyleSheet: { create: (value: unknown) => value, absoluteFill: { position: 'absolute' } },
      AccessibilityInfo: { isReduceMotionEnabled: () => Promise.resolve(reduced), addEventListener: (_: string, fn: (value: boolean) => void) => { motion = fn; return { remove() {} }; } },
    },
    './cover': coverState,
  });
  const labels = { loading: 'Loading', slow: 'Still opening', reopen: 'Reopen', back: 'Back' };
  let faded = 0;
  const render = (props: Record<string, unknown>) => page.render('LaunchCover', { labels, onReopen() {}, onBack() {}, onFaded: () => faded++, ...props });
  const arc = () => page.elements('Arc')[0]?.props;
  return { page, render, loops, fades, arc, setMotion: (value: boolean) => motion?.(value), faded: () => faded };
}
const flush = () => new Promise(resolve => setImmediate(resolve));

test('pending and hidden phases render nothing', () => {
  const f = fixture();
  assert.equal(f.render({ phase: 'pending', title: 'Drive' }), null);
  assert.equal(f.render({ phase: 'hidden', title: 'Drive' }), null);
});
test('shown phase orbits the App icon with an arc in the App color and no track', () => {
  const f = fixture();
  const icon = { type: 'AppIcon', props: {} };
  f.render({ phase: 'shown', title: 'Drive', icon, tint: '#C2410C' });
  assert.deepEqual([f.arc().tint, f.arc().size, f.arc().spinning], ['#C2410C', 100, true]);
  assert.equal(f.page.elements('AppIcon').length, 1, 'icon slot is used as given');
  assert.equal(f.page.elements('Pressable').length, 0, 'no actions before the slow state');
  assert.equal(f.fades.length, 0, 'the cover is on the page as it slides in, not faded in');
  assert.equal(f.page.elements('Animated.View')[0].props.style[1].opacity.value, 1);
});
test('letter tile stands in when no icon is provided', () => {
  const f = fixture();
  f.render({ phase: 'shown', title: 'drive' });
  assert.ok(f.page.elements('Text').some(text => text.props.children === 'D'));
});
test('reduced motion keeps the arc still and follows later changes', async () => {
  const f = fixture(true);
  f.render({ phase: 'shown', title: 'Drive' });
  await flush();
  f.render({ phase: 'shown', title: 'Drive' });
  assert.equal(f.arc().spinning, false);
  f.setMotion(false);
  f.render({ phase: 'shown', title: 'Drive' });
  assert.equal(f.arc().spinning, true);
});
test('slow state keeps turning and adds a hint and back, never reopen, without moving to the failure layout', () => {
  const f = fixture();
  f.render({ phase: 'slow', title: 'Drive' });
  assert.ok(f.arc(), 'arc keeps turning while slow');
  const texts = f.page.elements('Text').map(text => text.props.children);
  assert.ok(texts.includes('Still opening'));
  assert.equal(f.page.elements('Pressable').length, 1, 'back only: a slow App keeps opening and shows itself once drawn');
  assert.ok(!texts.includes('Reopen'), 'no reopen, which would only start a slow App again');
  f.render({ phase: 'slow', title: 'Drive', onBack: undefined });
  assert.equal(f.page.elements('Pressable').length, 0, 'no back without a place to go');
});
test('failure removes the arc and offers reopen and back', () => {
  const f = fixture();
  f.render({ phase: 'pending', title: 'Drive', message: 'Could not open' });
  assert.equal(f.arc(), undefined);
  assert.equal(f.page.elements('Pressable').length, 2);
  assert.equal(f.fades.length, 0, 'failure appears at once, without a fade');
  assert.equal(f.page.elements('Animated.View')[0].props.style[1].opacity.value, 1);
});
test('leaving fades out over COVER_FADE and then reports faded', () => {
  const f = fixture();
  f.render({ phase: 'shown', title: 'Drive' });
  f.render({ phase: 'leaving', title: 'Drive' });
  const fade = f.fades.at(-1)!;
  assert.deepEqual([fade.toValue, fade.duration], [0, coverState.COVER_FADE]);
  fade.done!({ finished: true });
  assert.equal(f.faded(), 1);
});
test('arc colors two edges of a transparent ring and spins only when allowed', () => {
  const f = fixture();
  const arc = f.page.render('Arc', { tint: '#C2410C', size: 100, spinning: true });
  const style = Object.assign({}, ...arc.props.style);
  assert.equal(style.borderColor, 'transparent');
  assert.deepEqual([style.borderTopColor, style.borderRightColor], ['#C2410C', '#C2410C']);
  assert.equal(style.borderBottomColor, undefined, 'no grey track');
  assert.deepEqual(f.loops.map(loop => loop.started), [true]);
  f.page.render('Arc', { tint: '#C2410C', size: 100, spinning: false });
  assert.deepEqual([f.loops[0].stopped, f.loops.length], [true, 1], 'reduced motion stops the spin and starts none');
});
test('browser build: the arc and the fade are CSS animations, which keep running while an App blocks the page', () => {
  const f = fixture(false, 'web');
  const arc = f.page.render('Arc', { tint: '#C2410C', size: 100, spinning: true });
  const style = Object.assign({}, ...[arc.props.style].flat(2).filter(Boolean));
  assert.equal(style.animationIterationCount, 'infinite');
  assert.equal(style.animationDuration.endsWith('ms'), true);
  assert.ok(style.animationKeyframes, 'a transform keyframe, not a JS-driven value');
  assert.equal(f.loops.length, 0, 'no Animated loop');
  const c = fixture(false, 'web');
  c.render({ phase: 'shown', title: 'Drive' });
  c.render({ phase: 'leaving', title: 'Drive' });
  assert.equal(c.fades.length, 0, 'no Animated fade');
  assert.equal(c.faded(), 0);
  c.page.timers();
  assert.equal(c.faded(), 1, 'faded once the CSS fade has run');
});
