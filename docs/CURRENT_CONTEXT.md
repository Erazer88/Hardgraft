# Contexte courant

État de référence compact pour les petites tâches. Il décrit les décisions de jeu
validées et distingue les systèmes en place des choix encore temporaires. Pour les
conflits, voir l'ordre de priorité dans [`AGENTS.md`](../AGENTS.md).

## Architecture en place

- Prototype HTML/CSS/JavaScript sans framework. `index.html` charge des IIFE exposés
  via `globalThis`; `build.py` embarque scripts, styles et ressources dans le HTML
  autonome. Garder cet ordre de chargement, sans migration ESM/npm transversale.
- Direction des responsabilités : `src/data/` déclare les paramètres ;
  `src/simulation/` porte les modèles et règles testables sans DOM/Canvas ;
  `src/gameplay/` raccorde les systèmes ; `src/ui/` gère DOM et interactions ;
  `src/rendering/` dessine ; `src/app.js` initialise, relie les modules, gère les
  interactions globales et exécute la boucle.
- La génération est déterministe à partir de la graine. Navigation continue,
  sauvegardes locales, construction de surface, routes et éditeur industriel sont
  fonctionnels. Voir [`ARCHITECTURE.md`](ARCHITECTURE.md) pour la carte des modules.

## Systèmes en place et frontières

- L'usine V1 est limitée à la chaîne du fer : Foreuse → Concasseur → Broyeur →
  Séparateur magnétique → Four de réduction. Les définitions et recettes sont
  déclaratives ; les buffers et quantités de matière sont entiers. Référence :
  [`PROCESS_SYSTEM.md`](PROCESS_SYSTEM.md).
- La Foreuse n'a pas de plafond nominal. Le Concasseur niveau 1 traite 2 u/s et forme
  le premier goulot ; les autres capacités sont temporaires et équilibrables dans
  `src/data/processes.js`.
- Le graphe V1 est version 4. Les sauvegardes générales sont préservées ; les plans
  industriels antérieurs sont réinitialisés plutôt que migrés. Les connexions
  nomment explicitement les deux machines et leurs ports.
- Le moteur pur est dans `processGraph.js` et `processSimulation.js`. L'éditeur garde
  son affichage dans `factoryEditor.js` et les gestes dans `factoryViewport.js`.
  `node --test tests/process-simulation.test.cjs` vérifie le moteur ;
  `npm run test:factory-editor` valide les gestes dans un vrai navigateur desktop et
  en émulation tactile.
- Les routes de surface enregistrent géométrie, connexions et progression de
  construction. Elles ne constituent pas encore le transport de ressources entre
  bâtiments. Les quartiers et véhicules visibles sont des représentations séparées.
  Référence : [`ROAD_SYSTEM.md`](ROAD_SYSTEM.md).

## Décisions de conception validées

- Il n'existe pas de stock global dépensable. Les ressources appartiennent à un réseau
  logistique local ; les bâtiments connectés à un réseau partagent son stock limité.
- Le transport terrestre est agrégé : pas de cargaisons simulées individuellement,
  transfert économiquement instantané sous les limites de débit et de capacité. Les
  véhicules visibles représentent le flux. Les dépôts augmentent la capacité ; la
  saturation applique une contre-pression jusqu'à la production amont.
- Dans un bâtiment, les processus restent précis : buffers, cycles, recettes, connexions,
  débits, énergie et blocages. Principe directeur : précision à l'intérieur,
  agrégation entre bâtiments.
- Le transport spatial garde une capacité limitée et un temps de trajet réel.
  Construction et approvisionnement attendront les ressources disponibles sur leur
  réseau local.
- Traiter localement réduit la matière envoyée dans le réseau ; expédier du brut vers
  une méga-usine reste une autre stratégie viable. Une foreuse sans plafond laisse le
  premier bloc de traitement limiter sa chaîne.
- Les recettes du prototype restent temporairement abstraites : le Four de réduction
  ne consomme pas de carbone explicite.

## Modes temporaires et écarts actuels

- Le prototype utilise encore une réserve de colonie infinie et une puissance
  illimitée par éolienne terminée. Ce sont des modes de test, pas l'économie finale ;
  leurs paramètres sont dans `src/data/processes.js`.
- Le code de prototype conserve encore `state.inventory` pour les coûts et
  l'approvisionnement manuel. L'absence de stock global dépensable décrit le modèle
  logistique cible ; ne pas confondre ce contrat avec cette implémentation temporaire.
- Le réseau logistique de ressources entre bâtiments, ses dépôts, sa contre-pression,
  les importations spatiales et la construction dépendante du réseau restent à venir.
- Les routes actuelles sont des infrastructures de surface constructibles, pas le
  réseau économique agrégé décrit plus haut. Ne leur ajouter ni transport ni cargaisons
  en travaillant sur une tâche sans rapport.
- L'analyse qualité est déclarée mais désactivée ; l'économie logistique complète est
  une étape future. Ne pas implémenter ces mécaniques simplement parce qu'elles sont
  décrites dans les références historiques.

## Fichiers à lire selon la tâche

| Tâche | Lecture minimale | Vérification ciblée |
| --- | --- | --- |
| Valeur de recette ou débit | `src/data/processes.js`, puis au besoin `PROCESS_SYSTEM.md` | `node --test tests/process-simulation.test.cjs` |
| Moteur de processus ou transfert | `processGraph.js`, `processSimulation.js` et `PROCESS_SYSTEM.md` | `node --test tests/process-simulation.test.cjs` |
| Génération / graine | `src/data/worldgen.js`, `src/world.js`, `docs/WORLDGEN.md` | `node --test src/world.test.cjs` |
| Caméra / navigation | `src/navigation/camera.js`, `src/app.js`, `src/state.js` | `node --test tests/architecture.test.cjs`; navigateur si interaction modifiée |
| Routes / quartiers | `ROAD_SYSTEM.md` puis le module touché | `node --test tests/settlement-growth.test.cjs tests/settlement-renderer.test.cjs` |
| Interface ou gestes de processus | `src/ui/factoryEditor.js`, `src/ui/factoryViewport.js`, puis modules de graphe concernés | `npm run test:factory-editor` |
| Sauvegarde | `src/storage/save.js`, `src/state.js`, `tests/architecture.test.cjs` | `node --test tests/architecture.test.cjs` |
| Export autonome | `build.py`, `index.html`, références depuis le script concerné | `python3 build.py` lors d'une livraison |

Suite complète : `npm test`. Smoke navigateur : `node tests/browser-smoke.cjs` lorsque
l'application, la navigation ou l'UI changent.
