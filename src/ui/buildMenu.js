(function (root) {
  'use strict';

  // The build menu: filter chips (all, a group, saved buildings), one card
  // per building (badge, name, an "i" for how it works) and the info sheet
  // opened in place of the list. Refreshed with the HUD; it reads the state
  // and never changes it (the clicks are handled in app.js).
  const BuildingData = root.OrbitBuildingData;
  const ResourceData = root.OrbitResourceData;
  const Inventory = root.OrbitInventory;

  function create(document, { resourceSummary = () => '' } = {}) {
    const $ = id => document.getElementById(id);
    const fmt = value => new Intl.NumberFormat('fr-FR').format(value);
    // The build menu: one card per building (badge, name, an "i" for how it
    // works), filtered by group; the info opens in place of the list.
    const buildOptions = $('build-options');
    const nameCase = label => label.charAt(0) + label.slice(1).toLowerCase();
    for (const definition of BuildingData.catalog()) {
      const card = document.createElement('div'); card.className = 'build-card'; card.dataset.buildingCard = definition.id;
      const button = document.createElement('button');
      button.type = 'button'; button.className = 'build-option'; button.dataset.buildingType = definition.id;
      const icon = document.createElement('canvas'); icon.className = 'build-option-badge'; icon.width = icon.height = 72;
      icon.setAttribute('aria-hidden', 'true');
      root.OrbitBuildingRenderer?.drawBadge(icon, definition.id);
      const name = document.createElement('strong'); name.textContent = nameCase(definition.label);
      const note = document.createElement('small'); note.className = 'build-option-note'; note.hidden = true;
      button.append(icon, name, note);
      const info = document.createElement('button');
      info.type = 'button'; info.className = 'build-info-button'; info.dataset.buildingInfo = definition.id;
      info.setAttribute('aria-label', `Fonctionnement : ${nameCase(definition.label)}`); info.textContent = 'i';
      card.append(button, info); buildOptions.append(card);
    }
    const groupOf = definition => BuildingData.menuGroups.find(group => group.categories.includes(definition?.category)) || null;

    function update(state, level) {
      $('build-menu').hidden = level !== 'surface' || !state.buildMenuOpen;
      const filter = buildFilter(state);
      for (const card of buildOptions.children) {
        const option = card.querySelector('.build-option'), type = card.dataset.buildingCard;
        const definition = BuildingData.get(type);
        const price = root.OrbitConstruction.costFor(type) || {};
        const unique = (definition?.placementRules?.uniquePerPlanet || definition?.placementRules?.uniqueInGame) &&
          (state.surfaceBuildings || []).some(building => building.type === definition.id &&
            (definition.placementRules.uniqueInGame || building.planetId === state.planet?.id));
        // Buildings appear as the colony needs them, in their group.
        card.hidden = !root.OrbitProgression.buildingUnlocked(state, type) || (filter !== 'all' && groupOf(definition)?.id !== filter);
        // A world without colony takes only a colony or labs (skill "Atterrisseur").
        const blocked = state.planet ? root.OrbitProgression.buildBlockedHere(state, type, state.planet) : null;
        option.disabled = unique || Boolean(blocked) || !Inventory.canAfford(state.inventory, price);
        // Prices are masked for now: only why it can't be placed shows.
        const note = option.querySelector('.build-option-note');
        const noteText = unique ? 'Déjà posée' : blocked ? 'Hors colonie'
          : root.OrbitConstruction.pricesEnabled() ? resourceSummary(price) : '';
        if (note.textContent !== noteText) note.textContent = noteText;
        note.hidden = !noteText;
        option.title = unique ? 'Un seul exemplaire possible.' : blocked || '';
      }
      renderBuildMenuTabs(state, filter);
      renderBuildInfo(state);
      $('build-menu-title').textContent = 'CONSTRUCTION';
      // On a world without colony, say what may be built there.
      const settled = (state.surfaceBuildings || []).some(building => building.type === 'colony' && building.planetId === state.planet?.id);
      const anyColony = (state.surfaceBuildings || []).some(building => building.type === 'colony');
      $('build-menu-hint').hidden = !(level === 'surface' && anyColony && !settled);
      $('build-menu-hint').textContent = root.OrbitProgression.buildBlockedHere(state, 'factory', state.planet) || '';
    }

    // The build menu's filter: all, one group, or the buildings the player
    // saved (state.library), placed again with their name and cards.
    const savedBuildings = state => (state.library?.buildings || []).filter(item => BuildingData.processTypes.includes(item.type));
    function buildFilter(state) {
      const wanted = state.buildMenuTab || 'all';
      if (wanted === 'saved') return savedBuildings(state).length ? 'saved' : 'all';
      return BuildingData.menuGroups.some(group => group.id === wanted) ? wanted : 'all';
    }
    let filterSignature = null, savedSignature = null;
    function renderBuildMenuTabs(state, filter) {
      const saved = savedBuildings(state);
      // Only the groups holding an available building, and "saved" once
      // something is saved.
      const groups = BuildingData.menuGroups.filter(group => BuildingData.catalog()
        .some(definition => group.categories.includes(definition.category) && root.OrbitProgression.buildingUnlocked(state, definition.id)));
      const chips = [{ id: 'all', label: 'TOUT' }, ...groups, ...(saved.length ? [{ id: 'saved', label: `ENREGISTRÉS ${saved.length}` }] : [])];
      const signature = JSON.stringify([chips.map(chip => chip.label), filter]);
      if (signature !== filterSignature) {
        filterSignature = signature;
        $('build-filters').replaceChildren(...chips.map(chip => {
          const button = document.createElement('button');
          button.type = 'button'; button.dataset.buildFilter = chip.id; button.textContent = chip.label;
          button.setAttribute('role', 'tab'); button.setAttribute('aria-selected', String(chip.id === filter));
          button.classList.toggle('active', chip.id === filter);
          return button;
        }));
      }
      const info = Boolean(state.buildInfoType);
      $('build-filters').hidden = info;
      $('build-options').hidden = info || filter === 'saved';
      $('saved-buildings').hidden = info || filter !== 'saved';
      const available = saved.map(item => root.OrbitProgression.buildingUnlocked(state, item.type));
      const savedNow = JSON.stringify([saved.map(item => [item.id, item.name]), available]);
      if (savedNow === savedSignature) return;
      savedSignature = savedNow;
      $('saved-buildings').replaceChildren(...saved.map((item, index) => {
        const definition = BuildingData.get(item.type);
        const entry = document.createElement('div'); entry.className = 'build-card saved-building';
        const button = document.createElement('button');
        button.type = 'button'; button.className = 'build-option'; button.dataset.savedBuildingId = item.id;
        button.disabled = !available[index] || !definition;
        const icon = document.createElement('canvas'); icon.className = 'build-option-badge'; icon.width = icon.height = 72;
        icon.setAttribute('aria-hidden', 'true');
        if (definition) root.OrbitBuildingRenderer?.drawBadge(icon, definition.id);
        const name = document.createElement('strong'); name.textContent = item.name;
        const cards = item.plan.machines.length;
        const note = document.createElement('small'); note.className = 'build-option-note';
        note.textContent = available[index] ? `${cards} carte${cards > 1 ? 's' : ''}` : 'Indisponible';
        button.append(icon, name, note);
        const remove = document.createElement('button');
        remove.type = 'button'; remove.className = 'saved-building-remove'; remove.dataset.deleteSavedBuilding = item.id;
        remove.setAttribute('aria-label', `Retirer ${item.name} des bâtiments enregistrés`); remove.textContent = '×';
        entry.append(button, remove);
        return entry;
      }));
    }

    // How a building works, opened by its "i": what it does, where it goes,
    // what it needs, and a button to place it.
    let infoShown = null;
    function placementText(definition) {
      const rules = definition.placementRules || {};
      if (rules.deepWaterOnly) return 'En mer profonde';
      if (rules.coastRequired) return 'Sur la côte, face à la mer';
      if (rules.shoreRequired) return `À moins de ${rules.shoreReach || 30} km d’une eau`;
      return 'Sur la terre ferme';
    }
    function powerText(definition) {
      if (definition.generatorMW) return `+${fmt(definition.generatorMW)} MW`;
      if (definition.id === 'wind_turbine') return `≈ ${fmt(root.OrbitProcessData?.config.windPowerMW || 0)} MW, selon le site et les voisines`;
      if (definition.id === 'lab') return 'Autonome';
      if (BuildingData.processTypes.includes(definition.id)) return 'Selon ses cartes';
      return '';
    }
    function renderBuildInfo(state) {
      const type = state.buildMenuOpen ? state.buildInfoType : null;
      const definition = type ? BuildingData.get(type) : null;
      $('build-info').hidden = !definition;
      if (!definition) { infoShown = null; return; }
      const option = buildOptions.querySelector(`[data-building-type="${type}"]`);
      $('build-info-place').disabled = !option || option.disabled;
      $('build-info-place').textContent = option?.disabled ? (option.querySelector('.build-option-note').textContent || 'INDISPONIBLE').toUpperCase() : 'CONSTRUIRE';
      if (infoShown === type) return;
      infoShown = type;
      root.OrbitPanelKit?.badge($('build-info-icon'), type);
      $('build-info-name').textContent = nameCase(definition.label);
      $('build-info-group').textContent = groupOf(definition)?.label || 'COLONIE';
      $('build-info-details').textContent = definition.details || definition.description;
      const facts = [['Emplacement', placementText(definition)],
        ['Route', definition.roadRequired ? 'À relier par route' : 'Par voie maritime'],
        ['Énergie', powerText(definition)],
        ['Limite', definition.placementRules?.uniquePerPlanet ? 'Une par planète' : ''],
        ['Chantier', Object.entries(definition.constructionNeeds || {})
          .map(([id, amount]) => `${fmt(amount)} ${ResourceData.get(id)?.label || id}`).join(' · ')]];
      $('build-info-facts').replaceChildren(...facts.filter(([, value]) => value).flatMap(([label, value]) => {
        const term = document.createElement('dt'); term.textContent = label;
        const detail = document.createElement('dd'); detail.textContent = value;
        return [term, detail];
      }));
      $('build-menu').scrollTop = 0;
    }

    return Object.freeze({ update });
  }

  root.OrbitBuildMenu = Object.freeze({ create });
})(globalThis);
