import test from 'node:test';
import assert from 'node:assert/strict';
import { acceptsIntake, type IntakeDeclaration } from '../src/core/intake/accept.ts';
const declaration: IntakeDeclaration = { route: '/add', accept: [{ kind: 'url', schemes: ['http', 'https', 'magnet', 'ed2k'] }, { kind: 'file', types: ['application/x-bittorrent', '.torrent'], max_bytes: 524288 }] };
test('shares match declared URL schemes, MIME/extensions and file bounds', () => {
  assert.equal(acceptsIntake([{ kind: 'url', url: 'magnet:?xt=example' }], declaration), true);
  assert.equal(acceptsIntake([{ kind: 'url', url: 'javascript:alert(1)' }], declaration), false);
  assert.equal(acceptsIntake([{ kind: 'text', text: 'text' }], declaration), false);
  const file = { kind: 'file', filename: 'fixture.torrent', mime: 'application/octet-stream', base64: 'YQ==', size: 1 } as const;
  assert.equal(acceptsIntake([file], declaration), true);
  assert.equal(acceptsIntake([{ ...file, size: 524289 }], declaration), false);
  assert.equal(acceptsIntake([{ ...file, filename: 'fixture.exe' }], declaration), false);
});
