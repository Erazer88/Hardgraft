# Génération v2 — Agent 01

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

`createTerrain(seed, width, height, planet)` utilise la couverture d'eau du
profil. L'appel historique sans profil reste accepté. Les gisements possèdent
un identifiant stable (`iron`, `copper`, `silicon`, `carbon`), leur libellé, leur
position et leur abondance. L'eau est représentée par les étendues liquides et
la propriété de la planète ; l’exploitation des ressources n’est pas présente dans le prototype actuel.

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
