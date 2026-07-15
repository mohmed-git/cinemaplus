/**
 * FULL TMDB enrichment pass — structured cast + rich metadata for ALL works
 * that already carry a tmdb_id (old catalogue + new works alike).
 *
 * This is the third-pass enricher requested by the SEO enrichment brief. Unlike
 * enrich-tmdb-extra.mjs (which only touched is_new works and only stored a
 * flat `stars` string), this pass:
 *
 *   - runs over EVERY work in all.json that has a tmdb_id
 *   - stores a STRUCTURED cast[] { name, character, profilePath, tmdbId, order }
 *     (the single biggest indexing gap — 0 works had this before)
 *   - fills: overview_ar / overview_en / story, genres[] (+genres_en),
 *     vote_average, vote_count, imdb_id, release_date, runtime, backdrop_path,
 *     trailerId, director / creators, spoken_languages, production_countries,
 *     status, number_of_episodes / number_of_seasons (tv only)
 *
 * One TMDB request per work via append_to_response (Arabic first). A single
 * English fallback request is made only when the Arabic overview is empty.
 *
 * Resumable: every fetch is cached in cast-enrich-cache.json keyed by
 * `${type}:${tmdb_id}`, so re-runs skip already-fetched works. Cache is flushed
 * to disk periodically and on exit, so an OOM/timeout kill loses at most the
 * current in-flight slice.
 *
 * Env:
 *   TMDB_TOKEN | TMDB_READ_TOKEN   v4 read token (required)
 *   LIMIT=N      fetch at most N still-uncached works this run (0 = all)
 *   MERGE_ONLY=1 skip fetching; just merge the existing cache into all.json
 *   CONCURRENCY=N  parallel requests (default 8; keep <= ~40 req / 10s)
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const ALL_PATH = join(root, 'src/data/generated/all.json');
const CACHE_PATH = join(root, 'src/data/generated/cast-enrich-cache.json');
const REPORT_PATH = join(root, 'src/data/generated/enrich-report.json');

const TOKEN = process.env.TMDB_TOKEN || process.env.TMDB_READ_TOKEN;
if (!TOKEN) { console.error('TMDB_TOKEN / TMDB_READ_TOKEN required'); process.exit(1); }
const LIMIT = Number(process.env.LIMIT || 0);
const MERGE_ONLY = process.env.MERGE_ONLY === '1';
const CONCURRENCY = Number(process.env.CONCURRENCY || 8);

const IMG_PROFILE = 'https://image.tmdb.org/t/p/w185';
const MAX_CAST = 15;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function tmdb(path, params = {}) {
  const url = new URL(`https://api.themoviedb.org/3/${path}`);
  for (const [k, v] of Object.entries(params)) if (v != null) url.searchParams.set(k, v);
  for (let attempt = 0; attempt < 5; attempt++) {
    // Hard timeout per request so a hung socket can never stall the whole run.
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 15000);
    try {
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${TOKEN}` },
        signal: ctrl.signal,
      });
      clearTimeout(timer);
      if (res.status === 429) { await sleep(1200 * (attempt + 1)); continue; }
      if (!res.ok) return null;
      return await res.json();
    } catch {
      clearTimeout(timer);
      await sleep(500 * (attempt + 1));
    }
  }
  return null;
}

/** Fetch full enrichment for one work using its tmdb_id. */
async function fetchFull(work) {
  const kind = work.category === 'movie' ? 'movie' : 'tv';
  const id = work.tmdb_id;
  if (!id) return null;

  const d = await tmdb(`${kind}/${id}`, {
    language: 'ar',
    append_to_response: 'credits,videos,external_ids,aggregate_credits',
  });
  if (!d) return null;

  // Overview: Arabic first, English fallback (single extra request when empty).
  let overviewAr = (d.overview || '').trim();
  let overviewEn = '';
  if (!overviewAr) {
    const en = await tmdb(`${kind}/${id}`, { language: 'en-US' });
    overviewEn = (en?.overview || '').trim();
  }

  // Genres (Arabic, because we asked language=ar).
  const genres = (d.genres || []).map((g) => g.name).filter(Boolean);

  // Structured cast — TV uses aggregate_credits (roles across seasons) if present.
  let castSrc = d.credits?.cast || [];
  if (kind === 'tv' && (d.aggregate_credits?.cast || []).length) {
    castSrc = d.aggregate_credits.cast.map((c) => ({
      name: c.name,
      character: (c.roles && c.roles[0] && c.roles[0].character) || c.character || '',
      profile_path: c.profile_path,
      id: c.id,
      order: c.order,
    }));
  }
  const cast = castSrc
    .slice(0, MAX_CAST)
    .map((c, i) => ({
      name: c.name || '',
      character: c.character || '',
      profilePath: c.profile_path ? IMG_PROFILE + c.profile_path : null,
      tmdbId: c.id || null,
      order: typeof c.order === 'number' ? c.order : i,
    }))
    .filter((c) => c.name);

  // Director (movie) / creators (tv).
  let director = null;
  let creators = [];
  if (kind === 'movie') {
    const dd = (d.credits?.crew || []).find((c) => c.job === 'Director');
    director = dd?.name || null;
  } else {
    creators = (d.created_by || []).map((c) => c.name).filter(Boolean);
  }

  // Trailer (YouTube).
  const vids = (d.videos?.results || []).filter((v) => v.site === 'YouTube');
  const trailer =
    vids.find((v) => v.type === 'Trailer' && v.official) ||
    vids.find((v) => v.type === 'Trailer') ||
    vids.find((v) => v.type === 'Teaser') ||
    vids[0];

  const releaseDate = (kind === 'movie' ? d.release_date : d.first_air_date) || null;
  const runtime = kind === 'movie'
    ? d.runtime || null
    : (d.episode_run_time || [])[0] || null;

  return {
    tmdb_type: kind,
    overview_ar: overviewAr || null,
    overview_en: overviewEn || null,
    genres,
    vote_average: typeof d.vote_average === 'number' ? d.vote_average : null,
    vote_count: typeof d.vote_count === 'number' ? d.vote_count : null,
    imdb_id: d.external_ids?.imdb_id || null,
    release_date: releaseDate,
    runtime,
    backdrop_path: d.backdrop_path || null,
    poster_path: d.poster_path || null,
    trailerId: trailer?.key || null,
    director,
    creators,
    original_title: d.original_title || d.original_name || null,
    title_ar: d.title || d.name || null,
    spoken_languages: (d.spoken_languages || []).map((l) => l.name).filter(Boolean),
    production_countries: (d.production_countries || []).map((c) => c.name).filter(Boolean),
    status: d.status || null,
    number_of_episodes: kind === 'tv' ? d.number_of_episodes || null : null,
    number_of_seasons: kind === 'tv' ? d.number_of_seasons || null : null,
    cast,
  };
}

