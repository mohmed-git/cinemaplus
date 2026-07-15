/**
 * Enrich NEW works (from new-works.json) with TMDB metadata, then build full
 * Title objects and merge them into all.json.
 *
 * - Only NEW works are enriched (old catalogue is never touched here).
 * - Resumable: every TMDB lookup is cached in tmdb-cache.json keyed by the
 *   work's name, so re-runs skip already-fetched works (Option A: enrich in
 *   batches over multiple runs without redoing work).
 * - Priority order: smaller / higher-value sub-categories first.
 *
 * Env:
 *   TMDB_TOKEN   (v4 read token)  — required
 *   LIMIT=N      enrich at most N still-uncached works this run (0 = all)
 *   ONLY=sub1,sub2  restrict to these sub-categories
 *
 * After enrichment it ALWAYS rebuilds all.json = oldWorks + newWorks(built),
 * so partially-enriched runs still produce a valid, buildable catalogue
 * (un-enriched new works get a clean fallback poster + description).
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { makeSlug, extractEnglishTitle, isAdultContent } from './lib-ingest.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const ALL_PATH = join(root, 'src/data/generated/all.json');
const NEW_WORKS_PATH = join(root, 'src/data/generated/new-works.json');
const CACHE_PATH = join(root, 'src/data/generated/tmdb-cache.json');
const SUBCAT_PATH = join(root, 'src/data/generated/subcategories.json');

const TOKEN = process.env.TMDB_TOKEN;
if (!TOKEN) { console.error('TMDB_TOKEN required'); process.exit(1); }
const LIMIT = Number(process.env.LIMIT || 0);
const ONLY = (process.env.ONLY || '').split(',').map((s) => s.trim()).filter(Boolean);

const IMG = 'https://image.tmdb.org/t/p/w500';
const PRIORITY = [
  'turkish-movies', 'indian-series', 'turkish-series', 'netflix-movies',
  'anime', 'asian-series', 'asian-movies', 'netflix-series',
  'foreign-series', 'indian-movies', 'foreign-movies',
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function tmdb(path, params = {}) {
  const url = new URL(`https://api.themoviedb.org/3/${path}`);
  url.searchParams.set('language', 'ar');
  for (const [k, v] of Object.entries(params)) if (v != null) url.searchParams.set(k, v);
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const res = await fetch(url, { headers: { Authorization: `Bearer ${TOKEN}` } });
      if (res.status === 429) { await sleep(1000 * (attempt + 1)); continue; }
      if (!res.ok) return null;
      return await res.json();
    } catch {
      await sleep(500 * (attempt + 1));
    }
  }
  return null;
}

/** Look up a work on TMDB. Returns a slim metadata object or null. */
async function lookup(work) {
  const q = work.englishTitle || extractEnglishTitle(work.name) || work.name;
  const isMovie = work.isMovie;
  const kind = isMovie ? 'movie' : 'tv';
  let search = await tmdb(`search/${kind}`, { query: q, year: work.year || undefined });
  if (!search?.results?.length) search = await tmdb(`search/${kind}`, { query: q });
  if (!search?.results?.length && q !== work.name) search = await tmdb(`search/${kind}`, { query: work.name });
  const hit = search?.results?.[0];
  if (!hit) return null;

  const details = await tmdb(`${kind}/${hit.id}`, {});
  const genres = (details?.genres || []).map((g) => g.name).filter(Boolean);
  const country = (details?.production_countries || [])[0]?.name || null;
  const year = (hit.release_date || hit.first_air_date || '').slice(0, 4) || work.year;
  return {
    tmdb_id: hit.id,
    poster: hit.poster_path ? IMG + hit.poster_path : null,
    backdrop: hit.backdrop_path ? IMG + hit.backdrop_path : null,
    story: (hit.overview || details?.overview || '').trim() || null,
    rating: hit.vote_average || 0,
    votes: hit.vote_count || 0,
    year: year || null,
    genre: genres.join('، ') || null,
    country,
    original_title: hit.original_title || hit.original_name || null,
    runtime: details?.runtime || (details?.episode_run_time || [])[0] || null,
    adult: hit.adult === true || details?.adult === true,
  };
}

