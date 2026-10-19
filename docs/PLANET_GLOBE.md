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

Le relief de rendu est radial et borné par `src/data/planetGlobeStyle.js`. Sa
plage verticale est recalculée depuis le quantile surfacique 98,5 % des altitudes
terrestres de chaque planète (pondération par latitude), entre 24 et 58 unités au-dessus du niveau marin.
La projection et le maillage conservent cette géométrie. La génération v9,
`elevation`, l'érosion et les quatre champs géologiques restent les données canoniques.

## Pipeline illustratif terrestre

`planetTerrainVisuals.js` transforme ces données en cartes mises en cache
par objet terrain, seed, climat et paramètres visuels. Les cartes ne sont pas
recalculées par frame et ne sont pas sauvegardées : elles se reconstruisent à
l'identique depuis le terrain.

- **Classes RGBA, 384 × 192** : plaine, colline, montagne, sommet. Le score combine
  altitude visuelle, pente macro et champs géologiques. Il est lissé sur la sphère.
  Les quantiles surfaciques de départ sont .54/.85/.97 ; les transitions restent
  continues.
- **Normales et matériau, 1024 × 512** : les plaines côtières restent presque
  sphériques. Un champ `mid - macro` et la rugosité large produisent un vallonnement
  discret et des buttes plus rares dans les basses terres. Les normales de massif
  viennent des pentes du relief intermédiaire, puis leur orientation est quantifiée
  doucement avec une variation tirée des mêmes champs. Les faces suivent les
  versants et les crêtes au lieu d'un pavage sphérique. Une carte séparée conserve
  la normale réelle pour comparaison. Cela ne change ni le mesh ni le raycast.
- **Matériau RGBA, 1024 × 512** : les classes gardent le vert aux pieds des massifs,
  puis font évoluer le matériau vers l'ocre, la roche et les crêtes. Les vallées
  assombrissent seulement les reliefs. L'humidité et l'altitude apportent une faible
  variation régionale ; aucune microtexture ne pilote la couleur. L'alpha porte
  neige et banquise, dont la couverture suit aussi le relief intermédiaire.

`planetTerrainStylizedShader.js` applique une rampe douce à trois tons, fortement
contrastée dans les massifs et limitée sur les plaines. Huit échantillons
géodésiques vers la lumière produisent des ombres douces sur les collines et les
montagnes. Les côtes utilisent deux bandes SDF finies : hauts-fonds turquoise
étroits puis sable. Les océans, calottes et bassins de lave gardent leur matériau
propre. L'atmosphère reste un pass séparé.

Dans **Outils développeur → Rendu de la planète**, le choix « Renderer v0.35.12 »
permet de comparer l'ancien renderer au nouveau sans changer planète, caméra ou
géométrie. Les diagnostics « Visual classes », « Faceted normals », « Real
mountain normals », « Rolling relief », « Terrain shadow » et « Final material »
affichent les différents étages sans atmosphère.
Le groupe **9 · RENDU STYLISÉ** du panneau de réglage expose les paramètres du
nouveau pipeline. Les paramètres CPU s'appliquent au relâchement ; lumière et
ombres se règlent en direct sans régénérer les cartes ou le worldgen.

## Responsabilités

- `planetGlobeMesh.js` fabrique une seule fois les positions, couleurs et normales
  du maillage pour un terrain donné. Le maillage utilise des indices 32 bits et
  640 × 320 segments. La topographie sphérique fournit la continuité aux pôles
  et à la couture sans moyenne de lignes.
- `planetGlobeRenderer.js` gère le contexte WebGL2, les shaders, les buffers, la
  perte/restauration du contexte et deux programmes fragment indépendants pour
  le renderer illustratif et la comparaison v0.35.12.
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
