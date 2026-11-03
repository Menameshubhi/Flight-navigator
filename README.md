# Window Seat — offline pixel-game flight guide

A 90s-style pixel game that shows which hills, rivers, lakes, monuments and temples you are flying over. Top-down view:
the plane stays near the bottom of the screen and always flies "up"; the world rotates under it, so a hill on the right of the
plane is drawn on the right. No window-side selector is needed. Static app: no backend, no build step, works offline.

## Run
```
cd flight-window-guide && python3 -m http.server 8137   # then open http://localhost:8137
```
Service workers need `http://localhost` or HTTPS. For a phone, host the folder on any static host, open it once on Wi-Fi, then "Add to Home Screen".
Everything the game needs (fonts, data, sprites) is precached by `sw.js` on first load; after that it needs no network.

## Flow
1. **Form** (wooden-panel menu on a pale sea with floating islands, chunky 3D buttons, blocky logo): flight number, PNR (a note only), from, to, scheduled departure, taxi time, optional flight time, sky clarity, optional phone GPS. "Demo: DEL > KTM" fills a sample flight.
2. **Window intro** (plays once per launch): the shade lifts, then the camera zooms through the glass into the game. Click or press a key to skip.
3. **Game view**
   - Plane fixed near the bottom, heading up; terrain scrolls and rotates under it: noise-based patches of forest, grass and meadow with little trees, rivers and lakes with sandy banks, hills and cities. Puffy parallax clouds with blue undersides and ground shadows give depth.
   - Sights visible from the window appear as pixel sprites on their true side of the plane, with name tags. Tap a sprite, tag or strip icon for a card.
   - **Route line:** a dotted line leaves the plane's nose and runs up to a flag at the destination ("KTM 536KM"). Upcoming notable sights are pinned on it, on the side of the window they are seen from (left window sights left of the line, right window sights right), with their **distance ahead along the route** (`+372KM`). The first stretch uses the map's real scale; further out the scale is squeezed so far sights still fit. A small `DEL ▮▮▯ KTM` progress plate rides under the plane's tail.
   - HUD: flight, phase and countdown, local sun time of day, altitude (flight level), speed, heading, % done, a north compass.
   - Buttons: `+` / `-` zoom, `T` time travel slider, `=` back to the form.
4. **Time of day:** the sun's elevation at the plane's position and time tints the whole screen (day, golden hour, sunset, dusk, night), with city lights at night. The HUD plates shift colour too.

## How it works
- `geo.js` — great-circle route, flight profile (taxi, climb, cruise, descent), altitude-aware visibility (horizon + per-sight range x clarity), left/right/clock position relative to the track.
- `game.js` — canvas renderer (low-resolution canvas scaled with nearest-neighbour: 2x on phones, 3-4x on desktop), sun model, HUD, route strip, sight cards, window intro, form.
- `sprites.js` — pixel sprites drawn from text bitmaps (prop plane with an animated propeller, flag, peak, volcano, temple, monument, city, dam, water, island, cactus, mesa, hills).
- Position is **time-based**: takeoff = departure + taxi time. Optional **device GPS** overrides it if the phone gets a fix. The time-travel slider previews any point of the flight.
- PNR is stored as a note only; it cannot be resolved offline.
- Terrain is drawn from our own data: rivers as full courses, lakes as discs, ranges as scattered hills, deserts, small seas and cities. Oceans and huge plateaus have no outline data and appear only as sprites when visible.

## Data
- `data/airports.js` — ~90 airports. `data/landmarks.js` — ~240 hand-picked highlights.
- `data/geodata.js` — GENERATED from Natural Earth (public domain) by `tools/build-geodata.py`: ~4,500 sights (lakes, rivers, ranges, deserts, plateaus, islands, seas, cities).
- Add rows following the format in the file header; the game picks them up automatically.

## Known limits
- Real flights deviate from the great circle (airways, weather, ATC); use GPS or the time slider to correct.
- Visibility is a heuristic (distance, altitude, clarity), not a line-of-sight terrain check. There is no coastline data, so land and sea are not drawn as a real map.
- Times shown are in the device's time zone; the sun/time-of-day display uses the plane's longitude.
- Fonts: Press Start 2P and VT323 (both SIL Open Font License), bundled in `fonts/`.
- The earlier list/map/photo version was removed; a copy of it is kept outside this folder.
- Not a Framer template; this folder is a standalone app.
