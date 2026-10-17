(function (root) {
  'use strict';

  const Data = root.OrbitOrbitalLogisticsData;
  const Network = root.OrbitLogisticsNetwork;
  const Transit = root.OrbitOrbitalTransit;

  function advance(state, currentTime, systemsById, running = true) {
    state.orbitalLogistics ||= Transit.createState();
    if (running) Network.transferDockStockToPlatforms(state);
    return Transit.advance(state, currentTime, systemsById, running);
  }

  function setExportEnabled(platform, resourceId, enabled) {
    if (!platform || platform.type !== 'launch_platform' || !Data.exportResources.some(item => item.id === resourceId)) return false;
    platform.exportEnabled ||= {};
    platform.exportEnabled[resourceId] = enabled === true;
    return true;
  }

  function platformStatus(state, platform, system, currentTime) {
    if (!system?.ark) return 'PAS DE HUB';
    const hasConnectedDock = (state.surfaceBuildings || []).some(source => source.id !== platform.id &&
      source.planetId === platform.planetId && source.constructionState === 'complete' &&
      Network.hasBuiltLandPath(state.roadNetworks?.[platform.planetId], source.id, platform.id));
    if (!hasConnectedDock) return 'PAS DE CONNEXION';
    const stock = platform.launchStock || {}, enabled = Data.exportResources.filter(item => platform.exportEnabled?.[item.id]);
    const hasEnabledStock = enabled.some(item => (stock[item.id] || 0) > 0);
    const hasExportableStock = Data.exportResources.some(item => (stock[item.id] || 0) > 0);
    if (platform.lastLaunchTime !== null && platform.lastLaunchTime !== undefined && currentTime - platform.lastLaunchTime < 1) return 'ACTIF';
    if (hasExportableStock && !hasEnabledStock) return 'EXPORT DÉSACTIVÉ';
    if (!hasExportableStock && Object.values(stock).some(amount => amount > 0)) return 'RESSOURCE NON EXPORTABLE';
    if (enabled.length && hasEnabledStock && enabled.reduce((sum, item) => sum + (stock[item.id] || 0), 0) > Data.launch.capacityUPerSecond) return 'SATURÉ';
    return 'EN ATTENTE';
  }

  root.OrbitLogistics = Object.freeze({ advance, setExportEnabled, platformStatus });
})(globalThis);
