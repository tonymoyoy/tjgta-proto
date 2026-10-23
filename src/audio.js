// Sonido del juego, todo generado con Web Audio (sin archivos): musica tenue de accion,
// ambiente de ciudad (trafico, claxons, sirenas lejanas), motor del auto y efectos de dinero.
(() => {
'use strict';
let ctx = null, master, musicBus, ambBus, sfxBus, noiseBuf;
let muted = false;
try { muted = localStorage.getItem('tjgta-mute') === '1'; } catch (e) { /* sin almacenamiento */ }

const VOL = { master: 0.8, music: 0.16, amb: 0.22, sfx: 0.5 };
// lo que el jugador le sube o le baja a cada uno (0 a 1; se guarda): musica, ambiente y efectos
const NIVEL = { music: 1, amb: 1, sfx: 1 };
try { Object.assign(NIVEL, JSON.parse(localStorage.getItem('tjrush-vol') || '{}')); } catch (e) { /* sin almacenamiento */ }

function init() {
  if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return; }
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return;
  ctx = new AC();
  master = ctx.createGain(); master.gain.value = muted ? 0 : VOL.master; master.connect(ctx.destination);
  const comp = ctx.createDynamicsCompressor(); comp.threshold.value = -18; comp.ratio.value = 4; comp.connect(master);
  musicBus = ctx.createGain(); musicBus.gain.value = VOL.music * NIVEL.music; musicBus.connect(comp);
  ambBus = ctx.createGain(); ambBus.gain.value = VOL.amb * NIVEL.amb; ambBus.connect(comp);
  sfxBus = ctx.createGain(); sfxBus.gain.value = VOL.sfx * NIVEL.sfx; sfxBus.connect(comp);
  // ruido para tambores, trafico y choques
  noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
  const d = noiseBuf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  startMusic(); startAmbience(); startEngine();
}

// ---------- utilidades ----------
const midi = (n) => 440 * Math.pow(2, (n - 69) / 12);
function env(g, t, a, peak, dec, sus = 0.0001) {
  g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(peak, t + a);
  g.gain.exponentialRampToValueAtTime(Math.max(sus, 0.0001), t + a + dec);
}
function tone(bus, type, freq, t, dur, vol, opts = {}) {
  const o = ctx.createOscillator(), g = ctx.createGain();
  o.type = type; o.frequency.setValueAtTime(freq, t);
  if (opts.to) o.frequency.exponentialRampToValueAtTime(opts.to, t + dur);
  let out = g;
  if (opts.lp) { const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = opts.lp; g.connect(f); out = f; }
  o.connect(g); out.connect(bus);
  env(g, t, opts.a || 0.005, vol, dur);
  o.start(t); o.stop(t + dur + 0.05);
}
function noise(bus, t, dur, vol, type, freq, q = 1) {
  const s = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
  s.buffer = noiseBuf; s.loop = true; f.type = type; f.frequency.value = freq; f.Q.value = q;
  s.connect(f); f.connect(g); g.connect(bus);
  env(g, t, 0.003, vol, dur);
  s.start(t, Math.random() * 1.5); s.stop(t + dur + 0.05);
}

// ---------- musica: loop de accion en La menor, 96 bpm, bajo + bateria suave + arpegio ----------
const BPM = 96, STEP = 60 / BPM / 4; // semicorcheas
const CHORDS = [[45, 57, 60, 64], [41, 53, 57, 60], [43, 55, 59, 62], [40, 52, 55, 59]]; // Am F G Em
const BASS = [1, 0, 0, 1, 0, 0, 1, 0, 1, 0, 0, 1, 0, 1, 0, 0];
const KICK = [1, 0, 0, 0, 0, 0, 0, 1, 1, 0, 0, 0, 0, 0, 0, 0];
const SNARE = [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 1];
let step = 0, nextT = 0;
function startMusic() { nextT = ctx.currentTime + 0.1; setInterval(schedule, 50); }
function schedule() {
  if (nextT < ctx.currentTime - 0.3) nextT = ctx.currentTime + 0.05; // la pestaña estuvo en segundo plano
  while (nextT < ctx.currentTime + 0.2) {
    const s = step % 16, bar = (step / 16 | 0) % 4, part = (step / 64 | 0) % 2, ch = CHORDS[bar], t = nextT;
    if (KICK[s]) { tone(musicBus, 'sine', 120, t, 0.18, 0.9, { to: 40 }); }
    if (SNARE[s]) noise(musicBus, t, 0.12, 0.25, 'bandpass', 1800, 0.8);
    if (s % 2 === 0) noise(musicBus, t, 0.03, s % 4 === 2 ? 0.12 : 0.06, 'highpass', 7000);
    if (BASS[s]) tone(musicBus, 'sawtooth', midi(ch[0] - 12 + (s === 13 ? 7 : 0)), t, STEP * 1.6, 0.35, { lp: 420 });
    // arpegio que entra en la segunda vuelta para que no se haga monotono
    if (part === 1 && s % 2 === 1) tone(musicBus, 'triangle', midi(ch[1 + ((s >> 1) % 3)] + 12), t, STEP * 1.2, 0.07, { lp: 2600 });
    if (s === 0) tone(musicBus, 'sine', midi(ch[2]), t, STEP * 14, 0.05, { a: 0.4, lp: 1200 }); // colchon
    nextT += STEP; step++;
  }
}

// ---------- mariachi de la fiesta: vals original en Do mayor, 3/4 a 180 bpm ----------
// guitarron en el tiempo 1, vihuela rasgueando en 2 y 3, y dos trompetas en terceras. Va por su propio bus
// para cortarlo de golpe al terminar; mientras suena, la musica de fondo se baja.
const MARI_BEAT = 60 / 180, MAJOR = [0, 2, 4, 5, 7, 9, 11];
const MARI_CHORDS = { C: [48, 52, 55], F: [53, 57, 60], G: [43, 47, 50] };
// [acorde, [nota midi, tiempos]...] por compas; dos frases de 8 compases
const MARI_SONG = [
  ['C', [76, 2], [79, 1]], ['G', [77, 1], [76, 1], [74, 1]], ['G', [71, 2], [74, 1]], ['C', [72, 3]],
  ['F', [81, 2], [81, 1]], ['C', [79, 1], [76, 1], [72, 1]], ['G', [74, 1], [77, 1], [76, 1]], ['C', [72, 3]],
  ['C', [79, 1], [81, 1], [79, 1]], ['F', [77, 2], [81, 1]], ['G', [79, 1], [77, 1], [74, 1]], ['C', [76, 3]],
  ['F', [77, 1], [76, 1], [74, 1]], ['C', [72, 2], [76, 1]], ['G', [74, 2], [71, 1]], ['C', [72, 3]],
];
// la segunda trompeta va una tercera abajo, dentro de la escala
const third = (n) => { const o = Math.floor(n / 12), pc = n % 12, i = MAJOR.indexOf(pc); if (i < 0) return n - 4; const j = i - 2; return (j < 0 ? o - 1 : o) * 12 + MAJOR[(j + 7) % 7]; };
let mariBus = null, mariOn = false, mariTimer = null;
function mariachiLoop(t0) {
  let t = t0;
  for (const [ch, ...notes] of MARI_SONG) {
    const c = MARI_CHORDS[ch];
    tone(mariBus, 'triangle', midi(c[0] - 12), t, MARI_BEAT * 0.9, 0.5, { lp: 600 });            // guitarron
    for (const b of [1, 2]) c.forEach((n, i) => tone(mariBus, 'triangle', midi(n + 12), t + b * MARI_BEAT + i * 0.012, 0.12, 0.07, { lp: 3000 })); // vihuela
    let d = 0;
    for (const [n, beats] of notes) {
      const len = beats * MARI_BEAT * 0.92;
      tone(mariBus, 'sawtooth', midi(n), t + d, len, 0.09, { lp: 2600 }); tone(mariBus, 'square', midi(third(n)), t + d, len, 0.05, { lp: 2200 });
      d += beats * MARI_BEAT;
    }
    t += 3 * MARI_BEAT;
  }
  return t;
}
function mariachi(on) {
  if (!ctx) return;
  const now = ctx.currentTime;
  if (on && !mariOn) {
    mariOn = true;
    mariBus = ctx.createGain(); mariBus.gain.value = 0.9; mariBus.connect(sfxBus);
    musicBus.gain.setTargetAtTime(0.0001, now, 0.4);
    let next = now + 0.2;
    const loop = () => { if (!mariOn) return; next = mariachiLoop(next); mariTimer = setTimeout(loop, (next - ctx.currentTime - 1) * 1000); };
    loop();
  } else if (!on && mariOn) {
    mariOn = false; clearTimeout(mariTimer);
    mariBus.gain.setTargetAtTime(0.0001, now, 0.3); const b = mariBus; setTimeout(() => b.disconnect(), 1500);
    musicBus.gain.setTargetAtTime(VOL.music, now + 0.5, 0.8);
  }
}

// ---------- ambiente de ciudad ----------
let traffic;
function startAmbience() {
  // rumor de trafico: ruido grave continuo que sube cuando hay autos cerca
  const s = ctx.createBufferSource(), f = ctx.createBiquadFilter();
  s.buffer = noiseBuf; s.loop = true; f.type = 'lowpass'; f.frequency.value = 380;
  traffic = ctx.createGain(); traffic.gain.value = 0.25;
  s.connect(f); f.connect(traffic); traffic.connect(ambBus); s.start();
  const later = (fn, a, b) => setTimeout(() => { fn(); later(fn, a, b); }, (a + Math.random() * (b - a)) * 1000);
  later(horn, 5, 14); later(siren, 35, 80); later(dog, 25, 60); later(vendor, 20, 45);
}
function horn() { // claxon lejano, a veces doble
  if (!ctx) return; const t = ctx.currentTime, f = 300 + Math.random() * 180, v = 0.08 + Math.random() * 0.1;
  const n = Math.random() < 0.4 ? 2 : 1;
  for (let i = 0; i < n; i++) { tone(ambBus, 'square', f, t + i * 0.22, 0.16 + Math.random() * 0.2, v, { lp: 1400 }); tone(ambBus, 'square', f * 1.26, t + i * 0.22, 0.16, v * 0.6, { lp: 1400 }); }
}
function siren() { // patrulla a lo lejos
  if (!ctx) return; const t = ctx.currentTime, o = ctx.createOscillator(), g = ctx.createGain(), f = ctx.createBiquadFilter();
  o.type = 'sawtooth'; f.type = 'lowpass'; f.frequency.value = 1100;
  for (let i = 0; i < 6; i++) { o.frequency.setValueAtTime(700, t + i * 0.9); o.frequency.linearRampToValueAtTime(1050, t + i * 0.9 + 0.45); o.frequency.linearRampToValueAtTime(700, t + i * 0.9 + 0.9); }
  g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.06, t + 1.5); g.gain.exponentialRampToValueAtTime(0.0001, t + 5.4);
  o.connect(f); f.connect(g); g.connect(ambBus); o.start(t); o.stop(t + 5.5);
}
function dog() { // ladrido de perro de azotea
  if (!ctx) return; const t = ctx.currentTime;
  for (let i = 0; i < 2 + (Math.random() * 2 | 0); i++) { tone(ambBus, 'sawtooth', 520, t + i * 0.28, 0.09, 0.07, { to: 260, lp: 1500 }); noise(ambBus, t + i * 0.28, 0.06, 0.05, 'bandpass', 900, 2); }
}
function vendor() { // la campanita del paletero / el silbato del afilador
  if (!ctx) return; const t = ctx.currentTime;
  if (Math.random() < 0.5) for (let i = 0; i < 4; i++) tone(ambBus, 'sine', 2093, t + i * 0.18, 0.25, 0.04);
  else [72, 74, 76, 77, 79, 77, 76, 74, 72].forEach((n, i) => tone(ambBus, 'sine', midi(n + 12), t + i * 0.07, 0.08, 0.035));
}

