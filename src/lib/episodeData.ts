/**
 * Runtime episode-title loader for the SSR episode pages.
 *
 * CRITICAL: the SSR episode routes must NOT import all.json (86MB) nor bundle
 * 2.4k per-title shards through Vite (that produces thousands of dynamic-import
 * chunks and cripples the build). Instead the shards are emitted by
 * scripts/build-episode-shards.mjs as PLAIN STATIC assets under
 * public/_data/episodes/<file>.json, and we fetch the single needed shard at
 * request time. Only the tiny slug→file manifest (~170KB) is bundled.
 *
 * The shards carry the exact same Title objects the static pages render; we
 * re-apply the opaque url-rewrite so internal links match the rest of the site.
 */
import type { Title } from './types';
import { detailRoute } from './routes';
import manifest from '../data/generated/episode-manifest.json';

// slug -> shard filename (base64url of slug). Generated at build time.
const SLUG_TO_FILE = manifest as Record<string, string>;

function normalize(raw: Title): Title {
  return {
    ...raw,
    url: detailRoute(raw.category, raw.slug),
    relatedAnimeSeasons: raw.relatedAnimeSeasons?.map((s) => ({
      ...s,
      url: detailRoute('anime', s.slug),
    })),
  };
}

/**
 * Load a single episodic Title by slug at request time.
 *
 * @param slug      the title slug from the route params
 * @param requestUrl the incoming request URL (Astro.url) — used as the origin
 *                   to fetch the static shard from the same Pages deployment.
 * Returns undefined for unknown / non-episodic slugs or a missing shard.
 */
export async function loadEpisodicTitle(
  slug: string,
  requestUrl: URL
): Promise<Title | undefined> {
  const file = SLUG_TO_FILE[slug];
  if (!file) return undefined;

  const assetUrl = new URL(`/_data/episodes/${file}.json`, requestUrl.origin);
  const res = await fetch(assetUrl);
  if (!res.ok) return undefined;

  const raw = (await res.json()) as Title;
  return normalize(raw);
}
