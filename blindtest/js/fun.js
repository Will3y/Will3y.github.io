// Textes, couleurs et petites blagues pour les 30 ans de Morgane.

export const BIRTHDAY_NAME = 'Morgane';

export const TEAM_COLORS = [
  { name: 'Rouge', hex: '#ff4d6d' },
  { name: 'Orange', hex: '#ff9f1c' },
  { name: 'Jaune', hex: '#ffd23f' },
  { name: 'Vert', hex: '#3ddc97' },
  { name: 'Turquoise', hex: '#22d3ee' },
  { name: 'Bleu', hex: '#4d7cff' },
  { name: 'Violet', hex: '#a259ff' },
  { name: 'Rose', hex: '#ff5fd2' },
];

export const TEAM_EMOJIS = ['🎂', '🎤', '🎸', '🦄', '🐑', '🍕', '💿', '🦖', '👑', '🍾', '🐙', '🔥', '🌮', '🐸', '🎺', '👵'];

export const TEAM_NAMES = [
  'Les Trentenaires Anonymes', 'Team Dolly la Brebis', 'Les Spice Mamies', 'Les Tamagotchis',
  'Les Rois de la Macarena', 'Morgane Fan Club', 'Les Genoux qui Craquent', 'Team Modem 56k',
  'Les Cassettes Rembobinées', 'Les Bougies Soufflées', 'Les Fausses Notes', 'Les Walkmans',
  'Les Pros du Playback', 'Les Minitels en Folie', 'Les Boys Band du Dimanche', 'Les Pas Encore 30',
  'Les Lunettes de Soleil la Nuit', 'Les Divas du Karaoké', 'Les Rembobineurs Fous', 'Team Dernière Part de Gâteau',
];

export const TAGLINES = [
  'Née en 1996, l\'année de la Macarena. Coïncidence ? Nous ne pensons pas.',
  '30 ans : les genoux craquent, mais l\'oreille est intacte.',
  '1996 : Dolly la brebis est clonée. Morgane, elle, reste unique.',
  'Règle n°1 : interdit de dire « c\'était mieux avant ».',
  'Règle n°2 : chanter faux, oui. Buzzer faux, non.',
  'Morgane a 30 ans, elle connaît donc toutes les chansons. Aucune pression.',
  'Spice Girls, Tamagotchi, modem 56k… bienvenue chez les trentenaires.',
  'Ce blind test est garanti sans Macarena. Ou presque.',
  'Trente bougies, zéro fausse note (on va vérifier).',
];

export const PLAYING_LINES = [
  '🎧 Ouvrez grand vos oreilles…',
  'Le premier qui buzze a la main !',
  'Chut… on écoute.',
  'Ça vous dit quelque chose ?',
  'Pas de Shazam, on vous voit 👀',
  'Morgane, interdiction de souffler la réponse.',
];

export const BUZZ_LINES = [
  'On vous écoute… 🎤',
  'Le titre ET l\'artiste, si possible !',
  'Pas de pression. (Si, un peu.)',
  'Respirez… et répondez.',
  'Tout le monde se tait, c\'est leur moment.',
];

export const CORRECT_LINES = [
  'Bravo ! Morgane valide. 🎂',
  'Quelle oreille ! Ça mérite une part de gâteau.',
  'Une oreille de vingt ans !',
  'Shazam peut aller se rhabiller.',
  'Vous connaissez vos classiques, respect.',
  'Champions ! Même Morgane est jalouse.',
];

export const WRONG_LINES = [
  'Raté ! Même un Tamagotchi aurait trouvé.',
  'Aïe. On met ça sur le compte de l\'âge ?',
  'Faux ! Mais on vous aime quand même.',
  'C\'était audacieux. Et faux.',
  'Le modem 56k de votre cerveau a planté.',
  'Non. Juste non. 🙈',
];

export const NOBODY_LINES = [
  'Personne ? Vraiment ? On sent la trentaine…',
  'Silence radio. Comme un modem 56k qui se connecte.',
  'Même Morgane séchait. (Ou pas, elle ne dira rien.)',
  'Celle-là, on la ressortira pour ses 40 ans.',
  'Personne… Le gâteau, ce n\'est pas pour tout de suite.',
];

export const LOCKED_LINES = [
  'Bloqués pour cette chanson 🔒 Profitez-en pour reprendre du gâteau 🍰',
  'Raté ! Pénitence : chantez le refrain 🙈',
  'Hors-jeu pour ce morceau. Dansez en attendant 💃',
];

export const WAITING_OTHERS_LINES = [
  'Croisons les doigts pour qu\'ils se trompent 🤞',
  'Faites semblant d\'être bons perdants…',
  'Silence, ils réfléchissent (enfin, on espère).',
];

export const PLAYLIST_THEMES = [
  { label: '🎂 Tubes de 1996', q: 'hits 1996' },
  { label: '📼 Années 90', q: 'années 90' },
  { label: '💿 Années 2000', q: 'années 2000' },
  { label: '📱 Années 2010', q: 'années 2010' },
  { label: '🇫🇷 Variété française', q: 'variété française' },
  { label: '🏰 Disney', q: 'disney' },
  { label: '📺 Génériques dessins animés', q: 'génériques dessins animés' },
  { label: '🎤 Rap FR', q: 'rap français' },
  { label: '🕺 Années 80', q: 'années 80' },
  { label: '🎉 Soirée', q: 'soirée' },
];

export const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

export function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', '\'': '&#39;' }[c]));
}

/** Couleur de texte lisible (noir ou blanc) sur une couleur de fond. */
export function textOn(hex) {
  const h = hex.replace('#', '');
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  const L = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return L > 0.35 ? '#1b0b33' : '#ffffff';
}

export const normName = (s) => (s || '').trim().replace(/\s+/g, ' ').toLowerCase()
  .normalize('NFD').replace(/[̀-ͯ]/g, '');

export const ordinal = (n) => (n === 1 ? '1ʳᵉ' : `${n}ᵉ`);
