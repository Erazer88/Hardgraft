# Architecture du prototype

Cette page décrit l'architecture effectivement chargée par `index.html`.
Les décisions de conception actuelles, les systèmes temporaires et les lectures
minimales par tâche sont dans [`CURRENT_CONTEXT.md`](CURRENT_CONTEXT.md).

## Modules

| Zone | Responsabilité principale |
| --- | --- |
| `src/data/` | Configuration, ressources, recettes, bâtiments, logistique orbitale, génération et styles déclaratifs |
| `src/world.js`, `src/world/` | Génération déterministe des galaxies, systèmes et terrains |
| `src/simulation/` | Horloge, inventaires, constructions, graphes industriels, routes, connectivité logistique et transit orbital |
| `src/gameplay/` | Raccord des règles aux bâtiments, à l'exploration, aux exports orbitaux et aux interactions de placement |
| `src/navigation/` | Projection, caméra, zoom et transitions de repère |
| `src/storage/`, `src/state.js` | État de session et sauvegarde/restauration locale |
| `src/rendering/` | Dessin Canvas 2D et orchestration des couches visuelles |
| `src/ui/` | HUD, vues interactives et outils développeur |
| `src/app.js` | Initialisation, état partagé, événements globaux, boucle et raccord entre modules |

Points d'entrée spécialisés :

- `docs/PROCESS_SYSTEM.md` décrit le graphe industriel et son moteur.
- `docs/ROAD_SYSTEM.md` décrit les routes constructibles.
- `docs/COLONY.md` décrit la colonie, la population, le contexte et le déblocage.
- `docs/SKILL_TREE.md` décrit l'arbre de compétences et ses pistes.
- `docs/DATA_NETWORK.md` décrit le réseau de données et le datacenter.
- `docs/ORBITAL_LOGISTICS.md` décrit le transfert Dock → bâtiment destinataire et le transit vers l’Arche.
- `docs/WORLDGEN.md` décrit les paramètres de génération.

Les fichiers importants comprennent `src/data/processes.js`,
`src/simulation/processGraph.js`, `processSimulation.js` et `depotRouting.js`,
`src/gameplay/industry.js`, `src/navigation/camera.js`,
`src/rendering/renderer.js`, `src/rendering/surfaceRenderer.js`,
`src/ui/factoryEditor.js`, `src/ui/factoryViewport.js` et `src/app.js`.

Modules de la colonie et de la progression :

