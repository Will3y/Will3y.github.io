'use strict';
// Plume — application d'entraînement à l'orthographe.
// Tout tient dans le navigateur : la progression de chaque profil est dans le localStorage de l'appareil.

const STORE = 'plume:v1';
const DAY = 864e5;
const INTERVALS = [0, 1, 3, 7, 21, 60]; // jours avant de revoir une phrase, selon sa « boîte »
const SESSION_LEN = 10;
const REVIEW_LEN = 12;
const UNLOCK = 0.6; // part de phrases acquises pour débloquer le niveau suivant
const EMOJIS = ['🦊', '🦉', '🐱', '🐼', '🌸', '⭐', '🌿', '☕', '📚', '🎈', '🐝', '🌙'];

// ───────────── Données ─────────────
function parse(src) {
  const m = src.match(/\[([^\]]+)\]|\{([^}]+)\}/);
  const isError = m[1] !== undefined;
  const parts = (isError ? m[1] : m[2]).split('|');
  const correct = isError ? parts[1] : parts[0];
  return {
    before: src.slice(0, m.index),
    after: src.slice(m.index + m[0].length),
    shown: parts[0],
    correct,
    isError,
    choices: [...new Set([correct, ...parts])],
  };
}
const ALL = [];
REGLES.forEach((r) => r.items.forEach((s, i) => ALL.push({ ...parse(s), key: `${r.id}#${i}`, rule: r })));
const RULE = Object.fromEntries(REGLES.map((r) => [r.id, r]));

// ───────────── Stockage ─────────────
let db = load();
function load() {
  try { const d = JSON.parse(localStorage.getItem(STORE)); if (d && Array.isArray(d.profiles)) return d; } catch (e) { /* données illisibles */ }
  return { profiles: [], current: null };
}
function save() { try { localStorage.setItem(STORE, JSON.stringify(db)); } catch (e) { toast('Impossible d\'enregistrer la progression sur cet appareil.'); } }
function me() { return db.profiles.find((p) => p.id === db.current) || null; }
function newProfile(name, emoji) {
  return { id: Math.random().toString(36).slice(2, 10), name, emoji, prog: {}, days: {}, goal: 20, mode: 'mix', created: Date.now() };
}

