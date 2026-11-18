/**
 * "Add to Home Screen" card for the browser build (`InstallHint.web.tsx`). The native App is already
 * installed, so it never shows one.
 */
/** locale: the App's language, the one the rest of the page is written in (not navigator.language) */
export type InstallHintProps = { name: string; locale: string };
export function InstallHint(_props: InstallHintProps) {
  return null;
}
