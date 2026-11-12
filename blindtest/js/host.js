// Écran hôte : diffuse la musique, reçoit les buzz, compte les points.
import { createHost, isLocalMode } from './net.js';
import { searchPlaylists, getPlaylist, getPlaylistTracks, getFreshPreview, parsePlaylistInput, isShortLink } from './deezer.js';
import { sfx, speak, confetti, audioCtx } from './fx.js';
import * as F from './fun.js';
import qrcode from '../vendor/qrcode.mjs';

const $ = (sel) => document.querySelector(sel);
const STORE_KEY = 'blindtest-host-v1';
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const GAME_PHASES = ['ready', 'loading', 'playing', 'paused', 'buzzed', 'reveal'];
const PREVIEW_TTL = 10 * 60 * 1000;

/* ------------------------------------------------------------------ */
/* État                                                                */
/* ------------------------------------------------------------------ */

const S = {
  code: '',
  adminKey: '',
  phase: 'lobby',
  settings: { rounds: 20, lockOnWrong: true, penalty: false, voice: true },
  playlists: [],
  pool: [],
  cursor: 0,
  round: 0,
  total: 0,
  readyRound: 1,
  current: null,
  teams: {},
  order: [],
  locked: new Set(),
  buzz: null,
  result: null,
  history: [],
  played: [],
  playLine: '',
  netStatus: 'connecting',
};

const clients = new Map(); // cid -> { conn, teamId, lastSeen }
const admins = new Map(); // cid -> { conn, lastSeen } : pages animateur connectées
let host = null;
let searchResults = [];
let saveTimer = null;

const newAdminKey = () => Array.from({ length: 6 }, () => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[Math.floor(Math.random() * 32)]).join('');
const newCode = () => Array.from({ length: 4 }, () => CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)]).join('');
const newId = () => Math.random().toString(36).slice(2, 9);
const teamList = () => S.order.map((id) => S.teams[id]).filter(Boolean);
const ranked = () => teamList().slice().sort((a, b) => b.score - a.score || S.order.indexOf(a.id) - S.order.indexOf(b.id));

function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    const data = {
      v: 1, savedAt: Date.now(),
      code: S.code, adminKey: S.adminKey, phase: S.phase, settings: S.settings, playlists: S.playlists,
      pool: S.pool, cursor: S.cursor, round: S.round, total: S.total, current: S.current,
      teams: S.teams, order: S.order, history: S.history, played: S.played,
    };
    try { localStorage.setItem(STORE_KEY, JSON.stringify(data)); } catch (e) { console.warn('save failed', e); }
  }, 250);
}

function restore() {
  try {
    const d = JSON.parse(localStorage.getItem(STORE_KEY) || 'null');
    if (!d || d.v !== 1 || Date.now() - d.savedAt > 18 * 3600 * 1000) return false;
    Object.assign(S, {
      code: d.code, adminKey: d.adminKey || '', settings: { ...S.settings, ...d.settings }, playlists: d.playlists || [],
      pool: d.pool || [], cursor: d.cursor || 0, round: d.round || 0, total: d.total || 0,
      current: d.current || null, teams: d.teams || {}, order: d.order || [],
      history: d.history || [], played: d.played || [],
    });
    if (d.phase === 'end') S.phase = 'end';
    else if (GAME_PHASES.includes(d.phase) && S.total > 0) {
      S.readyRound = d.phase === 'reveal' ? S.round + 1 : Math.max(1, S.round);
      S.phase = S.readyRound > S.total ? 'end' : 'ready';
      if (d.phase === 'reveal') S.current = null;
    } else S.phase = 'lobby';
    return true;
  } catch (e) {
    return false;
  }
}

/* ------------------------------------------------------------------ */
/* Réseau                                                              */
/* ------------------------------------------------------------------ */

function startNetwork() {
  if (host) host.destroy();
  host = createHost(S.code, {
    onConnect,
    onStatus(st) {
      if (st === 'id-taken') {
        S.code = newCode();
        save();
        renderJoin();
        startNetwork();
        return;
      }
      S.netStatus = st;
      renderNet();
    },
  });
}

function onConnect(conn) {
  let cid = null;
  let role = null; // 'player' | 'admin'
  conn.onData((m) => {
    if (!m || typeof m !== 'object') return;
    if (m.t === 'hello') { cid = handleHello(conn, m); role = cid ? 'player' : null; return; }
    if (m.t === 'hello-admin') { cid = handleAdminHello(conn, m); role = cid ? 'admin' : null; return; }
    if (role === 'admin') {
      const a = admins.get(cid);
      if (!a || a.conn !== conn) return;
      a.lastSeen = Date.now();
      if (m.t === 'ping') conn.send({ t: 'pong' });
      else if (m.t === 'cmd') handleCmd(m);
      return;
    }
    const c = cid && clients.get(cid);
    if (!c || c.conn !== conn) return;
    c.lastSeen = Date.now();
    switch (m.t) {
      case 'ping': conn.send({ t: 'pong' }); break;
      case 'buzz': onBuzz(c.teamId, m.round); break;
      case 'test': flashTeam(c.teamId); break;
      case 'leave': leaveClient(cid); break;
      default: break;
    }
  });
  conn.onClose(() => {
    if (role === 'admin') {
      const a = admins.get(cid);
      if (a && a.conn === conn) { admins.delete(cid); renderAdminPresence(); }
      return;
    }
    const c = cid && clients.get(cid);
    if (c && c.conn === conn) { c.conn = null; refreshOnline(); }
  });
}

/* ----- Page animateur ----- */

function handleAdminHello(conn, m) {
  if (!m.key || String(m.key).toUpperCase() !== S.adminKey) { conn.send({ t: 'admin-denied' }); return null; }
  const cid = `admin:${String(m.cid || conn.id).slice(0, 40)}`;
  const prev = admins.get(cid);
  if (prev && prev.conn && prev.conn !== conn) prev.conn.close();
  admins.set(cid, { conn, lastSeen: Date.now() });
  conn.send({ t: 'admin-welcome', code: S.code });
  conn.send(adminState());
  renderAdminPresence();
  return cid;
}

