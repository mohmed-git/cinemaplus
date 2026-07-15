// Shared helpers to parse base title / season number / franchise key from CinemaPlus titles.
// Exported for reuse by export scripts.

const AR_ORD = {
  'الاول': 1, 'الأول': 1, 'الثاني': 2, 'الثانى': 2, 'الثالث': 3, 'الرابع': 4,
  'الخامس': 5, 'السادس': 6, 'السابع': 7, 'الثامن': 8, 'التاسع': 9, 'العاشر': 10,
};
const ROMAN = { i: 1, ii: 2, iii: 3, iv: 4, v: 5, vi: 6, vii: 7, viii: 8, ix: 9, x: 10 };

// Leading media-kind prefixes (Arabic) that are NOT part of the base name.
const PREFIX_RE = /^(فيلم|أفلام|اونا|أونا|اوفا|أوفا|الحلقة\s*الخاصة|الحلقة-الخاصة|حلقة\s*خاصة|انمي|أنمي|مسلسل|برنامج)\s+/;

// Trailing noise words (Arabic) commonly appended by the source site.
const TRAILING_NOISE_RE = /\s*(مترجم(?:ة)?|ومدبلج|مدبلج|اون\s*لاين|بلا\s*حدود|كامل(?:ة)?)\s*$/g;

// Detect entry type (series / movie / ova / special / program) from title + category.
export function detectEntryType(t) {
  const name = (t.clean_title || t.raw_name || '');
  if (/^فيلم/.test(name)) return 'movie';
  if (/^(اونا|أونا)/.test(name)) return 'ona';
  if (/^(اوفا|أوفا)/.test(name)) return 'ova';
  if (/^(الحلقة\s*الخاصة|الحلقة-الخاصة|حلقة\s*خاصة)/.test(name) || t.is_special) return 'special';
  if (t.category === 'movie') return 'movie';
  return t.category === 'anime' ? 'anime' : 'series';
}

// Extract a season number (from the TITLE only). Returns null if none found.
export function extractSeasonFromTitle(name) {
  if (!name) return null;
  const n = String(name);

  // "2nd Season", "3rd Season", "1st Season"
  let m = n.match(/\b(\d+)\s*(?:st|nd|rd|th)\s+season\b/i);
  if (m) return parseInt(m[1], 10);

  // "Season 2" / "Season2"
  m = n.match(/\bseason\s*(\d+)\b/i);
  if (m) return parseInt(m[1], 10);

  // "Part 2"
  m = n.match(/\bpart\s*(\d+)\b/i);
  if (m) return parseInt(m[1], 10);

  // Arabic "الموسم الثاني" / "الموسم 2"
  m = n.match(/الموسم\s*(\d+)/);
  if (m) return parseInt(m[1], 10);
  m = n.match(/الموسم\s*(الاول|الأول|الثاني|الثالث|الرابع|الخامس|السادس|السابع|الثامن|التاسع|العاشر)/);
  if (m) return AR_ORD[m[1]] || null;

  // Trailing roman numeral as its own token: "Overlord III", "Ajin II"
  m = n.match(/\b(ii|iii|iv|v|vi|vii|viii|ix|x)\b\s*$/i);
  if (m) return ROMAN[m[1].toLowerCase()] || null;

  return null;
}

// Strip prefix + season markers + trailing noise -> a normalized BASE title (latin+arabic mixed).
export function makeBaseTitle(name) {
  if (!name) return '';
  let s = String(name).trim();

  // remove leading media-kind prefix
  s = s.replace(PREFIX_RE, '').trim();

  // remove season markers
  s = s
    .replace(/\b\d+\s*(?:st|nd|rd|th)\s+season\b/gi, ' ')
    .replace(/\bseason\s*\d+\b/gi, ' ')
    .replace(/\bpart\s*\d+\b/gi, ' ')
    .replace(/الموسم\s*\d+/g, ' ')
    .replace(/الموسم\s*(?:الاول|الأول|الثاني|الثالث|الرابع|الخامس|السادس|السابع|الثامن|التاسع|العاشر)/g, ' ')
    .replace(/\b(ii|iii|iv|v|vi|vii|viii|ix|x)\b\s*$/i, ' ');

  // remove trailing noise
  s = s.replace(TRAILING_NOISE_RE, ' ');

  // collapse spaces / stray punctuation
  s = s.replace(/[\s\-:_,]+$/g, '').replace(/\s+/g, ' ').trim();
  return s;
}

// A stable franchise key: lowercase latin tokens of the base title (drops arabic transliteration noise).
// If the base title has no usable latin tokens (e.g. purely Arabic film title that collapsed to a
// bare year), the key is NOT reliable for grouping -> caller should fall back to the slug.
export function franchiseKey(baseTitle) {
  const toks = String(baseTitle || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .filter((w) => w.length > 1 || /[0-9]/.test(w));
  return toks.join('-');
}

// Returns true when a franchise key is reliable enough to GROUP entries together.
// A key that is only digits (a year), a single very-short token, or empty is unreliable.
export function isReliableFranchiseKey(key) {
  if (!key) return false;
  if (/^\d{2,4}$/.test(key)) return false;           // just a year like "2025"
  const parts = key.split('-').filter(Boolean);
  if (parts.length === 0) return false;
  // single short token that is only letters (<=3 chars) is too generic
  if (parts.length === 1 && parts[0].length <= 3 && /^[a-z]+$/.test(parts[0])) return false;
  return true;
}
