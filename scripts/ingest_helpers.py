"""
Python port of scripts/lib-ingest.mjs helpers (kept byte-for-byte compatible in
behaviour) so the streaming ingest can match works exactly the way the Node
catalogue was built. Low-RAM friendly: pure functions, no big allocations.
"""
import re

# ---- adult / indecent filter (mirror of ADULT_PATTERNS) ----
_ADULT = [
    r'porn', r'\bxxx\b', r'erotic', r'\bhentai\b', r'\becchi\b', r'\bnsfw\b',
    r'\bsex(?:y|ual)?\b', r'\bnude|nudity\b', r'\bnaked\b', r'\bharem\b',
    r'\b18\+|\br-?18\b', r'\bsoftcore|hardcore\b', r'\bbrazzers\b', r'\bmilf\b',
    r'\bseduc', r'\bsensual\b', r'\borgy|orgasm\b', r'\bstrip(?:per|tease)\b',
    r'\bfetish\b', r'\blust\b', r'\bbabe(?:station)?\b', r'\bplayboy\b',
    'اباح', 'إباح', 'اباحي', 'جنس', 'جنسي', 'عاري|عارية', 'عُري|عري',
    'إغواء|اغواء', 'إغراء|اغراء', 'شهوة|شهوات', 'فاضح', 'خلاع|خلاعة',
    'دعار|دعارة', 'مثير(?:ة)? جنسي', 'ساخن(?:ة)? جدا', 'للكبار فقط',
    'محظور|للبالغين', 'حريم', 'عشيق(?:ة)?', 'خيانة زوجية', 'إيتشي|ايتشي',
    'هنتاي', r'نيك\b', 'سكس', 'سحاق', 'شاذ جنسي',
]
_ADULT_RE = [re.compile(p, re.I) for p in _ADULT]


def is_adult(name='', title='', genre='', adult=False):
    if adult is True:
        return True
    hay = f'{name} {title} {genre}'
    return any(r.search(hay) for r in _ADULT_RE)


def extract_year(name):
    m = re.search(r'\b(19|20)\d{2}\b', name or '')
    return m.group(0) if m else None


def extract_english_title(name):
    no_year = re.sub(r'\b(19|20)\d{2}\b', ' ', name or '').strip()
    latin = re.findall(r"[A-Za-z0-9][A-Za-z0-9 :.'!&,\-]*[A-Za-z0-9]", no_year)
    if not latin:
        return None
    return max(latin, key=len).strip()


def name_key(name):
    s = (name or '').lower()
    s = re.sub(r'\b(19|20)\d{2}\b', ' ', s)
    s = re.sub(r'[\u064B-\u065F\u0670]', '', s)   # Arabic diacritics
    s = re.sub(r'[إأآا]', 'ا', s)
    s = s.replace('ى', 'ي').replace('ة', 'ه')
    s = re.sub(r'[^0-9a-z\u0600-\u06FF]+', ' ', s)
    s = re.sub(r'\s+', ' ', s).strip()
    return s


def make_slug(name):
    base = name or ''
    base = re.sub(r'[\u064B-\u065F\u0670]', '', base)
    base = re.sub(r'[^0-9A-Za-z\u0600-\u06FF]+', '-', base)
    base = re.sub(r'-+', '-', base).strip('-').lower()
    return base or 'title'


def server_label(url):
    try:
        host = re.sub(r'^https?://', '', url).split('/')[0]
        host = re.sub(r'^www\.', '', host)
        base = host.split('.')[0]
        return f'{base} - HD'
    except Exception:
        return 'سيرفر - HD'


# ---- CSV Arabic title parsing -------------------------------------------------
# Strip the leading kind word + trailing junk to recover a clean matching title.
_KIND_PREFIX = re.compile(r'^\s*(?:مسلسل|انمي|أنمي|برنامج|ﺑﺮﻧﺎﻣﺞ|فيلم|مسرحية|مشاهدة)\s+')
_TRAIL_JUNK = re.compile(
    r'\s*(?:مترجم|مدبلج|كامل|اون\s*لاين|اونلاين|بالعربي|النسخه\s*الاصليه|'
    r'الموسم\s+\S+|الجزء\s+\S+|الحلقه\s+\S+|الحلقة\s+\S+)\s*',
)
_SEASON_WORD = re.compile(
    r'\bالموسم\s+(الاول|الأول|الثاني|الثالث|الرابع|الخامس|السادس|السابع|الثامن|التاسع|العاشر|\d+)'
)

