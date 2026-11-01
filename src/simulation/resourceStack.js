(function (root) {
  'use strict';
  const Data = root.OrbitResourceData;
  const EPSILON = 1e-9;
  const qualities = Object.freeze(['impure', 'standard', 'superior']);
  const sizes = Object.freeze(['raw', 'oversized', 'fragment', 'calibrated', 'powder']);
  const elements = Object.freeze(['iron', 'copper', 'silicon', 'carbon']);
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  const copy = value => value == null ? null : JSON.parse(JSON.stringify(value));

  function compositionOf(value) {
    const result = Object.fromEntries(Object.entries(value || {}).filter(([id, amount]) =>
      id && Number.isFinite(amount) && amount > 0));
    const total = Object.values(result).reduce((sum, value) => sum + value, 0);
    if (total > 1) for (const id of Object.keys(result)) result[id] /= total;
    else if (total < 1) result.sterile = (result.sterile || 0) + 1 - total;
    return result;
  }

  function create(value) {
    if (!value || typeof value.resourceId !== 'string' || !Number.isFinite(value.amount) || value.amount <= EPSILON) return null;
    const resourceId = Data.canonicalId(value.resourceId), definition = Data.get(resourceId);
    const moisture = clamp(Number.isFinite(value.moisture) ? value.moisture : 0, 0, 1);
    const composition = compositionOf(value.composition || definition?.composition);
    const recoverable = elements.reduce((sum, id) => sum + (composition[id] || 0), 0);
    return { resourceId, amount: value.amount,
      quality: qualities.includes(value.quality) ? value.quality : definition?.quality || 'standard',
      moisture, particleSize: sizes.includes(value.particleSize) ? value.particleSize : definition?.particleSize || 'raw',
      origin: copy(value.origin),
      tags: [...new Set([...(definition?.tags || []), ...(Array.isArray(value.tags) ? value.tags.filter(tag =>
        typeof tag === 'string' && tag !== 'wet' && tag !== 'dry') : []), moisture > .2 ? 'wet' : 'dry'])].sort(),
      composition, recoverableFraction: clamp(Number.isFinite(value.recoverableFraction)
        ? value.recoverableFraction : recoverable, 0, recoverable),
      reprocessingPasses: Math.max(0, Math.floor(value.reprocessingPasses || 0)) };
  }

  function merge(first, second) {
    if (!first) return second ? create(second) : null;
    if (!second) return create(first);
    if (first.resourceId !== second.resourceId) throw new RangeError('Cannot merge different resources');
    const amount = first.amount + second.amount;
    const weighted = key => (first[key] * first.amount + second[key] * second.amount) / amount;
    const composition = {};
    for (const id of new Set([...Object.keys(first.composition), ...Object.keys(second.composition)])) {
      composition[id] = ((first.composition[id] || 0) * first.amount + (second.composition[id] || 0) * second.amount) / amount;
    }
    return create({ ...first, amount, composition, tags: [...new Set([...first.tags, ...second.tags])],
      quality: qualities[Math.min(qualities.indexOf(first.quality), qualities.indexOf(second.quality))],
      moisture: weighted('moisture'), recoverableFraction: weighted('recoverableFraction'),
      particleSize: sizes[Math.min(sizes.indexOf(first.particleSize), sizes.indexOf(second.particleSize))],
      reprocessingPasses: Math.max(first.reprocessingPasses, second.reprocessingPasses),
      origin: JSON.stringify(first.origin) === JSON.stringify(second.origin) ? first.origin : { kind: 'mixed' } });
  }

  function total(stacks) { return (stacks || []).reduce((sum, stack) => sum + (stack?.amount || 0), 0); }

  function addToStock(stock, stack) {
    if (!stack || stack.amount <= EPSILON) return;
    const index = stock.findIndex(item => item.resourceId === stack.resourceId);
    if (index === -1) stock.push(create(stack)); else stock[index] = merge(stock[index], stack);
  }

  root.OrbitResourceStack = Object.freeze({ create, merge, total, addToStock, compositionOf, qualities, sizes, elements, EPSILON });
})(globalThis);
