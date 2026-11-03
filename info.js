// Sight write-ups and photos from Wikipedia / Wikimedia Commons (free, no key). Fetched while online, then kept on the device
// (text in localStorage, photos in the Cache API) so the cards still work in flight.
(function (root) {
  "use strict";
  const KEY = "windowseat.info.v1", IMG = "ws-img-v1";
  let db = {}; try { db = JSON.parse(localStorage.getItem(KEY)) || {}; } catch (e) { db = {}; }
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(db)); } catch (e) { /* storage full or blocked */ } };
  const titleOf = (lm) => lm.name.replace(/\s*\((lake|river)\)$/i, "").replace(/\s*\(.*\)\s*$/, "").trim();
  const key = (lm) => titleOf(lm).toLowerCase();
  const json = async (url) => { const r = await fetch(url, { headers: { Accept: "application/json" } }); if (!r.ok) throw new Error(r.status); return r.json(); };
  const BAD = /\.svg|logo|icon|flag|map|symbol|locator|coat|seal|signature|diagram|plan\b|chart|wikidata|commons-|stub|relief|location|topograph|physical|district|boundar/i;

  function twoSentences(t) {
    if (!t) return "";
    const parts = t.replace(/\s+/g, " ").split(/(?<=[.!?])\s+(?=[A-Z"“])/); let out = parts[0] || "";
    if (parts[1] && (out + " " + parts[1]).length <= 240) out += " " + parts[1];
    if (out.length > 260) out = out.slice(0, 257).replace(/\s+\S*$/, "") + "...";
    return out;
  }

  async function fetchInfo(lm) {
    const api = "https://en.wikipedia.org/api/rest_v1/page/";
    let title = titleOf(lm), sum;
    try { sum = await json(api + "summary/" + encodeURIComponent(title.replace(/ /g, "_"))); } catch (e) { sum = null; }
    if (!sum || sum.type === "disambiguation") { // search for the best match instead
      const s = await json("https://en.wikipedia.org/w/api.php?action=opensearch&limit=1&format=json&origin=*&search=" + encodeURIComponent(title));
      if (!s[1] || !s[1][0]) throw new Error("no page");
      title = s[1][0]; sum = await json(api + "summary/" + encodeURIComponent(title.replace(/ /g, "_")));
    }
    let imgs = [];
    try {
      const ml = await json(api + "media-list/" + encodeURIComponent((sum.title || title).replace(/ /g, "_")));
      for (const it of ml.items || []) {
        if (it.type !== "image" || it.showInGallery === false || BAD.test(it.title || "") || !it.srcset || !it.srcset.length) continue;
        const best = it.srcset.find((s) => s.scale === "1x") || it.srcset[0]; // ~500 px wide
        imgs.push({ u: "https:" + best.src.replace(/^https?:/, ""), t: (it.title || "").replace(/^File:/, "").replace(/\.[a-z]+$/i, "").replace(/_/g, " ") });
        if (imgs.length >= 4) break;
      }
    } catch (e) { /* no gallery */ }
    if (!imgs.length && sum.thumbnail) imgs = [{ u: sum.thumbnail.source, t: sum.title }];
    return { t: sum.title || title, d: sum.description || "", x: twoSentences(sum.extract), i: imgs, p: sum.content_urls && sum.content_urls.desktop ? sum.content_urls.desktop.page : "" };
  }

  const pending = new Map();
  function get(lm) { // resolves with the stored info, fetching it if online; null when unknown and offline
    const k = key(lm); if (db[k]) return Promise.resolve(db[k]);
    if (typeof navigator !== "undefined" && navigator.onLine === false) return Promise.resolve(null);
    if (!pending.has(k)) pending.set(k, fetchInfo(lm).then((v) => { db[k] = v; save(); return v; }).catch(() => null).finally(() => pending.delete(k)));
    return pending.get(k);
  }
  const cached = (lm) => db[key(lm)] || null;

  async function imgSrc(url) { // blob URL from the device cache, downloading (and caching) it first when needed
    try {
      const c = await caches.open(IMG); let res = await c.match(url);
      if (!res) { res = await fetch(url, { mode: "cors" }); if (!res.ok) throw new Error(res.status); await c.put(url, res.clone()); }
      return URL.createObjectURL(await res.blob());
    } catch (e) { return navigator.onLine === false ? null : url; }
  }

  let busy = false;
  async function prefetch(lms, photos) { // quietly warm the cache for a list of sights (e.g. everything along the route)
    if (busy || navigator.onLine === false) return; busy = true;
    try {
      for (const lm of lms) {
        if (navigator.onLine === false) break;
        const had = cached(lm), info = await get(lm);
        if (info) for (const im of info.i.slice(0, photos || 3)) { try { const c = await caches.open(IMG); if (!(await c.match(im.u))) { const r = await fetch(im.u, { mode: "cors" }); if (r.ok) await c.put(im.u, r); } } catch (e) { /* skip */ } }
        if (!had) await new Promise((r) => setTimeout(r, 250));
      }
    } finally { busy = false; }
  }

  root.Info = { get, cached, imgSrc, prefetch, titleOf };
})(window);
