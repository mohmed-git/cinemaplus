/**
 * Permanently removes works whose names appear in a CSV "name" column from the
 * catalogue (src/data/generated/all.json).
 *
 * Designed for bulk removal lists exported from iframe/source audits where the
 * same name may appear many times (duplicates are de-duplicated here).
 *
 * Matching is name-based and tolerant:
 *   1) exact normalised clean_title match (handles "عربي + Latin" titles)
 *   2) latin-part exact match (CSV names are usually Latin-only)
 *   3) latin-part + year match (when the CSV name carries a trailing year)
 *
 * Usage:
 *   node scripts/apply-csv-deletions.mjs <csv-path>        # apply + rewrite all.json
 *   node scripts/apply-csv-deletions.mjs <csv-path> --dry  # report only
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const ALL_PATH = join(root, 'src/data/generated/all.json');

const args = process.argv.slice(2);
const DRY = args.includes('--dry');
const CSV_PATH = args.find((a) => !a.startsWith('--'));
if (!CSV_PATH) {
  console.error('Usage: node scripts/apply-csv-deletions.mjs <csv-path> [--dry]');
  process.exit(1);
}

function parseCsvName(line) {
  let s = line.replace(/\r/g, '').trim();
  if (s.startsWith('"') && s.endsWith('"')) s = s.slice(1, -1).replace(/""/g, '"');
  return s.trim();
}
function norm(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[\u2019'`\u00b4]/g, "'")
    .replace(/["'']/g, '')
    .replace(/[:!?.,\-\u2013\u2014_()]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
function stripYear(s) {
  return s.replace(/\b(19|20)\d{2}\b/g, '').replace(/\s+/g, ' ').trim();
}
function latinPart(s) {
  return norm(s).replace(/[\u0600-\u06FF]/g, ' ').replace(/\s+/g, ' ').trim();
}
function stripKindPrefix(s) {
  return s.replace(/^(?:برنامج|مسلسل|فيلم|انمي|أنمي|عرض)\s+/u, '').trim();
}

const all = JSON.parse(readFileSync(ALL_PATH, 'utf8'));

// CSV → unique names
const rawNames = readFileSync(CSV_PATH, 'utf8')
  .split('\n')
  .slice(1) // drop header
  .map(parseCsvName)
  .filter(Boolean);
const uniqueNames = [...new Set(rawNames.map(stripKindPrefix))];

// Title index
const titleIndex = all.map((t) => ({
  t,
  clean: norm(t.clean_title || ''),
  cleanNoYear: stripYear(norm(t.clean_title || '')),
  latin: latinPart(t.clean_title || ''),
  latinNoYear: stripYear(latinPart(t.clean_title || '')),
  rawLatin: latinPart(t.raw_name || ''),
  year: String(t.year || ''),
}));

const toDelete = new Set();
const matched = [];
const unmatched = [];

for (const name of uniqueNames) {
  const ym = name.match(/\b((?:19|20)\d{2})\s*$/);
  const year = ym ? ym[1] : null;
  const nn = norm(name);
  const nl = latinPart(name);
  const nlNoYear = stripYear(nl);

  let hit = null;
  // 1) exact clean_title (full, incl. arabic)
  hit = titleIndex.find((ti) => ti.clean === nn);
  // 2) latin exact
  if (!hit && nl && nl.length >= 3) {
    hit = titleIndex.find((ti) => ti.latin === nl || ti.rawLatin === nl);
  }
  // 3) latin (no year) + year tiebreak
  if (!hit && nlNoYear && nlNoYear.length >= 3) {
    const candidates = titleIndex.filter(
      (ti) => ti.latinNoYear === nlNoYear || stripYear(ti.rawLatin) === nlNoYear,
    );
    if (candidates.length === 1) hit = candidates[0];
    else if (candidates.length > 1 && year) {
      hit = candidates.find((ti) => ti.year === year) || null;
    }
  }

  if (hit) {
    matched.push(name);
    toDelete.add(hit.t.slug);
  } else {
    unmatched.push(name);
  }
}

console.log(`[csv-delete] unique CSV names: ${uniqueNames.length}`);
console.log(`[csv-delete] matched ${matched.length} names → ${toDelete.size} unique works`);
console.log(`[csv-delete] UNMATCHED: ${unmatched.length}`);
if (unmatched.length) {
  unmatched.slice(0, 60).forEach((u) => console.log('  ✗', u));
  if (unmatched.length > 60) console.log(`  … and ${unmatched.length - 60} more`);
}

const kept = all.filter((t) => !toDelete.has(t.slug));
console.log(`[csv-delete] catalogue ${all.length} → ${kept.length} (removed ${all.length - kept.length})`);

if (DRY) {
  console.log('[csv-delete] --dry: no files written');
} else {
  writeFileSync(ALL_PATH, JSON.stringify(kept));
  console.log('[csv-delete] wrote src/data/generated/all.json');
}
