# Génération des systèmes et terrains v3 — Agent 01

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

La carte d'une planète est un rectangle 4:3 de 640 × 480 cellules
(`OrbitConfig.terrain`), soit 1920 × 1440 km. En arrivant sur une planète, la caméra
la cadre pour couvrir exactement l'écran, en portrait comme en paysage.

`createTerrain(seed, width, height, planet)` (terrain v5) dessine d'abord les terres,
puis en déduit le relief. Les réglages sont dans `OrbitWorldgenData.terrain`.

1. **Masses de terre** (`landmasses`) : deux à quatre continents, ou un à trois sur
   les mondes d'îles, se partagent la surface émergée. Chacun est une ellipse
   orientée avec des lobes (péninsules, sous-continents), placée loin des autres.
   Le reste de la surface forme des chaînes d'îles au large d'un continent ou en
   pleine mer.
2. **Côtes** (`coast`) : une déformation du domaine plie chaque forme, puis des
   bandes de bruit fractal découpent caps, baies et criques. Les bandes fines
   déplacent moins la côte que les larges, et chacune est tournée pour ne pas
   s'aligner sur les axes de la carte.
3. **Niveau de la mer** : le seuil de forme laisse exactement la couverture d'eau du
   profil (`surfaceWater`, ou `terrainWater` pour les mondes froids).
4. **Relief** (`relief`, sans toucher à la côte) : une rampe côtière de largeur
   variable (falaises ou plaines), un soulèvement à grande échelle qui crée lignes
   de partage des eaux et bassins, des plaines aplanies, des collines, des plateaux
   en terrasses (mesas) et des massifs montagneux le long de ceintures sinueuses
   (bruit multifractal à crêtes). Au large : plateau continental puis océan profond.
5. **Hydrologie** (`hydrology`), proportionnelle à l'eau de la planète :
   - des cuvettes irrégulières sont creusées puis une inondation par priorité
     depuis la mer donne à chaque cellule son exutoire et son niveau de
     débordement ;
   - les cuvettes profondes deviennent des **lacs** à leur niveau de débordement
     (part limitée des terres), les petites sont comblées en replats ;
   - l'eau ruisselle selon l'humidité ; au-delà d'un seuil de bassin versant
     naissent des **rivières**, dont le lit ne remonte jamais vers l'aval. Elles
     creusent des vallées, et des **canyons** étroits à travers mesas et massifs ;
   - les **marais** occupent les plaines inondables plates et humides, les rives de
     lacs et les replats ;
   - les grands fleuves débouchant sur une côte haute ouvrent une **crique**
     (estuaire en entonnoir de quelques cellules) ;
   - les mondes secs gardent seulement des canyons asséchés.

Le terrain expose `elevation` (hauteur canonique pour le gameplay : les lacs et
criques sont de l'eau, à ou sous la mer), `relief` (hauteur d'affichage, où un lac
garde l'altitude de sa surface), `features` (une valeur de `TERRAIN_FEATURES` par
cellule : lac, marais, rivière, canyon, crique) et `rivers` (tracés de la source à la
mer, à un lac ou à un confluent, avec le débit relatif en chaque point). Les étapes
de forme 1 à 3 ne dépendent pas du relief : le contour des continents est identique
avec ou sans hydrologie.

Sur les planètes `tellurique` et `océanique` (`oceanBorder`), les terres restent
en pleine mer : la carte garde au moins 70 % d'eau, les masses sont placées loin des
bords et une bande d'eau libre longe toujours le bord de la carte. Les autres mondes
(arides, glacés, volcaniques) gardent leur propre couverture d'eau et peuvent toucher
le bord. `terrain.elevation` reste la hauteur canonique, avec la mer à 102. Un
changement de version du terrain conserve la graine, mais régénère la géographie
des sauvegardes.

## Matériaux du sol

