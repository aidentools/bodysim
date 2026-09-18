/* simBody test suite — no framework, just assertions.  node tests/run.js */
var path = require('path');
['data', 'map', 'state', 'sim', 'actions'].forEach(function (f) {
  require(path.join(__dirname, '..', 'js', f + '.js'));
});
var SB = globalThis.SimBody;
var D = SB.data, C = D.CONFIG;

var passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  ok   ' + name); }
  catch (e) { failed++; console.log('  FAIL ' + name + '\n       ' + e.message); }
}
function assert(cond, msg) { if (!cond) throw new Error(msg || 'assertion failed'); }
function eq(a, b, msg) { if (a !== b) throw new Error((msg || 'expected') + ': ' + a + ' !== ' + b); }
function near(a, b, tol, msg) {
  if (Math.abs(a - b) > tol) throw new Error((msg || 'not near') + ': ' + a + ' vs ' + b);
}
function finite(v, msg) {
  assert(typeof v === 'number' && isFinite(v), (msg || 'value') + ' is not finite: ' + v);
}
function fresh(seed) { return SB.state.createState(seed === undefined ? 99 : seed); }
function run(state, days) { for (var i = 0; i < days; i++) SB.sim.tick(state); return state; }

console.log('\nmap');
test('body map has a silhouette with organs, skin and gut lining', function () {
  var t = SB.map.buildMap();
  eq(t.length, C.GRID_W * C.GRID_H, 'tile count');
  var body = t.filter(function (x) { return x.body; });
  assert(body.length > 300, 'body should cover a decent area, got ' + body.length);
  ['brain', 'heart', 'lung', 'liver', 'gut', 'kidney', 'airway'].forEach(function (o) {
    assert(t.some(function (x) { return x.organ === o; }), 'missing organ: ' + o);
  });
  assert(t.some(function (x) { return x.terrain === 'skin'; }), 'no skin');
  assert(t.some(function (x) { return x.terrain === 'gutlining'; }), 'no gut lining');
  assert(t.some(function (x) { return x.terrain === 'marrow'; }), 'no marrow');
});

test('every body region is reachable and labelled', function () {
  var t = SB.map.buildMap();
  var regions = {};
  t.forEach(function (x) { if (x.body) regions[x.region] = (regions[x.region] || 0) + 1; });
  ['head', 'neck', 'chest', 'abdomen', 'arm', 'leg'].forEach(function (r) {
    assert(regions[r] > 0, 'no tiles in region ' + r);
  });
});

test('the starting body comes with working infrastructure', function () {
  var s = fresh();
  assert(s.counts !== undefined, 'counts exist');
  SB.sim.circulate(s);
  var supplied = s.tiles.filter(function (t) { return t.body && t.perfusion > 0.22; });
  assert(supplied.length > 30, 'starting body should be partly perfused, got ' + supplied.length);
});

console.log('\ncirculation and innervation');
test('perfusion falls off with distance from the heart', function () {
  var s = fresh();
  SB.sim.circulate(s);
  var near_ = SB.map.at(s.tiles, 14, 19);      // just below the heart
  var far = SB.map.at(s.tiles, 14, 28);        // bottom of the abdomen
  assert(near_.perfusion > far.perfusion, 'near ' + near_.perfusion + ' should beat far ' + far.perfusion);
  assert(far.perfusion > 0, 'the trunk should still reach the lower abdomen');
});

test('a stopped heart stops circulation', function () {
  var s = fresh();
  s.organs.heart.health = 0;
  SB.sim.circulate(s);
  assert(s.tiles.every(function (t) { return t.perfusion === 0; }), 'no tile should be perfused');
});

test('isolated vessels get no blood', function () {
  var s = fresh();
  var lone = SB.map.at(s.tiles, 5, 25);        // a forearm tile far from the trunk
  SB.actions.place(s, lone.x, lone.y, 'vessel');
  SB.sim.circulate(s);
  eq(SB.map.at(s.tiles, 5, 25).perfusion, 0, 'disconnected vessel perfusion');
});

test('exercise extends how far blood reaches', function () {
  var lazy = fresh(), fit = fresh();
  lazy.policies.exercise = 0; fit.policies.exercise = 100;
  SB.sim.circulate(lazy); SB.sim.circulate(fit);
  var l = SB.map.at(lazy.tiles, 14, 28).perfusion;
  var f = SB.map.at(fit.tiles, 14, 28).perfusion;
  assert(f > l, 'fit body should perfuse further: ' + f + ' vs ' + l);
});

