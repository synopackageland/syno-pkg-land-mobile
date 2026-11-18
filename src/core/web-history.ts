/**
 * Browser history for the web build, one entry per back step the shell has, like Android's back stack.
 *
 * Screens declare how many steps back they hold (a tab other than the first, each pushed page, an open
 * App, a sheet, a dialog inside a DSM App). The sum is the depth. Every change of depth comes from a
 * tap, so each new step is pushed as an entry while the tap still counts as user activation, and
 * Chrome's back (button or edge swipe) stops at it. Back fires popstate: the shell runs its back
 * handlers once per entry left, which lowers the depth to match. When the shell itself goes back (a
 * Back or Home button), the entries are walked back to the new depth.
 *
 * Inside an App frame, the frame's own navigations add their own entries after the shell's, so the
 * browser goes back through them first and the App's root is left by the shell's entry.
 *
 * Each entry also keeps the screen it stands for, so a reload (and a step back into an entry from
 * before a reload, which the browser loads again) opens that screen instead of the home page.
 */
export type BackHandlerFn = () => boolean | null | undefined;
export type HistoryEnv = {
  /** The current entry's state */
  state(): unknown;
  push(state: unknown): void;
  replace(state: unknown): void;
  /** Goes back this many of the page's own entries, past any entries of its frames */
  back(steps: number): void;
  /** Saved for a reload that loses the entry's state */
  load(): string | null;
  save(value: string): void;
  /** True when this document is a reload, where the saved state belongs to the current entry */
  reloaded: boolean;
  /** Runs after the current task, once per batch of changes */
  later(run: () => void): void;
};
const MARK = 'spl-nav';
type Mark = { i: number; screen?: unknown };
function markOf(state: unknown): Mark | undefined {
  const mark = (state as Record<string, unknown> | null)?.[MARK] as Mark | undefined;
  return mark && Number.isInteger(mark.i) && mark.i >= 0 && mark.i <= 1000 ? mark : undefined;
}
function savedMark(value: string | null): Mark | undefined {
  try { return value ? markOf({ [MARK]: JSON.parse(value) }) : undefined; } catch { return undefined; }
}

export class WebHistory {
  private handlers: BackHandlerFn[] = [];
  private depths = new Map<object, number>();
  /** Index of the current entry among the page's own entries; 0 is the page as it was opened */
  private at: number;
  /** The index a walk back started by the shell lands on */
  private expected: number | null = null;
  private screen: unknown;
  private queued = false;
  /** Walks back in a row that landed somewhere else */
  private missed = 0;
  /** The screen the current entry stood for when this document started (reload or a step back) */
  readonly restored: unknown;
  private env: HistoryEnv;
  constructor(env: HistoryEnv) {
    this.env = env;
    const mark = markOf(env.state()) ?? (env.reloaded ? savedMark(env.load()) : undefined);
    this.at = mark?.i ?? 0;
    this.restored = this.screen = mark?.screen;
  }
  get index() { return this.at; }
  get depth() { let sum = 0; for (const value of this.depths.values()) sum += value; return sum; }
  addHandler(handler: BackHandlerFn) {
    this.handlers.push(handler);
    return () => { const i = this.handlers.indexOf(handler); if (i >= 0) this.handlers.splice(i, 1); };
  }
  /** The newest handler first, like Android's BackHandler */
  run(): boolean {
    for (let i = this.handlers.length - 1; i >= 0; i--) if (this.handlers[i]()) return true;
    return false;
  }
  setDepth(owner: object, depth: number) {
    const value = Math.max(0, Math.floor(depth) || 0);
    if (this.depths.get(owner) === value) return;
    if (value) this.depths.set(owner, value); else this.depths.delete(owner);
    this.schedule();
  }
  setScreen(screen: unknown) {
    this.screen = screen;
    this.schedule();
  }
  /** The browser moved to another entry (popstate) */
  moved(state: unknown) {
    const to = markOf(state)?.i ?? 0;
    if (this.expected !== null && to === this.expected) { this.expected = null; this.missed = 0; this.at = to; this.schedule(); return; }
    // The shell's own walk back landed elsewhere: take that entry, and walk again at most once
    if (this.expected !== null) { this.expected = null; this.at = to; if (this.missed++ < 1) this.schedule(); return; }
    // Forward, or no move at all: sync walks back to the shell's depth again
    if (to >= this.at) { this.at = to; this.schedule(); return; }
    let steps = this.at - to;
    this.at = to;
    while (steps-- > 0) if (!this.run()) break;
    this.schedule();
  }
  /** A walk back that never landed (blocked by the browser): take the entry it stopped on */
  settle(state: unknown) {
    if (this.expected === null) return;
    this.expected = null;
    this.at = markOf(state)?.i ?? 0;
    this.schedule();
  }
  private schedule() {
    if (this.queued) return;
    this.queued = true;
    this.env.later(() => { this.queued = false; this.sync(); });
  }
  sync() {
    if (this.expected !== null) return;
    const want = this.depth;
    if (want > this.at) while (this.at < want) { this.at++; this.env.push(this.mark()); }
    else if (want < this.at) { this.expected = want; this.env.back(this.at - want); return; }
    else this.env.replace(this.mark());
    try { this.env.save(JSON.stringify({ i: this.at, screen: this.screen })); } catch { /* Not kept over a reload */ }
  }
  private mark() { return { [MARK]: { i: this.at, screen: this.screen } }; }
}

/** The Navigation API's view of this page's history */
export type Navigation = { currentEntry?: { index: number }; entries(): Array<{ key: string }>; traverseTo(key: string): { finished: Promise<unknown> } };
/**
 * The launcher's entry `steps` back, by the Navigation API, which lists this page's own entries only:
 * entries an App frame added (its sub-pages) never shift the count. Undefined without the API.
 */
export function ownEntryBack(nav: Navigation | undefined, steps: number): { key: string } | undefined {
  const index = nav?.currentEntry?.index;
  return nav && index !== undefined && index - steps >= 0 ? nav.entries()[index - steps] : undefined;
}
