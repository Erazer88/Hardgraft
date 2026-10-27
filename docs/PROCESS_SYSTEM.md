# Processus industriels — filières par matériau

Cette référence décrit le graphe de processus actuellement chargé. Elle remplace
l'ancienne usine limitée au fer ; les graphes sauvegardés en version antérieure à 5
sont réinitialisés, tandis que les bâtiments et sauvegardes générales sont conservés.

## Modèle

Chaque bâtiment industriel possède un graphe indépendant. Son contexte géologique
identifie le matériau extrait du sol sous le bâtiment ; chaque carte conserve aussi son `resourceId` afin
que ses ports et sa recette restent cohérents après sauvegarde. `OrbitProcessData.get`
résout la définition adaptée. Le Concasseur, le Broyeur et le Four de réduction gardent
les mêmes identifiants et noms dans toutes les filières solides, mais leurs matières
d'entrée et de sortie suivent ce matériau.

Une connexion nomme ses deux machines et ses deux ports :

```js
{ id, fromMachineId, fromOutputId, toMachineId, toInputId }
```

Les connexions n'ont pas de débit indépendant. Elles transfèrent des unités entières
entre buffers ; les cycles des machines déterminent le débit. Les quantités de toutes
les recettes sont entières. Les machines peuvent avoir plusieurs entrées et sorties.
Les boucles restent désactivées dans cette version, mais Concasseur et Broyeur sont des
cartes distinctes pour permettre des retours de matière dans une évolution ultérieure.

## Cartes communes

| Carte | Entrée | Sortie / comportement | Débit N1 | Énergie |
| --- | --- | --- | ---: | ---: |
| Foreuse | Sol sous le bâtiment | Roche brute du matériau dominant, sans plafond nominal | Sans plafond | 2,5 MW |
| Quai d'entrée | Stock reçu du réseau terrestre | Une matière choisie vers les machines, 1:1 | 2 u/s | 0 MW |
| Concasseur | Roche brute du matériau | Minerai concassé, 1:1 | 2 u/s | 2 MW |
| Broyeur | Minerai concassé | Minerai broyé, 1:1 | 2 u/s | 6 MW |
| Four de réduction | Concentré adapté à la filière | Produit brut + laitier, ratio 2:1+1 | 2 u/s | 10 MW |
| Réserve d'eau | Réserve infinie temporaire de la colonie | Eau, sans consommation d'énergie | Sans plafond | 0 MW |
| Terril (ancienne carte) | Toute matière | Conservée pour les anciens plans ; retirée des catalogues | Sans débit | 0 MW |
| Dock de sortie | Une matière par carte | Transfert vers le stock local du bâtiment | 2 u/s | 0 MW |

Le débit 2 u/s est un maximum moyen ; les unités restent indivisibles et avancent par
cycles. La réserve d'eau est un apport auxiliaire temporaire, sans réseau de tuyaux.
Les réducteurs métallurgiques du Four sont abstraits : il ne consomme pas de carbone.

## Filières

| Matériau | Cartes de transformation | Recettes provisoires |
| --- | --- | --- |
| Fer | Foreuse → Concasseur → Broyeur → Séparateur magnétique → Four de réduction | 5 broyés → 2 concentrés de fer + 3 résidus ; 2 concentrés → 1 fer brut + 1 laitier |
| Cuivre | Foreuse → Concasseur → Broyeur → Séparateur gravitaire → Four de réduction | 5 broyés → 2 concentrés de cuivre + 3 résidus ; 2 concentrés → 1 cuivre brut + 1 laitier |
| Silice | Foreuse → Concasseur → Broyeur → Laveuse de silice → Sécheur de silice → Four de réduction | 20 broyés + 5 eaux → 8 siliciums impurs humides + 12 boues ; séchage 1:1 ; 2 siliciums secs → 1 silicium brut + 1 laitier |
| Carbone | Foreuse → Concasseur → Broyeur → Trieuse de carbone → Lavage du charbon | 5 broyés → 2 charbons + 3 résidus ; 20 charbons + 5 eaux → 8 carbones + 12 boues |
| Pétrole marin | Pompe pétrolière → Séparateur triphasé | 20 pétrole brut → 16 pétrole + 3 gaz + 1 déchet |

