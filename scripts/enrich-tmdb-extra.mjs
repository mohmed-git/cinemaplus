/**
 * SECOND-PASS TMDB enrichment for NEW works only (old catalogue untouched).
 *
 * The first pass (enrich-tmdb.mjs) only stored poster/story/rating/genre/country
 * — and it asked TMDB in Arabic only, so ~3.7k works got an EMPTY overview and
 * fell back to boilerplate ("... على سينما بلس"). It also never fetched the
 * director, the cast, or the trailer.
 *
 * This pass uses the tmdb_id already stored on each NEW work and fetches, via
 * append_to_response, the data the detail pages need to match the old pages:
 *   - real Arabic overview (English fallback when Arabic is empty)
 *   - director / creator           → title.director
 *   - top cast                     → title.stars
 *   - a YouTube trailer key        → title.trailerId
 *   - runtime (fills missing duration)
 *
 * It is resumable (extra-cache.json keyed by tmdb_id) and ONLY mutates NEW
 * (is_new) works inside all.json. Works without a tmdb_id are skipped.
 *
 * Env:
 *   TMDB_TOKEN   v4 read token (required)
 *   LIMIT=N      enrich at most N still-uncached works this run (0 = all)
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const ALL_PATH = join(root, 'src/data/generated/all.json');
const CACHE_PATH = join(root, 'src/data/generated/tmdb-extra-cache.json');

const TOKEN = process.env.TMDB_TOKEN;
if (!TOKEN) { console.error('TMDB_TOKEN required'); process.exit(1); }
const LIMIT = Number(process.env.LIMIT || 0);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function tmdb(path, params = {}) {
  const url = new URL(`https://api.themoviedb.org/3/${path}`);
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

/** Fetch the extra fields for one work using its tmdb_id. */
async function fetchExtra(work) {
  const kind = work.category === 'movie' ? 'movie' : 'tv';
  const id = work.tmdb_id;
  if (!id) return null;

  // Arabic first (overview), with credits + videos appended.
  const ar = await tmdb(`${kind}/${id}`, {
    language: 'ar',
    append_to_response: 'credits,videos',
  });
  if (!ar) return null;

  // English overview fallback when the Arabic one is empty.
  let overview = (ar.overview || '').trim();
  if (!overview) {
    const en = await tmdb(`${kind}/${id}`, { language: 'en-US' });
    overview = (en?.overview || '').trim();
  }

  // Director (movie) / creator (tv).
  let director = null;
  if (kind === 'movie') {
    const d = (ar.credits?.crew || []).find((c) => c.job === 'Director');
    director = d?.name || null;
  } else {
    director = (ar.created_by || []).map((c) => c.name).filter(Boolean).slice(0, 2).join('، ') || null;
  }

  // Top billed cast (up to 5).
  const stars = (ar.credits?.cast || [])
    .slice(0, 5)
    .map((c) => c.name)
    .filter(Boolean)
    .join('، ') || null;

  // A YouTube trailer (prefer official trailers, then any YouTube video).
  const vids = (ar.videos?.results || []).filter((v) => v.site === 'YouTube');
  const trailer =
    vids.find((v) => v.type === 'Trailer' && v.official) ||
    vids.find((v) => v.type === 'Trailer') ||
    vids.find((v) => v.type === 'Teaser') ||
    vids[0];
  const trailerId = trailer?.key || null;

  const runtime = kind === 'movie'
    ? ar.runtime || null
    : (ar.episode_run_time || [])[0] || null;

  return {
    overview: overview || null,
    director,
    stars,
    trailerId,
    runtime,
  };
}

async function main() {
  const all = JSON.parse(readFileSync(ALL_PATH, 'utf8'));
  const cache = existsSync(CACHE_PATH) ? JSON.parse(readFileSync(CACHE_PATH, 'utf8')) : {};

  const news = all.filter((t) => t.is_new && t.tmdb_id);
  const todo = news.filter((t) => !(String(t.tmdb_id) in cache));
  const batch = LIMIT > 0 ? todo.slice(0, LIMIT) : todo;
  console.log(`[extra] new with tmdb_id: ${news.length} | cached: ${Object.keys(cache).length} | fetching now: ${batch.length}`);

  let done = 0;
  const CONCURRENCY = 10;
  for (let i = 0; i < batch.length; i += CONCURRENCY) {
    const slice = batch.slice(i, i + CONCURRENCY);
    await Promise.all(slice.map(async (w) => {
      const extra = await fetchExtra(w);
      cache[String(w.tmdb_id)] = extra || { _miss: true };
      done++;
    }));
    if (done % 200 === 0 || i + CONCURRENCY >= batch.length) {
      writeFileSync(CACHE_PATH, JSON.stringify(cache));
      console.log(`[extra] enriched ${done}/${batch.length} (saved cache)`);
    }
  }
  writeFileSync(CACHE_PATH, JSON.stringify(cache));

  /* ── merge cached extras back into all.json (NEW works only) ── */
  let storyFixed = 0, directorAdded = 0, starsAdded = 0, trailerAdded = 0, durationAdded = 0;
  for (const t of all) {
    if (!t.is_new || !t.tmdb_id) continue;
    const ex = cache[String(t.tmdb_id)];
    if (!ex || ex._miss) continue;

    if (ex.overview) {
      // Replace boilerplate / empty story with the real TMDB overview.
      const boiler = /مترجم اون لاين بجودة عالية على/;
      if (!t.story || boiler.test(t.story)) {
        t.story = ex.overview;
        t.description = ex.overview;
        t.real_plot = true;
        storyFixed++;
      }
    }
    if (ex.director && !t.director) { t.director = ex.director; directorAdded++; }
    if (ex.stars && !t.stars) { t.stars = ex.stars; starsAdded++; }
    if (ex.trailerId && !t.trailerId) { t.trailerId = ex.trailerId; trailerAdded++; }
    if (ex.runtime && !t.duration) { t.duration = `${ex.runtime} دقيقة`; durationAdded++; }
  }

  writeFileSync(ALL_PATH, JSON.stringify(all));
  console.log(`[extra] merged: story=${storyFixed} director=${directorAdded} stars=${starsAdded} trailer=${trailerAdded} duration=${durationAdded}`);
  console.log('[extra] all.json updated. Next: rebuild shards + search index, then build.');
}

main().catch((e) => { console.error(e); process.exit(1); });
