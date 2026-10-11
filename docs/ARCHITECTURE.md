# Architecture du prototype de navigation

Cette note décrit les modules actuellement chargés par `index.html`. Le prototype garde la génération procédurale, le rendu Canvas, la navigation continue, l'exploration et la lecture des cartes de terrain. La construction d'infrastructures de surface et leurs routes sont en cours ; les blocs internes aux usines et la logistique de ressources ne sont pas encore simulés.

| Module | Responsabilité |
| --- | --- |
| `src/data/config.js` | Graine par défaut, caméra, génération de terrain, sauvegardes |
| `src/data/worldgen.js` | Paramètres des étoiles, systèmes, planètes et gisements naturels |
| `src/data/buildings.js` | Définitions déclaratives des bâtiments planétaires |
| `src/data/roads.js` | Pondérations de calcul et style de rendu des routes |
| `src/data/surfaceStyle.js` | Contrat visuel de la carte planétaire et niveaux de détail |
| `assets/buildings/*.webp` | Sprites transparents des bâtiments planétaires |
| `src/world.js` | Galaxies, positions orbitales et terrains procéduraux |
| `src/world/system.js` | Assemblage des systèmes et caractéristiques planétaires |
| `src/simulation/simulation.js` | Horloge orbitale |
| `src/simulation/buildings.js` | Modèle terrain des bâtiments planétaires |
| `src/simulation/construction.js` | Avancement temporel des constructions planétaires |
| `src/simulation/roadNetwork.js` | Nœuds, segments et intersections du réseau |
| `src/simulation/roadCostField.js` | Coût déterministe du relief, des obstacles et des routes existantes |
| `src/simulation/roadPathfinder.js` | Recherche A* pondérée avec vallée, pente, lacets et mutualisation |
| `src/simulation/roadGeometry.js` | Simplification, spline Catmull–Rom et validation du relief |
| `src/gameplay/buildingPlacement.js` | Validation spatiale du placement sur la surface |
| `src/gameplay/roadPlacement.js` | Raccord automatique, création et recalcul d'itinéraires |
| `src/gameplay/exploration.js` | Missions de sonde et découverte des systèmes |
| `src/state.js` | État de navigation et de session |
| `src/storage/save.js` | Sauvegarde locale de l'exploration, des bâtiments, du réseau et de la vue |
| `src/navigation/camera.js` | Projections, repères locaux, zoom et caméra de surface |
| `src/rendering/renderer.js` | Orchestration du rendu de galaxie, des systèmes et des couches planétaires |
| `src/rendering/surfaceRenderer.js` | Textures et couches de terrain, relief, sélection et labels planétaires |
| `src/rendering/roadRenderer.js` | Traits terrestres, points maritimes et points d'intersection |
| `src/rendering/buildingRenderer.js` | Empreintes, aperçus, ancres et cartes des bâtiments |
| `src/rendering/vehicleRenderer.js` | Couche visuelle des véhicules, en attente du réseau routier |
| `src/ui/hud.js` | Sélection, télémétrie, menus et échelle |
| `src/app.js` | Gestes, navigation, boucle de rendu et raccord entre modules |

`index.html` fixe l'ordre de chargement. `build.py` intègre ces mêmes scripts et `styles.css` dans les exports autonomes du dossier `dist/`.

Le rendu de surface suit un ordre stable : terrain, gisements, routes, bâtiments physiques, véhicules, ancres et cartes de bâtiments, sélection, labels. Un bâtiment routier posé rejoint le réseau le plus proche. La hauteur du terrain alimente un cost-field déterministe, puis A* cherche une route en tenant compte des vallées, des pentes, des obstacles, des lacets et des routes existantes. La recherche favorise davantage les vallées et les versants doux pour épouser le relief ; la pénalité de virage reste faible pour laisser la route prendre des courbes naturelles. Un surcoût non linéaire pénalise les montées raides, tandis que la pénalité de virage diminue sur ces pentes afin de permettre des lacets. Le tracé brut passe par Ramer–Douglas–Peucker, une spline Catmull–Rom et une validation dense avant d'être enregistré. La courbe peut s'écarter légèrement du chemin A* tout en restant validée contre le terrain. Au raccord, les croisements réels sont détectés en priorité ; les approches proches peuvent rejoindre une route existante dans une tolérance configurée. La classe terre/mer de chaque tronçon est aussi enregistrée avec sa géométrie : la boucle de rendu ne lit que le chemin précalculé. Les routes sauvegardées sont conservées par planète.

Les définitions de bâtiments décrivent des empreintes et ports en coordonnées monde de la surface. `OrbitSurfaceBuilding.create()` produit une instance ancrée par `planetId`, `x` et `y`; les extracteurs conservent aussi l'identifiant du gisement compatible choisi. `OrbitBuildingPlacement.validate()` vérifie les limites, le terrain et les chevauchements. La fiche d'un bâtiment sélectionné affiche son niveau d'amélioration, ses informations propres à son type, son stock ou son débit courant. Les débits et la puissance sont initialisés à zéro jusqu'à l'ajout de leur simulation. Les bâtiments, leur progression, les sondes en cours et la vue courante sont conservés dans la sauvegarde locale.

## État conservé

La sauvegarde contient la graine, les systèmes découverts, les zones sondées, les systèmes visités, les sondes en cours, l'horloge orbitale, les bâtiments et la position de navigation. Elle conserve uniquement des données simples et des identifiants ; les systèmes et terrains sont régénérés depuis la graine.

Les gisements visibles sur les cartes sont des détails du monde généré. Ils n'alimentent aucun inventaire ni aucune chaîne de production.
