# Logistique orbitale V1

Cette tranche relie les sorties d’une usine au stock de l’Arche. Elle ne simule ni
transport terrestre physique, ni flux Hub → planète.

## Flux

```text
Dock de sortie → dockStock → route terrestre terminée → Plateforme de lancement
                → export ON → lot spatial entier → arrivée → stock de l’Arche
```

`building.dockStock` est distinct de `building.inventory` et de l’inventaire de
construction global. La plateforme ne prélève que `dockStock` des bâtiments terminés
de sa planète qui sont reliés par un chemin terrestre entièrement construit. Les
segments en construction et les routes maritimes ne comptent pas. Le transfert terrestre
est instantané et agrégé, sans débit de route ni véhicules économiques.

Les exports sont OFF par défaut. La V1 expose Fer brut (`raw_iron`), Résidus
(`iron_tailings`) et Laitier (`iron_slag`). Les matières reçues restent dans
`launchStock` tant que leur export n’est pas activé. Les valeurs de départ — débit
moyen de 4 u/s, paquets toutes les 10 secondes (jusqu’à 40 unités par départ) et 5 MW —
sont déclarées dans `src/data/orbitalLogistics.js`. Les quantités restent entières ;
l’agrégation réduit le nombre de cargos représentés sans changer le débit moyen
nominal. Plusieurs plateformes peuvent être construites sur la même planète ; aucune
n’est requise avant les autres bâtiments.

## Simulation et rendu

Chaque corridor sauvegardé contient seulement `id`, `fromEntityId` et `toEntityId`.
Les lancements utilisent des lots à quantité entière. Leur `departureTime` et leur
`arrivalTime` sont mesurés sur `state.simulation.time` ; pause, sauvegarde et rendu
n’altèrent pas l’échéance. Le stock entier infini de l’Arche n’augmente qu’à l’arrivée.

L’Arche est un nouvel objet spatial généré de façon déterministe dans le système
primaire. L’épave conserve sa propre identité, sa position et son rendu. Les nouveaux
lots portent le marqueur `trajectoryVersion: 2` ; leur courbe polaire relie la surface
de la planète à la position future de l’Arche à `arrivalTime`. Le mode intérieur,
extérieur ou direct dépend de la correction angulaire à l’interception par rapport à
l’avance naturelle attendue sur un rayon moyen. L’angle reste strictement prograde ;
le rayon varie vers l’intérieur ou l’extérieur selon le mode et borne l’écart pour ne
pas traverser l’étoile ni dépasser l’étendue du système. La progression angulaire suit
une approximation de Kepler (`vitesse angulaire ∝ rayon⁻¹·⁵`). La durée des nouveaux
trajets est résolue à partir de la longueur de cette courbe, avec les bornes et le
ralentissement déclarés dans `src/data/orbitalLogistics.js`.

Les anciens lots sans marqueur gardent leur courbe et leur heure d’arrivée historiques
jusqu’à leur réception. Les nouveaux trajets sont reconstruits de façon déterministe
depuis le marqueur, la planète d’origine et les heures du lot ; aucun point de contrôle
graphique n’est sauvegardé. Le renderer met en cache les courbes actives. Le cargo
visuel ne porte aucune matière et ne pilote pas la simulation.

## Modules

| Fichier | Responsabilité |
| --- | --- |
| `src/data/orbitalLogistics.js` | Capacité, énergie, ressources exportables et durées de transit |
| `src/simulation/logisticsNetwork.js` | Chemin terrestre terminé et transfert Dock → plateforme |
| `src/simulation/orbitalTransit.js` | Corridors, lots, arrivées, mesures et géométrie orbitale pure |
| `src/gameplay/logistics.js` | Orchestration du transfert, de l’export et des états de plateforme |
| `src/rendering/orbitalTrafficRenderer.js` | Dessin de l’Arche et des cargos sans effet économique |
| `src/ui/hud.js` | Cartes de réception, lancement, exports et stock orbital |
| `src/storage/save.js` | Sauvegarde des stocks, corridors minimaux et lots en transit |

Vérifications ciblées :

```sh
node --test tests/orbital-logistics.test.cjs tests/architecture.test.cjs
npm run test:browser
```
