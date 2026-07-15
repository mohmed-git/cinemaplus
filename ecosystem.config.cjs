module.exports = {
  apps: [
    {
      name: 'cinemaplus',
      script: 'npx',
      // Hybrid build: static pages are served straight from dist/, while the
      // SSR routes (episode pages + episode sitemaps) run through the Cloudflare
      // Pages dev runtime. `wrangler pages dev` reads dist/_routes.json to decide
      // which paths hit the Worker vs. the static asset server.
      args: 'wrangler pages dev dist --ip 0.0.0.0 --port 3000',
      cwd: '/home/user/webapp',
      env: {
        NODE_ENV: 'production',
        PORT: 3000,
      },
      watch: false,
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      kill_timeout: 5000,
    },
  ],
};
