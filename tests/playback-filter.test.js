'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { isBlockedRequest } = require('../electron/request-filter');

test('blocks known advertising and tracking hosts', () => {
  assert.equal(isBlockedRequest('https://doubleclick.net/ad.js'), true);
  assert.equal(isBlockedRequest('https://sub.taboola.com/widget'), true);
  assert.equal(isBlockedRequest('https://www.criteo.com/serve'), true);
});

test('does not block normal streaming and Lumen resources', () => {
  assert.equal(isBlockedRequest('https://www.bbc.co.uk/iplayer'), false);
  assert.equal(isBlockedRequest('https://cdn.example-stream.com/video.m3u8'), false);
  assert.equal(isBlockedRequest('http://localhost:8787/tv/'), false);
});

test('matches host boundaries rather than arbitrary substrings', () => {
  assert.equal(isBlockedRequest('https://notdoubleclick.net/'), false);
  assert.equal(isBlockedRequest('https://doubleclick.net.evil.example/'), false);
});

test('ignores malformed URLs safely', () => {
  assert.equal(isBlockedRequest('not a URL'), false);
});
