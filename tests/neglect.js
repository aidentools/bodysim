/* How long does an untended body last? Run with no player input at all. */
var path = require('path');
['data', 'map', 'state', 'sim', 'actions'].forEach(function (f) { require(path.join(__dirname, '..', 'js', f + '.js')); });
var S = globalThis.SimBody;
var mode = process.argv[2] || 'default';
var results = [];
for (var seed = 1; seed <= 8; seed++) {
  var st = S.state.createState(seed);
  if (mode === 'bad') Object.assign(st.policies, { diet: 20, exercise: 5, sleep: 30, hydration: 25, hygiene: 25 });
  for (var d = 0; d < 1200 && !st.flags.gameOver; d++) S.sim.tick(st);
  results.push({ seed: seed, day: st.day, dead: st.flags.gameOver, hp: st.stats.health.toFixed(0),
    infl: st.stats.inflammation.toFixed(0), tox: st.stats.toxins.toFixed(0), cause: st.flags.cause || '' });
}
console.log('neglect mode:', mode);
console.table(results);