const cmdLog = [];
const seenCmdIds = new Set();
function handleCmd(m) {
  if (m.id) {
    if (seenCmdIds.has(m.id)) return; // commande déjà traitée
    seenCmdIds.add(m.id);
    if (seenCmdIds.size > 300) seenCmdIds.delete(seenCmdIds.values().next().value);
  }
  cmdLog.push({ action: m.action, at: Date.now() });
  if (cmdLog.length > 50) cmdLog.shift();
  switch (m.action) {
    case 'plus1': award(1); break;
    case 'plus2': award(2); break;
    case 'wrong': wrong(); break;
    case 'cancel': cancelBuzz(); break;
    case 'pause': if (S.phase === 'playing') togglePause(); break;
    case 'unpause': if (S.phase === 'paused') togglePause(); break;
    case 'togglePause': if (S.phase === 'playing' || S.phase === 'paused') togglePause(); break;
    case 'skip': nobody('skip'); break;
    case 'next': next(); break;
    case 'resume': if (S.phase === 'ready') playRound(S.readyRound); break;
    case 'start': if (S.phase === 'lobby' || S.phase === 'end') startGame({ remote: true }); break;
    case 'lobby': if (S.phase !== 'lobby') backToLobby(); break;
    case 'buzzFor': manualBuzz(String(m.teamId)); break;
    case 'adjust': {
      const d = Math.max(-5, Math.min(5, Math.round(Number(m.delta) || 0)));
      if (d) adjustScore(String(m.teamId), d);
      break;
    }
    default: break;
  }
}

function audioInfo() {
  const el = activeEl();
  const d = el.duration && Number.isFinite(el.duration) ? el.duration : 30;
  return { t: Math.min(el.currentTime || 0, d), d, paused: el.paused };
}

function adminState() {
  const cur = S.current && S.current.round === (S.phase === 'ready' ? S.readyRound : S.round) ? S.current : null;
  return {
    t: 'admin',
    code: S.code,
    phase: S.phase,
    round: S.round,
    total: S.total,
    readyRound: S.readyRound,
    current: cur && !['lobby', 'end'].includes(S.phase)
      ? { title: cur.title, artist: cur.artist, album: cur.album, cover: cur.cover } : null,
    teams: ranked().map((t) => ({ ...publicTeam(t), online: isOnline(t.id), phones: phoneCount(t.id), locked: S.locked.has(t.id) })),
    buzz: S.buzz,
    result: S.result,
    history: S.history.slice(-40),
    playlists: S.playlists.map((p) => ({ title: p.title, nb: p.nb })),
    audio: audioInfo(),
  };
}

function sendAdmins(msg) {
  if (!admins.size) return;
  const payload = msg || adminState();
  for (const a of admins.values()) if (a.conn && a.conn.open) a.conn.send(payload);
}

const notifyAdmins = (text) => sendAdmins({ t: 'notice', text });

setInterval(() => {
  if (admins.size && ['playing', 'paused', 'buzzed', 'reveal'].includes(S.phase)) sendAdmins({ t: 'tick', audio: audioInfo() });
}, 1000);

function adminUrl() {
  const u = new URL('animateur.html', location.href);
  u.search = '';
  u.hash = '';
  u.searchParams.set('r', S.code);
  u.searchParams.set('k', S.adminKey);
  if (isLocalMode()) u.searchParams.set('local', '1');
  return u.toString();
}

function renderAdminPresence() {
  const n = admins.size;
  document.body.classList.toggle('has-admin', n > 0);
  $('#adminBadge').hidden = n === 0;
  const txt = n ? `✅ Animateur connecté${n > 1 ? ` (${n})` : ''}` : 'Personne pour l\'instant.';
  $('#adminState').textContent = n ? txt : '';
  $('#adminDialogStatus').textContent = txt;
  if (!$('#game').hidden) renderGame();
}

let lastAdminQr = '';
function openAdminDialog() {
  const url = adminUrl();
  if (url !== lastAdminQr) {
    lastAdminQr = url;
    const qr = qrcode(0, 'M');
    qr.addData(url);
    qr.make();
    $('#adminQr').innerHTML = qr.createSvgTag({ cellSize: 4, margin: 2, scalable: true });
  }
  $('#adminKey').textContent = S.adminKey;
  $('#adminUrl').innerHTML = `<a href="${F.esc(url)}" target="_blank" rel="noopener">${F.esc(url.replace(/^https?:\/\//, ''))}</a>`;
  renderAdminPresence();
  $('#adminDialog').showModal();
}

function handleHello(conn, m) {
  const cid = String(m.cid || '').slice(0, 40);
  const name = String(m.name || '').trim().replace(/\s+/g, ' ').slice(0, 32);
  if (!cid || !name) { conn.send({ t: 'error', msg: 'Nom d\'équipe manquant.' }); return null; }
  const color = F.TEAM_COLORS.some((c) => c.hex === m.color) ? m.color : F.TEAM_COLORS[0].hex;
  const emoji = F.TEAM_EMOJIS.includes(m.emoji) ? m.emoji : F.TEAM_EMOJIS[0];

  const prev = clients.get(cid);
  if (prev && prev.conn && prev.conn !== conn) prev.conn.close();

  let team = prev && S.teams[prev.teamId];
  if (!team || F.normName(team.name) !== F.normName(name)) {
    team = teamList().find((t) => F.normName(t.name) === F.normName(name));
  }
  if (!team) {
    team = { id: newId(), name, color, emoji, score: 0 };
    S.teams[team.id] = team;
    S.order.push(team.id);
    if (S.phase === 'lobby') sfx.pop();
  } else if (!clients.size || ![...clients.values()].some((c) => c.teamId === team.id && c.conn && c !== prev)) {
    // Seul téléphone de l'équipe : il peut changer couleur / mascotte.
    team.color = color;
    team.emoji = emoji;
  }
  clients.set(cid, { conn, teamId: team.id, lastSeen: Date.now() });
  conn.send({ t: 'welcome', team: publicTeam(team) });
  save();
  refreshOnline(true);
  broadcast();
  return cid;
}