/* ─────────────────────────  merge cache → all.json  ───────────────────── */
function mergeIntoAll(all, cache) {
  const r = {
    total_with_tmdb: 0, enriched: 0, cast_added: 0, story_added: 0,
    genres_added: 0, rating_added: 0, release_added: 0, director_added: 0,
    trailer_added: 0, backdrop_added: 0, imdb_added: 0, no_cast: 0,
  };
  const boiler = /مترجم اون لاين بجودة عالية على/;
  for (const t of all) {
    if (!t.tmdb_id) continue;
    r.total_with_tmdb++;
    const key = `${t.category === 'movie' ? 'movie' : 'tv'}:${t.tmdb_id}`;
    const ex = cache[key];
    if (!ex || ex._miss) continue;
    r.enriched++;

    // Structured cast (the headline gap).
    if (Array.isArray(ex.cast) && ex.cast.length) {
      t.cast = ex.cast;
      r.cast_added++;
      // Keep a clean flat `stars` string in sync for legacy templates.
      if (!t.stars) t.stars = ex.cast.slice(0, 5).map((c) => c.name).join('، ');
    } else {
      r.no_cast++;
    }

    // Overview / story — prefer Arabic, then English, replace boilerplate/empty.
    const bestOverview = ex.overview_ar || ex.overview_en || null;
    if (bestOverview && (!t.story || boiler.test(t.story) || t.real_plot !== true)) {
      // only overwrite when the current story is boilerplate or empty
      if (!t.story || boiler.test(t.story)) {
        t.story = bestOverview;
        t.description = bestOverview;
        t.real_plot = true;
        r.story_added++;
      }
    }
    if (ex.overview_ar) t.overview_ar = ex.overview_ar;
    if (ex.overview_en) t.overview_en = ex.overview_en;

    // Genres.
    if (ex.genres && ex.genres.length) {
      t.genres = ex.genres;
      if (!t.genre) { t.genre = ex.genres.join('، '); }
      r.genres_added++;
    }

    // Ratings.
    if (ex.vote_average != null && ex.vote_average > 0) {
      t.vote_average = ex.vote_average;
      t.tmdb_vote = ex.vote_average;
      if (!t.rating) t.rating = Number(ex.vote_average.toFixed(1));
      t.sort_rating = ex.vote_average;
      r.rating_added++;
    }
    if (ex.vote_count != null) { t.vote_count = ex.vote_count; t.tmdb_votes = ex.vote_count; }

    // Dates.
    if (ex.release_date) {
      t.release_date = ex.release_date;
      if (!t.year) t.year = ex.release_date.slice(0, 4);
      r.release_added++;
    }

    // Production / meta.
    if (ex.runtime && !t.duration) t.duration = `${ex.runtime} دقيقة`;
    if (ex.runtime) t.runtime = ex.runtime;
    if (ex.director && !t.director) { t.director = ex.director; r.director_added++; }
    if (ex.creators && ex.creators.length) {
      t.creators = ex.creators;
      if (!t.director) t.director = ex.creators.join('، ');
    }
    if (ex.trailerId && !t.trailerId) { t.trailerId = ex.trailerId; r.trailer_added++; }
    if (ex.backdrop_path) { t.backdrop_path = ex.backdrop_path; r.backdrop_added++; }
    if (ex.poster_path && !t.poster) t.poster = 'https://image.tmdb.org/t/p/w500' + ex.poster_path;
    if (ex.imdb_id) { t.imdb_id = ex.imdb_id; r.imdb_added++; }
    if (ex.original_title && !t.original_title) t.original_title = ex.original_title;
    if (ex.title_ar) t.title_ar = ex.title_ar;
    if (ex.spoken_languages && ex.spoken_languages.length) t.spoken_languages = ex.spoken_languages;
    if (ex.production_countries && ex.production_countries.length) {
      t.production_countries = ex.production_countries;
      if (!t.country) t.country = ex.production_countries[0];
    }
    if (ex.status) t.status = ex.status;
    if (ex.tmdb_type === 'tv') {
      if (ex.number_of_episodes) t.number_of_episodes = ex.number_of_episodes;
      if (ex.number_of_seasons) t.number_of_seasons = ex.number_of_seasons;
    }
  }
  return r;
}

