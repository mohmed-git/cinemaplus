/**
 * Session behavior tracker.
 * Records pages visited + session duration in sessionStorage (per-tab, cleared
 * when the tab closes) and sends a single summary via navigator.sendBeacon
 * when the visitor actually leaves the SITE (not just navigates internally).
 *
 * Include on every page, e.g. in your main Layout:
 *   <script src="/session-tracker.js" defer></script>
 */
(function () {
  var PAGES_KEY = 'stt_pages';
  var START_KEY = 'stt_start';
  var NAV_FLAG = 'stt_internal_nav';
  var SENT_KEY = 'stt_sent';
  var MAX_PAGES = 50; // cap so very long sessions don't grow sessionStorage unbounded

  if (!sessionStorage.getItem(START_KEY)) {
    sessionStorage.setItem(START_KEY, String(Date.now()));
  }

  var pages = [];
  try { pages = JSON.parse(sessionStorage.getItem(PAGES_KEY) || '[]'); } catch (e) { pages = []; }
  pages.push({ url: location.pathname + location.search, title: document.title, t: Date.now() });
  if (pages.length > MAX_PAGES) pages = pages.slice(-MAX_PAGES);
  sessionStorage.setItem(PAGES_KEY, JSON.stringify(pages));

  // Fresh page load means the visitor is still around — clear any stale "sent" guard.
  sessionStorage.removeItem(SENT_KEY);

  // Mark same-site link clicks so pagehide knows this is internal navigation, not an exit.
  document.addEventListener('click', function (e) {
    var a = e.target.closest ? e.target.closest('a[href]') : null;
    if (!a) return;
    try {
      var url = new URL(a.href, location.href);
      if (url.origin === location.origin) {
        sessionStorage.setItem(NAV_FLAG, '1');
      }
    } catch (err) {}
  }, true);

  function sendSummary() {
    if (sessionStorage.getItem(SENT_KEY)) return;

    if (sessionStorage.getItem(NAV_FLAG)) {
      // Looks like internal navigation — not a real exit. Clear and wait.
      sessionStorage.removeItem(NAV_FLAG);
      return;
    }

    var start = parseInt(sessionStorage.getItem(START_KEY) || String(Date.now()), 10);
    var durationSec = Math.round((Date.now() - start) / 1000);
    var pagesList = [];
    try { pagesList = JSON.parse(sessionStorage.getItem(PAGES_KEY) || '[]'); } catch (e) {}

    var payload = {
      type: 'session_summary',
      pages: pagesList.map(function (p) { return p.url; }),
      duration_seconds: durationSec,
      device: [
        navigator.platform || '',
        screen.width + 'x' + screen.height,
        navigator.language,
        navigator.userAgent.slice(0, 100),
      ].join(' | '),
    };

    try {
      var blob = new Blob([JSON.stringify(payload)], { type: 'application/json' });
      navigator.sendBeacon('/api/notify', blob);
    } catch (e) {}

    sessionStorage.setItem(SENT_KEY, '1');
  }

  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'hidden') sendSummary();
  });
  window.addEventListener('pagehide', sendSummary);
})();