| Fichier | Responsabilité |
| --- | --- |
| `src/data/colony.js`, `src/data/progression.js` | Paliers, flux, zone ; étapes de déblocage |
| `src/simulation/colony.js` | Consommation, flux dus, paliers, population, contexte |
| `src/simulation/composition.js` | Composition moyenne de la roche par stock |
| `src/gameplay/colonyZone.js` | Croissance de la zone de la colonie sur le terrain |
| `src/gameplay/progression.js` | Déblocage des bâtiments et cartes, restauration |
| `src/gameplay/buildingNames.js` | Noms par défaut numérotés par type (`state.nameCounters`) |
| `src/ui/panelKit.js` | Briques communes des menus de colonie et de hub : unités, barres, débits glissants |
| `src/ui/colonyPanel.js` | Menu de la colonie et débits en moyenne glissante |
| `src/data/skills.js`, `src/gameplay/skills.js` | Compétences déclarées ; révélation à l'Arche, prérequis, acquisition |
| `src/data/dataNetwork.js`, `src/simulation/dataNetwork.js` | Réseau de données en surface : sources, antennes relais, datacenter, température de site |
| `src/simulation/lineOfSight.js` | Ligne de vue au-dessus du relief et couverture d'un mât (vue relief des antennes) |
| `src/gameplay/entryGates.js` | Cartes d'entrée créées et retirées selon les destinations choisies |
| `src/gameplay/undo.js` | Annulation des dernières actions des vues planète et galaxie (pose, démolition, route, sonde) |
| `src/storage/saveSlots.js` | Plusieurs parties : index, mise de côté, ouverture, nouvelle partie, export et import de fichier |
| `src/simulation/windPower.js` | Vent d'un site d'éolienne (relief, altitude) et sillage entre éoliennes |
| `src/simulation/dataTransit.js`, `src/rendering/dataTrafficRenderer.js` | Paquets de données entre mondes et vers l'Arche, conjonction solaire, rendu bleu |
| `src/ui/skillTree.js` | Menu de l'arbre de compétences (nœuds, brouillard, détail) |
| `src/ui/hubPanel.js` | Menu du hub (plateforme de lancement) : chantier, matériaux à recevoir, lancements |
| `src/gameplay/alerts.js` | Problèmes en cours (planète sans assez d'énergie, dock sans destination, flux de colonie en retard) |
| `src/storage/library.js` | Bibliothèque du joueur (clé locale à part de la sauvegarde) : bâtiments enregistrés et blueprints |
| `src/ui/alertsPanel.js` | Bouton « PROBLÈMES » sous les boutons du haut et sa liste déroulante |
| `src/ui/buildMenu.js` | Menu Construction : puces de tri, cartes des bâtiments, fiche « i » ; lit l'état, les clics restent dans `app.js` |
| `src/ui/hud.js` | Barre du haut, jauge d'énergie, inspecteur (fiche de bâtiment, Arche, relevé de terrain, corps célestes), toasts |

## Dépendances et chargement

Direction visée :

```text
data → simulation → gameplay
data + état → UI / rendu
app → initialise et orchestre
```

Les moteurs de simulation n'accèdent ni au DOM ni à Canvas. Le renderer lit l'état
et dessine ; l'UI édite l'état via les API de simulation, sans calculer elle-même
les productions. `app.js` relie ces modules mais reste un point de concentration
pour l'état partagé, les gestes, la navigation et la boucle. Ne pas extraire un
contrôleur sans une frontière d'état explicite et des tests ciblés.

Les IIFE publient leur API via `globalThis`. L'ordre de chargement est celui des
balises script dans `index.html`. `build.py` reprend ces balises et embarque les
scripts, CSS et ressources dans les exports de `dist/`. Cette simplicité est
volontaire pour le prototype ; aucune migration globale vers ESM ou npm n'est
prévue dans une tâche locale.

Le rendu de surface est entièrement Canvas 2D, au style néon (palette
`OrbitSurfaceStyle.neon`) : océan sombre quadrillé, strates d'altitude teintées et
ombrées avec lignes d'altitude, rivières, lacs et marais, carte de teneur des minerais, littoral lumineux, cuits dans une texture
à partir du terrain. Sur la surface active, côte, lignes d'altitude et rivières sont
retracées en vecteurs depuis ce même terrain pour rester nettes au zoom. Il n'y a ni
terrain haute résolution, ni worker, ni couche WebGL.

Les bâtiments ne sont pas dessinés : `buildingRenderer.js` les signale par des balises
de point d'intérêt (`OrbitSurfaceStyle.buildings.pin`) : un hexagone portant l'icône du
bâtiment, coloré selon sa catégorie et centré sur l'emplacement exact ; les routes le
rejoignent par l'angle tourné vers elles. La balise grossit et rétrécit avec le zoom
(`pinScale` : référence 1,6, exposant 0,8, bornée entre 0,45 et 2,2) et porte le nom du
bâtiment au-dessus. La construction progresse en arc autour de l'hexagone, sans cadre à côté ; la
sélection ajoute un hexagone orange. L'aperçu de placement montre en plus l'emprise au
sol. Le clic sur l'hexagone sélectionne le bâtiment (la Colonie ouvre son menu). La
zone de la colonie est dessinée en aplat doré sous les balises, avec sa population.

**Lisibilité mobile.** Toutes les tailles de texte de `styles.css` suivent
`taille × --ta + --tb` : 1 et 0 par défaut, 0,9 et 4,5 px sur téléphone en portrait
(7 px → 11 px, 18 px → 21 px). Les panneaux ouverts au toucher (inspecteur, colonie) grossissent moins
(décalage 2,5 px) et les noms des bâtiments sur la carte aussi (`scaleDamping`). Dans le plan d'usine zoomable, les cartes gardent leur
taille et leur texte ne gagne qu'un pixel ; à l'ouverture sur écran étroit, le plan est
zoomé pour qu'une carte occupe environ 80 % de la largeur, en commençant par la première carte. Le
texte dessiné sur Canvas lit la même échelle via `src/rendering/textScale.js`
(`OrbitTextScale.px`).

## Performances du rendu en vue planète

La rastérisation du canvas coûte bien plus que le JavaScript. Le rendu de surface
évite donc de redessiner ce qui ne bouge pas :

- **Cache du sol** (`surfaceRenderer.js`) : relief, minerais, côte, grille et routes
  terminées sont dessinés dans une image un quart d'écran plus grande de chaque côté.
  Pendant un déplacement ou un petit zoom (× 0,8 à × 1,25), cette image est décalée
  et mise à l'échelle ; elle est redessinée quand elle ne couvre plus la vue, quand la
  vue s'arrête sur une approximation, ou quand les routes terminées, le littoral, les
  réglages ou les bâtiments de la planète changent (`groundKey`). Les routes en
  chantier, leurs têtes animées et le tracé en cours restent dessinés à chaque image
  (`OrbitRoadRenderer.renderActivity`).
- **Sprites** (`buildingRenderer.js`) : une balise (hexagone lumineux et icône) est
  rendue une fois par icône, couleur, taille au quart de pixel, état fini ou non et
  densité de pixels ; un nom l'est une fois par texte, taille au demi-pixel et
  couleurs. Plus aucun flou n'est calculé par image pour les balises.
- **Impulsions de transport** (`vehicleRenderer.js`) : halo pré-rendu sur la tête et
  trait large translucide au lieu de traits flous.
- **Routes** : une passe trace toutes les routes en un seul chemin.
- **Galaxie** (`renderer.js`) : la poussière vue à travers les zones sondées n'est
  recomposée que lorsque la vue ou les relevés changent (46 → 60 images/s).
- **Simulation** : la connexité du réseau routier (`hasBuiltLandPath`) est calculée
  une fois par changement du réseau ; une zone de colonie bloquée n'est retentée
  que si sa cible, ses cellules ou les bâtiments de sa planète changent.

`node tools/planet-bench.cjs [bâtiments] [crans de molette]` (Playwright requis, hors
`npm test`) mesure les temps d'image d'une base dense et liste les points chauds ;
`PAN=3`, `ZOOMRATE=.012` et `DPR=3` mesurent en mouvement. Repères (Chromium headless,
rendu logiciel, 390 × 844) : 200 bâtiments en DPR 3 passent de 12 à 60 images/s vue
immobile et de 12 à 51 en déplacement.

## Modules denses et limites de refactorisation

- `src/app.js` centralise encore l'état partagé, les gestes, la navigation, les
  placements et la boucle. Les algorithmes de placement de bâtiments, de routes et
  de processus ont déjà des modules séparés. Les gestionnaires d'interaction restants
  partagent beaucoup d'état ; une extraction demande d'abord un contrat d'état clair.
- `src/ui/factoryEditor.js` rend les cartes, ports et connexions. Les gestes de la vue
  industrielle sont isolés dans `src/ui/factoryViewport.js` ; le graphe et sa simulation
  restent indépendants du DOM.
- `src/rendering/surfaceRenderer.js` gère la texture néon, le trait de côte vectoriel
  et les couches de surface. Le tracé du littoral est le prochain candidat d'extraction
  s'il évolue indépendamment.
- `src/ui/hud.js` garde la barre du haut et l'inspecteur ; le menu Construction vit
  dans `src/ui/buildMenu.js`. Les panneaux bas partagent `src/ui/panelKit.js` (lignes,
  badges) et les tuiles de `hud.js`.
- `styles.css` empile des blocs ajoutés au fil des refontes, qui surchargent des
  règles plus anciennes (menu Construction, inspecteur, panneaux). Les sélecteurs
  morts ont été retirés ; une consolidation par composant reste possible mais doit
  être vérifiée par captures avant/après.
- `src/simulation/roadNetwork.js` est volumineux mais porte un modèle cohérent
  (topologie et migration du réseau). Une extraction doit suivre une responsabilité
  modifiée, pas un seuil de lignes.

## Validation

- Tests unitaires et d'intégration : `npm test`.
- Processus : `node --test tests/process-simulation.test.cjs`.
- Éditeur et gestes desktop/tactile : `npm run test:factory-editor`.
- Smoke navigateur : `node tests/browser-smoke.cjs`, pertinent si l'application,
  la navigation ou l'UI changent ; Chromium et un serveur sur le port 8000 sont requis.
- Export autonome : `python3 build.py` lors d'une livraison.
- Performances en vue planète : `npm run bench:planet` (Playwright requis).

Ne lancez que la vérification pertinente pendant une itération. Le workflow complet
est décrit dans `AGENTS.md`.
