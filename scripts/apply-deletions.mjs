/**
 * Permanently removes works listed in scripts/data/delete-list.txt from the
 * catalogue (src/data/generated/all.json).
 *
 * Matching is name-based (clean_title / raw_name / original_title / slug),
 * normalised (lowercase, punctuation/diacritics stripped, year removed) with an
 * optional trailing year in the delete entry used as a tiebreak.
 *
 * Usage:
 *   node scripts/apply-deletions.mjs          # apply + rewrite all.json
 *   node scripts/apply-deletions.mjs --dry    # report only, no write
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const ALL_PATH = join(root, 'src/data/generated/all.json');
const LIST_PATH = join(root, 'scripts/data/delete-list.txt');
const DRY = process.argv.includes('--dry');

function norm(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[\u2019'`\u00b4]/g, "'")
    .replace(/[:!?.,\-\u2013\u2014_]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
function stripYear(s) {
  return s.replace(/\b(19|20)\d{2}\b/g, '').replace(/\s+/g, ' ').trim();
}
function titleNames(t) {
  const out = new Set();
  for (const f of [t.clean_title, t.raw_name, t.original_title, t.slug]) {
    if (f) out.add(stripYear(norm(f)));
  }
  if (t.slug) {
    const latin = t.slug.replace(/[^\x00-\x7F]/g, ' ').replace(/-/g, ' ');
    out.add(stripYear(norm(latin)));
  }
  return out;
}

const all = JSON.parse(readFileSync(ALL_PATH, 'utf8'));
const lines = readFileSync(LIST_PATH, 'utf8')
  .split('\n')
  .map((l) => l.replace(/\r/g, '').trim())
  .filter(Boolean);

const targets = lines.map((line) => {
  const m = line.match(/\b((?:19|20)\d{2})\s*$/);
  const year = m ? m[1] : null;
  const name = year ? line.slice(0, m.index).trim() : line.trim();
  return { line, year, nname: stripYear(norm(name)) };
});

const toDelete = new Set();
const matched = [];
const unmatched = [];
for (const tg of targets) {
  let hit = null;
  for (const t of all) {
    if (titleNames(t).has(tg.nname)) {
      hit = t;
      if (tg.year && String(t.year) === tg.year) break;
    }
  }
  if (hit) {
    matched.push(tg.line);
    toDelete.add(hit.slug);
  } else unmatched.push(tg.line);
}

console.log(`[delete] matched ${matched.length}/${targets.length} entries → ${toDelete.size} unique works`);
if (unmatched.length) {
  console.log(`[delete] UNMATCHED (${unmatched.length}):`);
  unmatched.forEach((u) => console.log('  ✗', u));
}

const kept = all.filter((t) => !toDelete.has(t.slug));
console.log(`[delete] catalogue ${all.length} → ${kept.length} (removed ${all.length - kept.length})`);

if (DRY) {
  console.log('[delete] --dry: no files written');
} else {
  writeFileSync(ALL_PATH, JSON.stringify(kept));
  console.log('[delete] wrote src/data/generated/all.json');
}
