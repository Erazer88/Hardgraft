# Processus industriels — contrat du moteur

Référence spécialisée sur l'implémentation actuelle des graphes, recettes et cycles.
Pour le contexte global, les systèmes temporaires et le choix du test par tâche, voir
[`CURRENT_CONTEXT.md`](CURRENT_CONTEXT.md) et `AGENTS.md`. Les versions datées plus
bas conservent l'historique des décisions ; elles ne définissent pas le workflow.

## Décisions validées

- Modes temporaires du prototype : réserve de la colonie infinie, y compris pour les
  coûts de construction. Le modèle économique cible est un stock limité par réseau local.
- Une éolienne terminée fournit actuellement une puissance illimitée à sa planète. Sans
  générateur, les traitements consommateurs restent SANS ÉNERGIE.
- L'approvisionnement manuel remplit le stock d'entrée du bâtiment depuis cette
  réserve. Un bloc Entrée, avec un filtre matière, alimente ensuite un seul flux.
- Le quai remplit un stock de sortie limité. Il ne livre pas automatiquement la
  colonie ni un autre bâtiment : la logistique extérieure reste une étape suivante.
- Le terril est une poubelle à capacité et débit de traitement illimités : chaque
  unité solide reçue est immédiatement conservée dans son historique de déchets,
  avec sa composition. Son entrée ne limite pas le débit ; la capacité de la source
  et la limite de sécurité globale des transferts continuent de s'appliquer.
- Analyse qualité figure dans les données et le catalogue, mais reste désactivé.
  Le purificateur et le raffinage pétrolier avancé ne sont pas implémentés.

Les réglages temporaires se trouvent dans `OrbitProcessData.config` :
`colonyReserveInfinite`, `windPowerUnlimited`, capacités, pas de simulation,
limites de transferts et modificateurs technologiques. Aucune valeur `Infinity`
n'est enregistrée en JSON : la puissance illimitée utilise un booléen.

## Organisation

| Fichier | Responsabilité |
| --- | --- |
| `src/data/resources.js` | Ressources canoniques, phases, familles, tags et compositions par défaut |
| `src/data/processes.js` | Ports, blocs, recettes, compatibilité et paramètres de V1 |
| `src/simulation/resourceStack.js` | Création, portions, fusion de métadonnées et opérations sur stocks |
| `src/simulation/processGraph.js` | Modèles, validation structurelle/physique, capacités, snapshots et récupération |
| `src/simulation/recipeResolver.js` | Résolution pure des recettes et de leurs variantes |
| `src/simulation/processSimulation.js` | Cycles, réservations, énergie et transferts transactionnels |
| `src/gameplay/industry.js` | Gisements, réserve, puissance planétaire et raccord aux bâtiments |
| `src/ui/factoryEditor.js` | Placement et connexion existants, affichage et réglages des blocs |

Les modules de simulation ne dépendent ni du DOM ni du Canvas. La boucle
d'application appelle `OrbitIndustry.advance(state, seconds)` ; l'éditeur
affiche l'état courant et ne fait pas tourner son propre moteur.

## Matières

Chaque stack possède `resourceId`, `amount`, `quality`, `moisture`,
`particleSize`, `origin`, `tags`, `composition`, `recoverableFraction` et
`reprocessingPasses`.

- Les qualités sont `impure`, `standard`, `superior`.
- Les tailles sont `raw`, `oversized`, `fragment`, `calibrated`, `powder`.
- Les phases physiques viennent des ressources : solide, liquide ou gaz.
- L'humidité est un attribut de préparation, pas une quantité d'eau implicite.
  L'eau consommée par une laveuse est une matière séparée, comptée dans les boues.
- Les compositions sont des fractions massiques normalisées, complétées par une
  fraction stérile. Les métaux extraits possèdent leur composition élémentaire.
- La fusion conserve la qualité la plus basse et pondère humidité, composition
  et fraction récupérable par les quantités. Les origines différentes deviennent
  une origine mixte ; la taille la plus grossière est retenue par prudence.

