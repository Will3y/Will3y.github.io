# Sensi — trouver sa sensibilité souris

Un outil pour trouver la sensibilité souris qui te convient, mesurée par un test de visée, puis convertie pour chaque jeu.

- En ligne : https://will3y.github.io/sensi/
- À utiliser sur ordinateur, avec une souris, de préférence dans Chrome ou Edge (ils donnent au test le mouvement brut de la souris, sans l'accélération de Windows).
- Rien à installer, aucun serveur : réglages et tests restent dans le navigateur (localStorage).

## Comment ça marche

1. **Matériel** : DPI, largeur du tapis, écran. « Mesurer mes DPI réels » fait glisser la souris sur une distance connue (règle, carte bancaire) et compte ce que la souris envoie vraiment.
2. **Profil** : visée au poignet ou au bras, prise, jeu principal, sensi actuelle si on en a une.
3. **Point de départ** : la sensi actuelle, ou une suggestion selon le profil. C'est le centre de la plage testée.
4. **Test** : 3 ou 5 sensis autour de ce centre, dans un ordre tiré au sort et sans dire lesquelles. Pour chacune :
   - *flick* — viser une cible et cliquer (cibles par minute, chaque tir raté coûte 0,3 s) ;
   - *suivi* — garder le viseur sur une cible qui bouge (part du temps passé dessus).
5. **Résultat** : une courbe est ajustée sur les scores, son sommet est l'optimum. Si le sommet tombe au bord de la plage, l'outil le dit et propose un test recentré plutôt que d'inventer un chiffre. Les sessions se cumulent.
6. **Réglages par jeu** : la valeur à entrer dans chaque jeu, arrondie comme le jeu l'accepte, avec la distance réelle obtenue.

Tout est exprimé en **cm/360** : la distance de souris nécessaire pour faire un tour complet sur soi-même. C'est la seule grandeur comparable d'un jeu à l'autre.

## Fichiers

- `core.js` — les calculs (conversions, point de départ, ajustement de la courbe) et la liste des jeux. Sans DOM.
- `trainer.js` — le test de visée 3D (canvas + capture de la souris) et la mesure des DPI.
- `app.js` — l'interface.
- `index.html` — la page et le style.

## Ajouter un jeu

Dans `core.js`, ajouter une ligne à `GAMES` :

```js
{ id: 'monjeu', name: 'Mon jeu', yaw: 0.022, dec: 2, style: 'tactical' }
```

- `yaw` : degrés tournés par « count » de souris quand la sensi du jeu vaut 1.
  Formule : `cm/360 = 914,4 / (yaw × sensi × DPI)`.
- `dec` : nombre de décimales acceptées par le jeu.
- `style` : `tactical`, `mixed` ou `tracking` (poids du flick et du suivi dans la note).
- `approx: true` si la valeur n'est pas sûre : elle s'affiche avec « ≈ ».

Pour vérifier un `yaw` en jeu : régler la sensi indiquée, glisser la souris de la distance annoncée, et contrôler qu'on a fait exactement un tour.

## Limites

- Pas de sensi parfaite au dixième près : le test situe une zone, l'habitude fait le reste.
- Les sensis de lunette / visée épaule (ADS) et le champ de vision ne sont pas gérés.
- The Finals, Rust et Escape from Tarkov utilisent des coefficients relevés par la communauté (marqués « ≈ »).
