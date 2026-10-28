# Hardgraft — règles de travail

## Invariants permanents

- Garder JavaScript simple, sans framework ou dépendance ajoutés sans besoin réel.
- Préserver la compatibilité PC et mobile, les sauvegardes, la génération déterministe
  par graine et les exports HTML autonomes.
- Conserver le chargement actuel par IIFE/globalThis et l'ordre des scripts dans
  `index.html`. Ne pas migrer vers ESM/npm dans une tâche locale.
- Séparer données, simulation, gameplay, UI et rendu. La simulation ne dépend ni du
  DOM ni de Canvas ; le rendu affiche l'état et l'UI ne produit pas de ressources.
- Garder les paramètres de gameplay déclaratifs lorsqu'ils peuvent l'être.
- Ne pas réécrire un système fonctionnel sans nécessité. Faire la modification minimale
  qui répond à la demande.
- Une mécanique future décrite dans le GDD n'est pas une demande d'implémentation.
- Lire uniquement le contexte et les références pertinents à la tâche ; ne pas lire
  intégralement `docs/reference/*.txt` par défaut.

## Priorité des décisions

En cas de contradiction, appliquer dans cet ordre :

1. demande actuelle de l'utilisateur ;
2. règles techniques permanentes de ce fichier ;
3. décisions actuelles dans [`docs/CURRENT_CONTEXT.md`](docs/CURRENT_CONTEXT.md) ;
4. documentation spécialisée du système concerné ;
5. documents de conception historiques dans `docs/reference/`.

## Workflow

**ITÉRATION — mode par défaut.** Inspecter le minimum utile, faire la modification
demandée et lancer les tests ciblés pertinents. Ne pas lancer automatiquement la suite
complète ou un smoke navigateur complet ; ne pas incrémenter la version, lancer
`build.py`, régénérer les exports, committer ou pousser.

**LIVRAISON — sur demande explicite de livraison/version/commit ou pour un lot cohérent.**
Lancer la suite complète et les smoke tests pertinents, incrémenter `package.json`,
exécuter `python3 build.py`, vérifier les exports, puis committer et pousser sur
`codex/nereide-prototype`. `src/data/version.js` et `dist/` sont générés : ne pas les
éditer à la main. Dans la réponse de livraison, fournir le commit, la version et
l'aperçu testable dans Firefox. Préférer RawGithack ; si le service est indisponible,
utiliser HTMLPreview. Ne pas présenter un aperçu inaccessible comme testable, ni un
aperçu publié comme contenant les changements d'une itération qui n'a pas été poussée.

## Repères rapides

- Commencer par [`docs/CURRENT_CONTEXT.md`](docs/CURRENT_CONTEXT.md), puis lire seulement
  la référence de la tâche. Voir [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) pour les
  modules et [`README.md`](README.md) pour lancer le jeu.
- Processus industriels : [`docs/PROCESS_SYSTEM.md`](docs/PROCESS_SYSTEM.md).
- Génération : [`docs/WORLDGEN.md`](docs/WORLDGEN.md).
- Routes : [`docs/ROAD_SYSTEM.md`](docs/ROAD_SYSTEM.md).
- Colonie, population et déblocage : [`docs/COLONY.md`](docs/COLONY.md).
- Les textes de `docs/reference/` conservent la conception et les plans historiques ;
  ils ne priment pas sur les décisions actuelles.
