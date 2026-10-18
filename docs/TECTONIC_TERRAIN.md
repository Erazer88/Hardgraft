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
