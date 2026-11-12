// Textes, couleurs et petites blagues du blind test.

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

export const TEAM_EMOJIS = ['🎤', '🎸', '🎧', '🦄', '🐑', '🍕', '💿', '🦖', '👑', '🍾', '🐙', '🔥', '🌮', '🐸', '🎺', '🥁'];

export const TEAM_NAMES = [
  'Les Fausses Notes', 'Les Walkmans', 'Les Pros du Playback', 'Les Cassettes Rembobinées',
  'Team Modem 56k', 'Les Tamagotchis', 'Les Divas du Karaoké', 'Les Rois du Refrain',
  'Les Oreilles d\'Or', 'Les Boys Band du Dimanche', 'Les Lunettes de Soleil la Nuit', 'Les Minitels en Folie',
  'Les Shazam Humains', 'Les Platines Rayées', 'Les Air Guitaristes', 'Les Chanteurs de Salle de Bain',
  'Les Sans Paroles', 'Les Tubes de l\'Été', 'Les Rembobineurs Fous', 'Les Mélomanes Anonymes',
];

export const TAGLINES = [
  'Règle n°1 : on buzze d\'abord, on réfléchit après.',
  'Règle n°2 : chanter faux, oui. Buzzer faux, non.',
  'Shazam est formellement interdit. On vous voit.',
  '« Je l\'ai sur le bout de la langue » ne rapporte aucun point.',
  'L\'oreille absolue n\'est pas obligatoire. Mais elle aide.',
  'Tout le monde connaît par cœur une chanson honteuse. Ce soir, on la trouve.',
  'Ce blind test est garanti sans Macarena. Ou presque.',
  'Échauffez vos doigts : le buzzer n\'attend personne.',
];

export const PLAYING_LINES = [
  '🎧 Ouvrez grand vos oreilles…',
  'Le premier qui buzze a la main !',
  'Chut… on écoute.',
  'Ça vous dit quelque chose ?',
  'Pas de Shazam, on vous voit 👀',
  'Interdit de fredonner pour aider… enfin, discrètement.',
];

export const BUZZ_LINES = [
  'On vous écoute… 🎤',
  'Le titre ET l\'artiste, si possible !',
  'Pas de pression. (Si, un peu.)',
  'Respirez… et répondez.',
  'Tout le monde se tait, c\'est leur moment.',
];

export const CORRECT_LINES = [
  'Bravo ! Quelle oreille 👂',
  'Shazam peut aller se rhabiller.',
  'Vous connaissez vos classiques, respect.',
  'Champions ! Le public est en délire.',
  'Imparable. On applaudit 👏',
  'Trop forts ! Vous avez révisé ou quoi ?',
];

export const WRONG_LINES = [
  'Raté ! Même un Tamagotchi aurait trouvé.',
  'Aïe. On fera comme si on n\'avait rien entendu.',
  'Faux ! Mais on vous aime quand même.',
  'C\'était audacieux. Et faux.',
  'Le modem 56k de votre cerveau a planté.',
  'Non. Juste non. 🙈',
];

export const NOBODY_LINES = [
  'Personne ? Vraiment ? 🦗',
  'Silence radio. Comme un modem 56k qui se connecte.',
  'Celle-là, on la garde pour la revanche.',
  'Personne… L\'animateur est déçu.',
  'Même le DJ ne la connaissait pas.',
];

export const LOCKED_LINES = [
  'Bloqués pour cette chanson 🔒 Profitez-en pour aller chercher à boire 🥤',
  'Raté ! Pénitence : chantez le refrain 🙈',
  'Hors-jeu pour ce morceau. Dansez en attendant 💃',
];

export const WAITING_OTHERS_LINES = [
  'Croisons les doigts pour qu\'ils se trompent 🤞',
  'Faites semblant d\'être bons perdants…',
  'Silence, ils réfléchissent (enfin, on espère).',
];

export const PLAYLIST_THEMES = [
  { label: '🔥 Hits du moment', q: 'hits du moment' },
  { label: '📼 Années 90', q: 'années 90' },
  { label: '💿 Années 2000', q: 'années 2000' },
  { label: '📱 Années 2010', q: 'années 2010' },
  { label: '🕺 Années 80', q: 'années 80' },
  { label: '🇫🇷 Variété française', q: 'variété française' },
  { label: '🎤 Rap FR', q: 'rap français' },
  { label: '🎸 Rock', q: 'rock classics' },
  { label: '🏰 Disney', q: 'disney' },
  { label: '📺 Génériques dessins animés', q: 'génériques dessins animés' },
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
