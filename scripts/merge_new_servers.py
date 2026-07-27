"""
Phase 3: MERGE the new CSV servers into the EXISTING catalogue works.

Low-RAM safe: streams all.json (140MB) with ijson and writes a NEW all.json
incrementally (never holds the whole array in memory). For every matched work
the new server URLs are appended to the SAME episode/movie's server list
(deduped by URL) — i.e. they sit *between* the existing servers of that
film/series, exactly as requested. Missing seasons/episodes on an existing
series are created so a CSV that adds a brand-new season to an existing show
still lands.

Inputs:
  scripts/_new_servers.json   (parsed CSV works)
  scripts/_match_result.json  (raw_title -> slug decisions)
Outputs:
  src/data/generated/all.json           (rewritten, servers merged)
  scripts/_merge_stats.json             (counters)
"""
import os, sys, json
from decimal import Decimal
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import ijson
from ingest_helpers import server_label


def _json_default(o):
    """ijson yields numbers as Decimal; serialise back as int when whole."""
    if isinstance(o, Decimal):
        return int(o) if o == o.to_integral_value() else float(o)
    raise TypeError(f'not serializable: {type(o).__name__}')


def dumps(obj):
    return json.dumps(obj, ensure_ascii=False, default=_json_default)

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
ALL = os.path.join(ROOT, 'src/data/generated/all.json')
ALL_TMP = ALL + '.tmp'
NEW = os.path.join(os.path.dirname(os.path.abspath(__file__)), '_new_servers.json')
MATCH = os.path.join(os.path.dirname(os.path.abspath(__file__)), '_match_result.json')
STATS = os.path.join(os.path.dirname(os.path.abspath(__file__)), '_merge_stats.json')


def build_merge_map():
    new_works = json.load(open(NEW, encoding='utf-8'))['works']
    by_raw = {w['raw_title']: w for w in new_works}
    matched = json.load(open(MATCH, encoding='utf-8'))['matched']
    # slug -> list of csv works to merge into it
    slug_to_works = {}
    for m in matched:
        w = by_raw.get(m['raw'])
        if not w:
            continue
        slug_to_works.setdefault(m['slug'], []).append(w)
    return slug_to_works


def max_id(title):
    mx = 0
    for s in title.get('seasons') or []:
        for e in s.get('episodes') or []:
            for sv in e.get('servers') or []:
                sid = sv.get('id')
                try:
                    sid = int(sid)
                except (TypeError, ValueError):
                    continue
                if sid > mx:
                    mx = sid
    return mx


def merge_into(title, works, stats):
    """Mutate `title` in place, appending new servers. Returns servers added."""
    added = 0
    next_id = max_id(title) + 1

    is_movie = title.get('category') == 'movie'
    if is_movie:
        # ensure a season/episode container exists
        seasons = title.setdefault('seasons', [])
        if not seasons:
            seasons.append({'season': 1, 'episodes_count': 1, 'episodes': []})
        s0 = seasons[0]
        eps = s0.setdefault('episodes', [])
        if not eps:
            eps.append({'episode': 1, 'title': title.get('clean_title') or 'الفيلم', 'servers': []})
        ep = eps[0]
        existing = {sv.get('url') for sv in ep.get('servers') or []}
        for w in works:
            for url in w.get('movie_servers') or []:
                if url in existing:
                    continue
                ep.setdefault('servers', []).append(
                    {'id': next_id, 'label': server_label(url), 'url': url, '_added': True})
                existing.add(url)
                next_id += 1
                added += 1
    else:
        # series / anime: index existing seasons+episodes.
        # ijson yields season/episode numbers as Decimal, so coerce to int for
        # dict keys to match the CSV ints.
        seasons = title.setdefault('seasons', [])
        def _int(x, d=0):
            try:
                return int(x)
            except (TypeError, ValueError):
                return d
        smap = {_int(s.get('season')): s for s in seasons}
        for w in works:
            for csv_ep in w.get('episodes') or []:
                sn = csv_ep['season']
                en = csv_ep['episode']
                season = smap.get(sn)
                if not season:
                    season = {'season': sn, 'episodes_count': 0, 'episodes': []}
                    seasons.append(season)
                    smap[sn] = season
                    stats['seasons_created'] += 1
                emap = {_int(e.get('episode')): e for e in season.setdefault('episodes', [])}
                ep = emap.get(en)
                if not ep:
                    ep = {'episode': en, 'title': csv_ep.get('title') or f'الحلقة {en}',
                          'servers': []}
                    season['episodes'].append(ep)
                    stats['episodes_created'] += 1
                existing = {sv.get('url') for sv in ep.get('servers') or []}
                for url in csv_ep.get('servers') or []:
                    if url in existing:
                        continue
                    ep.setdefault('servers', []).append(
                        {'id': next_id, 'label': server_label(url), 'url': url, '_added': True})
                    existing.add(url)
                    next_id += 1
                    added += 1
        # recompute counts
        for s in seasons:
            s['episodes_count'] = len(s.get('episodes') or [])
            s['episodes'].sort(key=lambda e: e.get('episode') or 0)
        seasons.sort(key=lambda s: s.get('season') or 0)
        title['seasons_count'] = len(seasons)
        title['episodes_count'] = sum(len(s.get('episodes') or []) for s in seasons)
    return added


def main():
    slug_to_works = build_merge_map()
    print(f'[merge] slugs to update: {len(slug_to_works)}')
    stats = {'titles_scanned': 0, 'titles_updated': 0, 'servers_added': 0,
             'seasons_created': 0, 'episodes_created': 0, 'slugs_hit': 0}
    hit_slugs = set()

    out = open(ALL_TMP, 'w', encoding='utf-8')
    out.write('[')
    first = True
    with open(ALL, 'rb') as f:
        for t in ijson.items(f, 'item'):
            stats['titles_scanned'] += 1
            slug = t.get('slug')
            works = slug_to_works.get(slug)
            if works:
                added = merge_into(t, works, stats)
                if added:
                    stats['titles_updated'] += 1
                    stats['servers_added'] += added
                hit_slugs.add(slug)
            if not first:
                out.write(',')
            first = False
            out.write(dumps(t))
            if stats['titles_scanned'] % 2000 == 0:
                print(f"  scanned {stats['titles_scanned']} | updated {stats['titles_updated']} | +{stats['servers_added']} servers", flush=True)
    out.write(']')
    out.close()
    stats['slugs_hit'] = len(hit_slugs)
    stats['slugs_missing'] = sorted(set(slug_to_works) - hit_slugs)[:20]
    stats['slugs_missing_count'] = len(set(slug_to_works) - hit_slugs)

    os.replace(ALL_TMP, ALL)
    json.dump(stats, open(STATS, 'w', encoding='utf-8'), ensure_ascii=False, indent=2)
    print(f"[merge] DONE scanned={stats['titles_scanned']} updated={stats['titles_updated']} "
          f"servers_added={stats['servers_added']} seasons_created={stats['seasons_created']} "
          f"episodes_created={stats['episodes_created']} slugs_missing={stats['slugs_missing_count']}")


if __name__ == '__main__':
    main()