Les anciens identifiants `iron`, `copper`, `silicon` restent à la frontière des
coûts de construction et des gisements. Leur conversion en stacks donne
`standard_iron`, `standard_copper`, `standard_silicon`. L'inventaire numérique de
construction est conservé pour compatibilité ; les matières industrielles et
les matières récupérées à la démolition utilisent les stacks communs.

## Graphe et API

`OrbitProcessGraph.create(plan)` migre et restaure un graphe. Ses champs principaux
sont `nodes`, `connections`, `externalStock`, `exportStock`, `retainedWaste`,
`geology`, `technologyLevel`, les compteurs temporels et les valeurs d'énergie.

Un bloc contient ses ports déclaratifs, `internalBuffer.inputs`,
`internalBuffer.outputs`, son éventuel historique de terril, ses paramètres,
son état et un `job` lorsque le cycle a commencé.

API utilisables par l'agent de validation :

- `OrbitResourceStack.create`, `portion`, `merge`, `addToStock`, `takeFromStock`,
  `recoverableAmount`.
- `OrbitProcessBlock.create` et `OrbitProcessGraph.create`, `connect`,
  `acceptance`, `outputRoom`, `removeNode`, `snapshot`, `materialTotal`.
- `OrbitRecipeResolver.resolve(node, graph)` renvoie un paquet prêt ou un
  blocage explicite, avec mode, état, diagnostic, ingrédients et produits prévus.
- `OrbitProcessSimulation.advance(graph, seconds, context)` avance un graphe
  autonome. Le contexte déclare `energyUnlimited` ou `energyAvailableMW`.
- `OrbitIndustry.ensureGraph`, `supply`, `advance`, `reclaimBuilding` raccordent
  ces opérations à une session et à ses bâtiments.

Une connexion accepte des indices de ports ou des identifiants stables
`fromPortId` / `toPortId`. Les snapshots conservent les deux ; les identifiants
sont prioritaires à la restauration. Une sortie ne peut alimenter qu'une seule
connexion, mais plusieurs sorties peuvent rejoindre la même entrée. Elles
occupent alors des points d'accroche distincts et se partagent le débit maximal
de ce port. Les ports ordinaires n'excèdent jamais leur limite déclarée : 12 u/s
pour les matières, 6 u/s pour l'eau et 4 u/s pour le carbone, même avec des bonus
technologiques. L'entrée du terril n'impose aucun plafond. Si les matières reçues
diffèrent, un port ordinaire conserve la première et signale le flux incompatible
sans le retirer de sa source. Le concasseur a
un port de retour dédié afin que roche fraîche et trop-gros puissent être
traités en alternance. Les boucles entre plusieurs blocs sont autorisées.

## Règles temporelles et conservation

La simulation utilise un pas fixe de 0,1 seconde. Les transferts ont une capacité
en unités/seconde mais aucun objet voyage sur les traits. Une seule passe utilise
les sorties disponibles ; une arrivée ne peut pas retraverser un second bloc
instantanément. `maxTransfersPerTick` borne la passe et une rotation de l'ordre
des connexions évite de toujours privilégier les mêmes sous une limite.
Un cycle commence uniquement si ses ingrédients et la place pour ses sorties
sont disponibles. Les ingrédients deviennent alors les matières en cours de
traitement dans `job.inputs`. `job.outputs` réserve la place et décrit le résultat
prévu : ce n'est pas encore de la matière produite. Les sorties n'existent
physiquement qu'à la fin du cycle. La foreuse ne crée donc de matière et
n'incrémente `totalExtracted` qu'à la fin de son cycle.

Les cycles de recette traitent une unité entière de matière principale. Une fusion
peut prendre une unité sur chacun des flux identiques disponibles ; elle conserve
la qualité la plus basse. Les transferts accumulent du crédit de débit, mais ne
déplacent qu'une unité entière à la fois. Les rendements de sortie peuvent être
fractionnaires : ils restent dans `yieldRemainders` et ne deviennent visibles ni
transférables qu'une fois une unité entière accumulée. Les réactifs secondaires
sont réservés par unités entières puis leur part fractionnaire est créditée entre
les cycles.

