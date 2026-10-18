# Expérimentation planète 3D

Cette implémentation appartient uniquement à la branche
`codex/planet-globe-3d-experiment`. La branche `codex/nereide-prototype` reste
restaurable sans fusion. Cette page décrit le rendu courant, pas une promesse de
migration définitive.

## Contrat de coordonnées

La génération et la simulation gardent les coordonnées terrain x/y existantes.
Les bâtiments, routes, gisements et données sauvegardées ne deviennent pas des
coordonnées 3D. Le renderer convertit seulement ces positions pour les dessiner.

`src/rendering/planetGlobeProjection.js` est le seul endroit qui réalise cette
conversion :

- `terrainToSphere` et `sphereToTerrain` convertissent longitude/latitude ;
- `sampleField`, `sampleElevation`, `surfaceRadius` et `surfacePosition` évaluent la heightmap ;
- `projectSurfacePoint` projette les éléments en pixels et indique l'hémisphère ;
- `raycastTerrain` reconvertit un point écran en position logique de terrain.

Le relief de rendu est radial et borné par `src/data/planetGlobeStyle.js`. Les
valeurs d'altitude de gameplay ne sont pas modifiées.

## Responsabilités

- `planetGlobeMesh.js` fabrique une seule fois les positions, couleurs et normales
  du maillage pour un terrain donné. Le maillage utilise des indices 16 bits et
  360 × 180 segments. `sampleField` raccorde les bords de longitude et adoucit
  les lignes polaires à l'affichage, sans altérer les valeurs de simulation.
- `planetGlobeRenderer.js` gère le contexte WebGL2, les shaders, les buffers, la
  perte/restauration du contexte et l'éclairage diffus.
- `planetGlobeOverlayRenderer.js` dessine la grille, les gisements, les routes,
  les repères de districts et les icônes de bâtiments en Canvas2D. Les marqueurs
  situés derrière la sphère ne sont pas dessinés ni sélectionnables.
- `planetGlobeCamera.js` porte le yaw, le pitch borné, le zoom court et les
  transitions de 320 ms. Il ne possède pas de roulis ni de caméra libre.
- `renderer.js` garde les vues galaxie/système en Canvas2D et délègue la surface.
- `app.js` conserve l'état de jeu et convertit les interactions de placement ou de
  route par le raycast du module de projection.

La surface demande WebGL2. En l'absence du contexte, l'interface affiche
« Cette vue nécessite WebGL2. » ; l'ancien rendu de surface 2D a été retiré de
cette branche.

## Interactions

Sur le globe, un doigt ou le bouton gauche fait tourner la planète. Deux doigts
modifient doucement le zoom ; sur ordinateur, la molette le règle dans la même
plage courte. Le pitch est borné pour garder l'axe vertical stable. Les actions de
placement et de route sont toujours interprétées dans l'espace de la heightmap.

L'entrée/sortie garde la navigation galaxie → système → surface. La transition
agrandit ou réduit le globe entre la position système de la planète et le centre
de l'écran sans changer ses coordonnées de simulation.

## Validation

```sh
node --test tests/planet-globe.test.cjs
npm test
# Serveur sur 8000 actif :
node tests/browser-smoke.cjs
python3 build.py
```

Le smoke navigateur vérifie Chromium desktop, mobile portrait et mobile paysage :
navigation réelle, glisser, molette/pinch, placement, sélection, tracé de route,
occlusion de l'hémisphère arrière, retour/réentrée et restauration WebGL si le
navigateur fournit `WEBGL_lose_context`.
