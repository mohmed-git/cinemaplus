/**
 * Surgical fix for the two "Avatar: The Last Airbender" works.
 *
 * PROBLEM (from all.json):
 *  - slug "avatar-the-last-airbender-2": category=anime BUT it carried the
 *    2024 Netflix LIVE-ACTION metadata (poster/cast/tmdb_id 82452/year 2024)
 *    and had only ONE broken server "videoland - HD" for every episode.
 *  - slug "last": category=series, clean_title mangled to "Last", also tmdb 82452.
 *  The original 2005 Nickelodeon ANIME and the 2024 Netflix LIVE-ACTION series
 *  got their data crossed. They must be TWO SEPARATE works and NEVER merged.
 *
 * FIX: rebuild BOTH works from the source CSV (topcinemaa) with correct,
 * independent metadata + the real streaming servers from the CSV.
 *
 *   1) Avatar: The Last Airbender (2005) — ANIME
 *        category=anime, tmdb_id=246 (TMDB TV, the original animated series),
 *        3 seasons / 54 episodes, real servers (vidtube/streamwish/…).
 *   2) Avatar: The Last Airbender (2024) — LIVE ACTION SERIES
 *        category=series, tmdb_id=82452 (TMDB TV, the Netflix live-action),
 *        servers from CSV.
 *
 * We drop the two broken slugs and write two fresh works. Everything else in
 * all.json is passed through untouched (memory-safe streaming carver + writer).
 *
 * Run: node scripts/fix-avatar.mjs [--dry]
 * After: node scripts/split-all-json.mjs && node scripts/build-episode-shards.mjs
 *        && node scripts/build-search-index.mjs
 */
