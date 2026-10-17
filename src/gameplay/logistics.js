(function (root) {
  'use strict';

  const Data = root.OrbitOrbitalLogisticsData;
  const Network = root.OrbitLogisticsNetwork;
  const Transit = root.OrbitOrbitalTransit;

  function advance(state, currentTime, systemsById, running = true) {
    state.orbitalLogistics ||= Transit.createState();
    if (running) Network.transferDockStockToBuildings(state);
    return Transit.advance(state, currentTime, systemsById, running);
  }

  function setDockDestination(building, resourceId, destinationId) {
    if (!building || !['factory', 'extractor'].includes(building.type) ||
        !Data.exportResources.some(item => item.id === resourceId)) return false;
    building.dockDestinations ||= {};
    if (destinationId === null || destinationId === '') delete building.dockDestinations[resourceId];
    else if (typeof destinationId === 'string' && destinationId !== building.id) {
      building.dockDestinations[resourceId] = destinationId;
    } else return false;
    return true;
  }

  function platformStatus(state, platform, system, currentTime) {
    if (!system?.ark) return 'PAS DE HUB';
    const sources = (state.surfaceBuildings || []).filter(source => source.id !== platform.id &&
      source.planetId === platform.planetId && source.constructionState === 'complete' &&
      Network.hasBuiltLandPath(state.roadNetworks?.[platform.planetId], source.id, platform.id));
    if (!sources.length) return 'PAS DE CONNEXION';
    const hasAssignedSource = sources.some(source => Object.values(source.dockDestinations || {}).includes(platform.id));
    if (!hasAssignedSource) return 'AUCUN FLUX ASSIGNÉ';
    if (platform.lastLaunchTime !== null && platform.lastLaunchTime !== undefined && currentTime - platform.lastLaunchTime < 1) return 'ACTIF';
    return 'EN ATTENTE';
  }

  root.OrbitLogistics = Object.freeze({ advance, setDockDestination, platformStatus });
})(globalThis);
