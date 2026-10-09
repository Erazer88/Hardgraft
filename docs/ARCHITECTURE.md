# Architecture — mission Agent 00

## Périmètre

Préparer la simulation industrielle sans ajouter de gameplay. Le générateur
`src/world.js`, l'aspect visuel et les gestes gardent leur comportement actuel.
La génération plus variée des systèmes appartient à Agent 01.

## Plan minimal

| Fichier | Responsabilité |
| --- | --- |
| `src/data/config.js` | Paramètres existants de navigation, sondes et terrain |
| `src/simulation/simulation.js` | Temps et collections vides pour ressources, bâtiments et usines |
| `src/state.js` | État de session, séparé des textures Canvas |
| `src/storage/save.js` | Sauvegarde versionnée et compatibilité des sauvegardes précédentes |
| `src/navigation/camera.js` | Projections, zoom ancré et interpolation de caméra |
| `src/gameplay/exploration.js` | Missions de sonde et découvertes, sans DOM ni Canvas |
| `src/rendering/renderer.js` | Dessin et textures ; aucune règle économique |
| `src/ui/hud.js` | HUD, fiches et notifications |
| `src/app.js` | Assemblage, commandes utilisateur et sélection de l'échelle |

`index.html` charge ces scripts dans l'ordre. `build.py` embarque les scripts
déclarés dans le HTML, puis archive les sources. Les modules exposent des
namespaces IIFE ; aucune dépendance ni bundler n'est nécessaire.

## Validation effectuée

- `npm test` : 16 tests réussis, dont les 3 tests de génération existants.
- Simulation, sauvegardes historiques et versionnées, sondes et caméra testées sans DOM ni Canvas.
- Navigation galaxie → système → surface → retour, toucher, glissement, pincement et molette vérifiés en émulation mobile (390 × 844) et bureau (1440 × 900).
- Zoom de 3 % aux seuils de détail : point visé stable et cadrage réversible ; plafond de zoom du terrain vérifié.
- Projet source et HTML autonome servis par HTTP : suites navigateur réussies, sans erreur JavaScript ni requête externe de l'application.
- Revue en lecture seule : le rendu exécuté aux trois échelles avec un état gelé ne modifie ni simulation ni découvertes. Le générateur est inchangé.

## Interfaces préparées

La simulation contient `time`, `resources`, `buildings` et `factories`. Ces
collections sont vides : aucune ressource gratuite, construction, recette ou
production n'est ajoutée par cette mission. Le contrôleur avance explicitement
le temps ; le rendu ne fait que consulter cet état.

`OrbitSimulation.create()` crée une simulation indépendante. Son horloge est
en secondes ; `advance(simulation, seconds, running)` refuse une durée négative
ou non finie. Les prochains lots ajouteront leurs données dans les collections
par identifiant, sans mettre d'objets DOM ou Canvas dans cet état.

`OrbitExploration` reçoit une horloge en millisecondes pour les sondes existantes.
Le contrôleur lance et avance les missions, applique leurs résultats et demande
la sauvegarde. La pause des orbites conserve le comportement précédent : elle
ne suspend pas les sondes. Les missions en cours ne sont pas sauvegardées.

`OrbitSave.snapshot(state, galaxy)` sérialise uniquement les données de jeu et
de découverte. Le format version 2 reste sous la clé historique
`nereide-atlas-v1` ; les anciennes sauvegardes sans version sont acceptées.
Un stockage indisponible n'empêche pas de jouer. Il n'y a pas de progression
hors ligne.

Le contrôleur prépare les systèmes et terrains avant `renderer.render(scene)`.
Les textures restent dans les caches de vue. `OrbitCamera` assure les projections,
les repères imbriqués, le zoom autour du point visé et les cadrages automatiques.
L'échelle du terrain vient d'un même paramètre pour la texture, l'inspection,
les gisements, le HUD et le plafond de zoom.

## Fichiers livrés et limites

Outre les modules du tableau, ce lot ajoute `tests/architecture.test.cjs`,
`AGENTS.md`, ce document et les trois PDF avec leur extraction textuelle dans
`docs/reference/`. Il adapte `index.html`, `build.py`, `package.json`, `README.md`
et régénère `dist/nereide-zoom-continu.html` et `dist/nereide-sources.zip`.

L'architecture conserve un contrôleur de navigation dans `src/app.js` et un
renderer commun aux trois échelles. Aucun framework ni dépendance n'a été
ajouté. Ressources, construction, usines et production ne sont pas implémentées.
La prochaine dépendance est Agent 01, pour la génération procédurale variée ;
sa mission n'a pas commencé.

Les tests mobiles utilisent Chromium en émulation. Un appareil physique reste
à vérifier. La politique du navigateur cloud bloque `file://` ; le HTML
autonome a donc été validé par HTTP, avec tous ses scripts et styles embarqués.
