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

// Telegram uses HTML parse mode — escape user-controlled text.
function esc(s: string): string {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function buildMessage(body: NotifyBody): string {
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
  if (type !== 'server_down' && type !== 'request_content') {
    return json({ ok: false, error: 'invalid_type' }, 400);
  }

  // request_content must carry something to request.
  if (type === 'request_content' && !((body.message && body.message.trim()) || (body.page && body.page.trim()))) {
    return json({ ok: false, error: 'empty_request' }, 400);
  }

  const botToken = readEnv(locals, 'TELEGRAM_BOT_TOKEN');
  const chatId = readEnv(locals, 'TELEGRAM_CHAT_ID');

  if (!botToken || !chatId) {
    // Misconfiguration — do not leak which var is missing to the client.
    return json({ ok: false, error: 'not_configured' }, 503);
  }

  const text = buildMessage(body);

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