console.log('\nplacement rules');
test('zones cannot be painted onto organs', function () {
  var s = fresh();
  var heart = s.tiles.filter(function (t) { return t.organ === 'heart'; })[0];
  var res = SB.actions.place(s, heart.x, heart.y, 'tissue');
  assert(!res.ok, 'should be rejected');
  assert(/organ/i.test(res.reason), 'reason should mention organs: ' + res.reason);
});

test('microbiome only colonises gut lining or skin', function () {
  var s = fresh();
  var chest = s.tiles.filter(function (t) {
    return t.body && t.region === 'chest' && t.terrain === 'tissue' && !t.zone;
  })[0];
  assert(!SB.actions.place(s, chest.x, chest.y, 'microbiome').ok, 'chest tissue should reject flora');
  var lining = s.tiles.filter(function (t) { return t.terrain === 'gutlining' && !t.zone; })[0];
  assert(SB.actions.place(s, lining.x, lining.y, 'microbiome').ok, 'gut lining should accept flora');
});

test('building deducts ATP and refuses when broke', function () {
  var s = fresh();
  var spot = s.tiles.filter(function (t) { return t.body && !t.vessel && t.terrain === 'tissue'; })[0];
  var before = s.atp;
  var res = SB.actions.place(s, spot.x, spot.y, 'vessel');
  assert(res.ok, 'placement should succeed');
  near(s.atp, before - SB.actions.toolById('vessel').cost, 0.001, 'ATP not deducted');

  s.atp = 1;
  var spot2 = s.tiles.filter(function (t) { return t.body && !t.vessel && t.terrain === 'tissue'; })[1];
  var res2 = SB.actions.place(s, spot2.x, spot2.y, 'vessel');
  assert(!res2.ok && /ATP/.test(res2.reason), 'should refuse when broke');
  near(s.atp, 1, 0.001, 'ATP should not change on a refused build');
});

test('apoptosis clears a tile but not infected tissue', function () {
  var s = fresh();
  var t = s.tiles.filter(function (x) { return x.zone === 'tissue'; })[0];
  assert(SB.actions.place(s, t.x, t.y, 'bulldoze').ok, 'clear should work');
  eq(SB.map.at(s.tiles, t.x, t.y).zone, null, 'zone cleared');

  var s2 = fresh();
  var o = SB.sim.startOutbreak(s2, D.DISEASES[0]);
  var inf = s2.tiles[o.tiles[0]];
  assert(!SB.actions.place(s2, inf.x, inf.y, 'bulldoze').ok, 'infected tiles must not be bulldozable');
});

console.log('\neconomy');
test('a starving body loses health and cannot bank negative ATP', function () {
  var s = fresh();
  s.atp = 0;
  s.policies.diet = 0;
  s.tiles.forEach(function (t) { if (t.zone === 'microbiome') { t.zone = null; t.density = 0; } });
  run(s, 12);
  assert(s.atp >= 0, 'ATP must never go negative, got ' + s.atp);
  assert(s.income.net < 0, 'a body with no flora and no food should run a deficit');
  assert(s.stats.health < 92, 'starving should cost health');
});

test('developed gut lining raises absorption', function () {
  var bare = fresh(), fed = fresh();
  bare.tiles.forEach(function (t) { if (t.terrain === 'gutlining') { t.zone = null; t.density = 0; } });
  fed.tiles.forEach(function (t) { if (t.terrain === 'gutlining') { t.zone = 'microbiome'; t.density = 3; } });
  [bare, fed].forEach(function (s) {
    SB.sim.circulate(s); SB.sim.innervate(s); SB.sim.develop(s); SB.sim.metabolize(s);
  });
  assert(fed.income.gut > bare.income.gut, 'villi should raise gut income: ' + fed.income.gut + ' vs ' + bare.income.gut);
});

console.log('\ndisease');
test('an outbreak starts at a valid entry point and spreads', function () {
  var s = fresh();
  var flu = D.DISEASES.filter(function (d) { return d.id === 'flu'; })[0];
  var o = SB.sim.startOutbreak(s, flu);
  assert(o, 'outbreak created');
  eq(s.tiles[o.tiles[0]].organ, 'airway', 'flu should start in the airway');
  s.stats.immunity = 0;
  run(s, 25);
  var still = s.outbreaks.filter(function (x) { return x.id === o.id; })[0];
  assert(still, 'with no immunity the flu should persist');
  assert(still.tiles.length > 1, 'it should have spread, got ' + still.tiles.length);
});

test('strong immunity clears an infection', function () {
  var s = fresh();
  s.stats.immunity = 100;
  s.tiles.forEach(function (t) {
    if (t.body && t.organ === null && t.region === 'neck') { t.zone = 'immune'; t.density = 3; }
  });
  var cold = SB.sim.startOutbreak(s, D.DISEASES[0]);
  run(s, 60);
  var alive = s.outbreaks.some(function (o) { return o.id === cold.id; });
  assert(!alive, 'the cold should have been cleared by a strong immune system');
  assert(s.flags.infectionsBeaten >= 1, 'beating it should be recorded');
});

