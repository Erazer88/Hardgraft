(function (root) {
  'use strict';

  const recipes = Object.freeze({
    iron_plate: Object.freeze({
      id: 'iron_plate', name: 'Plaque de fer', duration: 1.5, energy: .4,
      inputs: Object.freeze({ iron: 2 }), outputs: Object.freeze({ iron_plate: 1 })
    })
  });

  root.OrbitRecipeData = Object.freeze({ recipes });
})(globalThis);
