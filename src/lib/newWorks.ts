/**
 * Runtime loaders for the freshly-ingested (CSV) works.
 *
 * These works are flagged `is_new` and are served ON-DEMAND (SSR), never built
 * statically — there are ~12k of them, which would blow Cloudflare Pages'
 * 20k-file limit and the low-memory build. The build emits:
 *   - public/_data/new/<bucket>.json   hashed bucket: { slug: Title } map
 *   - public/_data/subcat/<sub>.json   slim card index per sub-category
 * A request hashes the slug to its bucket (FNV-1a, NEW_BUCKETS=256), fetches
 * just that one bucket, and pulls the work out of it. No manifest is bundled, so
 * the Worker stays well under the 3 MB limit AND the static file count stays
 * tiny (256 bucket files instead of ~12.8k).
 */
import type { Title } from './types';
import { newDetailRoute } from './routes';
import subcatCounts from '../data/generated/subcat-counts.json';

export const SUBCAT_COUNTS = subcatCounts as Record<string, number>;

/**
 * Bucket index for a slug. New works are grouped into NEW_BUCKETS bucket files
 * (instead of one file each) to stay under Cloudflare Pages' 20,000-file limit.
 * This MUST match scripts/build-episode-shards.mjs `NEW_BUCKETS` + `slugToBucket`
 * (FNV-1a 32-bit). Computed on the edge so no manifest is bundled into the Worker.
 */
const NEW_BUCKETS = 256;

function slugToBucket(slug: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < slug.length; i++) {
    h ^= slug.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0) % NEW_BUCKETS;
}

export interface SubcatCard {
  slug: string;
  clean_title: string;
  category: Title['category'];
  category_label: string;
  subcategory: string | null;
  subcategory_label: string | null;
  poster: string | null;
  year: string | null;
  episodes_count: number;
  seasons_count: number;
  genre: string | null;
  rating: number;
  votes: number;
  sort_rating: number;
  sort_recent: number;
  is_new: true;
  url?: string;
}

function normalize(raw: Title): Title {
  return {
    ...raw,
    url: newDetailRoute(raw.slug),
  };
}

const bucketCache = new Map<number, Record<string, Title>>();

/** Load a single NEW work's full detail by slug at request time. */
export async function loadNewWork(slug: string, requestUrl: URL): Promise<Title | undefined> {
  if (!slug) return undefined;
  const b = slugToBucket(slug);
  let bucket = bucketCache.get(b);
  if (!bucket) {
    const assetUrl = new URL(`/_data/new/${b}.json`, requestUrl.origin);
    const res = await fetch(assetUrl);
    if (!res.ok) return undefined; // bucket missing → 404 at the page level
    bucket = (await res.json()) as Record<string, Title>;
    bucketCache.set(b, bucket);
  }
  const raw = bucket[slug];
  if (!raw) return undefined; // unknown / non-new slug → 404 at the page level
  return normalize(raw);
}

const subcatCache = new Map<string, SubcatCard[]>();

/** Load the slim card index for one sub-category at request time. */
export async function loadSubcat(sub: string, requestUrl: URL): Promise<SubcatCard[]> {
  if (subcatCache.has(sub)) return subcatCache.get(sub)!;
  const assetUrl = new URL(`/_data/subcat/${sub}.json`, requestUrl.origin);
  const res = await fetch(assetUrl);
  if (!res.ok) return [];
  const list = (await res.json()) as SubcatCard[];
  for (const e of list) e.url = newDetailRoute(e.slug);
  subcatCache.set(sub, list);
  return list;
}
