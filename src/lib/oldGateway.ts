/**
 * Runtime loader for the ORIGINAL catalogue's gateway (watch) page.
 *
 * The /g gateway used to be built statically — one HTML file per work (~5.8k
 * files). Combined with the detail + season pages that pushed the deployment
 * over Cloudflare Pages' 20,000-file limit. We now serve /g as SSR and load a
 * slim "gateway payload" (identity + seasons/servers) from a hashed bucket file
 * at request time.
 *
 * The build (scripts/build-episode-shards.mjs) emits:
 *   - public/_data/oldgw/<bucket>.json   hashed bucket: { slug: GatewayPayload }
 * A request hashes the slug to its bucket (FNV-1a, NEW_BUCKETS=256), fetches just
 * that one bucket, and pulls the work out of it. No catalogue is bundled into the
 * Worker, so it stays well under the 3 MB limit and the file count stays tiny.
 *
 * MUST stay in sync with scripts/build-episode-shards.mjs `NEW_BUCKETS` +
 * `slugToBucket` (FNV-1a 32-bit) — the same hash used for new works.
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

export interface GatewayServer {
  id: number;
  label: string;
  url: string;
}
export interface GatewayEpisode {
  episode: number;
  servers: GatewayServer[];
}
export interface GatewaySeason {
  season: number;
  episodes: GatewayEpisode[];
}
export interface GatewayPayload {
  slug: string;
  clean_title: string;
  category: string;
  category_label: string | null;
  poster: string | null;
  episodes_count: number;
  url: string | null;
  seasons: GatewaySeason[];
}

const bucketCache = new Map<number, Record<string, GatewayPayload>>();

/** Load a single OLD work's gateway payload by slug at request time. */
export async function loadOldGateway(
  slug: string,
  requestUrl: URL
): Promise<GatewayPayload | undefined> {
  if (!slug) return undefined;
  const b = slugToBucket(slug);
  let bucket = bucketCache.get(b);
  if (!bucket) {
    const assetUrl = new URL(`/_data/oldgw/${b}.json`, requestUrl.origin);
    const res = await fetch(assetUrl);
    if (!res.ok) return undefined; // bucket missing → 404 at the page level
    bucket = (await res.json()) as Record<string, GatewayPayload>;
    bucketCache.set(b, bucket);
  }
  const raw = bucket[slug];
  if (!raw) return undefined; // unknown slug → 404 at the page level
  return raw;
}
