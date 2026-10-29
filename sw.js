// РабУч: кэш для работы офлайн. Версия кэша меняется при каждой сборке — так телефон узнаёт об обновлении.
// Новая версия скачивается и включается сама, но страницы отдаются из ОДОБРЕННОГО кэша: пока в колокольчике
// не нажали «Обновить», видна прежняя версия — даже если iOS закрыла приложение и новый обработчик уже работает.
var CACHE="rabuch-1.12.6-5bdfba08";
var FILES=["./","index.html","core.js","screen.js","manifest.webmanifest","icon-192.png","icon-512.png","apple-touch-icon.png"];
var META="rabuch-meta",APPROVED=null;   // в META лежит имя одобренного кэша
function approved(){
  if(APPROVED)return Promise.resolve(APPROVED);
  return caches.open(META).then(function(c){return c.match("approved")}).then(function(r){return r?r.text():null}).then(function(v){APPROVED=v;return v});
}
function approve(name){   // одобрить версию и убрать остальные
  APPROVED=name;
  return caches.open(META).then(function(c){return c.put("approved",new Response(name))})
    .then(function(){return caches.keys()})
    .then(function(k){return Promise.all(k.filter(function(x){return x!==name&&x!==META}).map(function(x){return caches.delete(x)}))});
}
self.addEventListener("install",function(e){e.waitUntil(caches.open(CACHE).then(function(c){return c.addAll(FILES.map(function(f){return new Request(f,{cache:"reload"})}))}))});
self.addEventListener("activate",function(e){e.waitUntil(approved().then(function(a){
  if(!a||a===CACHE)return approve(CACHE);   // первая установка (и переход со старой схемы без одобрения) — одобряем себя
  return caches.keys().then(function(k){return Promise.all(k.filter(function(x){return x!==a&&x!==CACHE&&x!==META}).map(function(x){return caches.delete(x)}))});
}).then(function(){return self.clients.claim()}))});
self.addEventListener("message",function(e){
  var port=e.ports&&e.ports[0];
  if(e.data==="skip")e.waitUntil(approve(CACHE).then(function(){if(port)port.postMessage("ok");return self.skipWaiting()}));   // «Обновить»
  if(e.data==="status")e.waitUntil(approved().then(function(a){if(port)port.postMessage({cache:CACHE,approved:a})}));
});
self.addEventListener("fetch",function(e){
  var r=e.request;if(r.method!=="GET"||new URL(r.url).origin!==location.origin)return;
  e.respondWith(approved().then(function(a){return caches.open(a||CACHE)}).then(function(c){
    return c.match(r,{ignoreSearch:true}).then(function(hit){
      if(hit)return hit;
      if(r.mode==="navigate")return c.match("./").then(function(x){return x||fetch(r)});
      return caches.match(r,{ignoreSearch:true}).then(function(x){return x||fetch(r)});
    });
  }));
});
