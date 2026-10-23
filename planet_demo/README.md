# Néréide — planète stylisée 0.1.0

Démo autonome pour Hardgraft : une carte procédurale illustrée en Canvas 2D, affichée sur un globe. Aucun moteur 3D, aucune tectonique, aucune heightmap ni shader de relief. Cette version de démo est indépendante de la version du jeu Néréide.

Ouvrir `dist/nereide-atlas-v0.1.html` dans Firefox ou Chromium, même sans connexion. Le fichier contient le code, les styles et les quatre images d'origine. `dist/index.html` est le même export pour l'hébergement statique.

Pour travailler sur les sources :

```sh
python3 -m http.server 8000
# http://localhost:8000/
npm test
python3 build.py
```

Aucune installation npm n'est nécessaire. JavaScript classique en IIFE et `globalThis`, compatible avec l'architecture actuelle de Hardgraft.

La démo propose une seed modifiable (hexadécimal ou nom), Randomiser, quatre sliders, une vue globe et une vue carte. Glisser ou utiliser les flèches pour tourner ; molette ou boutons pour zoomer. La grille et le halo restent propres à l'aperçu. Le lien copié contient la seed et les quatre réglages. Les exports PNG et HTML conservent le monde affiché.

| Fichier | Responsabilité |
| --- | --- |
| `src/random.js` | Seeds, PRNG et bruit cohérent ; flux aléatoires séparés par couche |
| `src/world.js` | Modèle pur : masques, îles, lacs, chaînes, forêts, collines et tracés de rivières |
| `src/assets.js` | Chargement des quatre assets et petites variantes mises en cache ; motifs vectoriels de secours |
| `src/texture.js` | Composition de la carte 2:1 et classification des terrains |
| `src/globe.js` | Projection orthographique de la texture, lumière légère, grille et atmosphère |
| `src/app.js` | Interface, URL, téléchargement et orchestration |
| `build.py` | Exports HTML autonomes et archive de sources |

La silhouette fusionne plusieurs ellipses, des baies et une perturbation basse fréquence. Les côtes sont interpolées, avec une bande turquoise fine et une plage. Les forêts sont des zones irrégulières, pas des tirages uniformes sur toute la carte. Les rivières suivent des courbes simples depuis les massifs ou des sources intérieures ; leur parcours est tronqué sur la première côte ou le premier lac réellement rencontré. Les lacs ont plusieurs lobes et les îles restent séparées de la terre principale.

Les images fournies (`mountain.webp`, `forest.webp`, `hills.svg`, `valley.svg`) sont conservées. La bibliothèque dérive 24 variantes de petits reliefs et 20 variantes forestières à partir des illustrations existantes, avec cadrage, miroir, légère variation de saturation et bords adoucis. Vingt motifs de collines complètent les assets. La silhouette teintée de vallée sert aux berges ; le tracé bleu est généré séparément, ce qui évite une rivière décorative déconnectée. Les variantes ne sont pas autant d'illustrations originales distinctes.

Pour préparer le raccord à la sphère du jeu :

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
// result.world : données et placements, sans dépendance au DOM
// result.terrain : Uint8Array de 128 × 64 cellules
// NereideAtlas.Terrain : ocean, land, coast, plain, forest,
//                       hill, mountain, valley, river, snow, lake
// NereideAtlas.classify(result.world, x, y) : classification plus précise
// x = longitude / 180 ; y = -latitude / 90, dans [-1, 1]
```

`world.landDistance(x, y)` est négatif sur la terre ; `world.water(x, y)` inclut la mer et les lacs. La texture accepte une largeur paire entre 256 et 4096 et une hauteur égale à la moitié. Les bords longitudinaux sont océaniques et se raccordent. Le modèle conserve sa seed, et tous les réglages appartiennent à son identité reproductible. Les rasterisations de navigateurs différents peuvent présenter de petites différences de pixels malgré des données identiques.

La démo n'est pas encore raccordée aux ressources, bâtiments et routes du jeu. Les formes restent une composition artistique simple ; aucune simulation géologique ou hydraulique n'est effectuée. Le globe calcule uniquement une projection de pixels sur une sphère lisse et utilise une résolution réduite pendant le déplacement.

Validation 0.1 : six tests Node couvrent le déterminisme, les seeds zéro et textuelles, les marges côtières, les îles, lacs, rivières, sliders à zéro et classes de terrain. Les contrôles navigateur supplémentaires sont consignés dans `VALIDATION.md` lors de la livraison.
