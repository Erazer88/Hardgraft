(function (root) {
  'use strict';

  // These levels are declarative so research can tune fleet size, load size and
  // travel speed independently as the logistics tree is added to the game.
  const profiles = Object.freeze([
    Object.freeze({ level: 1, name: 'I', trucks: 6, cargoCapacity: 24, speed: 42, loadWindow: 10, minimumLegSeconds: 5 }),
    Object.freeze({ level: 2, name: 'II', trucks: 8, cargoCapacity: 32, speed: 54, loadWindow: 9, minimumLegSeconds: 4 }),
    Object.freeze({ level: 3, name: 'III', trucks: 10, cargoCapacity: 48, speed: 68, loadWindow: 8, minimumLegSeconds: 3 })
  ]);

  function get(level) {
    return profiles.find(profile => profile.level === level) || profiles[0];
  }

  root.OrbitLogisticsData = Object.freeze({ profiles, get });
})(globalThis);