/* ─────────────────────────  build a full Title  ───────────────────────── */
function buildTitle(work, meta) {
  const slugBase = makeSlug(work.name);
  const category = work.category;
  const categoryLabel = category === 'movie' ? 'فيلم' : category === 'anime' ? 'أنمي' : 'مسلسل';

  // Build seasons
  let seasons = [];
  if (work.isMovie) {
    seasons = [{
      season: 1, episodes_count: 1,
      episodes: [{
        episode: 1, title: work.name,
        servers: (work.movieServers || []).map((s, i) => ({ id: i + 1, label: s.label, url: s.url })),
      }],
    }];
  } else {
    const bySeason = new Map();
    for (const ep of work.episodes) {
      if (!bySeason.has(ep.season)) bySeason.set(ep.season, []);
      bySeason.get(ep.season).push(ep);
    }
    seasons = [...bySeason.entries()].sort((a, b) => a[0] - b[0]).map(([sn, eps]) => ({
      season: sn,
      episodes_count: eps.length,
      episodes: eps.sort((a, b) => a.episode - b.episode).map((e) => ({
        episode: e.episode,
        title: e.title || `الحلقة ${e.episode}`,
        servers: (e.servers || []).map((s, i) => ({ id: i + 1, label: s.label, url: s.url })),
      })),
    }));
  }
  const episodesCount = seasons.reduce((n, s) => n + s.episodes.length, 0);
  const year = meta?.year || work.year || null;

  const fallbackPoster = 'https://placehold.co/500x750/0f172a/06b6d4?text=' +
    encodeURIComponent(work.englishTitle || work.name.slice(0, 24));
  const poster = meta?.poster || fallbackPoster;
  const story = meta?.story ||
    `شاهد ${work.name} مترجم اون لاين بجودة عالية على سينما بلس مع روابط مشاهدة مباشرة سريعة.`;

  const sortRecent = year ? new Date(`${year}-01-01`).getTime() : 0;
  return {
    slug: slugBase,
    clean_title: work.name,
    raw_name: work.name,
    category,
    category_label: categoryLabel,
    subcategory: work.sub,
    subcategory_label: work.subLabel,
    is_new: true,              // flag: rendered on-demand (SSR), enriched from TMDB
    poster,
    note: null,
    matched_poster: !!meta?.poster,
    seasons_count: seasons.length,
    episodes_count: episodesCount,
    seasons,
    description: story,
    url: `/${category}/${slugBase}`,
    story,
    year: year ? String(year) : null,
    quality: 'HD',
    duration: meta?.runtime ? `${meta.runtime} دقيقة` : null,
    language: 'مترجم',
    country: meta?.country || null,
    director: null,
    stars: null,
    genre: meta?.genre || null,
    trailerId: null,
    rating: meta?.rating || null,
    imdb_rating: null,
    tmdb_id: meta?.tmdb_id || null,
    tmdb_url: meta?.tmdb_id ? `https://www.themoviedb.org/${work.isMovie ? 'movie' : 'tv'}/${meta.tmdb_id}` : null,
    original_title: meta?.original_title || null,
    tmdb_vote: meta?.rating || 0,
    tmdb_votes: meta?.votes || 0,
    release_date: year ? `${year}-01-01` : undefined,
    sort_rating: meta?.rating || 0,
    sort_recent: sortRecent,
    real_plot: !!meta?.story,
    is_special: false,
    // Adult / indecent flag: TMDB's own flag OR a keyword match on the work's
    // names + genre. The shard builder skips any work where this is true.
    adult: isAdultContent({
      name: `${work.name} ${meta?.original_title || ''}`,
      genre: meta?.genre || '',
      adult: meta?.adult === true,
    }),
  };
}

async function main() {
  const newWorks = JSON.parse(readFileSync(NEW_WORKS_PATH, 'utf8'));
  const cache = existsSync(CACHE_PATH) ? JSON.parse(readFileSync(CACHE_PATH, 'utf8')) : {};

  // de-dupe slugs (across new + against a quick set of existing slugs)
  const all = JSON.parse(readFileSync(ALL_PATH, 'utf8'));
  const usedSlugs = new Set(all.map((t) => t.slug));

  // priority + ONLY filter
  let queue = [...newWorks];
  if (ONLY.length) queue = queue.filter((w) => ONLY.includes(w.sub));
  queue.sort((a, b) => PRIORITY.indexOf(a.sub) - PRIORITY.indexOf(b.sub));

  // Which works still need a TMDB fetch?
  const todo = queue.filter((w) => !(w.name in cache));
  const batch = LIMIT > 0 ? todo.slice(0, LIMIT) : todo;
  console.log(`[tmdb] new works: ${newWorks.length} | cached: ${Object.keys(cache).length} | fetching now: ${batch.length}`);

  let done = 0;
  const CONCURRENCY = 12;
  for (let i = 0; i < batch.length; i += CONCURRENCY) {
    const slice = batch.slice(i, i + CONCURRENCY);
    await Promise.all(slice.map(async (w) => {
      const meta = await lookup(w);
      cache[w.name] = meta || { _miss: true };
      done++;
    }));
    if (done % 240 === 0 || i + CONCURRENCY >= batch.length) {
      writeFileSync(CACHE_PATH, JSON.stringify(cache));
      console.log(`[tmdb] enriched ${done}/${batch.length} (saved cache)`);
    }
  }
  writeFileSync(CACHE_PATH, JSON.stringify(cache));

  /* ──────  rebuild all.json = old + ALL new works (built from cache)  ────── */
  const built = [];
  const subCounts = {};
  for (const w of newWorks) {
    const meta = cache[w.name];
    const t = buildTitle(w, meta && !meta._miss ? meta : null);
    // ensure unique slug
    let slug = t.slug, n = 2;
    while (usedSlugs.has(slug)) slug = `${t.slug}-${n++}`;
    usedSlugs.add(slug);
    t.slug = slug;
    t.url = `/${t.category}/${slug}`;
    built.push(t);
    subCounts[w.sub] = (subCounts[w.sub] || 0) + 1;
  }

  // strip any previously-appended new works (is_new) then re-append fresh build
  const oldOnly = all.filter((t) => !t.is_new);
  const merged = [...oldOnly, ...built];
  writeFileSync(ALL_PATH, JSON.stringify(merged));
  writeFileSync(SUBCAT_PATH, JSON.stringify(subCounts, null, 2));

  const enrichedCount = built.filter((t) => t.tmdb_id).length;
  console.log(`[tmdb] built ${built.length} new titles (${enrichedCount} TMDB-enriched)`);
  console.log(`[tmdb] all.json now has ${merged.length} titles (${oldOnly.length} old + ${built.length} new)`);
  console.log('[tmdb] new works by sub:', subCounts);
}

main().catch((e) => { console.error(e); process.exit(1); });
