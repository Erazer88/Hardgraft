# Validation — démo Néréide 0.2.0

Livraison du 24 octobre 2026. La démo demeure séparée du jeu Hardgraft.

- Vérification syntaxique des scripts JavaScript et génération du paquet avec \`build.py\`.
- Aperçu Chromium à 1440 px et 390 px ; aucun débordement mobile ni erreur JavaScript.
- À la seed \`4E455245\` : deux massifs, deux cours principaux (un vers un lac, un vers la mer), trois affluents, onze îles et deux lacs.
- Les six illustrations sont chargées ; la carte 2:1 et la vue globe rendent les rivières, plages et massifs sans erreur.
- Export autonome \`dist/nereide-atlas-v0.2.html\` : 1,4 Mo ; CSS, scripts et assets sont intégrés au fichier, sans requête d'asset externe.

## Version 0.1.0

Livraison du 23 octobre 2026, démo autonome ajoutée à côté du jeu. Les modules du jeu, sa version 0.34.109, ses sauvegardes et ses exports existants restent inchangés.

- **6 tests Node réussis** : déterminisme des données et des placements, seed zéro et noms, marges de placement, îles et lacs, sources et exutoires des rivières, réglages à zéro et API de classification.
- **21 contrôles Chromium et 24 contrôles Firefox réussis**, sans exception JavaScript : images chargées, reproduction des pixels, contrôles de caméra, grille séparée de la texture, vue à plat, Randomiser, quatre sliders, URL de seed, exports et erreurs de saisie.
- **320, 390, 1024 et 1440 px** : aucun débordement horizontal ; le canvas reste dans son panneau.
- **Export PNG** : 1536 × 768 ; raccord longitudinal vérifié. L'API accepte également d'autres résolutions 2:1.
- **Export HTML téléchargé** : ouvert dans Firefox par \`file://\`, réseau désactivé, sans requête HTTP. La seed zéro, les quatre paramètres et les pixels de la texture sont préservés. Le Chromium de l'environnement interdit les URL de fichiers par sa politique administrateur ; ce contrôle a donc été fait dans Firefox.
- **Suite du jeu existant** : 89 tests validés. Le premier passage sur l'extraction partielle a signalé un asset de village absent ; après extraction des assets existants, le test concerné a été rejoué avec succès. Aucun correctif du jeu n'a été nécessaire.
- **Build autonome** : scripts, CSS et quatre assets embarqués, sans dépendance réseau. Les deux pages dans \`dist/\` sont identiques et générées par \`build.py\`.

Les émulations de taille et de gestes ne remplacent pas un essai sur téléphone physique. Le dessin d'assets Canvas peut présenter des différences de rasterisation entre navigateurs ; le modèle du monde et ses placements restent déterministes. Le raccord aux ressources, bâtiments et routes de la sphère du jeu reste l'étape suivante.

Pour relancer les contrôles navigateur avec Playwright installé :

\`\`\`sh
python3 -m http.server 8000 --directory dist
python3 tests/browser-smoke.py --browser chromium
python3 tests/browser-smoke.py --browser firefox
\`\`\`

\`NEREIDE_BASE_URL\` permet de changer le serveur ; \`NEREIDE_QA_DIR\` choisit le dossier des captures et résultats JSON. Ces outils de vérification ne sont pas des dépendances de la démo.
