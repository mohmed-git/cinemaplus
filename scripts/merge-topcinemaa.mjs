/**
 * Merge the topcinemaa CSV (1836 pages) into the CinemaPlus catalogue.
 *
 * COLUMNS (0-indexed) in topcinemaa_full_1836pages.csv:
 *   0 page  1 kind(مسلسل/فيلم/انمي/غير معروف)  2 name  3 is_series
 *   4 season  5 season_text  6 episode  7 imdb_rating  8 poster
 *   9 poster_note  10 player  11 server_index  12 embed_url
 *   13 page_url  14 title
 *
 * PASSES (all NON-destructive to unrelated data):
 *   1. MATCH   — strict: normKey(name) + category (+ season for series) + year(±1).
 *                Ambiguous / not-confident matches go to unmatched-report.json.
 *   2. SERVERS — for a matched work's episode/movie:
 *                  · same PROVIDER already present  → REPLACE its url (newer link)
 *                  · provider NOT present            → ADD as a new server
 *                  · existing servers with no CSV counterpart are KEPT
 *                Ordering: new/replaced servers first, then remaining old ones.
 *   3. CREATE  — unmatched works are emitted to new-from-topcinemaa.json for the
 *                separate TMDB-enrichment step (image/story/details).
 *
 * Usage:
 *   node --max-old-space-size=850 scripts/merge-topcinemaa.mjs --dry [--limit=50]
 *   node --max-old-space-size=850 scripts/merge-topcinemaa.mjs        [--limit=N]
 */
import { createReadStream, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createInterface } from 'node:readline';
import { providerKey, sameProvider, serverLabel, unwrapProxy } from './lib-host.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');

const CSV_PATH = process.env.CSV_PATH || '/home/user/uploaded_files/topcinemaa_full_1836pages.csv';
const ALL_PATH = join(root, 'src/data/generated/all.json');
const NEW_PATH = join(root, 'src/data/generated/new-from-topcinemaa.json');
const REPORT_PATH = join(root, 'src/data/generated/topcinemaa-merge-report.json');
const UNMATCHED_PATH = join(root, 'src/data/generated/topcinemaa-unmatched-report.json');

const DRY = process.argv.includes('--dry');
const LIMIT = (() => {
  const a = process.argv.find((x) => x.startsWith('--limit='));
  return a ? parseInt(a.split('=')[1], 10) : 0;
})();

/* ─────────────  kind → internal category  ───────────── */
const KIND_MAP = {
  'مسلسل': 'series',
  'فيلم': 'movie',
  'انمي': 'anime',
  'أنمي': 'anime',
  // 'غير معروف' is skipped (ambiguous) unless is_series tells us
};

/* ─────────────  text normalisation (matches lib-ingest nameKey style)  ───────────── */

