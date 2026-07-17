/**
 * Split src/data/generated/all.json into <100MB chunk files so the catalogue can
 * live in the GitHub repo (GitHub rejects any single file > 100MB).
 *
 * The chunks are RAW BYTE slices (not JSON-aware) named all.json.part-000,
 * all.json.part-001, ... plus a manifest all.json.parts.json listing them in
 * order. `join-all-json.mjs` concatenates them back into an identical all.json
 * at the start of every build.
 *
 * Run manually whenever all.json changes:  node scripts/split-all-json.mjs
 */
import { readFileSync, writeFileSync, readdirSync, unlinkSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const genDir = join(root, 'src/data/generated');
const ALL = join(genDir, 'all.json');
const CHUNK = 60 * 1024 * 1024; // 60MB per part — comfortably under GitHub's 100MB

// clean old parts
for (const f of readdirSync(genDir)) {
  if (f.startsWith('all.json.part-')) unlinkSync(join(genDir, f));
}

const buf = readFileSync(ALL);
const parts = [];
let i = 0;
for (let off = 0; off < buf.length; off += CHUNK) {
  const name = `all.json.part-${String(i).padStart(3, '0')}`;
  writeFileSync(join(genDir, name), buf.subarray(off, off + CHUNK));
  parts.push(name);
  i++;
}
writeFileSync(join(genDir, 'all.json.parts.json'), JSON.stringify({ parts, bytes: buf.length }, null, 2));
console.log(`[split] all.json (${buf.length} bytes) -> ${parts.length} parts:`, parts.join(', '));
