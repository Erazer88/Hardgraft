# Réseau de données et datacenter

Débloqué par la compétence « Réseau informatique » (voir [`SKILL_TREE.md`](SKILL_TREE.md)),
le réseau de données transforme l'activité de la planète en **points de technologie**,
la monnaie de l'arbre de compétences (elle remplace le Contexte dans la télémétrie).
Les mécaniques du datacenter s'inspirent d'Upload Labs : flux de données, compression,
calcul, envoi, et goulots d'étranglement à équilibrer. Réglages provisoires dans
`src/data/dataNetwork.js` et `src/data/processes.js`.

## Flux

```text
Extracteur en activité ─ 1 Mo/s de données géologiques ─┐
Usine en activité ────── 1 Mo/s de données industrielles ┴→ Parabole la plus proche (≤ 300 km)
  → 4 Mo/s au plus, partagés → Datacenter le plus proche de la planète → inventaire (tampon 200 Mo)
  → Récepteur → Compresseur → Processeur → Liaison montante → points de technologie
```

- Une donnée vaut 1 u = 1 Mo. Seuls les bâtiments en activité (`status: 'active'`)
  émettent : une chaîne bloquée n'envoie rien.
- Chaque bâtiment rejoint la parabole la plus proche dans sa portée. Une parabole
  saturée partage sa bande passante entre ses sources. Elle envoie au datacenter le
  plus proche de la planète, sans limite de distance.
- Au-delà du tampon du datacenter, les données sont perdues (compteur `dataLost`).
- Ni le datacenter ni la parabole ne demandent de route.
- `src/simulation/dataNetwork.js` calcule les liaisons (`state.dataLinks`, non
  sauvegardé) ; le rendu trace les lignes bâtiment → parabole, le faisceau animé
  parabole → datacenter et la portée d'une parabole posée ou sélectionnée.

## Cartes du datacenter

| Carte | Entrée | Sortie | Débit | Énergie |
| --- | --- | --- | ---: | ---: |
| Récepteur | Données reçues (une sorte choisie) | Données brutes | 4 Mo/s | 3 MW |
| Compresseur | 4 Mo bruts (géologiques ou industriels) | 1 Mo compressé | 4 Mo/s | 10 MW |
| Processeur | 2 Mo compressés | 1 analyse | 1 Mo/s | 30 MW |
| Liaison montante | 1 analyse | 1 point de technologie | 1 /s | 5 MW |
| Corbeille | Toute donnée | — (effacée) | 50 Mo/s | 0 MW |

Une chaîne complète traite 4 Mo/s et rend 0,5 point/s (30 par minute) pour 48 MW.

## Énergie et refroidissement

Le datacenter enregistre la température de son site à la pose (`siteTemperature`) :
température moyenne de la planète, +12 °C à l'équateur, −0,45 °C par degré de
latitude, −6,5 °C par km d'altitude. Ses cartes consomment leur puissance multipliée
par un facteur de refroidissement : `1 + 0,02 × T`, borné entre 0,6 et 2,5 (×1 à 0 °C,
×1,6 à 30 °C). Le site et le facteur s'affichent pendant la pose et sur sa fiche.
Mieux vaut un site froid (pôles, montagne) et beaucoup d'éoliennes.

## Vérification

```sh
node --test tests/process-simulation.test.cjs tests/orbital-logistics.test.cjs
```
