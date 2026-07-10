import { gunzipSync, brotliDecompressSync } from 'node:zlib';

const CACHE_MAX = Number(process.env.BSK_CACHE_MAX) || 800;
const CACHE_TTL = Number(process.env.BSK_CACHE_TTL_MS) || 60 * 60 * 1000;
const HTML_CACHE_TTL = Number(process.env.BSK_HTML_CACHE_TTL_MS) || 5 * 60 * 1000;

/** @type {Map<string, { body: Buffer, headers: Record<string, string>, status: number, expires: number }>} */
const cache = new Map();

/** @type {Map<string, Promise<{ body: Buffer, headers: Record<string, string>, status: number }>>} */
const inflight = new Map();

function touch(key, entry) {
  cache.delete(key);
  cache.set(key, entry);
}

export function isCacheable(pathname, method) {
  if (method !== 'GET') return false;
  if (pathname.startsWith('/etc/clientlibs/')) return true;
  if (pathname.startsWith('/etc/designs/')) return true;
  if (pathname.startsWith('/content/')) return true;
  if (pathname.startsWith('/__module/')) return true;
  return /\.(?:js|css|woff2?|ttf|eot|png|jpe?g|gif|svg|ico|webp|avif|mp4|webm)(\?|$)/i.test(
    pathname,
  );
}

export function htmlCacheKey(hostname, targetUrl) {
  return `html:${hostname}:${targetUrl}`;
}

export function getCached(key) {
  const hit = cache.get(key);
  if (!hit) return null;
  if (Date.now() > hit.expires) {
    cache.delete(key);
    return null;
  }
  touch(key, hit);
  return hit;
}

export function setCached(key, entry, ttl = CACHE_TTL) {
  while (cache.size >= CACHE_MAX) {
    const first = cache.keys().next().value;
    if (!first) break;
    cache.delete(first);
  }
  cache.set(key, { ...entry, expires: Date.now() + ttl });
}

export function getInflight(key) {
  return inflight.get(key) || null;
}

export function setInflight(key, promise) {
  inflight.set(
    key,
    promise.finally(() => {
      inflight.delete(key);
    }),
  );
  return promise;
}

export function decompressBody(buf, encoding) {
  const enc = (encoding || '').toLowerCase();
  if (enc.includes('br')) return brotliDecompressSync(buf);
  if (enc.includes('gzip')) return gunzipSync(buf);
  return buf;
}

export function cacheStats() {
  let html = 0;
  let static_ = 0;
  for (const k of cache.keys()) {
    if (k.startsWith('html:')) html++;
    else static_++;
  }
  return { size: cache.size, html, static: static_, max: CACHE_MAX, ttlMs: CACHE_TTL };
}
