// @ts-check
import { defineConfig } from 'astro/config';
import tailwind from '@astrojs/tailwind';
import sitemap from '@astrojs/sitemap';
import cloudflare from '@astrojs/cloudflare';

// اسم الموقع ورابطه للنشر
export const SITE_NAME = 'CinemaPlus';
export const SITE_URL = 'https://cinemanaplus.site';

/** @param {string} page */
function shouldIncludeInSitemap(page) {
  const pathname = page.startsWith('http') ? new URL(page).pathname : page;
  const normalized = pathname.replace(/\/$/, '');

  // Exclude the opaque streaming gateway (/g/...) and the 404 page.
  // NOTE: episode pages (/d|n/.../c/.../e/...) are now SSR (prerender = false)
  // so Astro's static sitemap can never see them. They are published through a
  // dedicated SSR sitemap INDEX at /episodes-sitemap.xml and advertised to
  // crawlers via robots.txt (see public/robots.txt).
  //
  // IMPORTANT: we must NOT let /episodes-sitemap.xml (nor its /episodes-sitemap/*
  // chunks) leak into the *regular* page sitemap as a plain <url> entry — that
  // is what previously happened via `customPages`, and it made Google treat the
  // episode sitemap as a normal content page instead of a sub-sitemap, so the
  // episode URLs were never discovered.
  if (normalized.startsWith('/g/')) return false;
  if (normalized === '/404') return false;
  if (normalized === '/episodes-sitemap') return false;
  if (normalized.startsWith('/episodes-sitemap/')) return false;
  // The search page is intentionally `noindex` (dynamic, query-driven, thin/
  // duplicate results) — a noindex page must not appear in the sitemap.
  if (normalized === '/search') return false;
  return true;
}

export default defineConfig({
  site: SITE_URL,
  // Hybrid model: every page is STATIC by default (prerendered at build time);
  // only routes that explicitly opt in with `export const prerender = false`
  // (the episode pages) run as on-demand SSR on the Cloudflare edge.
  // In Astro 5 the old `output: 'hybrid'` is expressed as `output: 'static' + adapter`.
  output: 'static',
  adapter: cloudflare({
    imageService: 'compile',
  }),
  trailingSlash: 'ignore',
  build: {
    format: 'directory',
    inlineStylesheets: 'auto',
  },
  integrations: [
    tailwind({
      applyBaseStyles: true,
    }),
    sitemap({
      i18n: {
        defaultLocale: 'ar',
        locales: { ar: 'ar-SA' },
      },
      filter: shouldIncludeInSitemap,
      entryLimit: 1000,
      // NOTE: we intentionally do NOT use `customPages` for the episode sitemap.
      // `@astrojs/sitemap` injects customPages as plain <url> entries inside a
      // `sitemap-N.xml`, which is WRONG for a sub-sitemap — Google then crawls
      // /episodes-sitemap.xml as a content page and never follows the episode
      // URLs inside it. Instead the SSR episode sitemap index is advertised
      // directly in robots.txt, which is the correct, search-engine-supported
      // way to register an additional sitemap. See public/robots.txt.
    }),
  ],
  server: {
    host: '0.0.0.0',
    port: 3000,
  },
  vite: {
    build: {
      cssMinify: true,
      minify: 'esbuild',
    },
    ssr: {
      noExternal: ['fuse.js'],
    },
  },
});
