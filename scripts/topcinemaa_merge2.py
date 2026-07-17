#!/usr/bin/env python3
"""
Stage 2 (memory-safe v2): merge grouped topcinemaa servers into all.json using
on-disk shards (scripts/data/tc-shards/<hh>.jsonl) so peak RAM stays low.

Pipeline:
  · STREAM all.json with ijson (one title at a time).
  · For each title build its match key; load the matching shard (LRU-cached, a
    few hundred KB) and look up candidates by key.
  · Merge servers per the rule (replace same-provider, add new, keep old,
    new/replaced first).
  · Stream-write merged titles to all.json.tmp, then os.replace().
  · Track which grouped works were matched (by _k + a within-key index) so
    unmatched works can be emitted for TMDB enrichment by a second streaming
    pass over the shards.

Server merge rule (per episode / movie):
  · same PROVIDER already present  -> REPLACE its url with the newer CSV url
  · provider NOT present            -> ADD as a new server (id = max+1)
  · existing servers with no CSV counterpart are KEPT
  · order: replaced/new first, then leftover old servers

Match rule (strict): category + normKey(name) (+ year +/-1 to disambiguate).
"""
import argparse, json, os, re, hashlib
from urllib.parse import urlparse, parse_qs
from collections import OrderedDict
from decimal import Decimal
import ijson

def _json_default(o):
    # ijson yields JSON numbers as Decimal; convert back to int/float for output
    if isinstance(o, Decimal):
        i = int(o)
        return i if o == i else float(o)
    raise TypeError(f"Object of type {o.__class__.__name__} is not JSON serializable")

def dumps(obj):
    return json.dumps(obj, ensure_ascii=False, default=_json_default)

HERE = os.path.dirname(__file__)
ROOT = os.path.join(HERE, "..")
SHARDS = os.path.join(HERE, "data", "tc-shards")
ALL = os.path.join(ROOT, "src", "data", "generated", "all.json")
ALL_TMP = ALL + ".tmp"
NEW_OUT = os.path.join(ROOT, "src", "data", "generated", "new-from-topcinemaa.json")
REPORT = os.path.join(ROOT, "src", "data", "generated", "topcinemaa-merge-report.json")
UNMATCHED = os.path.join(ROOT, "src", "data", "generated", "topcinemaa-unmatched-report.json")
MATCHED_KEYS = os.path.join(HERE, "data", "tc-matched-keys.json")  # {key: [idx,...]}

# provider-key logic
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

# name normalisation (must match topcinemaa_shard.py)
NOISE_PREFIXES = [
    re.compile(r"^a\s+marvel\s+television\s+special\s+presentation\s*[\u2013:\-]\s*", re.I),
    re.compile(r"^marvel\s+studios[\u2019']?\s*", re.I),
    re.compile(r"^a\s+netflix\s+(original\s+)?(film|series|movie|event)\s*[\u2013:\-]\s*", re.I),
    re.compile(r"^dc\s+studios?\s*[\u2013:\-]\s*", re.I),
    re.compile(r"^special\s+presentation\s*[\u2013:\-]\s*", re.I),
]
DIACRITICS = re.compile(r"[\u064B-\u065F\u0670]")
YEAR_RE = re.compile(r"\b(19|20)\d{2}\b")
ARABIC_WRAPPERS = re.compile(r"\b(\u0645\u062a\u0631\u062c\u0645|\u0645\u062a\u0631\u062c\u0645\u0629|\u0627\u0648\u0646\u0644\u0627\u064a\u0646|\u0645\u0634\u0627\u0647\u062f\u0629|\u062a\u062d\u0645\u064a\u0644|\u0643\u0627\u0645\u0644|\u0643\u0627\u0645\u0644\u0629|\u0627\u0644\u0645\u0648\u0633\u0645|\u0627\u0644\u062d\u0644\u0642\u0629|\u0648\u0627\u0644\u0627\u062e\u064a\u0631\u0629|\u0627\u0644\u0627\u062e\u064a\u0631\u0629)\b")
NONWORD = re.compile(r"[^0-9a-z\u0600-\u06FF]+")

