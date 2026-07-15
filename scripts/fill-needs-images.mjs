import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');

const INPUT = process.argv[2] || '/home/user/uploaded_files/needs-images.csv';
const OUTPUT = process.argv[3] || join(root, 'exports/needs-images-filled.csv');
const ALL_PATH = join(root, 'src/data/generated/all.json');

// --- RFC4180 CSV parser ---
function parseCsv(text) {
  const rows = [];
  let field = '', row = [], i = 0, q = false;
  const s = text.replace(/^\uFEFF/, '');
  for (; i < s.length; i++) {
    const c = s[i];
    if (q) {
      if (c === '"') { if (s[i + 1] === '"') { field += '"'; i++; } else q = false; }
      else field += c;
    } else {
      if (c === '"') q = true;
      else if (c === ',') { row.push(field); field = ''; }
      else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
      else if (c === '\r') { /* skip */ }
      else field += c;
    }
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows;
}

function csv(v) {
  if (v === null || v === undefined) return '';
  let s = String(v).replace(/\r?\n/g, ' ').trim();
  if (/[",]/.test(s)) s = '"' + s.replace(/"/g, '""') + '"';
  return s;
}

// Arabic "noise" words that appear as prefixes/suffixes in site titles/slugs
const NOISE = new Set([
  'فيلم', 'اونا', 'أونا', 'اوفا', 'أوفا', 'مترجم', 'ومدبلج', 'مدبلج',
  'الحلقة', 'الخاصة', 'الموسم', 'اون', 'لاين', 'انمي', 'أنمي', 'ova', 'ona',
]);

// Latin+digit tokens only (drops all Arabic + punctuation)
function latinTokens(str) {
  return String(str || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .filter((w) => (w.length > 1 || /[0-9]/.test(w)));
}

// Full token set of a title (from slug is most reliable for latin transliteration)
function titleTokenSet(t) {
  // Prefer slug tokens (latin), fall back to clean/raw
  const src = [t.slug, t.clean_title, t.raw_name].filter(Boolean).join(' ');
  const toks = latinTokens(src).filter((w) => !NOISE.has(w));
  return new Set(toks);
}

function main() {
  const all = JSON.parse(readFileSync(ALL_PATH, 'utf8'));

  const bySlug = new Map();
  const index = [];
  for (const t of all) {
    if (t.slug) bySlug.set(t.slug, t);
    if (!t.poster) continue;
    index.push({ t, toks: titleTokenSet(t) });
  }

  const rows = parseCsv(readFileSync(INPUT, 'utf8'));
  const header = rows[0];
  const idIdx = header.indexOf('id');
  const nameIdx = header.indexOf('name');
  let imgIdx = header.indexOf('image_url');
  if (imgIdx === -1) { header.push('image_url'); imgIdx = header.length - 1; }
  // add a status column (matched via slug / exact token / not found on site)
  let statusIdx = header.indexOf('match_status');
  if (statusIdx === -1) { header.push('match_status'); statusIdx = header.length - 1; }

  const out = [header.map(csv).join(',')];
  let viaSlug = 0, viaExact = 0, missing = 0;
  const missingList = [];

  for (let r = 1; r < rows.length; r++) {
    const row = rows[r].slice();
    if (row.length === 1 && row[0] === '') continue;
    while (row.length < header.length) row.push('');

    const id = (row[idIdx] || '').trim();
    const name = (row[nameIdx] || '').trim();
    let poster = '';
    let how = '';

    // 1) exact slug hit (most reliable)
    const t = id && bySlug.get(id);
    if (t && t.poster) { poster = t.poster; how = 'slug'; }

    // 2) exact TOKEN-SET match: query tokens (from id+name) must equal a candidate's tokens
    if (!poster) {
      const qToks = new Set([
        ...latinTokens(id.replace(/-/g, ' ')),
        ...latinTokens(name),
      ].filter((w) => !NOISE.has(w)));

      if (qToks.size) {
        let best = null;
        for (const e of index) {
          if (e.toks.size !== qToks.size) continue;
          let same = true;
          for (const w of qToks) { if (!e.toks.has(w)) { same = false; break; } }
          if (same) { best = e.t; break; }
        }
        if (best) { poster = best.poster; how = 'exact'; }
      }
    }

    while (row.length <= statusIdx) row.push('');
    if (poster) {
      row[imgIdx] = poster;
      row[statusIdx] = how === 'slug' ? 'matched_slug' : 'matched_name';
      if (how === 'slug') viaSlug++; else viaExact++;
    } else {
      row[imgIdx] = '';
      row[statusIdx] = 'not_found_on_site';
      missing++;
      missingList.push(`${id},${csv(name)}`);
    }

    out.push(row.map(csv).join(','));
  }

  writeFileSync(OUTPUT, '\uFEFF' + out.join('\n') + '\n', 'utf8');

  // write a separate file listing only the unmatched works
  const missingOut = join(root, 'exports/needs-images-not-found.csv');
  writeFileSync(missingOut, '\uFEFF' + 'id,name\n' + missingList.join('\n') + '\n', 'utf8');

  const filled = viaSlug + viaExact;
  console.log(`[fill] rows processed : ${rows.length - 1}`);
  console.log(`[fill] filled         : ${filled} (slug=${viaSlug}, exact-token=${viaExact})`);
  console.log(`[fill] missing        : ${missing}`);
  console.log(`[fill] output         : ${OUTPUT}`);
  if (missing) {
    console.log('\n[fill] --- still missing (not found in site) ---');
    for (const m of missingList) console.log('  ' + m);
  }
}

main();
