# Génération des systèmes et terrains v3 — Agent 01

> Historique : les notes du lot v3 ci-dessous décrivent l'ancienne génération
> plane. Pour l'implémentation courante de `createTerrain`, suivre la section
> « Géographie sphérique actuelle ».

## Périmètre et fichiers

Ce lot rend les systèmes moins uniformes et prépare un monde natal exploitable.
Il ajoute `src/data/worldgen.js` (paramètres) et `src/world/system.js` (génération
pure, sans navigateur). `src/world.js` conserve la galaxie, les terrains et
l'API d'entrée ; `createSystem` délègue au nouveau module.

`src/app.js` cadre les systèmes selon leur étendue, même sans planète.
`src/rendering/renderer.js` accepte des listes vides et une épave absente.
`src/ui/hud.js` présente les décomptes, distances et estimations de température.
`index.html` charge les nouveaux modules. Tests concernés : `src/world.test.cjs`
et `tests/browser-smoke.cjs`. Documentation, version et exports sont mis à jour.

## Distribution réglable

| Planètes | Poids relatif (%) |
| --- | --- |
| 0 / 1 / 2 | 6 / 10 / 14 |
| 3 / 4 / 5 / 6 | 17 / 17 / 13 / 9 |
| 7 / 8 / 9 / 10 | 6 / 4 / 2,5 / 1,5 |

La majorité (56 %) possède trois à six planètes. Les ceintures utilisent une
distribution indépendante : 40 % sans ceinture, 40 % avec une, 16 % avec deux,
4 % avec trois. Les épaves décoratives sont présentes dans environ 12 % des
systèmes non natals. Elles n'ont pas encore de contenu à récupérer.

Les trois distributions d'espacement orbital sont compactes (25 %), régulières
(60 %) et étendues (15 %). Une distance minimale sépare les planètes ; les
ceintures occupent des intervalles libres ou l'extérieur du système.

Les tableaux et plages sont dans `OrbitWorldgenData`. Les poids n'ont pas besoin
de totaliser 100. Pour tester une configuration sans modifier les données
globales : `OrbitWorld.createSystem(seed, id, galaxy, settings)`.

## Données et unités

Chaque système fournit `extent`, y compris lorsqu'il n'a aucune planète.
Ce rayon inclut étoile, planètes, ceintures et éventuelle épave. La caméra et le
niveau de détail utilisent cette étendue, sans modifier le point visé au zoom.

L'étoile fournit sa masse et sa luminosité relatives au Soleil, ainsi qu'une
zone habitable indicative en UA. `orbit` désigne un rayon dans les unités de
dessin ; `distanceAU` est sa distance physique. `auPerUnit` relie ces mesures
à l'intérieur d'un système. Les dimensions entre systèmes sont adaptées au
petit écran. Les rapports de périodes respectent Kepler ; le temps est comprimé.

Les planètes possèdent des paramètres continus : `temperature` en °C,
`pressure` en bar, `gravity` relative à la Terre, `geology`, `water`,
`surfaceWater` et `habitability` normalisés. Le climat est une approximation :
flux proportionnel à luminosité / distance², température radiative plus un
effet de serre lié à la pression. Les noms tellurique, aride, océanique, glacée,
volcanique et gazeuse servent à présenter ces paramètres.

`water` représente une réserve potentielle, liquide ou gelée ; `surfaceWater`
commande la couverture liquide des cartes. Une géante gazeuse n'a ni surface
liquide jouable ni habitabilité de surface. `resources` contient des indices
d'abondance, pas un inventaire de matériaux ni des quantités extraites.

## Géographie sphérique actuelle

`createTerrain(seed, width, height, planet)` conserve le raster x/y et l'altitude
canonique `elevation`. La résolution canonique dans l'application est 960 × 360 ;
les textures du globe continuent à interpoler ces données. La version terrain est
9. Les anciennes chaînes/backbones/belts v7 ont été supprimées.

Le pipeline statique v9 est : plaques sphériques réparties par Fibonacci + jitter →
vitesses tangentielles par rotations → frontières et mouvements relatifs → uplift,
fosses et rifts → champ continental déformé indépendamment → plateau et relief
régional/collinaire/fin → zones orogéniques structurées → 12 passes d'érosion
thermique → quantile surfacique de l'eau → elevation finale.
Les centres des plaques et leurs mouvements sont seedés. Un support continu des
paires voisines évite les coupures quand les identités changent aux jonctions.
Les frontières de cisaillement ne deviennent pas automatiquement des montagnes.

`src/world/tectonics.js` porte le modèle et les champs ; `terrainElevation.js`
compose et normalise la hauteur ; `thermalErosion.js` effectue des échanges
conservatifs pondérés par les aires ; `terrainStructure.js` décrit ensuite la
hauteur finale pour le renderer. Le pôle est un seul point physique, y compris
pour l'érosion. La couture et les pôles restent exacts sans réparation de lignes.
Les continents proviennent d'un bruit 3D très basse fréquence, déformé sur la
sphère avec une petite perturbation de contour et une faible influence lissée des
propriétés des plaques ; ils ne sont pas leurs cellules. Le champ continental
sature sur les plateaux intérieurs. Trois bruits indépendants apportent un relief
régional et des collines aux amplitudes décroissantes. Les frontières convergentes
génèrent plusieurs crêtes irrégulières dans une large zone orogénique ; le type de
collision dépend des valeurs continentales locales de chaque côté. L'érosion
thermique reste inchangée à 12 passes.

