'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const media = require('../server/media');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lumen-media-'));
const touch = (n, body = '') => { fs.mkdirSync(path.dirname(path.join(dir, n)), { recursive: true }); fs.writeFileSync(path.join(dir, n), body); };
touch('Show S01E01.mkv'); touch('Show S01E02.mkv'); touch('Show S01E10.mkv');
touch('Show S01E01.en.srt', '1\r\n00:00:01,000 --> 00:00:02,500\r\nHello\r\n\r\n2\r\n00:00:03,000 --> 00:00:04,000\r\nThere\r\n');
touch('Show S01E01.fr.forced.srt', '1\n00:00:01,000 --> 00:00:02,000\nBonjour\n');
touch('Subs/Show S01E02.spa.srt', '1\n00:00:01,000 --> 00:00:02,000\nHola\n');
touch('notes.txt', 'x');
test.after(() => fs.rmSync(dir, { recursive: true, force: true }));

test('finds subtitles that belong to a video, with their language', async () => {
  const s = await media.subtitles(path.join(dir, 'Show S01E01.mkv'));
  assert.deepStrictEqual(s.map((x) => x.label).sort(), ['English', 'French (forced)']);
  const s2 = await media.subtitles(path.join(dir, 'Show S01E02.mkv'));
  assert.deepStrictEqual(s2.map((x) => x.label), ['Spanish']);
});

test('turns SRT subtitles into WebVTT', async () => {
  const v = await media.subtitleVtt(path.join(dir, 'Show S01E01.en.srt'));
  assert.match(v, /^WEBVTT\n\n/);
  assert.match(v, /00:00:01\.000 --> 00:00:02\.500\nHello/);
  assert.ok(!/\r/.test(v));
  await assert.rejects(media.subtitleVtt(path.join(dir, 'notes.txt')));
});

test('Up Next picks the following episode in name order', async () => {
  assert.strictEqual(path.basename((await media.nextVideo(path.join(dir, 'Show S01E01.mkv'))).path), 'Show S01E02.mkv');
  assert.strictEqual(path.basename((await media.nextVideo(path.join(dir, 'Show S01E02.mkv'))).path), 'Show S01E10.mkv');
  assert.strictEqual(await media.nextVideo(path.join(dir, 'Show S01E10.mkv')), null);
});
