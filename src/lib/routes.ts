/**
 * Central route codec.
 *
 * The whole point of this module is to keep the public URLs *opaque*:
 * nothing in the address bar should literally spell out "movie", "series",
 * "anime" or "watch". Every category maps to a short, non-obvious code, and
 * the streaming gateway lives behind an encoded token instead of a readable
 * "/watch/" path.
 *
 * IMPORTANT: poster / image paths are NOT touched by this module. Those keep
 * living under /images/{movie|series|anime}/... exactly as before.
 */
import type { Category } from './site';

/* ───────────────────────── category codes ─────────────────────────
 * Short opaque segments. Chosen so the URL reads like a random handle
 * rather than an English category name.
 *
 * URL REFRESH (v2): the detail/listing codes were rotated to brand-new values
 * so every catalogue URL changes at once, prompting search engines to
 * re-discover and re-index the whole site with fresh links. Because EVERY
 * internal link is generated through this codec, the rotation propagates
 * consistently across the entire site — page-to-page navigation stays intact.
 * The WATCH gateway (GATEWAY_NS + encodeGateToken and the /gw prefix) is
 * deliberately LEFT UNCHANGED so existing watch links keep working.
 *   movie  -> "m"  (was "f")
 *   series -> "s"  (was "d")
 *   anime  -> "a"  (was "n")
 * Listings live under the "c" namespace (was "x"):
 *   movies  listing -> /c/m
 *   series  listing -> /c/s
 *   anime   listing -> /c/a
 * The streaming gateway still lives under "g" with an encoded token (unchanged).
 */
export const DETAIL_CODE: Record<Category, string> = {
  movie: 'm',
  series: 's',
  anime: 'a',
};

export const CODE_TO_CATEGORY: Record<string, Category> = {
  m: 'movie',
  s: 'series',
  a: 'anime',
};

export const LISTING_NS = 'c';
export const GATEWAY_NS = 'g';
// NEW (CSV-ingested) works live under their own opaque namespace so the old,
// fully-static /f /d /n detail pages are left completely untouched. New works
// are SSR (on-demand) under /w/<slug>.
export const NEW_NS = 'w';

export function newDetailRoute(slug: string): string {
  return `/${NEW_NS}/${slug}`;
}
export function newSeasonRoute(slug: string, season: number): string {
  return `/${NEW_NS}/${slug}/c/${season}`;
}
export function newEpisodeRoute(slug: string, season: number, episode: number): string {
  return `/${NEW_NS}/${slug}/c/${season}/e/${episode}`;
}
export function newGatewayRoute(slug: string, season?: number, episode?: number): string {
  const q = season && episode ? `?s=${season}&e=${episode}` : '';
  return `/gw/${encodeGateToken(slug)}${q}`;
}

/* ───────────────────────── detail routes ───────────────────────── */

export function detailRoute(category: Category, slug: string): string {
  return `/${DETAIL_CODE[category]}/${slug}`;
}

export function listingRoute(category: Category): string {
  return `/${LISTING_NS}/${DETAIL_CODE[category]}`;
}

export function listingPageRoute(category: Category, page: number): string {
  const base = listingRoute(category);
  return page <= 1 ? base : `${base}/p/${page}`;
}

/* ───────────────────────── episode routes ───────────────────────── */

export function seasonRoute(category: Category, slug: string, season: number): string {
  return `${detailRoute(category, slug)}/c/${season}`;
}

export function episodeRoute(
  category: Category,
  slug: string,
  season: number,
  episode: number
): string {
  return `${seasonRoute(category, slug, season)}/e/${episode}`;
}

/* ───────────────────────── gateway (watch) token ─────────────────────────
 * The watch URL used to be /watch/{slug}. We now hide it behind an encoded
 * token so the path no longer contains the word "watch" nor the bare slug.
 *
 * The token is a reversible, URL-safe transform of the slug:
 *   1. UTF-8 encode the slug
 *   2. base64url
 *   3. light XOR-ish scramble keyed by a fixed salt so it doesn't *look* like
 *      plain base64 of the slug.
 * It is intentionally lightweight (this is obfuscation, not security) and is
 * fully reversible at build time + on the client.
 */
const GATE_SALT = 'cp7q';

function toBase64Url(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  // btoa exists in browsers; on the build side we polyfill below.
  const b64 = typeof btoa === 'function'
    ? btoa(bin)
    : Buffer.from(bin, 'binary').toString('base64');
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(str: string): Uint8Array {
  const b64 = str.replace(/-/g, '+').replace(/_/g, '/');
  const bin = typeof atob === 'function'
    ? atob(b64)
    : Buffer.from(b64, 'base64').toString('binary');
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function scramble(bytes: Uint8Array): Uint8Array {
  const out = new Uint8Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) {
    out[i] = bytes[i] ^ GATE_SALT.charCodeAt(i % GATE_SALT.length) ^ (i & 0xff);
  }
  return out;
}

function utf8Encode(str: string): Uint8Array {
  if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(str);
  return Uint8Array.from(Buffer.from(str, 'utf8'));
}

function utf8Decode(bytes: Uint8Array): string {
  if (typeof TextDecoder !== 'undefined') return new TextDecoder().decode(bytes);
  return Buffer.from(bytes).toString('utf8');
}

export function encodeGateToken(slug: string): string {
  return toBase64Url(scramble(utf8Encode(slug)));
}

export function decodeGateToken(token: string): string {
  try {
    return utf8Decode(scramble(fromBase64Url(token)));
  } catch {
    return '';
  }
}

export function gatewayRoute(slug: string): string {
  return `/${GATEWAY_NS}/${encodeGateToken(slug)}`;
}
