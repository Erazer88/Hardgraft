# Néréide — Atlas orbital

Prototype mobile de navigation spatiale et d'industrie, optimisé pour le paysage. Explorez une galaxie procédurale, examinez les cartes topographiques et construisez des chaînes de processus à l'intérieur des bâtiments.

Les captures de contrôle temporaires ne sont pas versionnées. Les textes de conception d'origine sont conservés dans [docs/reference](docs/reference) comme archives ; ils ne décrivent pas toujours l'implémentation actuelle.

## Développement

Pour une tâche de code, commencer par [AGENTS.md](AGENTS.md), puis lire le
[contexte courant](docs/CURRENT_CONTEXT.md) et uniquement la documentation du
système concerné. [Architecture](docs/ARCHITECTURE.md), [processus industriels](docs/PROCESS_SYSTEM.md),
[routes](docs/ROAD_SYSTEM.md), [logistique](docs/ORBITAL_LOGISTICS.md),
[colonie](docs/COLONY.md) et [génération](docs/WORLDGEN.md) ont chacun leur
référence. `docs/reference/` contient les plans et le GDD historiques ; il n'est
pas requis de les lire intégralement.

## Ouvrir le prototype

[Lancer la dernière version dans Firefox](https://htmlpreview.github.io/?https://github.com/Erazer88/Hardgraft/blob/claude/neon-style-visual-layer-a3c4vz/dist/nereide-zoom-continu.html) : ce lien suit la branche de travail et montre toujours le dernier export poussé.

Chaque livraison publie aussi un export versionné, ouvrable par un lien figé sur le commit :
`https://raw.githack.com/Erazer88/Hardgraft/<commit>/dist/nereide-zoom-continu-<version>.html`
(HTMLPreview en secours). Le numéro de version apparaît en bas de l'écran.

Les exports autonomes sont disponibles dans `dist/` : `nereide-zoom-continu.html`, sa copie versionnée `nereide-zoom-continu-<version>.html`, `nereide-prototype.html` et `nereide-sources.zip`. `python3 build.py` les régénère. Le HTML autonome embarque le JavaScript et le CSS ; il n'a pas besoin de dépendances réseau.

Pour développer localement :

```sh
cd /workspace/Hardgraft
python3 -m http.server 8000 --bind 0.0.0.0
```

Ouvrez ensuite le serveur dans un navigateur. Le projet utilise HTML, CSS et Canvas 2D ; aucune installation npm n'est requise.

## Navigation

- Glisser pour déplacer la caméra. Pincer, tourner la molette ou utiliser + et − pour zoomer autour du point visé.
- Zoomer sur une étoile pour voir son système, puis sur une planète pour afficher sa carte dans la même scène.
- Toucher une étoile puis **Zoomer sur le système**, ou double-toucher, pour recentrer la vue.
- Toucher une planète puis **Zoomer sur la surface** pour la centrer. Les géantes gazeuses n'ont pas de surface solide.
- Le retour et le fil d'Ariane remontent d'un niveau. Sur une planète, le bouton de cadrage remplit l'écran avec le terrain, sans bandes vides sur les côtés ; glisser permet d'explorer le reste de la carte. La cible recentre la vue.
- En vue galaxie, activer la sonde puis toucher une zone pour révéler des systèmes après son trajet. L'option **Révéler tous les systèmes** dans le menu facilite l'examen de la génération.
- Sur la surface, toucher le terrain pour lire le type de terrain, les coordonnées et l'altitude. La sélection affiche aussi la composition du sol (roche, fer, cuivre, silice, carbone). Un Extracteur se pose n'importe où sur la terre ferme et fore de la roche brute qui garde la composition du sol ; une Plateforme pétrolière se pose n'importe où en mer profonde.
- La colonie est le premier bâtiment : elle abrite la population, produit du contexte et grandit en zone néon avec la roche brute, le goudron puis les plaques de métal qu'on lui livre. Les bâtiments et les cartes apparaissent quand elle en a besoin. Un clic sur elle ouvre son menu : paliers, flux requis, arrivées, fournisseurs, réserve, zone et énergie (voir [docs/COLONY.md](docs/COLONY.md)).
- Le bouton construction active un aperçu de placement ; les prix sont masqués et un bâtiment se construit en 2 s. Les balises des bâtiments suivent le zoom et portent leur nom (« Usine 1 »…), modifiable dans l'inspecteur. Démolir un bâtiment retire aussi ses routes propres ; la colonie ne se démolit pas.
- **Modifier** ouvre les cartes du bâtiment. L'Extracteur fore (une Foreuse, 6 u/s), concasse et broie ; l'Usine sépare, réduit et fabrique goudron et plaques ; le Terril retraite ou incinère les déchets. Glissez une sortie vers une entrée ; glissez le fond pour naviguer, ou utilisez le pinch et la molette pour zoomer. Les connexions, Docks et Quais n'ont pas de débit propre et ne transfèrent que des unités entières. Détails : [docs/PROCESS_SYSTEM.md](docs/PROCESS_SYSTEM.md).
- Les cartes résument les matières d'entrée et de sortie, le débit, l'énergie, l'état et une barre qui compte les unités traitées. Un Dock de sortie choisit la destination de sa matière (Colonie, usine ou terril avec Quai d'entrée, dépôt, Plateforme de lancement) ; sans destination, il n'absorbe rien. Un bouton saute vers le bâtiment destinataire ou source.
- L'énergie est limitée : 12 MW par le générateur de la colonie, 32 MW par éolienne. Une puissance insuffisante ralentit les cartes.
- Une Plateforme de lancement reçoit ce qu'on lui envoie ; les ressources partent en lots entiers vers l’Arche du système primaire et apparaissent dans son stock après le transit. Détails : [docs/ORBITAL_LOGISTICS.md](docs/ORBITAL_LOGISTICS.md).
- Le bouton route active le tracé manuel : faites glisser depuis un bâtiment ou une route jusqu'à un autre bâtiment ou point de route. Avant l'accrochage à une arrivée, un trait guide blanc pointillé relie le départ au doigt, sans pouvoir être validé. Il devient continu après accrochage à une cible valide et suit le relief ; un détroit étroit se franchit par un pont. Deux doigts annulent l'aperçu en cours et permettent de zoomer ou déplacer la carte ; le bouton route reste actif.
- Une plateforme pétrolière ou un autre port se relie à un port de surface par une voie maritime, en faisant glisser l'outil route d'un bâtiment à l'autre. Un port peut recevoir plusieurs liaisons, qui partagent son point d'amarrage au large. Les voies maritimes ne créent pas de carrefour en mer et prolongent le réseau routier pour les livraisons.
- Tout nouveau tracé terrestre qui coupe une autre route terrestre crée un carrefour au point exact du croisement. Quand une ressource passe d'un bâtiment à un autre, une impulsion lumineuse parcourt le chemin ; elle est purement informative.
- Le menu permet de reprendre l'exploration, de réinitialiser la progression avec la même graine, de saisir une autre graine ou d'afficher tous les systèmes.
- L'icône pause ou la barre d'espace suspend les orbites. Échap ferme un panneau ; +/− règlent le zoom ; les flèches déplacent la caméra ; Entrée ouvre la sélection.

