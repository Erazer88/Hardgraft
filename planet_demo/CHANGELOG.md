# 0.2.1 — 2026-10-24

- Littoral et rives calculés depuis le champ de terrain continu, sans masque côtier binaire qui formait des escaliers au zoom.
- Bandes de côte et de plage affinées ; retour à des bleus et des verts plus proches de la première version.
- Chaînes et forêts composées avec les petits assets déjà présents ; retrait des grands collages photo qui dominaient la carte.
- Sommets réduits pour rendre les chaînes plus lisibles à l'échelle du continent.

# 0.2.0 — 2026-10-23

- Deux grands massifs continus avec sommets lisibles et échelle renforcée par rapport aux arbres et aux cours d'eau.
- Asset peint de chaîne alpine et groupe forestier ajoutés à la bibliothèque d'illustrations.
- Distance littorale signée, bancs turquoise plus fins et plages de largeur variable.
- Archipels regroupés, formes d'îles étirées et lacs allongés.
- Réseaux fluviaux composés de troncs et d'affluents, rivières plus étroites en altitude, élargies à l'aval.
- Vallées plus douces, végétation concentrée en zones irrégulières et variation régionale des plaines.
- Banquise polaire, nuages discrets sur l'océan et halo atmosphérique affiné.
- Projection bilinéaire de la texture sur le globe et export autonome mis à jour.

# 0.1.0 — 2026-10-23

- Générateur déterministe séparé du rendu, avec flux de seed indépendants par couche.
- Continent à plusieurs lobes, baies, littoral fin, petites îles et lacs irréguliers.
- Chaînes montagneuses, motifs illustrés réutilisables, forêts par zones et variations de plaine.
- Rivières générées depuis l'intérieur des terres vers une côte ou un lac.
- Carte équirectangulaire 2:1 exportable et fonction \`generatePlanetTexture\` pour le futur raccord à Hardgraft.
- Globe Canvas avec rotation, zoom, éclairage léger, grille et halo séparés de la surface.
- Quatre sliders, saisie et partage de seed, Randomiser, exports PNG et HTML hors ligne.
- Interface responsive et navigation clavier ; aucun framework ou moteur de terrain 3D.
