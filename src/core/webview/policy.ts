import { sameOrigin } from '../profiles/url.ts';
export function navigation(url: string, origin: string, mainFrame = true): 'allow' | 'external' | 'block' {
  if (url === 'about:blank' || sameOrigin(url, origin)) return 'allow';
  if (!mainFrame) return /^https?:/.test(url) ? 'allow' : 'block';
  return /^https?:/.test(url) ? 'external' : 'block';
}
export const mobilePreset = { scalesPageToFit: false, setBuiltInZoomControls: false };
export const desktopPreset = {
  userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
  scalesPageToFit: true, setBuiltInZoomControls: true, setDisplayZoomControls: false,
};
/** Two warm WebViews; eviction never reloads the foreground target */
export function warmKeys(previous: string[], foreground: string): string[] {
  return [...previous.filter(key => key !== foreground), foreground].slice(-2);
}
