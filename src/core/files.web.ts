import type { TextFiles } from './files';

/** The browser build: one localStorage key per file, under this App's prefix */
export function textFiles(folder?: string): TextFiles {
  const prefix = `spl:${folder ? `${folder}/` : ''}`;
  const store = () => { try { return window.localStorage; } catch { return undefined; } };
  return {
    read(name) { return store()?.getItem(prefix + name) ?? null; },
    write(name, text) { store()?.setItem(prefix + name, text); },
    remove(name) { store()?.removeItem(prefix + name); },
    list() {
      const s = store(), names: string[] = [];
      if (!s) return names;
      for (let i = 0; i < s.length; i++) {
        const key = s.key(i);
        if (key?.startsWith(prefix) && !key.slice(prefix.length).includes('/')) names.push(key.slice(prefix.length));
      }
      return names;
    },
  };
}
