# Arbre de compétences

L'arbre de compétences fait suite à la logistique jusqu'à l'Arche : il servira à sortir
du système (sondes, observation, voyages). Il est volontairement presque vide pour
l'instant.

## État actuel

- **Ouverture.** L'arbre se révèle quand les premières ressources arrivent dans le
  stock d'une Arche (`OrbitSkills.advance`, `state.skills.revealed`, sauvegardé). Un
  message l'annonce et un bouton « ✦ COMPÉTENCES » apparaît dans la télémétrie, sous
  le Contexte. Le réglage développeur « Tout débloquer » le montre d'office.
- **Menu.** Écran plein (`src/ui/skillTree.js`) : les compétences connues sont des
  nœuds (acquise, à débloquer, verrouillée), le reste des silhouettes « ? » dans le
  brouillard (`OrbitSkillData.fog`, décoratives). Le panneau du bas décrit la
  compétence choisie : description, effet, coût. Échap ou × ferme.
- **Compétence unique : Réveil des archives** (`archive_awakening`). Sans coût ni
  prérequis : un toucher la débloque. Elle n'a pas encore d'effet de jeu.

Une compétence se déclare dans `src/data/skills.js` : `id`, `label`, `mark`,
`description`, `effect`, `cost` (ressources ou `context`), `requires` (identifiants),
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
