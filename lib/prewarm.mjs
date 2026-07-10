/**
 * Prewarm static assets and homepage on server start.
 */
import { fetch as undiciFetch } from 'undici';
import { isCacheable, setCached, htmlCacheKey } from './cache.mjs';
import { fixCopyProtection } from './copy-protection.mjs';
import { createRewriter } from './rewrite.mjs';

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

export async function prewarmMirror({
  upstream,
  homePath,
  rewriteHosts,
  port,
  injectHtml,
  log = console.log,
}) {
  const origin = `http://localhost:${port}`;
  const hostname = 'localhost';
  const rewrite = createRewriter(rewriteHosts, origin);
  const homeUrl = `${upstream}${homePath.startsWith('/') ? homePath : `/${homePath}`}`;

  const t0 = Date.now();
  let html = '';

  try {
    const res = await undiciFetch(homeUrl, {
      headers: {
        'user-agent': UA,
        'accept-language': 'de-DE,de;q=0.9',
        'accept-encoding': 'gzip, deflate, br',
      },
    });
    html = await res.text();
    html = rewrite(html);
    html = injectHtml(html, hostname);
    const buf = Buffer.from(html, 'utf8');
    setCached(
      htmlCacheKey(hostname, homeUrl),
      {
        body: buf,
        headers: {
          'content-type': 'text/html; charset=utf-8',
          'content-length': String(buf.length),
          'cache-control': 'public, max-age=120',
        },
        status: res.status,
      },
      Number(process.env.BSK_HTML_CACHE_TTL_MS) || 5 * 60 * 1000,
    );
    log(`[prewarm] HTML ${homePath} (${buf.length} bytes)`);
  } catch (err) {
    log('[prewarm] HTML failed:', err.message || err);
    return;
  }

  const assets = new Set();
  for (const re of [
    /(?:href|src)="(\/etc\/clientlibs\/[^"?]+\.(?:css|js))"/gi,
    /(?:href|src)="(\/etc\/designs\/[^"?]+\.(?:css|js|svg))"/gi,
    /(?:href|src)="(\/content\/dam\/[^"?]+\.(?:png|jpe?g|svg|ico|webp))"/gi,
    /(?:href|src)="(\/content\/[^"?]+\.(?:png|jpe?g|svg|webp))"/gi,
  ]) {
    let m;
    while ((m = re.exec(html))) assets.add(m[1]);
  }

  const urls = [...assets].slice(0, 40);
  await Promise.allSettled(
    urls.map(async (path) => {
      if (!isCacheable(path, 'GET')) return;
      const url = `${upstream}${path}`;
      const key = `GET:${url}`;
      try {
        const res = await undiciFetch(url, {
          headers: { 'user-agent': UA, 'accept-encoding': 'identity' },
        });
        if (!res.ok) return;
        const buf = Buffer.from(await res.arrayBuffer());
        const headers = {};
        for (const [k, v] of res.headers) headers[k] = v;
        delete headers['content-encoding'];
        headers['content-length'] = String(buf.length);
        headers['cache-control'] = 'public, max-age=3600';
        setCached(key, { body: buf, headers, status: res.status });
      } catch {
        /* ignore individual asset failures */
      }
    }),
  );

  log(`[prewarm] done in ${Date.now() - t0}ms — HTML + ${urls.length} assets`);
}
