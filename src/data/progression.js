(function (root) {
  'use strict';

  // Buildings and cards appear when the colony needs them; nothing is shown
  // locked. Each step opens once its condition holds and stays open:
  //   start         from the first moment (the colony must come first);
  //   colonyPlaced  once the colony stands;
  //   powerShort    once a planet's cards ask for more power than it has;
  //   tier: n       once the colony has reached tier n.
  // Cards are named by type, or "type:material" for one furnace.
  const steps = [
    { id: 'landing', when: 'start', buildings: ['colony'] },
    // The first tier asks for raw rock.
    { id: 'rock', when: 'colonyPlaced', buildings: ['extractor'], cards: ['drill', 'output_dock'] },
    { id: 'power', when: 'powerShort', buildings: ['wind_turbine'] },
    // Tar: crushed rock cooked with coal sorted out of ground rock; its waste
    // finds a heap.
    { id: 'tar', when: { tier: 1 }, buildings: ['factory', 'waste_heap'],
      cards: ['crusher', 'grinder', 'carbon_separator', 'tar_furnace', 'input_dock', 'reprocessor', 'incinerator'] },
    // Metal plates: iron sorted out, smelted and rolled; a depot to share flows.
    { id: 'plates', when: { tier: 2 }, buildings: ['storage'],
      cards: ['magnetic_separator', 'reduction_furnace:iron', 'rolling_mill', 'depot_input', 'depot_output', 'depot_buffer',
        'depot_filter', 'depot_splitter', 'depot_priority'] }
  ];

  function freeze(value) {
    if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
    Object.values(value).forEach(freeze);
    return Object.freeze(value);
  }

  root.OrbitProgressionData = freeze({ steps });
})(globalThis);
