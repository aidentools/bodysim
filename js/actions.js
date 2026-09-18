/* simBody — player actions: placing, zoning and clearing tiles. */
(function (global) {
  'use strict';
  var D = global.SimBody.data;
  var M = global.SimBody.map;

  function toolById(id) {
    return D.TOOLS.filter(function (t) { return t.id === id; })[0];
  }

  function checkPlacement(state, tile, toolId) {
    if (!tile || !tile.body) return 'Outside the body.';
    var tool = toolById(toolId);
    if (!tool) return 'Unknown tool.';
    if (tool.kind === 'cursor') return null;

    if (tool.kind === 'bulldoze') {
      if (!tile.zone && !tile.structure && !tile.vessel && !tile.nerve) return 'Nothing here to clear.';
      if (tile.pathogen !== null) return 'Cannot clear infected tissue — treat the infection first.';
      return null;
    }
    var rule = D.PLACEMENT[toolId];
    var why = rule ? rule(tile) : null;
    if (why) return why;

    if (tool.kind === 'network') {
      if (toolId === 'vessel' && tile.vessel) return 'Already vascularised.';
      if (toolId === 'nerve' && tile.nerve) return 'Already innervated.';
    }
    if (tool.kind === 'zone') {
      if (tile.zone === toolId) return 'Already zoned for that.';
      if (tile.structure) return 'A structure occupies this tile.';
    }
    if (tool.kind === 'structure') {
      if (tile.structure) return 'A structure is already here.';
      if (tile.zone) return 'Clear the zone first.';
    }
    if (tile.pathogen !== null) return 'Infected tissue — you cannot build here.';
    return null;
  }

  function place(state, x, y, toolId) {
    if (state.flags.gameOver) return { ok: false, reason: 'The body is gone.' };
    var tile = M.at(state.tiles, x, y);
    var tool = toolById(toolId);
    if (!tool || tool.kind === 'cursor') return { ok: false, reason: null, silent: true };

    var why = checkPlacement(state, tile, toolId);
    if (why) return { ok: false, reason: why };
    if (state.atp < tool.cost) return { ok: false, reason: 'Not enough ATP — ' + tool.cost + ' required.' };

    state.atp -= tool.cost;

    switch (tool.kind) {
      case 'network':
        if (toolId === 'vessel') tile.vessel = true; else tile.nerve = true;
        break;
      case 'zone':
        tile.zone = toolId;
        tile.density = tile.density > 0 ? 1 : 0;
        tile.health = Math.max(tile.health, 60);
        break;
      case 'structure':
        tile.structure = toolId;
        break;
      case 'bulldoze':
        tile.zone = null;
        tile.structure = null;
        tile.vessel = false;
        tile.nerve = false;
        tile.density = 0;
        tile.health = Math.max(40, tile.health - 10);
        break;
    }
    return { ok: true, tile: tile, spent: tool.cost };
  }

  function setPolicy(state, id, value) {
    if (!(id in state.policies)) return false;
    state.policies[id] = Math.max(0, Math.min(100, Math.round(value)));
    return true;
  }

  function tileReport(state, tile) {
    if (!tile || !tile.body) return { title: 'Outside the body', lines: [] };
    var lines = [];
    var title = tile.organ ? D.ORGANS[tile.organ].name
      : (D.TERRAIN[tile.terrain] ? D.TERRAIN[tile.terrain].name : 'Tissue');
    lines.push(['Region', tile.region]);
    if (tile.organ) lines.push(['Organ health', Math.round(state.organs[tile.organ].health) + '%']);
    if (tile.zone) lines.push(['Zone', D.ZONES[tile.zone].name + ' · density ' + tile.density]);
    if (tile.structure) lines.push(['Structure', D.STRUCTURES[tile.structure].name]);
    lines.push(['Supply', Math.round(tile.perfusion * 100) + '% blood · ' + Math.round(tile.signal * 100) + '% signal']);
    lines.push(['Network', (tile.vessel ? 'vessel ' : '') + (tile.nerve ? 'nerve' : '') || 'none']);
    lines.push(['Condition', Math.round(tile.health) + '% healthy · ' + Math.round(tile.inflam) + ' inflammation']);
    if (tile.pathogen !== null) {
      var o = state.outbreaks.filter(function (ob) { return ob.id === tile.pathogen; })[0];
      if (o) lines.push(['INFECTED', o.name + ' (strength ' + Math.round(o.strength) + ')']);
    }
    return { title: title, lines: lines, desc: tile.organ ? D.ORGANS[tile.organ].desc : null };
  }

  global.SimBody.actions = {
    place: place, checkPlacement: checkPlacement, setPolicy: setPolicy,
    toolById: toolById, tileReport: tileReport
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
