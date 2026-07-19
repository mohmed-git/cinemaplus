#!/usr/bin/env node
/**
 * Reorder every episode's `servers[]` in src/data/generated/all.json by a fixed
 * PROVIDER PRIORITY, so the servers the site owner prefers show up first for the
 * user, and the problematic (anti-hotlinking) one is pushed to the very end.
 *
 * Desired default order (per site owner):
 *   1. megatuktuk   (the "forgotten" server the owner wanted first)
 *   2. streamwish
 *   3. luluvdo      (= LuluStream)
 *   4. uqload
 *   5. earnvids     (= Filelions / the FileLions–StreamWish network rebrand)
 *   … everything else keeps its original relative order …
 *   LAST. vidtube   (currently has an anti-hotlinking problem — parked last)
 *
 * Matching is by PROVIDER KEY (scripts/lib-host.mjs `providerKey`), which is
 * robust to subdomain/TLD hopping (down.vidtube.one, vidtube.pro, uqload.is/.net
 * … all collapse to a single key). The sort is STABLE: servers with equal
 * priority keep their existing relative order, so nothing else is disturbed.
 *
 * Memory-safe: streams all.json with a brace-depth carver (the 150MB file cannot
 * be JSON.parse'd on the low-memory sandbox), rewrites each title, and
 * stream-writes to all.json.tmp before an atomic os.rename-style replace.
 *
 * Run:  node scripts/reorder-servers.mjs
 * After: re-split into parts (node scripts/split-all-json.mjs) so the <45MB git
 *        parts stay in sync with the reordered all.json.
 */
import { createReadStream, createWriteStream, renameSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { providerKey } from './lib-host.mjs';

const ALL = resolve(process.cwd(), 'src/data/generated/all.json');
const TMP = ALL + '.tmp';

// Provider priority. Lower number = shown earlier. Anything not listed gets
// DEFAULT_RANK (kept in original order via a stable sort). vidtube gets LAST_RANK.
const FIRST = ['megatuktuk', 'streamwish', 'luluvdo', 'uqload', 'earnvids'];
const LAST = ['vidtube'];

const RANK = new Map();
FIRST.forEach((k, i) => RANK.set(k, i)); // 0..4
const DEFAULT_RANK = 1000;
const LAST_RANK = 2000;
LAST.forEach((k) => RANK.set(k, LAST_RANK));

function rankOf(url) {
  const k = providerKey(url);
  if (RANK.has(k)) return RANK.get(k);
  return DEFAULT_RANK;
}

/** Stable sort of a servers[] array by provider priority. */
function reorderServers(servers) {
  if (!Array.isArray(servers) || servers.length < 2) return servers;
  // decorate with original index for stability, sort, strip.
  return servers
    .map((sv, i) => ({ sv, i, r: rankOf(sv && sv.url) }))
    .sort((a, b) => (a.r - b.r) || (a.i - b.i))
    .map((x) => x.sv);
}

let reorderedEpisodes = 0;
let touchedWorks = 0;

function processTitle(txt) {
  let t;
  try {
    t = JSON.parse(txt);
  } catch {
    return txt; // if it can't parse, pass through unchanged (should never happen)
  }
  let touched = false;
  if (Array.isArray(t.seasons)) {
    for (const s of t.seasons) {
      if (!Array.isArray(s.episodes)) continue;
      for (const ep of s.episodes) {
        if (Array.isArray(ep.servers) && ep.servers.length > 1) {
          const before = ep.servers;
          const after = reorderServers(before);
          // only mark touched if order actually changed
          let changed = false;
          for (let i = 0; i < before.length; i++) {
            if (before[i] !== after[i]) { changed = true; break; }
          }
          if (changed) { ep.servers = after; reorderedEpisodes++; touched = true; }
        }
      }
    }
  }
  if (touched) touchedWorks++;
  return JSON.stringify(t);
}

async function main() {
  const ws = createWriteStream(TMP);
  const write = (s) => new Promise((res, rej) => (ws.write(s) ? res() : ws.once('drain', res), ws.once('error', rej)));

  await write('[');
  let first = true;

  let depth = 0, inStr = false, esc = false, buf = '', started = false, total = 0;
  const rs = createReadStream(ALL, { encoding: 'utf8' });

  for await (const chunk of rs) {
    for (let i = 0; i < chunk.length; i++) {
      const ch = chunk[i];
      if (!started) { if (ch === '[') started = true; continue; }
      if (inStr) { buf += ch; if (esc) esc = false; else if (ch === '\\') esc = true; else if (ch === '"') inStr = false; continue; }
      if (ch === '"') { inStr = true; buf += ch; continue; }
      if (ch === '{') { if (depth === 0) buf = ''; depth++; buf += ch; continue; }
      if (ch === '}') {
        depth--; buf += ch;
        if (depth === 0) {
          const out = processTitle(buf);
          buf = '';
          total++;
          await write(first ? out : ',' + out);
          first = false;
        }
        continue;
      }
      if (depth > 0) buf += ch;
    }
  }

  await write(']');
  await new Promise((res, rej) => ws.end((e) => (e ? rej(e) : res())));

  // sanity: tmp must be valid-ish (non-empty, ends with ])
  const size = statSync(TMP).size;
  if (size < 1000) throw new Error(`reorder produced a suspiciously small file (${size} bytes) — aborting`);

  renameSync(TMP, ALL);
  console.log(`[reorder-servers] titles processed : ${total}`);
  console.log(`[reorder-servers] works touched     : ${touchedWorks}`);
  console.log(`[reorder-servers] episodes reordered: ${reorderedEpisodes}`);
  console.log(`[reorder-servers] new all.json size : ${(size / 1048576).toFixed(1)} MB`);
  console.log(`[reorder-servers] order: ${FIRST.join(' > ')} > …rest… > ${LAST.join(', ')} (LAST)`);
}

main().catch((e) => { console.error(e); process.exit(1); });