Les filières solides reprennent pour l'instant le rendement de séparation du fer. Les
quantités de séchage sont conservées à 1:1. La séparation du pétrole garde son ratio
80/15/5. Les matières et sous-produits sont déclarés dans `src/data/resources.js` ; les
ports, recettes, débits et consommations se trouvent dans `src/data/processes.js`.

Il n'y a plus de gisements : un Extracteur se pose librement sur la terre ferme et
enregistre la composition moyenne du sol qu'il draine (`composition`) : une moyenne
pondérée (gaussienne) sur sa zone de captage (`catchmentRadius`, 24 km ; 30 km pour une
plateforme), si bien que le déplacer de quelques kilomètres change à peine son rendement.
Il en déduit le
matériau exploitable le plus présent (`resourceId` : fer, cuivre, silice ou carbone) et
sa part (`resourceShare`). L'interface n'affiche que des estimations (« ≈ 15 % », par pas
de 5 % au-dessus de 10 %, de 1 % en dessous). La Foreuse lit ce `resourceId`. Une Plateforme pétrolière se
pose librement en mer profonde, enregistre la part de pétrole du fond et utilise une
Pompe pétrolière dédiée et son séparateur triphasé. La part ne modifie pas encore le
débit : les rendements seront calibrés plus tard. La carte de Réserve d'eau ne mine pas le sol : elle fournit
l'auxiliaire eau depuis la réserve infinie temporaire de la colonie.

## Bâtiments spécialisés

**Station de pompage.** Elle se pose sur la terre ferme à moins de 30 km d'une eau
(`placementRules.shoreRequired`, `shoreReach`). L'eau la plus proche décide de son
`resourceId` : mer et criques → `salt_water` (Eau salée), lacs et rivières → `water`
(Eau douce). Cartes : Pompe (même carte pour toute eau, débit selon l'eau :
`config.waterPump`, salée 4 u/s · 3 MW, douce 1,5 u/s · 2 MW, valeurs provisoires),
Dessalinisateur (4 eau salée → 3 eau douce + 1 saumure, 6 MW, en mer seulement) et
Dock de sortie. L'eau circule par la route comme les autres matières.

**Dépôt.** Il reçoit tout ce qu'on lui envoie et le répartit. Ses cartes transportent un
flux mixte (ports `mixed`, reliables uniquement entre cartes du dépôt ; une entrée mixte
accepte plusieurs liens) et gardent leurs unités dans `storedResources` :

| Carte | Rôle | Réglage |
| --- | --- | --- |
| Porte d'entrée | Tire le stock reçu (`building.inventory`), à tour de rôle par ressource, 4 u/s | — |
| Tampon | Garde jusqu'à 200 unités par ressource | — |
| Filtre | Ressource choisie → sortie 1, le reste → sortie 2 | Ressource filtrée |
| Répartiteur | Partage selon un pourcentage (10 à 90 %) | Part A/B |
| Priorité | Remplit la sortie prioritaire, puis déborde | — |
| Porte de sortie | Met les unités en file vers un bâtiment (`building.gateStock`), 4 u/s | Destination |

Les autres cartes gardent au plus 20 unités. Le routage (`src/simulation/depotRouting.js`)
ne consomme pas d'énergie ; les réglages sont dans `machine.config` et sauvegardés.

**Terril.** C'est un bâtiment qui reçoit les déchets par route (Quai d'entrée). Ses
cartes : Retraitement par filière (fer, cuivre, silice, carbone : 10 déchets contenant le
matériau → 1 minerai broyé, 4 MW) ou Incinérateur (2 déchets/s brûlés, produit jusqu'à
8 MW pour la planète, proportionnellement à son débit). Pas de débordement ni de
pollution pour l'instant.

