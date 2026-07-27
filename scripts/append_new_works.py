"""
Phase 4c: append the freshly built new titles (_built_new.json) to all.json.

Low-RAM safe: streams the existing all.json through, collecting used slugs, then
appends the new titles (with slug de-dup) — all written to a temp file and
os.replace'd, so the 140MB+ array is never fully in memory.
"""
import os, sys, json
from decimal import Decimal
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import ijson

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
ALL = os.path.join(ROOT, 'src/data/generated/all.json')
ALL_TMP = ALL + '.tmp'
BUILT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '_built_new.json')


def _default(o):
    if isinstance(o, Decimal):
        return int(o) if o == o.to_integral_value() else float(o)
    raise TypeError(str(type(o)))


def dumps(obj):
    return json.dumps(obj, ensure_ascii=False, default=_default)


def main():
    built = json.load(open(BUILT, encoding='utf-8'))
    print(f'[append] new titles to add: {len(built)}')

    used = set()
    kept = 0
    out = open(ALL_TMP, 'w', encoding='utf-8')
    out.write('[')
    first = True
    # 1) stream existing titles through, record slugs
    with open(ALL, 'rb') as f:
        for t in ijson.items(f, 'item'):
            s = t.get('slug')
            if s:
                used.add(s)
            if not first:
                out.write(',')
            first = False
            out.write(dumps(t))
            kept += 1
            if kept % 3000 == 0:
                print(f'  passed {kept} existing …', flush=True)
    # 2) append new titles with unique slugs
    added = 0
    for t in built:
        base = t['slug']
        slug = base
        n = 2
        while slug in used:
            slug = f'{base}-{n}'
            n += 1
        used.add(slug)
        t['slug'] = slug
        t['url'] = f"/{t['category']}/{slug}"
        if not first:
            out.write(',')
        first = False
        out.write(dumps(t))
        added += 1
    out.write(']')
    out.close()
    os.replace(ALL_TMP, ALL)
    print(f'[append] existing kept={kept} | new appended={added} | total={kept + added}')


if __name__ == '__main__':
    main()
