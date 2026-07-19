/**
 * Deduplicate works that are the SAME title split across multiple entries.
 *
 * Two real-world problems this fixes (reported by users):
 *
 *  1) "The Season" style — one series appears as the proper multi-episode work
 *     PLUS a separate one-episode page per episode
 *     (مسلسل الموسم The Season الحلقة 1/2/3…). They all share the same tmdb_id
 *     and each carries its true episode number in seasons[].episodes[].episode,
 *     so they collapse cleanly into the single work.
 *
 *  2) "It's Okay to Not Be Okay" style — the exact same series exists twice
 *     (an English-named copy and an Arabic-named copy, same tmdb_id) but each
 *     copy has DIFFERENT streaming servers. We merge their servers per episode.
 *
 * Merge key: (category, tmdb_id). tmdb_id is a reliable identity key — of 1,170
 * duplicate groups only ONE had a mismatched original_title (a bad TMDB match:
 * "Spider & Jessie" vs "What We Hide"). To be safe we NEVER merge entries whose
 * normalized original_title disagree — that guards against merging two genuinely
 * different works that happen to share a tmdb_id. Similar-but-distinct titles
 * with DIFFERENT tmdb_ids are never touched.
 *
 * MEMORY MODEL — two streaming passes (the 148MB file cannot be held in RAM in
 * the 985MB sandbox):
 *   PASS 1: stream the file, count occurrences per (category, tmdb_id) key and
 *           record the normalized original_title of the FIRST occurrence. Only
 *           tiny per-key metadata is retained.
 *   PASS 2: stream the file again and write output element-by-element:
 *           - works with no tmdb_id, or keys seen exactly once → written as-is
 *           - the FIRST occurrence of a duplicate key → buffer all members of
 *             that group (only that group), then when the group is complete emit
 *             the single merged work. Groups are small, so peak RAM stays low.
 *           - later occurrences of a duplicate key → buffered, not written.
 *           - unsafe members (original_title disagrees) → written as-is.
 *
 * Usage:
 *   node scripts/dedupe-by-tmdb.mjs                 # in place (writes all.json)
 *   node scripts/dedupe-by-tmdb.mjs --in a --out b  # explicit paths
 *   node scripts/dedupe-by-tmdb.mjs --dry           # report only, no write
 */
