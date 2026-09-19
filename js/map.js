/* simBody — builds the body map: silhouette, organs, skin boundary, starter anatomy. */
(function (global) {
  'use strict';
  var D = global.SimBody.data;
  var C = D.CONFIG;

  function inEllipse(x, y, cx, cy, rx, ry) {
    var dx = (x - cx) / rx, dy = (y - cy) / ry;
    return dx * dx + dy * dy <= 1;
  }
  function inRect(x, y, x0, y0, x1, y1) {
    return x >= x0 && x <= x1 && y >= y0 && y <= y1;
  }

  function blankTile(x, y) {
    return {
      x: x, y: y,
      body: false,           // inside the silhouette?
      region: null,          // head | neck | chest | abdomen | arm | leg
      terrain: null,         // tissue | skin | gutlining | marrow | organ
      organ: null,
      zone: null,            // tissue | microbiome | immune
      structure: null,
      vessel: false,
      nerve: false,
      density: 0,
      health: 100,
      inflam: 0,
      perfusion: 0,
      signal: 0,
      pathogen: null         // id of the outbreak occupying this tile
    };
  }

  function regionAt(x, y) {
    if (inEllipse(x, y, 14, 5.2, 4.6, 5.2)) return 'head';
    if (inRect(x, y, 12, 10, 16, 12)) return 'neck';
    if (inRect(x, y, 8, 12, 20, 19)) return 'chest';
    if (inRect(x, y, 9, 20, 19, 28)) return 'abdomen';
    if (inRect(x, y, 4, 13, 7, 27) || inRect(x, y, 21, 13, 24, 27)) return 'arm';
    if (inRect(x, y, 10, 29, 13, 39) || inRect(x, y, 15, 29, 18, 39)) return 'leg';
    return null;
  }

  var ORGAN_SHAPES = [
    { organ: 'brain',   test: function (x, y) { return inEllipse(x, y, 14, 4.8, 2.9, 3.1); } },
    { organ: 'airway',  test: function (x, y) { return inRect(x, y, 13, 9, 15, 12); } },
    { organ: 'lung',    test: function (x, y) { return inEllipse(x, y, 10.5, 16, 2.4, 3.3) || inEllipse(x, y, 17.5, 16, 2.4, 3.3); } },
    { organ: 'heart',   test: function (x, y) { return inEllipse(x, y, 14, 16.5, 1.8, 2.2); } },
    { organ: 'liver',   test: function (x, y) { return inRect(x, y, 10, 20, 13, 22); } },
    { organ: 'stomach', test: function (x, y) { return inRect(x, y, 15, 20, 17, 22); } },
    { organ: 'kidney',  test: function (x, y) { return inRect(x, y, 9, 21, 9, 23) || inRect(x, y, 19, 21, 19, 23); } },
    { organ: 'spleen',  test: function (x, y) { return inRect(x, y, 18, 20, 18, 21); } },
    { organ: 'gut',     test: function (x, y) { return inRect(x, y, 11, 24, 17, 27); } }
  ];

  var MARROW = [[11, 34], [12, 36], [17, 34], [16, 36], [5, 20], [23, 20]];

  function buildTiles() {
    var tiles = new Array(C.GRID_W * C.GRID_H);
    var x, y, i, t;

    for (y = 0; y < C.GRID_H; y++) {
      for (x = 0; x < C.GRID_W; x++) {
        i = y * C.GRID_W + x;
        t = blankTile(x, y);
        var region = regionAt(x, y);
        if (region) {
          t.body = true;
          t.region = region;
          t.terrain = 'tissue';
        }
        tiles[i] = t;
      }
    }

    // Organs sit on top of plain tissue.
    for (i = 0; i < tiles.length; i++) {
      t = tiles[i];
      if (!t.body) continue;
      for (var s = 0; s < ORGAN_SHAPES.length; s++) {
        if (ORGAN_SHAPES[s].test(t.x, t.y)) {
          t.organ = ORGAN_SHAPES[s].organ;
          t.terrain = 'organ';
          break;
        }
      }
    }

    // Gut lining: the ring of tiles wrapping the intestine.
    for (i = 0; i < tiles.length; i++) {
      t = tiles[i];
      if (!t.body || t.terrain === 'organ') continue;
      if (t.region === 'abdomen' && neighbours(tiles, t.x, t.y).some(function (n) { return n.organ === 'gut'; })) {
        t.terrain = 'gutlining';
      }
    }

    // Marrow pockets in the long bones.
    MARROW.forEach(function (p) {
      var m = at(tiles, p[0], p[1]);
      if (m && m.body && m.terrain !== 'organ') m.terrain = 'marrow';
    });

    // Skin: any body tile touching the outside world.
    for (i = 0; i < tiles.length; i++) {
      t = tiles[i];
      if (!t.body || t.terrain === 'organ' || t.terrain === 'marrow') continue;
      var edge = t.x === 0 || t.y === 0 || t.x === C.GRID_W - 1 || t.y === C.GRID_H - 1;
      if (edge || neighbours(tiles, t.x, t.y).some(function (n) { return !n.body; })) {
        if (t.terrain !== 'gutlining') t.terrain = 'skin';
      }
    }

    return tiles;
  }

  function at(tiles, x, y) {
    if (x < 0 || y < 0 || x >= C.GRID_W || y >= C.GRID_H) return null;
    return tiles[y * C.GRID_W + x];
  }

  function neighbours(tiles, x, y) {
    var out = [];
    var deltas = [[0, -1], [1, 0], [0, 1], [-1, 0]];
    for (var i = 0; i < deltas.length; i++) {
      var n = at(tiles, x + deltas[i][0], y + deltas[i][1]);
      if (n) out.push(n);
    }
    return out;
  }

  /* The body doesn't start as a blank slate — you inherit a working circulatory
   * trunk, a spinal nerve, a little tissue and a starter colony in the gut. */
  function seedStartingBody(tiles) {
    var line = function (x0, y0, x1, y1, fn) {
      var steps = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0));
      for (var s = 0; s <= steps; s++) {
        var x = Math.round(x0 + (x1 - x0) * (s / (steps || 1)));
        var y = Math.round(y0 + (y1 - y0) * (s / (steps || 1)));
        var t = at(tiles, x, y);
        if (t && t.body) fn(t);
      }
    };
    var passable = function (t) {
      return t.terrain !== 'organ' || t.organ === 'gut' || t.organ === 'airway';
    };
    var vessel = function (t) { if (passable(t)) t.vessel = true; };
    var nerve = function (t) { t.nerve = true; };

    // Aorta: heart down through the abdomen, and up into the neck.
    line(14, 14, 14, 28, vessel);
    line(14, 9, 14, 14, vessel);
    line(10, 21, 18, 21, vessel);   // hepatic / splenic branch
    line(12, 25, 16, 25, vessel);   // mesenteric branch
    line(11, 17, 17, 17, vessel);   // pulmonary branch
    line(12, 27, 16, 27, vessel);   // lower mesenteric branch
    line(11, 23, 17, 23, vessel);   // duodenal arcade

    // Spinal cord and two peripheral nerves.
    line(14, 6, 14, 28, nerve);
    line(12, 24, 16, 24, nerve);

    // Starter tissue around the trunk vessel.
    [[13, 14], [15, 14], [13, 19], [15, 19], [12, 20], [16, 20], [13, 28], [15, 28]].forEach(function (p) {
      var t = at(tiles, p[0], p[1]);
      if (t && t.body && t.terrain !== 'organ') { t.zone = 'tissue'; t.density = 1; }
    });

    // A little villi surface to start absorbing with.
    [[12, 23], [16, 23], [13, 28], [15, 28]].forEach(function (p) {
      var t = at(tiles, p[0], p[1]);
      if (t && t.body && t.terrain !== 'organ') { t.zone = 'tissue'; t.density = 2; }
    });

    // Starter flora on the gut lining.
    for (var i = 0; i < tiles.length; i++) {
      var t = tiles[i];
      if (t.terrain === 'gutlining' && !t.zone && (t.x + t.y) % 2 === 0) { t.zone = 'microbiome'; t.density = 1; }
    }

    // One immune post by the marrow.
    var im = at(tiles, 11, 33);
    if (im && im.body) { im.zone = 'immune'; im.density = 1; }

    return tiles;
  }

  function buildMap() {
    return seedStartingBody(buildTiles());
  }

  global.SimBody.map = {
    buildMap: buildMap, buildTiles: buildTiles, seedStartingBody: seedStartingBody,
    at: at, neighbours: neighbours
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
