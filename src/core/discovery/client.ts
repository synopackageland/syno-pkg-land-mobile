import type { NasProfile } from '../config.ts';
import { filterApps } from './filter.ts';
import { record, registeredTarget, type DiscoveredApp } from './schema.ts';
import { dsmLang } from '../status/model.ts';

export type JsonResponse = { status: number; body: string };
/** language: an Accept-Language value; DSM localizes package strings by it, not by its lang parameter */
export type ReadJson = (url: string, origin: string, language?: string) => Promise<JsonResponse>;
/** The Accept-Language DSM maps to its own language code */
export function acceptLanguage(dsm: string): string {
  return dsm === 'cht' ? 'zh-TW' : dsm === 'chs' ? 'zh-CN' : 'en-US';
}
export class DiscoveryError extends Error {
  code: number | string;
  constructor(code: number | string) { super('Discovery failed'); this.code = code; }
}
export function json(response: JsonResponse): unknown {
  if (response.status !== 200) throw new DiscoveryError(`HTTP_${response.status}`);
  try { return JSON.parse(response.body); } catch { throw new DiscoveryError('INVALID_JSON'); }
}
export function apiData(response: JsonResponse): Record<string, unknown> {
  const value = record(json(response));
  if (value.success !== true) throw new DiscoveryError(Number(record(value.error).code) || 'API_ERROR');
  return record(value.data);
}
/** The second request races a slow first request; neither is aborted */
export function hedge<T>(request: () => Promise<T>, delay = 4000): Promise<T> {
  return new Promise((resolve, reject) => {
    let done = false;
    const complete = (value: T) => { if (!done) { done = true; clearTimeout(timer); resolve(value); } };
    const fail = (error: unknown) => { if (!done) { done = true; clearTimeout(timer); reject(error); } };
    const timer = setTimeout(() => { if (!done) request().then(complete, fail); }, delay);
    request().then(complete, fail);
  });
}
/** The JSON object DSM assigns in a getjs script (`name={...};`), matched brace by brace */
export function scriptObject(body: string, variable: string): Record<string, unknown> {
  const start = body.indexOf(`${variable}=`) + variable.length + 1;
  if (start <= variable.length || body[start] !== '{') throw new DiscoveryError('INVALID_SCRIPT');
  let depth = 0, quoted = false;
  for (let i = start; i < body.length; i++) {
    const c = body[i];
    if (quoted) { if (c === '\\') i++; else if (c === '"') quoted = false; continue; }
    if (c === '"') quoted = true;
    else if (c === '{') depth++;
    else if (c === '}' && --depth === 0) {
      try { return record(JSON.parse(body.slice(start, i + 1))); } catch { break; }
    }
  }
  throw new DiscoveryError('INVALID_SCRIPT');
}
export type Discovery = (profile: NasProfile, publish: (apps: DiscoveredApp[]) => void) => Promise<DiscoveredApp[]>;
/** language: the App's current locale, read again on every refresh so names follow the phone */
export function createDiscovery(read: ReadJson, locale: string | (() => string) = 'en'): Discovery {
  return async (profile, publish) => {
    const language = typeof locale === 'function' ? locale() : locale;
    const wanted = dsmLang(language), accept = acceptLanguage(wanted);
    const get = (path: string) => hedge(() => read(new URL(path, profile.origin).href, profile.origin, accept));
    const token = record(json(await get('/webman/login.cgi?enable_syno_token=yes')));
    if (token.success !== true || typeof token.SynoToken !== 'string' || !token.SynoToken) throw new DiscoveryError('SIGN_IN_REQUIRED');
    const api = (name: string, method: string, version: string, extra: Record<string, string> = {}) => {
      const query = new URLSearchParams({ api: name, method, version, ...extra, SynoToken: token.SynoToken as string });
      return get(`/webapi/entry.cgi?${query}`).then(apiData);
    };
    const script = async (name: string, extra: Record<string, string>, variable: string) => {
      const query = new URLSearchParams({ api: name, method: 'getjs', version: '1', ...extra, SynoToken: token.SynoToken as string });
      const response = await get(`/webapi/entry.cgi?${query}`);
      if (response.status !== 200) throw new DiscoveryError(`HTTP_${response.status}`);
      return scriptObject(response.body, variable);
    };
    // Use the desktop's own session/service and UI sources, plus its package map.
    const [service, packages] = await Promise.all([
      api('SYNO.Core.Desktop.Initdata', 'get_user_service', '1'),
      api('SYNO.Core.Package', 'list', '2', { additional: JSON.stringify(['status', 'dsm_apps']), ignore_hidden: 'false' }),
    ]);
    // Names follow the App's language: then the account's, then English
    const languages = [...new Set([wanted, String(record(service.Session).lang || 'enu'), 'enu'])];
    const first = async <T,>(load: (lang: string) => Promise<T>) => {
      let error: unknown;
      for (const lang of languages) { try { return await load(lang); } catch (e) { error = e; } }
      throw error;
    };
    const [ui, defs, strings] = await Promise.all([
      first(lang => api('SYNO.Core.Desktop.Initdata', 'get_ui_config', '1', { lang })),
      // DSM's hardware flags (_D) and global UI strings (_T): optional, a failed read keeps the fallbacks
      script('SYNO.Core.Desktop.Defs', {}, '_SYNOINFODEF').catch(() => undefined),
      first(lang => script('SYNO.Core.Desktop.UIString', { lang }, 'SYNO_WebManager_Strings')).catch(() => undefined),
    ]);
    const data = { ...ui, ...service, ...(defs ? { Defs: defs } : {}), ...(strings ? { UIStrings: strings } : {}) };
    if (!Array.isArray(packages.packages)) throw new DiscoveryError('INVALID_PACKAGES');
    let apps: DiscoveredApp[];
    try { apps = filterApps({ ...data, Packages: packages.packages }, profile.origin); } catch { throw new DiscoveryError('SIGN_IN_REQUIRED'); }
    publish(apps);
    // Registration entries are canonical, so no AppPortal admin API or defaultAlias is needed
    const probes = new Map<string, Promise<unknown>>();
    // DSM's built-in Apps have no package folder to register a mobile layout in
    for (const app of apps) if (!app.builtin && !probes.has(app.package)) probes.set(app.package, get(`/webman/3rdparty/${encodeURIComponent(app.package)}/app/mobile.json?v=${Date.now()}`).then(json));
    await Promise.all(apps.map(async (app, index) => {
      if (app.builtin) return;
      try {
        const value = await probes.get(app.package);
        apps[index] = registeredTarget(value, app, profile.origin, language) || { ...app, reason: 'unregistered' };
      } catch { apps[index] = { ...app, reason: 'unreadable' }; }
      publish([...apps]);
    }));
    return apps;
  };
}
