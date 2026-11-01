# Contexte courant

Résumé des décisions actives et des points d'entrée du prototype : c'est la page à
lire en premier pour reprendre le travail. Les détails d'un système restent dans sa
documentation spécialisée ; les anciens plans de `docs/reference/` sont des archives
et ne définissent pas l'implémentation actuelle. Les règles de travail (workflow,
livraison, branche, langue) sont dans [`AGENTS.md`](../AGENTS.md).

## Architecture

- Prototype web sans framework. `index.html` charge des scripts IIFE exposés via
  `globalThis` ; garder cet ordre et la compatibilité avec `build.py`.
- `src/data/` contient les réglages, `src/world/` la génération, `src/simulation/`
  les modèles, `src/gameplay/` leur raccordement, `src/ui/` les interactions,
  `src/rendering/` le dessin, `src/storage/` sauvegardes et bibliothèque, `src/app.js`
  l'initialisation et la boucle. Voir [`ARCHITECTURE.md`](ARCHITECTURE.md).
- La génération est déterministe par graine. Préserver navigation, sauvegardes et
  compatibilité mobile/desktop lors des changements.
- Performances en vue planète : sol (relief, minerais, côte, routes terminées) en
  cache réutilisé pendant les déplacements, balises, noms et halos en sprites, routes
  tracées en un chemin par passe, connexité routière mise en cache. Détails et banc de
  mesure (`npm run bench:planet`) dans
  [`ARCHITECTURE.md`](ARCHITECTURE.md#performances-du-rendu-en-vue-planète).

## État du jeu

Le gameplay est fonctionnel jusqu'à l'Arche puis l'arbre de compétences : colonie et
paliers jusqu'à 1 600 habitants, chaîne roche → goudron → plaques, hub de lancement,
fret vers l'Arche, réseau de données et points de technologie, colonies et
laboratoires sur d'autres mondes, plusieurs parties par navigateur.

## Décisions actives

### Monde et carte

- Carte planétaire au style néon (Canvas 2D) : strates d'altitude teintées et ombrées
  comme du papier empilé, lignes d'altitude, rivières, lacs, marais, côtes lumineuses,
  grille de latitude. L'ancien rendu réaliste (biomes, textures, WebGL) et les maisons
  décoratives sont supprimés. Réglages : `src/data/surfaceStyle.js`.
- Continents et îles d'abord, puis `terrain.elevation` (hauteur canonique) et
  l'hydrologie. Lacs et criques sont de l'eau pour le gameplay ; les rivières ne
  bloquent rien. Voir [`WORLDGEN.md`](WORLDGEN.md).
- Pas de gisements : chaque zone du sol a sa composition (roche + fer, cuivre, silice,
  carbone ; pétrole en mer), en veines ramifiées. La carte de teneur sera plus tard
  révélée par un scan ; ratios et rendements restent à calibrer.
- Les bâtiments sont des balises hexagonales dont la taille suit le zoom (bornée).
  Noms par défaut « Usine 1 », « Usine 2 »… numérotés par type sur toute la galaxie,
  modifiables dans l'inspecteur ou le menu de la colonie. Les noms n'apparaissent
  qu'une fois les balises assez grandes (toujours pour la sélection), suivent un peu
  le zoom et ne se chevauchent jamais : un nom qui couvrirait un autre nom ou une
  balise passe sous sa balise, sinon il est omis (sélection, colonie et hub d'abord).

### Interface

- Vue principale épurée. Barre du haut : population « HAB. » et points de technologie
  « TECH » (légende sous chaque chiffre, dans toute partie), « Compétences » réduit à
  son icône quand la place manque, menu ☰. Barre d'actions en bas : retour nommé
  d'après l'échelle visée, « Route », « Construction », « Sonde » en vue galaxie.
  Pause, plein écran, parties et version sont dans le menu ; zoom au pincement, à la
  molette ou aux touches + et −. En vue planète, une jauge « ⚡ consommation /
  production MW » (rouge en déficit).
- Un même panneau bas pour tout ce qu'on touche sur une planète : badge et nom, tuiles
  à icônes, lignes pleine largeur (provenances et arrivées en bleu, destinations en
  ambre, stocks).
  - Fiche de bâtiment : niveau / énergie, tuiles (vitesse et teneurs, débits de
    données, vent d'une éolienne…), provenance et destinations nommées, sources d'une
    antenne relais, puis « Modifier », « Enregistrer » et « Démolir ».
  - Colonie (`colonyPanel.js`) : paliers, flux, stock, arrivées.
  - Hub (`hubPanel.js`) : matériaux à recevoir, puis le prochain fret (barre de
    chargement, unités à bord) et le dernier.
  - Arche : plateformes, arrivées, énergie, points tech, stock.
  - Relevé de terrain (clic sur le sol) : altitude, rayon de forage, composition du
    sol en barres.
- Menu Construction (`buildMenu.js`) : puces de tri (Tout, Production, Industrie,
  Énergie, Transport, Données, Enregistrés), une carte par bâtiment (badge, nom, motif
  d'indisponibilité) et un bouton « i » qui ouvre sa fiche de fonctionnement
  (`details`, emplacement, route, énergie, chantier) avec « Construire ».
- Vues de pose et de sélection : l'antenne relais montre sa vue relief, l'éolienne sa
  vue vent (voir plus bas), en teintes transparentes qui laissent lire le relief. Au
  doigt, tout bâtiment se pose 72 px au-dessus du point touché
  (`OrbitBuildingData.placement.touchLiftPx`) pour rester visible.
- Éditeur de cartes : état et débit sur une ligne, une large barre bleue qui compte
  les unités, « ⚡ MW » et une note (stock d'un quai sur 100, teneur d'un séparateur).
  Quais, Docks et Portes de dépôt affichent le débit moyen des 5 dernières secondes,
  mis à jour toutes les 5 s. Liaisons courbes ou à angle droit (bouton de l'en-tête,
  choix gardé par le navigateur). Pas de symbole ∞ dans l'interface.

### Colonie et progression

- La Colonie est le premier bâtiment, unique par planète et indestructible,
  générateur 12 MW. Population 100 → 200 → 400 → 800 → 1 600 par paliers : 1 000
  roches brutes, puis 150 goudrons, puis 25 plaques, puis un hub assemblé. Dès le
  palier 2, les ressources des paliers précédents sont exigées en flux (roche
  500/min, goudron 25/min, plaque 1/min).
- À 800 habitants s'ouvrent le cuivre, le silicium, l'eau (station de pompage) et le
  hub, qui se bâtit avec des ressources livrées par route (plaques, goudron, cuivre,
  silicium, eau douce).
- Zone néon qui grandit avec ce que la colonie consomme ; on n'y construit pas.
- Les bâtiments et cartes apparaissent selon les besoins de la colonie ; le réglage
  développeur « Tout débloquer » montre tout. Voir [`COLONY.md`](COLONY.md).

### Industrie

- Graphe de cartes par bâtiment, cycles et buffers entiers. Chaque carte appartient à
  son bâtiment : l'Extracteur fore (une seule Foreuse, 6 u/s), concasse et broie ;
  l'Usine sépare, réduit, fabrique goudron et plaques. Pour forer plus, poser plusieurs
  extracteurs côte à côte.
- La roche reste une seule ressource à chaque étape ; chaque stock garde une
  composition moyenne. Les séparateurs récupèrent lot × teneur × 90 % en unités
  entières (la fraction attend dans un crédit) et leurs résidus perdent exactement
  cette part : le métal est conservé (tests de 0 à 80 % sur tous les séparateurs).
- Docks, Quais, Portes de dépôt et trieurs logiques n'ont pas de limite de débit, mais
  un quai garde au plus 100 u par ressource (`dockCapacity`) : un bâtiment à cartes ne
  reçoit plus au-delà, un Dock de sortie plein arrête l'amont. Un Dock de sortie sans
  destination n'absorbe rien (« SANS DESTINATION ») et bloque l'amont.
- Cartes d'entrée automatiques (`src/gameplay/entryGates.js`) : choisir une usine, un
  terril ou un dépôt comme destination crée sa carte d'entrée (un Quai d'entrée par
  ressource envoyée, une Porte d'entrée pour un dépôt), qui disparaît quand plus rien
  ne lui est envoyé. La supprimer à la main efface seulement la destination de ce qui
  l'alimentait. Ces cartes ne sont plus dans « Ajouter un bloc ».
- Bâtiments spécialisés : Station de pompage, Dépôt répartiteur, Terril (retraitement
  ou incinération productrice d'énergie), Plateforme de lancement. Pas de pollution.
- Deux équipes de robots, 2 s de construction par bâtiment. Prix masqués
  (`pricesEnabled: false`). Voir [`PROCESS_SYSTEM.md`](PROCESS_SYSTEM.md).

### Énergie

- Énergie limitée par planète : colonie 12 MW, incinérateur lissé sur 20 s, éoliennes.
  Une puissance insuffisante ralentit les cartes.
- Une éolienne donne ≈ 32 MW × le vent de son site × son sillage
  (`src/simulation/windPower.js`, `config.wind`) :
  - site : quasi nul en zone rouge (relief accidenté, côte), montée lente, jusqu'à
    ×1,5 sur les grandes plaines dégagées et les hauts plateaux, en vert ;
  - sillage : −50 % en entrant dans celui d'une autre éolienne (à moins de 140 km),
    jusqu'à −95 % juste à côté ; les sillages se cumulent.
- Vue vent à la pose et à la sélection : dégradé rouge (vers zéro), jaune pâle au
  milieu, vert sur les bons sites, avec les cercles de sillage. Le vent du site est
  recalculé dès que le terrain est connu ; le sillage n'est pas sauvegardé.

### Arche, compétences et données

- L'arbre de compétences s'ouvre aux premières ressources reçues par l'Arche :
  « Réveil des archives », « Réseau informatique » (Datacenter, Antenne relais,
  Antenne haute fréquence), « Atterrisseur » (colonie sur les autres mondes rocheux,
  laboratoires partout).
- Les données (géologiques, industrielles, planétaires) vont par une chaîne
  d'antennes relais au datacenter, ses analyses par l'antenne haute fréquence à
  l'Arche, où chacune devient un point de technologie (monnaie de l'arbre, seule
  affichée en haut). Débit stable, coupé par la conjonction solaire, 3× plus rapide
  que le fret ; un envoi (un point dans la vue système) toutes les 5 s.
- Les antennes relais ne relient que ce que leur mât (120 m) voit au-dessus du relief
  (`src/simulation/lineOfSight.js`) : les petites bosses (jusqu'à 70 m au-dessus de
  la ligne) laissent passer, une colline coupe le réseau. Vue relief : vert en vue,
  rouge caché, liaisons vertes ou rouges. Voir [`SKILL_TREE.md`](SKILL_TREE.md) et
  [`DATA_NETWORK.md`](DATA_NETWORK.md).

### Routes et logistique

- Routes manuelles qui suivent le relief (vallées, lacets, ponts sur les rivières et
  sur les détroits étroits), affichées en filament néon. Voies maritimes entre ports
  et plateformes. Démolir un bâtiment retire ses routes propres.
- Un Dock de sortie envoie sa matière vers la Colonie, une usine, un terril, un dépôt
  ou une Plateforme de lancement de la planète, si un chemin construit les relie
  (routes et voies maritimes via les ports). Transfert instantané, sans capacité de
  route ; des impulsions lumineuses purement informatives montrent les liaisons
  actives.
- Le hub lance un fret par minute qui emporte tout son stock (barre de chargement
  dans son menu, un vaisseau par fret dans la vue système). Le fret voyage vers
  l'Arche à `cargoSpeedMultiplier: .35`. Voir [`ROAD_SYSTEM.md`](ROAD_SYSTEM.md) et
  [`ORBITAL_LOGISTICS.md`](ORBITAL_LOGISTICS.md).

### Joueur, alertes et sauvegardes

- Bibliothèque du joueur hors sauvegarde (`src/storage/library.js`) : bâtiments
  enregistrés (menu Construction, filtre « Enregistrés ») et blueprints de cartes
  (éditeur, bouton « Blueprints »). Elle survit à toutes les parties.
- Le bouton « PROBLÈMES » liste les alertes en cours : énergie insuffisante, dock sans
  destination, flux de colonie en retard ; une alerte reste 3 s après sa cause et
  sélectionne son bâtiment au toucher.
- Plusieurs parties par navigateur (`src/storage/saveSlots.js`) : le menu ☰ liste les
  parties (graine, population, points tech, dernière sauvegarde), ouvre ou supprime
  celles mises de côté, et lance une nouvelle partie avec une graine tirée au hasard,
  modifiable. « Réinitialiser le système » recommence la partie jouée avec la même
  graine. La partie jouée reste sous la clé `nereide-atlas-v1` ; les autres sous
  `nereide-atlas-v1:slot:<id>`, avec l'index `nereide-atlas-saves-v1`.
- `saveVersion` 10 ; une sauvegarde plus ancienne démarre une nouvelle partie.

## Questions ouvertes

Proposées au joueur, non décidées — ne pas implémenter sans demande :

- passer les séparateurs gravitaire et de carbone à 6 u/s comme le magnétique ;
- flux exigés par la colonie après le dernier palier ;
- traitement des déchets par type (incinération réservée aux combustibles, laitier →
  ciment, résidus → granulats, saumure → sel, terril visible) ;
- les matériaux rendus à la démolition vont dans `state.colonyMaterials`, que rien ne
  lit encore ;
- le Contexte (`state.contextPoints`, 1/min par colonie) s'accumule et se sauvegarde
  mais n'est ni affiché ni dépensé ;
- pistes du dernier check-up des menus : menu ☰ au style des panneaux ; étoiles et
  planètes dans le panneau bas (tuiles température, atmosphère, distance) ; tuiles
  pour le hub en chantier et graduations de latitude écartées de la jauge d'énergie ;
  menu « Ajouter un bloc » comme le menu Construction (icône, nom, filtres, « i ») ;
  en-tête de l'arbre de compétences au style des panneaux ; colonie sans la phrase
  « Tout ce qui arrive est consommé » quand le stock est vide.

## Points d'entrée et vérification

| Sujet | Code de départ | Vérification ciblée |
| --- | --- | --- |
| Monde et graine | `src/world.js`, `src/data/worldgen.js` | `node --test src/world.test.cjs` |
| Caméra et navigation | `src/navigation/camera.js`, `src/app.js`, `src/state.js` | `node --test tests/architecture.test.cjs` |
| Processus industriels | `src/simulation/processGraph.js`, `src/simulation/processSimulation.js` | `node --test tests/process-simulation.test.cjs` |
| Cartes d'entrée | `src/gameplay/entryGates.js`, `src/ui/factoryEditor.js` | `node --test tests/orbital-logistics.test.cjs` |
| Colonie et déblocage | `src/simulation/colony.js`, `src/gameplay/progression.js`, `src/gameplay/colonyZone.js` | `node --test tests/orbital-logistics.test.cjs` |
| Énergie et vent | `src/simulation/windPower.js`, `src/data/processes.js` | `node --test tests/orbital-logistics.test.cjs` |
| Routes | `src/simulation/roadNetwork.js`, `src/gameplay/roadPlacement.js` | `node --test tests/architecture.test.cjs` |
| Logistique et hub | `src/simulation/logisticsNetwork.js`, `src/gameplay/logistics.js` | `node --test tests/orbital-logistics.test.cjs` |
| Données et compétences | `src/simulation/dataNetwork.js`, `dataTransit.js`, `lineOfSight.js`, `src/gameplay/skills.js` | `node --test tests/orbital-logistics.test.cjs` |
| Interface | `src/ui/hud.js`, `src/ui/buildMenu.js`, `src/ui/panelKit.js`, `styles.css` | captures navigateur ciblées |
| Rendu de surface | `src/rendering/surfaceRenderer.js`, `buildingRenderer.js`, `roadRenderer.js` | `npm run bench:planet` |
| Sauvegardes et parties | `src/storage/save.js`, `src/storage/saveSlots.js`, `src/state.js` | `node --test tests/architecture.test.cjs`, `npm run test:orbital-seed-reset` |
| Export autonome | `build.py`, `index.html` | `python3 build.py` |

Pour une livraison complète, `npm test` lance la suite ; les tests navigateur sont
nécessaires lorsque la navigation, les gestes ou l'interface changent.