La graine, les zones sondées et les systèmes visités sont sauvegardés localement lorsque le navigateur autorise le stockage. L'horloge orbitale ne progresse pas hors ligne.

## Contenu actuel

- 2 560 systèmes répartis dans quatre bras et un noyau. Le brouillard masque les secteurs non découverts.
- Des systèmes générés avec des compositions variées, des planètes solides ou gazeuses, des ceintures de débris et des épaves occasionnelles.
- Des vitesses orbitales relatives qui suivent la troisième loi de Kepler, avec des durées adaptées à la navigation du prototype.
- Des cartes planétaires reproductibles au style néon : océan sombre quadrillé, continents et archipels en strates d'altitude, rivières, lacs, littoral lumineux et carte de teneur des matériaux du sol (isolignes et aplats colorés).
- Une caméra et un repère galactique communs aux vues galaxie, système et surface. Le zoom reste continu ; les tailles sont adaptées à la navigation et ne représentent pas les distances réelles.

Les coûts, délais et remboursements restent déclaratifs (prix masqués). Les filières industrielles sont simulées par cycles et buffers entiers ; les routes alimentent la logistique planétaire et les exports orbitaux temporisés. Les flux du Hub vers les planètes restent à implémenter. Le contrat du moteur est décrit dans [docs/PROCESS_SYSTEM.md](docs/PROCESS_SYSTEM.md), et l'architecture du réseau de surface dans [docs/ROAD_SYSTEM.md](docs/ROAD_SYSTEM.md).

## Vérification manuelle

```sh
npm test
node tests/browser-smoke.cjs
npm run test:factory-editor
```

Les tests couvrent la génération, la navigation, l'exploration, les sauvegardes, la chaîne industrielle et les gestes de l'éditeur. Les smoke tests navigateur exigent Chromium et un serveur sur le port 8000.
