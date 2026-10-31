(function (root) {
  'use strict';

  // The skill tree menu: a map of nodes over the fog. Known skills show as
  // nodes (acquired, available or locked), the rest as silhouettes. Touching
  // an available skill acquires it; the panel below describes the one chosen.
  const Data = root.OrbitSkillData;
  const SVG = 'http://www.w3.org/2000/svg';
  const fmt = value => new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 }).format(Math.floor(value || 0));

  function create(document, { onUnlock = () => false, onClose = () => {} } = {}) {
    const $ = id => document.getElementById(id);
    const panel = $('skill-tree'), links = $('skill-tree-links'), nodes = $('skill-tree-nodes'), detail = $('skill-tree-detail');
    const Skills = root.OrbitSkills;
    let chosenId = Data.skills[0]?.id || null, signature = null, lastState = null;

    // Acquired, available, reachable but not yet paid for ("short"), or locked.
    const stateOf = (state, skill) => Skills.isUnlocked(state, skill.id) ? 'acquired'
      : Skills.canUnlock(state, skill.id) ? 'available' : Skills.reachable(state, skill.id) ? 'short' : 'locked';

    function line(from, to, className) {
      const path = document.createElementNS(SVG, 'line');
      path.setAttribute('x1', from.x * 100); path.setAttribute('y1', from.y * 100);
      path.setAttribute('x2', to.x * 100); path.setAttribute('y2', to.y * 100);
      path.setAttribute('class', className);
      links.append(path);
    }

    function render(state) {
      lastState = state;
      const next = JSON.stringify([state.skills?.unlocked || [], Math.floor(state.techPoints || 0), chosenId]);
      if (next === signature) return;
      signature = next;
      $('skill-tree-context').textContent = `POINTS TECH ${fmt(state.techPoints)}`;
      links.replaceChildren(); nodes.replaceChildren();
      // Silhouettes of what is still unknown.
      for (const shade of Data.fog) {
        const from = Data.get(shade.from);
        if (from) line(from, shade, 'skill-link fog');
        const node = document.createElement('span');
        node.className = 'skill-node fog'; node.textContent = '?';
        node.style.left = `${shade.x * 100}%`; node.style.top = `${shade.y * 100}%`;
        node.setAttribute('aria-hidden', 'true');
        nodes.append(node);
      }
      for (const skill of Data.skills) {
        for (const required of skill.requires) {
          const from = Data.get(required);
          if (from) line(from, skill, `skill-link ${Skills.isUnlocked(state, required) ? 'open' : ''}`);
        }
        const status = stateOf(state, skill);
        const node = document.createElement('button');
        node.type = 'button'; node.className = `skill-node ${status}${skill.id === chosenId ? ' chosen' : ''}`;
        node.dataset.skillId = skill.id;
        node.style.left = `${skill.x * 100}%`; node.style.top = `${skill.y * 100}%`;
        node.setAttribute('aria-label', `${skill.label} · ${{ acquired: 'acquise', available: 'à débloquer', short: 'points insuffisants', locked: 'verrouillée' }[status]}`);
        const mark = document.createElement('b'); mark.textContent = skill.mark;
        const label = document.createElement('span'); label.textContent = skill.label;
        node.append(mark, label);
        nodes.append(node);
      }
      renderDetail(state);
    }

    function renderDetail(state) {
      const skill = Data.get(chosenId);
      detail.replaceChildren();
      if (!skill) return;
      const status = stateOf(state, skill);
      const add = (tag, className, text) => {
        const element = document.createElement(tag);
        if (className) element.className = className;
        element.textContent = text;
        detail.append(element);
        return element;
      };
      add('span', 'skill-detail-kicker', { acquired: 'COMPÉTENCE ACQUISE', available: 'À DÉBLOQUER', short: 'POINTS INSUFFISANTS', locked: 'VERROUILLÉE' }[status]);
      add('strong', 'skill-detail-title', skill.label);
      add('p', '', skill.description);
      add('p', 'skill-detail-effect', skill.effect);
      const cost = Object.entries(skill.cost || {});
      add('small', 'skill-detail-cost', cost.length
        ? `COÛT · ${cost.map(([id, amount]) => `${id === 'tech' ? 'Points tech' : root.OrbitResourceData.get(id)?.label || id} ${fmt(amount)}`).join(' · ')}`
        : 'COÛT · aucun');
      if (status === 'available') add('small', 'skill-detail-hint', 'Touchez la compétence pour la débloquer.');
      if (status === 'short') add('small', 'skill-detail-hint', `Il manque ${fmt(Skills.missingPoints(state, skill.id))} points tech : le datacenter les produit.`);
      if (status === 'locked') add('small', 'skill-detail-hint', `Requiert : ${skill.requires.map(id => Data.get(id)?.label || id).join(', ')}.`);
    }

    nodes.addEventListener('click', event => {
      const node = event.target.closest('[data-skill-id]');
      if (!node || !lastState) return;
      chosenId = node.dataset.skillId;
      const acquired = Skills.canUnlock(lastState, chosenId) && onUnlock(chosenId) !== false;
      signature = null; render(lastState);
      // A short flash on the skill just acquired.
      if (acquired) nodes.querySelector(`[data-skill-id="${chosenId}"]`)?.classList.add('just-acquired');
    });

    function open(state) {
      panel.hidden = false;
      signature = null;
      render(state);
      $('skill-tree-close').focus({ preventScroll: true });
    }

    function close() {
      if (panel.hidden) return;
      panel.hidden = true;
      onClose();
    }

    function refresh(state) { if (!panel.hidden) render(state); }

    $('skill-tree-close').addEventListener('click', close);
    panel.addEventListener('keydown', event => { if (event.key === 'Escape') { event.stopPropagation(); close(); } });

    return Object.freeze({ open, close, refresh, isOpen: () => !panel.hidden });
  }

  root.OrbitSkillTree = Object.freeze({ create });
})(globalThis);
