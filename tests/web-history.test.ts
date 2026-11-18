import test from 'node:test';
import assert from 'node:assert/strict';
import { WebHistory, type HistoryEnv } from '../src/core/web-history.ts';

/** A browser history: entries, the current one, and popstate after a walk back */
function browser(options: { state?: unknown; before?: unknown[]; saved?: string | null; reloaded?: boolean } = {}) {
  const entries: unknown[] = [...(options.before ?? []), options.state ?? null];
  let at = entries.length - 1, saved = options.saved ?? null;
  const queue: (() => void)[] = [];
  const log: string[] = [];
  let history!: WebHistory;
  const env: HistoryEnv = {
    state: () => entries[at],
    push(state) { entries.splice(at + 1); entries.push(state); at++; log.push('push'); },
    replace(state) { entries[at] = state; log.push('replace'); },
    back(steps) { log.push(`back:${steps}`); at = Math.max(0, at - steps); queue.push(() => history.moved(entries[at])); },
    load: () => saved,
    save(value) { saved = value; },
    reloaded: Boolean(options.reloaded),
    later(run) { queue.push(run); },
  };
  history = new WebHistory(env);
  const settle = () => { while (queue.length) queue.shift()!(); };
  /** The user goes back (button or swipe): popstate with the entry landed on */
  const userBack = (steps = 1) => { at = Math.max(0, at - steps); history.moved(entries[at]); settle(); };
  return { history, env, log, settle, userBack, entries, get at() { return at; }, get saved() { return saved; } };
}

test('web history: each back step is one pushed entry; the user going back runs the shell back once per entry', () => {
  const b = browser();
  const shell = {}, sheet = {};
  let depth = 0, sheetOpen = false;
  b.history.addHandler(() => { if (!depth) return false; depth--; b.history.setDepth(shell, depth); return true; });
  b.history.addHandler(() => { if (!sheetOpen) return false; sheetOpen = false; b.history.setDepth(sheet, 0); return true; });
  depth = 2; b.history.setDepth(shell, 2); b.settle();
  assert.equal(b.at, 2);
  sheetOpen = true; b.history.setDepth(sheet, 1); b.settle();
  assert.equal(b.at, 3);
  assert.equal(b.history.depth, 3);
  b.userBack();
  assert.equal(sheetOpen, false, 'the newest handler (the sheet) answers first');
  assert.equal(depth, 2);
  assert.equal(b.at, 2, 'no extra entries pushed or walked');
  // A long press on back skips two entries at once: two shell steps
  b.userBack(2);
  assert.equal(depth, 0);
  assert.equal(b.at, 0);
  assert.equal(b.history.index, 0);
});

test('web history: the shell going back itself (Home) walks the entries back to the new depth', () => {
  const b = browser();
  const shell = {};
  let ran = 0;
  b.history.addHandler(() => { ran++; return true; });
  b.history.setDepth(shell, 3); b.settle();
  assert.equal(b.at, 3);
  b.history.setDepth(shell, 0); b.settle();
  assert.ok(b.log.includes('back:3'));
  assert.equal(b.at, 0);
  assert.equal(ran, 0, 'its own walk back runs no back handlers');
  // Open again: the forward entries are replaced
  b.history.setDepth(shell, 1); b.settle();
  assert.equal(b.at, 1);
  assert.equal(b.entries.length, 2);
});

test('web history: a walk back the browser never finishes settles on the entry it stopped at', () => {
  const b = browser();
  const shell = {};
  b.history.setDepth(shell, 2); b.settle();
  const back = b.env.back;
  b.env.back = steps => { b.log.push(`blocked:${steps}`); };
  b.history.setDepth(shell, 0); b.settle();
  assert.ok(b.log.includes('blocked:2'));
  b.history.setDepth(shell, 1); b.settle();
  assert.equal(b.history.index, 2, 'waits for the walk back');
  b.env.back = back;
  b.history.settle(b.entries[b.at]);
  b.settle();
  assert.equal(b.history.index, 1, 'one entry is above the depth: back to it');
});

