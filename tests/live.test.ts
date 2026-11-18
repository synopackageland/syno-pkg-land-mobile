import test from 'node:test';
import assert from 'node:assert/strict';
import { chartPoints, continuous, ease, easeIn, LIVE, liveWindow, pathOf, pushSample, scaleOf, tween, valueAt, type LiveSample } from '../src/core/status/live.ts';
import { periods } from '../src/core/status/model.ts';

test('live: utilization is polled every 5 seconds on both status surfaces, and the chart trails by one period', () => {
  assert.equal(LIVE.period, 5_000);
  assert.equal(periods.home.util, LIVE.period);
  assert.equal(periods.status.util, LIVE.period);
  assert.equal(LIVE.delay, LIVE.period);
});

test('ring buffer: keeps the newest samples in time order, replaces a repeated time and drops an older one', () => {
  let buffer: { t: number; v: number }[] | undefined;
  for (let i = 0; i < 15; i++) buffer = pushSample(buffer, { t: i * 5000, v: i }, 12);
  assert.equal(buffer!.length, 12);
  assert.deepEqual(buffer!.map(s => s.v), [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14]);
  const before = buffer!;
  const same = pushSample(before, { t: 14 * 5000, v: 99 }, 12);
  assert.equal(same.length, 12);
  assert.equal(same[11].v, 99);
  assert.deepEqual(pushSample(before, { t: 0, v: -1 }, 12), before, 'a late older sample is dropped');
  assert.notEqual(pushSample(before, { t: 0, v: -1 }, 12), before, 'a new array, never the stored one');
  assert.deepEqual(pushSample(undefined, { t: 1, v: 1 }, 0), [{ t: 1, v: 1 }], 'capacity is at least one');
});

test('gap filling: missing values are interpolated by time, leading gaps dropped, trailing gaps carry the last value', () => {
  const samples: LiveSample[] = [{ t: 0 }, { t: 5000, cpu: 10 }, { t: 10000 }, { t: 20000, cpu: 40 }, { t: 25000 }, { t: 30000 }];
  assert.deepEqual(continuous(samples, 'cpu'), [
    { t: 5000, v: 10 }, { t: 10000, v: 20 }, { t: 20000, v: 40 }, { t: 25000, v: 40 }, { t: 30000, v: 40 },
  ]);
  // A long time gap (the App was closed, a poll was missed) is bridged, never left open
  const gap = continuous([{ t: 0, cpu: 10 }, { t: 60_000, cpu: 70 }], 'cpu');
  assert.equal(gap.length, 2);
  assert.equal(valueAt(gap, 30_000), 40);
  assert.deepEqual(continuous([{ t: 0 }, { t: 1 }], 'cpu'), []);
  assert.deepEqual(continuous(undefined, 'cpu'), []);
  // Before the first sample the first value, after the last one the last value
  assert.equal(valueAt(gap, -5), 10);
  assert.equal(valueAt(gap, 90_000), 70);
  assert.equal(valueAt([], 0), undefined);
});

test('chart: one path across the window; a late poll keeps the line to the right edge at the last value', () => {
  const box = { width: 120, height: 28, max: 100, thickness: 1 };
  const points = [{ t: 0, v: 0 }, { t: 5000, v: 100 }, { t: 10000, v: 50 }];
  // Window 0..10 s: start, every sample, end
  const full = chartPoints(points, 0, 10_000, box);
  assert.deepEqual(full.map(c => c.x), [0, 60, 120]);
  assert.deepEqual(full.map(c => c.y), [27, 1, 14]);
  // Window starting mid-segment: the start value is interpolated, not a gap
  const mid = chartPoints(points, 2500, 12_500, box);
  assert.equal(mid[0].x, 0);
  assert.equal(mid[0].y, 14);
  // No sample for 20 s: the line still reaches the right edge at the last value
  const late = chartPoints(points, 20_000, 30_000, box);
  assert.deepEqual(late, [{ x: 0, y: 14 }, { x: 120, y: 14 }]);
  // The first sample inside the window starts the line there
  const fresh = chartPoints([{ t: 9000, v: 50 }], 0, 10_000, box);
  assert.deepEqual(fresh.map(c => c.x), [108, 120]);
  assert.deepEqual(chartPoints([{ t: 11_000, v: 50 }], 0, 10_000, box), [], 'nothing before the first sample');
  assert.deepEqual(chartPoints([], 0, 10_000, box), []);
  assert.deepEqual(chartPoints(points, 0, 10_000, { ...box, width: 0 }), []);
  // One path: a single move, then lines
  const d = pathOf(full);
  assert.equal(d, 'M0 27 L60 1 L120 14');
  assert.equal(d.split('M').length - 1, 1);
});

