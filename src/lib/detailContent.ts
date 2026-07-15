import type { Title } from './types';

export type DetailKind = 'movie' | 'series' | 'anime';

export interface DetailFaq {
  question: string;
  answer: string;
}

export interface DetailRow {
  label: string;
  value: string;
}

export interface DetailPattern {
  id: number;
  title: string;
  intro: string;
  sectionTitle: string;
}

export interface DetailInsight {
  title: string;
  body: string;
}

export const BRAND_NAME = 'سينما بلس';

const GENRE_NORMALIZE: Record<string, string> = {
  اثاره: 'إثارة',
  اثارة: 'إثارة',
  إثارة: 'إثارة',
  تشويق: 'إثارة',
  أكشن: 'أكشن',
  اكشن: 'أكشن',
  حركة: 'أكشن',
  رعب: 'رعب',
  دراما: 'دراما',
  جريمة: 'جريمة',
  بوليسي: 'جريمة',
  كوميدي: 'كوميديا',
  كوميديا: 'كوميديا',
  ساخر: 'كوميديا',
  كرتون: 'أنمي',
  انمي: 'أنمي',
  أنمي: 'أنمي',
  'رسوم متحركة': 'أنمي',
  غموض: 'غموض',
  مغامرة: 'مغامرة',
  مغامرات: 'مغامرة',
  عائلي: 'عائلي',
  أطفال: 'عائلي',
  فانتازيا: 'فانتازيا',
  خيال: 'فانتازيا',
  سحر: 'فانتازيا',
  رومانسي: 'رومانسي',
  رومنسية: 'رومانسي',
  'خيال علمي': 'خيال علمي',
  فضاء: 'خيال علمي',
  // anime cultural genres — kept intact, just normalized spelling
  شونين: 'شونين',
  سينين: 'سينين',
  شوجو: 'شوجو',
  جوسي: 'جوسي',
  ايسيكاي: 'إيسيكاي',
  إيسيكاي: 'إيسيكاي',
  ايتشي: 'إيتشي',
  حريم: 'حريم',
  ميكا: 'ميكا',
  'شريحة من الحياة': 'شريحة من الحياة',
  'خارق للطبيعة': 'خارق للطبيعة',
  'قوة خارقة': 'قوة خارقة',
  'فنون قتالية': 'فنون قتالية',
  ساموراي: 'ساموراي',
  شياطين: 'شياطين',
  'مصاصي دماء': 'مصاصي دماء',
  رياضي: 'رياضي',
  مدرسي: 'مدرسي',
  نفسي: 'نفسي',
  موسيقى: 'موسيقى',
  موسيقي: 'موسيقى',
  عسكري: 'عسكري',
  تاريخي: 'تاريخي',
  'حرب وسياسة': 'حرب',
};

// Compound TMDB tokens that must be split into two clean genres.
const GENRE_SPLIT: Record<string, string[]> = {
  'خيال علمي وفانتازيا': ['خيال علمي', 'فانتازيا'],
  'حركة ومغامرة': ['أكشن', 'مغامرة'],
  'حرب وسياسة': ['حرب', 'سياسة'],
};

const arabicComma = '،';

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

export function cleanBrand(value: string | null | undefined): string {
  return normalizeWhitespace(String(value ?? ''))
    .replace(/Flixora/gi, BRAND_NAME)
    .replace(/فليكسورا/g, BRAND_NAME)
    .replace(/CINMAPRO/gi, BRAND_NAME)
    .replace(/Cinmapro/g, BRAND_NAME);
}

