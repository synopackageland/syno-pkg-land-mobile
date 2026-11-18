import type { NativeEvent, NativeMessage } from '../bridge/contract.ts';
type Download = Extract<NativeMessage, { type: 'download' }>;
export const safeName = (name: string): string => {
  const value = name.replace(/[\\/:*?"<>|\u0000-\u001f\u007f]/g, '_').slice(0, 120);
  return !value.trim() || value === '.' || value === '..' ? 'download' : value;
};
/** Acknowledge before I/O, report ready before presenting native actions */
export async function prepareTransfer(message: Download, id: string, emit: (event: NativeEvent) => void,
  prepare: (message: Download, filename: string) => Promise<string>, present: (uri: string, filename: string) => void): Promise<void> {
  emit({ v: 1, type: 'transfer', id, state: 'downloading', progress: 0 });
  try {
    const filename = safeName(message.filename);
    const uri = await prepare(message, filename);
    emit({ v: 1, type: 'transfer', id, state: 'ready', progress: 1 });
    present(uri, filename);
  } catch (error) {
    emit({ v: 1, type: 'transfer', id, state: 'failed' });
    throw error;
  }
}