test('chart: the window trails now by one period while moving, and ends at the newest sample with reduced motion', () => {
  assert.deepEqual(liveWindow(100_000, 98_000, false), { from: 100_000 - LIVE.delay - LIVE.span, to: 95_000 });
  assert.deepEqual(liveWindow(100_000, 98_000, true), { from: 98_000 - LIVE.span, to: 98_000 });
  assert.deepEqual(liveWindow(100_000, undefined, true, 10_000, 1_000), { from: 89_000, to: 99_000 });
  // Moving one frame later moves the whole window by the same time: a steady scroll
  const a = liveWindow(100_000, 98_000, false), b = liveWindow(100_016, 98_000, false);
  assert.equal(b.from - a.from, 16);
  assert.equal(b.to - a.to, 16);
});

test('tween: numbers ease from the old value to the new one and land exactly', () => {
  assert.equal(ease(0), 0);
  assert.equal(ease(1), 1);
  assert.equal(ease(2), 1);
  assert.ok(ease(0.5) > 0.5, 'ease-out: fast start, gentle landing');
  assert.equal(tween(10, 20, 0, 800), 10);
  assert.equal(tween(10, 20, 400, 800), 10 + 10 * ease(0.5));
  assert.equal(tween(10, 20, 800, 800), 20);
  assert.equal(tween(10, 20, 5000, 800), 20);
  assert.equal(tween(undefined, 20, 0, 800), 20, 'the first value shows at once');
  assert.equal(tween(10, 20, 100, 800, true), 20, 'reduced motion: plain update');
  const values = [0, 100, 200, 400, 600, 800].map(e => tween(0, 100, e, 800));
  assert.ok(values.every((v, i) => i === 0 || v >= values[i - 1]), 'monotonic, no overshoot');
});

test('ease-in: the newest point bends from the carried value into place', () => {
  const points = [{ t: 0, v: 10 }, { t: 5000, v: 50 }];
  assert.deepEqual(easeIn(points, 1000, 1000, 800), [{ t: 0, v: 10 }, { t: 5000, v: 10 }]);
  assert.equal(easeIn(points, 1000, 1400, 800)[1].v, 10 + 40 * ease(0.5));
  assert.deepEqual(easeIn(points, 1000, 1800, 800), points);
  assert.deepEqual(easeIn(points, 1000, 1000, 800, true), points, 'reduced motion: no easing');
  assert.deepEqual(easeIn([{ t: 0, v: 1 }], 0, 0, 800), [{ t: 0, v: 1 }]);
});

test('scale: network lines scale to the visible peak with headroom, never to zero', () => {
  const points = [{ t: 0, v: 1000 }, { t: 5000, v: 200 }, { t: 10000, v: 100 }];
  assert.equal(scaleOf(points, 0), 1150);
  assert.equal(scaleOf(points, 6000), 200 * 1.15, 'the segment entering the window counts, older ones do not');
  assert.equal(scaleOf([{ t: 0, v: 0 }], 0), 1);
  assert.equal(scaleOf([], 0), 1);
});
