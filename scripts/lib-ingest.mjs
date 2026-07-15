/**
 * Shared helpers for ingesting the tuktuk CSV into the CinemaPlus catalogue.
 *
 * Pure, dependency-free utilities: slug generation, name normalisation,
 * sub-category mapping and server-label inference. Kept separate so both the
 * "merge servers into existing works" pass and the "create new works" pass use
 * identical logic.
 */

/* ──────────────────────────  sub-category taxonomy  ────────────────────────
 * The CSV `category` column is an Arabic label that bundles BOTH the media kind
 * (film/series/anime) AND a sub-grouping (foreign / netflix / asian / turkish /
 * indian). We split it into:
 *   - category   : 'movie' | 'series' | 'anime'  (the existing top-level kind)
 *   - subcategory: a stable slug used for the new detailed listing pages
 */
export const CSV_CATEGORY_MAP = {
  'مسلسلات أجنبي': { category: 'series', sub: 'foreign-series', subLabel: 'مسلسلات أجنبي' },
  'مسلسلات نتفليكس': { category: 'series', sub: 'netflix-series', subLabel: 'مسلسلات نتفليكس' },
  'قائمة الأنمي': { category: 'anime', sub: 'anime', subLabel: 'أنمي' },
  'مسلسلات آسيوي': { category: 'series', sub: 'asian-series', subLabel: 'مسلسلات آسيوي' },
  'مسلسلات تركي': { category: 'series', sub: 'turkish-series', subLabel: 'مسلسلات تركي' },
  'أفلام أجنبي': { category: 'movie', sub: 'foreign-movies', subLabel: 'أفلام أجنبي' },
  'أفلام هندي': { category: 'movie', sub: 'indian-movies', subLabel: 'أفلام هندي' },
  'أفلام آسيوي': { category: 'movie', sub: 'asian-movies', subLabel: 'أفلام آسيوي' },
  'مسلسلات هندي': { category: 'series', sub: 'indian-series', subLabel: 'مسلسلات هندي' },
  'أفلام نتفليكس': { category: 'movie', sub: 'netflix-movies', subLabel: 'أفلام نتفليكس' },
  'أفلام تركي': { category: 'movie', sub: 'turkish-movies', subLabel: 'أفلام تركي' },
};

/** The new detailed listing pages we expose, in nav order. */
export const SUBCATEGORIES = [
  { sub: 'netflix-series', label: 'مسلسلات نتفليكس', category: 'series' },
  { sub: 'netflix-movies', label: 'أفلام نتفليكس', category: 'movie' },
  { sub: 'asian-series', label: 'مسلسلات آسيوي', category: 'series' },
  { sub: 'asian-movies', label: 'أفلام آسيوي', category: 'movie' },
  { sub: 'turkish-series', label: 'مسلسلات تركي', category: 'series' },
  { sub: 'turkish-movies', label: 'أفلام تركي', category: 'movie' },
  { sub: 'indian-series', label: 'مسلسلات هندي', category: 'series' },
  { sub: 'indian-movies', label: 'أفلام هندي', category: 'movie' },
  { sub: 'foreign-series', label: 'مسلسلات أجنبي', category: 'series' },
  { sub: 'foreign-movies', label: 'أفلام أجنبي', category: 'movie' },
  { sub: 'anime', label: 'أنمي', category: 'anime' },
];

/* ──────────────────────────  adult / indecent content filter  ──────────────
 * The user explicitly asked to exclude any indecent or semi-pornographic work
 * ("استبعد اي فلم او مسلسل مخل او شبه اباحية"). The source CSV is already the
 * "no_adult" export, but it still leaks soft-core / ecchi / hentai titles, so we
 * apply an additional keyword blocklist (Arabic + English) on top of TMDB's
 * own `adult` boolean. A work is rejected if ANY of:
 *   - TMDB returned adult === true
 *   - its name / title / genre matches the blocklist below
 */
const ADULT_PATTERNS = [
  // English / latin
  /\bporn/i, /\bxxx\b/i, /\berotic/i, /\bhentai\b/i, /\becchi\b/i, /\bnsfw\b/i,
  /\bsex(?:y|ual)?\b/i, /\bnude|nudity\b/i, /\bnaked\b/i, /\bharem\b/i,
  /\b18\+|\br-?18\b/i, /\bsoftcore|hardcore\b/i, /\bbrazzers\b/i, /\bmilf\b/i,
  /\bseduc/i, /\bsensual\b/i, /\borgy|orgasm\b/i, /\bstrip(?:per|tease)\b/i,
  /\bfetish\b/i, /\blust\b/i, /\bbabe(?:station)?\b/i, /\bplayboy\b/i,
  // Arabic
  /اباح/, /إباح/, /اباحي/, /جنس/, /جنسي/, /عاري|عارية/, /عُري|عري/,
  /إغواء|اغواء/, /إغراء|اغراء/, /شهوة|شهوات/, /فاضح/, /خلاع|خلاعة/,
  /دعار|دعارة/, /مثير(?:ة)? جنسي/, /ساخن(?:ة)? جدا/, /للكبار فقط/,
  /محظور|للبالغين/, /حريم/, /عشيق(?:ة)?/, /خيانة زوجية/, /إيتشي|ايتشي/,
  /هنتاي/, /نيك\b/, /سكس/, /سحاق/, /شاذ جنسي/,
];

/** True when a work looks indecent / semi-pornographic and must be excluded. */
export function isAdultContent({ name = '', title = '', genre = '', adult = false } = {}) {
  if (adult === true) return true;
  const haystack = `${name} ${title} ${genre}`;
  return ADULT_PATTERNS.some((re) => re.test(haystack));
}

/* ──────────────────────────  text helpers  ──────────────────────── */

/** Strip the trailing 4-digit year (e.g. "Foo 2025" -> "Foo"). Returns both. */
export function extractYear(name) {
  const m = name.match(/\b(19|20)\d{2}\b/);
  return m ? m[0] : null;
}

/** Latin/English part of a mixed Arabic+English name (used for TMDB search). */
export function extractEnglishTitle(name) {
  // Remove a trailing year then keep the longest Latin-letter run.
  const noYear = name.replace(/\b(19|20)\d{2}\b/g, ' ').trim();
  const latin = noYear.match(/[A-Za-z0-9][A-Za-z0-9 :.'!&,\-]*[A-Za-z0-9]/g);
  if (!latin) return null;
  // Longest Latin chunk is almost always the real (English) title.
  return latin.sort((a, b) => b.length - a.length)[0].trim();
}

/** Normalised key for matching a work against the existing catalogue. */
export function nameKey(name) {
  return name
    .toLowerCase()
    .replace(/\b(19|20)\d{2}\b/g, ' ')
    .replace(/[\u064B-\u065F\u0670]/g, '') // Arabic diacritics
    .replace(/[إأآا]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/[^0-9a-z\u0600-\u06FF]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Build a URL slug from a (possibly Arabic) work name. */
export function makeSlug(name) {
  const base = name
    .replace(/[\u064B-\u065F\u0670]/g, '')
    .replace(/[^0-9A-Za-z\u0600-\u06FF]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase();
  return base || 'title';
}

/** Infer a friendly server label from an iframe host. */
export function serverLabel(url) {
  try {
    const host = new URL(url).hostname.replace(/^www\./, '');
    const base = host.split('.')[0];
    return `${base} - HD`;
  } catch {
    return 'سيرفر - HD';
  }
}
