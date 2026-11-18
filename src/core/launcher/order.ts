import type { DiscoveredApp } from '../discovery/schema.ts';

/** Locale-aware name comparison for the App language; CJK and Latin names mix by the locale's collation */
export function nameCollator(language: string): (a: DiscoveredApp, b: DiscoveredApp) => number {
  let collator: Intl.Collator;
  try { collator = new Intl.Collator(language, { sensitivity: 'base', numeric: true }); } catch { collator = new Intl.Collator('en', { sensitivity: 'base', numeric: true }); }
  return (a, b) => collator.compare(a.name, b.name) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

/**
 * Launcher order. A custom order saved on this phone wins; otherwise DSM's main
 * menu order. Apps missing from the deciding list follow, alphabetically.
 */
export function orderApps(apps: DiscoveredApp[], language: string, custom?: string[]): DiscoveredApp[] {
  const byName = nameCollator(language);
  const position = custom?.length ? new Map(custom.map((id, index) => [id, index])) : undefined;
  const rank = (app: DiscoveredApp) => position ? position.get(app.id) : app.dsmRank;
  return [...apps].sort((a, b) => {
    const left = rank(a), right = rank(b);
    if (left !== undefined && right !== undefined) return left - right || byName(a, b);
    if (left !== undefined) return -1;
    if (right !== undefined) return 1;
    return byName(a, b);
  });
}

/** Move one id within its section; the result is a full custom order for every listed App */
export function moveApp(ordered: string[], section: string[], from: number, to: number): string[] {
  const next = [...section];
  const [moved] = next.splice(from, 1);
  next.splice(Math.max(0, Math.min(to, next.length)), 0, moved);
  const members = new Set(section);
  let cursor = 0;
  return ordered.map(id => members.has(id) ? next[cursor++] : id);
}

/** Keep the saved relative order of Apps that still exist; new Apps are placed by orderApps */
export function pruneOrder(custom: string[], apps: DiscoveredApp[]): string[] {
  const present = new Set(apps.map(app => app.id));
  return custom.filter(id => present.has(id));
}