def norm_key(name):
    s = name or ""
    for r in NOISE_PREFIXES:
        s = r.sub("", s)
    s = s.strip().lower()
    s = YEAR_RE.sub(" ", s)
    s = DIACRITICS.sub("", s)
    s = re.sub(r"[\u0625\u0623\u0622\u0627]", "\u0627", s)
    s = s.replace("\u0649", "\u064a").replace("\u0629", "\u0647")
    s = ARABIC_WRAPPERS.sub(" ", s)
    s = NONWORD.sub(" ", s)
    return re.sub(r"\s+", " ", s).strip()

def shard_of(key):
    return hashlib.md5(key.encode("utf-8")).hexdigest()[:2]

def year_of(v):
    if not v:
        return None
    m = re.search(r"\d{4}", str(v))
    return int(m.group(0)) if m else None

# ── shard cache: key -> list[(global_line_idx, work)] ──
class ShardCache:
    def __init__(self, cap=8):
        self.cap = cap
        self.d = OrderedDict()  # hh -> {key: [(idx, work), ...]}
        # global line index per shard so we can identify works uniquely
    def get(self, hh):
        if hh in self.d:
            self.d.move_to_end(hh)
            return self.d[hh]
        path = os.path.join(SHARDS, f"{hh}.jsonl")
        idx = {}
        if os.path.exists(path):
            with open(path, encoding="utf-8") as f:
                for lineno, line in enumerate(f):
                    line = line.strip()
                    if not line:
                        continue
                    w = json.loads(line)
                    idx.setdefault(w["_k"], []).append((f"{hh}:{lineno}", w))
        self.d[hh] = idx
        if len(self.d) > self.cap:
            self.d.popitem(last=False)
        return idx

def merge_into(target, csv_servers):
    replaced = added = 0
    old = target.get("servers") or []
    max_id = max((s.get("id", 0) or 0) for s in old) if old else 0
    used = set(); fresh = []; idc = max_id
    for cs in csv_servers:
        cs_prov = provider_key(cs["url"])
        idx = -1
        for i, s in enumerate(old):
            if i in used:
                continue
            if cs_prov and provider_key(s.get("url", "")) == cs_prov:
                idx = i; break
        if idx >= 0:
            used.add(idx); kept = old[idx]
            if kept.get("url") != cs["url"]:
                replaced += 1
            fresh.append({"id": kept.get("id"), "label": cs.get("label") or kept.get("label"), "url": cs["url"]})
        else:
            idc += 1
            fresh.append({"id": idc, "label": cs["label"], "url": cs["url"]}); added += 1
    leftover = [s for i, s in enumerate(old) if i not in used]
    target["servers"] = fresh + leftover
    return replaced, added

