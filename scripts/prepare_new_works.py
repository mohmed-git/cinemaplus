"""
Phase 4a: turn the UNMATCHED CSV works into the `new-works.json` shape expected
by scripts/enrich-tmdb.mjs, so they can be TMDB-enriched and appended to
all.json as brand-new titles.

Each new work carries:
  name, englishTitle, category, sub, subLabel, year, isMovie,
  movieServers:[{url,label}], episodes:[{season,episode,title,servers:[{url,label}]}]

Sub-category is a sensible default (anime / foreign-*) since the CSV does not
carry the netflix/asian/turkish grouping; TMDB country can refine later but the
site renders fine with the default.
"""
import os, sys, json
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from ingest_helpers import server_label, is_adult, extract_english_title

HERE = os.path.dirname(os.path.abspath(__file__))
NEW = os.path.join(HERE, '_new_servers.json')
MATCH = os.path.join(HERE, '_match_result.json')
OUT = os.path.join(HERE, '..', 'src/data/generated/new-works.json')

SUB = {
    'anime':  ('anime',          'أنمي'),
    'movie':  ('foreign-movies', 'أفلام أجنبي'),
    'series': ('foreign-series', 'مسلسلات أجنبي'),
}


def to_servers(urls):
    out, seen = [], set()
    for u in urls or []:
        if u in seen:
            continue
        seen.add(u)
        out.append({'url': u, 'label': server_label(u)})
    return out


def main():
    new_works = json.load(open(NEW, encoding='utf-8'))['works']
    by_raw = {w['raw_title']: w for w in new_works}
    unmatched = json.load(open(MATCH, encoding='utf-8'))['unmatched']

    out = []
    skipped_adult = 0
    empty = 0
    for u in unmatched:
        w = by_raw.get(u['raw'])
        if not w:
            continue
        # exclude indecent works
        if is_adult(name=w['raw_title'], title=w.get('clean_title', '')):
            skipped_adult += 1
            continue
        english = w.get('english') or extract_english_title(w['clean_title'] or '')
        # use the cleaned title as the display name (kind prefix + junk removed)
        name = w.get('clean_title') or w['raw_title']
        is_movie = w['is_movie']
        movie_servers = to_servers(w.get('movie_servers')) if is_movie else []
        episodes = []
        if not is_movie:
            for e in w.get('episodes') or []:
                episodes.append({
                    'season': e['season'],
                    'episode': e['episode'],
                    'title': e.get('title') or f"الحلقة {e['episode']}",
                    'servers': to_servers(e.get('servers')),
                })
        # drop works with no playable servers at all
        if is_movie and not movie_servers:
            empty += 1
            continue
        if not is_movie and not any(ep['servers'] for ep in episodes):
            empty += 1
            continue
        sub, sub_label = SUB[w['kind']]
        out.append({
            'name': name,
            'englishTitle': english,
            'category': w['kind'],
            'sub': sub,
            'subLabel': sub_label,
            'year': w.get('year'),
            'isMovie': is_movie,
            'movieServers': movie_servers,
            'episodes': episodes,
            '_is_arabic': w['is_arabic'],
        })

    json.dump(out, open(OUT, 'w', encoding='utf-8'), ensure_ascii=False)
    from collections import Counter
    byk = Counter(x['category'] for x in out)
    arab = sum(1 for x in out if x['_is_arabic'])
    print(f'new works prepared : {len(out)}')
    print(f'  by kind          : {dict(byk)}')
    print(f'  arabic-only      : {arab}  (will try TMDB in Arabic, fallback poster if missed)')
    print(f'  skipped adult    : {skipped_adult}')
    print(f'  skipped no-server: {empty}')
    print(f'wrote {os.path.relpath(OUT, HERE)}')


if __name__ == '__main__':
    main()
