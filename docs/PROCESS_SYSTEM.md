# Processus industriels — filières par gisement

Cette référence décrit le graphe de processus actuellement chargé. Elle remplace
l'ancienne usine limitée au fer ; les graphes sauvegardés en version antérieure à 5
sont réinitialisés, tandis que les bâtiments et sauvegardes générales sont conservés.

## Modèle

Chaque bâtiment industriel possède un graphe indépendant. Son contexte géologique
identifie la matière du gisement ; chaque carte conserve aussi son `resourceId` afin
que ses ports et sa recette restent cohérents après sauvegarde. `OrbitProcessData.get`
résout la définition adaptée. Le Concasseur, le Broyeur et le Four de réduction gardent
les mêmes identifiants et noms dans toutes les filières solides, mais leurs matières
d'entrée et de sortie suivent le gisement.

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
| Foreuse | Gisement terrestre du bâtiment | Roche brute correspondante, sans plafond nominal | Sans plafond | 2,5 MW |
| Quai d'entrée | Réseau terrestre | Rend l'usine éligible comme destination d'un Dock de sortie | Réception agrégée | 0 MW |
| Concasseur | Roche brute du gisement | Minerai concassé, 1:1 | 2 u/s | 2 MW |
| Broyeur | Minerai concassé | Minerai broyé, 1:1 | 2 u/s | 6 MW |
| Four de réduction | Concentré adapté à la filière | Produit brut + laitier, ratio 2:1+1 | 2 u/s | 10 MW |
| Réserve d'eau | Réserve infinie temporaire de la colonie | Eau, sans consommation d'énergie | Sans plafond | 0 MW |
| Terril | Toute matière | Stocke les unités par ressource, sans limite | Sans débit | 0 MW |
| Dock de sortie | Une matière par carte | Transfert vers le stock local du bâtiment | 2 u/s | 0 MW |

Le débit 2 u/s est un maximum moyen ; les unités restent indivisibles et avancent par
cycles. La réserve d'eau est un apport auxiliaire temporaire, sans réseau de tuyaux.
Les réducteurs métallurgiques du Four sont abstraits : il ne consomme pas de carbone.

## Filières

| Gisement | Cartes de transformation | Recettes provisoires |
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

La Foreuse terrestre lit le `resourceId` du gisement du bâtiment : fer, cuivre, silice
ou carbone. La Plateforme pétrolière utilise une Pompe pétrolière dédiée et son
séparateur triphasé. La carte de Réserve d'eau ne mine pas un gisement : elle fournit
l'auxiliaire eau depuis la réserve infinie temporaire de la colonie.

## Buffers, énergie et état

Les machines de traitement ont des buffers entiers de 20 unités par port. Un cycle ne
commence que si tous ses ingrédients entiers sont présents et s'il y a de la place pour
tous ses produits. Un sous-produit bloqué arrête donc le cycle sans perte de matière.
Le Terril accepte plusieurs connexions sur son entrée partagée et stocke sans limite
chaque ressource reçue. Il n'a ni cycle ni débit et ses stocks sont enregistrés dans le
graphe. Le Dock conserve une seule connexion entrante pour identifier la matière exportée.
Le Quai d'entrée rend une usine disponible dans le menu de destination des Docks de
sortie. Les matières livrées restent dans l'inventaire du bâtiment ; elles ne sont pas
encore injectées dans les recettes du graphe. Les Plateformes de lancement reçoivent
nativement et n'ont pas besoin de cette carte.

Chaque carte montre les ports, le débit actuel, l'énergie, l'état et la progression du
cycle. États essentiels : `ACTIF`, `ATTENTE ENTRÉE`, `SORTIE PLEINE`, `SANS ÉNERGIE`.
L'animation de la barre ne modifie pas la simulation.

L'énergie reste simple : aucune ligne électrique interne. L'énergie infinie des
éoliennes terminées et la réserve d'eau infinie sont des modes temporaires du prototype.

Le Dock déplace les unités vers `building.dockStock`, distinct de l'inventaire reçu et
des matériaux de construction. La destination du Dock est choisie par matière parmi les
usines terminées équipées d'un Quai d'entrée et les Plateformes de lancement terminées
de la planète ; une route terrestre entièrement construite est nécessaire. Référence :
[`ORBITAL_LOGISTICS.md`](ORBITAL_LOGISTICS.md).

## Modules

| Fichier | Responsabilité |
| --- | --- |
| `src/data/processes.js` | Cartes, ports, recettes par gisement, débits et énergie |
| `src/data/resources.js` | Identifiants et noms des matières et sous-produits |
| `src/simulation/processGraph.js` | Création, validation, connexions et snapshots du graphe |
| `src/simulation/processSimulation.js` | Cycles entiers, transferts, énergie et débits soutenables |
| `src/gameplay/industry.js` | Géologie, puissance planétaire et raccord aux bâtiments |
| `src/ui/factoryEditor.js` | Cartes, ports, traits, palette contextuelle et routage des Docks |
| `src/storage/save.js` | Sauvegarde des bâtiments et graphes industriels versionnés |

La simulation ne dépend ni du DOM ni de Canvas. La vérification ciblée du moteur est :

```sh
node --test tests/process-simulation.test.cjs
```

La suite complète est `npm test`. L'éditeur navigateur dispose de
`npm run test:factory-editor`.
