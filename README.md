# Néréide — Atlas orbital

Prototype mobile de navigation spatiale. Explorez une galaxie procédurale, zoomez dans ses systèmes, observez les orbites et examinez les cartes topographiques des planètes. La première étape de construction planétaire permet de poser une usine test sur le terrain.

Les références de direction artistique sont dans [docs/images](docs/images). Les règles complètes du jeu fournies par l'utilisateur sont conservées dans [docs/reference](docs/reference) pour guider les prochaines étapes.

## Ouvrir le prototype

[Lancer le jeu dans le navigateur](https://raw.githack.com/Erazer88/Hardgraft/codex/nereide-prototype/dist/nereide-zoom-continu.html). Le numéro de version apparaît en bas de l'écran.

Les exports autonomes sont disponibles dans `dist/` : `nereide-zoom-continu.html`, `nereide-prototype.html` et `nereide-sources.zip`. `python3 build.py` les régénère. Le HTML autonome embarque le JavaScript et le CSS ; il n'a pas besoin de dépendances réseau.

Pour développer localement :

```sh
cd /workspace/Hardgraft
python3 -m http.server 8000 --bind 0.0.0.0
```

Ouvrez ensuite le serveur dans un navigateur. Le projet utilise HTML, CSS et JavaScript Canvas 2D ; aucune installation npm n'est requise.

## Navigation

- Glisser pour déplacer la caméra. Pincer, tourner la molette ou utiliser + et − pour zoomer autour du point visé.
- Zoomer sur une étoile pour voir son système, puis sur une planète pour afficher son relief dans la même scène.
- Toucher une étoile puis **Zoomer sur le système**, ou double-toucher, pour recentrer la vue.
- Toucher une planète puis **Zoomer sur la surface** pour la centrer. Les géantes gazeuses n'ont pas de surface solide.
- Le retour et le fil d'Ariane remontent d'un niveau. Le bouton de cadrage montre la carte entière ; la cible recentre la vue.
- En vue galaxie, activer la sonde puis toucher une zone pour révéler des systèmes après son trajet. L'option **Révéler tous les systèmes** dans le menu facilite l'examen de la génération.
- Sur la surface, toucher le terrain pour lire le type de relief, les coordonnées et l'altitude. Les gisements restent des éléments naturels générés, sans extraction active.
- En surface, le bouton usine active un aperçu de placement. Déplacez-le sur la terre ferme et touchez pour lancer l'assemblage ; Échap annule le mode. Les usines se sélectionnent en touchant leur empreinte. L'éditeur intérieur des blocs viendra dans une étape suivante.
- Le menu permet de reprendre l'exploration, de réinitialiser la progression avec la même graine, de saisir une autre graine ou d'afficher tous les systèmes.
- L'icône pause ou la barre d'espace suspend les orbites. Échap ferme un panneau ; +/− règlent le zoom ; les flèches déplacent la caméra ; Entrée ouvre la sélection.

La graine, les zones sondées et les systèmes visités sont sauvegardés localement lorsque le navigateur autorise le stockage. L'horloge orbitale ne progresse pas hors ligne.

## Contenu actuel

- 2 560 systèmes répartis dans quatre bras et un noyau. Le brouillard masque les secteurs non découverts.
- Des systèmes générés avec des compositions variées, des planètes solides ou gazeuses, des ceintures de débris et des épaves occasionnelles.
- Des vitesses orbitales relatives qui suivent la troisième loi de Kepler, avec des durées adaptées à la navigation du prototype.
- Des cartes planétaires reproductibles avec continents, océans, côtes, ombrage, courbes de niveau et gisements naturels.
- Une caméra et un repère galactique communs aux vues galaxie, système et surface. Le zoom reste continu ; les tailles sont adaptées à la navigation et ne représentent pas les distances réelles.

La pose d'usines est un premier outil de test ; les blocs internes, routes, flux de ressources et sauvegarde des bâtiments ne sont pas encore implémentés.

## Vérification manuelle

```sh
npm test
node tests/browser-smoke.cjs
```

Les tests couvrent la génération, la navigation, l'exploration, les sauvegardes et le zoom continu. Le test navigateur exige Chromium et un serveur sur le port 8000.