// ───────────── Outils ─────────────
const $app = document.getElementById('app');
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const shuffle = (a) => { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const dayKey = (t = Date.now()) => new Date(t).toLocaleDateString('sv-SE'); // AAAA-MM-JJ, heure locale
const pct = (x) => Math.round(x * 100);
const norm = (s) => s.normalize('NFC').replace(/[’`´]/g, "'").replace(/\s+/g, ' ').trim().toLowerCase();
let toastTimer;
function toast(msg) {
  document.querySelector('.toast')?.remove();
  const el = document.createElement('div'); el.className = 'toast'; el.textContent = msg; document.body.appendChild(el);
  clearTimeout(toastTimer); toastTimer = setTimeout(() => el.remove(), 2600);
}

// ───────────── Progression ─────────────
const st = (p, it) => p.prog[it.key];
const levelItems = (n) => ALL.filter((it) => it.rule.niveau === n);
const acquired = (p, it) => (st(p, it)?.b ?? -1) >= 2;
const levelProgress = (p, n) => { const its = levelItems(n); return its.filter((it) => acquired(p, it)).length / its.length; };
const unlocked = (p, n) => n === 1 || levelProgress(p, n - 1) >= UNLOCK;
function currentLevel(p) {
  for (const L of NIVEAUX) if (unlocked(p, L.n) && levelProgress(p, L.n) < 0.8) return L.n;
  return Math.max(...NIVEAUX.filter((L) => unlocked(p, L.n)).map((L) => L.n));
}
const dueErrors = (p) => ALL.filter((it) => { const s = st(p, it); return s && s.ko > 0 && s.b < 2 && s.d <= Date.now(); });
function streak(p) {
  let t = Date.now(), n = 0;
  if ((p.days[dayKey(t)] || 0) < p.goal) t -= DAY; // la journée en cours ne casse pas la série
  while ((p.days[dayKey(t)] || 0) >= p.goal) { n++; t -= DAY; }
  return n;
}
function ruleStats(p, r) {
  let ok = 0, ko = 0, acq = 0;
  r.items.forEach((_, i) => { const s = p.prog[`${r.id}#${i}`]; if (s) { ok += s.ok; ko += s.ko; if (s.b >= 2) acq++; } });
  return { ok, ko, n: ok + ko, rate: ok + ko ? ok / (ok + ko) : null, acq, total: r.items.length };
}
function record(p, it, ok) {
  const s = p.prog[it.key] || (p.prog[it.key] = { b: 0, d: 0, ok: 0, ko: 0 });
  const first = s.ok + s.ko === 0;
  if (ok) { s.ok++; s.b = first ? 2 : Math.min(s.b + 1, INTERVALS.length - 1); } else { s.ko++; s.b = 0; }
  s.d = Date.now() + INTERVALS[s.b] * DAY;
  const k = dayKey(); p.days[k] = (p.days[k] || 0) + 1;
  save();
}

// Choix des phrases d'une série : d'abord les erreurs à revoir, puis des phrases nouvelles,
// puis celles dont la date de révision est passée, puis les autres.
function pick(p, pool, len) {
  const now = Date.now();
  const failed = shuffle(pool.filter((it) => st(p, it) && st(p, it).b === 0));
  const fresh = shuffle(pool.filter((it) => !st(p, it)));
  const due = shuffle(pool.filter((it) => st(p, it) && st(p, it).b > 0 && st(p, it).d <= now));
  const rest = pool.filter((it) => st(p, it) && st(p, it).b > 0 && st(p, it).d > now).sort((a, b) => st(p, a).d - st(p, b).d);
  const out = [...failed.slice(0, Math.ceil(len * 0.4))];
  for (const list of [fresh, due, failed.slice(out.length), rest]) for (const it of list) if (out.length < len && !out.includes(it)) out.push(it);
  return shuffle(out);
}
function chooseMode(p, it) {
  if (p.mode === 'faute') return 'faute';
  const r = Math.random();
  if (it.isError) return r < 0.55 ? 'faute' : r < 0.8 ? 'qcm' : 'saisie';
  return r < 0.7 ? 'faute' : 'qcm';
}

// ───────────── Navigation ─────────────
let view = db.current && me() ? 'home' : 'profiles';
let session = null;
let ui = {}; // état temporaire de l'écran (formulaire de profil, etc.)
function go(v, extra = {}) { view = v; ui = extra; render(); window.scrollTo(0, 0); }

function render() {
  const p = me();
  if (!p && view !== 'profiles') view = 'profiles';
  const views = { profiles: vProfiles, home: vHome, quiz: vQuiz, results: vResults, memo: vMemo, stats: vStats, settings: vSettings };
  $app.innerHTML = views[view](p);
  const auto = $app.querySelector('[data-autofocus]');
  if (auto) auto.focus();
}

function tabs(active) {
  const t = [['home', '🏠', 'Accueil'], ['memo', '📖', 'Mémo'], ['stats', '📊', 'Stats'], ['settings', '⚙️', 'Profil']];
  return `<nav class="tabs" aria-label="Navigation"><div>${t.map(([v, i, l]) => `<button data-go="${v}" ${v === active ? 'aria-current="page"' : ''}><b aria-hidden="true">${i}</b>${l}</button>`).join('')}</div></nav>`;
}
function header(p) {
  return `<header class="top"><div class="brand"><img src="img/icon-192.png" alt="">Plume</div>
    ${p ? `<button class="chip" data-go="profiles" aria-label="Changer de profil"><span class="avatar">${esc(p.emoji)}</span><span>${esc(p.name)}</span></button>` : ''}</header>`;
}

// ───────────── Écran : profils ─────────────
function vProfiles() {
  const adding = ui.adding || db.profiles.length === 0;
  const em = ui.emoji || EMOJIS[db.profiles.length % EMOJIS.length];
  return `${header(null)}<div class="stack">
    <h1>${db.profiles.length ? 'Qui s\'entraîne ?' : 'Bienvenue sur Plume'}</h1>
    ${db.profiles.length ? '' : '<p class="muted">Créez un profil pour chaque personne : chacun garde sa propre progression sur cet appareil.</p>'}
    <div class="profiles">${db.profiles.map((p) => `<button class="profile" data-pick="${p.id}"><span class="avatar">${esc(p.emoji)}</span>
      <span class="grow"><h3>${esc(p.name)}</h3><span class="muted small">Niveau ${currentLevel(p)} · 🔥 ${streak(p)} jour${streak(p) > 1 ? 's' : ''}</span></span></button>`).join('')}</div>
    ${adding ? `<form class="card stack" data-form="profile">
        <label class="eyebrow" for="pname">Prénom</label>
        <input id="pname" class="input" name="pn" maxlength="24" autocomplete="off" placeholder="Votre prénom" required ${db.profiles.length ? 'data-autofocus' : ''}>
        <div class="eyebrow">Avatar</div>
        <div class="emojis">${EMOJIS.map((e) => `<button type="button" data-emoji="${e}" aria-pressed="${e === em}">${e}</button>`).join('')}</div>
        <button class="btn primary" type="submit">Créer le profil</button>
        ${db.profiles.length ? '<button class="btn ghost" type="button" data-act="cancel-add">Annuler</button>' : ''}
      </form>` : '<button class="btn" data-act="add-profile">＋ Ajouter un profil</button>'}
  </div>`;
}

// ───────────── Écran : accueil ─────────────
function vHome(p) {
  const today = p.days[dayKey()] || 0;
  const cur = currentLevel(p);
  const L = NIVEAUX.find((x) => x.n === cur);
  const errs = dueErrors(p).length;
  const s = streak(p);
  return `${header(p)}<div class="stack">
    <div class="tiles">
      <div class="tile"><div class="num">🔥 ${s}</div><div class="lbl">jour${s > 1 ? 's' : ''} d'affilée</div></div>
      <div class="tile"><div class="num">${Math.min(today, p.goal)}<span class="muted" style="font-size:18px"> / ${p.goal}</span></div><div class="lbl">objectif du jour${today >= p.goal ? ' ✓' : ''}</div>
        <div class="bar gold" style="margin-top:8px"><i style="width:${Math.min(100, (today / p.goal) * 100)}%"></i></div></div>
    </div>
    <button class="btn primary big" data-start="level" data-level="${cur}">Continuer<span class="sub">Niveau ${cur} · ${esc(L.titre)}</span></button>
    <button class="btn big" data-start="review" ${errs ? '' : 'disabled'}>🔁 Réviser mes erreurs<span class="sub">${errs ? `${errs} phrase${errs > 1 ? 's' : ''} à revoir` : 'Rien à revoir pour le moment'}</span></button>
    <h2 style="margin-top:24px">Les niveaux</h2>
    ${NIVEAUX.map((Lv) => {
      const pr = levelProgress(p, Lv.n), un = unlocked(p, Lv.n);
      return `<button class="level ${un ? '' : 'locked'} ${pr >= 0.8 ? 'done' : ''}" data-start="level" data-level="${Lv.n}">
        <span class="n">${un ? (pr >= 0.8 ? '✓' : Lv.n) : '🔒'}</span>
        <span class="grow" style="flex:1;min-width:0"><h3>${esc(Lv.titre)}</h3><span class="muted small">${esc(Lv.sous)}</span>
        <div class="bar" role="img" aria-label="${pct(pr)} % acquis"><i style="width:${pct(pr)}%"></i></div></span>
        <span class="pill">${pct(pr)} %</span></button>`;
    }).join('')}
    <p class="muted small">Un niveau se débloque quand ${pct(UNLOCK)} % des phrases du niveau précédent sont acquises.</p>
  </div>${tabs('home')}`;
}

// ───────────── Séries ─────────────
function startSession(kind, opt = {}) {
  const p = me();
  let pool, title, len = SESSION_LEN;
  if (kind === 'level') {
    if (!unlocked(p, opt.level) && !confirm(`Le niveau ${opt.level} n'est pas encore débloqué. Voulez-vous vous y essayer quand même ?`)) return;
    pool = levelItems(opt.level); title = `Niveau ${opt.level}`;
  } else if (kind === 'review') {
    pool = dueErrors(p).sort((a, b) => st(p, a).d - st(p, b).d); title = 'Révision'; len = REVIEW_LEN;
  } else if (kind === 'rule') {
    pool = ALL.filter((it) => it.rule.id === opt.rule); title = RULE[opt.rule].titre; len = Math.min(SESSION_LEN, pool.length);
  }
  if (!pool.length) { toast('Aucune phrase à réviser.'); return; }
  const items = kind === 'review' ? shuffle(pool.slice(0, len)) : pick(p, pool, len);
  session = {
    kind, opt, title, i: 0, answers: [], phase: 'ask',
    unlockedBefore: NIVEAUX.filter((L) => unlocked(p, L.n)).length,
    queue: items.map((item) => ({ item, mode: chooseMode(p, item), repeat: false })),
  };
  go('quiz');
}

function chunks(it) {
  // Découpe la phrase en « mots » à toucher ; le mot piégé est fusionné avec ce qui l'entoure sans espace (J'…, …-y, …,).
  const bm = it.before.match(/(\S*)$/)[1], am = it.after.match(/^(\S*)/)[1];
  const words = (s) => s.split(/\s+/).filter(Boolean).map((t) => ({ t }));
  return [...words(it.before.slice(0, it.before.length - bm.length)), { t: bm + it.shown + am, target: true }, ...words(it.after.slice(am.length))];
}
const isWord = (t) => /[\p{L}\p{N}]/u.test(t);
function fixedSentence(it, showWrong) {
  const mid = it.isError && showWrong ? `<del>${esc(it.shown)}</del> <ins>${esc(it.correct)}</ins>` : `<mark>${esc(it.correct)}</mark>`;
  return `${esc(it.before)}${mid}${esc(it.after)}`;
}

function vQuiz() {
  const S = session, q = S.queue[S.i], it = q.item, done = S.phase === 'feedback', a = S.last;
  const labels = { faute: '🔎 Touchez le mot fautif, ou indiquez qu\'il n\'y a pas de faute', qcm: '✍️ Choisissez la bonne orthographe', saisie: '⌨️ Corrigez le mot souligné' };
  let body = '';
  if (q.mode === 'faute') {
    const cs = chunks(it);
    body = `<div class="sentence">${cs.map((c, k) => {
      if (!isWord(c.t)) return `<span class="w">${esc(c.t)}</span>`;
      let cls = '';
      if (done && a.picked === k) cls = a.ok ? 'picked-ok' : 'picked-bad';
      if (done && c.target && it.isError && !a.ok) cls += ' target';
      return `<button class="w ${cls}" data-pickword="${k}" ${done ? 'disabled' : ''}>${esc(c.t)}</button>`;
    }).join(' ')}</div>
    <div class="answers"><button class="btn" data-pickword="-1" ${done ? 'disabled' : ''}>✓ Il n'y a pas de faute</button></div>`;
  } else if (q.mode === 'qcm') {
    if (!q.order) q.order = shuffle(it.choices);
    body = `<div class="sentence">${esc(it.before)}<span class="blank">${done ? esc(it.correct) : '…'}</span>${esc(it.after)}</div>
      <div class="answers ${q.order.length === 2 ? 'cols' : ''}">${q.order.map((c) => {
        const cls = done ? (c === it.correct ? 'ok' : c === a.choice ? 'bad' : '') : '';
        return `<button class="choice ${cls}" data-choice="${esc(c)}" ${done ? 'disabled' : ''}>${esc(c)}</button>`;
      }).join('')}</div>`;
  } else {
    body = `<div class="sentence">${esc(it.before)}<span class="under">${esc(it.shown)}</span>${esc(it.after)}</div>
      <form class="answers" data-form="saisie">
        <input class="input" name="v" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" placeholder="Écrivez le mot corrigé" value="${done ? esc(a.typed) : ''}" ${done ? 'disabled' : 'data-autofocus'}>
        <button class="btn primary" type="submit" ${done ? 'disabled' : ''}>Valider</button>
        <button class="btn ghost" type="button" data-act="dunno" ${done ? 'disabled' : ''}>Je ne sais pas</button>
      </form>`;
  }
  return `<div class="qtop"><button class="iconbtn" data-act="quit" aria-label="Quitter la série">✕</button>
      <div class="bar"><i style="width:${(S.i / S.queue.length) * 100}%"></i></div><span class="count">${S.i + 1}/${S.queue.length}</span></div>
    <div class="qlabel">${labels[q.mode]}</div>
    ${q.repeat ? '<p class="small muted" style="margin:-4px 0 10px">🔁 Cette phrase revient : à vous de jouer !</p>' : ''}
    ${body}
    ${done ? feedback(q, a) : ''}`;
}

function feedback(q, a) {
  const it = q.item, r = it.rule;
  let msg;
  if (q.mode === 'faute') {
    if (a.ok) msg = it.isError ? 'Bien vu, c\'était bien la faute.' : 'Exact : cette phrase était correcte.';
    else if (!it.isError) msg = `Cette phrase était correcte : « ${esc(a.word)} » était bien écrit.`;
    else if (a.picked === -1) msg = 'Il y avait pourtant une faute :';
    else msg = `« ${esc(a.word)} » était correct. La faute était ici :`;
  } else if (q.mode === 'qcm') {
    msg = a.ok ? 'Bonne réponse.' : `La bonne réponse était « ${esc(it.correct)} ».`;
  } else {
    msg = a.ok ? 'Parfait.' : a.typed ? `Vous avez écrit « ${esc(a.typed)} », il fallait « ${esc(it.correct)} ».` : `Il fallait écrire « ${esc(it.correct)} ».`;
  }
  return `<div class="feedback ${a.ok ? 'ok' : 'ko'}" role="dialog" aria-live="polite"><div>
    <div class="verdict"><i aria-hidden="true">${a.ok ? '✓' : '✕'}</i>${a.ok ? 'Bravo !' : 'Raté'}</div>
    <p style="margin-top:6px">${msg}</p>
    <p class="fixed">${fixedSentence(it, q.mode !== 'qcm')}</p>
    <div class="rulebox"><h3>📌 ${esc(r.titre)}</h3><p>${r.regle}</p><p class="ex">${r.exemple}</p></div>
    <button class="btn primary" style="margin-top:14px" data-act="next" data-autofocus>Continuer</button>
  </div></div>`;
}

function answer(ok, extra) {
  const S = session, q = S.queue[S.i];
  record(me(), q.item, ok);
  S.answers.push({ key: q.item.key, rule: q.item.rule.id, ok });
  S.last = { ok, ...extra };
  S.phase = 'feedback';
  if (!ok) {
    if (navigator.vibrate) navigator.vibrate(60);
    if (!q.repeat) { // la phrase ratée revient plus loin dans la série
      const at = Math.min(S.i + 4, S.queue.length);
      S.queue.splice(at, 0, { item: q.item, mode: chooseMode(me(), q.item), repeat: true });
    }
  }
  render();
}
function next() {
  const S = session;
  S.i++; S.phase = 'ask'; S.last = null;
  if (S.i >= S.queue.length) go('results'); else { render(); window.scrollTo(0, 0); }
}

// ───────────── Écran : résultats ─────────────
function vResults(p) {
  const S = session, n = S.answers.length, ok = S.answers.filter((a) => a.ok).length, rate = n ? ok / n : 0;
  const by = {};
  S.answers.forEach((a) => { (by[a.rule] ||= { ok: 0, ko: 0 }); by[a.rule][a.ok ? 'ok' : 'ko']++; });
  const nowUnlocked = NIVEAUX.filter((L) => unlocked(p, L.n)).length;
  const emoji = rate >= 0.9 ? '🏆' : rate >= 0.7 ? '🎉' : rate >= 0.5 ? '💪' : '🌱';
  const words = rate >= 0.9 ? 'Excellent !' : rate >= 0.7 ? 'Très bien !' : rate >= 0.5 ? 'Bon travail, continuez !' : 'Chaque erreur est une règle apprise.';
  const today = p.days[dayKey()] || 0;
  return `<div class="stack">
    <div class="card hero"><div class="emoji">${emoji}</div><div class="big" style="margin-top:8px">${ok}<span class="muted" style="font-size:28px"> / ${n}</span></div>
      <p style="margin-top:8px;font-weight:600">${words}</p><p class="muted small">${esc(S.title)} · ${pct(rate)} % de bonnes réponses</p></div>
    ${nowUnlocked > S.unlockedBefore ? `<div class="card" style="background:var(--gold-soft);border-color:#ecd49a"><b>🔓 Niveau ${nowUnlocked} débloqué :</b> ${esc(NIVEAUX[nowUnlocked - 1].titre)}</div>` : ''}
    ${today >= p.goal && today - n < p.goal ? '<div class="card" style="background:var(--ok-soft);border-color:#b7e0c8"><b>🎯 Objectif du jour atteint !</b> Votre série continue.</div>' : ''}
    <h2>Règles travaillées</h2>
    <div class="list">${Object.entries(by).map(([id, v]) => `<div class="li"><span class="grow">${esc(RULE[id].titre)}</span>
      ${v.ok ? `<span class="pill ok">✓ ${v.ok}</span>` : ''}${v.ko ? `<span class="pill bad">✕ ${v.ko}</span>` : ''}</div>`).join('')}</div>
    <button class="btn primary" data-act="again">Nouvelle série</button>
    <button class="btn" data-go="home">Retour à l'accueil</button>
  </div>`;
}

// ───────────── Écran : mémo des règles ─────────────
function vMemo(p) {
  return `${header(p)}<div class="stack"><h1>Mémo des règles</h1>
    <p class="muted">Toutes les règles, niveau par niveau. Touchez une règle pour la relire et vous entraîner dessus.</p>
    ${NIVEAUX.map((L) => `<h2 style="margin-top:22px;font-size:20px">${L.n}. ${esc(L.titre)}</h2>
      ${REGLES.filter((r) => r.niveau === L.n).map((r) => {
        const s = ruleStats(p, r);
        return `<details class="rule"><summary><span class="grow" style="flex:1">${esc(r.titre)}</span><span class="pill ${s.acq === s.total ? 'ok' : ''}">${s.acq}/${s.total}</span></summary>
          <div class="body"><p>${r.regle}</p><p class="ex">${r.exemple}</p>
          <button class="btn" data-start="rule" data-rule="${r.id}">S'entraîner sur cette règle</button></div></details>`;
      }).join('')}`).join('')}
  </div>${tabs('memo')}`;
}

// ───────────── Écran : statistiques ─────────────
function vStats(p) {
  let ok = 0, ko = 0, acq = 0;
  Object.values(p.prog).forEach((s) => { ok += s.ok; ko += s.ko; if (s.b >= 2) acq++; });
  const n = ok + ko;
  const weak = REGLES.map((r) => ({ r, s: ruleStats(p, r) })).filter((x) => x.s.n >= 3 && x.s.rate < 0.85).sort((a, b) => a.s.rate - b.s.rate).slice(0, 5);
  let best = 0, run = 0;
  Object.keys(p.days).sort().forEach((d, i, arr) => {
    if (p.days[d] < p.goal) { run = 0; return; }
    const prev = arr[i - 1];
    run = prev && p.days[prev] >= p.goal && Math.round((new Date(d) - new Date(prev)) / DAY) === 1 ? run + 1 : 1;
    best = Math.max(best, run);
  });
  return `${header(p)}<div class="stack"><h1>Statistiques</h1>
    <div class="tiles">
      <div class="tile"><div class="num">${n}</div><div class="lbl">réponses au total</div></div>
      <div class="tile"><div class="num">${n ? pct(ok / n) + ' %' : '–'}</div><div class="lbl">de bonnes réponses</div></div>
      <div class="tile"><div class="num">${acq}<span class="muted" style="font-size:18px"> / ${ALL.length}</span></div><div class="lbl">phrases acquises</div></div>
      <div class="tile"><div class="num">🔥 ${streak(p)}</div><div class="lbl">jours d'affilée (record : ${best})</div></div>
    </div>
    <h2 style="margin-top:22px">Par niveau</h2>
    <div class="card stack">${NIVEAUX.map((L) => {
      const pr = levelProgress(p, L.n);
      let lo = 0, lk = 0; REGLES.filter((r) => r.niveau === L.n).forEach((r) => { const s = ruleStats(p, r); lo += s.ok; lk += s.ko; });
      return `<div><div class="row"><span class="grow"><b>${L.n}.</b> ${esc(L.titre)}</span><span class="small muted">${lo + lk ? `${pct(lo / (lo + lk))} % réussite · ` : ''}${pct(pr)} % acquis</span></div>
        <div class="bar" style="margin-top:6px" role="img" aria-label="${pct(pr)} % acquis"><i style="width:${pct(pr)}%"></i></div></div>`;
    }).join('')}</div>
    <h2 style="margin-top:22px">Règles à travailler</h2>
    ${weak.length ? `<div class="list">${weak.map(({ r, s }) => `<button class="li" data-start="rule" data-rule="${r.id}" style="text-align:left;width:100%">
        <span class="grow"><b>${esc(r.titre)}</b><br><span class="small muted">Niveau ${r.niveau} · ${s.ok} ✓ / ${s.ko} ✕</span></span><span class="pill bad">${pct(s.rate)} %</span></button>`).join('')}</div>
        <p class="small muted">Touchez une règle pour vous entraîner dessus.</p>`
      : `<p class="muted">${n < 15 ? 'Répondez à quelques séries pour voir apparaître ici les règles à revoir.' : 'Aucune règle en difficulté : bravo !'}</p>`}
  </div>${tabs('stats')}`;
}

// ───────────── Écran : profil et réglages ─────────────
function vSettings(p) {
  return `${header(p)}<div class="stack"><h1>Profil</h1>
    <div class="card row"><span class="avatar" style="width:52px;height:52px;font-size:28px">${esc(p.emoji)}</span><span class="grow"><h3 style="font-size:20px">${esc(p.name)}</h3><span class="muted small">Sur cet appareil depuis le ${new Date(p.created).toLocaleDateString('fr-FR')}</span></span></div>
    <button class="btn" data-go="profiles">👥 Changer de profil</button>
    <div class="card stack"><div class="eyebrow">Objectif quotidien</div>
      <div class="seg">${[10, 20, 30, 50].map((g) => `<button data-goal="${g}" aria-pressed="${p.goal === g}">${g}</button>`).join('')}</div>
      <p class="small muted">Nombre de réponses par jour. Atteindre l'objectif fait avancer votre série de jours.</p></div>
    <div class="card stack"><div class="eyebrow">Type d'exercices</div>
      <div class="seg"><button data-mode="mix" aria-pressed="${p.mode === 'mix'}">Mélange</button><button data-mode="faute" aria-pressed="${p.mode === 'faute'}">Trouver la faute</button></div>
      <p class="small muted">« Mélange » alterne : trouver la faute, QCM et mot à corriger.</p></div>
    <div class="card stack"><div class="eyebrow">Changer d'appareil</div>
      <p class="small">La progression est enregistrée sur cet appareil. Pour la retrouver ailleurs (téléphone ↔ ordinateur), copiez ce code puis collez-le dans « Importer » sur l'autre appareil.</p>
      <button class="btn" data-act="export">📋 Copier mon code de sauvegarde</button>
      <textarea class="input" id="importbox" placeholder="Collez ici un code de sauvegarde"></textarea>
      <button class="btn" data-act="import">📥 Importer</button></div>
    <button class="btn ghost" data-act="delete" style="color:var(--bad)">Supprimer ce profil</button>
    <p class="small muted" style="text-align:center">Plume · ${ALL.length} phrases · ${REGLES.length} règles · ${NIVEAUX.length} niveaux</p>
  </div>${tabs('settings')}`;
}
const encode = (o) => btoa(unescape(encodeURIComponent(JSON.stringify(o))));
const decode = (s) => JSON.parse(decodeURIComponent(escape(atob(s.replace(/\s+/g, '')))));

// ───────────── Événements ─────────────
$app.addEventListener('click', async (e) => {
  const b = e.target.closest('button');
  if (!b || b.disabled) return;
  const d = b.dataset, p = me();
  if (d.go) return go(d.go);
  if (d.pick) { db.current = d.pick; save(); return go('home'); }
  if (d.emoji) { ui.emoji = d.emoji; ui.adding = true; const name = $app.querySelector('#pname')?.value; render(); if (name) $app.querySelector('#pname').value = name; return; }
  if (d.start) return startSession(d.start, { level: +d.level, rule: d.rule });
  if (d.pickword !== undefined && session) {
    const k = +d.pickword, it = session.queue[session.i].item, cs = chunks(it);
    const ok = k === -1 ? !it.isError : (cs[k].target && it.isError);
    return answer(ok, { picked: k, word: k >= 0 ? cs[k].t : '' });
  }
  if (d.choice !== undefined && session) { const it = session.queue[session.i].item; return answer(d.choice === it.correct, { choice: d.choice }); }
  if (d.goal) { p.goal = +d.goal; save(); return render(); }
  if (d.mode) { p.mode = d.mode; save(); return render(); }
  switch (d.act) {
    case 'add-profile': ui = { adding: true }; return render();
    case 'cancel-add': ui = {}; return render();
    case 'next': return next();
    case 'dunno': return answer(false, { typed: '' });
    case 'quit': if (!session.answers.length || confirm('Quitter la série ? Vos réponses sont déjà enregistrées.')) { session.answers.length ? go('results') : go('home'); } return;
    case 'again': return startSession(session.kind, session.opt);
    case 'export': {
      const code = encode(p);
      try { await navigator.clipboard.writeText(code); toast('Code copié. Collez-le sur l\'autre appareil.'); }
      catch { const box = $app.querySelector('#importbox'); box.value = code; box.select(); toast('Copiez le code affiché dans la case.'); }
      return;
    }
    case 'import': {
      const raw = $app.querySelector('#importbox').value.trim();
      if (!raw) return toast('Collez d\'abord un code.');
      let q; try { q = decode(raw); } catch { return toast('Ce code n\'est pas valide.'); }
      if (!q || !q.id || !q.prog || !q.name) return toast('Ce code n\'est pas valide.');
      const i = db.profiles.findIndex((x) => x.id === q.id);
      if (i >= 0 && !confirm(`Remplacer la progression de « ${q.name} » sur cet appareil par celle du code ?`)) return;
      if (i >= 0) db.profiles[i] = q; else db.profiles.push(q);
      db.current = q.id; save(); toast(`Profil « ${q.name} » importé.`); return go('home');
    }
    case 'delete':
      if (!confirm(`Supprimer le profil « ${p.name} » et toute sa progression ?`)) return;
      db.profiles = db.profiles.filter((x) => x.id !== p.id); db.current = db.profiles[0]?.id || null; save();
      return go('profiles');
  }
});

$app.addEventListener('submit', (e) => {
  e.preventDefault();
  const f = e.target;
  if (f.dataset.form === 'profile') {
    const name = f.pn.value.trim();
    if (!name) return;
    const em = $app.querySelector('[data-emoji][aria-pressed="true"]')?.dataset.emoji || EMOJIS[0];
    const p = newProfile(name, em);
    db.profiles.push(p); db.current = p.id; save(); go('home');
  } else if (f.dataset.form === 'saisie') {
    const v = f.v.value;
    if (!v.trim()) return f.v.focus();
    answer(norm(v) === norm(session.queue[session.i].item.correct), { typed: v.trim() });
  }
});

document.addEventListener('keydown', (e) => {
  if (view !== 'quiz' || !session) return;
  if (session.phase === 'feedback' && e.target.tagName !== 'BUTTON' && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); next(); }
});

render();
