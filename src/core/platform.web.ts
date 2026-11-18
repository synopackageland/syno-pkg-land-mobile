import type { NasProfile } from './config';

export const singleNas = true;
export const WEB_PROFILE = 'web';
const NAME_KEY = 'spl:server-name';
/** The DSM this page came from, named by its sign-in page; the saved switches (mobile fit) are kept */
export function fixedProfile(saved?: NasProfile): NasProfile | undefined {
  let name = '';
  try { name = window.localStorage.getItem(NAME_KEY) || ''; } catch { /* Private mode */ }
  return { id: WEB_PROFILE, name: name || location.hostname, origin: location.origin, ...(saved?.mobileFit !== undefined ? { mobileFit: saved.mobileFit } : {}) };
}
/** DSM's server name from its sign-in page title, for the next start */
export async function loadServerName(): Promise<string> {
  try {
    const page = await (await fetch('/', { credentials: 'same-origin' })).text();
    const raw = /<title>([^<]{1,200})<\/title>/i.exec(page)?.[1] || '';
    // DSM writes "<server>&nbsp;-&nbsp;Synology&nbsp;NAS", and "DSM mobile - <server>" to phones
    const title = new DOMParser().parseFromString(raw, 'text/html').documentElement.textContent?.replace(/\s+/g, ' ').replace(/ - Synology.*$/i, '').replace(/^DSM mobile - /i, '').trim().slice(0, 80) || '';
    if (title) window.localStorage.setItem(NAME_KEY, title);
    return title;
  } catch { return ''; }
}
