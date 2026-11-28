// test/lib/extract.js - pull named top-level functions / consts out of a source file and run them with
// stand-ins: for main.js parts that cannot be required (requiring main.js starts the app). Brace counting that
// skips strings, template text and comments (a const statement's own comments must not hold an apostrophe).
//   const { api } = load(path.join(ROOT, 'src', 'main.js'), ['menuItems', ...], { cfg, toast, ... })
'use strict';
const fs = require('fs');
const path = require('path');

function blockEnd(src, open) {
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    const c = src[i];
    if (c === '/' && src[i + 1] === '/') { i = src.indexOf('\n', i); if (i < 0) return -1; continue; }
    if (c === '/' && src[i + 1] === '*') { i = src.indexOf('*/', i) + 1; continue; }
    if (c === '"' || c === "'") { for (i++; i < src.length && src[i] !== c; i++) if (src[i] === '\\') i++; continue; }
    if (c === '`') {
      for (i++; i < src.length && src[i] !== '`'; i++) {
        if (src[i] === '\\') { i++; continue; }
        if (src[i] === '$' && src[i + 1] === '{') { const e = blockEnd(src, i + 1); i = e; }
      }
      continue;
    }
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) return i; }
  }
  return -1;
}

// -> source text of `function name(...) {...}` or `const|let name = ...;` (one statement)
function piece(src, name) {
  let m = new RegExp(`\\n(async )?function ${name}\\(`).exec(src);
  if (m) {
    const open = src.indexOf('{', src.indexOf(')', m.index));
    return src.slice(m.index + 1, blockEnd(src, open) + 1);
  }
  m = new RegExp(`\\n(const|let) ${name} = `).exec(src);
  if (!m) throw new Error(`not found: ${name}`);
  let depth = 0;                       // to the statement's end: the first ';' at depth 0 after it
  for (let i = m.index + 1; i < src.length; i++) {
    const c = src[i];
    if ('([{'.includes(c)) depth++;
    else if (')]}'.includes(c)) depth--;
    else if (c === ';' && depth === 0) return src.slice(m.index + 1, i + 1);
    else if (c === '`' || c === '"' || c === "'") { for (i++; src[i] !== c; i++) if (src[i] === '\\') i++; }
  }
  throw new Error(`no end: ${name}`);
}

// module-level objects of main.js a piece may look at that a test need not stand in for: null = not there
const OPTIONAL = { autostart: null, noGame: null };

// run the pieces with stand-ins (an object of name -> value); -> { api: { name: fn | value }, body }
function load(file, names, standIns = {}) {
  const src = fs.readFileSync(file, 'utf8');
  const body = names.map((n) => piece(src, n)).join('\n\n');
  // where the file is, as it would see it (main.js: src/; ROOT the program, ASSETS its icons and sounds)
  const where = { __dirname: path.dirname(file), ROOT: path.join(path.dirname(file), '..'), ASSETS: path.join(path.dirname(file), '..', 'assets') };
  const all = { ...where, ...OPTIONAL, ...standIns };
  for (const n of names) if (n in where && !(n in standIns)) delete all[n];
  for (const n of names) if (n in OPTIONAL && !(n in standIns)) delete all[n];   // extracted itself: not also a parameter
  const keys = Object.keys(all);
  // eslint-disable-next-line no-new-func
  const fn = new Function(...keys, `${body}\nreturn { ${names.join(', ')} };`);
  return { api: fn(...keys.map((k) => all[k])), body };
}

module.exports = { piece, load };
