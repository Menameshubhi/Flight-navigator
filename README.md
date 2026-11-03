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
1. **Form** (wooden-panel menu on a pale sea with floating islands): just **from**, **to**, **departure** and **arrival**, as local times at each airport (time zones are built in). "Demo: DEL > KTM" fills a sample flight. Taxi time, flight time and the airborne time are worked out from the departure and arrival times.
2. **Window intro** (plays once per launch): the shade lifts, then the camera zooms through the glass into the game. Click or press a key to skip.
3. **Game view**
   - Plane fixed near the bottom, heading up; terrain scrolls and rotates under it: noise-based patches of forest, grass and meadow with little trees, rivers and lakes with sandy banks, hills and cities. Puffy parallax clouds with blue undersides and ground shadows give depth.
   - Sights visible from the window appear as pixel sprites on their true side of the plane, with name tags. Tap a sprite, tag or strip icon for a card.
   - **Route line:** a dotted line leaves the plane's nose and runs up to a flag at the destination ("KTM 536KM"). Upcoming notable sights are pinned on it, on the side of the window they are seen from (left window sights left of the line, right window sights right), with their **distance ahead along the route** (`+372KM`). The first stretch uses the map's real scale; further out the scale is squeezed so far sights still fit. A small `DEL ▮▮▯ KTM` progress plate rides under the plane's tail.
   - HUD: flight, phase and countdown, local sun time of day, altitude (flight level), speed, heading, % done, a north compass.
   - **Real coastline:** land and sea come from Natural Earth coastlines (`data/land.js`): cyan sea with shallows and foam, sandy beaches, trees only on land.
   - **Map views:** zoom out twice past the normal range (`-`) to see a whole region or country; every curated monument, temple and peak in view gets a sprite and name, whether or not it is visible from the window.
   - **Hover (mouse):** point at any sight, city, lake, river or range to see its name, type and distance from the plane; click for the full card.
   - Buttons: `+` / `-` zoom, `T` time travel slider, `=` back to the form.
4. **Time of day:** the sun's elevation at the plane's position and time tints the whole screen (day, golden hour, sunset, dusk, night), with city lights at night. The HUD plates shift colour too.

## How it works
- `geo.js` — runway-aware flight path, flight profile (taxi, climb, cruise, descent), altitude-aware visibility (horizon + per-sight range x clarity), left/right/clock position relative to the track.
- `game.js` — canvas renderer (low-resolution canvas scaled with nearest-neighbour: 2x on phones, 3-4x on desktop), sun model, HUD, route strip, sight cards, window intro, form.
- `info.js` — Wikipedia write-ups and photos, saved on the device.
- `sprites.js` — pixel sprites drawn from text bitmaps (prop plane with an animated propeller, flag, peak, volcano, temple, monument, city, dam, water, island, cactus, mesa, hills).
- Position is **time-based**: block time = arrival - departure; about 5-15 min of it is taxi out and 3-8 min taxi in, the rest is airborne (climb, cruise, descent). The time-travel slider previews any point of the flight.
- **Real track, not a straight line:** the plane takes off on a runway heading, climbs straight out, turns toward the destination (max 9 deg per km) and lines up with a landing runway for the final stretch. Runway headings come from OurAirports (`data/airports.js`); the runway used is the one needing the smallest turn, because the wind is unknown. The HUD shows the departure runway while taxiing.
- **Sight cards:** a 2-sentence intro, relevance (what it is, and when and from which window you see it on this flight), nearest airport and up to 3 photos in a pixel frame (tap one to open it large with the place name). Text and photos come from Wikipedia / Wikimedia Commons; they are fetched and saved for the whole route when a flight is created while online, so they work in flight.
- Terrain is drawn from our own data: coastlines (land vs sea) as polygons, rivers as full courses, lakes as discs, ranges as scattered hills, deserts and cities.

## Data
- `data/airports.js` — ~90 airports with time zone and runway headings (built by `tools/build-airports.py`). `data/landmarks.js` — ~240 hand-picked highlights.
- `data/land.js` — GENERATED coastlines from Natural Earth ne_10m_land by `tools/build-land.py` (about 1 MB).
- `data/geodata.js` — GENERATED from Natural Earth (public domain) by `tools/build-geodata.py`: ~4,500 sights (lakes, rivers, ranges, deserts, plateaus, islands, seas, cities).
- Add rows following the format in the file header; the game picks them up automatically.

## Known limits
- Real flights deviate from this model (airways, weather, ATC, the wind-dependent runway); the time slider helps. Photos need a connection once, before the flight. The device-GPS option was removed from the form.
- Visibility is a heuristic (distance, altitude, clarity), not a line-of-sight terrain check. Coastlines are simplified to about 1-2 km.
- Times shown are in the device's time zone; the sun/time-of-day display uses the plane's longitude.
- Fonts: Press Start 2P and VT323 (both SIL Open Font License), bundled in `fonts/`.
- The earlier list/map/photo version was removed; a copy of it is kept outside this folder.
- Not a Framer template; this folder is a standalone app.
