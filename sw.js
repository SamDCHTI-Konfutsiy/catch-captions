/* Subtitle Studio Pro — service worker (PWA offline cache).
   Registered only over http(s); file:// already works offline by nature. */
const CACHE = "ssp-v1";
const ASSETS = [
  "./", "./index.html", "./manifest.webmanifest", "./assets/icon.svg",
  "./styles/main.css",
  "./js/utils/utils.js", "./js/utils/ffmpeg.js", "./js/i18n.js", "./js/parser/parsers.js",
  "./js/storage/db.js", "./js/storage/project.js",
  "./js/subtitle/model.js", "./js/subtitle/editor.js",
  "./js/settings.js", "./js/player/player.js",
  "./js/timeline/waveform.js", "./js/timeline/timeline.js",
  "./js/components/search.js", "./js/export/export.js",
  "./js/utils/hanzi.js", "./js/components/hanzi-tool.js", "./js/components/sync-tool.js",
  "./js/asr/asr.js",
  "./js/shortcuts.js", "./js/app.js"
];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(keys =>
    Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
  ).then(() => self.clients.claim()));
});
self.addEventListener("fetch", e => {
  if (e.request.method !== "GET") return;
  const url = new URL(e.request.url);
  if (url.origin !== location.origin) return;   // never intercept video URLs / CDNs
  e.respondWith(
    caches.match(e.request).then(hit => hit || fetch(e.request).then(res => {
      const copy = res.clone();
      caches.open(CACHE).then(c => c.put(e.request, copy));
      return res;
    }).catch(() => caches.match("./index.html")))
  );
});
