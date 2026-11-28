// fade.js (2026-11-28): a size change waits for the page to dim (MS), the steps asked meanwhile join the one swap
// (in order), then the page comes back; and main.js sends 배율 / 글자 steps and 잠금 때 작게 / 매우 작게 through it
// (the width and height bars do not).
'use strict';
const fs = require('fs');
const path = require('path');
const { SHARED, SRC } = require('../lib/env');
const t = require('../lib/check')();
const F = require(path.join(SHARED, 'fade.js'));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  t.check('the floor: the overlay never dims to nothing', F.FLOOR >= 0.25 && F.FLOOR < 1 && F.MS >= 80 && F.MS <= 200, JSON.stringify({ MS: F.MS, FLOOR: F.FLOOR }));
  const sent = [];
  const done = [];
  const f = F.create({ toPage: (m) => sent.push({ ...m, at: done.length }) });
  f.step(() => done.push('a'));
  t.check('a step: the page is told to dim first; nothing swapped yet', sent.length === 1 && sent[0].on === true && sent[0].floor === F.FLOOR && done.length === 0 && f.busy());
  await wait(F.MS / 2);
  f.step(() => done.push('b'));
  f.step(() => done.push('c'));
  t.check('...steps meanwhile: no second dimming', sent.length === 1 && done.length === 0);
  await wait(F.MS);
  t.check('...after it: every step applied once, in order, then the page comes back', done.join() === 'a,b,c' && sent.length === 2 && sent[1].on === false && sent[1].at === 3 && !f.busy(),
    JSON.stringify({ done, sent }));
  f.step(() => { throw new Error('x'); });
  f.step(() => done.push('d'));
  await wait(F.MS + 40);
  t.check('a step that throws does not stop the others, and the page still comes back', done[done.length - 1] === 'd' && sent[sent.length - 1].on === false);

  // main.js: what goes through it
  const main = fs.readFileSync(path.join(SRC, 'main.js'), 'utf8');
  t.check('main.js: 배율 steps eased', /case 'scale': saveCfg\(\{ scale: [^;]+\); fade\.step\(\(\) => place\(\)\);/.test(main));
  t.check('main.js: 글자 steps eased', /case 'text': saveCfg\(\{ text: [^;]+\); fade\.step\(\(\) => toPage\(windowState\(\)\)\);/.test(main));
  t.check('main.js: 잠금 때 작게 / 매우 작게 in and out eased', /onState: \(\) => \{ if \(cfg\.lockShrink\) fade\.step\(\(\) => \{ place\(\); toPage\(windowState\(\)\); \}\); \}/.test(main));
  t.check('main.js: the width / height bars are not (they follow the pointer)', !/fade\.step\([^)]*width|height-drag[^\n]*fade\.step/.test(main));
  process.exit(t.done() ? 0 : 1);
})().catch((e) => { t.fail('exception', e); process.exit(1); });