Il n'y a pas de gisements localisés : chaque cellule mélange de la roche avec du fer,
du cuivre, de la silice, du carbone et, sous la mer, du pétrole (`terrain.materials` :
une part par cellule et par matériau, en octets ; la roche complète le reste ;
`OrbitWorld.materialsAt` renvoie les fractions d'une cellule). La table déclarative
`OrbitWorldgenData.terrain.materials` fixe pour chaque matériau une part de fond, une
part maximale et ses affinités avec le terrain :

- le **fer** se concentre dans les montagnes et les hautes terres ;
- le **carbone** dans les marais, les plaines et le long des rivières ;
- la **silice** sur les côtes, dans les régions sèches et les sables de rivière ;
- le **cuivre**, plus rare, sur les reliefs escarpés, les canyons, l'intérieur reculé
  et les îles ;
- le **pétrole** sur les plateaux continentaux, plus rarement en mer profonde.

La carte est découpée en zones (cellules de Voronoï déformées, environ 36 cellules de
large) : chaque zone multiplie chaque matériau par son propre facteur et favorise un
matériau signature, avec des frontières fondues. Des poches de bruit concentrent les
matériaux. Les lieux difficiles d'accès (pentes, sommets, intérieur reculé) et les
petites îles portent des poches plus riches. L'indice de richesse de chaque planète
(`planet.resources`) module l'ensemble. La planète natale garantit au moins une poche
riche de chaque matériau terrestre. Les ratios sont des premiers jets.

Les minerais terrestres suivent ensuite des **veines** (`materials.veins`) : pour
chaque matériau, les poches les plus riches, espacées entre elles, deviennent des
nœuds (deux à quatre selon la richesse de la planète) d'où partent deux à quatre filons,
lancés dans les deux sens de la direction des courbes de niveau locales. Chaque filon
avance sur la terre ferme (jamais dans un lac, une crique ou la mer) en s'infléchissant
vers les courbes de niveau, comme une strate ou une faille, s'affine vers sa pointe et
se ramifie rarement, sur deux niveaux au plus. Le sol traversé est enrichi dans le matériau du filon (la part des autres est
réduite pour rester sous le plafond de minerai). `terrain.materials.veins` (tracés en
cellules, force par point) et `terrain.materials.nodes` sont déterministes par graine.

À l'écran, les matériaux apparaissent en points lumineux de la couleur du matériau
dominant, plus fréquents et plus vifs là où il est concentré
(`OrbitSurfaceStyle.neon.materials`). Les veines restent une indication légère : un
trait fin de la couleur du matériau, à peine lumineux, plus marqué près du nœud ;
chaque nœud porte un petit halo, un anneau ténu et un centre clair. Une couche
cuite montre points et veines en vue d'ensemble ; au zoom, ils sont retracés à taille
d'écran constante. Le réglage développeur
**Ressources du sol** les masque, en attendant l'affichage par scan.

Le rendu suit une carte hypsométrique néon : chaque strate d'altitude
(`OrbitSurfaceStyle.neon.relief.bandStep`) a sa teinte, des basses terres magenta
sombre aux sommets rose pâle (jamais blancs, pour rester lisibles), séparée de la suivante par une ligne d'altitude
fine et discrète, toutes identiques, accompagnée de lignes intermédiaires plus pâles.
Les strates se lisent comme des feuilles de papier empilées : un léger dégradé
intérieur, une ombre diffuse qui s'estompe au pied de chaque marche du côté opposé à
la lumière et un liseré clair et doux sur l'arête éclairée, plus un ombrage directionnel doux des pentes
(lumière venant du nord-ouest). Une couche de micro-relief, purement visuelle
(`relief.detail`), sème par endroits de petits îlots qui surélèvent ou creusent
légèrement le terrain : un peu plus clairs ou plus sombres, peu ombrés et cernés
d'une fine ligne de contour, retracée en vecteur au zoom pour rester nette. Chaque
îlot est gardé entier ou écarté : il doit tenir dans une zone éparse, sur la terre
ferme, dans une seule strate et à l'écart de ses limites. Ils ne changent pas
l'altitude du jeu. La mer porte quelques isobathes discrètes. Le trait de
côte suit un champ lissé qui arrondit l'escalier des cellules (`neon.shoreSmoothing`)
sans faire disparaître les îlots d'une cellule. Les marais portent un motif de touffes discret. Les rivières
reprennent l'eau sombre de la mer avec un liseré léger ; seules celles qui drainent un
bassin assez grand sont dessinées (`water.riverMinFlow`). Le rendu reste volontairement
sobre pour laisser la place aux éléments de jeu. Au zoom, lignes
d'altitude, rivières et côte sont retracées en vecteurs. La palette se règle dans
`OrbitSurfaceStyle.neon` (`src/data/surfaceStyle.js`).

## Départ viable et sauvegardes

Le système natal conserve une étoile G, quatre à six planètes, au moins une
ceinture et une géante gazeuse. Sa deuxième planète est un candidat tempéré :
pression de 0,9 à 1,1 bar, gravité de 0,85 à 1,15 g, réserves d'eau et de
matières de base. Sa carte offre au moins une poche riche de fer, cuivre, silice et
carbone. `startingPlanetId` identifie ce candidat.

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
