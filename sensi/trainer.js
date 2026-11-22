// Le test de visée : une petite salle 3D dessinée sur un canvas, la souris capturée
// (pointer lock) pour tourner la caméra exactement comme dans un FPS.
// Deux épreuves par sensi : « flick » (viser une cible et cliquer) et « suivi »
// (garder le viseur sur une cible qui bouge). Sert aussi à mesurer les DPI réels.
// Pour les jeux au curseur (League of Legends), le même test se joue « à plat » :
// un curseur sur un écran 2D, et la sensi se compte en cm pour traverser l'écran.
(function () {
  'use strict';

  const DEG = Math.PI / 180;
  const VFOV = 2 * Math.atan(Math.tan(51.5 * DEG) * 9 / 16); // ≈ 103° horizontal en 16:9
  const DIST = 10;                 // distance des cibles (m)
  const TIMEOUT = 5;               // une cible non touchée compte pour 5 s
  const MISS_COST = 0.3;           // chaque tir raté coûte 0,3 s
  const UNLOCK = { unlock: true }; // levé quand la souris est libérée en pleine manche (Échap)

  let el, canvas, ctx, hud, msg, box;
  let yaw = 0, pitch = 0;          // direction du regard, en degrés (à plat : position du curseur)
  let flat = false, hh = 28;       // à plat : unités = % de la largeur, centre en (0,0), hh = demi-hauteur
  let degPerCount = 0.05, countsPerCm = 315;
  let rawMode = false;             // true = mouvement brut, sans accélération du système
  let phase = null;                // épreuve en cours : { move, down, up, frame, abort }
  let target = null;               // { yaw, pitch, r (rayon en degrés), on }
  let scene = true, raf = 0, last = 0, fx = null, ac = null;

  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const isLocked = () => document.pointerLockElement === el;

  // Générateur pseudo-aléatoire à graine : chaque sensi reçoit exactement les mêmes cibles.
  function rngFrom(seed) {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // ---------- Mise en place ----------

  function build() {
    if (el) return;
    el = document.createElement('div');
    el.className = 'tr';
    el.hidden = true;
    el.innerHTML = '<canvas></canvas><div class="tr-hud"></div><div class="tr-msg"><div class="tr-box"></div></div>';
    document.body.appendChild(el);
    canvas = el.querySelector('canvas');
    ctx = canvas.getContext('2d');
    hud = el.querySelector('.tr-hud');
    msg = el.querySelector('.tr-msg');
    box = el.querySelector('.tr-box');

    document.addEventListener('mousemove', (e) => {
      if (!isLocked() || !phase) return;
      if (phase.look) {
        yaw += e.movementX * degPerCount;
        pitch -= e.movementY * degPerCount;
        if (flat) { yaw = clamp(yaw, -50, 50); pitch = clamp(pitch, -hh, hh); }
        else pitch = clamp(pitch, -89, 89);
      }
      if (phase.move) phase.move(e.movementX, e.movementY);
    });
    document.addEventListener('mousedown', (e) => {
      if (e.button === 0 && isLocked() && phase && phase.down) { e.preventDefault(); phase.down(performance.now()); }
    });
    document.addEventListener('mouseup', (e) => {
      if (e.button === 0 && isLocked() && phase && phase.up) phase.up();
    });
    document.addEventListener('pointerlockchange', () => {
      if (!isLocked() && phase && phase.abort) { const p = phase; phase = null; p.abort(); }
    });
    window.addEventListener('resize', resize);
  }

  function resize() {
    if (!el || el.hidden) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(el.clientWidth * dpr);
    canvas.height = Math.round(el.clientHeight * dpr);
    hh = 50 * el.clientHeight / Math.max(1, el.clientWidth);
  }

  function open(withScene) {
    build();
    scene = withScene;
    el.hidden = false;
    document.documentElement.classList.add('tr-open');
    resize();
    hud.textContent = '';
    last = performance.now();
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(loop);
  }

  function close() {
    phase = null; target = null;
    cancelAnimationFrame(raf);
    if (isLocked()) document.exitPointerLock();
    el.hidden = true;
    document.documentElement.classList.remove('tr-open');
  }

  function say(html) { box.innerHTML = html; msg.hidden = false; }
  function hush() { msg.hidden = true; }

  // Capture la souris. On demande d'abord le mouvement brut (sans accélération du système) ;
  // si le navigateur ne sait pas faire, on capture normalement et on le signale dans le résultat.
  async function lock() {
    if (isLocked()) return true;
    const settle = () => new Promise((res) => {
      if (isLocked()) return res(true);
      const done = () => { document.removeEventListener('pointerlockchange', done); clearTimeout(t); res(isLocked()); };
      const t = setTimeout(done, 1200);
      document.addEventListener('pointerlockchange', done);
    });
    try {
      const p = el.requestPointerLock({ unadjustedMovement: true });
      if (p && p.then) { await p; rawMode = true; } else rawMode = false;
    } catch (e) {
      rawMode = false;
      if (!e || e.name !== 'NotSupportedError') return false;
      try { const p = el.requestPointerLock(); if (p && p.then) await p; } catch (e2) { return false; }
    }
    return settle();
  }

  // Un panneau avec de vrais boutons (souris libre). Résout avec la valeur data-act du bouton cliqué.
  // Le bouton data-lock capture la souris avant de résoudre.
  function menu(html) {
    return new Promise((resolve) => {
      say(html);
      const onClick = async (e) => {
        const b = e.target.closest('button[data-act]');
        if (!b) return;
        if (b.hasAttribute('data-lock') && !(await lock())) {
          const w = box.querySelector('.tr-warn');
          if (w) w.textContent = 'La souris n\'a pas pu être capturée. Attends une seconde et reclique.';
          return;
        }
        box.removeEventListener('click', onClick);
        resolve(b.dataset.act);
      };
      box.addEventListener('click', onClick);
    });
  }

  // Message affiché souris capturée : on continue au prochain clic.
  function clickToGo(html) {
    return new Promise((resolve, reject) => {
      say(html);
      phase = { look: false, down: () => { phase = null; hush(); resolve(); }, abort: () => reject(UNLOCK) };
    });
  }

  // Message minuté (souris capturée, on peut déjà bouger pour se placer).
  function timed(html, ms) {
    return new Promise((resolve, reject) => {
      say(html);
      const t = setTimeout(() => { phase = null; hush(); resolve(); }, ms);
      phase = { look: true, abort: () => { clearTimeout(t); reject(UNLOCK); } };
    });
  }

  // ---------- Géométrie ----------

  function dir(y, p) { return [Math.sin(y * DEG) * Math.cos(p * DEG), Math.sin(p * DEG), Math.cos(y * DEG) * Math.cos(p * DEG)]; }

  // Angle (degrés) entre le regard et la cible.
  function angleTo(t) {
    if (flat) return Math.hypot(t.yaw - yaw, t.pitch - pitch);
    const a = dir(yaw, pitch), b = dir(t.yaw, t.pitch);
    return Math.acos(clamp(a[0] * b[0] + a[1] * b[1] + a[2] * b[2], -1, 1)) / DEG;
  }

  // Lignes de la salle : sol et plafond d'un côté, murs de l'autre.
  const ROOM = (() => {
    const X = 14, Y0 = -2.5, Y1 = 5.5, step = 2, floor = [], walls = [];
    for (let v = -X; v <= X; v += step) {
      floor.push([v, Y0, -X, v, Y0, X], [-X, Y0, v, X, Y0, v], [v, Y1, -X, v, Y1, X], [-X, Y1, v, X, Y1, v]);
      walls.push([v, Y0, -X, v, Y1, -X], [v, Y0, X, v, Y1, X], [-X, Y0, v, -X, Y1, v], [X, Y0, v, X, Y1, v]);
    }
    for (let y = Y0 + step; y < Y1; y += step) {
      walls.push([-X, y, -X, X, y, -X], [-X, y, X, X, y, X], [-X, y, -X, -X, y, X], [X, y, -X, X, y, X]);
    }
    return { floor, walls };
  })();

  // ---------- Dessin ----------

  function loop(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    if (phase && phase.frame && isLocked()) phase.frame(now, dt);
    draw(now);
    if (!el.hidden) raf = requestAnimationFrame(loop);
  }

  function draw(now) {
    const W = canvas.width, H = canvas.height, cx = W / 2, cy = H / 2;
    const px = W / Math.max(1, el.clientWidth);
    ctx.fillStyle = '#0b0e13';
    ctx.fillRect(0, 0, W, H);
    if (!scene) return;
    if (flat) return drawFlat(now, W, H, px);

    const f = cy / Math.tan(VFOV / 2);
    const sy = Math.sin(yaw * DEG), cyw = Math.cos(yaw * DEG), sp = Math.sin(pitch * DEG), cp = Math.cos(pitch * DEG);
    const cam = (x, y, z) => {
      const x1 = x * cyw - z * sy, z1 = x * sy + z * cyw;
      return [x1, y * cp - z1 * sp, y * sp + z1 * cp];
    };
    const NEAR = 0.05;
    const lines = (segs, color) => {
      ctx.beginPath();
      for (const s of segs) {
        let a = cam(s[0], s[1], s[2]), b = cam(s[3], s[4], s[5]);
        if (a[2] < NEAR && b[2] < NEAR) continue;
        if (a[2] < NEAR || b[2] < NEAR) { // on coupe le segment au ras de la caméra
          const k = (NEAR - a[2]) / (b[2] - a[2]);
          const c = [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, NEAR];
          if (a[2] < NEAR) a = c; else b = c;
        }
        ctx.moveTo(cx + f * a[0] / a[2], cy - f * a[1] / a[2]);
        ctx.lineTo(cx + f * b[0] / b[2], cy - f * b[1] / b[2]);
      }
      ctx.strokeStyle = color;
      ctx.lineWidth = px;
      ctx.stroke();
    };
    lines(ROOM.floor, 'rgba(108,128,160,.42)');
    lines(ROOM.walls, 'rgba(108,128,160,.24)');

    if (target) {
      const d = dir(target.yaw, target.pitch);
      const c = cam(d[0] * DIST, d[1] * DIST, d[2] * DIST);
      const x = cx + f * c[0] / c[2], y = cy - f * c[1] / c[2];
      const visible = c[2] > NEAR && Math.abs(x - cx) < cx && Math.abs(y - cy) < cy;
      if (c[2] > NEAR) {
        const r = f * DIST * Math.tan(target.r * DEG) / c[2];
        const g = ctx.createRadialGradient(x - r * 0.3, y - r * 0.35, r * 0.1, x, y, r);
        if (target.on) { g.addColorStop(0, '#c9ffd9'); g.addColorStop(1, '#2fbf6b'); }
        else { g.addColorStop(0, '#ffe2a6'); g.addColorStop(1, '#f08a1c'); }
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.fill();
      }
      if (!visible) { // cible hors champ : un chevron indique de quel côté tourner
        const side = c[0] >= 0 ? 1 : -1, ax = cx + side * (cx - 46 * px), s = 16 * px;
        ctx.strokeStyle = '#f08a1c'; ctx.lineWidth = 5 * px; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
        ctx.beginPath(); ctx.moveTo(ax - side * s, cy - s * 1.2); ctx.lineTo(ax, cy); ctx.lineTo(ax - side * s, cy + s * 1.2); ctx.stroke();
      }
    }

    // Viseur, brièvement teinté après un tir (vert = touché, rouge = raté).
    const flash = fx && now - fx.t < 110 ? fx.color : '#ffffff';
    const L = 7 * px, G = 3 * px;
    for (const [w, color] of [[4 * px, 'rgba(0,0,0,.65)'], [2 * px, flash]]) {
      ctx.strokeStyle = color; ctx.lineWidth = w; ctx.lineCap = 'butt';
      ctx.beginPath();
      ctx.moveTo(cx - G - L, cy); ctx.lineTo(cx - G, cy); ctx.moveTo(cx + G, cy); ctx.lineTo(cx + G + L, cy);
      ctx.moveTo(cx, cy - G - L); ctx.lineTo(cx, cy - G); ctx.moveTo(cx, cy + G); ctx.lineTo(cx, cy + G + L);
      ctx.stroke();
    }
  }

  // Vue à plat : un quadrillage fixe, la cible, et un curseur dessiné par nos soins
  // (le vrai est capturé), pour maîtriser exactement sa vitesse.
  function drawFlat(now, W, H, px) {
    const u = W / 100, cx = W / 2, cy = H / 2;
    ctx.beginPath();
    for (let x = -50; x <= 50; x += 5) { ctx.moveTo(cx + x * u, 0); ctx.lineTo(cx + x * u, H); }
    for (let y = 0; y <= hh; y += 5) { ctx.moveTo(0, cy + y * u); ctx.lineTo(W, cy + y * u); ctx.moveTo(0, cy - y * u); ctx.lineTo(W, cy - y * u); }
    ctx.strokeStyle = 'rgba(108,128,160,.16)'; ctx.lineWidth = px; ctx.stroke();

    if (target) {
      const x = cx + target.yaw * u, y = cy - target.pitch * u, r = target.r * u;
      const g = ctx.createRadialGradient(x - r * 0.3, y - r * 0.35, r * 0.1, x, y, r);
      if (target.on) { g.addColorStop(0, '#c9ffd9'); g.addColorStop(1, '#2fbf6b'); }
      else { g.addColorStop(0, '#ffe2a6'); g.addColorStop(1, '#f08a1c'); }
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.fill();
    }

    const x = cx + yaw * u, y = cy - pitch * u, k = 1.15 * px;
    if (fx && now - fx.t < 140) {
      ctx.strokeStyle = fx.color; ctx.lineWidth = 2 * px;
      ctx.beginPath(); ctx.arc(x, y, (6 + Math.max(0, now - fx.t) / 9) * px, 0, 7); ctx.stroke();
    }
    ctx.beginPath(); // flèche classique, la pointe sur la position exacte
    ctx.moveTo(x, y); ctx.lineTo(x, y + 17 * k); ctx.lineTo(x + 4.2 * k, y + 13 * k); ctx.lineTo(x + 7.2 * k, y + 19.5 * k);
    ctx.lineTo(x + 9.8 * k, y + 18.3 * k); ctx.lineTo(x + 6.9 * k, y + 12 * k); ctx.lineTo(x + 12 * k, y + 12 * k); ctx.closePath();
    ctx.fillStyle = '#ffffff'; ctx.fill();
    ctx.strokeStyle = '#0b0e13'; ctx.lineWidth = 1.5 * px; ctx.lineJoin = 'round'; ctx.stroke();
  }

  function tick(freq) {
    try {
      ac = ac || new (window.AudioContext || window.webkitAudioContext)();
      const o = ac.createOscillator(), g = ac.createGain(), t = ac.currentTime;
      o.frequency.value = freq;
      g.gain.setValueAtTime(0.05, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.07);
      o.connect(g); g.connect(ac.destination);
      o.start(t); o.stop(t + 0.08);
    } catch (e) { /* pas de son : tant pis */ }
  }

  // cm = distance de souris pour un tour complet (3D) ou pour traverser l'écran (à plat).
  function setSens(cm) { degPerCount = (flat ? 100 : 360) / (cm * countsPerCm); }

  // ---------- Épreuve 1 : flick ----------
  // Une cible à la fois, placée par rapport au viseur. 1 sur 5 demande un grand
  // mouvement (cible hors champ), le reste des écarts de 6° à 40°.
  // Les `adapt` premières cibles servent à s'habituer à la sensi et ne comptent pas.
  function flickRound(o) {
    return new Promise((resolve, reject) => {
      setSens(o.cm);
      const rng = rngFrom(o.seed);
      const total = o.adapt + o.n, stats = [];
      let cur = null, idx = 0;

      const along = () => {
        const x = (yaw - cur.y0) * cur.cosp, y = pitch - cur.p0;
        return { x, y, s: x * cur.ux + y * cur.uy };
      };
      const spawn = (now) => {
        let r;
        if (flat) { // n'importe où sur l'écran, à 8–48 % de largeur du curseur
          let tx, ty, tries = 0;
          do {
            const D = 8 + rng() * 40, a = rng() * 2 * Math.PI;
            tx = yaw + D * Math.cos(a); ty = pitch + D * Math.sin(a);
          } while ((Math.abs(tx) > 46 || Math.abs(ty) > hh - 4) && ++tries < 40);
          r = rng() < 0.3 ? 1.2 : 2;
          target = { yaw: clamp(tx, -46, 46), pitch: clamp(ty, 4 - hh, hh - 4), r, on: false };
        } else {
          const big = rng() < 0.2;
          const D = big ? 70 + rng() * 60 : 6 + rng() * 34;
          const phi = (rng() * 50 - 25) * DEG, side = rng() < 0.5 ? -1 : 1;
          r = rng() < 0.3 ? 1.1 : 1.7;
          target = { yaw: yaw + side * D * Math.cos(phi), pitch: clamp(pitch + D * Math.sin(phi), -18, 18), r, on: false };
        }
        const cosp = flat ? 1 : Math.cos(target.pitch * DEG);
        const dx = (target.yaw - yaw) * cosp, dy = target.pitch - pitch, len = Math.hypot(dx, dy) || 1;
        cur = { t0: now, miss: 0, y0: yaw, p0: pitch, cosp, ux: dx / len, uy: dy / len, D: len, r, lx: 0, ly: 0, v: 0, peak: 0, maxS: 0, stop: null };
        hud.textContent = o.label + (flat ? ' · Clics ' : ' · Flick ') + (idx < o.adapt ? '(adaptation)' : (idx - o.adapt + 1) + '/' + o.n);
      };
      const end = (now, hit) => {
        const s = along().s;
        stats.push({
          t: hit ? (now - cur.t0) / 1000 : TIMEOUT, miss: cur.miss, hit,
          over: cur.maxS - cur.D > cur.r + 0.25,
          bias: ((cur.stop == null ? s : cur.stop) - cur.D) / cur.D,
        });
        idx++;
        if (idx < total) return spawn(now);
        phase = null; target = null;
        const c = stats.slice(o.adapt);
        const mean = (fn) => c.reduce((a, x) => a + fn(x), 0) / c.length;
        const hits = c.filter((x) => x.hit).length, shots = hits + c.reduce((a, x) => a + x.miss, 0);
        resolve({
          score: 60 / mean((x) => x.t + MISS_COST * x.miss), // cibles par minute, tirs ratés pénalisés
          time: mean((x) => x.t),
          acc: shots ? hits / shots : 0,
          over: mean((x) => (x.over ? 1 : 0)),
          bias: mean((x) => x.bias),
        });
      };

      phase = {
        look: true,
        // Premier arrêt du geste : en deçà de la cible (trop court) ou au-delà (dépassement) ?
        frame(now, dt) {
          if (!cur) return;
          const p = along();
          cur.maxS = Math.max(cur.maxS, p.s);
          const v = dt > 0 ? Math.hypot(p.x - cur.lx, p.y - cur.ly) / dt : 0;
          cur.lx = p.x; cur.ly = p.y;
          cur.v = cur.v * 0.5 + v * 0.5;
          cur.peak = Math.max(cur.peak, cur.v);
          if (cur.stop == null && cur.peak > 60 && p.s > 0.3 * cur.D && cur.v < Math.max(0.2 * cur.peak, 25)) cur.stop = p.s;
          if (now - cur.t0 > TIMEOUT * 1000) end(now, false);
        },
        down(now) {
          if (!cur) return;
          if (angleTo(target) <= target.r) { fx = { t: now, color: '#4be08a' }; tick(880); end(now, true); }
          else { cur.miss++; fx = { t: now, color: '#ff5d5d' }; tick(220); }
        },
        abort: () => { target = null; reject(UNLOCK); },
      };
      spawn(performance.now());
    });
  }

  // ---------- Épreuve 2 : suivi ----------
  // La cible se déplace latéralement en changeant de sens et de vitesse, comme un
  // adversaire qui « strafe ». Note = % du temps passé avec le viseur sur la cible.
  function trackRound(o) {
    return new Promise((resolve, reject) => {
      setSens(o.cm);
      const rng = rngFrom(o.seed);
      const y0 = yaw;
      let vy = 0, vp = 0, gvy = 0, gvp = 0;
      // 3D : déplacement surtout latéral. À plat : dans toutes les directions, plus lentement.
      const turn = () => {
        if (flat) {
          const v = 8 + rng() * 14, a = rng() * 2 * Math.PI;
          gvy = v * Math.cos(a); gvp = v * Math.sin(a);
        } else {
          gvy = (rng() < 0.7 ? -1 : 1) * Math.sign(gvy || (rng() < 0.5 ? -1 : 1)) * (18 + rng() * 30);
          gvp = (rng() * 2 - 1) * 7;
        }
      };
      turn();
      let t = 0, next = 0.5 + rng() * 1.1, on = 0, tot = 0, err = 0;
      target = flat
        ? { yaw: clamp(yaw, -40, 40), pitch: clamp(pitch, 8 - hh, hh - 8), r: 2.5, on: false }
        : { yaw, pitch: clamp(pitch, -8, 8), r: 2, on: false };
      const bx = flat ? 42 : 60, by = flat ? hh - 6 : 12, ox = flat ? 0 : y0;

      phase = {
        look: true,
        frame(now, dt) {
          t += dt;
          if (t >= next) { turn(); next = t + 0.5 + rng() * 1.1; }
          if (target.yaw - ox > bx) gvy = -Math.abs(gvy);
          if (target.yaw - ox < -bx) gvy = Math.abs(gvy);
          if (target.pitch > by) gvp = -Math.abs(gvp);
          if (target.pitch < -by) gvp = Math.abs(gvp);
          const k = Math.min(1, dt / 0.1);
          vy += (gvy - vy) * k; vp += (gvp - vp) * k;
          target.yaw += vy * dt; target.pitch += vp * dt;

          const a = angleTo(target);
          target.on = a <= target.r;
          const left = o.adaptMs / 1000 + o.ms / 1000 - t;
          hud.textContent = o.label + ' · Suivi ' + (t < o.adaptMs / 1000 ? '(adaptation)' : Math.max(0, Math.ceil(left)) + ' s');
          if (t >= o.adaptMs / 1000) { tot += dt; err += a * dt; if (target.on) on += dt; }
          if (left <= 0) {
            phase = null; target = null;
            resolve({ score: tot ? 100 * on / tot : 0, err: tot ? err / tot : 0 });
          }
        },
        abort: () => { target = null; reject(UNLOCK); },
      };
    });
  }

  // ---------- Session complète ----------
  // cfg = { countsPerCm, list: [sensis à tester], warmup: sensi de l'échauffement, flat }
  // Les sensis sont en cm/360, ou en cm pour traverser l'écran si flat (jeux au curseur).
  // Les sensis passent dans un ordre tiré au sort et sont désignées par une lettre :
  // on ne sait pas laquelle on joue, pour ne pas s'influencer.
  async function runSession(cfg) {
    flat = !!cfg.flat;
    open(true);
    countsPerCm = cfg.countsPerCm;
    yaw = 0; pitch = 0;
    setSens(cfg.warmup);
    const order = cfg.list.map((cm) => ({ cm, k: Math.random() })).sort((a, b) => a.k - b.k).map((x) => x.cm);
    const steps = [{ warm: true, cm: cfg.warmup }].concat(order.map((cm, i) => ({ cm, label: 'Sensi ' + 'ABCDEFGH'[i] })));
    const seed = (Math.random() * 1e9) | 0;
    const rounds = [];
    let aborted = false;

    const first = await menu(
      '<h2>Test de visée</h2>' +
      '<p>Pour chaque sensi, deux épreuves :</p>' +
      (flat
        ? '<ul><li><b>Clics</b> — clique sur la cible orange, vite et sans rater.</li>' +
          '<li><b>Suivi</b> — garde le curseur sur la cible qui bouge (pas besoin de cliquer).</li></ul>' +
          '<p>Mets d\'abord le navigateur en plein écran (<kbd>F11</kbd>) : la vitesse du curseur se cale sur la largeur de la fenêtre.</p>'
        : '<ul><li><b>Flick</b> — vise la cible orange et clique dessus, vite et sans rater. Un chevron sur le bord indique une cible hors champ.</li>' +
          '<li><b>Suivi</b> — garde le viseur sur la cible qui bouge (pas besoin de cliquer).</li></ul>') +
      '<p>Joue comme en partie : même position, même tapis. <kbd>Échap</kbd> met en pause.</p>' +
      '<p class="tr-warn"></p>' +
      '<div class="tr-btns"><button data-act="go" data-lock class="primary">Commencer</button><button data-act="cancel">Annuler</button></div>');
    if (first !== 'go') { close(); return null; }

    for (let i = 0; i < steps.length;) {
      const s = steps[i];
      try {
        if (s.warm) {
          await clickToGo('<h2>Échauffement</h2><p>Quelques cibles pour se mettre en jambes. Ça ne compte pas.</p><p class="tr-go">Clique pour lancer</p>');
          await flickRound({ cm: s.cm, n: 8, adapt: 0, seed: seed + 7, label: 'Échauffement' });
        } else {
          const where = s.label + ' — ' + i + '/' + order.length;
          await clickToGo('<h2>' + where + '</h2><p>La sensi vient de changer. Les trois premières cibles servent à t\'y habituer.</p><p class="tr-go">Clique pour lancer</p>');
          const flick = await flickRound({ cm: s.cm, n: 14, adapt: 3, seed, label: where });
          await timed('<h2>Suivi</h2><p>Garde le ' + (flat ? 'curseur' : 'viseur') + ' sur la cible.</p>', 2200);
          const track = await trackRound({ cm: s.cm, adaptMs: 2500, ms: 12000, seed: seed + 3, label: where });
          rounds.push({
            cm: s.cm, flick: flick.score, track: track.score,
            time: flick.time, acc: flick.acc, over: flick.over, bias: flick.bias, err: track.err,
          });
        }
        i++;
      } catch (e) {
        if (e !== UNLOCK) { close(); throw e; }
        hud.textContent = 'Pause';
        const a = await menu(
          '<h2>Pause</h2><p>La manche en cours recommencera au début.' +
          (rounds.length ? ' ' + rounds.length + ' sensi(s) déjà mesurée(s).' : '') + '</p><p class="tr-warn"></p>' +
          '<div class="tr-btns"><button data-act="go" data-lock class="primary">Reprendre</button><button data-act="stop">Arrêter là</button></div>');
        hush();
        if (a !== 'go') { aborted = true; break; }
      }
    }
    const raw = rawMode;
    close();
    return { rounds, raw, aborted };
  }

  // ---------- Mesure des DPI réels ----------
  // On fait glisser la souris sur une distance connue (règle, carte bancaire…) en gardant
  // le clic enfoncé ; le nombre de « counts » reçus donne les DPI effectifs. Trois mesures, médiane.
  async function calibrate() {
    flat = false;
    open(false);
    const form =
      '<h2>Mesurer ma souris</h2>' +
      '<p>Pose une règle le long de ta souris. Tu vas la faire glisser vers la droite, bien droit, sur une distance précise, <b>clic gauche enfoncé</b> — trois fois.</p>' +
      '<p class="tr-dim">Pas de règle ? Une carte bancaire mesure 8,56 cm de large, une feuille A4 21 cm.</p>' +
      '<label class="tr-field">Distance <input id="trDist" type="number" min="3" max="60" step="0.01" value="10" inputmode="decimal"> cm</label>' +
      '<p class="tr-warn"></p>' +
      '<div class="tr-btns"><button data-act="go" data-lock class="primary">Commencer</button><button data-act="cancel">Annuler</button></div>';
    if ((await menu(form)) !== 'go') { close(); return null; }
    const typed = parseFloat((box.querySelector('#trDist').value || '').replace(',', '.'));
    const dist = typed >= 3 && typed <= 60 ? typed : 10;

    const samples = [];
    const result = await new Promise((resolve) => {
      let holding = false, sx = 0, sy = 0;
      const view = (live) => say(
        '<h2>Mesure ' + Math.min(3, samples.length + 1) + '/3</h2>' +
        '<p>Maintiens le clic gauche, glisse de <b>' + String(dist).replace('.', ',') + ' cm</b> vers la droite, puis relâche.</p>' +
        '<p class="tr-big">' + Math.round(live).toLocaleString('fr-FR') + ' <small>counts</small></p>' +
        '<p class="tr-dim">' + (samples.length ? 'Mesures : ' + samples.map((v) => Math.round(v * 2.54 / dist) + ' DPI').join(' · ') : 'Échap pour annuler') + '</p>');
      view(0);
      phase = {
        look: false,
        down() { holding = true; sx = 0; sy = 0; view(0); },
        move(dx, dy) { if (holding) { sx += dx; sy += dy; view(Math.hypot(sx, sy)); } },
        up() {
          if (!holding) return;
          holding = false;
          const n = Math.hypot(sx, sy);
          if (n > 150) samples.push(n);
          if (samples.length >= 3) { phase = null; resolve(true); } else view(0);
        },
        abort: () => resolve(false),
      };
    });
    const raw = rawMode;
    close();
    if (!result) return null;
    const sorted = samples.slice().sort((a, b) => a - b);
    return { countsPerCm: sorted[1] / dist, raw, spread: (sorted[2] - sorted[0]) / sorted[1] };
  }

  // peek : état instantané, pour les essais automatisés.
  const peek = () => ({ flat, yaw, pitch, degPerCount, target, locked: !!el && isLocked(), msg: !!msg && !msg.hidden, hud: hud ? hud.textContent : '' });
  window.SensiTrainer = { runSession, calibrate, peek };
})();
