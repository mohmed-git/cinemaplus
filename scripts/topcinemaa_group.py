#!/usr/bin/env python3
"""
Stage 1: fast group of the topcinemaa CSV into a compact intermediate JSON.

Reads the 865k-row CSV ONCE (Python csv is far faster + lighter than node
readline in this 985 MB sandbox) and emits scripts/data/topcinemaa-grouped.json:

  [ { name, category, is_movie, year, poster, imdb_rating, page_url,
      movie_servers: [ {provider,label,url} ],
      episodes: [ {season, episode, title, servers:[{provider,label,url}] } ] }, ... ]

Server URLs are already proxy-unwrapped and de-duplicated by provider (keeping
the LAST/newest occurrence). Provider key logic MUST mirror lib-host.mjs.
"""
import csv, json, os, re, sys
from urllib.parse import urlparse, parse_qs

csv.field_size_limit(10 * 1024 * 1024)

CSV_PATH = os.environ.get("CSV_PATH", "/home/user/uploaded_files/topcinemaa_full_1836pages.csv")
OUT_PATH = os.path.join(os.path.dirname(__file__), "data", "topcinemaa-grouped.json")

KIND_MAP = {"مسلسل": "series", "فيلم": "movie", "انمي": "anime", "أنمي": "anime"}

NOISE_SUBDOMAINS = {"www","down","up","embed","cdn","play","player","stream",
                    "video","watch","go","e","d","v","m","new","old","s1","s2"}

NOISE_PREFIXES = [
    re.compile(r"^a\s+marvel\s+television\s+special\s+presentation\s*[–:\-]\s*", re.I),
    re.compile(r"^marvel\s+studios[’']?\s*", re.I),
    re.compile(r"^a\s+netflix\s+(original\s+)?(film|series|movie|event)\s*[–:\-]\s*", re.I),
    re.compile(r"^dc\s+studios?\s*[–:\-]\s*", re.I),
    re.compile(r"^special\s+presentation\s*[–:\-]\s*", re.I),
]

DIACRITICS = re.compile(r"[\u064B-\u065F\u0670]")
YEAR_RE = re.compile(r"\b(19|20)\d{2}\b")
ARABIC_WRAPPERS = re.compile(r"\b(مترجم|مترجمة|اونلاين|مشاهدة|تحميل|كامل|كاملة|الموسم|الحلقة|والاخيرة|الاخيرة)\b")
NONWORD = re.compile(r"[^0-9a-z\u0600-\u06FF]+")

def strip_noise(name):
    s = name
    for r in NOISE_PREFIXES:
        s = r.sub("", s)
    return s.strip()

def norm_key(name):
    s = strip_noise(name).lower()
    s = YEAR_RE.sub(" ", s)
    s = DIACRITICS.sub("", s)
    s = re.sub(r"[إأآا]", "ا", s)
    s = s.replace("ى", "ي").replace("ة", "ه")
    s = ARABIC_WRAPPERS.sub(" ", s)
    s = NONWORD.sub(" ", s)
    return re.sub(r"\s+", " ", s).strip()

def extract_year(name):
    m = YEAR_RE.search(name)
    return int(m.group(0)) if m else None

def unwrap_proxy(url):
    if not url:
        return url
    try:
        u = urlparse(url)
        if "play.php" in (u.path or "") and u.query:
            q = parse_qs(u.query)
            to = (q.get("to") or q.get("url") or q.get("go") or [None])[0]
            if to:
                return to if re.match(r"^https?://", to, re.I) else "https://" + to
        if u.query:
            q = parse_qs(u.query)
            to = (q.get("to") or [None])[0]
            if to and re.search(r"[a-z0-9-]+\.[a-z]{2,}", to, re.I):
                return to if re.match(r"^https?://", to, re.I) else "https://" + to
    except Exception:
        pass
    return url

def real_host(url):
    u = unwrap_proxy(url)
    try:
        h = urlparse(u).hostname or ""
    except Exception:
        h = ""
    if not h:
        m = re.match(r"^([a-z0-9.\-]+\.[a-z]{2,})", str(u), re.I)
        h = m.group(1) if m else ""
    return h.lower().lstrip("www.") if h.startswith("www.") else h.lower()

def provider_key(url):
    h = real_host(url)
    if not h:
        return ""
    parts = [p for p in h.split(".") if p]
    if len(parts) <= 1:
        return h
    i = 0
    while i < len(parts) - 2 and parts[i] in NOISE_SUBDOMAINS:
        i += 1
    return parts[i]

def server_label(url, player):
    key = provider_key(url)
    base = key or (player or "سيرفر")
    return f"{base} - HD"


def main():
    works = {}   # gkey -> dict
    rows = skipped = 0
    with open(CSV_PATH, encoding="utf-8-sig", newline="") as f:
        r = csv.reader(f)
        header = next(r, None)
        for c in r:
            if len(c) < 13:
                skipped += 1
                continue
            kind = (c[1] or "").strip()
            category = KIND_MAP.get(kind)
            if not category:
                if kind == "غير معروف":
                    category = "series" if (c[3] or "").strip().lower() == "true" else "movie"
                else:
                    skipped += 1
                    continue
            name = (c[2] or "").strip()
            embed = (c[12] or "").strip()
            if not name or not embed:
                skipped += 1
                continue
            rows += 1
            is_movie = category == "movie"
            gkey = f"{category}::{norm_key(name)}"
            w = works.get(gkey)
            if w is None:
                w = {
                    "name": name, "category": category, "is_movie": is_movie,
                    "year": extract_year(name),
                    "poster": (c[8] or "").strip() or None,
                    "imdb_rating": (c[7] or "").strip() or None,
                    "page_url": (c[13] or "").strip() or None,
                    "movie_servers": {},   # provider -> server (dict for de-dupe; list on dump)
                    "episodes": {},        # "s-e" -> {season,episode,title,servers:{provider->srv}}
                }
                works[gkey] = w
            player = (c[10] or "").strip()
            url = unwrap_proxy(embed)
            prov = provider_key(embed)
            if not prov:
                continue
            srv = {"provider": prov, "label": server_label(embed, player), "url": url}
            if is_movie:
                w["movie_servers"][prov] = srv   # last wins (newest)
            else:
                try:
                    season = int(c[4]) if c[4] else 1
                except ValueError:
                    season = 1
                try:
                    episode = int(c[6]) if c[6] else 1
                except ValueError:
                    episode = 1
                ek = f"{season}-{episode}"
                ep = w["episodes"].get(ek)
                if ep is None:
                    ep = {"season": season, "episode": episode,
                          "title": (c[14] or "").strip() or f"الحلقة {episode}",
                          "servers": {}}
                    w["episodes"][ek] = ep
                ep["servers"][prov] = srv

    # dump compact list form
    out = []
    for w in works.values():
        out.append({
            "name": w["name"], "category": w["category"], "is_movie": w["is_movie"],
            "year": w["year"], "poster": w["poster"], "imdb_rating": w["imdb_rating"],
            "page_url": w["page_url"],
            "movie_servers": list(w["movie_servers"].values()),
            "episodes": [
                {"season": e["season"], "episode": e["episode"], "title": e["title"],
                 "servers": list(e["servers"].values())}
                for e in sorted(w["episodes"].values(), key=lambda e: (e["season"], e["episode"]))
            ],
        })

    os.makedirs(os.path.dirname(OUT_PATH), exist_ok=True)
    with open(OUT_PATH, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False)
    print(f"[group] rows={rows} skipped={skipped} works={len(out)}")
    print(f"[group] wrote {OUT_PATH}")


if __name__ == "__main__":
    main()
