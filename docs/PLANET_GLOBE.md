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
Ce quantile calibre le relief sans écrêter les sommets : une queue rationnelle
strictement croissante conserve les hauteurs jusqu'au maximum réel. En plus de
ce profil de base, `mountainMask` soulève les massifs et `ridgeField` ajoute une
poussée plus étroite aux crêtes hautes. Ces boosts visuels rendent les silhouettes
plus hautes et pointues sans changer `elevation` ni les données de gameplay. Les
champs sont utilisés dans la projection du maillage et dans le calcul GLSL des
normales/ombres ; le raycast utilise une borne correspondante et un échantillonnage
plus dense. Le décalage atmosphérique suit la nouvelle surface pour éviter de
traverser les pics. La génération v9, `elevation`, l'érosion et les quatre champs
géologiques restent les données canoniques.

## Pipeline illustratif terrestre

`planetTerrainVisuals.js` transforme ces données en cartes mises en cache
par objet terrain, seed, climat et paramètres visuels. Les cartes ne sont pas
recalculées par frame et ne sont pas sauvegardées : elles se reconstruisent à
l'identique depuis le terrain.

- **Classes RGBA, 384 × 192** : plaine, colline, montagne, sommet. Deux scores
  sphériques distincts séparent vallonnement/collines et vrais massifs. Le premier
  combine macro relief, résidu positif et rugosité ; le second privilégie le champ
  géologique `mountainMask`, puis la rugosité et la pente. Les quantiles surfaciques
  .54/.87/.978 calibrent leurs étendues ; une altitude élevée ne suffit pas à
  transformer un plateau en montagne.
- **Normales et matériau, 1024 × 512** : les plaines côtières restent presque
  sphériques. Un champ `mid - macro` et la rugosité large produisent un vallonnement
  discret et des buttes plus rares dans les basses terres. Les normales de massif
  viennent des pentes du relief intermédiaire, puis leur orientation est quantifiée
  doucement avec une variation tirée des mêmes champs. Les faces suivent les
  versants et les crêtes au lieu d'un pavage sphérique. Une carte séparée conserve
  la même normale avant quantification pour comparaison. Un troisième signal
  `local - mid`, faiblement filtré puis mélangé à 16 % uniquement dans les massifs,
  conserve les petites arêtes de la vraie topographie. Son diagnostic signé est
  stocké dans l'alpha de cette carte existante, sans nouvelle texture GPU.
  Cela ne change ni le mesh ni le raycast.
- **Petits massifs R8, 384 × 192** : le résidu positif et la rugosité réelle
  produisent une couche intermédiaire dans les plaines/collines intérieures.
  Elle est lissée à .040 rad, normalisée sur un quantile terrestre puis ajoutée
  aux normales, au matériau olive et à l'éclairage. Elle reste distincte des
  grandes montagnes et ne crée aucune nouvelle altitude de gameplay.
- **Matériau RGBA, 1024 × 512** : les classes gardent le vert aux pieds des massifs,
  puis font évoluer le matériau vers l'ocre, la roche et les crêtes. Les vallées
  assombrissent seulement les reliefs. Roche et crêtes dépendent conjointement de
  la pente, de la hauteur et de l'appartenance au massif. Les pieds de versant
  restent verts/olive, les parties élevées ont une transition minérale même si
  la pente locale est faible, et les pics/crêtes vont vers l'ocre et le beige
  clair. Cette transition de matériau ne crée pas de plateaux géométriques.
  L'humidité et l'altitude apportent une faible
  variation régionale ; aucune microtexture ne pilote la couleur. L'alpha porte
  neige et banquise. Seul le bord de neige terrestre est perturbé par les résidus
  topographiques, à moins de 8,5 points de couverture ; le climat et les normales
  sous-jacentes restent communs au terrain enneigé.

`planetTerrainStylizedShader.js` applique une rampe douce à trois tons, fortement
contrastée dans les massifs, modérée dans le vallonnement et limitée sur les vraies
plaines. Les ombres par défaut sont renforcées (.30, contraste du vallonnement
1.25) ; leur atténuation possède un plancher de .74 pour éviter
le cumul de versants presque noirs. Huit échantillons
géodésiques vers la lumière produisent des ombres douces sur les collines et les
montagnes. Les côtes utilisent deux bandes SDF finies : hauts-fonds turquoise
étroits puis sable. Les océans, calottes et bassins de lave gardent leur matériau
propre. L'atmosphère reste un pass séparé.

La SDF conserve une source 2048 × 1024 : le masque de couverture est d'abord
filtré en flottant, la position sous-pixel de son contour 50 % initialise la
distance, puis le champ signé est légèrement lissé avant encodage R8. Les deux
filtres raccordent la longitude et replient les prélèvements au-delà des pôles.
`Coast smoothing` et `Coast field blur` sont exprimés en texels à 2048 pixels de
largeur, adaptés à la résolution. Leur cache est séparé : les modifier ne
recalcule ni l'albedo ni les hauteurs RG8. Le masque source et `elevation` du
gameplay restent inchangés.

Dans **Outils développeur → Rendu de la planète**, le choix « Renderer v0.35.12 »
permet de comparer l'ancien renderer au nouveau sans changer planète, caméra ou
géométrie. Les diagnostics « Visual classes », « Faceted normals », « Real
mountain normals », « Rolling relief », « Local relief », « Small massifs »,
« Terrain shadow » et « Final material »
affichent les différents étages sans atmosphère.
Le groupe **9 · RENDU STYLISÉ** du panneau de réglage expose les paramètres du
nouveau pipeline. Les paramètres CPU s'appliquent au relâchement ; lumière et
ombres se règlent en direct sans régénérer les cartes ou le worldgen. Les contrôles
supplémentaires exposent la force locale, le contraste du vallonnement,
l'annulation de lumière sphérique, le plancher des ombres et le minimum d'AA côtier.
Les réglages de petits massifs, de matériau highland et des deux lissages de côte
s'appliquent au relâchement, sans régénérer la topographie.

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
