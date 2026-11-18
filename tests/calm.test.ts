import test from 'node:test';
import assert from 'node:assert/strict';
import { CALM, calmMoves, calmText, readouts, roundStep } from '../src/core/status/calm.ts';
import { formatBytes, formatRate } from '../src/core/status/format.ts';

const KB = 1024, MB = 1024 ** 2;
/** Every distinct text a change shows, one frame each 16 ms */
function frames(from: number | undefined, to: number, readout = readouts.rate, reduced = false): string[] {
  const out: string[] = [];
  for (let at = 0; at <= CALM.duration + 16; at += 16) {
    const text = calmText(from, to, readout, at, CALM.duration, reduced);
    if (out[out.length - 1] !== text) out.push(text);
  }
  return out;
}

test('calm: a number moves only when its value really changed', () => {
  assert.equal(calmMoves(undefined, 40, readouts.percent), false, 'the first value shows at once');
  assert.equal(calmMoves(40, 40, readouts.percent), false);
  assert.equal(calmMoves(40.2, 40.4, readouts.percent), false, 'the same text');
  assert.equal(calmMoves(9, 10, readouts.percent), false, 'one step simply switches');
  assert.equal(calmMoves(9, 11, readouts.percent), false, 'two steps simply switch');
  assert.equal(calmMoves(9, 34, readouts.percent), true);
  assert.equal(calmMoves(21.3 * KB, 21.5 * KB, readouts.rate), false, 'a tenth or two of a KB/s switches');
  assert.equal(calmMoves(21.3 * KB, 80.8 * KB, readouts.rate), true);
  // A value that does not change shows one frame, the resting text
  assert.deepEqual(frames(34, 34, readouts.percent), ['34%']);
  assert.deepEqual(frames(9, 10, readouts.percent), ['10%']);
});

test('calm: a unit change switches at once, never through the values between', () => {
  assert.equal(calmMoves(2.1 * MB, 1.6 * KB, readouts.rate), false);
  assert.equal(calmMoves(900 * KB, 1.2 * MB, readouts.rate), false);
  assert.deepEqual(frames(2.1 * MB, 1.6 * KB), ['1.6 KB/s']);
  assert.deepEqual(frames(512, 3 * KB), ['3.0 KB/s']);
});

test('calm: reduced motion shows the new value at once', () => {
  assert.equal(calmMoves(9, 34, readouts.percent, true), false);
  assert.deepEqual(frames(9, 34, readouts.percent, true), ['34%']);
  assert.deepEqual(frames(21.3 * KB, 80.8 * KB, readouts.rate, true), ['80.8 KB/s']);
});

test('calm: a change counts in a few round steps in the new unit and decimals, then lands exactly', () => {
  const rate = frames(21.3 * KB, 80.8 * KB);
  assert.equal(rate[0], '21.3 KB/s', 'it starts where it was');
  assert.equal(rate[rate.length - 1], '80.8 KB/s', 'it lands on the exact text');
  assert.ok(rate.length <= CALM.steps + 3, `a few steps, not a frame each: ${rate.join(', ')}`);
  for (const text of rate) assert.match(text, /^\d+\.\d KB\/s$/, 'one decimal and the same unit throughout');
  const values = rate.map(text => parseFloat(text));
  assert.ok(values.every((v, i) => !i || v > values[i - 1]), 'it only ever moves towards the new value');
  // The steps between are round: 30.0, 40.0, never 37.4
  for (const v of values.slice(1, -1)) assert.equal(v % 10, 0, `round step: ${v}`);
  const down = frames(34, 9, readouts.percent);
  assert.equal(down[0], '34%');
  assert.equal(down[down.length - 1], '9%');
  assert.ok(down.map(text => parseInt(text)).every((v, i, all) => !i || v < all[i - 1]));
  // It starts on the text already shown, even when the new value has fewer decimals
  const up = frames(1.6 * KB, 310 * KB);
  assert.equal(up[0], '1.6 KB/s');
  assert.equal(up[up.length - 1], '310 KB/s');
  for (const text of up.slice(1)) assert.match(text, /^\d+ KB\/s$/);
  // At the end of its time it is the resting text, whatever came before
  assert.equal(calmText(9, 34, readouts.percent, CALM.duration), '34%');
});

test('calm: round steps are 1, 2 or 5 times a power of ten', () => {
  assert.equal(roundStep(7.4), 10);
  assert.equal(roundStep(4.2), 5);
  assert.equal(roundStep(1.5), 2);
  assert.equal(roundStep(0.3), 0.5);
  assert.equal(roundStep(1), 1);
  assert.equal(roundStep(0), 1);
});

test('formatting is stable: rates keep their decimal, sizes and unknown values as before', () => {
  assert.equal(formatRate(2 * KB), '2.0 KB/s', 'a rate keeps its width from poll to poll');
  assert.equal(formatRate(2.1 * KB), '2.1 KB/s');
  assert.equal(formatRate(250 * KB), '250 KB/s');
  assert.equal(formatRate(512), '512 B/s');
  assert.equal(formatRate(undefined), '-');
  assert.equal(formatBytes(8 * 1024 ** 3), '8 GB', 'a size still drops ".0"');
  assert.equal(formatBytes(7.5 * 1024 ** 3), '7.5 GB');
  assert.equal(readouts.celsius.text(42), '42 °C');
  assert.equal(readouts.celsius.text(undefined), '-');
  assert.equal(readouts.percent.text(undefined), '-');
  // The readouts' resting text is the screens' own formatting
  for (const v of [0, 1023, 4544, 99.96 * KB, 1.5 * MB]) assert.equal(readouts.rate.text(v), formatRate(v));
});
