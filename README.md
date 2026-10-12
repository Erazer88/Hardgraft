# Néréide — Atlas orbital

Prototype mobile de navigation spatiale, optimisé pour le paysage. Explorez une galaxie procédurale, zoomez dans ses systèmes, observez les orbites et examinez les cartes topographiques des planètes. La première étape de construction planétaire permet de poser une usine test sur le terrain.

Les références de direction artistique sont dans [docs/images](docs/images). Les règles complètes du jeu fournies par l'utilisateur sont conservées dans [docs/reference](docs/reference) pour guider les prochaines étapes.

## Ouvrir le prototype

[Lancer le jeu dans le navigateur](https://htmlpreview.github.io/?https://github.com/Erazer88/Hardgraft/blob/codex/nereide-prototype/dist/nereide-zoom-continu.html). Le numéro de version apparaît en bas de l'écran.

Les exports autonomes sont disponibles dans `dist/` : `nereide-zoom-continu.html`, `nereide-prototype.html` et `nereide-sources.zip`. `python3 build.py` les régénère. Le HTML autonome embarque le JavaScript et le CSS ; il n'a pas besoin de dépendances réseau.

Pour développer localement :

```sh
cd /workspace/Hardgraft
python3 -m http.server 8000 --bind 0.0.0.0
```

Ouvrez ensuite le serveur dans un navigateur. Le projet utilise HTML, CSS, Canvas 2D et WebGL2 pour le rendu détaillé des surfaces ; aucune installation npm n'est requise. Les navigateurs sans WebGL2 conservent le rendu de carte intégré.

## Navigation

- Glisser pour déplacer la caméra. Pincer, tourner la molette ou utiliser + et − pour zoomer autour du point visé.
- Zoomer sur une étoile pour voir son système, puis sur une planète pour afficher son relief dans la même scène.
- Toucher une étoile puis **Zoomer sur le système**, ou double-toucher, pour recentrer la vue.
- Toucher une planète puis **Zoomer sur la surface** pour la centrer. Les géantes gazeuses n'ont pas de surface solide.
- Le retour et le fil d'Ariane remontent d'un niveau. Sur une planète, le bouton de cadrage remplit l'écran avec le terrain, sans bandes vides sur les côtés ; glisser permet d'explorer le reste de la carte. La cible recentre la vue.
- En vue galaxie, activer la sonde puis toucher une zone pour révéler des systèmes après son trajet. L'option **Révéler tous les systèmes** dans le menu facilite l'examen de la génération.
- Sur la surface, toucher le terrain pour lire le type de relief, les coordonnées et l'altitude. Les gisements restent des éléments naturels générés, sans extraction active.
- En surface, le catalogue affiche les stocks et le coût de chaque infrastructure. Les matériaux sont débités au lancement de l'assemblage ; toucher un bâtiment puis **Démolir** rembourse le taux indiqué. L'inventaire initial est limité : extraction et production ne sont pas encore actives.
- Le bouton construction active un aperçu de placement. Déplacez-le sur le terrain valide et touchez pour lancer l’assemblage ; Échap annule le mode. Les bâtiments se sélectionnent en touchant leur empreinte. **Modifier** ouvre leur espace de processus 2D : ajoutez, déplacez et reliez les blocs depuis la palette. Le plan est sauvegardé avec le bâtiment ; les blocs et connexions ne pilotent pas encore la production.
- Le bouton route active le tracé manuel : faites glisser depuis un bâtiment ou une route jusqu'à un autre bâtiment ou point de route. Avant l'accrochage à une arrivée, un trait guide blanc opaque et pointillé relie le départ au doigt, sans pouvoir être validé. Il devient continu après accrochage à une cible valide et suit le relief. Après relâchement, une lumière pulsée accompagne le front de construction. Deux doigts annulent l'aperçu en cours et permettent de zoomer ou déplacer la carte ; le bouton route reste actif.
- Une plateforme pétrolière se relie uniquement à un port de surface en faisant glisser l'outil route d'un bâtiment à l'autre. Un port peut recevoir plusieurs liaisons maritimes, qui partagent son point d'amarrage sûr au large ; l'approche rejoint le quai perpendiculairement. Les lignes maritimes ne s'accrochent pas à leur milieu et ne créent pas de carrefour en mer. Elles prennent le chemin navigable le plus court, contournent les terres sans zigzag et s'affichent en pointillés blancs à 60 % d'opacité.
- Tout nouveau tracé terrestre qui coupe une autre route terrestre crée un carrefour au point exact du croisement, même si le joueur continue jusqu'à une autre destination. Les segments se raccordent au nœud et la construction conserve sa progression depuis le départ. Les routes maritimes restent isolées jusqu'à leurs extrémités port et plateforme.
- Après le raccordement des bâtiments de production, des quartiers décoratifs se développent autour d'eux. Chaque quartier forme un graphe de rues collectrices et locales ; des boucles se créent lorsque le relief et la place disponible le permettent. Les maisons bordent les rues et alternent les trois modèles WebP. Six modules de rues — village ou ville, en ligne, en T ou en croix — sont choisis selon la forme et la densité du quartier. Cette croissance visuelle reste séparée du réseau routier manuel et n'ajoute pas de simulation de population.
- Le menu permet de reprendre l'exploration, de réinitialiser la progression avec la même graine, de saisir une autre graine ou d'afficher tous les systèmes.
- L'icône pause ou la barre d'espace suspend les orbites. Échap ferme un panneau ; +/− règlent le zoom ; les flèches déplacent la caméra ; Entrée ouvre la sélection.

La graine, les zones sondées et les systèmes visités sont sauvegardés localement lorsque le navigateur autorise le stockage. L'horloge orbitale ne progresse pas hors ligne.

## Contenu actuel

- 2 560 systèmes répartis dans quatre bras et un noyau. Le brouillard masque les secteurs non découverts.
- Des systèmes générés avec des compositions variées, des planètes solides ou gazeuses, des ceintures de débris et des épaves occasionnelles.
- Des vitesses orbitales relatives qui suivent la troisième loi de Kepler, avec des durées adaptées à la navigation du prototype.
- Des cartes planétaires reproductibles avec archipels, côtes détaillées, hauts fonds turquoise, relief ombré, textures de terrain CC0, courbes de niveau et gisements naturels.
- Une caméra et un repère galactique communs aux vues galaxie, système et surface. Le zoom reste continu ; les tailles sont adaptées à la navigation et ne représentent pas les distances réelles.

Les coûts, délais de construction et remboursements sont déclarés dans les données des bâtiments. Les gisements planétaires restent visuels : l'extraction, la production, les blocs internes et le transport logistique ne sont pas encore simulés. Les routes planétaires sont tracées manuellement ; leur construction progressive et leur avancement sont sauvegardés.

## Vérification manuelle

```sh
npm test
node tests/browser-smoke.cjs
```

Les tests couvrent la génération, la navigation, l'exploration, les sauvegardes et le zoom continu. Le test navigateur exige Chromium et un serveur sur le port 8000.
