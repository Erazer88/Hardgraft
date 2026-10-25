# Néréide — planète stylisée 0.5.0

Démo autonome Hardgraft : une carte procédurale illustrée en Canvas 2D, affichée sur un globe sphérique stylisé en 3D, de face et sans rotation de caméra. Aucun moteur 3D, système tectonique, heightmap ou shader de relief. La version reste indépendante du jeu Néréide.

Ouvrir `dist/nereide-atlas-v0.5.html` dans Firefox ou Chromium, y compris hors connexion. Le fichier contient le code, les styles et les trois images fournies. `dist/index.html` est le même export pour l'hébergement statique.

Pour travailler sur les sources :

```sh
python3 -m http.server 8000
# http://localhost:8000/
npm test
python3 build.py
```

Aucune installation npm n'est nécessaire. Les scripts restent en JavaScript classique avec IIFE et `globalThis`, dans l'ordre compatible avec Hardgraft.

La page propose une seed modifiable, Randomiser, quatre sliders, une vue globe et une vue carte. Le globe garde une caméra fixe de face ; le zoom reste disponible. La vue carte reste accessible à côté du globe. La grille, l'éclairage global et l'atmosphère sont composés à part de la texture. Les exports PNG et HTML conservent le monde affiché.

| Fichier | Responsabilité |
| --- | --- |
| `src/random.js` | Seeds, PRNG, bruit cohérent et flux aléatoires séparés |
| `src/geography.js` | 2 à 3 continents, côtes à plusieurs échelles et distances au rivage |
| `src/world.js` | Archipels, massifs, bassins, forêts et collines |
| `src/assets.js` | Bibliothèque d'illustrations et variantes réutilisables |
| `src/texture.js` | Littoral mesuré, couleurs, forêts, rivières, nuages et texture 2:1 |
| `src/globe.js` | Projection sur sphère, échantillonnage lissé, lumière, grille et halo |
| `src/app.js` | Interface, URL de seed, téléchargement et orchestration |
| `build.py` | Exports HTML autonomes et archive de sources |

Une entrée sans seed choisit un nouveau monde et inscrit sa seed dans l’URL ; recharger ou partager ce lien reproduit exactement le même résultat. Chaque seed produit deux ou trois continents distincts, disposés dans l’hémisphère de face afin qu’ils apparaissent ensemble sur le globe fixe. Comme sur l’image de référence, chaque masse possède un noyau asymétrique, des péninsules longues et des baies profondes. Des baies plus petites, des criques et des caps sont ensuite creusés par un bruit à gradients à plusieurs échelles. Le slider « Découpe du littoral » règle les détails ; « Étendue des continents » agrandit l’ensemble. Les petites poches d’eau et fragments accidentels sont nettoyés par connexité.

Un champ côtier continu de 1537 × 769 échantillons est préparé une seule fois par génération, puis interrogé par interpolation. Les distances sont recalculées depuis les passages sous-pixel du rivage afin de garder une bande de sable fine même dans les criques. Une bande turquoise claire souligne le côté mer de chaque côte et se fond dans l’océan. La texture finale fait 2048 × 1024 ; elle ne contient aucune altitude ni normales de relief.

Les îles suivent les tangentes du littoral en petits arcs, avec de grandes îles côté continent et de plus petites vers le large. Leurs silhouettes sont elles-mêmes déformées et leur placement garde un bras de mer autour de chaque île. Le nombre de continents s'affiche sous Randomiser.

À réglage moyen, la carte place deux à trois chaînes montagneuses principales, réparties entre les continents. Chaque massif garde une emprise stable (écart total inférieur à 20 % entre les tailles extrêmes), avec une hauteur d’affichage normalisée pour les deux images fournies. Leur masque alpha est nettoyé puis davantage adouci avant composition. La texture JPG fournie sert de sol par défaut. Le globe utilise un canvas haute résolution adapté aux écrans denses, avec un rééchantillonnage lissé des images. Les forêts gardent une teinte basse fréquence et les rivières restent dessinées au-dessus du sol.

Les rivières partent des massifs. Les sommets peints restent droits ; les chaînes sont presque horizontales, avec une légère variation d’angle. La sphère garde la même vue frontale pendant la génération et l’exploration. Chaque bassin possède un cours principal qui rejoint la mer ou un lac, avec des affluents qui se raccordent au cours aval. Les largeurs augmentent vers l'embouchure et les berges forment des vallées plus larges. Le routage reste guidé par des règles et des courbes 2D ; aucune simulation hydraulique ou heightmap n'est utilisée. Des banquises polaires et de faibles filaments nuageux complètent la mer.

La bibliothèque d'images est volontairement limitée à `ground-texture.jpg`, `massif-05.webp` et `massif-04.webp`. Les autres images de la version précédente ont été retirées.

Pour raccorder la carte à la sphère actuelle du jeu :

```js
const result = await NereideAtlas.generatePlanetTexture({
  seed: '4E455245',
  width: 2048,
  height: 1024,
  continentSize: 50,
  mountains: 60,
  forests: 65,
  roughness: 45
});

// result.canvas : texture 2:1, sans grille, éclairage ni halo
// result.world : placements et courbes déterministes, sans dépendance au DOM
// result.terrain : Uint8Array de 128 × 64 cellules
// result.world.continents : descriptions des 2–3 grandes masses
// result.world.rivers : troncs et affluents de chaque bassin
// NereideAtlas.Terrain : ocean, land, coast, plain, forest,
//                       hill, mountain, valley, river, snow, lake, ice
// NereideAtlas.classify(result.world, x, y) : classification détaillée
// x = longitude / 180 ; y = -latitude / 90, dans [-1, 1]
```

`world.landDistance(x, y)` est négatif sur la terre ; `world.water(x, y)` inclut la mer et les lacs. Les mêmes seed et réglages donnent les mêmes placements. La texture accepte une largeur paire entre 256 et 4096, avec une hauteur égale à la moitié.

La démo n'est pas encore raccordée aux ressources, bâtiments et routes du jeu. Le relief est illustré en 2D et la logique fluviale reste volontairement artistique. La projection du globe ne transforme pas la carte en terrain 3D.

La vérification fonctionnelle de la version 0.5 est consignée dans `VALIDATION.md`. Le dossier `tests/` garde les tests de déterminisme du monde.
