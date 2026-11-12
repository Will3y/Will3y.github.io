# 🎵 Blind test — le jeu musical de la soirée

Trois écrans :

| Écran | Page | Rôle |
|---|---|---|
| 📺 **TV** | `https://will3y.github.io/blindtest/` | Diffuse les extraits Deezer, affiche qui a buzzé, la réponse et les scores. |
| 📱 **Téléphones** | `…/blindtest/buzz.html` (via le QR code) | Les buzzers des équipes. |
| 🎙️ **Animateur** | `…/blindtest/animateur.html` (bouton « Page animateur ») | **La réponse dès le début de la chanson**, les scores par équipe en direct, les boutons pour juger et piloter la partie. |

La page animateur est protégée par un **code animateur** secret (affiché seulement dans la fenêtre « 🎙️ Page animateur » du PC) : un joueur qui n'a que le code du salon ne peut pas l'ouvrir.

### Installation conseillée

- **PC + TV en écran étendu** (Windows : touche `Windows` + `P` → « Étendre ») : la page du blind test en plein écran sur la TV, et la page animateur (bouton « 🪟 Ouvrir dans une nouvelle fenêtre ») sur l'écran du portable.
- **Ou** la page animateur sur ton téléphone / une tablette : scanne le QR code de la fenêtre « 🎙️ Page animateur » (avant l'arrivée des invités 😉).

Quand une page animateur est connectée, la TV masque ses boutons (affichage plus propre) ; les raccourcis clavier restent actifs sur les deux écrans.

## Déroulé d'une soirée

1. Sur le PC, ouvre la page (Chrome ou Edge conseillés), branche la TV et l'enceinte, puis appuie sur `F` pour le plein écran.
2. Choisis une ou plusieurs playlists Deezer (thèmes proposés, recherche, ou lien `deezer.com/…/playlist/123`).
3. Chaque équipe scanne le QR code, choisit un nom, une couleur et une mascotte. Le bouton **TEST** sur le téléphone permet de vérifier que le PC reçoit bien le buzz.
4. **C'est parti !** Au premier buzz, la musique se coupe et l'équipe s'affiche en grand.
5. L'animateur juge la réponse donnée à voix haute (depuis la page animateur, ou directement sur le PC).

## Raccourcis clavier (PC et page animateur)

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

Corrections et équipes sans téléphone : sur la page animateur, boutons `−` / `+` et 🔔 (buzz pour l'équipe) à côté de chaque score ; sur la TV, clic sur une équipe pendant la chanson = buzz manuel.

## Bon à savoir

- Tout le monde a besoin d'Internet (Wi-Fi de la maison conseillé ; la 4G marche aussi). Les Wi-Fi « invités » ou d'entreprise peuvent bloquer la connexion entre appareils.
- Si le PC recharge la page, la partie et les scores sont conservés : les téléphones se reconnectent tout seuls.
- Si un téléphone se met en veille, il se reconnecte en revenant sur la page.
- Sur iPhone : Safari → Partager → « Sur l'écran d'accueil » pour avoir le buzzer comme une appli (facultatif).
- **Mode test sans téléphone** : ouvre `index.html?local=1` sur le PC, puis le lien affiché sous le QR code dans d'autres onglets du même navigateur (chaque onglet = une équipe). La page animateur marche aussi dans ce mode.

## Technique

HTML/CSS/JavaScript sans compilation. Connexion PC ↔ téléphones en WebRTC via [PeerJS](https://peerjs.com) (serveur public gratuit), extraits de 30 s via l'API publique Deezer (JSONP), QR code via [qrcode-generator](https://github.com/kazuhikoarase/qrcode-generator). Sons et fanfare en 8-bit synthétisés dans le navigateur. Licences des bibliothèques : `vendor/LICENSES.txt`.

## Version souvenir

La version spéciale « 30 ans de Morgane » (textes, ballon 30, « Joyeux anniversaire » en 8-bit) reste en ligne, figée, sur `https://will3y.github.io/morgane30/`.
