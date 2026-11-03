// Window Seat · pixel game. Top-down view: the plane stays near the bottom of the screen and always flies "up";
// the world is rotated under it, so a hill on the right of the plane is drawn on the right.
(function () {
  "use strict";
  const G = window.Geo, SP = window.Sprites, S = SP.S;
  const $ = (s, el) => (el || document).querySelector(s);
  const $$ = (s, el) => [...(el || document).querySelectorAll(s)];
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const rad = (d) => (d * Math.PI) / 180;

  const AIRPORTS = Object.fromEntries(window.AIRPORTS.map((a) => [a[0], { code: a[0], name: a[1], city: a[2], lat: a[3], lon: a[4], tz: a[5] || "UTC", rwys: a[6] || [] }]));
  const LANDMARKS = G.toLandmarks(window.LANDMARKS, window.GEODATA);
  const KM = 111.19; // km per degree of latitude

  // ---------- storage ----------
  const KEY = "windowseat.v1";
  const store = {
    load() { try { return JSON.parse(localStorage.getItem(KEY)) || { flights: [], active: null }; } catch (e) { return { flights: [], active: null }; } },
    save(s) { try { localStorage.setItem(KEY, JSON.stringify(s)); } catch (e) { /* private mode */ } },
  };
  let state = store.load();

  // ---------- flight ----------
  let F = null, plan = [], planById = new Map(), ticks = [];
  let simMin = null, gpsFix = null, gpsWatch = null;

  const hhmm = (ms) => new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });
  const dur = (min) => { min = Math.round(Math.abs(min)); const h = Math.floor(min / 60), m = min % 60; return h ? `${h}H ${m}M` : `${m}M`; };
  const compassOf = (d) => ["N", "NE", "E", "SE", "S", "SW", "W", "NW"][Math.round(d / 45) % 8];
  const nowMs = () => (simMin == null ? Date.now() : F.takeoff + simMin * 60000);

  function airportFrom(text) {
    const t = text.trim();
    const m = t.match(/^([A-Za-z]{3})\b/);
    if (m && AIRPORTS[m[1].toUpperCase()]) return AIRPORTS[m[1].toUpperCase()];
    const low = t.toLowerCase();
    return Object.values(AIRPORTS).find((a) => a.city.toLowerCase() === low) || Object.values(AIRPORTS).find((a) => low.length > 2 && (a.city + " " + a.name).toLowerCase().includes(low)) || null;
  }

  // wall-clock time at an airport ("2026-11-03T18:30" in its own time zone) -> UTC ms
  function tzOffset(tz, ms) {
    const p = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }).formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
    return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second) - Math.floor(ms / 1000) * 1000;
  }
  function wallToUtc(str, tz) {
    const m = str.match(/^(\d{4})-(\d\d)-(\d\d)T(\d\d):(\d\d)/); if (!m) return NaN;
    const guess = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]); let t = guess - tzOffset(tz, guess); t = guess - tzOffset(tz, t); return t;
  }
  const localHm = (ms, tz) => new Intl.DateTimeFormat([], { timeZone: tz, hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(ms));

  function build(f) {
    const a = AIRPORTS[f.from], b = AIRPORTS[f.to], path = G.makePath(a, b), dist = path.total; // the real track: runway heading out, then the turn to the destination, then the arrival runway
    let takeoff, T;
    if (f.arr) { // block time from the ticket; taxi out / in are estimated and the rest is airborne
      const block = (f.arr - f.dep) / 60000, out = clamp(block * 0.12, 5, 15), inn = clamp(block * 0.07, 3, 8);
      T = Math.max(10, block - out - inn); takeoff = f.dep + out * 60000;
    } else { T = f.dur || null; takeoff = f.dep + (f.taxi || 0) * 60000; } // flights saved by older versions
    const profile = G.makeProfile(dist, T ? Math.round(T * 10) / 10 : null);
    return Object.assign({}, f, { a, b, path, dist, profile, takeoff, taxi: (takeoff - f.dep) / 60000, vis: f.vis ?? 0.75, landing: takeoff + profile.T * 60000 });
  }

  const TICK_W = { peak: 3, volcano: 3, monument: 3, temple: 3, range: 2.5, lake: 2, dam: 2, canyon: 2, island: 1.5, city: 1.5, desert: 1, plateau: 1, sea: 1, river: 1 };
  function pickTicks(list) { // notable, clearly visible sights, spaced along the route, for the progress strip
    const cand = list.filter((r) => r.dist <= 0.75 * r.max).sort((a, b) => (TICK_W[b.lm.type] || 1) - (TICK_W[a.lm.type] || 1) || a.dist / a.max - b.dist / b.max);
    const keep = [];
    for (const r of cand) { if (keep.length >= 40) break; if (keep.every((k) => Math.abs(k.alongKm - r.alongKm) >= 45)) keep.push(r); }
    return keep.sort((a, b) => a.alongKm - b.alongKm);
  }

  function activate(id) {
    const f = state.flights.find((x) => x.id === id);
    if (!f) { F = null; return; }
    state.active = id; store.save(state);
    F = build(f);
    plan = G.planRoute(LANDMARKS, F.path, F.profile, F.vis, Math.max(4, F.dist / 1500));
    planById = new Map(plan.map((r) => [r.lm.id, r]));
    simMin = null; gpsFix = null; slowAt = 0;
    const r = $("#warp-range"); r.min = -Math.round(F.taxi + 30); r.max = Math.round(F.profile.T + 20); r.value = 0;
    $("#h-num").textContent = F.a.code + ">" + F.b.code;
    $("#h-route").textContent = `${localHm(F.dep, F.a.tz)} > ${localHm(F.arr || F.landing, F.b.tz)}`;
    $("#prog-a").textContent = F.a.code; $("#prog-b").textContent = F.b.code;
    tickData = pickTicks(plan);
    if (navigator.onLine !== false) Info.prefetch(tickData.map((t) => t.lm), 3); // save write-ups and photos for the route while there is a connection
  }

  function position() {
    const t = (nowMs() - F.takeoff) / 60000, p = F.profile;
    if (gpsFix && simMin == null) {
      const s = G.pathNearest(F.path, gpsFix), pa = G.pathAt(F.path, s);
      return { t, phase: "air", pos: gpsFix, track: gpsFix.track ?? pa.track, alt: gpsFix.alt ?? G.CRUISE_ALT_KM, spd: gpsFix.spd ?? 830, frac: s / F.dist, gps: true };
    }
    const s = G.distAt(p, t), pa = G.pathAt(F.path, s);
    const phase = t < 0 ? (nowMs() < F.dep ? "gate" : "taxi") : t >= p.T ? "landed" : "air";
    return { t, phase, pos: { lat: pa.lat, lon: pa.lon }, track: pa.track, alt: G.altitudeAt(p, t), spd: G.speedAt(p, t), frac: s / F.dist };
  }

  // ---------- sun / time of day ----------
  function sunAt(lat, lon, ms) { // elevation in degrees, and hour angle (negative = morning)
    const d = ms / 86400000 + 2440587.5 - 2451545;
    const L = (280.46 + 0.9856474 * d) % 360, g = rad((357.528 + 0.9856003 * d) % 360);
    const lam = rad(L + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)), eps = rad(23.439 - 4e-7 * d);
    const decl = Math.asin(Math.sin(eps) * Math.sin(lam)), ra = Math.atan2(Math.cos(eps) * Math.sin(lam), Math.cos(lam)) * 180 / Math.PI;
    const gmst = (18.697374558 + 24.06570982441908 * d) * 15;
    let ha = (((gmst + lon - ra) % 360) + 540) % 360 - 180;
    const el = Math.asin(Math.sin(rad(lat)) * Math.sin(decl) + Math.cos(rad(lat)) * Math.cos(decl) * Math.cos(rad(ha))) * 180 / Math.PI;
    return { el, ha };
  }
  const STOPS = [[-18, [50, 66, 140]], [-12, [78, 96, 168]], [-6, [170, 130, 200]], [0, [255, 166, 120]], [6, [255, 214, 160]], [15, [255, 255, 255]]];
  function tintFor(el) {
    if (el <= STOPS[0][0]) return STOPS[0][1];
    for (let i = 1; i < STOPS.length; i++) if (el <= STOPS[i][0]) {
      const [e0, c0] = STOPS[i - 1], [e1, c1] = STOPS[i], k = (el - e0) / (e1 - e0);
      return c0.map((v, j) => Math.round(v + (c1[j] - v) * k));
    }
    return STOPS[STOPS.length - 1][1];
  }
  function todName(el, ha) {
    if (el > 15) return "DAY"; if (el > 0) return ha < 0 ? "MORNING" : "EVENING";
    if (el > -12) return ha < 0 ? "DAWN" : "DUSK"; return "NIGHT";
  }
  const rgb = (c) => `rgb(${c[0]},${c[1]},${c[2]})`;

  // ---------- canvas ----------
  const cv = $("#view"), ctx = cv.getContext("2d"), ic = $("#intro"), ictx = ic.getContext("2d");
  let PX = 3, W = 195, H = 422;
  const LEVELS = [100, 160, 250, 400, 700, 1400, 2800], MAP_LVL = 5; let level = 2; // the last two are map views: whole regions / countries // km across the narrower side of the screen
  let kmPx = 1;
  function resize() {
    const cw = innerWidth, ch = innerHeight, m = Math.min(cw, ch);
    PX = m < 520 ? 2 : m < 1000 ? 3 : 4;
    W = Math.ceil(cw / PX); H = Math.ceil(ch / PX);
    for (const c of [cv, ic]) { c.width = W; c.height = H; c.style.width = W * PX + "px"; c.style.height = H * PX + "px"; }
    ctx.imageSmoothingEnabled = false; ictx.imageSmoothingEnabled = false;
    kmPx = LEVELS[level] / Math.min(W, H * 0.75);
  }
  function setLevel(l) { level = clamp(l, 0, LEVELS.length - 1); kmPx = LEVELS[level] / Math.min(W, H * 0.75); slowAt = 0; }

  function hash(a, b, c) {
    let h = (Math.imul(a | 0, 374761393) + Math.imul(b | 0, 668265263) + Math.imul(c | 0, 2147483647)) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  }

  // view state, set each frame
  let vp = null, cx = 0, cy = 0, sinT = 0, cosT = 1, cosLat = 1, px = 0, py = 0;
  function proj(lat, lon) { // world -> screen (logical px), result in px/py
    let dx = lon - vp.pos.lon; dx = ((dx + 540) % 360) - 180;
    dx *= KM * cosLat; const dy = (lat - vp.pos.lat) * KM;
    px = Math.round(cx + (dx * cosT - dy * sinT) / kmPx);
    py = Math.round(cy - (dx * sinT + dy * cosT) / kmPx);
  }

  const C = { ground: "#5aa04a", gDark: "#4b8a3f", gLight: "#72b95c", tree: "#2f6f3a", treeD: "#245a2e", water: "#3fb8e0", waterD: "#2a7fb5", waterL: "#bdeeff",
    sand: "#e6cf8c", sandD: "#c9a95c", mesa: "#b58a58", mesaD: "#8f6a3f", shallow: "#6fd6ef", bank: "#e9dba6", city: "#9aa0b4", cityD: "#6a7088", win: "#f7d046" };

  function disc(x, y, r, col) {
    r = Math.max(1, Math.round(r)); const y0 = Math.max(0, y - r), y1 = Math.min(H - 1, y + r); ctx.fillStyle = col;
    for (let yy = y0; yy <= y1; yy++) { const dy = yy - y, hw = Math.floor(Math.sqrt(r * r - dy * dy)), x0 = Math.max(0, x - hw), x1 = Math.min(W, x + hw + 1); if (x1 > x0) ctx.fillRect(x0, yy, x1 - x0, 1); }
  }
  function line(x0, y0, x1, y1, t) { // Bresenham, t px thick
    if ((x0 < 0 && x1 < 0) || (y0 < 0 && y1 < 0) || (x0 > W && x1 > W) || (y0 > H && y1 > H)) return;
    if (Math.abs(x1 - x0) + Math.abs(y1 - y0) > 3 * (W + H)) return;
    let dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0), sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1, err = dx + dy;
    for (let n = 0; n < 4000; n++) {
      if (x0 >= -2 && x0 < W && y0 >= -2 && y0 < H) ctx.fillRect(x0, y0, t, t);
      if (x0 === x1 && y0 === y1) break;
      const e2 = 2 * err; if (e2 >= dy) { err += dy; x0 += sx; } if (e2 <= dx) { err += dx; y0 += sy; }
    }
  }
  function put(sp, x, y, bob) { // sprite with drop shadow, anchored bottom-centre
    const dx = Math.round(x - sp.w / 2), dy = Math.round(y - sp.h - (bob || 0));
    if (dx > W || dy > H || dx < -sp.w || dy < -sp.h) return;
    ctx.drawImage(sp.shadow, dx + 2, dy + 3 + (bob || 0)); ctx.drawImage(sp.c, dx, dy);
  }
  const onScreen = (x, y, m) => x > -m && x < W + m && y > -m && y < H + m;

  // ---------- ground texture ----------
  const abgr = (h) => (0xff000000 | (parseInt(h.slice(5, 7), 16) << 16) | (parseInt(h.slice(3, 5), 16) << 8) | parseInt(h.slice(1, 3), 16)) >>> 0;
  const G_FOREST = abgr("#3f9f3a"), G_GRASS = abgr("#62b83a"), G_MEADOW = abgr("#86d048");
  let gImg = null, g32 = null;
  function vn(x, y) { // smooth value noise
    const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi, u = xf * xf * (3 - 2 * xf), w = yf * yf * (3 - 2 * yf);
    const a = hash(xi, yi, 0), b = hash(xi + 1, yi, 0), c = hash(xi, yi + 1, 0), d = hash(xi + 1, yi + 1, 0);
    return a + (b - a) * u + (c - a) * w + (a - b - c + d) * u * w;
  }
  const groundV = (lat, lon) => (kmPx > 3 ? vn(lat * 4.5, lon * 3.6) : vn(lat * 14, lon * 11) * 0.6 + vn(lat * 4.5, lon * 3.6) * 0.4);

  // ---------- coastline: land polygons are filled into an offscreen mask each frame ----------
  const LAND = window.LAND || [], mc = document.createElement("canvas"), mx = mc.getContext("2d", { willReadFrequently: true });
  const sc = document.createElement("canvas"), sx = sc.getContext("2d"); // sea overlay (transparent over land)
  let land = new Uint8Array(1), sImg = null, s32 = null;
  const S_DEEP = abgr("#2e93d6"), S_MID = abgr("#3fb0e4"), S_SHALLOW = abgr("#6fd6ee"), S_FOAM = abgr("#d6f4fb"), S_SAND = abgr("#ecdfa8"), S_SANDD = abgr("#d9c98a");
  function landMask(p) {
    if (mc.width !== W || mc.height !== H) { mc.width = sc.width = W; mc.height = sc.height = H; land = new Uint8Array(W * H); sImg = sx.createImageData(W, H); s32 = new Uint32Array(sImg.data.buffer); }
    mx.clearRect(0, 0, W, H); mx.fillStyle = "#fff";
    const Rk = Math.hypot(W, H) * kmPx * 0.62, latR = Rk / KM, lonR = Rk / (KM * cosLat), la0 = p.pos.lat, lo0 = p.pos.lon;
    for (const poly of LAND) {
      const l0 = poly[0] / 100, a0 = poly[1] / 100, l1 = poly[2] / 100, a1 = poly[3] / 100;
      if (a1 < la0 - latR || a0 > la0 + latR) continue;
      const dl = ((((l0 + l1) / 2 - lo0 + 540) % 360) - 180); if (Math.abs(dl) - (l1 - l0) / 2 > lonR) continue;
      mx.beginPath();
      for (let r = 4; r < poly.length; r++) {
        const ring = poly[r];
        for (let i = 0; i < ring.length; i += 2) {
          let dx = ring[i] / 100 - lo0; dx = (((dx + 540) % 360) - 180) * KM * cosLat; const dy = (ring[i + 1] / 100 - la0) * KM;
          const x = cx + (dx * cosT - dy * sinT) / kmPx, y = cy - (dx * sinT + dy * cosT) / kmPx;
          if (i === 0) mx.moveTo(x, y); else mx.lineTo(x, y);
        }
        mx.closePath();
      }
      mx.fill("evenodd");
    }
    const d = mx.getImageData(0, 0, W, H).data;
    for (let i = 0, n = W * H; i < n; i++) land[i] = d[i * 4 + 3] > 127 ? 1 : 0;
  }
  const isLand = (x, y) => land[(y < 0 ? 0 : y >= H ? H - 1 : y) * W + (x < 0 ? 0 : x >= W ? W - 1 : x)]; // clamped, so screen edges make no false coast
  function groundPass(p) {
    if (!gImg || gImg.width !== W || gImg.height !== H) { gImg = ctx.createImageData(W, H); g32 = new Uint32Array(gImg.data.buffer); }
    landMask(p);
    const lat0 = p.pos.lat, lon0 = p.pos.lon, kx = 1 / (KM * cosLat);
    for (let y = 0; y < H; y += 2) {
      const fwd = (cy - y) * kmPx;
      for (let x = 0; x < W; x += 2) {
        const right = (x - cx) * kmPx, east = right * cosT + fwd * sinT, north = -right * sinT + fwd * cosT, lat = lat0 + north / KM, lon = lon0 + east * kx;
        const i = y * W + x, here = land[Math.min(i + W + 1, W * H - 1)];
        let col, scol = 0;
        if (here) {
          const v = groundV(lat, lon) + (hash(Math.floor(lat * 160), Math.floor(lon * 160), 5) - 0.5) * 0.07;
          col = v < 0.4 ? G_FOREST : v < 0.58 ? G_GRASS : G_MEADOW;
          if (!(isLand(x - 3, y) && isLand(x + 4, y) && isLand(x, y - 3) && isLand(x, y + 4))) scol = hash(x >> 1, y >> 1, 7) < 0.5 ? S_SAND : S_SANDD; // beach
        } else {
          col = G_GRASS;
          if (isLand(x - 3, y) || isLand(x + 4, y) || isLand(x, y - 3) || isLand(x, y + 4)) scol = S_FOAM;
          else if (isLand(x - 7, y - 7) || isLand(x + 8, y + 8) || isLand(x + 8, y - 7) || isLand(x - 7, y + 8) || isLand(x - 9, y) || isLand(x + 10, y) || isLand(x, y - 9) || isLand(x, y + 10)) scol = S_SHALLOW;
          else scol = vn(lat * 40, lon * 32) > 0.72 ? S_MID : vn(lat * 6, lon * 5) < 0.4 ? S_DEEP : S_MID;
        }
        g32[i] = col; if (x + 1 < W) g32[i + 1] = col; if (y + 1 < H) { g32[i + W] = col; if (x + 1 < W) g32[i + W + 1] = col; }
        s32[i] = scol; if (x + 1 < W) s32[i + 1] = scol; if (y + 1 < H) { s32[i + W] = scol; if (x + 1 < W) s32[i + W + 1] = scol; }
      }
    }
    ctx.putImageData(gImg, 0, 0); sx.putImageData(sImg, 0, 0);
  }
  const FLOWERS = ["#ff6fa8", "#ffd84a", "#ffffff", "#ff5a4a", "#b98cff"];
  function tree(x, y) { // round leafy tree with a highlight, a dark underside and a trunk
    ctx.fillStyle = "rgba(10,60,30,.35)"; ctx.fillRect(x + 2, y + 5, 6, 2);
    ctx.fillStyle = "#7a4a24"; ctx.fillRect(x + 3, y + 5, 2, 2);
    ctx.fillStyle = "#1f7a30"; ctx.fillRect(x, y + 1, 6, 4); ctx.fillRect(x + 1, y + 5, 4, 1);
    ctx.fillStyle = "#2e9a3a"; ctx.fillRect(x + 1, y, 4, 4); ctx.fillRect(x, y + 1, 5, 2);
    ctx.fillStyle = "#7ad84e"; ctx.fillRect(x + 1, y, 2, 1); ctx.fillRect(x + 1, y + 1, 1, 1);
  }

  // ---------- per-second work ----------
  const MAP_TYPES = { monument: 1, temple: 1, peak: 1, volcano: 1, dam: 1, canyon: 1 };
  function mapSights(pos, track, R) { // zoomed-out map view: every curated monument / peak in view, whether or not it is visible from the window
    const out = [];
    for (const lm of LANDMARKS) {
      if (!lm.curated || !MAP_TYPES[lm.type]) continue;
      const loc = G.locate(pos, lm); if (loc.d > R) continue;
      const rel = G.relBearing(track, G.bearing(pos, loc));
      out.push({ lm, dist: loc.d, max: R, rel, side: G.sideOf(rel), clock: G.clockOf(rel), score: loc.d / R - (TICK_W[lm.type] || 1) * 0.3, at: { lat: loc.lat, lon: loc.lon } });
    }
    return out.sort((a, b) => a.score - b.score);
  }
  const dbg = { el: null }; // test hook: force the sun's elevation
  let near = null, vis = [], slowAt = 0, sun = { el: 30, ha: 0 }, tint = [255, 255, 255], visIds = new Map();
  function slow(p, ts) {
    vp = p; slowAt = ts;
    const R = Math.hypot(W, H) * kmPx * 0.62, pos = p.pos, dLat = R / KM;
    near = { areas: [], lakes: [], rivers: [], ranges: [], cities: [] };
    for (const lm of LANDMARKS) {
      const rr = (lm.r || 0) / KM;
      if (lm.latLo - dLat - rr > pos.lat || lm.latHi + dLat + rr < pos.lat) continue;
      const loc = G.locate(pos, lm);
      if (loc.d - (lm.r || 0) > R) continue;
      const n = { lm, loc }, t = lm.type;
      if (t === "river" && lm.pts) near.rivers.push(n); else if (t === "lake") near.lakes.push(n); else if (t === "range") near.ranges.push(n);
      else if (t === "city") near.cities.push(n); else if (t === "sea" || t === "desert" || t === "plateau" || t === "island") near.areas.push(n);
    }
    vis = level >= MAP_LVL ? mapSights(pos, p.track, R) : G.visibleNow(LANDMARKS, pos, p.track, Math.max(p.alt, 0), F.vis);
    visIds = new Map(vis.map((v) => [v.lm.id, v]));
    sun = sunAt(pos.lat, pos.lon, nowMs()); if (dbg.el != null) sun.el = dbg.el; tint = tintFor(sun.el);
    const rt = document.documentElement.style, mix = (a, b, k) => Math.round(a + (b - a) * k);
    rt.setProperty("--tint", rgb(tint));
    rt.setProperty("--hud", `rgba(${mix(90, tint[0], .12)},${mix(58, tint[1], .12)},${mix(34, tint[2], .14)},.93)`);
    $("#h-sun").style.background = sun.el > 0 ? "#f7d046" : "#9fb4ff";
    $("#h-tod").textContent = todName(sun.el, sun.ha);
    const solar = (((nowMs() / 3600000 + pos.lon / 15) % 24) + 24) % 24;
    $("#h-clock").textContent = `${String(Math.floor(solar)).padStart(2, "0")}:${String(Math.floor((solar % 1) * 60)).padStart(2, "0")}`;
  }

  // ---------- frame ----------
  let tags = []; // pool of DOM labels
  let hits = [], hov = [];
  function frame(ts) {
    const p = position();
    if (!near || ts - slowAt > 1000 || p.phase === "gate" && ts - slowAt > 400) slow(p, ts);
    vp = p;
    cx = Math.round(W / 2); cy = Math.round(H * (level >= MAP_LVL ? 0.55 : 0.72)); // map views centre the plane so more of the country shows
    const th = rad(p.track); sinT = Math.sin(th); cosT = Math.cos(th); cosLat = Math.max(0.3, Math.cos(rad(p.pos.lat)));
    const bob = Math.floor(ts / 450) % 2;

    // ground: soft patches of forest / grass / meadow from world-fixed noise, then little trees on top
    groundPass(p);
    const Rk = Math.hypot(W, H) * kmPx * 0.6;
    {
      const cellKm = Math.max(4, kmPx * 5), cd = cellKm / KM, dl = Rk / (KM * cosLat);
      const i0 = Math.floor((p.pos.lat - Rk / KM) / cd), i1 = Math.floor((p.pos.lat + Rk / KM) / cd), j0 = Math.floor((p.pos.lon - dl) / cd), j1 = Math.floor((p.pos.lon + dl) / cd);
      for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) {
        const la = (i + hash(i, j, 1)) * cd, lo = (j + hash(i, j, 2)) * cd, v = groundV(la, lo), r = hash(i, j, 0);
        proj(la, lo); if (kmPx > 4 || px < -6 || px > W + 6 || py < -6 || py > H + 6 || !isLand(px, py) || !isLand(px, py + 6)) continue; // no single trees in map views, none at sea
        if (v < 0.4) { if (r < 0.45) tree(px, py); }
        else if (v < 0.58) { if (r < 0.07) tree(px, py); else if (r < 0.13) { ctx.fillStyle = FLOWERS[Math.floor(hash(i, j, 3) * 5)]; ctx.fillRect(px, py, 2, 2); } }
        else if (r < 0.17) { ctx.fillStyle = FLOWERS[Math.floor(hash(i, j, 3) * 5)]; ctx.fillRect(px, py, 2, 2); ctx.fillStyle = "#3d9a2e"; ctx.fillRect(px, py + 2, 1, 1); }
      }
    }
    // areas: sea / desert / plateau / islands
    for (const n of near.areas) {
      const lm = n.lm, rp = (lm.r || 20) / kmPx; if (lm.type === "sea" || lm.type === "island" || lm.r > 250) continue; // seas and islands come from the coastline now; huge plateaus: sprite only
      proj(lm.lat, lm.lon);
      if (px + rp < 0 || px - rp > W || py + rp < 0 || py - rp > H) continue;
      if (lm.type === "sea") { disc(px, py, rp + 2, C.bank); disc(px, py, rp + 1, C.waterD); disc(px, py, rp, C.water); }
      else if (lm.type === "desert") { disc(px, py, rp, C.sand); ctx.fillStyle = C.sandD; for (let k = 0; k < Math.min(90, rp * rp / 14); k++) { const a = hash(lm.id, k, 1) * 6.283, d = Math.sqrt(hash(lm.id, k, 2)) * rp * 0.95; ctx.fillRect(Math.round(px + Math.cos(a) * d), Math.round(py + Math.sin(a) * d), 2, 1); } }
      else if (lm.type === "plateau") { disc(px, py, rp, C.mesaD); disc(px, py - 1, rp - 1, C.mesa); }
      else { disc(px, py, rp, C.shallow); for (let k = 0; k < 6; k++) { const a = hash(lm.id, k, 1) * 6.283, d = Math.sqrt(hash(lm.id, k, 2)) * rp * 0.7; disc(Math.round(px + Math.cos(a) * d), Math.round(py + Math.sin(a) * d), 2 + hash(lm.id, k, 3) * 3, C.sand); } }
    }
    ctx.drawImage(sc, 0, 0); // sea and beaches on top of anything that spilled over the coast
    for (const n of near.lakes) {
      const lm = n.lm, rp = Math.max(2, (lm.r || 3) / kmPx); proj(lm.lat, lm.lon);
      if (px + rp < 0 || px - rp > W || py + rp < 0 || py - rp > H) continue;
      disc(px, py, rp + 2, C.bank); disc(px, py, rp + 1, C.waterD); disc(px, py, rp, C.water);
      ctx.fillStyle = C.waterL; for (let k = 0; k < 4 && rp > 4; k++) if ((Math.floor(ts / 500) + k) % 3 === 0) ctx.fillRect(Math.round(px + (hash(lm.id, k, 1) - .5) * rp * 1.2), Math.round(py + (hash(lm.id, k, 2) - .5) * rp * 1.2), 2, 1);
    }
    const rw = kmPx < 1.3 ? 2 : 1;
    for (const n of near.rivers) {
      const pts = n.lm.pts, step = pts.length > 1600 ? 4 : 2, xs = [], ys = [];
      if (kmPx > 3 && pts.length * 12.5 < kmPx * 40) continue; // map views: only the long rivers, or the land turns into a web
      for (let i = 0; i < pts.length; i += step) { proj(pts[i], pts[i + 1]); xs.push(px); ys.push(py); }
      const jump = 200 / kmPx; // the data joins separate pieces of a river end to end: never draw a link longer than 200 km
      const gap = (k) => Math.abs(xs[k] - xs[k - 1]) > jump || Math.abs(ys[k] - ys[k - 1]) > jump;
      ctx.fillStyle = C.bank; for (let k = 1; k < xs.length; k++) if (!gap(k)) line(xs[k - 1] - 1, ys[k - 1] - 1, xs[k] - 1, ys[k] - 1, rw + 2); // sandy banks first
      ctx.fillStyle = C.water; for (let k = 1; k < xs.length; k++) if (!gap(k)) line(xs[k - 1], ys[k - 1], xs[k], ys[k], rw);
    }
    // hills (mountain ranges are scattered hill sprites)
    for (const n of near.ranges) {
      const lm = n.lm, rk = lm.r || 40, cnt = clamp(Math.round(Math.PI * rk * rk / 180), 8, 70), snow = /himalaya|alps|andes|karakoram|hindu kush|rocky|caucasus|pamir|tian|kunlun|altai/i.test(lm.name);
      const cl = Math.max(0.3, Math.cos(rad(lm.lat)));
      for (let k = 0; k < cnt; k++) {
        const a = hash(lm.id, k, 1) * 6.283, d = Math.sqrt(hash(lm.id, k, 2)) * rk;
        proj(lm.lat + (Math.sin(a) * d) / KM, lm.lon + (Math.cos(a) * d) / (KM * cl));
        if (onScreen(px, py, 10)) { const sn = snow && hash(lm.id, k, 3) < 0.45; put(kmPx > 3 ? (sn ? S.hillSnowS : S.hillS) : (sn ? S.hillSnow : S.hill), px, py); }
      }
    }
    for (const n of near.cities) {
      const lm = n.lm; proj(lm.lat, lm.lon); if (!onScreen(px, py, 12)) continue;
      const sz = clamp(6 / kmPx * 10, 5, 14);
      for (let k = 0; k < 6; k++) {
        const bx = Math.round(px + (hash(lm.id, k, 1) - .5) * sz * 2), by = Math.round(py + (hash(lm.id, k, 2) - .5) * sz), bh = 2 + Math.floor(hash(lm.id, k, 3) * 4);
        ctx.fillStyle = C.cityD; ctx.fillRect(bx + 1, by - bh + 1, 3, bh + 1); ctx.fillStyle = C.city; ctx.fillRect(bx, by - bh, 3, bh + 1);
      }
    }

    // markers for what is visible from the window, drawn as sprites on their true side of the plane
    hits = []; const labelCands = [];
    for (const v of vis) {
      proj(v.at.lat, v.at.lon);
      const x = px, y = py;
      if (!onScreen(x, y, 14)) continue;
      const sp = SP.spriteOf(v.lm.type);
      put(sp, x, y, bob);
      hits.push({ x: x * PX, y: (y - sp.h / 2) * PX, v });
      labelCands.push({ v, x, y });
    }

    hov = []; // terrain you can point at (not necessarily visible from the window): cities, lakes, rivers, ranges
    for (const grp of [near.cities, near.lakes, near.ranges, near.rivers]) for (const n of grp) { const lm = n.lm; proj(lm.lat, lm.lon); if (px > 0 && px < W && py > 0 && py < H) hov.push({ x: px * PX, y: py * PX, v: { lm, at: { lat: lm.lat, lon: lm.lon }, score: 9 } }); }

    // clouds with a little parallax (they sit above the ground): shadows first, then the puffy white bodies with blue undersides
    {
      const cover = (F.vis >= 1 ? 0.1 : F.vis >= 0.75 ? 0.2 : 0.35) * (kmPx > 3 ? 0.45 : 1), cellKm = Math.max(70, kmPx * 28), cd = cellKm / KM, dl = Rk / (KM * cosLat), cl = [];
      const i0 = Math.floor((p.pos.lat - Rk / KM) / cd), i1 = Math.floor((p.pos.lat + Rk / KM) / cd), j0 = Math.floor((p.pos.lon - dl) / cd), j1 = Math.floor((p.pos.lon + dl) / cd);
      for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) {
        if (hash(i, j, 9) > cover) continue;
        proj((i + hash(i, j, 4)) * cd, (j + hash(i, j, 5)) * cd);
        const x = Math.round(cx + (px - cx) * 1.35), y = Math.round(cy + (py - cy) * 1.35), w = 24 + Math.floor(hash(i, j, 6) * 34);
        if (x < -w || x > W + w || y < -24 || y > H + 24) continue;
        cl.push({ x, y, w, s: i * 131 + j });
      }
      ctx.fillStyle = "rgba(10,30,60,0.17)"; for (const c of cl) cloudSpans(c, 8, 12, (yy, x0, x1) => ctx.fillRect(x0, yy, x1 - x0, 1));
      for (const c of cl) { let bot = -1e9; cloudSpans(c, 0, 0, (yy) => { if (yy > bot) bot = yy; });
        cloudSpans(c, 0, 0, (yy, x0, x1) => { ctx.fillStyle = yy >= bot - 1 ? "#9cc4ee" : yy >= bot - 3 ? "#cfe3f8" : "#ffffff"; ctx.fillRect(x0, yy, x1 - x0, 1); }); }
    }

    // plane (prop plane with a spinning propeller)
    const alt01 = vp.phase === "air" ? clamp(vp.alt / 10, 0.1, 1) : 0, off = Math.round(2 + 8 * alt01);
    const pl = S.plane, plx = cx - 12, ply = cy - 11;
    if (vp.phase === "air") { for (let k = 0; k < 14; k++) { ctx.fillStyle = `rgba(255,255,255,${(0.7 - k * 0.05).toFixed(2)})`; ctx.fillRect(cx - 11, ply + 11 + k * 2, 1, 1); ctx.fillRect(cx + 11, ply + 11 + k * 2, 1, 1); } }
    ctx.drawImage(pl.shadow, plx + off, ply + off + 2); ctx.drawImage(pl.c, plx, ply);
    { const f = Math.floor(ts / 55) % 3; ctx.fillStyle = "rgba(40,44,60,.55)";
      if (f === 0) ctx.fillRect(cx - 9, ply - 1, 19, 2); else if (f === 1) { ctx.fillRect(cx - 6, ply - 3, 13, 1); ctx.fillRect(cx - 9, ply, 19, 1); } else ctx.fillRect(cx - 8, ply - 2, 17, 2); }

    // time of day: tint everything below, then lights on top
    ctx.globalCompositeOperation = "multiply"; ctx.fillStyle = rgb(tint); ctx.fillRect(0, 0, W, H); ctx.globalCompositeOperation = "source-over";
    const dark = clamp((-sun.el - 2) / 9, 0, 1);
    if (dark > 0.02) {
      ctx.globalAlpha = dark; ctx.fillStyle = C.win;
      for (const n of near.cities) { const lm = n.lm; proj(lm.lat, lm.lon); if (!onScreen(px, py, 20)) continue; for (let k = 0; k < 14; k++) ctx.fillRect(Math.round(px + (hash(lm.id, k, 7) - .5) * 20), Math.round(py + (hash(lm.id, k, 8) - .5) * 11), 1, 1); }
      for (const l of labelCands) if (l.v.lm.type === "city") { ctx.fillRect(l.x - 5, l.y - 2, 2, 2); ctx.fillRect(l.x + 3, l.y - 6, 2, 2); }
      ctx.globalAlpha = 1;
    }
    if (dark > 0.02) { ctx.globalAlpha = 0.55 * dark; ctx.drawImage(pl.c, plx, ply); ctx.globalAlpha = 1; } // keep the plane readable at night
    const blink = Math.floor(ts / 500) % 2;
    const used = routeLine(vp, ply, cx);
    ctx.fillStyle = "#ff3b3b"; ctx.fillRect(plx - 1, ply + 6, 2, 2); ctx.fillStyle = "#3bff6b"; ctx.fillRect(plx + 24, ply + 6, 2, 2);
    if (blink) { ctx.fillStyle = "#fff"; ctx.fillRect(cx, ply + 20, 1, 2); }
    const pg = $("#prog"); pg.style.left = cx * PX + "px"; pg.style.top = (ply + 25) * PX + "px"; $("#prog-fill").style.width = Math.round(vp.frac * 100) + "%";

    // labels (DOM, so the pixel font stays crisp), highest-priority first, no overlaps
    placeTags(labelCands, used);
  }

  function cloudSpans(c, ox, oy, fn) { // union of 5 round puffs, one horizontal span per row
    const puffs = [];
    for (let k = 0; k < 5; k++) { const t = k / 4; puffs.push([c.x + (t - 0.5) * c.w * 0.9, c.y - Math.sin(t * 3.14) * c.w * 0.1 + (hash(c.s, k, 1) - 0.5) * 3, c.w * (0.14 + 0.1 * Math.sin(t * 3.14) + hash(c.s, k, 2) * 0.05)]); }
    let y0 = 1e9, y1 = -1e9; for (const q of puffs) { y0 = Math.min(y0, q[1] - q[2]); y1 = Math.max(y1, q[1] + q[2]); }
    for (let yy = Math.floor(y0); yy <= Math.ceil(y1); yy++) {
      let lo = 1e9, hi = -1e9;
      for (const q of puffs) { const dy = yy - q[1]; if (Math.abs(dy) <= q[2]) { const hw = Math.sqrt(q[2] * q[2] - dy * dy); lo = Math.min(lo, q[0] - hw); hi = Math.max(hi, q[0] + hw); } }
      if (hi > lo) fn(yy + oy, Math.round(lo) + ox, Math.round(hi) + ox);
    }
  }

  // ---------- the route line: it leaves the plane's nose; sights are pinned on it with their distance ahead ----------
  let rts = [];
  function routeLine(p, ply, cx0) {
    const y0 = ply - 4, ytop = Math.ceil(((cx0 * PX > hudRight + 40) ? 56 : hudBottom + 30) / PX), used = [], wrap = $("#tags");
    const along = p.frac * F.dist, aheadDest = F.dist - along, mapV = level >= MAP_LVL, yk = y0 - (y0 - ytop) * 0.55, A0 = mapV ? 1e9 : (y0 - yk) * kmPx, Amax = Math.max(A0 * 1.05, F.dist); // fixed for the whole flight, so the flag moves toward the plane as it advances
    const yOf = (a) => (a <= A0 ? y0 - a / kmPx : yk - Math.min(1, Math.log(1 + (a - A0) / A0) / Math.log(1 + (Amax - A0) / A0)) * (yk - ytop));
    const flagY = clamp(Math.round(yOf(aheadDest)), ytop, y0 - 14); // map views: the line is to scale, so the flag sits where the airport really is
    ctx.fillStyle = "#f7c860"; for (let y = y0; y > flagY; y -= 6) ctx.fillRect(cx0 - 1, y - 3, 2, 3);
    const last = { l: y0 + 12, r: y0 + 12 }, cnt = { l: 0, r: 0 }; let n = 0;
    ctx.drawImage(S.flag.c, cx0 + 1, flagY - 8);
    for (const t of tickData) {
      const ahead = t.alongKm - along; if (ahead < 2) continue; if (n >= 8) break;
      const sd = t.rel < 0 ? "l" : "r", y = Math.round(yOf(ahead)); // left window sights go on the left of the line, right window on the right
      if (y < flagY + 16 || last[sd] - y < 16 || cnt[sd] >= 4) continue; last[sd] = y; cnt[sd]++;
      const bx = sd === "r" ? cx0 + 4 : cx0 - 17;
      ctx.fillStyle = "#2a1a0e"; ctx.fillRect(bx, y - 7, 14, 14); ctx.fillStyle = "#f7c860"; ctx.fillRect(bx, y - 7, 14, 1); ctx.fillRect(bx, y + 6, 14, 1); ctx.fillRect(bx, y - 7, 1, 14); ctx.fillRect(bx + 13, y - 7, 1, 14);
      const sp = SP.spriteOf(t.lm.type); ctx.drawImage(sp.c, bx + 1 + ((12 - sp.w) >> 1), y - 6 + 12 - sp.h);
      ctx.fillStyle = "#f7c860"; ctx.fillRect(sd === "r" ? cx0 - 3 : cx0 - 4, y - 1, 7, 3);
      let el = rts[n]; if (!el) { el = document.createElement("div"); el.className = "rt"; el.addEventListener("click", () => el._r && openCard(el._r)); wrap.appendChild(el); rts[n] = el; }
      const txt = "+" + Math.round(ahead) + "KM"; if (el._t !== txt) { el.textContent = txt; el._t = txt; }
      const lx = sd === "r" ? cx0 + 20 : cx0 - 19, tw = txt.length * 8 + 10;
      el._r = t; el.classList.toggle("near", ahead < 60); el.classList.toggle("l", sd === "l"); el.classList.remove("dest"); el.style.left = lx * PX + "px"; el.style.top = y * PX + "px"; el.hidden = false;
      used.push({ x: lx * PX + (sd === "r" ? tw / 2 : -tw / 2), y: y * PX, w: tw }); hits.push({ x: (bx + 7) * PX, y: y * PX, v: t }); n++;
    }
    let el = rts[n]; if (!el) { el = document.createElement("div"); el.className = "rt"; wrap.appendChild(el); rts[n] = el; }
    const dt = `${F.b.code} ${Math.round(aheadDest)}KM`; if (el._t !== dt) { el.textContent = dt; el._t = dt; el._r = null; }
    el.classList.add("dest"); el.classList.remove("near", "l"); el.style.left = (cx0 + 12) * PX + "px"; el.style.top = (flagY - 4) * PX + "px"; el.hidden = false; n++;
    for (let i = n; i < rts.length; i++) rts[i].hidden = true;
    return used;
  }

  const TAG_COL = { peak: "#d9b38a", range: "#d9b38a", volcano: "#f08a24", river: "#5ad1f0", lake: "#5ad1f0", sea: "#5ad1f0", city: "#7ee06a", temple: "#f7d046", monument: "#f7d046" };
  function placeTags(cands, used0) {
    const wrap = $("#tags"), max = level >= MAP_LVL ? 16 : 9, used = used0 ? used0.slice() : [];
    cands.sort((a, b) => a.v.score - b.v.score); let n = 0;
    for (const c of cands) {
      if (n >= max) break;
      const name = c.v.lm.name.replace(/\s*\((lake|river)\)$/i, "").toUpperCase().slice(0, 16);
      const x = c.x * PX, y = (c.y + 2) * PX, w = name.length * 8 + 14, h = 18;
      if (x - w / 2 < 4 || x + w / 2 > innerWidth - 4 || y < 100 || y > innerHeight - 40) continue;
      if (used.some((u) => Math.abs(u.x - x) < (u.w + w) / 2 && Math.abs(u.y - y) < h + 2)) continue;
      used.push({ x, y, w });
      let el = tags[n]; if (!el) { el = document.createElement("div"); el.className = "tag"; el.addEventListener("click", () => el._v && openCard(el._v)); wrap.appendChild(el); tags[n] = el; }
      if (el._name !== name) { el.textContent = name; el._name = name; }
      el._v = c.v; el.style.setProperty("--tc", TAG_COL[c.v.lm.type] || "#f7d046"); el.style.left = x + "px"; el.style.top = y + "px"; el.hidden = false; n++;
    }
    for (let i = n; i < tags.length; i++) tags[i].hidden = true;
  }

  // ---------- HUD ----------
  let hudAt = 0, tickData = [], hudBottom = 120, hudRight = 540;
  function hud(p, ts) {
    if (ts - hudAt < 250) return; hudAt = ts;
    const ph = { gate: `BOARDING · DEPARTS IN ${dur((F.dep - nowMs()) / 60000)}`, taxi: `TAXI · RWY ${String(Math.round(F.path.depHdg / 10) % 36 || 36).padStart(2, "0")} · WHEELS UP ${hhmm(F.takeoff)}`, air: `AIRBORNE ${dur(p.t)} · ${dur(F.profile.T - p.t)} TO GO`, landed: "LANDED · WELCOME!" }[p.phase];
    $("#h-phase").textContent = (p.gps ? "GPS · " : "") + ph;
    $("#h-alt").textContent = p.alt > 0.05 ? "FL" + String(Math.round(p.alt * 32.81)).padStart(3, "0") : "GND";
    $("#h-spd").textContent = p.spd ? Math.round(p.spd) : "0";
    $("#h-hdg").textContent = String(Math.round(p.track) % 360).padStart(3, "0") + compassOf(p.track);
    $("#h-pct").textContent = Math.round(p.frac * 100) + "%";
    $("#compass-n").style.transform = `rotate(${(-p.track).toFixed(0)}deg)`;
    $("#warp-lbl").textContent = simMin == null ? "LIVE " + hhmm(Date.now()) : `T${simMin >= 0 ? "+" : ""}${Math.round(simMin)}M · ${hhmm(nowMs())}`;

    const st = $(".hud.stats").getBoundingClientRect(); hudBottom = st.bottom; hudRight = st.right;
  }

  // ---------- sight card ----------
  const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);
  const nearestAirport = (at) => { let best = null, bd = 1e9; for (const a of Object.values(AIRPORTS)) { const d = G.haversine(at, a); if (d < bd) { bd = d; best = a; } } return { a: best, d: bd }; };
  let cardTok = 0;
  function openCard(item) {
    const lm = item.lm, p = vp || position(), pl = planById.get(lm.id), at = item.at || (pl && pl.at) || { lat: lm.lat, lon: lm.lon }, tok = ++cardTok;
    const name = Info.titleOf(lm);
    $("#c-name").textContent = name.toUpperCase(); $("#c-type").textContent = SP.labelOf(lm.type);
    const ic = $("#c-icon"), x = ic.getContext("2d"); x.clearRect(0, 0, 12, 12); const sp = SP.spriteOf(lm.type); x.drawImage(sp.c, Math.floor((12 - sp.w) / 2), 12 - sp.h);
    const rel = G.relBearing(p.track, G.bearing(p.pos, at)), side = G.sideOf(rel), clock = G.clockOf(rel), d = G.haversine(p.pos, at), na = nearestAirport(at);
    const facts = [["FROM PLANE", `${Math.round(d)} KM · ${side.toUpperCase()}`], ["LOOK AT", `${clock} O'CLOCK`], ["NEAREST AIRPORT", `${na.a.code} · ${Math.round(na.d)} KM`]];
    if (pl) facts.push(["CLOSEST AT", hhmm(F.takeoff + pl.tMin * 60000)]);
    if (lm.elev > 0) facts.push(["HEIGHT", `${Math.round(lm.elev)} M`]);
    $("#c-facts").innerHTML = facts.map(([k, v]) => `<div><dt>${k}</dt><dd>${esc(v)}</dd></div>`).join("");

    const fill = (info) => { // text blocks: intro, relevance, from the air
      const flight = pl ? ` On this flight it is seen from the ${pl.side} window about ${Math.round(pl.tMin)} min after takeoff, ${Math.round(pl.dist)} km away at the closest.` : "";
      $("#c-note").textContent = (info && info.x) || lm.note || "";
      $("#c-why p").textContent = ((info && info.d ? cap(info.d) + "." : SP.labelOf(lm.type) + " on the route.") + flight).trim();
      const air = $("#c-air"); air.hidden = !(info && info.x && lm.note); if (!air.hidden) $("#c-air p").textContent = lm.note;
      const src = $("#c-src"); src.hidden = !(info && info.p); if (info && info.p) src.href = info.p;
    };
    const cachedInfo = Info.cached(lm); fill(cachedInfo);
    const shots = $("#c-shots"); shots.hidden = false; shots.innerHTML = ""; $("#c-src").hidden = true;
    const showShots = async (info) => {
      if (tok !== cardTok) return;
      if (!info || !info.i.length) { shots.innerHTML = `<div class="msg">${navigator.onLine === false ? "PHOTOS NEED A CONNECTION. THEY ARE SAVED WHEN THE FLIGHT IS SET UP ONLINE." : "NO PHOTOS FOUND FOR THIS PLACE."}</div>`; return; }
      shots.innerHTML = "";
      for (const im of info.i.slice(0, 3)) {
        const b = document.createElement("button"); b.type = "button"; b.className = "shot"; b.setAttribute("aria-label", "Open photo of " + name);
        const img = new Image(); img.alt = name; img.decoding = "async"; b.appendChild(img); shots.appendChild(b);
        b.addEventListener("click", () => openShot(img.src, name));
        Info.imgSrc(im.u).then((s) => { if (tok !== cardTok) return; if (s) img.src = s; else b.remove(); });
        img.addEventListener("error", () => b.remove());
      }
    };
    if (cachedInfo) showShots(cachedInfo);
    else { shots.innerHTML = `<div class="msg">${navigator.onLine === false ? "NO SAVED WRITE-UP OR PHOTOS FOR THIS PLACE YET." : "LOADING PHOTOS..."}</div>`; Info.get(lm).then((info) => { if (tok !== cardTok) return; fill(info); showShots(info); }); }
    $("#card").hidden = false;
  }
  function openShot(src, name) { $("#shot-img").src = src; $("#shot-img").alt = name; $("#shot-title").textContent = name; $("#shot").hidden = false; }
  const closeShot = () => ($("#shot").hidden = true);
  const closeCard = () => { cardTok++; $("#card").hidden = true; closeShot(); };

  // ---------- loop ----------
  let running = false, lastTs = 0;
  function loop(ts) {
    if (!running) return; requestAnimationFrame(loop);
    if (ts - lastTs < 33) return; lastTs = ts;
    if (!F) return;
    frame(ts); hud(vp, ts);
  }
  const start = () => { if (!running) { running = true; requestAnimationFrame(loop); } };
  const stop = () => { running = false; };
  document.addEventListener("visibilitychange", () => { if (document.hidden) stop(); else if (!$("#game").hidden) start(); });

  // ---------- screens ----------
  let introPlayed = false;
  const reduced = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
  function showMenu() {
    stop(); $("#menu").hidden = false; $("#game").hidden = true;
    $("#back").hidden = !F; if (F) $("#back").textContent = `CONTINUE ${F.a.code}>${F.b.code}`;
    renderSaved(); $("#menu").scrollTop = 0;
  }
  function enterGame() {
    $("#menu").hidden = true; $("#game").hidden = false; resize(); slowAt = 0; hudAt = 0; start();
    if (!introPlayed) { introPlayed = true; if (!reduced()) playIntro(); }
  }

  // ---------- window intro: the shade lifts, then the camera zooms through the glass ----------
  const WALL = "#d8d2c2";
  function rrRows(x, y, w, h, r, fn) { // rounded rectangle, one row at a time
    r = Math.min(r, w >> 1, h >> 1); const top = Math.round(y - h / 2), bot = top + Math.round(h);
    for (let yy = top; yy < bot; yy++) {
      const d = Math.min(yy - top, bot - 1 - yy), inset = d >= r ? 0 : Math.round(r - Math.sqrt(Math.max(0, r * r - (r - d - 0.5) ** 2)));
      fn(yy, Math.round(x - w / 2) + inset, Math.round(x + w / 2) - inset);
    }
  }
  function rr(c, x, y, w, h, r, col) { c.fillStyle = col; rrRows(x, y, w, h, r, (yy, x0, x1) => c.fillRect(x0, yy, x1 - x0, 1)); }
  function playIntro() {
    ic.hidden = false;
    const hw = Math.round(Math.min(W * 0.62, H * 0.4, 130)), hh = Math.round(Math.min(hw * 1.3, H * 0.7)), mx = W >> 1, my = H >> 1;
    const sMax = Math.max(W / hw, H / hh) * 1.8, T = { hold: 0.7, open: 1.5, wait: 0.5, zoom: 1.7 }, total = T.hold + T.open + T.wait + T.zoom;
    let t0 = null, done = false;
    const finish = () => { if (done) return; done = true; ic.hidden = true; removeEventListener("keydown", finish); ic.removeEventListener("pointerdown", finish); };
    addEventListener("keydown", finish); ic.addEventListener("pointerdown", finish);
    function draw(t) {
      const c = ictx; c.globalCompositeOperation = "source-over"; c.clearRect(0, 0, W, H);
      c.fillStyle = WALL; c.fillRect(0, 0, W, H);
      const zt = clamp((t - T.hold - T.open - T.wait) / T.zoom, 0, 1), s = Math.round((1 + (sMax - 1) * zt * zt) * 12) / 12;
      c.fillStyle = "#c9c2b0"; for (let y = Math.round(my - (my / s)) % 18; y < H; y += 18) c.fillRect(0, y, W, 1);
      const w = Math.round(hw * s), h = Math.round(hh * s), r = Math.round(w * 0.42), u = Math.max(2, Math.round(3 * s));
      rr(c, mx, my + u, w + 4 * u, h + 4 * u, r + 2 * u, "#a39d8a");
      rr(c, mx, my, w + 4 * u, h + 4 * u, r + 2 * u, "#f1ede2");
      rr(c, mx, my, w + 2 * u, h + 2 * u, r + u, "#6b6f80");
      c.globalCompositeOperation = "destination-out"; rr(c, mx, my, w, h, r, "#000"); c.globalCompositeOperation = "source-over";
      const op = clamp((t - T.hold) / T.open, 0, 1), cover = Math.round((1 - op) * 12) / 12 * h; // shade slides up in steps
      if (cover > 0) {
        const top = Math.round(my - h / 2);
        rrRows(mx, my, w, h, r, (yy, x0, x1) => { if (yy < top + cover) { c.fillStyle = ((yy - top) % Math.max(4, Math.round(6 * s)) === 0) ? "#c3cddd" : "#e9eff7"; c.fillRect(x0, yy, x1 - x0, 1); } });
        c.fillStyle = "#8d98ad"; c.fillRect(mx - Math.round(8 * s), Math.round(top + cover - 2 * s), Math.round(16 * s), Math.max(2, Math.round(3 * s)));
      }
    }
    function step(now) {
      if (done) return; if (t0 == null) t0 = now; const t = (now - t0) / 1000;
      if (t >= total) { finish(); return; }
      draw(t); requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
  }

  // ---------- form ----------
  const toLocalInput = (ms) => new Date(ms - new Date(ms).getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  function renderSaved() {
    $("#saved-wrap").hidden = !state.flights.length;
    $("#saved").innerHTML = state.flights.map((f) => {
      const a = AIRPORTS[f.from], b = AIRPORTS[f.to]; if (!a || !b) return "";
      return `<div class="saved" data-id="${f.id}"><div class="t"><b>${a.code}>${b.code}</b><small>${new Intl.DateTimeFormat([], { timeZone: a.tz, dateStyle: "medium", timeStyle: "short" }).format(new Date(f.dep))}${f.arr ? " · " + dur((f.arr - f.dep) / 60000) : ""}</small></div><button class="x" type="button" aria-label="Delete flight" data-del="${f.id}">X</button></div>`;
    }).join("");
  }
  function netGps(on) {
    if (!on) { if (gpsWatch != null && navigator.geolocation) navigator.geolocation.clearWatch(gpsWatch); gpsWatch = null; gpsFix = null; return; }
    if (!navigator.geolocation) return; let last = null;
    gpsWatch = navigator.geolocation.watchPosition((pos) => {
      const c = pos.coords, cur = { lat: c.latitude, lon: c.longitude };
      let track = c.heading; if ((track == null || isNaN(track)) && last) track = G.bearing(last, cur);
      if (!last || G.haversine(last, cur) > 0.5) last = cur;
      gpsFix = { ...cur, track: track == null || isNaN(track) ? undefined : track, alt: c.altitude ? c.altitude / 1000 : undefined, spd: c.speed ? c.speed * 3.6 : undefined };
    }, () => { gpsFix = null; }, { enableHighAccuracy: true, maximumAge: 5000 });
  }

  function drawSpriteTo(canvas, sp) { canvas.width = sp.w; canvas.height = sp.h; const x = canvas.getContext("2d"); x.drawImage(sp.c, 0, 0); }

  function init() {
    $("#ap-list").innerHTML = Object.values(AIRPORTS).map((a) => `<option value="${a.code} — ${esc(a.city)}">${esc(a.name)}</option>`).join("");
    const fillTimes = () => { // default: leave in 2 hours; arrival guessed from the distance, both as local airport times
      const a = airportFrom($("#f-from").value), b = airportFrom($("#f-to").value), t0 = Math.ceil((Date.now() + 2 * 3600e3) / 300000) * 300000;
      const fmt = (ms, tz) => { const p = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).formatToParts(new Date(ms)).map((x) => [x.type, x.value])); return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`; };
      const tzA = a ? a.tz : Intl.DateTimeFormat().resolvedOptions().timeZone, tzB = b ? b.tz : tzA, km = a && b && a !== b ? G.haversine(a, b) : 800;
      if (!$("#f-dep").dataset.touched) $("#f-dep").value = fmt(t0, tzA);
      if (!$("#f-arr").dataset.touched) $("#f-arr").value = fmt(wallToUtc($("#f-dep").value, tzA) + Math.round(km / 750 * 60 + 35) * 60000, tzB);
    };
    for (const id of ["#f-from", "#f-to"]) $(id).addEventListener("change", fillTimes);
    $("#f-dep").addEventListener("change", () => { $("#f-dep").dataset.touched = 1; delete $("#f-arr").dataset.touched; fillTimes(); });
    $("#f-arr").addEventListener("change", () => { $("#f-arr").dataset.touched = 1; });
    fillTimes();
    drawSpriteTo($("#logo-plane"), S.plane); drawSpriteTo($("#fly-plane"), S.plane);
    resize(); addEventListener("resize", resize);

    $("#form").addEventListener("submit", (e) => {
      e.preventDefault();
      const err = $("#form-err"); err.hidden = true; const fail = (m) => { err.textContent = m; err.hidden = false; };
      const a = airportFrom($("#f-from").value), b = airportFrom($("#f-to").value);
      if (!a || !b) return fail("PICK AIRPORTS FROM THE LIST (E.G. DEL). MORE CAN BE ADDED IN DATA/AIRPORTS.JS");
      if (a.code === b.code) return fail("FROM AND TO ARE THE SAME AIRPORT");
      const dep = wallToUtc($("#f-dep").value, a.tz), arr = wallToUtc($("#f-arr").value, b.tz);
      if (!dep) return fail("ENTER THE DEPARTURE DATE AND TIME");
      if (!arr) return fail("ENTER THE ARRIVAL DATE AND TIME");
      const block = (arr - dep) / 60000; if (block < 25) return fail("ARRIVAL MUST BE AFTER DEPARTURE. USE LOCAL TIMES AT EACH AIRPORT");
      const km = G.haversine(a, b); if (km / ((block - 20) / 60) > 1050) return fail("THAT IS TOO FAST FOR " + Math.round(km) + " KM. CHECK THE TIMES AND DATES");
      const f = { id: "f" + Date.now().toString(36), from: a.code, to: b.code, dep, arr };
      state.flights.unshift(f); activate(f.id); enterGame();
    });
    $("#demo").addEventListener("click", () => {
      const dep = Date.now() + 40 * 60000, f = { id: "f" + Date.now().toString(36), from: "DEL", to: "KTM", dep, arr: dep + 105 * 60000 };
      state.flights.unshift(f); activate(f.id); simMin = 30; $("#warp-range").value = 30; enterGame();
    });
    $("#back").addEventListener("click", enterGame);
    $("#saved").addEventListener("click", (e) => {
      const del = e.target.closest("[data-del]");
      if (del) { state.flights = state.flights.filter((f) => f.id !== del.dataset.del); if (state.active === del.dataset.del) { state.active = null; F = null; } store.save(state); showMenu(); return; }
      const card = e.target.closest("[data-id]"); if (card) { activate(card.dataset.id); enterGame(); }
    });

    $("#menu-btn").addEventListener("click", showMenu);
    $("#zoom-in").addEventListener("click", () => setLevel(level - 1)); $("#zoom-out").addEventListener("click", () => setLevel(level + 1));
    $("#warp-btn").addEventListener("click", () => ($("#warp").hidden = !$("#warp").hidden));
    $("#warp-range").addEventListener("input", (e) => { simMin = +e.target.value; slowAt = 0; hudAt = 0; });
    $("#warp-live").addEventListener("click", () => { simMin = null; $("#warp-range").value = 0; slowAt = 0; hudAt = 0; });
    $("#c-close").addEventListener("click", closeCard);
    $("#card").addEventListener("click", (e) => { if (e.target.id === "card") closeCard(); });
    $("#shot-close").addEventListener("click", closeShot);
    $("#shot").addEventListener("click", (e) => { if (e.target.id === "shot") closeShot(); });
    addEventListener("keydown", (e) => { if (e.key === "Escape") { if (!$("#shot").hidden) closeShot(); else closeCard(); } });
    const pick = (e) => {
      let best = null, bd = 28 * 28; for (const h of hits) { const d = (h.x - e.clientX) ** 2 + (h.y - e.clientY) ** 2; if (d < bd) { bd = d; best = h; } }
      if (!best) { bd = 22 * 22; for (const h of hov) { const d = (h.x - e.clientX) ** 2 + (h.y - e.clientY) ** 2; if (d < bd) { bd = d; best = h; } } }
      return best;
    };
    cv.addEventListener("pointerup", (e) => { const b = pick(e); if (b) openCard(b.v); });
    const tip = document.createElement("div"); tip.id = "hover"; tip.hidden = true; $("#game").appendChild(tip);
    cv.addEventListener("pointermove", (e) => { // mouse hover: name, kind and distance of whatever is under the pointer
      if (e.pointerType === "touch" || !vp) return;
      const b = pick(e); cv.style.cursor = b ? "pointer" : "";
      if (!b) { tip.hidden = true; return; }
      const lm = b.v.lm, at = b.v.at || { lat: lm.lat, lon: lm.lon }, d = Math.round(G.haversine(vp.pos, at));
      tip.innerHTML = `<b>${esc(lm.name.replace(/\s*\((lake|river)\)$/i, "").toUpperCase())}</b><small>${esc(SP.labelOf(lm.type))} · ${d} KM FROM PLANE</small>`;
      tip.style.left = Math.min(e.clientX + 14, innerWidth - 230) + "px"; tip.style.top = Math.max(e.clientY - 46, 8) + "px"; tip.hidden = false;
    });
    cv.addEventListener("pointerleave", () => { tip.hidden = true; });

    renderSaved();
    if (state.active && state.flights.some((f) => f.id === state.active)) activate(state.active);
    showMenu(); // always start with the form
    if ("serviceWorker" in navigator && location.protocol.startsWith("http")) navigator.serviceWorker.register("sw.js").catch(() => {});
  }
  init();
  window.__ws = { dbg, get F() { return F; }, get vis() { return vis; }, get near() { return near; }, setLevel, get sun() { return sun; }, set simMin(v) { simMin = v; slowAt = 0; } }; // debugging handle
})();
