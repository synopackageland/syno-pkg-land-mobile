import type { NativeEvent, NativeMessage } from '../bridge/contract';
import { prepareTransfer } from './prepare.ts';

/** The browser build saves through the browser's own download */
export async function download(message: Extract<NativeMessage, { type: 'download' }>, origin: string, id: string, emit: (event: NativeEvent) => void = () => {}): Promise<void> {
  await prepareTransfer(message, id, emit, async message => {
    if ('base64' in message) {
      const bytes = Uint8Array.from(atob(message.base64), c => c.charCodeAt(0));
      return URL.createObjectURL(new Blob([bytes], { type: message.mime || 'application/octet-stream' }));
    }
    if (new URL(message.url, origin).origin !== origin) throw new Error('Cross-origin download');
    return message.url;
  }, (uri, filename) => {
    const a = document.createElement('a');
    a.href = uri; a.download = filename; a.rel = 'noopener';
    document.body.append(a);
    try { a.click(); } finally { a.remove(); }
    if (uri.startsWith('blob:')) setTimeout(() => URL.revokeObjectURL(uri), 60_000);
    emit({ v: 1, type: 'transfer', id, state: 'saved' });
  });
}
/** The browser owns its downloads */
export function cleanupDownloads(): void {}
