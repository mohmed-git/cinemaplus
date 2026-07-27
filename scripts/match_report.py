"""
Phase 2b: match parsed CSV works (_new_servers.json) against the all.json index
(_match_index.json). Reports matched vs unmatched, and writes the decision
(slug to merge into, OR mark as new) to scripts/_match_result.json.

Matching rules:
  1. try name_key(clean_title)  (full cleaned Arabic+English title)
  2. try name_key(english)       (English chunk only)
  For each candidate key -> list of existing entries. Choose the best entry:
    - prefer same media kind (anime/series/movie), treating anime<->series as
      compatible (site sometimes files anime under series and vice-versa).
"""
import os, sys, json
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from ingest_helpers import match_keys

HERE = os.path.dirname(os.path.abspath(__file__))
NEW = os.path.join(HERE, '_new_servers.json')
IDX = os.path.join(HERE, '_match_index.json')
OUT = os.path.join(HERE, '_match_result.json')


def kind_compatible(csv_kind, cat):
    if csv_kind == 'movie':
        return cat == 'movie'
    # series or anime  -> match series/anime, never movie
    return cat in ('series', 'anime')


def main():
    new = json.load(open(NEW, encoding='utf-8'))['works']
    idx = json.load(open(IDX, encoding='utf-8'))
    entries = idx['entries']
    k2i = idx['key_to_idx']

    matched, unmatched = [], []
    for w in new:
        cand_keys = list(match_keys(w.get('clean_title'), w.get('english')))

        chosen = None
        for key in cand_keys:
            hits = k2i.get(key)
            if not hits:
                continue
            # prefer kind-compatible entry
            compat = [h for h in hits if kind_compatible(w['kind'], entries[h]['category'])]
            pool = compat or hits
            chosen = entries[pool[0]]
            break

        if chosen:
            matched.append({'raw': w['raw_title'], 'slug': chosen['slug'],
                            'cat': chosen['category'], 'kind': w['kind']})
        else:
            unmatched.append({'raw': w['raw_title'], 'kind': w['kind'],
                              'english': w.get('english'),
                              'is_arabic': w['is_arabic']})

    json.dump({'matched': matched, 'unmatched': unmatched},
              open(OUT, 'w', encoding='utf-8'), ensure_ascii=False)

    tot = len(new)
    m = len(matched)
    ua = sum(1 for u in unmatched if u['is_arabic'])
    un = len(unmatched) - ua
    print(f'total CSV works : {tot}')
    print(f'MATCHED         : {m}  ({m*100//tot}%)')
    print(f'UNMATCHED       : {len(unmatched)}  (arabic-only: {ua}, non-arabic: {un})')
    print('--- sample UNMATCHED non-arabic (candidates for TMDB create) ---')
    shown = 0
    for u in unmatched:
        if not u['is_arabic']:
            print('   ', u['kind'], '|', repr(u['english']), '|', u['raw'][:60])
            shown += 1
            if shown >= 25:
                break


if __name__ == '__main__':
    main()
