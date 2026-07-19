/**
 * Split src/data/generated/all.json into <45MB chunk files so the catalogue can
 * live in the GitHub repo (GitHub rejects any single file > 100MB and warns
 * above 50MB).
 *
 * The chunks are RAW BYTE slices (not JSON-aware) named all.json.part-000,
 * all.json.part-001, ... plus a manifest all.json.parts.json listing them in
 * order. `join-all-json.mjs` concatenates them back into an identical all.json
 * at the start of every build.
 *
 * STREAMING: the 140MB+ file cannot be read into a single Buffer on the
 * low-memory sandbox (OOM). We read it as a stream and cut a new part every
 * CHUNK bytes, so peak memory stays tiny.
 *
 * Run manually whenever all.json changes:  node scripts/split-all-json.mjs
 */
import {
  createReadStream,
  createWriteStream,
  writeFileSync,
  readdirSync,
  unlinkSync,
  statSync,
} from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const genDir = join(root, 'src/data/generated');
const ALL = join(genDir, 'all.json');
const CHUNK = 45 * 1024 * 1024; // 45MB per part — under GitHub's 50MB warning threshold

// clean old parts
for (const f of readdirSync(genDir)) {
  if (f.startsWith('all.json.part-')) unlinkSync(join(genDir, f));
}

const totalBytes = statSync(ALL).size;

async function main() {
  const parts = [];
  let idx = 0;
  let written = 0; // bytes written into the current part
  let ws = null;

  const openPart = () => {
    const name = `all.json.part-${String(idx).padStart(3, '0')}`;
    parts.push(name);
    ws = createWriteStream(join(genDir, name));
    written = 0;
  };
  const closePart = () =>
    ws ? new Promise((res, rej) => ws.end((e) => (e ? rej(e) : res()))) : Promise.resolve();

  const writeChunk = (b) =>
    new Promise((res, rej) => {
      if (ws.write(b)) res();
      else {
        ws.once('drain', res);
        ws.once('error', rej);
      }
    });

  openPart();

  const rs = createReadStream(ALL, { highWaterMark: 8 * 1024 * 1024 });
  for await (const chunk of rs) {
    let offset = 0;
    while (offset < chunk.length) {
      const room = CHUNK - written;
      const take = Math.min(room, chunk.length - offset);
      const slice = chunk.subarray(offset, offset + take);
      await writeChunk(slice);
      written += take;
      offset += take;
      if (written >= CHUNK) {
        await closePart();
        idx++;
        openPart();
      }
    }
  }
  await closePart();

  writeFileSync(
    join(genDir, 'all.json.parts.json'),
    JSON.stringify({ parts, bytes: totalBytes }, null, 2)
  );
  console.log(`[split] all.json (${totalBytes} bytes) -> ${parts.length} parts:`, parts.join(', '));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
