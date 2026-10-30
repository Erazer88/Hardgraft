# Processus industriels — roche à composition

Cette référence décrit le graphe de processus actuellement chargé.

## Modèle

Chaque bâtiment industriel possède un graphe indépendant de cartes reliées par leurs
ports. Une connexion nomme ses deux machines et ses deux ports :

```js
{ id, fromMachineId, fromOutputId, toMachineId, toInputId }
```

Les connexions n'ont pas de débit indépendant. Elles transfèrent des unités entières
entre buffers ; les cycles des machines déterminent le débit. Les quantités de toutes
les recettes sont entières. Les boucles restent désactivées.

## Roche et composition

La Foreuse extrait de la **Roche brute** partout : chargée en minerai ou non, toute
roche est de la roche brute. Ce qu'elle contient suit le sol sous l'Extracteur
(`building.composition`, moyenne gaussienne sur 24 km ; le pétrole n'entre jamais dans
la roche). La roche reste une seule ressource à chaque étape : `raw_rock` (brute),
`crushed_rock` (concassée), `ground_rock` (broyée), `tailings` (résidus).

**Mémoire.** Une unité ne porte pas sa propre composition : chaque *stock* (port de
carte, inventaire de bâtiment, dock, file d'une porte de dépôt) garde une seule
composition moyenne par ressource, pondérée par ses unités (`inputMix`, `outputMix`,
`storedMix`, `inventoryMix`, `dockMix`, `gateMix`). Quand deux roches se mélangent, la
moyenne se recalcule ; un stock vide l'oublie. La mémoire dépend du nombre de stocks,
jamais du nombre d'unités en circulation (`src/simulation/composition.js`).

**Séparation.** Un séparateur prend un lot de roche broyée et en tire son matériau en
proportion de la teneur : `lot × teneur × 0,9` (`config.separation.recovery`). Les
fractions s'accumulent d'un cycle à l'autre (`yieldCredit`) pour sortir des unités
entières ; le reste du lot part en résidus, appauvris d'autant. Une roche sans fer ne
donne pas de concentré de fer.

## Cartes

| Carte | Entrée | Sortie | Débit | Énergie |
| --- | --- | --- | ---: | ---: |
| Foreuse (une par extracteur) | Sol de l'Extracteur | Roche brute (composition du sol) | 6 u/s | 2,5 MW |
| Concasseur | Roche brute | Roche concassée, 1:1 | 6 u/s | 2 MW |
| Broyeur | Roche concassée | Roche broyée, 1:1 | 6 u/s | 6 MW |
| Séparateur magnétique | 5 roches broyées | Concentré de fer selon la teneur + résidus | 6 u/s | 3 MW |
| Séparateur gravitaire | 5 roches broyées | Concentré de cuivre selon la teneur + résidus | 2 u/s | 3 MW |
| Trieuse de carbone | 5 roches broyées | Charbon selon la teneur + résidus | 2 u/s | 3 MW |
| Laveuse de silice | 20 roches broyées + 5 eaux | Silicium impur humide selon la teneur + résidus | 2 u/s | 3 MW |
| Sécheur de silice | Silicium impur humide | Silicium impur sec, 1:1 | 2 u/s | 4 MW |
| Lavage du charbon | 20 charbons + 5 eaux | 8 carbones + 12 boues | 2 u/s | 3 MW |
| Four de réduction · fer / cuivre / silice | 2 concentrés | 1 métal brut + 1 laitier | 2 u/s | 10 MW |
| Four à goudron | 4 roches concassées + 1 charbon | 1 goudron + 3 déchets | 2 u/s | 6 MW |
| Laminoir | 10 fers bruts | 1 plaque de métal | 2 u/s | 8 MW |
| Quai d'entrée | Stock reçu par route | Une matière choisie, 1:1 | Illimité (connecteur) | 0 MW |
| Dock de sortie | Une matière | Stock à envoyer par route | Illimité (connecteur) | 0 MW |
| Réserve d'eau | Réserve infinie temporaire | Eau | Sans plafond | 0 MW |
| Pompe pétrolière → Séparateur triphasé | Pétrole brut | 20 → 16 pétrole + 3 gaz + 1 déchet | 2 u/s | 2,5 / 4 MW |

Chaque carte a son bâtiment : l'Extracteur fore, concasse et broie sur place (Foreuse,
une seule par extracteur, Concasseur, Broyeur, Dock de sortie) ; l'Usine fait le reste
(Quai d'entrée, séparateurs, laveuses, sécheur, fours, four à goudron, laminoir,
Dock de sortie). Seuls les docks sont communs. Pour forer plus, on pose plusieurs
extracteurs côte à côte. Les cartes apparaissent selon les besoins de la
colonie (voir [`COLONY.md`](COLONY.md)) ; le réglage développeur « Tout débloquer »
les montre toutes.

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
| Porte d'entrée | Tire le stock reçu (`building.inventory`), à tour de rôle par ressource, sans limite de débit | — |
| Tampon | Garde jusqu'à 200 unités par ressource | — |
| Filtre | Ressource choisie → sortie 1, le reste → sortie 2 | Ressource filtrée |
| Répartiteur | Partage selon un pourcentage (10 à 90 %) | Part A/B |
| Priorité | Remplit la sortie prioritaire, puis déborde | — |
| Porte de sortie | Met les unités en file vers un bâtiment (`building.gateStock`), sans limite de débit | Destination |

Les autres cartes gardent au plus 20 unités. Le routage (`src/simulation/depotRouting.js`)
ne consomme pas d'énergie ; les réglages sont dans `machine.config` et sauvegardés.

