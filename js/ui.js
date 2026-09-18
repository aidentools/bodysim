/* simBody — DOM wiring: panels, tools, sliders, inspector, modals. */
(function (global) {
  'use strict';
  var D = global.SimBody.data;
  var A = global.SimBody.actions;
  var Sim = global.SimBody.sim;
  var R = global.SimBody.render;
  var M = global.SimBody.map;

  var G = null;          // the game object owned by main.js
  var els = {};
  var toastTimer = null;

  function $(id) { return document.getElementById(id); }
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  }

  // ------------------------------------------------------------- building --
  function buildSpeeds() {
    els.speeds.innerHTML = '';
    var labels = ['❚❚', '▶', '▶▶', '▶▶▶'];
    D.CONFIG.SPEEDS.forEach(function (mult, i) {
      var b = el('button', 'btn', labels[i]);
      b.title = mult === 0 ? 'Pause' : mult + '× speed';
      b.onclick = function () { G.speed = i; buildSpeeds(); };
      if (G.speed === i) b.classList.add('active');
      els.speeds.appendChild(b);
    });
  }

  function buildToolbar() {
    els.toolbar.innerHTML = '';
    D.TOOLS.forEach(function (tool) {
      var b = el('button', 'tool');
      b.dataset.tool = tool.id;
      var ic = el('span', 'icon', tool.icon);
      if (tool.id === 'tissue') ic.style.color = D.ZONES.tissue.color;
      if (tool.id === 'microbiome') ic.style.color = D.ZONES.microbiome.color;
      if (tool.id === 'immune') ic.style.color = D.ZONES.immune.color;
      if (tool.id === 'vessel') ic.style.color = '#ff4d5e';
      if (tool.id === 'nerve') ic.style.color = '#ffd75e';
      b.appendChild(ic);
      var wrap = el('span');
      wrap.appendChild(el('b', 'nm', tool.name));
      wrap.appendChild(el('span', 'cost', (tool.cost ? tool.cost + ' ATP' : 'free') + ' · ' + tool.hotkey));
      b.appendChild(wrap);
      b.onclick = function () { selectTool(tool.id); };
      b.onmouseenter = function () { els.toolDesc.textContent = tool.desc; };
      els.toolbar.appendChild(b);
    });
    selectTool(G.tool);
  }

  function selectTool(id) {
    G.tool = id;
    Array.prototype.forEach.call(els.toolbar.children, function (b) {
      b.classList.toggle('sel', b.dataset.tool === id);
    });
    var tool = A.toolById(id);
    if (tool) els.toolDesc.textContent = tool.desc;
  }

  function buildOverlays() {
    els.overlays.innerHTML = '';
    R.OVERLAYS.forEach(function (o, i) {
      var b = el('button', 'btn', o.name);
      b.title = o.hint + '  (' + (i + 1) + ')';
      b.onclick = function () { G.overlay = o.id; buildOverlays(); };
      if (G.overlay === o.id) b.classList.add('active');
      els.overlays.appendChild(b);
    });
  }

  function buildLegend() {
    var items = [
      ['Tissue', D.ZONES.tissue.color], ['Microbiome', D.ZONES.microbiome.color],
      ['Immune', D.ZONES.immune.color], ['Vessel', '#ff4d5e'], ['Nerve', '#ffd75e'],
      ['Virus', '#c23ce8'], ['Bacteria', '#39e07a'], ['Fungus', '#e8a33c'], ['Tumour', '#e8e83c']
    ];
    els.legend.innerHTML = '';
    items.forEach(function (it) {
      var s = el('span');
      var sw = el('i');
      sw.style.background = it[1];
      s.appendChild(sw);
      s.appendChild(document.createTextNode(it[0]));
      els.legend.appendChild(s);
    });
  }

  function buildPolicies() {
    els.policies.innerHTML = '';
    D.POLICIES.forEach(function (p) {
      var wrap = el('div', 'policy');
      var row = el('div', 'row');
      row.appendChild(el('b', null, p.name));
      var val = el('span', null, G.state.policies[p.id]);
      row.appendChild(val);
      wrap.appendChild(row);

      var input = document.createElement('input');
      input.type = 'range'; input.min = 0; input.max = 100;
      input.value = G.state.policies[p.id];
      input.oninput = function () {
        A.setPolicy(G.state, p.id, +input.value);
        val.textContent = input.value;
      };
      wrap.appendChild(input);

      var ends = el('div', 'ends');
      ends.appendChild(el('span', null, p.low));
      ends.appendChild(el('span', null, p.high));
      wrap.appendChild(ends);
      wrap.title = p.desc;
      els.policies.appendChild(wrap);
    });
  }

  function buildTreatments() {
    els.treatments.innerHTML = '';
    D.TREATMENTS.forEach(function (t) {
      var b = el('button', 'treat');
      b.dataset.treat = t.id;
      b.appendChild(el('b', null, t.icon + ' ' + t.name));
      b.appendChild(el('small', null, t.cost + ' ATP'));
      b.title = t.desc;
      b.onclick = function () {
        var res = Sim.applyTreatment(G.state, t.id);
        if (!res.ok) toast(res.reason);
        refresh();
      };
      els.treatments.appendChild(b);
    });
  }

  // -------------------------------------------------------------- updating --
  function bar(label, value, colour, suffix) {
    var wrap = el('div', 'vital');
    var row = el('div', 'row');
    row.appendChild(el('b', null, label));
    row.appendChild(el('span', null, Math.round(value) + (suffix === undefined ? '' : suffix)));
    wrap.appendChild(row);
    var b = el('div', 'bar');
    var fill = el('i');
    fill.style.width = Math.max(0, Math.min(100, value)) + '%';
    fill.style.background = colour;
    b.appendChild(fill);
    wrap.appendChild(b);
    return wrap;
  }

  function gradeColour(v) {
    if (v > 66) return '#4fd08a';
    if (v > 33) return '#e8c84f';
    return '#e8575f';
  }
  function inverseColour(v) {
    if (v < 33) return '#4fd08a';
    if (v < 66) return '#e8c84f';
    return '#e8575f';
  }

  function refresh() {
    var s = G.state, S = s.stats;

    els.day.textContent = s.day;
    els.age.textContent = s.age.toFixed(1);
    els.atp.textContent = Math.round(s.atp);
    var net = s.income.net || 0;
    els.net.textContent = (net >= 0 ? '+' : '') + net.toFixed(1) + '/day';
    els.net.className = net >= 0 ? 'pos' : 'neg';
    els.health.textContent = Math.round(S.health);
    els.health.style.color = gradeColour(S.health);

    // vitals
    els.vitals.innerHTML = '';
    els.vitals.appendChild(bar('Health', S.health, gradeColour(S.health)));
    els.vitals.appendChild(bar('Immunity', S.immunity, gradeColour(S.immunity)));
    els.vitals.appendChild(bar('Inflammation', S.inflammation, inverseColour(S.inflammation)));
    els.vitals.appendChild(bar('Toxin load', S.toxins, inverseColour(S.toxins)));
    els.vitals.appendChild(bar('Nutrition', S.nutrition, gradeColour(S.nutrition)));
    els.vitals.appendChild(bar('Microbiome diversity', S.diversity, gradeColour(S.diversity)));
    els.vitals.appendChild(bar('Oxygenation', S.oxygen, gradeColour(S.oxygen)));
    els.vitals.appendChild(bar('Mood', S.mood, gradeColour(S.mood)));

    var pop = el('p', 'hint');
    pop.textContent = 'Cells ' + Math.round(s.counts.cells) + ' · flora ' + s.counts.flora
      + ' · immune ' + s.counts.immune + ' · vessels ' + s.counts.vessels + ' · nerves ' + s.counts.nerves;
    els.vitals.appendChild(pop);

    var econ = el('p', 'hint');
    econ.textContent = 'Gut ' + (s.income.gut || 0).toFixed(1) + ' + cell work ' + (s.income.work || 0).toFixed(1)
      + (s.income.workCapped ? ' (capped by absorption)' : '')
      + ' − upkeep ' + (s.income.basal + s.income.upkeep).toFixed(1) + ' ATP/day';
    els.vitals.appendChild(econ);

    // treatments availability
    Array.prototype.forEach.call(els.treatments.children, function (b) {
      var id = b.dataset.treat;
      var spec = D.TREATMENTS.filter(function (t) { return t.id === id; })[0];
      var cd = Math.ceil(s.treatmentCooldowns[id] || 0);
      var affordable = s.atp >= spec.cost;
      b.disabled = cd > 0 || !affordable || s.flags.gameOver;
      b.querySelector('small').textContent = cd > 0 ? cd + ' day cooldown' : spec.cost + ' ATP';
    });

    // tool affordability
    Array.prototype.forEach.call(els.toolbar.children, function (b) {
      var tool = A.toolById(b.dataset.tool);
      b.classList.toggle('broke', tool.cost > s.atp);
    });

    // outbreaks
    els.outbreaks.innerHTML = '';
    if (!s.outbreaks.length) {
      els.outbreaks.appendChild(el('p', 'hint', 'No active infections. Enjoy it.'));
    } else {
      s.outbreaks.forEach(function (o) {
        var card = el('div', 'outbreak');
        var nm = el('div', 'nm');
        nm.appendChild(el('span', null, o.name));
        nm.appendChild(el('span', 'kind ' + o.kind, o.kind));
        card.appendChild(nm);
        card.appendChild(el('div', 'meta', 'strength ' + Math.round(o.strength)
          + ' · ' + o.tiles.length + ' tiles · day ' + o.age));
        var mem = s.immunity_memory[o.disease];
        if (mem) card.appendChild(el('div', 'meta', 'memory cells: ' + Math.round(mem * 100) + '% resistance'));
        els.outbreaks.appendChild(card);
      });
    }

    // organs
    els.organs.innerHTML = '';
    Object.keys(s.organs).forEach(function (id) {
      var o = el('div', 'organ');
      o.title = D.ORGANS[id].desc;
      o.appendChild(el('div', 'nm', D.ORGANS[id].name));
      var v = el('div', 'val', Math.round(s.organs[id].health) + '%');
      v.style.color = gradeColour(s.organs[id].health);
      o.appendChild(v);
      els.organs.appendChild(o);
    });

    // advisors
    els.advisors.innerHTML = '';
    Sim.advice(s).slice(0, 4).forEach(function (a) {
      var row = el('div', 'advice sev' + a.severity);
      row.appendChild(el('span', 'who', D.ADVISORS[a.advisor].name + ':'));
      row.appendChild(el('span', null, a.text));
      els.advisors.appendChild(row);
    });

    // log
    els.log.innerHTML = '';
    s.log.slice(0, 40).forEach(function (l) {
      var row = el('div', l.tone);
      row.appendChild(el('b', null, 'Day ' + l.day + ' '));
      row.appendChild(document.createTextNode(l.text));
      els.log.appendChild(row);
    });
  }

  function setInspector(tile) {
    els.inspector.innerHTML = '';
    if (!tile || !tile.body) {
      els.inspector.appendChild(el('b', null, 'Inspector'));
      els.inspector.appendChild(el('span', 'hint', ' Hover a tile to read it.'));
      return;
    }
    var rep = A.tileReport(G.state, tile);
    els.inspector.appendChild(el('b', null, rep.title + ' (' + tile.x + ',' + tile.y + ')'));
    rep.lines.forEach(function (kv) {
      var row = el('div', 'kv');
      row.appendChild(el('span', null, kv[0]));
      row.appendChild(el('i', null, kv[1]));
      if (kv[0] === 'INFECTED') row.className = 'kv alert';
      els.inspector.appendChild(row);
    });
    var why = A.checkPlacement(G.state, tile, G.tool);
    if (why && G.tool !== 'inspect') els.inspector.appendChild(el('div', 'kv alert', why));
    if (rep.desc) els.inspector.appendChild(el('div', 'hint', rep.desc));
  }

  // ---------------------------------------------------------------- toast --
  function toast(msg) {
    if (!msg) return;
    els.toast.textContent = msg;
    els.toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { els.toast.classList.remove('show'); }, 2200);
  }

  function showModal(title, html, onClose) {
    els.modalTitle.textContent = title;
    els.modalBody.innerHTML = html;
    els.modal.classList.remove('hidden');
    els.modalClose.onclick = function () {
      els.modal.classList.add('hidden');
      if (onClose) onClose();
    };
  }

  function helpModal() {
    showModal('simBody — how to keep a body alive', [
      '<p>You are not a doctor. You are the <b>city planner of a human body</b>. Same job as SimCity:',
      'lay infrastructure, zone land, balance a budget, and handle the disasters that show up uninvited.</p>',
      '<h3>The budget is ATP</h3>',
      '<p>Energy comes from the gut. Absorption depends on how much developed, well-perfused gut lining you have —',
      'so <b>zone the gut lining and run vessels to it</b>. Well-supplied tissue cells also produce more ATP than they cost;',
      'starved ones just cost.</p>',
      '<h3>Infrastructure</h3><ul>',
      '<li><b>Blood vessels</b> spread out from the heart. Reach is limited — a long thin vessel run peters out.</li>',
      '<li><b>Nerve fibres</b> spread from the brain and let zones develop past low density.</li>',
      '<li>Zones only grow when they touch supply. Unsupplied zones starve and die back.</li></ul>',
      '<h3>The three zones</h3><ul>',
      '<li><b>Tissue</b> — the working population. Makes ATP, costs ATP.</li>',
      '<li><b>Microbiome</b> — gut flora, fed by dietary fibre. Produces the compounds that hold inflammation down.</li>',
      '<li><b>Immune</b> — your defence. Effective, but every post adds background inflammation and upkeep.</li></ul>',
      '<h3>Disasters are infections</h3>',
      '<p>Viruses and bacteria enter through the airway, the gut or a break in the skin, then spread tile by tile.',
      'Immune zones near the outbreak fight it; drugs help but each has a cost.',
      '<b>Antibiotics devastate your microbiome.</b> Mucus barriers block entry points before anything happens.</p>',
      '<h3>Controls</h3>',
      '<p><kbd>Q</kbd> inspect · <kbd>W</kbd> vessel · <kbd>E</kbd> nerve · <kbd>A</kbd> tissue · <kbd>S</kbd> microbiome ·',
      '<kbd>D</kbd> immune · <kbd>R</kbd> clear · <kbd>1</kbd>–<kbd>5</kbd> map overlays · <kbd>Space</kbd> pause.',
      'Click and drag to paint. The game autosaves every 20 days.</p>'
    ].join(' '));
  }

  function gameOverModal(state) {
    var score = Math.round(state.day * (0.5 + state.stats.health / 200)
      + state.flags.infectionsBeaten * 30 + state.counts.cells * 2);
    showModal('The body has died', [
      '<p><b>' + state.flags.cause + '</b></p>',
      '<p>Survived <b>' + state.day + ' days</b> (to age ' + state.age.toFixed(1) + ').',
      'Infections beaten: <b>' + state.flags.infectionsBeaten + '</b>.',
      'Peak health: <b>' + Math.round(state.flags.peakHealth) + '</b>.</p>',
      '<h3>Final score</h3><p style="font-size:26px;font-weight:700">' + score + '</p>',
      '<p class="hint">Press New to start a fresh body.</p>'
    ].join(' '));
  }

  // ---------------------------------------------------------- canvas input --
  function bindCanvas() {
    var canvas = els.map;
    var painting = false;

    function paint(evt) {
      var p = R.tileFromEvent(canvas, evt);
      G.hover = p;
      var tile = M.at(G.state.tiles, p.x, p.y);
      setInspector(tile);
      if (!painting || G.tool === 'inspect') return;
      var res = A.place(G.state, p.x, p.y, G.tool);
      if (!res.ok && !res.silent && res.reason) toast(res.reason);
      if (res.ok) refresh();
    }

    canvas.addEventListener('mousedown', function (e) { painting = true; paint(e); });
    canvas.addEventListener('mousemove', paint);
    window.addEventListener('mouseup', function () { painting = false; });
    canvas.addEventListener('mouseleave', function () { G.hover = null; setInspector(null); });

    canvas.addEventListener('touchstart', function (e) {
      painting = true; paint(e.touches[0]); e.preventDefault();
    }, { passive: false });
    canvas.addEventListener('touchmove', function (e) {
      paint(e.touches[0]); e.preventDefault();
    }, { passive: false });
    canvas.addEventListener('touchend', function () { painting = false; });
  }

  function bindKeys() {
    window.addEventListener('keydown', function (e) {
      if (e.target && e.target.tagName === 'INPUT') return;
      var key = e.key.toUpperCase();
      var tool = D.TOOLS.filter(function (t) { return t.hotkey === key; })[0];
      if (tool) { selectTool(tool.id); return; }
      if (e.key === ' ') {
        e.preventDefault();
        G.speed = G.speed === 0 ? 1 : 0;
        buildSpeeds();
      } else if (e.key >= '1' && e.key <= '5') {
        var ov = R.OVERLAYS[+e.key - 1];
        if (ov) { G.overlay = ov.id; buildOverlays(); }
      } else if (key === 'P') {
        G.speed = Math.min(D.CONFIG.SPEEDS.length - 1, G.speed + 1);
        buildSpeeds();
      }
    });
  }

  function init(game) {
    G = game;
    els = {
      day: $('r-day'), age: $('r-age'), atp: $('r-atp'), net: $('r-net'), health: $('r-health'),
      speeds: $('speeds'), toolbar: $('toolbar'), toolDesc: $('tool-desc'), policies: $('policies'),
      overlays: $('overlays'), map: $('map'), inspector: $('inspector'), vitals: $('vitals'),
      treatments: $('treatments'), outbreaks: $('outbreaks'), organs: $('organs'),
      advisors: $('advisors'), log: $('log'), legend: $('legend'), toast: $('toast'), modal: $('modal'),
      modalTitle: $('modal-title'), modalBody: $('modal-body'), modalClose: $('modal-close')
    };

    buildSpeeds();
    buildToolbar();
    buildOverlays();
    buildLegend();
    buildPolicies();
    buildTreatments();
    bindCanvas();
    bindKeys();

    $('btn-help').onclick = helpModal;
    $('btn-save').onclick = function () {
      toast(global.SimBody.state.save(G.state) ? 'Saved.' : 'Could not save in this browser.');
    };
    $('btn-load').onclick = function () {
      var loaded = global.SimBody.state.load();
      if (!loaded) { toast('No save found.'); return; }
      G.state = loaded;
      buildPolicies(); refresh();
      toast('Loaded day ' + loaded.day + '.');
    };
    $('btn-new').onclick = function () {
      if (!G.state.flags.gameOver && !confirm('Abandon this body and start a new one?')) return;
      G.newGame();
      buildPolicies(); refresh();
    };

    return { refresh: refresh, toast: toast, setInspector: setInspector, gameOverModal: gameOverModal, helpModal: helpModal, buildPolicies: buildPolicies };
  }

  global.SimBody.ui = { init: init };
})(typeof globalThis !== 'undefined' ? globalThis : this);
