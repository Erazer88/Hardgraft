# Processus industriels V1 — cartes et connexions partagées 0.34.75

Cette couche implémente les processus internes demandés le 14 octobre 2026.
Elle ne lance pas de tests, ne publie pas le jeu et ne modifie pas l'historique Git.
Les tests et la validation navigateur sont confiés à l'agent désigné par l'utilisateur.

## Décisions validées

- Réserve de la colonie infinie en V1, y compris pour les coûts de construction.
- Une éolienne terminée fournit une puissance illimitée à sa planète. Sans
  générateur, les traitements consommateurs restent SANS ÉNERGIE.
- L'approvisionnement manuel remplit le stock d'entrée du bâtiment depuis cette
  réserve. Un bloc Entrée, avec un filtre matière, alimente ensuite un seul flux.
- Le quai remplit un stock de sortie limité. Il ne livre pas automatiquement la
  colonie ni un autre bâtiment : la logistique extérieure reste une étape suivante.
- Le terril conserve les matières et leur composition, sans limite de gameplay.
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
- Les tailles sont `raw`, `fragment`, `powder`.
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
de ce port. Si les matières reçues diffèrent, le port conserve la première et
signale le flux incompatible sans le retirer de sa source. Les boucles entre
plusieurs blocs sont autorisées.

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
| Roche → Concasseur | Fragments, composition conservée |
| Fragments/poudre/métal industriel → Concasseur | Inchangé, TRAITEMENT INUTILE |
| Déchets bruts → Concasseur | Déchets fragmentés, identifiant de déchet conservé |
| Fragments → Broyeur | Poudre, composition conservée |
| Roche brute → Broyeur | Poudre ; cadence ×0,18, puissance ×3, cycle ×2 |
| Poudre → Broyeur | Inchangé, TRAITEMENT INUTILE |
| Roche/fragments/poudre → Crible | Brut vers Trop gros ; fragment/poudre vers Taille correcte |
| Roche → Trieuse magnétique/gravitaire/charbon | Récupération fortement dégradée + rejets |
| Fragments/poudre → Trieuse | Récupération de la fraction ciblée ; poudre favorisée |
| Fer standard → Trieuse magnétique | Inchangé côté produit, TRAITEMENT INUTILE |
| Cuivre pur → Trieuse magnétique | Inchangé côté rejets/non-ferreux |
| Roche contenant silicium + eau → Laveuse silicium | Silicium impur humide + boues |
| Laveuse silicium sans eau | ENTRÉE MANQUANTE : EAU |
| Solide sans silicium + eau → Laveuse silicium | Boues, traitement inutile |
| Silicium humide → Sécheur | Silicium impur sec |
| Silicium sec/autre métal → Sécheur | Inchangé, TRAITEMENT INUTILE |
| Charbon + eau → Lavage charbon | Carbone + boues |
| Charbon sans eau → Lavage charbon | ENTRÉE MANQUANTE : EAU |
| Roche/fer/cuivre → Lavage charbon | Inchangé, TRAITEMENT INUTILE, eau non consommée |
| Fer/cuivre/silicium impur sans carbone → Fonderie | ENTRÉE MANQUANTE : CARBONE |
| Matière impure + carbone → Fonderie | Matériau standard + déchets |
| Matière humide + carbone → Fonderie | Moins de produit, plus de déchets, plus lent, plus de puissance |
| Roche/fragments/poudre/charbon/déchets → Fonderie | Déchets, puissance consommée, PROCÉDÉ INADAPTÉ |
| Métal standard/acier → Fonderie | Inchangé, TRAITEMENT INUTILE |
| Fer standard + carbone → Affineur | Acier + déchets |
| Cuivre/silicium standard → Affineur | Matériau pur + déchets |
| Matière impure → Affineur | Matériau standard, récupération 35 %, davantage de déchets |
| Roche/déchets → Affineur | Déchets, PROCÉDÉ INADAPTÉ |
| Gaz/liquide → Concasseur/Broyeur/Fonderie | Refus physique, connexion en erreur, matière en amont |
| Eau → Fonderie | Refus physique ; aucune matière utile |
| Deux matières différentes → Fusion | Refus ; aucune création d'alliage |
| Même matière → Fusion | Fusion, qualité la plus basse |
| Autre matière → Stock tampon occupé | Refus jusqu'au vidage complet |
| Gaz → Stock solide | Refus ; choisir un stock Gaz vide dans la configuration |
| Division, branche pleine | Redistribution vers l'autre branche si elle a de la place |
| Quai sans destination | Stock extérieur rempli puis blocage, sans export automatique |
| Roche/déchets → Terril | Matière jetée mais conservée dans l'historique |
| Déchets → Analyseur | Minerai résiduel + déchets appauvris, récupération restante diminuée |
| Pétrole brut → Séparateur triphasé | Gaz + pétrole + déchets, masses issues de la composition |

Les recettes et chiffres d'équilibrage se trouvent dans les données et peuvent
être ajustés sans changer le rendu. Les valeurs de récupération restent
provisoires, conformément à la spécification.

## Sauvegarde et interface

Le format de sauvegarde passe à 9 et reste compatible avec les formats 2 à 8.
Il conserve les buffers, métadonnées, cycles en cours, stocks extérieurs,
historiques, réglages et restes de pas fixe. Aucun progrès industriel hors ligne
n'est ajouté. Les anciens types génériques sont migrés : Transformation vers
Fonderie, Assemblage vers Affineur, Séparation vers Division, Sortie vers Quai.
Les anciennes connexions dupliquant une sortie sont écartées avec un diagnostic
de migration. Les types inconnus et leurs matières restent conservés.

Le joueur ouvre Modifier, choisit les blocs du catalogue adapté au bâtiment,
configure les filtres d'Entrée, puis utilise Stocks pour approvisionner le stock
extérieur. Les cartes reprennent la densité de référence d'Upload Labs : état,
vitesse de traitement, durée par unité, progression du cycle, flux d'entrée,
sorties nommées à côté de leurs ports et énergie. Le panneau d'information au
clic est temporairement masqué; son contenu et les réglages restent dans le code.
Les traits restent sans flèche ; leur couleur dépend de cinq familles et leur
texte affiche matière dominante et débit actuel/maximal. Un toucher sur un trait
ouvre ses détails ; le glisser décroche la connexion.

## Relais avant validation initiale

Lors de la livraison initiale 0.34.73, aucun test, contrôle de syntaxe ni
lancement navigateur n'avait été effectué, à la demande de l'utilisateur.

## Validation du moteur en 0.34.74

`tests/process-simulation.test.cjs` ajoute 31 scénarios sur les recettes des
blocs miniers et pétroliers, les cinq catégories de compatibilité, les débits,
les transferts bloqués, les cycles, la conservation, l'énergie, la suppression,
les quais concurrents et les snapshots. Résultat ciblé : 31/31 réussis.

La suite complète `npm test` réussit : 68 tests passés, aucun échec. Aucune
vérification navigateur n'a été lancée; la validation porte sur le moteur de
simulation, sans contrôle visuel de l'éditeur mobile.

## Validation des cartes et des entrées partagées en 0.34.75

Les tests couvrent également plusieurs connexions vers une même entrée, ses
points d'accroche distincts et le partage de son débit maximal. La validation
du moteur ciblée passe (32/32), la suite complète passe (69/69) et le smoke test
de l'éditeur en paysage mobile 844×390 passe. Il vérifie les statistiques
Upload Labs, les noms de sortie et le raccordement de deux sources à la même
entrée. Aucun contrôle de bureau n'a été lancé.
