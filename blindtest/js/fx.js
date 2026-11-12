// Effets sonores synthétisés (aucun fichier audio), voix et confettis.

let ctx = null;
let master = null;

export function audioCtx() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = 0.5;
    master.connect(ctx.destination);
  }
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

function note(freq, start, dur, { type = 'square', vol = 0.25, slide = null, vibrato = 0, filter = null } = {}) {
  const c = audioCtx();
  if (!c) return;
  const t0 = c.currentTime + start;
  const osc = c.createOscillator();
  const g = c.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  if (slide) osc.frequency.exponentialRampToValueAtTime(slide, t0 + dur);
  if (vibrato) {
    const lfo = c.createOscillator();
    const lg = c.createGain();
    lfo.frequency.value = 6;
    lg.gain.value = vibrato;
    lfo.connect(lg).connect(osc.frequency);
    lfo.start(t0);
    lfo.stop(t0 + dur + 0.05);
  }
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(vol, t0 + 0.015);
  g.gain.setValueAtTime(vol, t0 + Math.max(0.02, dur - 0.06));
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  let node = osc.connect(g);
  if (filter) {
    const f = c.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = filter;
    node = g.connect(f);
  }
  node.connect(master);
  osc.start(t0);
  osc.stop(t0 + dur + 0.05);
}

const N = { A3: 220, B3: 246.94, C4: 261.63, D4: 293.66, E4: 329.63, F4: 349.23, G4: 392, A4: 440, Bb4: 466.16, B4: 493.88,
  C5: 523.25, D5: 587.33, E5: 659.25, F5: 698.46, G5: 783.99, A5: 880, B5: 987.77, C6: 1046.5 };

export const sfx = {
  /** Une équipe vient de buzzer. */
  buzz() {
    note(N.A5, 0, 0.12, { type: 'square', vol: 0.22 });
    note(N.C6, 0.12, 0.32, { type: 'square', vol: 0.22 });
  },
  /** Bonne réponse : petit arpège joyeux. */
  correct() {
    [N.C5, N.E5, N.G5, N.C6].forEach((f, i) => note(f, i * 0.09, 0.22, { type: 'triangle', vol: 0.35 }));
    note(N.C6, 0.36, 0.5, { type: 'square', vol: 0.12 });
  },
  /** Mauvaise réponse : le buzzer qui fait mal. */
  wrong() {
    note(110, 0, 0.55, { type: 'sawtooth', vol: 0.3, filter: 900 });
    note(116, 0, 0.55, { type: 'sawtooth', vol: 0.3, filter: 900 });
  },
  /** Personne n'a trouvé : la trompette triste. */
  sadTrombone() {
    const seq = [[N.D4 * 1.0, 0.38], [N.D4 * 0.944, 0.38], [N.D4 * 0.891, 0.38], [N.D4 * 0.841, 1.1]];
    let t = 0;
    seq.forEach(([f, d], i) => {
      note(f, t, d, { type: 'sawtooth', vol: 0.28, filter: 1200, vibrato: i === 3 ? 8 : 0 });
      t += d;
    });
  },
  pop() { note(N.E5, 0, 0.06, { type: 'triangle', vol: 0.2 }); },
  /** Bip du décompte (plus aigu sur le dernier). */
  tick(last = false) { note(last ? N.A5 : N.E5, 0, last ? 0.22 : 0.12, { type: 'square', vol: 0.2 }); },
  /** Petite fanfare de victoire en version 8-bit. */
  fanfare() {
    const b = 0.15;
    const m = [
      ['G4', 1], ['C5', 1], ['E5', 1], ['G5', 2], ['E5', 1], ['G5', 4],
      ['A4', 1], ['D5', 1], ['F5', 1], ['A5', 2], ['F5', 1], ['A5', 4],
      ['B4', 1], ['D5', 1], ['G5', 1], ['B5', 2], ['A5', 1], ['B5', 1], ['C6', 7],
    ];
    let t = 0.1;
    m.forEach(([n, d]) => {
      note(N[n], t, d * b * 0.9, { type: 'square', vol: 0.15 });
      note(N[n] / 2, t, d * b * 0.9, { type: 'triangle', vol: 0.18 });
      t += d * b;
    });
    // accord final
    [N.C5, N.E5, N.G5].forEach((f) => note(f, t - 7 * b, 7 * b, { type: 'triangle', vol: 0.12 }));
    return t;
  },
};

