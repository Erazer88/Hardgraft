# Logistique orbitale V1

Cette tranche relie les sorties d’une usine au stock de l’Arche. Elle ne simule ni
transport terrestre physique, ni flux Hub → planète.

## Flux

```text
Dock de sortie → dockStock → destination choisie au quai
                → route terrestre terminée → inventaire du bâtiment destinataire
                → Plateforme de lancement → lot spatial entier → arrivée → stock de l’Arche
```

`building.dockStock` est distinct de `building.inventory` et de l’inventaire de
construction global. Dans l’éditeur de processus, chaque Dock de sortie choisit une
destination pour sa ressource parmi les usines et les Plateformes de lancement terminées
de la planète. Une usine doit contenir une carte Quai d'entrée ; les Plateformes de
lancement reçoivent nativement. Les autres bâtiments ne sont pas des destinations en V1.
Un chemin terrestre entièrement construit est requis ; les segments en construction et les routes
maritimes ne comptent pas. Le transfert reste instantané et agrégé, sans débit de route
ni véhicules économiques. Une usine reçoit la matière dans son inventaire ; une
Plateforme de lancement la reçoit dans `launchStock`. Le Quai d'entrée affiche
l'inventaire reçu de l'usine et en retire des unités pour alimenter sa sortie interne
raccordée à une machine ; il ne crée aucune matière.

La destination est configurée au Dock, et non sur la plateforme. Toute ressource
transportable peut être routée ; une plateforme lance automatiquement chaque matière
qui lui est livrée. Les valeurs de départ — débit moyen de 4 u/s, paquets toutes les
10 secondes (jusqu’à 40 unités par départ) et 5 MW — restent déclarées dans
`src/data/orbitalLogistics.js`. Les quantités restent entières ; l’agrégation réduit le
nombre de cargos représentés sans changer le débit moyen nominal. Plusieurs plateformes
peuvent être construites sur la même planète ; aucune n’est requise avant les autres
bâtiments.

## Simulation et rendu

Chaque corridor sauvegardé contient seulement `id`, `fromEntityId` et `toEntityId`.
Les lancements utilisent des lots à quantité entière. Leur `departureTime` et leur
`arrivalTime` sont mesurés sur `state.simulation.time` ; pause, sauvegarde et rendu
n’altèrent pas l’échéance. Le stock entier infini de l’Arche n’augmente qu’à l’arrivée.
À l’arrivée, les métaux bruts et le carbone (`constructionCredits`) s’ajoutent aussi,
1 pour 1, au stock de construction de la colonie, comme à la base de débarquement.

La génération d'un nouvel univers réinitialise aussi les corridors, les stocks orbitaux,
les lots et l'horloge de départ. La restauration d'une sauvegarde conserve ces données.
Pour les sauvegardes affectées par l'ancien changement de graine, une échéance de départ
au-delà de la prochaine fenêtre de 10 secondes est recalée sur cette fenêtre, sans
modifier les stocks ni les lots déjà en transit.

L’Arche est un nouvel objet spatial généré de façon déterministe dans le système
primaire. L’épave conserve sa propre identité, sa position et son rendu. Les nouveaux
lots portent le marqueur `trajectoryVersion: 3` ; leur courbe polaire relie la surface
de la planète à la position future de l’Arche à `arrivalTime`. Quand l’Arche est derrière
la planète dans le sens prograde, les départs gardent une trajectoire enroulée ; pour une
Arche plus lente, cette règle s’active légèrement avant l’alignement afin d’éviter un
changement de branche autour du passage. Les trajets déjà en cours sont redessinés avec
la géométrie actuelle, sans modifier leur quantité ni leur heure d’arrivée. Le mode intérieur,
extérieur ou direct dépend de la correction angulaire à l’interception par rapport à
l’avance naturelle attendue sur un rayon moyen. L’angle reste strictement prograde ;
le rayon varie vers l’intérieur ou l’extérieur selon le mode et borne l’écart pour ne
pas traverser l’étoile ni dépasser l’étendue du système. La progression angulaire suit
une approximation de Kepler (`vitesse angulaire ∝ rayon⁻¹·⁵`). La durée des nouveaux
trajets est résolue à partir de la longueur de cette courbe, avec les bornes et le
ralentissement déclarés dans `src/data/orbitalLogistics.js`.

À la normalisation d’une sauvegarde, tous les lots encore en transit adoptent la géométrie
actuelle ; leurs quantités et heures d’arrivée restent inchangées. Les trajets sont
reconstruits de façon déterministe depuis le marqueur, la planète d’origine et les heures
du lot ; aucun point de contrôle graphique n’est sauvegardé. Le renderer met en cache les trajectoires des cargos, tandis
que le guide pointillé du fret est recalculé à chaque image depuis la position actuelle
de la planète jusqu’à la position actuelle de l’Arche. Le cargo visuel ne porte aucune
matière et ne pilote pas la simulation.

## Modules

| Fichier | Responsabilité |
| --- | --- |
| `src/data/orbitalLogistics.js` | Capacité, énergie et durées de transit |
| `src/simulation/logisticsNetwork.js` | Chemin terrestre terminé et transfert Dock → bâtiment destinataire |
| `src/simulation/orbitalTransit.js` | Corridors, lots, arrivées, mesures et géométrie orbitale pure |
| `src/gameplay/logistics.js` | Orchestration des destinations de quai, du lancement et des états de plateforme |
| `src/rendering/orbitalTrafficRenderer.js` | Dessin de l’Arche et des cargos sans effet économique |
| `src/ui/factoryEditor.js` | Choix au Dock de sortie du bâtiment destinataire par ressource |
| `src/ui/hud.js` | Cartes de réception, lancement et stock orbital |
| `src/storage/save.js` | Sauvegarde des stocks, corridors minimaux et lots en transit |

Vérifications ciblées :

```sh
node --test tests/orbital-logistics.test.cjs tests/architecture.test.cjs
npm run test:orbital-seed-reset
npm run test:browser
```
