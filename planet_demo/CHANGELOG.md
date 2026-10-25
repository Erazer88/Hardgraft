# 0.5.0 — Continents visibles et rendu haute définition

- Chaque seed génère deux ou trois continents, tous visibles de face ; un monde neuf reçoit une seed aléatoire, ensuite conservée dans l’URL.
- Massifs normalisés à moins de 20 % d’écart entre extrêmes, avec une hauteur visuelle commune aux deux assets.
- Liseré côtier turquoise clair plus lisible, fondu progressivement dans les eaux peu profondes.
- Texture équirectangulaire 2048 × 1024, masque des massifs plus doux et canvas adapté aux écrans haute densité.
- Tests ajoutés sur le nombre de continents, la stabilité des tailles de massif, les rechargements et la résolution du canvas.

# 0.4.0 — Continents et littoral

- Une à trois grandes masses déterministes, avec des silhouettes, orientations et proportions variées.
- Péninsules, golfes et criques par déformation à plusieurs échelles ; nettoyage des fragments et petites poches accidentelles.
- Distance au littoral recalculée en 2D à partir des passages sous-pixel ; plages plus fines et détails conservés à l'export.
- Archipels proches des côtes, organisés en arcs et de tailles décroissantes.
- Massifs redressés et alignés en chaînes légèrement inclinées autour de l’horizontale ; le tracé des cours d’eau et les lacs s’adaptent aux nouvelles masses. Les trois images fournies restent les seules images utilisées.
- Caméra verrouillée de face et centres des 1–3 continents regroupés dans l'hémisphère visible.
- Nombre de continents visible dans l'interface ; tests de connexité, variation des côtes et placement des îles.
- Silhouette inspirée de la référence : grand noyau asymétrique, baies profondes et péninsules avec détails de côte à plusieurs échelles.

# 0.3.0 — 2026-10-24

- Remplacement de l'ancienne bibliothèque d'images par la texture de sol et les deux massifs fournis.
- Texture de sol utilisée comme base de toutes les surfaces terrestres, avec plages et côtes conservées en bordure.
- Massifs nettoyés des fragments alpha isolés et dotés d'un fondu doux avant leur composition sur le sol.
- Variantes attribuées aux chaînes par seed ; export autonome limité aux trois images choisies.

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