_AR_ORD = {
    'الاول': 1, 'الأول': 1, 'الثاني': 2, 'الثالث': 3, 'الرابع': 4, 'الخامس': 5,
    'السادس': 6, 'السابع': 7, 'الثامن': 8, 'التاسع': 9, 'العاشر': 10,
}


def csv_kind(raw_title):
    """Return 'anime' | 'series' | 'movie' from the Arabic prefix."""
    t = (raw_title or '').strip()
    if t.startswith(('انمي', 'أنمي')):
        return 'anime'
    if t.startswith(('فيلم', 'مسرحية', 'مشاهدة')):
        return 'movie'
    return 'series'


def clean_csv_title(raw_title):
    """Strip kind prefix + trailing junk words -> best matching title."""
    t = (raw_title or '').strip()
    t = _KIND_PREFIX.sub('', t)
    # repeatedly strip trailing junk tokens
    prev = None
    while prev != t:
        prev = t
        t = _TRAIL_JUNK.sub(' ', t).strip()
    t = re.sub(r'\s+', ' ', t).strip()
    return t


def is_arabic_title(raw_title):
    """True when the title has (almost) no Latin letters -> likely Arabic work."""
    core = clean_csv_title(raw_title)
    latin = len(re.findall(r'[A-Za-z]', core))
    arabic = len(re.findall(r'[\u0600-\u06FF]', core))
    return latin < 2 and arabic > 0


# ---- season-suffix stripping (for base-work matching) ------------------------
# A work like "Boku no Hero Academia 7th Season" or "Dandadan الموسم الثاني" is
# the SAME base work as "Boku no Hero Academia" — the season number belongs in
# the season column, not the title. Strip these so base matching succeeds.
_EN_SEASON_SUFFIX = re.compile(
    r'\s*(?:'
    r'\d{1,2}(?:st|nd|rd|th)\s+season'          # 2nd Season
    r'|season\s+\d{1,2}'                         # Season 2
    r'|s\d{1,2}\b'                               # S2
    r'|part\s+\d{1,2}'                           # Part 2
    r'|the\s+final\s+season'                     # The Final Season
    r'|final\s+season'                           # Final Season
    r'|\d{1,2}(?:st|nd|rd|th)\s+cour'            # 2nd Cour
    r')\s*$',
    re.I,
)
_AR_SEASON_SUFFIX = re.compile(
    r'\s*(?:الموسم\s+\S+|الجزء\s+\S+|الحلقه\s+\S+|الحلقة\s+\S+|الجزء\s+الاخير)\s*$'
)


_PARENS = re.compile(r'\s*[\(\[（【][^)\]）】]*[\)\]）】]\s*')


def strip_parens(title):
    """Remove bracketed alt-titles, e.g. 'Foo (Bar Baz)' -> 'Foo'."""
    if not title:
        return title
    return re.sub(r'\s+', ' ', _PARENS.sub(' ', title)).strip()


def strip_season_suffix(title):
    """Remove a trailing season/part marker so the base work name remains."""
    if not title:
        return title
    prev = None
    t = title
    while prev != t:
        prev = t
        t = _EN_SEASON_SUFFIX.sub('', t).strip()
        t = _AR_SEASON_SUFFIX.sub('', t).strip()
    return re.sub(r'\s+', ' ', t).strip()


def match_keys(*texts):
    """
    Produce the full set of normalised match keys for one or more title strings.
    Combines: full name_key, English-chunk key, and both again after stripping
    bracketed alt-titles and trailing season/part markers. Shared by the index
    builder and the CSV matcher so both sides generate identical candidate keys.
    """
    ks = set()
    for text in texts:
        if not text:
            continue
        variants = set()
        variants.add(text)
        p = strip_parens(text)
        variants.add(p)
        for v in list(variants):
            variants.add(strip_season_suffix(v))
        for v in variants:
            if not v:
                continue
            nk = name_key(v)
            if nk:
                ks.add(nk)
            en = extract_english_title(v)
            if en:
                ek = name_key(en)
                if ek:
                    ks.add(ek)
                ebk = name_key(strip_season_suffix(en))
                if ebk:
                    ks.add(ebk)
    return ks
