import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

// iOS Safari zooms the whole page into a focused field under 16px, and the zoomed sheet runs off
// the right edge. Every shell text field takes the shared 16px input style (or a larger title).
test('every text field is at least 16px', () => {
  const dir = new URL('../variants/land/', import.meta.url);
  let fields = 0;
  for (const file of readdirSync(dir).filter(name => name.endsWith('.tsx'))) {
    const source = readFileSync(new URL(file, dir), 'utf8');
    for (const part of source.split('<TextInput').slice(1)) {
      const element = part.slice(0, part.indexOf('/>'));
      fields++;
      assert.ok(/style=\{\[type\.(input|hero|title)\b|fontSize: type\.input\.fontSize/.test(element), `${file}: a TextInput without type.input`);
    }
  }
  assert.ok(fields >= 7);
});
