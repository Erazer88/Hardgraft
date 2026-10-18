# Terrain tectonique statique

La construction est séparée en quatre étapes vérifiables. Toutes les distances et
mouvements géologiques sont sphériques ; les tableaux x/y restent l'interface du jeu.
Le globe, les textures et les shaders ne font pas partie de cette refonte.

## A — sources tectoniques

`src/world/tectonics.js` génère 12 à 24 plaques par Fibonacci sphere, avec rotation
et jitter seedés. Chaque plaque porte une rotation angulaire et une croûte.
`velocity = cross(omega, direction)` reste tangent à la sphère.
Les deux meilleurs produits scalaires définissent la frontière locale ; la vitesse
relative y distingue convergence, divergence et cisaillement. Le type de croûte
commande l'uplift, les fosses et les rifts. Le champ continental reste indépendant
et ne reçoit qu'une faible influence interpolée des plaques.

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
