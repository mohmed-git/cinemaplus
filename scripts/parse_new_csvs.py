"""
Phase 1: parse the two NEW server CSVs into a compact JSON payload that the
streaming merge step consumes. Groups by work, then (for series) by season+episode.

Column mapping (per the user's spec):
  series_with_servers_all.csv:
    0 series_title | 1 season | 2 episode | 3 watch_url(IGNORE) |
    4 series_vid(IGNORE) | 5 episode_title | 6.. server URLs
  result.csv (movies):
    0 title | 1 watch_url(IGNORE) | 2 vid(IGNORE) | 3 duration(IGNORE) |
    4 poster(IGNORE for merge) | 5.. server URLs

Output: scripts/_new_servers.json  ->
  { "works": [ {
       raw_title, kind, clean_title, english, year, is_arabic,
       is_movie, movie_servers:[url...],
       episodes:[ {season, episode, title, servers:[url...]} ]
    } ... ] }
"""
import csv, json, os, sys, re
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from ingest_helpers import (
    csv_kind, clean_csv_title, extract_english_title, extract_year,
    is_arabic_title,
)

BASE = '/home/user/uploaded_files'
SERIES_CSV = os.path.join(BASE, 'series_with_servers_all.csv')
MOVIES_CSV = os.path.join(BASE, 'result.csv')
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '_new_servers.json')

csv.field_size_limit(10 * 1024 * 1024)


def clean_urls(cells):
    out = []
    seen = set()
    for c in cells:
        u = (c or '').strip()
        if not u or not u.lower().startswith('http'):
            continue
        if u in seen:
            continue
        seen.add(u)
        out.append(u)
    return out


def base_meta(raw_title):
    return {
        'raw_title': raw_title,
        'kind': csv_kind(raw_title),
        'clean_title': clean_csv_title(raw_title),
        'english': extract_english_title(raw_title),
        'year': extract_year(raw_title),
        'is_arabic': is_arabic_title(raw_title),
    }


def parse_series():
    works = {}  # raw_title -> work
    with open(SERIES_CSV, encoding='utf-8') as f:
        r = csv.reader(f)
        next(r, None)
        for row in r:
            if not row or not row[0].strip():
                continue
            raw = row[0].strip()
            try:
                season = int(re.sub(r'[^0-9]', '', row[1]) or '1')
            except Exception:
                season = 1
            try:
                episode = int(re.sub(r'[^0-9]', '', row[2]) or '1')
            except Exception:
                episode = 1
            ep_title = (row[5].strip() if len(row) > 5 else '') or None
            servers = clean_urls(row[6:]) if len(row) > 6 else []
            if not servers:
                continue
            w = works.get(raw)
            if not w:
                w = base_meta(raw)
                w['is_movie'] = False
                w['movie_servers'] = []
                w['_eps'] = {}   # (s,e) -> ep
                works[raw] = w
            key = (season, episode)
            ep = w['_eps'].get(key)
            if not ep:
                ep = {'season': season, 'episode': episode,
                      'title': ep_title, 'servers': []}
                w['_eps'][key] = ep
            for u in servers:
                if u not in ep['servers']:
                    ep['servers'].append(u)
    # finalise
    for w in works.values():
        eps = sorted(w.pop('_eps').values(),
                     key=lambda e: (e['season'], e['episode']))
        w['episodes'] = eps
    return list(works.values())


def parse_movies():
    works = {}
    with open(MOVIES_CSV, encoding='utf-8') as f:
        r = csv.reader(f)
        next(r, None)
        for row in r:
            if not row or not row[0].strip():
                continue
            raw = row[0].strip()
            servers = clean_urls(row[5:]) if len(row) > 5 else []
            if not servers:
                continue
            w = works.get(raw)
            if not w:
                w = base_meta(raw)
                w['kind'] = 'movie'
                w['is_movie'] = True
                w['movie_servers'] = []
                w['episodes'] = []
                works[raw] = w
            for u in servers:
                if u not in w['movie_servers']:
                    w['movie_servers'].append(u)
    return list(works.values())


def main():
    series = parse_series()
    movies = parse_movies()
    works = series + movies
    total_srv = 0
    for w in works:
        if w['is_movie']:
            total_srv += len(w['movie_servers'])
        else:
            total_srv += sum(len(e['servers']) for e in w['episodes'])
    payload = {'works': works}
    with open(OUT, 'w', encoding='utf-8') as f:
        json.dump(payload, f, ensure_ascii=False)
    ar = sum(1 for w in works if w['is_arabic'])
    print(f'series works : {len(series)}')
    print(f'movie works  : {len(movies)}')
    print(f'total works  : {len(works)}  (arabic-only: {ar})')
    print(f'total server links parsed: {total_srv}')
    print(f'wrote {OUT}')
    # small sample
    for w in works[:3]:
        print('  sample:', w['kind'], '|', repr(w['clean_title']),
              '| en=', w['english'], '| yr=', w['year'],
              '| eps=', len(w['episodes']), '| movsrv=', len(w['movie_servers']))


if __name__ == '__main__':
    main()
