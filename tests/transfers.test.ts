import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareTransfer, safeName } from '../src/core/transfers/prepare.ts';
import type { NativeEvent } from '../src/core/bridge/contract.ts';
test('question marks and slashes affect only the filename, never the request URL', async () => {
  const events: Extract<NativeEvent, { type: 'transfer' }>[] = [];
  const url = 'https://nas.example.com/download?path=%2Fhome%2Fa%3F.csv';
  let release!: (uri: string) => void, presented = false;
  const pending = prepareTransfer({ v: 1, type: 'download', id: 'one', filename: 'a/測試?.csv', mime: 'text/csv', url }, 'one', e => { if (e.type === 'transfer') events.push(e); }, async (message, filename) => {
    assert.equal(filename, 'a_測試_.csv');
    assert.ok('url' in message); assert.equal(message.url, url);
    return new Promise<string>(resolve => { release = resolve; });
  }, () => { presented = true; assert.equal(events.at(-1)?.state, 'ready'); });
  assert.deepEqual(events, [{ v: 1, type: 'transfer', id: 'one', state: 'downloading', progress: 0 }]);
  assert.equal(presented, false);
  release('private-cache-uri'); await pending;
  assert.equal(events.at(-1)?.state, 'ready'); assert.equal(presented, true);
  assert.equal(JSON.stringify(events).includes('private-cache-uri'), false);
});
test('base64 and URL failures emit a terminal state without a timer or retry', async () => {
  const events: Extract<NativeEvent, { type: 'transfer' }>[] = []; let calls = 0;
  await assert.rejects(prepareTransfer({ v: 1, type: 'download', id: 'bad', filename: 'a.csv', mime: 'text/csv', base64: 'YQ==' }, 'bad', e => { if (e.type === 'transfer') events.push(e); }, async () => { calls++; throw new Error('I/O refused'); }, () => assert.fail('must not present')));
  assert.equal(calls, 1);
  assert.deepEqual(events.map(e => e.type === 'transfer' && e.state), ['downloading', 'failed']);
});
test('dot segments, empty names, native separators and controls cannot become paths', () => {
  for (const value of ['', '.', '..', '   ']) assert.equal(safeName(value), 'download');
  assert.equal(safeName('手機/驗收?.csv'), '手機_驗收_.csv');
  assert.equal(safeName('a\\b\u0000c\u007fd'), 'a_b_c_d');
});
