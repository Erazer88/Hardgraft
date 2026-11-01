# Arbre de compétences

L'arbre de compétences fait suite à la logistique jusqu'à l'Arche : il servira à sortir
du système (sondes, observation, voyages). Il est volontairement presque vide pour
l'instant.

## État actuel

- **Ouverture.** L'arbre se révèle quand les premières ressources arrivent dans le
  stock d'une Arche (`OrbitSkills.advance`, `state.skills.revealed`, sauvegardé). Un
  message l'annonce et un bouton « ✦ COMPÉTENCES » apparaît dans la barre du haut, à côté
  des points de technologie. Le réglage développeur « Tout débloquer » le montre d'office.
- **Menu.** Écran plein (`src/ui/skillTree.js`) : les compétences connues sont des
  nœuds (acquise, à débloquer, verrouillée), le reste des silhouettes « ? » dans le
  brouillard (`OrbitSkillData.fog`, décoratives). Le panneau du bas décrit la
  compétence choisie : description, effet, coût. Échap ou × ferme.
- **Réveil des archives** (`archive_awakening`) : sans coût ni prérequis, un toucher la
  débloque ; elle n'a pas d'effet de jeu.
- **Réseau informatique** (`computer_network`) : requiert la précédente, gratuite.
  Débloque le Datacenter, l'Antenne relais, l'Antenne haute fréquence et leurs cartes (étape `network` de
  `src/data/progression.js`, condition `{ skill }`). Voir
  [`DATA_NETWORK.md`](DATA_NETWORK.md).
- **Atterrisseur** (`lander`, 200 points tech) : sur une planète sans colonie, permet
  de poser une colonie (mondes rocheux) et des laboratoires d'analyse (toutes les
  planètes ; en orbite des géantes gazeuses, depuis la vue système). Une fois la
  colonie posée, tout ce qui est débloqué s'y construit (`buildBlockedHere`).
- **Points de technologie** (`state.techPoints`, sauvegardés) : produits par les
  datacenters, ils paient la suite de l'arbre (`cost.tech`) et sont le seul compteur
  de points de la barre du haut (« TECH »), dans toute partie. Une compétence atteignable mais trop
  chère s'affiche « points insuffisants ».

Une compétence se déclare dans `src/data/skills.js` : `id`, `label`, `mark`,
`description`, `effect`, `cost` (`tech` : points de technologie), `requires` (identifiants),
position `x`, `y` (fractions de la carte). `src/gameplay/skills.js` gère révélation,
prérequis et acquisition (`state.skills.unlocked`, ne fait que grandir).

## Pistes proposées (non décidées)

Proposées au joueur, à confirmer avant de coder :

- **Arche** : noyau de calcul (vitesse de recherche), atelier orbital (fabriquer
  sondes et vaisseaux depuis le stock de l'Arche), lecture des protocoles (Contexte).
- **Observation** : télescope orbital, spectromètre, radar de proximité (ceintures,
  astéroïdes, épaves), interféromètre (systèmes voisins), écoute profonde (signaux).
- **Sondes du système** : sonde orbitale, atterrisseur, sonde de prospection, drone de
  récupération d'épave, relais.
- **Logistique spatiale** : lanceur lourd, rampe électromagnétique, navette, mineur
  d'astéroïdes, station orbitale.
- **Interstellaire** : sonde interstellaire (remplacerait la sonde gratuite de la vue
  galaxie), sonde de l'espace profond, propulsion, vaisseau-graine.
- **Industrie** : récupération 95 %, séparateurs à 6 u/s, équipe de robots, valorisation
  des déchets, solaire et géothermie.

Questions ouvertes : coût en Contexte seul ou avec matériaux de l'Arche ; Contexte lié
à la population ; recherche avec durée ou achat immédiat ; épaves et ceintures cachées
jusqu'au radar.

## Vérification

```sh
node --test tests/orbital-logistics.test.cjs
```
