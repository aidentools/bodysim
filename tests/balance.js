/* Balance harness: plays simBody with a simple scripted strategy and prints a
 * time series, so tuning changes can be judged without clicking for an hour.
 * Usage: node tests/balance.js [seed] [days] */
var path = require('path');
['data', 'map', 'state', 'sim', 'actions'].forEach(function (f) {
  require(path.join(__dirname, '..', 'js', f + '.js'));
});
var S = globalThis.SimBody;

function bot(state) {
  var A = S.actions, tiles = state.tiles;
  Object.assign(state.policies, { diet: 75, exercise: 40, sleep: 70, hydration: 70, hygiene: 60 });

  // Treat what needs treating.
  state.outbreaks.forEach(function (o) {
    if (o.kind === 'bacteria' && o.strength > 35) S.sim.applyTreatment(state, 'antibiotics');
    else if (o.kind === 'virus' && o.strength > 45) S.sim.applyTreatment(state, 'antivirals');
    else if (o.kind === 'tumour' && o.strength > 30) S.sim.applyTreatment(state, 'surgery');
    else if (o.kind === 'fungus' && o.strength > 40) S.sim.applyTreatment(state, 'probiotic');
  });
  if (state.stats.inflammation > 60) S.sim.applyTreatment(state, 'rest');
  if (state.stats.diversity < 30) S.sim.applyTreatment(state, 'probiotic');

  var budget = state.atp - 90;
  if (budget <= 0) return;

  // Grow the vessel tree outward from perfused tiles, then zone beside it.
  var candidates = [];
  for (var i = 0; i < tiles.length; i++) {
    var t = tiles[i];
    if (!t.body) continue;
    if (!t.vessel && t.perfusion > 0.25) candidates.push(t);
  }
  candidates.sort(function (a, b) { return b.perfusion - a.perfusion; });

  var acted = 0;
  for (var k = 0; k < candidates.length && acted < 4 && state.atp > 90; k++) {
    var t = candidates[k];
    var tool;
    if (t.terrain === 'gutlining' && !t.zone) tool = 'microbiome';
    else if (!t.zone && t.terrain !== 'organ' && t.terrain !== 'marrow') tool = 'tissue';
    else if (t.terrain === 'marrow' && !t.zone) tool = 'immune';
    else tool = 'vessel';
    if (A.place(state, t.x, t.y, tool).ok) acted++;
  }
  // Extend the network into unperfused ground next to perfused vessels.
  for (var j = 0; j < tiles.length && acted < 6 && state.atp > 140; j++) {
    var n = tiles[j];
    if (!n.body || n.vessel) continue;
    var near = S.map.neighbours(tiles, n.x, n.y).some(function (q) { return q.vessel && q.perfusion > 0.3; });
    if (!near) continue;
    if (A.place(state, n.x, n.y, 'vessel').ok) acted++;
    if (state.counts.nerves < state.counts.vessels * 0.6) A.place(state, n.x, n.y, 'nerve');
  }
  if (state.atp > 260 && state.stats.immunity < 55) {
    for (var m = 0; m < tiles.length; m++) {
      var im = tiles[m];
      if (im.body && !im.zone && !im.structure && im.perfusion > 0.4 && im.terrain !== 'organ') {
        A.place(state, im.x, im.y, 'immune');
        break;
      }
    }
  }
}

var seed = +(process.argv[2] || 11);
var days = +(process.argv[3] || 365);
var st = S.state.createState(seed);
var rows = [];
for (var d = 0; d < days; d++) {
  bot(st);
  S.sim.tick(st);
  if (st.day % 30 === 0 || st.flags.gameOver) {
    rows.push({
      day: st.day, hp: st.stats.health.toFixed(0), imm: st.stats.immunity.toFixed(0),
      infl: st.stats.inflammation.toFixed(0), tox: st.stats.toxins.toFixed(0),
      div: st.stats.diversity.toFixed(0), nutr: st.stats.nutrition.toFixed(0),
      atp: st.atp.toFixed(0), net: st.income.net.toFixed(1),
      cells: st.counts.cells.toFixed(0), vess: st.counts.vessels, imm_t: st.counts.immune,
      out: st.outbreaks.length
    });
  }
  if (st.flags.gameOver) break;
}
console.table(rows);
console.log('seed', seed, '| survived to day', st.day, '| gameOver:', st.flags.gameOver, st.flags.cause || '');
console.log('infections beaten:', st.flags.infectionsBeaten);
console.log(st.log.slice(0, 8).map(function (l) { return '  d' + l.day + ' ' + l.text; }).join('\n'));
