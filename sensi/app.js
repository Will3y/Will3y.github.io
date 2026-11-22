// Interface de Sensi : formulaire, point de départ, résultats du test, réglages par jeu.
// Tout l'état tient dans un objet enregistré dans le localStorage.
(function () {
  'use strict';
  const C = window.SensiCore, T = window.SensiTrainer;
  const KEY = 'sensi-v1';
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const fr = (v, d) => v.toLocaleString('fr-FR', { minimumFractionDigits: d, maximumFractionDigits: d });
  const cmTxt = (v) => fr(v, v < 100 && Math.abs(v - Math.round(v)) > 0.04 ? 1 : 0);
  const OPT = ' <span style="font-weight:400;color:var(--muted)">(facultatif)</span>';

  const state = Object.assign({
    profile: { dpi: 800, pad: 40, screenW: Math.max(1280, Math.round(screen.width * (window.devicePixelRatio || 1))), aim: 'hybrid', grip: 'claw', game: 'valorant', curSens: '', curCross: '' },
    calib: null,     // { countsPerCm, raw, spread } : mesure réelle de la souris
    from: 'current', // centre du test : 'current' (sensi actuelle) ou 'suggested' (morphologie)
    sessions: [],    // [{ date, raw, kind, rounds: [{ cm, flick, track, acc, over, bias, time, err }] }]
    out: { mode: null, manual: 35 }, // mode : 'style' | 'uniform' | 'manual' (null = automatique)
  }, load());

  function load() { try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch (e) { return {}; } }
  function save() { try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) { /* stockage indisponible */ } }

  // ---------- Valeurs dérivées ----------

  const P = () => state.profile;
  const mainGame = () => C.game(P().game);
  // Counts par cm vus par le navigateur (pour le test) et DPI à utiliser pour les jeux.
  // Une mesure faite sans mouvement brut inclut le réglage de vitesse de Windows :
  // elle vaut pour le test, pas pour les jeux, qui lisent la souris directement.
  const countsPerCm = () => (state.calib ? state.calib.countsPerCm : P().dpi / 2.54);
  const gameDpi = () => (state.calib && state.calib.raw ? state.calib.countsPerCm * 2.54 : P().dpi);

  // Deux genres de jeux, deux unités. FPS : cm de souris pour un tour complet (cm/360).
  // Jeu au curseur (League of Legends) : cm de souris pour traverser l'écran.
  // Chaque genre a son test et son historique.
  const kind = () => (mainGame().kind === 'cursor' ? 'cursor' : 'fps');
  const isCursor = () => kind() === 'cursor';
  const lim = () => C.LIMITS[kind()];
  const cap = () => (isCursor() ? C.cursorCap(P().pad) : C.padCap(P().pad));
  const top = () => Math.min(cap(), lim().max);
  const unit = () => (isCursor() ? 'cm/écran' : 'cm/360');
  const unitBig = () => (isCursor() ? 'cm / écran' : 'cm / 360°');
  const sess = () => state.sessions.filter((s) => (s.kind || 'fps') === kind());

  // Distance mesurée à la règle pour traverser l'écran dans le jeu, si elle est renseignée.
  function measuredCross() {
    const v = parseFloat(String(P().curCross || '').replace(',', '.'));
    return v >= 1 && v <= 80 ? v : null;
  }
  function currentCm() {
    if (isCursor()) return measuredCross() || C.screenCm(gameDpi(), P().screenW);
    const s = parseFloat(String(P().curSens).replace(',', '.'));
    if (!(s > 0)) return null;
    const cm = C.cm360(mainGame().yaw, s, gameDpi());
    return isFinite(cm) && cm > 2 && cm < 400 ? cm : null;
  }
  function startCm() {
    const cur = currentCm();
    if (cur && (isCursor() || state.from !== 'suggested')) return C.clamp(cur, lim().min, top());
    return C.baseline(P()).cm;
  }
  const rounds = () => sess().reduce((n, s) => n + s.rounds.length, 0);
  const analysis = (style) => C.analyse(sess(), C.STYLES[style].flick);

  // cm/360 de référence pour un type de jeu : l'optimum mesuré s'il existe, sinon le point de départ.
  function refCm(style) {
    const a = analysis(style);
    if (a) return a.cm;
    const k = C.STYLES[style].mod / C.STYLES[mainGame().style].mod;
    return C.clamp(startCm() * k, lim().min, top());
  }
  const outMode = () => state.out.mode || (rounds() >= 3 ? 'style' : 'uniform');

  // ---------- Formulaire ----------

  function seg(id, options, key) {
    $(id).innerHTML = Object.keys(options).map((k) =>
      '<label><input type="radio" name="' + id + '" value="' + k + '"' + (P()[key] === k ? ' checked' : '') + '>' + esc(options[k].label) + '</label>').join('');
    $(id).addEventListener('change', (e) => { P()[key] = e.target.value; update(); });
  }

  function initForm() {
    $('dpi').value = P().dpi; $('pad').value = P().pad; $('screenW').value = P().screenW;
    $('game').innerHTML = C.GAMES.map((g) => '<option value="' + g.id + '">' + esc(g.name) + '</option>').join('');
    $('game').value = P().game;
    seg('aim', C.AIM, 'aim');
    seg('grip', C.GRIP, 'grip');

    const num = (id, key, lo, hi) => $(id).addEventListener('input', () => {
      const v = parseFloat($(id).value);
      if (v >= lo && v <= hi) {
        if (key === 'dpi' && v !== P().dpi) state.calib = null; // la mesure ne vaut que pour ce réglage de DPI
        P()[key] = v; update();
      }
    });
    num('dpi', 'dpi', 100, 32000); num('pad', 'pad', 10, 150); num('screenW', 'screenW', 800, 8000);
    $('game').addEventListener('change', () => { P().game = $('game').value; P().curSens = ''; syncCurrent(); update(); });
    $('curSens').addEventListener('input', () => { P()[isCursor() ? 'curCross' : 'curSens'] = $('curSens').value.trim(); update(); });
    syncCurrent();

    document.addEventListener('click', onAction);
    document.addEventListener('change', onChoice);
  }

  // Le champ « sensi actuelle » change de sens selon le genre du jeu principal.
  function syncCurrent() {
    const c = isCursor();
    $('curSens').value = c ? (P().curCross || '') : P().curSens;
    $('curSens').placeholder = c ? 'ex. 6' : 'ex. 0.35';
    $('curLabel').innerHTML = (c ? 'Distance de souris pour traverser l\'écran en jeu' : 'Ta sensi actuelle dans ce jeu') + OPT;
    $('bodyFields').hidden = c; // visée et prise ne servent qu'au point de départ des FPS
  }

  // ---------- Rendu ----------

  function update() { save(); render(); }

  function render() {
    const c = state.calib;
    $('dpiHint').innerHTML = c
      ? 'Mesuré : <b style="color:var(--ink)">' + Math.round(c.countsPerCm * 2.54) + ' DPI</b>' + (c.raw ? '' : ' (réglage de vitesse du système inclus)') +
        ' · <button class="link" data-act="calib">Refaire</button> · <button class="link" data-act="uncalib">Oublier</button>'
      : 'Le DPI annoncé est souvent faux de 5 à 10 %. <button class="link" data-act="calib">Mesurer mes DPI réels</button>';
    const cur = currentCm();
    if (isCursor()) {
      $('curHint').textContent = measuredCross()
        ? 'Utilisée comme point de départ du test.'
        : (P().curCross ? 'Valeur non reconnue.' : 'Curseur collé au bord gauche, glisse jusqu\'au bord droit et mesure. Sans mesure, on la déduit de tes DPI.');
      renderStartCursor(); renderResult(); renderLol();
      return;
    }
    $('curHint').textContent = cur ? '= ' + cmTxt(cur) + ' cm pour un tour complet (360°)' : (P().curSens ? 'Valeur non reconnue.' : 'Sert de point de départ au test et de base de conversion.');
    renderStart(); renderResult(); renderGames();
  }

  function planFor(kind) {
    const a = analysis(mainGame().style);
    if (kind === 'refine' && a) return C.testPlan(a.cm, a.kind === 'vertex' ? 'refine' : 'standard', cap(), lim());
    return C.testPlan(startCm(), kind === 'refine' ? 'standard' : kind, cap(), lim());
  }

  const testButtons = () =>
    '<div class="row"><button class="primary" data-act="test" data-kind="standard">Lancer le test · 5 sensis, env. 4 min</button>' +
    '<button data-act="test" data-kind="quick">Test rapide · 3 sensis</button></div>' +
    '<p class="sub" style="margin-top:10px">Sensis testées : ' + planFor('standard').map(cmTxt).join(' · ') + ' ' + unit() + '. Il faut une souris et un ordinateur.</p>';

  // Jeu au curseur : on part de la vitesse de curseur actuelle (mesurée, ou déduite des DPI).
  function renderStartCursor() {
    const s = startCm(), m = measuredCross(), cur = currentCm();
    let h = '<h2><span class="n">3</span> Point de départ</h2>' +
      '<p class="sub">Ta vitesse de curseur actuelle : le centre autour duquel le test va chercher.</p>' +
      '<div class="hero"><div class="big">' + cmTxt(s) + '<small>cm / écran</small></div>' +
      '<div class="facts">de souris pour traverser l\'écran' + (m ? ', d\'après ta mesure' : '<br>déduit de <b>' + Math.round(gameDpi()) + '</b> DPI sur <b>' + P().screenW + '</b> px') + '</div></div>';
    if (!m) h += '<div class="chips"><span class="chip">Windows 6/11</span><span class="chip">Accélération coupée</span><span class="chip">Vitesse souris du jeu ≈ 50</span></div>' +
      '<p class="sub" style="margin-top:10px">Ce calcul suppose ces trois réglages. S\'ils sont différents chez toi, mesure la distance à la règle et saisis-la plus haut.</p>';
    if (cur > top() + 0.05) h += '<div class="note warn">Traverser l\'écran te demande ' + cmTxt(cur) + ' cm : c\'est beaucoup pour un tapis de ' + P().pad + ' cm. Le test restera sous ' + cmTxt(top()) + ' cm/écran.</div>';
    $('start').innerHTML = h + testButtons();
  }

  function renderStart() {
    const b = C.baseline(P()), cur = currentCm(), s = startCm(), g = mainGame();
    const set = C.gameSetting(g, s, gameDpi());
    let h = '<h2><span class="n">3</span> Point de départ</h2>' +
      '<p class="sub">Le centre autour duquel le test va chercher. Ce n\'est pas encore ton résultat.</p>';
    if (cur) {
      h += '<div class="choice">' +
        '<label><input type="radio" name="from" value="current"' + (state.from !== 'suggested' ? ' checked' : '') + '>Partir de ma sensi actuelle<span class="v">' + cmTxt(cur) + ' cm/360</span></label>' +
        '<label><input type="radio" name="from" value="suggested"' + (state.from === 'suggested' ? ' checked' : '') + '>Partir de la suggestion pour mon profil<span class="v">' + cmTxt(b.cm) + ' cm/360</span></label></div>';
    }
    h += '<div class="hero"><div class="big">' + cmTxt(s) + '<small>cm / 360°</small></div>' +
      '<div class="facts">soit <b>' + set.text + '</b> dans ' + esc(g.name) + ' à ' + Math.round(gameDpi()) + ' DPI</div></div>';
    if (!cur || state.from === 'suggested') {
      h += '<div class="chips">' + b.parts.map((p) => '<span class="chip">' + esc(p.label) + ' ' + esc(p.value) + '</span>').join('') +
        (b.capped ? '<span class="chip">Limité par le tapis</span>' : '') + '</div>';
    }
    if (cur && cur > cap()) {
      h += '<div class="note warn">À ' + cmTxt(cur) + ' cm/360, un demi-tour demande <b>' + cmTxt(cur / 2) + ' cm</b> de souris : c\'est beaucoup pour un tapis de ' + P().pad + ' cm. Le test restera sous ' + cmTxt(cap()) + ' cm/360.</div>';
    }
    $('start').innerHTML = h + testButtons();
  }

  function renderResult() {
    const el = $('result'), n = rounds();
    el.hidden = n === 0;
    if (!n) return;
    const g = mainGame(), a = analysis(g.style);
    let h = '<h2><span class="n">4</span> Ton résultat</h2>';
    if (!a) {
      h += '<p class="sub">Il faut au moins trois sensis mesurées pour calculer un optimum. Relance un test.</p>';
    } else {
      const ns = sess().length;
      const what = isCursor()
        ? 'de souris pour traverser l\'écran'
        : 'soit <b>' + C.gameSetting(g, a.cm, gameDpi()).text + '</b> dans ' + esc(g.name) + ' à ' + Math.round(gameDpi()) + ' DPI';
      h += '<p class="sub">' + n + ' manches sur ' + ns + ' session' + (ns > 1 ? 's' : '') +
        ' · pondération « ' + C.STYLES[g.style].label.toLowerCase() + ' » de ' + esc(g.name) + '</p>' +
        '<div class="hero"><div class="big">' + cmTxt(a.cm) + '<small>' + unitBig() + '</small></div>' +
        '<div class="facts">' + what +
        (a.spread && a.kind === 'vertex' ? '<br>Fourchette : <b>' + cmTxt(a.spread[0]) + ' – ' + cmTxt(a.spread[1]) + '</b> cm' : '') + '</div></div>';
      if (a.kind === 'edge-low') h += '<div class="note warn"><b>Ton meilleur score est au bord le plus rapide de la plage testée.</b> Ton optimum est peut-être encore plus rapide : relance un test, il sera recentré sur cette valeur.</div>';
      else if (a.kind === 'edge-high') h += '<div class="note warn"><b>Ton meilleur score est au bord le plus lent de la plage testée.</b> Ton optimum est peut-être encore plus lent : relance un test, il sera recentré sur cette valeur.</div>';
      else if (a.flat) h += '<div class="note"><b>Tes scores varient très peu d\'une sensi à l\'autre.</b> Sur cette plage, l\'habitude compte plus que le réglage : choisis au confort.</div>';
      else if (a.comfort) h += '<div class="note">Zone de confort : de <b>' + cmTxt(a.comfort[0]) + '</b> à <b>' + cmTxt(a.comfort[1]) + '</b> ' + unit() + ', tes scores restent à moins de 2 % du maximum.</div>';
      h += chart(a);
    }
    const lastS = sess()[sess().length - 1];
    if (lastS && !lastS.raw) h += '<div class="note warn">Ton navigateur n\'a pas fourni le mouvement brut de la souris : l\'accélération du pointeur a pu fausser ce test. Utilise Chrome ou Edge sur PC, ou coupe « Améliorer la précision du pointeur » dans Windows.</div>';
    h += resultTable();
    h += '<div class="row"><button class="primary" data-act="test" data-kind="refine">' + (a && a.kind === 'vertex' ? 'Affiner autour de l\'optimum' : 'Relancer un test recentré') + '</button>' +
      '<button data-act="reset">Effacer mes tests</button></div>';
    el.innerHTML = h;
  }

  // Tableau des manches, regroupées par sensi (moyenne quand une sensi a été jouée plusieurs fois).
  function resultTable() {
    const by = new Map();
    for (const s of sess()) for (const r of s.rounds) {
      const k = r.cm.toFixed(2);
      if (!by.has(k)) by.set(k, []);
      by.get(k).push(r);
    }
    const avg = (list, key) => list.reduce((a, x) => a + (x[key] || 0), 0) / list.length;
    const rows = [...by.entries()].sort((a, b) => a[0] - b[0]).map(([k, list]) => {
      const bias = avg(list, 'bias');
      return '<tr><td class="num">' + cmTxt(parseFloat(k)) + '</td><td class="num">' + fr(avg(list, 'flick'), 1) + '</td><td class="num">' + Math.round(avg(list, 'acc') * 100) + ' %</td>' +
        '<td class="num">' + (bias >= 0 ? '+' : '−') + Math.round(Math.abs(bias) * 100) + ' %</td><td class="num">' + Math.round(avg(list, 'track')) + ' %</td><td class="num">' + list.length + '</td></tr>';
    }).join('');
    return '<div class="scroll"><table><thead><tr><th class="num">' + unit() + '</th><th class="num">' + (isCursor() ? 'Clics' : 'Flick') + ' (cibles/min)</th><th class="num">Précision</th><th class="num">1er geste</th><th class="num">Suivi (sur cible)</th><th class="num">Manches</th></tr></thead><tbody>' + rows + '</tbody></table></div>' +
      '<p class="sub" style="margin-top:8px">1er geste : où ton premier mouvement s\'arrête par rapport à la cible. Positif = tu dépasses la cible (sensi plutôt trop rapide), négatif = tu t\'arrêtes avant (plutôt trop lente). C\'est un indice, pas un verdict.</p>';
  }

  // Graphique : score relatif (100 = ta moyenne de la session) selon la sensi, échelle log.
  function chart(a) {
    const W = 640, H = 312, L = 44, R = 16, Tp = 26, B = 40; // Tp laisse la place à l'étiquette de l'optimum
    const x0 = Math.log(a.range[0]) - 0.07, x1 = Math.log(a.range[1]) + 0.07;
    const vals = a.points.flatMap((p) => [p.f, p.t]);
    if (a.fit) for (let i = 0; i <= 20; i++) vals.push(a.fit.at(Math.log(a.range[0]) + (Math.log(a.range[1]) - Math.log(a.range[0])) * i / 20));
    let y0 = Math.min(...vals), y1 = Math.max(...vals);
    const step = (y1 - y0) > 0.5 ? 0.2 : (y1 - y0) > 0.22 ? 0.1 : 0.05;
    y0 = Math.floor((y0 - 0.01) / step) * step; y1 = Math.ceil((y1 + 0.01) / step) * step;
    const X = (x) => L + (x - x0) / (x1 - x0) * (W - L - R), Y = (y) => Tp + (y1 - y) / (y1 - y0) * (H - Tp - B);
    let s = '<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Score relatif selon la sensi testée">';
    for (let y = y0; y <= y1 + 1e-9; y += step) {
      s += '<line x1="' + L + '" x2="' + (W - R) + '" y1="' + Y(y) + '" y2="' + Y(y) + '" stroke="#2a323e" stroke-width="1"/>' +
        '<text x="' + (L - 8) + '" y="' + (Y(y) + 4) + '" text-anchor="end" font-size="11" fill="#8793a3">' + Math.round(y * 100) + '</text>';
    }
    const cms = [...new Set(a.points.map((p) => p.cm))].sort((p, q) => p - q);
    let lastX = -99;
    for (const cm of cms) {
      const x = X(Math.log(cm));
      s += '<line x1="' + x + '" x2="' + x + '" y1="' + (H - B) + '" y2="' + (H - B + 4) + '" stroke="#3d4858"/>';
      if (x - lastX > 34) { s += '<text x="' + x + '" y="' + (H - B + 17) + '" text-anchor="middle" font-size="11" fill="#8793a3">' + cmTxt(cm) + '</text>'; lastX = x; }
    }
    s += '<text x="' + (W - R) + '" y="' + (H - 6) + '" text-anchor="end" font-size="11" fill="#8793a3">' + unitBig() + ' (plus à droite = plus lent)</text>';
    if (a.comfort && a.kind === 'vertex' && !a.flat) {
      const c0 = X(Math.log(a.comfort[0])), c1 = X(Math.log(a.comfort[1]));
      s += '<rect x="' + c0 + '" y="' + Tp + '" width="' + Math.max(2, c1 - c0) + '" height="' + (H - Tp - B) + '" fill="#edf1f6" opacity=".06"/>';
    }
    if (a.fit) {
      let d = '';
      const lo = Math.log(a.range[0]), hi = Math.log(a.range[1]);
      for (let i = 0; i <= 60; i++) { const x = lo + (hi - lo) * i / 60; d += (i ? 'L' : 'M') + X(x).toFixed(1) + ' ' + Y(a.fit.at(x)).toFixed(1); }
      s += '<path d="' + d + '" fill="none" stroke="#edf1f6" stroke-width="2" stroke-linecap="round"/>';
    }
    const ox = X(Math.log(a.cm));
    const anchor = ox > W - 110 ? 'end' : ox < L + 70 ? 'start' : 'middle';
    s += '<line x1="' + ox + '" x2="' + ox + '" y1="' + Tp + '" y2="' + (H - B) + '" stroke="#ffb224" stroke-width="1.5" stroke-dasharray="4 4"/>' +
      '<text x="' + ox + '" y="' + (Tp - 10) + '" text-anchor="' + anchor + '" font-size="12" font-weight="700" fill="#edf1f6">' + cmTxt(a.cm) + ' cm</text>';
    // Deux formes en plus des deux couleurs : rond = flick, losange = suivi.
    const tip = (p, name, v) => ' data-tip="' + esc(name + ' à ' + cmTxt(p.cm) + ' ' + unit() + ' : <b>' + Math.round(v * 100) + '</b> (100 = ta moyenne)') + '"';
    const flickName = isCursor() ? 'Clics' : 'Flick';
    for (const p of a.points) {
      const x = X(p.x), yf = Y(p.f), yt = Y(p.t);
      s += '<g' + tip(p, flickName, p.f) + '><circle cx="' + (x - 4) + '" cy="' + yf + '" r="12" fill="transparent"/><circle cx="' + (x - 4) + '" cy="' + yf + '" r="5" fill="#3987e5" stroke="#151a22" stroke-width="2"/></g>' +
        '<g' + tip(p, 'Suivi', p.t) + '><circle cx="' + (x + 4) + '" cy="' + yt + '" r="12" fill="transparent"/><rect x="' + (x + 4 - 4.5) + '" y="' + (yt - 4.5) + '" width="9" height="9" transform="rotate(45 ' + (x + 4) + ' ' + yt + ')" fill="#d95926" stroke="#151a22" stroke-width="2"/></g>';
    }
    s += '</svg>';
    return '<div class="legend"><span><i style="width:10px;height:10px;border-radius:50%;background:#3987e5"></i>' + (isCursor() ? 'Clics' : 'Flick') + '</span>' +
      '<span><i style="width:9px;height:9px;transform:rotate(45deg);background:#d95926"></i>Suivi</span>' +
      '<span><i style="width:18px;height:2px;background:#edf1f6"></i>Courbe combinée</span>' +
      '<span><i style="width:18px;border-top:2px dashed #ffb224"></i>Optimum</span></div>' +
      '<div class="viz" id="viz">' + s + '<div class="tip" hidden></div></div>';
  }

  function renderGames() {
    const mode = outMode(), tested = rounds() >= 3, g0 = mainGame(), dpi = gameDpi();
    const cmOf = (g) => mode === 'manual' ? state.out.manual : mode === 'uniform' ? refCm(g0.style) : refCm(g.style);
    const opt = (v, label, sub) => '<label><input type="radio" name="mode" value="' + v + '"' + (mode === v ? ' checked' : '') + '><span>' + label + '<span class="sm" style="display:block;font-size:13px;color:var(--muted)">' + sub + '</span></span></label>';
    let h = '<h2><span class="n">' + (tested ? 5 : 4) + '</span> Tes réglages par jeu</h2>' +
      '<p class="sub">' + (tested ? 'Calculés à partir de tes tests' : 'Calculés à partir du point de départ, en attendant ton test') + ', pour ' + Math.round(dpi) + ' DPI.</p>' +
      '<div class="choice">' +
      opt('uniform', 'Même sensi partout', 'La même distance de souris pour un tour complet dans tous les jeux : une seule mémoire musculaire.') +
      opt('style', 'Adaptée au type de jeu', tested ? 'Un optimum par famille : le flick pèse plus dans les jeux tactiques, le suivi dans les jeux de mouvement.' : 'Un peu plus lente dans les jeux tactiques, un peu plus rapide dans les jeux de suivi.') +
      opt('manual', 'Valeur de mon choix', '<span class="unit" style="display:inline-block;width:150px;margin-top:6px"><input id="manual" type="number" min="5" max="200" step="0.5" value="' + state.out.manual + '"><span>cm/360</span></span>') +
      '</div><div class="scroll"><table><thead><tr><th>Jeu</th><th class="num">Sensi à régler</th><th class="num">cm / 360°</th><th class="num">Repère pros</th></tr></thead><tbody>';
    for (const g of C.GAMES.filter((x) => x.kind !== 'cursor')) {
      const cm = cmOf(g), set = C.gameSetting(g, cm, dpi);
      h += '<tr' + (g.id === g0.id ? ' class="main"' : '') + '><td>' + esc(g.name) + '<span class="tag">' + C.STYLES[g.style].label + '</span>' +
        (g.note ? '<span class="sm">' + esc(g.note) + '</span>' : '') + '</td>' +
        '<td class="num sens">' + (g.approx ? '≈ ' : '') + set.text + '</td><td class="num">' + cmTxt(set.cm) + '</td>' +
        '<td class="num" style="color:var(--muted)">' + (g.pro ? g.pro[0] + ' – ' + g.pro[1] : '—') + '</td></tr>';
    }
    h += '</tbody></table></div>';
    const cm0 = cmOf(g0), perCount = 360 / (cm0 * dpi / 2.54), pix = C.pixelAngle(P().screenW);
    h += '<div class="note">Pour vérifier dans un jeu : glisse la souris de <b>' + cmTxt(cm0) + ' cm</b> ; tu dois avoir fait exactement un tour sur toi-même.</div>';
    if (perCount > pix) {
      const better = [800, 1600, 3200, 6400].find((d) => d > dpi && 360 / (cm0 * d / 2.54) <= pix) || 1600;
      h += '<div class="note warn"><b>Conseil DPI.</b> À ' + Math.round(dpi) + ' DPI, le plus petit mouvement de souris fait tourner la vue de plus d\'un pixel : la visée fine saute des pixels. Passe la souris à <b>' + better + ' DPI</b> et change le DPI ci-dessus : les sensis du tableau se recalculent, la distance pour 360° reste la même.</div>';
    }
    if (cm0 > cap()) h += '<div class="note warn">À ' + cmTxt(cm0) + ' cm/360, un demi-tour demande ' + cmTxt(cm0 / 2) + ' cm : ton tapis de ' + P().pad + ' cm est trop étroit pour cette sensi.</div>';
    h += '<p class="sub" style="margin-top:14px">League of Legends se règle autrement (jeu au curseur) : choisis-le comme jeu principal pour passer son test dédié.</p>';
    $('games').innerHTML = h;
  }

  // League of Legends : le curseur de vitesse du jeu n'a pas de formule publiée. On règle donc
  // par les DPI (à réglages neutres, 1 count = 1 pixel) et on contrôle à la règle.
  function renderLol() {
    const a = analysis('moba'), tested = !!a, cm = tested ? a.cm : startCm();
    const now = gameDpi(), m = measuredCross();
    // Avec une distance mesurée en jeu, on garde les réglages Windows et LoL tels quels et on
    // change les DPI en proportion. Sinon on suppose des réglages neutres (1 count = 1 pixel).
    const dpi = Math.max(100, Math.round((m ? now * m / cm : C.dpiFor(cm, P().screenW)) / 50) * 50);
    const same = Math.abs(dpi - now) / now < 0.06;
    let h = '<h2><span class="n">' + (tested ? 5 : 4) + '</span> Ton réglage pour League of Legends</h2>' +
      '<p class="sub">' + (tested ? 'Calculé à partir de tes tests' : 'Calculé à partir du point de départ, en attendant ton test') + ', pour un écran de ' + P().screenW + ' px de large.</p>' +
      '<div class="hero"><div class="big">' + (same ? Math.round(now) : '≈ ' + dpi) + '<small>DPI</small></div>' +
      '<div class="facts">' + (same ? 'Tes DPI actuels conviennent.' : 'à régler dans le logiciel de ta souris') +
      '<br>pour <b>' + cmTxt(cm) + '</b> cm de souris d\'un bord à l\'autre de l\'écran</div></div>' +
      '<div class="chips">' + (m
        ? '<span class="chip">Garde tes réglages Windows et LoL actuels</span><span class="chip">« Améliorer la précision du pointeur » décoché</span>'
        : '<span class="chip">Windows : vitesse du pointeur 6/11</span><span class="chip">« Améliorer la précision du pointeur » décoché</span><span class="chip">LoL : Vitesse de la souris ≈ 50</span>') + '</div>' +
      '<div class="note"><b>Vérifie à la règle.</b> En partie, colle le curseur au bord gauche puis glisse la souris de <b>' + cmTxt(cm) + ' cm</b> : il doit arriver juste au bord droit. S\'il s\'arrête avant, monte « Vitesse de la souris » dans les options de LoL ; s\'il arrive trop tôt, baisse-la.</div>' +
      '<div class="note">Tu ne peux pas changer tes DPI ? Garde-les et règle uniquement « Vitesse de la souris » du jeu, avec la même vérification à la règle.</div>' +
      '<p class="sub" style="margin-top:14px">Pour tes FPS (Valorant, CS2, Apex…), choisis-en un comme jeu principal : ils ont leur propre test et leur tableau de réglages.</p>';
    if (tested && a.kind !== 'vertex') h += '<div class="note warn"><b>Réglage provisoire.</b> Ton meilleur score est au bord de la plage testée : relance un test recentré avant de changer tes DPI.</div>';
    if (cm > cap() + 0.05) h += '<div class="note warn">Traverser l\'écran demande ' + cmTxt(cm) + ' cm : c\'est trop pour ton tapis de ' + P().pad + ' cm.</div>';
    $('games').innerHTML = h;
  }

  // ---------- Actions ----------

  async function onAction(e) {
    const b = e.target.closest('[data-act]');
    if (!b || b.closest('.tr')) return;
    const act = b.dataset.act;
    if (act === 'calib') {
      const r = await T.calibrate();
      if (r) { state.calib = r; update(); }
    } else if (act === 'uncalib') {
      state.calib = null; update();
    } else if (act === 'reset') {
      const k = kind();
      if (confirm('Effacer tes tests ' + (k === 'cursor' ? 'League of Legends' : 'FPS') + ' ? Tes réglages de matériel sont conservés.')) {
        state.sessions = state.sessions.filter((x) => (x.kind || 'fps') !== k); update();
      }
    } else if (act === 'test') {
      const list = planFor(b.dataset.kind);
      const k = kind();
      const res = await T.runSession({ countsPerCm: countsPerCm(), list, warmup: list[Math.floor(list.length / 2)], flat: k === 'cursor' });
      if (res && res.rounds.length >= 2) {
        state.sessions.push({ date: new Date().toISOString().slice(0, 10), raw: res.raw, kind: k, rounds: res.rounds });
        update();
        $('result').scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    }
  }

  function onChoice(e) {
    const t = e.target;
    if (t.name === 'from') { state.from = t.value; update(); }
    else if (t.name === 'mode') { state.out.mode = t.value; update(); }
    else if (t.id === 'manual') {
      const v = parseFloat(t.value);
      if (v >= 5 && v <= 200) { state.out.manual = v; state.out.mode = 'manual'; update(); }
    }
  }

  // Infobulle du graphique.
  document.addEventListener('mousemove', (e) => {
    const viz = $('viz');
    if (!viz) return;
    const tip = viz.querySelector('.tip'), g = e.target.closest ? e.target.closest('[data-tip]') : null;
    if (!g || !viz.contains(g)) { tip.hidden = true; return; }
    const r = viz.getBoundingClientRect();
    tip.innerHTML = g.dataset.tip;
    tip.hidden = false;
    const half = tip.offsetWidth / 2;
    tip.style.left = C.clamp(e.clientX - r.left, half, Math.max(half, r.width - half)) + 'px';
    tip.style.top = (e.clientY - r.top) + 'px';
  });

  initForm();
  render();
})();
