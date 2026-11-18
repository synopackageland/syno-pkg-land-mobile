// Browser build of the launcher, from the same source as the Android App.
// WEB_BASE_URL (or --base) is the path the hosting package serves it under. Without one the build
// is relative: it works from any directory, such as a package's content-hashed UI folder.
// Output: dist/web, with build.json listing the source commit and every file's SHA-256,
// so a host that vendors the build can check it is unchanged.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { extname } from 'node:path';
import { join, relative } from 'node:path';

const arg = process.argv.indexOf('--base');
const given = (arg > 0 ? process.argv[arg + 1] : process.env.WEB_BASE_URL || '').replace(/\/+$/, '');
if (given && (!/^\/[A-Za-z0-9._~\/-]+$/.test(given) || given.includes('..'))) {
  console.error('WEB_BASE_URL (or --base) must be the absolute path the build is served under, such as /apps/land');
  process.exit(2);
}
// A relative build is exported under a marker path, which then becomes ./ in every page and bundle
const RELATIVE = '/__spl_relative_base__';
const base = given || RELATIVE;
const root = new URL('..', import.meta.url).pathname;
const out = join(root, 'dist/web');
rmSync(out, { recursive: true, force: true });
execFileSync('npx', ['expo', 'export', '--platform', 'web', '--output-dir', out, '--clear'], { cwd: root, stdio: 'inherit', env: { ...process.env, WEB_BASE_URL: base, NODE_ENV: 'production' } });
rmSync(join(out, 'metadata.json'), { force: true });
const files = [];
const walk = dir => { for (const name of readdirSync(dir).sort()) { const path = join(dir, name); if (statSync(path).isDirectory()) walk(path); else files.push(path); } };
walk(out);
if (!given) for (const path of files.filter(path => ['.html', '.js', '.css', '.json', '.webmanifest'].includes(extname(path)))) {
  const text = readFileSync(path, 'utf8');
  if (!text.includes(RELATIVE)) continue;
  const relativeText = text.split(`${RELATIVE}/`).join('./');
  if (relativeText.includes(RELATIVE)) { console.error(`${relative(out, path)} uses the base path in a way a relative build cannot keep`); process.exit(1); }
  writeFileSync(path, relativeText);
}
const sha = path => createHash('sha256').update(readFileSync(path)).digest('hex');
let commit = '';
try { commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root }).toString().trim(); } catch { /* Not a checkout */ }
const dirty = (() => { try { return execFileSync('git', ['status', '--porcelain'], { cwd: root }).toString().trim() !== ''; } catch { return true; } })();
const { version } = JSON.parse(readFileSync(join(root, 'variants/land/config.json'), 'utf8'));
const build = { schema: 1, version, commit, dirty, base: given ? `${given}/` : './', files: Object.fromEntries(files.map(path => [relative(out, path), sha(path)])) };
writeFileSync(join(out, 'build.json'), `${JSON.stringify(build, null, 2)}\n`);
console.log(`Web build ${version} for ${given ? `${given}/` : 'any path (relative)'}: ${files.length} files`);
