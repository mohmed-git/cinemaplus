#!/usr/bin/env python3
"""
Append the built topcinemaa new titles (topcinemaa-new-built.json) into all.json
WITHOUT disturbing any existing work (old catalogue + previously-added is_new).

Memory-safe:
  · Pass 1: stream all.json, collect existing slugs (strings only).
  · Load built titles (smaller file), assign unique slugs (suffix -2, -3 ... on
    collision), skip any whose slug already exists as an exact duplicate work
    (defensive; normally none).
  · Pass 2: stream all.json titles straight through to all.json.tmp, then write
    the new built titles, close the array, os.replace().
"""
import json, os
from decimal import Decimal
import ijson

HERE = os.path.dirname(__file__)
ROOT = os.path.join(HERE, "..")
ALL = os.path.join(ROOT, "src", "data", "generated", "all.json")
ALL_TMP = ALL + ".tmp"
BUILT = os.path.join(ROOT, "src", "data", "generated", "topcinemaa-new-built.json")

def _default(o):
    if isinstance(o, Decimal):
        i = int(o)
        return i if o == i else float(o)
    raise TypeError(f"{o.__class__.__name__} not serializable")

def dumps(o):
    return json.dumps(o, ensure_ascii=False, default=_default)

def main():
    print("[append] pass 1: collect existing slugs …", flush=True)
    slugs = set()
    n_existing = 0
    with open(ALL, "rb") as f:
        for t in ijson.items(f, "item"):
            s = t.get("slug")
            if s:
                slugs.add(s)
            n_existing += 1
    print(f"[append]   existing titles: {n_existing}  (unique slugs {len(slugs)})", flush=True)

    print("[append] loading built new titles …", flush=True)
    built = json.load(open(BUILT, encoding="utf-8"))
    print(f"[append]   built titles: {len(built)}", flush=True)

    # assign unique slugs
    for t in built:
        base = t.get("slug") or "title"
        slug = base
        k = 2
        while slug in slugs:
            slug = f"{base}-{k}"
            k += 1
        slugs.add(slug)
        t["slug"] = slug
        t["url"] = f"/{t.get('category')}/{slug}"

    print("[append] pass 2: stream all.json + append new → tmp …", flush=True)
    written = 0
    with open(ALL, "rb") as fin, open(ALL_TMP, "w", encoding="utf-8") as out:
        out.write("[")
        first = True
        for t in ijson.items(fin, "item"):
            if not first:
                out.write(",")
            out.write(dumps(t))
            first = False
            written += 1
        for t in built:
            if not first:
                out.write(",")
            out.write(dumps(t))
            first = False
            written += 1
        out.write("]")
    os.replace(ALL_TMP, ALL)
    print(f"[append] DONE — all.json now has {written} titles "
          f"({n_existing} existing + {len(built)} new topcinemaa)", flush=True)

if __name__ == "__main__":
    main()