test('web history: forward moves the shell back to its own depth', () => {
  const b = browser();
  const shell = {};
  let ran = 0;
  b.history.addHandler(() => { ran++; b.history.setDepth(shell, 0); return true; });
  b.history.setDepth(shell, 1); b.settle();
  b.userBack();
  assert.equal(ran, 1);
  assert.equal(b.at, 0);
  // Forward to the entry left: nothing is open there any more, so the shell walks back again
  b.history.moved(b.entries[1]); b.settle();
  assert.equal(b.history.index, 0);
  assert.equal(ran, 1);
});

test('web history: each entry keeps its screen; a reload restores it from the entry or the saved copy', () => {
  const b = browser();
  const shell = {};
  b.history.setScreen({ tab: 'apps' });
  b.history.setDepth(shell, 1); b.settle();
  assert.deepEqual(JSON.parse(b.saved!), { i: 1, screen: { tab: 'apps' } });
  const state = b.entries[1];
  // The entry kept its state
  const kept = browser({ state });
  assert.deepEqual(kept.history.restored, { tab: 'apps' });
  assert.equal(kept.history.index, 1);
  // A reload that lost the state: the saved copy
  const reload = browser({ saved: b.saved, reloaded: true });
  assert.deepEqual(reload.history.restored, { tab: 'apps' });
  assert.equal(reload.history.index, 1);
  // A fresh visit ignores the saved copy; bad states are ignored
  assert.equal(browser({ saved: b.saved }).history.restored, undefined);
  assert.equal(browser({ state: { 'spl-nav': { i: -1, screen: 1 } } }).history.restored, undefined);
  assert.equal(browser({ saved: '{bad', reloaded: true }).history.index, 0);
});

test('web history: a restored index that is deeper than the screens restored walks back on the first sync', () => {
  const mark = (i: number) => ({ 'spl-nav': { i, screen: { tab: 'apps' } } });
  const b = browser({ before: [null, mark(1)], state: mark(2) });
  const shell = {};
  b.history.setDepth(shell, 1); b.settle();
  assert.ok(b.log.includes('back:1'));
  assert.equal(b.history.index, 1);
});

test('web history: a walk back that keeps landing on the wrong entry is not retried forever', () => {
  const b = browser();
  const shell = {};
  b.history.setDepth(shell, 2); b.settle();
  const back = b.env.back;
  let walks = 0;
  b.env.back = () => { walks++; b.env.later(() => b.history.moved(b.entries[2])); };
  b.history.setDepth(shell, 0); b.settle();
  assert.equal(walks, 2);
  assert.equal(b.history.index, 2);
  b.env.back = back;
});

test('browser files import nothing but types from their own Android counterpart, which is themselves in the browser build', async () => {
  const { readFileSync } = await import('node:fs');
  const { execFileSync } = await import('node:child_process');
  const files = execFileSync('git', ['ls-files', '*.web.ts', '*.web.tsx'], { encoding: 'utf8' }).split('\n').filter(Boolean);
  assert.ok(files.length > 3);
  for (const file of files) {
    const base = file.split('/').pop()!.replace(/\.web\.tsx?$/, '');
    const values = readFileSync(file, 'utf8').split('\n').filter(line => line.includes(`from './${base}'`) && !/^import type /.test(line));
    assert.deepEqual(values, [], file);
  }
});

test('the launcher walks back by its own entries, so an App frame\'s sub-page entries never shift the count', async () => {
  const { ownEntryBack } = await import('../src/core/web-history.ts');
  // The tab's history: launcher home, App open, then two sub-pages the App frame pushed.
  // The Navigation API lists only the launcher's own two.
  const own = [{ key: 'home' }, { key: 'app' }];
  const nav = { currentEntry: { index: 1 }, entries: () => own, traverseTo: () => ({ finished: Promise.resolve() }) };
  assert.equal(ownEntryBack(nav, 1)?.key, 'home', 'Home from inside an App lands on the launcher entry, past the frame\'s entries');
  assert.equal(ownEntryBack(nav, 2), undefined);
  assert.equal(ownEntryBack(undefined, 1), undefined, 'without the API the caller uses history.go');
});
