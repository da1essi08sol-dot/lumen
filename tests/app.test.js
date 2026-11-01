'use strict';
// The desktop app's own parts that don't need Electron: updates and bringing over older settings.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const createUpdater = require('../electron/updater');
const migrate = require('../electron/migrate');

test('updates: finds a newer Lumen in Downloads and ignores older ones', async () => {
  const dl = fs.mkdtempSync(path.join(os.tmpdir(), 'lumen-dl-'));
  for (const f of ['Lumen-Setup-1.9.0.exe', 'Lumen-2.0.0-win.zip', 'Lumen-Setup-2.1.0.exe', 'Lumen-Setup-2.0.5 (1).exe', 'Lumen-TV.zip', 'other.exe']) fs.writeFileSync(path.join(dl, f), '');
  const u = createUpdater({ app: { getPath: () => dl }, pkg: { version: '2.0.0' }, log: () => {}, broadcast: () => {} });
  const r = await u.check(true);
  assert.strictEqual(r.found, true);
  assert.strictEqual(r.version, '2.1.0');
  assert.strictEqual(r.source, 'downloads');
  const none = await createUpdater({ app: { getPath: () => dl }, pkg: { version: '3.0.0' }, log: () => {}, broadcast: () => {} }).check(true);
  assert.strictEqual(none.found, false);
  assert.strictEqual(u.cmp('2.10.0', '2.9.9'), 1);
  assert.strictEqual(u.cmp('2.0.0', '2.0.0'), 0);
  fs.rmSync(dl, { recursive: true, force: true });
});

test('settings from the older Lumen are copied over, without browser caches', () => {
  const old = fs.mkdtempSync(path.join(os.tmpdir(), 'lumen-old-'));
  const fresh = fs.mkdtempSync(path.join(os.tmpdir(), 'lumen-new-'));
  fs.mkdirSync(path.join(old, 'data', 'web-profile-brave', 'Default', 'Cache'), { recursive: true });
  fs.writeFileSync(path.join(old, 'data', 'store.json'), '{"folders":[]}');
  fs.writeFileSync(path.join(old, 'data', 'web-profile-brave', 'Default', 'Cookies'), 'c');
  fs.writeFileSync(path.join(old, 'data', 'web-profile-brave', 'Default', 'Cache', 'big'), 'x');
  const r = migrate.run({ DATA: fresh, oldRoot: old, log: () => {}, shell: null });
  assert.ok(r && r.from);
  assert.ok(fs.existsSync(path.join(fresh, 'store.json')));
  assert.ok(fs.existsSync(path.join(fresh, 'web-profile-brave', 'Default', 'Cookies')));
  assert.ok(!fs.existsSync(path.join(fresh, 'web-profile-brave', 'Default', 'Cache')));
  // a second start does nothing: Lumen already has its own settings
  assert.strictEqual(migrate.run({ DATA: fresh, oldRoot: old, log: () => {}, shell: null }), null);
  for (const d of [old, fresh]) fs.rmSync(d, { recursive: true, force: true });
});