// ---------- motor del auto ----------
let eng, engG, engF;
function startEngine() {
  eng = ctx.createOscillator(); eng.type = 'sawtooth'; eng.frequency.value = 40;
  engF = ctx.createBiquadFilter(); engF.type = 'lowpass'; engF.frequency.value = 300;
  engG = ctx.createGain(); engG.gain.value = 0;
  eng.connect(engF); engF.connect(engG); engG.connect(sfxBus); eng.start();
}

// ---------- efectos ----------
const SFX = {
  gain(amount) { // monedas que suben
    const t = ctx.currentTime, notes = amount >= 100 ? [76, 79, 84, 88] : [79, 84];
    notes.forEach((n, i) => tone(sfxBus, 'square', midi(n), t + i * 0.07, 0.12, 0.12, { lp: 3500 }));
  },
  loss() { // trombon triste "wah wah wah"
    const t = ctx.currentTime;
    [[58, 0], [57, 0.3], [56, 0.6]].forEach(([n, d]) => tone(sfxBus, 'sawtooth', midi(n), t + d, 0.28, 0.16, { lp: 900 }));
    tone(sfxBus, 'sawtooth', midi(55), t + 0.9, 0.7, 0.16, { lp: 900, to: midi(53) });
  },
  fanfare() { // lugar descubierto o secreto encontrado
    const t = ctx.currentTime;
    [[67, 0, 0.12], [72, 0.12, 0.12], [76, 0.24, 0.12], [79, 0.36, 0.5]].forEach(([n, d, l]) => {
      tone(sfxBus, 'square', midi(n), t + d, l, 0.12, { lp: 3000 }); tone(sfxBus, 'triangle', midi(n - 12), t + d, l, 0.15);
    });
  },
  boom(o = {}) { // explosion: tronido seco, golpe grave, estruendo, retumbo largo y pedazos cayendo (k = tamaño, v = volumen)
    const t = ctx.currentTime, k = o.k || 1, v = Math.max(0.15, Math.min(1, o.v ?? 1));
    noise(sfxBus, t, 0.09, 0.9 * v, 'highpass', 2200);
    tone(sfxBus, 'sine', 95, t, 1 + 0.5 * k, 0.95 * v, { to: 22 });
    noise(sfxBus, t, 1.3 + 0.8 * k, 0.85 * v, 'lowpass', Math.max(350, 1000 - 180 * k));
    noise(sfxBus, t + 0.2, 2 + k, 0.35 * v, 'lowpass', 260);
    for (let i = 0; i < 6 + 4 * k; i++) noise(sfxBus, t + 0.15 + Math.random() * (0.7 + 0.5 * k), 0.05, 0.1 * v, 'bandpass', 1800 + Math.random() * 3500, 3);
    if (k > 1.5) { // la pipa: un segundo trueno y el rugido del fuego
      tone(sfxBus, 'sawtooth', 60, t + 0.12, 2.2, 0.35 * v, { to: 18, lp: 320 });
      noise(sfxBus, t + 0.35, 0.9, 0.6 * v, 'lowpass', 500);
      noise(sfxBus, t + 0.5, 3.5, 0.25 * v, 'bandpass', 700, 0.5);
    }
  },
  claxon(v = 1) { // claxon de aire del camion: dos tonos, a veces dos veces
    const t = ctx.currentTime, n = Math.random() < 0.5 ? 2 : 1;
    for (let i = 0; i < n; i++) {
      const d = i * 0.32, l = n === 2 && i === 0 ? 0.22 : 0.5;
      tone(sfxBus, 'sawtooth', 233, t + d, l, 0.14 * v, { lp: 1600, a: 0.02 }); tone(sfxBus, 'sawtooth', 294, t + d, l, 0.11 * v, { lp: 1600, a: 0.02 });
    }
  },
  pito(v = 1) { // el claxon de un carro desesperado en la fila: corto, a veces dos o tres seguidos
    const t = ctx.currentTime, f = 330 + Math.random() * 150, n = 1 + (Math.random() * 3 | 0);
    for (let i = 0; i < n; i++) { tone(sfxBus, 'square', f, t + i * 0.2, 0.12 + Math.random() * 0.12, 0.07 * v, { lp: 1500 }); tone(sfxBus, 'square', f * 1.26, t + i * 0.2, 0.12, 0.045 * v, { lp: 1500 }); }
  },
  gasLP(v = 1) { // la cancioncita de la pipa que anda vendiendo gas por la colonia
    const t = ctx.currentTime, mel = [[67, 1], [72, 1], [72, 1], [76, 2], [74, 1], [72, 1], [74, 1], [79, 3]];
    let d = 0;
    for (const [n, b] of mel) {
      const l = b * 0.17;
      tone(ambBus, 'triangle', midi(n), t + d, l * 0.95, 0.22 * v, { lp: 2800 }); tone(ambBus, 'square', midi(n + 12), t + d, l * 0.6, 0.03 * v, { lp: 2400 });
      d += l;
    }
  },
  panLP(v = 1) { // la cancioncita del carro del pan por la bocina: cuadrada, aguda, sin graves y un poco rayada
    const t = ctx.currentTime, mel = [[72, 1], [72, 1], [74, 1], [76, 1], [76, 1], [74, 1], [72, 2], [67, 1], [72, 3]];
    let d = 0;
    for (const [n, b] of mel) {
      const l = b * 0.15, w = Math.random() < 0.15 ? 0.97 : 1; // a veces se jala la cinta
      tone(ambBus, 'square', midi(n) * w, t + d, l * 0.85, 0.07 * v, { lp: 2200 }); tone(ambBus, 'sawtooth', midi(n) * w, t + d, l * 0.85, 0.03 * v, { lp: 1500 });
      d += l;
    }
    noise(ambBus, t, d, 0.012 * v, 'bandpass', 2500, 1);
  },
  ladrido(v = 1) { // guau guau
    const t = ctx.currentTime, n = 1 + (Math.random() * 2 | 0), f = 420 + Math.random() * 220;
    for (let i = 0; i < n; i++) { tone(sfxBus, 'sawtooth', f, t + i * 0.24, 0.1, 0.12 * v, { to: f * 0.5, lp: 1600 }); noise(sfxBus, t + i * 0.24, 0.07, 0.08 * v, 'bandpass', 900, 2); }
  },
  miau(v = 1) { // "mi-au": sube y luego cae, con la nariz (pasabandas)
    const t = ctx.currentTime, f = 560 + Math.random() * 160;
    tone(sfxBus, 'sawtooth', f, t, 0.13, 0.09 * v, { to: f * 1.55, lp: 2200 });
    tone(sfxBus, 'sawtooth', f * 1.55, t + 0.13, 0.32, 0.1 * v, { to: f * 0.7, lp: 1800 });
    tone(sfxBus, 'triangle', f * 2, t, 0.45, 0.03 * v, { to: f * 1.2 });
  },
  aullido() { // el chillido del perrito atropellado: "cai cai cai"
    const t = ctx.currentTime;
    for (let i = 0; i < 3; i++) tone(sfxBus, 'triangle', 1500 - i * 120, t + i * 0.16, 0.13, 0.16, { to: 900 - i * 80, lp: 3000 });
  },
  fuga() { // el silbido del gas saliendose
    noise(sfxBus, ctx.currentTime, 1.4, 0.16, 'highpass', 5000);
  },
  crash(force) { // golpe: tronido grave + vidrio
    const t = ctx.currentTime, v = Math.min(1, 0.25 + force);
    noise(sfxBus, t, 0.35, 0.6 * v, 'lowpass', 500);
    tone(sfxBus, 'sine', 90, t, 0.25, 0.5 * v, { to: 35 });
    if (force > 0.6) noise(sfxBus, t + 0.03, 0.25, 0.15 * v, 'highpass', 5000);
  },
  chat() { // "¡eh!" corto cuando alguien te habla
    const t = ctx.currentTime;
    tone(sfxBus, 'triangle', midi(76), t, 0.07, 0.08); tone(sfxBus, 'triangle', midi(81), t + 0.07, 0.1, 0.08);
  },
  cohete() { // silbido que sube y el tronido con chisporroteo
    const t = ctx.currentTime;
    tone(sfxBus, 'sine', 700, t, 0.7, 0.05, { to: 2200 });
    noise(sfxBus, t + 0.75, 0.5, 0.45, 'lowpass', 900);
    tone(sfxBus, 'sine', 110, t + 0.75, 0.4, 0.4, { to: 40 });
    for (let i = 0; i < 9; i++) noise(sfxBus, t + 0.85 + Math.random() * 0.7, 0.04, 0.12, 'highpass', 5000);
  },
  tired() { // jadeo
    const t = ctx.currentTime;
    for (let i = 0; i < 3; i++) noise(sfxBus, t + i * 0.35, 0.2, 0.12, 'bandpass', 1200, 0.7);
  },
};

