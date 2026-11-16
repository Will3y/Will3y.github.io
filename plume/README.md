# Plume — entraînement à l'orthographe

Petite application pour s'entraîner à l'orthographe et à la grammaire, niveau par niveau.

- En ligne : https://will3y.github.io/plume/
- Sur iPhone : Safari → Partager → « Sur l'écran d'accueil ». Sur Android : Chrome → ⋮ → « Ajouter à l'écran d'accueil ».
  Ensuite l'icône marche même sans Internet (grâce à `sw.js`).

## Comment ça marche

- **Profils** : chacun crée son profil sur l'appareil ; la progression reste dans le navigateur (localStorage).
- **3 types d'exercices**, mélangés : trouver le mot fautif (ou « pas de faute »), QCM, réécrire le mot souligné.
  Le mode « Trouver la faute » seul peut être choisi dans l'onglet Profil.
- Après chaque réponse : la phrase corrigée et la règle avec un exemple.
- **6 niveaux** (des fondamentaux aux pièges des experts). Un niveau se débloque à 60 % de phrases acquises dans le précédent.
- **Révision des erreurs** : une phrase ratée revient dans la même série, puis dans « Réviser mes erreurs ».
  Les phrases réussies reviennent de plus en plus tard (1, 3, 7, 21, 60 jours).
- **Série de jours** : chaque jour où l'objectif quotidien (10 à 50 réponses) est atteint fait avancer la série.
- **Changer d'appareil** : Profil → « Copier mon code de sauvegarde », puis « Importer » sur l'autre appareil.

## Ajouter des phrases

Tout le contenu est dans `data.js`. Dans une règle, chaque phrase contient un seul mot piégé :

- `[affiché|correct]` : la phrase contient une faute (on affiche « affiché », il fallait « correct ») ;
- `{correct|leurre}` : la phrase est juste (le leurre sert pour le QCM).

Exemple : `'Il [à|a] mangé.'` ou `'Je vais {à|a} Paris.'`

Après une modification, changer `plume-v1` en `plume-v2` dans `sw.js` pour que les téléphones récupèrent la nouvelle version.
