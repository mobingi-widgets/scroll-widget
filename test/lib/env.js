// test/lib/env.js - where things are, for every suite. Nothing about this machine is written here: the app is
// the folder above test/, pictures go to MOBINGI_TEST_OUT (default: the system temp folder).
// The app's folders (2026-11-28): src/ (main.js, the program's own pages and code), src/shared/ (the copies every
// overlay shares, byte for byte), assets/ (icons, sounds); package.json, docs/, scripts/, test/ at the root.
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const PKG = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const SRC = path.join(ROOT, 'src');
const SHARED = path.join(SRC, 'shared');
const ASSETS = path.join(ROOT, 'assets');
// a program file by its name, wherever it lives (src/shared/, src/, assets/, the root)
function file(name) {
  for (const d of [SHARED, SRC, ASSETS, ROOT]) if (fs.existsSync(path.join(d, name))) return path.join(d, name);
  throw new Error(`no such program file: ${name}`);
}

// a suite's own folder for pictures and scratch files (made on first use)
function out(name) {
  const d = path.join(process.env.MOBINGI_TEST_OUT || path.join(os.tmpdir(), `${PKG.name}-test`), name);
  fs.mkdirSync(d, { recursive: true });
  return d;
}

module.exports = { ROOT, PKG, SRC, SHARED, ASSETS, file, out };