**Plateforme de lancement.** L'énergie d'un lancement croît avec la latitude :
`5 MW + 0,14 MW/°` (`launchSite` dans `src/data/orbitalLogistics.js`, la carte couvre
75° N à 75° S). Pendant sa pose ou sa sélection, une surcouche montre l'équateur, la
bande favorable de ±10°, les parallèles (15°) et les méridiens (30°) ; la balise affiche
la latitude et la puissance de lancement.

## Buffers, énergie et état

Les machines de traitement ont des buffers entiers de 20 unités par port. Un cycle ne
commence que si tous ses ingrédients entiers sont présents et s'il y a de la place pour
tous ses produits. Un sous-produit bloqué arrête donc le cycle sans perte de matière.
Le Terril accepte plusieurs connexions sur son entrée partagée et stocke sans limite
chaque ressource reçue. Il n'a ni cycle ni débit et ses stocks sont enregistrés dans le
graphe. Le Dock conserve une seule connexion entrante pour identifier la matière exportée.
Le Quai d'entrée rend une usine disponible dans le menu de destination des Docks de
sortie. Il affiche les matières livrées dans `building.inventory` et possède une sortie
`material` raccordable aux machines. La première matière reçue est sélectionnée
automatiquement ; le joueur peut choisir une autre matière du stock lorsque le quai
est débranché et son buffer vide. Le quai retire une unité du stock par cycle de 0,5 s,
uniquement s'il est relié et dispose de place en aval. Plusieurs quais partagent le même
stock sans dupliquer les unités. La matière sélectionnée et le buffer sont sauvegardés.
Le catalogue des nouvelles machines suit la filière du premier quai configuré, sans
modifier les recettes des machines déjà posées ni changer le matériau du sol.
Les Plateformes de lancement reçoivent nativement et n'ont pas besoin de cette carte.

Chaque carte montre les ports, le débit actuel, l'énergie, l'état et la progression du
cycle. États essentiels : `ACTIF`, `ATTENTE ENTRÉE`, `SORTIE PLEINE`, `SANS ÉNERGIE`.
L'animation de la barre ne modifie pas la simulation.

L'énergie reste simple : aucune ligne électrique interne. Chaque éolienne terminée
fournit 32 MW à la planète, partagés entre les plans au prorata de leur demande ; une
puissance insuffisante ralentit les cartes. La réserve d'eau infinie reste un mode
temporaire du prototype.

Le Dock déplace les unités vers `building.dockStock`, distinct de l'inventaire reçu et
des matériaux de construction. La destination du Dock est choisie par matière parmi les
usines et terrils terminés équipés d'un Quai d'entrée, les dépôts dotés d'une Porte
d'entrée et les Plateformes de lancement terminées de la planète ; une route terrestre entièrement construite est nécessaire. Référence :
[`ORBITAL_LOGISTICS.md`](ORBITAL_LOGISTICS.md).

## Équilibrage du début de partie

Objectif : environ 30 minutes de jeu avant le premier envoi à l'Arche. La colonie vit
d'abord de sa base de débarquement ; la plateforme de lancement est le premier grand
projet, qui demande les quatre matériaux.

**Prix masqués pour l'instant** (`construction.pricesEnabled: false` dans
`src/data/buildings.js`) : bâtiments et cartes ne coûtent rien et aucun prix n'est
affiché. Les valeurs ci-dessous restent dans les données comme référence ; tant
qu'elles sont masquées, rien ne retarde la plateforme et l'objectif des 30 minutes
n'est pas tenu. Il n'y a plus de hausse de prix par exemplaire.

- **Stock de débarquement** (`startingInventory`) : 120 fer, 60 cuivre, 0 silice,
  6 carbone. De quoi poser une éolienne, une filière fer et une filière cuivre dans
  leurs extracteurs. La silice et le carbone viennent de filières à monter.