Les quatre champs Uint8 sont calculés après elevation : `mountainMask` combine
uplift, altitude et pente, `ridgeField` la convexité des reliefs, `valleyField` la
concavité, `ruggednessField` les gradients et variations locales. La texture RGBA
structurelle existante les transmet au shader sans changement du renderer.

Le quantile utilise le poids cos(latitude) et la couverture `terrainWater`/
`surfaceWater` déjà utilisée par le jeu. Les hauteurs brutes et érodées sont
conservées dans `terrain.diagnostics` à la même échelle. Les caches terrain sont
générés une fois par planète, jamais par frame, et ne sont pas sérialisés dans les
sauvegardes. Changer la version topographique régénère la géographie en conservant
les sauvegardes générales et les coordonnées existantes.

Pour examiner les cartes sans albedo ni lumière : ouvrir une planète → menu →
outils développeur → **Diagnostic du terrain**. Les 11 champs demandés sont
sélectionnables et exportables en PNG. `node tests/terrain-topography-report.cjs`
produit aussi les cartes brutes de trois graines, en 960 × 360. Voir
[`TECTONIC_TERRAIN.md`](TECTONIC_TERRAIN.md) pour les validations A → D.

Les gisements solides (`iron`, `copper`, `silicon`, `carbon`) sont placés sur les
cellules terrestres du nouveau relief et gardent leur format x/y. Les champs
marins de pétrole sont générés sous le niveau de la mer.

Les gisements solides (`iron`, `copper`, `silicon`, `carbon`) gardent un rayon
déterministe en cellules de terrain. Les champs marins de pétrole sont générés
en eau profonde, et les plateformes pétrolières doivent être posées dans leur
zone. Les marqueurs de ressource sont dessinés en pixels d'écran afin de conserver
leur lisibilité au dézoom.

Le globe WebGL2 construit une texture climatique et une texture RGBA structurelle
à partir de l'altitude, des champs géologiques, de l'humidité, de la latitude, de
la température et du seed de la planète. Le shader lit directement les masques de
montagne, dorsale, vallée et rugosité ; il ne déduit plus les crêtes d'un
Laplacien de hauteur. La projection géométrique applique une forme de relief
monotone partagée par le maillage et les normales de shading.
Les motifs de détail utilisent des directions 3D afin de rester continus à la
couture et aux pôles. Les couleurs et le shader sont décrits dans
`planetSurfaceTexture.js` et `planetGlobeRenderer.js`.

## Départ viable et sauvegardes

Le système natal conserve une étoile G, quatre à six planètes, au moins une
ceinture et une géante gazeuse. Sa deuxième planète est un candidat tempéré :
pression de 0,9 à 1,1 bar, gravité de 0,85 à 1,15 g, réserves d'eau et de
matières de base. Le générateur place au moins un gisement de chaque solide
fondamental sur sa carte. `startingPlanetId` identifie ce candidat.

La galaxie garde ses 2 560 identifiants et positions. Les graines, scans et
visites des sauvegardes précédentes sont donc réutilisés. Les systèmes et les surfaces sont recalculés avec les nouveaux paramètres : leur ancien contenu
n'est pas figé. Les données de navigation des anciennes sauvegardes restent compatibles ;
les données industrielles éventuelles sont écartées.

## Validation et limites

Les tests couvrent le déterminisme, tous les décomptes par défaut, les cas
pauvres et riches, la majorité de systèmes ordinaires, la non-intersection des
orbites et ceintures, les relations physiques et les contraintes natales.
La distribution est vérifiée sur une galaxie complète et le départ sur 64
graines ; des cartes natales vérifient concrètement les ressources et l'eau.
Les tests navigateur visitent aussi les systèmes vides, à une planète,
entièrement gazeux et riches, avec cadrage, retour et absence d'erreur.

Résultats du lot : 20 tests unitaires réussis ; suites navigateur source et
HTML autonome réussies en 390 × 844 et 1440 × 900. Une vérification mobile
complémentaire couvre la fiche du candidat natal, son terrain et la version
affichée. Sur la graine `distribution-v2`, les 2 560 systèmes comprennent
165 systèmes sans planète et 203 systèmes de huit à dix planètes. Les
coordonnées galactiques ont également été comparées à la version précédente
sur quatre graines : identifiants, positions et découvertes initiales identiques.

Les atmosphères et températures sont des estimations simplifiées. La carte
reste régionale. Les étoiles multiples, anomalies nouvelles, découverte
progressive des fiches et exploitation industrielle appartiennent à d'autres
lots. Les ressources naturelles restent visibles dans les cartes. Leur exploitation appartient à une phase de jeu séparée qui repartira d’une base neuve.
