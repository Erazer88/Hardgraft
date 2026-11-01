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
  `src/rendering/` le dessin et `src/app.js` l'initialisation et la boucle. Voir
  [`ARCHITECTURE.md`](ARCHITECTURE.md).
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
laboratoires sur d'autres mondes.

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

- Vue principale épurée : barre du haut (population « HAB. », points « TECH » ou
  « CONTEXTE » en légende sous chaque chiffre, « Compétences » réduit à son icône quand
  la place manque, menu ☰) ; barre d'actions en bas (retour nommé d'après l'échelle
  visée, « Route », « Construction », « Sonde » en vue galaxie). Pause, plein écran et
  version sont dans le menu ; zoom au pincement, à la molette ou aux touches + et −.
  En vue planète, une jauge « ⚡ consommation / production MW » (rouge en déficit).
- Un même panneau bas pour tout ce qu'on touche sur une planète : badge et nom, tuiles
  à icônes, lignes pleine largeur (provenances et arrivées en bleu, destinations en
  ambre, stocks). Fiche de bâtiment : niveau / énergie, tuiles (vitesse et teneurs,
  débits de données…), provenance et destinations nommées, sources d'une antenne
  relais, puis « Modifier », « Enregistrer » et « Démolir ». Colonie
  (`colonyPanel.js`) : paliers, flux, stock, arrivées. Hub (`hubPanel.js`) : matériaux
  à recevoir, puis le prochain fret (barre de chargement, unités à bord) et le dernier. Arche : plateformes, arrivées, énergie,
  points tech, arrivées et stock. Relevé de terrain (clic sur le sol) : altitude,
  rayon de forage, composition du sol en barres.
