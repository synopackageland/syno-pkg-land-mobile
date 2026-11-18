import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

const dir = new URL('../variants/land/', import.meta.url);
const sources = readdirSync(dir).filter(name => name.endsWith('.tsx')).map(file => ({ file, source: readFileSync(new URL(file, dir), 'utf8') }));
const elements = (source: string, tag: string) => source.split(`<${tag}`).slice(1).map(part => part.slice(0, part.indexOf('/>')));

// iOS Safari zooms the whole page into a focused field under 16px, and the zoomed sheet runs off
// the right edge. Every shell text field takes the shared 16px input style (or a larger title);
// TextField applies it to every boxed field.
test('every text field is at least 16px', () => {
  let fields = 0;
  for (const { file, source } of sources) {
    for (const element of elements(source, 'TextInput')) {
      fields++;
      assert.ok(/style=\{\[type\.(input|hero|title)\b|fontSize: type\.input\.fontSize/.test(element), `${file}: a TextInput without type.input`);
    }
    fields += elements(source, 'TextField ').length;
  }
  assert.ok(fields >= 7);
});

// The browser draws its focus ring on the inner input only, a square inside the rounded box.
// Boxed fields go through TextField, which moves focus to the whole box; every bare input that
// remains draws its own focus state and drops the browser ring.
test('boxed fields share TextField and no input keeps the browser focus ring', () => {
  for (const { file, source } of sources) {
    for (const element of elements(source, 'TextInput')) {
      assert.match(element, /noWebOutline/, `${file}: a TextInput keeps the browser focus ring`);
      assert.doesNotMatch(element, /backgroundColor: colors\.grouped/, `${file}: a boxed TextInput outside TextField`);
    }
  }
  const ui = sources.find(s => s.file === 'ui.tsx')!.source;
  assert.match(ui, /borderColor: invalid \? colors\.danger : focused \? colors\.accent : 'transparent'/, 'TextField colours the whole box on focus');
  for (const file of ['SignIn.tsx', 'AddDevice.tsx', 'AddRemote.tsx']) {
    assert.ok(elements(sources.find(s => s.file === file)!.source, 'TextField ').length > 0, `${file} uses TextField`);
  }
});