Pour compter les matières, utiliser `materialTotal(graph)` ou additionner :

- stocks extérieurs et déchets conservés ;
- buffers d'entrée et de sortie ;
- historique des terrils ;
- **entrées** des cycles en cours.

Ne pas ajouter les sorties prévues des cycles : cela compterait les matières
deux fois. Les recettes de V1 répartissent toute la masse entre produit et
déchets ; le moteur refuse une recette non conservative avant de consommer quoi
que ce soit. Le carbone et l'eau font partie de cette comptabilité.

La suppression d'un bloc rend ses buffers, ses entrées en cours et son historique
au stock du bâtiment. Si ce stock est plein, l'excédent devient un stock de
déchets conservé avec sa composition. La suppression d'une source avant la fin
de son cycle ne donne aucun minerai gratuit. La démolition d'un bâtiment
conserve ses matières dans `state.colonyMaterials` et crédite l'inventaire de
construction correspondant.

## Comportements retenus

| Cas | Résultat V1 |
| --- | --- |
| Roche → Foreuse | Connexion impossible : aucune entrée |
| Roche → Concasseur | Fragments, composition conservée, 5 u/s au niveau 1 |
| Trop-gros → entrée de retour du concasseur | Fragments, composition conservée, partagé avec le débit nominal |
| Fragments/poudre/métal industriel → Concasseur | Inchangé, TRAITEMENT INUTILE |
| Déchets bruts → Concasseur | Déchets fragmentés, identifiant de déchet conservé |
| Fragments calibrés → Broyeur | Poudre, composition conservée, jusqu'à 9 u/s |
| Roche brute → Broyeur | Poudre à 2 u/s, puissance ×3 |
| Poudre → Broyeur | Inchangé, TRAITEMENT INUTILE |
| Roche brute → Crible | 100 % vers Trop gros |
| Fragments → Crible | 85 % calibrés, 15 % trop-gros ; poudre vers la sortie calibrée à 100 % |
| Roche → Trieuse magnétique/gravitaire/charbon | 3,6 u/s, rendement respectif 25 %, 20 %, 30 %, puis rejets |
| Fragments → Trieuse magnétique/gravitaire/charbon | 8 u/s, rendement respectif 86 %, 82 %, 85 % |
| Fragments calibrés → Trieuse magnétique/gravitaire/charbon | 9 u/s, rendement respectif 89 %, 86 %, 87 % |
| Poudre → Trieuse magnétique/gravitaire/charbon | 10 u/s, rendement respectif 92 %, 91 %, 88 % |
| Fer standard → Trieuse magnétique | Inchangé côté produit, TRAITEMENT INUTILE |
| Cuivre pur → Trieuse magnétique | Inchangé côté rejets/non-ferreux |
| Roche contenant silicium + eau → Laveuse silicium | Débit 3/8/9/10 u/s (brut/fragments/calibrés/poudre), eau 0,25R |
| Laveuse silicium sans eau | ENTRÉE MANQUANTE : EAU |
| Solide sans silicium + eau → Laveuse silicium | Boues, traitement inutile |
| Silicium humide → Sécheur | Silicium impur sec |
| Silicium sec/autre métal → Sécheur | Inchangé, TRAITEMENT INUTILE |
| Charbon + eau → Lavage charbon | Carbone + boues |
| Charbon sans eau → Lavage charbon | ENTRÉE MANQUANTE : EAU |
| Roche/fer/cuivre → Lavage charbon | Inchangé, TRAITEMENT INUTILE, eau non consommée |
| Fer/cuivre/silicium impur sans carbone → Fonderie | ENTRÉE MANQUANTE : CARBONE |
| Matière impure + carbone → Fonderie | Matériau standard + déchets |
| Matière humide (>25 %) + carbone → Fonderie | 2,6 u/s ; 0,736R de produit + 0,364R de déchets, plus de puissance |
| Roche/fragments/poudre/charbon/déchets → Fonderie | Déchets, puissance consommée, PROCÉDÉ INADAPTÉ |
| Métal standard/acier → Fonderie | Inchangé, TRAITEMENT INUTILE |
| Fer standard + carbone → Affineur | Acier + déchets |
| Cuivre/silicium standard → Affineur | Matériau pur + déchets |
| Matière impure → Affineur | 1 u/s ; 0,25R de matériau standard + 0,75R de déchets |
| Roche/déchets → Affineur | Déchets, PROCÉDÉ INADAPTÉ |
| Gaz/liquide → Concasseur/Broyeur/Fonderie | Refus physique, connexion en erreur, matière en amont |
| Eau → Fonderie | Refus physique ; aucune matière utile |
| Deux matières différentes → Fusion | Refus ; aucune création d'alliage |
| Même matière → Fusion | Fusion, qualité la plus basse |
| Autre matière → Stock tampon occupé | Refus jusqu'au vidage complet |
| Gaz → Stock solide | Refus ; choisir un stock Gaz vide dans la configuration |
| Division, branche pleine | Redistribution vers l'autre branche si elle a de la place |
| Quai sans destination | Stock extérieur rempli puis blocage, sans export automatique |
| Matière solide → Terril | Stockage immédiat illimité dans l'historique de déchets, composition conservée |
| Déchets → Analyseur | Minerai résiduel + déchets appauvris, récupération restante diminuée |
| Pétrole brut → Séparateur triphasé | Gaz + pétrole + déchets, masses issues de la composition |

