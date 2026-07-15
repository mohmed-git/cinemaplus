#!/usr/bin/env node
/**
 * apply-poster-overrides.mjs
 *
 * Replaces placehold.co placeholder posters in src/data/generated/all.json
 * with real poster URLs collected in scripts/data/poster-overrides.json
 * (a map of slug -> real poster URL).
 *
 * Usage:
 *   node scripts/apply-poster-overrides.mjs [--dry]
 *
 * Only titles whose current poster is a placehold.co placeholder are touched.
 * After applying, the title's `matched_poster` flag is set to true.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const ALL_JSON = path.join(ROOT, 'src/data/generated/all.json');
const OVERRIDES = path.join(ROOT, 'scripts/data/poster-overrides.json');

const DRY = process.argv.includes('--dry');

const all = JSON.parse(fs.readFileSync(ALL_JSON, 'utf8'));
const overridesRaw = JSON.parse(fs.readFileSync(OVERRIDES, 'utf8'));
const overrides = {};
for (const [k, v] of Object.entries(overridesRaw)) {
  if (k.startsWith('_')) continue;        // skip _note etc.
  if (typeof v === 'string' && v.trim()) overrides[k] = v.trim();
}

let applied = 0, skippedNotPlaceholder = 0, missingTitle = 0;
const slugSet = new Set(all.map(t => t.slug));

for (const [slug, url] of Object.entries(overrides)) {
  if (!slugSet.has(slug)) { missingTitle++; continue; }
}

for (const t of all) {
  const url = overrides[t.slug];
  if (!url) continue;
  const cur = String(t.poster || '');
  if (!cur.includes('placehold')) { skippedNotPlaceholder++; continue; }
  t.poster = url;
  t.matched_poster = true;
  applied++;
}

const remainingPlaceholders = all.filter(t => String(t.poster || '').includes('placehold')).length;

console.log('=== apply-poster-overrides ===');
console.log('Override entries:        ', Object.keys(overrides).length);
console.log('Applied (was placeholder):', applied);
console.log('Skipped (not placeholder):', skippedNotPlaceholder);
console.log('Override slug not in catalog:', missingTitle);
console.log('Placeholders remaining:  ', remainingPlaceholders);

if (DRY) {
  console.log('\n[dry run] no file written.');
} else {
  fs.writeFileSync(ALL_JSON, JSON.stringify(all));
  console.log('\nWrote', ALL_JSON);
}
