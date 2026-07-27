"""
Low-RAM byte-level splitter for all.json -> all.json.part-NNN (45MB each) +
all.json.parts.json manifest. Mirrors scripts/split-all-json.mjs output exactly
(raw byte slices) but runs in Python with a tiny fixed buffer, which is far more
reliable on this 985MB-RAM sandbox than the Node streaming version.
"""
import os, json, glob

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
GEN = os.path.join(ROOT, 'src/data/generated')
ALL = os.path.join(GEN, 'all.json')
CHUNK = 45 * 1024 * 1024
BUF = 4 * 1024 * 1024

# clean old parts
for f in glob.glob(os.path.join(GEN, 'all.json.part-*')):
    os.remove(f)

total = os.path.getsize(ALL)
parts = []
idx = 0
written = 0
out = None


def open_part():
    global out, idx, written
    name = f'all.json.part-{idx:03d}'
    parts.append(name)
    out = open(os.path.join(GEN, name), 'wb')
    written = 0


open_part()
with open(ALL, 'rb') as f:
    while True:
        need = min(BUF, CHUNK - written)
        data = f.read(need)
        if not data:
            break
        out.write(data)
        written += len(data)
        if written >= CHUNK:
            out.close()
            idx += 1
            open_part()
out.close()

# drop a trailing empty part if the file ended exactly on a boundary
last = os.path.join(GEN, parts[-1])
if os.path.getsize(last) == 0 and len(parts) > 1:
    os.remove(last)
    parts.pop()

json.dump({'parts': parts, 'bytes': total},
          open(os.path.join(GEN, 'all.json.parts.json'), 'w'), indent=2)
print(f'[split] all.json ({total} bytes) -> {len(parts)} parts: ' + ', '.join(parts))