function leaveClient(cid) {
  const c = clients.get(cid);
  if (!c) return;
  clients.delete(cid);
  const team = S.teams[c.teamId];
  const stillUsed = [...clients.values()].some((x) => x.teamId === c.teamId);
  if (team && !stillUsed && team.score === 0 && S.phase === 'lobby') removeTeam(team.id, false);
  refreshOnline(true);
}

function removeTeam(teamId, notify = true) {
  for (const [cid, c] of clients) {
    if (c.teamId === teamId) {
      if (notify && c.conn) c.conn.send({ t: 'kicked' });
      clients.delete(cid);
    }
  }
  delete S.teams[teamId];
  S.order = S.order.filter((id) => id !== teamId);
  S.locked.delete(teamId);
  if (S.buzz === teamId) {
    S.buzz = null;
    if (S.phase === 'buzzed') { S.phase = 'playing'; resumeMusic(); render(); }
  }
  save();
  renderTeams();
  renderScores();
  broadcast();
}

const publicTeam = (t) => ({ id: t.id, name: t.name, color: t.color, emoji: t.emoji, score: t.score });

function stateFor(teamId) {
  const showAnswer = S.phase === 'reveal' && S.current;
  return {
    t: 'state',
    phase: S.phase,
    round: S.round,
    total: S.total,
    readyRound: S.readyRound,
    teams: ranked().map(publicTeam),
    buzz: S.buzz,
    locked: [...S.locked],
    result: S.result,
    reveal: showAnswer ? { title: S.current.title, artist: S.current.artist, cover: S.current.cover } : null,
    you: teamId,
  };
}

function broadcast() {
  for (const c of clients.values()) if (c.conn && c.conn.open) c.conn.send(stateFor(c.teamId));
  sendAdmins();
}

let onlineSnapshot = '';
const isOnline = (teamId) => [...clients.values()].some((c) => c.teamId === teamId && c.conn && c.conn.open && Date.now() - c.lastSeen < 12000);
const phoneCount = (teamId) => [...clients.values()].filter((c) => c.teamId === teamId && c.conn && c.conn.open).length;

function refreshOnline(force = false) {
  const snap = S.order.map((id) => `${id}:${isOnline(id) ? 1 : 0}:${phoneCount(id)}`).join('|');
  if (!force && snap === onlineSnapshot) return;
  onlineSnapshot = snap;
  renderTeams();
  renderScores();
  sendAdmins();
}
setInterval(() => {
  refreshOnline();
  // pages animateur muettes depuis trop longtemps : on les oublie
  let changed = false;
  for (const [cid, a] of admins) {
    if (!a.conn || !a.conn.open || Date.now() - a.lastSeen > 15000) { admins.delete(cid); changed = true; }
  }
  if (changed) renderAdminPresence();
}, 3000);

/* ------------------------------------------------------------------ */
/* Lecture audio                                                        */
/* ------------------------------------------------------------------ */

const players = [new Audio(), new Audio()];
let curPlayer = 0;
let prefetched = null; // { id, url, at, track, el }
const activeEl = () => players[curPlayer];

players.forEach((el) => {
  el.preload = 'auto';
  el.addEventListener('ended', () => {
    if (el !== activeEl()) return;
    if (S.phase === 'playing') nobody('timeout');
    updateTimer();
  });
  el.addEventListener('error', () => {
    if (el !== activeEl() || !el.src) return;
    if (S.phase === 'playing' || S.phase === 'loading') {
      toast('😬 Extrait illisible, on passe au suivant…');
      S.current = null;
      setTimeout(() => playRound(S.round), 600);
    }
  });
});

function stopMusic() {
  players.forEach((p) => { p.pause(); });
}

function resumeMusic() {
  const el = activeEl();
  if (el.src && !el.ended) el.play().catch(() => {});
}

async function playUrl(url) {
  let el;
  if (prefetched && prefetched.url === url) {
    el = prefetched.el;
    curPlayer = players.indexOf(el);
  } else {
    el = activeEl();
    el.src = url;
  }
  prefetched = null;
  players.forEach((p) => { if (p !== el) p.pause(); });
  el.volume = 1;
  try { el.currentTime = 0; } catch (e) { /* ignore */ }
  try {
    await el.play();
    return 'ok';
  } catch (e) {
    console.warn('play() refusé', e);
    return e && e.name === 'NotAllowedError' ? 'blocked' : 'error';
  }
}

function prefetchNext() {
  if (S.round >= S.total) return;
  const cand = S.pool[S.cursor];
  if (!cand) return;
  getFreshPreview(cand.id).then((fr) => {
    if (!fr) return;
    const el = players[1 - curPlayer];
    el.src = fr.url;
    el.load();
    prefetched = { ...fr, id: cand.id, el };
  }).catch(() => {});
}

function duck(ms = 2600) {
  const el = activeEl();
  el.volume = 0.3;
  setTimeout(() => { el.volume = 1; }, ms);
}

/* ------------------------------------------------------------------ */
/* Déroulé de la partie                                                 */
/* ------------------------------------------------------------------ */

let roundToken = 0;

function setPhase(p) {
  S.phase = p;
  save();
  render();
  broadcast();
}

async function startGame({ remote = false } = {}) {
  if (!S.playlists.length) {
    startHint('Choisis au moins une playlist 🎵');
    notifyAdmins('Choisis d\'abord une playlist sur l\'écran du PC 🎵');
    return;
  }
  if (!S.order.length) {
    if (remote) { notifyAdmins('Aucune équipe connectée pour l\'instant 🤷'); return; }
    if (!confirm('Aucune équipe n\'est connectée. Lancer quand même ?')) return;
  }
  audioCtx();
  requestWakeLock();
  const btn = $('#startBtn');
  btn.disabled = true;
  btn.textContent = '⏳ Chargement des playlists…';
  try {
    const lists = await Promise.all(S.playlists.map((p) => getPlaylistTracks(p.id).catch(() => [])));
    const seen = new Set();
    let tracks = [];
    for (const t of lists.flat()) {
      const key = F.normName(`${t.title}|${t.artist}`);
      if (seen.has(t.id) || seen.has(key)) continue;
      seen.add(t.id);
      seen.add(key);
      tracks.push(t);
    }
    if (!tracks.length) { startHint('😬 Impossible de charger les chansons. Vérifie la connexion Internet.'); return; }
    // On évite de rejouer les chansons des parties précédentes s'il en reste assez.
    const played = new Set(S.played);
    const fresh = tracks.filter((t) => !played.has(t.id));
    if (fresh.length >= Math.min(S.settings.rounds, tracks.length)) tracks = fresh;
    S.pool = F.shuffle(tracks);
    S.cursor = 0;
    S.total = Math.min(S.settings.rounds, S.pool.length);
    S.round = 0;
    S.current = null;
    S.history = [];
    teamList().forEach((t) => { t.score = 0; });
    prefetched = null;
    await playRound(1);
  } finally {
    btn.disabled = false;
    btn.textContent = '🎉 C\'est parti !';
  }
}

