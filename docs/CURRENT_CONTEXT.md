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
  manuelles forment le réseau logistique terrestre ; les quartiers décoratifs et
  leurs rues restent visuels et indépendants.
- Les processus industriels sont simulés par cycles, buffers entiers, recettes,
  connexions explicites et débits configurés. Voir
  [`PROCESS_SYSTEM.md`](PROCESS_SYSTEM.md).
- Le modèle de transport cible agrège les transferts entre bâtiments. Actuellement,
  le Dock transfère vers une usine avec Quai d'entrée ou une Plateforme de lancement
  lorsqu'une route construite les relie. Les routes n'ont pas de capacité ni de durée.
  Voir [`ROAD_SYSTEM.md`](ROAD_SYSTEM.md) et
  [`ORBITAL_LOGISTICS.md`](ORBITAL_LOGISTICS.md).
- La génération de planète conserve `terrain.elevation` comme hauteur canonique et
  utilise des champs géologiques supplémentaires pour le rendu. Voir
  [`WORLDGEN.md`](WORLDGEN.md).
- Le prototype garde encore des modes de test : réserve de colonie infinie et énergie
  illimitée par éolienne terminée. Ne pas les prendre pour les règles économiques
  finales ; leurs réglages se trouvent dans `src/data/processes.js`.

## Points d'entrée et vérification

| Sujet | Code de départ | Vérification ciblée |
| --- | --- | --- |
| Monde et graine | `src/world.js`, `src/data/worldgen.js` | `node --test src/world.test.cjs` |
| Caméra et navigation | `src/navigation/camera.js`, `src/app.js`, `src/state.js` | `node --test tests/architecture.test.cjs` |
| Processus industriels | `src/simulation/processGraph.js`, `src/simulation/processSimulation.js` | `node --test tests/process-simulation.test.cjs` |
| Routes et quartiers | `src/simulation/roadNetwork.js`, `src/simulation/settlements.js` | `node --test tests/settlement-growth.test.cjs tests/settlement-renderer.test.cjs` |
| Sauvegardes | `src/storage/save.js`, `src/state.js` | `node --test tests/architecture.test.cjs` |
| Export autonome | `build.py`, `index.html` | `python3 build.py` |

Pour une livraison complète, `npm test` lance la suite ; les tests navigateur sont
nécessaires lorsque la navigation, les gestes ou l'interface changent.
