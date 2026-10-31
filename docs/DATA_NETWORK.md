# Réseau de données et datacenter

Débloqué par la compétence « Réseau informatique » (voir [`SKILL_TREE.md`](SKILL_TREE.md)),
le réseau de données transforme l'activité des planètes en **points de technologie**,
la monnaie de l'arbre (elle remplace le Contexte dans la télémétrie). Toute la galaxie
converge à terme vers l'Arche. Les mécaniques du datacenter s'inspirent d'Upload Labs
(réception, compression, calcul, envoi, goulots à équilibrer). Réglages provisoires dans
`src/data/dataNetwork.js` et `src/data/processes.js`. Une donnée vaut 1 u = 1 Mo.

## Schéma

```text
Planète du datacenter :
  bâtiment en activité → antenne relais (≤ 300 km) → route → datacenter
  → liaison montante → route → antenne haute fréquence → Arche : 1 analyse = 1 point

Autre planète (sans datacenter) :
  bâtiment → antenne relais → route → antenne haute fréquence
  → antenne haute fréquence d'une planète dont le datacenter est relié par la route → datacenter
```

Il n'y a ni station relais ni carte de réception spéciale : les données d'une autre
planète arrivent dans l'inventaire du datacenter comme les autres.

## Sources

| Source | Donnée | Débit |
| --- | --- | ---: |
| Extracteur en activité | Données géologiques | 1 Mo/s |
| Usine en activité | Données industrielles | 1 Mo/s |
| Laboratoire d'analyse | Données planétaires | selon le monde : 1 (tellurique, aride), 1,5 (océanique, glacé), 2 (volcanique), 3 (géante gazeuse) |

Seuls les bâtiments en activité émettent ; le laboratoire, autonome en énergie, émet
toujours. Un laboratoire sans antenne relais à portée (monde sans colonie, orbite d'une
géante gazeuse) émet lui-même ses données comme une antenne haute fréquence.

## Antennes

- **Antenne relais** (`antenna`) : rassemble les sources dans sa portée (300 km),
  4 Mo/s au plus partagés entre elles. Elle transmet par la route au datacenter le plus
  proche, sinon à l'antenne haute fréquence la plus proche. Sans route : « Non relié
  par la route ».
- **Antenne haute fréquence** (`hf_antenna`) : file d'attente de 400 Mo, envoie toutes
  les secondes un paquet par ressource, à débit stable (4 Mo/s, analyses d'abord). Les
  analyses partent vers l'Arche ; les données brutes vers l'antenne haute fréquence
  d'une autre planète qui a un datacenter relié par la route (la plus proche).
- **Vitesse** : 3 fois plus rapide que le fret interplanétaire (même trajet vers
  l'Arche ; ligne droite entre planètes).
- **Conjonction solaire** : si l'étoile passe entre les deux bouts (à moins de 4 rayons
  de la ligne), rien ne part ; la fiche l'indique.
- Paquets en vol sauvegardés (`state.dataTransit`, `src/simulation/dataTransit.js`).
  Rendu : traits bleus et impulsions électriques dans la vue système
  (`src/rendering/dataTrafficRenderer.js`), faisceaux bleus à impulsion en surface.

## Cartes du datacenter

| Carte | Entrée | Sortie | Débit | Énergie |
| --- | --- | --- | ---: | ---: |
| Récepteur | Données reçues (une sorte choisie) | Données brutes | 4 Mo/s | 3 MW |
| Compresseur | 4 Mo bruts (géologiques, industriels ou planétaires) | 1 Mo compressé | 4 Mo/s | 10 MW |
| Processeur | 2 Mo compressés | 1 analyse | 1 Mo/s | 30 MW |
| Stockage | Analyses | Analyses, jusqu'à 10 000 en attente | 20 /s | 1 MW |
| Liaison montante | Analyses | vers l'antenne haute fréquence reliée | — | 5 MW |
| Corbeille | Toute donnée | — (effacée) | 50 Mo/s | 0 MW |

La liaison montante fonctionne comme un Dock de sortie : sans antenne haute fréquence
reliée par la route, elle est « SANS DESTINATION » et la chaîne s'accumule dans le
Stockage, utile pour produire pendant des heures avant d'avoir le réseau vers l'Arche.
Une chaîne complète rend 0,5 analyse/s pour 48 MW.

## Énergie et refroidissement

Le datacenter enregistre la température de son site à la pose (`siteTemperature`) :
température moyenne de la planète, +12 °C à l'équateur, −0,45 °C par degré de
latitude, −6,5 °C par km d'altitude. Ses cartes consomment leur puissance multipliée
par `1 + 0,02 × T`, borné entre 0,6 et 2,5. Mieux vaut un site froid et beaucoup
d'éoliennes.

## Vérification

```sh
node --test tests/process-simulation.test.cjs tests/orbital-logistics.test.cjs
```
