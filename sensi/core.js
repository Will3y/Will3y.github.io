// Calculs purs de Sensi : conversions, point de départ, analyse des tests.
// Aucun accès au DOM ici, pour pouvoir vérifier les formules à part (node).
(function (root) {
  'use strict';

  // yaw = degrés tournés par « count » de souris quand la sensi du jeu vaut 1.
  // dec = nombre de décimales que le jeu accepte. approx = valeur relevée par la
  // communauté, moins sûre : à contrôler en jeu avec la règle (voir README).
  // pro = fourchette habituelle des joueurs pros en cm/360 (ordre de grandeur).
  const GAMES = [
    { id: 'cs2', name: 'Counter-Strike 2 / CS:GO', yaw: 0.022, dec: 2, style: 'tactical', pro: [35, 65] },
    { id: 'valorant', name: 'Valorant', yaw: 0.07, dec: 3, style: 'tactical', pro: [33, 62] },
    { id: 'r6', name: 'Rainbow Six Siege', yaw: 0.00572957795, dec: 0, style: 'tactical', note: 'Sensi entière : pour affiner, modifie MouseSensitivityMultiplierUnit dans GameSettings.ini.' },
    { id: 'tarkov', name: 'Escape from Tarkov', yaw: 0.125, dec: 2, style: 'tactical', approx: true },
    { id: 'apex', name: 'Apex Legends', yaw: 0.022, dec: 2, style: 'tracking', pro: [26, 50] },
    { id: 'ow2', name: 'Overwatch 2', yaw: 0.0066, dec: 2, style: 'tracking', pro: [25, 45] },
    { id: 'rivals', name: 'Marvel Rivals', yaw: 0.0175, dec: 2, style: 'tracking', pro: [25, 45] },
    { id: 'deadlock', name: 'Deadlock', yaw: 0.044, dec: 2, style: 'tracking' },
    { id: 'source', name: 'TF2, Titanfall 2, Quake, jeux Source', yaw: 0.022, dec: 2, style: 'tracking' },
    { id: 'fortnite', name: 'Fortnite', yaw: 0.005555, dec: 1, style: 'mixed', unit: '%', pro: [20, 40] },
    { id: 'cod', name: 'Call of Duty (Warzone, MW, Black Ops)', yaw: 0.0066, dec: 2, style: 'mixed', pro: [25, 43] },
    { id: 'destiny2', name: 'Destiny 2', yaw: 0.0066, dec: 0, style: 'mixed' },
    { id: 'finals', name: 'The Finals', yaw: 0.000789, dec: 0, style: 'mixed', approx: true },
    { id: 'rust', name: 'Rust', yaw: 0.1125, dec: 2, style: 'mixed', approx: true },
    // Jeu au curseur : pas de caméra à tourner, donc pas de cm/360. La sensi se compte en
    // cm de souris pour traverser l'écran, et se règle surtout par les DPI.
    { id: 'lol', name: 'League of Legends', kind: 'cursor', style: 'moba' },
  ];

  // flick = part du « flick » (viser-cliquer) dans la note, le reste étant le suivi.
  // mod = les jeux tactiques se jouent en général un peu plus lent, les jeux de suivi plus vite.
  const STYLES = {
    tactical: { label: 'Tactique', flick: 0.8, mod: 1.15 },
    mixed: { label: 'Mixte', flick: 0.55, mod: 1 },
    tracking: { label: 'Suivi', flick: 0.3, mod: 0.9 },
    moba: { label: 'Curseur', flick: 0.75, mod: 1 },
  };

  const AIM = {
    wrist: { label: 'Poignet', cm: 26 },
    hybrid: { label: 'Poignet + bras', cm: 36 },
    arm: { label: 'Bras', cm: 48 },
  };
  const GRIP = {
    fingertip: { label: 'Bout des doigts', mod: 0.92 },
    claw: { label: 'Griffe (claw)', mod: 1 },
    palm: { label: 'Paume (palm)', mod: 1.06 },
  };

  const CM_MIN = 12, CM_MAX = 90;
  // Bornes de la sensi selon le genre : cm/360 pour un FPS, cm pour traverser l'écran pour un jeu au curseur.
  const LIMITS = { fps: { min: CM_MIN, max: CM_MAX }, cursor: { min: 1.5, max: 30 } };
  const K = 360 * 2.54; // 914,4

  const game = (id) => GAMES.find((g) => g.id === id) || GAMES[0];
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

  function cm360(yaw, sens, dpi) { return K / (yaw * sens * dpi); }
  function sensFor(yaw, cm, dpi) { return K / (yaw * cm * dpi); }

  // Sensi arrondie comme le jeu l'accepte, et le cm/360 réellement obtenu après arrondi.
  function gameSetting(g, cm, dpi) {
    const exact = sensFor(g.yaw, cm, dpi);
    const p = Math.pow(10, g.dec);
    const sens = Math.max(1 / p, Math.round(exact * p) / p);
    return { sens, text: sens.toFixed(g.dec) + (g.unit || ''), cm: cm360(g.yaw, sens, dpi) };
  }

  // Un demi-tour (180°) doit tenir dans ~70 % de la largeur du tapis.
  function padCap(padCm) { return padCm > 0 ? 1.4 * padCm : CM_MAX; }

  // Jeux au curseur. Avec Windows sur 6/11, l'accélération coupée et la vitesse du jeu au
  // milieu, un « count » de souris déplace le curseur d'un pixel : traverser l'écran demande
  // largeur × 2,54 / DPI centimètres. Traverser l'écran doit tenir dans ~80 % du tapis.
  function screenCm(dpi, screenW) { return screenW * 2.54 / dpi; }
  function dpiFor(cm, screenW) { return screenW * 2.54 / cm; }
  function cursorCap(padCm) { return padCm > 0 ? 0.8 * padCm : LIMITS.cursor.max; }

  // Point de départ « à la morphologie » : sert de centre au test quand on n'a pas déjà une sensi.
  function baseline(p) {
    const aim = AIM[p.aim] || AIM.hybrid, grip = GRIP[p.grip] || GRIP.claw;
    const style = STYLES[game(p.game).style];
    const raw = aim.cm * grip.mod * style.mod;
    const cap = padCap(p.pad);
    const cm = clamp(raw, CM_MIN, Math.min(cap, CM_MAX));
    return {
      cm, cap, capped: raw > cap,
      parts: [
        { label: 'Visée : ' + aim.label.toLowerCase(), value: aim.cm + ' cm' },
        { label: 'Prise : ' + grip.label.toLowerCase(), value: '× ' + grip.mod },
        { label: 'Jeu ' + style.label.toLowerCase(), value: '× ' + style.mod },
      ],
    };
  }

  // Sensis à tester autour d'un centre, écartées régulièrement en échelle logarithmique.
  // Si le haut de la plage dépasse ce que le tapis permet, on décale toute la plage vers le bas.
  function testPlan(center, kind, cap, lim) {
    lim = lim || LIMITS.fps;
    const mults = {
      quick: [0.65, 1, 1.55],
      standard: [0.6, 0.78, 1, 1.28, 1.65],
      refine: [0.8, 0.9, 1, 1.12, 1.25],
    }[kind] || [0.6, 0.78, 1, 1.28, 1.65];
    const top = Math.min(cap || lim.max, lim.max);
    let c = clamp(center, lim.min, top);
    const hi = mults[mults.length - 1];
    if (c * hi > top) c = top / hi;
    if (c * mults[0] < lim.min) c = lim.min / mults[0];
    return mults.map((m) => (c * m >= 10 ? Math.round(c * m * 10) / 10 : Math.round(c * m * 100) / 100));
  }

  // Moindres carrés pour y = a + b·x + c·x² (x recentré pour la stabilité numérique).
  function quadFit(pts) {
    const n = pts.length;
    const mx = pts.reduce((s, p) => s + p.x, 0) / n;
    let s1 = 0, s2 = 0, s3 = 0, s4 = 0, t0 = 0, t1 = 0, t2 = 0;
    for (const p of pts) {
      const x = p.x - mx, x2 = x * x;
      s1 += x; s2 += x2; s3 += x2 * x; s4 += x2 * x2;
      t0 += p.y; t1 += p.y * x; t2 += p.y * x2;
    }
    const det = (m) =>
      m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) -
      m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) +
      m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);
    const M = [[n, s1, s2], [s1, s2, s3], [s2, s3, s4]];
    const D = det(M);
    if (!isFinite(D) || Math.abs(D) < 1e-12) return null;
    const col = (i) => M.map((r, k) => r.map((v, j) => (j === i ? [t0, t1, t2][k] : v)));
    const a = det(col(0)) / D, b = det(col(1)) / D, c = det(col(2)) / D;
    return { a, b, c, mx, at: (x) => a + b * (x - mx) + c * (x - mx) * (x - mx) };
  }

  // Où est le sommet de la courbe ? S'il tombe hors de la plage testée (ou si la courbe
  // n'a pas de sommet), on ne l'invente pas : on renvoie le meilleur bord, à explorer ensuite.
  function optimumOf(pts) {
    const xs = pts.map((p) => p.x);
    const lo = Math.min(...xs), hi = Math.max(...xs);
    const distinct = new Set(xs.map((x) => x.toFixed(3))).size;
    const best = pts.reduce((m, p) => (p.y > m.y ? p : m), pts[0]);
    if (distinct < 3) return { x: best.x, kind: 'best', fit: null, lo, hi };
    const fit = quadFit(pts);
    if (!fit) return { x: best.x, kind: 'best', fit: null, lo, hi };
    if (fit.c < 0) {
      const v = fit.mx - fit.b / (2 * fit.c);
      if (v >= lo && v <= hi) return { x: v, kind: 'vertex', fit, lo, hi };
    }
    return fit.at(lo) >= fit.at(hi) ? { x: lo, kind: 'edge-low', fit, lo, hi } : { x: hi, kind: 'edge-high', fit, lo, hi };
  }

  // sessions = [{ rounds: [{ cm, flick, track }] }]. Les notes sont rapportées à la moyenne
  // de leur session (1 = ta moyenne du jour) : on peut ainsi cumuler des sessions faites
  // des jours différents, en forme ou non. wFlick = poids du flick (0 à 1).
  function analyse(sessions, wFlick) {
    const pts = [];
    for (const s of sessions || []) {
      const r = (s.rounds || []).filter((x) => x.cm > 0 && x.flick > 0 && x.track >= 0);
      if (r.length < 2) continue;
      const mf = r.reduce((a, x) => a + x.flick, 0) / r.length;
      const mt = r.reduce((a, x) => a + x.track, 0) / r.length;
      for (const x of r) {
        const f = x.flick / mf, t = mt > 0 ? x.track / mt : 1;
        pts.push({ cm: x.cm, x: Math.log(x.cm), f, t, y: wFlick * f + (1 - wFlick) * t });
      }
    }
    if (pts.length < 3) return null;
    const opt = optimumOf(pts);
    const res = { points: pts, kind: opt.kind, cm: Math.exp(opt.x), fit: opt.fit, range: [Math.exp(opt.lo), Math.exp(opt.hi)] };

    // Fourchette : on refait le calcul en retirant chaque manche à tour de rôle.
    if (pts.length >= 5) {
      const alt = pts.map((_, i) => Math.exp(optimumOf(pts.filter((__, j) => j !== i)).x));
      res.spread = [Math.min(res.cm, ...alt), Math.max(res.cm, ...alt)];
    }
    // Zone de confort : là où la courbe reste à moins de 2 % de son maximum.
    if (opt.fit) {
      const N = 80, ys = [];
      for (let i = 0; i <= N; i++) ys.push(opt.fit.at(opt.lo + (opt.hi - opt.lo) * i / N));
      const top = Math.max(...ys), bottom = Math.min(...ys);
      const ok = ys.map((y) => y >= top - 0.02);
      const x = (i) => Math.exp(opt.lo + (opt.hi - opt.lo) * i / N);
      res.comfort = [x(ok.indexOf(true)), x(ok.lastIndexOf(true))];
      res.flat = top - bottom < 0.03;
    }
    return res;
  }

  // Angle couvert par un pixel au centre de l'écran (champ horizontal ~103°). Si un seul
  // « count » de souris tourne plus que ça, la visée saute des pixels : il faut monter les DPI.
  function pixelAngle(screenW) { return Math.atan(Math.tan(51.5 * Math.PI / 180) / (screenW / 2)) * 180 / Math.PI; }

  const api = { GAMES, STYLES, AIM, GRIP, CM_MIN, CM_MAX, LIMITS, game, clamp, cm360, sensFor, gameSetting, padCap, screenCm, dpiFor, cursorCap, baseline, testPlan, quadFit, analyse, pixelAngle };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.SensiCore = api;
})(typeof window !== 'undefined' ? window : globalThis);
