// test/lib/check.js - one suite's checks. A suite prints only what failed (all lines with --list), then
// "<n> checks" and "ALL OK" | "SOME FAILED" as its last line; test/run.js reads that and the exit code.
//   const t = require('../lib/check')();  t.check('what', cond, extra);  ...  process.exit(t.done() ? 0 : 1)
// (an Electron suite ends with app.exit(t.done() ? 0 : 1))
'use strict';

module.exports = function suite() {
  const list = process.argv.includes('--list');
  let ok = true;
  let n = 0;
  return {
    check(what, cond, extra = '') {
      n += 1;
      if (!cond || list) console.log(`${cond ? 'ok  ' : 'FAIL'} ${what}${extra ? `  (${extra})` : ''}`);
      if (!cond) ok = false;
      return !!cond;
    },
    fail(what, e) { n += 1; ok = false; console.log(`FAIL ${what}  (${(e && e.stack) || e})`); },
    get ok() { return ok; },
    done() {
      console.log(`${n} checks`);
      console.log(ok ? 'ALL OK' : 'SOME FAILED');
      return ok;
    },
  };
};
