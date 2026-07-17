#!/usr/bin/env python3
"""
Stage 2: merge grouped topcinemaa servers into all.json — memory-safe.

Strategy for the 985 MB sandbox:
  · Load the lean grouped file (8k works) into an index keyed by category::normKey.
  · STREAM all.json with ijson item-by-item (never hold the whole array), merge
    servers into each matched work, and stream-write the updated array to a temp
    file, then atomically replace all.json.
  · Works with no all.json match are emitted to new-from-topcinemaa.json for the
    later TMDB-enrichment step.

Server merge rule (per episode / movie):
  · same PROVIDER already present  -> REPLACE its url with the newer CSV url
  · provider NOT present            -> ADD as a new server (id = max+1)
  · existing servers with no CSV counterpart are KEPT
  · order: replaced/new first, then leftover old servers

Match rule (strict): category + normKey(name) (+ year ±1 to disambiguate).
Ambiguous / no-match -> not merged; recorded for the CREATE list / report.

Usage:
  python3 scripts/topcinemaa_merge.py --dry [--limit N]
  python3 scripts/topcinemaa_merge.py       [--limit N]
"""
import argparse, json, os, re, sys
from urllib.parse import urlparse, parse_qs

import ijson

HERE = os.path.dirname(__file__)
ROOT = os.path.join(HERE, "..")
LEAN = os.path.join(HERE, "data", "topcinemaa-grouped-lean.json")
ALL = os.path.join(ROOT, "src", "data", "generated", "all.json")
ALL_TMP = ALL + ".tmp"
NEW_OUT = os.path.join(ROOT, "src", "data", "generated", "new-from-topcinemaa.json")
REPORT = os.path.join(ROOT, "src", "data", "generated", "topcinemaa-merge-report.json")
UNMATCHED = os.path.join(ROOT, "src", "data", "generated", "topcinemaa-unmatched-report.json")

# ── provider-key logic (mirror of lib-host.mjs / topcinemaa_group.py) ──
NOISE_SUBDOMAINS = {"www","down","up","embed","cdn","play","player","stream",
                    "video","watch","go","e","d","v","m","new","old","s1","s2"}

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
    h = h.lower()
    return h[4:] if h.startswith("www.") else h

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

# ── name normalisation (mirror of topcinemaa_group.py) ──
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

def year_of(v):
    if not v:
        return None
    m = re.search(r"\d{4}", str(v))
    return int(m.group(0)) if m else None

# ── merge one episode target with csv servers ──
def merge_into(target, csv_servers):
    replaced = added = 0
    old = target.get("servers") or []
    max_id = max((s.get("id", 0) or 0) for s in old) if old else 0
    used = set()
    fresh = []
    idc = max_id
    for cs in csv_servers:
        cs_prov = provider_key(cs["url"])
        idx = -1
        for i, s in enumerate(old):
            if i in used:
                continue
            if cs_prov and provider_key(s.get("url", "")) == cs_prov:
                idx = i
                break
        if idx >= 0:
            used.add(idx)
            kept = old[idx]
            if kept.get("url") != cs["url"]:
                replaced += 1
            fresh.append({"id": kept.get("id"), "label": cs.get("label") or kept.get("label"), "url": cs["url"]})
        else:
            idc += 1
            fresh.append({"id": idc, "label": cs["label"], "url": cs["url"]})
            added += 1
    leftover = [s for i, s in enumerate(old) if i not in used]
    target["servers"] = fresh + leftover
    return replaced, added

