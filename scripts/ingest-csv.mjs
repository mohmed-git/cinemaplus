/**
 * Ingest the tuktuk CSV into the CinemaPlus catalogue.
 *
 * TWO non-destructive passes:
 *   1. MERGE  — if a work already exists in all.json (matched by normalised
 *               name + category), only ADD the new iframe server to the matching
 *               episode/movie. Existing fields are never touched.
 *   2. CREATE — works with no match become brand-new Title objects. These are
 *               the only ones enriched from TMDB (separate step) and the only
 *               ones carrying a `subcategory` for the new detailed pages.
 *
 * Old works are NEVER modified except for appended servers (which is additive,
 * never overwriting). New works are appended to all.json.
 *
 * Usage:
 *   node scripts/ingest-csv.mjs --dry        # report only, write nothing
 *   node scripts/ingest-csv.mjs              # write new-works.json + merge report
 */
import { createReadStream, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createInterface } from 'node:readline';
import {
  CSV_CATEGORY_MAP, nameKey, makeSlug, extractYear, extractEnglishTitle,
  serverLabel,
} from './lib-ingest.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const CSV_PATH = process.env.CSV_PATH || '/home/user/uploaded_files/tuktuk_clean_no_adult.csv';
const ALL_PATH = join(root, 'src/data/generated/all.json');
const NEW_WORKS_PATH = join(root, 'src/data/generated/new-works.json');
const MATCH_REPORT_PATH = join(root, 'src/data/generated/merge-report.json');

const DRY = process.argv.includes('--dry');

/* ───────────────  minimal CSV line parser (RFC-4180-ish)  ─────────────── */
function parseCsvLine(line) {
  const out = [];
  let cur = '';
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQ) {
      if (c === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; }
        else inQ = false;
      } else cur += c;
    } else {
      if (c === '"') inQ = true;
      else if (c === ',') { out.push(cur); cur = ''; }
      else cur += c;
    }
  }
  out.push(cur);
  return out;
}

/* ───────────────  read CSV (streamed) → grouped works  ─────────────── */
async function readWorks() {
  const works = new Map(); // groupKey -> work
  const rl = createInterface({ input: createReadStream(CSV_PATH, { encoding: 'utf8' }), crlfDelay: Infinity });
  let header = null;
  let rows = 0;
  for await (const line of rl) {
    if (!line) continue;
    if (!header) { header = parseCsvLine(line); continue; }
    const cols = parseCsvLine(line);
    if (cols.length < header.length) continue;
    const rec = {};
    header.forEach((h, i) => (rec[h] = cols[i]));
    const map = CSV_CATEGORY_MAP[rec.category];
    if (!map) continue;
    rows++;
    const name = (rec.name || '').trim();
    if (!name) continue;
    const groupKey = `${map.sub}::${nameKey(name)}`;
    let w = works.get(groupKey);
    if (!w) {
      w = {
        name,
        category: map.category,
        sub: map.sub,
        subLabel: map.subLabel,
        csvCategory: rec.category,
        year: extractYear(name),
        episodes: new Map(), // "s-e" -> { season, episode, title, servers[] }
        isMovie: map.category === 'movie',
        movieServers: [],
      };
      works.set(groupKey, w);
    }
    const url = (rec.iframe_src || '').trim();
    if (!url) continue;
    if (rec.type === 'movie' || w.isMovie) {
      if (!w.movieServers.some((s) => s.url === url)) {
        w.movieServers.push({ url, label: serverLabel(url) });
      }
    } else {
      const season = parseInt(rec.season, 10) || 1;
      const episode = parseInt(rec.episode, 10) || 1;
      const ek = `${season}-${episode}`;
      let ep = w.episodes.get(ek);
      if (!ep) {
        ep = { season, episode, title: rec.title || `الحلقة ${episode}`, servers: [] };
        w.episodes.set(ek, ep);
      }
      if (!ep.servers.some((s) => s.url === url)) {
        ep.servers.push({ url, label: serverLabel(url) });
      }
    }
  }
  return { works, rows };
}

