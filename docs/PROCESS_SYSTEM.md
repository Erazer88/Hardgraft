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
| Porte d'entrée | Tire tout le stock reçu (`building.inventory`), à tour de rôle par ressource, sans limite de débit ; note le nom de chaque ressource passée (`machine.transited`, sauvegardé) | — |
| Stockage | Garde jusqu'à 1 000 unités en tout (`depot.bufferCapacity`) ; 15 MW en permanence, sans énergie il n'accepte ni ne rend rien | — |
| Filtre | Ressource choisie → sortie 1, le reste → sortie 2 | Ressource filtrée |
| Répartiteur | Partage selon un pourcentage (10 à 90 %) | Part A/B |
| Priorité | Remplit la sortie prioritaire, puis déborde | — |
| Porte de sortie | Met les unités en file vers un bâtiment (`building.gateStock`), sans limite de débit | Destination |

Une seule Porte d'entrée suffit pour tout ce que reçoit le dépôt ; le tri se fait
ensuite avec les filtres. Les autres cartes gardent au plus 20 unités. Seules les cartes Stockage consomment de
l'énergie (`constantEnergy`, demande du dépôt comptée avec la planète,
`OrbitDepotRouting.demand`) ; les réglages sont dans `machine.config` et sauvegardés.

**Terril.** Bâtiment qui reçoit les déchets par route. Cartes : Quai d'entrée,
Retraitement (10 résidus → 1 roche broyée qui garde leur composition, 4 MW),
Incinérateur (4 MW par déchet brûlé chaque seconde, `generatedMWPerUnit`, jusqu'à 8 MW
par carte), Stockage et Dock de sortie. Retraitement et Incinérateur sont immédiats
(`instant: true`, sans débit propre) : tout ce qui leur arrive est traité dans le pas de
simulation, au plus un buffer d'entrée plein (20 u) par pas de 0,1 s ; ils comptent les
unités reçues (`machine.movedTotal`) pour leur débit affiché, moyen sur 5 s. La
puissance de l'incinérateur suit ce qu'il a réellement brûlé, lissé sur environ 20 s
(`generationSmoothingSeconds`, `machine.burningMW` puis `machine.generatedMW` plafonné,
non sauvegardés) : une
alimentation irrégulière donne une puissance stable au lieu de l'allumer et l'éteindre.
La carte Stockage (id `terril`, ex-carte Terril des usines) garde sans limite tout ce
qu'on lui relie, typiquement la roche broyée du Retraitement (`storesResources`,
`machine.storedResources`, sauvegardé) ; ce stock s'affiche sur la fiche du bâtiment et
ne ressort pas. Pas de débordement ni de pollution pour l'instant.

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