test('beating an infection leaves memory cells', function () {
  var s = fresh();
  s.stats.immunity = 100;
  var cold = D.DISEASES[0];
  SB.sim.startOutbreak(s, cold);
  run(s, 60);
  assert((s.immunity_memory[cold.id] || 0) > 0, 'memory should be acquired');
});

test('mucus barriers block their tile as an entry point', function () {
  var s = fresh();
  s.tiles.forEach(function (t) { if (t.organ === 'airway') t.structure = 'mucus'; });
  var airborne = D.DISEASES.filter(function (d) { return d.entry === 'airway'; })[0];
  for (var i = 0; i < 20; i++) {
    var o = SB.sim.startOutbreak(s, airborne, true);
    assert(!o, 'a fully sealed airway should not admit an airway pathogen');
  }
});

test('pathogens do not spread onto mucus-protected tiles as easily', function () {
  // Averaged over seeds: a single run's RNG path says nothing on its own.
  function spreadWith(seed, sealed) {
    var s = fresh(seed);
    s.stats.immunity = 0;
    if (sealed) {
      s.tiles.forEach(function (x) {
        if (x.body && (x.region === 'neck' || x.region === 'head')) x.structure = 'mucus';
      });
    }
    var flu = D.DISEASES.filter(function (d) { return d.id === 'flu'; })[0];
    SB.sim.startOutbreak(s, flu);
    run(s, 25);
    return s.outbreaks.reduce(function (n, o) {
      return n + o.tiles.filter(function (i) {
        var t2 = s.tiles[i];
        return t2.region === 'neck' || t2.region === 'head';
      }).length;
    }, 0);
  }
  var open = 0, sealed = 0;
  for (var seed = 1; seed <= 10; seed++) {
    open += spreadWith(seed, false);
    sealed += spreadWith(seed, true);
  }
  assert(sealed < open, 'barriers should slow spread: sealed ' + sealed + ' vs open ' + open);
});

console.log('\ntreatments');
test('antibiotics hit bacteria and wreck the microbiome', function () {
  var s = fresh();
  s.atp = 500;
  var bug = D.DISEASES.filter(function (d) { return d.kind === 'bacteria'; })[0];
  var o = SB.sim.startOutbreak(s, bug);
  var strength = o.strength, diversity = s.stats.diversity;
  var res = SB.sim.applyTreatment(s, 'antibiotics');
  assert(res.ok, 'treatment should apply: ' + res.reason);
  assert(o.strength < strength, 'bacteria should be knocked back');
  assert(s.stats.diversity < diversity, 'diversity should drop');
});

test('antivirals do nothing to bacteria', function () {
  var s = fresh();
  s.atp = 500;
  var bug = D.DISEASES.filter(function (d) { return d.kind === 'bacteria'; })[0];
  var o = SB.sim.startOutbreak(s, bug);
  var before = o.strength;
  SB.sim.applyTreatment(s, 'antivirals');
  eq(o.strength, before, 'bacterial strength should be untouched by antivirals');
});

test('treatments cost ATP, respect cooldowns and refuse when unaffordable', function () {
  var s = fresh();
  s.atp = 200;
  var res = SB.sim.applyTreatment(s, 'rest');
  assert(res.ok, 'first use allowed');
  near(s.atp, 175, 0.001, 'cost deducted');
  var again = SB.sim.applyTreatment(s, 'rest');
  assert(!again.ok && /cooldown/i.test(again.reason), 'second use should be blocked');
  s.atp = 0;
  var broke = SB.sim.applyTreatment(s, 'vaccine');
  assert(!broke.ok && /ATP/.test(broke.reason), 'should refuse when broke');
});

test('vaccination weakens future viral outbreaks', function () {
  var plain = fresh(), jabbed = fresh();
  jabbed.atp = 500;
  SB.sim.applyTreatment(jabbed, 'vaccine');
  var flu = D.DISEASES.filter(function (d) { return d.id === 'flu'; })[0];
  var a = SB.sim.startOutbreak(plain, flu);
  var b = SB.sim.startOutbreak(jabbed, flu);
  assert(b.strength < a.strength, 'vaccinated outbreak should start weaker: ' + b.strength + ' vs ' + a.strength);
});