async function playRound(n) {
  const my = ++roundToken;
  stopMusic();
  window.speechSynthesis?.cancel();
  S.round = n;
  S.readyRound = n;
  S.locked = new Set();
  S.buzz = null;
  S.result = null;
  S.playLine = F.pick(F.PLAYING_LINES);
  const reuse = S.current && S.current.round === n ? S.current : null;
  setPhase('loading');

  let fresh = null;
  let track = null;
  try {
    if (reuse) {
      fresh = await getFreshPreview(reuse.id);
      track = reuse;
    }
    while (!fresh) {
      if (S.cursor >= S.pool.length) {
        if (my !== roundToken) return;
        S.total = Math.max(0, n - 1);
        endGame();
        return;
      }
      const cand = S.pool[S.cursor];
      if (prefetched && prefetched.id === cand.id && Date.now() - prefetched.at < PREVIEW_TTL) fresh = prefetched;
      else fresh = await getFreshPreview(cand.id);
      if (my !== roundToken) return;
      S.cursor++;
      track = fresh ? { ...cand, ...fresh.track } : null;
    }
  } catch (e) {
    if (my !== roundToken) return;
    console.warn(e);
    toast('📡 Deezer ne répond pas. Vérifie Internet puis relance.');
    S.readyRound = n;
    setPhase('ready');
    return;
  }
  if (my !== roundToken) return;

  S.current = { ...track, round: n };
  if (!S.played.includes(track.id)) S.played.push(track.id);
  if (S.played.length > 2000) S.played = S.played.slice(-2000);
  const status = await playUrl(fresh.url);
  if (my !== roundToken) return;
  if (status === 'error') {
    toast('😬 Extrait illisible, on passe au suivant…');
    S.current = null;
    setTimeout(() => { if (my === roundToken) playRound(n); }, 500);
    return;
  }
  if (status === 'blocked') {
    toast('🔇 Le navigateur bloque le son : clique sur « Lancer ».');
    S.readyRound = n;
    setPhase('ready');
    return;
  }
  setPhase('playing');
  prefetchNext();
}

function onBuzz(teamId, round) {
  if (S.phase !== 'playing') return;
  if (round != null && round !== S.round) return;
  const team = S.teams[teamId];
  if (!team || S.locked.has(teamId)) return;
  S.buzz = teamId;
  activeEl().pause();
  sfx.buzz();
  if (S.settings.voice) setTimeout(() => { if (S.buzz === teamId) speak(`${team.name} !`); }, 380);
  S.buzzLine = F.pick(F.BUZZ_LINES);
  setPhase('buzzed');
}

function award(points) {
  if (S.phase !== 'buzzed') return;
  const team = S.teams[S.buzz];
  if (!team) return cancelBuzz();
  team.score += points;
  S.result = { type: 'correct', teamId: team.id, points, line: F.pick(F.CORRECT_LINES) };
  S.history.push({ round: S.round, trackId: S.current?.id, title: S.current?.title, artist: S.current?.artist, teamId: team.id, points });
  sfx.correct();
  confetti({ count: 200, colors: [team.color, '#ffffff', '#ffd23f', '#ff4fa3'] });
  bumpScore(team.id);
  S.buzz = null;
  resumeMusic();
  setPhase('reveal');
}

function wrong() {
  if (S.phase !== 'buzzed') return;
  const team = S.teams[S.buzz];
  S.buzz = null;
  if (!team) { setPhase('playing'); resumeMusic(); return; }
  if (S.settings.penalty) { team.score -= 1; bumpScore(team.id); }
  if (S.settings.lockOnWrong) S.locked.add(team.id);
  const line = F.pick(F.WRONG_LINES);
  S.result = { type: 'wrong', teamId: team.id, line, penalty: S.settings.penalty };
  sfx.wrong();
  toast(`❌ ${team.emoji} ${team.name} : ${line}`);
  const remaining = teamList().filter((t) => !S.locked.has(t.id));
  if (S.settings.lockOnWrong && remaining.length === 0) {
    setTimeout(() => { if (S.phase === 'playing') nobody('allwrong'); }, 700);
  }
  setPhase('playing');
  setTimeout(() => { if (S.phase === 'playing') resumeMusic(); }, 650);
}

function cancelBuzz() {
  if (S.phase !== 'buzzed') return;
  S.buzz = null;
  window.speechSynthesis?.cancel();
  setPhase('playing');
  resumeMusic();
}

function nobody(kind) {
  if (!['playing', 'paused'].includes(S.phase)) return;
  const line = kind === 'allwrong' ? 'Tout le monde s\'est trompé ! Bravo… enfin, non. 🙈' : F.pick(F.NOBODY_LINES);
  S.result = { type: 'none', kind, line };
  S.history.push({ round: S.round, trackId: S.current?.id, title: S.current?.title, artist: S.current?.artist, teamId: null, points: 0 });
  if (kind === 'skip') {
    sfx.pop();
    resumeMusic();
  } else {
    sfx.sadTrombone();
    if (kind === 'allwrong') { resumeMusic(); duck(); }
  }
  setPhase('reveal');
}

function next() {
  if (S.phase !== 'reveal') return;
  if (S.round >= S.total) endGame();
  else playRound(S.round + 1);
}

function togglePause() {
  if (S.phase === 'playing') { activeEl().pause(); setPhase('paused'); }
  else if (S.phase === 'paused') { resumeMusic(); setPhase('playing'); }
}

