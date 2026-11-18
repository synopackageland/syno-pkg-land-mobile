import type { IntakeDeclaration } from './intake/accept';
export type ShellConfig = {
  appId: string; name: string; version: string; scheme: string;
  assets: { icon?: string; splash?: string };
  mode: 'launcher' | 'single'; intakeSchemes: string[];
};
export type NasAddress = { url: string; kind: 'lan' | 'cf' | 'netbird' | 'other'; sha256?: string };
/** quickconnect: the QuickConnect ID the origin came from; each connection looks it up again, as the NAS's address can change */
export type NasProfile = { id: string; name: string; origin: string; group?: string; kind?: NasAddress['kind']; sha256?: string; mobileFit?: boolean; quickconnect?: string };
export type AppTarget = {
  id: string; url: string; preset: 'mobile' | 'desktop';
  /** Only mobile.json opt-in targets may enable the native bridge */
  intake?: IntakeDeclaration;
  registered: boolean; capabilities: Array<'download' | 'open-external' | 'camera'>;
  start?: string;
};
export type Launch = { link?: string; intake?: string };
