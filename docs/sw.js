// Cache only the application shell. API and map data always require the server.
const VERSIONE='fungometer-v33-commerce';
const FILE_APP=['index.html','inizia.html','prezzi.html','account.html','privacy.html','condizioni.html','info.html','stile.css','commerce.css','commerce-map.css','commerce.js','account-care.js','app.js','info.js','legal.js','manifest.webmanifest','icone/icona-32.png','icone/icona-192.png','icone/icona-512.png'];
self.addEventListener('install',e=>e.waitUntil(caches.open(VERSIONE).then(c=>c.addAll(FILE_APP)).then(()=>self.skipWaiting())));
self.addEventListener('activate',e=>e.waitUntil(caches.keys().then(ns=>Promise.all(ns.filter(n=>n.startsWith('fungometer-')&&n!==VERSIONE).map(n=>caches.delete(n)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',e=>{
 const r=e.request,u=new URL(r.url);
 if(r.method!=='GET'||u.origin!==self.location.origin||u.pathname.startsWith('/api/')||u.pathname.startsWith('/data/'))return;
 const f=u.pathname.split('/').pop();if(!FILE_APP.some(p=>p===f||p.endsWith('/'+f)))return;
 e.respondWith(fetch(r).then(s=>{if(s.ok){const copy=s.clone();e.waitUntil(caches.open(VERSIONE).then(c=>c.put(r,copy)));}return s;}).catch(async()=>await caches.match(r,{ignoreSearch:true})||new Response('Connessione necessaria. Riprova quando sei online.',{status:503})));
});