function endGame() {
  roundToken++;
  stopMusic();
  S.buzz = null;
  setPhase('end');
  celebrate();
}

function celebrate() {
  audioCtx();
  const dur = sfx.fanfare();
  const burst = () => confetti({ count: 140 });
  burst();
  [1.2, 2.6, 4.2, 6].forEach((s) => setTimeout(burst, s * 1000));
  const winner = ranked()[0];
  if (S.settings.voice && winner) setTimeout(() => speak(`Bravo ${winner.name} !`), (dur + 0.3) * 1000);
}

function backToLobby() {
  roundToken++;
  stopMusic();
  S.buzz = null;
  S.result = null;
  S.locked = new Set();
  setPhase('lobby');
}

function manualBuzz(teamId) {
  if (S.phase === 'playing') onBuzz(teamId, S.round);
}

function adjustScore(teamId, delta) {
  const t = S.teams[teamId];
  if (!t) return;
  t.score += delta;
  bumpScore(teamId);
  save();
  renderScores();
  broadcast();
}

/* ------------------------------------------------------------------ */
/* Rendu                                                                */
/* ------------------------------------------------------------------ */

function showScreen(id) {
  ['lobby', 'game', 'end'].forEach((s) => { $(`#${s}`).hidden = s !== id; });
}

function render() {
  if (S.phase === 'lobby') { showScreen('lobby'); renderLobby(); return; }
  if (S.phase === 'end') { showScreen('end'); renderEnd(); return; }
  showScreen('game');
  renderGame();
}

function renderLobby() {
  renderJoin();
  renderNet();
  renderTeams();
  renderSelected();
  renderResults();
  $('#setRounds').value = String(S.settings.rounds);
  $('#setLock').checked = S.settings.lockOnWrong;
  $('#setPenalty').checked = S.settings.penalty;
  $('#setVoice').checked = S.settings.voice;
}

function joinUrl() {
  const u = new URL('buzz.html', location.href);
  u.search = '';
  u.hash = '';
  u.searchParams.set('r', S.code);
  if (isLocalMode()) u.searchParams.set('local', '1');
  return u.toString();
}

