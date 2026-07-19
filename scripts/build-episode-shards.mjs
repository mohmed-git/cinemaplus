/**
 * Build per-title episode shards (streaming, dependency-free, low-memory).
 *
 * Reads the master src/data/generated/all.json and writes ONE small JSON file
 * per episodic title (series/anime with >1 episode) into public/_data/episodes/.
 *
 * Why shards: the SSR episode pages must NOT bundle the 86MB all.json (that OOMs
 * the build and blows the Cloudflare Worker size limit). Each title is emitted
 * as a PLAIN STATIC asset and fetched at request time, so a request only ever
 * pulls in the one title it needs. The shards carry the exact same Title objects
 * the static pages use, so episode content stays identical across the site.
 *
 * Why streaming: all.json is ~86MB. `JSON.parse(readFileSync(...))` peaks well
 * above 1GB and gets OOM-killed on small machines. Instead we walk the file as a
 * stream and carve out each top-level array element by tracking brace/bracket
 * depth (string- and escape-aware), parsing one Title object at a time. Peak
 * memory stays at roughly the size of a single title.
 *
 * Slugs can contain non-ASCII (Arabic) chars, so the on-disk filename is a
 * base64url of the UTF-8 slug; a manifest maps slug -> filename.
 */
import { createReadStream, writeFileSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { isAdultContent } from './lib-ingest.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const allPath = join(root, 'src/data/generated/all.json');
const outDir = join(root, 'public/_data/episodes');
const similarDir = join(root, 'public/_data/similar');
const manifestPath = join(root, 'src/data/generated/episode-manifest.json');
const routeIndexPath = join(root, 'src/data/generated/episode-routes.json');

// Gateway (watch) buckets. Detail pages (old + new works) are all static now,
// but the watch page stays SSR: each work's slim "gateway payload" (slug, title,
// poster, category, seasons+servers) is loaded from a hashed bucket file at
// request time via loadOldGateway(). This keeps the ~15k watch pages out of the
// static file count (Cloudflare Pages' 20,000-file limit) and the catalogue out
// of the Worker bundle. Covers BOTH /g (old) and /gw (new) — same loader.
const oldGwDir = join(root, 'public/_data/oldgw');



function slugToFile(slug) {
  return Buffer.from(slug, 'utf8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

/**
 * Bucket count for NEW-work shards.
 *
 * Cloudflare Pages caps a deployment at 20,000 files. Emitting ONE shard per new
 * work (~12.8k files) blew that limit. Instead we group the new works into a
 * fixed, small number of bucket files keyed by a stable hash of the slug, so the
 * file count stays constant regardless of catalogue size. The runtime loader
 * computes the SAME hash on the edge, fetches just that one bucket, and pulls the
 * work out of it. 256 buckets ⇒ ~50 works/bucket ⇒ ~135KB/bucket (well cached).
 *
 * MUST stay in sync with src/lib/newWorks.ts `NEW_BUCKETS` + `slugToBucket`.
 */
const NEW_BUCKETS = 256;

/** FNV-1a (32-bit) → stable bucket index. Mirrored in newWorks.ts. */
function slugToBucket(slug) {
  let h = 0x811c9dc5;
  for (let i = 0; i < slug.length; i++) {
    h ^= slug.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0) % NEW_BUCKETS;
}

function isEpisodic(t) {
  return (
    (t.category === 'series' || t.category === 'anime') &&
    t.episodes_count > 1 &&
    Array.isArray(t.seasons) &&
    t.seasons.length > 0
  );
}

/**
 * Is this work a TV program (reality / talk / news / stand-up) rather than a
 * "proper" film or scripted series? The site owner wants these kept OFF the
 * first page of each section because they read as "strange / unappealing" to a
 * new visitor. Detected from the genre and the "برنامج" name prefix the ingest
 * step adds. We do NOT delete them — just push them to the back.
 */
const PROGRAM_GENRES = /(?:واقع|حوار|أخبار|talk|reality|news)/i;
const PROGRAM_NAME = /^\s*(?:برنامج|عرض)\b|talk show|stand[\s-]?up/i;
function isTvProgram(t) {
  const genre = String(t.genre || '');
  const name = `${t.clean_title || ''} ${t.raw_name || ''}`;
  return PROGRAM_GENRES.test(genre) || PROGRAM_NAME.test(name);
}

/**
 * Trust-weighted quality score for default ordering. A bare TMDB average is
 * misleading when only a handful of people voted (a 1-vote "10/10" obscure
 * title would otherwise top the list). We use a Bayesian shrink toward the
 * global mean (~6.5) so a high score needs enough votes to be believed, then
 * nudge by recency. Returns a single sortable number (higher = better).
 */
const RATING_PRIOR = 6.5;   // assumed mean rating
const RATING_CONFIDENCE = 60; // votes needed before the raw average dominates
function qualityScore(t) {
  const r = Number(t.rating ?? t.tmdb_vote ?? 0) || 0;
  const v = Number(t.votes ?? t.tmdb_votes ?? 0) || 0;
  // Bayesian average: pulls low-vote ratings toward the prior.
  const bayes = (v / (v + RATING_CONFIDENCE)) * r + (RATING_CONFIDENCE / (v + RATING_CONFIDENCE)) * RATING_PRIOR;
  // Small popularity bonus (log of votes) so well-known titles rise.
  const pop = Math.log10(1 + v) * 0.15;
  // Tiny recency nudge (newer works slightly preferred among equals).
  const year = Number(String(t.year || '').slice(0, 4)) || 0;
  const recency = year >= 2015 ? (year - 2015) * 0.01 : 0;
  return bayes + pop + recency;
}

/**
 * Genre-interleave a quality-sorted list so the FIRST page of a section shows a
 * variety of genres instead of (say) 36 dramas in a row. Works in windows: it
 * round-robins across the primary genre of each item while preserving the
 * overall quality ranking as much as possible. Items keep their relative order
 * within a genre. Non-destructive to the tail (it just reshuffles the head's
 * neighbours for variety).
 */
function primaryGenre(e) {
  return String(e.genre || '').split(/[،,]/)[0].trim() || 'غير مصنف';
}
function genreInterleave(list) {
  if (list.length <= 12) return list;
  // Build per-genre queues (already in quality order).
  const queues = new Map();
  for (const e of list) {
    const g = primaryGenre(e);
    if (!queues.has(g)) queues.set(g, []);
    queues.get(g).push(e);
  }
  // Order genres by their best item's position (so strongest genres lead).
  const genreOrder = [...queues.keys()];
  const out = [];
  let remaining = list.length;
  while (remaining > 0) {
    for (const g of genreOrder) {
      const q = queues.get(g);
      if (q && q.length) { out.push(q.shift()); remaining--; }
    }
  }
  return out;
}

if (existsSync(outDir)) rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });
if (existsSync(similarDir)) rmSync(similarDir, { recursive: true, force: true });
mkdirSync(similarDir, { recursive: true });
if (existsSync(oldGwDir)) rmSync(oldGwDir, { recursive: true, force: true });
mkdirSync(oldGwDir, { recursive: true });

const manifest = {};
const routeIndex = [];

// Gateway payloads → hashed buckets (bucket -> { slug: GatewayPayload }).
// Replaces the ~5.8k statically-built /g pages with NEW_BUCKETS files served via
// SSR, removing the last big chunk of the deployment's file count.
const oldGwBuckets = {}; // bucketIndex -> { slug: { slug, clean_title, category, poster, seasons } }
let oldGwCount = 0;

// Slim "similar titles" index, sharded by category. Each entry only carries the
// card-level fields getSimilarTitlesLite needs to score + render related cards.
// Emitted as PLAIN STATIC assets so the SSR Worker never bundles the 5MB index.
const similarByCategory = {};
let episodicCount = 0;
let scanned = 0;

/**
 * Stream the top-level JSON array, yielding each element's raw JSON string.
 * Tracks depth only outside of strings, honouring escape sequences.
 */
let skippedAdult = 0;

function processObject(jsonText) {
  const t = JSON.parse(jsonText);
  scanned++;

  // ── Adult / indecent content gate ─────────────────────────────────────────
  // The user asked to exclude any indecent / semi-pornographic work. We apply
  // the blocklist to BOTH new (CSV-ingested) and old works so nothing slips
  // into the listings, similar rails or per-subcategory indexes. We rely on
  // TMDB's `adult` flag (when captured) plus a keyword blocklist over the work's
  // names + genre.
  if (
    isAdultContent({
      name: `${t.clean_title || ''} ${t.raw_name || ''} ${t.original_title || ''}`,
      title: t.clean_title || '',
      genre: t.genre || '',
      adult: t.adult === true,
    })
  ) {
    skippedAdult++;
    return; // never emit a shard, route or index entry for it
  }

  // Collect a slim "similar" entry for EVERY title (movies included as cards
  // can be recommended too) into its category bucket. Only the fields the
  // runtime scorer/renderer needs — keeps each category file small.
  const cat = t.category;
  if (cat) {
    // Gateway (watch) payload → hashed bucket. As of the "revert to static"
    // change BOTH the old catalogue and the new (CSV-ingested) works build as
    // ordinary static /f /d /n detail pages, and BOTH watch through the same
    // SSR gateway (/g for old, /gw for new — identical loader). So we emit a
    // gateway payload for EVERY work (old + new), keyed by slug hash. Only the
    // fields the gateway player needs: identity + seasons/servers.
    oldGwCount++;
    const gb = slugToBucket(t.slug);
    (oldGwBuckets[gb] ??= {})[t.slug] = {
      slug: t.slug,
      clean_title: t.clean_title,
      category: t.category,
      category_label: t.category_label ?? null,
      poster: t.poster ?? null,
      episodes_count: t.episodes_count ?? 0,
      url: t.url ?? null,
      seasons: Array.isArray(t.seasons)
        ? t.seasons.map((s) => ({
            season: s.season,
            episodes: Array.isArray(s.episodes)
              ? s.episodes.map((e) => ({
                  episode: e.episode,
                  servers: Array.isArray(e.servers)
                    ? e.servers.map((sv) => ({ id: sv.id, label: sv.label, url: sv.url }))
                    : [],
                }))
              : [],
          }))
        : [],
    };
  }
  if (cat && !t.is_new) {
    (similarByCategory[cat] ??= []).push({
      slug: t.slug,
      clean_title: t.clean_title,
      category: t.category,
      category_label: t.category_label,
      poster: t.poster ?? null,
      year: t.year ?? null,
      episodes_count: t.episodes_count ?? 0,
      seasons_count: t.seasons_count ?? 0,
      genre: t.genre ?? null,
      rating: t.rating ?? 0,
      votes: t.votes ?? 0,
      sort_rating: t.sort_rating ?? 0,
      sort_recent: t.sort_recent ?? 0,
      is_special: !!t.is_special,
      country: t.country ?? null,
    });
  }

  // NEW works (CSV-ingested) now build as ordinary STATIC /f /d /n detail pages
  // (single page per work, episode buttons link straight to the /gw gateway), so
  // they no longer need SSR buckets, a per-subcategory card index, or a dedicated
  // SSR sitemap route list. They still contribute an episode shard below like any
  // other episodic work.
  if (!isEpisodic(t)) return;

  episodicCount++;
  const file = slugToFile(t.slug);
  writeFileSync(join(outDir, `${file}.json`), JSON.stringify(t));
  manifest[t.slug] = file;

  routeIndex.push({
    s: t.slug,
    c: t.category, // 'series' | 'anime'
    z: [...t.seasons]
      .filter((season) => Array.isArray(season.episodes) && season.episodes.length > 0)
      .sort((a, b) => a.season - b.season)
      .map((season) => [
        season.season,
        [...season.episodes].sort((a, b) => a.episode - b.episode).map((e) => e.episode),
      ]),
  });
}

// Incremental state machine. `buf` only ever holds the bytes of the element
// currently being assembled (plus a little lookahead), so memory stays tiny.
let buf = '';        // bytes of the in-progress element (from its opening '{')
let depth = 0;       // brace depth of the in-progress element
let inString = false;
let escaped = false;
let started = false; // have we passed the opening top-level '['?
let collecting = false; // are we currently inside a top-level element?

const stream = createReadStream(allPath, { encoding: 'utf8', highWaterMark: 1 << 20 });

stream.on('data', (chunk) => {
  for (let i = 0; i < chunk.length; i++) {
    const ch = chunk[i];

    if (!started) {
      // Skip whitespace until the opening top-level '['.
      if (ch === '[') started = true;
      continue;
    }

    if (collecting) {
      buf += ch;
      if (inString) {
        if (escaped) escaped = false;
        else if (ch === '\\') escaped = true;
        else if (ch === '"') inString = false;
        continue;
      }
      if (ch === '"') { inString = true; continue; }
      if (ch === '{') depth++;
      else if (ch === '}') {
        depth--;
        if (depth === 0) {
          // Completed one top-level element.
          processObject(buf);
          buf = '';
          collecting = false;
        }
      }
      continue;
    }

    // Between elements: wait for the next element's opening '{'.
    if (ch === '{') {
      collecting = true;
      depth = 1;
      buf = '{';
    }
    // commas / whitespace / closing ']' are ignored here.
  }
});

stream.on('end', () => {
  writeFileSync(manifestPath, JSON.stringify(manifest));
  writeFileSync(routeIndexPath, JSON.stringify(routeIndex));

  // Emit one slim similar-index per category as a STATIC asset. The SSR episode
  // routes fetch only their own category file at request time, so the 5MB index
  // is never bundled into the Worker.
  for (const [cat, entries] of Object.entries(similarByCategory)) {
    writeFileSync(join(similarDir, `${cat}.json`), JSON.stringify(entries));
    console.log(`[episode-shards] similar/${cat}.json -> ${entries.length} titles`);
  }

  // Gateway (watch) buckets — one hashed bucket file per NEW_BUCKETS slice,
  // covering BOTH old and new works. Served via SSR (/g + /gw) so the ~15k watch
  // pages never enter the static file count.
  let oldGwFiles = 0;
  for (const [b, works] of Object.entries(oldGwBuckets)) {
    writeFileSync(join(oldGwDir, `${b}.json`), JSON.stringify(works));
    oldGwFiles++;
  }
  console.log(`[episode-shards] gateway buckets: ${oldGwFiles} files for ${oldGwCount} works (NEW_BUCKETS=${NEW_BUCKETS})`);
  console.log(`[episode-shards] skipped ${skippedAdult} adult/indecent works`);


  console.log(`[episode-shards] scanned ${scanned} titles`);
  console.log(`[episode-shards] wrote ${episodicCount} shards -> public/_data/episodes/`);
  console.log(`[episode-shards] manifest -> src/data/generated/episode-manifest.json`);
  console.log(`[episode-shards] route index (${routeIndex.length} titles) -> src/data/generated/episode-routes.json`);
});

stream.on('error', (err) => {
  console.error('[episode-shards] stream error:', err);
  process.exit(1);
});
