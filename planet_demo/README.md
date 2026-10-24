# Néréide — planète stylisée 0.2.1

Démo autonome Hardgraft : une carte procédurale illustrée en Canvas 2D, affichée sur un globe. Aucun moteur 3D, système tectonique, heightmap ou shader de relief. La version reste indépendante du jeu Néréide.

Ouvrir \`dist/nereide-atlas-v0.2.html\` dans Firefox ou Chromium, y compris hors connexion. Le fichier contient le code, les styles et les quatre assets d'illustration. \`dist/index.html\` est le même export pour l'hébergement statique.

Pour travailler sur les sources :

\`\`\`sh
python3 -m http.server 8000
# http://localhost:8000/
npm test
python3 build.py
\`\`\`

Aucune installation npm n'est nécessaire. Les scripts restent en JavaScript classique avec IIFE et \`globalThis\`, dans l'ordre compatible avec Hardgraft.

La page propose une seed modifiable, Randomiser, quatre sliders, une vue globe et une vue carte. Le globe se tourne à la souris, au toucher ou au clavier. La grille, l'éclairage global et l'atmosphère sont composés à part de la texture. Les exports PNG et HTML conservent le monde affiché.

| Fichier | Responsabilité |
| --- | --- |
| \`src/random.js\` | Seeds, PRNG, bruit cohérent et flux aléatoires séparés |
| \`src/world.js\` | Continent, baies, archipels, massifs, bassins, forêts et collines |
| \`src/assets.js\` | Bibliothèque d'illustrations et variantes réutilisables |
| \`src/texture.js\` | Littoral mesuré, couleurs, forêts, rivières, nuages et texture 2:1 |
| \`src/globe.js\` | Projection sur sphère, échantillonnage lissé, lumière, grille et halo |
| \`src/app.js\` | Interface, URL de seed, téléchargement et orchestration |
| \`build.py\` | Exports HTML autonomes et archive de sources |

La silhouette fusionne plusieurs blobs, de grandes baies et un bruit doux à plusieurs échelles. Les îles se regroupent en archipels. Le littoral est échantillonné depuis le champ continu de la carte, sur une grille de 1024 × 512 au maximum. L'eau côtière, le sable et les masques d'assets suivent cette distance, ce qui évite les marches dues à une côte binaire.

À réglage moyen, la carte place deux longues chaînes montagneuses principales. Les pics réutilisent les illustrations d'origine, réduites pour se composer en lignes de relief. Les forêts forment des zones irrégulières faites d'arbres groupés et de quelques petits assets de feuillage. Les sommets, les arbres, les rivières et les lacs restent lisibles à l'échelle du globe.

Les rivières partent des massifs. Chaque bassin possède un cours principal qui rejoint la mer ou un lac, avec des affluents qui se raccordent au cours aval. Les largeurs augmentent vers l'embouchure et les berges forment des vallées plus larges. Le routage reste guidé par des règles et des courbes 2D ; aucune simulation hydraulique ou heightmap n'est utilisée. Des banquises polaires et de faibles filaments nuageux complètent la mer.

Les quatre illustrations de départ (\`mountain.webp\`, \`forest.webp\`, \`hills.svg\`, \`valley.svg\`) sont réutilisées en variantes par cadrage, miroir, légère variation de saturation et dessin Canvas de secours. Les deux grands collages de forêt et de montagne ajoutés en 0.2.0 ont été retirés : ils prenaient trop de place et leur texture contrastait avec le reste de la carte.

Pour raccorder la carte à la sphère actuelle du jeu :

\`\`\`js
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
// result.world.rivers : troncs et affluents de chaque bassin
// NereideAtlas.Terrain : ocean, land, coast, plain, forest,
//                       hill, mountain, valley, river, snow, lake, ice
// NereideAtlas.classify(result.world, x, y) : classification détaillée
// x = longitude / 180 ; y = -latitude / 90, dans [-1, 1]
\`\`\`

\`world.landDistance(x, y)\` est négatif sur la terre ; \`world.water(x, y)\` inclut la mer et les lacs. Les mêmes seed et réglages donnent les mêmes placements. La texture accepte une largeur paire entre 256 et 4096, avec une hauteur égale à la moitié.

La démo n'est pas encore raccordée aux ressources, bâtiments et routes du jeu. Le relief est illustré en 2D et la logique fluviale reste volontairement artistique. La projection du globe ne transforme pas la carte en terrain 3D.

La vérification fonctionnelle de la version 0.2.1 est consignée dans \`VALIDATION.md\`. Le dossier \`tests/\` garde également les tests de déterminisme de la version précédente.