let lastQr = '';
function renderJoin() {
  const url = joinUrl();
  $('#roomCode').textContent = S.code;
  $('#miniCode').textContent = S.code;
  if (url !== lastQr) {
    lastQr = url;
    const qr = qrcode(0, 'M');
    qr.addData(url);
    qr.make();
    $('#qr').innerHTML = qr.createSvgTag({ cellSize: 4, margin: 2, scalable: true });
  }
  const pretty = url.replace(/^https?:\/\//, '');
  $('#joinUrl').innerHTML = `ou va sur <a href="${F.esc(url)}" target="_blank" rel="noopener">${F.esc(pretty)}</a>`;
}

function renderNet() {
  const map = {
    online: ['ok', isLocalMode() ? '🧪 Mode test (onglets du même navigateur)' : 'Prêt à recevoir les buzzers'],
    connecting: ['', 'Connexion au serveur…'],
    reconnecting: ['bad', 'Connexion perdue, reconnexion…'],
    'waiting-id': ['', 'Récupération du salon…'],
  };
  const [cls, text] = map[S.netStatus] || ['', S.netStatus];
  $('#netDot').className = `net-dot ${cls}`;
  $('#miniDot').className = `net-dot ${cls}`;
  $('#netText').textContent = text;
}

function renderTeams() {
  const list = teamList();
  $('#teamCount').textContent = list.length;
  const ul = $('#teamList');
  if (!list.length) {
    ul.innerHTML = '<li class="empty">Personne pour l\'instant… Scannez le QR code avec vos téléphones ! 📱</li>';
    return;
  }
  ul.innerHTML = list.map((t) => {
    const phones = phoneCount(t.id);
    const online = phones > 0 && isOnline(t.id);
    const manual = !phones && ![...clients.values()].some((c) => c.teamId === t.id);
    const meta = manual ? 'sans téléphone' : online ? `📱 ${phones}` : 'hors ligne';
    return `<li class="team-chip ${online || manual ? '' : 'offline'}" data-id="${t.id}" style="--c:${t.color}">
      <span class="emoji">${F.esc(t.emoji)}</span>
      <span class="name">${F.esc(t.name)}</span>
      <span class="meta">${meta}</span>
      <button class="remove" data-remove="${t.id}" title="Retirer l'équipe" aria-label="Retirer ${F.esc(t.name)}">✕</button>
    </li>`;
  }).join('');
}

function flashTeam(teamId) {
  sfx.pop();
  const el = document.querySelector(`.team-chip[data-id="${teamId}"], .score-item[data-id="${teamId}"]`);
  if (!el) return;
  el.classList.remove('flash');
  void el.offsetWidth;
  el.classList.add('flash');
}

function renderResults(message) {
  const box = $('#results');
  if (message) { box.innerHTML = `<p class="msg">${message}</p>`; return; }
  if (!searchResults.length) { box.innerHTML = '<p class="msg">Choisis un thème ou cherche une playlist 👆</p>'; return; }
  const sel = new Set(S.playlists.map((p) => p.id));
  box.innerHTML = searchResults.map((p) => `
    <button class="pl-card ${sel.has(p.id) ? 'added' : ''}" data-pl="${p.id}" title="${F.esc(p.title)}">
      <img src="${F.esc(p.picture)}" alt="" loading="lazy">
      <span class="t">${F.esc(p.title)}</span>
      <span class="s">${p.nb} titres${p.by ? ' · ' + F.esc(p.by) : ''}</span>
    </button>`).join('');
}

function renderSelected() {
  const ul = $('#selected');
  $('#selCount').textContent = S.playlists.length;
  if (!S.playlists.length) {
    ul.innerHTML = '<li class="empty">Aucune pour l\'instant. Tu peux en mélanger plusieurs !</li>';
  } else {
    ul.innerHTML = S.playlists.map((p) => `
      <li>
        <img src="${F.esc(p.picture)}" alt="">
        <div class="info"><div class="t">${F.esc(p.title)}</div><div class="s">${p.nb} titres</div></div>
        <button class="btn-icon" data-unpl="${p.id}" title="Retirer" aria-label="Retirer ${F.esc(p.title)}">✕</button>
      </li>`).join('');
  }
  const total = S.playlists.reduce((n, p) => n + (p.nb || 0), 0);
  if (S.playlists.length) startHint(`${total} chansons au total, ${Math.min(total, S.settings.rounds)} seront tirées au sort.`);
}

function startHint(text) { $('#startHint').textContent = text; }

function renderGame() {
  const p = S.phase;
  $('#roundLabel').textContent = S.total ? `Chanson ${Math.min(p === 'ready' ? S.readyRound : S.round, S.total)} / ${S.total}` : 'Blind test';

  const cd = $('#cd');
  cd.classList.toggle('spin', p === 'playing' || p === 'reveal');
  cd.classList.toggle('slow', p === 'reveal');

  const label = $('#cdLabel');
  const cover = p === 'reveal' && S.current?.cover;
  const wanted = cover ? `img:${cover}` : 'q';
  cd.classList.toggle('mystery', !cover);
  if (label.dataset.k !== wanted) {
    label.dataset.k = wanted;
    label.innerHTML = cover ? `<img src="${F.esc(cover)}" alt="Pochette">` : '<span>?</span>';
  }

  $('#timer').classList.toggle('hidden', !['playing', 'paused', 'buzzed', 'reveal'].includes(p));

  const statusMap = {
    ready: S.readyRound > 1 ? `Partie en pause. Prêts pour la chanson ${S.readyRound} ?` : 'Prêts ?',
    loading: '⏳ Chargement de la chanson…',
    playing: S.playLine,
    paused: '⏸ Pause ! On reprend quand vous voulez.',
    buzzed: '',
    reveal: '',
  };
  const status = $('#status');
  status.textContent = statusMap[p] ?? '';
  status.hidden = p === 'reveal';

  const ans = $('#answer');
  ans.hidden = p !== 'reveal';
  if (p === 'reveal' && S.current) {
    $('#ansTitle').textContent = S.current.title;
    $('#ansArtist').textContent = S.current.artist;
    const r = S.result;
    const res = $('#result');
    if (r?.type === 'correct') {
      const t = S.teams[r.teamId];
      res.className = 'result win';
      res.textContent = `${t?.emoji || ''} ${t?.name || ''} : +${r.points} point${r.points > 1 ? 's' : ''} ! ${r.line}`;
    } else {
      res.className = 'result';
      res.textContent = r?.line || '';
    }
  }

  const ctrl = $('#controls');
  const last = S.round >= S.total;
  const buttons = {
    ready: `<button class="btn pink btn-big" data-act="resume">▶︎ Lancer la chanson ${S.readyRound} <kbd>Entrée</kbd></button>`,
    loading: '',
    playing: `<button class="btn ghost" data-act="pause">⏸ Pause <kbd>Espace</kbd></button>
              <button class="btn ghost" data-act="skip">⏭ Révéler la réponse <kbd>R</kbd></button>`,
    paused: `<button class="btn pink" data-act="pause">▶︎ Reprendre <kbd>Espace</kbd></button>
             <button class="btn ghost" data-act="skip">⏭ Révéler la réponse <kbd>R</kbd></button>`,
    buzzed: '',
    reveal: last
      ? '<button class="btn pink btn-big" data-act="next">🏆 Voir le classement <kbd>Entrée</kbd></button>'
      : '<button class="btn pink btn-big" data-act="next">➡️ Chanson suivante <kbd>Entrée</kbd></button>',
  };
  const hideCtrl = admins.size > 0 && p !== 'ready';
  const html = hideCtrl ? '' : buttons[p] ?? '';
  const key = `${p}|${last}|${S.readyRound}|${hideCtrl}`;
  if (ctrl.dataset.k !== key) { ctrl.dataset.k = key; ctrl.innerHTML = html; }

  const ov = $('#buzzOverlay');
  if (p === 'buzzed' && S.teams[S.buzz]) {
    const t = S.teams[S.buzz];
    ov.style.setProperty('--c', t.color);
    ov.style.setProperty('--ct', F.textOn(t.color));
    $('#buzzEmoji').textContent = t.emoji;
    $('#buzzName').textContent = t.name;
    $('#buzzSub').textContent = S.buzzLine || '';
    if (ov.hidden) {
      ov.hidden = false;
      // relance les animations
      ov.querySelectorAll('.buzz-card, .buzz-emoji').forEach((el) => { el.style.animation = 'none'; void el.offsetWidth; el.style.animation = ''; });
    }
  } else {
    ov.hidden = true;
  }

  renderScores();
  updateTimer();
}

const bumped = new Set();
function bumpScore(teamId) { bumped.add(teamId); }

function renderScores() {
  const ol = $('#scoreList');
  if (!ol) return;
  const list = ranked();
  if (!list.length) { ol.innerHTML = '<li class="empty">Aucune équipe</li>'; return; }
  let rank = 0;
  let prevScore = null;
  ol.innerHTML = list.map((t, i) => {
    if (t.score !== prevScore) { rank = i + 1; prevScore = t.score; }
    const phones = [...clients.values()].some((c) => c.teamId === t.id);
    const offline = phones && !isOnline(t.id);
    const cls = ['score-item',
      S.buzz === t.id && S.phase === 'buzzed' ? 'is-buzz' : '',
      S.locked.has(t.id) && GAME_PHASES.includes(S.phase) ? 'is-locked' : '',
      offline ? 'is-offline' : '',
      bumped.has(t.id) ? 'bump' : ''].join(' ');
    const rankTxt = rank === 1 && t.score > 0 ? '👑' : rank;
    return `<li class="${cls}" data-id="${t.id}" style="--c:${t.color};--ct:${F.textOn(t.color)}" title="Cliquer = buzz manuel pendant la chanson">
      <span class="rank">${rankTxt}</span>
      <span class="emoji">${F.esc(t.emoji)}</span>
      <span class="name">${F.esc(t.name)}</span>
      <span class="score">${t.score}</span>
      <span class="adj"><button data-adj="-1" aria-label="Retirer un point">−</button><button data-adj="1" aria-label="Ajouter un point">+</button></span>
    </li>`;
  }).join('');
  bumped.clear();
}

function updateTimer() {
  const el = activeEl();
  const dur = el.duration && Number.isFinite(el.duration) ? el.duration : 30;
  const t = Math.min(el.currentTime || 0, dur);
  const pct = S.phase === 'loading' || S.phase === 'ready' ? 0 : Math.max(0, Math.min(100, (t / dur) * 100));
  $('#timerBar').style.width = `${100 - pct}%`;
  $('#timerText').textContent = S.phase === 'reveal' ? '' : `${Math.max(0, Math.ceil(dur - t))} s`;
}

(function tick() {
  if (!$('#game').hidden && ['playing', 'reveal'].includes(S.phase)) updateTimer();
  requestAnimationFrame(tick);
})();

function renderEnd() {
  const list = ranked();
  const top = list.slice(0, 3);
  const winner = top[0];
  $('#endSub').textContent = winner
    ? `${winner.emoji} ${winner.name} remporte le blind test avec ${winner.score} point${Math.abs(winner.score) > 1 ? 's' : ''} !`
    : 'Merci à tous d\'être venus fêter ça !';
  const order = [top[1], top[0], top[2]];
  const cls = ['p2', 'p1', 'p3'];
  $('#podium').innerHTML = order.map((t, i) => (t ? `
    <div class="step ${cls[i]}" style="--c:${t.color};--ct:${F.textOn(t.color)}">
      <div class="emoji">${F.esc(t.emoji)}</div>
      <div class="name">${F.esc(t.name)}</div>
      <div class="pts">${t.score} pt${Math.abs(t.score) > 1 ? 's' : ''}</div>
      <div class="block">${cls[i].slice(1)}</div>
    </div>` : '')).join('');
  $('#restList').innerHTML = list.slice(3).map((t, i) => `<li style="--c:${t.color}">${i + 4}. ${F.esc(t.emoji)} ${F.esc(t.name)} · ${t.score} pt${Math.abs(t.score) > 1 ? 's' : ''}</li>`).join('');
}

let toastTimer = null;
function toast(text, ms = 2800) {
  notifyAdmins(text);
  const el = $('#toast');
  el.textContent = text;
  el.hidden = false;
  el.style.animation = 'none';
  void el.offsetWidth;
  el.style.animation = '';
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, ms);
}

