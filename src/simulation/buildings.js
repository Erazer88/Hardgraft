(function (root) {
  'use strict';

  const Data = root.OrbitBuildingData;
  const constructionStates = Object.freeze(['planned', 'constructing', 'complete']);
  const isFiniteNumber = value => typeof value === 'number' && Number.isFinite(value);
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

  // Creates the authoritative, terrain-anchored model from id, type, planetId,
  // x, and y. It does not place the building, validate terrain, consume
  // resources, or create a route. roadPort is stored in surface-world space.
  function create(properties) {
    if (!properties || typeof properties !== 'object') throw new TypeError('Building properties are required');
    const definition = Data.get(properties.type);
    if (!definition) throw new RangeError('Unknown surface building type: ' + properties.type);
    if (typeof properties.id !== 'string' || !properties.id.trim()) throw new TypeError('Building id is required');
    if (typeof properties.planetId !== 'string' || !properties.planetId.trim()) throw new TypeError('Planet id is required');
    if (!isFiniteNumber(properties.x) || !isFiniteNumber(properties.y)) throw new TypeError('Building coordinates must be finite world coordinates');

    const rotation = properties.rotation ?? 0;
    if (!isFiniteNumber(rotation)) throw new TypeError('Building rotation must be a finite number in radians');
    const constructionState = properties.constructionState ?? 'planned';
    if (!constructionStates.includes(constructionState)) throw new RangeError('Unknown construction state: ' + constructionState);
    const progress = properties.constructionProgress ?? 0;
    if (!isFiniteNumber(progress) || progress < 0 || progress > 1) throw new RangeError('Construction progress must be between 0 and 1');
    const constructionDurationSeconds = properties.constructionDurationSeconds ?? definition.constructionDurationSeconds ?? 3.5;
    if (!isFiniteNumber(constructionDurationSeconds) || constructionDurationSeconds <= 0) {
      throw new RangeError('Construction duration must be a positive number of seconds');
    }
    const demolitionRefundRate = properties.demolitionRefundRate ?? definition.demolitionRefundRate ?? 1;
    if (!isFiniteNumber(demolitionRefundRate) || demolitionRefundRate < 0 || demolitionRefundRate > 1) {
      throw new RangeError('Demolition refund rate must be between 0 and 1');
    }
    const costPaid = properties.costPaid ?? null;
    if (costPaid !== null && (!costPaid || typeof costPaid !== 'object' || Array.isArray(costPaid) ||
        Object.entries(costPaid).some(([id, amount]) => !id.trim() || !isFiniteNumber(amount) || amount < 0))) {
      throw new TypeError('Paid construction cost must be a resource map');
    }
    // What the cards of its plan cost; refunded with the building.
    const cardCostPaid = properties.cardCostPaid && typeof properties.cardCostPaid === 'object' && !Array.isArray(properties.cardCostPaid)
      ? Object.fromEntries(Object.entries(properties.cardCostPaid).filter(([id, amount]) => id.trim() && isFiniteNumber(amount) && amount > 0)) : {};
    const energyUse = properties.energyUse ?? 0;
    if (!isFiniteNumber(energyUse) || energyUse < 0) throw new RangeError('Energy use must be a non-negative number');
    const createdAt = properties.createdAt ?? Date.now();
    if (!isFiniteNumber(createdAt)) throw new TypeError('Creation time must be a finite timestamp');

    const transformOffset = offset => {
      if (!offset) return null;
      const cos = Math.cos(rotation), sin = Math.sin(rotation);
      return {
        x: properties.x + offset.x * cos - offset.y * sin,
        y: properties.y + offset.x * sin + offset.y * cos
      };
    };
    const roadPort = transformOffset(definition.roadPortOffset);
    const derivedWaterPort = transformOffset(definition.marinePortOffset || definition.seaFacingOffset);
    const waterPort = isFiniteNumber(properties.waterPort?.x) && isFiniteNumber(properties.waterPort?.y)
      ? { x: properties.waterPort.x, y: properties.waterPort.y } : derivedWaterPort;

    const inventory = properties.inventory ?? {};
    if (!inventory || typeof inventory !== 'object' || Array.isArray(inventory)) throw new TypeError('Building inventory must be a resource map');
    const integerStock = value => value && typeof value === 'object' && !Array.isArray(value)
      ? Object.fromEntries(Object.entries(value).filter(([, amount]) => Number.isInteger(amount) && amount > 0)) : {};
    const dockStock = integerStock(properties.dockStock);
    const launchStock = integerStock(properties.launchStock);
    const launchReceivedTotal = integerStock(properties.launchReceivedTotal);
    // Materials a landing base turned into construction stock.
    const receivedTotal = integerStock(properties.receivedTotal);
    // Units a depot's output gates queued, per destination building.
    const gateStock = properties.gateStock && typeof properties.gateStock === 'object' && !Array.isArray(properties.gateStock)
      ? Object.fromEntries(Object.entries(properties.gateStock).map(([id, queue]) => [id, integerStock(queue)])
        .filter(([id, queue]) => id.trim() && Object.keys(queue).length)) : {};
    const dockDestinations = properties.dockDestinations && typeof properties.dockDestinations === 'object' &&
      !Array.isArray(properties.dockDestinations)
      ? Object.fromEntries(Object.entries(properties.dockDestinations)
        .filter(([resourceId, buildingId]) => resourceId.trim() && typeof buildingId === 'string' && buildingId.trim()))
      : {};
    const exportEnabled = {};
    const exportResources = root.OrbitOrbitalLogisticsData?.exportResources || [];
    for (const resource of exportResources) exportEnabled[resource.id] = properties.exportEnabled?.[resource.id] === true;
    const exportCursorResourceId = typeof properties.exportCursorResourceId === 'string' ? properties.exportCursorResourceId : null;
    const logisticsNodeId = properties.logisticsNodeId ?? null;
    if (logisticsNodeId !== null && typeof logisticsNodeId !== 'string') throw new TypeError('Logistics node id must be a string or null');
    const customName = properties.customName ?? null;
    if (customName !== null && typeof customName !== 'string') throw new TypeError('Custom name must be a string or null');
    const status = properties.status ?? 'offline';
    if (typeof status !== 'string') throw new TypeError('Building status must be a string');
    const resourceId = properties.resourceId ?? null;
    if (resourceId !== null && typeof resourceId !== 'string') throw new TypeError('Resource id must be a string or null');
    // Share of the extracted material in the ground below; older saves stored it as depositAbundance.
    const share = properties.resourceShare ?? properties.depositAbundance;
    const resourceShare = isFiniteNumber(share) ? clamp(share, 0, 1) : null;
    const composition = properties.composition && typeof properties.composition === 'object' && !Array.isArray(properties.composition)
      ? Object.fromEntries(Object.entries(properties.composition)
        .filter(([, value]) => isFiniteNumber(value)).map(([id, value]) => [id, clamp(value, 0, 1)])) : null;
    const upgradeLevel = properties.upgradeLevel ?? 1;
    if (!Number.isInteger(upgradeLevel) || upgradeLevel < 1) throw new RangeError('Upgrade level must be a positive integer');
    const flowPerMinute = properties.flowPerMinute ?? 0;
    if (!isFiniteNumber(flowPerMinute) || flowPerMinute < 0) throw new RangeError('Flow rate must be a non-negative number');
    const energyOutputWatts = properties.energyOutputWatts ?? 0;
    if (!isFiniteNumber(energyOutputWatts) || energyOutputWatts < 0) throw new RangeError('Power output must be a non-negative number');

    return {
      id: properties.id.trim(),
      type: definition.id,
      planetId: properties.planetId.trim(),
      x: properties.x,
      y: properties.y,
      rotation,
      constructionState,
      constructionProgress: clamp(progress, 0, 1),
      constructionDurationSeconds,
      demolitionRefundRate,
      costPaid: costPaid ? { ...costPaid } : null,
      cardCostPaid,
      roadPort,
      waterPort,
      logisticsNodeId,
      inventory: { ...inventory },
      dockStock,
      dockDestinations,
      launchStock,
      launchReceivedTotal,
      receivedTotal,
      gateStock,
      exportEnabled,
      exportCursorResourceId,
      energyUse,
      energyOutputWatts,
      energyOutputUnlimited: properties.energyOutputUnlimited === true,
      flowPerMinute,
      resourceId,
      resourceShare,
      composition,
      upgradeLevel,
      status,
      customName,
      createdAt
    };
  }

  root.OrbitSurfaceBuilding = Object.freeze({ create, getDefinition: Data.get, constructionStates });
})(globalThis);
