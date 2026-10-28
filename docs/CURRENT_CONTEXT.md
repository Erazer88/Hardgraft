# Contexte courant

Résumé des décisions actives et des points d'entrée du prototype. Les détails d'un
système restent dans sa documentation spécialisée ; les anciens plans de
`docs/reference/` sont des archives et ne définissent pas l'implémentation actuelle.

## Architecture

- Prototype web sans framework. `index.html` charge des scripts IIFE exposés via
  `globalThis`; garder cet ordre et la compatibilité avec `build.py`.
- `src/data/` contient les réglages, `src/world/` la génération, `src/simulation/`
  les modèles, `src/gameplay/` leur raccordement, `src/ui/` les interactions,
  `src/rendering/` le dessin et `src/app.js` l'initialisation.
- La génération est déterministe par graine. Préserver navigation, sauvegardes et
  compatibilité mobile/desktop lors des changements.

## Décisions actives

- Les bâtiments et ressources appartiennent à la surface d'une planète. Les routes
  manuelles forment le réseau logistique terrestre. L'ancien système de maisons et de
  quartiers décoratifs est supprimé.
- La Colonie est le premier bâtiment, unique et indestructible. Elle abrite la
  population (100 au départ, par paliers), produit du contexte (1/min) et grandit en
  zone néon avec les ressources qu'on lui livre : roche brute, puis goudron, puis
  plaques de métal. Les bâtiments et les cartes apparaissent quand ses besoins les
  appellent. Voir [`COLONY.md`](COLONY.md).
- Les processus industriels sont simulés par cycles, buffers entiers, recettes,
  connexions explicites et débits configurés. Voir
  [`PROCESS_SYSTEM.md`](PROCESS_SYSTEM.md).
- Le modèle de transport cible agrège les transferts entre bâtiments. Actuellement,
  le Dock transfère vers la Colonie, une usine ou un terril avec Quai d'entrée, un dépôt avec
  Porte d'entrée ou une Plateforme de lancement lorsqu'une route construite les relie ;
  le dépôt répartit ce qu'il reçoit par ses Portes de sortie. Les routes n'ont pas de capacité ni de durée.
  Leur tracé suit le relief affiché (vallées, lacets sur les pentes, ponts sur les
  rivières) et elles s'affichent en filament néon.
  Voir [`ROAD_SYSTEM.md`](ROAD_SYSTEM.md) et
  [`ORBITAL_LOGISTICS.md`](ORBITAL_LOGISTICS.md).
- La carte planétaire utilise la couche visuelle néon issue de la branche
  `neon-style` : strates d'altitude teintées (plus claires vers les sommets) et ombrées
  comme du papier empilé, lignes d'altitude, rivières, lacs, marais, côtes lumineuses. L'ancien rendu réaliste
  (biomes, textures, WebGL) est supprimé. Réglages dans `src/data/surfaceStyle.js`.
- La génération de planète dessine d'abord continents et îles, puis en déduit
  `terrain.elevation`, qui reste la hauteur canonique, et l'hydrologie (rivières,
  lacs, marais, canyons, criques). Les lacs et criques sont de l'eau pour le
  gameplay ; les rivières ne bloquent rien. Sur les planètes telluriques et
  océaniques, les terres ne touchent jamais le bord de la carte. Voir
  [`WORLDGEN.md`](WORLDGEN.md).
- Plus de gisements ni de champ de pétrole : chaque zone du sol a sa composition
  (roche + fer, cuivre, silice, carbone ; pétrole en mer), plus concentrée selon le
  terrain, lissée sur quelques kilomètres. Les Extracteurs se posent librement et
  forent de la roche brute qui garde la composition moyenne de leur zone (24 km) ;
  chaque stock de roche garde une composition moyenne et les séparateurs en tirent leur
  matériau selon la teneur. Les minerais suivent des veines ramifiées issues de nœuds
  riches. La carte de teneur (isolignes et aplats colorés) sera plus tard révélée par
  un scan progressif ; les ratios et rendements restent à calibrer.
- Bâtiments spécialisés : Station de pompage (eau salée en mer, douce en lac ou
  rivière), Dépôt répartiteur, Terril (retraitement à faible rendement ou incinération
  productrice d'énergie, sans débordement ni pollution), Plateforme de lancement moins
  coûteuse en énergie près de l'équateur ; pas de pollution pour l'instant. Voir
  [`PROCESS_SYSTEM.md`](PROCESS_SYSTEM.md).
- Deux équipes de robots construisent ; énergie limitée (générateur de colonie 12 MW,
  éolienne 32 MW). Les prix des bâtiments et des cartes sont masqués
  (`pricesEnabled: false`) : rien n'est facturé ni affiché, il n'y a pas de stock de
  construction. La carte Réserve d'eau reste une source infinie temporaire.

## Points d'entrée et vérification

| Sujet | Code de départ | Vérification ciblée |
| --- | --- | --- |
| Monde et graine | `src/world.js`, `src/data/worldgen.js` | `node --test src/world.test.cjs` |
| Caméra et navigation | `src/navigation/camera.js`, `src/app.js`, `src/state.js` | `node --test tests/architecture.test.cjs` |
| Processus industriels | `src/simulation/processGraph.js`, `src/simulation/processSimulation.js` | `node --test tests/process-simulation.test.cjs` |
| Colonie et déblocage | `src/simulation/colony.js`, `src/gameplay/progression.js`, `src/gameplay/colonyZone.js` | `node --test tests/orbital-logistics.test.cjs` |
| Routes | `src/simulation/roadNetwork.js`, `src/gameplay/roadPlacement.js` | `node --test tests/architecture.test.cjs` |
| Sauvegardes | `src/storage/save.js`, `src/state.js` | `node --test tests/architecture.test.cjs` |
| Export autonome | `build.py`, `index.html` | `python3 build.py` |

Pour une livraison complète, `npm test` lance la suite ; les tests navigateur sont
nécessaires lorsque la navigation, les gestes ou l'interface changent.