def merge_work(csv_work, title):
    replaced = added = 0
    if csv_work.get("m") or title.get("category") == "movie":
        seasons = title.get("seasons") or []
        if seasons and seasons[0].get("episodes"):
            r, a = merge_into(seasons[0]["episodes"][0], csv_work.get("ms") or [])
            replaced += r; added += a
    else:
        for e in csv_work.get("eps") or []:
            season = next((s for s in (title.get("seasons") or []) if s.get("season") == e["s"]), None)
            if not season:
                continue
            tgt = next((ep for ep in (season.get("episodes") or []) if ep.get("episode") == e["e"]), None)
            if not tgt:
                continue
            r, a = merge_into(tgt, e.get("sv") or [])
            replaced += r; added += a
    return replaced, added


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry", action="store_true")
    args = ap.parse_args()

    cache = ShardCache(cap=12)
    matched_uids = set()      # global work uid strings that got matched
    matched = 0
    total_replaced = total_added = 0
    matched_samples = []
    seen = 0

    print(f"[merge2] streaming all.json (dry={args.dry}) …", flush=True)
    out = None if args.dry else open(ALL_TMP, "w", encoding="utf-8")
    if out:
        out.write("[")
    first = True
    with open(ALL, "rb") as f:
        for title in ijson.items(f, "item"):
            seen += 1
            cat = title.get("category")
            keys = []
            ct = title.get("clean_title") or ""
            keys.append(f"{cat}::{norm_key(ct)}")
            for alt in (title.get("raw_name"), title.get("original_title"), title.get("title_ar")):
                if alt:
                    keys.append(f"{cat}::{norm_key(alt)}")
            chosen = None; chosen_uid = None
            for key in keys:
                idx = cache.get(shard_of(key))
                cands = idx.get(key)
                if not cands:
                    continue
                avail = [(uid, w) for uid, w in cands if uid not in matched_uids]
                if not avail:
                    continue
                if len(avail) == 1:
                    chosen_uid, chosen = avail[0]
                else:
                    ty = year_of(title.get("year"))
                    yr = [(uid, w) for uid, w in avail if w.get("y") and ty and abs(w["y"] - ty) <= 1]
                    if len(yr) == 1:
                        chosen_uid, chosen = yr[0]
                if chosen is not None:
                    break
            if chosen is not None:
                matched_uids.add(chosen_uid)
                matched += 1
                r, a = merge_work(chosen, title)
                total_replaced += r; total_added += a
                if (r or a) and len(matched_samples) < 60:
                    matched_samples.append({"csv": chosen["n"], "matched": title.get("clean_title"),
                                            "year": chosen.get("y"), "replaced": r, "added": a})
            if out:
                if not first:
                    out.write(",")
                out.write(dumps(title))
                first = False
            if seen % 2000 == 0:
                print(f"[merge2]   …scanned {seen}  matched={matched}", flush=True)
    if out:
        out.write("]")
        out.close()

    print(f"\n[merge2] ===== RESULT =====", flush=True)
    print(f"[merge2] existing titles scanned : {seen}", flush=True)
    print(f"[merge2] matched works           : {matched}", flush=True)
    print(f"[merge2]   servers REPLACED       : {total_replaced}", flush=True)
    print(f"[merge2]   servers ADDED          : {total_added}", flush=True)

    report = {
        "dryRun": args.dry,
        "existingScanned": seen, "matched": matched,
        "serversReplaced": total_replaced, "serversAdded": total_added,
        "matchedSamples": matched_samples,
    }

    if args.dry:
        print("\n[merge2] --dry: nothing written. Samples:", flush=True)
        for s in matched_samples[:15]:
            print("   ", dumps(s), flush=True)
        # still compute created count by streaming shards
        created = count_unmatched(matched_uids)
        report["created"] = created
        print(f"[merge2] NEW works (unmatched)   : {created}", flush=True)
        return

    os.replace(ALL_TMP, ALL)

    # second pass: stream shards, emit unmatched works for enrichment
    created = write_unmatched(matched_uids)
    report["created"] = created
    with open(MATCHED_KEYS, "w", encoding="utf-8") as fh:
        json.dump(sorted(matched_uids), fh)
    with open(REPORT, "w", encoding="utf-8") as fh:
        json.dump(report, fh, ensure_ascii=False, indent=2)
    print(f"\n[merge2] wrote all.json (merged) + new works ({created}) + reports", flush=True)


def _iter_shards():
    for name in sorted(os.listdir(SHARDS)):
        if not name.endswith(".jsonl"):
            continue
        hh = name[:2]
        with open(os.path.join(SHARDS, name), encoding="utf-8") as f:
            for lineno, line in enumerate(f):
                line = line.strip()
                if not line:
                    continue
                yield f"{hh}:{lineno}", json.loads(line)

def count_unmatched(matched_uids):
    n = 0
    for uid, w in _iter_shards():
        if uid not in matched_uids:
            n += 1
    return n

def write_unmatched(matched_uids):
    created = 0
    sample = []
    with open(NEW_OUT, "w", encoding="utf-8") as out:
        out.write("[")
        first = True
        for uid, w in _iter_shards():
            if uid in matched_uids:
                continue
            rec = {
                "name": w["n"], "category": w["c"], "is_movie": w.get("m"),
                "year": w.get("y"), "poster": w.get("p"), "imdb_rating": w.get("ir"),
                "page_url": w.get("pu"), "movie_servers": w.get("ms"), "episodes": w.get("eps"),
            }
            if not first:
                out.write(",")
            out.write(dumps(rec))
            first = False
            created += 1
            if len(sample) < 300:
                sample.append({"name": w["n"], "category": w["c"], "year": w.get("y")})
        out.write("]")
    with open(UNMATCHED, "w", encoding="utf-8") as fh:
        json.dump({"count": created, "sample": sample}, fh, ensure_ascii=False, indent=2)
    return created


if __name__ == "__main__":
    main()
