/**
 * Host-matching helpers for merging streaming servers.
 *
 * The goal: decide whether two embed URLs point at the SAME third-party host so
 * an OLD link can be REPLACED by a NEWER one (instead of adding a duplicate),
 * while genuinely different hosts are ADDED as new servers.
 *
 * Two subtleties the CSV forces us to handle:
 *
 *  1. PROXY / REDIRECT links. topcinemaa wraps some players in a redirect:
 *        https://topcinemaa.com/play.php?to=streamwish.fun/e/70y0xolrs4ex
 *     The real host is the `to=` target (streamwish.fun), NOT topcinemaa.com.
 *     We MUST unwrap it before comparing, or every proxied link would collapse
 *     into one bogus "topcinemaa" host.
 *
 *  2. Same provider, different domain/subdomain/TLD:
 *        down.vidtube.one  ≈  vidtube.one          (subdomain)
 *        uqload.is ≈ uqload.net ≈ uqload.cx ≈ uqload.io   (TLD hopping)
 *        d0o0d.com ≈ dood... (doodstream family)
 *     We reduce a hostname to a stable PROVIDER KEY = the registrable domain's
 *     first label (e.g. "vidtube", "uqload", "streamwish"), after stripping
 *     common noise subdomains (www., down., embed., cdn., …). That key is what
 *     we match on — so a newer uqload.net link replaces an old uqload.is one.
 */

// Subdomains that are pure noise and never change the provider identity.
const NOISE_SUBDOMAINS = new Set([
  'www', 'down', 'up', 'embed', 'cdn', 'play', 'player', 'stream',
  'video', 'watch', 'go', 'e', 'd', 'v', 'm', 'new', 'old', 's1', 's2',
]);

/**
 * Unwrap a topcinemaa (or similar) proxy link to its real target URL string.
 * Returns the original url if it is not a proxy link.
 */
export function unwrapProxy(rawUrl) {
  if (!rawUrl) return rawUrl;
  try {
    const u = new URL(rawUrl);
    // pattern: /play.php?to=<host>/<path>   (also tolerate ?url= / ?to=)
    if (/play\.php$/i.test(u.pathname) || /\/play\.php/i.test(u.pathname)) {
      const to = u.searchParams.get('to') || u.searchParams.get('url') || u.searchParams.get('go');
      if (to) {
        const target = /^https?:\/\//i.test(to) ? to : `https://${to}`;
        return target;
      }
    }
    // generic: any ?to=<absolute-or-host> even without play.php
    const to = u.searchParams.get('to');
    if (to && /[a-z0-9-]+\.[a-z]{2,}/i.test(to)) {
      return /^https?:\/\//i.test(to) ? to : `https://${to}`;
    }
  } catch {
    /* not a URL — return as-is */
  }
  return rawUrl;
}

/** Hostname of a URL after unwrapping proxy links. Lowercased, no leading www. */
export function realHost(rawUrl) {
  const url = unwrapProxy(rawUrl);
  try {
    return new URL(url).hostname.replace(/^www\./i, '').toLowerCase();
  } catch {
    // maybe it was "host/path" without scheme
    const m = String(url).match(/^([a-z0-9.-]+\.[a-z]{2,})/i);
    return m ? m[1].replace(/^www\./i, '').toLowerCase() : '';
  }
}

/**
 * Provider key = stable identity of the streaming host, robust to subdomain and
 * TLD changes. e.g.
 *   down.vidtube.one   -> "vidtube"
 *   vidtube.one        -> "vidtube"
 *   uqload.is/.net/.cx -> "uqload"
 *   streamwish.fun     -> "streamwish"
 *   topcinemaa.com/play.php?to=d0o0d.com/... -> "d0o0d"
 */
export function providerKey(rawUrl) {
  const host = realHost(rawUrl);
  if (!host) return '';
  const parts = host.split('.').filter(Boolean);
  if (parts.length <= 1) return host;
  // Drop leading noise subdomains until we reach the registrable-ish domain.
  let i = 0;
  while (i < parts.length - 2 && NOISE_SUBDOMAINS.has(parts[i])) i++;
  // Now parts[i..] is like ["vidtube","one"] or ["uqload","co","uk"].
  // The provider label is the first remaining label.
  const label = parts[i];
  return label;
}

/** Two URLs are the "same host/provider" iff their provider keys match. */
export function sameProvider(urlA, urlB) {
  const a = providerKey(urlA);
  const b = providerKey(urlB);
  return !!a && a === b;
}

/** Friendly server label inferred from the (unwrapped) provider + optional quality. */
export function serverLabel(rawUrl, playerName) {
  const key = providerKey(rawUrl);
  const base = key || (playerName || 'سيرفر');
  return `${base} - HD`;
}
