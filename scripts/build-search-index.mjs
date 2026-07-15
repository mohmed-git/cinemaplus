/**
 * Builds a COMPLETE client-side search index (old static catalogue + new SSR
 * works) and writes it to public/static/search-index.json.
 *
 * Why a separate static file instead of inlining the corpus into search.astro?
 *   - The full catalogue (>10k titles) inlined as JSON bloats the search page
 *     HTML to several MB; large inline payloads were the reason newly-added
 *     (is_new) works appeared to be "missing" from search.
 *   - A static JSON fetched on demand keeps the page tiny, is cached by the CDN,
 *     and is guaranteed to contain EVERY public work (old + new).
 *
 * URL mapping mirrors src/lib/titles.ts → toIndexEntry:
 *   - is_new  → /w/<slug>     (SSR new works)
 *   - movie   → /f/<slug>
 *   - series  → /d/<slug>
 *   - anime   → /n/<slug>
 *
 * Run as part of the build (prebuild) so the index always matches all.json.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const ALL_PATH = join(root, 'src/data/generated/all.json');
const OUT_DIR = join(root, 'public/static');
const OUT_PATH = join(OUT_DIR, 'search-index.json');

const DETAIL_CODE = { movie: 'f', series: 'd', anime: 'n' };

// ── adult filter (mirror of src/lib/contentSafety.ts) ──────────────────────
const ADULT_PATTERNS = [
  /\bporn/i, /\bxxx\b/i, /\berotic/i, /\bhentai\b/i, /\becchi\b/i, /\bnsfw\b/i,
  /\bsex(?:y|ual)?\b/i, /\bnude|nudity\b/i, /\bnaked\b/i, /\bharem\b/i,
  /\b18\+|\br-?18\b/i, /\bsoftcore|hardcore\b/i, /\bbrazzers\b/i, /\bmilf\b/i,
  /\bseduc/i, /\bsensual\b/i, /\borgy|orgasm\b/i, /\bstrip(?:per|tease)\b/i,
  /\bfetish\b/i, /\blust\b/i, /\bbabe(?:station)?\b/i, /\bplayboy\b/i,
  /اباح/, /إباح/, /اباحي/, /جنس/, /جنسي/, /عاري|عارية/, /عُري|عري/,
  /إغواء|اغواء/, /إغراء|اغراء/, /شهوة|شهوات/, /فاضح/, /خلاع|خلاعة/,
  /دعار|دعارة/, /مثير(?:ة)? جنسي/, /ساخن(?:ة)? جدا/, /للكبار فقط/,
  /محظور|للبالغين/, /حريم/, /عشيق(?:ة)?/, /خيانة زوجية/, /إيتشي|ايتشي/,
  /هنتاي/, /نيك\b/, /سكس/, /سحاق/, /شاذ جنسي/,
];
function isAdult(t) {
  if (t.adult === true) return true;
  const hay = `${t.clean_title || ''} ${t.raw_name || ''} ${t.original_title || ''} ${t.genre || ''}`;
  return ADULT_PATTERNS.some((re) => re.test(hay));
}

const all = JSON.parse(readFileSync(ALL_PATH, 'utf8'));

const index = [];
for (const t of all) {
  if (isAdult(t)) continue;
  const url = t.is_new ? `/w/${t.slug}` : `/${DETAIL_CODE[t.category] || 'f'}/${t.slug}`;
  index.push({
    s: t.slug,
    t: t.clean_title,
    r: t.raw_name || '',
    c: t.category,
    cl: t.category_label,
    p: t.poster || null,
    u: url,
    y: t.year || null,
    e: t.episodes_count || 0,
    sc: t.seasons_count || 0,
    rt: t.tmdb_vote ?? (Number(t.rating) || 0),
  });
}

mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(OUT_PATH, JSON.stringify(index));
const newCount = all.filter((t) => t.is_new && !isAdult(t)).length;
const oldCount = index.length - newCount;
console.log(
  `[search-index] wrote ${index.length} entries (static: ${oldCount}, new/SSR: ${newCount}) → public/static/search-index.json`,
);