- **Base de débarquement** (gratuite, une par planète, 10 s) : ce qu'on lui livre par
  route (Dock de sortie → base) devient du stock de construction pour les métaux bruts
  et le carbone (`constructionCredits`, 1 pour 1). Le reste (résidus, minerais) reste
  dans la base. L'Arche convertit de la même façon ce qu'elle reçoit.
- **Bâtiments** (`src/data/buildings.js`) : coût de référence et durée d'assemblage ; la
  démolition rend ce qui a été payé. Deux équipes de robots (`construction.crews`) :
  deux chantiers avancent à la fois.

| Bâtiment | Coût de référence (masqué) | Assemblage |
| --- | --- | ---: |
| Base de débarquement | gratuite | 10 s |
| Éolienne | 12 fer, 8 cuivre, 2 carbone | 20 s |
| Extracteur | 18 fer, 8 cuivre | 30 s |
| Usine | 35 fer, 16 cuivre, 8 silice | 45 s |
| Plateforme de lancement | 350 fer, 250 cuivre, 150 silice, 80 carbone | 90 s |
| Dépôt | 12 fer, 4 cuivre | 20 s |
| Station de pompage | 14 fer, 6 cuivre | 25 s |
| Terril | 8 fer | 15 s |
| Port | 24 fer, 12 cuivre | 40 s |
| Plateforme pétrolière | 40 fer, 20 cuivre, 10 silice | 60 s |

- **Cartes** (`cardCosts` dans `src/data/processes.js`) : payées à l'ajout, remboursées au
  retrait ou à la démolition (`building.cardCostPaid`). Une filière fer complète
  (foreuse, concasseur, broyeur, séparateur, four, trois docks pour le produit, les
  résidus et le laitier) coûte 33 fer et 12 cuivre.
- **Énergie** : une filière consomme 16,5 à 27,5 MW, une éolienne en fournit 32. Le
  carbone de départ ne paie que deux éoliennes : la filière carbone vient tôt.
- **Revenu** : une filière fer, cuivre ou silice produit 0,4 u/s (≈ 24/min), une
  filière carbone ≈ 0,32 u/s.
- **Repères** : premier fer crédité par la base moins de 2 minutes après le
  débarquement (joueur instantané, testé). Un modèle de joueur efficace (filières
  ajoutées dès qu'elles sont payables, éoliennes au besoin, 30 s à 2 min de
  manipulation par filière) paierait la plateforme en une demi-heure environ ; ce
  calcul supposait aussi une hausse de 30 % par exemplaire, retirée depuis. À refaire
  quand les prix reviendront.

Ces valeurs sont un premier réglage, à affiner en jouant.

## Modules

| Fichier | Responsabilité |
| --- | --- |
| `src/data/processes.js` | Cartes, ports, recettes par matériau, débits et énergie |
| `src/data/resources.js` | Identifiants et noms des matières et sous-produits |
| `src/simulation/processGraph.js` | Création, validation, connexions et snapshots du graphe |
| `src/simulation/processSimulation.js` | Cycles entiers, transferts, énergie et débits soutenables |
| `src/simulation/depotRouting.js` | Flux mixtes du dépôt : portes, tampon, filtre, répartiteur, priorité |
| `src/gameplay/industry.js` | Géologie, puissance planétaire et raccord aux bâtiments |
| `src/ui/factoryEditor.js` | Cartes, ports, traits, palette contextuelle et routage des Docks |
| `src/storage/save.js` | Sauvegarde des bâtiments et graphes industriels versionnés |

La simulation ne dépend ni du DOM ni de Canvas. La vérification ciblée du moteur est :

```sh
node --test tests/process-simulation.test.cjs
```

La suite complète est `npm test`. L'éditeur navigateur dispose de
`npm run test:factory-editor`.
