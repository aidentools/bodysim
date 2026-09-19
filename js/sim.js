/* simBody — the simulation. One tick == one day in the life of a body.
 *
 * Passes, in order:
 *   1. circulation   blood spreads from the heart along vessels
 *   2. innervation   signal spreads from the brain along nerves
 *   3. development   zones grow, starve or die back
 *   4. metabolism    ATP income vs. upkeep
 *   5. pathology     outbreaks grow, spread, damage and get fought
 *   6. homeostasis   global stats drift toward their targets
 *   7. chance        new infections and conditions roll
 */
(function (global) {
  'use strict';
  var D = global.SimBody.data;
  var M = global.SimBody.map;
  var St = global.SimBody.state;
  var C = D.CONFIG;

  function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }
  function drift(cur, target, rate) {
    if (cur < target) return Math.min(target, cur + rate);
    return Math.max(target, cur - rate);
  }

  // ------------------------------------------------------- 1. circulation --
  function circulate(state) {
    var tiles = state.tiles, i, t;
    for (i = 0; i < tiles.length; i++) { tiles[i].perfusion = 0; }

    var heartFn = state.organs.heart.health / 100;
    var fitness = 0.62 + 0.38 * (state.policies.exercise / 100);
    var range = Math.max(3, C.HEART_RANGE * heartFn * fitness);
    var pressure = clamp(heartFn * fitness, 0, 1);

    // Seed the queue with every vessel tile the heart itself touches.
    var queue = [], dist = new Float32Array(tiles.length).fill(Infinity);
    for (i = 0; i < tiles.length; i++) {
      t = tiles[i];
      if (t.organ === 'heart') {
        M.neighbours(tiles, t.x, t.y).forEach(function (n) {
          if (n.vessel && dist[n.y * C.GRID_W + n.x] === Infinity) {
            dist[n.y * C.GRID_W + n.x] = 0;
            queue.push(n);
          }
        });
      }
    }

    var head = 0;
    while (head < queue.length) {
      t = queue[head++];
      var d = dist[t.y * C.GRID_W + t.x];
      if (d >= range) continue;
      var ns = M.neighbours(tiles, t.x, t.y);
      for (var k = 0; k < ns.length; k++) {
        var n = ns[k], ni = n.y * C.GRID_W + n.x;
        if (!n.vessel || dist[ni] <= d + 1) continue;
        // Blocked vessels: heavy inflammation or a pathogen slows flow.
        var resistance = 1 + (n.inflam > 60 ? 0.3 : 0) + (n.pathogen !== null ? 0.4 : 0);
        dist[ni] = d + resistance;
        queue.push(n);
      }
    }

    for (i = 0; i < tiles.length; i++) {
      t = tiles[i];
      if (t.vessel && dist[i] < Infinity) {
        // clamp the base: BFS resistance can push a tile just past the range
        t.perfusion = clamp(pressure * Math.pow(Math.max(0, 1 - dist[i] / range), 0.6), 0, 1);
      }
    }
    // Tissue next to a live vessel is perfused by diffusion.
    for (i = 0; i < tiles.length; i++) {
      t = tiles[i];
      if (!t.body || t.vessel) continue;
      var best = 0;
      M.neighbours(tiles, t.x, t.y).forEach(function (n) {
        if (n.vessel && n.perfusion > best) best = n.perfusion;
      });
      t.perfusion = best * 0.85;
    }
    state.derived = state.derived || {};
    state.derived.pressure = pressure;
    state.derived.range = range;
  }

  // ------------------------------------------------------- 2. innervation --
  function innervate(state) {
    var tiles = state.tiles, i, t;
    for (i = 0; i < tiles.length; i++) tiles[i].signal = 0;

    var brainFn = state.organs.brain.health / 100;
    var range = Math.max(2, C.BRAIN_RANGE * brainFn);
    var dist = new Float32Array(tiles.length).fill(Infinity);
    var queue = [];

    for (i = 0; i < tiles.length; i++) {
      t = tiles[i];
      if (t.organ === 'brain') {
        M.neighbours(tiles, t.x, t.y).forEach(function (n) {
          var ni = n.y * C.GRID_W + n.x;
          if (n.nerve && dist[ni] === Infinity) { dist[ni] = 0; queue.push(n); }
        });
      }
    }
    var head = 0;
    while (head < queue.length) {
      t = queue[head++];
      var d = dist[t.y * C.GRID_W + t.x];
      if (d >= range) continue;
      M.neighbours(tiles, t.x, t.y).forEach(function (n) {
        var ni = n.y * C.GRID_W + n.x;
        if (n.nerve && dist[ni] > d + 1) { dist[ni] = d + 1; queue.push(n); }
      });
    }
    for (i = 0; i < tiles.length; i++) {
      t = tiles[i];
      if (t.nerve && dist[i] < Infinity) {
        t.signal = clamp(brainFn * Math.pow(Math.max(0, 1 - dist[i] / range), 0.5), 0, 1);
      }
    }
    for (i = 0; i < tiles.length; i++) {
      t = tiles[i];
      if (!t.body || t.nerve) continue;
      var best = 0;
      M.neighbours(tiles, t.x, t.y).forEach(function (n) { if (n.nerve && n.signal > best) best = n.signal; });
      t.signal = best * 0.8;
    }
  }

  // -------------------------------------------------------- 3. development --
  function develop(state) {
    var tiles = state.tiles, rng = state.rng;
    var fibre = state.policies.diet / 100;
    var hygiene = state.policies.hygiene / 100;
    var counts = { cells: 0, flora: 0, immune: 0, vessels: 0, nerves: 0, floraTiles: 0, lymph: 0, fat: 0, plasma: 0, mucus: 0, starved: 0 };
    var immuneCapacity = 0;
    // When the ATP bank is empty the body eats itself, worst-supplied cells first.
    var starving = state.income && state.income.starving;
    var catabolised = 0;

    for (var i = 0; i < tiles.length; i++) {
      var t = tiles[i];
      if (!t.body) continue;
      if (t.vessel) counts.vessels++;
      if (t.nerve) counts.nerves++;
      if (t.structure) counts[t.structure]++;

      // Tiles heal slowly when supplied, and rot when they are not.
      if (t.pathogen === null) {
        t.health = clamp(t.health + 0.6 * t.perfusion * (state.stats.nutrition / 100) - (t.inflam > 55 ? 0.4 : 0), 0, 100);
        t.inflam = clamp(t.inflam - 1.2 - 1.5 * (state.policies.sleep / 100), 0, 100);
      }

      if (!t.zone) continue;

      var supplied = t.perfusion > 0.22;
      var signalled = t.signal > 0.2;

      if (t.zone === 'tissue') {
        if (!supplied) {
          t.health = clamp(t.health - 2.2, 0, 100);
          if (t.health <= 0 && t.density > 0) { t.density--; t.health = 35; }
          if (t.density === 0 && rng() < 0.2) t.zone = null;
        } else if (starving && t.density > 0 && rng() < 0.1 * (1.1 - t.perfusion)) {
          t.density--;                       // autophagy: burn the tissue you cannot feed
          catabolised++;
        } else if (t.density < C.MAX_DENSITY) {
          var chance = 0.05 + 0.22 * t.perfusion + (signalled ? 0.12 : -0.05) - t.inflam / 320;
          if (state.atp > 25 && rng() < chance) t.density++;
        }
        counts.cells += t.density * (0.4 + 0.6 * t.health / 100);
        if (t.perfusion < 0.25) counts.starved += t.density;
      } else if (t.zone === 'microbiome') {
        // Flora live on fibre, not blood. Antibiotics and sterile living hurt.
        var floraChance = 0.04 + 0.3 * fibre - 0.12 * hygiene - t.inflam / 400;
        if (t.density < C.MAX_DENSITY && rng() < floraChance) t.density++;
        else if (fibre < 0.25 && rng() < 0.12 && t.density > 0) t.density--;
        if (t.density === 0 && rng() < 0.15) t.zone = null;
        counts.flora += t.density;
        if (t.density > 0) counts.floraTiles++;
      } else if (t.zone === 'immune') {
        if (!supplied) {
          t.density = Math.max(0, t.density - (rng() < 0.3 ? 1 : 0));
          if (t.density === 0 && rng() < 0.2) t.zone = null;
        } else if (t.density < C.MAX_DENSITY) {
          var demand = state.outbreaks.length > 0 ? 0.3 : 0.1;
          if (state.atp > 40 && rng() < demand + 0.15 * t.perfusion) t.density++;
        }
        var boost = 1;
        M.neighbours(tiles, t.x, t.y).forEach(function (n) { if (n.structure === 'lymph') boost += 0.9; });
        if (t.terrain === 'marrow') boost += 0.6;
        counts.immune += t.density;
        immuneCapacity += t.density * boost * (0.4 + 0.6 * t.perfusion);
      }
    }

    if (catabolised > 3 && state.day % 5 === 0) {
      St.log(state, 'Out of ATP: ' + catabolised + ' tissue units catabolised. The body is eating itself.', 'bad');
    }
    state.counts = counts;
    state.derived.immuneCapacity = immuneCapacity;
    return counts;
  }

  // --------------------------------------------------------- 4. metabolism --
  function metabolize(state) {
    var tiles = state.tiles, i, t;
    var P = state.policies, O = state.organs, counts = state.counts;

    var lungFn = O.lung.health / 100;
    var oxygen = clamp(0.35 + 0.65 * lungFn * (0.8 + 0.2 * P.exercise / 100), 0, 1);

    // Absorption is villi surface area: developed, well-perfused gut tiles.
    var absorption = 0;
    for (i = 0; i < tiles.length; i++) {
      t = tiles[i];
      if (t.terrain !== 'gutlining' && t.organ !== 'gut') continue;
      if (!t.zone) continue;
      absorption += t.density * (0.25 + 0.75 * t.perfusion) * (t.health / 100);
    }
    absorption = clamp(absorption / 26, 0, 1);

    var floraScore = clamp(counts.flora / 24, 0, 1) * (0.45 + 0.55 * state.stats.diversity / 100);
    var digestion = (O.gut.health / 100) * (0.3 + 0.7 * absorption) * (0.6 + 0.4 * floraScore);
    var restPenalty = state.restDays > 0 ? 0.6 : 1;
    var sleepCost = 1 - P.sleep / 420;      // more sleep, fewer productive waking hours

    var gutIntake = C.BASE_INTAKE * (0.45 + 0.9 * P.diet / 100) * digestion * oxygen
      * (1 - state.stats.inflammation * 0.002) * restPenalty * sleepCost;

    // Cells do work: a well-supplied cell earns more ATP than it burns.
    var cellWork = 0;
    for (i = 0; i < tiles.length; i++) {
      t = tiles[i];
      if (t.zone !== 'tissue' || !t.density) continue;
      cellWork += t.density * (0.25 + 0.75 * t.perfusion) * (t.health / 100)
        * (0.7 + 0.3 * t.signal);
    }
    // Well-supplied cells earn more than they cost; badly supplied ones do not.
    cellWork *= 0.95 * oxygen * restPenalty;

    var upkeep = 0;
    D.TOOLS.forEach(function (tool) {
      if (!tool.upkeep) return;
      if (tool.kind === 'network') upkeep += tool.upkeep * (tool.id === 'vessel' ? counts.vessels : counts.nerves);
      else if (tool.kind === 'zone' && tool.id === 'immune') upkeep += tool.upkeep * counts.immune;
      else if (tool.kind === 'structure') upkeep += tool.upkeep * (counts[tool.id] || 0);
    });

    var exerciseCost = (P.exercise / 100) * 12;
    var hygieneCost = (P.hygiene / 100) * 2;
    var basal = C.BASAL_COST + counts.cells * C.CELL_COST + exerciseCost + hygieneCost;
    var pathogenDrain = state.outbreaks.reduce(function (a, o) { return a + Math.max(0, o.strength) * 0.04; }, 0);

    // Cells convert nutrients into ATP — they cannot out-earn what the gut absorbs.
    // This is the ceiling on how large a body you can actually feed.
    var usableWork = Math.min(cellWork, gutIntake * 0.9);
    var intake = gutIntake + usableWork;
    var net = intake - basal - upkeep - pathogenDrain;
    var store = C.STORE_BASE + (counts.fat || 0) * C.STORE_PER_FAT;
    state.atp = state.atp + net;

    var starving = false;
    if (state.atp < 0) { starving = true; state.atp = 0; }
    if (state.atp > store) state.atp = store;

    state.income = {
      intake: intake, gut: gutIntake, work: usableWork, workPotential: cellWork,
      workCapped: cellWork > gutIntake * 0.9,
      upkeep: upkeep + pathogenDrain, basal: basal,
      net: net, store: store, digestion: digestion, absorption: absorption,
      oxygen: oxygen, starving: starving
    };
    state.stats.oxygen = oxygen * 100;
    return state.income;
  }

  // ---------------------------------------------------------- 5. pathology --
  function localDefence(state, tileIdx) {
    var tiles = state.tiles;
    var t = tiles[tileIdx];
    var sum = 0;
    for (var dy = -2; dy <= 2; dy++) {
      for (var dx = -2; dx <= 2; dx++) {
        var n = M.at(tiles, t.x + dx, t.y + dy);
        if (!n || n.zone !== 'immune') continue;
        var w = 1 / (1 + Math.abs(dx) + Math.abs(dy));
        var boost = n.terrain === 'marrow' ? 1.6 : 1;
        M.neighbours(tiles, n.x, n.y).forEach(function (q) { if (q.structure === 'lymph') boost += 0.9; });
        sum += n.density * w * boost;
      }
    }
    return sum;
  }

  function pathology(state) {
    var tiles = state.tiles, rng = state.rng;
    var survivors = [];

    state.outbreaks.forEach(function (o) {
      var disease = D.DISEASES.filter(function (d) { return d.id === o.disease; })[0];
      if (!disease) return;
      var memory = state.immunity_memory[disease.id] || 0;

      // How hard is the body pushing back here?
      var defence = 0;
      o.tiles.forEach(function (idx) { defence += localDefence(state, idx); });
      defence = defence / Math.max(1, o.tiles.length);
      defence = defence * 1.8 + state.stats.immunity / 18;
      defence *= (1 + memory);
      defence *= (0.6 + 0.4 * state.policies.sleep / 100);

      // Growth outpaces defence when the body is inflamed and undersupplied.
      var growth = disease.growth * (1 - memory * 0.5) * (1 + state.stats.inflammation / 260)
        * (1 - clamp(state.stats.immunity / 220, 0, 0.45));
      o.strength = o.strength + growth * 1.9 - defence * 1.5;
      o.age++;

      // Damage every tile it occupies, and the organs underneath.
      o.tiles.forEach(function (idx) {
        var t = tiles[idx];
        var dmg = disease.damage * (0.5 + o.strength / 60);
        t.health = clamp(t.health - dmg, 0, 100);
        t.inflam = clamp(t.inflam + 4 + disease.damage * 2, 0, 100);
        if (t.zone && t.health <= 0 && t.density > 0 && rng() < 0.3) t.density--;
        if (t.organ) {
          state.organs[t.organ].health = clamp(state.organs[t.organ].health - dmg * 0.14, 0, 100);
        }
      });

      // Spread to neighbouring tiles.
      if (o.strength > 12 && o.tiles.length < 60) {
        var frontier = [];
        o.tiles.forEach(function (idx) {
          var t = tiles[idx];
          M.neighbours(tiles, t.x, t.y).forEach(function (n) {
            if (n.body && n.pathogen === null) frontier.push(n);
          });
        });
        for (var f = 0; f < frontier.length; f++) {
          var n = frontier[f];
          if (n.pathogen !== null) continue;
          var p = disease.virulence * (1 + o.strength / 120)
            * (1 - clamp(state.stats.immunity / 180, 0, 0.6))
            * (n.structure === 'mucus' ? 0.15 : 1)
            * (n.zone === 'immune' ? 0.35 : 1)
            * (n.terrain === 'organ' ? 0.45 : 1)
            * (n.organ === 'brain' || n.organ === 'heart' ? 0.3 : 1)
            * (disease.kind === 'fungus' && n.zone === 'microbiome' ? 0.4 : 1);
          if (rng() < p * 0.25) {
            n.pathogen = o.id;
            o.tiles.push(n.y * C.GRID_W + n.x);
          }
        }
      }

      // Retreat: tiles are cleared as the outbreak weakens.
      if (o.strength < o.peak * 0.5 && o.tiles.length > 1 && rng() < 0.5) {
        var idx = o.tiles.pop();
        tiles[idx].pathogen = null;
      }
      o.peak = Math.max(o.peak, o.strength);

      if (o.strength <= 0) {
        o.tiles.forEach(function (idx) { tiles[idx].pathogen = null; });
        state.immunity_memory[disease.id] = clamp((state.immunity_memory[disease.id] || 0) + 0.35, 0, 0.8);
        state.flags.infectionsBeaten++;
        St.log(state, 'Cleared: ' + disease.name + ' after ' + o.age + ' days. Memory cells acquired.', 'good');
      } else if (o.tiles.length === 0) {
        St.log(state, disease.name + ' was pushed out of the tissue.', 'good');
      } else {
        survivors.push(o);
        if (o.age === 4 && o.strength > 30) {
          St.log(state, disease.name + ' is getting worse — it now covers ' + o.tiles.length + ' tiles.', 'bad');
        }
        // Bacteria in the bloodstream is how a bad day becomes a fatal one.
        if (disease.kind === 'bacteria' && o.strength > 70 && o.tiles.some(function (i2) { return tiles[i2].organ === 'heart'; })) {
          state.stats.health = clamp(state.stats.health - 3, 0, 100);
          St.log(state, 'SEPSIS: ' + disease.name + ' has reached the heart.', 'bad');
        }
      }
    });
    state.outbreaks = survivors;
  }

  // ------------------------------------------------------- 6. homeostasis --
  function homeostasis(state) {
    var P = state.policies, S = state.stats, O = state.organs, counts = state.counts;
    var pathogenLoad = state.outbreaks.reduce(function (a, o) { return a + o.strength; }, 0);
    var tileCount = state.outbreaks.reduce(function (a, o) { return a + o.tiles.length; }, 0);

    // --- microbiome diversity
    var divTarget = 18 + counts.floraTiles * 2.6 + P.diet * 0.28 - P.hygiene * 0.14
      - (S.inflammation * 0.12) - (counts.flora > 0 ? 0 : 20);
    S.diversity = clamp(drift(S.diversity, clamp(divTarget, 0, 100), 1.6), 0, 100);

    // --- toxins: junk food and dying tissue in, liver and kidneys out
    var liverFn = O.liver.health / 100, kidneyFn = O.kidney.health / 100;
    var clearance = (1.7 * liverFn + 1.6 * kidneyFn * (0.35 + 0.65 * P.hydration / 100));
    var toxinIn = (100 - P.diet) * 0.075 + pathogenLoad * 0.02 + (counts.fat > 3 ? (counts.fat - 3) * 0.3 : 0);
    S.toxins = clamp(S.toxins + toxinIn - clearance, 0, 100);

    // --- inflammation: the central tension of the whole game
    var scfa = (S.diversity / 100) * (counts.flora / 14);
    var inflamIn = Math.min(6, pathogenLoad * 0.05 + tileCount * 0.18) + counts.immune * 0.1
      + (100 - P.sleep) * 0.045 + S.toxins * 0.06 + counts.starved * 0.05
      + Math.max(0, state.age - 40) * 0.02 + (counts.fat > 3 ? (counts.fat - 3) * 0.5 : 0);
    var inflamOut = 0.6 + (P.sleep / 100) * 1.7 + Math.min(1.0, scfa) * 1.5 + (P.exercise / 100) * 0.7;
    S.inflammation = clamp(S.inflammation + inflamIn - inflamOut, 0, 100);

    // --- immunity
    var agePenalty = Math.max(0, (state.age - 35)) * 0.35;
    var immTarget = 12 + state.derived.immuneCapacity * 3.4 + (counts.plasma || 0) * 5
      + P.sleep * 0.16 + S.diversity * 0.2 + (S.nutrition * 0.08)
      - S.inflammation * 0.22 - S.toxins * 0.15 - agePenalty;
    S.immunity = clamp(drift(S.immunity, clamp(immTarget, 0, 100), 2.2), 0, 100);

    // --- nutrition: are you actually covering your metabolic bill?
    var ratio = state.income.intake / Math.max(1, state.income.basal + state.income.upkeep);
    var nutTarget = clamp(30 + ratio * 45 + (P.diet - 50) * 0.3, 0, 100);
    if (state.income.starving) nutTarget = Math.min(nutTarget, 20);
    S.nutrition = drift(S.nutrition, nutTarget, 2.5);

    // --- mood
    var moodTarget = clamp(35 + P.sleep * 0.25 + P.exercise * 0.18 + (S.health - 50) * 0.3
      - S.inflammation * 0.2 - pathogenLoad * 0.25, 0, 100);
    S.mood = drift(S.mood, moodTarget, 2);

    // --- organ repair and organ wear
    Object.keys(O).forEach(function (id) {
      var repair = 0.9 * (S.nutrition / 100) * (0.45 + 0.55 * P.sleep / 100)
        * Math.max(0.45, 1 - Math.max(0, state.age - 35) * 0.012);
      var wear = 0.05 + S.inflammation * 0.004;
      if (id === 'liver') wear += S.toxins * 0.03;
      if (id === 'kidney') wear += S.toxins * 0.025 + (100 - P.hydration) * 0.01;
      if (id === 'lung') wear += S.inflammation * 0.012;
      if (id === 'heart') wear += S.inflammation * 0.014 + (P.exercise < 15 ? 0.15 : 0) - (P.exercise / 100) * 0.12;
      if (id === 'brain') wear += (100 - P.sleep) * 0.011 + S.toxins * 0.008;
      if (id === 'gut') wear += Math.max(0, 55 - S.diversity) * 0.02;
      O[id].health = clamp(O[id].health + repair - wear, 0, 100);
    });

    // --- health: the headline number everything else feeds
    var organAvg = 0, vitalMin = 100, n = 0;
    Object.keys(O).forEach(function (id) {
      organAvg += O[id].health; n++;
      if (D.ORGANS[id].vital) vitalMin = Math.min(vitalMin, O[id].health);
    });
    organAvg /= n;

    var healthTarget = clamp(
      organAvg * 0.36 +
      (100 - S.inflammation) * 0.18 +
      (100 - S.toxins) * 0.12 +
      S.nutrition * 0.16 +
      P.hydration * 0.08 +
      S.mood * 0.05 +
      clamp(state.counts.cells * 1.6, 0, 100) * 0.05
      - pathogenLoad * 0.35, 0, 100);

    S.health = clamp(drift(S.health, healthTarget, C.HEALTH_DRIFT), 0, 100);
    if (state.income.starving) S.health = clamp(S.health - 1.2, 0, 100);
    if (vitalMin < 25) S.health = clamp(S.health - (25 - vitalMin) * 0.12, 0, 100);
    state.flags.peakHealth = Math.max(state.flags.peakHealth, S.health);

    // Memory cells fade. Nothing protects you forever.
    Object.keys(state.immunity_memory).forEach(function (k) {
      state.immunity_memory[k] *= 0.9975;
      if (state.immunity_memory[k] < 0.01) delete state.immunity_memory[k];
    });

    if (state.restDays > 0) {
      state.restDays--;
      S.inflammation = clamp(S.inflammation - 6, 0, 100);
      S.immunity = clamp(S.immunity + 3, 0, 100);
    }
  }

  // -------------------------------------------------------------- 7. chance --
  function entryCandidates(state, entry) {
    var tiles = state.tiles, out = [];
    for (var i = 0; i < tiles.length; i++) {
      var t = tiles[i];
      if (!t.body || t.pathogen !== null) continue;
      var ok = false;
      if (entry === 'airway') ok = t.organ === 'airway';
      else if (entry === 'gut') ok = t.terrain === 'gutlining' || t.organ === 'gut';
      else if (entry === 'skin') ok = t.terrain === 'skin';
      else if (entry === 'lung') ok = t.organ === 'lung';
      else ok = true;
      if (ok && t.structure !== 'mucus') out.push(i);
    }
    return out;
  }

  function startOutbreak(state, disease, quiet, novel) {
    var spots = entryCandidates(state, disease.entry);
    if (!spots.length) return null;
    var idx = spots[Math.floor(state.rng() * spots.length)];
    if (novel) state.immunity_memory[disease.id] = 0;
    var memory = state.immunity_memory[disease.id] || 0;
    var o = {
      id: state.nextOutbreakId++,
      disease: disease.id,
      kind: disease.kind,
      name: novel ? disease.name + ' (novel strain)' : disease.name,
      novel: !!novel,
      tiles: [idx],
      strength: clamp((14 + state.day * 0.012) * (1 - memory) + state.rng() * 8, 4, 45),
      peak: 0,
      age: 0
    };
    o.peak = o.strength;
    state.tiles[idx].pathogen = o.id;
    state.outbreaks.push(o);
    if (!quiet) {
      St.log(state, 'OUTBREAK: ' + o.name + ' — ' + disease.flavour
        + (novel ? ' Your memory cells do not recognise this one.' : ''), 'bad');
    }
    return o;
  }

  function weightedPick(rng, list) {
    var total = list.reduce(function (a, d) { return a + d.weight; }, 0);
    var r = rng() * total;
    for (var i = 0; i < list.length; i++) {
      r -= list[i].weight;
      if (r <= 0) return list[i];
    }
    return list[list.length - 1];
  }

  function applyCondition(state, cond) {
    var S = state.stats;
    switch (cond.id) {
      case 'dysbiosis':
        S.diversity = clamp(S.diversity - 35, 0, 100);
        state.tiles.forEach(function (t) {
          if (t.zone === 'microbiome' && state.rng() < 0.4) t.density = Math.max(0, t.density - 1);
        });
        break;
      case 'allergy':
        S.inflammation = clamp(S.inflammation + 22, 0, 100);
        break;
      case 'autoimmune':
        S.inflammation = clamp(S.inflammation + 15, 0, 100);
        state.tiles.forEach(function (t) {
          if (t.zone === 'tissue' && state.rng() < 0.18) t.health = clamp(t.health - 30, 0, 100);
        });
        break;
      case 'stone':
        state.organs.kidney.health = clamp(state.organs.kidney.health - 18, 0, 100);
        break;
      case 'injury':
        state.tiles.forEach(function (t) {
          if (t.zone === 'tissue' && t.region !== 'chest' && state.rng() < 0.12) {
            t.health = clamp(t.health - 45, 0, 100);
            t.inflam = clamp(t.inflam + 30, 0, 100);
          }
        });
        break;
    }
    St.log(state, cond.name.toUpperCase() + ': ' + cond.flavour, 'bad');
  }

  function rollEvents(state) {
    var S = state.stats, P = state.policies, rng = state.rng;
    var ageFactor = 1 + Math.max(0, state.age - 30) * 0.012;
    var risk = C.INFECTION_BASE_RISK
      * (1 + (100 - S.immunity) / 55)
      * (1 + S.inflammation / 130)
      * (1.35 - P.hygiene / 190)
      * ageFactor
      * (1 + state.outbreaks.length * 0.15)
      * (1 + state.day / 500);

    if (rng() < risk && state.outbreaks.length < 4) {
      var pool = D.DISEASES.filter(function (d) {
        return state.day >= d.minDay && !state.outbreaks.some(function (o) { return o.disease === d.id; });
      });
      if (pool.length) {
        // Strains drift: sooner or later something arrives that you have never met.
        var novel = state.day > 120 && rng() < 0.22;
        startOutbreak(state, weightedPick(rng, pool), false, novel);
      }
    }

    var condRisk = 0.006 * (1 + S.inflammation / 100) * (1 + S.toxins / 120) * ageFactor;
    if (state.policies.hydration < 30) condRisk *= 1.6;
    if (state.policies.exercise > 80) condRisk *= 1.3;
    if (rng() < condRisk) applyCondition(state, weightedPick(rng, D.CONDITIONS));
  }

  // ------------------------------------------------------------ treatments --
  function treatmentReady(state, id) {
    return (state.treatmentCooldowns[id] || 0) <= 0;
  }

  function applyTreatment(state, id) {
    var spec = D.TREATMENTS.filter(function (t) { return t.id === id; })[0];
    if (!spec) return { ok: false, reason: 'Unknown treatment.' };
    if (!treatmentReady(state, id)) return { ok: false, reason: spec.name + ' is on cooldown for ' + Math.ceil(state.treatmentCooldowns[id]) + ' more days.' };
    if (state.atp < spec.cost) return { ok: false, reason: 'Not enough ATP (' + spec.cost + ' needed).' };

    state.atp -= spec.cost;
    state.treatmentCooldowns[id] = spec.cooldown;
    var S = state.stats, hit = 0;

    var damageKind = function (kinds, amount) {
      state.outbreaks.forEach(function (o) {
        if (kinds.indexOf(o.kind) >= 0) { o.strength -= amount; hit++; }
      });
    };

    switch (id) {
      case 'antibiotics':
        damageKind(['bacteria'], 65);
        S.diversity = clamp(S.diversity - 32, 0, 100);
        state.tiles.forEach(function (t) {
          if (t.zone === 'microbiome' && state.rng() < 0.55) t.density = Math.max(0, t.density - 1);
        });
        St.log(state, 'Antibiotics administered. Bacteria hit hard — so was the microbiome.', hit ? 'good' : 'warn');
        break;
      case 'antivirals':
        damageKind(['virus'], 55);
        state.organs.liver.health = clamp(state.organs.liver.health - 6, 0, 100);
        St.log(state, 'Antivirals administered. The liver will feel it.', hit ? 'good' : 'warn');
        break;
      case 'fever':
        damageKind(['virus', 'bacteria', 'fungus'], 28);
        S.inflammation = clamp(S.inflammation + 14, 0, 100);
        S.health = clamp(S.health - 4, 0, 100);
        state.atp = Math.max(0, state.atp - 30);
        St.log(state, 'Core temperature raised. Everything in there is having a worse day, including you.', 'warn');
        break;
      case 'rest':
        state.restDays = 3;
        S.inflammation = clamp(S.inflammation - 16, 0, 100);
        S.immunity = clamp(S.immunity + 10, 0, 100);
        S.health = clamp(S.health + 3, 0, 100);
        St.log(state, 'Bed rest for three days. Income is down; recovery is up.', 'good');
        break;
      case 'probiotic':
        S.diversity = clamp(S.diversity + 26, 0, 100);
        var seeded = 0;
        state.tiles.forEach(function (t) {
          if (t.terrain === 'gutlining' && seeded < 8) {
            if (!t.zone) { t.zone = 'microbiome'; t.density = 1; seeded++; }
            else if (t.zone === 'microbiome' && t.density < C.MAX_DENSITY) { t.density++; seeded++; }
          }
        });
        St.log(state, 'Probiotics: ' + seeded + ' gut tiles reseeded.', 'good');
        break;
      case 'vaccine':
        D.DISEASES.forEach(function (d) {
          if (d.kind === 'virus') {
            state.immunity_memory[d.id] = clamp((state.immunity_memory[d.id] || 0) + 0.45, 0, 0.85);
          }
        });
        S.inflammation = clamp(S.inflammation + 4, 0, 100);
        St.log(state, 'Vaccinated. Memory cells primed against viral threats.', 'good');
        break;
      case 'surgery':
        var removed = 0;
        state.outbreaks = state.outbreaks.filter(function (o) {
          if (o.kind !== 'tumour') return true;
          o.tiles.forEach(function (idx) {
            state.tiles[idx].pathogen = null;
            state.tiles[idx].health = 45;
            state.tiles[idx].inflam = 45;
          });
          removed++;
          return false;
        });
        S.health = clamp(S.health - 6, 0, 100);
        S.inflammation = clamp(S.inflammation + 12, 0, 100);
        St.log(state, removed ? 'Surgery complete: ' + removed + ' growth removed.' : 'Surgery performed with nothing to remove. Ouch.', removed ? 'good' : 'warn');
        break;
    }
    return { ok: true };
  }

  // ---------------------------------------------------------------- advice --
  function advice(state) {
    var out = [], S = state.stats, c = state.counts;
    if (state.income.net < 0) out.push({ advisor: 'metab', text: 'You are burning ' + Math.abs(state.income.net).toFixed(1) + ' more ATP than you make. Grow the gut or cut upkeep.', severity: 2 });
    if (c.starved > 8) out.push({ advisor: 'cardio', text: Math.round(c.starved) + ' units of tissue sit outside blood supply. They cost ATP, inflame the body, and produce almost nothing — feed them or clear them.', severity: 2 });
    if (state.income.workCapped) out.push({ advisor: 'metab', text: 'Your cells could do more work than the gut can feed. Every extra cell now is pure upkeep — build absorption in the gut lining instead.', severity: 1 });
    var supported = Math.round((state.income.gut * 1.9 - D.CONFIG.BASAL_COST) / Math.max(0.01, D.CONFIG.CELL_COST));
    if (c.cells > supported * 1.6) out.push({ advisor: 'metab', text: 'You are feeding roughly ' + Math.round(c.cells) + ' cells on a gut that comfortably supports ' + supported + '. Expand absorption before expanding tissue.', severity: 2 });
    if (S.inflammation > 55) out.push({ advisor: 'immuno', text: 'Inflammation is at ' + Math.round(S.inflammation) + '. Sleep more, eat better, and stop over-building immune zones.', severity: 2 });
    if (S.immunity < 35) out.push({ advisor: 'immuno', text: 'Immunity is low. Build immune zones near marrow, and add a lymph node.', severity: 2 });
    if (S.diversity < 30) out.push({ advisor: 'gut', text: 'Microbiome diversity has collapsed. Probiotics and a higher-fibre diet, please.', severity: 2 });
    if (c.vessels < 25) out.push({ advisor: 'cardio', text: 'The vessel network is thin. Unperfused zones will not develop.', severity: 1 });
    if (S.toxins > 45) out.push({ advisor: 'metab', text: 'Toxin load is high — drink water and let the liver catch up.', severity: 2 });
    if (state.organs.heart.health < 60) out.push({ advisor: 'cardio', text: 'The heart is damaged; blood is not reaching the extremities.', severity: 2 });
    if (state.outbreaks.length && S.immunity > 60) out.push({ advisor: 'immuno', text: 'Immunity is strong — you may be able to ride this infection out without drugs.', severity: 0 });
    if (!out.length) out.push({ advisor: 'metab', text: 'Everything is boring right now. That is the goal.', severity: 0 });
    return out.sort(function (a, b) { return b.severity - a.severity; });
  }

  // ------------------------------------------------------------------ tick --
  function tick(state) {
    if (state.flags.gameOver) return state;
    state.derived = state.derived || {};

    circulate(state);
    innervate(state);
    develop(state);
    metabolize(state);
    pathology(state);
    homeostasis(state);
    rollEvents(state);

    Object.keys(state.treatmentCooldowns).forEach(function (k) {
      if (state.treatmentCooldowns[k] > 0) state.treatmentCooldowns[k]--;
    });

    state.day++;
    state.age += 1 / 365;

    // Death conditions.
    var cause = null;
    if (state.stats.health <= 0) cause = 'Total system failure — health reached zero.';
    else if (state.organs.heart.health <= 0) cause = 'Cardiac arrest.';
    else if (state.organs.brain.health <= 0) cause = 'Brain death.';
    else if (state.organs.lung.health <= 0) cause = 'Respiratory failure.';
    if (cause) {
      state.flags.gameOver = true;
      state.flags.cause = cause;
      St.log(state, 'GAME OVER on day ' + state.day + ': ' + cause, 'bad');
    }
    return state;
  }

  global.SimBody.sim = {
    tick: tick, circulate: circulate, innervate: innervate, develop: develop,
    metabolize: metabolize, pathology: pathology, homeostasis: homeostasis,
    rollEvents: rollEvents, startOutbreak: startOutbreak, applyTreatment: applyTreatment,
    treatmentReady: treatmentReady, advice: advice, localDefence: localDefence, clamp: clamp
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
