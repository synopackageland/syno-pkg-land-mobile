/**
 * Android's back button and gesture. The web build (back.web.ts) maps the browser's back to the
 * same handlers through history entries; on Android the steps and screens below need nothing:
 * the handlers run directly and a sheet's Modal takes back itself.
 */
export { BackHandler } from 'react-native';
export function useBackDepth(_depth: number): void {}
export function useBackStep(_open: boolean, _close: () => void): void {}
export const restoredScreen = (): unknown => undefined;
export function useBackScreen(_screen: unknown): void {}
