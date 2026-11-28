// test/lib/env.js - where things are, for every suite. Nothing about this machine is written here: the app is
// the folder above test/, pictures go to MOBINGI_TEST_OUT (default: the system temp folder).
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const PKG = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));

// a suite's own folder for pictures and scratch files (made on first use)
function out(name) {
  const d = path.join(process.env.MOBINGI_TEST_OUT || path.join(os.tmpdir(), `${PKG.name}-test`), name);
  fs.mkdirSync(d, { recursive: true });
  return d;
}

module.exports = { ROOT, PKG, out };
