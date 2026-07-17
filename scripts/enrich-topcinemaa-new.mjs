/**
 * Enrich the topcinemaa NEW works (src/data/generated/new-from-topcinemaa.json)
 * with TMDB metadata and build full Title objects (is_new=true). Writes the
 * built titles to src/data/generated/topcinemaa-new-built.json.
 *
 * This does NOT touch all.json — a separate streaming Python step appends the
 * built titles so existing works (old + previously-added is_new) are preserved.
 *
 * Subcategory is inferred from TMDB original_language / production country:
 *   Turkish -> turkish-*, Korean/Japanese/Chinese/Thai -> asian-* (anime stays anime),
 *   Hindi/Tamil/Telugu -> indian-*, English on a known-netflix... -> foreign-* default.
 *
 * Resumable: TMDB lookups cached in topcinemaa-tmdb-cache.json keyed by work name.
 *
 * Env:
 *   TMDB_TOKEN | TMDB_READ_TOKEN  v4 read token (required)
 *   LIMIT=N     enrich at most N still-uncached works this run (0 = all)
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { makeSlug, extractEnglishTitle, isAdultContent } from './lib-ingest.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const NEW_IN = join(root, 'src/data/generated/new-from-topcinemaa.json');
const BUILT_OUT = join(root, 'src/data/generated/topcinemaa-new-built.json');
const CACHE_PATH = join(root, 'src/data/generated/topcinemaa-tmdb-cache.json');

const TOKEN = process.env.TMDB_TOKEN || process.env.TMDB_READ_TOKEN;
if (!TOKEN) { console.error('TMDB_TOKEN / TMDB_READ_TOKEN required'); process.exit(1); }
const LIMIT = Number(process.env.LIMIT || 0);

const IMG = 'https://image.tmdb.org/t/p/w500';
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

/** Strip descriptive prefixes ("A Marvel Television Special Presentation - ..."). */
function cleanTitleForSearch(name) {
  let s = name;
  s = s.replace(/^a\s+marvel\s+television\s+special\s+presentation\s*[\u2013:\-]\s*/i, '');
  s = s.replace(/^marvel\s+studios[\u2019']?\s*/i, '');
  s = s.replace(/^a\s+netflix\s+(original\s+)?(film|series|movie|event)\s*[\u2013:\-]\s*/i, '');
  s = s.replace(/^dc\s+studios?\s*[\u2013:\-]\s*/i, '');
  s = s.replace(/^special\s+presentation\s*[\u2013:\-]\s*/i, '');
  return s.trim();
}

async function lookup(work) {
  const cleaned = cleanTitleForSearch(work.name);
  const q = extractEnglishTitle(cleaned) || cleaned;
  const isMovie = work.is_movie || work.category === 'movie';
  const kind = isMovie ? 'movie' : 'tv';
  let search = await tmdb(`search/${kind}`, { query: q, year: work.year || undefined });
  if (!search?.results?.length) search = await tmdb(`search/${kind}`, { query: q });
  if (!search?.results?.length && q !== cleaned) search = await tmdb(`search/${kind}`, { query: cleaned });
  const hit = search?.results?.[0];
  if (!hit) return null;

  const details = await tmdb(`${kind}/${hit.id}`, {});
  const genres = (details?.genres || []).map((g) => g.name).filter(Boolean);
  const country = (details?.production_countries || [])[0]?.name || null;
  const countryCode = (details?.production_countries || [])[0]?.iso_3166_1 || null;
  const lang = hit.original_language || details?.original_language || null;
  const year = (hit.release_date || hit.first_air_date || '').slice(0, 4) || work.year;
  return {
    tmdb_id: hit.id,
    poster: hit.poster_path ? IMG + hit.poster_path : null,
    backdrop: hit.backdrop_path ? IMG + hit.backdrop_path : null,
    story: (hit.overview || details?.overview || '').trim() || null,
    rating: hit.vote_average || 0,
    votes: hit.vote_count || 0,
    year: year || null,
    genre: genres.join('\u060c ') || null,
    country, countryCode, lang,
    original_title: hit.original_title || hit.original_name || null,
    runtime: details?.runtime || (details?.episode_run_time || [])[0] || null,
    adult: hit.adult === true || details?.adult === true,
  };
}

/** Infer subcategory (sub + label) from TMDB lang/country and the work category. */
function inferSub(work, meta) {
  const cat = work.category; // series | movie | anime
  if (cat === 'anime') return { sub: 'anime', subLabel: '\u0623\u0646\u0645\u064a' };
  const lang = (meta?.lang || '').toLowerCase();
  const cc = (meta?.countryCode || '').toUpperCase();
  const isMovie = work.is_movie || cat === 'movie';
  // region buckets
  let region = 'foreign';
  if (lang === 'tr' || cc === 'TR') region = 'turkish';
  else if (['ko','ja','zh','cn','th','vi','id','tl'].includes(lang) || ['KR','JP','CN','TW','HK','TH','VN','ID','PH'].includes(cc)) region = 'asian';
  else if (['hi','ta','te','ml','kn','bn','pa','ur'].includes(lang) || cc === 'IN') region = 'indian';
  else region = 'foreign';
  const map = {
    turkish: { movie: ['turkish-movies', '\u0623\u0641\u0644\u0627\u0645 \u062a\u0631\u0643\u064a'], series: ['turkish-series', '\u0645\u0633\u0644\u0633\u0644\u0627\u062a \u062a\u0631\u0643\u064a'] },
    asian:   { movie: ['asian-movies', '\u0623\u0641\u0644\u0627\u0645 \u0622\u0633\u064a\u0648\u064a'], series: ['asian-series', '\u0645\u0633\u0644\u0633\u0644\u0627\u062a \u0622\u0633\u064a\u0648\u064a'] },
    indian:  { movie: ['indian-movies', '\u0623\u0641\u0644\u0627\u0645 \u0647\u0646\u062f\u064a'], series: ['indian-series', '\u0645\u0633\u0644\u0633\u0644\u0627\u062a \u0647\u0646\u062f\u064a'] },
    foreign: { movie: ['foreign-movies', '\u0623\u0641\u0644\u0627\u0645 \u0623\u062c\u0646\u0628\u064a'], series: ['foreign-series', '\u0645\u0633\u0644\u0633\u0644\u0627\u062a \u0623\u062c\u0646\u0628\u064a'] },
  };
  const [sub, subLabel] = map[region][isMovie ? 'movie' : 'series'];
  return { sub, subLabel };
}

function buildTitle(work, meta) {
  const slugBase = makeSlug(work.name);
  const category = work.category === 'anime' ? 'anime' : (work.is_movie || work.category === 'movie' ? 'movie' : 'series');
  const categoryLabel = category === 'movie' ? '\u0641\u064a\u0644\u0645' : category === 'anime' ? '\u0623\u0646\u0645\u064a' : '\u0645\u0633\u0644\u0633\u0644';
  const { sub, subLabel } = inferSub(work, meta);
  const isMovie = category === 'movie';

  let seasons = [];
  if (isMovie) {
    seasons = [{
      season: 1, episodes_count: 1,
      episodes: [{
        episode: 1, title: work.name,
        servers: (work.movie_servers || []).map((s, i) => ({ id: i + 1, label: s.label, url: s.url })),
      }],
    }];
  } else {
    const bySeason = new Map();
    for (const ep of (work.episodes || [])) {
      const sn = ep.s ?? 1;
      if (!bySeason.has(sn)) bySeason.set(sn, []);
      bySeason.get(sn).push(ep);
    }
    seasons = [...bySeason.entries()].sort((a, b) => a[0] - b[0]).map(([sn, eps]) => ({
      season: sn,
      episodes_count: eps.length,
      episodes: eps.sort((a, b) => (a.e ?? 0) - (b.e ?? 0)).map((e) => ({
        episode: e.e ?? 1,
        title: e.t || `\u0627\u0644\u062d\u0644\u0642\u0629 ${e.e ?? 1}`,
        servers: (e.sv || []).map((s, i) => ({ id: i + 1, label: s.label, url: s.url })),
      })),
    }));
  }
  const episodesCount = seasons.reduce((n, s) => n + s.episodes.length, 0);
  const year = meta?.year || work.year || null;
  const engForPoster = extractEnglishTitle(work.name) || work.name;

  const fallbackPoster = 'https://placehold.co/500x750/0f172a/06b6d4?text=' +
    encodeURIComponent(String(engForPoster).slice(0, 24));
  const poster = meta?.poster || work.poster || fallbackPoster;
  const story = meta?.story ||
    `\u0634\u0627\u0647\u062f ${work.name} \u0645\u062a\u0631\u062c\u0645 \u0627\u0648\u0646 \u0644\u0627\u064a\u0646 \u0628\u062c\u0648\u062f\u0629 \u0639\u0627\u0644\u064a\u0629 \u0639\u0644\u0649 \u0633\u064a\u0646\u0645\u0627 \u0628\u0644\u0633 \u0645\u0639 \u0631\u0648\u0627\u0628\u0637 \u0645\u0634\u0627\u0647\u062f\u0629 \u0645\u0628\u0627\u0634\u0631\u0629 \u0633\u0631\u064a\u0639\u0629.`;

  const sortRecent = year ? new Date(`${year}-01-01`).getTime() : 0;
  return {
    slug: slugBase,
    clean_title: work.name,
    raw_name: work.name,
    category,
    category_label: categoryLabel,
    subcategory: sub,
    subcategory_label: subLabel,
    is_new: true,
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
    duration: meta?.runtime ? `${meta.runtime} \u062f\u0642\u064a\u0642\u0629` : null,
    language: '\u0645\u062a\u0631\u062c\u0645',
    country: meta?.country || null,
    director: null,
    stars: null,
    genre: meta?.genre || null,
    trailerId: null,
    rating: meta?.rating || null,
    imdb_rating: work.imdb_rating || null,
    tmdb_id: meta?.tmdb_id || null,
    tmdb_url: meta?.tmdb_id ? `https://www.themoviedb.org/${isMovie ? 'movie' : 'tv'}/${meta.tmdb_id}` : null,
    original_title: meta?.original_title || null,
    tmdb_vote: meta?.rating || 0,
    tmdb_votes: meta?.votes || 0,
    release_date: year ? `${year}-01-01` : undefined,
    sort_rating: meta?.rating || 0,
    sort_recent: sortRecent,
    real_plot: !!meta?.story,
    is_special: false,
    source: 'topcinemaa',
    adult: isAdultContent({
      name: `${work.name} ${meta?.original_title || ''}`,
      genre: meta?.genre || '',
      adult: meta?.adult === true,
    }),
  };
}

async function main() {
  const works = JSON.parse(readFileSync(NEW_IN, 'utf8'));
  const cache = existsSync(CACHE_PATH) ? JSON.parse(readFileSync(CACHE_PATH, 'utf8')) : {};

  const todo = works.filter((w) => !(w.name in cache));
  const batch = LIMIT > 0 ? todo.slice(0, LIMIT) : todo;
  console.log(`[tc-tmdb] new works: ${works.length} | cached: ${Object.keys(cache).length} | fetching now: ${batch.length}`);

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
      console.log(`[tc-tmdb] enriched ${done}/${batch.length} (saved cache)`);
    }
  }
  writeFileSync(CACHE_PATH, JSON.stringify(cache));

  // build titles from cache
  const built = [];
  let enriched = 0, adult = 0;
  const subCounts = {};
  for (const w of works) {
    const meta = cache[w.name];
    const m = meta && !meta._miss ? meta : null;
    const t = buildTitle(w, m);
    if (t.adult) { adult++; continue; } // skip adult per site policy
    if (m) enriched++;
    subCounts[t.subcategory] = (subCounts[t.subcategory] || 0) + 1;
    built.push(t);
  }
  writeFileSync(BUILT_OUT, JSON.stringify(built));
  console.log(`[tc-tmdb] built ${built.length} titles (${enriched} TMDB-enriched, ${adult} adult skipped)`);
  console.log('[tc-tmdb] by sub:', subCounts);
}

main().catch((e) => { console.error(e); process.exit(1); });
