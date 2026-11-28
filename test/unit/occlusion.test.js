// Native window occlusion off, always (2026-11-28): with the ☰ menu open, its full-screen click catcher made Chromium
// take the overlay for covered, so a 배율 step resized it and nothing was drawn until the menu closed. Native
// occlusion cannot be made offscreen; this checks the switch: in main.js at the top level (every start, not only
// the demo), before the app is ready, one disable-features list holding CalculateNativeWinOcclusion.
'use strict';
const fs = require('fs');
const path = require('path');
const { SRC } = require('../lib/env');
const t = require('../lib/check')();

const src = fs.readFileSync(path.join(SRC, 'main.js'), 'utf8');
const lines = src.split(/\r?\n/);
const at = lines.findIndex((l) => /appendSwitch\('disable-features'/.test(l));
t.check('main.js sets disable-features', at >= 0);
t.check('...at the top level, for every start (not under an if: not only the demo)', at >= 0 && /^app\.commandLine\.appendSwitch\('disable-features', '[^']*'\);$/.test(lines[at]), lines[at]);
const value = at >= 0 ? (lines[at].match(/'disable-features', '([^']*)'/) || [])[1] || '' : '';
t.check('...with CalculateNativeWinOcclusion in its list', value.split(',').map((s) => s.trim()).includes('CalculateNativeWinOcclusion'), value);
// appendSwitch twice does not merge: one call in the whole program
const all = fs.readdirSync(SRC, { recursive: true }).filter((f) => f.endsWith('.js'))
  .flatMap((f) => (fs.readFileSync(path.join(SRC, f), 'utf8').match(/appendSwitch\('disable-features'/g) || []).map(() => f));
t.check('one disable-features switch in the program (a second one would replace the first)', all.length === 1, all.join(' '));
// before 'ready': above the app.whenReady() that starts everything
const ready = lines.findIndex((l) => /app\.whenReady\(\)/.test(l));
t.check('...set before the app is ready (above the start)', at >= 0 && ready > at, `switch line ${at + 1}, whenReady line ${ready + 1}`);

process.exit(t.done() ? 0 : 1);
