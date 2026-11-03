// Pixel-art sprites, drawn from text bitmaps (one character = one pixel) into small canvases.
(function (root) {
  "use strict";
  const PAL = {
    k: "#1a1c2c", w: "#f4f4f8", g: "#b6bccb", G: "#7b8296", b: "#d08c42", B: "#8f5d2c", r: "#d9402f", o: "#f08a24",
    y: "#f7d046", l: "#9bd45a", n: "#2f8f46", N: "#1f6a35", c: "#7fd3f7", u: "#2f6fd0", s: "#e8cf8a", S: "#c99a50", p: "#d9609a", R: "#c8372d", d: "#4a4f63",
  };

  function make(rows) {
    const h = rows.length, w = Math.max(...rows.map((r) => r.length));
    const c = document.createElement("canvas"); c.width = w; c.height = h;
    const x = c.getContext("2d");
    rows.forEach((row, j) => { for (let i = 0; i < row.length; i++) { const ch = row[i]; if (ch !== "." && PAL[ch]) { x.fillStyle = PAL[ch]; x.fillRect(i, j, 1, 1); } } });
    return c;
  }
  function silhouette(src, color) { // same shape, one colour (used for drop shadows)
    const c = document.createElement("canvas"); c.width = src.width; c.height = src.height;
    const x = c.getContext("2d"); x.drawImage(src, 0, 0); x.globalCompositeOperation = "source-in"; x.fillStyle = color; x.fillRect(0, 0, c.width, c.height);
    return c;
  }

  const ROWS = {
    plane: [
      "..........kkkkk..........",
      ".........kRRRRRk.........",
      ".........kRRyRRk.........",
      ".........kRRRRRk.........",
      "..........kwwwk..........",
      "kkkkkkkkkkkwwwkkkkkkkkkkk",
      "krrrwwwwwwkccckwwwwwwrrrk",
      "krrrwwwwwwkccckwwwwwwrrrk",
      "krrrggggggkwwwkggggggrrrk",
      "kkkkkkkkkkkwwwkkkkkkkkkkk",
      "..........kwwwk..........",
      "..........kwwwk..........",
      "..........kwwwk..........",
      "...........kwk...........",
      ".....kkkkkkkwkkkkkkk.....",
      ".....kwwwwwkwkwwwwwk.....",
      "......kkkkkkwkkkkkk......",
      "...........krk...........",
      "...........krk...........",
      "...........krk...........",
      "............k............",
      ".........................",
    ],
    flag: [
      "kkkkkk..",
      "krrrrrk.",
      "krrrrk..",
      "krrkk...",
      "kkk.....",
      "k.......",
      "k.......",
      "k.......",
      "k.......",
    ],
    peak: [
      "............",
      ".....kk.....",
      "....kwwk....",
      "...kwwwwk...",
      "...kwgwwk...",
      "..kwgGgwwk..",
      "..kgGGgGgk..",
      ".kgGGbGGGgk.",
      ".kGGbBGGbGk.",
      "kGGbBBGbBGGk",
      "kBBBBBBBBBBk",
      "............",
    ],
    volcano: [
      "....o..o....",
      "...oyoyo....",
      "....kooyk...",
      "...kBBBBk...",
      "..kBBbBBBk..",
      "..kBbBBbBk..",
      ".kBBBBBBBBk.",
      ".kBbBBBbBBk.",
      "kBBBBBBBBBBk",
      "kkkkkkkkkkkk",
    ],
    temple: [
      ".....y......",
      ".....k......",
      "....kok.....",
      "...kooyk....",
      "...koook....",
      "..kooyook...",
      "..koooook...",
      ".kkkkkkkkk..",
      ".kyyokkoyyk.",
      ".kyyokkoyyk.",
      ".kkkkkkkkkk.",
    ],
    monument: [
      ".....y......",
      "....kwk.....",
      "...kwwwk....",
      "..kwwgwwk...",
      "..kwwwwwk...",
      "kk.kwwwk.kk.",
      "kwkkwwwkkwk.",
      "kwkwwgwwkwk.",
      "kwkwkkkwkwk.",
      "kwkwkGkwkwk.",
      "kkkkkkkkkkk.",
    ],
    city: [
      "............",
      "......kk....",
      "..kk..kGk...",
      "..kGk.kGk...",
      "..kGk.kyGkk.",
      "kkkyGkkGGGk.",
      "kGGGGkGGyGk.",
      "kGyGGkGyGGk.",
      "kGGGyGkGGGk.",
      "kGyGGGkGyGk.",
      "kkkkkkkkkkk.",
    ],
    dam: [
      "............",
      "kkkkkkkkkkkk",
      "kGgGgGgGgGgk",
      "kGGGGGGGGGGk",
      "kuuukGGkuuuk",
      "kucuukGGkucu",
      "kuuuukGGkuuu",
      "kkkkkkkkkkkk",
    ],
    water: [
      ".....k......",
      "....kck.....",
      "...kcwck....",
      "..kcwcccuk..",
      "..kcccccuk..",
      "..kccccuuk..",
      "..kcccuuuk..",
      "...kuuuuk...",
      "....kkkk....",
    ],
    island: [
      "...nn.nn....",
      "..nNnnNnn...",
      "...nnbnn....",
      "....kb......",
      "....kb......",
      ".ssssbssss..",
      "ssssssssssS.",
      ".SSSSSSSSS..",
    ],
    cactus: [
      ".....n......",
      "....nN..n...",
      ".n..nN..nN..",
      ".nN.nN.nN...",
      "..nNnNnN....",
      ".....nN.....",
      ".....nN.....",
      "..SSSSSSSS..",
    ],
    mesa: [
      "............",
      "..kkkkkkkk..",
      ".kooooooook.",
      ".kobbbbbbok.",
      ".kobbBbbbok.",
      "kkobbbbBbokk",
      "kbobbbbbbobk",
      "kBBBBBBBBBBk",
    ],
    hill: [
      "....k....",
      "...kbk...",
      "..kbbBk..",
      ".kbbBBBk.",
      "kbbBBBBBk",
    ],
    hillSnow: [
      "....k....",
      "...kwk...",
      "..kwwwk..",
      ".kbwBBBk.",
      "kbbBBBBBk",
    ],
    tree: ["nn", "nN", ".b"],
  };

  const S = {};
  for (const k in ROWS) { const c = make(ROWS[k]); S[k] = { c, shadow: silhouette(c, "rgba(10,12,30,0.32)"), w: c.width, h: c.height }; }

  // sight type -> sprite + label
  const TYPES = {
    peak: ["peak", "PEAK"], range: ["peak", "MOUNTAIN RANGE"], volcano: ["volcano", "VOLCANO"], river: ["water", "RIVER"], lake: ["water", "LAKE"],
    sea: ["water", "SEA / COAST"], dam: ["dam", "DAM"], island: ["island", "ISLANDS"], monument: ["monument", "MONUMENT"], temple: ["temple", "TEMPLE"],
    city: ["city", "CITY"], plateau: ["mesa", "PLATEAU"], desert: ["cactus", "DESERT"], canyon: ["mesa", "CANYON"],
  };
  const spriteOf = (type) => S[(TYPES[type] || ["peak"])[0]];
  const labelOf = (type) => (TYPES[type] || [0, "SIGHT"])[1];

  // little data-URL icon of a sprite, for the DOM (route strip, info card)
  const urlCache = {};
  function iconURL(type) {
    const k = (TYPES[type] || ["peak"])[0];
    if (!urlCache[k]) {
      const sp = S[k], c = document.createElement("canvas"); c.width = c.height = 12; const x = c.getContext("2d");
      x.drawImage(sp.c, Math.floor((12 - sp.w) / 2), 12 - sp.h);
      urlCache[k] = c.toDataURL();
    }
    return urlCache[k];
  }

  root.Sprites = { S, TYPES, spriteOf, labelOf, iconURL, PAL };
})(window);