function seedFrom(value: string): number {
  let hash = 2166136261;
  for (const char of value) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function pick<T>(items: T[], seed: number, offset = 0): T {
  return items[(seed + offset) % items.length];
}

export function splitGenres(value: string | null | undefined): string[] {
  const seen = new Set<string>();
  const tokens: string[] = [];
  for (const raw of cleanBrand(value).split(/[\/،,•·]+/)) {
    const trimmed = raw.trim();
    if (!trimmed) continue;
    // Expand compound TMDB tokens first (e.g. "خيال علمي وفانتازيا").
    const expanded = GENRE_SPLIT[trimmed] || [trimmed];
    for (const part of expanded) tokens.push(GENRE_NORMALIZE[part.trim()] || part.trim());
  }
  return tokens.filter(Boolean).filter((genre) => {
    const key = genre.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * Anime-aware genre ordering: promotes the recognisable anime-culture tags
 * (شونين/سينين/إيسيكاي…) to the front so the chips read like an anime page,
 * not a generic movie page. Always ensures "أنمي" leads.
 */
const ANIME_CULTURE_ORDER = [
  'أنمي', 'شونين', 'سينين', 'شوجو', 'جوسي', 'إيسيكاي', 'إيتشي', 'حريم',
  'ميكا', 'شريحة من الحياة', 'خارق للطبيعة', 'قوة خارقة', 'فنون قتالية',
  'ساموراي', 'شياطين', 'مصاصي دماء', 'سحر',
];

export function orderAnimeGenres(genres: string[]): string[] {
  const set = new Set(genres);
  set.add('أنمي');
  const culture = ANIME_CULTURE_ORDER.filter((g) => set.has(g));
  const rest = [...set].filter((g) => !ANIME_CULTURE_ORDER.includes(g));
  return [...culture, ...rest];
}

export function splitPeople(value: string | null | undefined): string[] {
  return cleanBrand(value)
    .split(/[\/،,]+/)
    .map((person) => person.trim())
    .filter(Boolean);
}

export function getWorkTitle(title: Title): string {
  const stripped = cleanBrand(title.clean_title)
    .replace(/^(فيلم|مسلسل|انمي|أنمي)\s+/u, '')
    .replace(/\s+مترجم(?:ة)?(?:\s+اون\s+لاين)?/gu, '')
    .replace(/\s+اون\s+لاين/gu, '')
    .trim();
  return stripped || cleanBrand(title.clean_title);
}

export function getWorkTitleWithoutYear(title: Title): string {
  const workTitle = getWorkTitle(title);
  if (!title.year) return workTitle;
  return workTitle.replace(new RegExp(`\\s*${title.year}\\b`, 'g'), '').trim() || workTitle;
}

function getSeoWorkTitle(title: Title): string {
  return cleanBrand(title.seoContent?.arabicTitle || getWorkTitleWithoutYear(title));
}

function removeTitleNoise(value: string): string {
  return normalizeWhitespace(cleanBrand(value)
    .replace(/^(فيلم|مسلسل|انمي|أنمي)\s+/u, '')
    .replace(/\s+مترجم(?:ة)?(?:\s+اون\s+لاين)?/gu, '')
    .replace(/\s+اون\s+لاين/gu, '')
    .replace(/\b(19|20)\d{2}\b/g, '')
    .replace(/\s+/g, ' '))
    .replace(/^[\s\-–—|:]+|[\s\-–—|:]+$/g, '');
}

function hasLatin(value: string): boolean {
  return /[A-Za-z]/.test(value);
}

function extractForeignTitle(title: Title): string {
  const clean = removeTitleNoise(getWorkTitleWithoutYear(title));
  if (hasLatin(clean)) return clean;

  const raw = removeTitleNoise(title.raw_name);
  const latinMatch = raw.match(/[A-Za-z0-9][A-Za-z0-9\s.'&:+\-½!؟?]+[A-Za-z0-9½]/);
  if (latinMatch?.[0]) return removeTitleNoise(latinMatch[0]);

  return clean || removeTitleNoise(title.clean_title);
}

const ARABIZED_WORDS: Record<string, string> = {
  a: '',
  an: '',
  the: '',
  movie: '',
  film: '',
  series: '',
  season: '',
  of: 'اوف',
  and: 'اند',
  one: 'ون',
  two: 'تو',
  three: 'ثري',
  four: 'فور',
  five: 'فايف',
  six: 'سكس',
  seven: 'سفن',
  eight: 'إيت',
  nine: 'ناين',
  ten: 'تن',
  punch: 'بنش',
  man: 'مان',
  blue: 'بلو',
  lock: 'لوك',
  record: 'ريكورد',
  ragnarok: 'راجناروك',
  minecraft: 'ماينكرافت',
  bridgerton: 'بريدجرتون',
  emily: 'إيميلي',
  paris: 'باريس',
  elsbeth: 'إلسبث',
  abigail: 'أبيغيل',
  aftermath: 'أفترماث',
  afraid: 'أفريد',
  fargo: 'فارغو',
  foundation: 'فاونديشن',
  ghosts: 'غوستس',
  from: 'فروم',
  doctor: 'دكتور',
  who: 'هو',
  anime: 'أنمي',
  dragon: 'دراغون',
  ball: 'بول',
  super: 'سوبر',
  jujutsu: 'جوجوتسو',
  kaisen: 'كايسن',
  stone: 'ستون',
  golden: 'غولدن',
  kamuy: 'كاموي',
  hero: 'هيرو',
  academia: 'أكاديميا',
  stray: 'ستراي',
  dogs: 'دوغز',
  diamond: 'دايموند',
  ace: 'آيس',
  act: 'آكت',
  underground: 'أندرغراوند',
  windows: 'ويندوز',
  hours: 'هاورز',
  minutes: 'مينتس',
  seconds: 'سيكندز',
  followers: 'فولوورز',
};

function arabizeWord(word: string): string {
  const lower = word.toLowerCase();
  if (ARABIZED_WORDS[lower] !== undefined) return ARABIZED_WORDS[lower];
  if (/^\d+$/.test(word)) return word;

  let value = lower
    .replace(/tion\b/g, 'شن')
    .replace(/sion\b/g, 'جن')
    .replace(/ough/g, 'و')
    .replace(/igh/g, 'اي')
    .replace(/ph/g, 'ف')
    .replace(/sh/g, 'ش')
    .replace(/ch/g, 'تش')
    .replace(/th/g, 'ث')
    .replace(/ck/g, 'ك')
    .replace(/qu/g, 'كو')
    .replace(/x/g, 'كس')
    .replace(/oo/g, 'و')
    .replace(/ee/g, 'ي')
    .replace(/ea/g, 'ي')
    .replace(/ai/g, 'اي')
    .replace(/ay/g, 'اي')
    .replace(/oa/g, 'و')
    .replace(/ou/g, 'او')
    .replace(/ow/g, 'او');

  const letters: Record<string, string> = {
    a: 'ا',
    b: 'ب',
    c: 'ك',
    d: 'د',
    e: 'ي',
    f: 'ف',
    g: 'ج',
    h: 'ه',
    i: 'ي',
    j: 'ج',
    k: 'ك',
    l: 'ل',
    m: 'م',
    n: 'ن',
    o: 'و',
    p: 'ب',
    q: 'ك',
    r: 'ر',
    s: 'س',
    t: 'ت',
    u: 'و',
    v: 'ف',
    w: 'و',
    y: 'ي',
    z: 'ز',
  };

  value = value.replace(/[a-z]/g, (char) => letters[char] || char);
  return value.replace(/[^\u0600-\u06FF0-9]+/g, '').trim();
}

function buildArabizedTitle(foreignTitle: string, title: Title): string {
  if (!hasLatin(foreignTitle)) return getSeoWorkTitle(title);

  const words = foreignTitle
    .split(/[\s:_|/\\.,!?()[\]{}]+/)
    .map((word) => word.replace(/^['-]+|['-]+$/g, ''))
    .filter(Boolean);

  const arabized = words
    .map(arabizeWord)
    .filter(Boolean)
    .join(' ');

  return arabized || getSeoWorkTitle(title);
}

function truncateChars(value: string, max: number): string {
  const clean = normalizeWhitespace(value);
  if (clean.length <= max) return clean;
  if (max <= 1) return clean.slice(0, Math.max(0, max));
  const cut = clean.slice(0, max - 1);
  const lastSpace = cut.lastIndexOf(' ');
  return `${cut.slice(0, lastSpace > 8 ? lastSpace : max - 1).trim()}…`;
}

// Arabic "type" prefixes that classify the entry (OVA/ONA/special episode/…)
// rather than naming it. When such a prefix is the ONLY Arabic in a title, the
// real name is the Latin part — so we must NOT strip the Latin tail.
// NOTE: Arabic letters are not part of \w, so a trailing \b does NOT anchor
// after an Arabic word in JS regex. We use an explicit separator/end lookahead
// instead so the prefix is matched and removed reliably.
const TYPE_PREFIX_RE = /^\s*(?:اوفا|أوفا|أونا|اونا|الحلقة\s+الخاصة|حلقة\s+خاصة|فيلم|مسلسل|أنمي|انمي|موفي)(?=[\s:،.\-]|$)[\s:،.\-]*/u;

function stripTypePrefix(value: string): string {
  return normalizeWhitespace(value.replace(TYPE_PREFIX_RE, ''));
}

function seoNamePair(title: Title): { arabized: string; foreign: string } {
  // The natural, human title as stored on the site (native Arabic + Latin name,
  // e.g. "حب في ارض الفيروز Love on the Turquoise Land"). This is what readers
  // and search engines expect — far better than a phonetic transliteration.
  const natural = removeTitleNoise(getWorkTitleWithoutYear(title));

  // If the natural title already mixes Arabic and Latin, just use it as‑is —
  // UNLESS the only Arabic is a bare type prefix like "اوفا"/"أونا" (then the
  // real name is the Latin part, and we must not keep just the prefix).
  if (/[\u0600-\u06FF]/.test(natural) && hasLatin(natural)) {
    // Strip a leading type prefix (اوفا/أونا/فيلم…) so the description/name is
    // the real work name, not the classification word.
    const stripped = stripTypePrefix(natural);
    // If after stripping the Arabic part is gone (prefix was the only Arabic),
    // the true name is the Latin part → return it as the (Latin) name.
    if (!/[\u0600-\u06FF]/.test(stripped)) {
      return { arabized: '', foreign: normalizeWhitespace(stripped) || natural };
    }
    return { arabized: normalizeWhitespace(stripped) || natural, foreign: '' };
  }

  const foreign = extractForeignTitle(title);
  // Prefer the SEO arabic title when present; otherwise fall back to a phonetic
  // arabization only when we have nothing native to show.
  const seoArabic = removeTitleNoise(getSeoWorkTitle(title));
  const arabized = seoArabic && /[\u0600-\u06FF]/.test(seoArabic)
    ? seoArabic
    : removeTitleNoise(buildArabizedTitle(foreign, title));

  return {
    arabized,
    foreign: removeTitleNoise(foreign),
  };
}

/**
 * Build a clean, human‑readable SEO <title>.
 *
 * The previous implementation forced an "arabized | foreign" split with a hard
 * 60‑char cap. For Arabic titles that already contain both the native name AND
 * the Latin name (e.g. "حب في ارض الفيروز Love on the Turquoise Land") this
 * produced BROKEN, DUPLICATED, mid‑word‑truncated titles such as
 * "حب في ارض… | حب في ارض… مسلسل مترجم اون لاين — سينما بلس", which Google
 * dislikes (it is a strong "crawled – not indexed" signal).
 *
 * New logic: prefer the natural full name (native + Latin as stored), append a
 * descriptive suffix, and only truncate ONCE, on a word boundary, without
 * repeating the name. The cap is raised to a comfortable length for Arabic.
 */
function fitSeoTitle(arabized: string, foreign: string, kind: DetailKind): string {
  const type = typeName(kind);
  const suffix = ` ${type} مترجم اون لاين — ${BRAND_NAME}`;
  const max = 65;

  // Pick the richest single name string, de‑duplicating the two candidates so we
  // never print the same words twice.
  const a = normalizeWhitespace(arabized);
  const f = normalizeWhitespace(foreign);
  let name: string;
  if (!f || a === f) {
    name = a || f;
  } else if (a && f.includes(a)) {
    name = f; // foreign already contains the arabized part
  } else if (f && a.includes(f)) {
    name = a; // arabized already contains the foreign part
  } else if (a && f) {
    name = `${a} ${f}`; // genuinely different -> keep both, space‑separated (no " | ")
  } else {
    name = a || f;
  }
  name = normalizeWhitespace(name);

  const full = `${name}${suffix}`;
  if (full.length <= max) return full;

  // Too long. For a mixed Arabic+Latin name, drop the Latin tail and keep the
  // clean Arabic name (what an Arabic-speaking searcher types) — this avoids
  // truncating a Latin word mid-way and keeps the title meaningful.
  //
  // BUT only do this when the Arabic part is a REAL name, not merely a type
  // prefix like "اوفا"/"أونا" (dropping the Latin there would leave a useless,
  // duplicated-across-works title like "اوفا فيلم مترجم اون لاين"). In that
  // case we keep/trim the Latin name instead.
  if (/[\u0600-\u06FF]/.test(name) && hasLatin(name)) {
    const arabicOnly = normalizeWhitespace(
      name.replace(/[A-Za-z0-9][A-Za-z0-9\s.,:'&+\-!؟?()]*$/u, '')
    );
    const arabicNameOnly = stripTypePrefix(arabicOnly); // drop leading "اوفا"/… 
    const hasRealArabicName = /[\u0600-\u06FF]/.test(arabicNameOnly)
      && arabicNameOnly.length >= 3;
    if (hasRealArabicName) {
      if ((`${arabicOnly}${suffix}`).length <= max) {
        return `${arabicOnly}${suffix}`;
      }
      return `${truncateChars(arabicOnly, Math.max(16, max - suffix.length))}${suffix}`;
    }
    // Arabic part is only a type prefix → keep the Latin (real) name, trimmed.
    const latinName = stripTypePrefix(name);
    if (latinName) {
      const budget = Math.max(16, max - suffix.length);
      return `${truncateChars(latinName, budget)}${suffix}`;
    }
  }

  // Otherwise truncate the NAME once, on a word boundary, keep the suffix intact.
  const nameBudget = Math.max(16, max - suffix.length);
  const trimmedName = truncateChars(name, nameBudget);
  return `${trimmedName}${suffix}`;
}

/**
 * A UNIQUE, metadata-driven description for works whose crawled plot was
 * boilerplate (discarded by sourceStory). Combines genre + year + season/
 * episode counts + quality so every page reads differently — avoiding the
 * near-duplicate "thin content" that caused "Crawled – not indexed".
 */
function metadataTeaser(title: Title, kind: DetailKind): string {
  const type = typeLabel(kind); // الفيلم / المسلسل / الأنمي
  const genres = splitGenres(title.genre).slice(0, 3).join('، ');
  const year = title.year ? ` المنتَج عام ${title.year}` : '';
  const quality = cleanBrand(title.quality) || 'HD';
  const parts: string[] = [];

  if (kind === 'movie') {
    parts.push(
      genres
        ? `${type} من نوع ${genres}${year}، بترجمة عربية دقيقة وجودة ${quality}`
        : `${type}${year} بترجمة عربية دقيقة وجودة ${quality}`
    );
    parts.push('يمكنك المشاهدة المباشرة عبر أكثر من سيرفر مع اختيار الجودة المناسبة');
  } else {
    const seasons = Number(title.seasons_count) || 0;
    const episodes = Number(title.episodes_count) || 0;
    const counts = episodes
      ? `${seasons > 1 ? `${seasons} مواسم و` : ''}${episodes} حلقة`
      : '';
    parts.push(
      genres
        ? `${type} من نوع ${genres}${year}${counts ? `، يضم ${counts}` : ''}`
        : `${type}${year}${counts ? ` يضم ${counts}` : ''}`
    );
    parts.push('مع قائمة الحلقات كاملة وروابط مشاهدة مباشرة بترجمة عربية وجودة عالية');
  }
  return normalizeWhitespace(parts.filter(Boolean).join('، '));
}

function buildSeoTeaser(title: Title, max: number, kind: DetailKind = 'movie'): string {
  // Use the uniquified plot so the meta description differs from the mirror
  // site; fall back to the raw story/description fields.
  const story = normalizeWhitespace(
    cleanBrand(uniquifyPlot(title, kind) || sourceStory(title) || '')
  );
  // Boilerplate/empty plots → build a UNIQUE metadata-driven description.
  if (!story) return truncateChars(metadataTeaser(title, kind), max);

  // لا نقسم عند الفاصلة العربية؛ هذا كان ينتج أوصافاً مبتورة مثل: "تبدأ القصة عندما تلتقي بيري".
  const sentenceParts = story
    .split(/[.!؟?]+/)
    .map((part) => part.trim())
    .filter(Boolean);
  const firstSentence = sentenceParts[0] || story;
  const candidate = firstSentence.length >= 70 || sentenceParts.length === 1
    ? firstSentence
    : `${firstSentence}. ${sentenceParts[1] || ''}`.trim();

  return truncateChars(candidate || fallback, max);
}

export function getDisplayTitle(title: Title): string {
  return cleanBrand(title.clean_title);
}

/**
 * Signatures of the auto-generated, near-duplicate plot text that was crawled
 * from the mirror source. These sentences are shared verbatim (only the name
 * differs) across HUNDREDS of works, so treating them as real content made
 * Google flag the pages as duplicate/thin ("Crawled – currently not indexed").
 * When a story matches one of these we discard it and build a unique,
 * metadata-driven description instead (see buildSeoTeaser fallback).
 */
const BOILERPLATE_STORY_RE: RegExp[] = [
  /ضمن أجواء درامية وترفيهية/,
  /تتطور الحكاية عبر شخصيات ومواقف تمنح العمل طابعه الخاص/,
  /يتوفر العمل كصفحة/,
  /تساعد هذه المعلومات على فهم طبيعة العمل/,
  /اختر الحلقة التي تريد مشاهدتها وبدّل بين السيرفرات/,
  /العمل يحتوي على \d+ حلقة في الموسم/,
];

function isBoilerplateStory(story: string): boolean {
  return BOILERPLATE_STORY_RE.some((re) => re.test(story));
}

function sourceStory(title: Title): string {
  let story = cleanBrand(title.story || title.description || title.clean_title);
  story = story
    .replace(/تجربة سينمائية مشوّقة[:：]?\s*/gu, '')
    .replace(/تجربة سينمائية مشوقة[:：]?\s*/gu, '');

  // Discard auto-generated near-duplicate plots entirely — a metadata-driven
  // fallback description (built in buildSeoTeaser) is more useful AND unique.
  if (isBoilerplateStory(story)) return '';

  // For REAL stories, strip a leading occurrence of the FULL work name so the
  // meta description does not repeat it (the page prefix already says the name).
  const workName = getWorkTitleWithoutYear(title) || cleanBrand(title.clean_title);
  if (workName && workName.length > 3) {
    const escaped = workName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    story = normalizeWhitespace(
      story.replace(new RegExp(`^([^.،؛]{0,40}?)\\s*${escaped}\\s+`, 'u'), '$1 ')
    );
  }

  const markers = [
    `على ${BRAND_NAME}`,
    `عبر ${BRAND_NAME}`,
    `متاح للمشاهدة`,
    `استمتع بمشاهدته`,
    `يعرض على`,
    `تقدمه لكم منصة`,
    `تقدّمه لكم منصّة`,
    `وتقدمه لكم منصة`,
    `وتقدّمه لكم منصّة`,
    `منصة ${BRAND_NAME}`,
    `منصّة ${BRAND_NAME}`,
    `— متاح`,
    `— استمتع`,
    `صدر عام`,
    `(صدر عام`,
  ];
  for (const marker of markers) {
    const idx = story.indexOf(marker);
    if (idx > 20) story = story.slice(0, idx);
  }
  return normalizeWhitespace(story.replace(/[،,\-—\s]+$/u, '').replace(/\.+$/u, ''));
}

function truncateWords(text: string, limit: number): string {
  const words = normalizeWhitespace(text).split(' ').filter(Boolean);
  if (words.length <= limit) return words.join(' ');
  return `${words.slice(0, limit).join(' ')}...`;
}

/* ───────────────────────── plot de-duplication ─────────────────────────
 * An older mirror site reuses the exact same crawled plot text we ingest, so
 * publishing those plots verbatim made Google treat our pages as duplicates
 * of the already-indexed mirror. To keep the meaning intact while making the
 * primary visible paragraph (and meta/JSON-LD descriptions) genuinely unique,
 * we wrap the original plot in a deterministic, per-title Arabic framing: a
 * varied lead-in + a varied closing clause keyed by the slug seed. Same title
 * → same output (stable for caching/diffs); different titles → different
 * phrasing; and the block no longer byte-matches the mirror's plain plot.
 */
const PLOT_LEAD_INS: Record<DetailKind, string[]> = {
  movie: [
    'في هذا الفيلم،',
    'تدور أحداث الفيلم حيث',
    'على امتداد الأحداث،',
    'ضمن خط درامي متصاعد،',
    'منذ المشاهد الأولى،',
    'تأخذنا القصة إلى عالم',
    'تتكشف الحكاية عندما',
    'يضعنا الفيلم أمام موقف',
  ],
  series: [
    'على مدى حلقات المسلسل،',
    'تتوالى أحداث المسلسل حيث',
    'يبني المسلسل عالمه عندما',
    'مع تتابع المواسم،',
    'تنطلق القصة من لحظة',
    'يأخذنا المسلسل إلى',
    'تتشابك الخيوط حين',
    'منذ الحلقة الأولى،',
  ],
  anime: [
    'في هذا الأنمي،',
    'تتطور أحداث الأنمي حيث',
    'يفتح الأنمي عالمه عندما',
    'مع تقدّم الحلقات،',
    'تبدأ الرحلة حين',
    'يصحبنا الأنمي إلى',
    'تتصاعد الأحداث عندما',
    'منذ بداية القصة،',
  ],
};

const PLOT_CLOSERS: Record<DetailKind, string[]> = {
  movie: [
    'في تجربة مشاهدة تمزج التشويق بالتفاصيل الإنسانية.',
    'لتقدّم حبكة محكمة تشدّ المشاهد حتى النهاية.',
    'بأسلوب بصري يمنح كل مشهد وزنه الخاص.',
    'مع إيقاع يوازن بين الهدوء ولحظات الذروة.',
    'لتبقى الأحداث مفتوحة على أكثر من احتمال.',
    'في قالب يجمع بين الحبكة والعاطفة.',
  ],
  series: [
    'لتتشكّل دراما ممتدة تتعمّق مع كل حلقة.',
    'في بناء سردي يكشف أوراقه تدريجيًا.',
    'مع تطوّر مستمر للشخصيات والعلاقات.',
    'لتظل المتابعة مشدودة من موسم لآخر.',
    'في خط درامي يتسع كلما تقدّمت الحلقات.',
    'مع مزيج من التوتر والتحولات غير المتوقعة.',
  ],
  anime: [
    'في عالم بصري غنيّ يتطوّر مع كل حلقة.',
    'لترافق رحلة الشخصيات وهي تتغيّر.',
    'بمزيج من الحركة والعمق العاطفي.',
    'مع تصاعد تدريجي يكشف أبعاد القصة.',
    'في سرد يوازن بين الإثارة والمشاعر.',
    'لتظل التفاصيل الصغيرة مؤثرة حتى النهاية.',
  ],
};

/**
 * Lower-case first Arabic letter handling is irrelevant in Arabic, so we just
 * trim trailing punctuation off the plot before splicing it into a sentence.
 */
function trimPlotTail(plot: string): string {
  return normalizeWhitespace(plot).replace(/[.،,؛!؟\s]+$/u, '');
}

/**
 * Returns a unique, meaning-preserving version of the source plot for a title.
 * Deterministic per slug. If there is no usable plot, returns ''.
 */
export function uniquifyPlot(title: Title, kind: DetailKind): string {
  const raw = trimPlotTail(sourceStory(title));
  if (!raw || raw.length < 30) return '';

  const seed = seedFrom(`plot-${title.slug}`);
  const leadIn = pick(PLOT_LEAD_INS[kind], seed);
  const closer = pick(PLOT_CLOSERS[kind], seed, 3);

  // Splice in the lead-in: strip the original's opening template clause (which
  // often embeds the type word AND the full name) so the sentence reads
  // naturally after our lead-in and never repeats "أنمي/فيلم" or the title.
  // e.g. "يدور أنمي أونا Modern Love Tokyo حول علاقة…" → "علاقة…"
  //      "يعتمد فيلم Ai no Utagoe wo Kikasete على انتقال…" → "انتقال…"
  // type words (with/without hamza) + optional demonstrative "هذا/هذه".
  const type = '(?:أنمي|انمي|مسلسل|فيلم|أونا|اونا|أوفا|اوفا|موفي)';
  const lead = `(?:هذا\\s+|هذه\\s+)?(?:${type}\\s+)`;
  let body = raw
    // "تدور (أحداث|احداث) (هذا) (الأنمي|الانمي…) حول " → after حول
    .replace(/^تدور\s+[أا]حداث\s+(?:هذا\s+|هذه\s+)?(?:ال[أا]نمي|المسلسل|الفيلم)?\s*حول\s+/u, '')
    .replace(/^تدور\s+[أا]حداث\s+[^؛.]*?\s+حول\s+/u, '')
    // "يدور <type>* <NAME up to connector> حول " → after حول
    .replace(new RegExp(`^يدور\\s+(?:${lead})*[^؛.]*?\\s+حول\\s+`, 'u'), '')
    // "يعتمد <type>* <NAME> على " → after على
    .replace(new RegExp(`^يعتمد\\s+(?:${lead})*[^؛.]*?\\s+على\\s+`, 'u'), '')
    // "تبدأ قصة <NAME> من/عند " → after من/عند
    .replace(/^تبدأ\s+(?:قصة|القصة|الأحداث|أحداث)\s+[^؛.]*?\s+(?:من|عند|عندما|حين|حيث)\s+/u, '')
    .replace(/^تدور\s+[أا]حداث\s+/u, '')
    .replace(/^القصة\s+تدور\s+حول\s+/u, '')
    // A bare leading "(هذا) <type> <type?> <NAME?> " with no connector.
    .replace(new RegExp(`^(?:هذا\\s+|هذه\\s+)?(?:${type}\\s+){1,2}(?:مترجم\\s+)?`, 'u'), '')
    .trim() || raw;
  body = normalizeWhitespace(body)
    // Belt-and-braces: never let a type word lead the spliced body.
    .replace(new RegExp(`^(?:في\\s+)?(?:${type})(?:\\s+(?:${type}|مترجم))*\\s+`, 'u'), '');
  body = normalizeWhitespace(body);

  // Guard: if stripping left something that still starts with a type word or is
  // too short to be a real clause, fall back to the raw text minus a type lead.
  if (body.length < 20) {
    body = normalizeWhitespace(raw.replace(new RegExp(`^(?:${type}\\s+){1,3}`, 'u'), '')) || raw;
  }

  return `${leadIn} ${body}، ${closer}`.replace(/\s+/g, ' ').trim();
}

function clampChars(text: string, max = 158): string {
  const clean = normalizeWhitespace(text);
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max - 1);
  const lastSpace = cut.lastIndexOf(' ');
  return `${cut.slice(0, lastSpace > 90 ? lastSpace : max - 1).trim()}...`;
}

function hasGenre(genres: string[], patterns: RegExp[]): boolean {
  return genres.some((genre) => patterns.some((pattern) => pattern.test(genre)));
}

function typeLabel(kind: DetailKind): string {
  if (kind === 'movie') return 'الفيلم';
  if (kind === 'series') return 'المسلسل';
  return 'الأنمي';
}

function typeName(kind: DetailKind): string {
  if (kind === 'movie') return 'فيلم';
  if (kind === 'series') return 'مسلسل';
  return 'أنمي';
}

function genreText(title: Title, kind: DetailKind): string {
  let genres = splitGenres(title.genre);
  if (kind === 'anime') genres = orderAnimeGenres(genres);
  return genres.length ? genres.join(`${arabicComma} `) : kind === 'anime' ? 'أنمي' : 'دراما';
}

export function getRating(title: Title): string | null {
  const rating = title.rating ?? title.imdb_rating;
  return rating === null || rating === undefined || rating === '' ? null : String(rating);
}

/**
 * Rating with an explicit, truthful SOURCE so the number is never presented as
 * a bare "score" that a search engine could read as deceptive/fabricated.
 * Prefers the genuine TMDB vote average (most works carry it), then falls back
 * to IMDb. Returns null when there is no credible rating to show.
 */
/**
 * Minimum TMDB vote count for a rating to be trustworthy. TMDB shows raw
 * averages even for titles with a single vote, which produces misleading
 * "10/10" or "9/10" scores on obscure works. We hide the number below this
 * threshold so the site never surfaces a fabricated-looking score (which a
 * search engine could read as deceptive). Tunable in one place.
 */
const MIN_TMDB_VOTES = 30;

export function getRatingInfo(
  title: Title,
): { value: string; source: 'TMDB' | 'IMDb'; url: string; votes: number } | null {
  const tmdb = (title as any).tmdb_vote;
  const votes = Number((title as any).tmdb_votes) || 0;
  const tmdbUrl = (title as any).tmdb_url || 'https://www.themoviedb.org/';
  if (
    tmdb !== null &&
    tmdb !== undefined &&
    Number(tmdb) > 0 &&
    votes >= MIN_TMDB_VOTES
  ) {
    return {
      value: Number(tmdb).toFixed(1),
      source: 'TMDB',
      url: tmdbUrl,
      votes,
    };
  }
  const imdb = title.imdb_rating ?? title.rating;
  if (imdb !== null && imdb !== undefined && imdb !== '' && Number(imdb) > 0) {
    return { value: String(imdb), source: 'IMDb', url: 'https://www.imdb.com/', votes: 0 };
  }
  return null;
}

export function getServerCount(title: Title): number {
  let count = 0;
  for (const season of title.seasons || []) {
    for (const episode of season.episodes || []) count = Math.max(count, episode.servers?.length || 0);
  }
  return count;
}

export function serverCountLabel(title: Title): string {
  const count = getServerCount(title);
  if (count === 0) return 'غير محدد';
  if (count === 1) return 'سيرفر واحد';
  if (count === 2) return 'سيرفران';
  return `${count} سيرفرات`;
}

function countryTag(country: string | null | undefined): string | null {
  const value = cleanBrand(country);
  if (!value) return null;
  if (/الولايات|امريك|أمريك|USA|United States/i.test(value)) return 'أمريكي';
  if (/اليابان|Japan/i.test(value)) return 'ياباني';
  if (/كوريا/i.test(value)) return 'كوري';
  if (/المملكة المتحدة|بريطان|إنجلترا|انجلترا/i.test(value)) return 'بريطاني';
  if (/فرنسا|French/i.test(value)) return 'فرنسي';
  if (/كندا|Canada/i.test(value)) return 'كندي';
  if (/الهند|India/i.test(value)) return 'هندي';
  if (/الصين|China/i.test(value)) return 'صيني';
  if (/اسبانيا|إسبانيا|Spain/i.test(value)) return 'إسباني';
  return value;
}

export function getCategoryTags(title: Title, kind: DetailKind): string[] {
  let tags = splitGenres(title.genre);
  if (kind === 'anime') tags = orderAnimeGenres(tags);
  if (title.year) {
    const prefix = kind === 'movie' ? 'أفلام' : kind === 'series' ? 'مسلسلات' : 'أنمي';
    tags.push(`${prefix} ${title.year}`);
  }
  const production = countryTag(title.country);
  if (production) tags.push(production);
  return [...new Set(tags.filter(Boolean))];
}

function genreProfile(title: Title, kind: DetailKind) {
  const genres = splitGenres(title.genre);
  const seed = seedFrom(`${title.slug}-${title.clean_title}`);
  if (kind === 'anime') {
    return {
      focus: pick(['تحولات الشخصيات', 'إيقاع الحلقات', 'العالم البصري', 'الصراع الداخلي', 'طاقة المواجهات'], seed),
      atmosphere: hasGenre(genres, [/رعب/, /غموض/])
        ? 'أجواء تميل إلى الظلال والغموض، حيث يصبح الصمت جزءا من التوتر لا مجرد فراغ بين المشاهد'
        : hasGenre(genres, [/أكشن/, /مغامرة/, /فانتازيا/])
          ? 'حيوية واضحة في الحركة والتحولات البصرية، مع مساحة جيدة لبناء الرهانات قبل المواجهات'
          : 'أجواء تمنح الشخصيات وقتها، وتوازن بين المشاعر وبناء العالم',
      craft: 'يعتمد السرد على تراكم الحلقات، لذلك تصبح التفاصيل الصغيرة في الحوار والقرارات مهمة مع كل موسم',
      audience: hasGenre(genres, [/أكشن/]) ? 'محبي الأكشن والشونن والمواجهات المتصاعدة' : 'محبي الأنمي الذي يترك أثرا بعد انتهاء الحلقة',
      pace: hasGenre(genres, [/أكشن/, /إثارة/]) ? 'سريع في اللحظات المحورية' : 'متدرج ويمنح الشخصيات مساحة',
      family: hasGenre(genres, [/رعب/, /جريمة/, /إثارة/]) ? 'يفضل مراجعته قبل المشاهدة العائلية' : 'قد يناسب المشاهدة العائلية حسب عمر المشاهد',
      violence: hasGenre(genres, [/أكشن/, /رعب/, /جريمة/]) ? 'قد تظهر مواجهات أو مشاهد توتر' : 'لا يعتمد أساسا على العنف',
    };
  }
  if (hasGenre(genres, [/رعب/, /غموض/])) {
    return {
      focus: pick(['الصوت والظل', 'المطاردة النفسية', 'الخوف من المجهول', 'توزيع المعلومات', 'الإحساس بالخطر'], seed),
      atmosphere: 'قاتمة ومبنية على التوتر النفسي والمفاجآت المحسوبة',
      craft: 'يستفيد السرد من تأخير الإجابات، فيترك المشاهد يركب الاحتمالات قبل أن يكشف ما يخفيه المشهد التالي',
      audience: 'مشاهدي الرعب والإثارة الذين يفضلون الضغط النفسي على الحلول السهلة',
      pace: 'متدرج ثم يشتد قرب المنعطفات',
      family: 'غالبا لا يناسب المشاهدة العائلية الصغيرة',
      violence: 'قد يحتوي على مشاهد توتر أو عنف أو صور مزعجة',
    };
  }
  if (hasGenre(genres, [/أكشن/, /حربي/, /مغامرة/])) {
    return {
      focus: pick(['تصميم المطاردات', 'إدارة الإيقاع', 'القرارات تحت الضغط', 'التصعيد البصري', 'حضور البطل في لحظة الخطر'], seed),
      atmosphere: 'سريعة ومشدودة، وفيها حضور واضح للمواجهات والقرارات تحت الضغط',
      craft: 'يقوم الإخراج على الحركة الواضحة وتصعيد الإيقاع من مشهد إلى آخر',
      audience: 'من يريد تجربة حماسية مباشرة مع جرعة درامية تثبت الرهانات',
      pace: 'سريع ومناسب للمشاهدة بجودة عالية',
      family: 'قد يحتاج إلى تقدير عمر المشاهد بسبب مشاهد المواجهة',
      violence: 'قد يحتوي على اشتباكات ومشاهد حركة مكثفة',
    };
  }
  if (hasGenre(genres, [/جريمة/, /تحقيق/])) {
    return {
      focus: pick(['الدوافع الخفية', 'تفاصيل الجريمة', 'السيناريو والتحقيق', 'تبدل الشكوك', 'المواجهة بين الحقيقة والوهم'], seed),
      atmosphere: 'متوترة وفضولية، وتدفع المشاهد إلى تتبع القرائن والدوافع',
      craft: 'يميل السرد إلى ترتيب المعلومات على مراحل حتى تتحول التفاصيل الصغيرة إلى مفاتيح مهمة',
      audience: 'محبي الجريمة والتحقيقات والقصص التي تكافئ الانتباه',
      pace: 'متوسط مع لحظات تصعيد واضحة',
      family: 'يفضل مراجعته قبل المشاهدة العائلية',
      violence: 'قد تظهر مشاهد جريمة أو تهديدات مباشرة',
    };
  }
  if (hasGenre(genres, [/خيال علمي/, /فانتازيا/])) {
    return {
      focus: pick(['بناء العالم', 'قواعد الخيال', 'الأسئلة الوجودية', 'المؤثرات والمعنى', 'الرحلة بين الدهشة والخطر'], seed),
      atmosphere: 'واسعة وتستفيد من الفكرة غير الواقعية لطرح أسئلة عن الاختيار والنتائج',
      craft: 'يهتم السرد ببناء العالم وتوضيح قوانينه دون التخلي عن الجانب الإنساني',
      audience: 'محبي العوالم المتخيلة والقصص التي تمزج الدهشة بالتوتر',
      pace: 'متدرج مع لحظات انبهار وتصعيد',
      family: 'يعتمد تقييمه على طبيعة المشاهد لا على الفكرة وحدها',
      violence: 'قد يحتوي على مواجهات أو مخاطر مرتبطة بعالمه',
    };
  }
  if (hasGenre(genres, [/كوميد/])) {
    return {
      focus: pick(['توقيت النكتة', 'الكيمياء بين الشخصيات', 'المفارقة اليومية', 'خفّة الحوار', 'اللعب على التوقعات'], seed),
      atmosphere: 'خفيفة ومرنة، وتمنح المواقف اليومية مساحة لتتحول إلى مفارقات طريفة',
      craft: 'يراهن السرد على الإيقاع والحوار وتبادل المواقف بدل التصعيد الثقيل',
      audience: 'من يبحث عن مشاهدة مرحة لا تتخلى عن لمسة إنسانية',
      pace: 'خفيف ومتوازن',
      family: 'قد يناسب المشاهدة العائلية مع مراجعة التصنيف العمري',
      violence: 'لا يعتمد على العنف غالبا',
    };
  }
  return {
    focus: pick(['العمق الدرامي', 'تبدل العلاقات', 'الأداء الهادئ', 'القرارات الصعبة', 'السيناريو الداخلي للشخصيات'], seed),
    atmosphere: 'درامية وتركز على التحولات النفسية والعلاقات التي تتبدل تحت ضغط الأحداث',
    craft: 'يمنح السرد التفاصيل اليومية قيمة درامية ويترك مساحة للأداء كي يقود المشهد',
    audience: 'من يفضل الأعمال القائمة على الشخصيات والمشاعر والاختيارات الصعبة',
    pace: 'هادئ إلى متوسط',
    family: 'يعتمد على طبيعة الموضوع والتصنيف العمري',
    violence: 'لا يقوم أساسا على العنف',
  };
}

const DETAIL_PATTERNS = [
  {
    title: 'قراءة في السيناريو',
    intro: 'هذا النمط يركز على طريقة بناء الحكاية وتوزيع المعلومات داخل الصفحة.',
    sectionTitle: 'زاوية السيناريو',
  },
  {
    title: 'تحليل الحبكة',
    intro: 'هذا النمط يمنح مساحة أكبر لتطور الفكرة وما يدفع الأحداث إلى الأمام.',
    sectionTitle: 'الحبكة وما تخفيه',
  },
  {
    title: 'الشخصيات والأداء',
    intro: 'هذا النمط يهتم بحضور الشخصيات وطريقة تأثيرها في الإيقاع العام.',
    sectionTitle: 'الشخصيات تحت الضوء',
  },
  {
    title: 'الإيقاع وتجربة المشاهدة',
    intro: 'هذا النمط يقرأ سرعة العمل وكيف تتوزع لحظات الهدوء والتصعيد.',
    sectionTitle: 'الإيقاع قبل القصة',
  },
  {
    title: 'الأجواء والعالم',
    intro: 'هذا النمط يبرز المكان والنبرة البصرية والشعور العام الذي يرافق المشاهدة.',
    sectionTitle: 'العالم والأجواء',
  },
  {
    title: 'العمق الدرامي',
    intro: 'هذا النمط يبحث في الطبقات العاطفية والقرارات التي تترك أثرا بعد النهاية.',
    sectionTitle: 'الطبقة الدرامية',
  },
  {
    title: 'التوتر والمفاجآت',
    intro: 'هذا النمط يناسب الأعمال التي تعتمد على الغموض أو الخطر أو تبدل التوقعات.',
    sectionTitle: 'مصدر التوتر',
  },
  {
    title: 'الصورة والإخراج',
    intro: 'هذا النمط يلتفت إلى الصورة والإخراج وطريقة تقديم المشاهد المهمة.',
    sectionTitle: 'اللغة البصرية',
  },
  {
    title: 'لمن يناسب العمل',
    intro: 'هذا النمط يوضح الجمهور الأقرب للعمل وما يجب توقعه قبل المشاهدة.',
    sectionTitle: 'الجمهور المناسب',
  },
  {
    title: 'نقاط التميز',
    intro: 'هذا النمط يجمع العناصر التي تمنح العمل اختلافه عن أعمال مشابهة.',
    sectionTitle: 'ما الذي يميزه؟',
  },
] satisfies Omit<DetailPattern, 'id'>[];

export function getDetailPattern(title: Title, kind: DetailKind, patternId?: number): DetailPattern {
  const id = typeof patternId === 'number'
    ? Math.abs(Math.trunc(patternId)) % DETAIL_PATTERNS.length
    : seedFrom(`${kind}-${title.slug}`) % DETAIL_PATTERNS.length;
  return { id, ...DETAIL_PATTERNS[id] };
}

export function buildPatternInsight(title: Title, kind: DetailKind, patternId?: number): DetailInsight {
  const name = getWorkTitle(title);
  const pattern = getDetailPattern(title, kind, patternId);
  const profile = genreProfile(title, kind);
  const story = truncateWords(sourceStory(title), 30);
  const people = splitPeople(title.stars).slice(0, 2).join(`${arabicComma} `);
  const director = title.director ? cleanBrand(title.director) : null;
  const variants = [
    {
      title: `كيف يتحرك سيناريو ${name}؟`,
      body: `الصفحة هنا لا تكتفي بملخص سريع؛ فهي تقرأ ${name} من زاوية السيناريو، حيث تبدأ الفكرة من ${story || 'خط درامي واضح'} ثم تتوسع عبر التفاصيل الصغيرة. قيمة العمل تظهر في ${profile.focus} وفي طريقة تأخير بعض الإجابات حتى يبقى الفضول حاضرًا قبل الانتقال إلى المشاهدة.`,
    },
    {
      title: `الحبكة في ${name}`,
      body: `ما يهم في هذا العمل ليس الحدث الأول فقط، بل الطريقة التي تتغير بها دلالته مع الوقت. ${pattern.intro} لذلك تظهر المعلومات الأساسية بجانب الملاحظات والتصنيفات حتى يستطيع الزائر فهم طبيعة الحبكة قبل أن يقرر إن كان العمل مناسبًا له.`,
    },
    {
      title: `حضور الشخصيات في ${name}`,
      body: people
        ? `وجود ${people} يمنح الصفحة مدخلا مختلفا لقراءة العمل، لأن الشخصيات هنا ليست أسماء مضافة إلى البيانات فقط، بل جزء من فهم الصراع والنبرة. التركيز يكون على ما تكشفه الاختيارات وردود الفعل، لا على ملخص القصة وحده.`
        : `الشخصيات في ${name} تقود الإحساس العام بالعمل حتى عند غياب بيانات طاقم كاملة. لذلك يركز هذا النمط على ردود الفعل والتحولات الصغيرة التي تجعل المشاهدة مرتبطة بما يحدث داخل الشخصية لا بما يحدث حولها فقط.`,
    },
    {
      title: `نظرة سريعة إلى ${name}`,
      body: `إيقاع العمل ${profile.pace}، وهذا يؤثر في طريقة قراءة الصفحة نفسها. بدل تقديم كل شيء كتقرير واحد، يظهر هذا النمط معلومات المشاهدة والجودة وما قبل المشاهدة بشكل أوضح، حتى يعرف الزائر هل يحتاج جلسة متابعة سريعة أم مشاهدة أهدأ.`,
    },
    {
      title: `أجواء ${name}`,
      body: `الأجواء في هذا العمل ${profile.atmosphere}. لهذا تركز الصفحة على النبرة قبل التفاصيل التقنية، لأن بعض الأعمال تُفهم من إحساسها العام قبل أن تُفهم من ملخصها. التصنيفات والتريلر هنا يساعدان على التقاط هذا الشعور بسرعة.`,
    },
    {
      title: `العمق الدرامي في ${name}`,
      body: `يترك ${name} مساحة للتأمل في الدوافع والقرارات، خصوصا عندما لا تكون الحكاية مجرد انتقال من حدث إلى آخر. هذا النمط يبرز الجانب الدرامي ويجعل الفقرة الموسعة أقرب إلى قراءة نقدية خفيفة بدل وصف متكرر.`,
    },
    {
      title: `التوتر داخل ${name}`,
      body: `يعتمد هذا النمط على قراءة مصدر التوتر: هل يأتي من الخطر، من الغموض، أم من تبدل العلاقات؟ ${profile.craft}. لذلك تظهر نقاط "قبل أن تشاهد" كجزء مهم من الصفحة، لأنها تساعد على فهم حدة العمل قبل فتح المشاهدة.`,
    },
    {
      title: `الصورة والإخراج في ${name}`,
      body: director
        ? `وجود ${director} خلف العمل يجعل قراءة الإخراج جزءا من هوية الصفحة. هذا النمط يهتم بطريقة إدارة المشاهد والصورة والجودة، خصوصا عندما تكون التفاصيل البصرية مهمة لفهم الأجواء أو التصعيد.`
        : `حتى عند غياب اسم مخرج واضح في البيانات، يمكن قراءة ${name} من خلال الصورة وتوزيع المشاهد. هذا النمط يجعل الجودة والتريلر ومواصفات الإصدار عناصر أساسية لفهم التجربة لا مجرد بيانات جانبية.`,
    },
    {
      title: `هل يناسبك ${name}؟`,
      body: `هذا النمط يوجه الصفحة نحو قرار المشاهدة نفسه. العمل أقرب إلى ${profile.audience}، مع إيقاع ${profile.pace}. لذلك تجمع الصفحة بين القصة والتصنيف والتنبيهات الخفيفة حتى لا تبدو كصفحة بيانات جامدة.`,
    },
    {
      title: `ما الذي يميز ${name}؟`,
      body: `نقطة التميز هنا تأتي من ${profile.focus} ومن الطريقة التي يوازن بها العمل بين القصة والأجواء. هذا النمط يجعل الصفحة أشبه ببطاقة تقييم تحريرية: ما الفكرة، ما النبرة، لمن يناسب، وما أفضل طريقة لمشاهدته على ${BRAND_NAME}.`,
    },
  ];
  return variants[pattern.id];
}

export function buildPatternHighlights(title: Title, kind: DetailKind, patternId?: number): string[] {
  const name = getWorkTitle(title);
  const pattern = getDetailPattern(title, kind, patternId);
  const profile = genreProfile(title, kind);
  const genres = genreText(title, kind);
  const quality = cleanBrand(title.quality) || 'HD';
  const runtime = kind === 'movie'
    ? cleanBrand(title.duration) || 'مدة غير محددة'
    : `${title.seasons_count} موسم و${title.episodes_count} حلقة`;
  const sets = [
    [
      `راقب كيف يبدأ ${name} فكرته قبل أن يكشف التفاصيل الأكبر.`,
      `السيناريو يميل إلى ${profile.focus}، لذلك لا تعتمد على الملخص وحده.`,
      `الجودة ${quality} تساعد على متابعة التفاصيل الصغيرة في الصورة والترجمة.`,
    ],
    [
      `الحبكة مصنفة ضمن ${genres}، وهذا يحدد نوع التوقع قبل المشاهدة.`,
      `الأحداث تستفيد من إيقاع ${profile.pace} بدل السير بخط واحد طوال الوقت.`,
      `وجود التريلر يمنح فكرة أسرع عن طبيعة الصراع قبل فتح صفحة المشاهدة.`,
    ],
    [
      `الشخصيات هي المدخل الأفضل لفهم ${name} وليس الحدث الظاهر فقط.`,
      `التصنيف ${genres} يوضح طبيعة العلاقات والصدامات داخل العمل.`,
      `راجع طاقم العمل لأن الأسماء أو الشخصيات قد تغير توقعك من التجربة.`,
    ],
    [
      `مدة/حجم العمل: ${runtime}، وهذا يؤثر في طريقة المتابعة.`,
      `الإيقاع ${profile.pace}، لذلك اختر وقت مشاهدة يناسب هذا النوع.`,
      `قسم "قبل أن تشاهد" يلخص أهم ما قد تحتاج معرفته دون حرق مباشر.`,
    ],
    [
      `الأجواء ${profile.atmosphere}.`,
      `التصنيفات ليست كلمات مفتاحية فقط؛ هي مفتاح لفهم نبرة الصفحة.`,
      `التريلر مفيد هنا لأنه يوضح العالم البصري أسرع من أي وصف طويل.`,
    ],
    [
      `العمق يظهر في القرارات لا في الحدث الكبير وحده.`,
      `يناسب العمل ${profile.audience}.`,
      `القراءة الموسعة تساعد على فهم الطبقة الدرامية قبل المشاهدة.`,
    ],
    [
      `${profile.violence}، لذلك راجع التنبيه قبل المشاهدة العائلية.`,
      `مصدر التوتر مرتبط غالبا بـ ${profile.focus}.`,
      `لا تعتمد على العنوان وحده؛ التصنيفات والتريلر يعطيان صورة أوضح.`,
    ],
    [
      `الصورة والجودة ${quality} جزء مهم من التجربة.`,
      `طريقة السرد: ${profile.craft}.`,
      `مواصفات الإصدار تساعدك على اختيار تجربة مشاهدة أنسب.`,
    ],
    [
      `يناسب العمل ${profile.audience}.`,
      `${profile.family}.`,
      `إذا كنت تفضل إيقاعا ${profile.pace} فسيكون الاختيار أقرب لذوقك.`,
    ],
    [
      `يميز ${name} تركيزه على ${profile.focus}.`,
      `الجمع بين القصة والتريلر والبيانات يجعل القرار أسرع للزائر.`,
      `المشاهدة بجودة ${quality} تمنح أفضل نتيجة للتفاصيل والترجمة.`,
    ],
  ];
  return sets[pattern.id];
}

export function buildHeroSummary(title: Title, kind: DetailKind): string {
  const name = getSeoWorkTitle(title);
  const genres = genreText(title, kind);
  const country = countryTag(title.country);
  const director = title.director ? ` من إخراج ${cleanBrand(title.director)}` : '';
  const year = title.year ? ` ${title.year}` : '';
  const extra = kind === 'movie'
    ? `${title.duration ? `، مدته ${cleanBrand(title.duration)}` : ''}`
    : `، بعدد ${title.seasons_count} موسم و${title.episodes_count} حلقة`;
  return `${typeName(kind)} ${name}${year} ضمن أجواء ${genres}${country ? ` من إنتاج ${country}` : ''}${director}${extra}، مع تفاصيل القصة والمعلومات والتريلر على ${BRAND_NAME}.`;
}

export function buildMainDescription(title: Title, kind: DetailKind, patternId?: number): string {
  if (title.seoContent?.mainDescription) return cleanBrand(title.seoContent.mainDescription);
  const name = getWorkTitle(title);
  const label = typeLabel(kind);
  const profile = genreProfile(title, kind);
  const people = splitPeople(title.stars).slice(0, 3).join(`${arabicComma} `);
  const genres = genreText(title, kind);
  const year = title.year ? ` عام ${title.year}` : '';

  // When we have the real plot, the plot itself is the primary paragraph —
  // but wrapped through uniquifyPlot() so it doesn't byte-match the older
  // mirror site (which reuses the same crawled plot text) and trip Google's
  // duplicate-content filtering.
  if (title.real_plot) {
    const plot = uniquifyPlot(title, kind) || normalizeWhitespace(sourceStory(title));
    if (plot && plot.length >= 40) {
      const meta = kind === 'movie'
        ? `${label} ${genres}${title.country ? ` من إنتاج ${countryTag(title.country)}` : ''}${year}`
        : `${label} ${genres}${year}، بعدد ${title.seasons_count} موسم و${title.episodes_count} حلقة`;
      const castLine = people ? ` بطولة ${people}.` : '';
      return `${plot} ${meta}.${castLine}`.replace(/\s+/g, ' ').trim();
    }
  }

  // Fallback (no real plot): lighter generated framing, no brand-data boilerplate.
  const story = truncateWords(sourceStory(title), 38);
  const opener = story
    ? `تدور أحداث ${label} ${name}${year} حول ${story}.`
    : `${label} ${name}${year} ضمن أجواء ${genres}.`;
  return `${opener} ${profile.atmosphere}. ${people ? `يشارك في العمل ${people}، ` : ''}والإيقاع فيه ${profile.pace}، ما يجعله مناسبا لـ${profile.audience}.`.replace(/\s+/g, ' ').trim();
}

export function buildSeoHighlights(title: Title): string | null {
  return title.seoContent?.highlights ? cleanBrand(title.seoContent.highlights) : null;
}

export function buildSeoBeforeWatching(title: Title): string | null {
  return title.seoContent?.beforeWatching ? cleanBrand(title.seoContent.beforeWatching) : null;
}

export function buildTeamNote(title: Title, kind: DetailKind): string {
  const quality = cleanBrand(title.quality) || 'جودة عالية';
  const servers = serverCountLabel(title);
  if (kind === 'movie') {
    return `ملاحظة من فريق ${BRAND_NAME}: راجعنا بيانات الفيلم بحيث تظهر الجودة والترجمة وروابط المشاهدة بوضوح. النسخة المعروضة بجودة ${quality}، ومع توفر ${servers} يمكنك تغيير السيرفر إذا كان الاتصال بطيئا.`;
  }
  if (kind === 'series') {
    return `ملاحظة من فريق ${BRAND_NAME}: تم ترتيب المواسم والحلقات لتصل للحلقة المطلوبة بسرعة، مع الحفاظ على معلومات الجودة والسيرفرات داخل كل صفحة. إذا وجدت أكثر من موسم فابدأ بالترتيب المعروض لتجنب حرق الأحداث.`;
  }
  return `ملاحظة من فريق ${BRAND_NAME}: صفحات الأنمي مرتبة حسب المواسم والحلقات مع إبراز الترجمة والجودة. يفضل متابعة الحلقات بالتسلسل لأن التفاصيل الصغيرة في الأنمي غالبا تعود لاحقا في تطور الشخصيات.`;
}

export function buildLongRead(title: Title, kind: DetailKind): string[] {
  const name = getWorkTitle(title);
  const label = typeLabel(kind);
  const profile = genreProfile(title, kind);
  const people = splitPeople(title.stars);
  const cast = people.slice(0, 4).join(`${arabicComma} `);
  const director = title.director ? cleanBrand(title.director) : null;
  const seed = seedFrom(title.slug);

  const paragraphs: string[] = [];

  // Lead paragraph: the real plot when available — uniquified so it no longer
  // matches the older mirror site's plain plot text — otherwise a generated opener.
  if (title.real_plot) {
    const plot = uniquifyPlot(title, kind) || normalizeWhitespace(sourceStory(title));
    if (plot && plot.length >= 40) {
      paragraphs.push(plot);
    }
  }
  if (paragraphs.length === 0) {
    const story = truncateWords(sourceStory(title), 42);
    const firstOpenings = [
      `يبدأ ${label} ${name} من فكرة تبدو مباشرة: ${story}. لكن قوته لا تأتي من الحدث وحده، بل من الطريقة التي يسمح بها للقلق أو الفضول أن يتسرب بين المشاهد.`,
      `في ${name} تتحرك القصة أبعد من ملخص قصير عن ${story}. قوة العمل تظهر في طريقته الخاصة في تحويل التفاصيل الصغيرة إلى إشارات تكشف حجم الصراع.`,
      `فكرة ${label} ${name} تتحرك حول ${story}. ومن هذه النقطة يبني العمل مساحة مشاهدة تعتمد على ${profile.focus} وعلى إحساس واضح بطبيعة التصنيف.`,
    ];
    paragraphs.push(`${pick(firstOpenings, seed)} الأجواء هنا ${profile.atmosphere}.`);
  }

  // Character / cast paragraph.
  paragraphs.push(
    cast
      ? `على مستوى الشخصيات، يمنح حضور ${cast} العمل قدرة على تغيير النبرة بين مشهد وآخر. كل تردد أو قرار يضيف طبقة جديدة لفهم الصراع، لذلك تبدو المتابعة أفضل عند الانتباه للتفاصيل الصغيرة في الحوار لا للأحداث الكبيرة فقط.`
      : `على مستوى الشخصيات، يعتمد العمل على ردود الفعل والاختيارات أكثر من الأسماء الكبيرة. الشخصيات تتحرك داخل ضغط واضح، ومع كل قرار يتغير معنى المشهد السابق.`
  );

  // Craft / direction paragraph.
  paragraphs.push(
    director
      ? `إخراجيا، يترك ${director} بصمة في إدارة الإيقاع وتوزيع المعلومات. ${profile.craft}.`
      : `من ناحية السرد، لا يتعامل العمل مع المشاهد كحشو بين نقاط القصة. ${profile.craft}.`
  );

  // Audience paragraph (no brand boilerplate).
  paragraphs.push(
    `يخاطب العمل ${profile.audience}، ويمنح جمهوره نبرة واضحة وتفاصيل كافية، خصوصا عند مشاهدته بجودة عالية مع ترجمة دقيقة.`
  );

  return paragraphs;
}

export function buildBeforeWatching(title: Title, kind: DetailKind): string[] {
  const seoPoints = (title.seoContent?.beforeWatchingPoints || [])
    .map((point) => cleanBrand(point))
    .filter(Boolean)
    .slice(0, 3);
  if (seoPoints.length === 3) return seoPoints;

  const profile = genreProfile(title, kind);
  const name = getWorkTitle(title);
  const continuity = kind === 'movie'
    ? `لا يحتاج ${name} غالبا إلى معرفة سابقة إلا إذا كان مرتبطا بسلسلة تحمل نفس العالم.`
    : `يفضل البدء من الموسم الأول لأن ترتيب الحلقات يساعد على فهم تطور الشخصيات.`;
  const quality = title.quality
    ? `يفضل تشغيله بجودة ${cleanBrand(title.quality)} لالتقاط تفاصيل الصورة والترجمة بوضوح.`
    : 'يفضل اختياره بجودة عالية لأن التفاصيل البصرية تساعد على فهم الأجواء.';
  return [
    `${profile.violence}، لذلك راجع التصنيف إذا كنت تتحسس من هذه النوعية من المشاهد.`,
    `${profile.family}، خصوصا عند وجود توتر أو موضوعات موجهة للكبار.`,
    continuity,
    `${quality} إيقاع العمل ${profile.pace}، فاختر وقت مشاهدة يناسب طبيعته.`,
  ];
}

export function buildCastRows(title: Title, kind: DetailKind): DetailRow[] {
  const people = splitPeople(title.stars).slice(0, 6).join(`${arabicComma} `);
  const rows: DetailRow[] = [];
  if (kind === 'movie') {
    if (title.director) rows.push({ label: 'المخرج', value: cleanBrand(title.director) });
    if (title.year) rows.push({ label: 'سنة الإنتاج', value: title.year });
    if (people) rows.push({ label: 'أهم الممثلين', value: people });
    rows.push({ label: 'لغة الإنتاج', value: cleanBrand(title.language) || 'مترجم' });
    if (title.country) rows.push({ label: 'مواقع التصوير / الإنتاج', value: cleanBrand(title.country) });
    return rows;
  }
  if (title.director) rows.push({ label: kind === 'anime' ? 'الاستوديو / المنشئ' : 'المنشئ', value: cleanBrand(title.director) });
  if (title.year) rows.push({ label: 'سنة البداية', value: title.year });
  rows.push({ label: 'عدد المواسم', value: String(title.seasons_count) });
  rows.push({ label: 'عدد الحلقات', value: String(title.episodes_count) });
  if (people) rows.push({ label: kind === 'anime' ? 'أهم الشخصيات / الأصوات' : 'أهم الممثلين', value: people });
  rows.push({ label: 'لغة الإنتاج', value: cleanBrand(title.language) || (kind === 'anime' ? 'اليابانية / مترجم' : 'مترجم') });
  return rows;
}

export function buildInfoRows(title: Title, kind: DetailKind): DetailRow[] {
  const rows: DetailRow[] = [];
  if (kind === 'movie' && title.director) rows.push({ label: 'المخرج', value: cleanBrand(title.director) });
  if (kind !== 'movie' && title.director) rows.push({ label: kind === 'anime' ? 'الاستوديو / المنشئ' : 'المنشئ', value: cleanBrand(title.director) });
  // Prefer the structured cast (clean names) over the flat `stars` text.
  const castNames = Array.isArray(title.cast) && title.cast.length
    ? title.cast.slice(0, 6).map((c) => cleanBrand(c.name)).filter(Boolean).join(`${arabicComma} `)
    : (title.stars ? cleanBrand(title.stars) : '');
  if (castNames) rows.push({ label: kind === 'anime' ? 'الشخصيات / الأصوات' : 'النجوم', value: castNames });
  if (title.country) rows.push({ label: 'الدولة', value: cleanBrand(title.country) });
  if (title.duration) rows.push({ label: 'المدة', value: cleanBrand(title.duration) });
  if (title.year) rows.push({ label: 'السنة', value: title.year });
  rows.push({ label: 'التصنيف', value: genreText(title, kind) });
  rows.push({ label: 'الجودة', value: cleanBrand(title.quality) || 'HD' });
  rows.push({ label: 'اللغة', value: cleanBrand(title.language) || 'مترجم' });
  rows.push({ label: 'عدد السيرفرات', value: serverCountLabel(title) });
  if (kind !== 'movie') {
    rows.push({ label: 'عدد المواسم', value: String(title.seasons_count) });
    rows.push({ label: 'عدد الحلقات', value: String(title.episodes_count) });
  }
  return rows;
}

export function buildFaqs(title: Title, kind: DetailKind): DetailFaq[] {
  const seoFaqs: DetailFaq[] = [];
  const name = getWorkTitle(title);
  const genres = genreText(title, kind);
  const rating = getRating(title);
  const family = genreProfile(title, kind).family;
  if (kind === 'movie') {
    return [
      ...seoFaqs,
      { question: `ما قصة فيلم ${name}؟`, answer: `تجد القصة في قسم وصف العمل أعلى الصفحة، ثم تكمل بقية الأقسام معلومات التصنيف والطاقة الفنية دون تكرار الملخص.` },
      { question: `من هو مخرج فيلم ${name}؟`, answer: title.director ? `الفيلم من إخراج ${cleanBrand(title.director)}.` : 'لم تضف بيانات المخرج لهذا الفيلم بعد ضمن ملف البيانات الحالي.' },
      { question: 'ما مدة الفيلم وتقييمه؟', answer: `مدة الفيلم ${title.duration ? cleanBrand(title.duration) : 'غير محددة في البيانات'}${rating ? `، والتقييم المتوفر هو ${rating}` : '، ولا يوجد تقييم رقمي متاح حاليا في البيانات'}.` },
      { question: `هل الفيلم مترجم بالعربية على ${BRAND_NAME}؟`, answer: `نعم، تعرض صفحة الفيلم بيانات الترجمة والجودة، واللغة المسجلة هي ${cleanBrand(title.language) || 'مترجم'}.` },
      { question: `هل المشاهدة مجانية على ${BRAND_NAME}؟`, answer: `${BRAND_NAME} يوفر روابط مشاهدة مباشرة عبر سيرفرات طرف ثالث دون تغيير رابط التفاصيل الأصلي للعمل.` },
      { question: 'ما تصنيف الفيلم وهل يناسب جميع الأعمار؟', answer: `الفيلم مصنف ضمن ${genres}. ${family}، لذلك يفضل مراجعة طبيعة العمل قبل مشاهدته مع العائلة.` },
    ];
  }
  if (kind === 'series') {
    return [
      ...seoFaqs,
      { question: `ما قصة مسلسل ${name}؟`, answer: `القصة معروضة مرة واحدة في قسم وصف العمل، وبعدها تعرض الصفحة المواسم والحلقات والمعلومات الأساسية فقط.` },
      { question: `كم عدد مواسم مسلسل ${name}؟`, answer: `يتوفر المسلسل في البيانات الحالية بعدد ${title.seasons_count} موسم و${title.episodes_count} حلقة.` },
      { question: 'هل المسلسل مترجم بالعربية؟', answer: `نعم، يعرض ${BRAND_NAME} المسلسل ضمن تجربة عربية مع تبويبات للحلقات وسيرفرات متعددة عند توفرها.` },
      { question: 'ما تصنيف المسلسل؟', answer: `تصنيف المسلسل هو ${genres}، وهذا يوضح طبيعة الأجواء قبل بدء المتابعة.` },
      { question: `هل يمكن مشاهدة الحلقات على ${BRAND_NAME}؟`, answer: 'نعم، يمكن فتح الحلقة الأولى من زر المشاهدة ثم التنقل بين المواسم والحلقات من صفحة التفاصيل أو صفحة المشاهدة.' },
    ];
  }
  return [
    ...seoFaqs,
    { question: `ما قصة أنمي ${name}؟`, answer: `قسم وصف العمل هو المكان الوحيد لملخص القصة، بينما تعرض الأسئلة هنا معلومات المتابعة والتصنيف دون إعادة النص.` },
    { question: `كم عدد حلقات أنمي ${name}؟`, answer: `يتوفر الأنمي في البيانات الحالية بعدد ${title.seasons_count} موسم و${title.episodes_count} حلقة.` },
    { question: 'هل الأنمي مترجم بالعربية؟', answer: `نعم، يقدم ${BRAND_NAME} بيانات الأنمي مع تجربة مشاهدة عربية وسيرفرات متعددة عند توفرها.` },
    { question: 'ما تصنيف الأنمي؟', answer: `تصنيف الأنمي هو ${genres}، مع اختلاف النبرة حسب الموسم والحلقات.` },
    { question: 'هل يناسب محبي الأكشن أو الشونن أو الدراما؟', answer: `إذا كانت التصنيفات قريبة من ${genres} فسيكون مناسبا غالبا لمحبي هذا اللون، مع مراجعة الإيقاع والتصنيف العمري قبل المشاهدة.` },
  ];
}

export function buildSeoTitle(title: Title, kind: DetailKind): string {
  let { arabized, foreign } = seoNamePair(title);
  // Guard against an empty name (e.g. a work literally titled with a year such
  // as "2073", where removeTitleNoise strips the digits as a "year"). Never
  // emit a nameless "<space> فيلم مترجم…" title — fall back to the raw title.
  if (!normalizeWhitespace(arabized) && !normalizeWhitespace(foreign)) {
    const raw = normalizeWhitespace(cleanBrand(getWorkTitle(title)) || cleanBrand(title.clean_title) || cleanBrand(title.raw_name));
    arabized = raw;
    foreign = '';
  }
  return fitSeoTitle(arabized, foreign, kind);
}

export function buildMetaDescription(title: Title, kind: DetailKind): string {
  const type = typeName(kind);
  const year = title.year || '';
  // Use the cleaned SEO name (type prefixes like اوفا/أونا stripped) so the
  // meta description name matches the <title> and avoids duplicated boilerplate.
  const { arabized, foreign } = seoNamePair(title);
  let seoName = '';
  if (!foreign || arabized === foreign) { seoName = arabized || foreign; }
  else if (arabized && foreign.includes(arabized)) { seoName = foreign; }
  else if (foreign && arabized.includes(foreign)) { seoName = arabized; }
  else if (arabized && foreign) { seoName = `${arabized} ${foreign}`; }
  else { seoName = arabized || foreign; }
  seoName = normalizeWhitespace(seoName) || getWorkTitleWithoutYear(title) || getWorkTitle(title);
  const compactName = truncateChars(seoName, 44);
  const prefix = `شاهد ${type} ${compactName}${year ? ` ${year}` : ''}: `;
  const suffix = ` مترجم HD على ${BRAND_NAME}.`;
  let teaserLimit = Math.max(50, 152 - prefix.length - suffix.length);
  let teaser = buildSeoTeaser(title, teaserLimit, kind);
  let result = `${prefix}${teaser}${suffix}`;

  // Keep the trust/action suffix intact; never let final truncation cut the brand/domain signal.
  while (result.length > 155 && teaserLimit > 45) {
    teaserLimit -= 5;
    teaser = buildSeoTeaser(title, teaserLimit, kind);
    result = `${prefix}${teaser}${suffix}`;
  }
  if (result.length <= 155) return result;
  return `${truncateChars(`${prefix}${teaser}`, 155 - suffix.length)}${suffix}`;
}

export function buildJsonLdDescription(title: Title, kind: DetailKind): string {
  const name = getWorkTitle(title);
  // Prefer the uniquified plot so structured-data descriptions also differ from
  // the mirror site; fall back to raw story / SEO meta / genres.
  const base = uniquifyPlot(title, kind) || sourceStory(title) || metadataTeaser(title, kind);
  return clampChars(`${name}: ${base}`, 260);
}

/* ────────────────────────────────────────────────────────────────────────
 * Structured data (JSON-LD) — unified builder used by all detail pages.
 *
 * Produces a @graph with:
 *   - Movie | TVSeries  (with aggregateRating, actor[] from structured cast,
 *     director/creator, genre[], duration ISO-8601, datePublished, trailer)
 *   - BreadcrumbList     (Home → category → work)
 *   - FAQPage            (from buildFaqs)
 * Everything is emitted only when the underlying data exists, so the graph
 * validates cleanly in Google's Rich Results Test.
 * ──────────────────────────────────────────────────────────────────────── */

const TMDB_PROFILE_BASE = 'https://image.tmdb.org/t/p/w185';
const TMDB_BACKDROP_BASE = 'https://image.tmdb.org/t/p/w1280';

/** Absolute URL helper (accepts already-absolute or site-relative paths). */
function absUrl(pathOrUrl: string | null | undefined, siteUrl: string): string | undefined {
  if (!pathOrUrl) return undefined;
  if (/^https?:\/\//i.test(pathOrUrl)) return pathOrUrl;
  if (pathOrUrl.startsWith('/')) return `${siteUrl}${pathOrUrl}`;
  return pathOrUrl;
}

/** Best image for og:image / schema image — backdrop first, then poster. */
export function getWorkImage(title: Title, siteUrl: string): string | undefined {
  if (title.backdrop_path) return `${TMDB_BACKDROP_BASE}${title.backdrop_path}`;
  return absUrl(title.poster, siteUrl);
}

/** Structured actor list from the enriched cast (falls back to `stars` text). */
function schemaActors(title: Title): Array<Record<string, unknown>> {
  if (Array.isArray(title.cast) && title.cast.length) {
    return title.cast
      .filter((c) => c && c.name)
      .slice(0, 12)
      .map((c) => {
        const person: Record<string, unknown> = { '@type': 'Person', name: cleanBrand(c.name) };
        if (c.character) person.characterName = cleanBrand(c.character);
        if (c.profilePath) {
          person.image = /^https?:\/\//i.test(c.profilePath) ? c.profilePath : `${TMDB_PROFILE_BASE}${c.profilePath}`;
        }
        return person;
      })
      .filter((p) => p.name);
  }
  // Legacy fallback: split the flat `stars` string.
  return splitPeople(title.stars)
    .slice(0, 8)
    .map((name) => ({ '@type': 'Person', name: cleanBrand(name) }))
    .filter((p) => p.name);
}

/** ISO-8601 duration (PT###M) from a runtime in minutes. */
function isoDuration(runtime?: number | null): string | undefined {
  const m = Number(runtime);
  if (!m || !Number.isFinite(m) || m <= 0) return undefined;
  return `PT${Math.round(m)}M`;
}

/** aggregateRating node — only when there is a real TMDB vote with count. */
function schemaAggregateRating(title: Title): Record<string, unknown> | undefined {
  const value = Number(title.vote_average ?? title.tmdb_vote ?? 0);
  const count = Number(title.vote_count ?? title.tmdb_votes ?? 0);
  if (value > 0 && count > 0) {
    return {
      '@type': 'AggregateRating',
      ratingValue: value.toFixed(1),
      bestRating: '10',
      worstRating: '0',
      ratingCount: count,
    };
  }
  return undefined;
}

/**
 * Build the full JSON-LD @graph for a work detail page.
 * `watchUrl` is the absolute URL of the watch/first-episode page.
 */
export function buildWorkJsonLd(
  title: Title,
  kind: DetailKind,
  opts: { siteUrl: string; siteName: string; pageUrl: string; watchUrl?: string; categoryLabel: string; categoryHref: string },
): Record<string, unknown> {
  const { siteUrl, siteName, pageUrl, watchUrl, categoryLabel, categoryHref } = opts;
  const name = getDisplayTitle(title);
  const description = buildJsonLdDescription(title, kind);
  const image = getWorkImage(title, siteUrl);
  const genres = (title.genres && title.genres.length ? title.genres : splitGenres(title.genre));
  const actors = schemaActors(title);
  const aggregateRating = schemaAggregateRating(title);
  const datePublished = title.release_date || (title.year ? `${title.year}-01-01` : undefined);
  const videoUploadDate = datePublished || '2024-01-01';

  const isMovie = kind === 'movie';
  const work: Record<string, unknown> = {
    '@type': isMovie ? 'Movie' : 'TVSeries',
    '@id': `${pageUrl}#work`,
    name,
    url: pageUrl,
    inLanguage: 'ar',
  };
  if (title.title_ar && title.title_ar !== name) work.alternateName = title.title_ar;
  else if (title.original_title && title.original_title !== name) work.alternateName = title.original_title;
  if (description) work.description = description;
  if (image) work.image = image;
  if (datePublished) work.datePublished = datePublished;
  if (genres.length) work.genre = genres;
  if (actors.length) work.actor = actors;
  if (aggregateRating) work.aggregateRating = aggregateRating;

  // director / creator
  if (isMovie && title.director) {
    work.director = { '@type': 'Person', name: cleanBrand(title.director) };
  }
  if (!isMovie) {
    const creators = (title.creators && title.creators.length)
      ? title.creators
      : (title.director ? splitPeople(title.director) : []);
    if (creators.length) {
      work.creator = creators.map((n) => ({ '@type': 'Person', name: cleanBrand(n) }));
    }
    if (title.number_of_seasons || title.seasons_count) work.numberOfSeasons = title.number_of_seasons || title.seasons_count;
    if (title.number_of_episodes || title.episodes_count) work.numberOfEpisodes = title.number_of_episodes || title.episodes_count;
  }

  // duration (movies) / episode runtime
  const dur = isoDuration(title.runtime);
  if (dur) work.duration = dur;

  // trailer
  if (title.trailerId) {
    work.trailer = {
      '@type': 'VideoObject',
      name: `تريلر ${name}`,
      description: `تريلر ${name} على ${siteName}`,
      thumbnailUrl: `https://img.youtube.com/vi/${title.trailerId}/hqdefault.jpg`,
      uploadDate: videoUploadDate,
      embedUrl: `https://www.youtube.com/embed/${title.trailerId}`,
    };
  }

  // watch action
  if (watchUrl) {
    work.potentialAction = {
      '@type': 'WatchAction',
      target: watchUrl,
    };
  }

  // BreadcrumbList
  const breadcrumb = {
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'الرئيسية', item: siteUrl },
      { '@type': 'ListItem', position: 2, name: categoryLabel, item: absUrl(categoryHref, siteUrl) },
      { '@type': 'ListItem', position: 3, name, item: pageUrl },
    ],
  };

  // FAQPage
  const faqs = buildFaqs(title, kind);
  const faqPage = faqs.length
    ? {
        '@type': 'FAQPage',
        mainEntity: faqs.map((f) => ({
          '@type': 'Question',
          name: f.question,
          acceptedAnswer: { '@type': 'Answer', text: f.answer },
        })),
      }
    : undefined;

  const graph: Array<Record<string, unknown>> = [work, breadcrumb];
  if (faqPage) graph.push(faqPage);

  return { '@context': 'https://schema.org', '@graph': graph };
}