Les débits ci-dessus sont les maxima nominaux niveau 1 à pleine puissance. Les
recettes normales de fonderie traitent jusqu'à 4 u/s et consomment 0,10R de
carbone ; elles rendent 0,92R de métal standard et 0,18R de déchets. Le lavage
charbon traite jusqu'à 6 u/s avec 0,25R d'eau ; il sort 0,85R de carbone et
0,40R de boues. Un stock tampon a une capacité de 500 unités et n'accepte
qu'une matière à la fois. Division, Fusion et chaque quai restent limités à
12 u/s. Le séparateur triphasé traite 8 u/s ; la pompe pétrolière part de 8 u/s
et dépend de la richesse et de la dureté du gisement.

L'Analyseur de déchets récupère `R × recoverableFraction × 0,65`. Le déchet
appauvri conserve 35 % de son potentiel récupérable précédent à chaque passage
(20 % → 7 % → 2,45 % → 0,86 %), ce qui permet le retraitement sans boucle
créatrice de matière. Les rendements technologiques augmentent de 3, 6 puis 8
points aux niveaux 2, 3 et 4, avec un plafond de 95 % ; les niveaux suivants
ne font pas disparaître l'intérêt de la préparation granulométrique.

Les blocs inconnus se règlent par `invalidInputBehavior` : `pass_through`,
`waste` ou `reject`. Les phases physiquement incompatibles sont déjà rejetées
par le port avant le traitement. La fonderie convertit à 2 u/s la roche, les
minerais et les déchets non préparés en déchets, avec une énergie multipliée
par trois ; les métaux finis, le charbon et le carbone y passent inchangés.

Les recettes et chiffres d'équilibrage se trouvent dans les données et peuvent
être ajustés sans changer le rendu. Les valeurs de récupération restent
provisoires, conformément à la spécification.

## Sauvegarde et interface

Le format de sauvegarde passe à 9 et reste compatible avec les formats 2 à 8.
Il conserve les buffers, métadonnées, cycles en cours, stocks extérieurs,
historiques, réglages et restes de pas fixe. Aucun progrès industriel hors ligne
n'est ajouté. Les anciens types génériques sont migrés : Transformation vers
Fonderie, Assemblage vers Affineur, Séparation vers Division, Sortie vers Quai.
Le graphe de processus est actuellement en version 3 ; les plans existants reçoivent
le port de retour du concasseur et migrent les stocks fractionnaires vers les unités
entières avec leurs restes de rendement.
Les anciennes connexions dupliquant une sortie sont écartées avec un diagnostic
de migration. Les types inconnus et leurs matières restent conservés.