test('surgery removes tumours and nothing else', function () {
  var s = fresh();
  s.atp = 500;
  var tumour = D.DISEASES.filter(function (d) { return d.kind === 'tumour'; })[0];
  var virus = D.DISEASES.filter(function (d) { return d.kind === 'virus'; })[0];
  SB.sim.startOutbreak(s, tumour);
  SB.sim.startOutbreak(s, virus);
  SB.sim.applyTreatment(s, 'surgery');
  eq(s.outbreaks.filter(function (o) { return o.kind === 'tumour'; }).length, 0, 'tumour excised');
  eq(s.outbreaks.filter(function (o) { return o.kind === 'virus'; }).length, 1, 'virus untouched');
});

console.log('\nsimulation integrity');
test('no stat ever becomes NaN or infinite over a long run', function () {
  [1, 2, 3, 7, 13].forEach(function (seed) {
    var s = fresh(seed);
    s.policies = { diet: 0, exercise: 100, sleep: 0, hydration: 0, hygiene: 100 };
    for (var i = 0; i < 400 && !s.flags.gameOver; i++) {
      SB.sim.tick(s);
      Object.keys(s.stats).forEach(function (k) { finite(s.stats[k], 'stats.' + k + ' (seed ' + seed + ')'); });
      Object.keys(s.organs).forEach(function (k) { finite(s.organs[k].health, 'organs.' + k); });
      finite(s.atp, 'atp');
      s.tiles.forEach(function (t) {
        finite(t.perfusion, 'tile perfusion'); finite(t.signal, 'tile signal'); finite(t.health, 'tile health');
      });
    }
  });
});

test('stats stay inside their 0..100 bounds', function () {
  var s = fresh(5);
  s.policies = { diet: 100, exercise: 0, sleep: 100, hydration: 100, hygiene: 0 };
  for (var i = 0; i < 300 && !s.flags.gameOver; i++) {
    SB.sim.tick(s);
    Object.keys(s.stats).forEach(function (k) {
      assert(s.stats[k] >= 0 && s.stats[k] <= 100, k + ' out of bounds: ' + s.stats[k]);
    });
  }
});

test('the same seed replays identically', function () {
  var a = run(fresh(1234), 120), b = run(fresh(1234), 120);
  eq(a.day, b.day, 'day');
  near(a.stats.health, b.stats.health, 1e-9, 'health');
  near(a.atp, b.atp, 1e-9, 'atp');
  eq(a.outbreaks.length, b.outbreaks.length, 'outbreak count');
});

test('an untended body dies within a few months', function () {
  var deaths = 0;
  for (var seed = 1; seed <= 6; seed++) {
    var s = fresh(seed);
    for (var i = 0; i < 400 && !s.flags.gameOver; i++) SB.sim.tick(s);
    if (s.flags.gameOver) deaths++;
  }
  eq(deaths, 6, 'all six neglected bodies should die inside 400 days');
});

test('death stops the simulation', function () {
  var s = fresh();
  s.stats.health = 0.1;
  s.organs.heart.health = 0;
  SB.sim.tick(s);
  assert(s.flags.gameOver, 'should be over');
  var day = s.day;
  SB.sim.tick(s);
  eq(s.day, day, 'no further days should pass');
});

console.log('\nsave/load');
test('a save round-trips the map, stats and outbreaks', function () {
  var s = fresh(77);
  run(s, 40);
  SB.sim.startOutbreak(s, D.DISEASES[0]);
  var copy = SB.state.deserialize(SB.state.serialize(s));
  eq(copy.day, s.day, 'day');
  near(copy.atp, s.atp, 0.001, 'atp');
  eq(copy.outbreaks.length, s.outbreaks.length, 'outbreaks');
  eq(copy.tiles.filter(function (t) { return t.zone; }).length,
     s.tiles.filter(function (t) { return t.zone; }).length, 'zoned tiles');
  eq(copy.tiles.filter(function (t) { return t.vessel; }).length,
     s.tiles.filter(function (t) { return t.vessel; }).length, 'vessels');
  eq(copy.tiles.filter(function (t) { return t.pathogen !== null; }).length,
     s.tiles.filter(function (t) { return t.pathogen !== null; }).length, 'infected tiles');
  // and it must keep simulating
  SB.sim.tick(copy);
  finite(copy.stats.health, 'health after reload');
});

console.log('\nadvisors');
test('advisors always say something useful', function () {
  var s = fresh();
  run(s, 5);
  var tips = SB.sim.advice(s);
  assert(tips.length > 0, 'at least one tip');
  tips.forEach(function (t) {
    assert(D.ADVISORS[t.advisor], 'unknown advisor ' + t.advisor);
    assert(t.text && t.text.length > 10, 'tip should be a sentence');
  });
});

console.log('\n' + passed + ' passed, ' + failed + ' failed\n');
process.exit(failed ? 1 : 0);
