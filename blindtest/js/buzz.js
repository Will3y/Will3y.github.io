// Téléphone : un gros bouton buzzer relié au PC hôte.
import { createClient } from './net.js';
import * as F from './fun.js';

const $ = (sel) => document.querySelector(sel);
const PROFILE_KEY = 'morgane30-phone-v1';
const params = new URLSearchParams(location.search);

/* ------------------------------------------------------------------ */
/* Profil (mémorisé sur le téléphone pour se reconnecter tout seul)     */
/* ------------------------------------------------------------------ */

// En mode test (?local=1), chaque onglet joue le rôle d'un téléphone : on garde le profil par onglet.
const store = params.has('local') ? sessionStorage : localStorage;
const profile = (() => {
  try { return JSON.parse(store.getItem(PROFILE_KEY)) || {}; } catch (e) { return {}; }
})();
const saveProfile = () => { try { store.setItem(PROFILE_KEY, JSON.stringify(profile)); } catch (e) { /* ignore */ } };

// Identifiant de l'appareil : propre à chaque onglet, pour que deux onglets ne se marchent jamais dessus.
const CID_KEY = 'morgane30-cid';
profile.cid = sessionStorage.getItem(CID_KEY)
  || (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`).slice(0, 36);
try { sessionStorage.setItem(CID_KEY, profile.cid); } catch (e) { /* ignore */ }
const urlCode = cleanCode(params.get('r'));
if (urlCode) {
  if (profile.code !== urlCode) profile.joined = false;
  profile.code = urlCode;
}
if (!F.TEAM_COLORS.some((c) => c.hex === profile.color)) profile.color = F.pick(F.TEAM_COLORS).hex;
if (!F.TEAM_EMOJIS.includes(profile.emoji)) profile.emoji = F.pick(F.TEAM_EMOJIS);
saveProfile();

function cleanCode(v) { return String(v || '').toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4); }

/* ------------------------------------------------------------------ */
/* Connexion                                                            */
/* ------------------------------------------------------------------ */

let conn = null;
let connected = false;
let everConnected = false;
let joining = false;
let joinTimer = null;
let lastMsg = 0;
let lastAttempt = 0;
let reconnectTimer = null;
let state = null;
let team = null;
let pendingBuzz = 0;

const client = createClient({
  onOpen(c) {
    conn = c;
    lastMsg = Date.now();
    c.onData(onMsg);
    c.send({ t: 'hello', cid: profile.cid, name: profile.name, color: profile.color, emoji: profile.emoji });
  },
  onClose() {
    conn = null;
    connected = false;
    setNet('bad');
    if (profile.joined) { showBanner('Connexion perdue… on réessaie 🔄'); scheduleReconnect(1500); }
    renderPlay();
  },
  onError(type) {
    if (joining && !everConnected) {
      joinFail(type === 'host-not-found'
        ? 'Salon introuvable 🤔 Vérifie le code, et que l\'écran du blind test est bien ouvert sur le PC.'
        : 'Connexion impossible 📡 Vérifie la connexion Internet du téléphone.');
      return;
    }
    if (profile.joined) {
      showBanner(type === 'host-not-found' ? 'Le PC ne répond plus… on réessaie 🔄' : 'Problème de connexion… on réessaie 🔄');
      scheduleReconnect(3000);
    }
  },
});

function connectNow() {
  lastAttempt = Date.now();
  setNet('');
  client.connect(profile.code);
}

function scheduleReconnect(delay) {
  clearTimeout(reconnectTimer);
  reconnectTimer = setTimeout(() => { if (profile.joined) connectNow(); }, delay);
}

setInterval(() => {
  if (!profile.joined) return;
  if (conn && conn.open) conn.send({ t: 'ping' });
  if (Date.now() - lastMsg > 9000 && Date.now() - lastAttempt > 6000) {
    connected = false;
    setNet('bad');
    showBanner('Connexion perdue… on réessaie 🔄');
    renderPlay();
    connectNow();
  }
}, 3000);

document.addEventListener('visibilitychange', () => {
  if (document.hidden || !profile.joined) return;
  requestWakeLock();
  if (Date.now() - lastMsg > 4000 && Date.now() - lastAttempt > 2000) connectNow();
});

function onMsg(m) {
  if (!m || typeof m !== 'object') return;
  lastMsg = Date.now();
  switch (m.t) {
    case 'welcome':
      team = m.team;
      Object.assign(profile, { name: team.name, color: team.color, emoji: team.emoji, joined: true });
      saveProfile();
      connected = true;
      everConnected = true;
      joining = false;
      clearTimeout(joinTimer);
      applyTheme(team.color);
      hideBanner();
      setNet('ok');
      showPlay();
      break;
    case 'state':
      state = m;
      if (pendingBuzz && (m.phase !== 'playing' || m.locked.includes(team?.id))) pendingBuzz = 0;
      renderPlay();
      break;
    case 'kicked':
      leave('Ton équipe a été retirée par l\'animateur. Tu peux en recréer une !');
      break;
    case 'error':
      joinFail(m.msg || 'Erreur');
      break;
    default:
      break;
  }
}

/* ------------------------------------------------------------------ */
/* Inscription                                                          */
/* ------------------------------------------------------------------ */

function buildJoinForm() {
  $('#codeInput').value = profile.code || '';
  $('#nameInput').value = profile.name || '';
  $('#swatches').innerHTML = F.TEAM_COLORS.map((c) => `<button type="button" class="swatch" role="radio" data-color="${c.hex}" style="--c:${c.hex}" aria-label="${c.name}"></button>`).join('');
  $('#swatches').setAttribute('role', 'radiogroup');
  $('#emojis').innerHTML = F.TEAM_EMOJIS.map((e) => `<button type="button" class="emoji-btn" role="radio" data-emoji="${e}" aria-label="${e}">${e}</button>`).join('');
  $('#emojis').setAttribute('role', 'radiogroup');
  syncChoices();

  $('#swatches').addEventListener('click', (e) => {
    const b = e.target.closest('[data-color]');
    if (!b) return;
    profile.color = b.dataset.color;
    syncChoices();
  });
  $('#emojis').addEventListener('click', (e) => {
    const b = e.target.closest('[data-emoji]');
    if (!b) return;
    profile.emoji = b.dataset.emoji;
    syncChoices();
  });
  $('#diceBtn').addEventListener('click', () => {
    const current = $('#nameInput').value;
    let name = F.pick(F.TEAM_NAMES);
    for (let i = 0; i < 5 && name === current; i++) name = F.pick(F.TEAM_NAMES);
    $('#nameInput').value = name;
    navigator.vibrate?.(20);
  });
  $('#codeInput').addEventListener('input', (e) => { e.target.value = cleanCode(e.target.value); });
  $('#joinForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const code = cleanCode($('#codeInput').value);
    const name = $('#nameInput').value.trim().replace(/\s+/g, ' ').slice(0, 28);
    if (code.length !== 4) { joinFail('Le code du salon fait 4 lettres (il est affiché sur l\'écran du PC).'); return; }
    if (!name) { joinFail('Il faut un nom d\'équipe ! (🎲 pour en tirer un au hasard)'); return; }
    profile.code = code;
    profile.name = name;
    saveProfile();
    requestWakeLock();
    joining = true;
    everConnected = false;
    $('#joinErr').textContent = '';
    const btn = $('#joinBtn');
    btn.disabled = true;
    btn.textContent = 'Connexion… ⏳';
    clearTimeout(joinTimer);
    joinTimer = setTimeout(() => {
      if (joining) { client.disconnect(); joinFail('Le PC ne répond pas 😕 Vérifie le code et réessaie.'); }
    }, 15000);
    connectNow();
  });
}

function syncChoices() {
  document.querySelectorAll('#swatches [data-color]').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.color === profile.color)));
  document.querySelectorAll('#emojis [data-emoji]').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.emoji === profile.emoji)));
  applyTheme(profile.color);
}

function joinFail(msg) {
  joining = false;
  clearTimeout(joinTimer);
  $('#joinErr').textContent = msg;
  const btn = $('#joinBtn');
  btn.disabled = false;
  btn.textContent = 'C\'est parti ! 🎉';
  if (!everConnected) { profile.joined = false; saveProfile(); showJoin(); }
}

function showJoin(message) {
  $('#join').hidden = false;
  $('#play').hidden = true;
  $('#phTeam').hidden = true;
  document.body.dataset.state = 'join';
  hideBanner();
  if (message) $('#joinErr').textContent = message;
}

function showPlay() {
  $('#join').hidden = true;
  $('#play').hidden = false;
  $('#phTeam').hidden = false;
  const btn = $('#joinBtn');
  btn.disabled = false;
  btn.textContent = 'C\'est parti ! 🎉';
  renderPlay();
}

function leave(message) {
  if (conn && conn.open) conn.send({ t: 'leave' });
  client.disconnect();
  conn = null;
  connected = false;
  team = null;
  state = null;
  profile.joined = false;
  saveProfile();
  showJoin(message);
}

/* ------------------------------------------------------------------ */
/* Rendu du buzzer                                                      */
/* ------------------------------------------------------------------ */

const memo = new Map();
function line(key, arr) {
  const k = `${key}|${arr[0]}`;
  if (!memo.has(k)) memo.set(k, F.pick(arr));
  return memo.get(k);
}

let prevState = '';
let testUntil = 0;

function computeState() {
  if (!connected || !state || !team) return 'connecting';
  const me = team.id;
  switch (state.phase) {
    case 'lobby': return 'lobby';
    case 'ready':
    case 'loading': return 'waiting';
    case 'playing':
      if (state.locked.includes(me)) return 'locked';
      return pendingBuzz && Date.now() - pendingBuzz < 2000 ? 'sent' : 'active';
    case 'paused': return 'paused';
    case 'buzzed': return state.buzz === me ? 'mine' : 'other';
    case 'reveal': return 'reveal';
    case 'end': return 'end';
    default: return 'waiting';
  }
}

function renderPlay() {
  if ($('#play').hidden) return;
  const st = computeState();
  document.body.dataset.state = st;
  const s = state;
  const me = team?.id;
  const teams = s?.teams || [];
  const mine = teams.find((t) => t.id === me) || team;
  const key = `${s?.round}|${st}`;

  if (mine) {
    $('#phEmoji').textContent = mine.emoji;
    $('#phName').textContent = mine.name;
    $('#phScore').textContent = mine.score ?? 0;
  }

  $('#phRound').textContent = s && s.total && !['lobby', 'end'].includes(s.phase)
    ? `Chanson ${s.phase === 'ready' ? s.readyRound : s.round} / ${s.total}`
    : `Salon ${profile.code}`;

  const buzzTeam = s && teams.find((t) => t.id === s.buzz);
  if (buzzTeam) document.body.style.setProperty('--other', buzzTeam.color);

  const view = {
    connecting: ['…', 'Connexion au PC… ⏳'],
    lobby: ['TEST', Date.now() < testUntil ? 'Ça marche ! 💪 Le PC a bien reçu ton buzz.' : 'Vous êtes dans la partie ! 🎉 Appuie pour tester, on attend le lancement…'],
    waiting: ['…', s?.phase === 'ready' ? 'Prêts ? La chanson arrive…' : '🎶 Chanson suivante…'],
    active: ['BUZZ !', 'Appuie dès que tu as la réponse !'],
    sent: ['!!!', 'Buzz envoyé…'],
    locked: ['🔒', line(key, F.LOCKED_LINES)],
    paused: ['⏸', 'Pause ! Pas de buzz pour l\'instant.'],
    mine: ['À VOUS !', 'Répondez à voix haute 🎤'],
    other: [buzzTeam?.emoji || '🔔', buzzTeam ? `${buzzTeam.name} a buzzé… ${line(key, F.WAITING_OTHERS_LINES)}` : 'Quelqu\'un a buzzé…'],
    reveal: ['', ''],
    end: ['', ''],
  }[st] || ['…', ''];
  $('#buzzerLabel').textContent = view[0];
  $('#phMsg').textContent = view[1];

  const inBuzzZone = !['reveal', 'end'].includes(st);
  $('#buzzZone').hidden = !inBuzzZone;
  $('#buzzer').disabled = !['active', 'lobby'].includes(st);
  $('#buzzer').setAttribute('aria-label', view[0] === 'BUZZ !' ? 'Buzzer' : view[1]);

  // Révélation
  const rev = $('#phReveal');
  rev.hidden = st !== 'reveal';
  if (st === 'reveal' && s.reveal) {
    const img = $('#revCover');
    if (img.getAttribute('src') !== s.reveal.cover) img.src = s.reveal.cover || '';
    img.hidden = !s.reveal.cover;
    $('#revTitle').textContent = s.reveal.title;
    $('#revArtist').textContent = s.reveal.artist;
    const r = s.result;
    const res = $('#revResult');
    if (r?.type === 'correct') {
      const winner = teams.find((t) => t.id === r.teamId);
      const pts = `${r.points} point${r.points > 1 ? 's' : ''}`;
      res.className = `rev-result ${r.teamId === me ? 'win' : ''}`;
      res.textContent = r.teamId === me ? `+${pts} pour vous ! 🎉` : `${winner?.emoji || ''} ${winner?.name || ''} marque ${pts}`;
    } else {
      res.className = 'rev-result';
      res.textContent = r?.line || '';
    }
  }

  // Fin
  const end = $('#phEnd');
  end.hidden = st !== 'end';
  if (st === 'end') {
    const idx = teams.findIndex((t) => t.id === me);
    let rank = idx + 1;
    while (rank > 1 && teams[rank - 2].score === teams[idx].score) rank--;
    const medal = ['🥇', '🥈', '🥉'][rank - 1] || '🎉';
    $('#endRank').textContent = idx >= 0 ? `Vous finissez ${F.ordinal(rank)} sur ${teams.length} ${medal}` : 'Partie terminée !';
  }

  // Classement
  $('#phScores').innerHTML = teams.slice(0, 8).map((t) => `
    <li class="${t.id === me ? 'me' : ''}" style="--c:${t.color}">
      <span>${F.esc(t.emoji)}</span><span class="n">${F.esc(t.name)}</span><span class="p">${t.score}</span>
    </li>`).join('');

  // Petites vibrations aux moments clés
  if (st !== prevState) {
    if (st === 'mine') navigator.vibrate?.([120, 60, 120]);
    else if (st === 'locked' && prevState === 'mine') navigator.vibrate?.(300);
    else if (st === 'active' && ['waiting', 'paused', 'reveal'].includes(prevState)) navigator.vibrate?.(25);
    prevState = st;
  }
}

function applyTheme(color) {
  document.body.style.setProperty('--team', color);
  document.body.style.setProperty('--team-text', F.textOn(color));
  $('#themeColor')?.setAttribute('content', color);
}

/* ------------------------------------------------------------------ */
/* Bouton                                                               */
/* ------------------------------------------------------------------ */

function press() {
  const st = computeState();
  const btn = $('#buzzer');
  btn.classList.add('pressed');
  setTimeout(() => btn.classList.remove('pressed'), 160);
  if (st === 'active' && conn && conn.open) {
    pendingBuzz = Date.now();
    conn.send({ t: 'buzz', round: state.round });
    navigator.vibrate?.(60);
    renderPlay();
    setTimeout(renderPlay, 2100);
  } else if (st === 'lobby' && conn && conn.open) {
    conn.send({ t: 'test' });
    navigator.vibrate?.(40);
    testUntil = Date.now() + 1800;
    renderPlay();
    setTimeout(renderPlay, 1900);
  }
}

function bindBuzzer() {
  const btn = $('#buzzer');
  // pointerdown : plus réactif qu'un clic (pas d'attente du relâchement)
  btn.addEventListener('pointerdown', (e) => { e.preventDefault(); press(); });
  btn.addEventListener('click', (e) => { if (e.detail === 0) press(); }); // clavier
  btn.addEventListener('contextmenu', (e) => e.preventDefault());
  $('#leaveBtn').addEventListener('click', () => {
    if (confirm('Quitter cette équipe pour en choisir une autre ?')) leave();
  });
}

/* ------------------------------------------------------------------ */
/* Divers                                                               */
/* ------------------------------------------------------------------ */

let wakeLock = null;
async function requestWakeLock() {
  try {
    if ('wakeLock' in navigator && !wakeLock && !document.hidden) {
      wakeLock = await navigator.wakeLock.request('screen');
      wakeLock.addEventListener('release', () => { wakeLock = null; });
    }
  } catch (e) { /* pas grave */ }
}

function setNet(cls) { $('#netDot').className = `net-dot ${cls}`; }
function showBanner(text) { const b = $('#banner'); b.textContent = text; b.hidden = false; }
function hideBanner() { $('#banner').hidden = true; }

if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}

/* ------------------------------------------------------------------ */
/* Démarrage                                                            */
/* ------------------------------------------------------------------ */

buildJoinForm();
bindBuzzer();
if (!window.Peer && !params.has('local')) {
  showJoin('Le module de connexion n\'a pas pu se charger 📡 Vérifie Internet puis recharge la page.');
} else if (profile.joined && profile.code && profile.name) {
  showPlay();
  showBanner('Reconnexion à la partie…');
  connectNow();
} else {
  showJoin();
  if (!urlCode) $('#codeInput').focus();
}