- Menu Construction (`buildMenu.js`) : puces de tri (Tout, Production, Industrie,
  Énergie, Transport, Données, Enregistrés), une carte par bâtiment (badge, nom, motif
  d'indisponibilité) et un bouton « i » qui ouvre sa fiche de fonctionnement
  (`details`, emplacement, route, énergie, chantier) avec « Construire ».
- Éditeur de cartes : état et débit sur une ligne, une large barre bleue (unité en
  cours, ou remplissage d'un quai sur 100), « ⚡ MW » et une note (stock d'un quai,
  teneur d'un séparateur). Liaisons courbes ou à angle droit (bouton de l'en-tête,
  choix gardé par le navigateur). Pas de symbole ∞ dans l'interface.

### Colonie et progression

- La Colonie est le premier bâtiment, unique et indestructible, générateur 12 MW.
  Population 100 → 200 → 400 → 800 → 1 600 par paliers : 1 000 roches brutes, puis
  150 goudrons, puis 25 plaques, puis un hub assemblé. Dès le palier 2, les ressources
  des paliers précédents sont exigées en flux (roche 500/min, goudron 25/min, plaque
  1/min). Contexte : 1/min.
- À 800 habitants s'ouvrent le cuivre, le silicium, l'eau (station de pompage) et le
  hub, qui se bâtit avec des ressources livrées par route (plaques, goudron, cuivre,
  silicium, eau douce).
- Zone néon qui grandit avec ce que la colonie consomme ; on n'y construit pas. Une
  colonie par planète.
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
- Bâtiments spécialisés : Station de pompage, Dépôt répartiteur, Terril (retraitement
  ou incinération productrice d'énergie), Plateforme de lancement. Pas de pollution.
- Énergie limitée (colonie 12 MW, éolienne 32 MW, incinérateur lissé sur 20 s). Deux
  équipes de robots, 2 s de construction par bâtiment. Prix masqués
  (`pricesEnabled: false`). Voir [`PROCESS_SYSTEM.md`](PROCESS_SYSTEM.md).

### Arche, compétences et données

- L'arbre de compétences s'ouvre aux premières ressources reçues par l'Arche :
  « Réveil des archives », « Réseau informatique » (Datacenter, Antenne relais,
  Antenne haute fréquence), « Atterrisseur » (colonie sur les autres mondes rocheux,
  laboratoires partout).
- Les données (géologiques, industrielles, planétaires) vont par une chaîne
  d'antennes relais au datacenter, ses analyses par l'antenne haute fréquence à
  l'Arche, où chacune devient un point de technologie (monnaie de l'arbre, à la place
  du Contexte). Débit stable, coupé par la conjonction solaire, 3× plus rapide que le
  fret. Voir [`SKILL_TREE.md`](SKILL_TREE.md) et [`DATA_NETWORK.md`](DATA_NETWORK.md).

### Routes et logistique

- Routes manuelles qui suivent le relief (vallées, lacets, ponts sur les rivières et
  sur les détroits étroits), affichées en filament néon. Voies maritimes entre ports
  et plateformes. Démolir un bâtiment retire ses routes propres.
- Le Dock envoie vers la Colonie, une usine ou un terril avec Quai d'entrée, un dépôt
  avec Porte d'entrée ou une Plateforme de lancement, si un chemin construit les relie
  (routes et voies maritimes via les ports). Transfert instantané, sans capacité de
  route ; des impulsions lumineuses purement informatives montrent les liaisons
  actives. Le hub lance un fret par minute qui emporte tout son stock (barre de
  chargement dans son menu, un vaisseau par fret dans la vue système). Le fret vers
  l'Arche est 2× plus lent qu'avant (`cargoSpeedMultiplier: .35`). Voir [`ROAD_SYSTEM.md`](ROAD_SYSTEM.md) et
  [`ORBITAL_LOGISTICS.md`](ORBITAL_LOGISTICS.md).

### Joueur, alertes et sauvegardes

- Bibliothèque du joueur hors sauvegarde (`src/storage/library.js`) : bâtiments
  enregistrés (menu Construction, filtre « Enregistrés ») et blueprints de cartes
  (éditeur, bouton « Blueprints »).
- Le bouton « PROBLÈMES » liste les alertes en cours : énergie insuffisante, dock sans
  destination, flux de colonie en retard ; une alerte reste 3 s après sa cause et
  sélectionne son bâtiment au toucher.
- `saveVersion` 10 ; une sauvegarde plus ancienne démarre une nouvelle partie.

## Questions ouvertes

Proposées au joueur, non décidées — ne pas implémenter sans demande :

- passer les séparateurs gravitaire et de carbone à 6 u/s comme le magnétique ;
- flux exigés par la colonie après le dernier palier ;
- traitement des déchets par type (incinération réservée aux combustibles, laitier →
  ciment, résidus → granulats, saumure → sel, terril visible) ;
- les matériaux rendus à la démolition vont dans `state.colonyMaterials`, que rien ne
  lit encore ;
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
| Colonie et déblocage | `src/simulation/colony.js`, `src/gameplay/progression.js`, `src/gameplay/colonyZone.js` | `node --test tests/orbital-logistics.test.cjs` |
| Routes | `src/simulation/roadNetwork.js`, `src/gameplay/roadPlacement.js` | `node --test tests/architecture.test.cjs` |
| Logistique | `src/simulation/logisticsNetwork.js`, `src/gameplay/logistics.js` | `node --test tests/orbital-logistics.test.cjs` |
| Données et compétences | `src/simulation/dataNetwork.js`, `src/simulation/dataTransit.js`, `src/gameplay/skills.js` | `node --test tests/orbital-logistics.test.cjs` |
| Interface | `src/ui/hud.js`, `src/ui/buildMenu.js`, `src/ui/panelKit.js`, `styles.css` | captures navigateur ciblées |
| Rendu de surface | `src/rendering/surfaceRenderer.js`, `buildingRenderer.js`, `roadRenderer.js` | `npm run bench:planet` |
| Sauvegardes | `src/storage/save.js`, `src/state.js` | `node --test tests/architecture.test.cjs` |
| Export autonome | `build.py`, `index.html` | `python3 build.py` |

Pour une livraison complète, `npm test` lance la suite ; les tests navigateur sont
nécessaires lorsque la navigation, les gestes ou l'interface changent.
