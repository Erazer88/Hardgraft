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

- L'usine V1 couvre la chaîne du fer (Foreuse → Concasseur → Broyeur → Séparateur
  magnétique → Four de réduction), une Poubelle et un Dock de sortie. Le Dock transfère
  les matières vers `building.dockStock`, séparé des autres inventaires. Les définitions
  et recettes sont déclaratives ; les buffers et quantités sont entiers.
  Référence : [`PROCESS_SYSTEM.md`](PROCESS_SYSTEM.md).
- La Foreuse n'a pas de plafond nominal. Tous les autres bâtiments tournent à 2 u/s,
  comme le Concasseur niveau 1, premier goulot de la chaîne. La Poubelle détruit les
  unités à cette cadence. Paramètres : `src/data/processes.js`.
- Le graphe V1 est version 4. Les sauvegardes générales sont restaurées au mieux,
  même si leur numéro de format est inconnu ; les plans industriels antérieurs sont
  réinitialisés plutôt que migrés. Les connexions nomment explicitement les deux
  machines et leurs ports.
- Le moteur pur est dans `processGraph.js` et `processSimulation.js`. L'éditeur garde
  son affichage dans `factoryEditor.js` et les gestes dans `factoryViewport.js`.
  `node --test tests/process-simulation.test.cjs` vérifie le moteur ;
  `npm run test:factory-editor` valide les gestes dans un vrai navigateur desktop et
  en émulation tactile.
- Le Dock choisit une destination parmi les usines (`factory`) et les Plateformes de
  lancement (`launch_platform`) terminées de la planète. Le transfert est instantané
  après un chemin terrestre entièrement construit ; une plateforme lance automatiquement
  ce qu'elle reçoit. Les autres bâtiments ne sont pas des destinations en V1. Les routes
  n'ont ni capacité ni temps de trajet. Référence : [`ORBITAL_LOGISTICS.md`](ORBITAL_LOGISTICS.md)
  et [`ROAD_SYSTEM.md`](ROAD_SYSTEM.md).
- L’Arche est un objet orbital déterministe distinct de l’épave du système primaire.
  Son stock entier infini est sauvegardé. Le lancement traite en moyenne 4 u/s par
  paquets entiers de 10 secondes ; la capacité énergétique de test est de 5 MW,
  déclarée dans `src/data/orbitalLogistics.js`.
- Le transit spatial est sauvegardé en lots entiers avec des heures absolues de départ
  et d’arrivée en temps simulé. Les cargos sont un rendu séparé et ne portent aucune
  matière. Les nouveaux cargos utilisent un transfert orbital prograde déterministe ;
  les lots déjà en transit conservent leur échéance et leur modèle visuel. Aucun flux
  Hub → planète n’est implémenté. Voir
  [`ORBITAL_LOGISTICS.md`](ORBITAL_LOGISTICS.md).

## Décisions de conception validées

- Il n'existe pas de stock global dépensable. Les ressources appartiennent à un réseau
  logistique local ; les bâtiments connectés à un réseau partagent son stock limité.
- Le modèle cible du transport terrestre est agrégé : pas de cargaisons simulées
  individuellement, transfert économiquement instantané sous les limites du réseau.
  L’implémentation actuelle ne couvre que la connectivité Dock → Plateforme, sans
  capacité routière ni contre-pression générale.
- Dans un bâtiment, les processus restent précis : buffers, cycles, recettes, connexions,
  débits, énergie et blocages. Principe directeur : précision à l'intérieur,
  agrégation entre bâtiments.
- Le transport spatial a une capacité limitée et un temps de trajet réel. Construction
  et approvisionnement dépendants du réseau local restent à venir.
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
- Le réseau logistique partagé entre bâtiments, ses dépôts, limites de stock et
  contre-pression restent à venir. Une route conditionne actuellement le transfert
  instantané du stock de Dock vers une Plateforme de lancement.
- Plusieurs Plateformes de lancement peuvent être construites sur une même planète ;
  aucune d'elles n'est un bâtiment principal obligatoire.
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
| Export orbital | `src/data/orbitalLogistics.js`, `src/simulation/logisticsNetwork.js`, `src/simulation/orbitalTransit.js`, `src/gameplay/logistics.js` | `node --test tests/orbital-logistics.test.cjs` |
| Export autonome | `build.py`, `index.html`, références depuis le script concerné | `python3 build.py` lors d'une livraison |

Suite complète : `npm test`. Smoke navigateur : `node tests/browser-smoke.cjs` lorsque
l'application, la navigation ou l'UI changent.
