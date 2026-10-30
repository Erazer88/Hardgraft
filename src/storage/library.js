(function (root) {
  'use strict';

  // The player's library, kept apart from the game save so it outlives a new
  // game: saved buildings (type, name and cards, placed again from the build
  // menu) and blueprints (a region of cards, placed again inside a building).
  const STORAGE_KEY = 'nereide-atlas-library-v1';
  const LIMIT = 40;
  const copy = value => JSON.parse(JSON.stringify(value));
  const uid = (prefix, now) => `${prefix}-${now.toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  const text = value => typeof value === 'string' && value.trim() ? value.trim().slice(0, 32) : null;

  // The cards of a plan, without their stocks: positions relative to the
  // top-left card, links between kept cards only. `ids` keeps a subset.
  function planTemplate(plan, ids = null) {
    const keep = ids ? new Set(ids) : null;
    const machines = (plan?.machines || []).filter(machine => !keep || keep.has(machine.id));
    if (!machines.length) return { machines: [], connections: [] };
    const minX = Math.min(...machines.map(machine => machine.x)), minY = Math.min(...machines.map(machine => machine.y));
    const kept = new Set(machines.map(machine => machine.id));
    return {
      machines: machines.map(machine => ({ key: machine.id, type: machine.type, resourceId: machine.resourceId || null,
        dx: machine.x - minX, dy: machine.y - minY,
        ...(machine.config ? { config: copy(machine.config) } : {}),
        ...(machine.importResourceId ? { importResourceId: machine.importResourceId } : {}) })),
      connections: (plan.connections || []).filter(link => kept.has(link.fromMachineId) && kept.has(link.toMachineId))
        .map(link => ({ from: link.fromMachineId, fromOutputId: link.fromOutputId, to: link.toMachineId, toInputId: link.toInputId }))
    };
  }

  function buildingTemplate(building, plan, now = Date.now()) {
    return { id: uid('building', now), type: building.type, name: text(building.customName) || building.type,
      plan: planTemplate(plan), savedAt: now };
  }

  function blueprint(name, buildingType, plan, ids, now = Date.now()) {
    return { id: uid('blueprint', now), name: text(name) || 'Blueprint', buildingType,
      ...planTemplate(plan, ids), savedAt: now };
  }

  // Plain machines and connections from a template, with fresh ids, placed
  // from `origin`; `accept` may leave cards out (their links go with them) and
  // `resource` names the material each card works in its new building.
  function instantiate(template, { origin = { x: 80, y: 80 }, machineId, connectionId, accept = () => true,
    resource = item => item.resourceId } = {}) {
    const ids = new Map(), machines = [];
    for (const item of template?.machines || []) {
      if (!accept(item)) continue;
      const id = machineId(item);
      ids.set(item.key, id);
      const resourceId = resource(item);
      machines.push({ id, type: item.type, ...(resourceId ? { resourceId } : {}),
        x: origin.x + item.dx, y: origin.y + item.dy,
        ...(item.config ? { config: copy(item.config) } : {}),
        ...(item.importResourceId ? { importResourceId: item.importResourceId } : {}) });
    }
    const connections = (template?.connections || []).filter(link => ids.has(link.from) && ids.has(link.to))
      .map(link => ({ id: connectionId(link), fromMachineId: ids.get(link.from), fromOutputId: link.fromOutputId,
        toMachineId: ids.get(link.to), toInputId: link.toInputId }));
    return { machines, connections };
  }

  const validPlan = value => Array.isArray(value?.machines) && value.machines.every(machine =>
    typeof machine?.key === 'string' && typeof machine.type === 'string' && Number.isFinite(machine.dx) && Number.isFinite(machine.dy)) &&
    Array.isArray(value.connections);

  function normalize(value) {
    const buildings = (Array.isArray(value?.buildings) ? value.buildings : [])
      .filter(item => typeof item?.id === 'string' && typeof item.type === 'string' && text(item.name) && validPlan(item.plan));
    const blueprints = (Array.isArray(value?.blueprints) ? value.blueprints : [])
      .filter(item => typeof item?.id === 'string' && text(item.name) && validPlan(item));
    return { buildings: buildings.slice(0, LIMIT), blueprints: blueprints.slice(0, LIMIT) };
  }

  function load(storage) {
    try { return normalize(JSON.parse(storage?.getItem(STORAGE_KEY) || 'null')); }
    catch (_) { return normalize(null); }
  }

  function save(storage, library) {
    try { storage.setItem(STORAGE_KEY, JSON.stringify(normalize(library))); return true; }
    catch (_) { return false; }
  }

  // Newest first, at most LIMIT entries.
  function add(list, item) {
    list.unshift(item);
    list.splice(LIMIT);
    return item;
  }

  root.OrbitLibrary = Object.freeze({ planTemplate, buildingTemplate, blueprint, instantiate, normalize, load, save, add, limit: LIMIT });
})(globalThis);
