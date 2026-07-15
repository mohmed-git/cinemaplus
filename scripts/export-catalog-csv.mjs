/**
 * Export the WHOLE catalogue (old + new works) to a single flat CSV.
 *
 * One row per SERVER link — the most complete, normalized form — so every
 * playable server URL of every episode of every work is captured. Movies are
 * stored with a single season/episode holding their servers, so they naturally
 * come out as season=1 / episode=1.
 *
 * Columns:
 *   slug, title, category, category_label, subcategory, subcategory_label,
 *   is_new, year, poster, season, episode, episode_title, server_label, server_url
 *
 * Usage:  node scripts/export-catalog-csv.mjs [output.csv]
 * Default output: exports/catalog-all.csv
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const ALL_PATH = join(root, 'src/data/generated/all.json');
const outArg = process.argv[2];
const OUT_PATH = outArg
  ? (outArg.startsWith('/') ? outArg : join(root, outArg))
  : join(root, 'exports/catalog-all.csv');

/** RFC-4180 CSV field escaping. */
function csv(value) {
  if (value === null || value === undefined) return '';
  let s = String(value);
  // Normalize newlines inside fields to spaces to keep rows single-line-ish.
  s = s.replace(/\r?\n/g, ' ').trim();
  if (/[",]/.test(s)) {
    s = '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

const HEADERS = [
  'slug',
  'title',
  'category',
  'category_label',
  'subcategory',
  'subcategory_label',
  'is_new',
  'year',
  'poster',
  'season',
  'episode',
  'episode_title',
  'server_label',
  'server_url',
];

function main() {
  const all = JSON.parse(readFileSync(ALL_PATH, 'utf8'));
  const rows = [HEADERS.join(',')];

  let works = 0;
  let episodesWithServers = 0;
  let serverRows = 0;
  let worksWithoutServers = 0;

  for (const t of all) {
    works++;
    const base = {
      slug: t.slug,
      title: t.clean_title || t.raw_name || t.slug,
      category: t.category,
      category_label: t.category_label,
      subcategory: t.subcategory ?? '',
      subcategory_label: t.subcategory_label ?? '',
      is_new: t.is_new ? '1' : '0',
      year: t.year ?? '',
      poster: t.poster ?? '',
    };

    let emittedForWork = 0;
    const seasons = Array.isArray(t.seasons) ? t.seasons : [];
    for (const s of seasons) {
      const episodes = Array.isArray(s.episodes) ? s.episodes : [];
      for (const ep of episodes) {
        const servers = Array.isArray(ep.servers) ? ep.servers : [];
        if (servers.length > 0) episodesWithServers++;
        for (const sv of servers) {
          if (!sv || !sv.url) continue;
          rows.push([
            csv(base.slug),
            csv(base.title),
            csv(base.category),
            csv(base.category_label),
            csv(base.subcategory),
            csv(base.subcategory_label),
            csv(base.is_new),
            csv(base.year),
            csv(base.poster),
            csv(s.season),
            csv(ep.episode),
            csv(ep.title || ''),
            csv(sv.label || ''),
            csv(sv.url),
          ].join(','));
          serverRows++;
          emittedForWork++;
        }
      }
    }
    if (emittedForWork === 0) worksWithoutServers++;
  }

  const outDir = dirname(OUT_PATH);
  if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });
  // Prepend a UTF-8 BOM so Excel opens the Arabic text correctly.
  writeFileSync(OUT_PATH, '\uFEFF' + rows.join('\n') + '\n', 'utf8');

  console.log(`[export-csv] works scanned      : ${works}`);
  console.log(`[export-csv] episodes w/ servers: ${episodesWithServers}`);
  console.log(`[export-csv] server rows written: ${serverRows}`);
  console.log(`[export-csv] works w/o servers   : ${worksWithoutServers}`);
  console.log(`[export-csv] output              : ${OUT_PATH}`);
}

main();
