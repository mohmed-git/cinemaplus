// @ts-check
import { defineConfig } from 'astro/config';
import tailwind from '@astrojs/tailwind';
import sitemap from '@astrojs/sitemap';

import cloudflare from "@astrojs/cloudflare";

// اسم الموقع ورابطه للنشر
export const SITE_NAME = 'CinemaPlus';
export const SITE_URL = 'https://cinemanaplus.site';

/** @param {string} page */
function shouldIncludeInSitemap(page) {
  const pathname = page.startsWith('http') ? new URL(page).pathname : page;
  const normalized = pathname.replace(/\/$/, '');

  // Exclude the opaque streaming gateway (/g/...) and the 404 page.
  return !normalized.startsWith('/g/') && normalized !== '/404';
}

export default defineConfig({
  site: SITE_URL,
  output: 'static',
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

  adapter: cloudflare()
});