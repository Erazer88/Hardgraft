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
| 1 | 1 000 roches brutes | 200 |
| 2 | 150 goudrons | 400 |
| 3 | 25 plaques de métal | 800 |
| 4 | un hub (plateforme de lancement) assemblé sur sa planète | 1 600 |

À partir du palier 2, ce que demandaient les paliers précédents doit continuer
d'arriver en flux régulier (`flowPerMinute`) : roche brute 500/min au palier 2, roche
brute 500/min et goudron 25/min au palier 3, plus 1 plaque/min au palier 4. Le dû de chaque flux grandit avec le temps
(au plus deux minutes de retard) et se paie en unités entières avec ce qui arrive. Les
quantités du palier n'avancent que tant que chaque flux a moins d'une minute de retard.
Le menu de la colonie affiche ces flux (tenus ou en retard).

Un palier peut demander un bâtiment plutôt que des ressources (`requires`) : le palier 4
attend un hub assemblé sur la planète de la colonie, ses flux étant tenus.

**Le hub** (`launch_platform`) se bâtit avec des ressources livrées par route
(`constructionNeeds`, valeurs provisoires) : 25 plaques de métal, 50 goudrons,
15 cuivres bruts, 15 silicium bruts et 100 eaux douces. Posé, il devient un chantier
(`constructionState: 'supplying'`) que les Docks de sortie peuvent choisir comme
destination ; il ne prend que ce qui lui manque. Une fois tout livré, les robots
l'assemblent (2 s). Sa fiche, sa balise et le menu de la colonie montrent l'avancement.

La population ne baisse pas et n'a pas d'autre effet pour l'instant. Après le dernier
palier, aucun flux n'est plus exigé ; les paliers suivants viendront plus tard.

## Menu de la colonie

Un clic sur la colonie ouvre son propre menu (`src/ui/colonyPanel.js`) : nom modifiable,
frise des paliers de population, contexte, quantités du palier en cours (barre,
débit reçu et temps estimé), flux requis (débit reçu face au débit demandé, retard),
arrivées par ressource et par fournisseur, réserve, total
consommé, zone (surface, cible, maximum) et énergie de la planète. Les débits viennent
des totaux reçus que la logistique tient sur chaque destination (`receivedTotal`,
`receivedFrom`, non sauvegardés), en moyenne glissante sur les 30 dernières secondes de jeu ; le menu se redessine toutes les
5 s, en nombres entiers avec unités d'échelle (u, ku, Mu, Gu). Les quantités du palier en
cours (valeur et barre) suivent chaque rafraîchissement de l'interface (0,35 s).

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
| Palier 1 atteint (elle demande du goudron) | Usine, Terril, Port | Concasseur, Broyeur, Trieuse de carbone, Four à goudron, Quai d'entrée, Retraitement, Incinérateur |
| Palier 2 atteint (elle demande des plaques) | Dépôt | Séparateur magnétique, Four · fer, Laminoir, cartes du dépôt |
| Palier 3 atteint, 800 habitants (elle demande le hub) | Station de pompage, Hub | Séparateur gravitaire, Four · cuivre, Laveuse et sécheur de silice, Four · silice, Pompe, Dessalinisateur |

Un court message signale ce qui apparaît. Le réglage développeur « Tout débloquer »
montre tout. La plateforme pétrolière et la Réserve d'eau infinie restent hors
progression.

## Repères

Avec une seule foreuse (6 u/s) reliée par route à la colonie, le palier 1 prend
environ trois minutes. Les sauvegardes antérieures à la colonie (version 10) démarrent une
nouvelle partie.
