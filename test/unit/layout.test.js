// The program's folders (2026-11-28): every file the code reaches by a path is where that path says - the
// requires, the pages and preloads, the icons and sounds, the links in the pages - and the shared copies stay
// shared: src/shared/ reaches nothing outside itself and is byte for byte the other overlay's (when that one sits
// beside this one, as in the workspace). The notice keeps its flat links: every version's update window lays a
// downloaded notice.html out beside its own notice.css / notice.js (updater.fetchNotice).
'use strict';
const fs = require('fs');
const path = require('path');
const { ROOT, SRC, SHARED, ASSETS, PKG } = require('../lib/env');
const t = require('../lib/check')();

const walk = (dir, keep) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
  const p = path.join(dir, e.name);
  if (e.isDirectory()) return ['node_modules', '.git', 'dist', 'out', '__pycache__', 'data', 'test'].includes(e.name) ? [] : walk(p, keep);
  return keep(e.name) ? [p] : [];
});
const rel = (p) => path.relative(ROOT, p).replace(/\\/g, '/');
const code = walk(SRC, (n) => n.endsWith('.js'));
const pages = walk(SRC, (n) => n.endsWith('.html'));
const styles = walk(SRC, (n) => n.endsWith('.css'));
const read = (p) => fs.readFileSync(p, 'utf8');

t.check('package.json "main" is src/main.js, and it is there', PKG.main === 'src/main.js' && fs.existsSync(path.join(ROOT, PKG.main)), PKG.main);
t.check('the folders: src/, src/shared/, assets/', [SRC, SHARED, ASSETS].every((d) => fs.statSync(d).isDirectory()));
t.check('nothing of the program left at the root (only package files, docs, the launcher)',
  fs.readdirSync(ROOT).filter((n) => /\.(js|html|css|ps1|py)$/.test(n)).length === 0, fs.readdirSync(ROOT).filter((n) => /\.(js|html|css|ps1|py)$/.test(n)).join(' '));

// requires
const missing = [];
for (const f of code) {
  for (const m of read(f).matchAll(/require\('(\.{1,2}\/[^']+)'\)/g)) {
    try { require.resolve(path.resolve(path.dirname(f), m[1])); } catch { missing.push(`${rel(f)}: ${m[1]}`); }
  }
}
t.check(`every relative require resolves (${code.length} files)`, missing.length === 0, missing.join(' | '));

// paths built in code from __dirname / ROOT / ASSETS with plain names
const bases = (f) => ({ __dirname: path.dirname(f), ROOT, ASSETS });
const built = [];
let nBuilt = 0;
for (const f of code) {
  for (const m of read(f).matchAll(/path\.join\((__dirname|ROOT|ASSETS)((?:,\s*'[^']*')+)\)/g)) {
    const parts = [...m[2].matchAll(/'([^']*)'/g)].map((x) => x[1]);
    if (parts.some((p) => ['.git', 'node_modules', '.scroll-widget-update', 'update-ok.json'].includes(p) || p.startsWith('.'))) {
      if (!(parts[0] === '..')) continue;                 // the developer's copy, the runtime, made at run time
    }
    nBuilt++;
    const p = path.join(bases(f)[m[1]], ...parts);
    if (!fs.existsSync(p)) built.push(`${rel(f)}: ${m[1]}/${parts.join('/')}`);
  }
}
t.check(`every path built from __dirname / ROOT / ASSETS exists (${nBuilt})`, nBuilt > 10 && built.length === 0, built.join(' | '));

// the pages' links and the styles' urls
const links = [];
let nLinks = 0;
for (const f of pages) {
  // (notice.html is shown laid out beside the shared notice.css / notice.js - consent.js viewDir)
  const base = f === path.join(SRC, 'notice.html') ? SHARED : path.dirname(f);
  for (const m of read(f).matchAll(/\s(?:href|src)="([^"#:]+)"/g)) {
    nLinks++;
    if (!fs.existsSync(path.resolve(base, m[1]))) links.push(`${rel(f)}: ${m[1]}`);
  }
}
for (const f of styles) {
  for (const m of read(f).matchAll(/url\("?([^")]+)"?\)/g)) {
    if (/^(data:|#)/.test(m[1])) continue;
    nLinks++;
    if (!fs.existsSync(path.resolve(path.dirname(f), m[1]))) links.push(`${rel(f)}: ${m[1]}`);
  }
}
// files a page script loads by a relative path (the sound; the pages are in src/)
for (const m of read(path.join(SRC, 'renderer.js')).matchAll(/'(\.\.\/assets\/[^']+)'/g)) {
  nLinks++;
  if (!fs.existsSync(path.resolve(SRC, m[1]))) links.push(`src/renderer.js: ${m[1]}`);
}
t.check(`every link in the pages and url in the styles is there (${nLinks})`, nLinks > 10 && links.length === 0, links.join(' | '));

// the shared copies: nothing outside themselves
const outside = [];
for (const f of walk(SHARED, () => true)) {
  const s = read(f);
  if (/require\('\.\.\//.test(s) || /path\.join\(__dirname,\s*'\.\.'/.test(s) || /(?:href|src)="\.\.\//.test(s)) outside.push(rel(f));
}
t.check('src/shared/ reaches nothing outside itself', outside.length === 0, outside.join(' '));
const notice = read(path.join(SRC, 'notice.html'));
t.check('notice.html links notice.css / notice.js flat (the layout every update window gives it)',
  /href="notice\.css"/.test(notice) && /src="notice\.js"/.test(notice) && !/(?:href|src)="[^"]*\//.test(notice));

// the same copies as the other overlay's
const other = { 'mangho-scanner': 'scroll-widget', 'mobingi-scroll-widget': 'mangho-scanner' }[PKG.name];
const otherShared = path.join(ROOT, '..', other, 'src', 'shared');
if (fs.existsSync(otherShared)) {
  const list = (d) => Object.fromEntries(walk(d, () => true).map((f) => [path.relative(d, f).replace(/\\/g, '/'), fs.readFileSync(f)]));
  const a = list(SHARED);
  const b = list(otherShared);
  const diff = [...new Set([...Object.keys(a), ...Object.keys(b)])].filter((n) => !a[n] || !b[n] || !a[n].equals(b[n]));
  t.check(`src/shared/ is byte for byte ${other}'s (${Object.keys(a).length} files)`, diff.length === 0, diff.join(' '));
} else {
  console.log(`     (src/shared/: no ${other} beside this program - not compared)`);
}

// .bat (cmd) / .ps1 (Windows PowerShell 5.1) are read in the system code page
const notAscii = walk(ROOT, (n) => /\.(bat|ps1)$/.test(n)).filter((f) => fs.readFileSync(f).some((b) => b > 127));
t.check('.bat / .ps1 files are ASCII', notAscii.length === 0, notAscii.map(rel).join(' '));

process.exit(t.done() ? 0 : 1);