/* ------------------------------------------------------------------ */
/* Playlists                                                            */
/* ------------------------------------------------------------------ */

async function runSearch(q) {
  renderResults('🔎 Recherche…');
  try {
    searchResults = (await searchPlaylists(q)).filter((p) => p.nb > 0);
    renderResults(searchResults.length ? null : 'Aucune playlist trouvée 🤷');
  } catch (e) {
    renderResults('📡 Deezer ne répond pas. Vérifie la connexion Internet.');
  }
}

async function addPlaylistById(id) {
  if (S.playlists.some((p) => p.id === id)) return;
  try {
    const p = searchResults.find((x) => x.id === id) || await getPlaylist(id);
    if (!p || !p.nb) { toast('Playlist vide ou introuvable 🤔'); return; }
    S.playlists.push(p);
    save();
    renderSelected();
    renderResults();
    sendAdmins();
  } catch (e) {
    toast('Playlist introuvable (est-elle publique ?)');
  }
}

function removePlaylist(id) {
  S.playlists = S.playlists.filter((p) => p.id !== id);
  save();
  sendAdmins();
  renderSelected();
  renderResults();
}

/* ------------------------------------------------------------------ */
/* Divers                                                               */
/* ------------------------------------------------------------------ */

let wakeLock = null;
async function requestWakeLock() {
  try {
    if ('wakeLock' in navigator && !wakeLock) {
      wakeLock = await navigator.wakeLock.request('screen');
      wakeLock.addEventListener('release', () => { wakeLock = null; });
    }
  } catch (e) { /* pas grave */ }
}
document.addEventListener('visibilitychange', () => { if (!document.hidden && S.phase !== 'lobby') requestWakeLock(); });

function toggleFullscreen() {
  if (document.fullscreenElement) document.exitFullscreen?.();
  else document.documentElement.requestFullscreen?.().catch(() => {});
}

let taglineIdx = Math.floor(Math.random() * F.TAGLINES.length);
function rotateTagline() {
  const el = $('#tagline');
  el.classList.add('fade');
  setTimeout(() => {
    taglineIdx = (taglineIdx + 1) % F.TAGLINES.length;
    el.textContent = F.TAGLINES[taglineIdx];
    el.classList.remove('fade');
  }, 350);
}

/* ------------------------------------------------------------------ */
/* Évènements                                                           */
/* ------------------------------------------------------------------ */

