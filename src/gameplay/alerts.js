(function (root) {
  'use strict';

  // Problems worth the player's attention, read from the state without
  // changing it: a planet short of power, a dock whose resource has no
  // destination, a colony flow running late. The UI words and shows them.
  function list(state) {
    const alerts = [];
    for (const [planetId, power] of Object.entries(state.powerStatus || {})) {
      if (power.demandMW > power.supplyMW + 1e-6) {
        alerts.push({ id: `power:${planetId}`, kind: 'power', severity: 'critical', planetId,
          demandMW: power.demandMW, supplyMW: power.supplyMW });
      }
    }
    for (const building of state.surfaceBuildings || []) {
      if (building.constructionState !== 'complete') continue;
      const graph = state.factoryPlans?.[building.id];
      const closed = new Set();
      for (const machine of graph?.machines || []) {
        if (machine.state !== 'no_destination') continue;
        closed.add(dockResource(graph, machine) || null);
      }
      if (closed.size) {
        alerts.push({ id: `dock:${building.id}`, kind: 'dock', severity: 'warning', buildingId: building.id,
          planetId: building.planetId, resourceIds: [...closed].filter(Boolean).sort() });
      }
      if (building.type === 'colony' && root.OrbitColony) {
        const colony = root.OrbitColony.normalize(building.colony);
        const late = Object.entries(root.OrbitColony.flows(colony.tier))
          .filter(([id, rate]) => (colony.owed[id] || 0) >= rate).map(([id]) => id).sort();
        if (late.length) {
          alerts.push({ id: `flow:${building.id}`, kind: 'colonyFlow', severity: 'warning', buildingId: building.id,
            planetId: building.planetId, resourceIds: late });
        }
      }
    }
    return alerts;
  }

  // The resource an output dock receives, from the card linked to it.
  function dockResource(graph, dock) {
    const link = graph.connections?.find(connection => connection.toMachineId === dock.id);
    const source = link && graph.machines.find(machine => machine.id === link.fromMachineId);
    const definition = source && root.OrbitProcessGraph?.definitionOf(source);
    return definition?.outputPorts.find(port => port.id === link.fromOutputId)?.resourceId || null;
  }

  root.OrbitAlerts = Object.freeze({ list });
})(globalThis);
