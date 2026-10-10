# Néréide — Atlas orbital

Premier prototype de navigation spatiale en portrait. Une galaxie procédurale, ses systèmes orbitaux et les surfaces de ses planètes se parcourent par glissement, zoom et sélection. L'interface reprend la direction graphique des études : galaxie organique, système en plan technique bleu, surface topographique contrastée.

Les [captures du prototype sur GitHub](https://github.com/Erazer88/Hardgraft/tree/codex/nereide-prototype/docs/images) présentent les vues mobile et bureau, ainsi que les étapes du zoom continu.

Les règles actuelles sont les trois documents fournis par l'utilisateur, conservés intégralement dans [docs/reference](docs/reference). Agent 00 a préparé la [séparation entre simulation, rendu et interface](docs/ARCHITECTURE.md). Agent 01 ajoute la [génération variée des systèmes](docs/WORLDGEN.md). Les phases 3 et 4 apportent l’inventaire, la construction et les premières chaînes d’usine.

## Ouvrir le prototype

[Lancer le jeu dans le navigateur](https://raw.githack.com/Erazer88/Hardgraft/codex/nereide-prototype/dist/nereide-zoom-continu.html). Ce lien suit la branche du prototype ; la version est affichée en bas du jeu.

Les fichiers prêts à télécharger sont dans le dépôt : [prototype HTML autonome](dist/nereide-zoom-continu.html) et [archive ZIP des sources](dist/nereide-sources.zip). Sur GitHub, ouvrir le fichier puis utiliser **Download raw file** pour le récupérer.

`python3 build.py` produit **dist/nereide-prototype.html** et **dist/nereide-zoom-continu.html**. Les deux fichiers contiennent le même prototype autonome : tout est embarqué. Un navigateur mobile peut nécessiter d'ouvrir le fichier téléchargé depuis son gestionnaire de fichiers ou de le servir avec une application locale.

Pour développer :

```sh
cd /workspace/Hardgraft
python3 -m http.server 8000 --bind 0.0.0.0
```

Ouvrir le serveur dans un navigateur. Le projet utilise uniquement HTML, CSS et JavaScript Canvas 2D ; aucune installation npm n'est nécessaire. `npm start` et `npm run build` exécutent les mêmes commandes si Node est disponible.

## Navigation

- Le menu propose une graine d'univers. La même graine génère les mêmes positions, systèmes et terrains ; le bouton ↻ crée l'univers saisi.
- Glisser pour déplacer la caméra. Pincer, tourner la molette ou utiliser + et − pour zoomer autour du point visé.
- Zoomer sur une étoile pour voir ses orbites, puis sur une planète pour détailler son terrain, sans changement de scène.
- Toucher une étoile puis **Zoomer sur le système**, ou double toucher, pour un cadrage automatique avec la même caméra.
- Toucher une planète puis **Zoomer sur la surface** pour la centrer. Les géantes gazeuses n'ont pas de surface solide.
- La flèche ou le fil d'Ariane revient à l'échelle précédente. Le bouton de cadrage montre l'ensemble de la carte ; la cible recentre.
- À proximité d'une planète, la caméra suit son déplacement orbital tout en conservant les déplacements manuels. Dézoomer retrouve les orbites, puis la galaxie.
- En vue galaxie, activer la sonde puis toucher une zone. Une mission révèle les systèmes après son trajet. L'option **Révéler tous les systèmes** dans le menu facilite l'examen de la génération.
- En vue surface, toucher le terrain pour lire son type, ses coordonnées et son altitude ; les gisements sont hachurés.
- Sur le monde natal, le bouton de construction ouvre cinq installations, dont un port d’envoi. Choisir un bâtiment puis toucher une terre ferme lance un chantier. Les installations ont maintenant des silhouettes différentes vues du dessus.
- Dans le menu de démarrage, « Matériaux infinis » active un mode de test : les bâtiments et usines ne consomment pas les stocks planétaires. Le réglage est sauvegardé et les stocks affichent ∞.
- En zoomant sur une usine achevée, ses blocs et leurs connexions apparaissent directement sur le relief. L’emprise de l’usine sur la carte est environ 3,5 fois plus grande pour rendre les blocs visibles plus tôt ; chaque type de bloc a son propre pictogramme en vue du dessus.
- Dans le bloc Sortie, choisir le stock de la colonie, un dépôt ou un port d’envoi achevé. Le réseau de routes suit le relief et forme des branches vers les autres installations, avec des virages arrondis et des jonctions visibles. Le trajet de fret contourne les pentes raides et les installations, et évite l’eau autant que possible. Une flotte de camions charge plusieurs unités, livre sa cargaison puis revient à l’usine. La taille de la flotte, la capacité par camion et la vitesse sont définies par niveaux dans `src/data/logistics.js` ; le dépôt ajoute les matériaux au stock de la colonie et le port garde sa cargaison en attente d’expédition.
- La chaîne de départ prélève du fer dans le stock planétaire, le transforme en plaques, puis les remet dans le stock. Dans l’usine, ajouter les six types de blocs, déplacer les blocs en les faisant glisser, créer des liens entre leurs ports et supprimer un bloc ou une connexion.
- L'icône pause ou la barre d'espace suspend les orbites. Échap ferme un panneau ; +/− contrôlent le zoom ; les flèches déplacent la caméra ; Entrée ouvre la sélection.

La graine, les zones sondées et les systèmes visités sont sauvegardés localement lorsque le navigateur autorise le stockage. Le prototype continue de fonctionner si le stockage est indisponible. L'horloge ne progresse pas hors ligne.

## Contenu et limites de ce prototype

- 2 560 systèmes, dont 560 par bras sur quatre bras et 320 dans le noyau.
- De zéro à dix planètes par système, avec une majorité de systèmes ordinaires. Espacements compacts, réguliers ou étendus ; zéro à trois ceintures de débris et épaves occasionnelles. Les fréquences sont configurables dans `src/data/worldgen.js`.
- Température estimée, atmosphère, eau, gravité et activité géologique varient progressivement. La température dépend de la luminosité stellaire, de la distance physique et de la pression. Les vitesses relatives suivent la troisième loi de Kepler, avec des durées comprimées pour le jeu.
- Le système natal possède quatre à six planètes et un candidat tempéré à l'installation. Sa carte garantit des gisements de fer, cuivre, silice et carbone, ainsi que de l'eau. Ces données préparent l'industrie ; l'extraction automatisée des gisements n'est pas encore implémentée.
- Le transfert et le rendez-vous orbital seront intégrés ultérieurement.
- Surfaces reproductibles avec continents, océans, côtes, altitude, ombrage renforcé, courbes de niveau plus fines et gisements. La palette ardoise et olive rapproche le terrain d’une carte topographique; la surface reste une carte régionale rectangulaire, pas encore une projection complète du globe.
- Une seule caméra et un repère galactique commun : chaque système est inclus dans son étoile, chaque carte dans sa planète. Le zoom ne remplace pas la scène et ne réinitialise pas le cadrage. Les tailles relatives sont adaptées à la navigation du prototype ; ce n'est pas une simulation des distances physiques réelles.
- Le stock de la colonie suit cinq ressources fondamentales et les plaques de fer produites par l’usine. Les recettes et caractéristiques des blocs sont déclaratives. Les stocks internes sont limités ; les blocages et la famine ralentissent réellement les flux.
- L’usine possède une surface interne de rang I et une demande énergétique globale affichée en MW. La disponibilité de l’énergie et les améliorations de rang seront ajoutées dans leur phase dédiée.
- Le zoom maximal du terrain dépend de la résolution de sa carte pour préserver un relief lisible. La collecte automatisée et les usines de rang supérieur restent hors du périmètre de cette version.
- Quelques connexions et cargos interstellaires servent de repères visuels dans la galaxie.

## Validation

```sh
npm test
node tests/browser-smoke.cjs
```

Les tests du générateur couvrent la reproductibilité, des graines différentes, la continuité des bras, l'ordre des orbites, les vitesses de Kepler et la présence de terres, d'océans et de ressources.

Les tests d'architecture exécutent les modules de simulation, sauvegarde, exploration et caméra sans DOM ni Canvas. Les tests de construction et d’usine contrôlent les inventaires, les coûts, les minuteries, les remboursements et une chaîne matière qui tourne jusqu’au stock planétaire.

Le test navigateur utilise Chromium installé et le protocole DevTools natif, sans bibliothèque additionnelle. Il attend le serveur sur le port 8000 et produit des captures dans `artifacts/`. Les résultats d'émulation mobile ne remplacent pas un essai sur appareil physique.

La validation couvre les écrans 390 × 844 et 1440 × 900 : sélection réelle par toucher, navigation et retours, glissement, pincement à deux doigts, génération par menu et mission de sonde révélant de nouveaux systèmes. Elle contrôle aussi, aux seuils de détail, le facteur de zoom, la stabilité du point visé et le retour au cadrage initial après dézoom.

Les tests de génération vérifient aussi la distribution sur 2 560 systèmes et les conditions de départ sur 64 graines. Les tests navigateur visitent des systèmes vides, à une planète, entièrement gazeux et riches, puis vérifient leurs cadrages et retours.

La génération v2 modifie la composition des systèmes et les niveaux d'eau des cartes existantes. Les positions des étoiles, leurs identifiants et les découvertes sauvegardées sont conservés. Une graine reproduit exactement le même univers pour une même version du générateur et de ses paramètres.

Dans ce navigateur cloud géré, la politique de l'organisation bloque le protocole `file://` avant que l'application soit exécutée. Le même HTML autonome est testé par HTTP avec contrôle de l'absence de requêtes externes. L'ouverture locale sur un navigateur personnel et les appareils physiques restent à essayer.

Les anciennes pages du dépôt Hardgraft restent dans leurs répertoires historiques ; le nouveau prototype est à la racine. Le fichier autonome et l'archive des sources ne les incluent pas.
