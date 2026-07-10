const r = await fetch('http://localhost:5180/de/home.html?n=true&stref=logo');
const html = await r.text();
const salt = html.match(/data-cp_salt="([^"]+)"/)?.[1];
const proof = html.match(/data-cp_proof="([^"]+)"/)?.[1];
console.log('salt', salt);
console.log('proof', proof);
console.log('redirect', html.includes('data-cp_redirect'));

function compute(hostname, salt) {
  const str = salt + hostname;
  let hash = 0;
  for (let i = 0; i < str.length; i++) hash = ((hash << 5) - hash + str.charCodeAt(i)) | 0;
  return String(hash);
}
for (const h of ['localhost', '127.0.0.1']) {
  console.log(h, compute(h, salt), 'match', compute(h, salt) === proof);
}
