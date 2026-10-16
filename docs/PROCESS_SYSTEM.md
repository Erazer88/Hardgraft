# Usine V1 — chaîne du fer

Cette référence décrit le graphe industriel actuellement chargé par l’application.
Elle remplace les anciennes hypothèses multi-ressources et les archives de
conception de `docs/reference/`.

## Modèle

Chaque machine possède un identifiant, un type, une position, des buffers entiers
d’entrée et de sortie, un état et la progression de son cycle. Les définitions
déclaratives dans `src/data/processes.js` indiquent ses ports nommés, sa recette,
son débit maximal d’entrée et sa consommation nominale en MW.

Une connexion a exactement cette forme :

```js
{
  id,
  fromMachineId,
  fromOutputId,
  toMachineId,
  toInputId
}
```

Une connexion ne possède pas de débit. Les transferts sont immédiats et déplacent
des unités entières dans les buffers. Les machines et leurs cycles déterminent le
débit de la chaîne. La V1 n’autorise ni boucles, ni mélange de matières, ni plusieurs
connexions sur le même port, sauf l'entrée partagée de la Poubelle.

Les machines de traitement gardent un buffer de 20 unités par port. Elles ne
terminent un cycle que si elles possèdent les ingrédients entiers de la recette et
de la place pour toutes leurs sorties. Un sous-produit bloqué remplit son buffer et
arrête le cycle sans perdre de matière. L'entrée partagée de la Poubelle utilise
également un buffer de 20 unités ; les unités y attendent leur cycle de destruction.

## Machines et recettes

Les débits sont les maxima nominaux niveau 1, en unités d’entrée par seconde.
Les consommations nominales sont des valeurs de départ à équilibrer.

| Machine | Entrée | Sortie(s) | Débit | Énergie |
| --- | --- | --- | ---: | ---: |
| Foreuse | Gisement de fer | 1 roche ferrifère brute | Sans plafond nominal | 2,5 MW |
| Concasseur | 1 roche ferrifère brute | 1 minerai concassé | 2 u/s | 2 MW |
| Broyeur | 1 minerai concassé | 1 minerai broyé | 2 u/s | 6 MW |
| Séparateur magnétique | 5 minerais broyés | 2 concentrés + 3 résidus | 2 u/s | 3 MW |
| Four de réduction | 2 concentrés | 1 fer brut + 1 laitier | 2 u/s | 10 MW |
| Poubelle | Toute ressource | Aucune, destruction par unité | 2 u/s | 0 MW |

La Foreuse ne limite pas le débit : elle fournit des unités entières à la capacité
de son premier consommateur. Le Concasseur niveau 1 constitue donc le premier
goulot de la chaîne complète. Tous les bâtiments sauf la Foreuse ont un débit
nominal de 2 u/s, identique au Concasseur niveau 1. Le minerai ferrifère n’est
disponible que sur un gisement de fer.

Le réducteur métallurgique du Four de réduction reste abstrait en V1. Il n’y a pas
de ressource carbone ni de consommable explicite pour cette recette.

La Poubelle accepte tout identifiant de ressource. Plusieurs sorties peuvent viser
son entrée partagée. Elle détruit les unités entières à 2 u/s, sans sortie ni
consommation électrique ; son buffer partagé applique une limite de capacité de 20
unités et transmet le blocage en amont lorsqu'il est plein.

## Cycle, débit et énergie

Une recette consomme et produit uniquement des quantités entières. Le cycle est
exprimé comme une progression de travail, pas comme une quantité de matière : une
machine à 2 u/s traite 1 unité toutes les 0,5 secondes. Le cycle de 5 unités du
Séparateur magnétique dure donc 2,5 secondes à débit nominal.

Le débit courant affiché suit la capacité soutenable de l’amont et le débit nominal
de la machine. La barre se remplit selon ce débit ; son animation est visuelle et ne
modifie pas la simulation. Pour la Foreuse, le débit nominal est illimité et la barre
représente la demande du consommateur aval.

Chaque machine indique l’énergie actuelle et sa valeur nominale (`MW / MW`). Il
n’existe ni câble ni réseau électrique interne. La puissance disponible vient du
système planétaire. L’énergie infinie des éoliennes terminées reste un mode temporaire
du prototype.

États visibles : `ACTIF`, `ATTENTE ENTRÉE`, `SORTIE PLEINE` et `SANS ÉNERGIE`.
Chaque carte montre le nom, ses matières d’entrée et de sortie, le débit courant,
la consommation, l’état et la progression du cycle. Les recettes détaillées et les
anciennes métadonnées ne sont pas exposées dans la carte.

## Sauvegardes

Les sauvegardes générales gardent leur version, les bâtiments, les routes, la graine
et la progression du jeu. Les graphes industriels antérieurs à la version 4 sont
volontairement réinitialisés ; ils ne sont pas convertis. Les graphes V1 et leurs
buffers sont sauvegardés avec leurs bâtiments.

La suppression d’une machine occupée est refusée jusqu’à ce que ses buffers soient
vides. La démolition d’un bâtiment rend les matières de ses buffers à l’inventaire
de matériaux de la colonie.

## Modules

| Fichier | Responsabilité |
| --- | --- |
| `src/data/processes.js` | Définitions, ports, recettes, débits et énergie |
| `src/data/resources.js` | Identifiants et noms des matières du jeu |
| `src/simulation/processGraph.js` | Création, validation, connexions et snapshots du graphe |
| `src/simulation/processSimulation.js` | Cycles entiers, transferts, énergie et débits soutenables |
| `src/gameplay/industry.js` | Gisements, puissance planétaire et raccord aux bâtiments |
| `src/ui/factoryViewport.js` | États d’interaction pan, déplacement, connexion et pinch |
| `src/ui/factoryEditor.js` | Cartes, ports, traits et palette de l’éditeur |
| `src/storage/save.js` | Préservation des sauvegardes générales et reset des graphes anciens |

La simulation ne dépend ni du DOM ni de Canvas. `factoryViewport.js` ne simule pas
de matière ; il fournit une caméra commune aux cartes et aux connexions, et émet les
gestes de l’éditeur.

## Vérifications

- Contrat du moteur : `node --test tests/process-simulation.test.cjs`.
- Sauvegardes générales et reset des graphes : `node --test tests/architecture.test.cjs`.
- Gestes réels de l’éditeur dans Chromium desktop et tactile : `npm run test:factory-editor`.
- Suite complète : `npm test`.
