// Site-wide constants — CINEMA PLUS brand
import { listingRoute } from './routes';

export const SITE = {
  name: 'سينما بلس',
  nameEn: 'CinemaPlus',
  nameLatin: 'CINEMA PLUS',
  tagline: 'مشاهدة أفلام ومسلسلات وأنمي مترجمة اون لاين بجودة عالية',
  description:
    'سينما بلس CinemaPlus موقع عربي لمشاهدة احدث الافلام والمسلسلات والانمي مترجم اون لاين بجودة عالية HD و4K مجاناً بدون اعلانات مزعجة، مع تحديث يومي وروابط مشاهدة مباشرة سريعة.',
  url: 'https://cinemanaplus.site',
  locale: 'ar-SA',
  themeColor: '#06b6d4',
  defaultOgImage: '/og-default.png',
} as const;

export type Category = 'movie' | 'series' | 'anime';

// Navigation uses the opaque listing routes from routes.ts.
export const NAV = [
  { label: 'الرئيسية', href: '/' },
  { label: 'أفلام', href: listingRoute('movie') },
  { label: 'مسلسلات', href: listingRoute('series') },
  { label: 'أنمي', href: listingRoute('anime') },
  { label: 'بحث', href: '/search' },
] as const;

export const CATEGORY_SLUG = {
  movie: 'movie',
  series: 'series',
  anime: 'anime',
} as const;

export const CATEGORY_LABEL = {
  movie: 'فيلم',
  series: 'مسلسل',
  anime: 'أنمي',
} as const;

export const CATEGORY_LABEL_PLURAL = {
  movie: 'أفلام',
  series: 'مسلسلات',
  anime: 'أنمي',
} as const;

export const CATEGORY_TYPE_KEY = 'category' as const;
