'use strict';

const BLOCKED_HOSTS = new Set([
  'doubleclick.net', 'googlesyndication.com', 'googleadservices.com',
  'adservice.google.com', 'adnxs.com', 'adsrvr.org', 'taboola.com',
  'outbrain.com', 'popads.net', 'popcash.net', 'exoclick.com',
  'trafficjunky.net', 'propellerads.com', 'zedo.com', 'adsterra.com',
  'ad-maven.com', 'pushground.com', 'mgid.com', 'criteo.com',
  'scorecardresearch.com', 'serving-sys.com', 'quantserve.com',
  'casalemedia.com', 'rubiconproject.com', 'pubmatic.com',
  'openx.net', 'sharethrough.com', 'lijit.com',
  'smartadserver.com', 'adsafeprotected.com', 'moatads.com'
]);

function isBlockedRequest(raw) {
  let host;
  try { host = new URL(raw).hostname.toLowerCase().replace(/^www\./, ''); }
  catch { return false; }
  for (const domain of BLOCKED_HOSTS) if (host === domain || host.endsWith('.' + domain)) return true;
  return false;
}

module.exports = { BLOCKED_HOSTS, isBlockedRequest };
