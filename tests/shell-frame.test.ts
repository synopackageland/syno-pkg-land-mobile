import test from 'node:test';
import assert from 'node:assert/strict';
import { SHELL_FRAME_NAME, isFrameHome } from '../src/core/webview/shell-frame.ts';

test('the browser launcher names an App frame as the UI kit reads it', () => {
  // The UI kit's SHELL_FRAME_PREFIX is 'synopkg-shell:1:' followed by comma-separated features
  assert.match(SHELL_FRAME_NAME, /^synopkg-shell:1:([a-z.]+,)*close(,[a-z.]+)*$/);
});

test('an App frame\'s Home leaves the App only for close, from that frame and origin, right after a tap', () => {
  const frame = {}, origin = 'https://nas.example.com', close = { v: 1, type: 'close' };
  const event = (extra = {}) => ({ data: close, origin, source: frame, ...extra });
  assert.equal(isFrameHome(event(), frame, origin, true), true);
  assert.equal(isFrameHome(event(), frame, origin, false), false, 'no tap');
  assert.equal(isFrameHome(event({ source: {} }), frame, origin, true), false, 'another frame');
  assert.equal(isFrameHome(event({ origin: 'https://other.example.com' }), frame, origin, true), false, 'another origin');
  assert.equal(isFrameHome(event({ data: JSON.stringify(close) }), frame, origin, true), false, 'a string');
  assert.equal(isFrameHome(event({ data: { ...close, link: '/' } }), frame, origin, true), false, 'extra fields');
  assert.equal(isFrameHome(event({ source: null }), null, origin, true), false, 'no frame yet');
});
