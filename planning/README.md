# Le planning de Willyam et Hailey

Suivi des tâches de la journée, à cocher. Indépendant des missions (pas d'étoiles, pas d'exercices).
En un seul fichier : `index.html`.

- En ligne : https://will3y.github.io/planning/
- Un côté par enfant, chacun son planning. Sur un grand écran (tablette), les deux côtés sont affichés ; sur un téléphone, deux boutons changent de côté.
- Trois routines : matin, après l'école, soir. Le planning ouvre tout seul celle du moment.
- Une tâche peut revenir un jour sur deux, pour les tours de rôle (un jour Willyam met la table et Hailey débarrasse, le lendemain l'inverse).
- Tout repart de zéro chaque jour. L'historique des 7 derniers jours est dans l'espace parent.
- Sur la tablette : Chrome → ⋮ → « Ajouter à l'écran d'accueil ». L'icône marche ensuite sans Internet (grâce à `sw.js`).

Espace parent (bouton ⚙️) : tâches et jours de chaque routine pour chaque enfant, horaires des routines,
écran toujours allumé, code parent, sauvegarde par code à copier.

Les données restent sur l'appareil (localStorage, clé `planning-famille-v1`).
