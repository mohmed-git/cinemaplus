"""
Fix TMDB *collisions*: two (or more) DIFFERENT works that ended up sharing the
same tmdb_id / poster / story because of name similarity (e.g.
"My Dearest Assassin" vs "My Dearest Señorita" both -> tmdb 1630423).

Approach (collision-driven, very targeted — only touches works that share an id):
  1. Group is_new works that carry a *real TMDB poster* by tmdb_id.
  2. A collision = one tmdb_id shared by >=2 works whose english base names differ.
  3. For each collision, fetch the canonical TMDB record (movie then tv) to read
     its real title + original_title. Score every colliding slug against it.
       - the single best-matching slug KEEPS the id (it is the legitimate owner);
       - every other slug is re-matched: search TMDB by its OWN english title,
         verify by title-token overlap, take the best verified hit; if none is
         trustworthy, drop to a neutral placeholder poster + generic arabic story
         so two different works never again share one poster/story.
  4. Legitimate duplicates (same work, alternate spelling — both slugs match the
     same record well) are LEFT UNTOUCHED.

We ONLY rewrite metadata fields (poster, story, description, tmdb_id, ... ).
We NEVER touch: slug, url, category, seasons, episodes, servers, is_new,
  raw_name, clean_title, subcategory.

Low-RAM: streams all.json with ijson, writes a new all.json incrementally.
Env: TMDB_TOKEN (v4 read token) required.
"""
import os, sys, json, time, re, urllib.request, urllib.parse
from decimal import Decimal
from collections import defaultdict
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import ijson
from ingest_helpers import (name_key, extract_english_title, strip_season_suffix,
                            strip_parens, is_adult)

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.join(HERE, '..')
ALL = os.path.join(ROOT, 'src/data/generated/all.json')
ALL_TMP = ALL + '.tmp'
REPORT = os.path.join(HERE, '_collision_report.json')

TOKEN = os.environ.get('TMDB_TOKEN')
if not TOKEN:
    print('TMDB_TOKEN required'); sys.exit(1)
IMG = 'https://image.tmdb.org/t/p/w500'


def _json_default(o):
    if isinstance(o, Decimal):
        return int(o) if o == o.to_integral_value() else float(o)
    raise TypeError(f'not serializable: {type(o).__name__}')


def dumps(obj):
    return json.dumps(obj, ensure_ascii=False, default=_json_default)


def _get(path, params, lang='ar'):
    params = {k: v for k, v in params.items() if v is not None}
    params['language'] = lang
    url = f'https://api.themoviedb.org/3/{path}?' + urllib.parse.urlencode(params)
    for attempt in range(4):
        try:
            req = urllib.request.Request(url, headers={'Authorization': f'Bearer {TOKEN}'})
            with urllib.request.urlopen(req, timeout=20) as r:
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


def toks(s):
    return set(name_key(s or '').split())


def title_of(hit):
    return hit.get('title') or hit.get('name') or ''


def orig_of(hit):
    return hit.get('original_title') or hit.get('original_name') or ''


_YEAR_RE = re.compile(r'\b(19|20)\d{2}\b')
_ARABIC_RE = re.compile(r'[\u0600-\u06FF]')
# quality / release tags that must never be treated as a title
_QUALITY_RE = re.compile(
    r'\b(hd|fhd|uhd|sd|cam|web[\-\s]?dl|webrip|bluray|blu[\-\s]?ray|hdrip|dvdrip|'
    r'brrip|hdtv|1080p|720p|480p|4k|2160p|x264|x265|hevc|aac|مترجم|اون\s*لاين|'
    r'online|مشاهدة|كامل|جودة\s*عالية)\b', re.IGNORECASE)


def _clean_query(s):
    s = _QUALITY_RE.sub(' ', s or '')
    s = _YEAR_RE.sub(' ', s)
    s = re.sub(r'\s+', ' ', s).strip(' -–—:|.,')
    return s


def english_title_of(t):
    """Best *searchable* title for a work, plus a flag for how usable it is.
    Returns the query string. ingest's extract_english_title() truncates at the
    first non-ASCII char ("My Dearest Señorita" -> "My Dearest Se"), which breaks
    search, so we keep accented latin letters. Quality tags (HD/WEB-DL/...) and
    the year are stripped. If no usable latin remains we return the cleaned
    ARABIC title so pure-arabic works still search by their real name."""
    ct = (t.get('clean_title') or t.get('raw_name') or '').strip()
    # latin part: drop arabic runs, quality tags, year
    latin = _clean_query(_ARABIC_RE.sub(' ', ct))
    if latin and re.search(r'[A-Za-zÀ-ÿ]', latin) and len(latin) >= 3:
        return latin
    # otherwise search by the cleaned full (arabic) title
    arabic = _clean_query(ct)
    if arabic and len(arabic) >= 2:
        return arabic
    return extract_english_title(ct) or ct


