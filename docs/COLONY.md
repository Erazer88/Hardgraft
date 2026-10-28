# Colonie, population et progression

## Colonie

La Colonie est obligatoirement le premier bâtiment : au départ, le menu de construction
ne propose qu'elle. Le joueur la pose où il veut sur la terre ferme. Il n'y en a qu'une
dans la partie ; elle ne se démolit pas. Elle reçoit par route, comme une usine, mais
sans carte : un Dock de sortie peut l'avoir pour destination. Son générateur fournit
12 MW à sa planète (`generatorMW`).

- **Population** : 100 habitants au départ, puis par paliers.
- **Contexte** : 1 point par minute dès que la colonie est assemblée
  (`state.contextPoints`, total galactique).
- **Paliers** (`src/data/colony.js`) : chaque palier consomme les ressources qu'il
  demande (elles disparaissent), puis fait passer la population au niveau suivant. Ce
  que le palier ne demande pas attend en réserve dans la colonie.

| Palier | Demande | Population atteinte |
| --- | --- | ---: |
| 1 | 500 roches brutes | 200 |
| 2 | 150 goudrons | 400 |
| 3 | 25 plaques de métal | 800 |

La population ne baisse pas et n'a pas d'autre effet pour l'instant. Les paliers
suivants (cumuls de plusieurs ressources) viendront plus tard.

## Zone

La colonie occupe une zone qui grandit avec ce qu'elle a consommé : 600 km² au départ,
plus 1 km² par unité consommée, jusqu'à 6 000 km² (`zone`). La zone pousse depuis le
point de pose, case de terrain par case (9 km²), d'abord sur sa strate de relief (±1),
sans eau, sans approcher les autres bâtiments (une case de marge) et en restant
groupée. Elle ne perd jamais de case (`src/gameplay/colonyZone.js`). On ne construit
rien dans la zone. Rendu : aplat néon doré, plus vif au bord, contour lumineux, icône et
population au centre.

## Déblocage naturel

Les bâtiments et les cartes apparaissent quand la colonie en a besoin ; rien n'est
affiché verrouillé (`src/data/progression.js`, `src/gameplay/progression.js`) :

| Quand | Bâtiments | Cartes |
| --- | --- | --- |
| Au départ | Colonie | — |
| Colonie posée (elle demande de la roche) | Extracteur | Foreuse, Dock de sortie |
| Une planète manque d'énergie | Éolienne | — |
| Palier 1 atteint (elle demande du goudron) | Usine, Terril | Concasseur, Broyeur, Trieuse de carbone, Four à goudron, Quai d'entrée, Retraitement, Incinérateur |
| Palier 2 atteint (elle demande des plaques) | Dépôt | Séparateur magnétique, Four · fer, Laminoir, cartes du dépôt |

Un court message signale ce qui apparaît. Le réglage développeur « Tout débloquer »
montre tout. La plateforme de lancement, le port, la station de pompage et la plateforme
pétrolière viendront avec les paliers suivants.

## Repères

Avec une seule foreuse reliée par route à la colonie, le palier 1 prend environ
4 minutes (testé). Les sauvegardes antérieures à la colonie (version 10) démarrent une
nouvelle partie.
