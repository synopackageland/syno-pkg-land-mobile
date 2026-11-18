import { MAX_BASE64, isNativeMessage, type NativeEvent, type NativeMessage } from './contract.ts';
import { sameOrigin } from '../profiles/url.ts';
import type { IntakeInbox } from '../intake/inbox.ts';
export type BridgeActions = {
  download: (message: Extract<NativeMessage, { type: 'download' }>) => Promise<void>;
  openExternal: (url: string) => Promise<void>;
  /** Leave the App for the App list; absent when this shell has nowhere to go back to */
  close?: () => void;
  ready: () => void; emit: (event: NativeEvent) => void;
};
export class BridgeHost {
  private lastExternal = -Infinity;
  private activation = -Infinity;
  private active = 0;
  private origin: string; private caps: string[]; private inbox: IntakeInbox; private actions: BridgeActions; private now: () => number;
  constructor(origin: string, caps: string[], inbox: IntakeInbox, actions: BridgeActions, now = Date.now) {
    this.origin = origin; this.caps = caps; this.inbox = inbox; this.actions = actions; this.now = now;
  }
  activate(): void { this.activation = this.now(); }
  async receive(value: unknown, sourceOrigin: string): Promise<boolean> {
    if (sourceOrigin !== this.origin || !isNativeMessage(value)) return false;
    const m = value;

    try {
      switch (m.type) {
        case 'ready': this.actions.ready(); break;
        case 'intake.take': this.actions.emit({ v: 1, type: 'reply', id: m.id, ok: true, items: this.inbox.take(m.id, this.origin) }); return true;
        case 'openExternal': {
          const u = new URL(m.url);
          if (!this.caps.includes('open-external') || !/^https?:$/.test(u.protocol) || u.username || u.password || this.now() - this.activation > 1000 || this.now() - this.lastExternal < 1000) return false;
          this.activation = -Infinity; this.lastExternal = this.now();
          await this.actions.openExternal(u.href); break;
        }
        case 'close':
          // The page's own Back to the App list: only right after a tap, like openExternal, so a page cannot close itself
          if (!this.actions.close || this.now() - this.activation > 1000) return false;
          this.activation = -Infinity;
          this.actions.close(); break;
        case 'download':
          if (!this.caps.includes('download') || ('url' in m && !sameOrigin(m.url, this.origin)) || ('base64' in m && m.base64.length / 4 * 3 - (m.base64.endsWith('==') ? 2 : m.base64.endsWith('=') ? 1 : 0) > MAX_BASE64) || this.active >= 2) { this.actions.emit({ v: 1, type: 'transfer', id: m.id, state: 'failed' }); return false; }
          this.active++;
          try { await this.actions.download(m); } finally { this.active--; }
          break;
      }
      return true;
    } catch {
      if (m.type === 'intake.take') this.actions.emit({ v: 1, type: 'reply', id: m.id, ok: false, error: { code: 'NATIVE_FAILED' } });
      return false;
    }
  }
}
