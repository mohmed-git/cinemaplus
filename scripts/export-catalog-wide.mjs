import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const ALL_PATH = join(root, 'src/data/generated/all.json');

const outArg = process.argv[2];
const OUT_PATH = outArg
  ? (outArg.startsWith('/') ? outArg : join(root, outArg))
  : join(root, 'exports/catalog-wide.csv');

function csv(value) {
  if (value === null || value === undefined) return '';
  let s = String(value).replace(/\r?\n/g, ' ').trim();
  if (/[",]/.test(s)) s = '"' + s.replace(/"/g, '""') + '"';
  return s;
}

function main() {
  const all = JSON.parse(readFileSync(ALL_PATH, 'utf8'));

  // First pass: find max servers across ANY episode (for column sizing)
  let maxServers = 0;
  for (const t of all) {
    for (const s of t.seasons || []) {
      for (const e of s.episodes || []) {
        const n = Array.isArray(e.servers) ? e.servers.length : 0;
        if (n > maxServers) maxServers = n;
      }
    }
  }

  // Header: work info + season/episode + N server columns (label+url merged per server)
  const baseHeaders = [
    'slug', 'title', 'category', 'category_label',
    'subcategory', 'subcategory_label', 'is_new', 'year',
    'poster', 'season', 'season_poster', 'episode', 'episode_title',
  ];
  const serverHeaders = [];
  for (let i = 1; i <= maxServers; i++) {
    serverHeaders.push(`server_${i}_label`);
    serverHeaders.push(`server_${i}_url`);
  }
  const header = [...baseHeaders, ...serverHeaders];

  const rows = [header.join(',')];

  const worksSeen = new Set();
  const worksEmitted = new Set();
  let episodeRows = 0;
  let worksWithoutAnyServer = 0;
  const noServerWorks = [];

  for (const t of all) {
    worksSeen.add(t.slug);
    const workPoster = t.poster || t.matched_poster || '';
    const base = {
      slug: t.slug,
      title: t.clean_title || t.raw_name || t.slug,
      category: t.category,
      category_label: t.category_label,
      subcategory: t.subcategory ?? '',
      subcategory_label: t.subcategory_label ?? '',
      is_new: t.is_new ? '1' : '0',
      year: t.year ?? '',
      poster: workPoster,
    };

    let workHadServer = false;

    const seasons = Array.isArray(t.seasons) ? t.seasons : [];
    for (const s of seasons) {
      // Site data has no per-season image -> use the work poster as season image
      const seasonPoster = s.poster || s.season_poster || s.image || workPoster;
      const episodes = Array.isArray(s.episodes) ? s.episodes : [];
      for (const ep of episodes) {
        const servers = Array.isArray(ep.servers) ? ep.servers : [];
        if (servers.length > 0) workHadServer = true;

        const cells = [
          csv(base.slug), csv(base.title), csv(base.category), csv(base.category_label),
          csv(base.subcategory), csv(base.subcategory_label), csv(base.is_new), csv(base.year),
          csv(base.poster), csv(s.season), csv(seasonPoster), csv(ep.episode), csv(ep.title || ''),
        ];
        // one pair (label,url) per server, padded to maxServers
        for (let i = 0; i < maxServers; i++) {
          const sv = servers[i];
          cells.push(csv(sv ? (sv.label || '') : ''));
          cells.push(csv(sv ? (sv.url || '') : ''));
        }
        rows.push(cells.join(','));
        episodeRows++;
        worksEmitted.add(t.slug);
      }
    }

    if (!workHadServer) {
      worksWithoutAnyServer++;
      noServerWorks.push(t.slug);
      // still emit a placeholder row so EVERY work appears in the CSV
      if (seasons.length === 0) {
        const cells = [
          csv(base.slug), csv(base.title), csv(base.category), csv(base.category_label),
          csv(base.subcategory), csv(base.subcategory_label), csv(base.is_new), csv(base.year),
          csv(base.poster), '', csv(base.poster), '', '',
        ];
        for (let i = 0; i < maxServers; i++) { cells.push(''); cells.push(''); }
        rows.push(cells.join(','));
        episodeRows++;
        worksEmitted.add(t.slug);
      }
    }
  }

  const outDir = dirname(OUT_PATH);
  if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });
  writeFileSync(OUT_PATH, '\uFEFF' + rows.join('\n') + '\n', 'utf8');

  // Coverage check: every work in all.json must appear in the CSV
  const missingFromCsv = [];
  for (const slug of worksSeen) if (!worksEmitted.has(slug)) missingFromCsv.push(slug);

  console.log(`[wide] total works in site   : ${worksSeen.size}`);
  console.log(`[wide] works emitted in CSV  : ${worksEmitted.size}`);
  console.log(`[wide] works MISSING from CSV: ${missingFromCsv.length}`);
  console.log(`[wide] episode rows written  : ${episodeRows}`);
  console.log(`[wide] max servers per episode: ${maxServers}  -> ${maxServers} server columns (x2)`);
  console.log(`[wide] works without servers : ${worksWithoutAnyServer}`);
  console.log(`[wide] total columns         : ${header.length}`);
  console.log(`[wide] output                : ${OUT_PATH}`);
  if (missingFromCsv.length) {
    console.log('\n[wide] !!! works missing from CSV:');
    for (const m of missingFromCsv.slice(0, 50)) console.log('  ' + m);
  }
}

main();
