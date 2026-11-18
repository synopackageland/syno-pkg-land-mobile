import type { NativeIntakeItem } from '../bridge/contract.ts';
export type IntakeRule =
  | { kind: 'url'; schemes: string[] }
  | { kind: 'text' }
  | { kind: 'file'; types: string[]; max_bytes: number };
export type IntakeDeclaration = { route: string; accept: IntakeRule[] };
export function acceptsIntake(items: NativeIntakeItem[], declaration: IntakeDeclaration): boolean {
  if (!items.length || items.length > 16) return false;
  let size = 0;
  return items.every(item => {
    if (item.kind === 'file') { size += item.size; if (size > 8 * 1024 * 1024) return false; }
    return declaration.accept.some(rule => {
      if (rule.kind !== item.kind) return false;
      if (rule.kind === 'text') return true;
      if (rule.kind === 'url' && item.kind === 'url') {
        try { return rule.schemes.includes(new URL(item.url).protocol.slice(0, -1)); } catch { return false; }
      }
      if (rule.kind === 'file' && item.kind === 'file') return item.size <= Math.min(rule.max_bytes, 8 * 1024 * 1024) && rule.types.some(type => type.startsWith('.') ? item.filename.toLowerCase().endsWith(type.toLowerCase()) : type.endsWith('/*') ? item.mime.startsWith(type.slice(0, -1)) : item.mime === type);
      return false;
    });
  });
}
