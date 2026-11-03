// Pure geo + flight-model helpers. No DOM access, so this file also runs under Node for tests.
(function (root) {
  const R = 6371.0088; // km
  const rad = (d) => (d * Math.PI) / 180;
  const deg = (r) => (r * 180) / Math.PI;
  const norm360 = (a) => ((a % 360) + 360) % 360;

  function haversine(a, b) {
    const dφ = rad(b.lat - a.lat), dλ = rad(b.lon - a.lon);
    const h = Math.sin(dφ / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dλ / 2) ** 2;
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
  }

  function bearing(a, b) {
    const φ1 = rad(a.lat), φ2 = rad(b.lat), dλ = rad(b.lon - a.lon);
    const y = Math.sin(dλ) * Math.cos(φ2);
    const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(dλ);
    return norm360(deg(Math.atan2(y, x)));
  }

  // Point a fraction f (0..1) along the great circle a -> b.
  function gcPoint(a, b, f) {
    const δ = haversine(a, b) / R;
    if (δ < 1e-9) return { lat: a.lat, lon: a.lon };
    const A = Math.sin((1 - f) * δ) / Math.sin(δ), B = Math.sin(f * δ) / Math.sin(δ);
    const φ1 = rad(a.lat), λ1 = rad(a.lon), φ2 = rad(b.lat), λ2 = rad(b.lon);
    const x = A * Math.cos(φ1) * Math.cos(λ1) + B * Math.cos(φ2) * Math.cos(λ2);
    const y = A * Math.cos(φ1) * Math.sin(λ1) + B * Math.cos(φ2) * Math.sin(λ2);
    const z = A * Math.sin(φ1) + B * Math.sin(φ2);
    return { lat: deg(Math.atan2(z, Math.hypot(x, y))), lon: deg(Math.atan2(y, x)) };
  }

  function trackAt(a, b, f) {
    const e = 0.002;
    const p = gcPoint(a, b, Math.max(0, f - e)), q = gcPoint(a, b, Math.min(1, f + e));
    return bearing(p, q);
  }


  // ---------- Flight path: runway heading out, a turn toward the destination, then lined up with the arrival runway ----------
  const angDiff = (a, b) => ((b - a + 540) % 360) - 180; // signed shortest turn from a to b
  function moveTo(p, hdg, km) {
    const δ = km / R, θ = rad(hdg), φ1 = rad(p.lat), λ1 = rad(p.lon);
    const φ2 = Math.asin(Math.sin(φ1) * Math.cos(δ) + Math.cos(φ1) * Math.sin(δ) * Math.cos(θ));
    const λ2 = λ1 + Math.atan2(Math.sin(θ) * Math.sin(δ) * Math.cos(φ1), Math.cos(δ) - Math.sin(φ1) * Math.sin(φ2));
    return { lat: deg(φ2), lon: ((deg(λ2) + 540) % 360) - 180 };
  }
  const closestHeading = (heads, want) => (heads && heads.length ? heads.reduce((b, h) => (Math.abs(angDiff(h, want)) < Math.abs(angDiff(b, want)) ? h : b)) : want);
  // Fly straight along `hdg` for `straight` km, then turn (at most `turn` deg per km) until pointing at `target`.
  function leg(start, hdg, straight, target, turn) {
    const pts = [start], step = 0.5; let p = start, h = hdg, n = 0;
    for (; n * step < straight; n++) { p = moveTo(p, h, step); pts.push(p); }
    for (let i = 0; i < 1600; i++) {
      const want = bearing(p, target), d = angDiff(h, want);
      if (Math.abs(d) < 1.5) break;
      h = norm360(h + Math.max(-turn * step, Math.min(turn * step, d))); p = moveTo(p, h, step); pts.push(p);
    }
    return pts;
  }
  // a, b: { lat, lon, rwys: [runway headings] }. Returns { pts, cum, total, depHdg, arrHdg }.
  function makePath(a, b) {
    const D = haversine(a, b), dir = bearing(a, b), arrTrack = norm360(bearing(b, a) + 180);
    const depHdg = closestHeading(a.rwys, dir), arrHdg = closestHeading(b.rwys, arrTrack); // runway used: the one that needs the smallest turn (wind is unknown)
    let pts;
    if (D < 90) pts = [{ lat: a.lat, lon: a.lon }, { lat: b.lat, lon: b.lon }];
    else {
      const dep = leg(a, depHdg, Math.min(5, D * 0.06), b, 9);                           // takeoff roll, climb out, turn
      const arrRev = leg(b, norm360(arrHdg + 180), Math.min(18, D * 0.15), a, 9).reverse(); // final approach, and the turn onto it
      const s = dep[dep.length - 1], e = arrRev[0], gap = haversine(s, e), k = Math.max(1, Math.ceil(gap / 4));
      pts = dep.slice(0, -1);
      for (let i = 0; i <= k; i++) pts.push(gcPoint(s, e, i / k));
      pts = pts.concat(arrRev.slice(1));
      if (gap > D || !isFinite(gap)) pts = [{ lat: a.lat, lon: a.lon }, { lat: b.lat, lon: b.lon }]; // the two turns would overlap: fall back to direct
    }
    const cum = [0]; for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + haversine(pts[i - 1], pts[i]));
    return { pts, cum, total: cum[cum.length - 1], depHdg, arrHdg };
  }
  function pathAt(path, s) { // position and track after s km along the path
    const c = path.cum, n = c.length;
    s = Math.max(0, Math.min(path.total, s));
    let lo = 0, hi = n - 1; while (hi - lo > 1) { const m = (lo + hi) >> 1; if (c[m] <= s) lo = m; else hi = m; }
    const p = path.pts[lo], q = path.pts[hi], seg = c[hi] - c[lo], f = seg > 0 ? (s - c[lo]) / seg : 0;
    const pos = seg > 0 ? gcPoint(p, q, f) : { lat: p.lat, lon: p.lon };
    const i0 = Math.max(0, lo - 1), i1 = Math.min(n - 1, hi + 1);
    return { lat: pos.lat, lon: pos.lon, track: bearing(path.pts[i0], path.pts[i1]) };
  }
  function pathNearest(path, pos) { // km along the path of the point closest to pos (used with GPS)
    let best = 0, bd = 1e18; const k = Math.cos(rad(pos.lat));
    for (let i = 0; i < path.pts.length; i++) { const dx = (path.pts[i].lon - pos.lon) * k, dy = path.pts[i].lat - pos.lat, d = dx * dx + dy * dy; if (d < bd) { bd = d; best = i; } }
    return path.cum[best];
  }

  // ---------- Flight model ----------
  const CRUISE_ALT_KM = 10.7;
  const CRUISE_KMH = 830;
  const AVG_CLIMB_FRAC = 0.55; // average speed in climb/descent relative to cruise

  // Build a flight profile from route length and (optional) known block duration.
  function makeProfile(distKm, durationMin) {
    const T = durationMin || Math.round((distKm / CRUISE_KMH) * 60 + 22);
    const Tc = Math.min(20, T * 0.3), Td = Math.min(24, T * 0.3);
    const v = distKm / (T - (1 - AVG_CLIMB_FRAC) * (Tc + Td)); // km/min at cruise
    return { distKm, T, Tc, Td, v, vc: v * AVG_CLIMB_FRAC };
  }

  function distAt(p, t) { // km flown after t minutes airborne
    if (t <= 0) return 0;
    if (t >= p.T) return p.distKm;
    const dc = p.vc * p.Tc, dd = p.vc * p.Td;
    if (t < p.Tc) return p.vc * t;
    if (t > p.T - p.Td) return p.distKm - p.vc * (p.T - t);
    return dc + p.v * (t - p.Tc);
  }

  function timeAtDist(p, s) { // inverse of distAt
    if (s <= 0) return 0;
    if (s >= p.distKm) return p.T;
    const dc = p.vc * p.Tc;
    if (s < dc) return s / p.vc;
    if (s > p.distKm - p.vc * p.Td) return p.T - (p.distKm - s) / p.vc;
    return p.Tc + (s - dc) / p.v;
  }

  function altitudeAt(p, t) { // km
    if (t <= 0 || t >= p.T) return 0;
    if (t < p.Tc) return CRUISE_ALT_KM * (t / p.Tc);
    if (t > p.T - p.Td) return CRUISE_ALT_KM * ((p.T - t) / p.Td);
    return CRUISE_ALT_KM;
  }

  function speedAt(p, t) { // km/h
    if (t <= 0 || t >= p.T) return 0;
    return 60 * (t < p.Tc || t > p.T - p.Td ? p.vc : p.v);
  }

  // ---------- Visibility ----------
  const horizonKm = (hMeters) => 3.57 * Math.sqrt(Math.max(0, hMeters));
  const DEFAULT_RANGE = { peak: 200, range: 130, volcano: 200, river: 60, lake: 70, sea: 100, monument: 25, temple: 25, city: 45, island: 70, desert: 150, dam: 50, canyon: 120, plateau: 80 };

  // vis: 1 = crystal clear, ~0.6 = hazy
  function maxVisibleKm(lm, altKm, vis) {
    const base = lm.range || DEFAULT_RANGE[lm.type] || 40;
    const altFactor = Math.min(1, Math.max(0.2, altKm / 9));
    const geom = horizonKm(altKm * 1000) + horizonKm(Math.max(0, lm.elev));
    const grow = (lm.r || 0) * 0.5; // big lakes/ranges are seen from further away than their centre point
    return Math.min(base * altFactor * vis + grow, geom + grow);
  }

  // Distance from p to a sight. Rivers are polylines (flat [lat,lon,...]) so they count anywhere along their course.
  function locate(p, lm) {
    if (!lm.pts) return { d: haversine(p, lm), lat: lm.lat, lon: lm.lon };
    let best = Infinity, bi = 0;
    const pts = lm.pts, cl = Math.cos(rad(p.lat));
    for (let i = 0; i < pts.length; i += 2) {
      const dy = pts[i] - p.lat; let dx = pts[i + 1] - p.lon; if (dx > 180) dx -= 360; else if (dx < -180) dx += 360;
      const q = dy * dy + (dx * cl) ** 2;
      if (q < best) { best = q; bi = i; }
    }
    const n = { lat: pts[bi], lon: pts[bi + 1] };
    return { d: haversine(p, n), lat: n.lat, lon: n.lon };
  }
  const inBand = (p, lm) => p.lat >= lm.latLo - 4.5 - (lm.r || 0) / 180 && p.lat <= lm.latHi + 4.5 + (lm.r || 0) / 180;

  function relBearing(trackDeg, toDeg) { return ((toDeg - trackDeg + 540) % 360) - 180; } // -180..180, negative = left
  function sideOf(rel) {
    const a = Math.abs(rel);
    if (a < 10) return "ahead";
    if (a > 170) return "behind";
    return rel < 0 ? "left" : "right";
  }
  function clockOf(rel) { const h = Math.round(norm360(rel) / 30) % 12; return h === 0 ? 12 : h; }

  function toLandmarks(rows, geo) {
    const list = rows.map((r, i) => ({ id: i, name: r[0], type: r[1], lat: r[2], lon: r[3], elev: r[4], note: r[5], range: r[6], curated: true }));
    if (geo) addGeo(list, geo);
    for (const lm of list) { lm.latLo = lm.latLo ?? lm.lat; lm.latHi = lm.latHi ?? lm.lat; }
    return list;
  }

  const kfmt = (km) => (km >= 100 ? Math.round(km / 10) * 10 : Math.round(km));
  function addGeo(list, geo) {
    const have = new Set(list.map((l) => l.name.toLowerCase()));
    const push = (o) => { if (have.has(o.name.toLowerCase())) return; have.add(o.name.toLowerCase()); o.id = list.length; o.elev = o.elev || 0; list.push(o); };
    for (const [name, lat, lon, ext, admin] of geo.lakes || [])
      push({ name: /lake|sea|reservoir|bay|loch|lago/i.test(name) ? name : name + " (lake)", type: "lake", lat, lon, r: ext / 2, range: Math.min(110, 40 + ext * 0.4),
        note: `Lake about ${kfmt(ext)} km across${admin ? " · " + admin : ""}. Look for a flat sheet of blue, silver or brown.` });
    for (const [name, flat] of geo.rivers || []) {
      let lo = 90, hi = -90, ml = 0, mo = 0;
      for (let i = 0; i < flat.length; i += 2) { lo = Math.min(lo, flat[i]); hi = Math.max(hi, flat[i]); }
      const mid = (flat.length / 4 | 0) * 2; ml = flat[mid]; mo = flat[mid + 1];
      push({ name: /river|ganga|ganges|brahmaputra|indus|yamuna|nile|danube|rhine|volga/i.test(name) ? name : name + " (river)", type: "river", lat: ml, lon: mo, pts: flat, latLo: lo, latHi: hi,
        note: "River — a winding silver or brown ribbon; best seen when the sun is low." });
    }
    const AREA_NOTE = { range: "Mountain range / hills — ridges, snow lines and long shadows.", desert: "Desert — sand, rock or salt flats with few fields.", plateau: "Highland plateau / basin — a raised or sunken landform.",
      island: "Islands — look for coastline shapes and reefs.", sea: "Open water, gulf or bay — dark blue with ship wakes or coastline curves.", river: "River delta — branching channels meeting the sea." };
    for (const [name, type, lat, lon, ext] of geo.areas || [])
      push({ name, type, lat, lon, r: ext / 2, range: type === "range" ? Math.min(220, 100 + ext * 0.2) : undefined, note: `${AREA_NOTE[type] || ""} About ${kfmt(ext)} km across.` });
    for (const [name, country, lat, lon, pop] of geo.cities || [])
      push({ name, type: "city", lat, lon, range: Math.min(75, 28 + 11 * Math.log10(pop / 1e5 + 1) * 3), note: `City of ${pop >= 1e6 ? (pop / 1e6).toFixed(1) + " million" : Math.round(pop / 1e3) + ",000"}${country ? " · " + country : ""}. Grids of streets, rivers and lights at night.` });
  }

  // What can be seen from `pos` (heading `track`) at altitude `altKm`?
  function visibleNow(landmarks, pos, track, altKm, vis) {
    const out = [];
    for (const lm of landmarks) {
      if (!inBand(pos, lm)) continue;
      const loc = locate(pos, lm), d = loc.d;
      const max = maxVisibleKm(lm, altKm, vis);
      if (d > max) continue;
      const rel = relBearing(track, bearing(pos, loc));
      out.push({ lm, dist: d, max, rel, side: sideOf(rel), clock: clockOf(rel), score: d / max, at: { lat: loc.lat, lon: loc.lon } });
    }
    return out.sort((a, b) => a.score - b.score);
  }

  // Walk the whole route once and find when each sight is closest and whether it's ever visible.
  function planRoute(landmarks, path, profile, vis, stepKm) {
    const D = profile.distKm, step = stepKm || 5;
    const n = Math.max(2, Math.ceil(D / step));
    const best = new Map();
    for (let i = 0; i <= n; i++) {
      const f = i / n, s = f * D;
      const p = pathAt(path, s);
      const t = timeAtDist(profile, s), alt = altitudeAt(profile, t);
      for (const lm of landmarks) {
        if (!inBand(p, lm)) continue; // cheap prefilter
        const loc = locate(p, lm), d = loc.d;
        const max = maxVisibleKm(lm, alt, vis);
        if (d > max) continue;
        const cur = best.get(lm.id);
        if (!cur || d < cur.dist) best.set(lm.id, { lm, dist: d, max, f, s, tMin: t, alt, p, loc });
      }
    }
    const list = [];
    for (const b of best.values()) {
      const track = pathAt(path, b.s).track;
      const rel = relBearing(track, bearing(b.p, b.loc));
      list.push({ lm: b.lm, dist: b.dist, max: b.max, tMin: b.tMin, alongKm: b.s, rel, side: sideOf(rel), clock: clockOf(rel), alt: b.alt, at: { lat: b.loc.lat, lon: b.loc.lon } });
    }
    return list.sort((a, b) => a.tMin - b.tMin);
  }

  const api = { R, rad, deg, haversine, bearing, gcPoint, trackAt, makePath, pathAt, pathNearest, makeProfile, distAt, timeAtDist, altitudeAt, speedAt,
    maxVisibleKm, locate, relBearing, sideOf, clockOf, toLandmarks, visibleNow, planRoute, CRUISE_ALT_KM, CRUISE_KMH };
  if (typeof module !== "undefined" && module.exports) module.exports = api; else root.Geo = api;
})(typeof window !== "undefined" ? window : globalThis);
