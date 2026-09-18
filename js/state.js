/* simBody — game state: creation, derived getters, save/load, RNG. */
(function (global) {
  'use strict';
  var D = global.SimBody.data;
  var M = global.SimBody.map;
  var C = D.CONFIG;

  var SAVE_KEY = 'simbody.save.v1';

  // Deterministic RNG so a seed replays identically (and tests stay stable).
  function mulberry32(seed) {
    var a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function createState(seed) {
    var s = {
      version: 1,
      seed: (seed === undefined ? (Date.now() % 100000) : seed) | 0,
      day: 1,
      age: C.START_AGE,
      atp: C.START_ATP,
      tiles: M.buildMap(),
      organs: {},
      stats: {
        health: 92,
        immunity: 55,
        inflammation: 8,
        toxins: 6,
        nutrition: 60,
        diversity: 45,
        mood: 65,
        oxygen: 80
      },
      policies: { diet: 60, exercise: 35, sleep: 62, hydration: 60, hygiene: 55 },
      outbreaks: [],
      nextOutbreakId: 1,
      immunity_memory: {},        // diseaseId -> strength of learned defence 0..1
      treatmentCooldowns: {},
      restDays: 0,
      log: [],
      flags: { gameOver: false, cause: null, peakHealth: 92, infectionsBeaten: 0 },
      income: { intake: 0, upkeep: 0, basal: 0, net: 0, store: C.STORE_BASE },
      counts: { cells: 0, flora: 0, immune: 0, vessels: 0, nerves: 0 }
    };
    Object.keys(D.ORGANS).forEach(function (id) { s.organs[id] = { health: 100 }; });
    s.rng = mulberry32(s.seed);
    return s;
  }

  function tileAt(state, x, y) { return M.at(state.tiles, x, y); }
  function neighbours(state, x, y) { return M.neighbours(state.tiles, x, y); }

  function log(state, text, tone) {
    state.log.unshift({ day: state.day, text: text, tone: tone || 'info' });
    if (state.log.length > 120) state.log.length = 120;
  }

  // ------------------------------------------------------------- save/load --
  function serialize(state) {
    var packed = state.tiles.map(function (t) {
      if (!t.body) return 0;
      return [t.zone ? t.zone[0] : '', t.structure || '', t.vessel ? 1 : 0, t.nerve ? 1 : 0,
        t.density, Math.round(t.health), Math.round(t.inflam), t.pathogen === null ? -1 : t.pathogen].join(',');
    });
    return JSON.stringify({
      version: state.version, seed: state.seed, day: state.day, age: state.age, atp: state.atp,
      stats: state.stats, policies: state.policies, outbreaks: state.outbreaks,
      nextOutbreakId: state.nextOutbreakId, immunity_memory: state.immunity_memory,
      treatmentCooldowns: state.treatmentCooldowns, restDays: state.restDays,
      organs: state.organs, flags: state.flags, log: state.log.slice(0, 40), packed: packed
    });
  }

  function deserialize(json) {
    var raw = JSON.parse(json);
    var s = createState(raw.seed);
    s.day = raw.day; s.age = raw.age; s.atp = raw.atp;
    s.stats = raw.stats; s.policies = raw.policies; s.outbreaks = raw.outbreaks || [];
    s.nextOutbreakId = raw.nextOutbreakId || 1;
    s.immunity_memory = raw.immunity_memory || {};
    s.treatmentCooldowns = raw.treatmentCooldowns || {};
    s.restDays = raw.restDays || 0;
    s.organs = raw.organs; s.flags = raw.flags; s.log = raw.log || [];
    var zoneByLetter = { t: 'tissue', m: 'microbiome', i: 'immune' };
    raw.packed.forEach(function (p, i) {
      if (p === 0) return;
      var f = String(p).split(',');
      var t = s.tiles[i];
      t.zone = f[0] ? zoneByLetter[f[0]] : null;
      t.structure = f[1] || null;
      t.vessel = f[2] === '1';
      t.nerve = f[3] === '1';
      t.density = +f[4];
      t.health = +f[5];
      t.inflam = +f[6];
      t.pathogen = +f[7] < 0 ? null : +f[7];
    });
    // Re-advance the RNG so a reloaded run doesn't repeat the same rolls.
    s.rng = mulberry32((s.seed + s.day * 7919) | 0);
    return s;
  }

  function save(state) {
    if (typeof localStorage === 'undefined') return false;
    try { localStorage.setItem(SAVE_KEY, serialize(state)); return true; }
    catch (e) { return false; }
  }
  function load() {
    if (typeof localStorage === 'undefined') return null;
    try {
      var raw = localStorage.getItem(SAVE_KEY);
      return raw ? deserialize(raw) : null;
    } catch (e) { return null; }
  }
  function hasSave() {
    return typeof localStorage !== 'undefined' && !!localStorage.getItem(SAVE_KEY);
  }
  function clearSave() {
    if (typeof localStorage !== 'undefined') localStorage.removeItem(SAVE_KEY);
  }

  global.SimBody.state = {
    createState: createState, tileAt: tileAt, neighbours: neighbours, log: log,
    serialize: serialize, deserialize: deserialize,
    save: save, load: load, hasSave: hasSave, clearSave: clearSave,
    mulberry32: mulberry32, SAVE_KEY: SAVE_KEY
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
