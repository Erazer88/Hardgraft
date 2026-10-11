# Architecture du prototype de navigation

Cette note décrit les modules actuellement chargés par `index.html`. Le prototype garde la génération procédurale, le rendu Canvas, la navigation continue, l'exploration et la lecture des cartes de terrain. La construction de surface consomme désormais un stock initial et la démolition rembourse selon les données du bâtiment. L'extraction, la production et la logistique de ressources restent à implémenter.

| Module | Responsabilité |
| --- | --- |
| `src/data/config.js` | Graine par défaut, caméra, génération de terrain, sauvegardes |
| `src/data/resources.js` | Catalogue des ressources et stock initial de la colonie |
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
| `src/simulation/buildings.js` | Modèle terrain des bâtiments planétaires |
| `src/simulation/construction.js` | Démarrage payant, avancement temporel et remboursement des constructions |
| `src/simulation/roadNetwork.js` | Nœuds, segments, intersections et distance déjà construite |
| `src/simulation/roadConstruction.js` | Progression temporelle des routes, indépendante du rendu |
| `src/simulation/roadCostField.js` | Coût déterministe du relief, des obstacles et des routes existantes |
| `src/simulation/roadPathfinder.js` | Recherche A* pondérée avec vallée, pente, lacets et mutualisation |
| `src/simulation/roadGeometry.js` | Simplification, spline Catmull–Rom et validation du relief |
| `src/simulation/settlements.js` | Génération déterministe de rues secondaires, ronds-points et habitations |
| `src/gameplay/buildingPlacement.js` | Validation spatiale du placement sur la surface |
| `src/gameplay/roadPlacement.js` | Raccord automatique, création et recalcul d'itinéraires |
| `src/gameplay/exploration.js` | Missions de sonde et découverte des systèmes |
| `src/state.js` | État de navigation, session et inventaire |
| `src/storage/save.js` | Sauvegarde locale de l'exploration, de l'inventaire, des bâtiments, du réseau et de la vue |
| `src/navigation/camera.js` | Projections, repères locaux, zoom et caméra de surface |
| `src/rendering/renderer.js` | Orchestration du rendu de galaxie, des systèmes et des couches planétaires |
| `src/rendering/surfaceRenderer.js` | Matières procédurales, éclairage du relief, sélection et labels planétaires |
| `src/rendering/roadRenderer.js` | Traits terrestres, points maritimes et points d'intersection |
| `src/rendering/settlementRenderer.js` | Rues secondaires et sprites de lotissements planétaires |
| `src/rendering/buildingRenderer.js` | Empreintes, aperçus, ancres et cartes des bâtiments |
| `src/rendering/vehicleRenderer.js` | Couche visuelle des véhicules, en attente de la logistique |
| `src/ui/hud.js` | Sélection, télémétrie, menus et échelle |
| `src/app.js` | Gestes, navigation, boucle de rendu et raccord entre modules |

`index.html` fixe l'ordre de chargement. `build.py` intègre ces mêmes scripts et `styles.css` dans les exports autonomes du dossier `dist/`.

Les rues résidentielles sont générées de façon déterministe à partir des axes terrestres achevés et des bâtiments industriels raccordés. Leur progression et leur rendu restent dans une couche séparée du réseau manuel, mais leurs tronçons déjà construits peuvent servir de points d'accroche pour une route tracée par le joueur. Les cul-de-sac finissent par un mini-rond-point, et les rues secondaires se construisent à une vitesse inférieure à l'axe principal.

Le rendu de surface suit un ordre stable : terrain, gisements, routes, bâtiments physiques, véhicules, ancres et cartes de bâtiments, sélection, labels. Un bâtiment routier posé rejoint l'axe accessible le plus proche. Si un autre axe est suffisamment éloigné et part dans une direction distincte, une branche secondaire repart de l'axe principal à une distance configurée du port du bâtiment. Son nœud de jonction est donc sur la route, pas contre le bâtiment. La branche attend que le tronçon de sortie atteigne ce nœud avant de commencer sa construction. La hauteur du terrain alimente un cost-field déterministe, puis A* cherche chaque route en tenant compte des vallées, des pentes, des obstacles, des lacets et des routes existantes. La recherche favorise davantage les vallées et les versants doux pour épouser le relief ; la pénalité de virage reste faible pour laisser la route prendre des courbes naturelles. Un surcoût non linéaire pénalise les montées raides, tandis que la pénalité de virage diminue sur ces pentes afin de permettre des lacets. Le tracé brut passe par Ramer–Douglas–Peucker, une spline Catmull–Rom et une validation dense avant d'être enregistré. La courbe peut s'écarter légèrement du chemin A* tout en restant validée contre le terrain. Au raccord, les croisements réels sont détectés en priorité ; les approches proches peuvent rejoindre une route existante dans une tolérance configurée. Une route neuve stocke la distance construite depuis son origine ; la simulation l'allonge selon sa classe et le rendu n'affiche que cette portion. Cette progression et les dépendances de construction sont sauvegardées avec le réseau. Les vitesses de l'axe principal et des routes secondaires sont configurées séparément. La classe terre/mer de chaque tronçon est aussi enregistrée avec sa géométrie : la boucle de rendu ne lit que le chemin précalculé. Les routes sauvegardées sont conservées par planète.

Les définitions de bâtiments décrivent coûts, durées, remboursements, empreintes et ports en coordonnées monde de la surface. `OrbitSurfaceBuilding.create()` produit une instance ancrée par `planetId`, `x` et `y`; les extracteurs conservent aussi l'identifiant du gisement compatible choisi. `OrbitBuildingPlacement.validate()` vérifie les limites, le terrain et les chevauchements. `OrbitConstruction.start()` consomme le coût déclaré, puis `advance()` fait progresser l'assemblage sans Canvas. La démolition crédite le remboursement déclaré et détache les nœuds routiers du bâtiment. L'extraction, les débits et la production restent inactifs. Les stocks, bâtiments, leur progression, les sondes en cours et la vue courante sont conservés dans la sauvegarde locale.

## État conservé

La sauvegarde contient la graine, les systèmes découverts, les zones sondées, les systèmes visités, les sondes en cours, l'horloge orbitale, l'inventaire, les bâtiments, les réseaux, les rues résidentielles en cours de construction et la position de navigation. Elle conserve uniquement des données simples et des identifiants ; les systèmes et terrains sont régénérés depuis la graine.

Les gisements visibles sur les cartes sont des détails du monde généré. Ils n'alimentent aucun inventaire ni aucune chaîne de production.
