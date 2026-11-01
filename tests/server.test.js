'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { startServer, otherAddress } = require('./helpers');
const { onHomeNetwork } = require('../server/netcheck');

let S;
test.before(async () => { S = await startServer(); });
test.after(() => S?.stop());

test('the TV page and its settings load on the TV computer', async () => {
  const page = await S.api('/tv/');
  assert.strictEqual(page.status, 200);
  assert.match(page.text, /theme-tv\.css/);
  const cfg = await S.api('/api/config');
  assert.strictEqual(cfg.status, 200);
  assert.ok(cfg.json.version);
});

test('new installs start with an empty library', async () => {
  const r = await S.api('/api/folders');
  assert.strictEqual(r.status, 200);
  assert.deepStrictEqual(r.json.folders, []);
});

test('pairing codes are made on the TV computer only, and wrong codes are refused', async () => {
  const start = await S.api('/api/pair/start', { method: 'POST' });
  assert.strictEqual(start.status, 200);
  const wrong = await S.api('/api/pair', { method: 'POST', body: { code: '000000', name: 'Test' } });
  assert.ok([403, 429].includes(wrong.status));
});

test('the sleep timer can be set, read and turned off', async () => {
  let r = await S.api('/api/sleep', { method: 'POST', body: { minutes: 30 } });
  assert.strictEqual(r.status, 200);
  assert.ok(r.json.sleep.left > 1790 && r.json.sleep.left <= 1800);
  r = await S.api('/api/sleep');
  assert.ok(r.json.sleep);
  r = await S.api('/api/sleep', { method: 'POST', body: { minutes: 0 } });
  assert.strictEqual(r.json.sleep, null);
  r = await S.api('/api/sleep', { method: 'POST', body: { minutes: 9999 } }); // nonsense is ignored
  assert.strictEqual(r.json.sleep, null);
});

test('each film remembers the Watch website you used last', async () => {
  const set = await S.api('/api/settings', { method: 'POST', body: { watchLinks: [{ id: 'a', pattern: 'one.example/', name: 'One' }, { id: 'b', pattern: 'two.example/', name: 'Two' }] } });
  assert.strictEqual(set.status, 200);
  let r = await S.api('/api/film-site?type=movie&id=550');
  assert.strictEqual(r.json.linkId, null);
  const open = await S.api('/api/open', { method: 'POST', body: { watchLink: true, linkId: 'b', title: 'Fight Club', year: 1999, item: { type: 'movie', id: 550 } } });
  assert.strictEqual(open.status, 200);
  r = await S.api('/api/film-site?type=movie&id=550');
  assert.strictEqual(r.json.linkId, 'b');
  await S.api('/api/close-external', { method: 'POST' });
});

test('devices outside the home network are refused', async (t) => {
  const addr = otherAddress();
  if (!addr) return t.skip('no network address to test with');
  const r = await S.api('/api/config', { host: addr });
  if (onHomeNetwork(addr)) assert.strictEqual(r.status, 401); // a home device still needs pairing
  else assert.strictEqual(r.status, 403);
});

test('home-network check', () => {
  for (const a of ['127.0.0.1', '192.168.1.20', '10.0.0.4', '172.20.1.1', '::ffff:192.168.0.9', 'fe80::1', 'fd12::5', '::1']) assert.ok(onHomeNetwork(a), a);
  for (const a of ['8.8.8.8', '81.2.69.160', '172.32.0.1', '2001:4860:4860::8888']) assert.ok(!onHomeNetwork(a), a);
});

test('the font style can be chosen, and anything unknown is ignored', async () => {
  let c = await S.api('/api/config');
  assert.strictEqual(c.json.font, 'classic');
  await S.api('/api/settings', { method: 'POST', body: { font: 'serif' } });
  c = await S.api('/api/config');
  assert.strictEqual(c.json.font, 'serif');
  await S.api('/api/settings', { method: 'POST', body: { font: 'comic-sans' } });
  c = await S.api('/api/config');
  assert.strictEqual(c.json.font, 'serif');
});
