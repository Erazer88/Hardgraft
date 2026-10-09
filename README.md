# Néréide — Atlas orbital

Premier prototype de navigation spatiale en portrait. Une galaxie procédurale, ses systèmes orbitaux et les surfaces de ses planètes se parcourent par glissement, zoom et sélection. L'interface reprend la direction graphique des études : galaxie organique, système en plan technique bleu, surface topographique contrastée.

Les [captures du prototype sur GitHub](https://github.com/Erazer88/Hardgraft/tree/codex/nereide-prototype/docs/images) présentent les vues mobile et bureau, ainsi que les étapes du zoom continu.

Les règles actuelles sont les trois documents fournis par l'utilisateur, conservés intégralement dans [docs/reference](docs/reference). Agent 00 a préparé la [séparation entre simulation, rendu et interface](docs/ARCHITECTURE.md). Agent 01 ajoute la [génération variée des systèmes](docs/WORLDGEN.md). La phase 3 introduit l’inventaire planétaire et les premiers chantiers.

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
- Sur le monde natal, le bouton de construction ouvre trois installations. Choisir un bâtiment puis toucher une terre ferme lance un chantier de 3 à 4 secondes. Toucher l’installation permet de suivre son avancement ou de la démolir avec remboursement intégral.
- L'icône pause ou la barre d'espace suspend les orbites. Échap ferme un panneau ; +/− contrôlent le zoom ; les flèches déplacent la caméra ; Entrée ouvre la sélection.

La graine, les zones sondées et les systèmes visités sont sauvegardés localement lorsque le navigateur autorise le stockage. Le prototype continue de fonctionner si le stockage est indisponible. L'horloge ne progresse pas hors ligne.

## Contenu et limites de ce prototype

- 2 560 systèmes, dont 560 par bras sur quatre bras et 320 dans le noyau.
- De zéro à dix planètes par système, avec une majorité de systèmes ordinaires. Espacements compacts, réguliers ou étendus ; zéro à trois ceintures de débris et épaves occasionnelles. Les fréquences sont configurables dans `src/data/worldgen.js`.
- Température estimée, atmosphère, eau, gravité et activité géologique varient progressivement. La température dépend de la luminosité stellaire, de la distance physique et de la pression. Les vitesses relatives suivent la troisième loi de Kepler, avec des durées comprimées pour le jeu.
- Le système natal possède quatre à six planètes et un candidat tempéré à l'installation. Sa carte garantit des gisements de fer, cuivre, silice et carbone, ainsi que de l'eau. Ces données préparent l'industrie ; l'extraction n'est pas encore implémentée.
- Le transfert et le rendez-vous orbital seront intégrés ultérieurement.
- Surfaces reproductibles avec continents, océans, côtes, altitude, ombrage de relief, courbes de niveau et gisements. La surface est une carte régionale rectangulaire, pas encore une projection complète du globe.
- Une seule caméra et un repère galactique commun : chaque système est inclus dans son étoile, chaque carte dans sa planète. Le zoom ne remplace pas la scène et ne réinitialise pas le cadrage. Les tailles relatives sont adaptées à la navigation du prototype ; ce n'est pas une simulation des distances physiques réelles.
- Le stock de la colonie suit cinq ressources stables : fer, cuivre, silicium, carbone et eau. Les coûts des bâtiments, leurs durées et le taux de remboursement sont déclaratifs. L’extraction et la production restent hors du périmètre de cette version.
- Le terrain peut être agrandi jusqu'à l'échelle locale prévue pour les futures usines. Le zoom maximal dépend de la résolution de la carte pour préserver un relief lisible. Les usines, la collecte automatisée et les stratégies énergétiques restent hors du périmètre de cette version.
- Quelques connexions et cargos interstellaires servent de repères visuels dans la galaxie.

## Validation

```sh
npm test
node tests/browser-smoke.cjs
```

Les tests du générateur couvrent la reproductibilité, des graines différentes, la continuité des bras, l'ordre des orbites, les vitesses de Kepler et la présence de terres, d'océans et de ressources.

Les tests d'architecture exécutent les modules de simulation, sauvegarde, exploration et caméra sans DOM ni Canvas. Le test de construction contrôle aussi les inventaires isolés, les coûts, les minuteries, l’espacement et les remboursements.

Le test navigateur utilise Chromium installé et le protocole DevTools natif, sans bibliothèque additionnelle. Il attend le serveur sur le port 8000 et produit des captures dans `artifacts/`. Les résultats d'émulation mobile ne remplacent pas un essai sur appareil physique.

La validation couvre les écrans 390 × 844 et 1440 × 900 : sélection réelle par toucher, navigation et retours, glissement, pincement à deux doigts, génération par menu et mission de sonde révélant de nouveaux systèmes. Elle contrôle aussi, aux seuils de détail, le facteur de zoom, la stabilité du point visé et le retour au cadrage initial après dézoom.

Les tests de génération vérifient aussi la distribution sur 2 560 systèmes et les conditions de départ sur 64 graines. Les tests navigateur visitent des systèmes vides, à une planète, entièrement gazeux et riches, puis vérifient leurs cadrages et retours.

La génération v2 modifie la composition des systèmes et les niveaux d'eau des cartes existantes. Les positions des étoiles, leurs identifiants et les découvertes sauvegardées sont conservés. Une graine reproduit exactement le même univers pour une même version du générateur et de ses paramètres.

Dans ce navigateur cloud géré, la politique de l'organisation bloque le protocole `file://` avant que l'application soit exécutée. Le même HTML autonome est testé par HTTP avec contrôle de l'absence de requêtes externes. L'ouverture locale sur un navigateur personnel et les appareils physiques restent à essayer.

Les anciennes pages du dépôt Hardgraft restent dans leurs répertoires historiques ; le nouveau prototype est à la racine. Le fichier autonome et l'archive des sources ne les incluent pas.
