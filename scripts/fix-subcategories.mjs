/**
 * Corrects mis-classified sub-categories on the CSV-ingested (is_new) works.
 *
 * The CSV's own grouping was sometimes wrong (e.g. a Hollywood film like
 * "The Dark Knight" landing under "indian-movies"). We re-derive the correct
 * ORIGIN (indian / turkish / asian / foreign) from the TMDB `country` field,
 * which is far more reliable, and rewrite `subcategory` + `subcategory_label`
 * accordingly. The film/series/movie *kind* is preserved — only the origin
 * prefix changes (indian-movies → foreign-movies, etc.).
 *
 * Conservative rules:
 *   - `country` may list several co-production countries. We only RECLASSIFY
 *     when NONE of the listed countries matches the current origin (so genuine
 *     co-productions keep their existing, plausible bucket).
 *   - Netflix works are a PLATFORM tag, not a geographic origin → never moved.
 *   - Works without a usable country are left untouched.
 *   - Anime/old-catalogue works (no is_new) are untouched.
 *
 * Usage:
 *   node scripts/fix-subcategories.mjs         # apply
 *   node scripts/fix-subcategories.mjs --dry   # report only
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const ALL_PATH = join(root, 'src/data/generated/all.json');
const DRY = process.argv.includes('--dry');

// Sub-category label per (origin, kind). kind = 'movies' | 'series'.
const LABELS = {
  'indian-movies': 'أفلام هندي',
  'indian-series': 'مسلسلات هندي',
  'turkish-movies': 'أفلام تركي',
  'turkish-series': 'مسلسلات تركي',
  'asian-movies': 'أفلام آسيوي',
  'asian-series': 'مسلسلات آسيوي',
  'foreign-movies': 'أفلام أجنبي',
  'foreign-series': 'مسلسلات أجنبي',
  'netflix-movies': 'أفلام نتفليكس',
  'netflix-series': 'مسلسلات نتفليكس',
};

const ORIGIN_KEYWORDS = {
  indian: ['india', 'الهند', 'هندي'],
  turkish: ['turkey', 'türkiye', 'تركيا', 'turkish'],
  asian: [
    'japan', 'اليابان', 'ياباني', 'korea', 'كوريا', 'كوري', 'china', 'الصين',
    'صيني', 'thailand', 'تايلاند', 'indonesia', 'إندونيسيا', 'philippines',
    'الفلبين', 'taiwan', 'تايوان', 'hong kong', 'هونغ كونغ', 'vietnam',
    'فيتنام', 'malaysia', 'ماليزيا', 'singapore', 'سنغافورة',
  ],
  foreign: [
    'united states', 'الولايات', 'أمريك', 'usa', 'united kingdom',
    'المملكة المتحدة', 'بريطاني', 'england', 'canada', 'كندا', 'france',
    'فرنس', 'germany', 'ألماني', 'spain', 'إسبان', 'italy', 'إيطال',
    'australia', 'أستراليا', 'brazil', 'برازيل', 'mexico', 'مكسيك',
    'argentina', 'أرجنتين', 'belgium', 'بلجيك', 'netherlands', 'هولند',
    'sweden', 'سويد', 'norway', 'نرويج', 'denmark', 'دنمارك', 'ireland',
    'أيرلند', 'new zealand', 'نيوزيلند', 'poland', 'بولند', 'russia', 'روسي',
    'portugal', 'برتغال', 'austria', 'نمسا', 'switzerland', 'سويسر',
  ],
};

/** Return the SET of origins implied by a (possibly multi-country) string. */
function originsOf(country) {
  if (!country) return new Set();
  const c = country.toLowerCase();
  const found = new Set();
  for (const [origin, kws] of Object.entries(ORIGIN_KEYWORDS)) {
    if (kws.some((k) => c.includes(k))) found.add(origin);
  }
  return found;
}

function parseSub(sub) {
  if (!sub) return null;
  for (const origin of ['indian', 'turkish', 'asian', 'foreign', 'netflix']) {
    if (sub.startsWith(origin + '-')) {
      return { origin, kind: sub.slice(origin.length + 1) }; // 'movies' | 'series'
    }
  }
  return null;
}

const all = JSON.parse(readFileSync(ALL_PATH, 'utf8'));

let changed = 0;
let skippedNetflix = 0;
let skippedNoCountry = 0;
const moves = {};

for (const t of all) {
  if (!t.is_new) continue;
  const cur = parseSub(t.subcategory);
  if (!cur) continue;
  if (cur.origin === 'netflix') { skippedNetflix++; continue; }

  const origins = originsOf(t.country);
  if (origins.size === 0) { skippedNoCountry++; continue; }

  // Keep current bucket if it's among the plausible origins (co-production).
  if (origins.has(cur.origin)) continue;

  // Pick the new origin: priority indian > turkish > asian > foreign so a
  // single, specific regional origin wins over the generic "foreign".
  const priority = ['indian', 'turkish', 'asian', 'foreign'];
  const newOrigin = priority.find((o) => origins.has(o));
  if (!newOrigin || newOrigin === cur.origin) continue;

  const newSub = `${newOrigin}-${cur.kind}`;
  if (!LABELS[newSub]) continue;

  const key = `${cur.origin}-${cur.kind} → ${newSub}`;
  moves[key] = (moves[key] || 0) + 1;
  t.subcategory = newSub;
  t.subcategory_label = LABELS[newSub];
  changed++;
}

console.log(`[fix-subcat] reclassified ${changed} works`);
console.log(`[fix-subcat] skipped netflix: ${skippedNetflix} | no/unknown country: ${skippedNoCountry}`);
console.log('[fix-subcat] moves:');
for (const [k, n] of Object.entries(moves).sort((a, b) => b[1] - a[1])) {
  console.log(`   ${k}: ${n}`);
}

if (DRY) {
  console.log('[fix-subcat] --dry: no files written');
} else {
  writeFileSync(ALL_PATH, JSON.stringify(all));
  console.log('[fix-subcat] wrote src/data/generated/all.json');
}
