# Terrain tectonique statique

La construction est séparée en quatre étapes vérifiables. Toutes les distances et
mouvements géologiques sont sphériques ; les tableaux x/y restent l'interface du jeu.
Le globe, les textures et les shaders ne font pas partie de cette refonte.

## A — sources tectoniques

`src/world/tectonics.js` génère 12 à 24 plaques par Fibonacci sphere, avec rotation
et jitter seedés. Chaque plaque porte une rotation angulaire et une croûte.
`velocity = cross(omega, direction)` reste tangent à la sphère.
Les deux meilleurs produits scalaires définissent la frontière locale ; la vitesse
relative y distingue convergence, divergence et cisaillement. Les étiquettes de
croûte des plaques n'ajoutent qu'un faible biais au champ continental ; la classe
de collision actuelle est échantillonnée dans ce champ de chaque côté de la frontière.

Validation A : `node --test tests/tectonics.test.cjs` (4 tests). L'ajout de ce modèle
n'a pas modifié la génération d'elevation v7 à cette étape.

## B — nouvelle hauteur, sans érosion

`terrainElevation.js` compose base continentale basse fréquence, variation régionale,
uplift et subsidence. Un faible déplacement 3D est appliqué aux champs tectoniques
déjà construits. La conversion en Uint8 conserve le quantile surfacique et comprime
la plage verticale si nécessaire, sans saturer les sommets.

L'examen des cartes brutes a révélé des coupures aux jonctions de plaques. Le modèle
combine maintenant les paires proches avec un support continu, au lieu de couper
l'influence lors d'un changement de seconde/troisième plaque. Un test vérifie ce
raccord à plusieurs jonctions. Les IDs restent un Voronoï strict.

Validation B : 6 tests ciblés et cartes grises de trois graines en 960 × 360 via
`node tests/terrain-topography-report.cjs`. Aucun changement de texture ou shader.
Le remplacement du point d'entrée `createTerrain` est différé jusqu'à D pour ne pas
brancher des champs structurels incomplets pendant les étapes B/C.

## C — érosion thermique

`thermalErosion.js` échange de la hauteur uniquement au-delà du talus, pendant
12 passes. Les échanges sont pondérés par l'aire sphérique et conservatifs ; la
couture est un graphe fermé et chaque pôle est un seul nœud relié à sa couronne.
Il ne s'agit pas d'une moyenne de lignes polaires. Les plaines planes ne changent
pas. L'érosion hydraulique n'est pas incluse.

Validation C : 8 tests ciblés, conservation de l'intégrale surfacique, pic isolé
adouci, dépôt dans les voisins, pôles/couture exacts, déterminisme et comparaison
raw/eroded de trois cartes canoniques. Les grands systèmes tectoniques sont
conservés ; l'effet reste local aux pentes dépassant le talus.

## D — raccord canonique et diagnostic

La génération v7 a été supprimée de `world.js` et des données. `createTerrain`
compose A/B/C puis dérive les quatre champs via des stencils angulaires sphériques
sur elevation : pente, convexité/concavité et variation locale. Le shader conserve
son interface RGBA et tous ses paramètres existants.

Le menu développeur affiche onze cartes CPU, avec hauteurs avant/après sur la
même échelle et export PNG. Les IDs utilisent des couleurs catégorielles ; les
hauteurs ne reçoivent ni albedo ni shading. Ces cartes sont des caches, pas des
données de sauvegarde. Le coût est payé une fois lors du chargement d'une planète.

Limites : tectonique statique stylisée, sans simulation temporelle ni drainage
hydraulique. Les vallées sont détectées par concavité après érosion thermique.
La génération n'est pas une reconstruction géophysique. Les changements v8
régénèrent la topographie ; les anciennes positions de bâtiments restent conservées.

## E — conversion du relief v9

La version 9 conserve le modèle de plaques v8 et le contrat du renderer. Elle
modifie seulement l'échantillonnage de la géographie continentale et sa conversion
en altitude :

- `continentalField` reste le champ terre/mer basse fréquence. Un domain warp
  sphérique et une faible variation de contour le rendent moins rond sans calquer
  les continents sur les cellules des plaques.
- La contribution d'altitude du champ continental sature vers le plateau intérieur.
  Les points profondément continentaux ne tirent donc plus toute leur altitude de
  la valeur du masque terre/mer.
- Trois bruits sphériques indépendants produisent du relief régional, des collines
  et un détail fin de plus faible amplitude. Les terres éloignées des frontières
  conservent ainsi une variation topographique mesurée.
- Les frontières convergentes génèrent une large zone orogénique avec plusieurs
  bandes de crêtes irrégulières, des interruptions et des cols. La classification
  utilise les valeurs continentales de part et d'autre de la frontière locale,
  permettant à une plaque de traverser une côte.
- L'érosion thermique reste à 12 passes. Aucun changement de shader ou de renderer
  n'est requis : `rawElevation` est inspectée seule avant tout travail visuel.

`node tests/terrain-topography-report.cjs` produit les cartes brutes, d'uplift et
érodées pour trois graines. `tests/tectonics.test.cjs` couvre la saturation des
plateaux, le relief intérieur, le changement local de croûte au sein d'une plaque,
les crêtes multiples et la continuité/déterminisme des champs.
