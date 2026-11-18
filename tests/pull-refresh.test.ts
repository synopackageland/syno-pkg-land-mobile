import test from 'node:test';
import assert from 'node:assert/strict';
import { component } from './component.ts';
import { PULL, PULL_START_WAIT, PullGesture, pullDistance, pullProgress } from '../variants/land/pull.ts';
const plain = (value: unknown) => JSON.parse(JSON.stringify(value));

test('pull: the indicator follows the finger, then ever more slowly, and never passes its limit', () => {
  assert.equal(pullDistance(0), 0);
  assert.equal(pullDistance(-20), 0);
  let last = 0, lastStep = Infinity;
  for (let finger = 10; finger <= 2000; finger += 10) {
    const d = pullDistance(finger), step = d - last;
    assert.ok(d > last && d < PULL.max, `${finger}px`);
    assert.ok(step <= lastStep + 1e-9, 'damping only grows');
    last = d; lastStep = step;
  }
  // A deliberate pull of a short thumb stroke (well under the height of a phone screen) refreshes
  const needed = Array.from({ length: 400 }, (_, i) => i).find(finger => pullDistance(finger) >= PULL.threshold)!;
  assert.ok(needed > 100 && needed < 200, `threshold at ${needed}px of finger`);
  assert.equal(pullProgress(0), 0); assert.equal(pullProgress(PULL.threshold), 1); assert.equal(pullProgress(PULL.max), 1);
  assert.ok(PULL.rest < PULL.threshold, 'the refreshing indicator rests above where it was released');
});

test('pull: only a downward pull from the very top starts; release past the threshold refreshes', () => {
  const g = new PullGesture();
  g.start(100, 100, true);
  assert.deepEqual(g.move(101, 104, true, true), { kind: 'wait' }, 'under the slop nothing moves yet');
  const first = g.move(101, 100 + PULL.slop, true, true);
  assert.equal(first.kind, 'pull'); assert.equal(first.kind === 'pull' && first.began, true);
  const far = g.move(101, 400, true, true);
  assert.ok(far.kind === 'pull' && !far.began && far.distance >= PULL.threshold);
  assert.equal(g.end(true, true), 'refresh');

  g.start(100, 100, true); g.move(100, 160, true, true);
  assert.equal(g.end(true, true), 'spring', 'a short pull springs back');
  g.start(100, 100, true); g.move(100, 400, true, true);
  assert.equal(g.end(false, true), 'spring', 'a cancelled touch never refreshes');
  g.start(100, 100, true); g.move(100, 400, true, true);
  assert.equal(g.end(true, false), 'spring', 'disabled mid-pull (an App drag began) never refreshes');
  g.start(100, 100, true); g.move(100, 103, true, true);
  assert.equal(g.end(true, true), 'none', 'a tap is not a pull');
});

test('pull: scrolling, sideways swipes and lists away from the top are left alone', () => {
  const g = new PullGesture();
  g.start(100, 100, false);
  assert.deepEqual(g.move(100, 300, true, true), { kind: 'scroll', drawn: false }, 'started below the top, or while refreshing');
  g.start(100, 100, true);
  assert.deepEqual(g.move(100, 90, true, true), { kind: 'scroll', drawn: false }, 'scrolling down the list');
  assert.deepEqual(g.move(100, 300, true, true), { kind: 'scroll', drawn: false }, 'stays a scroll for the rest of the touch');
  g.start(100, 100, true);
  assert.deepEqual(g.move(140, 110, true, true), { kind: 'scroll', drawn: false }, 'a sideways swipe');
  g.start(100, 100, true);
  assert.deepEqual(g.move(100, 120, true, false), { kind: 'scroll', drawn: false }, 'the list moved off its top');
  // Pulling, then back above the start: the indicator goes and the touch scrolls again
  g.start(100, 100, true); g.move(100, 200, true, true);
  assert.deepEqual(g.move(100, 95, true, true), { kind: 'scroll', drawn: true });
  assert.equal(g.end(true, true), 'none');
  // A second finger or the list being disabled ends a pull without refreshing
  g.start(100, 100, true); g.move(100, 400, true, true);
  assert.deepEqual(g.move(100, 420, false, true), { kind: 'scroll', drawn: true });
  assert.equal(g.end(true, true), 'none');
});

/** The pull control's refreshing flag, rendered through the sandboxed React */
function pulledFlag() {
  const page = component('variants/land/pull.ts', {});
  let runs = 0, busy = false;
  const render = () => page.render('usePulled', { busy, onRefresh: () => { runs++; } }) as unknown as { refreshing: boolean; start(): void };
  return { page, render, runs: () => runs, set busy(value: boolean) { busy = value; } };
}

