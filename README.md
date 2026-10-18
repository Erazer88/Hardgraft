# Néréide — Atlas orbital

Prototype mobile de navigation spatiale et d'industrie, optimisé pour le paysage. Explorez une galaxie procédurale, faites tourner des globes planétaires en relief et construisez des chaînes de processus à l'intérieur des bâtiments.

Les références de direction artistique sont dans [docs/images](docs/images). Les textes de conception d'origine sont conservés dans [docs/reference](docs/reference) comme archives ; ils ne décrivent pas toujours l'implémentation actuelle.

## Développement

Pour une tâche de code, commencer par [AGENTS.md](AGENTS.md), puis lire le
[contexte courant](docs/CURRENT_CONTEXT.md) et uniquement la documentation du
système concerné. [Architecture](docs/ARCHITECTURE.md), [processus industriels](docs/PROCESS_SYSTEM.md),
[routes](docs/ROAD_SYSTEM.md) et [génération](docs/WORLDGEN.md) ont chacun leur
référence. `docs/reference/` contient les plans et le GDD historiques ; il n'est
pas requis de les lire intégralement.

## Ouvrir le prototype

[Aperçu de l'expérimentation planète 3D dans Firefox](https://htmlpreview.github.io/?https://github.com/Erazer88/Hardgraft/blob/codex/planet-globe-3d-experiment/dist/nereide-zoom-continu.html). Le numéro de version apparaît en bas de l'écran.

Les exports autonomes sont disponibles dans `dist/` : `nereide-zoom-continu.html`, `nereide-prototype.html` et `nereide-sources.zip`. `python3 build.py` les régénère. Le HTML autonome embarque le JavaScript et le CSS ; le globe demande WebGL2 et ne conserve pas la carte 2D expérimentale en solution de repli.

Pour développer localement :

```sh
cd /workspace/Hardgraft
python3 -m http.server 8000 --bind 0.0.0.0
```

Ouvrez ensuite le serveur dans un navigateur compatible WebGL2. Canvas 2D dessine la galaxie et les systèmes ; WebGL2 dessine la surface sphérique et Canvas 2D projette ses routes, gisements et icônes. Les navigateurs sans WebGL2 affichent un message explicite.

## Navigation

- Glisser pour déplacer la caméra spatiale. Pincer, tourner la molette ou utiliser + et − pour zoomer autour du point visé.
- Zoomer sur une étoile pour voir son système, puis ouvrir une planète solide pour afficher son globe en relief.
- Toucher une étoile puis **Zoomer sur le système**, ou double-toucher, pour recentrer la vue.
- Toucher une planète puis **Zoomer sur la surface** pour entrer sur son globe. Les géantes gazeuses n'ont pas de surface solide.
- Sur une planète, glisser à un doigt fait tourner le globe ; pincer sur mobile ou utiliser la molette sur ordinateur règle un zoom court. Le globe reste global, sans descendre au niveau du sol.
- Le retour et le fil d'Ariane remontent d'un niveau avec une transition courte. Les bâtiments restent des coordonnées terrain sauvegardées ; leurs icônes et les routes suivent la sphère lorsqu'elle tourne.
- En vue galaxie, activer la sonde puis toucher une zone pour révéler des systèmes après son trajet. L'option **Révéler tous les systèmes** dans le menu facilite l'examen de la génération.
- Sur la surface, toucher le terrain pour lire le relief, les coordonnées et l'altitude. Un Extracteur posé sur un gisement de fer, cuivre, silice ou carbone peut recevoir une Foreuse dans son éditeur ; la sortie suit le gisement.
- Le catalogue affiche les coûts et l'assemblage des infrastructures. Le prototype utilise temporairement une réserve de colonie infinie et une puissance illimitée par éolienne terminée ; le modèle final prévoit des stocks limités par réseau logistique local. Les modes temporaires sont déclarés dans `src/data/processes.js`.
- Une Plateforme de lancement peut être construite à tout moment, et plusieurs peuvent coexister sur la même planète. Chaque Dock route ses ressources vers une usine équipée d'un Quai d'entrée ou une Plateforme de lancement ; un chemin routier entièrement construit est requis. Dans l’usine, le Quai d’entrée affiche le stock reçu et alimente les machines par son port de sortie droit, à 2 unités entières/s. Les ressources attendent sur la plateforme, puis partent en lots entiers vers l’Arche du système primaire et apparaissent dans son stock après le transit. L’Arche est distincte de l’épave du système. Détails : [docs/ORBITAL_LOGISTICS.md](docs/ORBITAL_LOGISTICS.md).
- Le bouton construction active un aperçu de placement. **Modifier** ouvre une usine configurée selon le gisement : Foreuse, Concasseur et Broyeur communs, puis séparateur ou traitement adapté. Le Terril stocke toute ressource sans limite ni débit et accepte plusieurs connexions. Les machines de traitement ont un débit nominal de 2 u/s ; la Foreuse n'a pas de plafond nominal. Les connexions n'ont pas de débit propre et ne transfèrent que des unités entières. Glissez une sortie vers une entrée ; glissez le fond pour naviguer, ou utilisez le pinch et la molette pour zoomer autour du point visé.
- Les cartes résument les matières d'entrée et de sortie, le débit actuel, une barre de débit, l'énergie actuelle/nominale, l'état et le cycle. Les sauvegardes générales restent compatibles, mais les graphes d'usine de l'ancienne version sont réinitialisés.
- Le bouton route active le tracé manuel : faites glisser depuis un bâtiment ou une route jusqu'à un autre bâtiment ou point de route. Avant l'accrochage à une arrivée, un trait guide blanc opaque et pointillé relie le départ au doigt, sans pouvoir être validé. Il devient continu après accrochage à une cible valide et suit le relief. Après relâchement, une lumière pulsée accompagne le front de construction. Deux doigts annulent l'aperçu en cours et permettent de zoomer ou déplacer la carte ; le bouton route reste actif.
- Une plateforme pétrolière se relie uniquement à un port de surface en faisant glisser l'outil route d'un bâtiment à l'autre. Un port peut recevoir plusieurs liaisons maritimes, qui partagent son point d'amarrage sûr au large ; l'approche rejoint le quai perpendiculairement. Les lignes maritimes ne s'accrochent pas à leur milieu et ne créent pas de carrefour en mer. Elles prennent le chemin navigable le plus court, contournent les terres sans zigzag et s'affichent en pointillés blancs à 60 % d'opacité.
- Tout nouveau tracé terrestre qui coupe une autre route terrestre crée un carrefour au point exact du croisement, même si le joueur continue jusqu'à une autre destination. Les segments se raccordent au nœud et la construction conserve sa progression depuis le départ. Les routes maritimes restent isolées jusqu'à leurs extrémités port et plateforme.
- La croissance des quartiers reste simulée et sauvegardée ; la vue globe la représente par des repères de district discrets plutôt que par les anciens sprites de rues et de maisons.
- Le menu permet de reprendre l'exploration, de réinitialiser la progression avec la même graine, de saisir une autre graine ou d'afficher tous les systèmes.
- L'icône pause ou la barre d'espace suspend les orbites. Échap ferme un panneau ; +/− règlent le zoom ; les flèches déplacent la caméra ; Entrée ouvre la sélection.

La graine, les zones sondées et les systèmes visités sont sauvegardés localement lorsque le navigateur autorise le stockage. L'horloge orbitale ne progresse pas hors ligne.

## Contenu actuel

- 2 560 systèmes répartis dans quatre bras et un noyau. Le brouillard masque les secteurs non découverts.
- Des systèmes générés avec des compositions variées, des planètes solides ou gazeuses, des ceintures de débris et des épaves occasionnelles.
- Des vitesses orbitales relatives qui suivent la troisième loi de Kepler, avec des durées adaptées à la navigation du prototype.
- Des terrains planétaires déterministes projetés sur une sphère WebGL2 déformée par la heightmap, avec couleurs climatiques, grille cartographique, routes et gisements projetés.
- Une caméra et un repère galactique communs aux vues galaxie, système et surface. Le zoom reste continu ; les tailles sont adaptées à la navigation et ne représentent pas les distances réelles.

Les coûts, délais et remboursements restent déclaratifs. Les filières industrielles sont simulées par cycles et buffers entiers ; les routes alimentent la logistique planétaire et les exports orbitaux temporisés. Les flux du Hub vers les planètes restent à implémenter. Le contrat du moteur est décrit dans [docs/PROCESS_SYSTEM.md](docs/PROCESS_SYSTEM.md), et l'architecture du réseau de surface dans [docs/ROAD_SYSTEM.md](docs/ROAD_SYSTEM.md).

## Vérification manuelle

```sh
npm test
node tests/browser-smoke.cjs
npm run test:factory-editor
```

Les tests couvrent la génération, la projection et le mesh globe, la navigation, les sauvegardes, la chaîne industrielle et les gestes de l'éditeur. Le smoke test globe utilise Chromium et un serveur sur le port 8000 ; il vérifie les interactions à la souris et au toucher en portrait et paysage.

Diagnostic du terrain : ouvrir une planète, puis **Menu → Outils développeur →
Diagnostic du terrain**. Plaques, convergence/divergence, uplift, hauteurs avant/après
érosion et quatre champs structurels sont affichés séparément ; export PNG possible.
Le rapport CPU reproductible se lance avec `node tests/terrain-topography-report.cjs`.
