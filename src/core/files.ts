import { Directory, File, Paths } from 'expo-file-system';

/** Small named text files in one folder of the App's documents; the web build keeps them in localStorage */
export type TextFiles = {
  read(name: string): string | null;
  write(name: string, text: string): void;
  remove(name: string): void;
  list(): string[];
};
export function textFiles(folder?: string): TextFiles {
  const dir = () => folder ? new Directory(Paths.document, folder) : new Directory(Paths.document);
  const file = (name: string) => new File(dir(), name);
  return {
    read(name) { const f = file(name); return f.exists ? f.textSync() : null; },
    write(name, text) {
      const d = dir(); if (!d.exists) d.create({ intermediates: true });
      const f = file(name); if (!f.exists) f.create(); f.write(text);
    },
    remove(name) { const f = file(name); if (f.exists) f.delete(); },
    list() { const d = dir(); return d.exists ? d.list().filter(item => item instanceof File).map(item => item.name) : []; },
  };
}
