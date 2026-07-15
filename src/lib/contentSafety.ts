/**
 * Adult / indecent content filter (runtime, TypeScript mirror of
 * scripts/lib-ingest.mjs `isAdultContent`).
 *
 * The user explicitly asked to exclude any indecent or semi-pornographic work
 * ("استبعد اي فلم او مسلسل مخل او شبه اباحية"). We apply this on the read side
 * (titles loader, search corpus, homepage curation) so nothing indecent ever
 * reaches the rendered HTML — covering BOTH the old catalogue and the new
 * CSV-ingested works.
 */

const ADULT_PATTERNS: RegExp[] = [
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

export interface AdultCheckInput {
  name?: string;
  title?: string;
  genre?: string;
  adult?: boolean;
}

/** True when a work looks indecent / semi-pornographic and must be excluded. */
export function isAdultContent({
  name = '',
  title = '',
  genre = '',
  adult = false,
}: AdultCheckInput = {}): boolean {
  if (adult === true) return true;
  const haystack = `${name} ${title} ${genre}`;
  return ADULT_PATTERNS.some((re) => re.test(haystack));
}

/** Convenience: check a full Title-like object. */
export function isAdultTitle(t: {
  clean_title?: string;
  raw_name?: string;
  original_title?: string;
  genre?: string;
  adult?: boolean;
}): boolean {
  return isAdultContent({
    name: `${t.clean_title || ''} ${t.raw_name || ''} ${t.original_title || ''}`,
    title: t.clean_title || '',
    genre: t.genre || '',
    adult: (t as any).adult === true,
  });
}
