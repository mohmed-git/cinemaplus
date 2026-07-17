#!/usr/bin/env python3
"""
Stage 1.5: shard the lean grouped works into small on-disk buckets keyed by a
2-hex prefix of a hash of norm_key. STREAMING both read (ijson) and write, so
peak memory stays tiny (one work at a time + open file handles).

Output: scripts/data/tc-shards/<hh>.jsonl   (one JSON work per line)
Each line already carries its match key as "_k" = "<category>::<normKey>".
"""
import ijson, json, os, re, hashlib

HERE = os.path.dirname(__file__)
LEAN = os.path.join(HERE, "data", "topcinemaa-grouped-lean.json")
OUTDIR = os.path.join(HERE, "data", "tc-shards")

NOISE_PREFIXES = [
    re.compile(r"^a\s+marvel\s+television\s+special\s+presentation\s*[\u2013:\-]\s*", re.I),
    re.compile(r"^marvel\s+studios[\u2019']?\s*", re.I),
    re.compile(r"^a\s+netflix\s+(original\s+)?(film|series|movie|event)\s*[\u2013:\-]\s*", re.I),
    re.compile(r"^dc\s+studios?\s*[\u2013:\-]\s*", re.I),
    re.compile(r"^special\s+presentation\s*[\u2013:\-]\s*", re.I),
]
DIACRITICS = re.compile(r"[\u064B-\u065F\u0670]")
YEAR_RE = re.compile(r"\b(19|20)\d{2}\b")
ARABIC_WRAPPERS = re.compile(r"\b(\u0645\u062a\u0631\u062c\u0645|\u0645\u062a\u0631\u062c\u0645\u0629|\u0627\u0648\u0646\u0644\u0627\u064a\u0646|\u0645\u0634\u0627\u0647\u062f\u0629|\u062a\u062d\u0645\u064a\u0644|\u0643\u0627\u0645\u0644|\u0643\u0627\u0645\u0644\u0629|\u0627\u0644\u0645\u0648\u0633\u0645|\u0627\u0644\u062d\u0644\u0642\u0629|\u0648\u0627\u0644\u0627\u062e\u064a\u0631\u0629|\u0627\u0644\u0627\u062e\u064a\u0631\u0629)\b")
NONWORD = re.compile(r"[^0-9a-z\u0600-\u06FF]+")

def norm_key(name):
    s = name or ""
    for r in NOISE_PREFIXES:
        s = r.sub("", s)
    s = s.strip().lower()
    s = YEAR_RE.sub(" ", s)
    s = DIACRITICS.sub("", s)
    s = re.sub(r"[\u0625\u0623\u0622\u0627]", "\u0627", s)
    s = s.replace("\u0649", "\u064a").replace("\u0629", "\u0647")
    s = ARABIC_WRAPPERS.sub(" ", s)
    s = NONWORD.sub(" ", s)
    return re.sub(r"\s+", " ", s).strip()

def shard_of(key):
    return hashlib.md5(key.encode("utf-8")).hexdigest()[:2]

def main():
    os.makedirs(OUTDIR, exist_ok=True)
    # open 256 shard files lazily
    handles = {}
    n = 0
    with open(LEAN, "rb") as f:
        for w in ijson.items(f, "item"):
            key = f"{w['c']}::{norm_key(w['n'])}"
            w["_k"] = key
            hh = shard_of(key)
            h = handles.get(hh)
            if h is None:
                h = open(os.path.join(OUTDIR, f"{hh}.jsonl"), "w", encoding="utf-8")
                handles[hh] = h
            h.write(json.dumps(w, ensure_ascii=False))
            h.write("\n")
            n += 1
            if n % 1000 == 0:
                print(f"[shard] {n}", flush=True)
    for h in handles.values():
        h.close()
    print(f"[shard] DONE {n} works into {len(handles)} shard files", flush=True)

if __name__ == "__main__":
    main()