Le joueur ouvre Modifier, choisit les blocs du catalogue adapté au bâtiment,
configure les filtres d'Entrée, puis utilise Stocks pour approvisionner le stock
extérieur. Les cartes reprennent la densité de référence d'Upload Labs : état,
vitesse de traitement, durée par unité, progression du cycle, flux d'entrée,
sorties nommées à côté de leurs ports et énergie. Le panneau d'information au
clic est temporairement masqué; son contenu et les réglages restent dans le code.
Les traits restent sans flèche et sans étiquette de débit ou de ressource ; leur
couleur dépend de cinq familles. Le glisser décroche la connexion.

## Historique des validations (versions antérieures)

Les résultats datés ci-dessous décrivent leurs versions respectives, pas le
contrat courant quand celui-ci a évolué.

### Relais avant validation initiale

Lors de la livraison initiale 0.34.73, aucun test, contrôle de syntaxe ni
lancement navigateur n'avait été effectué, à la demande de l'utilisateur.

### Validation du moteur en 0.34.74

`tests/process-simulation.test.cjs` ajoute 31 scénarios sur les recettes des
blocs miniers et pétroliers, les cinq catégories de compatibilité, les débits,
les transferts bloqués, les cycles, la conservation, l'énergie, la suppression,
les quais concurrents et les snapshots. Résultat ciblé : 31/31 réussis.

La suite complète `npm test` réussit : 68 tests passés, aucun échec. Aucune
vérification navigateur n'a été lancée; la validation porte sur le moteur de
simulation, sans contrôle visuel de l'éditeur mobile.

### Validation des cartes et des entrées partagées en 0.34.75

Les tests couvrent également plusieurs connexions vers une même entrée, ses
points d'accroche distincts et le partage de son débit maximal. La validation
du moteur ciblée passe (32/32), la suite complète passe (69/69) et le smoke test
de l'éditeur en paysage mobile 844×390 passe. Il vérifie les statistiques
Upload Labs, les noms de sortie et le raccordement de deux sources à la même
entrée. Aucun contrôle de bureau n'a été lancé.

### Équilibrage, recyclage et cycles partiels en 0.34.80

Le crible sépare désormais les fragments en 85 % calibrés et 15 % trop-gros ;
le concasseur possède une entrée de retour dédiée et alterne les deux flux. Les
lots partiels se traitent en proportion de leur quantité, avec un plancher d'un
pas de simulation. Les limites physiques des ports restent fixes malgré les
bonus technologiques. Les rendements, débits, fonderie humide, raccourci de
l'affineur, filtre à deux sorties et décroissance du potentiel des déchets sont
déclarés et validés dans le moteur.

La suite complète `npm test` passe : 78/78. Les tests du moteur passent :
41/41. Le smoke test de l'éditeur mobile paysage 844×390 passe. Aucun test de
bureau n'a été lancé.

### Débit affiché déterministe en 0.34.81

Le débit de la carte et de l'inspecteur est estimé à partir de la cadence de la
recette active, des rendements de ses sorties, des limites de ports et du flux
disponible en amont, y compris les coentrées comme l'eau et le carbone. Les
cycles de recyclage sont résolus de manière stable. La télémétrie de production
réelle reste séparée pour la simulation économique.

### Cycles et transferts par unité en 0.34.82

Une barre de progression représente le traitement d'une unité de matière
principale (1 u). Les connexions accumulent leur capacité de transfert, puis
déplacent la matière par paquets atomiques de 1 u, en respectant les limites de
débit des ports. Les sorties fractionnaires des recettes s'accumulent en buffer
jusqu'à former une unité transférable.

### Unités entières et cadence d'extraction en 0.34.83

Les quantités saisies et déplacées entre les blocs sont des unités entières.
Les rendements fractionnaires restent dans un accumulateur interne et ne
deviennent visibles sur une sortie qu'une fois une unité complète disponible.
Les réactifs secondaires sont prélevés par unités entières puis crédités sur
plusieurs cycles selon leur ratio de recette. La foreuse n'applique plus de
cadence géologique comme limite de machine ; le concasseur niveau 1 traite 5 u/s
et constitue le premier goulot de la chaîne.