/* ------------------------------------------------------------------ */
/* Voix (synthèse vocale du navigateur)                               */
/* ------------------------------------------------------------------ */

let frVoice = null;
function pickVoice() {
  if (!('speechSynthesis' in window)) return;
  const voices = speechSynthesis.getVoices();
  frVoice = voices.find((v) => /^fr(-|_)FR/i.test(v.lang) && /google|natural|online/i.test(v.name))
    || voices.find((v) => /^fr(-|_)FR/i.test(v.lang))
    || voices.find((v) => /^fr/i.test(v.lang)) || null;
}
if ('speechSynthesis' in window) {
  pickVoice();
  speechSynthesis.addEventListener?.('voiceschanged', pickVoice);
}

export function speak(text) {
  if (!('speechSynthesis' in window)) return;
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = 'fr-FR';
  if (frVoice) u.voice = frVoice;
  u.rate = 1.05;
  u.pitch = 1.1;
  speechSynthesis.speak(u);
}

/* ------------------------------------------------------------------ */
/* Confettis                                                           */
/* ------------------------------------------------------------------ */

let canvas = null;
let particles = [];
let raf = 0;

const CONFETTI_COLORS = ['#ff4fa3', '#ffd23f', '#22d3ee', '#a259ff', '#3ddc97', '#ff9f1c', '#ffffff'];

export function confetti({ count = 160, colors = CONFETTI_COLORS, origin = null } = {}) {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  if (!canvas) {
    canvas = document.createElement('canvas');
    canvas.className = 'confetti-canvas';
    canvas.setAttribute('aria-hidden', 'true');
    document.body.appendChild(canvas);
  }
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = innerWidth * dpr;
  canvas.height = innerHeight * dpr;
  const W = canvas.width;
  const H = canvas.height;
  for (let i = 0; i < count; i++) {
    const ox = origin ? origin.x * W : Math.random() * W;
    const oy = origin ? origin.y * H : -20 * dpr;
    const angle = origin ? Math.random() * Math.PI * 2 : Math.PI / 2 + (Math.random() - 0.5) * 0.6;
    const speed = (origin ? 6 + Math.random() * 10 : 2 + Math.random() * 4) * dpr;
    particles.push({
      x: ox, y: oy,
      vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed - (origin ? 6 * dpr : 0),
      w: (6 + Math.random() * 8) * dpr, h: (4 + Math.random() * 6) * dpr,
      rot: Math.random() * Math.PI, vr: (Math.random() - 0.5) * 0.3,
      color: colors[(Math.random() * colors.length) | 0],
      life: 0, max: 220 + Math.random() * 120, round: Math.random() < 0.25,
    });
  }
  if (!raf) loop();
}

function loop() {
  const c = canvas.getContext('2d');
  c.clearRect(0, 0, canvas.width, canvas.height);
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  particles = particles.filter((p) => p.life < p.max && p.y < canvas.height + 40);
  for (const p of particles) {
    p.life++;
    p.vy += 0.12 * dpr;
    p.vx *= 0.99;
    p.vy *= 0.99;
    p.x += p.vx + Math.sin(p.life / 12) * 0.6 * dpr;
    p.y += p.vy;
    p.rot += p.vr;
    c.save();
    c.globalAlpha = Math.min(1, (p.max - p.life) / 40);
    c.translate(p.x, p.y);
    c.rotate(p.rot);
    c.fillStyle = p.color;
    if (p.round) { c.beginPath(); c.arc(0, 0, p.h / 1.6, 0, Math.PI * 2); c.fill(); }
    else c.fillRect(-p.w / 2, -p.h / 2, p.w, p.h * (0.4 + Math.abs(Math.sin(p.life / 8)) * 0.6));
    c.restore();
  }
  if (particles.length) raf = requestAnimationFrame(loop);
  else { raf = 0; c.clearRect(0, 0, canvas.width, canvas.height); }
}
