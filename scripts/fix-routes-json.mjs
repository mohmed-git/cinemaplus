#!/usr/bin/env node
/**
 * Post-build fixer for dist/_routes.json (Cloudflare Pages function-routing).
 *
 * WHY THIS EXISTS
 * ---------------
 * The @astrojs/cloudflare adapter auto-generates dist/_routes.json. Our site
 * mixes thousands of PRERENDERED (static) pages with a handful of SSR route
 * *shapes* that live under the same URL prefixes:
 *
 *   STATIC  : /                      (home)
 *             /m/<slug>              (movie detail)
 *             /s/<slug>              (series detail — single page per work)
 *             /a/<slug>              (anime  detail — single page per work)
 *             /c/...                 (listings: /c/m /c/s /c/a)
 *             /search /contact /privacy /terms /404
 *
 *   SSR     : /gw/<token> /g/<token> (streaming / watch gateway)
 *             /api/*                 (e.g. /api/notify — Telegram bot)
 *             /_image  /_server-islands/*
 *
 * As of the "revert to static" change EVERY detail page (old + new works) is
 * prerendered as a SINGLE static page per work — there are no more SSR episode
 * pages (/d|/n/<slug>/c/<s>/e/<e>), no /w new-works namespace, no /x/c listing
 * resolver, and no SSR sitemaps. Episode navigation happens client-side and each
 * episode button links straight to the watch gateway (/gw or /g). The ONLY
 * dynamic routes left are the two watch gateways + the notify API.
 *
 * Because the static page count is far above Cloudflare's 100-rule limit, the
 * adapter falls back to `include: ["/*"]` with a TRUNCATED exclude list. That
 * routes EVERY request (every static page + asset) through the SSR Worker,
 * which on the free plan burns the daily Functions request quota fast
 * (Googlebot alone was crawling ~4k/day), after which pages fail to serve and
 * Google stops indexing.
 *
 * THE FIX
 * -------
 * Write a precise _routes.json whose `include` lists ONLY the SSR prefixes
 * (/gw, /g, /api, /_image, /_server-islands). Everything else — home, every
 * /f /d /n detail page, listings and assets — is served as a pure static asset
 * (unlimited + fast + correct HTML), so the Worker is invoked solely for the
 * watch gateways and the notify API. The rule set is tiny (well under 100), so
 * Cloudflare never truncates it.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const routesPath = join(root, 'dist', '_routes.json');

// SSR-only include prefixes. Trailing "*" = Cloudflare prefix match.
// Only the watch gateways + notify API + Astro's image/server-island endpoints
// are dynamic now; everything else is static and served straight from ASSETS.
const INCLUDE = [
  '/api/*',               // SSR API routes (e.g. /api/notify — Telegram bot)
  '/gw/*',                // streaming/watch gateway (new works, encoded token)
  '/g/*',                 // streaming/watch gateway (old catalogue, encoded)
  '/_image',              // Astro on-demand image endpoint
  '/_server-islands/*',
];

// These are STATIC and must never invoke the Worker. `exclude` beats `include`.
// All detail pages (/f /d /n) are fully static now — a single page per work —
// so we exclude them explicitly to keep Worker invocations to the bare minimum.
const EXCLUDE = [
  '/',
  '/index.html',
  '/m/*',                 // movie  detail pages (static)
  '/s/*',                 // series detail pages (static, single page per work)
  '/a/*',                 // anime  detail pages (static, single page per work)
  '/c/*',                 // all listing pages (static): /c/m /c/s /c/a
  '/search',
  '/contact',
  '/privacy',
  '/terms',
  '/404',
  '/_astro/*',            // hashed JS/CSS assets
  '/_data/*',             // episode/detail data shards (static JSON)
  '/static/*',
  '/robots.txt',
  '/sitemap-index.xml',
  '/sitemap-0.xml',
  '/og-default.png',
  '/favicon.ico',
  '/favicon-48.png',
  '/favicon-192.png',
  '/favicon-512.png',
  '/apple-touch-icon.png',
  '/site.webmanifest',
  '/sw.js',
  '/README.txt',
];

function validate(rules) {
  const tooLong = rules.filter((r) => r.length > 100);
  if (tooLong.length) {
    throw new Error(`_routes.json rule(s) exceed 100 chars: ${tooLong.join(', ')}`);
  }
}

function main() {
  if (!existsSync(routesPath)) {
    console.error(`[fix-routes] dist/_routes.json not found at ${routesPath}. Run the build first.`);
    process.exit(1);
  }

  const before = JSON.parse(readFileSync(routesPath, 'utf8'));

  validate(INCLUDE);
  validate(EXCLUDE);

  const total = INCLUDE.length + EXCLUDE.length;
  if (total > 100) {
    throw new Error(`[fix-routes] combined rule count ${total} exceeds Cloudflare's 100 limit`);
  }

  const next = { version: 1, include: INCLUDE, exclude: EXCLUDE };
  writeFileSync(routesPath, JSON.stringify(next, null, 2) + '\n', 'utf8');

  console.log('[fix-routes] rewrote dist/_routes.json');
  console.log(`[fix-routes]   before: include=${before.include?.length ?? 0} exclude=${before.exclude?.length ?? 0}`);
  console.log(`[fix-routes]   after : include=${INCLUDE.length} exclude=${EXCLUDE.length} (total ${total}/100)`);
}

main();
