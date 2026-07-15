/**
 * Lightweight "similar titles" for the SSR episode pages.
 *
 * CRITICAL: this module must NOT statically import index.json (~5MB). Doing so
 * bundles the whole index into the SSR Worker (>5MB chunk) and pushes the Worker
 * past Cloudflare Pages' publish limit ("Failed to publish assets").
 *
 * Instead, scripts/build-episode-shards.mjs emits one slim, card-level index per
 * category as a PLAIN STATIC asset under public/_data/similar/<category>.json.
 * We fetch only the current title's category file at request time (same pattern
 * as episodeData.ts), so the Worker stays tiny.
 */
import type { Category, TitleIndexEntry } from './types';
import { splitGenres } from './detailContent';
import { detailRoute } from './routes';

interface RawIndexEntry {
  slug: string;
  clean_title: string;
  category: Category;
  category_label: string;
  poster: string | null;
  year?: string | null;
  episodes_count: number;
  seasons_count: number;
  genre?: string | null;
  rating?: number;
  votes?: number;
  sort_rating?: number;
  sort_recent?: number;
  is_special?: boolean;
  country?: string | null;
}

// Per-origin, per-category in-memory cache so a single Worker isolate that
// serves several requests only fetches each category file once.
const categoryCache = new Map<string, RawIndexEntry[]>();

async function loadCategoryIndex(
  category: Category,
  requestUrl: URL
): Promise<RawIndexEntry[]> {
  const cacheKey = `${requestUrl.origin}::${category}`;
  const cached = categoryCache.get(cacheKey);
  if (cached) return cached;

  const assetUrl = new URL(`/_data/similar/${category}.json`, requestUrl.origin);
  const res = await fetch(assetUrl);
  if (!res.ok) {
    categoryCache.set(cacheKey, []);
    return [];
  }
  const data = (await res.json()) as RawIndexEntry[];
  categoryCache.set(cacheKey, data);
  return data;
}

function toEntry(e: RawIndexEntry): TitleIndexEntry {
  const genres = splitGenres(e.genre);
  return {
    slug: e.slug,
    clean_title: e.clean_title,
    category: e.category,
    category_label: e.category_label,
    poster: e.poster,
    seasons_count: e.seasons_count,
    episodes_count: e.episodes_count,
    url: detailRoute(e.category, e.slug),
    has_multiple_seasons: e.seasons_count > 1,
    year: e.year ?? null,
    genres,
    rating: e.rating ?? 0,
    votes: e.votes ?? 0,
    sort_rating: e.sort_rating ?? 0,
    sort_recent: e.sort_recent ?? 0,
    is_special: !!e.is_special,
  };
}

/**
 * Same heuristic as titles.ts#getSimilarTitles: prefer overlapping genres,
 * then country / year, with a deterministic tiebreak.
 *
 * Now async — fetches the slim per-category index from a static asset instead
 * of bundling the full index. `requestUrl` (Astro.url) provides the origin.
 */
export async function getSimilarTitlesLite(
  currentSlug: string,
  currentCategory: Category,
  currentGenre: string | null | undefined,
  currentCountry: string | null | undefined,
  currentYear: string | null | undefined,
  requestUrl: URL,
  limit = 12
): Promise<TitleIndexEntry[]> {
  const index = await loadCategoryIndex(currentCategory, requestUrl);
  const currentGenres = new Set(splitGenres(currentGenre));
  const sameCat = index.filter(
    (t) => t.category === currentCategory && t.slug !== currentSlug
  );
  const hash = [...currentSlug].reduce((h, c) => (h * 31 + c.charCodeAt(0)) | 0, 0);

  return sameCat
    .map((t, i) => {
      const genreScore = splitGenres(t.genre).reduce(
        (score, g) => score + (currentGenres.has(g) ? 1 : 0),
        0
      );
      const countryScore = currentCountry && t.country === currentCountry ? 1 : 0;
      const yearScore = currentYear && t.year === currentYear ? 1 : 0;
      return {
        t,
        score: genreScore * 10 + countryScore * 2 + yearScore,
        key: (i * 2654435761 + hash) >>> 0,
      };
    })
    .sort((a, b) => b.score - a.score || a.key - b.key)
    .slice(0, limit)
    .map((x) => toEntry(x.t));
}
