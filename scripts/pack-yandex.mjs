// Builds the Yandex Games archive and checks the platform's archive rules:
// index.html in the root, Latin file names without spaces, under 100 MB unpacked,
// the SDK referenced as /sdk.js, no requests to third-party domains.
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const dir = path.resolve('dist-yandex');
const zip = path.resolve('dist-yandex.zip');
execSync('npx vite build --mode yandex', { stdio: 'inherit' });

const files = [];
const walk = d => { for (const f of fs.readdirSync(d)) { const p = path.join(d, f); fs.statSync(p).isDirectory() ? walk(p) : files.push(p); } };
walk(dir);
const problems = [];
if (!fs.existsSync(path.join(dir, 'index.html'))) problems.push('index.html is not in the archive root');
let size = 0;
for (const f of files) {
  const rel = path.relative(dir, f);
  size += fs.statSync(f).size;
  if (!/^[A-Za-z0-9._\-/]+$/.test(rel)) problems.push(`bad file name: ${rel}`);
  if (/\.(html|js|css)$/.test(f)) {
    const txt = fs.readFileSync(f, 'utf8');
    // any absolute URL the game would load at runtime (license texts and comments aside)
    for (const m of txt.matchAll(/(?:src|href)\s*=\s*["'](https?:)?\/\/[^"']+/g)) problems.push(`external resource in ${rel}: ${m[0]}`);
    for (const m of txt.matchAll(/(fetch|import)\(\s*["']https?:\/\/[^"']+/g)) problems.push(`external request in ${rel}: ${m[0]}`);
  }
}
if (size > 100 * 1024 * 1024) problems.push(`too big: ${(size / 1048576).toFixed(1)} MB`);
if (!fs.readFileSync(path.join(dir, 'index.html'), 'utf8').includes('src="/sdk.js"')) problems.push('SDK script /sdk.js missing');
if (problems.length) { console.error('Archive check FAILED:\n' + problems.join('\n')); process.exit(1); }
fs.rmSync(zip, { force: true });
execSync(`cd "${dir}" && zip -qr -X "${zip}" .`);
console.log(`OK: ${files.length} files, ${(size / 1024).toFixed(0)} KB unpacked -> ${path.basename(zip)} (${(fs.statSync(zip).size / 1024).toFixed(0)} KB)`);
