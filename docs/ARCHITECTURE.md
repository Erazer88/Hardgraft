# Architecture du prototype de navigation

Cette note décrit les modules actuellement chargés par `index.html`. Le prototype garde la génération procédurale, le rendu Canvas, la navigation continue, l'exploration et la lecture des cartes de terrain. Les modules de construction, d'usine et de routes planétaires ont été retirés.

| Module | Responsabilité |
| --- | --- |
| `src/data/config.js` | Graine par défaut, caméra, génération de terrain, sauvegardes |
| `src/data/worldgen.js` | Paramètres des étoiles, systèmes, planètes et gisements naturels |
| `src/data/buildings.js` | Définitions déclaratives des bâtiments planétaires |
| `src/data/surfaceStyle.js` | Contrat visuel de la carte planétaire et niveaux de détail |
| `src/world.js` | Galaxies, positions orbitales et terrains procéduraux |
| `src/world/system.js` | Assemblage des systèmes et caractéristiques planétaires |
| `src/simulation/simulation.js` | Horloge orbitale |
| `src/simulation/buildings.js` | Modèle terrain des bâtiments planétaires |
| `src/gameplay/exploration.js` | Missions de sonde et découverte des systèmes |
| `src/state.js` | État de navigation et de session |
| `src/storage/save.js` | Sauvegarde des découvertes, missions et temps orbital |
| `src/navigation/camera.js` | Projections, repères locaux, zoom et caméra de surface |
| `src/rendering/renderer.js` | Orchestration du rendu de galaxie, des systèmes et des couches planétaires |
| `src/rendering/surfaceRenderer.js` | Textures et couches de terrain, relief, sélection et labels planétaires |
| `src/rendering/roadRenderer.js` | Couche de routes planétaires, en attente du modèle réseau |
| `src/rendering/buildingRenderer.js` | Couches de bâtiments, ancres et cartes, en attente du modèle bâtiment |
| `src/rendering/vehicleRenderer.js` | Couche visuelle des véhicules, en attente du réseau routier |
| `src/ui/hud.js` | Sélection, télémétrie, menus et échelle |
| `src/app.js` | Gestes, navigation, boucle de rendu et raccord entre modules |

`index.html` fixe l'ordre de chargement. `build.py` intègre ces mêmes scripts et `styles.css` dans les exports autonomes du dossier `dist/`.

Le rendu de surface suit un ordre stable : terrain, gisements, routes, bâtiments physiques, véhicules, ancres et cartes de bâtiments, sélection, labels. Les passes des bâtiments, routes et véhicules sont des points d'extension vides à ce stade ; elles ne créent ni état ni logique de simulation.

Les définitions de bâtiments décrivent des empreintes et ports en coordonnées monde de la surface. `OrbitSurfaceBuilding.create()` produit une instance ancrée par `planetId`, `x` et `y`, destinée au tableau `state.surfaceBuildings`; le port routier est un point monde calculé depuis l'ancre, la rotation et le décalage local de la définition. Les règles de placement sont déclaratives et ne sont pas encore évaluées. La sauvegarde des bâtiments viendra au bloc 20.

## État conservé

La sauvegarde contient la graine, les systèmes découverts, les zones sondées, les systèmes visités et l'horloge orbitale. Les anciennes sauvegardes de construction sont invalidées par la version du format afin qu'aucune donnée d'usine ou de route ne réapparaisse dans le nouvel état.

Les gisements visibles sur les cartes sont des détails du monde généré. Ils n'alimentent aucun inventaire ni aucune chaîne de production.