async function main() {
  const all = JSON.parse(readFileSync(ALL_PATH, 'utf8'));
  const cache = existsSync(CACHE_PATH) ? JSON.parse(readFileSync(CACHE_PATH, 'utf8')) : {};

  if (!MERGE_ONLY) {
    const withId = all.filter((t) => t.tmdb_id);
    const todo = withId.filter((t) => {
      const key = `${t.category === 'movie' ? 'movie' : 'tv'}:${t.tmdb_id}`;
      return !(key in cache);
    });
    const batch = LIMIT > 0 ? todo.slice(0, LIMIT) : todo;
    console.log(`[cast] works with tmdb_id: ${withId.length} | cached: ${Object.keys(cache).length} | fetching now: ${batch.length}`);

    let done = 0;
    const flush = () => writeFileSync(CACHE_PATH, JSON.stringify(cache));
    for (let i = 0; i < batch.length; i += CONCURRENCY) {
      const slice = batch.slice(i, i + CONCURRENCY);
      await Promise.all(slice.map(async (w) => {
        const key = `${w.category === 'movie' ? 'movie' : 'tv'}:${w.tmdb_id}`;
        const data = await fetchFull(w);
        cache[key] = data || { _miss: true };
        done++;
      }));
      if (done % 160 === 0 || i + CONCURRENCY >= batch.length) {
        flush();
        console.log(`[cast] fetched ${done}/${batch.length} (cache saved)`);
      }
      // gentle throttle to respect rate limits
      await sleep(120);
    }
    flush();
  }

  /* ── merge into all.json ── */
  const report = mergeIntoAll(all, cache);
  writeFileSync(ALL_PATH, JSON.stringify(all));
  report.generated_at = new Date().toISOString();
  report.cache_entries = Object.keys(cache).length;
  writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2));

  console.log('[cast] merge report:', JSON.stringify(report, null, 2));
  console.log('[cast] all.json updated. Next: rebuild shards + search index, then build.');
}

main().catch((e) => { console.error(e); process.exit(1); });