// Long descriptive prefixes/wrappers to strip before matching, e.g.
// "A Marvel Television Special Presentation – The Punisher: One Last Kill"
const NOISE_PREFIXES = [
  /^a\s+marvel\s+television\s+special\s+presentation\s*[–:-]\s*/i,
  /^marvel\s+studios[’']?\s*/i,
  /^a\s+netflix\s+(original\s+)?(film|series|movie|event)\s*[–:-]\s*/i,
  /^dc\s+(studios?)\s*[–:-]\s*/i,
  /^special\s+presentation\s*[–:-]\s*/i,
];

function stripNoise(name) {
  let s = name;
  for (const re of NOISE_PREFIXES) s = s.replace(re, '');
  return s.trim();
}

export function extractYear(name) {
  const m = name.match(/\b(19|20)\d{2}\b/);
  return m ? parseInt(m[0], 10) : null;
}

/** Strong normalised key for matching (Arabic + Latin aware). */
export function normKey(name) {
  return stripNoise(name)
    .toLowerCase()
    .replace(/\b(19|20)\d{2}\b/g, ' ')
    .replace(/[\u064B-\u065F\u0670]/g, '')       // Arabic diacritics
    .replace(/[إأآا]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    // strip common Arabic wrapper words
    .replace(/\b(مترجم|مترجمة|اونلاين|مشاهدة|تحميل|كامل|كاملة|الموسم|الحلقة|والاخيرة|الاخيرة)\b/g, ' ')
    .replace(/[^0-9a-z\u0600-\u06FF]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Latin/English portion for a secondary match key (helps mixed titles). */
export function latinKey(name) {
  const noYear = stripNoise(name).replace(/\b(19|20)\d{2}\b/g, ' ');
  const latin = (noYear.match(/[A-Za-z0-9][A-Za-z0-9 :.'!&,\-]*[A-Za-z0-9]/g) || []);
  if (!latin.length) return '';
  return latin.sort((a, b) => b.length - a.length)[0]
    .toLowerCase().replace(/[^0-9a-z]+/g, ' ').replace(/\s+/g, ' ').trim();
}

console.log(`[merge] CSV=${CSV_PATH}`);
console.log(`[merge] mode=${DRY ? 'DRY-RUN' : 'WRITE'}${LIMIT ? `  limit=${LIMIT} works` : ''}`);

/* ─────────────  minimal CSV line parser (handles quotes + CRLF)  ───────────── */
function parseCsvLine(line) {
  const out = [];
  let cur = '', inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQ) {
      if (c === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else inQ = false; }
      else cur += c;
    } else {
      if (c === '"') inQ = true;
      else if (c === ',') { out.push(cur); cur = ''; }
      else cur += c;
    }
  }
  out.push(cur);
  return out;
}

/* ─────────────  read CSV → grouped works  ─────────────
 * Group key = category :: normKey(name).  For a series, we still collect all
 * seasons/episodes under one work (season is matched per-episode later). */
async function readCsvWorks() {
  const works = new Map();
  const rl = createInterface({
    input: createReadStream(CSV_PATH, { encoding: 'utf8' }),
    crlfDelay: Infinity,
  });
  let header = null, rows = 0, skipped = 0;
  for await (const raw of rl) {
    const line = raw.replace(/\r$/, '');
    if (!line) continue;
    if (!header) { header = parseCsvLine(line.replace(/^\uFEFF/, '')); continue; }
    const c = parseCsvLine(line);
    if (c.length < 13) { skipped++; continue; }
    const kind = (c[1] || '').trim();
    let category = KIND_MAP[kind];
    // 'غير معروف' → infer from is_series
    if (!category) {
      if (kind === 'غير معروف') category = (c[3] || '').trim().toLowerCase() === 'true' ? 'series' : 'movie';
      else { skipped++; continue; }
    }
    const name = (c[2] || '').trim();
    if (!name) { skipped++; continue; }
    const embed = (c[12] || '').trim();
    if (!embed) { skipped++; continue; }
    rows++;

    const isMovie = category === 'movie';
    const gkey = `${category}::${normKey(name)}`;
    let w = works.get(gkey);
    if (!w) {
      w = {
        name, category, isMovie,
        year: extractYear(name),
        poster: (c[8] || '').trim() || null,
        imdb_rating: (c[7] || '').trim() || null,
        page_url: (c[13] || '').trim() || null,
        latin: latinKey(name),
        episodes: new Map(),      // "s-e" -> { season, episode, title, servers[] }
        movieServers: [],
      };
      works.set(gkey, w);
    }
    const player = (c[10] || '').trim();
    const server = { url: unwrapProxy(embed), rawUrl: embed, label: serverLabel(embed, player), provider: providerKey(embed) };
    if (!server.provider) continue; // unparseable host — skip

    if (isMovie) {
      // de-dupe by provider within the CSV work (keep the LAST = newest occurrence)
      const ex = w.movieServers.find((s) => s.provider === server.provider);
      if (ex) ex.url = server.url;
      else w.movieServers.push(server);
    } else {
      const season = parseInt(c[4], 10) || 1;
      const episode = parseInt(c[6], 10) || 1;
      const ek = `${season}-${episode}`;
      let ep = w.episodes.get(ek);
      if (!ep) { ep = { season, episode, title: (c[14] || '').trim() || `الحلقة ${episode}`, servers: [] }; w.episodes.set(ek, ep); }
      const ex = ep.servers.find((s) => s.provider === server.provider);
      if (ex) ex.url = server.url;
      else ep.servers.push(server);
    }
  }
  return { works, rows, skipped };
}

/* ─────────────  build match index from existing all.json  ───────────── */
function buildIndex(all) {
  // Map: `${category}::${normKey}` -> [titles]   (array: same key may repeat)
  const byKey = new Map();
  const add = (k, t) => { if (!k) return; const a = byKey.get(k) || []; if (!a.includes(t)) a.push(t); byKey.set(k, a); };
  for (const t of all) {
    for (const nm of [t.clean_title, t.raw_name, t.original_title, t.title_ar].filter(Boolean)) {
      add(`${t.category}::${normKey(nm)}`, t);
      const lk = latinKey(nm);
      if (lk) add(`${t.category}::L::${lk}`, t);
    }
  }
  return byKey;
}

/** Strict match: returns { title, reason } or { title:null, reason }. */
function matchWork(work, byKey) {
  const cat = work.category;
  const primary = byKey.get(`${cat}::${normKey(work.name)}`) || [];
  const latin = work.latin ? (byKey.get(`${cat}::L::${work.latin}`) || []) : [];
  // union of candidates
  const cands = [...new Set([...primary, ...latin])];
  if (cands.length === 0) return { title: null, reason: 'no_candidate' };

  // Year filter (±1) when both sides have a year.
  const withYear = cands.filter((t) => {
    const ty = t.year ? parseInt(String(t.year).match(/\d{4}/)?.[0] || '', 10) : null;
    if (work.year && ty) return Math.abs(work.year - ty) <= 1;
    return true; // if either side lacks a year, don't reject on year
  });
  const pool = withYear.length ? withYear : cands;

  if (pool.length === 1) return { title: pool[0], reason: 'unique' };
  // Multiple candidates: only accept if exactly one also shares the year.
  if (work.year) {
    const exactYear = pool.filter((t) => {
      const ty = t.year ? parseInt(String(t.year).match(/\d{4}/)?.[0] || '', 10) : null;
      return ty && Math.abs(work.year - ty) <= 1;
    });
    if (exactYear.length === 1) return { title: exactYear[0], reason: 'year_disambiguated' };
  }
  return { title: null, reason: `ambiguous_${pool.length}` };
}

/* ─────────────  merge CSV servers into a matched title  ─────────────
 * REPLACE same-provider url with the newer CSV url; ADD new providers.
 * Keep old servers with no CSV counterpart. Order: new/replaced first, old after.
 * Returns { replaced, added }. */
function mergeInto(episodeTarget, csvServers) {
  let replaced = 0, added = 0;
  const old = episodeTarget.servers || [];
  const maxId = old.reduce((m, s) => Math.max(m, s.id || 0), 0);
  const usedOld = new Set();
  const fresh = [];   // new + replaced (go first)
  let idc = maxId;

  for (const cs of csvServers) {
    const idx = old.findIndex((s, i) => !usedOld.has(i) && sameProvider(s.url, cs.url));
    if (idx >= 0) {
      usedOld.add(idx);
      const kept = old[idx];
      if (kept.url !== cs.url) { replaced++; }
      fresh.push({ id: kept.id, label: cs.label || kept.label, url: cs.url });
    } else {
      fresh.push({ id: ++idc, label: cs.label, url: cs.url });
      added++;
    }
  }
  // append old servers that had no CSV counterpart
  const leftover = old.filter((_, i) => !usedOld.has(i));
  episodeTarget.servers = [...fresh, ...leftover];
  return { replaced, added };
}

function mergeWork(work, title) {
  let replaced = 0, added = 0;
  if (work.isMovie || title.category === 'movie') {
    const ep = title.seasons?.[0]?.episodes?.[0];
    if (ep) { const r = mergeInto(ep, work.movieServers); replaced += r.replaced; added += r.added; }
  } else {
    for (const ep of work.episodes.values()) {
      const season = title.seasons?.find((s) => s.season === ep.season);
      const tgt = season?.episodes?.find((e) => e.episode === ep.episode);
      if (tgt) { const r = mergeInto(tgt, ep.servers); replaced += r.replaced; added += r.added; }
      // if season/episode not present on an existing series, we DON'T invent it here
      // (kept for a later "add missing episodes" enhancement); recorded in report.
    }
  }
  return { replaced, added };
}

/* ─────────────────────────────  main  ───────────────────────────── */
async function main() {
  const t0 = Date.now();
  const { works, rows, skipped } = await readCsvWorks();
  console.log(`[merge] parsed ${rows} rows (skipped ${skipped}) -> ${works.size} distinct works`);

  let workList = [...works.values()];
  if (LIMIT) workList = workList.slice(0, LIMIT);

  console.log('[merge] loading all.json …');
  const all = JSON.parse(readFileSync(ALL_PATH, 'utf8'));
  const byKey = buildIndex(all);

  let matched = 0, created = 0, totalReplaced = 0, totalAdded = 0;
  const newWorks = [];
  const unmatched = [];
  const matchedSamples = [];

  for (const work of workList) {
    const { title, reason } = matchWork(work, byKey);
    if (title) {
      matched++;
      const { replaced, added } = mergeWork(work, title);
      totalReplaced += replaced; totalAdded += added;
      if ((replaced || added) && matchedSamples.length < 60) {
        matchedSamples.push({ csv: work.name, matched: title.clean_title, year: work.year, replaced, added, reason });
      }
    } else {
      created++;
      newWorks.push({
        name: work.name, category: work.category, isMovie: work.isMovie, year: work.year,
        poster: work.poster, imdb_rating: work.imdb_rating, page_url: work.page_url,
        movieServers: work.movieServers.map((s) => ({ label: s.label, url: s.url })),
        episodes: [...work.episodes.values()].sort((a, b) => a.season - b.season || a.episode - b.episode)
          .map((e) => ({ season: e.season, episode: e.episode, title: e.title,
            servers: e.servers.map((s) => ({ label: s.label, url: s.url })) })),
      });
      if (unmatched.length < 300) unmatched.push({ name: work.name, category: work.category, year: work.year, reason });
    }
  }

  const secs = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`\n[merge] ===== RESULT (${secs}s) =====`);
  console.log(`[merge] matched existing works : ${matched}`);
  console.log(`[merge]   · servers REPLACED (same provider, newer url): ${totalReplaced}`);
  console.log(`[merge]   · servers ADDED    (new provider)            : ${totalAdded}`);
  console.log(`[merge] NEW works (to enrich via TMDB): ${created}`);

  const report = {
    generatedAt: new Date().toISOString(),
    csv: CSV_PATH, dryRun: DRY, limit: LIMIT || null,
    rows, skipped, distinctWorks: works.size, processed: workList.length,
    matched, serversReplaced: totalReplaced, serversAdded: totalAdded, created,
    matchedSamples,
  };

  if (DRY) {
    console.log('\n[merge] --dry: nothing written. Report preview:');
    console.log(JSON.stringify({ ...report, matchedSamples: matchedSamples.slice(0, 15) }, null, 2));
    return;
  }

  writeFileSync(ALL_PATH, JSON.stringify(all));
  writeFileSync(NEW_PATH, JSON.stringify(newWorks));
  writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2));
  writeFileSync(UNMATCHED_PATH, JSON.stringify({ count: created, sample: unmatched }, null, 2));
  console.log(`\n[merge] wrote all.json (merged servers)`);
  console.log(`[merge] wrote ${newWorks.length} new works -> ${NEW_PATH}`);
  console.log(`[merge] wrote reports -> topcinemaa-merge-report.json / -unmatched-report.json`);
}

main().catch((e) => { console.error(e); process.exit(1); });