function bind() {
  $('#themeChips').innerHTML = F.PLAYLIST_THEMES.map((t, i) => `<button class="chip" data-q="${F.esc(t.q)}" data-i="${i}">${t.label}</button>`).join('');
  $('#themeChips').addEventListener('click', (e) => {
    const b = e.target.closest('[data-q]');
    if (!b) return;
    document.querySelectorAll('#themeChips .chip').forEach((c) => c.classList.toggle('active', c === b));
    runSearch(b.dataset.q);
  });

  $('#searchForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const v = $('#searchInput').value.trim();
    if (!v) return;
    const id = parsePlaylistInput(v);
    if (id) { addPlaylistById(id); $('#searchInput').value = ''; return; }
    if (isShortLink(v)) {
      renderResults('Les liens courts (link.deezer.com) ne marchent pas ici. Ouvre-le dans le navigateur, puis copie l\'adresse finale (deezer.com/…/playlist/123…).');
      return;
    }
    document.querySelectorAll('#themeChips .chip').forEach((c) => c.classList.remove('active'));
    runSearch(v);
  });

  $('#results').addEventListener('click', (e) => {
    const b = e.target.closest('[data-pl]');
    if (!b) return;
    if (S.playlists.some((p) => p.id === b.dataset.pl)) removePlaylist(b.dataset.pl);
    else addPlaylistById(b.dataset.pl);
  });
  $('#selected').addEventListener('click', (e) => {
    const b = e.target.closest('[data-unpl]');
    if (b) removePlaylist(b.dataset.unpl);
  });

  $('#teamList').addEventListener('click', (e) => {
    const b = e.target.closest('[data-remove]');
    if (!b) return;
    const t = S.teams[b.dataset.remove];
    if (t && confirm(`Retirer l'équipe « ${t.name} » ?`)) removeTeam(t.id);
  });

  $('#addTeamForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const input = $('#addTeamInput');
    const name = input.value.trim().replace(/\s+/g, ' ').slice(0, 32);
    if (!name) return;
    if (teamList().some((t) => F.normName(t.name) === F.normName(name))) { toast('Ce nom d\'équipe existe déjà'); return; }
    const used = new Set(teamList().map((t) => t.color));
    const color = (F.TEAM_COLORS.find((c) => !used.has(c.hex)) || F.pick(F.TEAM_COLORS)).hex;
    const team = { id: newId(), name, color, emoji: F.pick(F.TEAM_EMOJIS), score: 0 };
    S.teams[team.id] = team;
    S.order.push(team.id);
    input.value = '';
    sfx.pop();
    save();
    renderTeams();
    broadcast();
  });

  $('#setRounds').addEventListener('change', (e) => { S.settings.rounds = Number(e.target.value); save(); renderSelected(); });
  $('#setLock').addEventListener('change', (e) => { S.settings.lockOnWrong = e.target.checked; save(); });
  $('#setPenalty').addEventListener('change', (e) => { S.settings.penalty = e.target.checked; save(); });
  $('#setVoice').addEventListener('change', (e) => { S.settings.voice = e.target.checked; save(); if (e.target.checked) speak('Bienvenue au blind test !'); });

  $('#startBtn').addEventListener('click', () => startGame());

  $('#adminOpen').addEventListener('click', openAdminDialog);
  $('#adminClose').addEventListener('click', () => $('#adminDialog').close());
  $('#adminWindow').addEventListener('click', () => {
    window.open(adminUrl(), 'animateur-blindtest', 'popup,width=1100,height=820');
  });
  $('#adminCopy').addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(adminUrl()); $('#adminCopy').textContent = '✅ Lien copié'; }
    catch (e) { $('#adminCopy').textContent = '❌ Copie impossible'; }
    setTimeout(() => { $('#adminCopy').textContent = '📋 Copier le lien'; }, 2000);
  });

  $('#controls').addEventListener('click', (e) => {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    ({ pause: togglePause, skip: () => nobody('skip'), next, resume: () => { audioCtx(); requestWakeLock(); playRound(S.readyRound); } })[b.dataset.act]?.();
  });

  $('#judge').addEventListener('click', (e) => {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    ({ plus1: () => award(1), plus2: () => award(2), wrong, cancel: cancelBuzz })[b.dataset.act]?.();
  });

  $('#scoreList').addEventListener('click', (e) => {
    const item = e.target.closest('.score-item');
    if (!item) return;
    const adj = e.target.closest('[data-adj]');
    if (adj) { adjustScore(item.dataset.id, Number(adj.dataset.adj)); return; }
    manualBuzz(item.dataset.id);
  });

  $('#fsBtn').addEventListener('click', toggleFullscreen);
  $('#quitBtn').addEventListener('click', () => {
    if (confirm('Revenir au menu ? La partie en cours sera arrêtée (les équipes restent connectées).')) backToLobby();
  });

  $('#replayBtn').addEventListener('click', async () => {
    toast('🔀 On mélange de nouvelles chansons…');
    await startGame();
    if (S.phase === 'end') render();
  });
  $('#fanfareBtn').addEventListener('click', celebrate);
  $('#menuBtn').addEventListener('click', backToLobby);

  document.addEventListener('keydown', (e) => {
    if (e.target.closest('input, select, textarea') || e.ctrlKey || e.metaKey || e.altKey) return;
    const k = e.key.toLowerCase();
    // Espace / Entrée sur un bouton : on laisse le bouton faire son clic normal.
    if (e.target.closest('button') && (k === ' ' || k === 'enter')) return;
    if (k === 'f') { toggleFullscreen(); return; }
    let handled = true;
    switch (S.phase) {
      case 'playing':
        if (k === ' ') togglePause(); else if (k === 'r') nobody('skip'); else handled = false;
        break;
      case 'paused':
        if (k === ' ') togglePause(); else if (k === 'r') nobody('skip'); else handled = false;
        break;
      case 'buzzed':
        if (k === '1' || k === '&') award(1);
        else if (k === '2' || k === 'é') award(2);
        else if (k === 'x' || k === '0' || k === 'backspace' || k === 'à') wrong();
        else if (k === 'a' || k === 'q' || k === 'escape') cancelBuzz();
        else handled = false;
        break;
      case 'reveal':
        if (k === 'enter' || k === 'n' || k === 'arrowright' || k === ' ') next(); else handled = false;
        break;
      case 'ready':
        if (k === 'enter' || k === ' ') { audioCtx(); requestWakeLock(); playRound(S.readyRound); } else handled = false;
        break;
      default:
        handled = false;
    }
    if (handled) e.preventDefault();
  });

  window.addEventListener('beforeunload', (e) => {
    if (['playing', 'paused', 'buzzed', 'reveal', 'loading'].includes(S.phase)) { e.preventDefault(); e.returnValue = ''; }
  });
}

/* ------------------------------------------------------------------ */
/* Démarrage                                                            */
/* ------------------------------------------------------------------ */

function init() {
  if (!window.Peer && !isLocalMode()) {
    alert('Le module de connexion n\'a pas pu se charger. Vérifie la connexion Internet puis recharge la page.');
  }
  restore();
  if (!S.code) S.code = newCode();
  if (!S.adminKey) S.adminKey = newAdminKey();
  save();
  bind();
  $('#tagline').textContent = F.TAGLINES[taglineIdx];
  setInterval(rotateTagline, 6500);
  render();
  startNetwork();
  requestWakeLock();
  if (S.phase === 'lobby') {
    const first = document.querySelector('#themeChips .chip');
    first?.classList.add('active');
    runSearch(F.PLAYLIST_THEMES[0].q);
  }
  // Pour les tests et le débogage depuis la console.
  window.__bt = { S, clients, admins, cmdLog, award, wrong, next, nobody, onBuzz, adminUrl };
}

init();
