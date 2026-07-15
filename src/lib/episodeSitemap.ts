/**
 * Episode sitemap helpers.
 *
 * The episode pages are SSR (prerender = false), so Astro's automatic sitemap
 * integration never sees them. We therefore enumerate every episode URL from a
 * tiny pre-built route index (src/data/generated/episode-routes.json, ~270KB)
 * — NOT from all.json — and expose them through SSR sitemap endpoints.
 *
 * ~48k episodes is far above the 50k-URL / 50MB single-sitemap cap, so we shard
 * the URLs into chunks and publish a sitemap *index* pointing at each chunk.
 */
import routeIndexData from '../data/generated/episode-routes.json';
import { episodeRoute } from './routes';
import type { Category } from './site';
import { SITE } from './site';

interface RouteEntry {
  s: string; // slug
  c: Category; // 'series' | 'anime'
  z: Array<[number, number[]]>; // [seasonNumber, episodeNumbers[]]
}

const ROUTE_INDEX = routeIndexData as unknown as RouteEntry[];

/** Max URLs per child sitemap. Kept well under the 50k hard cap. */
export const EPISODE_SITEMAP_CHUNK = 10000;

/** All absolute episode URLs across series + anime, in a stable order. */
export function getAllEpisodeUrls(): string[] {
  const urls: string[] = [];
  for (const entry of ROUTE_INDEX) {
    for (const [season, episodes] of entry.z) {
      for (const ep of episodes) {
        const route = episodeRoute(entry.c, entry.s, season, ep);
        urls.push(new URL(route, SITE.url).toString());
      }
    }
  }
  return urls;
}

/** Number of child sitemap chunks needed for the current catalogue. */
export function getEpisodeSitemapChunkCount(total = getAllEpisodeUrls().length): number {
  return Math.max(1, Math.ceil(total / EPISODE_SITEMAP_CHUNK));
}

/** URLs belonging to a single 0-based chunk. */
export function getEpisodeUrlsForChunk(chunk: number): string[] {
  const all = getAllEpisodeUrls();
  const start = chunk * EPISODE_SITEMAP_CHUNK;
  return all.slice(start, start + EPISODE_SITEMAP_CHUNK);
}

function xmlEscape(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/** Build a <urlset> document from a list of absolute URLs. */
export function buildUrlSet(urls: string[]): string {
  const body = urls.map((u) => `  <url><loc>${xmlEscape(u)}</loc></url>`).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${body}\n</urlset>\n`;
}
