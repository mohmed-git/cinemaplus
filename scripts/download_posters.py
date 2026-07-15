#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
download_posters.py
===================
Download the REAL poster image for every work listed in
``posters-to-download.csv`` and save it under the right folder
(``movie/`` or ``series/``) with the EXACT filename used in the
Cloudflare R2 URLs on the site, so that after you upload the folders to
your R2 bucket the posters appear automatically.

CSV columns (produced by build-poster-csv.mjs):
    name        - work title (for reference / logging)
    type        - "movie" or "series"  -> output sub-folder
    image_name  - "<slug>.jpg"          -> output filename (kept as-is)
    page_url    - a page on tuktukarab that contains the poster <img>

How it works
------------
For each row it requests ``page_url`` and extracts the poster image
(the <img> inside ``<div class="image">`` of the ``MainSingle`` block,
falling back to the og:image meta tag, then to the first
``wp-content/uploads/.../*.webp`` that is not the site favicon).
The image is downloaded and saved as ``<type>/<image_name>``.

Output layout (created next to this script, or under --out):
    posters/
      movie/   the-xxx.jpg ...
      series/  raakh.jpg ...

After it finishes, upload BOTH folders to the root of your R2 bucket:
    movie/...    -> https://pub-...r2.dev/movie/...
    series/...   -> https://pub-...r2.dev/series/...

Usage
-----
    pip install requests beautifulsoup4
    python download_posters.py                       # uses posters-to-download.csv
    python download_posters.py --csv my.csv --out ./posters
    python download_posters.py --workers 8            # parallel downloads
    python download_posters.py --retry-failed         # only re-try previous failures

Notes
-----
* Images are saved with the SAME basename you see in the R2 URL
  (``<slug>.jpg``). The original file may be .webp; we keep the .jpg name
  because that is what the site references. R2 serves bytes regardless of
  extension, so browsers will still render it. If you prefer to also convert
  the bytes to real JPEG, install Pillow and pass --convert.
* A ``download_report.csv`` is written summarising success / failure so you
  can see at a glance which posters still need attention.
"""

import argparse
import csv
import os
import re
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed

try:
    import requests
except ImportError:
    sys.exit("Missing dependency: pip install requests beautifulsoup4")

try:
    from bs4 import BeautifulSoup
    HAVE_BS4 = True
except ImportError:
    HAVE_BS4 = False

HERE = os.path.dirname(os.path.abspath(__file__))
DEFAULT_CSV = os.path.join(HERE, "data", "posters-to-download.csv")

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/124.0 Safari/537.36"
    ),
    "Accept": "text/html,application/xhtml+xml,image/webp,*/*",
    "Accept-Language": "ar,en;q=0.8",
}

# favicon / logo files we must ignore when scraping the poster
FAVICON_RE = re.compile(r"/cropped-|[-/]\d{2,4}x\d{2,4}\.", re.IGNORECASE)
UPLOAD_RE = re.compile(
    r"https://[^\"'<> ]*/wp-content/uploads/[^\"'<>?\s]+\.(?:webp|jpe?g|png)",
    re.IGNORECASE,
)


def extract_poster_url(html, base_url):
    """Return the best poster image URL found in the page HTML."""
    # 1) BeautifulSoup: the poster <img> lives in <div class="image"> of MainSingle
    if HAVE_BS4:
        soup = BeautifulSoup(html, "html.parser")
        block = soup.select_one(".MainSingle .image img, .Single--Container .image img")
        if block and block.get("src"):
            src = block["src"].strip()
            if src and not FAVICON_RE.search(src):
                return src
        # 2) og:image meta
        og = soup.find("meta", attrs={"property": "og:image"})
        if og and og.get("content"):
            src = og["content"].strip()
            if src and not FAVICON_RE.search(src):
                return src

    # 3) regex fallback: first uploads image that is not a favicon/thumbnail
    for m in UPLOAD_RE.finditer(html):
        url = m.group(0)
        if not FAVICON_RE.search(url):
            return url
    return None


def fetch(url, timeout=30):
    return requests.get(url, headers=HEADERS, timeout=timeout)


