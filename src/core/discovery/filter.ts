import { record, type DiscoveredApp } from './schema.ts';
import { sameOrigin } from '../profiles/url.ts';

/** DSM tools bundled with DSM itself, even where DSM deploys them under 3rdparty */
const bundledPackages = new Set(['FileBrowser', 'StorageManager', 'ResourceMonitor', 'ControlPanel', 'SecurityScan', 'SupportForm', 'UniversalSearch', 'OAuthService', 'ScsiTarget', 'USBCopy']);
/** DSM Apps the launcher leaves out: DSM Help and Support Center */
const hiddenApps = new Set(['SYNO.SDS.HelpBrowser.Application', 'SYNO.SDS.SupportForm.Application', 'SYNO.PKG.SupportForm.Application']);
type Visibility = 'shown' | 'runtime' | false;
/**
 * DSM's main-menu decision from Initdata: grants, user type, scope, service
 * state and launch conditions. A hardware flag (supportKey) is answered from
 * DSM's Defs (_D); without Defs, from DSM's own last main menu
 * (valid_appview_order), and otherwise the live DSM runtime must confirm it.
 */
function allowed(config: Record<string, unknown>, id: string, data: Record<string, unknown>, shownByDsm: Set<string>): Visibility {
  const session = record(data.Session), privileges = record(data.AppPrivilege);
  const admin = session.is_admin === true, domain = session.domainUser === true || session.domainUser === 'true';
  // DSM StatusNotifier.isAppHasPrivilege
  const scope = String(config.grantPrivilege || 'all'), userType = config.grantPrivilegeUserType || 'all';
  const scoped = scope === 'all' || scope === 'local' && !domain || scope === 'domain' && domain;
  if ((config.grantPrivilege || config.grantAppPrivilege) && scoped) {
    if (privileges['SYNO.ALLOW.ALL.APPLICATIONS'] !== true && privileges[String(config.grantAppPrivilege || id)] !== true) return false;
    if (userType === 'admin' && !admin || userType === 'normal' && admin) return false;
  } else if (!(Array.isArray(data.ActionPrivilege) && data.ActionPrivilege.includes(id))
    && !((admin || config.allUsers === true) && !(scope === 'local' && domain || scope === 'domain' && !domain))) return false;
  if (config.hidden === true || config.launchable === false || (id in record(data.ServiceStatus) && record(data.ServiceStatus)[id] !== true)) return false;
  if (Object.entries(record(config.canLaunch)).some(([key, value]) => Boolean(session[key]) !== value)) return false;
  if (session.ha_safemode === true) return false;
  if (config.supportKey === undefined || config.type !== 'app') return 'shown';
  const defs = data.Defs;
  if (defs && typeof defs === 'object') return supported(config.supportKey, record(defs)) ? 'shown' : false;
  return shownByDsm.has(id) ? 'shown' : 'runtime';
}
/** DSM AppUtil.isSupportedType: each {key, value?, cond?} folds into one answer against _D() */
function supported(value: unknown, defs: Record<string, unknown>): boolean {
  const D = (key: unknown) => typeof key === 'string' && typeof defs[key] === 'string' ? defs[key] as string : '';
  return (Array.isArray(value) ? value : [value]).reduce<boolean>((result, raw) => {
    const item = record(raw), match = item.value !== undefined ? D(item.key) === item.value : D(item.key) !== '';
    return item.cond === 'or' ? result || match : result && match;
  }, true);
}
/** DSM icon templates: {0} is the pixel size, {1} the resolution folder (1x / 2x) */
export const ICON_SIZES = [72, 128, 256, 64, 48] as const;
function iconTemplate(icon: string, base: string, origin: string): string | undefined {
  // Some templates carry their stamp as "&v=0003" without a query; DSM serves it as a query
  let template = icon.replaceAll('{1}', '1x');
  if (!template.includes('?') && template.includes('&')) template = template.replace('&', '?');
  try {
    const resolved = new URL(template.replaceAll('{0}', 'SIZE0'), `${origin}/${base}/`).href;
    return sameOrigin(resolved, origin) ? resolved.replaceAll('SIZE0', '{0}') : undefined;
  } catch { return undefined; }
}
/**
 * The order of DSM's main menu: the user's drag order (Desktop.appview_order),
 * then the order DSM last displayed (Desktop.valid_appview_order), which also
 * holds Apps installed after the user reordered.
 */
