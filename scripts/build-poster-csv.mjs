#!/usr/bin/env node
/**
 * build-poster-csv.mjs
 * --------------------
 * Task 2 (part A): produce a NEW csv listing only the works that have NO real
 * poster (the ones we just pointed at Cloudflare R2), together with the source
 * page_url where the real .webp poster can be scraped, plus the exact image
 * filename (slug + folder) we used in the R2 URL.
 *
 * Output columns:
 *   name        - the work name (raw_name, as it appears on the source site)
 *   type        - "movie" or "series"  (the R2 folder)
 *   image_name  - "<slug>.jpg"  (exact object key in R2)
 *   page_url    - a page on tuktukarab where the work's poster image lives
 *
 * The page_url is taken from the ORIGINAL ingest CSV
 * (uploaded_files/tuktuk_clean_no_adult.csv) by matching on the normalised
 * work name (nameKey), which is stable even after subcategory corrections.
 *
 * Usage:
 *   node scripts/build-poster-csv.mjs
 *     -> writes scripts/data/posters-to-download.csv
 *     -> prints how many works matched / are missing a page_url
 */
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';
import { nameKey } from './lib-ingest.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ALL_JSON = path.join(__dirname, '..', 'src', 'data', 'generated', 'all.json');
const SRC_CSV = '/home/user/uploaded_files/tuktuk_clean_no_adult.csv';
const OUT_CSV = path.join(__dirname, 'data', 'posters-to-download.csv');

const folderFor = (category) => (category === 'movie' ? 'movie' : 'series');

/* ---- 1. collect the works that still need a poster ----
 * Scope: only the works WE converted from a placehold.co placeholder in this
 * task (tracked via the pre-conversion backup). These are the genuine
 * "no poster" works the user asked about. Works that already carried an R2
 * URL before this task were handled previously and are left untouched.
 */
const all = JSON.parse(fs.readFileSync(ALL_JSON, 'utf8'));
const R2 = 'pub-7bd753a4463049929e562aa677ad4251.r2.dev';

// slugs that were placehold.co right before we ran apply-r2-posters.mjs
const BACKUP = '/tmp/all.beforeR2.bak';
let targetSlugs = null;
if (fs.existsSync(BACKUP)) {
  const before = JSON.parse(fs.readFileSync(BACKUP, 'utf8'));
  targetSlugs = new Set(
    before.filter((t) => String(t.poster || '').includes('placehold')).map((t) => t.slug),
  );
}

const needList = all.filter((t) => {
  if (!String(t.poster || '').includes(R2)) return false;
  if (targetSlugs) return targetSlugs.has(t.slug); // only just-converted works
  return true;
});
console.log('No-poster works to resolve:', needList.length);

// index by normalised name -> list of works (collisions possible across subcats)
const byName = new Map();
for (const t of needList) {
  const k = nameKey(t.raw_name || t.clean_title || t.slug);
  if (!byName.has(k)) byName.set(k, []);
  byName.get(k).push(t);
}

/* ---- 2. stream the source CSV, capture first page_url per nameKey ---- */
const pageByName = new Map(); // nameKey -> page_url (first seen, episode 1 preferred)
const rl = readline.createInterface({ input: fs.createReadStream(SRC_CSV, 'utf8') });

let header = null;
function parseCsvLine(line) {
  // simple CSV parser handling quoted fields
  const out = [];
  let cur = '';
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQ) {
      if (ch === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; }
        else inQ = false;
      } else cur += ch;
    } else {
      if (ch === '"') inQ = true;
      else if (ch === ',') { out.push(cur); cur = ''; }
      else cur += ch;
    }
  }
  out.push(cur);
  return out;
}

await new Promise((resolve) => {
  rl.on('line', (line) => {
    if (header === null) { header = parseCsvLine(line); return; }
    if (!line.trim()) return;
    const cols = parseCsvLine(line);
    const rec = {};
    header.forEach((h, i) => { rec[h] = (cols[i] || '').replace(/\r$/, ''); });
    const nm = (rec.name || '').trim();
    if (!nm) return;
    const k = nameKey(nm);
    if (!byName.has(k)) return; // not a work we care about
    const pu = (rec.page_url || '').trim();
    if (!pu) return;
    // prefer episode 1 / lowest episode page when available
    const epNum = parseInt(rec.episode, 10);
    const prev = pageByName.get(k);
    if (!prev) {
      pageByName.set(k, { url: pu, ep: isNaN(epNum) ? 9999 : epNum });
    } else if (!isNaN(epNum) && epNum < prev.ep) {
      pageByName.set(k, { url: pu, ep: epNum });
    }
  });
  rl.on('close', resolve);
});

/* ---- 3. emit the new CSV ---- */
function csvCell(v) {
  const s = String(v ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

const rows = [['name', 'type', 'image_name', 'page_url']];
let matched = 0;
const missing = [];
for (const t of needList) {
  const k = nameKey(t.raw_name || t.clean_title || t.slug);
  const hit = pageByName.get(k);
  const folder = folderFor(t.category);
  const imageName = `${t.slug}.jpg`;
  if (hit) {
    rows.push([t.raw_name || t.clean_title, folder, imageName, hit.url]);
    matched++;
  } else {
    rows.push([t.raw_name || t.clean_title, folder, imageName, '']);
    missing.push(t.raw_name || t.slug);
  }
}

fs.mkdirSync(path.dirname(OUT_CSV), { recursive: true });
fs.writeFileSync(OUT_CSV, rows.map((r) => r.map(csvCell).join(',')).join('\n') + '\n');

console.log('Matched a page_url :', matched);
console.log('Missing page_url   :', missing.length);
if (missing.length) console.log('  e.g.', missing.slice(0, 15).join(' | '));
console.log('Wrote', OUT_CSV, '(', rows.length - 1, 'data rows )');
