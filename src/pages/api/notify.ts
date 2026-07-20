import type { APIRoute } from 'astro';

/**
 * Telegram notification endpoint.
 *
 * NOTE ON ARCHITECTURE: this project uses the `@astrojs/cloudflare` adapter
 * (`output: 'static'` + adapter). Cloudflare Pages *Functions* (a top-level
 * `functions/` dir) do NOT run here — the adapter emits a single `_worker.js`
 * that intercepts every request, so `functions/api/notify.js` would be ignored.
 * The correct, equivalent place for the endpoint is this Astro API route, which
 * runs on-demand (SSR) on the same Worker and is reachable at `POST /api/notify`.
 *
 * Secrets (TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID) are read server-side only from
 * the Cloudflare runtime env — they are NEVER exposed to the browser.
 *
 * TWO-BOT ROUTING: "server_down" / "request_content" / "feedback" go to the
 * main bot (TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID). "session_summary" (visitor
 * behavior tracking) goes to a separate bot (TELEGRAM_BOT_TOKEN_ANALYTICS /
 * TELEGRAM_CHAT_ID_ANALYTICS) so behavior noise never mixes with real alerts.
 * If the analytics vars aren't set, session_summary falls back to the main bot.
 *
 * Expected JSON body:
 *   { type: "server_down" | "request_content",
 *     page?: string, server?: string, message?: string }
 */

export const prerender = false;

interface NotifyBody {
  type?: string;
  page?: string;
  server?: string;
  message?: string;
  rating?: number;           // 1-5, for type "feedback"
  device?: string;           // client-supplied UA/screen summary, optional
  pages?: string[];          // visited page paths, for type "session_summary"
  duration_seconds?: number; // total session length, for type "session_summary"
}

// Read a var from the Cloudflare runtime env, falling back to process.env
// (useful for `wrangler pages dev` / local `.dev.vars`).
function readEnv(locals: App.Locals, key: string): string | undefined {
  const runtimeEnv = (locals as any)?.runtime?.env;
  if (runtimeEnv && typeof runtimeEnv[key] === 'string') return runtimeEnv[key];
  if (typeof process !== 'undefined' && process.env && process.env[key]) return process.env[key];
  return undefined;
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}

// Pick which bot/chat to send to based on message type.
// session_summary (behavior tracking) -> analytics bot, if configured.
// everything else (alerts/requests) -> main bot.
function pickTelegramTarget(locals: App.Locals, type: string): { botToken?: string; chatId?: string } {
  if (type === 'session_summary') {
    const analyticsToken = readEnv(locals, 'TELEGRAM_BOT_TOKEN_ANALYTICS');
    const analyticsChat = readEnv(locals, 'TELEGRAM_CHAT_ID_ANALYTICS');
    if (analyticsToken && analyticsChat) {
      return { botToken: analyticsToken, chatId: analyticsChat };
    }
    // Fall back to the main bot if the analytics bot isn't configured yet.
  }
  return {
    botToken: readEnv(locals, 'TELEGRAM_BOT_TOKEN'),
    chatId: readEnv(locals, 'TELEGRAM_CHAT_ID'),
  };
}

