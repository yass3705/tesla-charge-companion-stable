const workerUrl=new URL(self.location.href);
const BUILD=(workerUrl.searchParams.get('v')||'').trim()||'7310';
const CACHE=`tcc-v${BUILD}-stable`;
const q=encodeURIComponent(BUILD);
const SHELL=[
  './',
  `./index.html?app=${q}`,
  `./assets/style.css?v=${q}`,
  `./assets/update.js?v=${q}`,
  `./assets/app.js?v=${q}`,
  `./assets/dedupe.js?v=${q}`,
  `./assets/france-catalog.js?v=${q}`,
  './manifest.webmanifest',
  './app-version.json'
];

self.addEventListener('install',event=>{
  event.waitUntil(
    caches.open(CACHE)
      .then(cache=>cache.addAll(SHELL))
      .catch(()=>{})
  );
  self.skipWaiting();
});

self.addEventListener('activate',event=>{
  event.waitUntil(
    caches.keys()
      .then(keys=>Promise.all(keys.filter(key=>key.startsWith('tcc-')&&key!==CACHE).map(key=>caches.delete(key))))
      .then(()=>self.clients.claim())
  );
});

self.addEventListener('fetch',event=>{
  if(event.request.method!=='GET')return;

  const url=new URL(event.request.url);
  const sameOrigin=url.origin===self.location.origin;
  if(!sameOrigin)return;

  const networkFirst=
    event.request.mode==='navigate'||
    url.pathname.includes('/data/')||
    url.pathname.includes('/assets/')||
    url.pathname.endsWith('/app-version.json')||
    url.pathname.endsWith('/v9-production-control.json')||
    url.pathname.endsWith('/shell-config.json')||
    url.pathname.endsWith('/manifest.webmanifest')||
    url.pathname.endsWith('/index.html')||
    url.pathname.endsWith('/');

  if(!networkFirst)return;

  event.respondWith(
    fetch(event.request,{cache:'no-store'})
      .then(response=>{
        if(response&&response.ok){
          const copy=response.clone();
          caches.open(CACHE).then(cache=>cache.put(event.request,copy)).catch(()=>{});
        }
        return response;
      })
      .catch(async()=>{
        const exact=await caches.match(event.request);
        if(exact)return exact;
        if(event.request.mode==='navigate'){
          return(await caches.match(`./index.html?app=${q}`))||(await caches.match('./'));
        }
        return Response.error();
      })
  );
});
