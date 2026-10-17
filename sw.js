// РабУч: кэш для работы офлайн. Версия кэша меняется при каждой сборке — так телефон узнаёт об обновлении.
var CACHE="rabuch-1.1-6560f679";
var FILES=["./","index.html","manifest.webmanifest","icon-192.png","icon-512.png","apple-touch-icon.png"];
self.addEventListener("install",function(e){e.waitUntil(caches.open(CACHE).then(function(c){return c.addAll(FILES.map(function(f){return new Request(f,{cache:"reload"})}))}))});
self.addEventListener("activate",function(e){e.waitUntil(caches.keys().then(function(k){return Promise.all(k.filter(function(x){return x!==CACHE}).map(function(x){return caches.delete(x)}))}).then(function(){return self.clients.claim()}))});
self.addEventListener("message",function(e){if(e.data==="skip")self.skipWaiting()});
self.addEventListener("fetch",function(e){
  var r=e.request;if(r.method!=="GET"||new URL(r.url).origin!==location.origin)return;
  e.respondWith(caches.open(CACHE).then(function(c){
    return c.match(r,{ignoreSearch:true}).then(function(hit){
      if(hit)return hit;
      if(r.mode==="navigate")return c.match("./").then(function(x){return x||fetch(r)});
      return fetch(r);
    });
  }));
});
