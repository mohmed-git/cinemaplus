/**
 * Episode sitemap INDEX (SSR).
 *
 * Lists one child sitemap per chunk of episode URLs. This file is referenced
 * from the main sitemap-index via `customPages` in astro.config.mjs, so the
 * episode URLs remain fully discoverable by search engines even though the
 * episode pages themselves are SSR and absent from the static sitemap.
 */
export const prerender = false;

import type { APIRoute } from 'astro';
import { SITE } from '../lib/site';
import { getEpisodeSitemapChunkCount } from '../lib/episodeSitemap';

export const GET: APIRoute = () => {
  const chunks = getEpisodeSitemapChunkCount();
  const lastmod = new Date().toISOString();

  const entries = Array.from({ length: chunks }, (_, i) => {
    const loc = new URL(`/episodes-sitemap/${i}.xml`, SITE.url).toString();
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
