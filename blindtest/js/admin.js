// Page animateur : la réponse en avance, les scores en direct et les boutons pour juger.
import { createClient } from './net.js';
import * as F from './fun.js';

const $ = (sel) => document.querySelector(sel);
const params = new URLSearchParams(location.search);
const SAVE_KEY = 'blindtest-admin-v1';
const store = params.has('local') ? sessionStorage : localStorage;

const cleanCode = (v) => String(v || '').toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4);
const cleanKey = (v) => String(v || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);

const saved = (() => { try { return JSON.parse(store.getItem(SAVE_KEY)) || {}; } catch (e) { return {}; } })();
let code = cleanCode(params.get('r')) || saved.code || '';
let key = cleanKey(params.get('k')) || saved.key || '';
let active = false; // on veut rester connecté

const CID_KEY = 'blindtest-admin-cid';
const cid = sessionStorage.getItem(CID_KEY) || (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`).slice(0, 36);
try { sessionStorage.setItem(CID_KEY, cid); } catch (e) { /* ignore */ }

/* ------------------------------------------------------------------ */
/* Connexion                                                            */
/* ------------------------------------------------------------------ */

let conn = null;
let connected = false;
let everConnected = false;
let lastMsg = 0;
let lastAttempt = 0;
let retryTimer = null;
let st = null; // dernier état reçu
let audio = { t: 0, d: 30, paused: true };
let audioAt = 0;

const client = createClient({
  onOpen(c) {
    conn = c;
    lastMsg = Date.now();
    c.onData(onMsg);
    c.send({ t: 'hello-admin', key, cid });
  },
  onClose() {
    conn = null;
    connected = false;
    setNet('bad');
    if (active) { toast('Connexion perdue… on réessaie 🔄'); retry(1500); }
  },
  onError(type) {
    if (!everConnected) {
      active = false;
      client.disconnect();
      showJoin(type === 'host-not-found'
        ? 'Salon introuvable 🤔 Vérifie le code et que l\'écran du blind test est ouvert sur le PC.'
        : 'Connexion impossible 📡 Vérifie la connexion Internet.');
      return;
    }
    if (active) retry(3000);
  },
});

function connectNow() {
  lastAttempt = Date.now();
  setNet('');
  client.connect(code);
}

function retry(ms) {
  clearTimeout(retryTimer);
  retryTimer = setTimeout(() => { if (active) connectNow(); }, ms);
}

setInterval(() => {
  if (!active) return;
  if (conn && conn.open) conn.send({ t: 'ping' });
  if (Date.now() - lastMsg > 9000 && Date.now() - lastAttempt > 6000) {
    connected = false;
    setNet('bad');
    connectNow();
  }
}, 3000);

document.addEventListener('visibilitychange', () => {
  if (document.hidden || !active) return;
  if (Date.now() - lastMsg > 4000 && Date.now() - lastAttempt > 2000) connectNow();
});

let prevPhase = '';
function onMsg(m) {
  if (!m || typeof m !== 'object') return;
  lastMsg = Date.now();
  switch (m.t) {
    case 'admin-welcome':
      connected = true;
      everConnected = true;
      try { store.setItem(SAVE_KEY, JSON.stringify({ code, key })); } catch (e) { /* ignore */ }
      setNet('ok');
      showDesk();
      break;
    case 'admin-denied':
      active = false;
      client.disconnect();
      try { store.removeItem(SAVE_KEY); } catch (e) { /* ignore */ }
      showJoin('Code animateur incorrect 🔒');
      break;
    case 'admin':
      st = m;
      audio = m.audio || audio;
      audioAt = Date.now();
      if (m.phase === 'buzzed' && prevPhase !== 'buzzed') navigator.vibrate?.([90, 50, 90]);
      prevPhase = m.phase;
      render();
      break;
    case 'tick':
      audio = m.audio || audio;
      audioAt = Date.now();
      break;
    case 'notice':
      toast(m.text);
      break;
    default:
      break;
  }
}

let cmdSeq = 0;
function send(action, extra = {}) {
  if (!conn || !conn.open) { toast('Pas connecté au PC… 🔄'); return; }
  // Identifiant unique : le PC ignore une commande qu'il aurait déjà reçue.
  conn.send({ t: 'cmd', action, id: `${cid}:${Date.now().toString(36)}:${++cmdSeq}`, ...extra });
  navigator.vibrate?.(15);
}

/* ------------------------------------------------------------------ */
/* Écrans                                                               */
/* ------------------------------------------------------------------ */

function showJoin(err) {
  $('#join').hidden = false;
  $('#desk').hidden = true;
  $('#codeInput').value = code;
  $('#keyInput').value = key;
  $('#joinErr').textContent = err || '';
  const btn = $('#joinBtn');
  btn.disabled = false;
  btn.textContent = 'Se connecter';
  $('#adRoom').textContent = '';
}

function showDesk() {
  $('#join').hidden = true;
  $('#desk').hidden = false;
  $('#adRoom').innerHTML = `Salon <b>${F.esc(code)}</b>`;
  render();
}

const PHASES = {
  lobby: ['', '⏳ En attente du lancement'],
  ready: ['paused', '⏸ Prêt à lancer'],
  loading: ['', '⏳ Chargement…'],
  playing: ['playing', '🎵 En écoute'],
  paused: ['paused', '⏸ Pause'],
  buzzed: ['buzzed', '🔔 BUZZ !'],
  reveal: ['reveal', '✅ Réponse affichée'],
  end: ['reveal', '🏆 Partie terminée'],
};

function render() {
  if (!st || $('#desk').hidden) return;
  const p = st.phase;
  const teams = st.teams || [];
  const byId = Object.fromEntries(teams.map((t) => [t.id, t]));

  // En-tête de la chanson
  $('#roundPill').textContent = st.total && !['lobby', 'end'].includes(p)
    ? `Chanson ${p === 'ready' ? st.readyRound : st.round} / ${st.total}` : (p === 'end' ? 'Fin' : 'Accueil');
  const [cls, label] = PHASES[p] || ['', p];
  const pill = $('#phasePill');
  pill.className = `phase-pill ${cls}`;
  pill.textContent = label;

  const cur = st.current;
  $('#answerBox').hidden = !cur;
  if (cur) {
    const img = $('#ansCover');
    if (img.getAttribute('src') !== cur.cover) img.src = cur.cover || '';
    img.hidden = !cur.cover;
    $('#ansTitle').textContent = cur.title;
    $('#ansArtist').textContent = cur.artist;
    $('#ansAlbum').textContent = cur.album ? `Album : ${cur.album}` : '';
  }
  const ph = $('#placeholder');
  ph.hidden = !!cur;
  ph.textContent = {
    lobby: st.playlists?.length
      ? `${teams.length} équipe${teams.length > 1 ? 's' : ''} connectée${teams.length > 1 ? 's' : ''}. Lance la partie quand tout le monde est prêt !`
      : 'Choisis une ou plusieurs playlists sur l\'écran du PC, puis lance la partie.',
    loading: '🎧 Chargement de la chanson…',
    end: 'Partie terminée ! Bravo à tous 🎉',
  }[p] || '🎧 La réponse s\'affichera ici dès le lancement de la chanson.';

  $('#adTimer').hidden = !['playing', 'paused', 'buzzed', 'reveal'].includes(p);
  updateTimer();

  const rl = $('#resultLine');
  rl.hidden = p !== 'reveal' || !st.result;
  if (p === 'reveal' && st.result) {
    const r = st.result;
    if (r.type === 'correct') {
      const t = byId[r.teamId];
      rl.className = 'result-line win';
      rl.textContent = `${t?.emoji || ''} ${t?.name || ''} : +${r.points} point${r.points > 1 ? 's' : ''}`;
    } else {
      rl.className = 'result-line';
      rl.textContent = r.line || 'Personne n\'a trouvé';
    }
  }

  // Panneau de jugement
  const bp = $('#buzzPanel');
  const bt = p === 'buzzed' ? byId[st.buzz] : null;
  bp.hidden = !bt;
  if (bt) {
    bp.style.setProperty('--c', bt.color);
    bp.style.setProperty('--ct', F.textOn(bt.color));
    $('#buzzEmoji').textContent = bt.emoji;
    $('#buzzName').textContent = bt.name;
    $('#buzzExpect').textContent = cur ? `${cur.title} — ${cur.artist}` : '?';
  }

  // Boutons de pilotage
  const last = st.round >= st.total;
  const controls = {
    lobby: `<button class="btn pink btn-big" data-cmd="start" ${st.playlists?.length ? '' : 'disabled'}>🎉 Lancer la partie</button>`,
    ready: `<button class="btn pink btn-big" data-cmd="resume">▶︎ Lancer la chanson ${st.readyRound} <kbd>Entrée</kbd></button>`,
    loading: '',
    playing: `<button class="btn ghost" data-cmd="pause">⏸ Pause <kbd>Espace</kbd></button>
              <button class="btn ghost" data-cmd="skip">⏭ Personne ne trouve : révéler <kbd>R</kbd></button>`,
    paused: `<button class="btn pink" data-cmd="unpause">▶︎ Reprendre <kbd>Espace</kbd></button>
             <button class="btn ghost" data-cmd="skip">⏭ Révéler <kbd>R</kbd></button>`,
    buzzed: '',
    reveal: `<button class="btn pink btn-big" data-cmd="next">${last ? '🏆 Voir le classement' : '➡️ Chanson suivante'} <kbd>Entrée</kbd></button>`,
    end: `<button class="btn pink" data-cmd="start">🔁 Rejouer (mêmes équipes)</button>
          <button class="btn ghost" data-cmd="lobby">⚙️ Retour au menu</button>`,
  };
  const ctrlKey = `${p}|${last}|${st.readyRound}|${st.playlists?.length || 0}`;
  const ctrl = $('#controls');
  if (ctrl.dataset.k !== ctrlKey) { ctrl.dataset.k = ctrlKey; ctrl.innerHTML = controls[p] ?? ''; }

  // Scores
  const playing = p === 'playing';
  let rank = 0;
  let prev = null;
  $('#scores').innerHTML = teams.length ? teams.map((t, i) => {
    if (t.score !== prev) { rank = i + 1; prev = t.score; }
    const status = t.phones ? (t.online ? `📱 ${t.phones}` : '⚠️ hors ligne') : 'sans téléphone';
    const cls2 = [st.buzz === t.id && p === 'buzzed' ? 'is-buzz' : '', t.locked && ['playing', 'paused', 'buzzed'].includes(p) ? 'is-locked' : ''].join(' ');
    return `<li class="${cls2}" style="--c:${t.color};--ct:${F.textOn(t.color)}" data-id="${t.id}">
      <span class="rank">${rank === 1 && t.score > 0 ? '👑' : rank}</span>
      <span class="emoji">${F.esc(t.emoji)}</span>
      <span class="name"><b>${F.esc(t.name)}</b><small>${status}${t.locked && ['playing', 'paused', 'buzzed'].includes(p) ? ' · 🔒 bloquée' : ''}</small></span>
      <span class="pts">${t.score}</span>
      <span class="tools">
        <button data-buzz="${t.id}" title="Buzzer pour cette équipe" aria-label="Buzzer pour ${F.esc(t.name)}" ${playing && !t.locked ? '' : 'hidden'}>🔔</button>
        <button data-adj="-1" title="Retirer un point" aria-label="Retirer un point à ${F.esc(t.name)}">−</button>
        <button data-adj="1" title="Ajouter un point" aria-label="Ajouter un point à ${F.esc(t.name)}">+</button>
      </span>
    </li>`;
  }).join('') : '<li class="empty">Aucune équipe pour l\'instant… elles scannent le QR code sur la TV.</li>';

  // Playlists (accueil)
  $('#lobbyCard').hidden = p !== 'lobby';
  $('#playlists').innerHTML = (st.playlists || []).map((pl) => `<li>${F.esc(pl.title)} <small>(${pl.nb} titres)</small></li>`).join('')
    || '<li>Aucune pour l\'instant</li>';

  // Historique
  const hist = (st.history || []).slice().reverse();
  $('#historyCard').hidden = p === 'lobby' && !hist.length;
  $('#history').innerHTML = hist.length ? hist.map((h) => {
    const t = h.teamId ? byId[h.teamId] : null;
    const by = t ? `${t.emoji} ${F.esc(t.name)} +${h.points}` : 'personne 🎺';
    return `<li value="${h.round}"><span class="h-song">${F.esc(h.title || '?')}</span> — ${F.esc(h.artist || '')}<br><span class="h-by">${by}</span></li>`;
  }).join('') : '<li class="empty">Rien pour l\'instant.</li>';
}

function updateTimer() {
  if (!st) return;
  const running = st.phase === 'playing' && !audio.paused;
  const t = Math.min(audio.d, audio.t + (running ? (Date.now() - audioAt) / 1000 : 0));
  const pct = audio.d ? Math.max(0, Math.min(100, (t / audio.d) * 100)) : 0;
  $('#adTimerBar').style.width = `${100 - pct}%`;
  $('#adTimerText').textContent = st.phase === 'reveal' ? '' : `${Math.max(0, Math.ceil(audio.d - t))} s`;
}
setInterval(() => { if (st && st.phase === 'playing') updateTimer(); }, 250);

function setNet(cls) { $('#netDot').className = `net-dot ${cls}`; }

let toastTimer = null;
function toast(text, ms = 3200) {
  const el = $('#toast');
  el.textContent = text;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, ms);
}

/* ------------------------------------------------------------------ */
/* Évènements                                                           */
/* ------------------------------------------------------------------ */

const CONFIRM = {
  lobby: 'Revenir au menu ? (les équipes restent connectées)',
};

document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-cmd]');
  if (b) {
    const cmd = b.dataset.cmd;
    if (CONFIRM[cmd] && !confirm(CONFIRM[cmd])) return;
    send(cmd);
    return;
  }
  const li = e.target.closest('#scores li[data-id]');
  if (!li) return;
  const adj = e.target.closest('[data-adj]');
  if (adj) send('adjust', { teamId: li.dataset.id, delta: Number(adj.dataset.adj) });
  else if (e.target.closest('[data-buzz]')) send('buzzFor', { teamId: li.dataset.id });
});

document.addEventListener('keydown', (e) => {
  if (!st || e.target.closest('input, select, textarea') || e.ctrlKey || e.metaKey || e.altKey) return;
  const k = e.key.toLowerCase();
  if (e.target.closest('button') && (k === ' ' || k === 'enter')) return;
  const map = {
    playing: { ' ': 'togglePause', r: 'skip' },
    paused: { ' ': 'togglePause', r: 'skip' },
    buzzed: { 1: 'plus1', '&': 'plus1', 2: 'plus2', 'é': 'plus2', x: 'wrong', 0: 'wrong', 'à': 'wrong', backspace: 'wrong', a: 'cancel', q: 'cancel', escape: 'cancel' },
    reveal: { enter: 'next', n: 'next', arrowright: 'next', ' ': 'next' },
    ready: { enter: 'resume', ' ': 'resume' },
  }[st.phase] || {};
  const cmd = map[k];
  if (cmd) { e.preventDefault(); send(cmd); }
});

$('#joinForm').addEventListener('submit', (e) => {
  e.preventDefault();
  code = cleanCode($('#codeInput').value);
  key = cleanKey($('#keyInput').value);
  if (code.length !== 4 || key.length < 4) { $('#joinErr').textContent = 'Il faut le code du salon (4 lettres) et le code animateur.'; return; }
  const btn = $('#joinBtn');
  btn.disabled = true;
  btn.textContent = 'Connexion… ⏳';
  active = true;
  everConnected = false;
  connectNow();
});
$('#codeInput').addEventListener('input', (e) => { e.target.value = cleanCode(e.target.value); });
$('#keyInput').addEventListener('input', (e) => { e.target.value = cleanKey(e.target.value); });

$('#logoutBtn').addEventListener('click', () => {
  if (!confirm('Se déconnecter de la régie ?')) return;
  active = false;
  client.disconnect();
  try { store.removeItem(SAVE_KEY); } catch (err) { /* ignore */ }
  st = null;
  showJoin();
});

/* ------------------------------------------------------------------ */
/* Démarrage                                                            */
/* ------------------------------------------------------------------ */

if (!window.Peer && !params.has('local')) {
  showJoin('Le module de connexion n\'a pas pu se charger 📡 Vérifie Internet puis recharge la page.');
} else if (code && key) {
  active = true;
  $('#desk').hidden = false;
  $('#adRoom').innerHTML = `Salon <b>${F.esc(code)}</b>`;
  $('#placeholder').textContent = 'Connexion au PC… ⏳';
  $('#answerBox').hidden = true;
  $('#adTimer').hidden = true;
  connectNow();
} else {
  showJoin();
}
