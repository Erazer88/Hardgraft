# Contexte courant

Résumé des décisions actives et des points d'entrée du prototype. Les détails d'un
système restent dans sa documentation spécialisée ; les anciens plans de
`docs/reference/` sont des archives et ne définissent pas l'implémentation actuelle.

## Architecture

- Prototype web sans framework. `index.html` charge des scripts IIFE exposés via
  `globalThis`; garder cet ordre et la compatibilité avec `build.py`.
- `src/data/` contient les réglages, `src/world/` la génération, `src/simulation/`
  les modèles, `src/gameplay/` leur raccordement, `src/ui/` les interactions,
  `src/rendering/` le dessin et `src/app.js` l'initialisation. Voir
  [`ARCHITECTURE.md`](ARCHITECTURE.md).
- La génération est déterministe par graine. Préserver navigation, sauvegardes et
  compatibilité mobile/desktop lors des changements.

## Décisions actives

### Monde et rendu

- Carte planétaire au style néon (Canvas 2D) : strates d'altitude teintées et ombrées
  comme du papier empilé, lignes d'altitude, rivières, lacs, marais, côtes lumineuses,
  grille de latitude. L'ancien rendu réaliste (biomes, textures, WebGL) et l'ancien
  système de maisons et quartiers décoratifs sont supprimés. Réglages :
  `src/data/surfaceStyle.js`.
- Continents et îles d'abord, puis `terrain.elevation` (hauteur canonique) et
  l'hydrologie. Lacs et criques sont de l'eau pour le gameplay ; les rivières ne
  bloquent rien. Voir [`WORLDGEN.md`](WORLDGEN.md).
- Plus de gisements : chaque zone du sol a sa composition (roche + fer, cuivre, silice,
  carbone ; pétrole en mer), en veines ramifiées. La carte de teneur sera plus tard
  révélée par un scan ; ratios et rendements restent à calibrer.
- Les bâtiments sont des balises hexagonales dont la taille suit le zoom (bornée), avec
  leur nom au-dessus. Noms par défaut « Usine 1 », « Usine 2 »… numérotés par type sur
  toute la galaxie, modifiables dans l'inspecteur ou le menu de la colonie.

### Colonie et progression

- La Colonie est le premier bâtiment, unique et indestructible, générateur 12 MW.
  Population 100 → 200 → 400 → 800 par paliers : 1 000 roches brutes, puis
  150 goudrons, puis 25 plaques. Dès le palier 2, les ressources des paliers
  précédents sont exigées en flux (roche 500/min, goudron 50/min). Contexte : 1/min.
  Zone néon qui grandit avec ce qu'elle consomme ; on n'y construit pas.
- Les bâtiments et cartes apparaissent selon les besoins de la colonie ; le réglage
  développeur « Tout débloquer » montre tout.
- Un clic sur la colonie ouvre son menu (stats, flux en moyenne glissante sur 30 s,
  rafraîchi toutes les 5 s, unités u/ku/Mu…). Voir [`COLONY.md`](COLONY.md).

### Industrie

- Graphe de cartes par bâtiment, cycles et buffers entiers. Chaque carte appartient à
  son bâtiment : l'Extracteur fore (une seule Foreuse, 6 u/s), concasse et broie ;
  l'Usine sépare, réduit, fabrique goudron et plaques. Pour forer plus, poser plusieurs
  extracteurs côte à côte.
- La roche reste une seule ressource à chaque étape ; chaque stock garde une
  composition moyenne et les séparateurs tirent leur matériau selon la teneur
  (récupération 90 %).
- Docks, Quais, Portes de dépôt et trieurs logiques n'ont pas de limite de débit. Un
  Dock de sortie sans destination n'absorbe rien (« SANS DESTINATION ») et bloque
  l'amont.
- Bâtiments spécialisés : Station de pompage, Dépôt répartiteur, Terril (retraitement
  ou incinération productrice d'énergie), Plateforme de lancement. Pas de pollution.
- Énergie limitée (colonie 12 MW, éolienne 32 MW). Deux équipes de robots, 2 s de
  construction par bâtiment. Prix masqués (`pricesEnabled: false`).
  Voir [`PROCESS_SYSTEM.md`](PROCESS_SYSTEM.md).

### Routes et logistique

- Routes manuelles qui suivent le relief (vallées, lacets, ponts sur les rivières et
  sur les détroits étroits), affichées en filament néon. Voies maritimes entre ports
  et plateformes. Démolir un bâtiment retire ses routes propres.
- Le Dock envoie vers la Colonie, une usine ou un terril avec Quai d'entrée, un dépôt
  avec Porte d'entrée ou une Plateforme de lancement, si un chemin construit les relie
  (routes et voies maritimes via les ports). Transfert instantané, sans capacité de
  route ; des impulsions lumineuses purement informatives montrent les liaisons
  actives. Voir [`ROAD_SYSTEM.md`](ROAD_SYSTEM.md) et
  [`ORBITAL_LOGISTICS.md`](ORBITAL_LOGISTICS.md).

### Sauvegardes

- `saveVersion` 10 ; une sauvegarde plus ancienne démarre une nouvelle partie.

## Questions ouvertes

Proposées au joueur, non décidées — ne pas implémenter sans demande :

- passer les séparateurs gravitaire et de carbone à 6 u/s comme le magnétique ;
- flux exigés par la colonie après le dernier palier ;
- traitement des déchets par type (incinération réservée aux combustibles, laitier →
  ciment, résidus → granulats, saumure → sel, terril visible).

## Points d'entrée et vérification

| Sujet | Code de départ | Vérification ciblée |
| --- | --- | --- |
| Monde et graine | `src/world.js`, `src/data/worldgen.js` | `node --test src/world.test.cjs` |
| Caméra et navigation | `src/navigation/camera.js`, `src/app.js`, `src/state.js` | `node --test tests/architecture.test.cjs` |
| Processus industriels | `src/simulation/processGraph.js`, `src/simulation/processSimulation.js` | `node --test tests/process-simulation.test.cjs` |
| Colonie et déblocage | `src/simulation/colony.js`, `src/gameplay/progression.js`, `src/gameplay/colonyZone.js` | `node --test tests/orbital-logistics.test.cjs` |
| Routes | `src/simulation/roadNetwork.js`, `src/gameplay/roadPlacement.js` | `node --test tests/architecture.test.cjs` |
| Logistique | `src/simulation/logisticsNetwork.js`, `src/gameplay/logistics.js` | `node --test tests/orbital-logistics.test.cjs` |
| Sauvegardes | `src/storage/save.js`, `src/state.js` | `node --test tests/architecture.test.cjs` |
| Export autonome | `build.py`, `index.html` | `python3 build.py` |

Pour une livraison complète, `npm test` lance la suite ; les tests navigateur sont
nécessaires lorsque la navigation, les gestes ou l'interface changent.
