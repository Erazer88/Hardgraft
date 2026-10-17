# Routes de surface et quartiers décoratifs

Cette référence décrit les routes actuellement constructibles et les rues
résidentielles décoratives. La seule interaction économique actuelle vérifie qu’un
chemin terrestre terminé relie un Dock à une Plateforme de lancement. Les routes
n’imposent aucun débit ni temps de trajet terrestre. Pour le modèle logistique, voir
[`CURRENT_CONTEXT.md`](CURRENT_CONTEXT.md).

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
| `src/rendering/roadRenderer.js` | Affichage des routes, connexions maritimes et intersections |
| `src/rendering/settlementRenderer.js` | Affichage des rues secondaires et sprites de quartiers |

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
le relief et la place disponible le permettent. Les trois modèles de maisons
alternent le long des rues ; six sprites de rues représentent les formes en ligne,
en T et en croix, en version village ou ville. Cette croissance ne simule pas de
population et reste séparée du réseau manuel.

L'ordre visuel de surface est : terrain, gisements, routes, bâtiments physiques,
véhicules, ancres et cartes des bâtiments, sélection, labels. `developerSettings.js`
permet de masquer routes et maisons pendant les ajustements visuels sans effacer
leurs données.

## Vérifications

- Croissance : `node --test tests/settlement-growth.test.cjs`.
- Rendu de quartiers : `node --test tests/settlement-renderer.test.cjs`.
- Comportement intégré, sauvegardes, navigation : `node --test tests/architecture.test.cjs`.
