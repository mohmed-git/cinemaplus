/**
 * Title loader.
 * Reads from src/data/generated/all.json and rewrites every `url` to the
 * opaque route form (see routes.ts) so that nowhere in the rendered HTML do we
 * leak readable /movie /series /anime /watch paths.
 *
 * Image / poster paths are deliberately left untouched.
 */
import type { Title, TitleIndexEntry } from './types';
import { splitGenres } from './detailContent';
import { detailRoute, newDetailRoute } from './routes';
import { isAdultTitle } from './contentSafety';

/**
 * CRITICAL — Worker-size safety.
 *
 * Every page that imports this module is `prerender = true` (static / built at
 * build time), so `all.json` (~86 MB) is ONLY ever needed by the Node build
 * process, never at request time on the Cloudflare edge.
 *
 * Previously this file did `import all from '.../all.json'`. A *static* import
 * makes Vite/Rollup inline the whole catalogue into a shared chunk
 * (`titles_*.mjs`, ~55 MB) that the Cloudflare adapter then bundles into
 * `dist/_worker.js`. That single chunk pushed the Worker far past Cloudflare's
 * 3 MB free-plan limit, so the build succeeded but the **publish step failed
 * within seconds** ("Worker exceeded the size limit of 3 MiB", code 10027).
 *
 * Fix: read the JSON from disk with `node:fs` at build time. Because there is
 * no static import, the bundler never pulls `all.json` into any chunk, and the
 * Worker stays tiny. `node:fs` runs only during the Node-side prerender pass,
 * which is exactly where these pages execute.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Resolve against the project root (process.cwd() === the webapp dir during the
// Astro build) rather than `import.meta.url`. The Cloudflare adapter copies the
// emitted page modules into `dist/_worker.js/...` before running the prerender
// pass, so a path relative to `import.meta.url` would resolve to a non-existent
// `dist/_worker.js/data/generated/all.json`. `process.cwd()` stays stable.
const ALL_JSON_PATH = resolve(process.cwd(), 'src/data/generated/all.json');
const RAW_TITLES: Title[] = JSON.parse(
  readFileSync(ALL_JSON_PATH, 'utf-8')
) as Title[];

/**
 * Optional preview cap.
 *
 * The full library is ~5,800 titles which expands to tens of thousands of
 * static pages — too much for a low-memory preview sandbox to build at once.
 * Setting PREVIEW_LIMIT (e.g. PREVIEW_LIMIT=600) builds a balanced subset across
 * the three categories so the redesign, themes and obfuscated routes can be
 * previewed. In production CI (no PREVIEW_LIMIT) the *entire* catalogue builds.
 */
const PREVIEW_LIMIT = Number(
  (typeof process !== 'undefined' && process.env && process.env.PREVIEW_LIMIT) || 0
);

function capByCategory(items: Title[], limit: number): Title[] {
  if (!limit || limit <= 0) return items;
  const perCat = Math.max(1, Math.floor(limit / 3));
  const buckets: Record<string, Title[]> = { movie: [], series: [], anime: [] };
  for (const t of items) {
    const b = buckets[t.category];
    if (b && b.length < perCat) b.push(t);
  }
  return [...buckets.movie, ...buckets.series, ...buckets.anime];
}

// Drop any indecent / semi-pornographic work up-front so it can never reach the
// homepage, search corpus, listings or similar rails (old catalogue + new works).
const SAFE_TITLES: Title[] = RAW_TITLES.filter((t) => !isAdultTitle(t as any));

// Rewrite the stored url to the opaque detail route.
const ALL_TITLES: Title[] = capByCategory(SAFE_TITLES, PREVIEW_LIMIT).map((t) => ({
  ...t,
  url: detailRoute(t.category, t.slug),
  relatedAnimeSeasons: t.relatedAnimeSeasons?.map((s: any) => ({
    ...s,
    url: detailRoute('anime', s.slug),
  })),
}));

// Build a slug → Title map for quick lookup
const bySlug = new Map<string, Title>();
for (const t of ALL_TITLES) bySlug.set(t.slug, t);

export function getAllTitles(): Title[] {
  return ALL_TITLES;
}

/**
 * Static (prerendered) catalogue only — EXCLUDES the freshly-ingested works
 * flagged `is_new`. Those new works (12k+) are served on-demand (SSR) via the
 * dedicated routes, so they must never enter a static `getStaticPaths()` (that
 * would emit 12k+ extra files and blow Cloudflare Pages' 20k-file limit and the
 * low-memory build). The existing detail/listing pages call this, so the old
 * catalogue keeps building exactly as before.
 */
export function getStaticTitlesByCategory(category: Title['category']): Title[] {
  return ALL_TITLES.filter((t) => t.category === category && !(t as any).is_new);
}

/** Full catalogue (old + new) for a category — used by SSR listings/search. */
export function getTitlesByCategory(category: Title['category']): Title[] {
  return ALL_TITLES.filter((t) => t.category === category && !(t as any).is_new);
}

