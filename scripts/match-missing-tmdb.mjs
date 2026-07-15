/**
 * Match works that still have NO tmdb_id to a TMDB entry — STRICT matching.
 *
 * A wrong TMDB link (someone else's plot/cast) hurts indexing and trust more
 * than a missing one, so this script only commits a match when confidence is
 * high. Everything else goes to unmatched-report.json for manual review.
 *
 * Confidence rules (a match is accepted only if BOTH hold):
 *   1. Normalised title similarity between the query (Latin title) and the
 *      TMDB result's title/original_title is >= 0.82 (token Jaccard + prefix).
 *   2. If the work has a year, the TMDB year must be within ±1. If the work has
 *      NO year, the title similarity must be >= 0.92 (stricter, since we cannot
 *      disambiguate by date).
 *
 * On a confident match it writes only the identity fields (tmdb_id, tmdb_type,
 * tmdb_url) — the enrichment itself is then done by enrich-cast.mjs on the next
 * run (which fills cast/overview/genres/etc. for every work that has a tmdb_id).
 *
 * Resumable via match-cache.json keyed by slug. Never overwrites an existing
 * tmdb_id. Operational fields are never touched.
 *
 * Env: TMDB_TOKEN | TMDB_READ_TOKEN (required); LIMIT=N; CONCURRENCY=N (def 6)
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { extractEnglishTitle, extractYear } from './lib-ingest.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const ALL_PATH = join(root, 'src/data/generated/all.json');
const CACHE_PATH = join(root, 'src/data/generated/match-cache.json');
const UNMATCHED_PATH = join(root, 'src/data/generated/unmatched-report.json');

const TOKEN = process.env.TMDB_TOKEN || process.env.TMDB_READ_TOKEN;
if (!TOKEN) { console.error('TMDB token required'); process.exit(1); }
const LIMIT = Number(process.env.LIMIT || 0);
const CONCURRENCY = Number(process.env.CONCURRENCY || 6);
const MERGE_ONLY = process.env.MERGE_ONLY === '1';
// In DRY_RUN we probe matches + write a preview report, but never touch all.json.
const DRY_RUN = process.env.DRY_RUN === '1';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function tmdb(path, params = {}) {
  const url = new URL(`https://api.themoviedb.org/3/${path}`);
  for (const [k, v] of Object.entries(params)) if (v != null) url.searchParams.set(k, v);
  for (let attempt = 0; attempt < 4; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 15000);
    try {
      const res = await fetch(url, { headers: { Authorization: `Bearer ${TOKEN}` }, signal: ctrl.signal });
      clearTimeout(timer);
      if (res.status === 429) { await sleep(1200 * (attempt + 1)); continue; }
      if (!res.ok) return null;
      return await res.json();
    } catch {
      clearTimeout(timer);
      await sleep(400 * (attempt + 1));
    }
  }
  return null;
}

/* ── string similarity ── */
function norm(s) {
  return (s || '')
    .toLowerCase()
    .replace(/[^a-z0-9\u0600-\u06FF ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
function tokens(s) { return new Set(norm(s).split(' ').filter(Boolean)); }
function jaccard(a, b) {
  const A = tokens(a), B = tokens(b);
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const x of A) if (B.has(x)) inter++;
  return inter / (A.size + B.size - inter);
}
function similarity(q, cand) {
  const j = jaccard(q, cand);
  const nq = norm(q), nc = norm(cand);
  // prefix boost when one string starts with the other
  const prefix = (nq && nc && (nc.startsWith(nq) || nq.startsWith(nc))) ? 0.15 : 0;
  return Math.min(1, j + prefix);
}

function tmdbYear(hit) {
  return ((hit.release_date || hit.first_air_date || '') + '').slice(0, 4);
}

/** Decode common HTML entities and normalise curly punctuation before matching. */
function cleanSource(s) {
  return (s || '')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/[\u2018\u2019]/g, "'")   // curly single quotes → straight
    .replace(/[\u201C\u201D]/g, '"');  // curly double quotes → straight
}

/** Strict lookup → { tmdb_id, tmdb_type, score } or null (with reason). */
async function matchWork(work) {
  const src = cleanSource(work.clean_title || work.raw_name || '');
  const srcOrig = cleanSource(work.original_title || '');
  const latin = extractEnglishTitle(src) || extractEnglishTitle(srcOrig) || '';
  const query = (latin || '').trim();
  if (!query || query.length < 2) return { _reason: 'no_latin_title' };

  const workYear = work.year || extractYear(work.raw_name || '') || null;
  const kinds = work.category === 'movie' ? ['movie'] : ['tv', 'movie'];

  let best = null;
  for (const kind of kinds) {
    const search = await tmdb(`search/${kind}`, {
      query,
      year: kind === 'movie' && workYear ? workYear : undefined,
      first_air_date_year: kind === 'tv' && workYear ? workYear : undefined,
      include_adult: 'false',
    });
    for (const hit of (search?.results || []).slice(0, 5)) {
      const cand = hit.title || hit.name || '';
      const candOrig = hit.original_title || hit.original_name || '';
      const score = Math.max(similarity(query, cand), similarity(query, candOrig));
      const y = tmdbYear(hit);
      let yearOk = true;
      if (workYear && y) yearOk = Math.abs(Number(workYear) - Number(y)) <= 1;
      const threshold = workYear ? 0.82 : 0.92;
      const accept = score >= threshold && yearOk;
      if (accept && (!best || score > best.score)) {
        best = { tmdb_id: hit.id, tmdb_type: kind, score: Number(score.toFixed(3)), matched_title: cand || candOrig, tmdb_year: y };
      }
    }
    if (best) break;
  }
  if (best) return best;
  return { _reason: 'below_threshold', query };
}

async function main() {
  const all = JSON.parse(readFileSync(ALL_PATH, 'utf8'));
  const cache = existsSync(CACHE_PATH) ? JSON.parse(readFileSync(CACHE_PATH, 'utf8')) : {};

  if (!MERGE_ONLY) {
    const missing = all.filter((t) => !t.tmdb_id);
    const todo = missing.filter((t) => !(t.slug in cache));
    const batch = LIMIT > 0 ? todo.slice(0, LIMIT) : todo;
    console.log(`[match] missing tmdb_id: ${missing.length} | cached: ${Object.keys(cache).length} | matching now: ${batch.length}`);

    let done = 0;
    const flush = () => writeFileSync(CACHE_PATH, JSON.stringify(cache));
    for (let i = 0; i < batch.length; i += CONCURRENCY) {
      const slice = batch.slice(i, i + CONCURRENCY);
      await Promise.all(slice.map(async (w) => {
        cache[w.slug] = await matchWork(w);
        done++;
      }));
      if (done % 120 === 0 || i + CONCURRENCY >= batch.length) {
        flush();
        console.log(`[match] processed ${done}/${batch.length}`);
      }
      await sleep(150);
    }
    flush();
  }

  /* ── merge confident matches into all.json ── */
  let matched = 0;
  const unmatched = [];
  const matchedSamples = [];
  for (const t of all) {
    if (t.tmdb_id) continue;
    const m = cache[t.slug];
    if (m && m.tmdb_id) {
      if (!DRY_RUN) {
        t.tmdb_id = m.tmdb_id;
        t.tmdb_type = m.tmdb_type;
        t.tmdb_url = `https://www.themoviedb.org/${m.tmdb_type}/${m.tmdb_id}`;
        t.tmdb_match_score = m.score;
      }
      matched++;
      matchedSamples.push({
        slug: t.slug,
        title: t.clean_title || t.raw_name,
        year: t.year || null,
        tmdb_type: m.tmdb_type,
        tmdb_id: m.tmdb_id,
        matched_title: m.matched_title,
        tmdb_year: m.tmdb_year,
        score: m.score,
      });
    } else {
      unmatched.push({
        slug: t.slug,
        category: t.category,
        title: t.clean_title || t.raw_name,
        year: t.year || null,
        reason: (m && m._reason) || 'not_processed',
        query: (m && m.query) || null,
      });
    }
  }
  if (!DRY_RUN) writeFileSync(ALL_PATH, JSON.stringify(all));
  writeFileSync(UNMATCHED_PATH, JSON.stringify({
    generated_at: new Date().toISOString(),
    dry_run: DRY_RUN,
    total_missing: matched + unmatched.length,
    newly_matched: matched,
    still_unmatched: unmatched.length,
    matched_samples: matchedSamples.slice(0, 40),
    items: unmatched,
  }, null, 2));

  console.log(`[match] newly matched: ${matched} | still unmatched: ${unmatched.length}${DRY_RUN ? ' (DRY_RUN — all.json untouched)' : ''}`);
  if (!DRY_RUN) console.log('[match] wrote all.json. Re-run enrich-cast.mjs to enrich the new matches.');
}

main().catch((e) => { console.error(e); process.exit(1); });