test('pull: the spinner answers only a pull, and stays until the refresh it asked for ends', () => {
  const p = pulledFlag();
  p.busy = true;
  assert.equal(p.render().refreshing, false, 'a background refresh stays quiet');
  p.busy = false; p.render();
  p.render().start();
  assert.equal(p.runs(), 1, 'the pull runs the screen\'s own reload');
  assert.equal(p.render().refreshing, true);
  p.busy = true; assert.equal(p.render().refreshing, true, 'kept while the reload runs; the data on screen stays');
  p.busy = false; p.render();
  assert.equal(p.render().refreshing, false, 'collapses when it ends');
});

test('pull: a pull during a running refresh waits for that one; a reload that never starts does not spin forever', () => {
  const p = pulledFlag();
  p.busy = true; p.render();
  p.render().start();
  assert.equal(p.render().refreshing, true);
  p.busy = false; p.render();
  assert.equal(p.render().refreshing, false);
  // Nothing became busy: the spinner gives up after a short wait
  p.render().start(); p.render();
  assert.equal(p.render().refreshing, true);
  p.page.timers(); assert.equal(p.render().refreshing, false, `gone after ${PULL_START_WAIT} ms`);
});

test('pull: a failing reload keeps the screen\'s own error and does not throw out of the gesture', async () => {
  const page = component('variants/land/pull.ts', {});
  const hook = (onRefresh: () => unknown) => page.render('usePulled', { busy: false, onRefresh }) as unknown as { start(): void };
  assert.doesNotThrow(() => hook(() => { throw new Error('offline'); }).start());
  assert.doesNotThrow(() => hook(() => Promise.reject(new Error('offline'))).start());
  await new Promise(done => setImmediate(done));
});

test('pull: Android uses the platform indicator in the accent colour, below the top bar, keeping what the list passes in', () => {
  const flag = { refreshing: true, start() {} };
  const page = component('variants/land/PullRefresh.tsx', {
    'react-native': { RefreshControl: 'RefreshControl' }, './theme': { colors: { accent: '#1D6FE8', background: '#FFFFFF' } }, './pull': { usePulled: () => flag },
  });
  const tree = page.render('PullRefresh', { busy: true, onRefresh() {}, offset: 96, enabled: false, style: { flex: 1 }, children: 'list' }) as any;
  assert.equal(tree.type, 'RefreshControl');
  assert.equal(tree.props.refreshing, true); assert.equal(tree.props.onRefresh, flag.start);
  assert.deepEqual(plain(tree.props.colors), ['#1D6FE8']); assert.equal(tree.props.tintColor, '#1D6FE8');
  assert.equal(tree.props.progressViewOffset, 96); assert.equal(tree.props.enabled, false);
  assert.deepEqual(plain(tree.props.style), { flex: 1 }); assert.equal(tree.props.children, 'list');
});

test('pull: the browser control wraps the scroller, keeps its style and draws a trackless accent arc', () => {
  const page = component('variants/land/PullRefresh.web.tsx', {
    'react-native': { View: 'View' }, './theme': { colors: { accent: '#1D6FE8', background: '#FFFFFF' } },
    './pull': { PULL, PullGesture, pullProgress, usePulled: () => ({ refreshing: false, start() {} }) },
  });
  const tree = page.render('PullRefresh', { busy: false, onRefresh() {}, offset: 96, style: { flexGrow: 1 }, children: 'scroller' }) as any;
  assert.equal(tree.type, 'View');
  assert.equal(tree.props.children[0], 'scroller', 'the scroller comes first: the gesture reads its scrollTop');
  assert.deepEqual(plain(tree.props.style[0]), { flexGrow: 1 });
  const circles = page.elements('circle');
  assert.equal(circles.length, 1, 'one arc and no track');
  assert.equal(circles[0].props.stroke, '#1D6FE8');
  const disc = page.elements('div')[0].props;
  assert.equal(disc['aria-hidden'], 'true'); assert.equal(disc.style.pointerEvents, 'none');
  assert.equal(disc.style.top, 96 - PULL.size, 'hidden just above the content, under the top bar');
});


test('pull: every tab and the status page refresh through the shared control', async () => {
  const { readFileSync } = await import('node:fs');
  for (const file of ['Overview', 'AppsTab', 'Notifications', 'Status']) {
    const text = readFileSync(`variants/land/${file}.tsx`, 'utf8');
    assert.match(text, /refreshControl=\{[^\n]*<PullRefresh /, file);
    assert.doesNotMatch(text, /RefreshControl[ ,}]/, `${file} has no direct RefreshControl`);
  }
});
