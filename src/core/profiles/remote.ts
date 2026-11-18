import type { NasLink } from './nas-links';

/**
 * Other NAS the browser build can switch to: each runs its own launcher on its own origin (see
 * nas-links.ts). The Android App keeps its NAS as profiles instead, so it has none of this.
 */
export type RemoteState = { links: NasLink[]; checking: string[] };
export type FindResult =
  | { kind: 'found'; origin: string; launcher: string }
  /** DSM answered, but no launcher: the NAS can still be added, and switching opens its DSM */
  | { kind: 'noLauncher'; origin: string }
  /**
   * Nothing answered. A browser cannot tell why: off that network, or a certificate it does not
   * trust (self-signed, or issued for a name while the address is an IP), which it refuses
   * silently in the background until the user opens and accepts that page once
   */
  | { kind: 'unreachable'; origin?: string; certificate?: boolean }
  | { kind: 'invalid'; code: string };
export type RemoteNas = {
  /** This page's own origin */
  self: string;
  subscribe(listener: () => void): () => void;
  getState(): RemoteState;
  /** Checks in the background which NAS answer; never blocks */
  check(): void;
  /**
   * Opens that NAS's launcher in place of the current history entry, handing the list over; a
   * DSM-only NAS opens its DSM in a new tab instead. True when this page is navigating away
   */
  switchTo(origin: string): boolean;
  remove(origin: string): void;
  /** Looks for a launcher at a typed address */
  find(input: string, signal: AbortSignal): Promise<FindResult>;
  /**
   * Adds a NAS: dsm when no launcher answered there, so switching opens its DSM; unanswered when
   * nothing answered at all, so it is not shown as reachable
   */
  add(link: { origin: string; launcher: string; name: string; dsm?: boolean; unanswered?: boolean }): void;
  /** That NAS's DSM in a new tab */
  openDsm(origin: string): void;
};
export const remoteNas: RemoteNas | undefined = undefined;