**Docks et quais.** Ce sont des connecteurs logiques, sans limite de débit, qui gardent
au plus `config.dockCapacity` (100) unités par ressource. Le Dock de
sortie accepte plusieurs connexions entrantes, toutes de la même matière, et déplace
les unités vers `building.dockStock` (distinct de l'inventaire reçu) tant que ce stock
n'a pas atteint 100 ; au-delà il se remplit et arrête l'amont. De même, la logistique
ne livre à un bâtiment à cartes que ce qui manque pour atteindre 100 u de chaque
ressource reçue (`building.inventory`) ; le reste attend au Dock source. La Colonie et
la Plateforme de lancement reçoivent tout. Sa destination
est choisie par matière parmi la Colonie, les usines, terrils et dépôts terminés et les
Plateformes de lancement terminées de la planète, reliés par un chemin construit ; la
carte d'entrée d'une usine, d'un terril ou d'un dépôt se crée d'elle-même (ci-dessous). Tant que sa matière n'a pas
de destination, il n'absorbe rien (état « SANS DESTINATION ») et ce qui l'alimente
s'arrête. Référence : [`ORBITAL_LOGISTICS.md`](ORBITAL_LOGISTICS.md).

**Cartes d'entrée** (`src/gameplay/entryGates.js`). Un Quai d'entrée (usine, terril)
fait entrer une seule ressource (`importResourceId`) : une usine ou un terril ne reçoit
par route que les ressources qui ont leur quai (`hasReceivingDock(state, building,
resourceId)`). Un dépôt reçoit tout par sa Porte d'entrée. Le joueur peut poser ces
cartes depuis « Ajouter un bloc » : un quai posé sans ressource est libre. Quand on
choisit une usine ou un terril comme destination d'un Dock de sortie ou d'une Porte de
sortie de dépôt, chaque ressource envoyée prend le quai déjà réglé sur elle, sinon un
quai libre (qui s'y lie), sinon un quai créé par le jeu (`autoEntry`) ; pour une Porte
de sortie, les ressources envoyées sont celles de sa file et celles déjà livrées
(`receivedFrom`). Un dépôt choisi comme destination reçoit une Porte d'entrée s'il n'en
a pas. Les cartes créées par le jeu disparaissent quand plus rien ne leur est envoyé ;
celles du joueur restent. Supprimer une carte d'entrée à la main ne supprime
pas les Docks ou Portes de sortie qui l'alimentaient : leur destination est seulement
effacée. La synchronisation se fait à chaque choix de destination, à chaque démolition
et toutes les 2 s.

Le Quai d'entrée affiche les matières livrées dans `building.inventory` et possède une sortie `material` raccordable
aux machines. Le joueur peut changer sa ressource (parmi celles reçues) lorsque la
carte est débranchée et vide. Plusieurs
quais partagent le même stock sans dupliquer les unités. Un quai peut alimenter
plusieurs cartes : son stock se partage à tour de rôle entre ses liaisons. Dans l'éditeur, le port partagé d'un quai
(sortie) ou d'un Dock de sortie (entrée) montre un point par liaison et un point libre
de plus. La Colonie et les Plateformes
de lancement reçoivent nativement, sans cette carte.

Dans l'éditeur, un Dock de sortie porte un bouton vers le bâtiment destinataire, un
Quai d'entrée sa « RESSOURCE » et des boutons vers les bâtiments qui la lui envoient, la
Porte d'entrée d'un dépôt sa « PROVENANCE » (tous les bâtiments qui lui envoient quelque
chose) et le nom des ressources passées ; le changement de
bâtiment se fait par un court glissement.

**Blueprints.** Le bouton « BLUEPRINTS », à côté d'« AJOUTER UN BLOC », liste les plans
enregistrés. « Sélectionner une région » passe en mode sélection : un glisser trace un
rectangle, les cartes touchées sont retenues avec leurs liaisons internes et leurs
réglages (filtres, quais), puis enregistrées sous un nom. Toucher un blueprint pose,
au centre de la vue et à l'écart des cartes présentes, celles de ses cartes que le
catalogue du bâtiment accepte (déblocage et limite par bâtiment compris). Les blueprints
vivent dans la bibliothèque du joueur (`src/storage/library.js`), à part de la
sauvegarde, et survivent à une nouvelle partie.

**Bâtiments enregistrés.** Sur la fiche d'un bâtiment à cartes (usine, extracteur, terril, dépôt, station de pompage, datacenter…), « ENREGISTRER » copie son type,
son nom et ses cartes (sans stocks ni destinations) sous le filtre « ENREGISTRÉS » du
menu Construction. Le poser crée le bâtiment avec ce nom (numéroté s'il est déjà pris) et ses
cartes ; seules restent celles que son catalogue accepte à cet endroit.

**Lecture des cartes.** Chaque carte montre ses ports, puis son état et son débit sur
une ligne (« 0,8 / 6 u/s », ou « 2 u/s » sans plafond), une large barre bleue, sa
puissance (« ⚡ 3 MW », ambre en manque d'énergie, « +x / 8 MW » pour un générateur) et
une note : stock d'un quai (« Stock 45 / 100 u »), teneur d'un séparateur, charge d'une
carte de dépôt. États : `ACTIF`, `ATTENTE ENTRÉE`, `SORTIE PLEINE`, `SANS ÉNERGIE`,
`SANS DESTINATION`. L'affichage est lissé (un état actif est tenu 1,2 s, le débit lissé
sur 0,7 s) pour ne pas clignoter à haut débit. Quais d'entrée, Docks de sortie et Portes
de dépôt, qui passent leurs unités par à-coups, affichent plutôt le débit moyen des
5 dernières secondes, mis à jour toutes les 5 s (première valeur après 1 s), calculé sur
le compteur d'unités passées `machine.movedTotal` (non sauvegardé). La barre compte les
unités par blocs et repart de zéro sans animation de retour : bloc de 1 u sous
100 u/s, puis 0,1 ku, 1 ku, 0,1 Mu… selon le débit (`BAR_BLOCKS`) ; le remplissage d'un
quai sur 100 reste dans sa note. Les liaisons sont des courbes ou
des angles droits arrondis (bouton de l'en-tête de l'éditeur, gardé dans le
navigateur). L'affichage ne modifie pas la simulation.

**Teneurs.** Un séparateur crédite, à chaque lot, lot × teneur × 90 % de son matériau
et en sort les unités entières (la fraction attend dans `yieldCredit`) ; ses résidus
perdent exactement cette part récupérée, si bien que concentré + crédit + métal des
résidus = métal entré. Exemple à 30 % de fer : 100 roches broyées donnent 27
concentrés et 73 résidus à ≈ 4,1 % de fer ; 27 concentrés font 13 fers bruts (2:1),
puis une plaque par 10 fers.

## Énergie et prix

Chaque éolienne fournit environ 32 MW à sa planète, multipliés par le **vent de son
site** et par son **sillage** (`src/simulation/windPower.js`, réglages `config.wind`) :

- Le site (`building.windSite`, recalculé dès que le terrain est connu) part de la
  **qualité** du lieu : son ouverture (1 − écart-type des altitudes des terres dans un
  rayon de 15 km / 350 m ; la mer ne compte pas), relevée par l'altitude là où c'est
  ouvert (jusqu'à +25 % à 3 000 m). Sous une qualité de 0,4, le vent est quasi nul
  (×0,02) ; il monte ensuite lentement (au carré) jusqu'à ×1,5 pour une qualité de
  1,05 : seules les grandes plaines bien dégagées et les hauts plateaux rapportent.
  Sur la planète de départ, la moitié des terres donne presque rien (médiane ×0,05)
  et les 10 % les plus dégagés ×0,9 et plus.
- Le sillage : une éolienne à moins de 140 km d'une autre perd 50 % de son vent à
  l'entrée du sillage, jusqu'à 95 % juste à côté (linéaire entre les deux,
  `wakeLossAtEdge` / `wakeLossAtCenter`) ; plusieurs sillages se cumulent, chacun
  prenant sa part de ce qui reste. Au-delà de 140 km, rien n'est perdu.
- À la pose ou à la sélection, la vue vent colore toute la planète en transparence,
  en dégradé selon le vent du site : rouge vers zéro, orange, jaune pâle presque
  transparent vers ×0,55, puis vert de plus en plus franc à partir de ×0,85 ;
  les cercles de sillage des éoliennes existantes sont en pointillés. Le texte sous
  l'aperçu donne « Vent ×1,2 · sillage −15 % · ≈ 33 MW », la fiche le vent du site et
  le sillage. Les éoliennes posées avant reçoivent leur site dès que le terrain de leur
  planète est connu.

Le générateur de la colonie fournit 12 MW, de quoi faire tourner un ou deux bâtiments. La puissance se partage entre les plans
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
| `src/simulation/depotRouting.js` | Flux mixtes du dépôt : portes, stockage, filtre, répartiteur, priorité |
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
