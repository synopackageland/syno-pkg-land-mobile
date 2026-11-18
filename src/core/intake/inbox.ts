import { isNativeIntakeItem, type NativeIntakeItem } from '../bridge/contract.ts';
export class IntakeInbox {
  private entries = new Map<string, { origin: string; items: NativeIntakeItem[] }>();
  private used = new Set<string>();
  put(id: string, origin: string, items: NativeIntakeItem[]): void {
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(id) || this.used.has(id) || !items.every(isNativeIntakeItem)) throw new Error('Invalid intake');
    if (items.length > 16 || items.some(item => item.kind === 'file' && item.base64.length / 4 * 3 - (item.base64.endsWith('==') ? 2 : item.base64.endsWith('=') ? 1 : 0) !== item.size)) throw new Error('Invalid intake size');
    // A session stops accepting shares at the bound, instead of forgetting consumed handles
    if (this.used.size >= 1024) throw new Error('Intake session limit reached');
    if (this.entries.size >= 16) this.entries.delete(this.entries.keys().next().value!);
    this.used.add(id);
    this.entries.set(id, { origin, items: items.map(item => ({ ...item })) });
  }
  take(id: string, origin: string): NativeIntakeItem[] {
    const entry = this.entries.get(id);
    if (!entry || entry.origin !== origin) return [];
    this.entries.delete(id);
    return entry.items;
  }
  clear(): void { this.entries.clear(); this.used.clear(); }
}
export const intakeInbox = new IntakeInbox();
