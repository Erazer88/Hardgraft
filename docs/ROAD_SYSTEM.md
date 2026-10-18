# Routes de surface et quartiers décoratifs

Cette référence décrit les routes constructibles et les quartiers résidentiels.
Sur `codex/planet-globe-3d-experiment`, l'ancien descriptif du rendu 2D est
historique : la surface est désormais une sphère, et ses routes sont dessinées par
la couche projetée du globe. La seule interaction économique actuelle vérifie
qu’un chemin terrestre terminé relie un Dock à une Plateforme de lancement. Les
routes n’imposent aucun débit ni temps de trajet terrestre. Pour le modèle
logistique, voir [`CURRENT_CONTEXT.md`](CURRENT_CONTEXT.md).

## Modules

| Fichier | Responsabilité |
| --- | --- |
| `src/data/roads.js` | Coûts, vitesses et paramètres visuels |
| `src/data/settlements.js` | Croissance et présentation des quartiers |
| `src/simulation/roadNetwork.js` | Nœuds, segments, connexions, croisements, restauration |
| `src/simulation/roadCostField.js` | Coût déterministe du terrain, des obstacles et des routes |
| `src/simulation/roadPathfinder.js` | Recherche A* pondérée |
| `src/simulation/roadGeometry.js` | Simplification, spline et validation du relief |
| `src/simulation/roadConstruction.js` | Progression des travaux et dépendances entre segments |
| `src/simulation/settlements.js` | Génération déterministe de rues et d'habitations décoratives |
| `src/gameplay/roadPlacement.js` | Raccordement des extrémités, création et recalcul des itinéraires |
| `src/rendering/planetGlobeOverlayRenderer.js` | Projection des routes, gisements, icônes et repères de districts |

## Routes constructibles

Le réseau manuel est sauvegardé par planète. Les segments enregistrent leur
géométrie, leur classe terre/mer et la distance déjà construite. La simulation
fait progresser les travaux ; le renderer n'affiche que la portion terminée.
Les intersections terrestres sont détectées sur la géométrie réelle, puis le
segment est découpé et rattaché au nouveau nœud. Les routes maritimes relient les
ports de surface aux plateformes pétrolières, restent isolées en mer et partagent
les points d'amarrage des ports.

Pour les exports orbitaux, `src/simulation/logisticsNetwork.js` parcourt uniquement
les segments terrestres dont `builtLength` atteint `length`. Le stock dédié `dockStock`
est transféré instantanément vers la plateforme de la même planète. Les segments en
construction et les liaisons maritimes ne connectent pas ces stocks ; les routes ne
consomment ni ressources de construction ni autres inventaires.

Le placement construit un champ de coût déterministe à partir du relief, des
obstacles et des routes existantes. A* choisit un trajet ; la géométrie est ensuite
simplifiée, lissée et validée contre le terrain. Le calcul appartient aux modules
`simulation/` et `gameplay/` ; le rendu lit les points calculés et ne choisit pas
les itinéraires.

## Quartiers résidentiels

Les quartiers décoratifs se développent autour des bâtiments de production
raccordés. La simulation conserve leurs centres, rues, collectrices, maisons et
identifiants d'assets. Elle peut prolonger les rues et fermer des boucles lorsque
le relief et la place disponible le permettent. Ces données restent sauvegardées.
Sur cette branche, le globe affiche un repère discret par district ; les anciennes
maisons et rues en sprites ne sont plus dessinées. Cette croissance ne simule pas
de population et reste séparée du réseau manuel.

L'ordre visuel actuel est : sphère et relief WebGL2, grille cartographique,
gisements, routes, repères de districts, bâtiments sous forme d'icônes et aperçu de
placement. La conversion terrain/sphère est centralisée dans
`src/rendering/planetGlobeProjection.js`.

## Vérifications

- Croissance : `node --test tests/settlement-growth.test.cjs`.
- Projection et visibilité des icônes : `node --test tests/planet-globe.test.cjs`.
- Comportement intégré et sauvegardes : `node --test tests/architecture.test.cjs`.
- Interaction souris/tactile : `node tests/browser-smoke.cjs`.
