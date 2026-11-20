/**
 * "Switch to the local network" card for the browser build (`LanSwitch.web.tsx`). The native App
 * reaches the NAS its own way, so it never shows one.
 */
/** locale: the App's language, the one the rest of the page is written in */
export type LanSwitchProps = { locale: string };
export function LanSwitch(_props: LanSwitchProps) {
  return null;
}