def process_row(row, out_dir, convert=False, timeout=30, sleep=0.0):
    name = row.get("name", "")
    typ = (row.get("type") or "").strip()
    image_name = (row.get("image_name") or "").strip()
    page_url = (row.get("page_url") or "").strip()

    if typ not in ("movie", "series"):
        return (name, image_name, "skip", "bad type")
    if not page_url:
        return (name, image_name, "fail", "no page_url")

    folder = os.path.join(out_dir, typ)
    os.makedirs(folder, exist_ok=True)
    dest = os.path.join(folder, image_name)

    if os.path.exists(dest) and os.path.getsize(dest) > 0:
        return (name, image_name, "exists", dest)

    try:
        if sleep:
            time.sleep(sleep)
        r = fetch(page_url, timeout=timeout)
        if r.status_code != 200:
            return (name, image_name, "fail", f"page HTTP {r.status_code}")
        poster = extract_poster_url(r.text, page_url)
        if not poster:
            return (name, image_name, "fail", "poster <img> not found")

        ir = fetch(poster, timeout=timeout)
        if ir.status_code != 200 or not ir.content:
            return (name, image_name, "fail", f"image HTTP {ir.status_code}")

        data = ir.content
        if convert:
            try:
                from io import BytesIO
                from PIL import Image
                im = Image.open(BytesIO(data)).convert("RGB")
                buf = BytesIO()
                im.save(buf, format="JPEG", quality=90)
                data = buf.getvalue()
            except Exception as e:  # noqa: BLE001
                # keep original bytes if conversion fails
                pass

        with open(dest, "wb") as fh:
            fh.write(data)
        return (name, image_name, "ok", poster)
    except Exception as e:  # noqa: BLE001
        return (name, image_name, "fail", str(e))


def main():
    ap = argparse.ArgumentParser(description="Download real posters from tuktukarab pages.")
    ap.add_argument("--csv", default=DEFAULT_CSV, help="input CSV (default: data/posters-to-download.csv)")
    ap.add_argument("--out", default=os.path.join(HERE, "posters"), help="output dir (default: ./posters)")
    ap.add_argument("--workers", type=int, default=6, help="parallel downloads (default: 6)")
    ap.add_argument("--timeout", type=int, default=30, help="per-request timeout seconds")
    ap.add_argument("--sleep", type=float, default=0.0, help="delay before each request (politeness)")
    ap.add_argument("--convert", action="store_true", help="convert images to real JPEG (needs Pillow)")
    ap.add_argument("--retry-failed", action="store_true", help="only retry rows missing from output")
    args = ap.parse_args()

    if not os.path.exists(args.csv):
        sys.exit(f"CSV not found: {args.csv}")

    with open(args.csv, encoding="utf-8") as f:
        rows = list(csv.DictReader(f))

    if args.retry_failed:
        def missing(row):
            dest = os.path.join(args.out, row.get("type", ""), row.get("image_name", ""))
            return not (os.path.exists(dest) and os.path.getsize(dest) > 0)
        rows = [r for r in rows if missing(r)]

    print(f"Rows to process : {len(rows)}")
    print(f"Output dir       : {args.out}")
    print(f"BeautifulSoup    : {'yes' if HAVE_BS4 else 'no (regex fallback only)'}")
    print("-" * 60)

    results = []
    with ThreadPoolExecutor(max_workers=args.workers) as ex:
        futs = {
            ex.submit(process_row, r, args.out, args.convert, args.timeout, args.sleep): r
            for r in rows
        }
        done = 0
        for fut in as_completed(futs):
            res = fut.result()
            results.append(res)
            done += 1
            status = res[2]
            mark = {"ok": "OK ", "exists": "== ", "fail": "XX ", "skip": ".. "}.get(status, "?? ")
            print(f"[{done}/{len(rows)}] {mark} {res[1]:<45} {res[3][:60]}")

    ok = sum(1 for r in results if r[2] == "ok")
    ex_ = sum(1 for r in results if r[2] == "exists")
    fail = sum(1 for r in results if r[2] == "fail")
    skip = sum(1 for r in results if r[2] == "skip")

    report = os.path.join(args.out, "download_report.csv")
    os.makedirs(args.out, exist_ok=True)
    with open(report, "w", encoding="utf-8", newline="") as f:
        w = csv.writer(f)
        w.writerow(["name", "image_name", "status", "detail"])
        w.writerows(results)

    print("-" * 60)
    print(f"OK: {ok}   already-existed: {ex_}   FAILED: {fail}   skipped: {skip}")
    print(f"Report: {report}")
    if fail:
        print("Re-run with --retry-failed to attempt the failures again.")


if __name__ == "__main__":
    main()
