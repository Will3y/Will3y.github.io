# 🎂 Blind test — Les 30 ans de Morgane

Le PC (branché sur la TV) diffuse les extraits Deezer, les téléphones servent de buzzers.

- **Écran du PC** : `https://will3y.github.io/blindtest/`
- **Buzzers** : les joueurs scannent le QR code affiché sur le PC (ou vont sur `…/blindtest/buzz.html` et tapent le code à 4 lettres).

## Déroulé d'une soirée

1. Sur le PC, ouvre la page (Chrome ou Edge conseillés), branche la TV et l'enceinte, puis appuie sur `F` pour le plein écran.
2. Choisis une ou plusieurs playlists Deezer (thèmes proposés, recherche, ou lien `deezer.com/…/playlist/123`).
3. Chaque équipe scanne le QR code, choisit un nom, une couleur et une mascotte. Le bouton **TEST** sur le téléphone permet de vérifier que le PC reçoit bien le buzz.
4. **C'est parti !** Au premier buzz, la musique se coupe et l'équipe s'affiche en grand.
5. L'animateur juge la réponse donnée à voix haute.

## Raccourcis clavier (PC)

| Moment | Touche | Action |
|---|---|---|
| Pendant la chanson | `Espace` | Pause / reprise |
| Pendant la chanson | `R` | Révéler la réponse (personne n'a trouvé) |
| Après un buzz | `1` | +1 point (titre **ou** artiste) |
| Après un buzz | `2` | +2 points (titre **et** artiste) |
| Après un buzz | `X` | Mauvaise réponse (la musique reprend, l'équipe est bloquée sur ce morceau) |
| Après un buzz | `A` | Annuler le buzz (sans pénalité) |
| Réponse affichée | `Entrée` | Chanson suivante |
| Partout | `F` | Plein écran |

Dans le tableau des scores : clic sur une équipe pendant la chanson = buzz manuel (pour une équipe sans téléphone), boutons `−` / `+` pour corriger les points.

## Bon à savoir

- Tout le monde a besoin d'Internet (Wi-Fi de la maison conseillé ; la 4G marche aussi). Les Wi-Fi « invités » ou d'entreprise peuvent bloquer la connexion entre appareils.
- Si le PC recharge la page, la partie et les scores sont conservés : les téléphones se reconnectent tout seuls.
- Si un téléphone se met en veille, il se reconnecte en revenant sur la page.
- Sur iPhone : Safari → Partager → « Sur l'écran d'accueil » pour avoir le buzzer comme une appli (facultatif).
- **Mode test sans téléphone** : ouvre `index.html?local=1` sur le PC, puis le lien affiché sous le QR code dans d'autres onglets du même navigateur (chaque onglet = une équipe).

## Technique

HTML/CSS/JavaScript sans compilation. Connexion PC ↔ téléphones en WebRTC via [PeerJS](https://peerjs.com) (serveur public gratuit), extraits de 30 s via l'API publique Deezer (JSONP), QR code via [qrcode-generator](https://github.com/kazuhikoarase/qrcode-generator). Sons et « Joyeux anniversaire » en 8-bit synthétisés dans le navigateur. Licences des bibliothèques : `vendor/LICENSES.txt`.