import { createReadStream, createWriteStream, renameSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const GEN = join(root, 'src/data/generated');

// ---- args ----
const argv = process.argv.slice(2);
function argVal(flag) {
  const i = argv.indexOf(flag);
  return i >= 0 && i + 1 < argv.length ? argv[i + 1] : null;
}
const DRY = argv.includes('--dry');
const IN = argVal('--in') || join(GEN, 'all.json');
const OUT = argVal('--out') || join(GEN, 'all.json');

// ---------- helpers ----------
function normTitle(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[’'`]/g, '')
    .replace(/[^a-z0-9\u0600-\u06ff]+/g, ' ')
    .trim();
}

function tmdbKey(o) {
  const tid = o.tmdb_id;
  if (tid === null || tid === undefined || tid === '' || Number(tid) === 0) return null;
  const cat = o.category || '';
  return `${cat}#${Number(tid)}`;
}

// Richness score → which entry becomes the canonical "base" that we keep.
function richness(o) {
  let s = 0;
  s += (Number(o.episodes_count) || 0) * 1000;
  s += (Array.isArray(o.seasons) ? o.seasons.length : 0) * 100;
  if (o.real_plot) s += 500;
  if (o.matched_poster) s += 300;
  if (o.poster) s += 100;
  if (o.story && String(o.story).length > 40) s += 50;
  s += Array.isArray(o.cast) ? o.cast.length : 0;
  if (!o.is_new) s += 25;
  return s;
}

function absorbSeasons(seasonsMap, work) {
  const seasons = Array.isArray(work.seasons) ? work.seasons : [];
  for (const s of seasons) {
    const sn = Number(s.season) || 1;
    if (!seasonsMap.has(sn)) seasonsMap.set(sn, new Map());
    const epMap = seasonsMap.get(sn);
    const eps = Array.isArray(s.episodes) ? s.episodes : [];
    for (const e of eps) {
      const en = Number(e.episode);
      if (!Number.isFinite(en)) continue;
      if (!epMap.has(en)) {
        epMap.set(en, { episode: en, title: e.title ?? null, servers: [], _urls: new Set() });
      }
      const slot = epMap.get(en);
      if (!slot.title && e.title) slot.title = e.title;
      const servers = Array.isArray(e.servers) ? e.servers : [];
      for (const sv of servers) {
        const url = sv && sv.url ? String(sv.url) : '';
        if (!url) continue;
        if (slot._urls.has(url)) continue;
        slot._urls.add(url);
        slot.servers.push({ id: sv.id ?? null, label: sv.label ?? null, url });
      }
    }
  }
}

function buildMergedWork(group) {
  const base = { ...group.slice().sort((a, b) => richness(b) - richness(a))[0] };
  const seasonsMap = new Map();
  for (const w of group) absorbSeasons(seasonsMap, w);

  const seasons = [...seasonsMap.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([sn, epMap]) => ({
      season: sn,
      episodes: [...epMap.values()]
        .sort((a, b) => a.episode - b.episode)
        .map(({ episode, title, servers }) => ({ episode, title, servers })),
    }));

  const totalEpisodes = seasons.reduce((n, s) => n + s.episodes.length, 0);

  base.seasons = seasons;
  base.seasons_count = seasons.length;
  base.number_of_seasons = seasons.length;
  base.episodes_count = totalEpisodes;
  base.number_of_episodes = totalEpisodes;

  return base;
}

function countServers(work) {
  const seasons = Array.isArray(work.seasons) ? work.seasons : [];
  let n = 0;
  for (const s of seasons) {
    const eps = Array.isArray(s.episodes) ? s.episodes : [];
    for (const e of eps) n += Array.isArray(e.servers) ? e.servers.length : 0;
  }
  return n;
}

// ---------- streaming JSON array carver ----------
// Reads a JSON array element-by-element (brace-depth state machine) and calls
// `onObject(parsedObject)` for each element. Returns a Promise.
function streamArray(path, onObject) {
  return new Promise((resolve, reject) => {
    let buf = '';
    let depth = 0;
    let inStr = false;
    let esc = false;
    let started = false;
    let collecting = false;

    const stream = createReadStream(path, { encoding: 'utf8', highWaterMark: 1 << 20 });
    stream.on('data', (chunk) => {
      for (let i = 0; i < chunk.length; i++) {
        const ch = chunk[i];
        if (!started) {
          if (ch === '[') started = true;
          continue;
        }
        if (collecting) {
          buf += ch;
          if (inStr) {
            if (esc) esc = false;
            else if (ch === '\\') esc = true;
            else if (ch === '"') inStr = false;
            continue;
          }
          if (ch === '"') { inStr = true; continue; }
          if (ch === '{') depth++;
          else if (ch === '}') {
            depth--;
            if (depth === 0) {
              let o;
              try { o = JSON.parse(buf); }
              catch (err) { console.error('[dedupe] parse error, skipping:', err.message); }
              buf = '';
              collecting = false;
              if (o) onObject(o);
            }
          }
        } else {
          if (ch === '{') { collecting = true; depth = 1; buf = '{'; }
        }
      }
    });
    stream.on('error', reject);
    stream.on('end', resolve);
  });
}

// ================= PASS 1: count keys + record first title =================
const keyInfo = new Map(); // key -> { count, firstTitle }
let scanned = 0;

await streamArray(IN, (o) => {
  scanned++;
  const key = tmdbKey(o);
  if (!key) return;
  const t = normTitle(o.original_title || o.clean_title);
  const info = keyInfo.get(key);
  if (!info) keyInfo.set(key, { count: 1, firstTitle: t });
  else info.count++;
});

// Duplicate keys only (count > 1). Singletons pass straight through in pass 2.
let dupGroupKeys = 0;
for (const info of keyInfo.values()) if (info.count > 1) dupGroupKeys++;

console.log(`[dedupe] PASS 1: scanned ${scanned} works, ${keyInfo.size} unique keys, ${dupGroupKeys} duplicate groups`);

// ================= PASS 2: stream out, merging duplicate groups =============
const writer = DRY ? null : createWriteStream(OUT + '.tmp', { encoding: 'utf8', highWaterMark: 1 << 20 });
if (writer) {
  writer.on('error', (err) => { console.error('[dedupe] write error:', err); process.exit(1); });
}

let wroteAny = false;
const pending = new Map(); // key -> array of buffered group members (only for dup keys)
const emittedGroup = new Set(); // keys already flushed
const unsafeSkips = [];
let outCount = 0;
let mergedGroups = 0;
let removed = 0;
const examples = [];

function emit(obj) {
  outCount++;
  if (!writer) return true;
  const chunk = (wroteAny ? ',' : '[') + JSON.stringify(obj);
  wroteAny = true;
  return writer.write(chunk);
}

// backpressure-aware emit for large flushes
function emitAsync(obj) {
  const ok = emit(obj);
  if (ok) return Promise.resolve();
  return new Promise((res) => writer.once('drain', res));
}

function flushGroup(key) {
  const members = pending.get(key);
  pending.delete(key);
  emittedGroup.add(key);
  if (!members || members.length === 0) return;
  if (members.length === 1) { emit(members[0]); return; }
  const before = members.reduce((n, w) => n + countServers(w), 0);
  const merged = buildMergedWork(members);
  const after = countServers(merged);
  emit(merged);
  mergedGroups++;
  removed += members.length - 1;
  if (examples.length < 8) {
    examples.push({ key, title: merged.clean_title, copies: members.length,
      episodes: merged.episodes_count, serversAfter: after, serversBefore: before });
  }
}

let processedInPass2 = 0;

await streamArray(IN, (o) => {
  processedInPass2++;
  const key = tmdbKey(o);
  const info = key ? keyInfo.get(key) : null;

  // no key OR a unique (non-duplicate) key → emit as-is
  if (!key || !info || info.count <= 1) { emit(o); return; }

  // duplicate group. Safety: original_title must agree with the group's first
  // occurrence, else keep this member APART (emit as its own standalone work).
  const b = normTitle(o.original_title || o.clean_title);
  if (info.firstTitle && b && info.firstTitle !== b) {
    emit(o);
    unsafeSkips.push({ key, a: info.firstTitle, b });
    // this member does NOT count toward the group; decrement expected count
    info.count--;
    if (info.count <= 1 && pending.has(key)) {
      // group collapsed to a single safe member → flush it now
      flushGroup(key);
    }
    return;
  }

  if (!pending.has(key)) pending.set(key, []);
  const arr = pending.get(key);
  arr.push(o);

  // once we've buffered all safe members of the group, flush the merged work
  if (arr.length >= info.count && !emittedGroup.has(key)) {
    flushGroup(key);
  }
});

// flush any groups that never reached expected count (defensive)
for (const key of [...pending.keys()]) flushGroup(key);

function finish() {
  console.log(`[dedupe] PASS 2: processed ${processedInPass2} works`);
  console.log(`[dedupe] merged ${mergedGroups} duplicate groups → removed ${removed} redundant works`);
  console.log(`[dedupe] output works: ${outCount}`);
  if (unsafeSkips.length) {
    console.log(`[dedupe] SAFETY: kept ${unsafeSkips.length} entries apart (same tmdb_id, different original_title):`);
    for (const u of unsafeSkips.slice(0, 10)) console.log(`   - ${u.key}: "${u.a}" vs "${u.b}"`);
  }
  console.log('[dedupe] examples:');
  for (const e of examples) {
    console.log(`   - ${e.title} [${e.key}] copies=${e.copies} → episodes=${e.episodes}, servers=${e.serversAfter} (was ${e.serversBefore})`);
  }
}

if (!writer) {
  console.log('[dedupe] --dry: no file written.');
  finish();
} else {
  writer.end(wroteAny ? ']' : '[]', () => {
    renameSync(OUT + '.tmp', OUT);
    console.log(`[dedupe] wrote ${OUT} (streamed)`);
    finish();
  });
}
