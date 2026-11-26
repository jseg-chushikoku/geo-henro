// ジオ遍路：電波がないときも使えるようにする仕組み（サービスワーカー）
// - アプリ本体とデータ：手元に残したものをすぐ出し、裏で新しい版を取りに行く
// - 地図・地質図の画像：一度表示したものを残し、次からは手元のものを使う（上限あり）
//   「電波なし用に保存」で残したもの（henro-tiles-saved）は別の置き場所で、上限で消えない。いちばん先に使う
// - 地質の問い合わせ：まずネットに聞き、だめなら前に聞いた答えを使う
// アプリを直したら VERSION を上げる。
const VERSION = "2026-11-28-5";
const SHELL = "henro-shell-" + VERSION;
const TILES = "henro-tiles";
const SAVED = "henro-tiles-saved";   // index.html の SAVED_CACHE と同じ名前
const API = "henro-api";
const TILE_MAX = 4000;   // 地図の画像を残す上限（約60〜100 MB）
const API_MAX = 500;

const SHELL_FILES = [
  "./", "./index.html", "./data.js", "./manifest.webmanifest",
  "./icon-192.png", "./icon-512.png", "./icon-maskable-512.png", "./apple-touch-icon.png",
  "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js",
  "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css",
];
const isTile = u =>
  u.hostname === "cyberjapandata.gsi.go.jp" ||
  u.hostname === "tiles.gsj.jp" ||
  (u.hostname === "gbank.gsj.jp" && u.pathname.includes("/tiles/"));
const isLegend = u => u.hostname === "gbank.gsj.jp" && u.pathname.endsWith("/legend.json");

self.addEventListener("install", e => {
  e.waitUntil((async () => {
    const c = await caches.open(SHELL);
    await c.addAll(SHELL_FILES.map(u => new Request(u, {mode: u.startsWith("http") ? "cors" : "same-origin", cache: "reload"})));
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", e => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k.startsWith("henro-shell-") && k !== SHELL) await caches.delete(k);
    await self.clients.claim();
  })());
});

let putCount = 0;
async function trim(name, max){
  const c = await caches.open(name);
  const keys = await c.keys();
  for (let i = 0; i < keys.length - max; i++) await c.delete(keys[i]);  // 古いものから消す
}

async function cacheFirst(req){
  const keep = await (await caches.open(SAVED)).match(req, {ignoreVary: true});   // 保存のときと地図の表示のときで、受け取る形式の指定（Accept）が違っても同じ画像として使う
  if (keep) return keep;
  const c = await caches.open(TILES);
  const hit = await c.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok) {
    c.put(req, res.clone());
    if (++putCount % 100 === 0) trim(TILES, TILE_MAX);
  }
  return res;
}

async function networkFirst(req){
  const c = await caches.open(API);
  try {
    const res = await fetch(req);
    if (res.ok) { c.put(req, res.clone()); if (++putCount % 50 === 0) trim(API, API_MAX); }
    return res;
  } catch (err) {
    const hit = await c.match(req);
    if (hit) return hit;
    throw err;
  }
}

async function staleWhileRevalidate(req, event){
  const c = await caches.open(SHELL);
  const hit = await c.match(req, {ignoreSearch: true});
  const update = fetch(req).then(res => { if (res.ok) c.put(req, res.clone()); return res; }).catch(() => null);
  if (hit) { event.waitUntil(update); return hit; }
  const res = await update;
  return res || new Response("電波がなく、まだ保存もされていません。", {status: 503, headers: {"Content-Type": "text/plain; charset=utf-8"}});
}

self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET") return;
  const u = new URL(req.url);
  // 「電波なし用に保存」が取りに行く画像（cache:"no-store" の印）は、ここでは何もしない（アプリ側が保存する）
  if (isTile(u)) return req.cache === "no-store" ? undefined : e.respondWith(cacheFirst(req));
  if (isLegend(u)) return e.respondWith(networkFirst(req));
  if (u.origin === location.origin || u.hostname === "cdnjs.cloudflare.com" ||
      u.hostname === "fonts.googleapis.com" || u.hostname === "fonts.gstatic.com")
    return e.respondWith(staleWhileRevalidate(req, e));
});
