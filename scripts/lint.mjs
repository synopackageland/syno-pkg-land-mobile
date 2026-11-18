import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
const roots = ['src', 'variants', 'modules', 'docker', 'tests', 'scripts', 'spec'];
let failures = 0;
function walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) { if (!['build', '.gradle'].includes(entry.name)) walk(path); continue; }
    if (!/\.(ts|tsx|mjs|kt|gradle|sh|json|md)$/.test(path)) continue;
    const text = readFileSync(path, 'utf8');
    if (/[\t ]+$/m.test(text) || !text.endsWith('\n')) { console.error(`Whitespace error: ${path}`); failures++; }
    if (/\.(ts|tsx|kt)$/.test(path) && /console\.(log|error|warn)\(|println\(/.test(text)) { console.error(`Page data logging is forbidden: ${path}`); failures++; }
  }
}
roots.forEach(walk);
if (failures) process.exit(1);
console.log('Source whitespace and logging checks passed');
