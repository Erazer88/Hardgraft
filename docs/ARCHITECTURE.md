# Architecture du prototype de navigation

Cette note décrit les modules actuellement chargés par `index.html`. Le prototype garde la génération procédurale, le rendu Canvas, la navigation continue, l'exploration et la lecture des cartes de terrain. Les modules de construction, d'usine et de routes planétaires ont été retirés.

| Module | Responsabilité |
| --- | --- |
| `src/data/config.js` | Graine par défaut, caméra, génération de terrain, sauvegardes |
| `src/data/worldgen.js` | Paramètres des étoiles, systèmes, planètes et gisements naturels |
| `src/world.js` | Galaxies, positions orbitales et terrains procéduraux |
| `src/world/system.js` | Assemblage des systèmes et caractéristiques planétaires |
| `src/simulation/simulation.js` | Horloge orbitale |
| `src/gameplay/exploration.js` | Missions de sonde et découverte des systèmes |
| `src/state.js` | État de navigation et de session |
| `src/storage/save.js` | Sauvegarde des découvertes, missions et temps orbital |
| `src/navigation/camera.js` | Projections, repères locaux, zoom et caméra de surface |
| `src/rendering/renderer.js` | Galaxie, systèmes, planètes et textures de relief |
| `src/ui/hud.js` | Sélection, télémétrie, menus et échelle |
| `src/app.js` | Gestes, navigation, boucle de rendu et raccord entre modules |

`index.html` fixe l'ordre de chargement. `build.py` intègre ces mêmes scripts et `styles.css` dans les exports autonomes du dossier `dist/`.

## État conservé

La sauvegarde contient la graine, les systèmes découverts, les zones sondées, les systèmes visités et l'horloge orbitale. Les anciennes sauvegardes de construction sont invalidées par la version du format afin qu'aucune donnée d'usine ou de route ne réapparaisse dans le nouvel état.

Les gisements visibles sur les cartes sont des détails du monde généré. Ils n'alimentent aucun inventaire ni aucune chaîne de production.
