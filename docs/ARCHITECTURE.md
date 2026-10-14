# Architecture du prototype de navigation

Cette note décrit les modules chargés par `index.html`. Le prototype garde la génération procédurale, le rendu Canvas, la navigation continue et l'exploration. Les bâtiments possèdent désormais des graphes industriels actifs, décrits dans `docs/PROCESS_SYSTEM.md`. La réserve de la colonie et les éoliennes utilisent actuellement les modes infinis demandés pour la V1 ; la logistique extérieure reste à implémenter.

| Module | Responsabilité |
| --- | --- |
| `src/data/config.js` | Graine par défaut, caméra, génération de terrain, sauvegardes |
| `src/data/resources.js` | Catalogue des ressources et stock initial de la colonie |
| `src/data/processes.js` | Catalogue des blocs, ports, recettes, compatibilité et réglages de V1 |
| `src/data/worldgen.js` | Paramètres des étoiles, systèmes, planètes et gisements naturels |
| `src/data/buildings.js` | Définitions déclaratives des bâtiments planétaires |
| `src/data/roads.js` | Pondérations de calcul et style de rendu des routes |
| `src/data/settlements.js` | Croissance, vitesse et style des rues et habitations décoratives |
| `src/data/surfaceStyle.js` | Contrat visuel de la carte planétaire et niveaux de détail |
| `assets/buildings/*.webp` | Sprites transparents des bâtiments planétaires |
| `assets/settlements/*.webp` | Maisons et modules transparents de villages et de villes |
| `assets/textures/*.webp` | Matières aériennes détaillées des plaines, montagnes et océans |
| `src/world.js` | Galaxies, positions orbitales et terrains procéduraux |
| `src/world/system.js` | Assemblage des systèmes et caractéristiques planétaires |
| `src/simulation/simulation.js` | Horloge orbitale |
| `src/simulation/inventory.js` | Stocks simples, vérification des coûts, consommation et ajout de ressources |
| `src/simulation/resourceStack.js` | Matières industrielles avec qualité, humidité, composition et origine |
| `src/simulation/processGraph.js` | Blocs, connexions, capacités, récupération et snapshots des graphes |
| `src/simulation/recipeResolver.js` | Résolution déterministe des recettes valides, dégradées, inutiles ou destructives |
| `src/simulation/processSimulation.js` | Cycles, consommation énergétique et transferts transactionnels au pas fixe |
| `src/simulation/buildings.js` | Modèle terrain des bâtiments planétaires |
| `src/simulation/construction.js` | Démarrage payant, avancement temporel et remboursement des constructions |
| `src/simulation/roadNetwork.js` | Nœuds, segments, intersections et distance déjà construite |
| `src/simulation/roadConstruction.js` | Progression temporelle des routes, indépendante du rendu |
| `src/simulation/roadCostField.js` | Coût déterministe du relief, des obstacles et des routes existantes |
| `src/simulation/roadPathfinder.js` | Recherche A* pondérée avec vallée, pente, lacets et mutualisation |
| `src/simulation/roadGeometry.js` | Simplification, spline Catmull–Rom et validation du relief |
| `src/simulation/settlements.js` | Génération déterministe de quartiers, rues secondaires et habitations décoratives |
| `src/gameplay/buildingPlacement.js` | Validation spatiale du placement sur la surface |
| `src/gameplay/roadPlacement.js` | Raccord automatique, création et recalcul d'itinéraires |
| `src/gameplay/exploration.js` | Missions de sonde et découverte des systèmes |
| `src/gameplay/industry.js` | Raccord des graphes aux gisements, stocks et puissance planétaire |
| `src/state.js` | État de navigation, session et inventaire |
| `src/storage/save.js` | Sauvegarde locale de l'exploration, de l'inventaire, des bâtiments, du réseau et de la vue |
| `src/navigation/camera.js` | Projections, repères locaux, zoom et caméra de surface |
| `src/rendering/renderer.js` | Orchestration du rendu de galaxie, des systèmes et des couches planétaires |
| `src/rendering/surfaceRenderer.js` | Matières procédurales, éclairage du relief, sélection et labels planétaires |
| `src/rendering/surfaceMaterialRenderer.js` | Échantillonnage WebGL2 continu des textures de biome, lié aux coordonnées du terrain avec filtrage stochastique |
| `src/rendering/roadRenderer.js` | Traits terrestres, points maritimes et points d'intersection |
| `src/rendering/settlementRenderer.js` | Rues secondaires et sprites de lotissements planétaires |
| `src/rendering/buildingRenderer.js` | Empreintes, aperçus, ancres et cartes des bâtiments |
| `src/rendering/vehicleRenderer.js` | Couche visuelle des véhicules, en attente de la logistique |
| `src/ui/hud.js` | Sélection, télémétrie, menus et échelle |
| `src/ui/factoryEditor.js` | Placement, connexion, configuration et lecture des processus actifs |
| `src/app.js` | Gestes, navigation, boucle de rendu et raccord entre modules |