window.SND = {
  init,
  play(name, arg) { if (ctx && !muted && SFX[name]) SFX[name](arg); },
  mariachi,
  // se llama cada cuadro: motor segun velocidad y rumor de trafico segun autos cercanos
  update(inCar, speed, cars) {
    if (!ctx) return;
    const t = ctx.currentTime;
    engG.gain.setTargetAtTime(inCar ? 0.06 + Math.min(speed / 300, 1) * 0.06 : 0, t, 0.1);
    eng.frequency.setTargetAtTime(38 + speed * 0.32, t, 0.08);
    engF.frequency.setTargetAtTime(250 + speed * 3, t, 0.1);
    traffic.gain.setTargetAtTime(0.18 + Math.min(cars / 8, 1) * 0.35, t, 0.5);
  },
  get muted() { return muted; },
  // el volumen de musica, ambiente o efectos (0 a 1)
  nivel(k, v) {
    if (v == null) return NIVEL[k];
    NIVEL[k] = Math.max(0, Math.min(1, v));
    try { localStorage.setItem('tjrush-vol', JSON.stringify(NIVEL)); } catch (e) { /* sin almacenamiento */ }
    const bus = { music: musicBus, amb: ambBus, sfx: sfxBus }[k];
    if (ctx && bus) bus.gain.setTargetAtTime(VOL[k] * NIVEL[k], ctx.currentTime, 0.05);
    return NIVEL[k];
  },
  // la app se va a segundo plano (o vuelve): se calla todo y se reanuda si el sonido estaba prendido
  suspend() { if (ctx) ctx.suspend(); },
  resume() { if (ctx && !muted) ctx.resume(); },
  toggle() {
    muted = !muted;
    try { localStorage.setItem('tjgta-mute', muted ? '1' : '0'); } catch (e) { /* sin almacenamiento */ }
    if (ctx) {
      master.gain.setTargetAtTime(muted ? 0 : VOL.master, ctx.currentTime, 0.05);
      if (muted) setTimeout(() => { if (muted) ctx.suspend(); }, 200); else ctx.resume(); // apagado no gasta CPU
    }
    return muted;
  },
};
})();
