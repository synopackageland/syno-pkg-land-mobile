/**
 * Readiness of the document in the browser build's App frame (ShellScreen.web.tsx).
 * `loaded`: the document has finished loading; `reported`/`busy`: the fit's last report on the App;
 * `ready`: the cover is leaving; `launched`/`launchedAt`: the warm page's App request and when it, or
 * this document, started; `failed`/`placedAt`: the warm page's failure and slide bookkeeping.
 */
export type FrameState = { loaded: boolean; reported: boolean; busy: boolean; ready: boolean; launched: number; launchedAt: number; failed: number; placedAt: number };
export const initialFrameState = (): FrameState => ({ loaded: false, reported: false, busy: false, ready: false, launched: 0, launchedAt: 0, failed: 0, placedAt: 0 });

/**
 * The state for a document the shell has just noticed. The shell polls for new documents, and a small
 * page (an SDK App's launch page) can finish loading, and fire the frame's load event, before the
 * poll sees it: such a document counts as loaded from now, or no load event would ever mark it.
 * A warm DSM page keeps its own launch time.
 */
export function noticedDocument(state: FrameState, readyState: string, now: number, warm: boolean): FrameState {
  const loaded = readyState === 'complete';
  return { ...state, loaded, reported: false, busy: false, ready: false, launched: 0, launchedAt: loaded && !warm ? now : state.launchedAt };
}
