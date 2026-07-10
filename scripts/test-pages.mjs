const pages = [
  '/content/myif/berliner-sk/work/filiale/de/home/misc/beraterchat.html?n=true',
  '/de/home/login-online-banking.html',
  '/de/home/misc/break.html?type=counter&ckey=js-usage&cval=1',
  '/de/home/girokonto-eroeffnen.html',
];
for (const p of pages) {
  const r = await fetch('http://localhost:5180' + p, { redirect: 'manual' });
  const loc = r.headers.get('location');
  console.log(p.slice(0, 60), r.status, loc ? '-> ' + loc.slice(0, 80) : 'ok');
}
