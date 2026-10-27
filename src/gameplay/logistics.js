(function (root) {
  'use strict';

  const Data = root.OrbitOrbitalLogisticsData;
  const Network = root.OrbitLogisticsNetwork;
  const Transit = root.OrbitOrbitalTransit;

  function advance(state, currentTime, systemsById, running = true) {
    state.orbitalLogistics ||= Transit.createState();
    if (running) recordTransportActivity(state, Network.transferDockStockToBuildings(state).flows, currentTime);
    return Transit.advance(state, currentTime, systemsById, running);
  }

  // Last simulation time each road link carried a transfer, keyed
  // "source>destination". Runtime only: saves leave it out.
  function recordTransportActivity(state, flows, currentTime) {
    if (!flows.length) return;
    state.transportActivity ||= {};
    for (const flow of flows) state.transportActivity[`${flow.sourceId}>${flow.destinationId}`] = currentTime;
  }

  function setDockDestination(building, resourceId, destinationId) {
    if (!building || !root.OrbitBuildingData.dockSourceTypes.includes(building.type) ||
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
