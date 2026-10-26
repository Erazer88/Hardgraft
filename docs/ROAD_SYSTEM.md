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
segment est découpé et rattaché au nouveau nœud. Les routes maritimes, tracées avec
l'outil route, relient un port de surface à une plateforme pétrolière ou à un autre
port ; elles restent isolées en mer et partagent les points d'amarrage des ports.

Une route maritime suit un couloir cohérent : seule l'eau est ouverte, l'eau proche
des côtes coûte plus cher (`marine.coastClearanceCells`, `marine.coastPenalty`), si
bien que le couloir prend le large et contourne caps et continents entiers si besoin
(`marine.maxExpandedStates` autorise ces longues recherches). Les emprises des autres
bâtiments sont évitées. Deux ports qui ne donnent pas sur la même étendue d'eau (un
lac fermé et la mer) sont refusés immédiatement. Les couloirs s'affichent en
pointillés lumineux.

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

### Suivre le terrain

- **Relief affiché.** Le champ de coût lit `terrain.relief` (le relief dessiné,
  avec canyons et rives de lacs), moyenné sur chaque cellule de routage ; l'eau
  reste décidée par `terrain.elevation`. La validation géométrique mesure aussi la
  pente sur ce relief.
- **Seize caps.** A* avance vers les huit voisins et en saut de cavalier : les
  routes prennent des angles de 26,6° et 63,4° et tournent progressivement. Le coût
  de virage est proportionnel à l'angle.
- **Pente et lacets.** Au-delà d'une pente confortable (`comfortableSlopePerHeightCell`),
  la pénalité croît fortement (`steepGradePenalty`) : sur un versant raide, il est
  moins cher de monter en biais, et les virages y coûtent peu
  (`switchbackTurnMultiplier`), ce qui plie la montée en lacets.
- **Dévers.** Traverser un flanc coûte selon la pente latérale (`crossSlopePenalty`,
  terrassements) : les routes préfèrent fonds de vallée et replats.
- **Rivières.** Les rivières dessinées (`bridgeMinFlow`) se franchissent par un pont,
  avec un coût d'entrée (`riverCrossing`) ; suivre leur lit coûte (`riverAlong`).
- **Recherche.** L'heuristique utilise le coût de cellule le plus bas du champ,
  pondérée par `search.heuristicWeight` pour rester rapide.

### Rendu « filament néon »

Le point de raccordement d'un bâtiment (`roadPort`, `waterPort`) reste la fin du
tracé calculé, mais il n'est plus dessiné : le rendu prolonge chaque route atteinte
jusqu'à l'angle de la balise hexagonale tourné vers elle. Vue de loin, les routes
s'affinent et leur halo s'atténue (`render.zoomWidth`).

Les routes terrestres sont un fil lumineux : deux passes de halo cyan
(`render.glowPasses`) sous un cœur blanc. Les chaussées sur l'eau peu profonde
gardent leurs points lumineux, les carrefours sont de petits losanges à contour
lumineux, et chaque franchissement de rivière porte deux rails de pont. Tous les
réglages sont dans `src/data/roads.js`.

## Quartiers résidentiels

Les quartiers décoratifs se développent autour des bâtiments de production
raccordés. La simulation conserve leurs centres, rues, collectrices, maisons et
identifiants d'assets. Elle peut prolonger les rues et fermer des boucles lorsque
le relief et la place disponible le permettent. Les trois modèles de maisons
alternent le long des rues ; six sprites de rues représentent les formes en ligne,
en T et en croix, en version village ou ville. Cette croissance ne simule pas de
population et reste séparée du réseau manuel.

L'ordre visuel de surface est : terrain et matériaux du sol, routes, bâtiments physiques,
véhicules, ancres et cartes des bâtiments, sélection, labels. `developerSettings.js`
permet de masquer routes et maisons pendant les ajustements visuels sans effacer
leurs données.

## Vérifications

- Croissance : `node --test tests/settlement-growth.test.cjs`.
- Rendu de quartiers : `node --test tests/settlement-renderer.test.cjs`.
- Comportement intégré, sauvegardes, navigation : `node --test tests/architecture.test.cjs`.