`index.html` fixe l'ordre de chargement. `build.py` intègre ces mêmes scripts et `styles.css` dans les exports autonomes du dossier `dist/`. Le rendu de surface détaillé utilise WebGL2 pour rééchantillonner les matières à chaque image pendant le déplacement ; Canvas reste responsable du relief, des contours et des calques interactifs, et le terrain intégré sert de repli si WebGL2 est indisponible.

Les quartiers résidentiels sont générés de façon déterministe autour des bâtiments de production raccordés. Chaque quartier conserve son centre, son producteur, ses voies et sa route collectrice. Les routes secondaires enregistrent leurs nœuds de départ et d'arrivée ainsi que leur rattachement à un axe principal ou à une rue du quartier. Les collectrices relient l'axe au centre du quartier ; les rues locales prolongent ce réseau, et des rues de liaison ferment des boucles quand le relief et la place disponible le permettent. La recherche A* réutilise les coûts de pente, de vallée, d'obstacles et de routes existantes.

Les maisons sont posées en façades le long des rues, en alternant les côtés et en écartant les bâtiments qui se chevaucheraient, tomberaient dans l'eau ou bloqueraient un bâtiment de production. Chaque quartier devient plus dense quand son réseau et son nombre d'habitations augmentent. Les modèles WebP de village et de ville sont choisis d'après la forme du graphe : alignement, carrefour en T ou croisement. Les trois modèles de maisons et les six modules de rues sont référencés par le générateur ; leurs identifiants compacts et les nœuds de quartier sont conservés dans la sauvegarde.

Le rendu de surface suit un ordre stable : terrain, gisements, routes, bâtiments physiques, véhicules, ancres et cartes de bâtiments, sélection, labels. Un bâtiment routier posé rejoint l'axe accessible le plus proche. Si un autre axe est suffisamment éloigné et part dans une direction distincte, une branche secondaire repart de l'axe principal à une distance configurée du port du bâtiment. Son nœud de jonction est donc sur la route, pas contre le bâtiment. La branche attend que le tronçon de sortie atteigne ce nœud avant de commencer sa construction. La hauteur du terrain alimente un cost-field déterministe, puis A* cherche chaque route en tenant compte des vallées, des pentes, des obstacles, des lacets et des routes existantes. La recherche favorise davantage les vallées et les versants doux pour épouser le relief ; la pénalité de virage reste faible pour laisser la route prendre des courbes naturelles. Un surcoût non linéaire pénalise les montées raides, tandis que la pénalité de virage diminue sur ces pentes afin de permettre des lacets. Le tracé brut passe par Ramer–Douglas–Peucker, une spline Catmull–Rom et une validation dense avant d'être enregistré. La courbe peut s'écarter légèrement du chemin A* tout en restant validée contre le terrain. Au raccord, les croisements réels sont détectés en priorité ; les approches proches peuvent rejoindre une route existante dans une tolérance configurée. Une route neuve stocke la distance construite depuis son origine ; la simulation l'allonge selon sa classe et le rendu n'affiche que cette portion. Cette progression et les dépendances de construction sont sauvegardées avec le réseau. Les vitesses de l'axe principal et des routes secondaires sont configurées séparément. La classe terre/mer de chaque tronçon est aussi enregistrée avec sa géométrie : la boucle de rendu ne lit que le chemin précalculé. Les routes sauvegardées sont conservées par planète.

Les définitions de bâtiments décrivent coûts, durées, remboursements, empreintes et ports en coordonnées monde de la surface. `OrbitSurfaceBuilding.create()` produit une instance ancrée par `planetId`, `x` et `y`; les extracteurs conservent l'identifiant et l'abondance du gisement compatible. `OrbitBuildingPlacement.validate()` vérifie terrain et chevauchements. `OrbitConstruction.start()` applique les coûts déclarés, selon les modes de réserve, puis `advance()` fait progresser l'assemblage sans Canvas. La démolition rembourse la construction, récupère les matières industrielles et détache les nœuds routiers.

`state.factoryPlans[buildingId]` contient le graphe industriel faisant autorité, avec disposition, réglages, buffers et cycles. L'éditeur partage cette instance avec la simulation et ne calcule aucune production. `OrbitIndustry.advance()` alimente un pas fixe et répartit la puissance par planète ; les blocs fonctionnent également lorsque leur éditeur est fermé. Une éolienne terminée active le mode de puissance illimitée pour cette V1. Le stock d'entrée et le stock extérieur des quais restent distincts pour éviter une boucle automatique d'import/export. Les matières de la colonie récupérées après démolition conservent leurs métadonnées dans `state.colonyMaterials`.

## État conservé

La sauvegarde contient la graine, l'exploration, l'horloge, les inventaires, bâtiments, réseaux, quartiers et position de navigation. Le format 9 conserve aussi les graphes industriels, leurs stocks, signatures géologiques, cycles en cours et restes de pas fixe. Les champs temporaires de débit et d'affichage sont recalculés. Les anciens formats 2 à 8 et les anciens blocs génériques sont migrés ; les systèmes et terrains restent régénérés depuis la graine.

Les foreuses et pompes des bâtiments associés aux gisements alimentent désormais les chaînes internes. La composition, la dureté et le débit proviennent de paramètres déterministes ; le placement des blocs internes n'affecte jamais leur performance.
