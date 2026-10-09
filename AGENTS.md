# Hardgraft — consignes de développement

Lire intégralement avant toute modification :

- `docs/reference/gameplay.txt` : Game Design Source of Truth.
- `docs/reference/agents.txt` : Plan Codex, missions et dépendances.
- `docs/reference/general.txt` : règles générales.
- `README.md` et les fichiers/tests concernés.

Les PDF originaux sont conservés dans le même dossier. Ces documents fournis
par l'utilisateur remplacent les anciennes hypothèses de gameplay.

Travailler sur une seule mission demandée à la fois. Commencer par Agent 00
(architecture) ; ne pas démarrer la mission suivante sans demande explicite.
Préserver génération, seeds, zoom continu, mobile, sauvegardes et HTML autonome.
Avant de coder, annoncer le plan minimal et les fichiers concernés.

Séparer données, simulation, rendu et interface. La simulation est testable sans
Canvas ; paramètres et recettes sont déclaratifs. JavaScript simple et modules
IIFE sont acceptés. Éviter frameworks, abstractions prématurées et dépendances.

Les blocs industriels seront dans l'espace interne fini d'une usine. Leur
placement ne modifie pas les performances. Transferts internes instantanés si
le stock suivant a de la place ; transports hors usine temporisés. Énergie
globale par usine. Ne pas implémenter ces mécaniques pendant Agent 00.

Après chaque mission : tests unitaires et smoke tests pertinents ; vérifier
mobile et bureau si l'interface est concernée. Rapporter fichiers, résultat,
tests, limites, risques et prochaine dépendance. Ne pas étendre le scope aux
mécaniques galactiques, monétaires, orbitales avancées ou au Contexte complet.

Agent 00 travaille seul sur la structure commune. Les tâches suivantes peuvent
être parallélisées uniquement sur des fichiers distincts, après intégration et
validation de leur base commune.

## Livraison et version

Chaque mise à jour doit être testée, puis commitée et poussée sur GitHub dans
la branche `codex/nereide-prototype`. Fournir le lien du commit à la livraison.

`package.json` est la référence du numéro de version. Incrémenter la version
pour chaque mise à jour livrée et exécuter `python3 build.py` : il génère
`src/data/version.js` et les exports. Le HUD affiche cette version en bas du jeu.
Ne pas modifier directement le fichier de version généré.

Terminer chaque réponse à l'utilisateur dans ce chat, y compris les points
d'avancement, par `Version actuelle : X.Y.Z`, avec la version courante du projet.
