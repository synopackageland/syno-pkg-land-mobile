import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { backArrowPath, backArrowStrokes, type BackArrow } from '../src/core/icons/back-arrow.ts';

// The UI kit pins the same hash for its copy (src/components/app/app-layout/back-arrow.json):
// change the drawing in both repositories together.
const backArrow: BackArrow = JSON.parse(readFileSync('src/core/icons/back-arrow.json', 'utf8'));
const SHARED_SHA256 = '9d04578e202495113dd97533489de394dba4a57b1d18c8cc5fc0b7b2840823bc';
test('the back arrow is a byte copy of the UI kit drawing', () => {
  assert.equal(createHash('sha256').update(readFileSync('src/core/icons/back-arrow.json')).digest('hex'), SHARED_SHA256);
  assert.equal(backArrowPath(backArrow), 'M5 12L19 12M5 12L11 6M5 12L11 18');
});
test('each stroke is a round-capped bar centred on its segment', () => {
  const boxes = backArrowStrokes(24, backArrow);
  assert.equal(boxes.length, backArrow.lines.length);
  for (const [index, [x1, y1, x2, y2]] of backArrow.lines.entries()) {
    const box = boxes[index];
    assert.ok(Math.abs(box.left + box.width / 2 - (x1 + x2) / 2) < 1e-9);
    assert.ok(Math.abs(box.top + box.height / 2 - (y1 + y2) / 2) < 1e-9);
    assert.ok(Math.abs(box.width - Math.hypot(x2 - x1, y2 - y1) - backArrow.stroke) < 1e-9);
    assert.equal(box.radius, backArrow.stroke / 2);
  }
  assert.deepEqual(boxes.map(box => Math.round(box.rotate)), [0, -45, 45]);
  // Scaling keeps the drawing's proportions
  assert.equal(backArrowStrokes(48, backArrow)[0].height, backArrow.stroke * 2);
});
