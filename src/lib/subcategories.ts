/**
 * Detailed sub-category taxonomy for the newly-ingested catalogue.
 *
 * These power the new, more granular listing pages (Netflix / Asian / Turkish /
 * Indian … for both series and movies, plus anime) that sit alongside the
 * original /x/f /x/d /x/n listings.
 *
 * Routes are kept opaque to match the rest of the site: a sub-category listing
 * lives under /x/c/<code> where <code> is a short, non-obvious handle rather
 * than the readable sub key.
 */
import type { Category } from './site';

export interface SubCategoryDef {
  sub: string;        // internal key (matches the data shards)
  code: string;       // opaque URL segment used in /x/c/<code>
  label: string;      // Arabic display label (plural)
  category: Category; // underlying media kind
  blurbEn: string;    // small uppercase eyebrow text
}

export const SUBCATEGORIES: SubCategoryDef[] = [
  { sub: 'netflix-series', code: 'nx', label: 'مسلسلات نتفليكس', category: 'series', blurbEn: 'NETFLIX SERIES' },
  { sub: 'netflix-movies', code: 'mx', label: 'أفلام نتفليكس', category: 'movie', blurbEn: 'NETFLIX MOVIES' },
  { sub: 'asian-series', code: 'as', label: 'مسلسلات آسيوي', category: 'series', blurbEn: 'ASIAN SERIES' },
  { sub: 'asian-movies', code: 'am', label: 'أفلام آسيوي', category: 'movie', blurbEn: 'ASIAN MOVIES' },
  { sub: 'turkish-series', code: 'ts', label: 'مسلسلات تركي', category: 'series', blurbEn: 'TURKISH SERIES' },
  { sub: 'turkish-movies', code: 'tm', label: 'أفلام تركي', category: 'movie', blurbEn: 'TURKISH MOVIES' },
  { sub: 'indian-series', code: 'is', label: 'مسلسلات هندي', category: 'series', blurbEn: 'INDIAN SERIES' },
  { sub: 'indian-movies', code: 'im', label: 'أفلام هندي', category: 'movie', blurbEn: 'INDIAN MOVIES' },
  { sub: 'foreign-series', code: 'fs', label: 'مسلسلات أجنبي', category: 'series', blurbEn: 'FOREIGN SERIES' },
  { sub: 'foreign-movies', code: 'fm', label: 'أفلام أجنبي', category: 'movie', blurbEn: 'FOREIGN MOVIES' },
  { sub: 'anime', code: 'an', label: 'أنمي جديد', category: 'anime', blurbEn: 'NEW ANIME' },
];

export const SUB_BY_CODE: Record<string, SubCategoryDef> = Object.fromEntries(
  SUBCATEGORIES.map((s) => [s.code, s])
);
export const SUB_BY_KEY: Record<string, SubCategoryDef> = Object.fromEntries(
  SUBCATEGORIES.map((s) => [s.sub, s])
);

export function subcatRoute(code: string): string {
  return `/x/c/${code}`;
}