export function dsmOrder(value: unknown): string[] {
  const desktop = record(record(record(value).UserSettings).Desktop);
  const ids = (list: unknown) => Array.isArray(list) ? list.filter((id): id is string => typeof id === 'string') : [];
  return [...new Set([...ids(desktop.appview_order), ...ids(desktop.valid_appview_order)])];
}
export function filterApps(value: unknown, origin: string): DiscoveredApp[] {
  const data = record(value);
  if (record(data.Session).isLogined !== true) throw new Error('SIGN_IN_REQUIRED');
  // DSM AppUtil -> StatusNotifier.isAppValid -> Packages.isStop. Package IDs
  // and UI folders are not interchangeable: DSM maps status via dsm_apps.
  const stopped = new Set<string>(), versions = new Map<string, string>();
  for (const value of Array.isArray(data.Packages) ? data.Packages : []) {
    const additional = record(record(value).additional), version = record(value).version;
    if (typeof additional.dsm_apps === 'string' && typeof version === 'string') additional.dsm_apps.trim().split(/\s+/).forEach(id => versions.set(id, version));
    if (['stop', 'NA', 'non_installed'].includes(String(additional.status)) && typeof additional.dsm_apps === 'string') {
      additional.dsm_apps.trim().split(/\s+/).forEach(id => stopped.add(id));
    }
  }
  const order = dsmOrder(data), rank = new Map(order.map((id, index) => [id, index]));
  const shownByDsm = new Set(order);
  const session = record(data.Session);
  const dsmVersion = typeof session.fullversion === 'string' ? session.fullversion : typeof session.version === 'string' ? session.version : undefined;
  const seen = new Set<string>();
  const apps = new Map<string, DiscoveredApp>();
  for (const [source, group] of Object.entries(record(data.JSConfig))) {
    for (const [key, raw] of Object.entries(record(group))) {
      const config = record(raw), id = typeof config.jsID === 'string' ? config.jsID : key;
      if (seen.has(id)) continue;
      seen.add(id); // DSM JSLoad.init retains the first definition
      if (stopped.has(id) || hiddenApps.has(id) || !['app', 'standalone', 'url'].includes(String(config.type))) continue;
      const visibility = allowed(config, id, data, shownByDsm);
      if (!visibility) continue;
      const base = typeof config.jsBaseURL === 'string' ? config.jsBaseURL : source;
      // Packages live in webman/3rdparty/<package>, DSM's own modules in webman/modules/<module>
      const [, kind, pkg] = /^\/?webman\/(3rdparty|modules)\/([A-Za-z0-9_-]+)(?:\/|$)/.exec(base) || [];
      if (!pkg) continue;
      const builtin = kind === 'modules' || bundledPackages.has(pkg);
      const localized = record(record(data.Strings)[id]);
      const title = typeof config.title === 'string' ? config.title : '';
      const [namespace, label] = title.split(':');
      // A package's own strings first, then DSM's global UI strings (DSM's _T)
      const name = label ? record(localized[namespace])[label] || record(record(data.UIStrings)[namespace])[label] : title;
      const template = typeof config.icon === 'string' ? iconTemplate(config.icon, `webman/${kind}/${pkg}`, origin) : undefined;
      // A DSM module has no package version; DSM's own build keys its icon cache
      const version = versions.get(id) || (kind === 'modules' ? dsmVersion : undefined);
      // icon stays the 72 px URL for older snapshots; iconTemplate lets the cache pick a size
      const icon = template?.replaceAll('{0}', '72');
      const desktop = new URL('/', origin);
      desktop.searchParams.set('launchApp', id);
      let direct: string | undefined;
      try { if (typeof config.url === 'string') direct = new URL(config.url, origin).href; } catch { /* Use DSM's launch ID */ }
      apps.set(id, { id, package: pkg, name: typeof name === 'string' && name ? name : pkg, icon, ...(template?.includes('{0}') ? { iconTemplate: template } : {}), ...(version ? { version } : {}), ...(rank.has(id) ? { dsmRank: rank.get(id) } : {}), url: direct && sameOrigin(direct, origin) ? direct : desktop.href, registered: false, preset: 'desktop', capabilities: [], ...(builtin ? { builtin: true } : {}), ...(visibility === 'runtime' ? { runtimeOnly: true } : {}) });
    }
  }
  return [...apps.values()].sort((a, b) => a.name.localeCompare(b.name));
}