**Terril.** Bâtiment qui reçoit les déchets par route. Cartes : Quai d'entrée,
Retraitement (10 résidus → 1 roche broyée qui garde leur composition, 4 MW),
Incinérateur (2 déchets/s brûlés, jusqu'à 8 MW rendus à la planète au prorata de son
débit) et Dock de sortie. La puissance de l'incinérateur suit son débit moyen sur environ
20 s (`generationSmoothingSeconds`, `machine.generatedMW` non sauvegardé) : une
alimentation irrégulière donne une puissance stable au lieu de l'allumer et l'éteindre. Pas de débordement ni de pollution pour l'instant. L'ancienne
carte Terril (stock illimité dans l'usine) reste dans les données mais n'est plus dans
aucun catalogue.

**Plateforme de lancement.** L'énergie d'un lancement croît avec la latitude :
`5 MW + 0,14 MW/°` (`launchSite` dans `src/data/orbitalLogistics.js`, la carte couvre
75° N à 75° S). Pendant sa pose ou sa sélection, une surcouche montre l'équateur, la
bande favorable de ±10°, les parallèles (15°) et les méridiens (30°) ; la balise affiche
la latitude et la puissance de lancement.

## Buffers, énergie et état

Les machines de traitement ont des buffers entiers de 20 unités par port. Un cycle ne
commence que si tous ses ingrédients entiers sont présents et s'il y a de la place pour
tous ses produits. Un sous-produit bloqué arrête donc le cycle sans perte de matière.
Une simulation avance au plus 100 pas de 0,1 s par appel (`maxTicksPerAdvance`).

**Docks et quais.** Ce sont des connecteurs logiques, sans limite de débit. Le Dock de
sortie accepte plusieurs connexions entrantes, toutes de la même matière, et déplace
les unités vers `building.dockStock` (distinct de l'inventaire reçu). Sa destination
est choisie par matière parmi la Colonie, les usines et terrils terminés équipés d'un
Quai d'entrée, les dépôts dotés d'une Porte d'entrée et les Plateformes de lancement
terminées de la planète, reliés par un chemin construit. Tant que sa matière n'a pas
de destination, il n'absorbe rien (état « SANS DESTINATION ») et ce qui l'alimente
s'arrête. Référence : [`ORBITAL_LOGISTICS.md`](ORBITAL_LOGISTICS.md).

Le Quai d'entrée rend un bâtiment disponible comme destination. Il affiche les
matières livrées dans `building.inventory` et possède une sortie `material` raccordable
aux machines. La première matière reçue est sélectionnée automatiquement ; le joueur
peut en choisir une autre lorsque le quai est débranché et son buffer vide. Plusieurs
quais partagent le même stock sans dupliquer les unités. Un quai peut alimenter plusieurs cartes : son stock se
partage à tour de rôle entre ses liaisons. Dans l'éditeur, le port partagé d'un quai
(sortie) ou d'un Dock de sortie (entrée) montre un point par liaison et un point libre
de plus. La Colonie et les Plateformes
de lancement reçoivent nativement, sans cette carte.

Dans l'éditeur, un Dock de sortie porte un bouton vers le bâtiment destinataire et un
Quai d'entrée un bouton vers ses bâtiments sources ; le changement de bâtiment se fait
par un court glissement.

**Lecture des cartes.** Chaque carte montre ses ports, son débit, son énergie, son état
et sa barre de traitement. États : `ACTIF`, `ATTENTE ENTRÉE`, `SORTIE PLEINE`,
`SANS ÉNERGIE`, `SANS DESTINATION`. L'affichage est lissé (un état actif est tenu
1,2 s, le débit lissé sur 0,7 s) pour ne pas clignoter à haut débit. La barre compte
les unités traitées par blocs et repart de zéro sans animation de retour : bloc de
1 u sous 100 u/s, puis 0,1 ku, 1 ku, 0,1 Mu… selon le débit (`BAR_BLOCKS`). Son libellé
donne « TRAITÉ / EXTRAIT / ENVOYÉ · total · BARRE bloc » ; un séparateur affiche aussi la
teneur moyenne de sa roche. L'affichage ne modifie pas la simulation.

## Énergie et prix

Chaque éolienne fournit 32 MW à sa planète ; le générateur de la colonie en fournit
12, de quoi faire tourner un ou deux bâtiments. La puissance se partage entre les plans
au prorata de leur demande ; une puissance insuffisante ralentit les cartes. Les prix
des bâtiments et des cartes restent dans les données mais sont masqués
(`construction.pricesEnabled: false`).

## Modules

| Fichier | Responsabilité |
| --- | --- |
| `src/data/processes.js` | Cartes, ports, recettes par matériau, débits et énergie |
| `src/data/resources.js` | Identifiants et noms des matières et sous-produits |
| `src/simulation/processGraph.js` | Création, validation, connexions et snapshots du graphe |
| `src/simulation/composition.js` | Composition moyenne de la roche par stock |
| `src/simulation/processSimulation.js` | Cycles entiers, transferts, rendements selon la teneur, énergie |
| `src/simulation/depotRouting.js` | Flux mixtes du dépôt : portes, tampon, filtre, répartiteur, priorité |
| `src/gameplay/industry.js` | Géologie, puissance planétaire et raccord aux bâtiments |
| `src/ui/factoryEditor.js` | Cartes, ports, traits, palette contextuelle, routage des Docks et lecture lissée |
| `src/ui/factoryViewport.js` | Gestes de la vue industrielle (glisser, pincer, molette) |
| `src/storage/save.js` | Sauvegarde des bâtiments et graphes industriels versionnés |

La simulation ne dépend ni du DOM ni de Canvas. La vérification ciblée du moteur est :

```sh
node --test tests/process-simulation.test.cjs
```

La suite complète est `npm test`. L'éditeur navigateur dispose de
`npm run test:factory-editor`.
