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
| Foreuse | Sol de l'Extracteur | Roche brute (composition du sol) | Sans plafond | 2,5 MW |
| Concasseur | Roche brute | Roche concassée, 1:1 | 2 u/s | 2 MW |
| Broyeur | Roche concassée | Roche broyée, 1:1 | 2 u/s | 6 MW |
| Séparateur magnétique | 5 roches broyées | Concentré de fer selon la teneur + résidus | 2 u/s | 3 MW |
| Séparateur gravitaire | 5 roches broyées | Concentré de cuivre selon la teneur + résidus | 2 u/s | 3 MW |
| Trieuse de carbone | 5 roches broyées | Charbon selon la teneur + résidus | 2 u/s | 3 MW |
| Laveuse de silice | 20 roches broyées + 5 eaux | Silicium impur humide selon la teneur + résidus | 2 u/s | 3 MW |
| Sécheur de silice | Silicium impur humide | Silicium impur sec, 1:1 | 2 u/s | 4 MW |
| Lavage du charbon | 20 charbons + 5 eaux | 8 carbones + 12 boues | 2 u/s | 3 MW |
| Four de réduction · fer / cuivre / silice | 2 concentrés | 1 métal brut + 1 laitier | 2 u/s | 10 MW |
| Four à goudron | 4 roches concassées + 1 charbon | 1 goudron + 3 déchets | 2 u/s | 6 MW |
| Laminoir | 10 fers bruts | 1 plaque de métal | 2 u/s | 8 MW |
| Quai d'entrée | Stock reçu par route | Une matière choisie, 1:1 | 2 u/s | 0 MW |
| Dock de sortie | Une matière | Stock à envoyer par route | 2 u/s | 0 MW |
| Réserve d'eau | Réserve infinie temporaire | Eau | Sans plafond | 0 MW |
| Pompe pétrolière → Séparateur triphasé | Pétrole brut | 20 → 16 pétrole + 3 gaz + 1 déchet | 2 u/s | 2,5 / 4 MW |

Seul l'Extracteur fore ; l'Usine reçoit par son Quai d'entrée. Les deux proposent les
mêmes cartes de transformation. Les cartes apparaissent selon les besoins de la
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
| Porte d'entrée | Tire le stock reçu (`building.inventory`), à tour de rôle par ressource, 4 u/s | — |
| Tampon | Garde jusqu'à 200 unités par ressource | — |
| Filtre | Ressource choisie → sortie 1, le reste → sortie 2 | Ressource filtrée |
| Répartiteur | Partage selon un pourcentage (10 à 90 %) | Part A/B |
| Priorité | Remplit la sortie prioritaire, puis déborde | — |
| Porte de sortie | Met les unités en file vers un bâtiment (`building.gateStock`), 4 u/s | Destination |

Les autres cartes gardent au plus 20 unités. Le routage (`src/simulation/depotRouting.js`)
ne consomme pas d'énergie ; les réglages sont dans `machine.config` et sauvegardés.

**Terril.** C'est un bâtiment qui reçoit les déchets par route (Quai d'entrée). Ses
cartes : Retraitement (10 résidus → 1 roche broyée qui garde leur composition, 4 MW) ou
Incinérateur (2 déchets/s brûlés, produit jusqu'à
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
graphe. Le Dock accepte plusieurs connexions entrantes, toutes de la même matière, qu'il exporte.
Le Quai d'entrée rend une usine disponible dans le menu de destination des Docks de
sortie. Il affiche les matières livrées dans `building.inventory` et possède une sortie
`material` raccordable aux machines. La première matière reçue est sélectionnée
automatiquement ; le joueur peut choisir une autre matière du stock lorsque le quai
est débranché et son buffer vide. Le quai retire une unité du stock par cycle de 0,5 s,
uniquement s'il est relié et dispose de place en aval. Plusieurs quais partagent le même
stock sans dupliquer les unités. La matière sélectionnée et le buffer sont sauvegardés.
Les Plateformes de lancement et la Colonie reçoivent nativement et n'ont pas besoin de
cette carte.

Chaque carte montre les ports, le débit actuel, l'énergie, l'état et la progression du
cycle. États essentiels : `ACTIF`, `ATTENTE ENTRÉE`, `SORTIE PLEINE`, `SANS ÉNERGIE`.
L'animation de la barre ne modifie pas la simulation.

Le Dock déplace les unités vers `building.dockStock`, distinct de l'inventaire reçu et
des matériaux de construction. La destination du Dock est choisie par matière parmi la
Colonie, les usines et terrils terminés équipés d'un Quai d'entrée, les dépôts dotés
d'une Porte d'entrée et les Plateformes de lancement terminées de la planète ; une route terrestre entièrement construite est nécessaire. Référence :
[`ORBITAL_LOGISTICS.md`](ORBITAL_LOGISTICS.md).

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
| `src/ui/factoryEditor.js` | Cartes, ports, traits, palette contextuelle et routage des Docks |
| `src/storage/save.js` | Sauvegarde des bâtiments et graphes industriels versionnés |

La simulation ne dépend ni du DOM ni de Canvas. La vérification ciblée du moteur est :

```sh
node --test tests/process-simulation.test.cjs
```

La suite complète est `npm test`. L'éditeur navigateur dispose de
`npm run test:factory-editor`.