def score_against(en, hit):
    """How well an english work title matches a TMDB record (0..2)."""
    want = toks(en)
    have = toks(title_of(hit)) | toks(orig_of(hit))
    if not want or not have:
        base = 0.0
    else:
        base = len(want & have) / max(1, len(want))
    exact = 1.0 if (name_key(title_of(hit)) == name_key(en) or
                    name_key(orig_of(hit)) == name_key(en)) else 0.0
    return base + exact


CAT_KIND = {'movie': 'movie', 'series': 'tv', 'anime': 'tv'}


def record_title_tokens(tid, category):
    """All title tokens for a TMDB record: title/original + alternative titles,
    across en-US and ar. Used to decide whether an undecided colliding member is
    the SAME work (shares tokens) or a genuinely different one (zero overlap)."""
    order = ['movie', 'tv'] if CAT_KIND.get(category, 'movie') == 'movie' else ['tv', 'movie']
    tok = set()
    for kind in order:
        got = False
        for lang in ('en-US', 'ar'):
            d = _get(f'{kind}/{tid}', {'append_to_response': 'alternative_titles'}, lang=lang)
            if not (d and d.get('id')):
                continue
            got = True
            tok |= toks(title_of(d)) | toks(orig_of(d))
            alt = (d.get('alternative_titles') or {})
            for a in (alt.get('titles') or alt.get('results') or []):
                tok |= toks(a.get('title') or '')
        if got:
            break
    return tok


def fetch_record(tid, category):
    """Fetch canonical TMDB record for id. Try natural kind first, then the other."""
    order = ['movie', 'tv'] if CAT_KIND.get(category, 'movie') == 'movie' else ['tv', 'movie']
    for kind in order:
        d = _get(f'{kind}/{tid}', {})
        if d and d.get('id'):
            return kind, d
    return None, None


def search(kind, q, year=None):
    # search in english so result titles are comparable to the work's english title
    r = _get(f'search/{kind}', {'query': q, 'year': year}, lang='en-US') if year else None
    if not (r and r.get('results')):
        r = _get(f'search/{kind}', {'query': q}, lang='en-US')
    return (r or {}).get('results') or []


def self_search(en, category, year):
    """Search TMDB by the work's OWN english title across likely kinds.
       Return (kind, best_hit, best_score, ids_set) where ids_set is the set of
       all result ids across the kinds searched (for self-ownership checks)."""
    kinds = ['movie', 'tv'] if CAT_KIND.get(category, 'movie') == 'movie' else ['tv', 'movie']
    best = None; best_kind = None; best_score = -1; ids = set()
    q = en
    for kind in kinds:
        results = search(kind, q, year)
        if not results:
            q2 = strip_season_suffix(strip_parens(q))
            if q2 and q2 != q:
                results = search(kind, q2, year)
        for r in results[:10]:
            ids.add(int(r['id']))
            s = score_against(en, r)
            if s > best_score:
                best_score = s; best = r; best_kind = kind
    return best_kind, best, best_score, ids


def details_for(kind, hit_id, d=None):
    d = d if d is not None else (_get(f'{kind}/{hit_id}', {}) or {})
    genres = [g['name'] for g in (d.get('genres') or []) if g.get('name')]
    countries = d.get('production_countries') or []
    country = countries[0]['name'] if countries else None
    return {
        'genre': '، '.join(genres) or None,
        'country': country,
        'runtime': d.get('runtime') or (d.get('episode_run_time') or [None])[0],
        'adult': d.get('adult') is True,
    }