// Telegram uses HTML parse mode — escape user-controlled text.
function esc(s: string): string {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// Cloudflare attaches geo info to the raw Request as `.cf` (non-standard,
// not in the Fetch spec typings) — used only by the new feedback/session types
// below, so it never touches the existing server_down / request_content output.
function readGeo(request: Request): { country?: string; city?: string } {
  const cf = (request as any)?.cf;
  if (!cf) return {};
  return { country: cf.country, city: cf.city };
}

function buildContextLine(request: Request, body: NotifyBody): string {
  const geo = readGeo(request);
  const parts: string[] = [];
  if (geo.country) parts.push(`🌍 ${esc(geo.country)}${geo.city ? ' - ' + esc(geo.city) : ''}`);
  if (body.device) parts.push(`📱 ${esc(body.device.slice(0, 150))}`);
  return parts.length ? parts.join('  |  ') : '';
}

// Detects common crawlers/bots so session_summary / feedback don't get
// polluted by automated traffic (Googlebot, Yandex, headless scrapers, etc.)
function isLikelyBot(uaOrDevice?: string): boolean {
  if (!uaOrDevice) return false;
  const ua = uaOrDevice.toLowerCase();
  const botMarkers = [
    'headless', 'bot', 'crawler', 'crawl', 'spider', 'scraper',
    'yandex', 'yabr', 'bingpreview', 'googlebot', 'baiduspider',
    'ahrefsbot', 'semrushbot', 'mj12bot', 'dotbot', 'petalbot',
    'phantomjs', 'puppeteer', 'playwright', 'selenium', 'curl/', 'wget/',
  ];
  return botMarkers.some((m) => ua.includes(m));
}

function stars(n?: number): string {
  const v = Math.max(1, Math.min(5, Math.round(n || 0)));
  return '⭐'.repeat(v) + '☆'.repeat(5 - v);
}

function fmtDuration(sec?: number): string {
  const s = Math.max(0, Math.round(sec || 0));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return m > 0 ? `${m} د ${r} ث` : `${r} ث`;
}

function buildMessage(request: Request, body: NotifyBody): string {
  const page = body.page ? esc(body.page.slice(0, 300)) : '—';
  const server = body.server ? esc(body.server.slice(0, 120)) : '—';
  const msg = body.message ? esc(body.message.slice(0, 800)) : '';
  const now = new Date().toISOString().replace('T', ' ').slice(0, 19) + ' UTC';

  if (body.type === 'server_down') {
    return [
      '🚨 <b>بلاغ: سيرفر لا يعمل</b>',
      '',
      `🎬 <b>العمل / الصفحة:</b> ${page}`,
      `🖥️ <b>السيرفر:</b> ${server}`,
      msg ? `📝 <b>ملاحظة:</b> ${msg}` : '',
      '',
      `🕒 ${now}`,
    ].filter(Boolean).join('\n');
  }

  if (body.type === 'request_content') {
    return [
      '🎯 <b>طلب محتوى جديد</b>',
      '',
      `📽️ <b>المطلوب:</b> ${msg || page}`,
      body.page && body.message ? `🔗 <b>من صفحة:</b> ${page}` : '',
      '',
      `🕒 ${now}`,
    ].filter(Boolean).join('\n');
  }

  if (body.type === 'feedback') {
    const ctx = buildContextLine(request, body);
    return [
      '💬 <b>تقييم / رأي جديد</b>',
      '',
      `${stars(body.rating)}`,
      page !== '—' ? `📄 <b>الصفحة:</b> ${page}` : '',
      msg ? `📝 <b>الرأي:</b> ${msg}` : '',
      ctx,
      '',
      `🕒 ${now}`,
    ].filter(Boolean).join('\n');
  }

  if (body.type === 'session_summary') {
    const ctx = buildContextLine(request, body);
    const list = Array.isArray(body.pages) ? body.pages.slice(0, 50) : [];
    const pagesText = list.length
      ? list.map((p, i) => `${i + 1}. ${esc(String(p).slice(0, 200))}`).join('\n')
      : '—';
    return [
      '🧭 <b>ملخص جلسة زائر</b>',
      '',
      `⏱️ <b>المدة الإجمالية:</b> ${fmtDuration(body.duration_seconds)}`,
      `📄 <b>عدد الصفحات:</b> ${list.length}`,
      ctx,
      '',
      '<b>مسار التصفح:</b>',
      pagesText,
      '',
      `🕒 ${now}`,
    ].filter(Boolean).join('\n');
  }

  // Unknown type — still forward something useful.
  return [
    'ℹ️ <b>إشعار من الموقع</b>',
    '',
    `النوع: ${esc(body.type || 'غير محدد')}`,
    page !== '—' ? `الصفحة: ${page}` : '',
    msg ? `الرسالة: ${msg}` : '',
    '',
    `🕒 ${now}`,
  ].filter(Boolean).join('\n');
}

export const POST: APIRoute = async ({ request, locals }) => {
  // Parse body defensively.
  let body: NotifyBody;
  try {
    body = (await request.json()) as NotifyBody;
  } catch {
    return json({ ok: false, error: 'invalid_json' }, 400);
  }

  const type = body.type;
  const validTypes = ['server_down', 'request_content', 'feedback', 'session_summary'];
  if (!type || !validTypes.includes(type)) {
    return json({ ok: false, error: 'invalid_type' }, 400);
  }

  // request_content must carry something to request.
  if (type === 'request_content' && !((body.message && body.message.trim()) || (body.page && body.page.trim()))) {
    return json({ ok: false, error: 'empty_request' }, 400);
  }

  if (type === 'feedback' && !body.rating && !(body.message && body.message.trim())) {
    return json({ ok: false, error: 'empty_feedback' }, 400);
  }

  // Silently drop session/feedback noise from crawlers & headless bots.
  // Checks both the client-reported device string and the real request header
  // (the header can't be spoofed by a script the way a JSON field can).
  // server_down / request_content are untouched — those are explicit human clicks.
  if (type === 'session_summary' || type === 'feedback') {
    const realUa = request.headers.get('user-agent') || '';
    if (isLikelyBot(body.device) || isLikelyBot(realUa)) {
      return json({ ok: true, skipped: 'bot' });
    }
  }

  const { botToken, chatId } = pickTelegramTarget(locals, type);

  if (!botToken || !chatId) {
    return json({ ok: false, error: 'not_configured' }, 503);
  }

  const text = buildMessage(request, body);

  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 10000);
    const tgRes = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: 'HTML',
        disable_web_page_preview: true,
      }),
      signal: ctrl.signal,
    });
    clearTimeout(timer);

    if (!tgRes.ok) {
      return json({ ok: false, error: 'telegram_failed' }, 502);
    }
    return json({ ok: true });
  } catch {
    return json({ ok: false, error: 'network_error' }, 502);
  }
};

// Reject non-POST methods cleanly.
export const ALL: APIRoute = async ({ request }) => {
  if (request.method === 'POST') return json({ ok: false, error: 'unexpected' }, 500);
  return json({ ok: false, error: 'method_not_allowed' }, 405);
};
