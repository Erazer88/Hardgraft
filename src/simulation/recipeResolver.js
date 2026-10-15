(function (root) {
  'use strict';
  const Data = root.OrbitProcessData, Resources = root.OrbitResourceData;
  const Stack = root.OrbitResourceStack, Graph = root.OrbitProcessGraph;
  const EPS = Stack.EPSILON, clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  const stateOf = mode => ({ valid: 'active', degraded: 'degraded', useless: 'useless', destructive: 'destructive' })[mode] || 'incompatible';
  const blocked = (state, message, mode = 'valid') => ({ ready: false, state, message, mode, inputs: [], outputs: [], energyUse: 0 });

  function timing(definition, graph, recipe = {}) {
    const level = Math.max(0, graph.technologyLevel - 1);
    const port = definition.inputPorts[0] || definition.outputPorts[0];
    const portCap = port?.maxThroughput ?? Infinity;
    return { duration: Math.max(.01, definition.processingTime * (recipe.timeMultiplier ?? 1)),
      rate: Math.min(portCap, definition.baseThroughput * (recipe.rateMultiplier ?? 1) *
        (1 + level * Data.config.throughputPerLevel)),
      energyUse: definition.energyUse * (recipe.energyMultiplier ?? 1) };
  }
  function result(definition, graph, recipe, inputs, outputs, extra = {}) {
    const time = timing(definition, graph, recipe), mode = recipe.mode || 'valid';
    if (time.rate <= EPS) return blocked('waiting', 'Débit nul pour ce bloc.');
    const workAmount = inputs.length ? (definition.operation === 'merge'
      ? inputs.reduce((sum, item) => sum + item.amount, 0) : inputs[0].amount)
      : Stack.total(outputs.filter(item => item.port >= 0).map(item => item.stack));
    const unit = Data.config.resourceUnit || 1;
    if (workAmount + EPS < unit) return blocked('missing_input', `En attente de ${unit} u pour terminer un cycle.`);
    const duration = workAmount > EPS
      ? Math.min(time.duration, Math.max(Data.config.fixedStepSeconds, workAmount / time.rate)) : time.duration;
    return { ready: true, state: stateOf(mode), mode, message: recipe.message || '', recipeId: recipe.id || definition.operation,
      duration, energyUse: time.energyUse, rate: time.rate, inputs, outputs, ...extra };
  }
  function budget(definition, graph, stack, recipe = {}) {
    const time = timing(definition, graph, recipe);
    const unit = Data.config.resourceUnit || 1;
    const available = Math.min(stack.amount, time.rate * time.duration,
      definition.outputCapacity / (1 + (recipe.secondary?.ratio || 0)));
    return available + EPS >= unit ? unit : 0;
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

  function ingredientBatch(node, graph, definition, recipe, main, mainPort = 0) {
    let amount = budget(definition, graph, main, recipe), secondary = null, creditUpdates = [];
    if (amount + EPS < (Data.config.resourceUnit || 1)) {
      return { error: blocked('missing_input', `En attente de ${Data.config.resourceUnit || 1} u entière.`) };
    }
    if (recipe.secondary) {
      const required = recipe.secondary, available = node.internalBuffer.inputs[required.port];
      const credit = node.internalBuffer.ingredientCredits[required.port];
      if (credit && credit.resourceId !== required.resourceId) {
        return { error: blocked('incompatible', 'Le crédit d’ingrédient contient une matière différente.', 'impossible') };
      }
      const needed = amount * required.ratio, shortfall = Math.max(0, needed - (credit?.amount || 0));
      const reserveAmount = Math.ceil(shortfall - EPS);
      if (reserveAmount > 0 && (!available || available.resourceId !== required.resourceId || available.amount + EPS < reserveAmount)) {
        return { error: blocked('missing_input', 'ENTRÉE MANQUANTE : ' + Resources.get(required.resourceId).label.toUpperCase()) };
      }
      const reserved = reserveAmount > 0 ? Stack.portion(available, reserveAmount) : null;
      const creditPool = Stack.merge(credit, reserved);
      secondary = Stack.portion(creditPool, needed);
      const creditLeft = creditPool.amount - needed;
      creditUpdates = [{ port: required.port, stack: creditLeft > EPS ? Stack.portion(creditPool, creditLeft) : null }];
      amount = Math.min(amount, 1);
      return { amount, main: Stack.portion(main, amount), secondary,
        inputs: [{ port: mainPort, amount }, { port: required.port, resourceId: required.resourceId,
          amount: secondary.amount, reserveAmount, ingredientCredit: true }], creditUpdates };
    }
    return { amount, main: Stack.portion(main, amount), secondary,
      inputs: [{ port: mainPort, amount }], creditUpdates };
  }

  function recover(node, graph, definition, recipe, main, mainPort = 0) {
    let adjusted = { ...recipe };
    const grain = main.particleSize === 'oversized' ? 'raw' : main.particleSize;
    if (grain === 'raw') adjusted = { ...adjusted, mode: 'degraded',
      rateMultiplier: recipe.rawRateMultiplier, message: 'Roche non préparée : récupération et cadence réduites.' };
    else if (grain === 'fragment') adjusted.rateMultiplier = recipe.fragmentRateMultiplier;
    else if (grain === 'calibrated') adjusted.rateMultiplier = recipe.calibratedRateMultiplier;
    else if (grain === 'powder') adjusted.rateMultiplier = recipe.powderRateMultiplier;
    const batch = ingredientBatch(node, graph, definition, adjusted, main, mainPort);
    if (batch.error) return batch.error;
    const mineralFraction = Stack.elements.reduce((sum, id) => sum + (main.composition[id] || 0), 0);
    const accessibleFraction = (main.composition[recipe.element] || 0) * (mineralFraction > EPS
      ? Math.min(1, main.recoverableFraction / mineralFraction) : 0);
    const recoveryBonusIndex = Math.min(Data.config.recoveryBonusByLevel.length - 1, Math.max(0, graph.technologyLevel - 1));
    const recoveryBonus = Data.config.recoveryBonusByLevel[recoveryBonusIndex] || 0;
    const efficiency = clamp(recipe.recovery[grain] + recoveryBonus, 0, Data.config.maxRecovery);
    const product = usefulStack(batch.main, recipe.outputResource, batch.amount * accessibleFraction * efficiency,
      { moisture: recipe.outputMoisture ?? main.moisture });
    const inputs = [batch.main, ...(batch.secondary ? [batch.secondary] : [])];
    let rejection = remainder(inputs, product, recipe.wasteResource || 'waste');
    if (!product && !batch.secondary && !main.tags.includes('ore') && !main.tags.includes('waste')) rejection = batch.main;
    if (!product) adjusted = { ...adjusted, mode: 'useless', message: 'Aucune fraction ' + recipe.element + ' récupérable : flux dirigé vers les rejets.' };
    if (recipe.wasteResource === 'sludge' && rejection) rejection = Stack.create({ ...rejection, moisture: .9 });
    return result(definition, graph, adjusted, batch.inputs, [...output(0, product), ...output(1, rejection)],
      { creditUpdates: batch.creditUpdates });
  }

  function purify(node, graph, definition, recipe, main, mainPort = 0) {
    const wet = recipe.wet && main.moisture > recipe.wet.threshold;
    const adjusted = wet ? { ...recipe, mode: 'degraded', rateMultiplier: recipe.wet.rateMultiplier,
      energyMultiplier: recipe.wet.energyMultiplier, message: 'Matière humide : moins de produit, plus de déchets et d’énergie.' } : recipe;
    const batch = ingredientBatch(node, graph, definition, adjusted, main, mainPort);
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
    return result(definition, graph, adjusted, batch.inputs, [...output(0, product), ...output(1, rejection)],
      { creditUpdates: batch.creditUpdates });
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
    if (waste) waste.recoverableFraction = Math.min(waste.recoverableFraction,
      consumed.recoverableFraction * recipe.remainingRecoverability);
    return result(definition, graph, residual ? recipe : { ...recipe, mode: 'useless', message: 'Aucune matière récupérable restante.' },
      [{ port: 0, amount }], [...output(0, residual), ...output(1, waste)]);
  }

  function resolve(node, graph) {
    const definition = Graph.definitionOf(node), mainPorts = definition.mainInputPorts || [0];
    const nextPortIndex = mainPorts.indexOf(node.settings.nextMainPort);
    const firstPort = nextPortIndex >= 0 ? nextPortIndex : 0;
    let mainPort = mainPorts[firstPort] ?? 0, main = null;
    for (let step = 0; step < mainPorts.length; step++) {
      const candidate = mainPorts[(firstPort + step) % mainPorts.length];
      if (node.internalBuffer.inputs[candidate]) { mainPort = candidate; main = node.internalBuffer.inputs[candidate]; break; }
    }
    if (definition.operation === 'disabled' || definition.enabled === false) return blocked('waiting', 'Bloc désactivé pour cette version.');
    if (definition.operation === 'dump') return blocked('waiting', 'Le terril stocke directement toute matière reçue.');
    if (definition.operation === 'source') {
      const oil = definition.sourceResource === 'raw_oil';
      if (!graph.geology || !Number.isFinite(graph.geology.throughput) || !Number.isFinite(graph.geology.hardness) ||
          !Object.hasOwn(Data.config.geology.signatures, graph.geology.resourceId) ||
          (oil ? graph.geology.resourceId !== 'oil' : graph.geology.resourceId === 'oil')) {
        return blocked('missing_input', 'Aucun gisement compatible associé au bâtiment.');
      }
      if (oil && graph.geology.throughput <= EPS) return blocked('waiting', 'Le gisement ne produit aucun flux actuellement.');
      const sourceRate = oil ? graph.geology.throughput : definition.baseThroughput;
      const adjusted = { rateMultiplier: sourceRate / definition.baseThroughput,
        energyMultiplier: graph.geology.hardness, id: 'geological_extraction' };
      const time = timing(definition, graph, adjusted);
      const stack = Stack.create({ resourceId: definition.sourceResource, amount: Math.min(time.rate * time.duration,
        definition.outputCapacity, Data.config.resourceUnit || 1),
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
      const unit = Data.config.resourceUnit || 1;
      const inputs = node.internalBuffer.inputs.flatMap((stack, port) =>
        stack && stack.amount + EPS >= unit ? [{ port, stack: Stack.portion(stack, unit) }] : []);
      if (!inputs.length) return blocked('missing_input', `En attente de ${unit} u entière pour fusionner.`);
      const merged = inputs.reduce((current, item) => Stack.merge(current, item.stack), null);
      return result(definition, graph, {}, inputs.map(item => ({ port: item.port, amount: item.stack.amount })),
        output(0, merged));
    }
    if (!main) return blocked('missing_input', 'Aucune matière dans le buffer d’entrée.');
    const acceptance = Graph.acceptance(node, mainPort, main);
    if (!acceptance.ok && acceptance.kind !== 'capacity') return blocked(acceptance.state, acceptance.reason, acceptance.kind);
    if (definition.operation === 'export') {
      const amount = Math.min(budget(definition, graph, main), graph.exportCapacity - Stack.total(graph.exportStock));
      if (amount <= EPS) return blocked('output_blocked', 'Stock du quai plein : aucune destination extérieure ne l’a vidé.');
      return result(definition, graph, {}, [{ port: mainPort, amount }], output(-1, Stack.portion(main, amount)), { destination: 'exportStock' });
    }
    if (definition.operation === 'screen') {
      const amount = budget(definition, graph, main);
      const stack = (particleSize, portion) => Stack.convert(main, main.resourceId, portion, { particleSize });
      if (main.particleSize === 'raw' || main.particleSize === 'oversized') {
        return result(definition, graph, {}, [{ port: mainPort, amount }], output(0, stack('oversized', amount)),
          { message: 'Roche brute : tout le flux est trop gros.' });
      }
      if (main.particleSize === 'fragment') {
        const oversized = amount * .15, calibrated = amount - oversized;
        return result(definition, graph, {}, [{ port: mainPort, amount }], [
          ...output(0, stack('oversized', oversized)), ...output(1, stack('calibrated', calibrated))
        ], { message: 'Tri granulométrique : 15 % trop gros, 85 % calibrés.' });
      }
      return result(definition, graph, {}, [{ port: mainPort, amount }], output(1, stack(main.particleSize, amount)),
        { message: 'Granulométrie correcte.' });
    }
    if (definition.operation === 'split') {
      const desired = budget(definition, graph, main), roomA = Graph.outputRoom(node, 0, main), roomB = Graph.outputRoom(node, 1, main);
      const amount = Math.min(desired, roomA + roomB);
      if (amount + EPS < (Data.config.resourceUnit || 1)) {
        return blocked('output_blocked', 'Les sorties doivent pouvoir accueillir le cycle complet de 1 u.');
      }
      let amountA = Math.min(amount * clamp(node.settings.ratio, 0, 1), roomA);
      const amountB = Math.min(amount - amountA, roomB); amountA += Math.min(amount - amountA - amountB, roomA - amountA);
      return result(definition, graph, {}, [{ port: mainPort, amount: amountA + amountB }],
        [...output(0, Stack.portion(main, amountA)), ...output(1, Stack.portion(main, amountB))]);
    }
    if (definition.operation === 'filter') {
      const amount = budget(definition, graph, main), conforming = !node.settings.filter || node.settings.filter === main.resourceId;
      return result(definition, graph, {}, [{ port: mainPort, amount }],
        output(conforming ? 0 : 1, Stack.portion(main, amount)),
        { message: conforming ? 'Matière conforme.' : 'Matière dirigée vers les rejets.' });
    }
    if (definition.operation === 'pass' || definition.passResources?.includes(main.resourceId)) {
      const amount = budget(definition, graph, main), recipe = definition.passResources?.includes(main.resourceId)
        ? { mode: 'useless', energyMultiplier: 0, message: 'Matière déjà préparée : aucune transformation.' } : {};
      return result(definition, graph, recipe, [{ port: mainPort, amount }], output(0, Stack.portion(main, amount)),
        definition.passResources?.includes(main.resourceId) ? { energyUse: 0 } : {});
    }
    const recipe = definition.recipes.find(item => matches(item, main));
    if (recipe?.operation === 'recover') return recover(node, graph, definition, recipe, main, mainPort);
    if (recipe?.operation === 'purify') return purify(node, graph, definition, recipe, main, mainPort);
    if (recipe?.operation === 'recycle') return recycle(node, graph, definition, recipe, main);
    if (recipe?.operation === 'resize' || recipe?.operation === 'dry') {
      const amount = budget(definition, graph, main, recipe);
      const stack = recipe.operation === 'dry' ? Stack.create({ ...main, amount, moisture: 0 }) :
        Stack.convert(main, recipe.outputMap[main.resourceId] || main.resourceId, amount, { particleSize: recipe.particleSize, quality: main.quality });
      return result(definition, graph, recipe, [{ port: mainPort, amount }], output(0, stack));
    }
    if (recipe?.operation === 'triphasic') {
      const amount = budget(definition, graph, main, recipe), gas = usefulStack(main, 'gas', amount * (main.composition.gas || 0));
      const oil = usefulStack(main, 'oil', amount * (main.composition.oil || 0));
      const waste = Stack.convert(main, 'waste', Math.max(0, amount - (gas?.amount || 0) - (oil?.amount || 0)),
        { composition: { sterile: 1 }, recoverableFraction: 0 });
      return result(definition, graph, recipe, [{ port: 0, amount }], [...output(0, gas), ...output(1, oil), ...output(2, waste)]);
    }
    const behavior = definition.invalidInputBehavior || 'pass_through';
    if (behavior === 'reject') return blocked('incompatible', definition.invalidInputMessage ||
      'Cette matière ne peut pas entrer physiquement dans ce procédé.', 'impossible');
    const destructive = behavior === 'waste' &&
      (!definition.destructiveTags?.length || definition.destructiveTags.some(tag => main.tags.includes(tag)));
    const fallback = destructive ? { mode: 'destructive',
      rateMultiplier: definition.invalidInputRate ? definition.invalidInputRate / definition.baseThroughput : 1,
      energyMultiplier: definition.invalidInputEnergyMultiplier ?? 1,
      message: 'Procédé inadapté : cette matière est convertie en déchets.' } : {
      mode: 'useless', energyMultiplier: 0, message: 'Cette matière ressort inchangée.' };
    const amount = budget(definition, graph, main, fallback);
    return result(definition, graph, fallback, [{ port: mainPort, amount }], output(destructive ? 1 : 0,
      destructive ? Stack.convert(main, 'waste', amount) : Stack.portion(main, amount)),
      destructive ? {} : { energyUse: 0 });
  }

  root.OrbitRecipeResolver = Object.freeze({ resolve, stateOf, remainder });
})(globalThis);
