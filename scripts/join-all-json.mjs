/**
 * Reassemble src/data/generated/all.json from its committed <100MB part files
 * (see split-all-json.mjs). Runs as the FIRST build/prebuild/dev step so every
 * consumer that reads all.json (titles.ts prerender, build-episode-shards,
 * build-search-index) finds the full, byte-identical catalogue.
 *
 * Idempotent + safe: if all.json already exists and matches the manifest byte
 * count, it is left untouched (skips the concat on repeat runs / local dev).
 */
import { readFileSync, existsSync, statSync, createReadStream, createWriteStream, renameSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pipeline } from 'node:stream/promises';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const genDir = join(root, 'src/data/generated');
const ALL = join(genDir, 'all.json');
const MANIFEST = join(genDir, 'all.json.parts.json');

if (!existsSync(MANIFEST)) {
  if (existsSync(ALL)) {
    console.log('[join] no parts manifest; assuming all.json is already present.');
    process.exit(0);
  }
  console.error('[join] ERROR: neither all.json nor all.json.parts.json exists.');
  process.exit(1);
}

const { parts, bytes } = JSON.parse(readFileSync(MANIFEST, 'utf8'));

if (existsSync(ALL) && statSync(ALL).size === bytes) {
  console.log(`[join] all.json already assembled (${bytes} bytes) — skipping.`);
  process.exit(0);
}

// Memory-safe: append each part to the output via a stream (one part in flight
// at a time) instead of Buffer.concat, which would peak at ~2x the file size.
const TMP = ALL + '.tmp';
const ws = createWriteStream(TMP);
for (const p of parts) {
  const fp = join(genDir, p);
  if (!existsSync(fp)) {
    console.error(`[join] ERROR: missing part ${p}`);
    process.exit(1);
  }
  await pipeline(createReadStream(fp), ws, { end: false });
}
await new Promise((res, rej) => ws.end((e) => (e ? rej(e) : res())));

const finalSize = statSync(TMP).size;
if (finalSize !== bytes) {
  console.error(`[join] ERROR: reassembled ${finalSize} bytes but manifest expects ${bytes}.`);
  process.exit(1);
}
renameSync(TMP, ALL);
console.log(`[join] all.json reassembled from ${parts.length} parts (${bytes} bytes).`);