import { createReadStream, createWriteStream, renameSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { providerKey } from './lib-host.mjs';

const DRY = process.argv.includes('--dry');
const ALL = resolve(process.cwd(), 'src/data/generated/all.json');
const TMP = ALL + '.tmp';

const ANIME_ROWS = JSON.parse(readFileSync('/home/user/avatar_anime_rows.json', 'utf8'));
const LIVE_ROWS = JSON.parse(readFileSync('/home/user/avatar_live_rows.json', 'utf8'));

// slugs to REMOVE (the broken crossed works)
const DROP_SLUGS = new Set(['avatar-the-last-airbender-2', 'last']);

// ---- server provider priority (same as reorder-servers.mjs) ----
const FIRST = ['megatuktuk', 'streamwish', 'luluvdo', 'uqload', 'earnvids'];
const LAST = ['vidtube'];
const RANK = new Map();
FIRST.forEach((k, i) => RANK.set(k, i));
LAST.forEach((k) => RANK.set(k, 2000));
const DEFAULT_RANK = 1000;

// LuluStream shows up as lulu.st (key "lulu") or luluvdo.com (key "luluvdo").
// Normalize the display key so both read "luluvdo".
function normKey(k) {
  if (k === 'lulu') return 'luluvdo';
  if (k === 'filelions') return 'earnvids';
  return k;
}
function rankOf(url) {
  const k = normKey(providerKey(url));
  return RANK.has(k) ? RANK.get(k) : DEFAULT_RANK;
}

/** Build servers[] for one episode from its CSV rows (unwrap proxy, de-dupe, order). */
function buildServers(rows) {
  const byKey = new Map(); // providerKey -> {label,url}
  for (const r of rows) {
    const raw = r.embed_url || '';
    if (!raw) continue;
    const key = normKey(providerKey(raw));
    if (!key) continue;
    if (byKey.has(key)) continue; // one server per provider (keep first)
    byKey.set(key, { key, label: `${key} - HD`, url: raw });
  }
  // order by priority, then assign sequential ids
  const ordered = [...byKey.values()].sort((a, b) => {
    const ra = RANK.has(a.key) ? RANK.get(a.key) : DEFAULT_RANK;
    const rb = RANK.has(b.key) ? RANK.get(b.key) : DEFAULT_RANK;
    return ra - rb;
  });
  return ordered.map((s, i) => ({ id: i + 1, label: s.label, url: s.url }));
}

/** Group CSV rows into seasons[] -> episodes[] -> servers[]. */
function buildSeasons(rows) {
  const seasonMap = new Map(); // seasonNum -> Map<epNum, rows[]>
  for (const r of rows) {
    const sn = parseInt(r.season, 10) || 1;
    const en = parseInt(r.episode, 10);
    if (!Number.isFinite(en)) continue;
    if (!seasonMap.has(sn)) seasonMap.set(sn, new Map());
    const epMap = seasonMap.get(sn);
    if (!epMap.has(en)) epMap.set(en, []);
    epMap.get(en).push(r);
  }
  const seasons = [...seasonMap.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([sn, epMap]) => ({
      season: sn,
      episodes: [...epMap.entries()]
        .sort((a, b) => a[0] - b[0])
        .map(([en, epRows]) => ({
          episode: en,
          title: epRows[0]?.title || null,
          servers: buildServers(epRows),
        })),
    }));
  return seasons;
}

function totalEpisodes(seasons) {
  return seasons.reduce((n, s) => n + s.episodes.length, 0);
}

// ---------- the two correct works ----------
const animeSeasons = buildSeasons(ANIME_ROWS);
const liveSeasons = buildSeasons(LIVE_ROWS);

const ANIME_WORK = {
  slug: 'avatar-the-last-airbender',
  clean_title: 'Avatar: The Last Airbender',
  raw_name: 'Avatar: The Last Airbender',
  category: 'anime',
  category_label: 'أنمي',
  subcategory: 'anime',
  subcategory_label: 'أنمي',
  is_new: false,
  poster: 'https://image.tmdb.org/t/p/w500/cVwn1YZTfPnkDNwWZTdBWJzZFB2.jpg',
  note: null,
  matched_poster: true,
  seasons_count: animeSeasons.length,
  episodes_count: totalEpisodes(animeSeasons),
  seasons: animeSeasons,
  description:
    'في عالمٍ تُقسَّم فيه الأمم وفق عناصر الطبيعة الأربعة (الماء والأرض والنار والهواء)، يستيقظ الفتى "آنغ" — الأفاتار، الوحيد القادر على التحكم بالعناصر الأربعة جميعًا — من سباتٍ دام مئة عام ليجد أمة النار قد أشعلت حربًا لإخضاع العالم. يخوض آنغ ورفاقه رحلة لإتقان العناصر وإنهاء الحرب.',
  url: '/anime/avatar-the-last-airbender',
  story:
    'في عالمٍ تُقسَّم فيه الأمم وفق عناصر الطبيعة الأربعة (الماء والأرض والنار والهواء)، يستيقظ الفتى "آنغ" — الأفاتار، الوحيد القادر على التحكم بالعناصر الأربعة جميعًا — من سباتٍ دام مئة عام ليجد أمة النار قد أشعلت حربًا لإخضاع العالم. يخوض آنغ ورفاقه رحلة لإتقان العناصر وإنهاء الحرب.',
  year: 2005,
  quality: 'HD',
  duration: null,
  language: 'مترجم',
  country: 'United States of America',
  director: 'Michael Dante DiMartino, Bryan Konietzko',
  stars: 'Zach Tyler Eisen، Mae Whitman، Jack DeSena، Dante Basco',
  genre: 'حركة ومغامرة، أنيميشن، عائلي، خيال',
  trailerId: null,
  rating: 8.7,
  imdb_rating: null,
  tmdb_id: 246,
  tmdb_url: 'https://www.themoviedb.org/tv/246',
  original_title: 'Avatar: The Last Airbender',
  tmdb_vote: 8.7,
  tmdb_votes: 4500,
  release_date: '2005-02-21',
  sort_rating: 8.7,
  sort_recent: 1108944000000,
  real_plot: true,
  is_special: false,
  adult: false,
  cast: [
    'Zach Tyler Eisen', 'Mae Whitman', 'Jack DeSena', 'Dante Basco',
    'Dee Bradley Baker', 'Mako', 'Grey DeLisle', 'Jessie Flower',
  ],
  overview_ar:
    'في عالمٍ تُقسَّم فيه الأمم وفق عناصر الطبيعة الأربعة، يستيقظ الأفاتار "آنغ" من سباتٍ دام مئة عام ليوقف حرب أمة النار.',
  genres: ['حركة ومغامرة', 'أنيميشن', 'عائلي', 'خيال'],
  vote_average: 8.7,
  vote_count: 4500,
  creators: ['Michael Dante DiMartino', 'Bryan Konietzko'],
  backdrop_path: '/9kuXBUj0Xz3nBGyGkH0N4pM7d3.jpg',
  imdb_id: 'tt0417299',
  title_ar: 'أفاتار: آخر بني الهواء',
  spoken_languages: ['English'],
  production_countries: ['United States of America'],
  status: 'Ended',
  number_of_episodes: totalEpisodes(animeSeasons),
  number_of_seasons: animeSeasons.length,
};

const LIVE_WORK = {
  slug: 'avatar-the-last-airbender-2024',
  clean_title: 'Avatar: The Last Airbender 2024',
  raw_name: 'Avatar: The Last Airbender 2024',
  category: 'series',
  category_label: 'مسلسلات',
  subcategory: 'netflix-series',
  subcategory_label: 'مسلسلات نتفليكس',
  is_new: false,
  poster: 'https://image.tmdb.org/t/p/w500/arhzBuZF0qBhYQx6RHapR37d9lc.jpg',
  note: null,
  matched_poster: true,
  seasons_count: liveSeasons.length,
  episodes_count: totalEpisodes(liveSeasons),
  seasons: liveSeasons,
  description:
    'النسخة الحيّة (Live Action) من إنتاج Netflix للأنمي الشهير: يجب على صبيٍّ صغير يُعرف باسم "الأفاتار" إتقان قوى عناصر الطبيعة الأربعة لإنقاذ عالمٍ تستعِر فيه نيران الحرب على يد أمة النار.',
  url: '/series/avatar-the-last-airbender-2024',
  story:
    'النسخة الحيّة (Live Action) من إنتاج Netflix للأنمي الشهير: يجب على صبيٍّ صغير يُعرف باسم "الأفاتار" إتقان قوى عناصر الطبيعة الأربعة لإنقاذ عالمٍ تستعِر فيه نيران الحرب على يد أمة النار.',
  year: 2024,
  quality: 'HD',
  duration: null,
  language: 'مترجم',
  country: 'United States of America',
  director: 'Albert Kim',
  stars: 'Gordon Cormier، Kiawentiio، Ian Ousley، Dallas Liu، Paul Sun-Hyung Lee',
  genre: 'حركة ومغامرة، خيال علمي وفانتازيا، دراما، عائلي',
  trailerId: null,
  rating: 7.79,
  imdb_rating: null,
  tmdb_id: 82452,
  tmdb_url: 'https://www.themoviedb.org/tv/82452',
  original_title: 'Avatar: The Last Airbender',
  tmdb_vote: 7.792,
  tmdb_votes: 1260,
  release_date: '2024-02-22',
  sort_rating: 7.792,
  sort_recent: 1708560000000,
  real_plot: true,
  is_special: false,
  adult: false,
  cast: [
    'Gordon Cormier', 'Kiawentiio', 'Ian Ousley', 'Dallas Liu',
    'Paul Sun-Hyung Lee', 'Daniel Dae Kim', 'Ken Leung', 'Elizabeth Yu',
  ],
  overview_ar:
    'النسخة الحيّة من Netflix لأفاتار: على الأفاتار الصغير إتقان العناصر الأربعة لإنقاذ العالم من أمة النار.',
  genres: ['حركة ومغامرة', 'خيال علمي وفانتازيا', 'دراما', 'عائلي'],
  vote_average: 7.792,
  vote_count: 1260,
  creators: ['Albert Kim'],
  backdrop_path: '/xUB3xFMgsHgPmdWnUWkHTJ03vHa.jpg',
  imdb_id: 'tt9018736',
  title_ar: 'أفاتار: مسخّر الهواء (لايف أكشن)',
  spoken_languages: ['English'],
  production_countries: ['United States of America'],
  status: 'Returning Series',
  number_of_episodes: totalEpisodes(liveSeasons),
  number_of_seasons: liveSeasons.length,
};

// ---------- report ----------
function reportWork(w) {
  console.log(`  slug=${w.slug} cat=${w.category} tmdb=${w.tmdb_id} year=${w.year} seasons=${w.number_of_seasons} eps=${w.number_of_episodes}`);
  const e0 = w.seasons[0]?.episodes[0];
  if (e0) console.log(`     S${w.seasons[0].season}E${e0.episode} servers(${e0.servers.length}): ${e0.servers.map((s) => s.label).join(', ')}`);
}
console.log('[fix-avatar] rebuilt works:');
reportWork(ANIME_WORK);
reportWork(LIVE_WORK);

if (DRY) {
  console.log('[fix-avatar] --dry: not writing all.json.');
  process.exit(0);
}

// ---------- stream all.json, drop broken slugs, append the two fresh works ----------
let buf = '', depth = 0, inStr = false, esc = false, started = false, collecting = false;
let scanned = 0, dropped = 0;
const ws = createWriteStream(TMP, { encoding: 'utf8', highWaterMark: 1 << 20 });
let wroteAny = false;

function emit(objText) {
  const chunk = (wroteAny ? ',' : '[') + objText;
  wroteAny = true;
  return ws.write(chunk);
}

const rs = createReadStream(ALL, { encoding: 'utf8', highWaterMark: 1 << 20 });
rs.on('data', (chunk) => {
  for (let i = 0; i < chunk.length; i++) {
    const ch = chunk[i];
    if (!started) { if (ch === '[') started = true; continue; }
    if (collecting) {
      buf += ch;
      if (inStr) {
        if (esc) esc = false; else if (ch === '\\') esc = true; else if (ch === '"') inStr = false;
        continue;
      }
      if (ch === '"') { inStr = true; continue; }
      if (ch === '{') depth++;
      else if (ch === '}') {
        depth--;
        if (depth === 0) {
          scanned++;
          // quick slug check without full parse
          const m = buf.match(/"slug"\s*:\s*"([^"]+)"/);
          const slug = m ? m[1] : '';
          if (DROP_SLUGS.has(slug)) { dropped++; }
          else { emit(buf); }
          buf = ''; collecting = false;
        }
      }
    } else if (ch === '{') { collecting = true; depth = 1; buf = '{'; }
  }
});
rs.on('error', (e) => { console.error('[fix-avatar] read error', e); process.exit(1); });
rs.on('end', () => {
  // append the two corrected works
  emit(JSON.stringify(ANIME_WORK));
  emit(JSON.stringify(LIVE_WORK));
  ws.end(wroteAny ? ']' : '[]', () => {
    renameSync(TMP, ALL);
    console.log(`[fix-avatar] scanned ${scanned}, dropped ${dropped} broken slugs, added 2 fresh works → wrote ${ALL}`);
  });
});
