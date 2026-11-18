import { Alert } from 'react-native';
import { Directory, File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import Native from '../../../modules/webview-cookies';
import type { NativeEvent, NativeMessage } from '../bridge/contract';
import { prepareTransfer } from './prepare.ts';
import { strings } from '../i18n/strings';
export async function download(message: Extract<NativeMessage, { type: 'download' }>, origin: string, id: string, emit: (event: NativeEvent) => void = () => {}): Promise<void> {
  const mime = message.mime || 'application/octet-stream';
  await prepareTransfer(message, id, emit, async (message, filename) => {
    let uri: string;
    if ('base64' in message) {
      const dir = new Directory(Paths.cache, 'downloads', `${Date.now()}-${Math.random().toString(36).slice(2)}`);
      dir.create({ intermediates: true, idempotent: true });
      const file = new File(dir, filename); file.create();
      await file.write(message.base64, { encoding: 'base64' }); uri = file.uri;
    } else uri = await Native.download(message.url, origin, filename, id);
    return uri;
  }, (uri, filename) => {
    // No file URI crosses the page boundary
    const t = strings();
    Alert.alert(t.downloadDone, filename, [
      { text: t.later, style: 'cancel', onPress: () => emit({ v: 1, type: 'transfer', id, state: 'canceled' }) },
      { text: t.share, onPress: () => { Sharing.shareAsync(uri, { mimeType: mime, dialogTitle: filename }).then(() => emit({ v: 1, type: 'transfer', id, state: 'shared' })).catch(() => { emit({ v: 1, type: 'transfer', id, state: 'failed' }); Alert.alert(t.fileShareFailed); }); } },
      { text: t.saveToDownloads, onPress: () => { Native.saveToDownloads(uri, filename, mime).then(() => { emit({ v: 1, type: 'transfer', id, state: 'saved' }); Alert.alert(t.savedToDownloads); }).catch(() => { emit({ v: 1, type: 'transfer', id, state: 'failed' }); Alert.alert(t.saveFailed); }); } },
    ]);
  });
}
/** Clean old cache entries only; never remove an in-flight or recently shared file */
export function cleanupDownloads(): void {
  try {
    const root = new Directory(Paths.cache, 'downloads');
    if (!root.exists) return;
    for (const item of root.list()) if (Date.now() - (item.info().modificationTime || Date.now()) > 24 * 60 * 60 * 1000) item.delete();
  } catch { /* Cache cleanup is best effort */ }
}
