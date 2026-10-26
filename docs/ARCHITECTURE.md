# Architecture du prototype

Cette page décrit l'architecture effectivement chargée par `index.html`.
Les décisions de conception actuelles, les systèmes temporaires et les lectures
minimales par tâche sont dans [`CURRENT_CONTEXT.md`](CURRENT_CONTEXT.md).

## Modules

| Zone | Responsabilité principale |
| --- | --- |
| `src/data/` | Configuration, ressources, recettes, bâtiments, logistique orbitale, génération et styles déclaratifs |
| `src/world.js`, `src/world/` | Génération déterministe des galaxies, systèmes et terrains |
| `src/simulation/` | Horloge, inventaires, constructions, graphes industriels, routes, connectivité logistique et transit orbital |
| `src/gameplay/` | Raccord des règles aux bâtiments, à l'exploration, aux exports orbitaux et aux interactions de placement |
| `src/navigation/` | Projection, caméra, zoom et transitions de repère |
| `src/storage/`, `src/state.js` | État de session et sauvegarde/restauration locale |
| `src/rendering/` | Dessin Canvas 2D et orchestration des couches visuelles |
| `src/ui/` | HUD, vues interactives et outils développeur |
| `src/app.js` | Initialisation, état partagé, événements globaux, boucle et raccord entre modules |

Points d'entrée spécialisés :

- `docs/PROCESS_SYSTEM.md` décrit le graphe industriel et son moteur.
- `docs/ROAD_SYSTEM.md` décrit les routes constructibles et les quartiers décoratifs.
- `docs/ORBITAL_LOGISTICS.md` décrit le transfert Dock → plateforme et le transit vers l’Arche.
- `docs/WORLDGEN.md` décrit les paramètres de génération.

Les fichiers importants comprennent `src/data/processes.js`,
`src/simulation/processGraph.js` et `processSimulation.js`,
`src/gameplay/industry.js`, `src/navigation/camera.js`,
`src/rendering/renderer.js`, `src/rendering/surfaceRenderer.js`,
`src/ui/factoryEditor.js`, `src/ui/factoryViewport.js` et `src/app.js`.

## Dépendances et chargement

Direction visée :

```text
data → simulation → gameplay
data + état → UI / rendu
app → initialise et orchestre
```

Les moteurs de simulation n'accèdent ni au DOM ni à Canvas. Le renderer lit l'état
et dessine ; l'UI édite l'état via les API de simulation, sans calculer elle-même
les productions. `app.js` relie ces modules mais reste un point de concentration
pour l'état partagé, les gestes, la navigation et la boucle. Ne pas extraire un
contrôleur sans une frontière d'état explicite et des tests ciblés.

Les IIFE publient leur API via `globalThis`. L'ordre de chargement est celui des
balises script dans `index.html`. `build.py` reprend ces balises et embarque les
scripts, CSS et ressources dans les exports de `dist/`. Cette simplicité est
volontaire pour le prototype ; aucune migration globale vers ESM ou npm n'est
prévue dans une tâche locale.

Le rendu de surface est entièrement Canvas 2D, au style néon (palette
`OrbitSurfaceStyle.neon`) : océan sombre quadrillé, strates d'altitude teintées et
ombrées avec lignes d'altitude, rivières, lacs et marais, carte de teneur des minerais, littoral lumineux, cuits dans une texture
à partir du terrain. Sur la surface active, côte, lignes d'altitude et rivières sont
retracées en vecteurs depuis ce même terrain pour rester nettes au zoom. Il n'y a ni
terrain haute résolution, ni worker, ni couche WebGL.

Les bâtiments ne sont pas dessinés : `buildingRenderer.js` les signale par des balises
de point d'intérêt de taille constante à l'écran (`OrbitSurfaceStyle.buildings.pin`),
une tête hexagonale portant l'icône du bâtiment, colorée selon sa catégorie, posée
sur une tige au-dessus d'un anneau lumineux qui marque l'emplacement exact. La
construction progresse en arc autour de la tête ; la sélection ajoute un hexagone
orange. L'aperçu de placement montre en plus l'emprise au sol. Le clic sur la tête
sélectionne le bâtiment. Pendant le placement d'une foreuse, et lorsqu'elle est
sélectionnée, son rayon de captage est tracé en pointillés et une étiquette sous
l'anneau donne les minerais qu'elle draine (texte préparé par `app.js`, qui garde
la mise en forme dans l'UI).

## Modules denses et limites de refactorisation

- `src/app.js` centralise encore l'état partagé, les gestes, la navigation, les
  placements et la boucle. Les algorithmes de placement de bâtiments, de routes et
  de processus ont déjà des modules séparés. Les gestionnaires d'interaction restants
  partagent beaucoup d'état ; une extraction demande d'abord un contrat d'état clair.
- `src/ui/factoryEditor.js` rend les cartes, ports et connexions. Les gestes de la vue
  industrielle sont isolés dans `src/ui/factoryViewport.js` ; le graphe et sa simulation
  restent indépendants du DOM.
- `src/rendering/surfaceRenderer.js` gère la texture néon, le trait de côte vectoriel
  et les couches de surface. Le tracé du littoral est le prochain candidat d'extraction
  s'il évolue indépendamment.
- `src/simulation/settlements.js` et `roadNetwork.js` sont volumineux mais portent
  chacun un modèle cohérent (croissance urbaine décorative, topologie et migration du
  réseau). Une extraction doit suivre une responsabilité modifiée, pas un seuil de lignes.

## Validation

- Tests unitaires et d'intégration : `npm test`.
- Processus : `node --test tests/process-simulation.test.cjs`.
- Éditeur et gestes desktop/tactile : `npm run test:factory-editor`.
- Smoke navigateur : `node tests/browser-smoke.cjs`, pertinent si l'application,
  la navigation ou l'UI changent ; Chromium et un serveur sur le port 8000 sont requis.
- Export autonome : `python3 build.py` lors d'une livraison.

Ne lancez que la vérification pertinente pendant une itération. Le workflow complet
est décrit dans `AGENTS.md`.
