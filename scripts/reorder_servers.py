"""
Reorder every episode/movie server list so that:
  1. the newly-added CSV servers (flagged `_added: True`) come FIRST, keeping
     the order they were appended in (== CSV order),
  2. then the `megatuktuk - HD` server(s),
  3. then all the remaining existing servers, untouched in their original order.

Low-RAM safe: streams all.json (164MB) with ijson and writes a NEW all.json
incrementally (never holds the whole array in memory).

The `id` field of each server is reassigned 1..N to reflect the new order so
the frontend renders them in sequence. The `_added` flag is left in place
(harmless; used to identify new servers on any future re-run).
"""
import os, sys, json
from decimal import Decimal
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import ijson


def _json_default(o):
    if isinstance(o, Decimal):
        return int(o) if o == o.to_integral_value() else float(o)
    raise TypeError(f'not serializable: {type(o).__name__}')


def dumps(obj):
    return json.dumps(obj, ensure_ascii=False, default=_json_default)


ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
ALL = os.path.join(ROOT, 'src/data/generated/all.json')
ALL_TMP = ALL + '.tmp'

MEGA = 'megatuktuk - hd'


def is_mega(sv):
    return (sv.get('label') or '').strip().lower() == MEGA


def reorder_list(servers):
    """Return reordered list: added -> megatuktuk -> rest. Preserves original
    relative order within each group. Reassigns ids 1..N."""
    if not servers:
        return servers, False
    added = [s for s in servers if s.get('_added')]
    mega = [s for s in servers if (not s.get('_added')) and is_mega(s)]
    rest = [s for s in servers if (not s.get('_added')) and not is_mega(s)]
    new = added + mega + rest
    changed = new != servers  # identity-order comparison of same dict objects
    for i, sv in enumerate(new, start=1):
        sv['id'] = i
    return new, changed


def reorder_title(title, stats):
    touched = False
    for s in title.get('seasons') or []:
        for e in s.get('episodes') or []:
            svs = e.get('servers')
            if not svs:
                continue
            new, changed = reorder_list(svs)
            e['servers'] = new
            if changed:
                touched = True
                stats['lists_reordered'] += 1
    return touched


def main():
    stats = {'titles_scanned': 0, 'titles_touched': 0, 'lists_reordered': 0}
    out = open(ALL_TMP, 'w', encoding='utf-8')
    out.write('[')
    first = True
    with open(ALL, 'rb') as f:
        for t in ijson.items(f, 'item'):
            stats['titles_scanned'] += 1
            if reorder_title(t, stats):
                stats['titles_touched'] += 1
            if not first:
                out.write(',')
            first = False
            out.write(dumps(t))
            if stats['titles_scanned'] % 2000 == 0:
                print(f"  scanned {stats['titles_scanned']} | touched {stats['titles_touched']} | lists {stats['lists_reordered']}", flush=True)
    out.write(']')
    out.close()
    os.replace(ALL_TMP, ALL)
    print(f"[reorder] DONE scanned={stats['titles_scanned']} "
          f"titles_touched={stats['titles_touched']} "
          f"lists_reordered={stats['lists_reordered']}")


if __name__ == '__main__':
    main()