def apply_fix(t, kind, hit):
    """Rewrite ONLY metadata from a verified TMDB hit. Servers/seasons untouched.
    The `hit` came from an en-US search (english titles); fetch the full record in
    Arabic for the localized story/poster/title."""
    ar = _get(f'{kind}/{hit["id"]}', {}, lang='ar') or {}   # arabic detail
    det = details_for(kind, hit['id'], ar)
    poster_path = ar.get('poster_path') or hit.get('poster_path')
    backdrop_path = ar.get('backdrop_path') or hit.get('backdrop_path')
    poster = IMG + poster_path if poster_path else None
    backdrop = IMG + backdrop_path if backdrop_path else None
    story = (ar.get('overview') or hit.get('overview') or '').strip() or None
    ar_title = ar.get('title') or ar.get('name') or title_of(hit)
    orig = ar.get('original_title') or ar.get('original_name') or orig_of(hit)
    yr = (ar.get('release_date') or ar.get('first_air_date') or
          hit.get('release_date') or hit.get('first_air_date') or '')[:4] or t.get('year')
    fallback_poster = 'https://placehold.co/500x750/0f172a/06b6d4?text=' + \
        urllib.parse.quote((english_title_of(t) or t.get('clean_title') or '')[:24])
    final_poster = poster or fallback_poster
    final_story = story or (f"شاهد {t.get('clean_title')} مترجم اون لاين بجودة عالية على "
                            f"سينما بلس مع روابط مشاهدة مباشرة سريعة.")
    sort_recent = int(time.mktime(time.strptime(f'{yr}-01-01', '%Y-%m-%d'))) * 1000 if yr else (t.get('sort_recent') or 0)
    rating = ar.get('vote_average') if ar.get('vote_average') is not None else hit.get('vote_average')
    votes = ar.get('vote_count') if ar.get('vote_count') is not None else hit.get('vote_count')
    t['poster'] = final_poster
    t['matched_poster'] = bool(poster)
    t['description'] = final_story
    t['story'] = final_story
    t['real_plot'] = bool(story)
    t['year'] = str(yr) if yr else t.get('year')
    t['duration'] = f"{det['runtime']} دقيقة" if det['runtime'] else t.get('duration')
    t['country'] = det['country']
    t['genre'] = det['genre']
    t['rating'] = rating or None
    t['tmdb_id'] = hit['id']
    t['tmdb_url'] = f"https://www.themoviedb.org/{kind}/{hit['id']}"
    t['original_title'] = orig or None
    t['tmdb_vote'] = rating or 0
    t['tmdb_votes'] = votes or 0
    t['release_date'] = f'{yr}-01-01' if yr else t.get('release_date')
    t['sort_rating'] = rating or 0
    t['sort_recent'] = sort_recent
    t['backdrop_path'] = backdrop
    t['adult'] = is_adult(name=f"{t.get('clean_title')} {orig}",
                          genre=det['genre'] or '', adult=det['adult'])


def apply_fallback(t):
    en = english_title_of(t) or t.get('clean_title') or ''
    fallback_poster = 'https://placehold.co/500x750/0f172a/06b6d4?text=' + urllib.parse.quote(en[:24])
    story = (f"شاهد {t.get('clean_title')} مترجم اون لاين بجودة عالية على سينما بلس "
             f"مع روابط مشاهدة مباشرة سريعة.")
    t['poster'] = fallback_poster
    t['matched_poster'] = False
    t['description'] = story
    t['story'] = story
    t['real_plot'] = False
    t['country'] = None
    t['genre'] = None
    t['rating'] = None
    t['tmdb_id'] = None
    t['tmdb_url'] = None
    t['original_title'] = None
    t['tmdb_vote'] = 0
    t['tmdb_votes'] = 0
    t['sort_rating'] = 0
    t['backdrop_path'] = None


