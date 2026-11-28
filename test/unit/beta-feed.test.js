// 베타 받기 in the updater (2026-11-28), on a stand-in network: the release feeds are this app's real published
// latest.json files with their real signatures (test/fixtures/feeds/<version>/), so every check runs as it does
// for a user. The API's release list is made up per case (it is only a pointer). Off: exactly the stable feed,
// pre-releases never seen. On: the newest pre-release if newer; the list failing -> the stable feed; the beta's
// feed failing its checks -> an error, never a quiet fallback.
'use strict';
const fs = require('fs');
const path = require('path');
const { ROOT, SHARED, PKG } = require('../lib/env');
const t = require('../lib/check')();

const APP = PKG.name === 'mangho-scanner' ? 'mangho-scanner' : 'scroll-widget';
const FX = path.join(ROOT, 'test', 'fixtures', 'feeds');
const [OLD, NEW] = fs.readdirSync(FX).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
const feed = (v, f) => fs.readFileSync(path.join(FX, v, f));
const U = require(path.join(SHARED, 'updater.js'));

const GH = `https://github.com/mobingi-widgets/${APP}/releases/`;
const API = `https://api.github.com/repos/mobingi-widgets/${APP}/releases?per_page=20`;
let routes = {};
let asked = [];
globalThis.fetch = async (u) => {
  const url = String(u);
  asked.push(url);
  const r = routes[url];
  if (r === undefined) return new Response('not found', { status: 404 });
  if (typeof r === 'number') return new Response('no', { status: r });
  return new Response(r, { status: 200 });
};
const rel = (tag, prerelease, extra = {}) => ({ tag_name: tag, prerelease, draft: false, assets: [{ name: 'latest.json' }, { name: 'x.zip' }], ...extra });
const stable = (v) => ({ [`${GH}latest/download/latest.json`]: feed(v, 'latest.json'), [`${GH}latest/download/latest.json.minisig`]: feed(v, 'latest.json.minisig') });
const tagged = (tag, v, sigOf = v) => ({ [`${GH}download/${tag}/latest.json`]: feed(v, 'latest.json'), [`${GH}download/${tag}/latest.json.minisig`]: feed(sigOf, 'latest.json.minisig') });
const run = async (setup, opts) => { routes = setup; asked = []; try { return { r: await U.check({ repo: APP, app: APP, version: OLD, ...opts }) }; } catch (e) { return { e }; } };

(async () => {
  t.check(`(the fixtures: this app's published feeds ${OLD} and ${NEW})`, !!OLD && !!NEW && OLD !== NEW);
  // off: the stable feed only - a newer pre-release in the list is never seen, the list never asked
  let x = await run({ ...stable(OLD), ...tagged(`v${NEW}`, NEW), [API]: JSON.stringify([rel(`v${NEW}`, true)]) }, {});
  t.check('베타 off: the stable feed - up to date, the pre-release not seen, the release list never asked',
    x.r && x.r.available === false && !asked.some((u) => u.startsWith('https://api.github.com')), JSON.stringify(x.r || String(x.e)));
  // on: the newest pre-release, verified like the stable feed (the real signature)
  x = await run({ ...stable(OLD), ...tagged(`v${NEW}`, NEW), [API]: JSON.stringify([rel(`v${OLD}`, false), rel(`v${NEW}`, true)]) }, { beta: true });
  t.check(`베타 on: the newer pre-release v${NEW} offered, marked beta, from its own signed feed`,
    x.r && x.r.available && x.r.version === NEW && x.r.beta === true && x.r.assetUrl === `${GH}download/v${NEW}/${APP}-${NEW}-app.zip`, JSON.stringify(x.r || String(x.e)));
  // on, the list fails (rate limit, network): the stable feed, quietly
  x = await run({ ...stable(OLD), [API]: 403 }, { beta: true });
  t.check('베타 on, the release list refused (403): the stable feed, no error', x.r && x.r.available === false && !x.r.beta, JSON.stringify(x.r || String(x.e)));
  x = await run({ ...stable(OLD), [API]: 'not json' }, { beta: true });
  t.check('...a list that is not JSON: the stable feed', x.r && x.r.available === false);
  // on, the newest release is a stable one: the stable feed (nothing beta about it)
  x = await run({ ...stable(NEW), [API]: JSON.stringify([rel(`v${NEW}`, false), rel(`v${OLD}`, false)]) }, { beta: true });
  t.check('베타 on, the newest is a stable release: through the stable feed, not marked beta', x.r && x.r.available && x.r.version === NEW && !x.r.beta
    && !asked.includes(`${GH}download/v${NEW}/latest.json`), JSON.stringify(x.r || String(x.e)));
  // on, the pre-release's feed fails its checks: rejected, not a quiet fallback
  x = await run({ ...stable(OLD), ...tagged(`v${NEW}`, NEW, OLD), [API]: JSON.stringify([rel(`v${NEW}`, true)]) }, { beta: true });
  t.check('베타 on, the pre-release\'s signature does not match: rejected (an error, not the stable feed)', !!x.e, String(x.e && x.e.message));
  // the tag is only a pointer: its feed must say the same version
  x = await run({ ...stable(OLD), ...tagged('v9.9.9', NEW), [API]: JSON.stringify([rel('v9.9.9', true)]) }, { beta: true });
  t.check('a tag whose signed feed is another version: rejected', !!x.e && /태그/.test(x.e.message), String(x.e && x.e.message));
  // the running version is already the newest pre-release: nothing (the stable feed says up to date)
  routes = { ...stable(OLD), ...tagged(`v${NEW}`, NEW), [API]: JSON.stringify([rel(`v${NEW}`, true)]) };
  asked = [];
  const same = await U.check({ repo: APP, app: APP, version: NEW, beta: true });
  t.check('running the newest pre-release already: nothing offered', same.available === false, JSON.stringify(same));

  // the pointer's choice
  const p = U.pickBeta([rel('v1.2.3', false), rel('v1.10.0', true), rel('v1.9.9', false), rel('v2.0.0', true, { draft: true }),
    rel('v3.0.0-beta', true), { tag_name: 'v4.0.0', prerelease: true, draft: false, assets: [{ name: 'other.zip' }] }, null, 'x']);
  t.check('pickBeta: the highest vX.Y.Z with a latest.json; drafts, other tags and releases without a feed left out', p && p.version === '1.10.0' && p.prerelease === true, JSON.stringify(p));
  t.check('pickBeta: nothing usable -> null', U.pickBeta([]) === null && U.pickBeta(null) === null && U.pickBeta({}) === null);
  process.exit(t.done() ? 0 : 1);
})().catch((e) => { t.fail('exception', e); process.exit(1); });
