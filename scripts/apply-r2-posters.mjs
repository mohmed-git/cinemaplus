#!/usr/bin/env node
/**
 * apply-r2-posters.mjs
 * --------------------
 * Task 1: For every catalogue work that still has a placeholder poster
 * (placehold.co), replace its `poster` with a self-hosted Cloudflare R2 URL.
 *
 *   movie            -> https://<R2>/movie/<slug>.jpg
 *   series | anime   -> https://<R2>/series/<slug>.jpg
 *
 * The <slug> is the work's canonical slug (same value used in the site URLs),
 * so the filename in R2 matches exactly what the Python downloader saves.
 *
 * Sets matched_poster:true so the UI treats it as a real poster.
 *
 * Usage:
 *   node scripts/apply-r2-posters.mjs            # writes all.json
 *   node scripts/apply-r2-posters.mjs --dry      # report only, no write
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ALL_JSON = path.join(__dirname, '..', 'src', 'data', 'generated', 'all.json');

const R2_BASE = 'https://pub-7bd753a4463049929e562aa677ad4251.r2.dev';
const DRY = process.argv.includes('--dry');

function folderFor(category) {
  return category === 'movie' ? 'movie' : 'series'; // series + anime -> series
}

// Build the R2 URL. The slug may contain Arabic; encode each path segment
// so the URL is valid. R2 stores the object key with the RAW (decoded) name,
// which is what the Python script will save the file as.
function r2Url(folder, slug) {
  return `${R2_BASE}/${folder}/${encodeURIComponent(slug)}.jpg`;
}

const all = JSON.parse(fs.readFileSync(ALL_JSON, 'utf8'));

let applied = 0;
const perFolder = { movie: 0, series: 0 };
for (const t of all) {
  const cur = String(t.poster || '');
  if (!cur.includes('placehold')) continue;
  const folder = folderFor(t.category);
  t.poster = r2Url(folder, t.slug);
  t.matched_poster = true;
  perFolder[folder]++;
  applied++;
}

console.log('R2 base           :', R2_BASE);
console.log('Applied (placeholder -> R2):', applied);
console.log('  movie/ :', perFolder.movie);
console.log('  series/:', perFolder.series);

if (DRY) {
  console.log('\n[DRY RUN] all.json NOT written.');
} else {
  fs.writeFileSync(ALL_JSON, JSON.stringify(all));
  console.log('\nWrote', ALL_JSON);
}
