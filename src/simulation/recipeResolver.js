(function (root) {
  'use strict';
  const Data = root.OrbitProcessData, Resources = root.OrbitResourceData;
  const Stack = root.OrbitResourceStack, Graph = root.OrbitProcessGraph;
  const EPS = Stack.EPSILON, clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  const stateOf = mode => ({ valid: 'active', degraded: 'degraded', useless: 'useless', destructive: 'destructive' })[mode] || 'incompatible';
  const blocked = (state, message, mode = 'valid') => ({ ready: false, state, message, mode, inputs: [], outputs: [], energyUse: 0 });

  function timing(definition, graph, recipe = {}) {
    const level = Math.max(0, graph.technologyLevel - 1);
    return { duration: Math.max(.01, definition.processingTime * (recipe.timeMultiplier ?? 1)),
      rate: definition.baseThroughput * (recipe.rateMultiplier ?? 1) * (1 + level * Data.config.throughputPerLevel),
      energyUse: definition.energyUse * (recipe.energyMultiplier ?? 1) };
  }
  function result(definition, graph, recipe, inputs, outputs, extra = {}) {
    const time = timing(definition, graph, recipe), mode = recipe.mode || 'valid';
    if (time.rate <= EPS) return blocked('waiting', 'Débit nul pour ce bloc.');
    return { ready: true, state: stateOf(mode), mode, message: recipe.message || '', recipeId: recipe.id || definition.operation,
      duration: time.duration, energyUse: time.energyUse, rate: time.rate, inputs, outputs, ...extra };
  }
  function budget(definition, graph, stack, recipe = {}) {
    const time = timing(definition, graph, recipe);
    return Math.min(stack.amount, time.rate * time.duration, definition.outputCapacity / (1 + (recipe.secondary?.ratio || 0)));
  }
  const output = (port, stack) => stack ? [{ port, stack }] : [];
  function usefulStack(source, resourceId, amount, changes = {}) {
    const definition = Resources.get(resourceId);
    return amount > EPS ? Stack.convert(source, resourceId, amount, { composition: definition.composition,
      moisture: source.moisture, recoverableFraction: undefined, ...changes }) : null;
  }

  // Component totals and recoverable material are retained in every rejection.
  function remainder(inputs, product, resourceId = 'waste', overrides = {}) {
    const total = Stack.total(inputs), amount = total - (product?.amount || 0);
    if (amount <= EPS) return null;
    const components = {}, recoverableInput = inputs.reduce((sum, item) => sum + item.amount * item.recoverableFraction, 0);
    for (const stack of inputs) for (const [id, fraction] of Object.entries(stack.composition)) {
      components[id] = (components[id] || 0) + stack.amount * fraction;
    }
    if (product) for (const [id, fraction] of Object.entries(product.composition)) {
      components[id] = Math.max(0, (components[id] || 0) - product.amount * fraction);
    }
    const composition = Object.fromEntries(Object.entries(components).map(([id, value]) => [id, value / amount]));
    const recovered = product ? Stack.elements.reduce((sum, id) => sum + (product.composition[id] || 0) * product.amount, 0) : 0;
    return Stack.convert(inputs[0], resourceId, amount, { composition,
      moisture: inputs.reduce((sum, item) => sum + item.moisture * item.amount, 0) / total,
      recoverableFraction: Math.max(0, recoverableInput - recovered) / amount, ...overrides });
  }

  function matches(recipe, stack) {
    return (!recipe.resources || recipe.resources.includes(stack.resourceId)) &&
      (!recipe.particleSizes || recipe.particleSizes.includes(stack.particleSize)) &&
      (recipe.minMoisture == null || stack.moisture > recipe.minMoisture);
  }

  function ingredientBatch(node, graph, definition, recipe, main) {
    let amount = budget(definition, graph, main, recipe), secondary = null;
    if (recipe.secondary) {
      const required = recipe.secondary, available = node.internalBuffer.inputs[required.port];
      if (!available || available.resourceId !== required.resourceId || available.amount <= EPS) {
        return { error: blocked('missing_input', 'ENTRÉE MANQUANTE : ' + Resources.get(required.resourceId).label.toUpperCase()) };
      }
      amount = Math.min(amount, available.amount / required.ratio);
      secondary = Stack.portion(available, amount * required.ratio);
    }
    return { amount, main: Stack.portion(main, amount), secondary,
      inputs: [{ port: 0, amount }, ...(secondary ? [{ port: recipe.secondary.port, amount: secondary.amount }] : [])] };
  }

  function recover(node, graph, definition, recipe, main) {
    let adjusted = { ...recipe };
    if (main.particleSize === 'raw') adjusted = { ...adjusted, mode: 'degraded',
      rateMultiplier: recipe.rawRateMultiplier, message: 'Roche non préparée : récupération et cadence réduites.' };
    if (main.particleSize === 'powder') adjusted.rateMultiplier = recipe.powderRateMultiplier;
    const batch = ingredientBatch(node, graph, definition, adjusted, main);
    if (batch.error) return batch.error;
    const mineralFraction = Stack.elements.reduce((sum, id) => sum + (main.composition[id] || 0), 0);
    const accessibleFraction = (main.composition[recipe.element] || 0) * (mineralFraction > EPS
      ? Math.min(1, main.recoverableFraction / mineralFraction) : 0);
    const efficiency = clamp(recipe.recovery[main.particleSize] +
      Math.max(0, graph.technologyLevel - 1) * Data.config.recoveryPerLevel, 0, .99);
    const product = usefulStack(batch.main, recipe.outputResource, batch.amount * accessibleFraction * efficiency,
      { moisture: recipe.outputMoisture ?? main.moisture });
    const inputs = [batch.main, ...(batch.secondary ? [batch.secondary] : [])];
    let rejection = remainder(inputs, product, recipe.wasteResource || 'waste');
    if (!product && !batch.secondary && !main.tags.includes('ore') && !main.tags.includes('waste')) rejection = batch.main;
    if (!product) adjusted = { ...adjusted, mode: 'useless', message: 'Aucune fraction ' + recipe.element + ' récupérable : flux dirigé vers les rejets.' };
    if (recipe.wasteResource === 'sludge' && rejection) rejection = Stack.create({ ...rejection, moisture: .9 });
    return result(definition, graph, adjusted, batch.inputs, [...output(0, product), ...output(1, rejection)]);
  }

  function purify(node, graph, definition, recipe, main) {
    const wet = recipe.wet && main.moisture > recipe.wet.threshold;
    const adjusted = wet ? { ...recipe, mode: 'degraded', rateMultiplier: recipe.wet.rateMultiplier,
      energyMultiplier: recipe.wet.energyMultiplier, message: 'Matière humide : moins de produit, plus de déchets et d’énergie.' } : recipe;
    const batch = ingredientBatch(node, graph, definition, adjusted, main);
    if (batch.error) return batch.error;
    const ingredients = [batch.main, ...(batch.secondary ? [batch.secondary] : [])];
    let usefulAmount = batch.amount * recipe.yield * (wet ? recipe.wet.yieldMultiplier : 1);
    const productComposition = Resources.get(recipe.outputResource).composition;
    for (const [element, fraction] of Object.entries(productComposition)) {
      if (fraction > EPS) usefulAmount = Math.min(usefulAmount,
        ingredients.reduce((sum, stack) => sum + (stack.composition[element] || 0) * stack.amount, 0) / fraction);
    }
    const product = usefulStack(batch.main, recipe.outputResource, usefulAmount, { moisture: 0 });
    const rejection = remainder(ingredients, product, recipe.wasteResource || 'waste',
      recipe.wasteResource === 'sludge' ? { moisture: .9 } : {});
    return result(definition, graph, adjusted, batch.inputs, [...output(0, product), ...output(1, rejection)]);
  }

  function recycle(node, graph, definition, recipe, main) {
    const amount = budget(definition, graph, main, recipe), consumed = Stack.portion(main, amount);
    const accessible = Stack.elements.reduce((sum, id) => sum + (main.composition[id] || 0), 0);
    const recoveredAmount = amount * main.recoverableFraction * recipe.recovery;
    const composition = Object.fromEntries(Stack.elements.map(id => [id, accessible > EPS ? (main.composition[id] || 0) / accessible : 0]));
    const residualId = { raw: 'residual_ore', fragment: 'residual_ore_fragment', powder: 'residual_ore_powder' }[main.particleSize];
    const residual = recoveredAmount > EPS ? Stack.convert(consumed, residualId, recoveredAmount,
      { composition, recoverableFraction: 1, reprocessingPasses: main.reprocessingPasses + 1 }) : null;
    const waste = remainder([consumed], residual, 'residual_waste', { reprocessingPasses: main.reprocessingPasses + 1 });
    if (waste) waste.recoverableFraction *= recipe.recoverabilityDecay;
    return result(definition, graph, residual ? recipe : { ...recipe, mode: 'useless', message: 'Aucune matière récupérable restante.' },
      [{ port: 0, amount }], [...output(0, residual), ...output(1, waste)]);
  }

  function resolve(node, graph) {
    const definition = Graph.definitionOf(node), main = node.internalBuffer.inputs[0];
    if (definition.operation === 'disabled' || definition.enabled === false) return blocked('waiting', 'Bloc désactivé pour cette version.');
    if (definition.operation === 'source') {
      const oil = definition.sourceResource === 'raw_oil';
      if (!graph.geology || !Number.isFinite(graph.geology.throughput) || !Number.isFinite(graph.geology.hardness) ||
          !Object.hasOwn(Data.config.geology.signatures, graph.geology.resourceId) ||
          (oil ? graph.geology.resourceId !== 'oil' : graph.geology.resourceId === 'oil')) {
        return blocked('missing_input', 'Aucun gisement compatible associé au bâtiment.');
      }
      if (graph.geology.throughput <= EPS) return blocked('waiting', 'Le gisement ne produit aucun flux actuellement.');
      const adjusted = { rateMultiplier: graph.geology.throughput / definition.baseThroughput,
        energyMultiplier: graph.geology.hardness, id: 'geological_extraction' };
      const time = timing(definition, graph, adjusted);
      const stack = Stack.create({ resourceId: definition.sourceResource, amount: Math.min(time.rate * time.duration, definition.outputCapacity),
        composition: graph.geology.composition, moisture: graph.geology.moisture,
        origin: { kind: 'deposit', id: graph.geology.id, planetId: graph.geology.planetId }, quality: 'impure' });
      return result(definition, graph, adjusted, [], output(0, stack), { geologicalSource: true });
    }
    if (definition.operation === 'import') {
      const source = graph.externalStock.find(stack => !node.settings.filter || stack.resourceId === node.settings.filter);
      if (!source) return blocked('missing_input', 'Stock d’entrée du bâtiment vide pour cette matière.');
      const amount = budget(definition, graph, source);
      return result(definition, graph, {}, [{ external: true, resourceId: source.resourceId, amount }],
        output(0, Stack.portion(source, amount)));
    }
    if (definition.operation === 'merge') {
      const stacks = node.internalBuffer.inputs.filter(Boolean);
      if (!stacks.length) return blocked('missing_input', 'Aucun flux à fusionner.');
      if (stacks.some(stack => stack.resourceId !== stacks[0].resourceId)) return blocked('incompatible', 'Fusion refusée : Fer + Cuivre ne crée pas un alliage.', 'impossible');
      const time = timing(definition, graph), total = Math.min(Stack.total(stacks), time.rate * time.duration, definition.outputCapacity);
      const available = Stack.total(stacks), inputs = [], portions = [];
      node.internalBuffer.inputs.forEach((stack, port) => { if (stack) {
        const amount = total * stack.amount / available; inputs.push({ port, amount }); portions.push(Stack.portion(stack, amount));
      } });
      return result(definition, graph, {}, inputs, output(0, portions.reduce((a, b) => Stack.merge(a, b), null)));
    }
    if (!main) return blocked('missing_input', 'Aucune matière dans le buffer d’entrée.');
    const acceptance = Graph.acceptance(node, 0, main);
    if (!acceptance.ok && acceptance.kind !== 'capacity') return blocked(acceptance.state, acceptance.reason, acceptance.kind);
    if (definition.operation === 'export') {
      const amount = Math.min(budget(definition, graph, main), graph.exportCapacity - Stack.total(graph.exportStock));
      if (amount <= EPS) return blocked('output_blocked', 'Stock du quai plein : aucune destination extérieure ne l’a vidé.');
      return result(definition, graph, {}, [{ port: 0, amount }], output(-1, Stack.portion(main, amount)), { destination: 'exportStock' });
    }
    if (definition.operation === 'dump') {
      const amount = budget(definition, graph, main);
      return result(definition, graph, {}, [{ port: 0, amount }], output(-1, Stack.convert(main, 'waste', amount)), { destination: 'history' });
    }
    if (definition.operation === 'screen') {
      const amount = budget(definition, graph, main), port = main.particleSize === 'raw' ? 0 : 1;
      return result(definition, graph, {}, [{ port: 0, amount }], output(port, Stack.portion(main, amount)),
        { message: port === 0 ? 'Granulométrie trop grosse.' : 'Granulométrie correcte.' });
    }
    if (definition.operation === 'split') {
      const desired = budget(definition, graph, main), roomA = Graph.outputRoom(node, 0, main), roomB = Graph.outputRoom(node, 1, main);
      const amount = Math.min(desired, roomA + roomB);
      if (amount <= EPS) return blocked('output_blocked', 'Les deux branches sont pleines.');
      let amountA = Math.min(amount * clamp(node.settings.ratio, 0, 1), roomA);
      const amountB = Math.min(amount - amountA, roomB); amountA += Math.min(amount - amountA - amountB, roomA - amountA);
      return result(definition, graph, {}, [{ port: 0, amount: amountA + amountB }],
        [...output(0, Stack.portion(main, amountA)), ...output(1, Stack.portion(main, amountB))]);
    }
    if (definition.operation === 'pass' || definition.passResources?.includes(main.resourceId)) {
      const amount = budget(definition, graph, main), recipe = definition.passResources?.includes(main.resourceId)
        ? { mode: 'useless', energyMultiplier: 0, message: 'Matière déjà préparée : aucune transformation.' } : {};
      return result(definition, graph, recipe, [{ port: 0, amount }], output(0, Stack.portion(main, amount)),
        definition.passResources?.includes(main.resourceId) ? { energyUse: 0 } : {});
    }
    const recipe = definition.recipes.find(item => matches(item, main));
    if (recipe?.operation === 'recover') return recover(node, graph, definition, recipe, main);
    if (recipe?.operation === 'purify') return purify(node, graph, definition, recipe, main);
    if (recipe?.operation === 'recycle') return recycle(node, graph, definition, recipe, main);
    if (recipe?.operation === 'resize' || recipe?.operation === 'dry') {
      const amount = budget(definition, graph, main, recipe);
      const stack = recipe.operation === 'dry' ? Stack.create({ ...main, amount, moisture: 0 }) :
        Stack.convert(main, recipe.outputMap[main.resourceId] || main.resourceId, amount, { particleSize: recipe.particleSize, quality: main.quality });
      return result(definition, graph, recipe, [{ port: 0, amount }], output(0, stack));
    }
    if (recipe?.operation === 'triphasic') {
      const amount = budget(definition, graph, main, recipe), gas = usefulStack(main, 'gas', amount * (main.composition.gas || 0));
      const oil = usefulStack(main, 'oil', amount * (main.composition.oil || 0));
      const waste = Stack.convert(main, 'waste', Math.max(0, amount - (gas?.amount || 0) - (oil?.amount || 0)),
        { composition: { sterile: 1 }, recoverableFraction: 0 });
      return result(definition, graph, recipe, [{ port: 0, amount }], [...output(0, gas), ...output(1, oil), ...output(2, waste)]);
    }
    const amount = budget(definition, graph, main), destructive = definition.destructiveTags?.some(tag => main.tags.includes(tag));
    return result(definition, graph, { mode: destructive ? 'destructive' : 'useless',
      message: destructive ? 'Aucun métal séparé exploitable : matière convertie en déchets.' : 'Cette matière ressort inchangée.' },
      [{ port: 0, amount }], output(destructive ? 1 : 0,
        destructive ? Stack.convert(main, 'waste', amount) : Stack.portion(main, amount)),
      destructive ? {} : { energyUse: 0 });
  }

  root.OrbitRecipeResolver = Object.freeze({ resolve, stateOf, remainder });
})(globalThis);