/* ───────────────  load existing catalogue index (name → title)  ─────────────── */
function loadExistingIndex() {
  console.log('[ingest] loading existing all.json …');
  const all = JSON.parse(readFileSync(ALL_PATH, 'utf8'));
  const byKey = new Map(); // `${category}::${nameKey}` -> title ref
  for (const t of all) {
    const candidates = [t.clean_title, t.raw_name, t.original_title].filter(Boolean);
    for (const c of candidates) {
      byKey.set(`${t.category}::${nameKey(c)}`, t);
    }
  }
  return { all, byKey };
}

/* ───────────────  MERGE pass: add servers to existing works  ─────────────── */
function mergeServers(work, title) {
  let added = 0;
  const nextId = () => {
    let max = 0;
    for (const s of title.seasons || []) for (const e of s.episodes || [])
      for (const sv of e.servers || []) if (sv.id > max) max = sv.id;
    return max + 1;
  };
  if (work.isMovie || title.category === 'movie') {
    const ep = title.seasons?.[0]?.episodes?.[0];
    if (ep) {
      let id = Math.max(0, ...ep.servers.map((s) => s.id || 0));
      for (const sv of work.movieServers) {
        if (!ep.servers.some((x) => x.url === sv.url)) {
          ep.servers.push({ id: ++id, label: sv.label, url: sv.url, _added: true });
          added++;
        }
      }
    }
  } else {
    for (const ep of work.episodes.values()) {
      const season = title.seasons?.find((s) => s.season === ep.season);
      const tgt = season?.episodes?.find((e) => e.episode === ep.episode);
      if (tgt) {
        let id = Math.max(0, ...tgt.servers.map((s) => s.id || 0));
        for (const sv of ep.servers) {
          if (!tgt.servers.some((x) => x.url === sv.url)) {
            tgt.servers.push({ id: ++id, label: sv.label, url: sv.url, _added: true });
            added++;
          }
        }
      }
    }
  }
  return added;
}

async function main() {
  const { works, rows } = await readWorks();
  console.log(`[ingest] parsed ${rows} rows -> ${works.size} distinct works`);

  const { all, byKey } = loadExistingIndex();

  let matched = 0, serversAdded = 0, created = 0;
  const newWorks = [];
  const matchedNames = [];

  for (const work of works.values()) {
    const key = `${work.category}::${nameKey(work.name)}`;
    const existing = byKey.get(key);
    if (existing) {
      matched++;
      const added = mergeServers(work, existing);
      serversAdded += added;
      if (added) matchedNames.push({ name: work.name, added });
    } else {
      created++;
      newWorks.push(work);
    }
  }

  console.log(`[ingest] matched existing works: ${matched} (servers added: ${serversAdded})`);
  console.log(`[ingest] NEW works to create:    ${created}`);

  // breakdown of new works by sub-category
  const bySub = {};
  for (const w of newWorks) bySub[work_sub(w)] = (bySub[work_sub(w)] || 0) + 1;
  function work_sub(w) { return w.sub; }
  console.log('[ingest] new works by sub-category:');
  for (const [k, v] of Object.entries(bySub).sort((a, b) => b[1] - a[1])) {
    console.log(`   ${k}: ${v}`);
  }

  if (DRY) { console.log('[ingest] --dry: nothing written'); return; }

  // Serialise new works (compact intermediate form) for the TMDB enrichment step.
  const serialisable = newWorks.map((w) => ({
    name: w.name,
    englishTitle: extractEnglishTitle(w.name),
    category: w.category,
    sub: w.sub,
    subLabel: w.subLabel,
    year: w.year,
    isMovie: w.isMovie,
    movieServers: w.movieServers,
    episodes: [...w.episodes.values()].sort((a, b) =>
      a.season - b.season || a.episode - b.episode),
  }));
  writeFileSync(NEW_WORKS_PATH, JSON.stringify(serialisable));
  writeFileSync(ALL_PATH, JSON.stringify(all));
  writeFileSync(MATCH_REPORT_PATH, JSON.stringify({
    rows, distinctWorks: works.size, matched, serversAdded, created, bySub,
    matchedSample: matchedNames.slice(0, 50),
  }, null, 2));
  console.log(`[ingest] wrote ${serialisable.length} new works -> new-works.json`);
  console.log(`[ingest] updated all.json with ${serversAdded} merged servers`);
}

main().catch((e) => { console.error(e); process.exit(1); });
