/**
 * Copy-protection helpers (Sparkasse IF6 anti-proxy check).
 */
export function computeCpProof(hostname, salt) {
  const str = salt + hostname;
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash + str.charCodeAt(i)) | 0;
  }
  return String(hash);
}

export function fixCopyProtection(html, hostname) {
  const salt = html.match(/data-cp_salt="([^"]*)"/)?.[1];
  if (!salt) return html;

  const proof = computeCpProof(hostname, salt);
  html = html.replace(/data-cp_proof="[^"]*"/, `data-cp_proof="${proof}"`);
  html = html.replace(/\sdata-cp_redirect="[^"]*"/, '');
  return html;
}
