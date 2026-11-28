// test/lib/page-app - how test/run.js starts a page suite: `electron test/lib/page-app <suite.page.js>`.
// First a settings folder of its own for the run: Electron's default profile keeps a zoom level per local page
// (a page zoomed once in any plain `electron <file>` run stays zoomed in the next), which moves every coordinate
// a test reads or clicks - and nothing a test does is kept. app.setPath must run in the main script, before
// 'ready' (a NODE_OPTIONS preload is too early to reach the app). Then the suite itself.
'use strict';
const { app } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mobingi-test-profile-'));
app.setPath('userData', dir);
process.on('exit', () => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* still in use: the temp folder keeps it */ } });

const suite = process.argv.find((a) => a.endsWith('.page.js'));
if (!suite) { console.log('FAIL no suite given'); app.exit(1); } else require(path.resolve(suite));