def merge_work(csv_work, title):
    replaced = added = 0
    if csv_work["m"] or title.get("category") == "movie":
        seasons = title.get("seasons") or []
        if seasons and seasons[0].get("episodes"):
            r, a = merge_into(seasons[0]["episodes"][0], csv_work["ms"])
            replaced += r; added += a
    else:
        for e in csv_work["eps"]:
            season = next((s for s in (title.get("seasons") or []) if s.get("season") == e["s"]), None)
            if not season:
                continue
            tgt = next((ep for ep in (season.get("episodes") or []) if ep.get("episode") == e["e"]), None)
            if not tgt:
                continue
            r, a = merge_into(tgt, e["sv"])
            replaced += r; added += a
    return replaced, added


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry", action="store_true")
    ap.add_argument("--limit", type=int, default=0)
    args = ap.parse_args()

    print(f"[merge] loading lean grouped works …")
    with open(LEAN, encoding="utf-8") as f:
        works = json.load(f)
    if args.limit:
        works = works[: args.limit]
    print(f"[merge] {len(works)} grouped works (limit={args.limit or 'none'})")

    # index by category::normKey  → list of works (usually 1)
    index = {}
    for w in works:
        k = f"{w['c']}::{norm_key(w['n'])}"
        index.setdefault(k, []).append(w)
    matched_flags = {id(w): False for w in works}

    matched = created = 0
    total_replaced = total_added = 0
    matched_samples = []

    # stream all.json, merge in place, stream-write to tmp
    print(f"[merge] streaming all.json → merging …  (dry={args.dry})")
    out = None if args.dry else open(ALL_TMP, "w", encoding="utf-8")
    if out:
        out.write("[")
    first = True
    seen = 0
    with open(ALL, "rb") as f:
        for title in ijson.items(f, "item"):
            seen += 1
            cat = title.get("category")
            key = f"{cat}::{norm_key(title.get('clean_title') or '')}"
            cands = index.get(key)
            if not cands:
                # try raw_name / original_title keys
                for alt in (title.get("raw_name"), title.get("original_title"), title.get("title_ar")):
                    if alt:
                        cands = index.get(f"{cat}::{norm_key(alt)}")
                        if cands:
                            break
            chosen = None
            if cands:
                if len(cands) == 1:
                    chosen = cands[0]
                else:
                    ty = year_of(title.get("year"))
                    yr = [w for w in cands if w["y"] and ty and abs(w["y"] - ty) <= 1]
                    if len(yr) == 1:
                        chosen = yr[0]
            if chosen is not None and not matched_flags[id(chosen)]:
                matched_flags[id(chosen)] = True
                matched += 1
                r, a = merge_work(chosen, title)
                total_replaced += r; total_added += a
                if (r or a) and len(matched_samples) < 60:
                    matched_samples.append({"csv": chosen["n"], "matched": title.get("clean_title"),
                                            "year": chosen["y"], "replaced": r, "added": a})
            if out:
                if not first:
                    out.write(",")
                out.write(json.dumps(title, ensure_ascii=False))
                first = False
            if seen % 2000 == 0:
                print(f"[merge]   …scanned {seen} existing titles")
    if out:
        out.write("]")
        out.close()

    # works never matched → CREATE list
    new_works = [w for w in works if not matched_flags[id(w)]]
    created = len(new_works)

    print(f"\n[merge] ===== RESULT =====")
    print(f"[merge] existing titles scanned : {seen}")
    print(f"[merge] matched works           : {matched}")
    print(f"[merge]   · servers REPLACED     : {total_replaced}")
    print(f"[merge]   · servers ADDED        : {total_added}")
    print(f"[merge] NEW works (to enrich)    : {created}")

    report = {
        "dryRun": args.dry, "limit": args.limit or None,
        "groupedWorks": len(works), "existingScanned": seen,
        "matched": matched, "serversReplaced": total_replaced,
        "serversAdded": total_added, "created": created,
        "matchedSamples": matched_samples,
    }

    if args.dry:
        print("\n[merge] --dry: nothing written. Samples:")
        for s in matched_samples[:15]:
            print("   ", json.dumps(s, ensure_ascii=False))
        return

    os.replace(ALL_TMP, ALL)
    # emit new works (compact form for enrichment)
    with open(NEW_OUT, "w", encoding="utf-8") as f:
        json.dump([{
            "name": w["n"], "category": w["c"], "is_movie": w["m"], "year": w["y"],
            "poster": w["p"], "imdb_rating": w["ir"], "page_url": w["pu"],
            "movie_servers": w["ms"], "episodes": w["eps"],
        } for w in new_works], f, ensure_ascii=False)
    with open(REPORT, "w", encoding="utf-8") as f:
        json.dump(report, f, ensure_ascii=False, indent=2)
    with open(UNMATCHED, "w", encoding="utf-8") as f:
        json.dump({"count": created,
                   "sample": [{"name": w["n"], "category": w["c"], "year": w["y"]} for w in new_works[:300]]},
                  f, ensure_ascii=False, indent=2)
    print(f"\n[merge] wrote all.json (merged) + new-from-topcinemaa.json ({created}) + reports")


if __name__ == "__main__":
    main()
