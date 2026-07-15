/**
 * New-works sitemap CHUNK (SSR).
 *
 * Streams up to NEW_SITEMAP_CHUNK /w/<slug> URLs for the given 0-based chunk.
 * Lives under /new-sitemap/<n>.xml so the Cloudflare adapter emits a clean
 * `/new-sitemap/*` SSR include. Linked from /new-sitemap.xml.
 */
export const prerender = false;

import type { APIRoute } from 'astro';
import {
  buildUrlSet,
  getNewSitemapChunkCount,
  getNewUrlsForChunk,
} from '../../lib/newSitemap';

export const GET: APIRoute = ({ params }) => {
  const chunk = Number.parseInt(params.chunk ?? '', 10);
  const chunkCount = getNewSitemapChunkCount();

  if (Number.isNaN(chunk) || chunk < 0 || chunk >= chunkCount) {
    return new Response('Not found', { status: 404 });
  }

  const urls = getNewUrlsForChunk(chunk);
  const xml = buildUrlSet(urls);

  return new Response(xml, {
    headers: {
      'Content-Type': 'application/xml; charset=utf-8',
      'Cache-Control': 'public, max-age=0, s-maxage=86400, stale-while-revalidate=604800',
    },
  });
};
