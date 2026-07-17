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
 *             /f/<slug>              (movie detail)
 *             /d/<slug>  /d/<slug>/c/<season>     (series detail + season)
 *             /n/<slug>  /n/<slug>/c/<season>     (anime  detail + season)
 *             /x/...                 (listings)
 *             /search /contact /privacy /terms /404
 *
 *   SSR     : /d/<slug>/c/<season>/e/<episode>    (series episode)
 *             /n/<slug>/c/<season>/e/<episode>    (anime  episode)
 *             /w/...                 (new CSV works, all depths)
 *             /gw/<token> /g/<token> (streaming gateway)
 *             /x/c/<code>            (listing code resolver)
 *             /episodes-sitemap.xml  /episodes-sitemap/<n>.xml
 *             /new-sitemap.xml       /new-sitemap/<n>.xml
 *             /_image  /_server-islands/*
 *
 * Because the static page count is far above Cloudflare's 100-rule limit, the
 * adapter falls back to `include: ["/*"]` with a TRUNCATED exclude list. That
 * routes EVERY request (every static page + asset) through the SSR Worker:
 *   - On the free plan this burns the daily Functions request quota fast
 *     (Googlebot alone was crawling ~4k/day), after which pages fail to serve
 *     and Google stops indexing.
 *   - Even when it serves, episode SSR pages compete for the same starved
 *     Worker, so "crawled - currently not indexed" piles up.
 *
 * THE FIX
 * -------
 * Write a precise _routes.json whose `include` lists ONLY the SSR prefixes.
 * Everything else is served as a pure static asset (unlimited + fast + correct
 * HTML), so the Worker is invoked solely for genuinely dynamic routes.
 *
 * Static /d/<slug> and /n/<slug> (and their /c/<season> pages) are NOT
 * renderable SSR routes in the Worker manifest, so when they DO hit the Worker
 * (they share the /d/* and /n/* include prefix with episodes) the adapter's
 * handler finds no matching route and falls through to env.ASSETS — i.e. the
 * static HTML is still served correctly. Keeping /d/* and /n/* in `include` is
 * required so the deeper episode URLs (which ARE SSR) are reachable.
 *
 * The resulting rule set is tiny (well under 100), so Cloudflare never
 * truncates it and the home page / movies / listings / assets are 100% static.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const routesPath = join(root, 'dist', '_routes.json');

// SSR-only include prefixes. Trailing "*" = Cloudflare prefix match.
// `exclude` always wins over `include`, so we exclude the static assets that
// would otherwise be swept up by the broad /d/* and /n/* prefixes (handled by
// the adapter's ASSETS fallthrough anyway, but excluding them keeps Worker
// invocations to the bare minimum and the static pages 100% free/fast).
const INCLUDE = [
  '/api/*',               // SSR API routes (e.g. /api/notify — Telegram bot)
  '/d/*',                 // series episodes  (/d/<slug>/c/<s>/e/<e>) are SSR
  '/n/*',                 // anime  episodes  (/n/<slug>/c/<s>/e/<e>) are SSR
  '/w/*',                 // new CSV works (all SSR)
  '/gw/*',                // streaming gateway (encoded)
  '/g/*',                 // legacy streaming gateway
  '/x/c/*',               // listing code resolver (SSR)
  '/episodes-sitemap.xml',
  '/episodes-sitemap/*',
  '/new-sitemap.xml',     // new-works sitemap index (SSR)
  '/new-sitemap/*',       // new-works sitemap chunks (SSR)
  '/_image',              // Astro on-demand image endpoint
  '/_server-islands/*',
];

// These are STATIC and must never invoke the Worker. `exclude` beats `include`.
// NOTE: we cannot list every /d/<slug> individually (thousands), so we rely on
// the adapter's ASSETS fallthrough for the detail/season pages under /d & /n.
// We still explicitly exclude the clearly-static top-level areas + assets.
const EXCLUDE = [
  '/',
  '/index.html',
  '/f/*',                 // movie detail pages are fully static
  '/x/d/*',               // series listing (static)
  '/x/f/*',               // movie  listing (static)
  '/x/n/*',               // anime  listing (static)
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