def main():
    # Pass 1: group is_new works with a real tmdb poster by tmdb_id
    groups = defaultdict(list)  # tmdb_id -> [{slug,en,namekey,category,year}]
    with open(ALL, 'rb') as f:
        for t in ijson.items(f, 'item'):
            tid = t.get('tmdb_id')
            poster = t.get('poster') or ''
            if not tid or 'image.tmdb.org' not in poster:
                continue
            en = english_title_of(t)
            groups[int(tid)].append({
                'slug': t.get('slug'), 'en': en, 'nk': name_key(en),
                'category': t.get('category'), 'year': t.get('year'),
            })

    # collisions: same id, >=2 works with DIFFERENT english base names
    collisions = {tid: items for tid, items in groups.items()
                  if len(items) >= 2 and len({i['nk'] for i in items}) >= 2}
    print(f'[coll] real-poster works: {sum(len(v) for v in groups.values())}', flush=True)
    print(f'[coll] tmdb ids shared by >=2 different-named works: {len(collisions)}', flush=True)

    # For each collision, gather each member's OWN best self-search match, then
    # decide per-member with group awareness:
    #   1. best_id == shared id (score>=1.0)  -> candidate KEEPER of the shared id
    #      (its own top match IS this record: real owner / alt title / sequel).
    #   2. best_id != shared id (score>=1.0)  -> FIX to best_id (a different work
    #      whose true top match differs -> reassign metadata).
    #   3. no confident match                 -> undecided for now.
    # Then: a group has a legit keeper if >=1 member is a candidate keeper. If a
    # member is undecided AND some OTHER member diverges (fix/own-different id),
    # the undecided one is a wrong-sharer with no replacement -> FALLBACK (neutral
    # placeholder) so two different works never share one poster/story. If ALL
    # members keep the shared id (legit multi-entry duplicate), nobody changes.
    decisions = {}
    report = []
    for tid, items in collisions.items():
        infos = []
        for it in items:
            bk, bhit, bscore, ids = self_search(it['en'], it['category'], it['year'])
            bid = int(bhit['id']) if bhit else None
            infos.append({'it': it, 'bk': bk, 'bhit': bhit, 'bscore': bscore, 'bid': bid})
        # who confidently owns the shared id?
        owns_shared = [x for x in infos if x['bid'] == tid and x['bscore'] >= 1.0]
        # a member "diverges" if it confidently matches a DIFFERENT id
        diverging = [x for x in infos if x['bid'] is not None and x['bid'] != tid and x['bscore'] >= 1.0]
        entry = {'tmdb': tid, 'members': [it['slug'] for it in items], 'losers': []}
        for x in infos:
            it = x['it']
            if x['bid'] == tid and x['bscore'] >= 1.0:
                decisions[it['slug']] = ('keep', None, None)         # legit owner
            elif x['bid'] is not None and x['bid'] != tid and x['bscore'] >= 1.0:
                decisions[it['slug']] = ('fix', x['bk'], x['bhit'])  # different work -> reassign
                entry['losers'].append({'slug': it['slug'], 'en': it['en'], 'action': 'fix',
                                        'score': round(x['bscore'], 2),
                                        'new_tmdb': x['bhit']['id'], 'new_title': title_of(x['bhit'])})
            else:
                # Undecided (no confident own match). Distinguish "same work under
                # an alternate/foreign title" (KEEP) from "a genuinely different
                # work wrongly sharing this id" (FALLBACK) by token overlap against
                # the shared record's own titles (title/original/alternatives).
                rec_tok = record_title_tokens(tid, it['category'])
                own_tok = toks(it['en']) | toks(it['nk'])
                same_work = bool(rec_tok & own_tok)
                if not same_work and (diverging or owns_shared):
                    decisions[it['slug']] = ('fallback', None, None)
                    entry['losers'].append({'slug': it['slug'], 'en': it['en'],
                                            'action': 'fallback', 'score': round(x['bscore'], 2),
                                            'new_tmdb': None, 'new_title': None})
                else:
                    decisions[it['slug']] = ('keep', None, None)
        if entry['losers']:
            report.append(entry)
            print(f"[coll] {tid} members={entry['members']} -> "
                  f"{[l['slug']+'='+l['action']+('>'+str(l['new_tmdb']) if l['new_tmdb'] else '') for l in entry['losers']]}",
                  flush=True)

    n_fix = sum(1 for d in decisions.values() if d[0] == 'fix')
    n_fb = sum(1 for d in decisions.values() if d[0] == 'fallback')
    print(f'[coll] decisions: fix={n_fix} fallback={n_fb} keep={len(decisions)-n_fix-n_fb}', flush=True)

    # Pass 3: stream all.json, apply decisions to loser slugs, write new file
    applied = {'fix': 0, 'fallback': 0}
    out = open(ALL_TMP, 'w', encoding='utf-8')
    out.write('[')
    first = True
    with open(ALL, 'rb') as f:
        for t in ijson.items(f, 'item'):
            slug = t.get('slug')
            d = decisions.get(slug)
            if d and d[0] == 'fix':
                apply_fix(t, d[1], d[2]); applied['fix'] += 1
            elif d and d[0] == 'fallback':
                apply_fallback(t); applied['fallback'] += 1
            if not first:
                out.write(',')
            first = False
            out.write(dumps(t))
    out.write(']')
    out.close()
    os.replace(ALL_TMP, ALL)
    json.dump({'applied': applied, 'report': report}, open(REPORT, 'w', encoding='utf-8'),
              ensure_ascii=False, indent=1)
    print(f"[coll] DONE fixed={applied['fix']} fallback={applied['fallback']} -> all.json rewritten", flush=True)


if __name__ == '__main__':
    main()
