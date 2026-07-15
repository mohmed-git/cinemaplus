/**
 * New-works sitemap helpers.
 *
 * The freshly-ingested works are served on-demand at /w/<slug> (SSR), so
 * Astro's automatic sitemap integration never sees them — which is exactly why
 * they were not getting indexed. We enumerate every /w URL from a tiny
 * pre-built route index (src/data/generated/new-routes.json) and expose them
 * through SSR sitemap endpoints, mirroring the episode-sitemap design.
 */
import newRoutesData from '../data/generated/new-routes.json';
import { newDetailRoute, newEpisodeRoute } from './routes';
import { SITE } from './site';
import { buildUrlSet } from './episodeSitemap';

interface NewRouteEntry {
  s: string; // slug
  c: string; // category
  se?: number; // season   (episode entries only)
  ep?: number; // episode  (episode entries only)
}

const NEW_ROUTES = newRoutesData as unknown as NewRouteEntry[];

/** Max URLs per child sitemap. Kept well under the 50k hard cap. */
export const NEW_SITEMAP_CHUNK = 10000;

/** All absolute /w detail + episode URLs, in a stable order. */
export function getAllNewUrls(): string[] {
  return NEW_ROUTES.map((e) =>
    e.se != null && e.ep != null
      ? new URL(newEpisodeRoute(e.s, e.se, e.ep), SITE.url).toString()
      : new URL(newDetailRoute(e.s), SITE.url).toString()
  );
}

export function getNewSitemapChunkCount(total = getAllNewUrls().length): number {
  return Math.max(1, Math.ceil(total / NEW_SITEMAP_CHUNK));
}

export function getNewUrlsForChunk(chunk: number): string[] {
  const all = getAllNewUrls();
  const start = chunk * NEW_SITEMAP_CHUNK;
  return all.slice(start, start + NEW_SITEMAP_CHUNK);
}

export { buildUrlSet };
