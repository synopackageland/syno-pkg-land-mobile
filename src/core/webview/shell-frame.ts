/**
 * The browser launcher's half of an App's Home (the UI kit's top-left Home on a root page). The
 * Android shell lists `close` in its bridge's `features`; a browser frame has no bridge, so the
 * launcher names the App's frame instead and the page posts the same `{ v: 1, type: 'close' }` to
 * its parent window. The UI kit documents the name (docs/adaptive-layout.md).
 */
import { isNativeClose } from '../bridge/contract.ts';

/** `synopkg-shell:<protocol>:<features>`: protocol 1, and the one request it takes */
export const SHELL_FRAME_NAME = 'synopkg-shell:1:close';

/**
 * Whether a message is the App's Home: from the App's own frame and origin, the bridge's `close`,
 * and right after a tap (a tap in the frame activates this page too), so a page cannot leave on
 * its own.
 */
export function isFrameHome(event: { data: unknown; origin: string; source: unknown }, frame: unknown, origin: string, activated: boolean): boolean {
  return Boolean(frame) && event.source === frame && event.origin === origin && activated && isNativeClose(event.data);
}
