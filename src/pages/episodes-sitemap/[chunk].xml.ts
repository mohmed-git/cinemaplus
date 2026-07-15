/**
 * Episode sitemap CHUNK (SSR).
 *
 * Streams up to EPISODE_SITEMAP_CHUNK episode URLs for the given 0-based chunk.
 * Lives under /episodes-sitemap/<n>.xml so the Cloudflare adapter emits a clean
 * `/episodes-sitemap/*` SSR include (a top-level `/episodes-sitemap-[chunk].xml`
 * produced a malformed route pattern). Linked from /episodes-sitemap.xml.
 */
export const prerender = false;

import type { APIRoute } from 'astro';
import {
  buildUrlSet,
  getEpisodeSitemapChunkCount,
  getEpisodeUrlsForChunk,
} from '../../lib/episodeSitemap';

export const GET: APIRoute = ({ params }) => {
  const chunk = Number.parseInt(params.chunk ?? '', 10);
  const chunkCount = getEpisodeSitemapChunkCount();

  if (Number.isNaN(chunk) || chunk < 0 || chunk >= chunkCount) {
    return new Response('Not found', { status: 404 });
  }

  const urls = getEpisodeUrlsForChunk(chunk);
  const xml = buildUrlSet(urls);

  return new Response(xml, {
    headers: {
      'Content-Type': 'application/xml; charset=utf-8',
      'Cache-Control': 'public, max-age=0, s-maxage=86400, stale-while-revalidate=604800',
    },
  });
};
