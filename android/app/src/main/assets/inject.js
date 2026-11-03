// Runs in every page and frame the Lumen Browser player opens.
// No pop-ups; once the film's video appears, start it, fill the screen with it and report how far through it is.
(function () {
  if (window.__lumenPlayer) return; window.__lumenPlayer = true;
  var RESUME = __RESUME__;
  var noop = function () { return null; };
  try { window.open = noop; } catch (e) {}
  var started = false, resumed = false, filled = null;
  var area = function (el) { var r = el.getBoundingClientRect(); return r.width * r.height; };
  var FILL = 'position:fixed!important;left:0!important;top:0!important;right:0!important;bottom:0!important;width:100vw!important;height:100vh!important;max-width:none!important;max-height:none!important;margin:0!important;transform:none!important;z-index:2147483647!important;background:#000!important;border:0!important;';
  function fill(el) {
    if (filled === el) return;
    filled = el;
    el.setAttribute('style', (el.getAttribute('style') || '') + ';' + FILL + (el.tagName === 'VIDEO' ? 'object-fit:contain!important;' : ''));
    document.documentElement.style.setProperty('overflow', 'hidden', 'important');
    if (document.body) document.body.style.setProperty('overflow', 'hidden', 'important');
  }
  function tick() {
    var vids = Array.prototype.slice.call(document.querySelectorAll('video')).filter(function (v) { return v.currentSrc || v.src || v.readyState > 0; });
    vids.sort(function (a, b) { return area(b) - area(a); });
    var v = vids[0];
    if (v && (area(v) > 20000 || v.duration > 300)) {
      if (!started && v.paused) {
        var p = v.play();
        if (p && p.catch) p.catch(function () { v.muted = true; var q = v.play(); if (q && q.then) q.then(function () { setTimeout(function () { v.muted = false; }, 400); }).catch(function () {}); });
      }
      if (!v.paused) started = true;
      if (!resumed && RESUME > 30 && v.duration > RESUME + 60) { try { v.currentTime = RESUME; } catch (e) {} resumed = true; }
      v.controls = true;
      fill(v);
      if (window.LumenPlayer && v.duration > 0 && isFinite(v.duration)) window.LumenPlayer.progress(v.currentTime, v.duration);
      return;
    }
    // in the page itself, a film often plays inside an embedded player: make that frame fill the screen
    if (window === window.top) {
      var frames = Array.prototype.slice.call(document.querySelectorAll('iframe')).filter(function (f) { return area(f) > 60000; });
      frames.sort(function (a, b) { return area(b) - area(a); });
      if (frames[0] && (frames[0].allowFullscreen || /embed|player|video|stream/i.test(frames[0].src + ' ' + frames[0].className + ' ' + frames[0].id))) {
        frames[0].setAttribute('allow', 'autoplay; fullscreen; encrypted-media');
        fill(frames[0]);
      }
    }
  }
  setInterval(tick, 1000);
  document.addEventListener('DOMContentLoaded', tick);
})();
