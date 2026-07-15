import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  detectEntryType, extractSeasonFromTitle, makeBaseTitle, franchiseKey, isReliableFranchiseKey,
} from './lib-title-parse.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const ALL_PATH = join(root, 'src/data/generated/all.json');
const OUT_CSV = join(root, 'exports/catalog-ai.csv');

function csv(value) {
  if (value === null || value === undefined) return '';
  let s = String(value).replace(/\r?\n/g, ' ').trim();
  if (/[",]/.test(s)) s = '"' + s.replace(/"/g, '""') + '"';
  return s;
}

function main() {
  const all = JSON.parse(readFileSync(ALL_PATH, 'utf8'));

  // ---- Pass 1: compute franchise key + base title + entry season for every work ----
  const meta = new Map(); // slug -> {baseTitle, fkey, entryType, seasonNum}
  for (const t of all) {
    const name = t.clean_title || t.raw_name || t.slug;
    const baseTitle = makeBaseTitle(name) || name;
    let fkey = franchiseKey(baseTitle);
    if (!isReliableFranchiseKey(fkey)) fkey = 'slug:' + t.slug; // fall back to unique slug
    const entryType = detectEntryType(t);
    // Season number for THIS work entry:
    //  - prefer explicit season marker in the title
    //  - else if the work stores multiple seasons internally, we handle per-season below
    const titleSeason = extractSeasonFromTitle(name);
    meta.set(t.slug, { baseTitle, fkey, entryType, titleSeason });
  }

  // ---- Pass 2: group franchises, count seasons, assign season ordinals ----
  // A "franchise" = all works sharing the same fkey. Within a franchise each work entry
  // is one "season entry" (unless the work itself has internal seasons[]).
  const franchises = new Map(); // fkey -> [{slug, titleSeason}]
  for (const t of all) {
    const m = meta.get(t.slug);
    if (!franchises.has(m.fkey)) franchises.set(m.fkey, []);
    franchises.get(m.fkey).push({ slug: t.slug, titleSeason: m.titleSeason, year: t.year, entryType: m.entryType });
  }

  // For each franchise, decide a display order for its entries.
  // Order by: explicit titleSeason (1,2,3...), then by year, then by slug. Movies/OVA/specials go after seasons.
  const typeRank = { series: 0, anime: 0, movie: 5, ova: 6, ona: 6, special: 7 };
  const franchiseInfo = new Map(); // fkey -> {count, orderMap: slug->ordinal}
  for (const [fkey, entries] of franchises) {
    const sorted = entries.slice().sort((a, b) => {
      const ta = a.titleSeason ?? 999, tb = b.titleSeason ?? 999;
      if (ta !== tb) return ta - tb;
      const ra = typeRank[a.entryType] ?? 1, rb = typeRank[b.entryType] ?? 1;
      if (ra !== rb) return ra - rb;
      const ya = Number(a.year) || 0, yb = Number(b.year) || 0;
      if (ya !== yb) return ya - yb;
      return a.slug.localeCompare(b.slug);
    });
    const orderMap = new Map();
    sorted.forEach((e, i) => orderMap.set(e.slug, i + 1));
    franchiseInfo.set(fkey, { count: entries.length, orderMap });
  }

  // ---- Pass 3: max servers for column sizing ----
  let maxServers = 0;
  for (const t of all) {
    for (const s of t.seasons || []) {
      for (const e of s.episodes || []) {
        const n = Array.isArray(e.servers) ? e.servers.length : 0;
        if (n > maxServers) maxServers = n;
      }
    }
  }

  // ---- Header ----
  const baseHeaders = [
    'work_id',            // = slug (unique per work entry on the site)
    'franchise_key',      // groups all seasons/parts of the SAME show
    'base_title',         // show name WITHOUT season markers
    'full_title',         // original title as shown on the site
    'entry_type',         // series | anime | movie | ova | ona | special
    'franchise_entry_no', // this entry's order within its franchise (1=first season/part)
    'franchise_total_entries', // how many entries the franchise has on the site
    'season_number',      // the season number for THIS row (from title marker OR internal seasons[])
    'seasons_in_work',    // how many internal seasons this work object stores
    'category', 'category_label',
    'subcategory', 'subcategory_label',
    'is_new', 'year',
    'poster', 'season_poster',
    'episode_number', 'episodes_in_season', 'episode_title',
    'detail_url',
  ];
  const serverHeaders = [];
  for (let i = 1; i <= maxServers; i++) { serverHeaders.push(`server_${i}_label`); serverHeaders.push(`server_${i}_url`); }
  const header = [...baseHeaders, ...serverHeaders];
  const rows = [header.join(',')];

  const worksEmitted = new Set();
  let episodeRows = 0;

  for (const t of all) {
    const m = meta.get(t.slug);
    const fi = franchiseInfo.get(m.fkey);
    const workPoster = t.poster || t.matched_poster || '';
    const internalSeasons = Array.isArray(t.seasons) ? t.seasons : [];
    const seasonsInWork = internalSeasons.length;

    const base = {
      work_id: t.slug,
      franchise_key: m.fkey.startsWith('slug:') ? t.slug : m.fkey,
      base_title: m.baseTitle,
      full_title: t.clean_title || t.raw_name || t.slug,
      entry_type: m.entryType,
      franchise_entry_no: fi.orderMap.get(t.slug) || 1,
      franchise_total_entries: fi.count,
      category: t.category,
      category_label: t.category_label,
      subcategory: t.subcategory ?? '',
      subcategory_label: t.subcategory_label ?? '',
      is_new: t.is_new ? '1' : '0',
      year: t.year ?? '',
      poster: workPoster,
      detail_url: t.url ?? '',
      seasons_in_work: seasonsInWork,
    };

    const emitRow = (seasonNumber, seasonPoster, episodesInSeason, ep) => {
      const servers = ep && Array.isArray(ep.servers) ? ep.servers : [];
      const cells = [
        csv(base.work_id), csv(base.franchise_key), csv(base.base_title), csv(base.full_title),
        csv(base.entry_type), csv(base.franchise_entry_no), csv(base.franchise_total_entries),
        csv(seasonNumber), csv(base.seasons_in_work),
        csv(base.category), csv(base.category_label),
        csv(base.subcategory), csv(base.subcategory_label),
        csv(base.is_new), csv(base.year),
        csv(base.poster), csv(seasonPoster),
        csv(ep ? ep.episode : ''), csv(episodesInSeason), csv(ep ? (ep.title || '') : ''),
        csv(base.detail_url),
      ];
      for (let i = 0; i < maxServers; i++) {
        const sv = servers[i];
        cells.push(csv(sv ? (sv.label || '') : ''));
        cells.push(csv(sv ? (sv.url || '') : ''));
      }
      rows.push(cells.join(','));
      episodeRows++;
      worksEmitted.add(t.slug);
    };

    if (seasonsInWork === 0) {
      // placeholder so every work appears
      emitRow(m.titleSeason ?? '', workPoster, 0, null);
      continue;
    }

    for (const s of internalSeasons) {
      // Season number for the row: internal season if work has >1 season, else the title-derived season
      const seasonNumber = seasonsInWork > 1 ? s.season : (m.titleSeason ?? s.season ?? 1);
      const seasonPoster = s.poster || s.season_poster || s.image || workPoster;
      const episodes = Array.isArray(s.episodes) ? s.episodes : [];
      const episodesInSeason = episodes.length;
      if (episodes.length === 0) { emitRow(seasonNumber, seasonPoster, 0, null); continue; }
      for (const ep of episodes) emitRow(seasonNumber, seasonPoster, episodesInSeason, ep);
    }
  }

  if (!existsSync(dirname(OUT_CSV))) mkdirSync(dirname(OUT_CSV), { recursive: true });
  writeFileSync(OUT_CSV, '\uFEFF' + rows.join('\n') + '\n', 'utf8');

  // stats
  const allSlugs = new Set(all.map((t) => t.slug));
  const missing = [...allSlugs].filter((s) => !worksEmitted.has(s));
  let multiEntryFranchises = 0;
  for (const [, fi] of franchiseInfo) if (fi.count > 1) multiEntryFranchises++;

  console.log(`[ai] works in site        : ${allSlugs.size}`);
  console.log(`[ai] works emitted        : ${worksEmitted.size}`);
  console.log(`[ai] works missing        : ${missing.length}`);
  console.log(`[ai] episode rows         : ${episodeRows}`);
  console.log(`[ai] franchises (groups)  : ${franchiseInfo.size}`);
  console.log(`[ai] multi-entry franchises: ${multiEntryFranchises}`);
  console.log(`[ai] max servers/episode  : ${maxServers}`);
  console.log(`[ai] total columns        : ${header.length}`);
  console.log(`[ai] output               : ${OUT_CSV}`);
  if (missing.length) console.log('  missing:', missing.slice(0, 30).join(', '));
}

main();
