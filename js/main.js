/* simBody — bootstrap and the real-time loop. */
(function (global) {
  'use strict';
  var SB = global.SimBody;
  var C = SB.data.CONFIG;

  var G = {
    state: null,
    speed: 1,
    tool: 'vessel',
    overlay: 'none',
    hover: null,
    newGame: function () {
      G.state = SB.state.createState();
      SB.state.log(G.state, 'A new body comes online. Age 24, and everything still works.', 'good');
      G.speed = 1;
      G.overlay = 'none';
    }
  };

  var ui, ctx, accumulator = 0, last = 0, lastMilestone = 0;

  var MILESTONES = [
    { day: 30,   text: 'One month in. The body has settled into a rhythm.' },
    { day: 100,  text: 'Day 100. Homeostasis is holding.' },
    { day: 365,  text: 'A full year survived. Happy birthday.' },
    { day: 730,  text: 'Two years. Most bodies do not make it this far under new management.' },
    { day: 1095, text: 'Three years. You are, at this point, a very good body.' }
  ];

  function tickOnce() {
    var s = G.state;
    if (s.flags.gameOver) { G.speed = 0; return; }

    SB.sim.tick(s);

    MILESTONES.forEach(function (m) {
      if (s.day === m.day && lastMilestone < m.day) {
        lastMilestone = m.day;
        SB.state.log(s, m.text, 'good');
      }
    });

    if (s.day % 20 === 0) SB.state.save(s);

    if (s.flags.gameOver) {
      G.speed = 0;
      ui.gameOverModal(s);
    }
    ui.refresh();
  }

  function frame(now) {
    if (!last) last = now;
    var dt = now - last;
    last = now;

    var mult = C.SPEEDS[G.speed];
    if (mult > 0) {
      accumulator += dt * mult;
      var budget = 0;
      while (accumulator >= C.TICK_MS && budget < 8) {
        accumulator -= C.TICK_MS;
        budget++;
        tickOnce();
      }
    } else {
      accumulator = 0;
    }

    SB.render.draw(ctx, G.state, {
      hover: G.hover, tool: G.tool, overlay: G.overlay, time: now
    });
    requestAnimationFrame(frame);
  }

  function boot() {
    var saved = SB.state.hasSave() ? SB.state.load() : null;
    if (saved) {
      G.state = saved;
      SB.state.log(G.state, 'Resumed from autosave on day ' + saved.day + '.', 'info');
    } else {
      G.newGame();
    }

    ctx = SB.render.setup(document.getElementById('map'));
    ui = SB.ui.init(G);
    SB.uiApi = ui;

    // Prime the derived values so the first frame has numbers to show.
    SB.sim.circulate(G.state);
    SB.sim.innervate(G.state);
    SB.sim.develop(G.state);
    SB.sim.metabolize(G.state);
    ui.refresh();

    if (!saved) ui.helpModal();
    requestAnimationFrame(frame);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();

  global.SimBody.game = G;
})(typeof globalThis !== 'undefined' ? globalThis : this);