export function getTitleBySlug(slug: string): Title | undefined {
  return bySlug.get(slug);
}

/** Tiny entry used in listings / cards */
export function toIndexEntry(t: Title): TitleIndexEntry {
  const genres = splitGenres(t.genre);
  return {
    slug: t.slug,
    clean_title: t.clean_title,
    category: t.category,
    category_label: t.category_label,
    poster: t.poster,
    seasons_count: t.seasons_count,
    episodes_count: t.episodes_count,
    // NEW (CSV-ingested) works live in the SSR /w namespace; the old catalogue
    // keeps the static /f /d /n detail routes.
    url: (t as any).is_new ? newDetailRoute(t.slug) : detailRoute(t.category, t.slug),
    has_multiple_seasons: t.seasons_count > 1,
    year: t.year || null,
    genres,
    rating: t.tmdb_vote ?? (Number(t.rating) || 0),
    votes: t.tmdb_votes ?? 0,
    sort_rating: t.sort_rating ?? 0,
    sort_recent: t.sort_recent ?? 0,
    is_special: !!t.is_special,
  };
}

export function sortByAlpha(titles: Title[]): Title[] {
  return [...titles].sort((a, b) =>
    a.clean_title.localeCompare(b.clean_title, 'ar')
  );
}

export function sortByEpisodes(titles: Title[]): Title[] {
  return [...titles].sort((a, b) => b.episodes_count - a.episodes_count);
}

/* ─────────────────  SORTING (TMDB-backed)  ───────────────── */

export type SortMode = 'featured' | 'latest' | 'top' | 'alpha';

const num = (v: unknown) => (typeof v === 'number' ? v : Number(v) || 0);

/** Special/OVA anime entries are always pushed to the very end. */
function specialPenalty(t: Title): number {
  return (t as { is_special?: boolean }).is_special ? 1 : 0;
}

/** Most recent first, by exact release/air date (falls back to year). */
export function sortByLatest(titles: Title[]): Title[] {
  return [...titles].sort((a, b) => {
    const sp = specialPenalty(a) - specialPenalty(b);
    if (sp !== 0) return sp;
    return num((b as any).sort_recent) - num((a as any).sort_recent);
  });
}

/** Highest credible (Bayesian) TMDB rating first. */
export function sortByTopRated(titles: Title[]): Title[] {
  return [...titles].sort((a, b) => {
    const sp = specialPenalty(a) - specialPenalty(b);
    if (sp !== 0) return sp;
    const r = num((b as any).sort_rating) - num((a as any).sort_rating);
    if (r !== 0) return r;
    return num((b as any).tmdb_votes) - num((a as any).tmdb_votes);
  });
}

/**
 * Default "featured" order: a balanced blend of credibility and freshness that
 * keeps specials/OVA out of the top. Deterministic (no Math.random) for SSG.
 */
export function sortFeatured(titles: Title[]): Title[] {
  const now = Date.now();
  const yearMs = 365.25 * 24 * 3600 * 1000;
  return [...titles].sort((a, b) => {
    const sp = specialPenalty(a) - specialPenalty(b);
    if (sp !== 0) return sp;
    const score = (t: Title) => {
      const rating = num((t as any).sort_rating); // 0..10
      const ageYears = Math.max(0, (now - num((t as any).sort_recent)) / yearMs);
      const recency = Math.max(0, 6 - Math.min(ageYears, 12) * 0.5); // newer ⇒ higher
      return rating * 1.0 + recency * 0.6;
    };
    const s = score(b) - score(a);
    if (s !== 0) return s;
    return a.clean_title.localeCompare(b.clean_title, 'ar');
  });
}

export function sortTitles(titles: Title[], mode: SortMode): Title[] {
  switch (mode) {
    case 'latest': return sortByLatest(titles);
    case 'top': return sortByTopRated(titles);
    case 'alpha': return sortByAlpha(titles);
    case 'featured':
    default: return sortFeatured(titles);
  }
}

/** Similar works: prefer overlapping genres, then keep a deterministic order. */
export function getSimilarTitles(current: Title, limit = 12): Title[] {
  const currentGenres = new Set(splitGenres(current.genre));
  const currentCountry = current.country || '';
  const sameCat = getTitlesByCategory(current.category).filter(
    (t) => t.slug !== current.slug
  );
  const hash = [...current.slug].reduce((h, c) => (h * 31 + c.charCodeAt(0)) | 0, 0);
  const sorted = sameCat
    .map((t, i) => {
      const genreScore = splitGenres(t.genre).reduce(
        (score, genre) => score + (currentGenres.has(genre) ? 1 : 0),
        0
      );
      const countryScore = currentCountry && t.country === current.country ? 1 : 0;
      const yearScore = current.year && t.year === current.year ? 1 : 0;
      return {
        t,
        score: genreScore * 10 + countryScore * 2 + yearScore,
        key: (i * 2654435761 + hash) >>> 0,
      };
    })
    .sort((a, b) => (b.score - a.score) || (a.key - b.key))
    .map((x) => x.t);
  return sorted.slice(0, limit);
}
