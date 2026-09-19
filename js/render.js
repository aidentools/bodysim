/* simBody — canvas rendering of the body map. */
(function (global) {
  'use strict';
  var D = global.SimBody.data;
  var M = global.SimBody.map;
  var C = D.CONFIG;

  var OVERLAYS = [
    { id: 'none',   name: 'Anatomy',      hint: 'Zones, organs and networks.' },
    { id: 'blood',  name: 'Circulation',  hint: 'How far blood actually reaches.' },
    { id: 'nerve',  name: 'Innervation',  hint: 'Nerve signal coverage.' },
    { id: 'inflam', name: 'Inflammation', hint: 'Where the body is irritated.' },
    { id: 'immune', name: 'Immune cover', hint: 'Defensive strength per tile.' }
  ];

  function shade(hex, amount) {
    var n = parseInt(hex.slice(1), 16);
    var r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
    r = Math.round(Math.max(0, Math.min(255, r * amount)));
    g = Math.round(Math.max(0, Math.min(255, g * amount)));
    b = Math.round(Math.max(0, Math.min(255, b * amount)));
    return 'rgb(' + r + ',' + g + ',' + b + ')';
  }

  function heat(v) {
    // 0 -> deep blue, 0.5 -> teal/amber, 1 -> hot
    v = Math.max(0, Math.min(1, v));
    var r = Math.round(255 * Math.min(1, v * 1.8));
    var g = Math.round(255 * Math.min(1, Math.abs(Math.sin(v * Math.PI)) * 0.9 + v * 0.2));
    var b = Math.round(255 * Math.max(0, 1 - v * 1.6));
    return 'rgba(' + r + ',' + g + ',' + b + ',0.72)';
  }

  function baseColour(tile) {
    if (tile.organ) return D.ORGANS[tile.organ].color;
    var terr = D.TERRAIN[tile.terrain];
    return terr ? terr.color : '#3a2b33';
  }

  function setup(canvas) {
    var dpr = (global.devicePixelRatio || 1);
    canvas.width = C.GRID_W * C.TILE * dpr;
    canvas.height = C.GRID_H * C.TILE * dpr;
    canvas.style.width = (C.GRID_W * C.TILE) + 'px';
    canvas.style.height = (C.GRID_H * C.TILE) + 'px';
    var ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return ctx;
  }

  function draw(ctx, state, view) {
    var T = C.TILE, tiles = state.tiles, i, t, x, y;
    var time = view.time || 0;
    var pulse = 0.5 + 0.5 * Math.sin(time / 320);

    ctx.clearRect(0, 0, C.GRID_W * T, C.GRID_H * T);

    // --- body silhouette base
    for (i = 0; i < tiles.length; i++) {
      t = tiles[i];
      if (!t.body) continue;
      x = t.x * T; y = t.y * T;
      var lit = 0.55 + 0.45 * (t.health / 100);
      ctx.fillStyle = shade(baseColour(t), lit);
      ctx.fillRect(x, y, T, T);

      if (t.terrain === 'skin') {
        ctx.fillStyle = 'rgba(255,225,215,0.05)';
        ctx.fillRect(x, y, T, T);
      }
    }

    // --- outline so the silhouette reads as a body, not a pile of squares
    ctx.strokeStyle = 'rgba(255,205,195,0.28)';
    ctx.lineWidth = 1;
    for (i = 0; i < tiles.length; i++) {
      t = tiles[i];
      if (!t.body) continue;
      var dirs = [[0, -1, 0, 0, 1, 0], [0, 1, 0, 1, 1, 1], [-1, 0, 0, 0, 0, 1], [1, 0, 1, 0, 1, 1]];
      for (var e = 0; e < dirs.length; e++) {
        var dd = dirs[e], nb = M.at(tiles, t.x + dd[0], t.y + dd[1]);
        if (nb && nb.body) continue;
        ctx.beginPath();
        ctx.moveTo((t.x + dd[2]) * T, (t.y + dd[3]) * T);
        ctx.lineTo((t.x + dd[4]) * T, (t.y + dd[5]) * T);
        ctx.stroke();
      }
    }

    // --- zones
    for (i = 0; i < tiles.length; i++) {
      t = tiles[i];
      if (!t.body || !t.zone) continue;
      x = t.x * T; y = t.y * T;
      var z = D.ZONES[t.zone];
      var alpha = t.density === 0 ? 0.18 : 0.28 + t.density * 0.17;
      ctx.fillStyle = z.color;
      ctx.globalAlpha = alpha;
      ctx.fillRect(x + 1, y + 1, T - 2, T - 2);
      ctx.globalAlpha = 1;

      if (t.density === 0) {
        // Un-developed zoning reads as a dotted outline, like SimCity's empty lots.
        ctx.strokeStyle = z.color;
        ctx.globalAlpha = 0.6;
        ctx.setLineDash([2, 2]);
        ctx.strokeRect(x + 1.5, y + 1.5, T - 3, T - 3);
        ctx.setLineDash([]);
        ctx.globalAlpha = 1;
      } else {
        ctx.fillStyle = 'rgba(255,255,255,0.75)';
        for (var d = 0; d < t.density; d++) {
          ctx.fillRect(x + 2.5 + d * 3.5, y + T - 4.5, 2, 2);
        }
      }
    }

    // --- vessels and nerves as connected networks
    ctx.lineCap = 'round';
    for (i = 0; i < tiles.length; i++) {
      t = tiles[i];
      if (!t.body) continue;
      if (t.vessel) drawLink(ctx, tiles, t, 'vessel', T, 0, '#ff4d5e', t.perfusion);
      if (t.nerve) drawLink(ctx, tiles, t, 'nerve', T, 3.5, '#ffd75e', t.signal);
    }

    // --- structures
    for (i = 0; i < tiles.length; i++) {
      t = tiles[i];
      if (!t.body || !t.structure) continue;
      x = t.x * T; y = t.y * T;
      var st = D.STRUCTURES[t.structure];
      ctx.fillStyle = st.color;
      ctx.beginPath();
      ctx.arc(x + T / 2, y + T / 2, T * 0.32, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = 'rgba(10,10,14,0.85)';
      ctx.font = 'bold 8px ui-monospace, monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      var glyph = { lymph: 'L', mucus: 'B', fat: 'F', plasma: 'Y' }[t.structure];
      ctx.fillText(glyph, x + T / 2, y + T / 2 + 0.5);
    }

    // --- inflammation haze
    for (i = 0; i < tiles.length; i++) {
      t = tiles[i];
      if (!t.body || t.inflam < 12) continue;
      ctx.fillStyle = 'rgba(255,90,60,' + Math.min(0.42, t.inflam / 240) + ')';
      ctx.fillRect(t.x * T, t.y * T, T, T);
    }

    // --- overlay heatmaps
    if (view.overlay && view.overlay !== 'none') {
      for (i = 0; i < tiles.length; i++) {
        t = tiles[i];
        if (!t.body) continue;
        var v = 0;
        if (view.overlay === 'blood') v = t.perfusion;
        else if (view.overlay === 'nerve') v = t.signal;
        else if (view.overlay === 'inflam') v = t.inflam / 100;
        else if (view.overlay === 'immune') v = Math.min(1, global.SimBody.sim.localDefence(state, i) / 6);
        ctx.fillStyle = heat(v);
        ctx.fillRect(t.x * T, t.y * T, T, T);
      }
    }

    // --- pathogens
    var kindColour = { virus: '#c23ce8', bacteria: '#39e07a', fungus: '#e8a33c', tumour: '#e8e83c', condition: '#ffffff' };
    state.outbreaks.forEach(function (o) {
      var col = kindColour[o.kind] || '#ffffff';
      o.tiles.forEach(function (idx) {
        var tt = tiles[idx];
        var cx = tt.x * T + T / 2, cy = tt.y * T + T / 2;
        ctx.fillStyle = col;
        ctx.globalAlpha = 0.35 + 0.35 * pulse;
        ctx.beginPath();
        ctx.arc(cx, cy, T * (0.28 + 0.1 * pulse), 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;
        ctx.strokeStyle = col;
        ctx.lineWidth = 1;
        ctx.strokeRect(tt.x * T + 0.5, tt.y * T + 0.5, T - 1, T - 1);
      });
    });

    // --- organ labels, one per connected blob
    if (!view.overlay || view.overlay === 'none') {
      ctx.font = '600 7px ui-monospace, monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      organCentroids(state).forEach(function (c) {
        if (c.n < 8) return;                       // too small to label legibly
        var label = D.ORGANS[c.organ].name.toUpperCase();
        var w = label.length * 4.8 + 4;
        ctx.fillStyle = 'rgba(10,11,16,0.6)';
        ctx.fillRect(c.x * T - w / 2, c.y * T - 5, w, 9);
        ctx.fillStyle = 'rgba(255,255,255,0.78)';
        ctx.fillText(label, c.x * T, c.y * T);
      });
    }

    // --- hover / ghost
    if (view.hover) {
      var h = M.at(tiles, view.hover.x, view.hover.y);
      if (h) {
        var ok = h.body && !global.SimBody.actions.checkPlacement(state, h, view.tool);
        var tool = global.SimBody.actions.toolById(view.tool);
        var affordable = tool && state.atp >= tool.cost;
        ctx.strokeStyle = (view.tool === 'inspect') ? '#ffffff'
          : (ok && affordable ? '#7dffb0' : '#ff6b6b');
        ctx.lineWidth = 2;
        ctx.strokeRect(view.hover.x * T + 1, view.hover.y * T + 1, T - 2, T - 2);
      }
    }
  }

  var centroidCache = { tiles: null, value: null };

  /* One label per connected organ blob, so the two lungs (and two kidneys)
   * don't average out into a single label sitting on the heart. */
  function organCentroids(state) {
    if (centroidCache.tiles === state.tiles) return centroidCache.value;
    var tiles = state.tiles, seen = {}, out = [];
    tiles.forEach(function (t, i) {
      if (!t.organ || seen[i]) return;
      var stack = [t], sx = 0, sy = 0, n = 0;
      seen[i] = true;
      while (stack.length) {
        var cur = stack.pop();
        sx += cur.x + 0.5; sy += cur.y + 0.5; n++;
        M.neighbours(tiles, cur.x, cur.y).forEach(function (nb) {
          var ni = nb.y * C.GRID_W + nb.x;
          if (nb.organ === t.organ && !seen[ni]) { seen[ni] = true; stack.push(nb); }
        });
      }
      out.push({ organ: t.organ, x: sx / n, y: sy / n, n: n });
    });
    centroidCache = { tiles: state.tiles, value: out };
    return out;
  }

  function drawLink(ctx, tiles, t, key, T, offset, colour, strength) {
    var dirsAll = [[1, 0], [0, 1]];
    var off = offset || 0;
    var cx = t.x * T + T / 2 + off;
    var cy = t.y * T + T / 2 + off;
    var alpha = 0.3 + 0.7 * Math.max(0, Math.min(1, strength));
    ctx.strokeStyle = colour;
    ctx.globalAlpha = alpha;
    ctx.lineWidth = key === 'vessel' ? 2.8 : 1.4;
    ctx.shadowColor = colour;
    ctx.shadowBlur = key === 'vessel' ? 4 : 2;
    if (key === 'nerve') ctx.setLineDash([2, 2]);

    for (var pass = 0; pass < 2; pass++) {
      if (pass === 0) {                    // dark underlay for contrast
        ctx.strokeStyle = 'rgba(8,8,12,0.75)';
        ctx.lineWidth = key === 'vessel' ? 4 : 2.6;
        ctx.globalAlpha = 0.9;
        ctx.shadowBlur = 0;
      } else {
        ctx.strokeStyle = colour;
        ctx.lineWidth = key === 'vessel' ? 2.6 : 1.4;
        ctx.globalAlpha = alpha;
        ctx.shadowColor = colour;
        ctx.shadowBlur = key === 'vessel' ? 5 : 2;
      }
      for (var k = 0; k < dirsAll.length; k++) {
        var n = M.at(tiles, t.x + dirsAll[k][0], t.y + dirsAll[k][1]);
        if (!n || !n[key]) continue;
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.lineTo(n.x * T + T / 2 + off, n.y * T + T / 2 + off);
        ctx.stroke();
      }
    }
    // Lone segments still need to be visible.
    ctx.beginPath();
    ctx.arc(cx, cy, key === 'vessel' ? 2.1 : 1.2, 0, Math.PI * 2);
    ctx.fillStyle = colour;
    ctx.fill();
    if (key === 'nerve') ctx.setLineDash([]);
    ctx.shadowBlur = 0;
    ctx.globalAlpha = 1;
  }

  function tileFromEvent(canvas, evt) {
    var rect = canvas.getBoundingClientRect();
    var scaleX = (C.GRID_W * C.TILE) / rect.width;
    var scaleY = (C.GRID_H * C.TILE) / rect.height;
    var px = (evt.clientX - rect.left) * scaleX;
    var py = (evt.clientY - rect.top) * scaleY;
    return { x: Math.floor(px / C.TILE), y: Math.floor(py / C.TILE) };
  }

  global.SimBody.render = { setup: setup, draw: draw, tileFromEvent: tileFromEvent, OVERLAYS: OVERLAYS };
})(typeof globalThis !== 'undefined' ? globalThis : this);
