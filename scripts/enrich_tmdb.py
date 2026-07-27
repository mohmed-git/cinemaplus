"""
Phase 4b: TMDB-enrich the prepared new-works.json and build full Title objects
(same schema the site uses, ported from scripts/enrich-tmdb.mjs buildTitle).

- Resumable via tmdb-cache.json (keyed by work name). Re-runs skip cached works.
- Concurrency via a small thread pool; retries on HTTP 429.
- Writes built titles to scripts/_built_new.json (NOT all.json) so the append
  step can stream them into all.json without loading the 140MB file in RAM.

Env:
  TMDB_TOKEN  (v4 read token) required
  LIMIT=N     enrich at most N still-uncached works (0 = all)
"""
import os, sys, json, time, urllib.request, urllib.parse
from concurrent.futures import ThreadPoolExecutor
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from ingest_helpers import make_slug, extract_english_title, is_adult, strip_season_suffix

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.join(HERE, '..')
NEW_WORKS = os.path.join(ROOT, 'src/data/generated/new-works.json')
CACHE = os.path.join(ROOT, 'src/data/generated/tmdb-cache-new.json')
BUILT = os.path.join(HERE, '_built_new.json')

TOKEN = os.environ.get('TMDB_TOKEN')
if not TOKEN:
    print('TMDB_TOKEN required'); sys.exit(1)
LIMIT = int(os.environ.get('LIMIT', '0'))

IMG = 'https://image.tmdb.org/t/p/w500'


def _get(path, params):
    params = {k: v for k, v in params.items() if v is not None}
    params['language'] = 'ar'
    url = f'https://api.themoviedb.org/3/{path}?' + urllib.parse.urlencode(params)
    for attempt in range(4):
        try:
            req = urllib.request.Request(url, headers={'Authorization': f'Bearer {TOKEN}'})
            with urllib.request.urlopen(req, timeout=20) as r:
                if r.status == 429:
                    time.sleep(1 * (attempt + 1)); continue
                return json.load(r)
        except urllib.error.HTTPError as e:
            if e.code == 429:
                time.sleep(1 * (attempt + 1)); continue
            if e.code == 404:
                return None
            time.sleep(0.5 * (attempt + 1))
        except Exception:
            time.sleep(0.5 * (attempt + 1))
    return None


def lookup(work):
    q = work.get('englishTitle') or extract_english_title(work['name']) or work['name']
    kind = 'movie' if work['isMovie'] else 'tv'
    year = work.get('year')
    search = _get(f'search/{kind}', {'query': q, 'year': year})
    if not (search and search.get('results')):
        search = _get(f'search/{kind}', {'query': q})
    if not (search and search.get('results')):
        # try season-stripped english
        q2 = strip_season_suffix(q)
        if q2 and q2 != q:
            search = _get(f'search/{kind}', {'query': q2})
    if not (search and search.get('results')) and q != work['name']:
        search = _get(f'search/{kind}', {'query': work['name']})
    results = (search or {}).get('results') or []
    if not results:
        return None
    hit = results[0]
    details = _get(f'{kind}/{hit["id"]}', {}) or {}
    genres = [g['name'] for g in (details.get('genres') or []) if g.get('name')]
    countries = details.get('production_countries') or []
    country = countries[0]['name'] if countries else None
    yr = (hit.get('release_date') or hit.get('first_air_date') or '')[:4] or year
    return {
        'tmdb_id': hit['id'],
        'poster': IMG + hit['poster_path'] if hit.get('poster_path') else None,
        'backdrop': IMG + hit['backdrop_path'] if hit.get('backdrop_path') else None,
        'story': (hit.get('overview') or details.get('overview') or '').strip() or None,
        'rating': hit.get('vote_average') or 0,
        'votes': hit.get('vote_count') or 0,
        'year': yr or None,
        'genre': '، '.join(genres) or None,
        'country': country,
        'original_title': hit.get('original_title') or hit.get('original_name'),
        'runtime': details.get('runtime') or (details.get('episode_run_time') or [None])[0],
        'adult': hit.get('adult') is True or details.get('adult') is True,
    }


