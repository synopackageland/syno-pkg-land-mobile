import test from 'node:test';
import assert from 'node:assert/strict';
import { attentionOf } from '../src/core/status/attention.ts';
import type { StatusSnapshot } from '../src/core/status/model.ts';

const snapshot = (extra: Partial<StatusSnapshot>) => ({ scope: 's', times: { health: 1 }, denied: [], ...extra }) as StatusSnapshot;
const health = (security?: string) => ({ disks: [], links: [], security });

test('attention: a normal user sees the Security Advisor verdict from system health', () => {
  const risky = attentionOf(snapshot({ health: health('risk') }));
  assert.deepEqual(risky.items, [{ kind: 'security', level: 'warning', issues: 0, severity: 'risk', summary: true }]);
  assert.deepEqual(attentionOf(snapshot({ health: health('safe') })).items, []);
  assert.deepEqual(attentionOf(snapshot({ health: health() })).items, []);
});
test('attention: Security Advisor details win over the health verdict', () => {
  const security = { level: 'safe' as const, running: false, categories: [], issues: 0 };
  assert.deepEqual(attentionOf(snapshot({ health: health('danger'), security })).items, []);
});
test('attention: a known pool state is worded by the App; only an unknown word shows DSM\'s own', () => {
  const pool = (level: string, raw?: string) => ({ id: 'p1', order: 1, level, raw, disks: [], volumes: [] });
  const items = (p: unknown) => attentionOf(snapshot({ pools: [p] } as never)).items;
  assert.deepEqual(items(pool('warning', 'attention')), [{ kind: 'pool', level: 'warning', id: 'p1', order: 1 }]);
  assert.deepEqual(items(pool('unknown', 'mystery')), [{ kind: 'pool', level: 'warning', id: 'p1', order: 1, raw: 'mystery' }]);
});
