# Architecture du prototype de navigation

Cette note décrit les modules actuellement chargés par `index.html`. Le prototype garde la génération procédurale, le rendu Canvas, la navigation continue, l'exploration et la lecture des cartes de terrain. Les modules de construction, d'usine et de routes planétaires ont été retirés.

| Module | Responsabilité |
| --- | --- |
| `src/data/config.js` | Graine par défaut, caméra, génération de terrain, sauvegardes |
| `src/data/worldgen.js` | Paramètres des étoiles, systèmes, planètes et gisements naturels |
| `src/data/buildings.js` | Définitions déclaratives des bâtiments planétaires |
| `src/data/surfaceStyle.js` | Contrat visuel de la carte planétaire et niveaux de détail |
| `assets/buildings/*.webp` | Sprites transparents des bâtiments planétaires |
| `src/world.js` | Galaxies, positions orbitales et terrains procéduraux |
| `src/world/system.js` | Assemblage des systèmes et caractéristiques planétaires |
| `src/simulation/simulation.js` | Horloge orbitale |
| `src/simulation/buildings.js` | Modèle terrain des bâtiments planétaires |
| `src/simulation/construction.js` | Avancement temporel des constructions planétaires |
| `src/gameplay/buildingPlacement.js` | Validation spatiale du placement sur la surface |
| `src/gameplay/exploration.js` | Missions de sonde et découverte des systèmes |
| `src/state.js` | État de navigation et de session |
| `src/storage/save.js` | Sauvegarde locale de l'exploration, des bâtiments et de la vue |
| `src/navigation/camera.js` | Projections, repères locaux, zoom et caméra de surface |
| `src/rendering/renderer.js` | Orchestration du rendu de galaxie, des systèmes et des couches planétaires |
| `src/rendering/surfaceRenderer.js` | Textures et couches de terrain, relief, sélection et labels planétaires |
| `src/rendering/roadRenderer.js` | Couche de routes planétaires, en attente du modèle réseau |
| `src/rendering/buildingRenderer.js` | Empreintes, aperçus, ancres et cartes des bâtiments |
| `src/rendering/vehicleRenderer.js` | Couche visuelle des véhicules, en attente du réseau routier |
| `src/ui/hud.js` | Sélection, télémétrie, menus et échelle |
| `src/app.js` | Gestes, navigation, boucle de rendu et raccord entre modules |

`index.html` fixe l'ordre de chargement. `build.py` intègre ces mêmes scripts et `styles.css` dans les exports autonomes du dossier `dist/`.

Le rendu de surface suit un ordre stable : terrain, gisements, routes, bâtiments physiques, véhicules, ancres et cartes de bâtiments, sélection, labels. Le catalogue permet de placer les bâtiments définis ; les routes, véhicules et flux de ressources restent sans simulation.

Les définitions de bâtiments décrivent des empreintes et ports en coordonnées monde de la surface. `OrbitSurfaceBuilding.create()` produit une instance ancrée par `planetId`, `x` et `y`; les extracteurs conservent aussi l'identifiant du gisement compatible choisi. `OrbitBuildingPlacement.validate()` vérifie les limites, le terrain et les chevauchements. La fiche d'un bâtiment sélectionné affiche son niveau d'amélioration, ses informations propres à son type, son stock ou son débit courant. Les débits et la puissance sont initialisés à zéro jusqu'à l'ajout de leur simulation. Les bâtiments, leur progression, les sondes en cours et la vue courante sont conservés dans la sauvegarde locale.

## État conservé

La sauvegarde contient la graine, les systèmes découverts, les zones sondées, les systèmes visités, les sondes en cours, l'horloge orbitale, les bâtiments et la position de navigation. Elle conserve uniquement des données simples et des identifiants ; les systèmes et terrains sont régénérés depuis la graine.

Les gisements visibles sur les cartes sont des détails du monde généré. Ils n'alimentent aucun inventaire ni aucune chaîne de production.
