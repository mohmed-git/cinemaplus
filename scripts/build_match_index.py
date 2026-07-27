"""
Phase 2a: stream all.json (140MB, must NOT be loaded whole on 985MB RAM) and
build a lightweight match index -> scripts/_match_index.json

For every existing title we record:
  slug, category, plus a set of normalised match keys derived from
  clean_title / raw_name / original_title / title_ar and the longest Latin chunk.

Keys are grouped so a CSV work can be matched by:
  - exact name_key of its cleaned Arabic+English title
  - name_key of just its English chunk (+ optional year)
"""
import os, sys, json
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import ijson
from ingest_helpers import match_keys

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
ALL = os.path.join(ROOT, 'src/data/generated/all.json')
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '_match_index.json')


def keys_for(title):
    return match_keys(title.get('clean_title'), title.get('raw_name'),
                      title.get('original_title'), title.get('title_ar'))


def main():
    # entries: list of {slug, category, keys:[...]}
    # also flat maps for O(1) lookup: full_key -> [idx...], but keep JSON small
    entries = []
    key_to_idx = {}      # match_key -> list of entry indices
    n = 0
    with open(ALL, 'rb') as f:
        for t in ijson.items(f, 'item'):
            idx = len(entries)
            cat = t.get('category')
            ks = keys_for(t)
            entries.append({'slug': t.get('slug'), 'category': cat})
            for k in ks:
                key_to_idx.setdefault(k, []).append(idx)
            n += 1
            if n % 2000 == 0:
                print(f'  indexed {n} …', flush=True)
    payload = {'entries': entries, 'key_to_idx': key_to_idx}
    with open(OUT, 'w', encoding='utf-8') as f:
        json.dump(payload, f, ensure_ascii=False)
    print(f'indexed {n} titles; distinct keys={len(key_to_idx)}; wrote {OUT}')


if __name__ == '__main__':
    main()
