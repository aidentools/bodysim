/* simBody — static game data: tuning constants, build catalog, treatments, diseases.
 * Loaded as a classic script so the game runs straight off the filesystem. */
(function (global) {
  'use strict';

  var CONFIG = {
    GRID_W: 29,
    GRID_H: 40,
    TILE: 16,
    TICK_MS: 850,              // one in-game day at 1x speed
    SPEEDS: [0, 1, 2, 4],
    START_ATP: 340,
    START_AGE: 24,
    MAX_DENSITY: 3,
    BASE_INTAKE: 80,           // ATP/day from a perfectly working gut
    BASAL_COST: 16,            // ATP/day the body burns doing nothing
    CELL_COST: 0.35,           // ATP/day per unit of tissue density
    HEART_RANGE: 32,           // how far blood reaches along vessels
    BRAIN_RANGE: 42,           // how far nerve signal reaches
    STORE_BASE: 420,           // glycogen/fat cap before any fat reserves
    STORE_PER_FAT: 260,
    HEALTH_DRIFT: 1.4,         // max health points moved toward target per day
    INFECTION_BASE_RISK: 0.012 // per day, before modifiers
  };

  // ---------------------------------------------------------------- terrain --
  var TERRAIN = {
    tissue:    { name: 'Soft tissue',  color: '#4b3540', buildable: true },
    skin:      { name: 'Skin',         color: '#7d585c', buildable: true },
    gutlining: { name: 'Gut lining',   color: '#6d5330', buildable: true },
    marrow:    { name: 'Bone marrow',  color: '#9a7fa0', buildable: true },
    organ:     { name: 'Organ',        color: '#7a3b46', buildable: false }
  };

  // ----------------------------------------------------------------- organs --
  var ORGANS = {
    brain:   { name: 'Brain',    color: '#b98fd0', vital: true,  desc: 'Broadcasts nerve signal. Without it nothing develops.' },
    airway:  { name: 'Airway',   color: '#8fb8d0', vital: false, desc: 'Air comes in here — and so do airborne pathogens.' },
    lung:    { name: 'Lung',     color: '#d08f9f', vital: true,  desc: 'Sets how much oxygen your ATP production can use.' },
    heart:   { name: 'Heart',    color: '#e0555f', vital: true,  desc: 'Pumps blood down the vessel network. Range depends on its health.' },
    liver:   { name: 'Liver',    color: '#9b6a3f', vital: true,  desc: 'Clears toxins. Hates junk food and antivirals.' },
    stomach: { name: 'Stomach',  color: '#c09a5a', vital: false, desc: 'First stage of digestion. Acid is a pathogen filter.' },
    gut:     { name: 'Intestine',color: '#c8a05f', vital: true,  desc: 'Absorbs nutrients. Home of the microbiome.' },
    kidney:  { name: 'Kidney',   color: '#8a5a8f', vital: true,  desc: 'Filters waste. Needs hydration to work.' },
    spleen:  { name: 'Spleen',   color: '#7a6ab0', vital: false, desc: 'Immune organ: filters blood and stores defenders.' }
  };

  // ------------------------------------------------------------------ zones --
  var ZONES = {
    tissue: {
      name: 'Tissue', short: 'T', color: '#4fd08a',
      desc: 'Working cells. They make ATP and keep the body alive, but need blood and nerve signal.'
    },
    microbiome: {
      name: 'Microbiome', short: 'M', color: '#d0b34f',
      desc: 'Gut flora. Fed by dietary fibre, produces short-chain fatty acids that calm inflammation.'
    },
    immune: {
      name: 'Immune', short: 'I', color: '#4fa8d0',
      desc: 'Immune posts. Fight pathogens nearby, but cost ATP and add background inflammation.'
    }
  };

  // ------------------------------------------------------------- structures --
  var STRUCTURES = {
    lymph:  { name: 'Lymph Node',    color: '#7fd4e8', desc: 'Doubles immune strength of adjacent immune zones.' },
    mucus:  { name: 'Mucus Barrier', color: '#9ad8b0', desc: 'Blocks infections entering through this tile.' },
    fat:    { name: 'Fat Reserve',   color: '#e8cf8a', desc: 'Raises ATP storage cap. Too many add background inflammation.' },
    plasma: { name: 'Antibody Lab',  color: '#d79ae8', desc: 'Plasma cells: adds body-wide immunity every day.' }
  };

  // ------------------------------------------------------------------ tools --
  var TOOLS = [
    { id: 'inspect',    kind: 'cursor',    name: 'Inspect',        cost: 0,  hotkey: 'Q', icon: '?',
      desc: 'Click a tile to read it.' },
    { id: 'vessel',     kind: 'network',   name: 'Blood Vessel',   cost: 6,  upkeep: 0.04, hotkey: 'W', icon: '~',
      desc: 'Carries blood from the heart. Zones must touch a perfused vessel to develop.' },
    { id: 'nerve',      kind: 'network',   name: 'Nerve Fibre',    cost: 8,  upkeep: 0.04, hotkey: 'E', icon: '=',
      desc: 'Carries signal from the brain. Zones need signal to reach higher density.' },
    { id: 'tissue',     kind: 'zone',      name: 'Tissue Zone',    cost: 14, upkeep: 0,    hotkey: 'A', icon: 'T',
      desc: ZONES.tissue.desc },
    { id: 'microbiome', kind: 'zone',      name: 'Microbiome Zone',cost: 10, upkeep: 0,    hotkey: 'S', icon: 'M',
      desc: ZONES.microbiome.desc },
    { id: 'immune',     kind: 'zone',      name: 'Immune Zone',    cost: 22, upkeep: 0.5,  hotkey: 'D', icon: 'I',
      desc: ZONES.immune.desc },
    { id: 'lymph',      kind: 'structure', name: 'Lymph Node',     cost: 45, upkeep: 0.6,  hotkey: 'Z', icon: 'L',
      desc: STRUCTURES.lymph.desc },
    { id: 'mucus',      kind: 'structure', name: 'Mucus Barrier',  cost: 20, upkeep: 0.2,  hotkey: 'X', icon: 'B',
      desc: STRUCTURES.mucus.desc },
    { id: 'fat',        kind: 'structure', name: 'Fat Reserve',    cost: 26, upkeep: 0.1,  hotkey: 'C', icon: 'F',
      desc: STRUCTURES.fat.desc },
    { id: 'plasma',     kind: 'structure', name: 'Antibody Lab',   cost: 60, upkeep: 0.9,  hotkey: 'V', icon: 'Y',
      desc: STRUCTURES.plasma.desc },
    { id: 'bulldoze',   kind: 'bulldoze',  name: 'Apoptosis',      cost: 3,  hotkey: 'R', icon: 'X',
      desc: 'Clear a tile. Costs a little ATP — controlled cell death is not free.' }
  ];

  // Where each tool may be placed. Returns null when allowed, else a reason.
  var PLACEMENT = {
    // The gut and the airway are tubes with room alongside them (the spine runs
    // behind the trachea); solid organs bring their own supply.
    vessel:     function (t) {
      return (t.terrain === 'organ' && t.organ !== 'gut' && t.organ !== 'airway')
        ? 'Solid organs already have their own supply.' : null;
    },
    // Nerves reach everywhere — routing signal is unconstrained, routing blood is not.
    nerve:      function () { return null; },
    tissue:     function (t) { return t.terrain === 'organ' ? 'Organ tiles cannot be zoned.' : null; },
    microbiome: function (t) {
      if (t.terrain === 'gutlining') return null;
      if (t.terrain === 'skin') return null;
      return 'Flora only colonises gut lining or skin.';
    },
    immune:     function (t) { return t.terrain === 'organ' ? 'Organ tiles cannot be zoned.' : null; },
    lymph:      function (t) { return t.terrain === 'organ' ? 'No room inside an organ.' : null; },
    mucus:      function (t) {
      return (t.terrain === 'skin' || t.terrain === 'gutlining' || t.organ === 'airway')
        ? null : 'Barriers only go on skin, gut lining or the airway.';
    },
    fat:        function (t) { return t.terrain === 'organ' ? 'No room inside an organ.' : null; },
    plasma:     function (t) { return t.terrain === 'organ' ? 'No room inside an organ.' : null; }
  };

  // -------------------------------------------------------------- lifestyle --
  var POLICIES = [
    { id: 'diet',      name: 'Diet quality', low: 'Junk', high: 'Whole foods',
      desc: 'Raises nutrient yield and feeds the microbiome. Junk food adds toxins.' },
    { id: 'exercise',  name: 'Exercise',     low: 'Sedentary', high: 'Athlete',
      desc: 'Burns ATP, but strengthens the heart, widens blood reach and lifts mood.' },
    { id: 'sleep',     name: 'Sleep',        low: '4h', high: '9h',
      desc: 'Clears inflammation and brain waste, boosts immunity. Costs you productive hours.' },
    { id: 'hydration', name: 'Hydration',    low: 'Parched', high: 'Well watered',
      desc: 'Kidneys need water to clear toxins.' },
    { id: 'hygiene',   name: 'Hygiene',      low: 'Feral', high: 'Sterile',
      desc: 'Cuts infection risk — but a sterile life starves microbiome diversity.' }
  ];

  // ------------------------------------------------------------- treatments --
  var TREATMENTS = [
    { id: 'antibiotics', name: 'Antibiotics',   cost: 70, cooldown: 14, icon: '💊',
      desc: 'Wipes out bacterial infections fast. Also nukes your microbiome.' },
    { id: 'antivirals',  name: 'Antivirals',    cost: 80, cooldown: 14, icon: '🧪',
      desc: 'Suppresses viral infections. Hard on the liver.' },
    { id: 'fever',       name: 'Run a Fever',   cost: 40, cooldown: 8,  icon: '🌡️',
      desc: 'Burns ATP to damage every pathogen at once. Costs health and adds inflammation.' },
    { id: 'rest',        name: 'Bed Rest',      cost: 25, cooldown: 10, icon: '🛌',
      desc: 'Three days of reduced income; big drop in inflammation, good immunity rebound.' },
    { id: 'probiotic',   name: 'Probiotics',    cost: 40, cooldown: 12, icon: '🥛',
      desc: 'Reseeds gut flora and restores diversity.' },
    { id: 'vaccine',     name: 'Vaccination',   cost: 90, cooldown: 30, icon: '💉',
      desc: 'Trains memory cells: future viral infections start much weaker.' },
    { id: 'surgery',     name: 'Surgery',       cost: 120, cooldown: 25, icon: '🔪',
      desc: 'Excises a tumour outright. Traumatic: costs health and tissue.' }
  ];

  // ---------------------------------------------------------------- disease --
  // kind: virus | bacteria | fungus | tumour | condition
  // entry: which tiles it can appear on
  var DISEASES = [
    { id: 'cold',      name: 'Common Cold',        kind: 'virus',    entry: 'airway',
      virulence: 0.22, growth: 0.9,  damage: 0.5, weight: 30, minDay: 3,
      flavour: 'Sniffles in the airway. Annoying, rarely dangerous.' },
    { id: 'flu',       name: 'Influenza',          kind: 'virus',    entry: 'airway',
      virulence: 0.34, growth: 1.5,  damage: 1.4, weight: 16, minDay: 20,
      flavour: 'Fever, aches, and a virus that spreads down into the lungs.' },
    { id: 'strep',     name: 'Strep Throat',       kind: 'bacteria', entry: 'airway',
      virulence: 0.3,  growth: 1.3,  damage: 1.1, weight: 14, minDay: 12,
      flavour: 'Bacteria in the throat. Antibiotics make short work of it.' },
    { id: 'foodpois',  name: 'Food Poisoning',     kind: 'bacteria', entry: 'gut',
      virulence: 0.38, growth: 1.6,  damage: 1.2, weight: 18, minDay: 6,
      flavour: 'Something you ate. The gut lining is taking the hit.' },
    { id: 'cellulitis',name: 'Skin Infection',     kind: 'bacteria', entry: 'skin',
      virulence: 0.28, growth: 1.2,  damage: 1.0, weight: 14, minDay: 10,
      flavour: 'A break in the skin barrier got colonised.' },
    { id: 'candida',   name: 'Fungal Overgrowth',  kind: 'fungus',   entry: 'gut',
      virulence: 0.24, growth: 1.0,  damage: 0.8, weight: 10, minDay: 25,
      flavour: 'Opportunistic fungus — it thrives when the microbiome is thin.' },
    { id: 'pneumonia', name: 'Pneumonia',          kind: 'bacteria', entry: 'lung',
      virulence: 0.42, growth: 1.8,  damage: 2.0, weight: 8,  minDay: 45,
      flavour: 'Deep lung infection. This one can end you.' },
    { id: 'tumour',    name: 'Rogue Cell Cluster', kind: 'tumour',   entry: 'any',
      virulence: 0.18, growth: 0.8,  damage: 1.1, weight: 7,  minDay: 60,
      flavour: 'Cells that stopped listening. Immunity slows it; surgery removes it.' }
  ];

  // Non-infectious events rolled separately.
  var CONDITIONS = [
    { id: 'dysbiosis',  name: 'Dysbiosis',        weight: 12,
      flavour: 'Gut flora collapsed into a monoculture. Digestion is suffering.' },
    { id: 'allergy',    name: 'Allergic Flare',   weight: 14,
      flavour: 'The immune system picked a fight with nothing at all.' },
    { id: 'autoimmune', name: 'Autoimmune Flare', weight: 10,
      flavour: 'Immune cells are attacking your own tissue.' },
    { id: 'stone',      name: 'Kidney Stone',     weight: 10,
      flavour: 'Dehydration crystallised into a very unwelcome pebble.' },
    { id: 'injury',     name: 'Training Injury',  weight: 12,
      flavour: 'You pushed too hard. Torn tissue, open door for bacteria.' }
  ];

  var ADVISORS = {
    cardio:  { name: 'Dr. Vessel',  role: 'Circulation' },
    gut:     { name: 'Dr. Flora',   role: 'Microbiome' },
    immuno:  { name: 'Dr. Thymus',  role: 'Immunity' },
    metab:   { name: 'Dr. Krebs',   role: 'Metabolism' }
  };

  global.SimBody = global.SimBody || {};
  global.SimBody.data = {
    CONFIG: CONFIG, TERRAIN: TERRAIN, ORGANS: ORGANS, ZONES: ZONES,
    STRUCTURES: STRUCTURES, TOOLS: TOOLS, PLACEMENT: PLACEMENT,
    POLICIES: POLICIES, TREATMENTS: TREATMENTS, DISEASES: DISEASES,
    CONDITIONS: CONDITIONS, ADVISORS: ADVISORS
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
