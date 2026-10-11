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
    const logisticsNodeId = properties.logisticsNodeId ?? null;
    if (logisticsNodeId !== null && typeof logisticsNodeId !== 'string') throw new TypeError('Logistics node id must be a string or null');
    const customName = properties.customName ?? null;
    if (customName !== null && typeof customName !== 'string') throw new TypeError('Custom name must be a string or null');
    const status = properties.status ?? 'offline';
    if (typeof status !== 'string') throw new TypeError('Building status must be a string');
    const resourceId = properties.resourceId ?? null;
    if (resourceId !== null && typeof resourceId !== 'string') throw new TypeError('Resource id must be a string or null');
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
      roadPort,
      waterPort,
      logisticsNodeId,
      inventory: { ...inventory },
      energyUse,
      energyOutputWatts,
      flowPerMinute,
      resourceId,
      upgradeLevel,
      status,
      customName,
      createdAt
    };
  }

  root.OrbitSurfaceBuilding = Object.freeze({ create, getDefinition: Data.get, constructionStates });
})(globalThis);