def build_title(work, meta):
    slug_base = make_slug(work['name'])
    category = work['category']
    cat_label = 'فيلم' if category == 'movie' else ('أنمي' if category == 'anime' else 'مسلسل')

    if work['isMovie']:
        seasons = [{
            'season': 1, 'episodes_count': 1,
            'episodes': [{
                'episode': 1, 'title': work['name'],
                'servers': [{'id': i + 1, 'label': s['label'], 'url': s['url']}
                            for i, s in enumerate(work.get('movieServers') or [])],
            }],
        }]
    else:
        by_season = {}
        for ep in work.get('episodes') or []:
            by_season.setdefault(ep['season'], []).append(ep)
        seasons = []
        for sn in sorted(by_season):
            eps = sorted(by_season[sn], key=lambda e: e['episode'])
            seasons.append({
                'season': sn, 'episodes_count': len(eps),
                'episodes': [{
                    'episode': e['episode'],
                    'title': e.get('title') or f"الحلقة {e['episode']}",
                    'servers': [{'id': i + 1, 'label': s['label'], 'url': s['url']}
                                for i, s in enumerate(e.get('servers') or [])],
                } for e in eps],
            })
    episodes_count = sum(len(s['episodes']) for s in seasons)
    year = (meta or {}).get('year') or work.get('year')

    fallback_poster = 'https://placehold.co/500x750/0f172a/06b6d4?text=' + \
        urllib.parse.quote((work.get('englishTitle') or work['name'])[:24])
    poster = (meta or {}).get('poster') or fallback_poster
    story = (meta or {}).get('story') or \
        f"شاهد {work['name']} مترجم اون لاين بجودة عالية على سينما بلس مع روابط مشاهدة مباشرة سريعة."
    sort_recent = int(time.mktime(time.strptime(f'{year}-01-01', '%Y-%m-%d'))) * 1000 if year else 0

    return {
        'slug': slug_base,
        'clean_title': work['name'],
        'raw_name': work['name'],
        'category': category,
        'category_label': cat_label,
        'subcategory': work['sub'],
        'subcategory_label': work['subLabel'],
        'is_new': True,
        'poster': poster,
        'note': None,
        'matched_poster': bool((meta or {}).get('poster')),
        'seasons_count': len(seasons),
        'episodes_count': episodes_count,
        'seasons': seasons,
        'description': story,
        'url': f'/{category}/{slug_base}',
        'story': story,
        'year': str(year) if year else None,
        'quality': 'HD',
        'duration': f"{meta['runtime']} دقيقة" if (meta or {}).get('runtime') else None,
        'language': 'مترجم',
        'country': (meta or {}).get('country'),
        'director': None,
        'stars': None,
        'genre': (meta or {}).get('genre'),
        'trailerId': None,
        'rating': (meta or {}).get('rating') or None,
        'imdb_rating': None,
        'tmdb_id': (meta or {}).get('tmdb_id'),
        'tmdb_url': (f"https://www.themoviedb.org/{'movie' if work['isMovie'] else 'tv'}/{meta['tmdb_id']}"
                     if (meta or {}).get('tmdb_id') else None),
        'original_title': (meta or {}).get('original_title'),
        'tmdb_vote': (meta or {}).get('rating') or 0,
        'tmdb_votes': (meta or {}).get('votes') or 0,
        'release_date': f'{year}-01-01' if year else None,
        'sort_rating': (meta or {}).get('rating') or 0,
        'sort_recent': sort_recent,
        'real_plot': bool((meta or {}).get('story')),
        'is_special': False,
        'backdrop_path': (meta or {}).get('backdrop'),
        'adult': is_adult(
            name=f"{work['name']} {(meta or {}).get('original_title') or ''}",
            genre=(meta or {}).get('genre') or '',
            adult=(meta or {}).get('adult') is True,
        ),
    }


def main():
    works = json.load(open(NEW_WORKS, encoding='utf-8'))
    cache = json.load(open(CACHE, encoding='utf-8')) if os.path.exists(CACHE) else {}

    todo = [w for w in works if w['name'] not in cache]
    if LIMIT > 0:
        todo = todo[:LIMIT]
    print(f'[tmdb] new works: {len(works)} | cached: {len(cache)} | fetching now: {len(todo)}', flush=True)

    done = 0
    def fetch(w):
        nonlocal done
        meta = lookup(w)
        cache[w['name']] = meta or {'_miss': True}
        done += 1

    with ThreadPoolExecutor(max_workers=10) as ex:
        futures = [ex.submit(fetch, w) for w in todo]
        for i, f in enumerate(futures):
            f.result()
            if (i + 1) % 100 == 0:
                json.dump(cache, open(CACHE, 'w', encoding='utf-8'), ensure_ascii=False)
                print(f'[tmdb] enriched {i + 1}/{len(todo)} (cache saved)', flush=True)
    json.dump(cache, open(CACHE, 'w', encoding='utf-8'), ensure_ascii=False)

    # build all titles (enriched or fallback)
    built = []
    enriched = 0
    for w in works:
        meta = cache.get(w['name'])
        meta = meta if (meta and not meta.get('_miss')) else None
        if meta:
            enriched += 1
        built.append(build_title(w, meta))
    json.dump(built, open(BUILT, 'w', encoding='utf-8'), ensure_ascii=False)
    print(f'[tmdb] built {len(built)} titles ({enriched} TMDB-enriched, '
          f'{len(built) - enriched} fallback) -> _built_new.json', flush=True)


if __name__ == '__main__':
    main()
