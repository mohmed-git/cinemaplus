/**
 * New-works sitemap INDEX (SSR).
 *
 * Lists one child sitemap per chunk of /w/<slug> URLs. Advertised to crawlers
 * via public/robots.txt. New works are SSR and absent from the static sitemap,
 * so this is what makes them discoverable / indexable by search engines.
 */
export const prerender = false;

import type { APIRoute } from 'astro';
import { SITE } from '../lib/site';
import { getNewSitemapChunkCount } from '../lib/newSitemap';

export const GET: APIRoute = () => {
  const chunks = getNewSitemapChunkCount();
  const lastmod = new Date().toISOString();

  const entries = Array.from({ length: chunks }, (_, i) => {
    const loc = new URL(`/new-sitemap/${i}.xml`, SITE.url).toString();
    return `  <sitemap><loc>${loc}</loc><lastmod>${lastmod}</lastmod></sitemap>`;
  }).join('\n');

  const xml =
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
    `${entries}\n` +
    `</sitemapindex>\n`;

  return new Response(xml, {
    headers: {
      'Content-Type': 'application/xml; charset=utf-8',
      'Cache-Control': 'public, max-age=0, s-maxage=86400, stale-while-revalidate=604800',
    },
  });
};
