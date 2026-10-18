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
| `src/rendering/` | Dessin Canvas/WebGL et orchestration des couches visuelles |
| `src/ui/` | HUD, vues interactives et outils développeur |
| `src/app.js` | Initialisation, état partagé, événements globaux, boucle et raccord entre modules |

Points d'entrée spécialisés :

- `docs/PROCESS_SYSTEM.md` décrit le graphe industriel et son moteur.
- `docs/ROAD_SYSTEM.md` décrit les routes constructibles et les quartiers décoratifs.
- `docs/ORBITAL_LOGISTICS.md` décrit le transfert Dock → plateforme et le transit vers l’Arche.
- `docs/WORLDGEN.md` décrit les paramètres de génération.
- `docs/PLANET_GLOBE.md` décrit la projection sphérique et la surface WebGL2 de cette branche.

Les fichiers importants comprennent `src/data/processes.js`,
`src/simulation/processGraph.js` et `processSimulation.js`,
`src/gameplay/industry.js`, `src/navigation/camera.js`,
`src/rendering/renderer.js`, `src/rendering/planetGlobeProjection.js`,
`src/rendering/planetGlobeMesh.js`, `src/rendering/planetGlobeRenderer.js`,
`src/rendering/planetGlobeOverlayRenderer.js`, `src/navigation/planetGlobeCamera.js`,
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

La surface ne partage plus le renderer Canvas 2D de la carte système. `renderer.js`
dessine toujours galaxie et systèmes en Canvas2D puis délègue la surface sphérique
au renderer WebGL2 natif ; `planetGlobeOverlayRenderer.js` projette les icônes,
routes, gisements et grille. `planetGlobeProjection.js` centralise coordonnées
terrain ↔ sphère, relief, raycast et projection. WebGL2 est requis pour la surface.

## Modules denses et limites de refactorisation

- `src/app.js` centralise encore l'état partagé, les gestes, la navigation, les
  placements et la boucle. Les algorithmes de placement de bâtiments, de routes et
  de processus ont déjà des modules séparés. Les gestionnaires d'interaction restants
  partagent beaucoup d'état ; une extraction demande d'abord un contrat d'état clair.
- `src/ui/factoryEditor.js` rend les cartes, ports et connexions. Les gestes de la vue
  industrielle sont isolés dans `src/ui/factoryViewport.js` ; le graphe et sa simulation
  restent indépendants du DOM.
- `src/app.js` garde encore la coordination des gestes de surface, la projection
  des actions de placement et la navigation. `planetGlobeCamera.js` isole l'état
  de rotation/zoom/transition ; l'extraction ultérieure d'un contrôleur d'entrée
  devra garder l'intégration avec les moteurs de placement explicite.
- `src/simulation/settlements.js` et `roadNetwork.js` sont volumineux mais portent
  chacun un modèle cohérent (croissance urbaine décorative, topologie et migration du
  réseau). Une extraction doit suivre une responsabilité modifiée, pas un seuil de lignes.

## Validation

- Tests unitaires et d'intégration : `npm test`.
- Processus : `node --test tests/process-simulation.test.cjs`.
- Éditeur et gestes desktop/tactile : `npm run test:factory-editor`.
- Globe pur : `node --test tests/planet-globe.test.cjs`.
- Smoke navigateur : `node tests/browser-smoke.cjs`, avec interactions Chromium
  desktop et tactile ; un serveur sur le port 8000 est requis.
- Export autonome : `python3 build.py` lors d'une livraison.

Ne lancez que la vérification pertinente pendant une itération. Le workflow complet
est décrit dans `AGENTS.md`.
