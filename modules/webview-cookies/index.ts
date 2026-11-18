import { requireNativeModule } from 'expo';
import type { NativeModule } from 'expo-modules-core/types';
import type { NativeIntakeItem as NativeIntake } from '../../src/core/bridge/contract';
export type NativeTls = { sha256: string; trusted: boolean; chainTrusted: boolean; hostnameMatch: boolean; selfSigned: boolean; expired: boolean; subject: string; issuer: string; notAfter: number };
export type NativeSignIn = { success: true; scope: string } | { success: false; status: number; code: number; types: string[] };
export type NativeProbe = { status?: number; body?: string; location?: string | null; error?: string; tls?: NativeTls | null };
type Events = {
  onBridgeMessage: (event: { data: string; origin: string; viewId: number; userActivated: boolean }) => void;
  onIntake: (event: { items: NativeIntake[]; error?: string; addNas?: string }) => void;
  onTransfer: (event: { id: string; received: number; total: number }) => void;
  onDocument: (event: { viewId: number; stage: 'start' | 'visible' }) => void;
  /** Keyboard top in window dp; -1 while no keyboard is shown */
  onKeyboard: (event: { top: number }) => void;
  onSignIn: (event: { viewId: number; origin: string; scope: string }) => void;
};
export default requireNativeModule<NativeModule<Events> & {
  /** resetScript runs at document start in every frame of the origin, bridge or not */
  bindBridge(viewId: number, origin: string, script: string, camera: boolean, signInScript: string, resetScript: string): Promise<boolean>;
  unbindBridge(viewId: number): Promise<void>;
  /** Experimental mobile fit: presentation-only document-start script, no transport. Call after bindBridge. */
  bindFit(viewId: number, origin: string, script: string): Promise<boolean>;
  /** Pre-sign-in probe: no cookies; reports the presented leaf without trusting it */
  probe(url: string, id: string): Promise<NativeProbe>;
  cancelProbe(id: string): void;
  releaseProbe(id: string): void;
  goBackIfPossible(viewId: number): Promise<boolean>;
  zeroWebViewInsets(): Promise<number>;
  logOpen(stage: 'tap_received' | 'intake_received' | 'open_requested' | 'webview_created' | 'open_waiting' | 'open_retry' | 'open_rejected' | 'press_started' | 'press_released', request: number): void;
  logSignIn(stage: 'launcher_shown' | 'refresh_started' | 'refresh_finished' | 'refresh_failed'): void;
  setCertificatePins(pins: { origin: string; sha256: string }[]): Promise<void>;
  cookieHeader(url: string): string;
  sessionKey(origin: string): string;
  /** language: an optional Accept-Language value */
  readJson(url: string, origin: string, language?: string): Promise<{ status: number; body: string }>;
  /** Writes the image to dest (under files/app-icons) only on a 200 raster image; 304 and errors leave it untouched */
  fetchIcon(url: string, origin: string, dest: string, etag?: string | null, lastModified?: string | null): Promise<{ status: number; etag?: string | null; lastModified?: string | null; size?: number }>;
  haptic(kind: 'long' | 'tick' | 'confirm'): void;
  /** Expires the origin's cookies; keepDevice keeps DSM's trusted-device cookie (sign-out, not NAS removal) */
  clearSession(origin: string, keepDevice: boolean): Promise<void>;
  /** Native Auth.login. Rejects with a network cause code (certificate, timeout, refused, cancelled…) */
  signIn(origin: string, body: string, userAgent: string, id: string): Promise<NativeSignIn>;
  cancelSignIn(id: string): void;
  deviceName(): string;
  /** Nonce written at each sign-out and native sign-in; empty before the first */
  storageReset(origin: string): string;
  takePendingIntake(): Promise<{ items: NativeIntake[]; error?: string; addNas?: string }>;
  download(url: string, origin: string, filename: string, id: string): Promise<string>;
  saveToDownloads(uri: string, filename: string, mime: string): Promise<void>;
}>('WebViewCookies');
