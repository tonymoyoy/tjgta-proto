// TJ Rush: juego de vista cenital en la Zona Centro de Tijuana.
// Mapa: calles, edificios y lugares reales (Overture Maps / OpenStreetMap), ver tools/prep_data.py.
(() => {
'use strict';
const D = window.TJ_DATA;
const M = 5;            // pixeles por metro
const S = M / 10;       // pixeles por decimetro (unidad de los datos)
const WORLD_W = Math.ceil(D.w * M), WORLD_H = Math.ceil(D.h * M);
// trozos chicos: cada uno se dibuja rapido y no se nota el tiron al irlos creando
const CHUNK = 256;
const EXTRA_UP = 44; // lo mas que se eleva un techo (px)
// nitidez: el lienzo usa los pixeles reales de la pantalla (hasta 3 por punto en celulares) y los trozos
// del mapa y los textos se pintan a mas resolucion, porque la camara los amplia
// calidad grafica (Opciones): alta es lo de siempre; media y baja bajan la resolucion del lienzo, del mapa y de
// los sprites, y la cantidad de autos y gente (se nota sobre todo en celulares; en PC casi no cambia)
const CALIDADES = {
  alta: { dpr: 3, res: 3, spr: 5, autos: 18, gente: 26 },
  media: { dpr: 2, res: 2, spr: 3, autos: 15, gente: 20 },
  baja: { dpr: 1.5, res: 2, spr: 2, autos: 12, gente: 14 },
};
const CALIDAD = (() => { try { const c = localStorage.getItem('tjrush-calidad'); return CALIDADES[c] ? c : 'alta'; } catch (e) { return 'alta'; } })();
const Q = CALIDADES[CALIDAD];
const DPR = Math.min(window.devicePixelRatio || 1, Q.dpr);
const RES = DPR > 1.5 ? Q.res : 2;        // pixeles de textura por pixel del mundo en los trozos
const KEEP = RES >= 3 ? 2 : 3;            // trozos que se guardan alrededor de la pantalla (a mas resolucion pesan mas)
const CHUNK_BUDGET_MS = 4;                // tiempo por cuadro para ir pintando el siguiente trozo
const CHUNK_BUDGET_SEEN_MS = 10;          // ... si ese trozo ya se ve en pantalla
const PREFETCH = 320;                     // los trozos se empiezan a pintar a esta distancia de la orilla de la pantalla
const LOOKAHEAD_S = 0.9;                  // ... y ademas hacia donde vas: lo que recorres en este tiempo (hasta LOOKAHEAD_MAX px)
const LOOKAHEAD_MAX = 700;
// los lienzos del mapa se pintan en memoria normal (CPU) y no en la tarjeta de video: en el celular el dibujo
// en la tarjeta se acumula y se cobra todo junto al subir la textura (un tiron); en CPU cada paso cuesta lo que
// cuesta y cabe en el presupuesto del cuadro. (localStorage tjrush-lienzo = 'gpu' vuelve a lo de antes, para comparar)
const LIENZO_CPU = (() => { try { return localStorage.getItem('tjrush-lienzo') !== 'gpu'; } catch (e) { return true; } })();
const CTX2D = LIENZO_CPU ? { willReadFrequently: true } : undefined;
const TXT_RES = Math.ceil(DPR * 2);
// autos y peatones: pixeles de textura por pixel del mundo (el sprite se muestra a escala 1 / SPR)
const SPR = DPR > 1.5 ? Q.spr : 2;

// ---------- geometria ----------
// clases: 0 autopista, 1 troncal, 2 primaria, 3 secundaria, 4 terciaria, 5 residencial,
// 6 calle local, 7 servicio, 8 peatonal, 9 banqueta/sendero, 10 tren, 11 rio
// las avenidas principales (clases 0-3) tienen 4 carriles de 4.5 m
const ROAD_W = [19, 19, 19, 18, 12, 10, 9, 6, 6, 2.5, 3, 10];
const MAJOR = 3;
const SIDEWALK = 2.5;
const COL = {
  ground: '#8f8875', sidewalk: '#b4ab98', curb: '#9d9481', asphalt: '#3c3c41', paving: '#c5b89e',
  footway: '#c9bda3', rail: '#6b5a48', water: '#2f5f7f', yellow: '#e6c13a', white: '#8a8a90',
  us: 'rgba(52,60,48,0.82)', fence: '#5b3f2a',
};
const AREA_COL = ['#5f8a3f', '#6a9a48', '#c9bc9f', '#a39a82', '#9b927d', '#a08c66', '#958e7a', '#2f5f7f'];
const ROOFS = ['#b9a98c', '#c9b89c', '#a39483', '#8f8a84', '#c3a27b', '#d2c5ae', '#9d7c64', '#7f8a90',
  '#b07d62', '#a8a8a0', '#c7b18a', '#8d9a86', '#bfa99a', '#d6cfc0'];

function pts(arr) { const a = new Float32Array(arr.length); for (let i = 0; i < arr.length; i++) a[i] = arr[i] * S; return a; }
// cuanto gira una linea por px recorrido (las glorietas giran mucho)
function curviness(p) {
  let turn = 0, len = 0, pa = null;
  for (let i = 0; i < p.length - 2; i += 2) {
    const dx = p[i + 2] - p[i], dy = p[i + 3] - p[i + 1], a = Math.atan2(dy, dx);
    len += Math.hypot(dx, dy);
    if (pa !== null) { let d = a - pa; d = Math.atan2(Math.sin(d), Math.cos(d)); turn += Math.abs(d); }
    pa = a;
  }
  return len > 0 ? turn / len : 0;
}
function bbox(p, pad) {
  let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
  for (let i = 0; i < p.length; i += 2) { const x = p[i], y = p[i + 1]; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  return [x0 - pad, y0 - pad, x1 + pad, y1 + pad];
}
function pip(x, y, p) {
  let c = false;
  for (let i = 0, j = p.length - 2; i < p.length; j = i, i += 2) {
    const xi = p[i], yi = p[i + 1], xj = p[j], yj = p[j + 1];
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) c = !c;
  }
  return c;
}
// punto mas cercano (y distancia) de (px,py) al eje de un vehiculo, sin contar su ancho
function axisPoint(px, py, o) {
  const h = Math.max(0, o.hl - o.hw), c = Math.cos(o.a), s = Math.sin(o.a);
  const t = Math.max(-h, Math.min(h, (px - o.x) * c + (py - o.y) * s));
  return [o.x + c * t, o.y + s * t];
}
function axisDist(px, py, o) { const q = axisPoint(px, py, o); return Math.hypot(px - q[0], py - q[1]); }
function hash(i) { i = Math.imul(i ^ 61, 0x9e3779b1); i ^= i >>> 15; return (i >>> 0); }
const dist = (ax, ay, bx, by) => Math.hypot(ax - bx, ay - by);
const angDiff = (a, b) => { let d = b - a; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; return d; };
const rnd = (a, b) => a + Math.random() * (b - a);
const pick = (arr) => arr[(Math.random() * arr.length) | 0];

const roads = D.roads.map(([c, n, f, co], i) => { const p = pts(co); return { i, c, n, f, p, bb: bbox(p, (ROAD_W[c] / 2 + 3) * M), curvy: curviness(p) > 0.0024 }; });
const blds = D.blds.map(([h, co], i) => { const p = pts(co); const sh = Math.min(h * 0.45, 22) * M / 5 * 1.6; return { h, p, sh, bb: bbox(p, 0), sbb: bbox(p, Math.max(sh, EXTRA_UP) + 2), col: ROOFS[hash(i) % ROOFS.length] }; });
const areas = D.areas.map(([k, co]) => { const p = pts(co); return { k, p, bb: bbox(p, 0) }; });
const B = pts(D.border);
const borderY = (x) => B[1] + (x - B[0]) * (B[3] - B[1]) / (B[2] - B[0]);
const landmarks = D.landmarks.map(([name, desc, x, y]) => ({ name, desc, x: x * S, y: y * S, found: false }));
const tacos = D.tacos.map(([name, x, y]) => ({ name, x: x * S, y: y * S, eaten: false }));
const cafes = D.cafes.map(([name, x, y]) => ({ name, x: x * S, y: y * S, drunk: false }));

// ---------- easter eggs: personajes y cosas tipicas de Tijuana, uno de cada uno y escondidos ----------
// cerca de un lugar (por nombre) y corridos dx,dy metros; al encontrarlos sueltan una frase y una lana
const EGGS = [
  { k: 'burro', name: 'El Burro Zebra', near: 'Arco Monumental', dx: 45, dy: 160, pay: 200,
    say: '"¿Qué me ves? Soy burro pintado, no caballo de carreras. Ten, pa\' que te tomes la foto."' },
  { k: 'cesar', name: 'La Ensalada César', near: "Hotel Caesar's", dx: 30, dy: -25, pay: 150,
    say: '"Nací aquí en 1924 y los gringos juran que soy italiana. Ni modo, toma una lana."' },
  { k: 'xolo', name: 'Un Xolo pelón', near: 'Parque Teniente Guerrero', dx: 40, dy: -50, pay: 150,
    say: '"Sí, estoy pelón. No, no tengo frío. Sí, le voy a los Xolos. Ten tu feria y no me andes sobando."' },
  { k: 'batiz', name: 'Javier Bátiz', near: 'Frontón Jai Alai', dx: -40, dy: 40, pay: 200,
    say: '"Yo le enseñé a tocar a Santana, ¿y tú qué has hecho? Toma, cómprate una guitarra y ponte a practicar."' },
  { k: 'gringo', name: 'Un Gringo Perdido', near: 'Puente El Chaparral', dx: -50, dy: 60, pay: 250,
    say: '"Bro, where is la Revolución? Llevo tres días caminando. Toma mis dólares, ya no los entiendo."' },
  { k: 'mariachi', name: 'El Mariachi Desvelado', near: 'Plaza Santa Cecilia', dx: -40, dy: -20, pay: 200,
    say: '"Te canto El Rey gratis... no, mentira. Bueno, hoy sí, y hasta te doy pa\'l camión."' },
  { k: 'mimo', name: 'El Mimo Moy', near: 'Museo de Historia (MUHTI)', dx: 40, dy: 40, pay: 150,
    say: '(No dice ni una palabra. Saca una cartera invisible, cuenta billetes invisibles... y te da dinero de verdad.)' },
  { k: 'payaso', name: 'El Payaso del Crucero', near: 'Glorieta Cuauhtémoc', dx: 60, dy: -40, pay: 150,
    say: '"Hago malabares con tres limones y dos chambas. Toma, que hoy me fue bien en el semáforo."' },
].map(e => { const l = landmarks.find(q => q.name === e.near) || landmarks[0]; return { ...e, x: l.x + e.dx * M, y: l.y + e.dy * M, got: false }; });

// ---------- indices espaciales ----------
function gridIndex(items, cell, bbKey) {
  const g = new Map();
  items.forEach((it, i) => {
    const b = it[bbKey];
    for (let cx = Math.floor(b[0] / cell); cx <= Math.floor(b[2] / cell); cx++)
      for (let cy = Math.floor(b[1] / cell); cy <= Math.floor(b[3] / cell); cy++) {
        const k = cx + ',' + cy; let a = g.get(k); if (!a) g.set(k, a = []); a.push(i);
      }
  });
  return g;
}
const chunkRoads = gridIndex(roads, CHUNK, 'bb');
const chunkBlds = gridIndex(blds, CHUNK, 'sbb');
const chunkAreas = gridIndex(areas, CHUNK, 'bb');
const BCELL = 64;
const bldGrid = gridIndex(blds, BCELL, 'bb');
const NCELL = 128;
const named = roads.map((r, i) => i).filter(i => roads[i].n >= 0 && roads[i].c <= 9);
const nameGrid = gridIndex(named.map(i => roads[i]), NCELL, 'bb');

function inBuilding(x, y) {
  const a = bldGrid.get(Math.floor(x / BCELL) + ',' + Math.floor(y / BCELL));
  if (!a) return false;
  for (const i of a) { const b = blds[i]; if (x < b.bb[0] || x > b.bb[2] || y < b.bb[1] || y > b.bb[3]) continue; if (pip(x, y, b.p)) return true; }
  return false;
}
// Las calles se dibujan encima de los edificios, asi que su franja (con banqueta) siempre es transitable.
const RCELL = 64;
const roadSegGrid = new Map();
roads.forEach(r => {
  if (r.c > 7) return;
  const half = (ROAD_W[r.c] / 2 + (r.c <= 6 ? SIDEWALK : 0.5)) * M, p = r.p;
  for (let q = 0; q < p.length - 2; q += 2) {
    const seg = [p[q], p[q + 1], p[q + 2], p[q + 3], half];
    const x0 = Math.floor((Math.min(p[q], p[q + 2]) - half) / RCELL), x1 = Math.floor((Math.max(p[q], p[q + 2]) + half) / RCELL);
    const y0 = Math.floor((Math.min(p[q + 1], p[q + 3]) - half) / RCELL), y1 = Math.floor((Math.max(p[q + 1], p[q + 3]) + half) / RCELL);
    for (let cx = x0; cx <= x1; cx++) for (let cy = y0; cy <= y1; cy++) {
      const k = cx + ',' + cy; let a = roadSegGrid.get(k); if (!a) roadSegGrid.set(k, a = []); a.push(seg);
    }
  }
});
function onRoad(x, y) {
  const a = roadSegGrid.get(Math.floor(x / RCELL) + ',' + Math.floor(y / RCELL));
  if (a) for (const g of a) if (segDist(x, y, g[0], g[1], g[2], g[3]) < g[4]) return true;
  return false;
}
// agua (el canal del rio Tijuana y demas): las areas de agua y la linea del rio. Como con los edificios,
// la franja de una calle encima (los puentes) si se puede pasar
const waterAreas = areas.filter(a => a.k === AREA_COL.length - 1);
const waterGrid = gridIndex(waterAreas, BCELL, 'bb');
const riverSegGrid = new Map();
roads.forEach(r => {
  if (r.c !== 11) return;
  const half = ROAD_W[11] / 2 * M, p = r.p;
  for (let q = 0; q < p.length - 2; q += 2) {
    const seg = [p[q], p[q + 1], p[q + 2], p[q + 3], half];
    for (let cx = Math.floor((Math.min(p[q], p[q + 2]) - half) / RCELL); cx <= Math.floor((Math.max(p[q], p[q + 2]) + half) / RCELL); cx++)
      for (let cy = Math.floor((Math.min(p[q + 1], p[q + 3]) - half) / RCELL); cy <= Math.floor((Math.max(p[q + 1], p[q + 3]) + half) / RCELL); cy++) {
        const k = cx + ',' + cy; let a = riverSegGrid.get(k); if (!a) riverSegGrid.set(k, a = []); a.push(seg);
      }
  }
});
function inWater(x, y) {
  const a = waterGrid.get(Math.floor(x / BCELL) + ',' + Math.floor(y / BCELL));
  if (a) for (const i of a) { const w = waterAreas[i]; if (x >= w.bb[0] && x <= w.bb[2] && y >= w.bb[1] && y <= w.bb[3] && pip(x, y, w.p)) return true; }
  const s = riverSegGrid.get(Math.floor(x / RCELL) + ',' + Math.floor(y / RCELL));
  if (s) for (const g of s) if (segDist(x, y, g[0], g[1], g[2], g[3]) < g[4]) return true;
  return false;
}
function blocked(x, y) {
  return x < 4 || y < 4 || x > WORLD_W - 4 || y > WORLD_H - 4 || y < borderY(x) + 6 || ((inBuilding(x, y) || inWater(x, y)) && !onRoad(x, y));
}
function laneLat(e, k) {
  if (e.c <= MAJOR) return e.one ? [-3, -1, 1, 3][k & 3] * e.w / 8 : [1, 3][k & 1] * e.w / 8;
  return e.one ? 0 : e.w / 4;
}
function offsetLine(r, d) {
  r.off = r.off || {};
  if (r.off[d]) return r.off[d];
  const p = r.p, n = p.length / 2, o = new Float32Array(p.length);
  for (let i = 0; i < n; i++) {
    let nx = 0, ny = 0;
    if (i > 0) { const dx = p[i * 2] - p[i * 2 - 2], dy = p[i * 2 + 1] - p[i * 2 - 1], l = Math.hypot(dx, dy) || 1; nx -= dy / l; ny += dx / l; }
    if (i < n - 1) { const dx = p[i * 2 + 2] - p[i * 2], dy = p[i * 2 + 3] - p[i * 2 + 1], l = Math.hypot(dx, dy) || 1; nx -= dy / l; ny += dx / l; }
    const l = Math.hypot(nx, ny) || 1;
    o[i * 2] = p[i * 2] + nx / l * d; o[i * 2 + 1] = p[i * 2 + 1] + ny / l * d;
  }
  return (r.off[d] = o);
}
function segDist(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay, l = dx * dx + dy * dy;
  let t = l ? ((px - ax) * dx + (py - ay) * dy) / l : 0; t = t < 0 ? 0 : t > 1 ? 1 : t;
  return Math.hypot(px - ax - t * dx, py - ay - t * dy);
}
function streetAt(x, y) {
  let best = null, bd = 70;
  const cx = Math.floor(x / NCELL), cy = Math.floor(y / NCELL);
  for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) {
    const a = nameGrid.get((cx + i) + ',' + (cy + j)); if (!a) continue;
    for (const k of a) {
      const r = roads[named[k]], p = r.p;
      for (let q = 0; q < p.length - 2; q += 2) {
        const d = segDist(x, y, p[q], p[q + 1], p[q + 2], p[q + 3]) - (r.c === 9 ? 0 : 10);
        if (d < bd) { bd = d; best = r; }
      }
    }
  }
  return best ? D.names[best.n] : null;
}

// ---------- grafo de calles (trafico y peatones) ----------
function buildGraph(filter, oneways) {
  const key = (x, y) => Math.round(x * 4) + ',' + Math.round(y * 4);
  const cnt = new Map();
  const sel = roads.filter(filter);
  for (const r of sel) {
    const p = r.p, n = p.length / 2;
    for (let i = 0; i < n; i++) { const k = key(p[i * 2], p[i * 2 + 1]); cnt.set(k, (cnt.get(k) || 0) + (i === 0 || i === n - 1 ? 2 : 1)); }
  }
  const nodeId = new Map(), nodes = [], edges = [], adj = [];
  const node = (x, y) => { const k = key(x, y); let id = nodeId.get(k); if (id === undefined) { id = nodes.length; nodeId.set(k, id); nodes.push([x, y]); adj.push([]); } return id; };
  for (const r of sel) {
    const p = r.p, n = p.length / 2;
    let start = 0;
    for (let i = 1; i < n; i++) {
      if (i < n - 1 && cnt.get(key(p[i * 2], p[i * 2 + 1])) < 2) continue;
      const ep = p.slice(start * 2, i * 2 + 2);
      const cum = [0];
      for (let q = 2; q < ep.length; q += 2) cum.push(cum[cum.length - 1] + Math.hypot(ep[q] - ep[q - 2], ep[q + 1] - ep[q - 1]));
      const len = cum[cum.length - 1];
      if (len > 2) {
        const e = { p: ep, cum, len, a: node(ep[0], ep[1]), b: node(ep[ep.length - 2], ep[ep.length - 1]),
          one: oneways && (r.f & 2) !== 0, w: ROAD_W[r.c] * M, c: r.c, id: edges.length };
        edges.push(e);
        adj[e.a].push({ e, dir: 1 });
        if (!e.one) adj[e.b].push({ e, dir: -1 });
      }
      start = i;
    }
  }
  const grid = new Map(), GC = 256;
  for (const e of edges) for (let q = 0; q < e.p.length; q += 2) {
    const k = Math.floor(e.p[q] / GC) + ',' + Math.floor(e.p[q + 1] / GC); let a = grid.get(k); if (!a) grid.set(k, a = []);
    if (a[a.length - 1] !== e) a.push(e);
  }
  return { nodes, edges, adj, grid, GC };
}
const inMx = (r) => { const p = r.p; for (let i = 0; i < p.length; i += 2) if (p[i + 1] < borderY(p[i]) + 30) return false; return true; };
const traffic = buildGraph(r => r.c <= 6 && !(r.f & 4) && inMx(r), true);
// andadores (clases 8 y 9) que quedan dentro de una calle ya ensanchada se ignoran: si no, la gente camina sobre el asfalto
const footwayOnRoad = (r) => { let n = 0; for (let i = 0; i < r.p.length; i += 2) if (onRoad(r.p[i], r.p[i + 1])) n++; return n * 2 > r.p.length / 3; };
const walkG = buildGraph(r => r.c >= 2 && r.c <= 9 && r.c !== 7 && inMx(r) && !(r.c >= 8 && footwayOnRoad(r)), false);
// desplazamiento lateral de un peaton: en la banqueta del lado mas cercano a (x, y);
// con probabilidad `cross` elige la banqueta de enfrente (cruza la calle)
function pedSide(e, s, dir, x, y, cross) {
  if (e.c >= 8) return rnd(-3, 3);
  const off = e.w / 2 + rnd(0.6, 2.2) * M, a = edgePos(e, s, dir, off, {}), b = edgePos(e, s, dir, -off, {});
  const near = dist(a.x, a.y, x, y) <= dist(b.x, b.y, x, y) ? off : -off;
  return Math.random() < cross ? -near : near;
}

function edgePos(e, s, dir, lat, out) {
  let d = dir > 0 ? s : e.len - s; if (d < 0) d = 0; if (d > e.len) d = e.len;
  const cum = e.cum; let i = 1; while (i < cum.length - 1 && cum[i] < d) i++;
  const p = e.p, x0 = p[i * 2 - 2], y0 = p[i * 2 - 1], x1 = p[i * 2], y1 = p[i * 2 + 1];
  const t = (d - cum[i - 1]) / ((cum[i] - cum[i - 1]) || 1);
  let a = Math.atan2(y1 - y0, x1 - x0); if (dir < 0) a += Math.PI;
  out.x = x0 + (x1 - x0) * t - Math.sin(a) * lat;
  out.y = y0 + (y1 - y0) * t + Math.cos(a) * lat;
  out.a = a;
  return out;
}
function nextEdge(g, e, dir) {
  const n = dir > 0 ? e.b : e.a;
  let opts = g.adj[n].filter(o => o.e !== e);
  if (!opts.length) opts = g.adj[n];
  if (!opts.length) return null;
  const tmp = {}; edgePos(e, e.len - 0.5, dir, 0, tmp); const inA = tmp.a;
  let best = null, bs = -9;
  for (const o of opts) { edgePos(o.e, 1, o.dir, 0, tmp); const sc = Math.cos(angDiff(inA, tmp.a)) * 0.7 + Math.random(); if (sc > bs) { bs = sc; best = o; } }
  return best;
}
function randomEdgeNear(g, x, y, r0, r1) {
  for (let tries = 0; tries < 12; tries++) {
    const ang = Math.random() * Math.PI * 2, r = rnd(r0, r1);
    const px = x + Math.cos(ang) * r, py = y + Math.sin(ang) * r;
    const a = g.grid.get(Math.floor(px / g.GC) + ',' + Math.floor(py / g.GC));
    if (a && a.length) return pick(a);
  }
  return null;
}
function nearestOnGraph(g, x, y) {
  let best = null, bd = 1e9;
  for (const e of g.edges) {
    const p = e.p;
    for (let q = 0; q < p.length - 2; q += 2) {
      const d = segDist(x, y, p[q], p[q + 1], p[q + 2], p[q + 3]);
      if (d < bd) { bd = d; best = { e, s: e.cum[q / 2] }; }
    }
  }
  return best;
}

// ---------- faroles para la noche ----------
// cada ~90 px en calles de clase 0 a 5, a los dos lados; se guardan por celdas de 256 px para buscar solo los que se ven
const FAROLES = new Map();
for (const e of traffic.edges) {
  if (e.c > 5) continue;
  for (let s = 25; s < e.len - 10; s += 90) for (const side of [1, -1]) {
    const q = edgePos(e, s, 1, side * (e.w / 2 + 1.2 * M), {}), k = Math.floor(q.x / 256) + ',' + Math.floor(q.y / 256);
    let a = FAROLES.get(k); if (!a) FAROLES.set(k, a = []);
    if (a.some(o => Math.abs(o.x - q.x) < 35 && Math.abs(o.y - q.y) < 35)) continue; // calles encimadas
    a.push({ x: q.x, y: q.y });
  }
}

// ---------- ruta al destino (la linea tenue de puntos de las entregas, el taxi y el destino marcado) ----------
// se usa la red del trafico pero en los dos sentidos: en moto o a pie nadie respeta los sentidos
const routeAdj = traffic.nodes.map(() => []);
for (const e of traffic.edges) { routeAdj[e.a].push({ e, to: e.b, dir: 1 }); routeAdj[e.b].push({ e, to: e.a, dir: -1 }); }
// el punto de la red mas cercano a (x, y): solo se buscan las celdas de alrededor
function nearEdge(g, x, y) {
  const cx = Math.floor(x / g.GC), cy = Math.floor(y / g.GC);
  for (let r = 1; r <= 3; r++) {
    let best = null, bd = 1e9;
    for (let i = cx - r; i <= cx + r; i++) for (let j = cy - r; j <= cy + r; j++) for (const e of g.grid.get(i + ',' + j) || []) {
      const p = e.p;
      for (let q = 0; q < p.length - 2; q += 2) {
        const dx = p[q + 2] - p[q], dy = p[q + 3] - p[q + 1], l2 = dx * dx + dy * dy || 1;
        const t = Math.max(0, Math.min(1, ((x - p[q]) * dx + (y - p[q + 1]) * dy) / l2));
        const d = Math.hypot(p[q] + dx * t - x, p[q + 1] + dy * t - y);
        if (d < bd) { bd = d; best = { e, s: e.cum[q / 2] + t * Math.sqrt(l2), x: p[q] + dx * t, y: p[q + 1] + dy * t }; }
      }
    }
    if (best) return best;
  }
  const n = nearestOnGraph(g, x, y); if (!n) return null;
  const o = edgePos(n.e, n.s, 1, 0, {}); return { e: n.e, s: n.s, x: o.x, y: o.y };
}
// puntos del tramo e entre las distancias s0 y s1 (si s0 > s1 van al reves)
function edgeSlice(e, s0, s1, out) {
  const tmp = {}, cum = e.cum, p = e.p;
  edgePos(e, s0, 1, 0, tmp); out.push(tmp.x, tmp.y);
  if (s0 < s1) { for (let i = 0; i < cum.length; i++) if (cum[i] > s0 && cum[i] < s1) out.push(p[i * 2], p[i * 2 + 1]); }
  else for (let i = cum.length - 1; i >= 0; i--) if (cum[i] < s0 && cum[i] > s1) out.push(p[i * 2], p[i * 2 + 1]);
  edgePos(e, s1, 1, 0, tmp); out.push(tmp.x, tmp.y);
}
// camino mas corto por las calles de (x0, y0) a (x1, y1) con A*; devuelve [x, y, x, y, ...]
function findRoute(x0, y0, x1, y1) {
  const g = traffic, A = nearEdge(g, x0, y0), B = nearEdge(g, x1, y1);
  if (!A || !B) return null;
  const out = [x0, y0];
  if (A.e === B.e) { edgeSlice(A.e, A.s, B.s, out); out.push(x1, y1); return out; }
  const N = g.nodes.length, cost = new Float64Array(N).fill(Infinity), prev = new Array(N);
  const h = (n) => Math.hypot(g.nodes[n][0] - B.x, g.nodes[n][1] - B.y);
  const heap = []; // [f, nodo], monticulo binario por f
  const push = (f, n) => { heap.push([f, n]); let i = heap.length - 1; while (i > 0) { const pi = (i - 1) >> 1; if (heap[pi][0] <= heap[i][0]) break; [heap[pi], heap[i]] = [heap[i], heap[pi]]; i = pi; } };
  const pop = () => { const top = heap[0], last = heap.pop(); if (heap.length) { heap[0] = last; let i = 0; for (;;) { const l = i * 2 + 1, r = l + 1; let m = i; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === i) break; [heap[m], heap[i]] = [heap[i], heap[m]]; i = m; } } return top; };
  cost[A.e.a] = A.s; push(A.s + h(A.e.a), A.e.a);
  if (A.e.len - A.s < cost[A.e.b]) { cost[A.e.b] = A.e.len - A.s; push(cost[A.e.b] + h(A.e.b), A.e.b); }
  let best = Infinity, end = -1;
  while (heap.length) {
    const [f, n] = pop();
    if (f >= best) break;
    if (f > cost[n] + h(n) + 1e-6) continue; // entrada vieja
    const fin = n === B.e.a ? B.s : n === B.e.b ? B.e.len - B.s : -1;
    if (fin >= 0 && cost[n] + fin < best) { best = cost[n] + fin; end = n; }
    for (const o of routeAdj[n]) {
      const c = cost[n] + o.e.len;
      if (c < cost[o.to]) { cost[o.to] = c; prev[o.to] = o; push(c + h(o.to), o.to); }
    }
  }
  if (end < 0) return null;
  // hacia atras por prev (el costo siempre baja, asi que se termina en uno de los dos extremos del tramo A)
  const steps = []; let n = end;
  while (prev[n]) { const o = prev[n]; steps.push(o); n = o.dir > 0 ? o.e.a : o.e.b; }
  steps.reverse();
  edgeSlice(A.e, A.s, n === A.e.a ? 0 : A.e.len, out);
  for (const o of steps) edgeSlice(o.e, o.dir > 0 ? 0 : o.e.len, o.dir > 0 ? o.e.len : 0, out);
  edgeSlice(B.e, end === B.e.a ? 0 : B.e.len, B.s, out);
  out.push(x1, y1);
  return out;
}

// ---------- locales de "comida china" (ficticios) en la Calle Coahuila: aqui se pierde dinero ----------
const CHINA_NAMES = ['Comida China Dragón Dorado', 'Comida China El Panda Feliz', 'Comida China Flor de Loto',
  'Comida China La Gran Muralla', 'Comida China Palacio Imperial', 'Comida China Fénix Rojo'];
const chinas = (() => {
  const out = [], tmp = {};
  const coah = traffic.edges.filter(e => {
    const r = roads.find(q => q.p[0] === e.p[0] && q.p[1] === e.p[1]) || roads.find(q => q.p.includes(e.p[0]) && q.p.includes(e.p[1]));
    return r && r.n >= 0 && D.names[r.n] === 'Calle Coahuila';
  });
  for (const e of coah) {
    if (out.length >= CHINA_NAMES.length) break;
    if (e.len < 120) continue;
    edgePos(e, e.len / 2, 1, (out.length % 2 ? -1 : 1) * (e.w / 2 + 1.5 * M), tmp);
    if (out.some(o => dist(o.x, o.y, tmp.x, tmp.y) < 300)) continue;
    out.push({ name: CHINA_NAMES[out.length], x: tmp.x, y: tmp.y, cool: 0 });
  }
  return out;
})();

// ---------- detalles de la calle: topes y baches ----------
function mulberry(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const topes = [], baches = [];
(() => {
  for (const e of traffic.edges) {
    if (e.c < 4 || e.len < 160 || hash(e.id * 7 + 3) % 3 !== 0) continue;
    const q = edgePos(e, e.len / 2, 1, 0, {});
    topes.push({ x: q.x, y: q.y, a: q.a, w: e.w, bb: [q.x - 40, q.y - 40, q.x + 40, q.y + 40] });
  }
  // baches: uno cada ~600 m de calle en promedio, en cualquier carril, lejos de las esquinas
  for (const e of traffic.edges) {
    if (e.c > 6 || e.len < 120) continue;
    const rnd = mulberry(e.id * 131 + 17);
    for (let n = e.len / 3000 + rnd(); n >= 1; n--) {
      const q = edgePos(e, e.len * (0.2 + rnd() * 0.6), 1, (rnd() - 0.5) * (e.w - 16), {});
      const r = 6 + rnd() * 6;
      baches.push({ x: q.x, y: q.y, a: rnd() * 6.3, r, seed: (rnd() * 1e9) | 0, bb: [q.x - r - 4, q.y - r - 4, q.x + r + 4, q.y + r + 4] });
    }
  }
})();
const chunkTopes = gridIndex(topes, CHUNK, 'bb');
const TCELL = 128;
const topeGrid = gridIndex(topes, TCELL, 'bb');
function topesNear(x, y) { return topeGrid.get(Math.floor(x / TCELL) + ',' + Math.floor(y / TCELL)) || []; }
const chunkBaches = gridIndex(baches, CHUNK, 'bb');
const bacheGrid = gridIndex(baches, TCELL, 'bb');
function bachesNear(x, y) { return bacheGrid.get(Math.floor(x / TCELL) + ',' + Math.floor(y / TCELL)) || []; }

// ---------- dibujo de trozos del mapa ----------
function trace(ctx, p, close) {
  ctx.beginPath(); ctx.moveTo(p[0], p[1]);
  for (let i = 2; i < p.length; i += 2) ctx.lineTo(p[i], p[i + 1]);
  if (close) ctx.closePath();
}
// mugre: manchas, aceite, grietas, baches y alcantarillas, siempre igual para la misma calle
function grime(ctx, list, cx, cy) {
  const X0 = cx * CHUNK - 40, Y0 = cy * CHUNK - 40, X1 = X0 + CHUNK + 80, Y1 = Y0 + CHUNK + 80;
  for (const r of list) {
    if (r.c > 7) continue;
    const w = ROAD_W[r.c] * M;
    const rng = mulberry(r.i * 9973 + 17), p = r.p;
    for (let q = 0; q < p.length - 2; q += 2) {
      const ax = p[q], ay = p[q + 1], dx = p[q + 2] - ax, dy = p[q + 3] - ay, len = Math.hypot(dx, dy);
      const a = Math.atan2(dy, dx), nx = -dy / (len || 1), ny = dx / (len || 1);
      for (let t = 0; t < len; t += 16) {
        const k = rng(), lat = (rng() - 0.5) * (w - 14), x = ax + dx * t / len + nx * lat, y = ay + dy * t / len + ny * lat;
        const r1 = rng(), r2 = rng();
        if (x < X0 || x > X1 || y < Y0 || y > Y1) continue;
        ctx.save(); ctx.translate(x, y); ctx.rotate(a);
        if (k < 0.12) {
          ctx.fillStyle = r1 < 0.6 ? 'rgba(15,15,18,0.16)' : 'rgba(150,140,115,0.12)';
          ctx.beginPath(); ctx.ellipse(0, 0, 6 + r2 * 14, 4 + r1 * 8, r2 * 3, 0, 7); ctx.fill();
        } else if (k < 0.16) {
          ctx.fillStyle = 'rgba(5,5,8,0.32)';
          ctx.beginPath(); ctx.ellipse(0, 0, 5 + r1 * 5, 2 + r2 * 2, 0, 0, 7); ctx.fill();
        } else if (k < 0.185) {
          ctx.strokeStyle = 'rgba(10,10,12,0.5)'; ctx.lineWidth = 1;
          ctx.beginPath(); ctx.moveTo(-10, 0);
          for (let j = 1; j <= 4; j++) ctx.lineTo(-10 + j * 5 + (rng() - 0.5) * 3, (rng() - 0.5) * 8);
          ctx.stroke();
        } else if (k < 0.193 && r.c >= 4) {
          ctx.fillStyle = 'rgba(160,150,125,0.45)'; ctx.beginPath();
          for (let j = 0; j < 7; j++) { const an = j / 7 * 6.283, rr = 6 + rng() * 4; ctx.lineTo(Math.cos(an) * rr, Math.sin(an) * rr * 0.75); }
          ctx.closePath(); ctx.fill();
          ctx.fillStyle = '#232326'; ctx.scale(0.75, 0.75); ctx.fill();
        } else if (k < 0.2) {
          ctx.fillStyle = '#2b2b2e'; ctx.strokeStyle = '#5c5c60'; ctx.lineWidth = 1.5;
          ctx.beginPath(); ctx.arc(0, 0, 5, 0, 7); ctx.fill(); ctx.stroke();
          ctx.beginPath(); ctx.moveTo(-3, -1.5); ctx.lineTo(3, -1.5); ctx.moveTo(-3, 1.5); ctx.lineTo(3, 1.5); ctx.stroke();
        }
        ctx.restore();
      }
    }
  }
}
function roadMarks(ctx, k) {
  // baches: hoyo irregular oscuro con orilla de asfalto quebrado y algo de grava
  for (const i of chunkBaches.get(k) || []) {
    const b = baches[i], rnd = mulberry(b.seed), pts = [];
    for (let j = 0; j < 9; j++) { const a = j / 9 * Math.PI * 2, rr = b.r * (0.7 + rnd() * 0.45); pts.push([Math.cos(a) * rr, Math.sin(a) * rr * 0.8]); }
    ctx.save(); ctx.translate(b.x, b.y); ctx.rotate(b.a);
    const path = (sc) => { ctx.beginPath(); pts.forEach(([x, y], j) => j ? ctx.lineTo(x * sc, y * sc) : ctx.moveTo(x * sc, y * sc)); ctx.closePath(); };
    path(1.35); ctx.fillStyle = 'rgba(92,88,80,0.75)'; ctx.fill(); ctx.strokeStyle = 'rgba(30,30,30,0.5)'; ctx.lineWidth = 0.8; ctx.stroke();
    path(1); ctx.fillStyle = '#1b1a19'; ctx.fill();
    ctx.save(); ctx.clip(); ctx.fillStyle = 'rgba(0,0,0,0.5)'; ctx.translate(-2, -2); path(1); ctx.fill(); ctx.restore();
    ctx.fillStyle = '#6a655c'; for (let j = 0; j < 6; j++) ctx.fillRect((rnd() - 0.5) * b.r * 2.6, (rnd() - 0.5) * b.r * 2.2, 1.6, 1.6);
    ctx.restore();
  }
  for (const i of chunkTopes.get(k) || []) {
    const t = topes[i];
    ctx.save(); ctx.translate(t.x, t.y); ctx.rotate(t.a);
    ctx.fillStyle = 'rgba(0,0,0,0.35)'; ctx.fillRect(-2, -t.w / 2, 8, t.w);
    for (let l = -t.w / 2, j = 0; l < t.w / 2; l += 6, j++) { ctx.fillStyle = j % 2 ? '#2a2a2a' : '#d9b21f'; ctx.fillRect(-3, l, 6, Math.min(6, t.w / 2 - l)); }
    ctx.restore();
  }
}
// Edificios con volumen (vista oblicua fija, como si la camara estuviera un poco al sur).
// Por cada grupo de alturas se pinta una capa con los techos, se le borra lo que cae sobre calles y
// banquetas (para que coincida con donde se puede pasar) y se apila varias veces hacia arriba en un
// tono mas oscuro: eso forma las paredes del frente. Se hace una sola vez por trozo del mapa,
// asi que no cuesta nada mientras se juega.
const LIFTS = [[5, 10], [9, 18], [16, 26], [1e9, 42]]; // (elevacion - 2 multiplo de 4: ver la pila de paredes) // [altura maxima en m, elevacion del techo en px]
const bRoof = document.createElement('canvas'), bWall = document.createElement('canvas'), bWall2 = document.createElement('canvas'), bWin = document.createElement('canvas'), bStack = document.createElement('canvas');
// las capas son EXTRA_UP px mas altas que el trozo: los techos de abajo se elevan y entran a este trozo
// y LEAN_PAD px mas anchas a la izquierda: los techos se recargan un poco a la derecha (se ve la pared oeste)
const LEAN = 0.25, LEAN_PAD = Math.ceil(EXTRA_UP * LEAN) + 2;
// las capas miden BW x BH pixeles del mundo pero tienen RES veces mas pixeles; sus contextos dibujan
// escalados por RES, y al copiar entre capas el rectangulo de origen va en pixeles de la capa (x RES)
const BW = CHUNK + 2 + LEAN_PAD, BH = CHUNK + 2 + EXTRA_UP;
for (const c of [bRoof, bWall, bWall2, bWin, bStack]) { c.width = BW * RES; c.height = BH * RES; c.getContext('2d', CTX2D).setTransform(RES, 0, 0, RES, 0, 0); }
const blit = (dst, src, sx, sy, sw, sh, dx, dy, dw, dh) => dst.drawImage(src, sx * RES, sy * RES, sw * RES, sh * RES, dx, dy, dw, dh);
// cada piso de la pared son 4 capas: linea de entrepiso, dos de ventanas y pared
const wallLayer = (k) => { const m = k % 4; return m === 0 ? bWall2 : m === 3 ? bWall : bWin; };
function* drawBuildings(ctx, bl, rs, cx, cy) {
  const g = bRoof.getContext('2d');
  let lo = 0;
  for (const [hmax, L] of LIFTS) {
    const group = bl.filter(b => b.h >= lo && b.h < hmax); lo = hmax;
    if (!group.length) continue;
    // solo se trabaja en el rectangulo que ocupan los edificios del grupo (en pixeles de la capa)
    let rx0 = 1e9, ry0 = 1e9, rx1 = -1e9, ry1 = -1e9;
    for (const b of group) { rx0 = Math.min(rx0, b.bb[0]); ry0 = Math.min(ry0, b.bb[1]); rx1 = Math.max(rx1, b.bb[2]); ry1 = Math.max(ry1, b.bb[3]); }
    rx0 = Math.max(0, Math.floor(rx0 - cx * CHUNK + LEAN_PAD - 3)); rx1 = Math.min(BW, Math.ceil(rx1 - cx * CHUNK + LEAN_PAD + 4));
    ry0 = Math.max(0, Math.floor(ry0 - cy * CHUNK - 3)); ry1 = Math.min(BH, Math.ceil(ry1 - cy * CHUNK + 4));
    if (rx1 <= rx0 || ry1 <= ry0) continue;
    const rw = rx1 - rx0, rh = ry1 - ry0;
    const cp = (dst, src, dx, dy) => blit(dst, src, rx0, ry0, rw, rh, rx0 + dx, ry0 + dy, rw, rh);
    g.setTransform(RES, 0, 0, RES, 0, 0); g.clearRect(0, 0, BW, BH);
    g.translate(1 + LEAN_PAD - cx * CHUNK, 1 - cy * CHUNK); g.lineJoin = 'round';
    for (const b of group) {
      trace(g, b.p, true); g.fillStyle = b.col; g.fill();
      // luz desde el noroeste: el techo se aclara arriba a la izquierda y se oscurece abajo a la derecha
      if (b.bb[2] - b.bb[0] > 16 || b.bb[3] - b.bb[1] > 16) {
      const lg = g.createLinearGradient(b.bb[0], b.bb[1], b.bb[2], b.bb[3]);
      lg.addColorStop(0, 'rgba(255,255,255,0.13)'); lg.addColorStop(1, 'rgba(0,0,0,0.13)');
      g.fillStyle = lg; g.fill();
      }
      g.lineWidth = 2.5; g.strokeStyle = 'rgba(0,0,0,0.3)'; g.stroke();
      g.lineWidth = 1; g.strokeStyle = 'rgba(255,255,255,0.16)'; g.stroke(); // pretil
      // tinacos negros en las azoteas, de rigor
      const bw = b.bb[2] - b.bb[0], bh = b.bb[3] - b.bb[1], hh = hash(b.p.length * 31 + (b.bb[0] | 0));
      if (bw > 22 && bh > 22 && hh % 5 < 2) {
        const tx = b.bb[0] + bw * (0.3 + (hh >> 4) % 40 / 100), ty = b.bb[1] + bh * (0.3 + (hh >> 10) % 40 / 100);
        g.fillStyle = 'rgba(0,0,0,0.35)'; g.beginPath(); g.arc(tx + 1.5, ty + 1.5, 3.4, 0, 7); g.fill();
        g.fillStyle = '#1c1c1c'; g.beginPath(); g.arc(tx, ty, 3.4, 0, 7); g.fill();
        g.fillStyle = '#3a3a3a'; g.beginPath(); g.arc(tx - 0.8, ty - 0.8, 1.6, 0, 7); g.fill();
      }
      if (b.h >= 7 && b.bb[2] - b.bb[0] > 30 && b.bb[3] - b.bb[1] > 30) {
        const mx = (b.bb[0] + b.bb[2]) / 2, my = (b.bb[1] + b.bb[3]) / 2;
        g.save(); g.translate(mx, my); g.scale(0.8, 0.8); g.translate(-mx, -my);
        trace(g, b.p, true); g.fillStyle = 'rgba(255,255,255,0.10)'; g.fill(); g.restore();
        if (hash(b.p.length + (mx | 0)) % 3 === 0) { g.fillStyle = 'rgba(60,60,60,0.55)'; g.fillRect(mx - 6, my - 4, 12, 8); }
      }
    }
    // borrar lo que cae sobre calles y banquetas
    g.globalCompositeOperation = 'destination-out'; g.lineCap = 'round'; g.strokeStyle = '#000';
    for (const r of rs) {
      if (r.c > 7) continue;
      g.lineWidth = (r.c <= 6 ? ROAD_W[r.c] + SIDEWALK * 2 : ROAD_W[r.c] + 1) * M;
      trace(g, r.p); g.stroke();
    }
    g.globalCompositeOperation = 'source-over';
    yield;
    // versiones oscuras para las paredes (una un poco mas oscura para marcar los pisos)
    for (const [cv, a] of [[bWall, 0.36], [bWall2, 0.16], [bWin, 0.36]]) {
      const w = cv.getContext('2d'); w.clearRect(rx0, ry0, rw, rh); cp(w, bRoof, 0, 0);
      w.globalCompositeOperation = 'source-atop'; w.fillStyle = 'rgba(0,0,0,' + a + ')'; w.fillRect(rx0, ry0, rw, rh);
      if (cv === bWin) { // ventanas: columnas alineadas al mapa, unas con luz
        const x0 = cx * CHUNK - 1 - LEAN_PAD, ox = (x0 % 8 + 8) % 8;
        for (let x = rx0 - (rx0 + ox) % 8; x < rx1; x += 8) {
          const lit = hash(((x0 + x) / 8 | 0) * 13 + cy) % 12 === 0;
          w.fillStyle = lit ? 'rgba(255,214,120,0.6)' : 'rgba(25,35,50,0.55)'; w.fillRect(x + 2.5, ry0, 3, rh);
        }
      }
      w.globalCompositeOperation = 'source-over';
    }
    yield;
    // apilar la pared L veces: se arman 4 capas y se duplica la pila sobre si misma (4, 8, 16...)
    // en vez de pintar capa por capa; las que sobran se pintan una por una
    const st = bStack.getContext('2d');
    // (el patron se repite cada 4 capas y 4*LEAN es entero, asi que duplicar la pila lo conserva)
    const lx = (k) => Math.round(k * LEAN);
    const top = L - 2, base = Math.min(top, 4);
    st.clearRect(0, Math.max(0, ry0 - L - 1), BW, rh + L + 2); cp(st, bWall2, 0, 0);
    for (let k = 1; k < base; k++) cp(st, wallLayer(k), lx(k), -k);
    // al duplicar, la pila ya mide n capas: se copia el rectangulo crecido hacia arriba
    const cps = (dx, dy, n) => blit(st, bStack, rx0, ry0 - n, rw + lx(n), rh + n, rx0 + dx, ry0 - n + dy, rw + lx(n), rh + n);
    let n = base;
    while (n * 2 <= top) { cps(lx(n), -n, n); n *= 2; }
    if (n < top) cps(lx(top - n), n - top, n); // lo que falta: la misma pila corrida (top - n es multiplo de 4)
    cp(st, bWall, lx(top), -top); cp(st, bWall2, lx(top + 1), -top - 1); // cornisa clara arriba
    yield;
    ctx.save(); ctx.setTransform(RES, 0, 0, RES, 0, 0);
    const sy0 = Math.max(0, ry0 - L - 1), sw = Math.min(BW - rx0, rw + lx(L) + 1);
    blit(ctx, bStack, rx0, sy0, sw, ry1 - sy0, rx0 - LEAN_PAD, sy0, sw, ry1 - sy0);
    blit(ctx, bRoof, rx0, ry0, rw, rh, rx0 + lx(L) - LEAN_PAD, ry0 - L, rw, rh);
    ctx.restore();
  }
}
// Un trozo se pinta por pasos (generador): asi se reparte en varios cuadros y no da tirones.
// Las capas de los edificios (bRoof...) se comparten, asi que solo puede haber un trozo a medias a la vez.
function* chunkSteps(cx, cy) {
  const cv = document.createElement('canvas'); cv.width = cv.height = (CHUNK + 2) * RES;
  const ctx = cv.getContext('2d', CTX2D);
  ctx.scale(RES, RES); ctx.translate(1 - cx * CHUNK, 1 - cy * CHUNK);
  ctx.fillStyle = COL.ground; ctx.fillRect(cx * CHUNK - 1, cy * CHUNK - 1, CHUNK + 2, CHUNK + 2);
  const k = cx + ',' + cy;
  for (const i of chunkAreas.get(k) || []) { const a = areas[i]; ctx.fillStyle = AREA_COL[a.k]; trace(ctx, a.p, true); ctx.fill(); }
  const rs = (chunkRoads.get(k) || []).map(i => roads[i]);
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  const pass = (list, width, color, filter, off) => {
    for (const r of list) {
      if (!filter(r)) continue;
      ctx.strokeStyle = typeof color === 'function' ? color(r) : color; ctx.lineWidth = width(r);
      for (const d of off ? off(r) : [0]) { trace(ctx, d ? offsetLine(r, d) : r.p); ctx.stroke(); }
    }
  };
  const ground = rs.filter(r => !(r.f & 1));
  const bridges = rs.filter(r => r.f & 1);
  // debajo de los edificios: agua, andadores y vias del tren
  const under = (list) => {
    pass(list, r => ROAD_W[r.c] * M, COL.water, r => r.c === 11);
    pass(list, r => ROAD_W[r.c] * M, r => r.c === 8 ? COL.paving : COL.footway, r => r.c === 8 || r.c === 9);
    pass(list, () => 3 * M, COL.rail, r => r.c === 10);
    ctx.setLineDash([2, 6]); pass(list, () => 3 * M, '#3a2d22', r => r.c === 10);
    ctx.setLineDash([]); pass(list, () => 1, '#9a9aa0', r => r.c === 10);
  };
  // encima de los edificios: calles con banqueta y lineas de carril
  const over = (list) => {
    pass(list, r => (ROAD_W[r.c] + SIDEWALK * 2 + 0.5) * M, COL.curb, r => r.c <= 6);
    pass(list, r => (ROAD_W[r.c] + SIDEWALK * 2) * M, COL.sidewalk, r => r.c <= 6);
    pass(list, r => (ROAD_W[r.c] + 1) * M, COL.sidewalk, r => r.c === 7);
    // orilla polvosa junto a la banqueta; el asfalto limpio de los cruces la tapa
    pass(list, r => ROAD_W[r.c] * M, '#4b4842', r => r.c <= 7);
    pass(list, r => ROAD_W[r.c] * M - 9, COL.asphalt, r => r.c <= 7);
    const q = r => ROAD_W[r.c] * M / 4;
    ctx.setLineDash([]);
    pass(list, () => 2, COL.yellow, r => r.c <= MAJOR && !(r.f & 2), () => [-2, 2]);
    ctx.setLineDash([16, 16]);
    pass(list, () => 2, COL.white, r => r.c <= MAJOR && !(r.f & 2), r => [-q(r), q(r)]);
    // rampas y viaductos de un sentido se enciman entre si: sin lineas para no ensuciar
    pass(list, () => 2, COL.white, r => r.c >= 2 && r.c <= MAJOR && (r.f & 2) && !r.curvy, r => [-q(r), 0, q(r)]);
    pass(list, () => 2, COL.yellow, r => r.c === 4 && !(r.f & 2));
    pass(list, () => 2, COL.white, r => r.c === 4 && (r.f & 2) && !r.curvy);
    ctx.setLineDash([]);
  };
  under(ground);
  const bl = (chunkBlds.get(k) || []).map(i => blds[i]);
  ctx.fillStyle = 'rgba(0,0,0,0.26)';
  for (const b of bl) { ctx.save(); ctx.translate(b.sh, b.sh); trace(ctx, b.p, true); ctx.fill(); ctx.restore(); }
  yield;
  over(ground);
  grime(ctx, ground, cx, cy);
  roadMarks(ctx, k);
  if (bridges.length) {
    pass(bridges, r => (ROAD_W[r.c] + 6) * M, 'rgba(0,0,0,0.35)', r => r.c <= 7);
    under(bridges); over(bridges); grime(ctx, bridges, cx, cy);
  }
  yield;
  yield* drawBuildings(ctx, bl, rs, cx, cy);
  // lado de Estados Unidos
  const x0 = cx * CHUNK, x1 = x0 + CHUNK;
  if (borderY(x0) > cy * CHUNK || borderY(x1) > cy * CHUNK) {
    ctx.beginPath(); ctx.moveTo(x0 - 2, cy * CHUNK - 2); ctx.lineTo(x1 + 2, cy * CHUNK - 2);
    ctx.lineTo(x1 + 2, borderY(x1 + 2)); ctx.lineTo(x0 - 2, borderY(x0 - 2)); ctx.closePath();
    ctx.fillStyle = COL.us; ctx.fill();
    ctx.strokeStyle = COL.fence; ctx.lineWidth = 7; ctx.beginPath(); ctx.moveTo(x0 - 2, borderY(x0 - 2)); ctx.lineTo(x1 + 2, borderY(x1 + 2)); ctx.stroke();
    ctx.strokeStyle = '#2b1d12'; ctx.lineWidth = 7; ctx.setLineDash([2, 5]); ctx.stroke(); ctx.setLineDash([]);
    ctx.fillStyle = 'rgba(255,255,255,0.35)'; ctx.font = 'bold 28px sans-serif';
    for (let x = Math.ceil(x0 / 900) * 900 + 300; x < x1; x += 900) ctx.fillText('EE. UU.', x, borderY(x) - 60);
  }
  return cv;
}
// el trozo completo de una vez (al arrancar y para pruebas)
function drawChunk(cx, cy) { const it = chunkSteps(cx, cy); let r; while (!(r = it.next()).done); return r.value; }

// ---------- minimapa ----------
const MS = 0.08;
const miniFull = document.createElement('canvas');
miniFull.width = Math.ceil(WORLD_W * MS); miniFull.height = Math.ceil(WORLD_H * MS);
(() => {
  const c = miniFull.getContext('2d');
  c.fillStyle = '#6d6858'; c.fillRect(0, 0, miniFull.width, miniFull.height);
  c.scale(MS, MS);
  for (const a of areas) { c.fillStyle = AREA_COL[a.k]; trace(c, a.p, true); c.fill(); }
  c.fillStyle = '#9a917e'; for (const b of blds) { trace(c, b.p, true); c.fill(); }
  c.lineCap = 'round';
  for (const r of roads) {
    if (r.c > 9) { if (r.c === 11) { c.strokeStyle = COL.water; c.lineWidth = 60; trace(c, r.p); c.stroke(); } continue; }
    c.strokeStyle = r.c <= 2 ? '#f2d16b' : r.c <= 6 ? '#2e2e33' : r.c === 7 ? '#55555a' : '#c8bda4';
    c.lineWidth = Math.max(ROAD_W[r.c] * M, r.c <= 6 ? 50 : 25); trace(c, r.p); c.stroke();
  }
  c.fillStyle = 'rgba(30,36,30,0.85)';
  c.beginPath(); c.moveTo(0, 0); c.lineTo(WORLD_W, 0); c.lineTo(WORLD_W, borderY(WORLD_W)); c.lineTo(0, borderY(0)); c.closePath(); c.fill();
  c.strokeStyle = '#a0522d'; c.lineWidth = 40; c.beginPath(); c.moveTo(0, borderY(0)); c.lineTo(WORLD_W, borderY(WORLD_W)); c.stroke();
})();

// ---------- estado guardado ----------
const SAVE_KEY = 'tjgta-centro-v1';
const state = { money: 0, found: [], eaten: [] };
try { Object.assign(state, JSON.parse(localStorage.getItem(SAVE_KEY) || '{}')); } catch (e) { /* sin almacenamiento */ }
landmarks.forEach(l => { l.found = state.found.includes(l.name); });
tacos.forEach(t => { t.eaten = state.eaten.includes(t.name); });
state.cafes = state.cafes || [];
cafes.forEach(c => { c.drunk = state.cafes.includes(c.name); });
state.eggs = state.eggs || [];
EGGS.forEach(e => { e.got = state.eggs.includes(e.k); });
// premios por completar colecciones (ver checkPerks) y contadores para el Acta de Tijuanense
state.celebrated = state.celebrated || []; state.deliveries = state.deliveries || 0; state.rides = state.rides || 0;
const perks = () => {
  const p = { cafe: cafes.every(c => c.drunk), taco: tacos.every(t => t.eaten), noche: landmarks.every(l => l.found) };
  p.final = p.cafe && p.taco && p.noche;
  return p;
};
// en la app tambien se guarda en el almacen nativo (ver partidaNativa en index.html)
const PREFS = window.Capacitor && Capacitor.Plugins && Capacitor.Plugins.Preferences;
let noGuardar = false; // al importar una partida se recarga sin pisarla con la de memoria
function save() {
  if (noGuardar) return;
  state.found = landmarks.filter(l => l.found).map(l => l.name);
  state.eaten = tacos.filter(t => t.eaten).map(t => t.name);
  state.cafes = cafes.filter(c => c.drunk).map(c => c.name);
  state.eggs = EGGS.filter(e => e.got).map(e => e.k);
  state.t = Date.now();
  const json = JSON.stringify(state);
  try { localStorage.setItem(SAVE_KEY, json); } catch (e) { /* sin almacenamiento */ }
  if (PREFS) PREFS.set({ key: SAVE_KEY, value: json }).catch(() => {});
}

// ---------- frases ----------
const FRASES_ROBO = [
  '¡Ey, mi carro!', '¡Ese carro tiene más multas que yo, suerte!', '¡Auxilio, me lo bajaron!', '¡No manches, todavía lo estoy pagando!',
  '¡Llévatelo, pero cámbiale el aceite!', '¡Ni lo laves, ya así está bonito!', '¡Le falta la segunda, ahí te encargo!',
  '¡Mi jefa me va a matar!', '¡Era de mi compadre, ni es mío!', '¡Chale, y con el tanque lleno!',
  '¡Ya ni la amuelas, güey!', '¡Ahí van mis 14 abonos!', '¡Al menos ponle gasolina, rata!',
  '¡Por lo menos devuélveme mis lentes!', '¡Se me olvidó adentro el pollo asado!', '¡Cuidado, frena con el de mano!',
  '¡Ese no tiene placas, buena suerte!', '¡Lo saqué del yonke ayer!', '¡Me lo lleva el diablo... y tú!',
  '¡Ni modo, me regreso en calafia!',
];
const FRASES_ATROPELLO = [
  '¡Ay, mi espalda!', '¡Fíjate, güey!', '¡Aguas!', '¡No soy de hule, perro!', '¡No seas mamón!',
  '¡Iba por unas tortillas nomás!', '¡Me tumbaste el elote!', '¡Ni el Uber me había atropellado tan feo!',
  '¡Ya llegué tarde a la maquila, gracias!', '¡Te voy a quemar en el Face!', '¡Le voy a decir a mi mamá!', '¡Estaba en la banqueta, menso!',
  '¡Ya me tocaba vacaciones, gracias!', '¡No vi el semáforo... porque no hay!', '¡Me arruinaste los tenis nuevos!',
  '¡Uy, eso va a dejar marca!', '¡Pinche carro, ni frenó!', '¡Me debes un tejuino!',
  '¡Ando de buenas, si no, te bajo!', '¡Ahí te va la cuenta del Seguro, compa!',
];
const FRASES_POLI = [
  '¡Ahí nomás, joven! Vamos arreglándonos.',
  '¿Me da pa\'l refresco o nos vamos a la delegación?',
  '¡Le chocaste la troca al comandante!',
  'Licencia, tarjeta de circulación... y cooperación.',
  'Mire nomás cómo me dejó la defensa.',
  'Ni modo, la multa es por el susto.',
  'Con esto sale la carne asada del viernes.',
  '¡Órale! Ahí se va su quincena.',
  'Nomás porque ando de buenas: la mitad de su cartera.',
  '¡Daños a la patrulla! Eso es delito federal... o casi.',
  'Ya se le cayó el sistema, mi joven.',
  '¿Y la placa? ¿Y el seguro? ¿Y la vergüenza?',
];
// cuando se te acaba el aire de tanto correr
const FRASES_CANSADO = ['¡Te bofeaste!', 'Mucho taco y poco ejercicio.', 'Se te salió un pulmón, compa.', 'Así no llegas ni a la fila de la garita.',
  'Pa\'l otra, menos caguama.', 'Échate un aguita, campeón.', 'Ya no das ni un paso más, ¿verdad?', 'Te faltó el aire, viejo lobo.'];
const STAMINA = 5; // segundos que aguantas corriendo
const FIESTA_SECS = 32;  // lo que dura la fiesta de la Plaza Santa Cecilia
const MARI_SWAY = 333;   // mecerse al compas del vals (un tiempo a 180 bpm)
// al llegar a un cafe
const FRASES_CAFE = ['Un americano para el camino.', 'Café de olla bien cargado.', 'Un latte con pan dulce.', 'Un cold brew, que hace calor.',
  'Un espresso doble, pa\' despertar hasta al compa.', 'Un capuchino con canela y un ratito de wifi.', 'Un matcha bien verde, pa\' sentirte fresa de la Zona Río.',
  'Un frappé de cajeta, ni modo, se antojó.', 'Un mocha con concha de chocolate.', 'Café con leche como el de la abuela.',
  'Un dirty chai: especias, espresso y cero arrepentimientos.', 'Un pour over y un barista explicándote el grano.', 'Un descafeinado... ¿y para qué viniste?'];
// al caer en un bache
const FRASES_BACHE = ['¡Ese bache tenía su propio código postal!', 'Ahí se fue la suspensión, compa.', 'Bache tijuanense: si lo tapan, lo extrañan.',
  '¡Uy! Ese ya hasta paga predial.', 'Gracias, Ayuntamiento.', '¿Bache o alberca? Ni el gobierno sabe.', 'Se te cayó hasta la placa.',
  'Ese bache tiene más años que la Revu.', 'Directo a la vulcanizadora.', 'Ni el Mimo Moy se hace que no lo vio.',
  'Ahí vive una familia de tlacuaches.', 'Ese bache sale en Google Maps.'];
// lo que te dice la gente cuando te le pegas caminando, agrupado por tema:
// cada tema tiene su propio globo (ver .bubble en style.css)
const FRASES = {
  historia: [
    'En 1911 los magonistas tomaron Tijuana. Y luego llegaron los gringos a tomar tequila.',
    'Mi abuelo dice que vio a Rita Hayworth en el Agua Caliente. Mi abuelo dice muchas cosas.',
    'La ensalada César se inventó aquí, no en Italia. Apúntalo.',
    'En la Ley Seca los gringos venían a la Revu a echarse lo que allá no podían.',
    'Antes la línea se cruzaba en diez minutos. Ahora llévate lonche y cobija.',
    'Tijuana se fundó en 1889. Desde entonces estamos esperando que alguien termine las obras del bulevar.',
    'El Casino Agua Caliente era lo más elegante del mundo. Luego Cárdenas lo cerró y nos quedamos con la torre y la nostalgia.',
    'Dicen que el nombre viene de una tal Tía Juana que tenía un rancho. Nadie la conoció, pero todos la mencionan.',
    'El Jai Alai lleva más de setenta años parado en la Revu. Ha visto más cosas que un taxista de la Sexta.',
    'Los burros pintados de cebra de la Revu llevan casi cien años posando. Más fotos que cualquier influencer.',
    'Antes el río Tijuana era río. Luego lo canalizaron y le pusimos Zona Río para que no se sintiera mal.',
    'El Arco del Reloj se inauguró en el 2000. Hasta la fecha nadie sabe para qué lado da la hora.',
  ],
  sinaloa: [
    '¿Eres de Culiacán? Aquí todos tenemos un primo de Sinaloa.',
    'Media Tijuana es de Sinaloa y la otra media está esperando su raite pa\'llá.',
    'Si oyes tambora a las 3 de la mañana es el vecino de Mazatlán celebrando que es martes.',
    '¿Aguachile? Lo trajeron los sinaloenses y aquí nos lo quedamos, compa.',
    'Compa, si ves una troca con la tambora a todo volumen, no es fiesta, es un miércoles normal.',
    'Mi apá llegó de Los Mochis en el 85 "nomás por un rato". Aquí seguimos.',
    'Aquí le decimos "plebe" a todo: al niño, al perro, al jefe y al que te chocó.',
    'En Culiacán hace un calor que derrite. Aquí hace un frío que no entiendo. Extraño sudar.',
    'Si tu tía no te ha ofrecido un chilorio de Sinaloa, no eres de la familia todavía.',
    'Pa\' los sinaloenses Tijuana es como Culiacán, pero con gringos y neblina.',
  ],
  pocho: [
    'Órale bro, ¿where queda la Revu? Mi abuela me mandó por unos tacos.',
    'Bro, mi outfit es todo de la Ross: diez dólares y me veo de Fashion Valley.',
    'Cruzo la línea diario, bro: con mi sueldo en San Diego nomás me alcanza para rentar un clóset.',
    'Hablo spanglish bien fluent: "voy a la marketa por unas groceries y regreso pronto, ¿okay?"',
    'Bro, I\'m like, super mexicano. Mi playlist es puro Peso Pluma.',
    'Mi abuela me dice pocho, mis primos de LA me dicen paisa. Soy un bug de dos países.',
    'Vengo a Tijuana por el dentista, los tacos y que la farmacia no me pida receta. Pura vida, bro.',
    'Pagué con dólares y me dieron cambio en pesos, centavos y un chicle. Best deal ever.',
    'Mi Spanish es bien rusty, pero mi taco order es fluent: "dos de adobada con todo, porfa".',
    'Bro, ¿la Revu es safe? Le pregunté a un zonkey y no me contestó.',
    'Rento en Chula Vista, trabajo en Otay, como en Tijuana y duermo en la línea. Life is good.',
    'Mi tía dice que el chipotle de Chipotle no es chipotle. Creo que tiene razón.',
  ],
  deporte: [
    '¡Xolos campeón 2012! Todavía no me quito la playera.',
    '¡Vamos Toros! El beisbol aquí se vive con carne asada en el estacionamiento.',
    'El Terrible Morales es de aquí, ¿eh? Respeta el barrio.',
    'Aquí hasta la abuelita se sabe la alineación de los Xolos... y la critica.',
    'El Estadio Caliente tiene pasto artificial. Igual que mis promesas de ir al gimnasio.',
    'Los Xolos se llaman así por un perro sin pelo. Representa al aficionado después de la quincena.',
    'En la Perrera no se canta, se ladra. Y se ladra bonito.',
    'Los Toros han sido campeones de la Liga Mexicana. Yo nomás he sido campeón de comer dogos.',
    'Aquí salen buenos boxeadores porque desde morro aprendes a esquivar baches.',
    'Fui a ver a los Zonkeys y salí más cansado que los jugadores. Puro gritar.',
  ],
  inseguridad: [
    'No dejes nada a la vista en el carro, ni el cargador del cel.',
    'Aquí cuando te dicen "cuídate" no es despedida, es consejo.',
    'Aquí el que no tiene alarma tiene perro, y el que no tiene perro, reza.',
    'Si te ofrecen un iPhone en 500 pesos en la Sexta, no es oferta, es examen de ética.',
    'Mi carro tiene volante con candado, alarma, GPS y una estampita de San Judas. Por si acaso.',
    'Aquí le pones el seguro a la puerta antes que el cinturón.',
    'Mi vecino tiene tres perros, dos cámaras y una suegra en la ventana. Nadie se le acerca.',
    'El viene-viene te cuida el carro. ¿De quién? No preguntes.',
  ],
  comida: [
    'Los mejores tacos de adobada son los de la esquina... de cualquier esquina.',
    'Si no has desayunado birria, ¿qué estás haciendo con tu vida?',
    'Hot dog de la Revu a las 2 de la mañana: ese es el verdadero monumento de Tijuana.',
    'Pescado en la mañana, adobada en la noche y carne asada el domingo. Así se vive aquí.',
    'Pide un ceviche de carreta, el de la esquina no falla... casi nunca.',
    'La dieta tijuanense: tacos de adobada, luego de asada, luego de tripa y luego arrepentimiento.',
    '¿Que el taco de canasta te cayó mal? No, mijo, tú le caíste mal al taco.',
    'En la Telefónica venden comida gourmet en contenedores. Tijuana es la única ciudad que recicla así.',
    'Los dogos de la Revu a las tres de la mañana saben a gloria y a malas decisiones.',
    'Si la taquería no tiene salsa de aguacate aguada, no es taquería, es restaurante.',
    'Mi abuela le pone queso a todo. El otro día le puso queso al café.',
    'Aquí al Baja Med lo inventaron chefs. Mi tía lo inventó antes, pero no le puso nombre.',
    'El taquero me recuerda aunque nunca le he dicho mi nombre. "¿Lo de siempre, güero?" Es amor.',
    'Las Ahumaderas: el único callejón donde quieres que te sigan. Con más tacos.',
    'Me dijeron que comer en la calle es peligroso. Llevo treinta años de peligro y estoy feliz.',
  ],
  filosofia: [
    'La línea es como la vida: larga, lenta, y al final te preguntan qué traes.',
    'Nadie es de Tijuana, pero todos acabamos siendo de aquí. Así funciona la ciudad.',
    'Somos la esquina de Latinoamérica. Todo lo que pasa en el continente termina aquí esperando el semáforo.',
    'Si un bache se hace en la Vía Rápida y nadie lo reporta, ¿existe? Sí. Siempre existe.',
    'La neblina de la mañana te enseña que el futuro no se ve, pero igual hay que manejar.',
    '¿Ya te diste cuenta de que caminas en círculos? Yo también. Por eso me compré tenis.',
    'El dinero va y viene. Sobre todo va. Pa\'l otro lado de la línea, generalmente.',
    'Todos traemos una calafia por dentro: vamos llenos, rápido y sin saber dónde paramos.',
    'El tiempo es relativo: cinco minutos en la línea son tres horas.',
    'Uno no escoge Tijuana. Tijuana te escoge, te cobra la renta y te quedas.',
    'La felicidad es un taco de adobada en una banqueta, sin prisa y con salsa que pica tantito.',
    'Si la vida te da limones, pídele sal y un clamato.',
    'El que nace pa\' tamal, del cielo le caen hojas. El que nace pa\' taco, igual pide uno.',
    'Pienso, luego existo. Pienso en tacos, luego existo con hambre.',
    'Nadie sabe para quién trabaja. Yo trabajo para el casero y la gasolinera.',
    'Somos polvo de estrellas, o sea, polvo de la Libertad un día de Santa Ana.',
    'El cerro Colorado está ahí desde antes que nosotros y seguirá después. Respeto.',
    'Uno nunca termina de llegar a Tijuana. Siempre hay alguien que llegó después y te pregunta cómo llegar.',
    'La vida es un semáforo en amarillo: todos aceleramos y nadie sabe por qué.',
    'Los muros dividen, pero los tacos unen. Del otro lado también hay taquerías, pero no es lo mismo.',
    'Dicen que el que se va de Tijuana siempre regresa. Yo nunca me fui y aquí sigo regresando.',
    'Mi abuela dice que la paciencia es una virtud. Ella nunca cruzó por San Ysidro un domingo.',
    'Somos lo que comemos. Por eso huelo a carbón.',
    'La vida no tiene manual, pero tiene viene-viene que te dice "dale, dale, dale".',
    'Cada bache es un recordatorio de que nada es perfecto, ni siquiera el pavimento recién hecho.',
  ],
  cuartapared: [
    'Oye, ¿tú también sientes que alguien nos controla con un joystick?',
    'Solo existo cuando estás cerca. Cuando te vas me borran de la memoria. Así que no te vayas.',
    'Llevo caminando la misma cuadra desde que abriste el juego. Ayúdame.',
    'Si me atropellas no tengo respawn, ¿eh? Bueno, sí tengo, pero duele igual.',
    'Psst, la comida china te quita dinero. Lo sé porque me lo dijo el programador.',
    '¿Por qué todos te hablan cuando te pegas? Porque así nos programaron, compa. No es personal.',
    'Esa flecha verde que ves… yo no la veo. Pero te tengo envidia.',
    'Mi diálogo son solo unas frases. Tú tienes un mapa entero. Qué injusto.',
    'Corre a 60 cuadros por segundo. Yo a ocho cuadros de animación. Y aun así llego.',
    'Te vi robarte ese taxi. No diré nada porque no tengo esa función.',
    'Si cierras la app, ¿a dónde vamos todos? Nadie me ha contestado nunca.',
    'Eres el único que tiene camisa amarilla. Sospechoso.',
    'Dicen que antes el juego se veía borroso. Yo me veía horrible. Ahora tengo cinco veces más pixeles.',
    'No me toques el globo de texto, que me tardaron en hacerlo bonito.',
    'Juego de una ciudad real, con tacos reales, y yo… yo soy inventado. Ay.',
    'Si me estás leyendo, ya caminaste demasiado cerca. Respeta mi espacio personal.',
    'Cada vez que reinicias la partida, me olvido de todo. Es como un lunes.',
    'El tráfico tiene un límite de autos. Por eso nunca hay tanto como en la vida real.',
    'Hola, soy un NPC. Mi sueño es tener una misión. Aunque sea entregar tamales.',
    'Me dijeron que estoy hecho de vectores y JavaScript. Mi mamá dice que de amor.',
    'Si te sales del mapa no hay nada. Bueno, está San Diego, pero no lo cargaron.',
    'El minimapa sabe dónde estás. Yo no sé ni dónde estoy yo.',
    'Mira, si vas a seguir dando vueltas para escuchar todas las frases, son ciento cincuenta. Ánimo.',
    'Ya sé que estás jugando en el celular. Se te nota en el pulgar.',
    'Detrás de cada peatón hay un programador desvelado. Valóranos.',
  ],
  linea: [
    'San Ysidro es la garita más transitada del hemisferio. Y yo siempre en el carril más lento.',
    'En la línea venden churros, piñatas, Cristos de yeso y cobijas. Si tardas mucho, sales con casa amueblada.',
    'Tengo SENTRI, pero igual me revisan. Será la cara.',
    '¿Qué traes? Nada. ¿Nada? Nada. ¿Y esa piñata? Ah, eso sí.',
    'La línea de los domingos es tan larga que te da tiempo de hacerte ciudadano… mexicano otra vez.',
    'Crucé caminando por la PedWest y me sentí atleta olímpico. Tres horas de maratón.',
    'Mi carro conoce la línea mejor que yo. Ya se apaga solo cuando llegamos.',
    'Por el CBX cruzas a pie al aeropuerto. Es como teletransportarse, pero cobrando.',
    'En la fila de Otay conocí a mi novia. Veníamos en el carril de al lado durante dos horas.',
    'El oficial me preguntó a qué iba. Le dije "a Costco". Me dejó pasar con respeto.',
    'La Ready Lane no es ready. Es "ya casi". Igual que todo en la vida.',
    'Vivo aquí, trabajo allá, pago la gasolina en dos monedas. Soy un experto en tipo de cambio.',
    'Hay gente que cruza diario a estudiar. Para mí ya eso cuenta como doctorado.',
    'Si oyes "¡Agua, chicles, churros!" en tu cabeza al dormir, ya eres local.',
    'La línea es el único lugar donde te alegras de ver a un vendedor de Cristos.',
  ],
  barrio: [
    'Súbete a una calafia y aprendes geometría: cómo meter treinta personas en un espacio para quince.',
    'El taxi de ruta no se para. Tú te subes en movimiento y rezas.',
    'Cuando llueve en Tijuana, la Vía Rápida se vuelve el río que antes le quitamos.',
    'Con los vientos de Santa Ana todo el mundo anda despeinado y de mal humor. Hasta los perros.',
    'En el Mercado Hidalgo compras tamarindo, piñatas y te enteras de todos los chismes de la colonia.',
    'El Pasaje Rodríguez antes estaba vacío. Ahora tiene galerías, café de especialidad y morros con lentes.',
    '¿Que dónde vivo? Arriba del cerro, a la izquierda del otro cerro, enfrente del cerro.',
    'En Playas de Tijuana puedes ver el mar y el muro al mismo tiempo. Postal agridulce.',
    'Aquí todo está a quince minutos. Sin tráfico. O sea, a una hora.',
    'Mi colonia tiene nombre de presidente, mi calle de poeta y mi bache de leyenda.',
    'El que no ha ido a una carne asada en la cochera de un desconocido, no ha vivido Tijuana.',
    'Aquí el "ahorita" puede ser en cinco minutos o en cinco años. Depende del humor.',
    'En la Sexta los viernes hay más gente que en un concierto. Y mejor música.',
    'Los perros callejeros de la Revu tienen más estilo que yo. Uno trae paliacate.',
    'Cuando dices "voy al centro" en Tijuana, tu mamá te dice "cuídate" tres veces.',
    'En el sobre ruedas encuentras desde un tornillo hasta un sillón de los setenta. Yo compré los dos.',
    'Si escuchas a alguien decir "ahí nos vidrios", ya estás en confianza.',
    'La Mona sigue en la colonia Aeropuerto, desnuda y feliz. Más feliz que yo, seguro.',
  ],
};
// lo que te dicen en la fiesta de la Plaza Santa Cecilia (al completar todo)
const FRASES_FIESTA = () => [
  '¿Tú eres el que se comió los ' + tacos.length + ' tacos? Respeto.',
  'Dicen que conoces los ' + landmarks.length + ' lugares. Yo nomás me sé el camino a mi casa.',
  '¡' + cafes.length + ' cafés! Con razón no te cansas, compa.',
  'Te vi en la línea, en la Revu y en El Cubo el mismo día. ¿Tú no duermes o qué?',
  'Sabía que alguien terminaría este juego. El programador no lo creía.',
  '¡Otra, otra! Que se aviente una el del guitarrón.',
  'Esta fiesta es por ti. Bueno, y porque es martes.',
  'Ya eres más tijuanense que el burro cebra. Bueno, casi.',
  'Mi abuela dice que te invita a comer el domingo. Lleva tortillas.',
];
const FRASES_PEATON = Object.entries(FRASES).flatMap(([k, list]) => list.map(t => ({ k, t })));
const FRASES_TOPE = [
  '¡Tope!', '¡Ese tope no venía en el mapa!', '¡Aguas con el tope!', '¡Adiós suspensión!',
  '¡Ese tope lo puso el taller de enfrente!', '¡Se me salió el hígado!', '¡Uy, el escape se quedó atrás!',
  '¡Tope pirata, cortesía de los vecinos!', '¡Pegaste con el cárter, mijo!', '¡Bienvenido a Tijuana!',
  '¡El tope ganó esta vez!', '¡Ahí van los amortiguadores!', '¡Con ese brinco ya cruzas la línea!',
  '¡Ese tope es más alto que la renta!', '¡Despacito, que no es la Vía Rápida!',
];

const FRASES_MOTO = [
  '¡Mi moto no, que traigo 4.9 estrellas!', '¡Ese pedido es del licenciado, no lo vayas a abrir!',
  '¡Llévatela, pero entrega el pedido o me cobran a mí!', '¡Ahí va mi aguinaldo en forma de birria!',
  '¡Ya ni robar seguro se puede en esta app!', '¡La moto vale menos que la caja térmica, pa que sepas!',
  '¡El cliente ya me había puesto "¿dónde estás?" tres veces!', '¡Cuidado, que la moto se apaga si piensas feo!',
  '¡Esa caja tiene sopa de mariscos, no la voltees!', '¡Me robaron la moto y el GPS con todo y mis sueños!',
  '¡Mi jefe es un algoritmo y ahorita me va a despedir!', '¡Dile al cliente que soy yo, nos parecemos!',
  '¡Te va a seguir el olor a carne asada por siempre!', '¡Ya llevaba once entregas, déjame la doce!',
  '¡Esa moto tiene más kilómetros que la Transpeninsular!', '¡Ni modo, hoy reparto en patines!',
  '¡Ojalá te toque cliente que no baja por el pedido!', '¡Ahí adentro va el pastel de cumpleaños de una abuelita!',
];
const PEDIDOS = [
  '3 tacos de adobada y un tejuino', 'una pizza con piña y chiles en vinagre', '12 donas y un Pepto-Bismol',
  'un caldo de res a las 40 grados', 'una birria para un perro con depresión', 'una ensalada César, de donde nació',
  'unos churros y una mantita para el frío', 'un café de olla para un influencer', 'una torta de jamón sin jamón',
  'un elote con todo y un abrazo', 'unos tamales para la junta del condominio', 'sushi empanizado con queso',
  'unos raspados en pleno diciembre', 'una sopa Maruchan "gourmet"', 'un pozole tamaño piscina',
  'un pay de queso para disculparse con la suegra', 'unas papas locas y pañuelos desechables',
];
const CLIENTES = [
  '"¿Y la salsa?" Así nomás te recibió.', 'Te pagó con monedas de 50 centavos, una por una.',
  'Te abrió en pijama de dinosaurio y te dijo "gracias, mi rey".', 'Te calificó con 5 estrellas y un emoji de calavera.',
  '"Pedí esto hace tres semanas", pero igual se lo comió.', 'Te pidió que le cambiaras un foco ya que ibas a estar ahí.',
  '"Déjalo en la puerta", dijo el señor desde la puerta.',
  'Te ofreció la mitad de su pedido. Era tuyo de todas formas.', 'Te dio de propina un boleto de la rifa de la parroquia.',
];
// cuando el que recibe es el perro (la birria del perro deprimido o, a veces, al azar)
const PERRO_PEDIDO = 'una birria para un perro con depresión';
const CLIENTES_PERRO = [
  'Su perro te recibió primero. El perro firmó.',
  'Te recibió un perro con paliacate. Movió la cola: eso cuenta como cinco estrellas.',
  'El perro olió el pedido, te miró a los ojos y se lo llevó. Su dueño pagó desde la ventana.',
  'El perro ladró dos veces. Según su dueño eso significa "gracias, quédate con el cambio".',
];
const CLIENTES_PERRO_BIRRIA = 'Llegó la birria. El perro sigue deprimido, pero ya comió y te lamió la mano. Algo es algo.';
const CANCELADOS = [
  'El cliente canceló y te dejó una estrella con un comentario de tres párrafos.',
  'Se enfrió el pedido. Te lo comiste en un semáforo, para que no se desperdiciara.',
  'El cliente ya se había dormido. Tocaste y salió su abuela con la chancla.', 'La app dice que entregaste. La app miente.',
  'Llegaste a la dirección y era un lote baldío con un perro muy enojado.',
];

// ---------- HUD ----------
const $ = (id) => document.getElementById(id);
const hud = { money: $('money'), counts: $('counts'), obj: $('obj'), street: $('street'), toast: $('toast'), timer: $('timer'), arrow: $('arrow'), mini: $('mini') };
$('credit').textContent = D.src;
let toastT = 0, streetT = 0, lastStreet = '';
// la columna de avisos va entre el panel de dinero y el minimapa; si no cabe ahi (pantalla angosta), debajo de los dos.
// Se recalcula cada vez que aparece un aviso porque el panel cambia de ancho con el texto
function layoutTop() {
  const t = $('topmsg').style, st = $('stats').getBoundingClientRect(), mi = hud.mini.getBoundingClientRect();
  if (mi.left - st.right >= 220) { t.left = (st.right + 12) + 'px'; t.right = (window.innerWidth - mi.left + 12) + 'px'; t.top = '10px'; }
  else { t.left = '12px'; t.right = '12px'; t.top = (Math.max(st.bottom, mi.bottom) + 8) + 'px'; }
}
function toast(title, body, secs) { layoutTop(); hud.toast.innerHTML = '<b></b><span></span>'; hud.toast.firstChild.textContent = title; hud.toast.lastChild.textContent = body || ''; hud.toast.classList.add('on'); toastT = secs || 3.5; }
// sonido de dinero: se compara contra el ultimo saldo mostrado (bigSound = fanfarria en vez de monedas)
let lastMoney = state.money, bigSound = false;
function updateStats() {
  const dm = state.money - lastMoney; lastMoney = state.money;
  if (window.SND) { if (dm > 0) SND.play(bigSound ? 'fanfare' : 'gain', dm); else if (dm < 0) SND.play('loss'); }
  bigSound = false;
  hud.money.textContent = '$' + state.money.toLocaleString('es-MX');
  hud.counts.textContent = `★ ${landmarks.filter(l => l.found).length}/${landmarks.length} · 🌮 ${tacos.filter(t => t.eaten).length}/${tacos.length} · ☕ ${cafes.filter(c => c.drunk).length}/${cafes.length}` +
    (EGGS.some(e => e.got) ? ` · 🥚 ${EGGS.filter(e => e.got).length}/${EGGS.length}` : '');
}

// ---------- texturas ----------
// ---------- vehiculos ----------
// Tipos de vehiculo: medidas en px (L largo, W ancho), manejo, resistencia y peso de aparicion (w).
// Cada uno se dibuja en dos variantes: limpio como recien salido de la agencia, o sucio y madreado.
const VTYPES = [
  { name: 'Sedán', L: 30, W: 14, top: 230, acc: 115, steer: 2.6, hp: 100, w: 14, r: 4, cols: ['#c0392b', '#2e86c1', '#ecf0f1', '#34495e', '#7f8c8d', '#d5d8dc', '#27ae60'] },
  { name: 'Vocho', L: 26, W: 14, top: 190, acc: 95, steer: 2.9, hp: 80, w: 11, r: 6.5, cols: ['#2e86c1', '#f1c40f', '#ecf0f1', '#27ae60', '#e67e22', '#c0392b', '#5dade2'] },
  { name: 'Troca', L: 38, W: 17, top: 220, acc: 110, steer: 2.3, hp: 130, w: 12, r: 3.5, cols: ['#ecf0f1', '#1c2833', '#922b21', '#7f8c8d', '#1f618d', '#7d6608'] },
  { name: 'Camioneta', L: 36, W: 17, top: 225, acc: 110, steer: 2.4, hp: 130, w: 10, r: 3.5, cols: ['#1c2833', '#ecf0f1', '#7f8c8d', '#5b2c6f', '#145a32', '#d5d8dc'] },
  { name: 'Tsurito', L: 28, W: 14, top: 215, acc: 110, steer: 2.8, hp: 90, w: 12, r: 2.5, cols: ['#ecf0f1', '#c0392b', '#2e86c1', '#a3a3a3', '#117a65', '#d4ac0d'] },
  { name: 'Combi', L: 36, W: 17, top: 185, acc: 90, steer: 2.2, hp: 120, w: 6, r: 4.5, cols: ['#2874a6', '#c0392b', '#e67e22', '#1e8449', '#f4d03f'] },
  { name: 'Muscle car', L: 35, W: 16, top: 270, acc: 150, steer: 2.5, hp: 100, w: 5, r: 3, cols: ['#e67e22', '#151515', '#c0392b', '#f1c40f', '#1f618d'] },
  { name: 'Lowrider', L: 40, W: 16, top: 210, acc: 100, steer: 2.1, hp: 110, w: 4, r: 5, cols: ['#6c3483', '#117864', '#922b21', '#1a5276', '#b7950b'] },
  { name: 'Calafia', L: 52, W: 19, top: 170, acc: 70, steer: 1.8, hp: 200, w: 4, r: 3.5, cols: ['#c0392b', '#1e8449', '#2874a6', '#d35400'] },
  { name: 'Camión de carga', L: 46, W: 18, top: 175, acc: 75, steer: 1.9, hp: 180, w: 4, r: 3, cols: ['#c0392b', '#1f618d', '#ecf0f1', '#d4ac0d'] },
  // superdeportivo italiano estilo F40: rojo, rapidisimo, fragil y escaso
  { name: 'Bólido italiano', L: 34, W: 16, top: 330, acc: 195, steer: 2.9, hp: 75, w: 2, r: 3, cols: ['#d10a0a'] },
];
const VT_TAXI = { name: 'Taxi libre', L: 37, W: 16, top: 230, acc: 115, steer: 2.6, hp: 100 };
const VT_MOTO = { name: 'Moto de reparto', L: 19, W: 9.2, top: 210, acc: 150, steer: 3.4, hp: 60 };
// premios: la troca de tacos (los 32 tacos) y el burro cebra dorado (todo completo, no se rompe)
const VT_TROCA_TACOS = { name: 'Troca de tacos', L: 44, W: 18, top: 205, acc: 105, steer: 2.3, hp: 220 };
const VT_ZONKEY = { name: 'Burro cebra dorado', L: 24, W: 11, top: 200, acc: 170, steer: 3.6, hp: 99999 };
const VT_WSUM = VTYPES.reduce((s, t) => s + t.w, 0);
const DIRTY_SEEDS = 3;
const GLASS = '#1d2733';

function rgbOf(h) { const n = parseInt(h.slice(1), 16); return [n >> 16, (n >> 8) & 255, n & 255]; }
function shade(h, f) { return 'rgb(' + rgbOf(h).map(v => Math.max(0, Math.min(255, Math.round(v * f)))).join(',') + ')'; }
function mixc(a, b, t) { const p = rgbOf(a), q = rgbOf(b); return '#' + p.map((v, i) => Math.round(v + (q[i] - v) * t).toString(16).padStart(2, '0')).join(''); }

// tipo al azar, los grandes salen menos
function randomVType() {
  let r = Math.random() * VT_WSUM;
  for (let i = 0; i < VTYPES.length; i++) { r -= VTYPES[i].w; if (r <= 0) return i; }
  return 0;
}

// dibuja el tipo ti con el color col; devuelve el rectangulo del parabrisas y donde van los faros
function drawVehicle(x, ti, col, dirty) {
  const T = VTYPES[ti], L = T.L, W = T.W;
  const rr = (X, Y, w, h, r, f) => { x.fillStyle = f; x.beginPath(); x.roundRect(X, Y, w, h, r); x.fill(); };
  const lights = (fx, inset) => {
    x.fillStyle = '#fff6b0'; x.fillRect(fx, inset, 1.8, 2.6); x.fillRect(fx, W - inset - 2.6, 1.8, 2.6);
    x.fillStyle = '#ff3b30'; x.fillRect(0, inset, 1.3, 2.6); x.fillRect(0, W - inset - 2.6, 1.3, 2.6);
  };
  const mirrors = (mx) => { x.fillStyle = shade(col, 0.6); x.fillRect(mx, -0.9, 1.6, 1.1); x.fillRect(mx, W - 0.2, 1.6, 1.1); };
  let ws;
  // sombra
  x.fillStyle = 'rgba(0,0,0,0.35)'; x.beginPath(); x.roundRect(2, 2, L, W, T.r); x.fill();
  if (T.name === 'Sedán') {
    rr(0, 0, L, W, T.r, col);
    rr(9, 2.5, 10, W - 5, 1.5, shade(col, 0.9));
    ws = [19, 2, 4, W - 4]; x.fillStyle = GLASS; x.fillRect(6, 2.8, 3, W - 5.6);
    x.strokeStyle = shade(col, 0.75); x.lineWidth = 0.4; x.beginPath(); x.moveTo(23.5, 2); x.lineTo(23.5, W - 2); x.moveTo(5, 2); x.lineTo(5, W - 2); x.stroke();
    mirrors(19); lights(L - 1.8, 1.5);
  } else if (T.name === 'Vocho') {
    // salpicaderas redondas que sobresalen
    x.fillStyle = col;
    for (const fx of [5.5, L - 6]) for (const fy of [1.4, W - 1.4]) { x.beginPath(); x.arc(fx, fy, 3, 0, 7); x.fill(); }
    rr(0, 0, L, W, T.r, col);
    rr(7, 2.4, 8.5, W - 4.8, 3.5, shade(col, 0.92));
    ws = [15.5, 2.6, 3, W - 5.2]; x.fillStyle = GLASS; x.beginPath(); x.roundRect(4.8, 3.6, 2, W - 7.2, 1); x.fill();
    // rejillas del motor atras
    x.strokeStyle = shade(col, 0.6); x.lineWidth = 0.5; x.beginPath();
    for (let i = 0; i < 4; i++) { x.moveTo(1.6 + i * 0.8, W / 2 - 2); x.lineTo(1.6 + i * 0.8, W / 2 + 2); }
    x.stroke();
    x.fillStyle = '#fff6b0'; x.beginPath(); x.arc(L - 3.2, 2.6, 1.3, 0, 7); x.arc(L - 3.2, W - 2.6, 1.3, 0, 7); x.fill();
    x.fillStyle = '#ff3b30'; x.fillRect(0.6, 2, 1.2, 2); x.fillRect(0.6, W - 4, 1.2, 2);
  } else if (T.name === 'Troca') {
    // caja de carga atras y cabina adelante
    rr(0, 0.4, 16, W - 0.8, 1.5, shade(col, 0.95));
    rr(1.4, 2, 13, W - 4, 0.8, shade(col, 0.55));
    x.strokeStyle = shade(col, 0.45); x.lineWidth = 0.5; x.beginPath();
    for (let i = 1; i < 4; i++) { x.moveTo(1.4, 2 + i * (W - 4) / 4); x.lineTo(14.4, 2 + i * (W - 4) / 4); }
    x.stroke();
    rr(15, 0, L - 15, W, T.r, col);
    rr(17, 2.4, 8.5, W - 4.8, 1.2, shade(col, 0.9));
    x.fillStyle = GLASS; x.fillRect(16.2, 3, 1.3, W - 6);
    ws = [25.5, 2, 4, W - 4]; mirrors(25.5); lights(L - 1.8, 1.6);
  } else if (T.name === 'Camioneta') {
    rr(0, 0, L, W, T.r, col);
    rr(6, 2.2, 19, W - 4.4, 1.5, shade(col, 0.9));
    x.strokeStyle = '#9aa3a8'; x.lineWidth = 0.7; x.beginPath(); x.moveTo(7.5, 3.4); x.lineTo(23.5, 3.4); x.moveTo(7.5, W - 3.4); x.lineTo(23.5, W - 3.4); x.stroke();
    ws = [25, 2, 4, W - 4]; x.fillStyle = GLASS; x.fillRect(3.4, 2.6, 2.4, W - 5.2);
    // llanta de refaccion atras
    x.fillStyle = '#151515'; x.beginPath(); x.arc(0.6, W / 2, 3, Math.PI * 0.5, Math.PI * 1.5); x.fill();
    mirrors(25); lights(L - 1.8, 1.5);
  } else if (T.name === 'Tsurito') {
    rr(0, 0, L, W, T.r, col);
    rr(8.5, 2.4, 9.5, W - 4.8, 1, shade(col, 0.9));
    ws = [18, 2, 3.6, W - 4]; x.fillStyle = GLASS; x.fillRect(5.4, 2.6, 3.1, W - 5.2);
    x.fillStyle = '#2a2a2a'; x.fillRect(L - 0.8, 0.5, 0.8, W - 1); x.fillRect(0, 0.5, 0.8, W - 1);
    mirrors(18); lights(L - 2.4, 1.4);
  } else if (T.name === 'Combi') {
    rr(0, 0, L, W, T.r, col);
    // techo crema y nariz de color en V
    rr(2.5, 1.4, L - 8, W - 2.8, 3, '#efe6d2');
    x.fillStyle = '#efe6d2'; x.beginPath(); x.moveTo(L - 5.5, 1.4); x.lineTo(L - 2.5, W / 2); x.lineTo(L - 5.5, W - 1.4); x.fill();
    // parrilla del techo con maletas
    x.strokeStyle = '#555'; x.lineWidth = 0.6; x.strokeRect(6, 3.5, 17, W - 7);
    x.beginPath(); for (let i = 1; i < 4; i++) { x.moveTo(6 + i * 17 / 4, 3.5); x.lineTo(6 + i * 17 / 4, W - 3.5); } x.stroke();
    x.fillStyle = '#7b4a2a'; x.fillRect(8, 4.5, 5, 4); x.fillStyle = '#2c4a6b'; x.fillRect(15, W - 9, 6, 4.5);
    x.fillStyle = GLASS; x.fillRect(L - 5.8, 2, 2.2, W / 2 - 2.6); x.fillRect(L - 5.8, W / 2 + 0.6, 2.2, W / 2 - 2.6);
    ws = [L - 5.8, 2, 2.2, W - 4];
    x.fillStyle = '#fff6b0'; x.beginPath(); x.arc(L - 1.6, 2.6, 1.2, 0, 7); x.arc(L - 1.6, W - 2.6, 1.2, 0, 7); x.fill();
    x.fillStyle = '#ff3b30'; x.fillRect(0, 1.6, 1.2, 2.4); x.fillRect(0, W - 4, 1.2, 2.4);
  } else if (T.name === 'Muscle car') {
    rr(0, 0, L, W, T.r, col);
    rr(10, 2.5, 7, W - 5, 1, shade(col, 0.9));
    ws = [17, 2, 3.6, W - 4]; x.fillStyle = GLASS; x.fillRect(7.6, 3, 2.4, W - 6);
    // franjas de carreras y toma de aire
    const st = col === '#151515' || col === '#1f618d' ? '#f4f4f4' : '#151515';
    x.fillStyle = st; x.fillRect(0.5, W / 2 - 2.6, L - 1, 1.6); x.fillRect(0.5, W / 2 + 1, L - 1, 1.6);
    rr(24, W / 2 - 1.8, 4.5, 3.6, 0.8, '#222');
    x.fillStyle = '#111'; x.fillRect(0.4, 1, 1.4, W - 2);
    mirrors(17); lights(L - 1.8, 1.4);
  } else if (T.name === 'Lowrider') {
    rr(0, 0, L, W, T.r, col);
    // toldo de vinil blanco y molduras cromadas
    rr(11, 2.4, 11, W - 4.8, 2, '#efece4');
    ws = [22, 2.2, 4, W - 4.4]; x.fillStyle = GLASS; x.fillRect(8.6, 3, 2.4, W - 6);
    x.strokeStyle = '#e6edf0'; x.lineWidth = 0.7; x.beginPath(); x.roundRect(0.8, 0.8, L - 1.6, W - 1.6, T.r - 0.8); x.stroke();
    // filetes dorados en el cofre y la cajuela
    x.strokeStyle = '#f5cd5b'; x.lineWidth = 0.45; x.beginPath();
    x.moveTo(27.5, W / 2); x.quadraticCurveTo(32, 3, 37, W / 2); x.quadraticCurveTo(32, W - 3, 27.5, W / 2);
    x.moveTo(1.8, W / 2); x.quadraticCurveTo(5, 3.5, 7.8, W / 2); x.quadraticCurveTo(5, W - 3.5, 1.8, W / 2); x.stroke();
    mirrors(22); lights(L - 1.8, 1.8);
  } else if (T.name === 'Calafia') {
    rr(0, 0, L, W, T.r, '#f2efe6');
    rr(3, 3.4, L - 9, W - 6.8, 1.5, '#dcd8cc');
    // franjas de color en los costados y ventanillas
    x.fillStyle = col; x.fillRect(1, 0.3, L - 2, 1.5); x.fillRect(1, W - 1.8, L - 2, 1.5);
    x.fillStyle = '#f4d03f'; x.fillRect(L - 12, 0.3, 10, 1.5); x.fillRect(L - 12, W - 1.8, 10, 1.5);
    x.fillStyle = GLASS;
    for (let i = 0; i < 8; i++) { x.fillRect(4 + i * 5.2, 2, 4.2, 1.2); x.fillRect(4 + i * 5.2, W - 3.2, 4.2, 1.2); }
    x.fillStyle = '#bdb8aa'; x.fillRect(12, W / 2 - 2, 4, 4); x.fillRect(30, W / 2 - 2, 4, 4);
    ws = [L - 5, 2, 3.4, W - 4]; x.fillStyle = GLASS; x.fillRect(0.6, 3.5, 1.6, W - 7);
    x.fillStyle = col; x.fillRect(L - 1.6, 4, 1.2, W - 8);
    lights(L - 1.8, 1.4);
  } else if (T.name === 'Bólido italiano') {
    rr(0, 0, L, W, T.r, col);
    x.fillStyle = shade(col, 0.78); x.fillRect(4, 0.3, L - 10, 1.1); x.fillRect(4, W - 1.4, L - 10, 1.1); // costados esculpidos
    // tapa del motor con rejillas atras de la cabina
    rr(3.2, 2.6, 11, W - 5.2, 1, shade(col, 0.86));
    x.strokeStyle = shade(col, 0.45); x.lineWidth = 0.55; x.beginPath();
    for (let i = 4.2; i < 14; i += 1.35) { x.moveTo(i, 3.4); x.lineTo(i, W - 3.4); } x.stroke();
    // aleron trasero de lado a lado con sus soportes
    x.fillStyle = shade(col, 0.7); x.fillRect(0.3, 0.3, 2.6, W - 0.6);
    x.fillStyle = '#111'; x.fillRect(0.3, 0, 2.6, 1.1); x.fillRect(0.3, W - 1.1, 2.6, 1.1);
    x.fillStyle = 'rgba(0,0,0,0.55)'; x.fillRect(2.9, 0.8, 0.6, W - 1.6); // sombra del aleron sobre la carroceria
    // cabina chiquita y medallon
    rr(15.2, 3, 6.3, W - 6, 1.6, shade(col, 0.93));
    x.fillStyle = GLASS; x.fillRect(14, 3.6, 1.3, W - 7.2);
    ws = [21.5, 2.6, 3.8, W - 5.2];
    // tomas de aire NACA en el cofre
    x.fillStyle = shade(col, 0.42);
    for (const yy of [4, W - 5.4]) { x.beginPath(); x.moveTo(26, yy + 0.7); x.lineTo(30.5, yy); x.lineTo(30.5, yy + 1.4); x.closePath(); x.fill(); }
    // faros escondidos y cuatro calaveras redondas
    x.fillStyle = '#fff6b0'; x.fillRect(L - 2.2, 2, 1.6, 2.4); x.fillRect(L - 2.2, W - 4.4, 1.6, 2.4);
    x.fillStyle = '#ff3b30'; for (const yy of [3, 5.2, W - 5.2, W - 3]) { x.beginPath(); x.arc(1.2, yy, 0.85, 0, 7); x.fill(); }
    mirrors(20.5);
  } else {
    // camion de carga: caja blanca atras, cabina de color adelante
    rr(0, 0, 33, W, 1.5, '#e8e7e1');
    x.strokeStyle = 'rgba(0,0,0,0.12)'; x.lineWidth = 0.6; x.beginPath();
    for (let i = 4; i < 33; i += 4) { x.moveTo(i, 0.6); x.lineTo(i, W - 0.6); } x.stroke();
    x.strokeStyle = 'rgba(0,0,0,0.4)'; x.lineWidth = 0.5; x.strokeRect(0.25, 0.25, 32.5, W - 0.5);
    rr(34, 0.5, L - 34, W - 1, T.r, col);
    rr(35, 2, 5.5, W - 4, 1, shade(col, 0.88));
    ws = [40.5, 2, 3, W - 4]; mirrors(40); lights(L - 1.8, 1.6);
  }
  if (T.name !== 'Combi') { x.fillStyle = GLASS; x.fillRect(ws[0], ws[1], ws[2], ws[3]); }
  x.strokeStyle = 'rgba(0,0,0,0.45)'; x.lineWidth = 0.6; x.beginPath(); x.roundRect(0, 0, L, W, T.r); x.stroke();
  return ws;
}

// textura de un vehiculo (se crea la primera vez que se pide); d = 0 limpio, 1..3 sucio
function vehicleTexture(scene, ti, ci, d) {
  const key = 'v' + ti + '_' + ci + '_' + d;
  if (scene.textures.exists(key)) return key;
  const T = VTYPES[ti], L = T.L, W = T.W;
  const t = scene.textures.createCanvas(key, (L + 5) * SPR, (W + 5) * SPR), x = t.getContext();
  x.scale(SPR, SPR); x.translate(1, 1);
  const dirty = d > 0, base = T.cols[ci];
  // la pintura sucia se ve deslavada y opaca
  const col = dirty ? mixc(base, '#8a7d6a', 0.32) : base;
  const ws = drawVehicle(x, ti, col, dirty);
  x.save(); x.beginPath(); x.roundRect(0, 0, L, W, T.r); x.clip();
  if (!dirty) {
    // brillo de recien encerado
    const g = x.createLinearGradient(0, 0, L * 0.6, W);
    g.addColorStop(0, 'rgba(255,255,255,0)'); g.addColorStop(0.45, 'rgba(255,255,255,0.28)'); g.addColorStop(0.55, 'rgba(255,255,255,0.05)'); g.addColorStop(1, 'rgba(255,255,255,0)');
    x.fillStyle = g; x.fillRect(0, 0, L, W);
    x.fillStyle = 'rgba(255,255,255,0.35)'; x.fillRect(L * 0.15, 0.5, L * 0.7, 0.5);
  } else {
    const R = mulberry(hash(ti * 131 + ci * 17 + d * 7919));
    const rn = (a, b) => a + R() * (b - a);
    // laminas de otro color (de yonke) o con primer
    if (R() < 0.6) { x.fillStyle = R() < 0.5 ? '#8f8f88' : mixc(T.cols[(ci + 1 + (R() * 3 | 0)) % T.cols.length], '#8a7d6a', 0.3); const side = R() < 0.5; x.fillRect(rn(L * 0.3, L * 0.55), side ? 0 : W - W * 0.32, L * 0.2, W * 0.32); }
    if (R() < 0.35) { x.fillStyle = '#8f8f88'; x.fillRect(ws[0] + ws[2], 0, L - ws[0] - ws[2], W); }
    // tierra y polvo, mas cargado abajo y atras
    for (let i = 0; i < 18; i++) {
      x.fillStyle = `rgba(${rn(90, 130) | 0},${rn(72, 100) | 0},${rn(45, 65) | 0},${rn(0.15, 0.4)})`;
      const ex = R() < 0.6 ? rn(0, L * 0.4) : rn(0, L), ey = R() < 0.5 ? rn(0, 2.5) : W - rn(0, 2.5);
      x.beginPath(); x.ellipse(R() < 0.7 ? ex : rn(0, L), R() < 0.7 ? ey : rn(0, W), rn(1, 4), rn(0.8, 2.5), rn(0, 3), 0, 7); x.fill();
    }
    // oxido
    for (let i = 0; i < 6; i++) {
      const rx = rn(0.5, L - 0.5), ry = R() < 0.5 ? rn(0, 2) : W - rn(0, 2);
      x.fillStyle = 'rgba(122,59,26,0.85)'; x.beginPath(); x.ellipse(rx, ry, rn(0.6, 1.8), rn(0.5, 1.2), rn(0, 3), 0, 7); x.fill();
      x.fillStyle = 'rgba(176,96,40,0.6)'; x.beginPath(); x.arc(rx + 0.3, ry, rn(0.3, 0.7), 0, 7); x.fill();
    }
    // rayones y golpes
    x.strokeStyle = 'rgba(235,230,215,0.55)'; x.lineWidth = 0.35; x.beginPath();
    for (let i = 0; i < 4; i++) { const sx = rn(2, L - 6), sy = rn(1, W - 1); x.moveTo(sx, sy); x.lineTo(sx + rn(3, 7), sy + rn(-1.2, 1.2)); }
    x.stroke();
    for (let i = 0; i < 2; i++) {
      x.fillStyle = 'rgba(0,0,0,0.35)'; x.beginPath(); x.ellipse(R() < 0.5 ? rn(0, 2.5) : L - rn(0, 2.5), rn(2, W - 2), rn(1.2, 2.2), rn(1.5, 3), 0, 0, 7); x.fill();
    }
  }
  x.restore();
  if (dirty) {
    const R = mulberry(hash(ti * 977 + ci * 31 + d * 101));
    // parabrisas estrellado
    if (R() < 0.6) {
      const cx = ws[0] + ws[2] * (0.3 + R() * 0.4), cy = ws[1] + ws[3] * (0.2 + R() * 0.6);
      x.strokeStyle = 'rgba(220,235,245,0.75)'; x.lineWidth = 0.3; x.beginPath();
      for (let i = 0; i < 6; i++) { const a = R() * 6.28, r = 1.5 + R() * 3.5; x.moveTo(cx, cy); x.lineTo(Math.max(ws[0], Math.min(ws[0] + ws[2], cx + Math.cos(a) * r)), Math.max(ws[1], Math.min(ws[1] + ws[3], cy + Math.sin(a) * r))); }
      x.stroke();
    }
    // faro tuerto y calavera con cinta
    if (R() < 0.55) { x.fillStyle = '#2a2a2a'; x.fillRect(L - 2.6, R() < 0.5 ? 1 : W - 4.6, 2.6, 3.6); }
    if (R() < 0.4) { x.fillStyle = '#d9c27a'; x.fillRect(0, R() < 0.5 ? 1.4 : W - 4.4, 1.6, 3); }
  }
  t.refresh();
  return key;
}

const SHIRTS = ['#d35400', '#2980b9', '#27ae60', '#8e44ad', '#c0392b', '#ecf0f1', '#16a085', '#7f8c8d', '#f39c12', '#2c3e50',
  '#e91e63', '#ff7043', '#9ccc65', '#4dd0e1', '#fdd835', '#795548', '#5c6bc0', '#212121'];
// 36 personas distintas para la gente de la calle: se reparten genero, edad y complexion y lo demas sale de un
// generador con semilla fija (siempre las mismas). speed: los viejitos caminan mas despacio, los ninos un poco mas rapido
const PED_VARIANTS = (() => {
  const R = mulberry(2024), pick2 = (a) => a[(R() * a.length) | 0];
  const SKINS = ['#e0b08a', '#c68e5f', '#a8714a', '#8d5a36', '#6b4428'];
  const PANTS = ['#2c3e66', '#3b3b3b', '#5a4632', '#1f2a38', '#6d6d6d', '#8d6e63', '#1d3f8f'];
  const AGES = ['joven', 'adulto', 'viejo', 'adulto', 'joven', 'nino'], BUILDS = ['normal', 'delgado', 'gordo', 'normal', 'delgado', 'normal'];
  const out = [];
  for (let i = 0; i < 36; i++) {
    const female = i % 2 === 1, age = AGES[i % 6], build = age === 'nino' ? pick2(['normal', 'delgado']) : BUILDS[(i >> 1) % 6];
    const gray = pick2(['#bdbdbd', '#e0e0e0', '#9e9e9e']);
    const darks = ['#111', '#2a1a10', '#3b2414', '#5a3a22'];
    const V = { female, age, build, skin: pick2(SKINS), shirt: pick2(SHIRTS), pants: pick2(PANTS), k: age === 'nino' ? 0.74 : 1,
      speed: { nino: 1.1, joven: 1.05, adulto: 1, viejo: 0.7 }[age] };
    if (female) {
      V.hair = age === 'viejo' ? pick2(['chongo', 'corto']) : pick2(['largo', 'largo', 'cola', 'chongo', 'rizado']);
      V.hairCol = age === 'viejo' ? gray : R() < 0.25 ? pick2(['#c9a227', '#8d3b1f', '#6a1b9a']) : pick2(darks); // a veces teñido
      if (age !== 'nino' && R() < 0.45) V.skirt = pick2(['#c2185b', '#283593', '#4e342e', '#00796b', '#212121', V.shirt]);
    } else {
      V.hair = age === 'viejo' ? pick2(['calvo', 'corto', 'calvo']) : age === 'adulto' && R() < 0.2 ? 'calvo' : pick2(['corto', 'corto', 'rizado']);
      V.hairCol = age === 'viejo' ? gray : pick2(darks);
      if (age === 'joven' && R() < 0.5) { V.hat = 'gorra'; V.hatCol = pick2(['#c62828', '#1565c0', '#212121', '#2e7d32', '#f9a825']); }
      if ((age === 'adulto' || age === 'viejo') && R() < 0.3) { V.hat = 'vaquero'; V.hatCol = pick2(['#d7b98a', '#3e2723', '#fafafa']); }
    }
    if (age === 'viejo' && R() < 0.5) V.cane = true;
    if ((age === 'nino' || age === 'joven') && R() < 0.4) V.pack = pick2(['#e53935', '#1e88e5', '#43a047', '#8e24aa', '#fb8c00']);
    out.push(V);
  }
  return out;
})();
const N_PEDS = PED_VARIANTS.length;
const pedVariant = () => (Math.random() * N_PEDS) | 0;
// una persona vista desde arriba mirando a la derecha (+x); sw entre -1 y 1 es el paso de la caminata
function drawPerson(x, V, sw) {
  x.save(); x.scale(V.k, V.k); x.lineCap = 'round';
  const B = { delgado: [2.3, 4.4, 4.1], normal: [2.8, 5.2, 4.6], gordo: [3.3, 6.2, 5.5] }[V.build]; // [frente-espalda, hombros, brazos]
  const tx = B[0], ty = B[1] * (V.female ? 0.9 : 1), arm = B[2] * (V.female ? 0.92 : 1), step = V.age === 'viejo' ? 4.5 : 6.5;
  x.fillStyle = 'rgba(0,0,0,0.25)'; x.beginPath(); x.ellipse(1.2, 1.2, tx + 1.7, ty + 1.3, 0, 0, 7); x.fill();
  // piernas con zapatos: una adelante y otra atras
  for (const side of [-1, 1]) {
    const off = sw * step * side;
    x.strokeStyle = V.skirt ? V.skin : V.pants; x.lineWidth = V.build === 'gordo' ? 3.4 : V.build === 'delgado' ? 2.5 : 3;
    x.beginPath(); x.moveTo(0, side * 2); x.lineTo(off, side * 2); x.stroke();
    x.fillStyle = '#20160f'; x.beginPath(); x.ellipse(off + 0.8, side * 2, 1.9, 1.4, 0, 0, 7); x.fill();
  }
  // falda o vestido (tapa la cadera)
  // desde arriba la falda asoma alrededor de la cadera, mas ancha que el torso
  if (V.skirt) { x.fillStyle = V.skirt; x.beginPath(); x.ellipse(-0.6, 0, tx + 2.6, ty + 0.9, 0, 0, 7); x.fill(); x.strokeStyle = 'rgba(0,0,0,0.35)'; x.lineWidth = 0.6; x.stroke(); }
  // brazos: se mueven al reves que las piernas; el viejito con baston lo lleva en la mano derecha
  for (const side of [-1, 1]) {
    const off = -sw * 4.5 * side * (V.age === 'viejo' ? 0.6 : 1);
    x.strokeStyle = V.shirt; x.lineWidth = V.build === 'gordo' ? 2.8 : 2.4;
    x.beginPath(); x.moveTo(0, side * (arm - 0.2)); x.lineTo(off * 0.7, side * (arm + 0.6)); x.stroke();
    x.fillStyle = V.skin; x.beginPath(); x.arc(off, side * (arm + 0.7), 1.3, 0, 7); x.fill();
    if (V.cane && side === 1) { x.strokeStyle = '#5d4037'; x.lineWidth = 0.9; x.beginPath(); x.moveTo(off, arm + 0.7); x.lineTo(off + 3.6, arm + 1.2); x.stroke(); }
  }
  // mochila en la espalda
  if (V.pack) { x.fillStyle = V.pack; x.beginPath(); x.roundRect(-tx - 1.8, -2.6, 2.4, 5.2, 0.8); x.fill(); }
  // torso (con panza si es gordo)
  x.fillStyle = V.shirt; x.beginPath(); x.ellipse(-0.3, 0, tx, ty, 0, 0, 7); x.fill();
  x.strokeStyle = 'rgba(0,0,0,0.4)'; x.lineWidth = 0.7; x.stroke();
  if (V.build === 'gordo') { x.fillStyle = 'rgba(255,255,255,0.12)'; x.beginPath(); x.ellipse(1, 0, tx * 0.6, ty * 0.55, 0, 0, 7); x.fill(); }
  // cabeza: cara hacia adelante (+x) y el peinado
  const H = V.hairCol, face = () => { x.fillStyle = V.skin; x.beginPath(); x.arc(0.9, 0, 2.5, 0, 7); x.fill(); };
  const back = () => { x.fillStyle = H; x.beginPath(); x.arc(0.5, 0, 2.6, Math.PI * 0.5, Math.PI * 1.5); x.closePath(); x.fill(); x.beginPath(); x.ellipse(0.6, 0, 1.2, 2.5, 0, 0, 7); x.fill(); };
  if (V.hair === 'largo') { x.fillStyle = H; x.beginPath(); x.ellipse(-1.4, 0, 3.4, 2.9, 0, 0, 7); x.fill(); face(); x.fillStyle = H; x.beginPath(); x.arc(0.4, 0, 2.6, Math.PI * 0.55, Math.PI * 1.45); x.closePath(); x.fill(); }
  else if (V.hair === 'rizado') { face(); x.fillStyle = H; for (let a = 0.6; a < 5.7; a += 0.55) { x.beginPath(); x.arc(0.3 + Math.cos(a + Math.PI / 2) * 2.2, Math.sin(a + Math.PI / 2) * 2.2, 1.2, 0, 7); x.fill(); } x.beginPath(); x.arc(0, 0, 2.2, Math.PI * 0.5, Math.PI * 1.5); x.fill(); }
  else if (V.hair === 'calvo') { face(); x.strokeStyle = H; x.lineWidth = 1; x.beginPath(); x.arc(0.9, 0, 2.2, Math.PI * 0.7, Math.PI * 1.3); x.stroke(); x.fillStyle = 'rgba(255,255,255,0.25)'; x.beginPath(); x.arc(1.3, -0.6, 0.8, 0, 7); x.fill(); }
  else { face(); back(); if (V.hair === 'cola') { x.fillStyle = H; x.beginPath(); x.ellipse(-2.8, 0, 1.8, 1.1, 0, 0, 7); x.fill(); } if (V.hair === 'chongo') { x.fillStyle = H; x.beginPath(); x.arc(-2.2, 0, 1.5, 0, 7); x.fill(); } }
  // sombreros
  if (V.hat === 'gorra') { x.fillStyle = V.hatCol; x.beginPath(); x.arc(0.4, 0, 2.7, Math.PI * 0.55, Math.PI * 1.45); x.closePath(); x.fill(); x.beginPath(); x.arc(0.6, 0, 2.6, 0, 7); x.fill(); x.fillRect(0.2, -1.6, 3.2, 3.2); }
  if (V.hat === 'vaquero') {
    x.fillStyle = V.hatCol; x.beginPath(); x.ellipse(0.7, 0, 4.4, 4.0, 0, 0, 7); x.fill(); x.strokeStyle = 'rgba(0,0,0,0.35)'; x.lineWidth = 0.5; x.stroke();
    x.fillStyle = 'rgba(0,0,0,0.18)'; x.beginPath(); x.ellipse(0.5, 0, 2.4, 2.1, 0, 0, 7); x.fill();
    x.strokeStyle = '#4e342e'; x.lineWidth = 0.6; x.beginPath(); x.ellipse(0.5, 0, 2.5, 2.2, 0, 0, 7); x.stroke();
  }
  x.restore();
}
function makeTextures(scene) {
  makeLights(scene); makeFiesta(scene); makeMoto(scene); makePerro(scene); makeLandmarkIcons(scene); makeTrocaTacos(scene); makeZonkey(scene); makeTaxi(scene); makePolice(scene); makeTacoStands(scene); makeCafes(scene); makeChinas(scene); makeEggs(scene); makeScorch(scene);
  // personas vistas desde arriba, mirando a la derecha; 8 cuadros de caminata (el cuadro 0 es parado).
  // Una textura por variante de PED_VARIANTS ('ped0'...) y la del jugador ('pedP'); ver drawPerson.
  // Se dibujan a SPR veces la resolucion y el sprite se muestra a escala 1 / SPR para que se vean nitidas.
  const PF = PED_FRAME * SPR;
  const sheet = (key, V) => {
    const t = scene.textures.createCanvas('ped' + key, PF * 8, PF), x = t.getContext();
    for (let f = 0; f < 8; f++) {
      x.save(); x.translate(f * PF + PF / 2, PF / 2); x.scale(SPR, SPR);
      drawPerson(x, V, Math.sin(f / 8 * Math.PI * 2));
      x.restore();
      t.add(f, 0, f * PF, 0, PF, PF);
    }
    t.refresh();
    scene.anims.create({ key: 'walk' + key, frames: Array.from({ length: 8 }, (_, f) => ({ key: 'ped' + key, frame: f })), frameRate: 9, repeat: -1 });
  };
  PED_VARIANTS.forEach((V, i) => sheet(i, V));
  sheet(PLAYER_SHIRT, PLAYER_LOOK);
  // aro de los lugares y del destino: a SPR veces la resolucion (las escalas de abajo se dividen entre SPR)
  const r = scene.textures.createCanvas('ring', 64 * SPR, 64 * SPR), x = r.getContext();
  x.scale(SPR, SPR); x.strokeStyle = '#fff'; x.lineWidth = 5; x.beginPath(); x.arc(32, 32, 28, 0, 7); x.stroke(); r.refresh();
}
const PLAYER_SHIRT = 'P'; // textura 'pedP' y animacion 'walkP'
// el jugador: camisa amarilla, pantalon de mezclilla y gorra roja (como siempre)
const PLAYER_LOOK = { female: false, age: 'adulto', build: 'normal', skin: '#c68e5f', shirt: '#ffd23f', pants: '#1d3f8f', hair: 'corto', hairCol: '#111', hat: 'gorra', hatCol: '#c0392b', k: 1 };
// taxi libre clasico de Tijuana: guayin roja con franjas negras y crema.
// Se dibuja a SPR veces la resolucion y el sprite va a escala 1 / SPR.
// moto de repartidor vista desde arriba con su caja termica, a SPR veces la resolucion
// perro callejero color caramelo con paliacate, visto desde arriba mirando a la derecha;
// dos cuadros: la cola a un lado y al otro
function makePerro(scene) {
  const FW = 22, FH = 14, t = scene.textures.createCanvas('perro', FW * 2 * SPR, FH * SPR), x = t.getContext();
  for (let f = 0; f < 2; f++) {
    x.save(); x.scale(SPR, SPR); x.translate(f * FW + 10, FH / 2);
    x.fillStyle = 'rgba(0,0,0,0.25)'; x.beginPath(); x.ellipse(1, 1, 8, 4.2, 0, 0, 7); x.fill();
    // cola
    x.strokeStyle = '#9a5f2b'; x.lineWidth = 1.6; x.lineCap = 'round';
    x.beginPath(); x.moveTo(-6, 0); x.quadraticCurveTo(-8.5, f ? 2.5 : -2.5, -9.5, f ? 4 : -4); x.stroke();
    // patas
    x.fillStyle = '#8a5426';
    for (const [px, py] of [[-4, -3.4], [-4, 3.4], [3, -3.2], [3, 3.2]]) { x.beginPath(); x.ellipse(px, py, 1.4, 1, 0, 0, 7); x.fill(); }
    // cuerpo y lomo mas oscuro
    x.fillStyle = '#c58747'; x.beginPath(); x.ellipse(-0.5, 0, 6.5, 3.4, 0, 0, 7); x.fill();
    x.fillStyle = '#a86b33'; x.beginPath(); x.ellipse(-1.5, 0, 4, 1.4, 0, 0, 7); x.fill();
    // paliacate rojo con puntitos
    x.fillStyle = '#c62828'; x.beginPath(); x.ellipse(5, 0, 1.5, 3, 0, 0, 7); x.fill();
    x.fillStyle = '#fff'; for (const py of [-1.6, 0, 1.6]) x.fillRect(4.7, py - 0.3, 0.6, 0.6);
    // cabeza, orejas y nariz
    x.fillStyle = '#c58747'; x.beginPath(); x.ellipse(7.5, 0, 2.8, 2.5, 0, 0, 7); x.fill();
    x.fillStyle = '#7a4520'; x.beginPath(); x.ellipse(6.6, -2.4, 1.5, 0.9, -0.5, 0, 7); x.fill(); x.beginPath(); x.ellipse(6.6, 2.4, 1.5, 0.9, 0.5, 0, 7); x.fill();
    x.fillStyle = '#1a1a1a'; x.beginPath(); x.arc(10.2, 0, 0.8, 0, 7); x.fill();
    x.restore();
    t.add(f, 0, f * FW * SPR, 0, FW * SPR, FH * SPR);
  }
  t.refresh();
  scene.anims.create({ key: 'cola', frames: [{ key: 'perro', frame: 0 }, { key: 'perro', frame: 1 }], frameRate: 8, repeat: -1 });
}
// luces de la noche: 'luz' es un circulo que se desvanece hacia afuera (128 px) y 'cono' el haz de un faro
// (256 x 128, nace en la orilla izquierda al centro). Se usan para borrar la oscuridad y, teñidas, como resplandor
function makeLights(scene) {
  let t = scene.textures.createCanvas('luz', 128, 128), x = t.getContext();
  let g = x.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.45, 'rgba(255,255,255,0.75)'); g.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = g; x.fillRect(0, 0, 128, 128); t.refresh();
  t = scene.textures.createCanvas('cono', 256, 128); x = t.getContext();
  g = x.createRadialGradient(0, 64, 0, 0, 64, 256);
  g.addColorStop(0, 'rgba(255,255,255,0.95)'); g.addColorStop(0.6, 'rgba(255,255,255,0.45)'); g.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = g; x.beginPath(); x.moveTo(0, 56); x.lineTo(256, 0); x.lineTo(256, 128); x.lineTo(0, 72); x.closePath(); x.fill();
  t.refresh();
}
// la fiesta de la Plaza Santa Cecilia: mariachis vistos desde arriba (sombrero ancho con bordado dorado, traje negro
// con botonadura de plata) con su instrumento al frente: 0 trompeta, 1 guitarra, 2 violin, 3 guitarron.
// Miran a la derecha; cuadro de 30 x 30 a SPR veces la resolucion. Ademas 'chispa' (cohetes) y 'confeti'.
function makeFiesta(scene) {
  const F = 30;
  for (let v = 0; v < 4; v++) {
    const t = scene.textures.createCanvas('mariachi' + v, F * SPR, F * SPR), x = t.getContext();
    x.scale(SPR, SPR); x.translate(F / 2, F / 2);
    const ell = (c, ex, ey, rx, ry, a) => { x.fillStyle = c; x.beginPath(); x.ellipse(ex, ey, rx, ry, a || 0, 0, 7); x.fill(); };
    ell('rgba(0,0,0,0.3)', 1.5, 1.5, 10, 10);
    // brazos hacia el instrumento y hombros con botonadura
    ell('#1a1a1a', 3, -5, 4, 1.8, 0.4); ell('#1a1a1a', 3, 5, 4, 1.8, -0.4);
    ell('#151515', -1, 0, 4, 8);
    x.fillStyle = '#d9d9d9'; for (const yy of [-6.5, -4.5, 4.5, 6.5]) { x.beginPath(); x.arc(-1, yy, 0.6, 0, 7); x.fill(); }
    // instrumento
    if (v === 0) { x.strokeStyle = '#e8b923'; x.lineWidth = 1.3; x.beginPath(); x.moveTo(4, 0); x.lineTo(13, 0); x.stroke(); ell('#f5d250', 13.5, 0, 1.4, 2.6); ell('#a07a10', 13.9, 0, 0.7, 1.6); }
    if (v === 1) { ell('#a0622d', 7, 2.5, 4.2, 3.2, 0.5); ell('#3e2410', 7, 2.5, 1.1, 1.1); x.strokeStyle = '#5d3a1a'; x.lineWidth = 1.2; x.beginPath(); x.moveTo(8.5, 0); x.lineTo(13, -6); x.stroke(); }
    if (v === 2) { ell('#8b3a1a', 5, -5, 2.4, 1.6, -0.6); x.strokeStyle = '#d7ccc8'; x.lineWidth = 0.6; x.beginPath(); x.moveTo(2, -1); x.lineTo(10, -8); x.stroke(); }
    if (v === 3) { ell('#9a5a28', 8, 0, 5.5, 5, 0); ell('#c98a4a', 8, 0, 4.2, 3.8, 0); ell('#3e2410', 8, 0, 1.4, 1.4); }
    // sombrero ancho con bordado y la copa
    x.fillStyle = '#1c1c1c'; x.beginPath(); x.arc(-0.5, 0, 7.5, 0, 7); x.fill();
    x.strokeStyle = '#e3b341'; x.lineWidth = 0.8; x.beginPath(); x.arc(-0.5, 0, 6.6, 0, 7); x.stroke();
    x.setLineDash([1, 1.2]); x.beginPath(); x.arc(-0.5, 0, 5.4, 0, 7); x.stroke(); x.setLineDash([]);
    ell('#2a2a2a', -0.5, 0, 3.2, 3); x.strokeStyle = '#e3b341'; x.lineWidth = 0.7; x.beginPath(); x.arc(-0.5, 0, 3.2, 0, 7); x.stroke();
    t.refresh();
  }
  let t = scene.textures.createCanvas('chispa', 16, 16), x = t.getContext();
  const g = x.createRadialGradient(8, 8, 0, 8, 8, 8); g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.4, 'rgba(255,255,255,0.8)'); g.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = g; x.fillRect(0, 0, 16, 16); t.refresh();
  t = scene.textures.createCanvas('confeti', 6, 3); x = t.getContext(); x.fillStyle = '#fff'; x.fillRect(0, 0, 6, 3); t.refresh();
}
// troca de tacos vista desde arriba: caja blanca con letrero en el techo, toldo a rayas del lado derecho
// (el del servicio) y su chimenea del trompo. Lienzo (L + 6) x (W + 6); la troca empieza en (3, 3)
function makeTrocaTacos(scene) {
  const { L, W } = VT_TROCA_TACOS, t = scene.textures.createCanvas('troca_tacos', (L + 6) * SPR, (W + 6) * SPR), x = t.getContext();
  x.scale(SPR, SPR); x.translate(3, 3);
  x.fillStyle = 'rgba(0,0,0,0.35)'; x.fillRect(2.5, 2.5, L, W);
  // caja y cabina
  x.fillStyle = '#f4f1ea'; x.beginPath(); x.roundRect(0, 0, 33, W, 2); x.fill();
  x.fillStyle = '#e9e4d8'; x.beginPath(); x.roundRect(32, 1, L - 32, W - 2, 3); x.fill();
  x.strokeStyle = 'rgba(0,0,0,0.45)'; x.lineWidth = 0.7; x.beginPath(); x.roundRect(0, 0, 33, W, 2); x.stroke(); x.beginPath(); x.roundRect(32, 1, L - 32, W - 2, 3); x.stroke();
  x.fillStyle = GLASS; x.fillRect(37, 2.5, 3, W - 5); x.fillStyle = 'rgba(255,255,255,0.25)'; x.fillRect(37.5, 3, 0.8, W - 6);
  // franjas de colores a lo largo de la caja
  ['#c62828', '#f9a825', '#2e7d32'].forEach((c, i) => { x.fillStyle = c; x.fillRect(1, 1.2 + i * 1.2, 31, 1); x.fillRect(1, W - 2.2 - i * 1.2, 31, 1); });
  // letrero de TACOS en el techo
  x.fillStyle = '#c62828'; x.beginPath(); x.roundRect(7, W / 2 - 3.2, 18, 6.4, 1.5); x.fill();
  x.fillStyle = '#fff'; x.font = 'bold 4.6px sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText('TACOS', 16, W / 2 + 0.3);
  // chimenea del trompo con humito y un aire acondicionado
  x.fillStyle = '#9e9e9e'; x.beginPath(); x.arc(28.5, 4.5, 1.7, 0, 7); x.fill(); x.fillStyle = '#424242'; x.beginPath(); x.arc(28.5, 4.5, 0.9, 0, 7); x.fill();
  x.fillStyle = 'rgba(230,230,230,0.6)'; x.beginPath(); x.arc(27, 3, 1.4, 0, 7); x.arc(25.4, 2.4, 1.1, 0, 7); x.fill();
  x.fillStyle = '#cfd8dc'; x.fillRect(2.5, W / 2 - 2.5, 3.5, 5);
  // toldo a rayas del lado de servicio (asoma por la derecha)
  for (let i = 0; i < 6; i++) { x.fillStyle = i % 2 ? '#fafafa' : '#e53935'; x.fillRect(5 + i * 4, W - 0.5, 4, 2.6); }
  // faros y calaveras
  x.fillStyle = '#fff6b0'; x.fillRect(L - 1.6, 2.5, 1.6, 2.6); x.fillRect(L - 1.6, W - 5.1, 1.6, 2.6);
  x.fillStyle = '#ff3b30'; x.fillRect(0, 1.5, 1.2, 2.6); x.fillRect(0, W - 4.1, 1.2, 2.6);
  t.refresh();
}
// burro cebra dorado con sarape, visto desde arriba mirando a la derecha. Lienzo (L + 6) x (W + 6)
function makeZonkey(scene) {
  const { L, W } = VT_ZONKEY, t = scene.textures.createCanvas('zonkey', (L + 6) * SPR, (W + 6) * SPR), x = t.getContext();
  x.scale(SPR, SPR); x.translate(3, 3);
  const cy = W / 2, ell = (c, ex, ey, rx, ry, a) => { x.fillStyle = c; x.beginPath(); x.ellipse(ex, ey, rx, ry, a || 0, 0, 7); x.fill(); };
  ell('rgba(0,0,0,0.3)', L / 2 + 1.5, cy + 1.5, 11, 5);
  // cola, patas y orejas
  x.strokeStyle = '#7a5a12'; x.lineWidth = 1.2; x.lineCap = 'round'; x.beginPath(); x.moveTo(3, cy); x.quadraticCurveTo(0.5, cy + 1.5, -1.5, cy + 3); x.stroke();
  for (const [px, py] of [[6, cy - 4.3], [6, cy + 4.3], [15.5, cy - 4], [15.5, cy + 4]]) ell('#8d6e1e', px, py, 1.6, 1.1);
  // cuerpo dorado con rayas de cebra
  const g = x.createLinearGradient(0, 0, 0, W); g.addColorStop(0, '#fff3b0'); g.addColorStop(0.5, '#ffd54f'); g.addColorStop(1, '#c9a227');
  x.fillStyle = g; x.beginPath(); x.ellipse(10.5, cy, 8.5, 4.6, 0, 0, 7); x.fill();
  x.save(); x.clip(); x.strokeStyle = '#3e2f05'; x.lineWidth = 0.75;
  for (let i = 3.5; i <= 18; i += 1.9) { x.beginPath(); x.moveTo(i, cy - 5); x.quadraticCurveTo(i + 0.8, cy, i, cy + 5); x.stroke(); }
  x.restore();
  // sarape en el lomo
  x.fillStyle = '#e53935'; x.fillRect(8, cy - 3.6, 5, 7.2);
  ['#fdd835', '#43a047', '#1e88e5', '#8e24aa'].forEach((c, i) => { x.fillStyle = c; x.fillRect(8.4 + i * 1.15, cy - 3.6, 0.5, 7.2); });
  // cuello, cabeza y orejas
  x.fillStyle = g; x.beginPath(); x.ellipse(19.5, cy, 3.3, 2.4, 0, 0, 7); x.fill();
  ell('#ffe082', 22.3, cy, 2.6, 2.1); ell('#5d4a12', 24.2, cy, 0.9, 1.4);
  ell('#c9a227', 19.6, cy - 2.6, 2, 0.9, -0.5); ell('#c9a227', 19.6, cy + 2.6, 2, 0.9, 0.5);
  // destellos
  x.fillStyle = '#fffde7'; for (const [px, py] of [[6, cy - 2], [13, cy + 2.6], [17, cy - 1.8]]) { x.beginPath(); x.arc(px, py, 0.5, 0, 7); x.fill(); }
  t.refresh();
}
function makeMoto(scene) {
  const t = scene.textures.createCanvas('moto', 26 * SPR, 14 * SPR), x = t.getContext();
  x.scale(SPR, SPR);
  x.fillStyle = 'rgba(0,0,0,0.3)'; x.beginPath(); x.ellipse(14, 8.5, 11, 4, 0, 0, 7); x.fill();
  // llantas y cuerpo
  x.fillStyle = '#111'; x.fillRect(19, 5.8, 5, 2.4); x.fillRect(1.5, 5.8, 5, 2.4);
  x.fillStyle = '#2b2b2b'; x.beginPath(); x.roundRect(4, 5, 17, 4, 2); x.fill();
  x.strokeStyle = '#999'; x.lineWidth = 1; x.beginPath(); x.moveTo(19, 2.2); x.lineTo(19, 11.8); x.stroke();
  x.fillStyle = '#fff6b0'; x.fillRect(22.5, 6, 1.5, 2);
  // caja termica verde en la parte de atras
  x.fillStyle = '#1e8f4e'; x.fillRect(1, 2.5, 8, 9); x.strokeStyle = '#0d4a28'; x.lineWidth = 0.8; x.strokeRect(1, 2.5, 8, 9);
  x.fillStyle = '#f2f2f2'; x.fillRect(3.2, 5.5, 3.6, 3);
  // repartidor: hombros, brazos al manubrio y casco
  x.fillStyle = '#1e8f4e'; x.beginPath(); x.ellipse(13, 7, 2.6, 4.2, 0, 0, 7); x.fill();
  x.strokeStyle = '#1e8f4e'; x.lineWidth = 1.6; x.beginPath(); x.moveTo(13, 3.5); x.lineTo(18.5, 2.6); x.moveTo(13, 10.5); x.lineTo(18.5, 11.4); x.stroke();
  x.fillStyle = '#e8e8e8'; x.beginPath(); x.arc(14, 7, 2.6, 0, 7); x.fill();
  x.fillStyle = '#1d2733'; x.fillRect(15.4, 5.6, 1.4, 2.8);
  t.refresh();
}
// patrulla municipal: troca blanca con cofre azul y torreta; dos texturas para que la torreta parpadee
const VT_POLI = { name: 'Patrulla', L: 38, W: 17, top: 245, acc: 125, steer: 2.4, hp: 150 };
function makePolice(scene) {
  const L = 38, W = 17, NAVY = '#1b2f6b';
  for (const f of [0, 1]) {
    const t = scene.textures.createCanvas('poli' + f, (L + 5) * SPR, (W + 5) * SPR), x = t.getContext();
    x.scale(SPR, SPR); x.translate(1, 1);
    drawVehicle(x, 2, '#f2f2f2', false);
    // cofre azul con franja blanca y compuerta azul
    x.fillStyle = NAVY; x.beginPath(); x.roundRect(29.6, 0, L - 29.6, W, [0, 3.5, 3.5, 0]); x.fill();
    x.fillStyle = '#f2f2f2'; x.fillRect(29.6, W / 2 - 0.8, L - 31, 1.6);
    x.fillStyle = '#fff6b0'; x.fillRect(L - 1.8, 1.6, 1.8, 2.6); x.fillRect(L - 1.8, W - 4.2, 1.8, 2.6);
    x.fillStyle = NAVY; x.fillRect(0, 0.4, 1.6, W - 0.8);
    x.fillStyle = NAVY; x.fillRect(15, 0, 14.6, 1.6); x.fillRect(15, W - 1.6, 14.6, 1.6);
    // torreta roja y azul sobre la cabina
    const on = f === 0;
    x.fillStyle = '#222'; x.fillRect(22, 1.8, 2.8, W - 3.6);
    x.fillStyle = on ? '#ff2a2a' : '#6b1515'; x.fillRect(22.3, 2.1, 2.2, W / 2 - 2.3);
    x.fillStyle = on ? '#16306b' : '#2f7bff'; x.fillRect(22.3, W / 2 + 0.2, 2.2, W / 2 - 2.3);
    x.fillStyle = on ? 'rgba(255,60,60,0.35)' : 'rgba(60,120,255,0.35)';
    x.beginPath(); x.arc(23.4, on ? 4 : W - 4, 4.5, 0, 7); x.fill();
    t.refresh();
  }
}
function makeTaxi(scene) {
  const t = scene.textures.createCanvas('taxi', 40 * SPR, 19 * SPR), x = t.getContext();
  x.scale(SPR, SPR);
  const L = 37, W = 16, RED = '#c62828', CREAM = '#efe3c2', BLACK = '#151515';
  x.fillStyle = 'rgba(0,0,0,0.35)'; x.fillRect(3, 3, L, W);
  x.fillStyle = RED; x.beginPath(); x.roundRect(0, 0, L, W, 3.5); x.fill();
  x.strokeStyle = 'rgba(0,0,0,0.5)'; x.lineWidth = 0.8; x.stroke();
  // franjas a lo largo de los dos costados: negra, crema, negra
  for (const y of [1.2, W - 4.2]) {
    x.fillStyle = BLACK; x.fillRect(1.5, y, L - 3, 3);
    x.fillStyle = CREAM; x.fillRect(1.5, y + 0.7, L - 3, 1.6);
  }
  // techo largo de guayin con ventanas laterales hasta atras
  x.fillStyle = '#a61f1f'; x.fillRect(4, 3.5, 20, W - 7);
  x.fillStyle = '#1d2733'; x.fillRect(4, 3.2, 20, 1.3); x.fillRect(4, W - 4.5, 20, 1.3);
  x.fillStyle = 'rgba(255,255,255,0.15)'; x.fillRect(7, 5, 14, W - 10);
  // parabrisas, medallon trasero y franja crema del cofre
  x.fillStyle = '#1d2733'; x.fillRect(24, 3.5, 4.5, W - 7); x.fillRect(1.6, 4, 2.4, W - 8);
  x.fillStyle = CREAM; x.fillRect(29, W / 2 - 1, L - 30.5, 2);
  x.fillStyle = BLACK; x.fillRect(29, W / 2 - 1.6, L - 30.5, 0.6); x.fillRect(29, W / 2 + 1, L - 30.5, 0.6);
  // letrero de TAXI en el techo
  x.fillStyle = CREAM; x.fillRect(13, W / 2 - 2.5, 4, 5); x.strokeStyle = BLACK; x.lineWidth = 0.5; x.strokeRect(13, W / 2 - 2.5, 4, 5);
  // faros y calaveras
  x.fillStyle = '#fff6b0'; x.fillRect(L - 1.8, 1.5, 1.8, 3); x.fillRect(L - 1.8, W - 4.5, 1.8, 3);
  x.fillStyle = '#ff3b30'; x.fillRect(0, 1.5, 1.4, 3); x.fillRect(0, W - 4.5, 1.4, 3);
  t.refresh();
}
const PED_FRAME = 24;
// puesto callejero de tacos visto desde arriba: lona a rayas, trompo de pastor, comal y bancos de plastico.
// Tres combinaciones de colores de lona; se dibuja al doble y se muestra a escala 0.5.
const LONAS = [['#d62828', '#f4efe6'], ['#f77f00', '#fcbf49'], ['#2a9d8f', '#e9f5db']];
function makeTacoStands(scene) {
  LONAS.forEach(([c1, c2], v) => {
    const t = scene.textures.createCanvas('puesto' + v, 88, 76), x = t.getContext();
    x.scale(2, 2); x.translate(4, 3);
    // sombra
    x.fillStyle = 'rgba(0,0,0,0.3)'; x.fillRect(3, 3, 32, 22);
    // carrito y mostrador de lamina al frente (abajo)
    x.fillStyle = '#9aa1a6'; x.fillRect(2, 15, 30, 9); x.strokeStyle = '#5d6469'; x.lineWidth = 0.6; x.strokeRect(2, 15, 30, 9);
    x.fillStyle = '#2b2b2b'; x.fillRect(5, 17, 9, 5); // comal
    x.fillStyle = '#c96f2d'; for (const [a, b] of [[7, 18.5], [10, 19.5], [8.5, 20.8], [11.5, 18]]) { x.beginPath(); x.arc(a, b, 0.9, 0, 7); x.fill(); }
    // salsas: roja y verde
    x.fillStyle = '#b3201b'; x.beginPath(); x.arc(18, 19.5, 1.5, 0, 7); x.fill();
    x.fillStyle = '#3f8f2f'; x.beginPath(); x.arc(22, 19.5, 1.5, 0, 7); x.fill();
    x.fillStyle = '#f2e6c9'; x.fillRect(25, 17.5, 5, 4); // tortillas
    // lona a rayas encima
    for (let i = 0; i < 6; i++) { x.fillStyle = i % 2 ? c2 : c1; x.fillRect(i * 5.5, 0, 5.5, 15); }
    x.strokeStyle = 'rgba(0,0,0,0.45)'; x.lineWidth = 0.7; x.strokeRect(0, 0, 33, 15);
    x.fillStyle = 'rgba(255,255,255,0.18)'; x.fillRect(0, 0, 33, 4);
    // letrero pintado a mano
    x.fillStyle = 'rgba(0,0,0,0.55)'; x.fillRect(7, 5, 19, 6.5);
    x.fillStyle = '#ffe066'; x.font = 'bold 6px sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText('TACOS', 16.5, 8.4);
    // trompo de pastor a un lado, con su pina arriba
    x.fillStyle = '#3a3a3a'; x.fillRect(33, 9, 4, 4);
    x.fillStyle = '#b5521b'; x.beginPath(); x.arc(35, 11, 3.2, 0, 7); x.fill();
    x.fillStyle = '#e07b2e'; x.beginPath(); x.arc(34.3, 10.3, 1.9, 0, 7); x.fill();
    x.fillStyle = '#f2c94c'; x.beginPath(); x.arc(35, 11, 1, 0, 7); x.fill();
    // bancos de plastico
    for (const [a, b, c] of [[6, 30, '#c62828'], [15, 31, '#1565c0'], [24, 30, '#c62828']]) {
      x.fillStyle = 'rgba(0,0,0,0.25)'; x.beginPath(); x.arc(a + 0.8, b + 0.8, 2.4, 0, 7); x.fill();
      x.fillStyle = c; x.beginPath(); x.arc(a, b, 2.4, 0, 7); x.fill();
      x.fillStyle = 'rgba(255,255,255,0.25)'; x.beginPath(); x.arc(a - 0.6, b - 0.6, 0.9, 0, 7); x.fill();
    }
    t.refresh();
  });
}
// el puesto va en la banqueta de la calle mas cercana (del lado donde esta la taqueria),
// con el mostrador y los bancos viendo hacia la calle. Devuelve [x, y, rotacion].
// fachada de cafe vista desde arriba: toldo pegado al edificio (atras), mesitas con sombrilla
// y un pizarron en la banqueta (adelante). Tres estilos de toldo.
const TOLDOS = [['#5d3a1a', '#efe3c8', '#efe3c8'], ['#1f4d3a', '#f4f1e8', '#f4f1e8'], ['#1d1d1d', '#c9a26b', '#f0e6d2']];
function makeCafes(scene) {
  TOLDOS.forEach(([c1, c2, tx], v) => {
    const t = scene.textures.createCanvas('cafe' + v, 96, 70), x = t.getContext();
    x.scale(2, 2); x.translate(3, 2);
    // toldo a rayas con orilla de olanes
    x.fillStyle = 'rgba(0,0,0,0.3)'; x.fillRect(2, 2, 40, 14);
    for (let i = 0; i < 8; i++) { x.fillStyle = i % 2 ? c2 : c1; x.fillRect(i * 5, 0, 5, 12); }
    for (let i = 0; i < 8; i++) { x.fillStyle = i % 2 ? c2 : c1; x.beginPath(); x.arc(i * 5 + 2.5, 12, 2.5, 0, Math.PI); x.fill(); }
    x.strokeStyle = 'rgba(0,0,0,0.35)'; x.lineWidth = 0.6; x.strokeRect(0, 0, 40, 12);
    x.fillStyle = 'rgba(255,255,255,0.15)'; x.fillRect(0, 0, 40, 3);
    x.fillStyle = c1; x.fillRect(11, 3.5, 18, 6); x.fillStyle = tx; x.font = 'bold 5.5px serif'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText('CAFÉ', 20, 6.8);
    // mesitas con sombrilla y sillas
    for (const mx of [8, 30]) {
      x.fillStyle = '#6b6b6b'; for (const [a, b] of [[-4, 0], [4, 0]]) { x.beginPath(); x.arc(mx + a, 23 + b, 1.6, 0, 7); x.fill(); }
      x.fillStyle = 'rgba(0,0,0,0.25)'; x.beginPath(); x.arc(mx + 1, 24, 5, 0, 7); x.fill();
      x.fillStyle = c1; x.beginPath(); x.arc(mx, 23, 4.5, 0, 7); x.fill();
      x.strokeStyle = c2; x.lineWidth = 0.6; x.beginPath();
      for (let k = 0; k < 4; k++) { const a = k * Math.PI / 4; x.moveTo(mx - Math.cos(a) * 4.5, 23 - Math.sin(a) * 4.5); x.lineTo(mx + Math.cos(a) * 4.5, 23 + Math.sin(a) * 4.5); }
      x.stroke();
    }
    // pizarron con el menu y una taza junto
    x.fillStyle = '#3b2a1a'; x.fillRect(17.5, 19.5, 5, 7); x.fillStyle = '#263238'; x.fillRect(18.2, 20.2, 3.6, 5.6);
    x.strokeStyle = 'rgba(255,255,255,0.7)'; x.lineWidth = 0.35; x.beginPath(); for (const yy of [21.5, 23, 24.5]) { x.moveTo(18.8, yy); x.lineTo(21.2, yy); } x.stroke();
    t.refresh();
  });
}
// "comida china": local grande con marquesina de neon, faroles rojos, alfombra, cordon y cadenero.
// Dos texturas para que el neon parpadee. El frente (alfombra) va hacia abajo.
function makeChinas(scene) {
  for (const k of ['0', '1', '0u', '1u']) {
    const f = +k[0], up = k.length > 1; // 'u': letrero volteado para locales que quedan "de cabeza"
    const t = scene.textures.createCanvas('antro' + k, 176, 128), x = t.getContext();
    x.scale(2, 2); x.translate(4, 3);
    const neon = f ? '#3ff0ff' : '#ff3fa4';
    // edificio y marquesina
    x.fillStyle = 'rgba(0,0,0,0.35)'; x.fillRect(3, 3, 80, 36);
    x.fillStyle = '#2a1630'; x.fillRect(0, 0, 80, 36);
    x.fillStyle = '#3a1e42'; for (let i = 4; i < 80; i += 8) x.fillRect(i, 2, 4, 20);
    x.fillStyle = '#7a0f1a'; x.fillRect(4, 24, 72, 12);
    x.strokeStyle = neon; x.lineWidth = 1.2; x.strokeRect(4.5, 24.5, 71, 11);
    x.shadowColor = neon; x.shadowBlur = 4;
    x.fillStyle = '#ffd23f'; x.font = 'bold 8px sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle';
    x.save(); x.translate(40, 30.2); if (up) x.rotate(Math.PI); x.fillText('COMIDA CHINA', 0, 0); x.restore();
    x.shadowBlur = 0;
    x.strokeStyle = neon; x.lineWidth = 1; x.strokeRect(0.5, 0.5, 79, 35);
    // faroles rojos en las esquinas
    for (const lx of [8, 72]) {
      x.fillStyle = f ? '#ff5a4a' : '#d4261a'; x.beginPath(); x.ellipse(lx, 40, 3.6, 4.4, 0, 0, 7); x.fill();
      x.strokeStyle = '#f5c542'; x.lineWidth = 0.6; x.beginPath(); x.moveTo(lx - 3.6, 40); x.lineTo(lx + 3.6, 40); x.stroke();
      x.fillStyle = '#f5c542'; x.fillRect(lx - 1.5, 35, 3, 1.2); x.fillRect(lx - 1.5, 44, 3, 1.2);
    }
    // puerta y alfombra roja
    x.fillStyle = '#0d0d0d'; x.fillRect(33, 34, 14, 3);
    x.fillStyle = '#b3141f'; x.fillRect(35, 37, 10, 15);
    // cordon de terciopelo con postes dorados
    x.strokeStyle = '#8e0f2a'; x.lineWidth = 0.9;
    for (const sx of [30, 50]) {
      x.beginPath(); x.moveTo(sx, 38); x.quadraticCurveTo(sx + (sx < 40 ? -1.5 : 1.5), 44, sx, 50); x.stroke();
      x.fillStyle = '#e8c35a'; for (const py of [38, 50]) { x.beginPath(); x.arc(sx, py, 1.2, 0, 7); x.fill(); }
    }
    // cadenero junto a la puerta
    x.fillStyle = '#111'; x.beginPath(); x.ellipse(54, 40, 3.2, 4.2, 0, 0, 7); x.fill();
    x.fillStyle = '#7a5236'; x.beginPath(); x.arc(54, 40, 1.8, 0, 7); x.fill();
    x.fillStyle = '#000'; x.fillRect(53, 39.4, 2.2, 0.8);
    // gente formada afuera del cordon
    for (const [px, py, c] of [[25, 42, '#2980b9'], [24, 47.5, '#8e44ad'], [26, 53, '#27ae60']]) {
      x.fillStyle = c; x.beginPath(); x.ellipse(px, py, 1.8, 2.6, 0, 0, 7); x.fill();
      x.fillStyle = '#3b2414'; x.beginPath(); x.arc(px, py, 1.3, 0, 7); x.fill();
    }
    t.refresh();
  }
}
// encima del auto quemado: manchas de hollin, vidrios rotos y lamina abollada (64 de largo x 32 de ancho, frente a la derecha)
function makeScorch(scene) {
  const t = scene.textures.createCanvas('scorch', 64, 32), x = t.getContext(), r = mulberry(7);
  for (let i = 0; i < 14; i++) { x.fillStyle = 'rgba(0,0,0,' + (0.25 + r() * 0.4) + ')'; x.beginPath(); x.ellipse(6 + r() * 52, 5 + r() * 22, 3 + r() * 9, 2 + r() * 6, r() * 3, 0, 7); x.fill(); }
  x.fillStyle = 'rgba(255,120,30,0.35)'; x.beginPath(); x.ellipse(46, 16, 10, 8, 0, 0, 7); x.fill(); // cofre al rojo vivo
  x.strokeStyle = 'rgba(220,230,240,0.7)'; x.lineWidth = 0.7; // parabrisas estrellado
  for (let i = 0; i < 7; i++) { const a = r() * 6.3; x.beginPath(); x.moveTo(38, 16); x.lineTo(38 + Math.cos(a) * 7, 16 + Math.sin(a) * 9); x.stroke(); }
  x.strokeStyle = 'rgba(0,0,0,0.6)'; x.lineWidth = 1.2; // abolladuras
  for (let i = 0; i < 5; i++) { const px = 8 + r() * 48, py = r() < 0.5 ? 2 : 30; x.beginPath(); x.moveTo(px, py); x.quadraticCurveTo(px + 3, py + (py < 16 ? 5 : -5), px + 7, py); x.stroke(); }
  t.refresh();
}
// easter eggs vistos desde arriba: lienzo de 32x32 unidades dibujado a 5x para que tengan detalle
// insignias de los lugares ★: un circulo con borde dorado y un dibujo propio de cada lugar.
// Se dibujan centradas en (0, 0) dentro de un radio de ~22; la textura mide LM_SIZE a SPR veces la resolucion
const LM_SIZE = 72;
function makeLandmarkIcons(scene) {
  let x;
  const fill = (c) => { x.fillStyle = c; x.fill(); };
  const ell = (c, cx, cy, rx, ry, a) => { x.beginPath(); x.ellipse(cx, cy, rx, ry, a || 0, 0, 7); fill(c); };
  const circ = (c, cx, cy, r) => ell(c, cx, cy, r, r);
  const rect = (c, x0, y0, w, h) => { x.fillStyle = c; x.fillRect(x0, y0, w, h); };
  const poly = (c, pts) => { x.beginPath(); pts.forEach(([a, b], i) => i ? x.lineTo(a, b) : x.moveTo(a, b)); x.closePath(); fill(c); };
  const line = (c, w, pts) => { x.strokeStyle = c; x.lineWidth = w; x.lineCap = 'round'; x.lineJoin = 'round'; x.beginPath(); pts.forEach(([a, b], i) => i ? x.lineTo(a, b) : x.moveTo(a, b)); x.stroke(); };
  const ring = (c, w, cx, cy, r, a0 = 0, a1 = 7) => { x.strokeStyle = c; x.lineWidth = w; x.lineCap = 'round'; x.beginPath(); x.arc(cx, cy, r, a0, a1); x.stroke(); };
  const txt = (c, size, s, cx, cy) => { x.fillStyle = c; x.font = 'bold ' + size + 'px sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText(s, cx, cy); };
  const flagMx = (x0, y0, w, h) => { rect('#006847', x0, y0, w / 3, h); rect('#fff', x0 + w / 3, y0, w / 3, h); rect('#ce1126', x0 + w * 2 / 3, y0, w / 3, h); circ('#8b5a2b', x0 + w / 2, y0 + h / 2, h * 0.15); };
  const icons = {
    'Arco Monumental': ['#1f4e79', () => { // arco metalico con el reloj colgando
      rect('rgba(255,255,255,0.18)', -22, 17, 44, 3);
      x.save(); x.translate(0, 18); x.scale(1, 1.35);
      ring('#9aa3ad', 4.4, 0, 0, 18, Math.PI, 0); ring('#e3e7ec', 1.6, 0, 0, 18, Math.PI + 0.1, -0.1); x.restore();
      line('#c9ced5', 1.2, [[0, -6], [0, -2]]);
      circ('#2b2b2b', 0, 4, 7.5); circ('#fdf8e7', 0, 4, 6.2);
      for (let i = 0; i < 12; i++) { const a = i / 12 * Math.PI * 2; circ('#2b2b2b', Math.cos(a) * 5, 4 + Math.sin(a) * 5, 0.45); }
      line('#2b2b2b', 1.1, [[0, 4], [0, 0.2]]); line('#c62828', 0.8, [[0, 4], [3.6, 5.4]]);
    }],
    'Plaza Santa Cecilia': ['#7b1f2b', () => { // sombrero de charro con notas de mariachi
      ell('#1a1a1a', 0, 7, 20, 6.5); x.beginPath(); x.ellipse(0, 7, 18.5, 5.4, 0, 0, 7); x.strokeStyle = '#e3b341'; x.lineWidth = 1.2; x.stroke();
      x.beginPath(); x.moveTo(-8, 6); x.bezierCurveTo(-8, -9, 8, -9, 8, 6); fill('#222');
      rect('#e3b341', -8, 2, 16, 2.2);
      for (const [nx, ny] of [[11, -12], [16, -7]]) { circ('#fff', nx, ny, 1.8); line('#fff', 1, [[nx + 1.6, ny], [nx + 1.6, ny - 7], [nx + 4, ny - 5.5]]); }
    }],
    'Catedral de Guadalupe': ['#3b6ea5', () => { // fachada de dos torres
      rect('#efe2c4', -11, -4, 22, 22); poly('#efe2c4', [[-11, -4], [0, -12], [11, -4]]);
      for (const tx of [-17, 10]) { rect('#e4d3ae', tx, -10, 7, 28); x.beginPath(); x.arc(tx + 3.5, -10, 3.5, Math.PI, 0); fill('#c9a464'); line('#5a4632', 1, [[tx + 3.5, -14], [tx + 3.5, -19]]); line('#5a4632', 1, [[tx + 1.8, -17], [tx + 5.2, -17]]); rect('#6b5a45', tx + 2.3, -5, 2.4, 4); }
      circ('#6fa8dc', 0, -3, 2.6); ring('#8a6d45', 0.8, 0, -3, 2.6);
      x.beginPath(); x.moveTo(-4, 18); x.lineTo(-4, 8); x.arc(0, 8, 4, Math.PI, 0); x.lineTo(4, 18); fill('#5a3d22');
    }],
    'Museo de Historia (MUHTI)': ['#6b4f2a', () => { // palacio con columnas y frontón
      poly('#f3e6cc', [[-19, -5], [0, -16], [19, -5]]); rect('#d9c8a5', -19, -6, 38, 3);
      for (let i = 0; i < 5; i++) rect('#f3e6cc', -16 + i * 7.6, -2, 4, 16);
      rect('#d9c8a5', -20, 14, 40, 3); rect('#c9b691', -22, 17, 44, 3);
      txt('#6b4f2a', 4.2, 'MUHTI', 0, -8.5);
    }],
    "Hotel Caesar's": ['#2e7d32', () => { // ensalada Cesar con tenedor
      ell('#fafafa', -2, 3, 17, 13); ell('#e6e6e6', -2, 3, 13, 9.5);
      for (const [lx, ly, a] of [[-7, 1, -0.6], [2, -1, 0.5], [-3, 6, 0.2], [4, 6, -0.4], [-9, 6, 0.9]]) { ell('#7cb342', lx, ly, 6, 2.8, a); line('#c5e1a5', 0.5, [[lx - 4 * Math.cos(a), ly - 4 * Math.sin(a)], [lx + 4 * Math.cos(a), ly + 4 * Math.sin(a)]]); }
      for (const [cx2, cy2] of [[-4, -2], [3, 3], [-8, 3], [1, 8]]) { x.save(); x.translate(cx2, cy2); x.rotate(cx2); rect('#e0b46c', -1.3, -1.3, 2.6, 2.6); x.restore(); }
      for (let i = 0; i < 9; i++) circ('#fffde7', -10 + i * 2.4, -1 + (i % 3) * 3.5, 0.6);
      line('#cfd8dc', 1.6, [[17, -14], [17, 16]]); for (const fx of [15.5, 17, 18.5]) line('#cfd8dc', 0.8, [[fx, -18], [fx, -12]]);
    }],
    'Frontón Jai Alai': ['#b45309', () => { // cesta de jai alai y la pelota
      x.beginPath(); x.moveTo(-16, 10); x.quadraticCurveTo(-4, -22, 16, -12); x.quadraticCurveTo(2, -10, -10, 14); x.closePath(); fill('#c8945a');
      x.save(); x.clip(); for (let i = -20; i < 20; i += 3) line('#9c6b37', 0.7, [[i, -20], [i + 10, 20]]); x.restore();
      line('#6d4520', 1.6, [[-16, 10], [-10, 14]]); rect('#5d3a1a', -15, 11, 4, 9);
      circ('#fafafa', 9, 8, 5); ring('#9e9e9e', 0.6, 9, 8, 5); ring('#bdbdbd', 0.5, 9, 8, 3.2, 0.5, 2.6);
    }],
    'Pasaje Rodríguez': ['#4a148c', () => { // paleta de pintor y pincel
      x.beginPath(); x.ellipse(-2, 2, 17, 13, -0.3, 0, 7); fill('#e8c99a'); circ('#4a148c', 6, 8, 3.2);
      [['#e53935', -11, 0], ['#fdd835', -6, -6], ['#43a047', 1, -8], ['#1e88e5', 8, -4], ['#fb8c00', -9, 7]].forEach(([c, px, py]) => circ(c, px, py, 2.6));
      line('#6d4c41', 2, [[4, 18], [18, -12]]); line('#bdbdbd', 2.2, [[16.5, -9], [18, -12]]); line('#e53935', 2, [[18, -12], [19.5, -16]]);
    }],
    'Foreign Club': ['#1b5e20', () => { // naipe y dados de casino
      x.save(); x.rotate(-0.25); x.beginPath(); x.roundRect(-16, -16, 15, 21, 2); fill('#fafafa'); txt('#c62828', 7, 'A', -8.5, -9); txt('#c62828', 7, '♥', -8.5, 0); x.restore();
      const die = (cx2, cy2, a, n) => { x.save(); x.translate(cx2, cy2); x.rotate(a); x.beginPath(); x.roundRect(-6.5, -6.5, 13, 13, 2.5); fill('#fafafa');
        const P = { 1: [[0, 0]], 5: [[-3, -3], [3, -3], [0, 0], [-3, 3], [3, 3]], 6: [[-3, -3.5], [3, -3.5], [-3, 0], [3, 0], [-3, 3.5], [3, 3.5]] }[n];
        P.forEach(([px, py]) => circ('#1a1a1a', px, py, 1.2)); x.restore(); };
      die(7, -3, 0.3, 5); die(4, 11, -0.2, 6);
    }],
    'Museo de Cera': ['#5d4037', () => { // vela de cera derritiendose
      rect('#f5e6c8', -6, -6, 12, 22); x.beginPath(); x.moveTo(-6, -6); x.quadraticCurveTo(0, -9, 6, -6); fill('#f5e6c8');
      for (const [dx, dl] of [[-4, 7], [1, 11], [4.5, 5]]) { rect('#fff4dc', dx - 1, -6, 2, dl); circ('#fff4dc', dx, -6 + dl, 1.3); }
      rect('#d7c49e', -6, -6, 1.5, 22);
      line('#3e2723', 0.9, [[0, -8], [0, -11]]);
      ell('#ffb300', 0, -15, 2.8, 5); ell('#fff59d', 0, -14, 1.3, 2.6);
      ell('rgba(0,0,0,0.25)', 0, 17, 10, 2.4); rect('#8d6e63', -10, 15, 20, 3);
    }],
    'Parque Teniente Guerrero': ['#2f6f3e', () => { // kiosco entre arboles
      circ('#1b5e20', -15, -4, 7); circ('#388e3c', -14, -6, 5); circ('#1b5e20', 15, -4, 7); circ('#388e3c', 14, -6, 5);
      rect('#5d4037', -16, 2, 2, 12); rect('#5d4037', 14, 2, 2, 12);
      poly('#c62828', [[-11, -4], [0, -15], [11, -4]]); rect('#e8d9b5', -12, -5, 24, 2);
      for (let i = 0; i < 5; i++) rect('#f5ecd7', -10 + i * 5, -3, 1.6, 12);
      rect('#d7c4a0', -13, 9, 26, 3); rect('#bfa982', -14, 12, 28, 3);
      line('#ffd23f', 1, [[0, -15], [0, -18]]);
    }],
    'Teatro Zaragoza': ['#8b0000', () => { // mascaras de comedia y tragedia
      const mask = (cx2, cy2, a, happy, c) => { x.save(); x.translate(cx2, cy2); x.rotate(a);
        x.beginPath(); x.moveTo(-8, -9); x.quadraticCurveTo(0, -12, 8, -9); x.quadraticCurveTo(9, 6, 0, 11); x.quadraticCurveTo(-9, 6, -8, -9); fill(c);
        ell('#2b2b2b', -3.5, -3, 2, happy ? 1.3 : 1.6, happy ? 0 : 0.3); ell('#2b2b2b', 3.5, -3, 2, happy ? 1.3 : 1.6, happy ? 0 : -0.3);
        x.beginPath(); if (happy) { x.arc(0, 2, 4, 0.15, Math.PI - 0.15); } else { x.arc(0, 7, 4, Math.PI + 0.25, -0.25); } x.strokeStyle = '#2b2b2b'; x.lineWidth = 1.4; x.stroke(); x.restore(); };
      mask(6, 3, 0.3, false, '#cfd8dc'); mask(-6, -2, -0.25, true, '#fff8e1');
    }],
    'Mercado de Artesanías': ['#00897b', () => { // pinata de estrella
      const cols = ['#e91e63', '#ffeb3b', '#2196f3', '#ff9800', '#9c27b0', '#4caf50', '#f44336'];
      for (let i = 0; i < 7; i++) { const a = i / 7 * Math.PI * 2 - Math.PI / 2, ca = Math.cos(a), sa = Math.sin(a);
        poly(cols[i], [[ca * 18, sa * 18], [Math.cos(a + 0.45) * 7, Math.sin(a + 0.45) * 7], [Math.cos(a - 0.45) * 7, Math.sin(a - 0.45) * 7]]);
        line(cols[(i + 3) % 7], 0.9, [[ca * 18, sa * 18], [ca * 21, sa * 21 + 2]]); }
      circ('#ffeb3b', 0, 0, 8.5); ring('#e91e63', 1.4, 0, 0, 6.3); ring('#2196f3', 1.4, 0, 0, 3.8);
    }],
    'Puente El Chaparral': ['#455a64', () => { // puente peatonal con alguien cruzando
      x.beginPath(); x.moveTo(-22, 10); x.quadraticCurveTo(0, -4, 22, 10); x.lineTo(22, 13); x.quadraticCurveTo(0, -1, -22, 13); fill('#cfd8dc');
      // barandal: la misma curva 5 px arriba, con postes (y de la curva en x: t = (x / 22 + 1) / 2)
      x.beginPath(); x.moveTo(-22, 5); x.quadraticCurveTo(0, -9, 22, 5); x.strokeStyle = '#eceff1'; x.lineWidth = 0.9; x.stroke();
      for (let i = -18; i <= 18; i += 4) { const t = (i / 22 + 1) / 2, yy = 10 - 28 * t * (1 - t); line('#eceff1', 0.6, [[i, yy], [i, yy - 5]]); }
      rect('#90a4ae', -20, 12, 3, 9); rect('#90a4ae', 17, 12, 3, 9);
      circ('#ffd23f', 0, -12, 2); line('#ffd23f', 1.6, [[0, -10], [0, -5]]); line('#ffd23f', 1.3, [[0, -5], [-2, -1.5]]); line('#ffd23f', 1.3, [[0, -5], [2, -1.5]]); line('#ffd23f', 1.2, [[0, -9], [2.5, -6.5]]); line('#ffd23f', 1.2, [[0, -9], [-2.5, -6.5]]);
    }],
    'Garita de San Ysidro': ['#37474f', () => { // caseta con pluma
      rect('#eceff1', -20, -15, 40, 4); for (const px of [-18, -1, 16]) rect('#b0bec5', px, -11, 2, 18);
      x.beginPath(); x.roundRect(-14, -6, 10, 13, 1.5); fill('#90caf9'); rect('#546e7a', -14, -6, 10, 2.5);
      x.save(); x.translate(-3, 4); x.rotate(-0.12); for (let i = 0; i < 6; i++) rect(i % 2 ? '#fafafa' : '#e53935', i * 3.4, -1.2, 3.4, 2.4); x.restore();
      circ('#263238', -3, 4, 1.6);
      rect('#2e7d32', 8, -5, 6, 8); circ('#a5d6a7', 11, -2.5, 1.4); circ('#1b5e20', 11, 1, 1.4);
      rect('rgba(255,255,255,0.25)', -22, 8, 44, 1); txt('#fff', 3.6, 'U.S.A.  ·  MÉXICO', 0, 15);
    }],
    'Mercado Hidalgo': ['#f57c00', () => { // chiles
      const chile = (cx2, cy2, a, c, c2) => { x.save(); x.translate(cx2, cy2); x.rotate(a);
        x.beginPath(); x.moveTo(-3, -12); x.quadraticCurveTo(6, -10, 4, 2); x.quadraticCurveTo(2, 12, -6, 15); x.quadraticCurveTo(-1, 6, -4, -2); x.quadraticCurveTo(-6, -10, -3, -12); fill(c);
        line(c2, 1, [[0, -9], [1.5, -2]]); x.beginPath(); x.ellipse(-1, -12.5, 3.2, 1.6, 0, 0, 7); fill('#558b2f'); line('#33691e', 1.5, [[-1, -13], [1, -18]]); x.restore(); };
      chile(-6, 2, -0.35, '#d32f2f', 'rgba(255,255,255,0.45)'); chile(6, 1, 0.35, '#43a047', 'rgba(255,255,255,0.4)');
    }],
    'Museo del Taco': ['#c62828', () => { // taco de adobada con su limon
      x.beginPath(); x.arc(0, 6, 17, Math.PI, 0); fill('#f3cf7a');
      x.beginPath(); x.arc(0, 6, 13, Math.PI, 0); fill('#a8401a');
      for (const [px, py] of [[-7, -1], [-1, -4], [5, -2], [9, 2], [-10, 3]]) circ('#c4562b', px, py, 2.2);
      for (const [px, py] of [[-5, -4], [2, -6], [7, -3], [-9, 0]]) circ('#43a047', px, py, 1.3);
      for (const [px, py] of [[-2, -1], [4, 1], [-7, 2]]) rect('#fafafa', px, py, 2, 1.4);
      ring('#e0b55a', 1.2, 0, 6, 17, Math.PI, 0); rect('#e0b55a', -17, 5.5, 34, 1.2);
      x.beginPath(); x.moveTo(12, 16); x.arc(12, 16, 6, Math.PI * 1.15, Math.PI * 1.85); x.closePath(); fill('#7cb342'); x.beginPath(); x.moveTo(12, 16); x.arc(12, 16, 4.6, Math.PI * 1.2, Math.PI * 1.8); x.closePath(); fill('#dcedc8');
    }],
    'CECUT': ['#0d47a1', () => { // La Bola
      rect('#bcaaa4', -18, 10, 36, 6); rect('#a1887f', -20, 15, 40, 3);
      const g = x.createRadialGradient(-5, -8, 2, 0, -2, 16); g.addColorStop(0, '#f5ead8'); g.addColorStop(1, '#b8a68a');
      x.beginPath(); x.arc(0, -2, 14, 0, 7); x.fillStyle = g; x.fill();
      x.save(); x.beginPath(); x.arc(0, -2, 14, 0, 7); x.clip();
      for (let i = -12; i <= 12; i += 4) { x.beginPath(); x.ellipse(0, -2 + i, 14, 1.2, 0, 0, 7); x.strokeStyle = 'rgba(120,100,80,0.35)'; x.lineWidth = 0.6; x.stroke(); }
      for (let i = -10; i <= 10; i += 5) { x.beginPath(); x.ellipse(i, -2, Math.max(0.5, 14 - Math.abs(i) * 1.3), 14, 0, 0, 7); x.stroke(); }
      x.restore();
    }],
    'El Cubo': ['#263238', () => { // un cubo
      poly('#eceff1', [[0, -17], [16, -8], [0, 1], [-16, -8]]);
      poly('#b0bec5', [[-16, -8], [0, 1], [0, 19], [-16, 10]]);
      poly('#78909c', [[16, -8], [0, 1], [0, 19], [16, 10]]);
      for (let i = 1; i < 4; i++) { line('rgba(0,0,0,0.12)', 0.5, [[-16, -8 + i * 4.5], [0, 1 + i * 4.5]]); line('rgba(0,0,0,0.15)', 0.5, [[16, -8 + i * 4.5], [0, 1 + i * 4.5]]); }
    }],
    'Monumento a México': ['#1565c0', () => { // Las Tijeras: dos arcos que se cruzan
      rect('#90a4ae', -20, 15, 40, 4);
      x.beginPath(); x.moveTo(-17, 15); x.quadraticCurveTo(-6, -30, 12, -18); x.lineTo(9, -14); x.quadraticCurveTo(-4, -22, -11, 15); fill('#eceff1');
      x.beginPath(); x.moveTo(17, 15); x.quadraticCurveTo(6, -30, -12, -18); x.lineTo(-9, -14); x.quadraticCurveTo(4, -22, 11, 15); fill('#cfd8dc');
    }],
    'Glorieta Cuauhtémoc': ['#bf360c', () => { // penacho de plumas sobre la cabeza
      const cols = ['#2e7d32', '#1565c0', '#43a047', '#c62828', '#1e88e5', '#2e7d32', '#fdd835', '#43a047', '#1565c0'];
      for (let i = 0; i < 9; i++) { const a = Math.PI + (i + 0.5) / 9 * Math.PI; x.save(); x.translate(0, 6); x.rotate(a + Math.PI / 2); ell(cols[i], 0, -14, 3, 9); line('rgba(255,255,255,0.4)', 0.5, [[0, -6], [0, -22]]); x.restore(); }
      rect('#fdd835', -10, 1, 20, 3.5); for (let i = -8; i <= 8; i += 4) circ('#c62828', i, 2.8, 1);
      x.beginPath(); x.arc(0, 11, 8, Math.PI, 0); fill('#8d5a3b'); rect('#8d5a3b', -8, 11, 16, 8);
    }],
    'Glorieta Lincoln': ['#283593', () => { // sombrero de copa y cadenas rotas
      rect('#1a1a1a', -8, -18, 16, 18); ell('#1a1a1a', 0, 0, 14, 3.5); rect('#5d4037', -8, -5, 16, 3);
      const link = (cx2, cy2, a) => { x.save(); x.translate(cx2, cy2); x.rotate(a); x.beginPath(); x.ellipse(0, 0, 4, 2.4, 0, 0, 7); x.strokeStyle = '#cfd8dc'; x.lineWidth = 1.6; x.stroke(); x.restore(); };
      link(-16, 9, 0.4); link(-11, 11, -0.3); link(-6, 12, 0.2); link(16, 9, -0.4); link(11, 11, 0.3);
      line('#ffd23f', 1, [[-3, 10], [-1, 13], [-3, 15]]); line('#ffd23f', 1, [[5, 10], [3, 13], [5, 15]]);
    }],
    'Glorieta Zaragoza': ['#33691e', () => { // quepi y los lentes redondos del general
      x.beginPath(); x.moveTo(-11, -2); x.lineTo(-9, -17); x.lineTo(9, -17); x.lineTo(11, -2); x.closePath(); fill('#1a237e');
      rect('#ffd23f', -11, -6, 22, 2.5); ell('#0d1257', 0, -1, 14, 3.2); circ('#ffd23f', 0, -12, 2);
      ring('#e0e0e0', 1.4, -6, 9, 4.6); ring('#e0e0e0', 1.4, 6, 9, 4.6); line('#e0e0e0', 1.2, [[-1.4, 8.5], [1.4, 8.5]]);
      circ('rgba(144,202,249,0.35)', -6, 9, 3.9); circ('rgba(144,202,249,0.35)', 6, 9, 3.9);
      line('#3e2723', 2.2, [[-6, 17], [0, 15.5], [6, 17]]);
    }],
    'Plaza Río Tijuana': ['#ad1457', () => { // bolsa de compras
      ring('#f8bbd0', 1.8, 0, -8, 6, Math.PI, 0);
      x.beginPath(); x.moveTo(-13, -8); x.lineTo(13, -8); x.lineTo(15, 17); x.lineTo(-15, 17); x.closePath(); fill('#fafafa');
      poly('#e0e0e0', [[13, -8], [15, 17], [11, 17]]);
      txt('#ad1457', 13, 'R', 0, 5);
    }],
    'Palacio Municipal': ['#546e7a', () => { // edificio con la bandera
      rect('#eceff1', -16, -6, 32, 24); rect('#cfd8dc', -18, -8, 36, 3);
      for (let r = 0; r < 3; r++) for (let c = 0; c < 5; c++) rect('#64b5f6', -13 + c * 5.6, -2 + r * 6, 3.6, 4);
      rect('#795548', -2.5, 12, 5, 6);
      line('#b0bec5', 1, [[0, -8], [0, -22]]); flagMx(0.5, -22, 12, 7);
    }],
    'Defensa Heroica': ['#4e342e', () => { // obelisco de 1911
      poly('#d7ccc8', [[-4, 12], [-2.6, -15], [0, -20], [2.6, -15], [4, 12]]); poly('#a1887f', [[0, -20], [2.6, -15], [4, 12], [0.5, 12]]);
      rect('#bcaaa4', -12, 12, 24, 4); rect('#a1887f', -14, 16, 28, 3);
      txt('#4e342e', 4.4, '1911', 0, 14.2);
      for (const sx of [-1, 1]) for (let i = 0; i < 4; i++) ell('#7cb342', sx * (8 + i * 1.6), 8 - i * 3.6, 1.2, 2.4, sx * (0.6 + i * 0.15));
    }],
  };
  // insignia de respaldo (un lugar nuevo sin dibujo): la estrella de siempre
  const fallback = ['#5d4037', () => txt('#ffd23f', 30, '★', 0, 1)];
  landmarks.forEach((l, i) => {
    const [bg, art] = icons[l.name] || fallback, S0 = LM_SIZE, R = 30;
    const t = scene.textures.createCanvas('lm' + i, S0 * SPR, S0 * SPR); x = t.getContext();
    x.scale(SPR, SPR); x.translate(S0 / 2, S0 / 2);
    circ('rgba(0,0,0,0.35)', 2, 3, R);
    const g = x.createRadialGradient(-R * 0.4, -R * 0.4, 2, 0, 0, R); g.addColorStop(0, shade(bg, 1.35)); g.addColorStop(1, bg);
    x.beginPath(); x.arc(0, 0, R, 0, 7); x.fillStyle = g; x.fill();
    x.save(); x.beginPath(); x.arc(0, 0, R - 3, 0, 7); x.clip(); art(); x.restore();
    ring('#ffd23f', 3.4, 0, 0, R - 1.5); ring('rgba(255,255,255,0.35)', 0.8, 0, 0, R - 4);
    t.refresh();
    l.icon = 'lm' + i;
  });
}
function makeEggs(scene) {
  let x;
  const ell = (c, cx, cy, rx, ry, a) => { x.fillStyle = c; x.beginPath(); x.ellipse(cx, cy, rx, ry, a || 0, 0, 7); x.fill(); };
  const line = (c, w, pts) => { x.strokeStyle = c; x.lineWidth = w; x.lineCap = 'round'; x.beginPath(); pts.forEach(([a, b], i) => i ? x.lineTo(a, b) : x.moveTo(a, b)); x.stroke(); };
  const rad = (cx, cy, r, c0, c1) => { const g = x.createRadialGradient(cx - r * 0.35, cy - r * 0.35, r * 0.1, cx, cy, r); g.addColorStop(0, c0); g.addColorStop(1, c1); return g; };
  const ball = (cx, cy, r, c0, c1, out) => { x.fillStyle = rad(cx, cy, r, c0, c1); x.beginPath(); x.arc(cx, cy, r, 0, 7); x.fill(); if (out) { x.strokeStyle = out; x.lineWidth = 0.35; x.stroke(); } };
  const shadow = (cx, cy, rx, ry) => ell('rgba(0,0,0,0.32)', cx + 1.2, cy + 1.4, rx, ry);
  // persona vista desde arriba: hombros con brazos, cabeza con pelo (opcional)
  const shoulders = (cx, cy, c0, c1, w = 5, h = 3.4) => { x.fillStyle = rad(cx, cy, w, c0, c1); x.beginPath(); x.ellipse(cx, cy, w, h, 0, 0, 7); x.fill(); x.strokeStyle = 'rgba(0,0,0,0.45)'; x.lineWidth = 0.35; x.stroke(); };
  const draw = {
    burro(x0) { // burro pintado de cebra con sarape, jalando su carreta para la foto
      shadow(16, 18, 11, 13);
      // carreta de madera pintada con letrero
      x.fillStyle = '#7a4a22'; x.fillRect(8.5, 21, 15, 9.5);
      x.fillStyle = '#c0392b'; x.fillRect(9.2, 21.6, 13.6, 8.3);
      x.fillStyle = '#f4d03f'; x.fillRect(9.2, 23.5, 13.6, 1.1); x.fillStyle = '#27ae60'; x.fillRect(9.2, 26.8, 13.6, 1.1);
      x.fillStyle = '#fff'; x.font = 'bold 2.4px sans-serif'; x.textAlign = 'center'; x.fillText('TIJUANA', 16, 26.4);
      ell('#2c2c2c', 7.8, 25.5, 1, 3.2); ell('#2c2c2c', 24.2, 25.5, 1, 3.2); // ruedas
      line('#5a3415', 0.6, [[13, 21], [14, 15]]); line('#5a3415', 0.6, [[19, 21], [18, 15]]); // varas
      // cuerpo de burro con rayas
      x.fillStyle = rad(16, 11, 7, '#ffffff', '#d9d6cc'); x.beginPath(); x.ellipse(16, 11.5, 4.4, 7.4, 0, 0, 7); x.fill();
      x.save(); x.clip();
      for (let i = 4.6; i <= 19; i += 1.9) line('#141414', 0.8, [[11, i], [14, i + 1.1], [16, i + 0.4], [18, i + 1.1], [21, i]]);
      x.restore(); x.strokeStyle = 'rgba(0,0,0,0.5)'; x.lineWidth = 0.35; x.beginPath(); x.ellipse(16, 11.5, 4.4, 7.4, 0, 0, 7); x.stroke();
      // sarape en el lomo
      x.fillStyle = '#e74c3c'; x.fillRect(12.2, 9.5, 7.6, 4.4);
      ['#f1c40f', '#27ae60', '#2980b9', '#8e44ad'].forEach((c, i) => { x.fillStyle = c; x.fillRect(12.2, 9.9 + i * 1, 7.6, 0.45); });
      for (let i = 0; i < 6; i++) line('#fdebd0', 0.3, [[12.4 + i * 1.4, 13.9], [12.4 + i * 1.4, 14.8]]); // flecos
      // cabeza, orejas y crin
      ell('#e8e5dc', 16, 3.2, 2.3, 3); ell('#5d5d5d', 16, 1, 1.6, 1.1); ell('#111', 15.4, 0.8, 0.3, 0.25); ell('#111', 16.6, 0.8, 0.3, 0.25);
      line('#141414', 0.5, [[15, 3], [17, 3.2]]); line('#141414', 0.5, [[15.1, 4.5], [16.9, 4.6]]);
      ell('#e8e5dc', 13.7, 4.6, 0.9, 2.6, -0.5); ell('#e8e5dc', 18.3, 4.6, 0.9, 2.6, 0.5); ell('#c9a9a6', 13.7, 4.6, 0.4, 1.8, -0.5); ell('#c9a9a6', 18.3, 4.6, 0.4, 1.8, 0.5);
      line('#141414', 0.9, [[16, 5.5], [16, 7.5]]); // crin
      line('#e74c3c', 0.4, [[14, 3.6], [18, 3.6]]); // bozal
    },
    cesar(x0) { // tazon de ensalada Cesar con crutones, queso, limon y tenedor
      shadow(16, 16, 13, 13);
      ball(16, 16, 13, '#ffffff', '#cfcabb', 'rgba(0,0,0,0.35)');
      ball(16, 16, 11, '#d9d3c2', '#bdb6a3');
      for (let i = 0; i < 22; i++) { // hojas de lechuga romana con su vena
        const a = i * 2.39, r = 1.5 + (i % 6) * 1.5, lx = 16 + Math.cos(a) * r, ly = 16 + Math.sin(a) * r;
        x.fillStyle = rad(lx, ly, 3.4, i % 3 ? '#9ccc65' : '#c5e1a5', i % 2 ? '#558b2f' : '#689f38');
        x.beginPath(); x.ellipse(lx, ly, 3.6, 1.7, a + 0.6, 0, 7); x.fill();
        line('rgba(240,250,220,0.7)', 0.25, [[lx - Math.cos(a + 0.6) * 3, ly - Math.sin(a + 0.6) * 3], [lx + Math.cos(a + 0.6) * 3, ly + Math.sin(a + 0.6) * 3]]);
      }
      for (let i = 0; i < 8; i++) { const a = i * 0.8 + 0.3, r = 3 + (i % 3) * 2.2, cx = 16 + Math.cos(a) * r, cy = 16 + Math.sin(a) * r;
        x.fillStyle = '#c98a3a'; x.fillRect(cx - 1, cy - 1, 2, 2); x.fillStyle = '#e8b866'; x.fillRect(cx - 1, cy - 1, 1.2, 1.2); }
      for (let i = 0; i < 16; i++) { const a = i * 1.7, r = 2 + (i % 5) * 1.7; ell('#fff8e1', 16 + Math.cos(a) * r, 16 + Math.sin(a) * r, 0.9, 0.35, a); }
      // gajo de limon y tenedor
      x.fillStyle = '#f9e04b'; x.beginPath(); x.moveTo(24, 21); x.arc(24, 21, 3.4, 3.4, 5.2); x.closePath(); x.fill();
      line('#fffde7', 0.35, [[24, 21], [21.2, 19.6]]); line('#fffde7', 0.35, [[24, 21], [22.4, 18.1]]);
      line('#b0b7bd', 0.8, [[4, 26], [10, 20]]); for (const d of [-0.7, 0, 0.7]) line('#c9d0d6', 0.35, [[10 + d, 20 - d], [12 + d, 18 - d]]);
    },
    xolo(x0) { // xoloitzcuintle pelon con copete, collar de los Xolos y cola
      shadow(16, 17, 7, 13);
      line('#454b52', 1.3, [[16, 25], [18.5, 28], [17.5, 31]]); // cola
      for (const [px, py] of [[12.6, 10.5], [19.4, 10.5], [13, 22.5], [19, 22.5]]) ell('#3d4248', px, py, 1.3, 1.8); // patas
      x.fillStyle = rad(16, 16, 9, '#6c737b', '#3b4046'); x.beginPath(); x.ellipse(16, 16.5, 4.6, 8.6, 0, 0, 7); x.fill();
      x.strokeStyle = 'rgba(0,0,0,0.5)'; x.lineWidth = 0.35; x.stroke();
      for (const yy of [13, 15, 17]) line('rgba(30,30,30,0.45)', 0.3, [[13.5, yy], [16, yy + 0.6], [18.5, yy]]); // arrugas
      ell('rgba(230,200,190,0.35)', 15, 18, 1.6, 2.4); // manchita rosada
      // collar rojo con placa dorada
      line('#c0392b', 1, [[12.4, 9.2], [16, 10], [19.6, 9.2]]); ball(16, 10.4, 0.7, '#fff3a0', '#c9a227');
      // cabeza alargada, orejas de murcielago y copete
      x.fillStyle = rad(16, 6, 3.5, '#6c737b', '#3b4046'); x.beginPath(); x.ellipse(16, 5.8, 2.7, 3.8, 0, 0, 7); x.fill();
      ell('#2f3338', 16, 2.4, 1.2, 1); // hocico
      x.fillStyle = '#4a5057';
      for (const s of [-1, 1]) { x.beginPath(); x.moveTo(16 + s * 1.6, 6.5); x.lineTo(16 + s * 5, 4.2); x.lineTo(16 + s * 2.4, 8.2); x.closePath(); x.fill(); }
      for (const s of [-1, 1]) { x.fillStyle = '#c99a94'; x.beginPath(); x.moveTo(16 + s * 2, 6.7); x.lineTo(16 + s * 4.2, 4.9); x.lineTo(16 + s * 2.6, 7.6); x.closePath(); x.fill(); }
      for (let i = 0; i < 7; i++) line('#e8e8e8', 0.35, [[15.2 + i * 0.27, 4.3], [14.8 + i * 0.4, 7.4]]); // copete blanco
    },
    batiz(x0) { // rockero de pelo largo canoso con lentes, chamarra de piel, guitarra roja y su amplificador
      shadow(15, 17, 12, 10);
      // amplificador
      x.fillStyle = '#1b1b1b'; x.fillRect(22, 18, 8, 9); x.fillStyle = '#3a3a3a'; x.fillRect(22.6, 18.6, 6.8, 7.8);
      for (let i = 0; i < 6; i++) line('#555', 0.25, [[22.8, 19.3 + i * 1.2], [29.2, 19.3 + i * 1.2]]);
      x.fillStyle = '#e0c068'; x.fillRect(24, 18.2, 4, 0.7);
      line('#111', 0.4, [[22, 22], [19, 21.5], [17, 20]]); // cable
      // guitarra electrica roja cruzada
      x.save(); x.translate(13, 18); x.rotate(-0.75);
      x.fillStyle = '#5a3a1e'; x.fillRect(2.2, -0.75, 9, 1.5); // mastil
      x.fillStyle = '#d9c39a'; for (let i = 0; i < 6; i++) x.fillRect(3 + i * 1.4, -0.75, 0.2, 1.5); // trastes
      x.fillStyle = '#222'; x.beginPath(); x.roundRect(10.8, -1.2, 2.6, 2.4, 0.6); x.fill(); // clavijero
      x.fillStyle = rad(-1, 0, 4.5, '#ff5a4a', '#a3150b'); x.beginPath();
      x.ellipse(-2.4, 0, 3.4, 3.8, 0, 0, 7); x.ellipse(1.3, 0, 2.6, 2.9, 0, 0, 7); x.fill();
      x.fillStyle = '#f5f2ea'; x.beginPath(); x.ellipse(-1.2, 0.8, 2.2, 1.8, 0.4, 0, 7); x.fill(); // golpeador
      x.fillStyle = '#222'; x.fillRect(-2.8, -1.4, 0.6, 2.8); x.fillRect(-0.6, -1.4, 0.6, 2.8);
      line('#ddd', 0.12, [[-3.6, -0.5], [13, -0.5]]); line('#ddd', 0.12, [[-3.6, 0.5], [13, 0.5]]);
      x.restore();
      // chamarra de piel negra con hombreras y cierre
      shoulders(14, 14, '#3a3a3a', '#0d0d0d', 6, 3.8);
      line('#9a9a9a', 0.3, [[14, 10.5], [14, 17.5]]);
      ell('#1a1a1a', 8.6, 15.5, 1.6, 2.6, 0.3); ell('#1a1a1a', 19.4, 15.5, 1.6, 2.6, -0.3);
      // cabeza: pelo largo canoso cayendo sobre los hombros, lentes oscuros
      x.fillStyle = rad(14, 12, 5, '#ffffff', '#b8b8b8');
      x.beginPath(); x.ellipse(14, 12.6, 3.8, 4.8, 0, 0, 7); x.fill();
      for (let i = 0; i < 9; i++) line('rgba(150,150,150,0.8)', 0.25, [[11 + i * 0.75, 9], [10.6 + i * 0.85, 16.5]]);
      ell('#c99a6b', 14, 9.4, 2.1, 1.8); // frente
      x.fillStyle = '#0b0b0b'; x.beginPath(); x.roundRect(12, 8.6, 1.8, 1, 0.4); x.roundRect(14.2, 8.6, 1.8, 1, 0.4); x.fill();
      line('#0b0b0b', 0.25, [[13.8, 9], [14.2, 9]]);
    },
    gringo(x0) { // turista quemado con sombrero de souvenir, camisa hawaiana, maleta con calcomanias y vaso
      shadow(16, 17, 12, 11);
      // maleta con ruedas y calcomanias
      x.fillStyle = '#5d6d7e'; x.beginPath(); x.roundRect(22, 16, 7, 10, 1); x.fill();
      x.fillStyle = '#85929e'; x.fillRect(22.6, 16.6, 5.8, 1);
      [['#e74c3c', 23, 19], ['#f1c40f', 25.5, 21], ['#2ecc71', 23.4, 23.2]].forEach(([c, a, b]) => { x.fillStyle = c; x.fillRect(a, b, 2.2, 1.5); });
      line('#2c3e50', 0.5, [[24, 16], [24, 13], [27, 13], [27, 16]]);
      // brazos quemados y vaso de michelada
      ell('#ff8a75', 7.6, 17.5, 1.5, 3, 0.4); ell('#ff8a75', 22, 13.6, 2.6, 1.3, -0.3);
      ball(6.4, 21.4, 1.6, '#ffe082', '#c27c0e', '#7a5a10'); ell('#e74c3c', 6.4, 21.4, 1.6, 0.4); // vaso con chile en el borde
      // camisa hawaiana
      shoulders(15, 17, '#3cc1e6', '#1a8db3', 6, 3.8);
      for (const [fx, fy, c] of [[11, 16.5, '#ff4f8b'], [14, 18.8, '#ffd23f'], [17.5, 15.8, '#ff4f8b'], [19.4, 18.6, '#ffffff'], [12.6, 19, '#ffffff']]) {
        for (let k = 0; k < 5; k++) ell(c, fx + Math.cos(k * 1.26) * 0.7, fy + Math.sin(k * 1.26) * 0.7, 0.5, 0.5); ell('#f1c40f', fx, fy, 0.3, 0.3);
      }
      // sombrero de souvenir enorme con zigzag bordado y letrero
      x.fillStyle = rad(15, 13, 9, '#f8e08e', '#c99a2e'); x.beginPath(); x.arc(15, 13, 8.6, 0, 7); x.fill();
      x.strokeStyle = '#8a6514'; x.lineWidth = 0.35; x.stroke();
      x.strokeStyle = '#e74c3c'; x.lineWidth = 0.55; x.beginPath();
      for (let i = 0; i <= 36; i++) { const a = i / 36 * Math.PI * 2, r = i % 2 ? 6.6 : 7.6; i ? x.lineTo(15 + Math.cos(a) * r, 13 + Math.sin(a) * r) : x.moveTo(15 + Math.cos(a) * r, 13 + Math.sin(a) * r); } x.stroke();
      ball(15, 13, 4.2, '#fbe9a8', '#d4a73a', '#8a6514');
      x.strokeStyle = '#27ae60'; x.lineWidth = 0.6; x.beginPath(); x.arc(15, 13, 4.6, 0, 7); x.stroke();
      x.fillStyle = '#c0392b'; x.font = 'bold 1.9px sans-serif'; x.textAlign = 'center'; x.fillText('TJ', 15, 13.7);
    },
    mariachi(x0) { // charro de negro con botonadura plateada, sombrero con bordado de oro y guitarron
      shadow(15, 16, 12, 12);
      // guitarron
      x.save(); x.translate(22, 21); x.rotate(0.65);
      x.fillStyle = '#4a2c12'; x.fillRect(-0.8, -10, 1.6, 6);
      x.fillStyle = rad(0, 0, 6, '#e8b56a', '#9a5a20'); x.beginPath(); x.ellipse(0, 0, 4.6, 5.6, 0, 0, 7); x.fill();
      x.strokeStyle = '#3a200a'; x.lineWidth = 0.4; x.stroke();
      ell('#2a1606', 0, -1.2, 1.5, 1.5); line('#3a200a', 0.6, [[-2, 2.6], [2, 2.6]]);
      for (const d of [-0.5, 0, 0.5]) line('#eee', 0.1, [[d, -9.5], [d, 2.6]]);
      x.restore();
      // traje negro con botonadura de plata en los brazos
      shoulders(14, 16, '#3a3a3a', '#0a0a0a', 6.2, 4);
      ell('#111', 8, 18.5, 1.6, 3, 0.25); ell('#111', 20, 18, 1.6, 3, -0.6);
      for (let i = 0; i < 5; i++) { ball(8.3 - i * 0.1, 16 + i * 1.1, 0.32, '#ffffff', '#9aa0a6'); ball(19.6 + i * 0.25, 15.8 + i * 0.9, 0.32, '#ffffff', '#9aa0a6'); }
      ell('#c0392b', 14, 19.6, 1.6, 0.8); // mono rojo
      // sombrero de charro: ala ancha con bordado de oro y copa alta
      x.fillStyle = rad(14, 13, 10, '#3a3a3a', '#0d0d0d'); x.beginPath(); x.arc(14, 13, 9.4, 0, 7); x.fill();
      x.strokeStyle = '#d4af37'; x.lineWidth = 0.7; x.beginPath(); x.arc(14, 13, 8.7, 0, 7); x.stroke();
      x.lineWidth = 0.3;
      for (let i = 0; i < 24; i++) { const a = i / 24 * Math.PI * 2; x.beginPath(); x.arc(14 + Math.cos(a) * 7, 13 + Math.sin(a) * 7, 0.6, 0, 7); x.stroke(); }
      ball(14, 13, 4.3, '#3d3d3d', '#111');
      x.strokeStyle = '#d4af37'; x.lineWidth = 0.5; x.beginPath(); x.arc(14, 13, 4.6, 0, 7); x.stroke();
      line('#d4af37', 0.35, [[11.4, 13], [16.6, 13]]); line('#d4af37', 0.35, [[14, 10.4], [14, 15.6]]);
    },
    mimo(x0) { // mimo: boina, cara blanca pintada, playera de rayas, tirantes y guantes atrapado en una caja invisible
      // la caja invisible
      x.setLineDash([1, 0.8]); x.strokeStyle = 'rgba(255,255,255,0.55)'; x.lineWidth = 0.35; x.strokeRect(4, 4, 24, 24); x.setLineDash([]);
      shadow(16, 17, 9, 8);
      // brazos estirados con guantes blancos tocando las paredes
      ell('#f4f4f4', 8, 15, 3, 1.3, 0.1); ell('#f4f4f4', 24, 15, 3, 1.3, -0.1);
      for (let i = 0; i < 4; i++) line('#111', 0.5, [[6 + i * 1.2, 14.2], [6 + i * 1.2, 15.8]]); for (let i = 0; i < 4; i++) line('#111', 0.5, [[22.4 + i * 1.2, 14.2], [22.4 + i * 1.2, 15.8]]);
      ball(4.6, 15, 1.5, '#ffffff', '#cfcfcf', '#999'); ball(27.4, 15, 1.5, '#ffffff', '#cfcfcf', '#999');
      for (const s of [-1, 1]) for (let k = 0; k < 4; k++) ell('#fff', 16 + s * 13.1, 13.7 + k * 0.9, 0.5, 0.35); // dedos en la pared
      // torso con rayas y tirantes
      x.save(); x.beginPath(); x.ellipse(16, 16, 5.4, 3.8, 0, 0, 7); x.clip();
      x.fillStyle = '#f5f5f5'; x.fillRect(10, 12, 12, 8); for (let i = 0; i < 6; i++) { x.fillStyle = '#111'; x.fillRect(10.4 + i * 2, 12, 1, 8); }
      x.restore(); x.strokeStyle = 'rgba(0,0,0,0.5)'; x.lineWidth = 0.35; x.beginPath(); x.ellipse(16, 16, 5.4, 3.8, 0, 0, 7); x.stroke();
      line('#c0392b', 0.7, [[13.6, 12.6], [13.6, 19.4]]); line('#c0392b', 0.7, [[18.4, 12.6], [18.4, 19.4]]);
      // cabeza con boina negra ladeada y cara pintada asomandose
      ball(16, 13.4, 2.9, '#ffffff', '#dcdcdc', '#aaa');
      ell('#111', 15.4, 12.4, 3.1, 2.4, -0.3); ell('#222', 15.8, 11.5, 0.5, 0.5);
      ell('#111', 14.8, 14.5, 0.35, 0.6); ell('#111', 17.2, 14.5, 0.35, 0.6); ell('#d0112b', 16, 15.7, 0.8, 0.35);
      line('#111', 0.15, [[14.8, 13.8], [14.8, 15.4]]); line('#111', 0.15, [[17.2, 13.8], [17.2, 15.4]]);
    },
    payaso(x0) { // payaso de crucero: peluca de colores, nariz roja, traje de lunares, zapatotes y limones al aire
      shadow(16, 18, 9, 10);
      ell('#c0392b', 12.5, 25.5, 2.2, 3.4, 0.15); ell('#c0392b', 19.5, 25.5, 2.2, 3.4, -0.15); // zapatotes
      ell('#ff7b6b', 12.3, 24.4, 1, 1.2); ell('#ff7b6b', 19.3, 24.4, 1, 1.2);
      // traje de lunares
      shoulders(16, 18, '#4fa3ff', '#1c5fb8', 6, 4.2);
      for (const [px, py, c] of [[12.4, 17, '#ffd23f'], [15, 20, '#ff4f8b'], [18.6, 16.6, '#ffffff'], [19.6, 19.6, '#ffd23f'], [14.4, 16, '#ff4f8b'], [11.8, 19.6, '#ffffff']]) ell(c, px, py, 0.7, 0.7);
      for (let i = 0; i < 5; i++) ell(i % 2 ? '#ffffff' : '#ff4f8b', 13.4 + i * 1.3, 14.8, 0.9, 0.6); // cuello de holan
      // brazos arriba haciendo malabares
      ell('#4fa3ff', 9.6, 14, 1.4, 2.6, 0.6); ell('#4fa3ff', 22.4, 14, 1.4, 2.6, -0.6);
      ball(8.6, 11.8, 1, '#ffffff', '#d8d8d8'); ball(23.4, 11.8, 1, '#ffffff', '#d8d8d8');
      // limones en el aire con su estela
      x.setLineDash([0.6, 0.6]); x.strokeStyle = 'rgba(255,255,255,0.6)'; x.lineWidth = 0.3; x.beginPath(); x.arc(16, 9, 7.5, Math.PI * 1.05, Math.PI * 1.95); x.stroke(); x.setLineDash([]);
      for (const [lx, ly] of [[9.6, 6.2], [16, 1.8], [22.4, 6.2]]) { ball(lx, ly, 1.5, '#c5ef7c', '#4c9a1c', '#2f6b0d'); ell('#8bc34a', lx + 0.5, ly - 0.5, 0.4, 0.3); }
      // cabeza: peluca esponjada de colores, cara blanca y nariz roja
      for (let i = 0; i < 10; i++) { const a = i / 10 * Math.PI * 2; ball(16 + Math.cos(a) * 3.2, 13 + Math.sin(a) * 3.2, 1.6, ['#ff5252', '#ffd23f', '#4caf50', '#40c4ff', '#e040fb'][i % 5], ['#b71c1c', '#c79a00', '#1b5e20', '#0277bd', '#7b1fa2'][i % 5]); }
      ball(16, 13, 2.7, '#ffffff', '#e8dccb', '#bbb');
      ball(16, 12, 0.95, '#ff6b6b', '#c40000');
      line('#d0112b', 0.4, [[14.8, 14.2], [16, 14.8], [17.2, 14.2]]);
    },
  };
  for (const k in draw) {
    const t = scene.textures.createCanvas('egg_' + k, 160, 160);
    x = t.getContext(); x.save(); x.scale(5, 5); draw[k](x); x.restore(); t.refresh();
  }
}
function onAsphalt(x, y, pad) {
  for (const r of roads) {
    if (r.c > 7 || x < r.bb[0] || x > r.bb[2] || y < r.bb[1] || y > r.bb[3]) continue;
    for (let i = 0; i < r.p.length - 2; i += 2) if (segDist(x, y, r.p[i], r.p[i + 1], r.p[i + 2], r.p[i + 3]) < ROAD_W[r.c] / 2 * M + pad) return true;
  }
  return false;
}
// hay algun punto libre a menos de R de (x, y)? (se revisa en circulos cada 4 px)
function reachable(x, y, R) {
  for (let r = 0; r <= R; r += 4) for (let k = 0; k < 16; k++) { const a = k / 16 * Math.PI * 2; if (!blocked(x + Math.cos(a) * r, y + Math.sin(a) * r)) return true; }
  return false;
}
function sidewalkSpot(x, y, extra = 17) {
  const cands = [];
  for (const r of roads) {
    if (r.c > 6 || r.f & 1 || x < r.bb[0] - 200 || x > r.bb[2] + 200 || y < r.bb[1] - 200 || y > r.bb[3] + 200) continue;
    const p = r.p;
    for (let i = 0; i < p.length - 2; i += 2) {
      const ax = p[i], ay = p[i + 1], bx = p[i + 2], by = p[i + 3], dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy || 1;
      // a la mitad del tramo cuando se puede, lejos de las esquinas
      const t = Math.max(0.2, Math.min(0.8, ((x - ax) * dx + (y - ay) * dy) / L2)), qx = ax + dx * t, qy = ay + dy * t;
      cands.push({ d: Math.hypot(x - qx, y - qy), qx, qy, dx, dy, r });
    }
  }
  cands.sort((a, b) => a.d - b.d);
  for (const { qx, qy, dx, dy, r } of cands.slice(0, 12)) {
    const nl = Math.hypot(dx, dy) || 1;
    for (const side of [1, -1]) {
      let nx = -dy / nl * side, ny = dx / nl * side;
      if (side === 1 && (x - qx) * nx + (y - qy) * ny < 0) { nx = -nx; ny = -ny; }
      const off = ROAD_W[r.c] / 2 * M + extra, px = qx + nx * off, py = qy + ny * off;
      if (!onAsphalt(px, py, 15)) return [px, py, Math.atan2(-ny, -nx) - Math.PI / 2];
    }
  }
  return [x, y, 0];
}

// ---------- escena ----------
class Main extends Phaser.Scene {
  constructor() { super('main'); }

  create() {
    makeTextures(this);
    this.chunks = new Map();
    this.cars = []; this.peds = []; this.parked = [];
    this.tmp = {};
    this.cameras.main.setBounds(0, 0, WORLD_W, WORLD_H);
    this.cameras.main.setBackgroundColor('#2a2a2a');
    this.keys = this.input.keyboard.addKeys('W,A,S,D,UP,DOWN,LEFT,RIGHT,SHIFT,SPACE,E,ENTER,F,T,M,R,N,L');
    this.input.keyboard.addCapture('SPACE,UP,DOWN,LEFT,RIGHT');

    // marcadores de lugares y tacos
    this.marks = [];
    for (const l of landmarks) {
      // si el lugar queda en medio de un edificio enorme o del agua (Palacio Municipal, Plaza Rio), su marca
      // se pasa a la banqueta mas cercana; si no, nunca se podria descubrir (se descubre a menos de 110 px)
      if (!reachable(l.x, l.y, 95)) { const [sx, sy] = sidewalkSpot(l.x, l.y, (SIDEWALK + 0.5) * M); l.x = sx; l.y = sy; }
      const ring = this.add.image(l.x, l.y, 'ring').setDepth(3).setTint(0xffd23f).setAlpha(0.8);
      // la insignia del lugar flota un poco (cada una a su ritmo)
      const star = this.add.image(l.x, l.y, l.icon).setDepth(20).setScale(0.62 / SPR);
      this.tweens.add({ targets: star, y: l.y - 3, duration: 900 + Math.random() * 300, yoyo: true, repeat: -1, ease: 'Sine.inOut', delay: Math.random() * 900 });
      const label = this.add.text(l.x, l.y - 34, l.name, { fontSize: '15px', fontStyle: 'bold', color: '#fff', stroke: '#000', strokeThickness: 4, resolution: TXT_RES }).setOrigin(0.5).setDepth(20);
      this.marks.push({ l, ring, star, label });
    }
    for (const t of tacos) {
      const [sx, sy, rot] = sidewalkSpot(t.x, t.y);
      t.x = sx; t.y = sy;
      t.icon = this.add.image(t.x, t.y, 'puesto' + (hash(t.name.length * 31 + (t.x | 0)) % LONAS.length)).setScale(0.55).setRotation(rot).setDepth(6);
      t.label = this.add.text(t.x, t.y - 26, t.name, { fontSize: '12px', color: '#ffe0a0', stroke: '#000', strokeThickness: 3, resolution: TXT_RES }).setOrigin(0.5).setDepth(19);
    }
    for (const c of cafes) {
      // el toldo queda pegado a la fachada, del lado de la banqueta que da al edificio
      const [sx, sy, rot] = sidewalkSpot(c.x, c.y, (SIDEWALK + 0.5) * M + 2);
      c.x = sx; c.y = sy;
      c.icon = this.add.image(c.x, c.y, 'cafe' + (hash(c.name.length * 17 + (c.x | 0)) % TOLDOS.length)).setScale(0.55).setRotation(rot).setDepth(6);
      c.label = this.add.text(c.x, c.y - 24, c.name, { fontSize: '12px', color: '#e8d2b5', stroke: '#000', strokeThickness: 3, resolution: TXT_RES }).setOrigin(0.5).setDepth(19);
    }
    for (const c of chinas) {
      // la entrada (punta de la alfombra) queda en la banqueta; el local se mete hacia el edificio
      const [sx, sy, rot] = sidewalkSpot(c.x, c.y, (SIDEWALK + 0.5) * M + 2);
      c.x = sx; c.y = sy;
      const bx = -Math.sin(rot), by = Math.cos(rot); // hacia el frente del local (la calle)
      c.up = Math.cos(rot) < -0.3 ? 'u' : '';
      c.icon = this.add.image(sx - bx * 30, sy - by * 30, 'antro0' + c.up).setScale(0.6).setRotation(rot).setDepth(6);
      const hh = Math.abs(Math.cos(rot)) * 40 + Math.abs(Math.sin(rot)) * 54;
      c.label = this.add.text(c.icon.x, c.icon.y - hh - 8, c.name, { fontSize: '12px', color: '#ff8a80', stroke: '#000', strokeThickness: 3, resolution: TXT_RES }).setOrigin(0.5).setDepth(19);
    }
    for (const e of EGGS) {
      const [sx, sy, rot] = sidewalkSpot(e.x, e.y, (SIDEWALK + 0.5) * M);
      e.x = sx; e.y = sy;
      e.icon = this.add.image(sx, sy, 'egg_' + e.k).setScale(0.4).setRotation(rot).setDepth(7).setVisible(!e.got);
    }
    this.stamina = STAMINA; this.tired = false; this.burning = [];
    this.chatDeck = []; this.chatCool = 0;
    this.bubble = { el: $('bubble'), ped: null, t: 0 };
    this.staminaBar = this.add.graphics().setDepth(20);
    this.target = this.add.image(0, 0, 'ring').setDepth(4).setTint(0x57d16b).setVisible(false);
    this.routeG = this.add.graphics().setDepth(3); this.route = null; this.routeT = 0;

    // el jugador aparece en una calle al azar, en la banqueta y con un auto estacionado al lado
    let pos, side;
    for (let tries = 0; tries < 200; tries++) {
      const e = pick(traffic.edges);
      if (e.c < 2 || e.c > 5 || e.len < 80) continue;
      const sAt = rnd(30, e.len - 30);
      side = edgePos(e, sAt, 1, e.w / 2 + 1.5 * M, {});
      pos = edgePos(e, sAt, 1, laneLat(e, e.one ? 3 : 1), {});
      if (!blocked(side.x, side.y) && side.y > borderY(side.x) + 150) break;
    }
    this.player = { x: side.x, y: side.y, a: pos.a, sprite: this.add.sprite(side.x, side.y, 'ped' + PLAYER_SHIRT, 0).setDepth(12).setScale(1 / SPR) };
    const car = this.makeCar(pos.x, pos.y, pos.a, { taxi: true });
    this.parked.push(car);
    this.inCar = null;
    this.cameras.main.startFollow(this.player.sprite, true, 0.15, 0.15);
    this.cameras.main.setZoom(this.baseZoom());

    this.taxi = null; this.waypoint = null;
    this.perk = perks();
    this.night = { a: state.night && this.perk.noche ? 1 : 0, rt: null, cut: [], glow: [] };
    if (state.celebrated.includes('taco')) this.spawnSpecial('troca', 60);
    if (state.celebrated.includes('final')) this.spawnSpecial('zonkey', 110);
    // la fiesta: si ya fue, los mariachis se quedan en la plaza; si falta, sigue la invitacion
    this.fiesta = null;
    if (state.celebrated.includes('fiesta')) this.spawnMariachis();
    else if (state.celebrated.includes('final')) this.time.delayedCall(4000, () => { this.inviteFiesta(); toast('🎉 Te esperan en la Plaza Santa Cecilia', 'La fiesta no empieza sin ti. Sigue los puntos verdes.', 5); });
    this.populate(true);
    updateStats();
    this.setObjective();
    this.nameT = 0; this.spawnT = 0;
    setupBigMap(this);
  }

  baseZoom() { return (Math.min(window.innerWidth, window.innerHeight) < 600 ? 1.45 : 1.8) * DPR; } // antes 1.15 y 1.4

  walker(x, y, rate) {
    const i = pedVariant(), V = PED_VARIANTS[i];
    const s = this.add.sprite(x, y, 'ped' + i, 0).setDepth(5).setScale(1 / SPR);
    s.play({ key: 'walk' + i, startFrame: (Math.random() * 8) | 0 }); s.anims.timeScale = rate * V.speed;
    s.pace = V.speed; // los viejitos caminan mas despacio
    return s;
  }

  // o: { moto, taxi, ti (tipo), ci (color), dirty }; sin tipo se escoge uno al azar
  carSpec(o = {}) {
    if (o.moto) return { T: VT_MOTO, key: 'moto', ox: 0.5, oy: 0.5, dirty: false };
    if (o.taxi) return { T: VT_TAXI, key: 'taxi', ox: 0.5, oy: 0.5, dirty: false };
    if (o.troca) return { T: VT_TROCA_TACOS, key: 'troca_tacos', ox: (VT_TROCA_TACOS.L / 2 + 3) / (VT_TROCA_TACOS.L + 6), oy: 0.5, dirty: false };
    if (o.zonkey) return { T: VT_ZONKEY, key: 'zonkey', ox: (VT_ZONKEY.L / 2 + 3) / (VT_ZONKEY.L + 6), oy: 0.5, dirty: false };
    if (o.poli) return { T: VT_POLI, key: 'poli0', ox: (VT_POLI.L / 2 + 1) / (VT_POLI.L + 5), oy: (VT_POLI.W / 2 + 1) / (VT_POLI.W + 5), dirty: false };
    const ti = o.ti ?? randomVType(), T = VTYPES[ti], ci = o.ci ?? (Math.random() * T.cols.length) | 0;
    const dirty = o.dirty ?? Math.random() < 0.45, d = dirty ? 1 + ((Math.random() * DIRTY_SEEDS) | 0) : 0;
    return { T, key: vehicleTexture(this, ti, ci, d), ox: (T.L / 2 + 1) / (T.L + 5), oy: (T.W / 2 + 1) / (T.W + 5), dirty };
  }
  makeCar(x, y, a, o) {
    const sp = o && o.T ? o : this.carSpec(o), T = sp.T, f = sp.dirty ? 0.7 : 1;
    return { x, y, a, vx: 0, vy: 0, T, dirty: sp.dirty, moto: T === VT_MOTO, poli: T === VT_POLI, hp: Math.round(T.hp * f), maxHp: Math.round(T.hp * f),
      top: T.top * (sp.dirty ? 0.92 : 1), acc: T.acc * (sp.dirty ? 0.9 : 1), hl: T.L / 2 - 1, hw: T.W / 2 - 1,
      sprite: this.add.image(x, y, sp.key).setOrigin(sp.ox, sp.oy).setRotation(a).setDepth(10).setScale(1 / SPR) };
  }

  // golpe: en la PC se sacude la camara; en el celular el sacudon se ve raro y mejor vibra el telefono
  jolt(ms, amount) {
    if (!document.body.classList.contains('touch')) { this.cameras.main.shake(ms, amount); return; }
    const H = window.Capacitor && Capacitor.Plugins && Capacitor.Plugins.Haptics;
    if (H) H.impact({ style: amount >= 0.01 ? 'HEAVY' : amount >= 0.005 ? 'MEDIUM' : 'LIGHT' }).catch(() => {});
    else if (navigator.vibrate) navigator.vibrate(Math.round(ms * Math.min(1, amount * 120)));
  }

  // ----- trozos -----
  updateChunks(all) {
    const v = this.cameras.main.worldView;
    // velocidad de la camara (suavizada) para pedir antes los trozos de adelante
    const dt = Math.max(1, this.game.loop.delta) / 1000, lv = this.lastView || { x: v.centerX, y: v.centerY };
    const sm = (o, n) => o + (n - o) * Math.min(1, dt * 4);
    this.camVX = sm(this.camVX || 0, (v.centerX - lv.x) / dt); this.camVY = sm(this.camVY || 0, (v.centerY - lv.y) / dt);
    this.lastView = { x: v.centerX, y: v.centerY };
    const cl = (a) => Math.max(-LOOKAHEAD_MAX, Math.min(LOOKAHEAD_MAX, a * LOOKAHEAD_S));
    const ax = cl(this.camVX), ay = cl(this.camVY);
    const cx0 = Math.max(0, Math.floor((v.x + Math.min(0, ax) - PREFETCH) / CHUNK)), cy0 = Math.max(0, Math.floor((v.y + Math.min(0, ay) - PREFETCH) / CHUNK));
    const cx1 = Math.floor((v.right + Math.max(0, ax) + PREFETCH) / CHUNK), cy1 = Math.floor((v.bottom + Math.max(0, ay) + PREFETCH) / CHUNK);
    // primero el que ya se ve, luego los mas cercanos a donde vas a estar en un rato
    const px = v.centerX + ax * 0.6, py = v.centerY + ay * 0.6;
    const want = [];
    for (let cx = cx0; cx <= cx1; cx++) for (let cy = cy0; cy <= cy1; cy++) {
      if (cx * CHUNK >= WORLD_W || cy * CHUNK >= WORLD_H || this.chunks.has(cx + ',' + cy)) continue;
      const seen = cx * CHUNK < v.right && (cx + 1) * CHUNK > v.x && cy * CHUNK < v.bottom && (cy + 1) * CHUNK > v.y;
      want.push([cx, cy, Math.hypot((cx + 0.5) * CHUNK - px, (cy + 0.5) * CHUNK - py) - (seen ? 1e6 : 0)]);
    }
    const add = (cx, cy, cv) => {
      const k = cx + ',' + cy, tk = 'ch' + k;
      this.textures.addCanvas(tk, cv);
      this.chunks.set(k, this.add.image(cx * CHUNK - 1, cy * CHUNK - 1, tk).setOrigin(0).setDepth(0).setScale(1 / RES));
    };
    // todo de una vez: el trozo a medias se descarta (comparte las capas de los edificios) y se pinta completo con los demas
    if (all) { this.chunkJob = null; this.chunkDone = null; for (const [cx, cy] of want) add(cx, cy, drawChunk(cx, cy)); }
    else if (this.chunkDone) {
      // el trozo terminado se sube a la tarjeta de video en su propio cuadro (subirlo tambien cuesta)
      const d = this.chunkDone; this.chunkDone = null;
      if (!this.chunks.has(d.k)) add(d.cx, d.cy, d.cv);
    } else {
      // se sigue con el trozo a medias o se empieza el mas urgente; unos milisegundos por cuadro,
      // y mas si el trozo ya se esta viendo (para tapar el hueco pronto)
      if (!this.chunkJob && want.length) {
        const [cx, cy] = want.sort((a, b) => a[2] - b[2])[0];
        this.chunkJob = { cx, cy, k: cx + ',' + cy, it: chunkSteps(cx, cy) };
      }
      const job = this.chunkJob;
      if (job) {
        const seen = job.cx * CHUNK < v.right && (job.cx + 1) * CHUNK > v.x && job.cy * CHUNK < v.bottom && (job.cy + 1) * CHUNK > v.y;
        const t0 = performance.now(); let r;
        const budget = seen ? CHUNK_BUDGET_SEEN_MS : CHUNK_BUDGET_MS;
        do r = job.it.next(); while (!r.done && performance.now() - t0 < budget);
        if (r.done) { this.chunkJob = null; this.chunkDone = { cx: job.cx, cy: job.cy, k: job.k, cv: r.value }; }
      }
    }
    for (const [k, img] of this.chunks) {
      const [cx, cy] = k.split(',').map(Number);
      if (cx < cx0 - KEEP || cx > cx1 + KEEP || cy < cy0 - KEEP || cy > cy1 + KEEP) { img.destroy(); this.textures.remove('ch' + k); this.chunks.delete(k); }
    }
  }

  // ----- poblacion -----
  viewR() { const c = this.cameras.main; return Math.hypot(c.width, c.height) / 2 / c.zoom; }
  populate(initial) {
    const p = this.focus(), R = this.viewR();
    // nada aparece dentro de la pantalla (con margen); el tramo de calle puede ser largo y pasar junto a ti
    const v = this.cameras.main.worldView, M0 = 70;
    const inView = (x, y) => x > v.x - M0 && x < v.right + M0 && y > v.y - M0 && y < v.bottom + M0;
    let n = 0;
    while (this.cars.length < Q.autos && n++ < 6) {
      const e = randomEdgeNear(traffic, p.x, p.y, initial ? 80 : R + 40, R + 300); if (!e) break;
      const dir = e.one ? 1 : (Math.random() < 0.5 ? 1 : -1), s = rnd(0, e.len);
      const lane = (Math.random() * 4) | 0, lat = laneLat(e, lane);
      const q = edgePos(e, s, dir, lat, {});
      if (initial ? dist(q.x, q.y, p.x, p.y) < 160 : (inView(q.x, q.y) || dist(q.x, q.y, p.x, p.y) < R)) continue;
      const moto = Math.random() < 0.3 && this.cars.filter(c => c.moto).length < 5;
      const poli = !moto && Math.random() < 0.15 && this.cars.filter(c => c.poli).length < 3;
      const spec = this.carSpec({ moto, poli });
      if (this.cars.some(c => dist(c.x, c.y, q.x, q.y) < 26 + c.hl + spec.T.L / 2)) continue;
      const car = this.makeCar(q.x, q.y, q.a, spec);
      Object.assign(car, { e, dir, s, lat, lane, speed: 0, max: rnd(50, 80) * (e.c <= 2 ? 1.2 : 1) * (moto ? 1.15 : poli ? 1.1 : car.top / 230) });
      this.cars.push(car);
    }
    n = 0;
    while (this.peds.length < Q.gente && n++ < 6) {
      const e = randomEdgeNear(walkG, p.x, p.y, initial ? 60 : R + 20, R + 250); if (!e) break;
      const side = e.c >= 8 ? rnd(-3, 3) : (Math.random() < 0.5 ? 1 : -1) * (e.w / 2 + rnd(0.6, 2.2) * M);
      const ped = { e, dir: Math.random() < 0.5 ? 1 : -1, s: rnd(0, e.len), side, speed: rnd(14, 26), st: 'walk', t: 0, x: 0, y: 0, a: 0 };
      edgePos(e, ped.s, ped.dir, ped.side, ped);
      if (blocked(ped.x, ped.y) || (!initial && inView(ped.x, ped.y))) continue;
      ped.sprite = this.walker(ped.x, ped.y, ped.speed / 20);
      ped.speed *= ped.sprite.pace;
      this.peds.push(ped);
    }
    const far = R + 520;
    this.cars = this.cars.filter(c => { if (dist(c.x, c.y, p.x, p.y) > far) { c.sprite.destroy(); return false; } return true; });
    this.peds = this.peds.filter(c => { if (dist(c.x, c.y, p.x, p.y) > far) { c.sprite.destroy(); return false; } return true; });
  }
  focus() { return this.inCar || this.player; }

  // ----- actualizacion -----
  update(time, delta) {
    if (!this.ready) { this.ready = true; this.updateChunks(true); }
    const dt = Math.min(delta / 1000, 0.05);
    const k = this.keys, J = Phaser.Input.Keyboard.JustDown;
    const ctl = readControls(k);
    if (J(k.E) || J(k.ENTER) || J(k.F) || touch.pressed.E) this.toggleCar();
    if (J(k.T) || touch.pressed.T) this.startTaxi();
    if (J(k.M)) toggleBigMap();
    if (J(k.N)) toggleSound();
    if (J(k.L)) toggleNight();
    touch.pressed = {};

    if (this.inCar) this.driveCar(this.inCar, ctl, dt); else this.walk(ctl, dt);
    this.updateTraffic(dt);
    this.updatePeds(dt);
    this.pedChat(dt);
    this.updateBurning(dt);

    const f = this.focus();
    const cam = this.cameras.main;
    const sp = this.inCar ? Math.hypot(this.inCar.vx, this.inCar.vy) : 0;
    const z = this.baseZoom() * (this.inCar ? 1 - Math.min(sp / 320, 1) * 0.15 : 1.1) * (this.fiesta && this.fiesta.on ? 0.72 : 1); // la fiesta se ve de mas lejos
    cam.setZoom(cam.zoom + (z - cam.zoom) * Math.min(1, dt * 2));
    // al manejar, la camara se adelanta en la direccion del auto para ver lo que viene
    if (window.SND) { let near = 0; for (const o of this.cars) if (Math.abs(o.x - f.x) < 350 && Math.abs(o.y - f.y) < 350) near++; SND.update(!!this.inCar, sp, near); }
    const look = this.inCar ? 0.45 : 0, tx = -(this.inCar ? this.inCar.vx : 0) * look, ty = -(this.inCar ? this.inCar.vy : 0) * look;
    cam.followOffset.x += (tx - cam.followOffset.x) * Math.min(1, dt * 2.5);
    cam.followOffset.y += (ty - cam.followOffset.y) * Math.min(1, dt * 2.5);
    this.updateChunks(false);

    this.spawnT -= dt; if (this.spawnT <= 0) { this.populate(false); this.spawnT = 0.25; }
    this.checkActivities(dt, f, sp);
    this.updateMarkers(time, f);
    this.updateRoute(time, dt, f);
    this.updateFiesta(time, dt, f);
    this.updateNight(time, dt, f);
    this.updateHud(dt, f);
  }

  walk(c, dt) {
    const p = this.player;
    let mx = c.x, my = c.y;
    const m = Math.hypot(mx, my);
    if (m > 0.1) {
      // correr gasta aire; si se acaba, solo caminas hasta recuperarlo completo
      const running = c.run && !this.tired;
      if (running && !this.perk.cafe) { // con los 43 cafes ya no se acaba el aire
        this.stamina -= dt;
        if (this.stamina <= 0) { this.stamina = 0; this.tired = true; toast('😮‍💨 ' + pick(FRASES_CANSADO), 'Camina un rato para recuperar el aire.', 2.4); if (window.SND) SND.play('tired'); }
      } else this.stamina = Math.min(STAMINA, this.stamina + dt * 0.8);
      const run = running ? 1.8 : 1, sp = (this.perk.cafe ? 70 : 62) * run * Math.min(1, m);
      mx /= m; my /= m;
      const nx = p.x + mx * sp * dt, ny = p.y + my * sp * dt;
      if (!blocked(nx, p.y)) p.x = nx;
      if (!blocked(p.x, ny)) p.y = ny;
      p.a = Math.atan2(my, mx);
      if (!p.sprite.anims.isPlaying) p.sprite.play('walk' + PLAYER_SHIRT);
      p.sprite.anims.timeScale = run * Math.min(1, m) * 1.2;
    } else {
      this.stamina = Math.min(STAMINA, this.stamina + dt * 1.6); // parado se recupera mas rapido
      if (p.sprite.anims.isPlaying) { p.sprite.stop(); p.sprite.setFrame(0); }
    }
    if (this.tired && this.stamina >= STAMINA) this.tired = false;
    // barrita de aire arriba del jugador, solo cuando no esta llena
    const sb = this.staminaBar;
    sb.clear();
    if (this.stamina < STAMINA) {
      const w = 26, f = this.stamina / STAMINA, bx = p.x - w / 2, by = p.y - 20;
      sb.fillStyle(0x000000, 0.55).fillRect(bx - 1, by - 1, w + 2, 5);
      sb.fillStyle(this.tired ? 0xe74c3c : 0x7fd3ff, 1).fillRect(bx, by, w * f, 3);
    }
    p.sprite.setPosition(p.x, p.y).setRotation(p.a);
  }

  driveCar(car, c, dt) {
    const fx = Math.cos(car.a), fy = Math.sin(car.a);
    let fwd = car.vx * fx + car.vy * fy;
    let lat = -car.vx * fy + car.vy * fx;
    const broken = car.hp <= 0;
    let thr = 0, steer = 0;
    if (c.stick) {
      // control tactil: apuntar hacia la direccion del joystick
      const m = Math.min(1, Math.hypot(c.x, c.y));
      if (m > 0.25) {
        const d = angDiff(car.a, Math.atan2(c.y, c.x));
        if (Math.abs(d) > 2.5 && fwd < 40) { thr = -0.6; steer = -Math.sign(d); }
        else { thr = m; steer = Math.max(-1, Math.min(1, d * 2.2)); }
      }
      // boton de reversa: echa para atras y el joystick solo gira
      if (c.rev) { thr = -1; steer = Math.max(-1, Math.min(1, c.x * 1.5)); }
    } else { thr = c.up ? 1 : (c.down || c.rev) ? -1 : 0; steer = c.x; }
    if (broken) thr = 0;
    const TOP = car.top, ACC = car.acc;
    if (thr > 0) fwd += (fwd < 0 ? 420 : ACC * (1 - Math.max(0, fwd) / (TOP + 30))) * thr * dt;
    else if (thr < 0) fwd += (fwd > 0 ? -520 : -150) * -thr * dt;
    else fwd -= Math.sign(fwd) * Math.min(Math.abs(fwd), 90 * dt);
    fwd = Math.max(car.moto ? -40 : -80, Math.min(TOP, fwd));
    if (c.brake) fwd -= Math.sign(fwd) * Math.min(Math.abs(fwd), 160 * dt);
    const grip = c.brake ? 0.9 : 9;
    lat -= lat * Math.min(1, grip * dt);
    const turn = Math.max(-1, Math.min(1, fwd / 90));
    car.a += steer * car.T.steer * turn * dt * (c.brake ? 1.35 : 1);
    const nfx = Math.cos(car.a), nfy = Math.sin(car.a);
    car.vx = nfx * fwd - nfy * lat; car.vy = nfy * fwd + nfx * lat;

    const nx = car.x + car.vx * dt, ny = car.y + car.vy * dt;
    const hit = (x, y) => this.carBlocked(x, y, car.a, car);
    // si ya quedo encajado, se vale moverse mientras no se encaje mas (asi siempre puede salir)
    const stuck = hit(car.x, car.y) ? this.carBlocked(car.x, car.y, car.a, car, true) : 0;
    if (!hit(nx, ny) || (stuck && this.carBlocked(nx, ny, car.a, car, true) <= stuck)) { car.x = nx; car.y = ny; }
    else {
      const speed = Math.hypot(car.vx, car.vy), hitObj = this.lastHit;
      if (!hit(nx, car.y)) { car.x = nx; car.vy *= -0.2; car.vx *= 0.8; }
      else if (!hit(car.x, ny)) { car.y = ny; car.vx *= -0.2; car.vy *= 0.8; }
      else { car.vx *= -0.3; car.vy *= -0.3; }
      if (hitObj && hitObj.poli && car === this.inCar) this.hitPoli(speed);
      if (speed > 110) {
        this.jolt(120, Math.min(0.012, speed / 30000));
        if (car === this.inCar && window.SND) SND.play('crash', speed / 250);
        car.hp -= speed / 14;
        if (car.hp <= 0 && !broken) { this.wreck(car); toast('¡Auto deshuesado!', 'Bájate con E y roba otro.'); }
      }
    }
    // topes
    let onTope = false;
    for (const i of topesNear(car.x, car.y)) {
      const t = topes[i], dx = car.x - t.x, dy = car.y - t.y;
      const along = dx * Math.cos(t.a) + dy * Math.sin(t.a), across = -dx * Math.sin(t.a) + dy * Math.cos(t.a);
      if (Math.abs(along) < 7 && Math.abs(across) < t.w / 2 + 4) onTope = true;
    }
    if (onTope && !car.onTope) {
      const sp = Math.hypot(car.vx, car.vy);
      if (sp > 90) {
        this.jolt(180, Math.min(0.014, sp / 22000));
        if (car === this.inCar && window.SND) SND.play('crash', 0.2);
        car.vx *= 0.55; car.vy *= 0.55; car.hp -= sp / 45;
        if (Math.random() < 0.6) toast(pick(FRASES_TOPE), '', 1.6);
      } else if (sp > 25) this.jolt(90, 0.003);
    }
    car.onTope = onTope;
    // baches: solo al jugador le duelen (los demas ya se los saben de memoria)
    if (car === this.inCar) {
      let inB = null;
      for (const i of bachesNear(car.x, car.y)) { const b = baches[i]; if (dist(car.x, car.y, b.x, b.y) < b.r + car.hw * 0.6) inB = b; }
      if (inB && car.bache !== inB) {
        const sp = Math.hypot(car.vx, car.vy);
        if (sp > 30) {
          const dmg = (car.moto ? 1.5 : 1) * (inB.r / 9) * (4 + sp / 18);
          car.hp -= dmg; car.vx *= 0.8; car.vy *= 0.8;
          this.jolt(160, Math.min(0.012, sp / 20000));
          if (window.SND) SND.play('crash', 0.35);
          toast('🕳️ ' + pick(FRASES_BACHE), 'Tu auto: -' + Math.round(dmg) + ' de vida', 2);
          if (car.hp <= 0 && !broken) { this.wreck(car); toast('¡Auto deshuesado!', 'El bache ganó. Bájate con E y roba otro.'); }
        }
      }
      car.bache = inB;
    }
    car.sprite.setPosition(car.x, car.y).setRotation(car.a);
    if (car.hp <= 0 && !car.wrecked) { this.wreck(car); toast('¡Auto deshuesado!', 'Bájate con E y roba otro.'); }
    car.smokeT = (car.smokeT || 0) - dt;
    if (car.hp < car.maxHp * 0.35 && car.smokeT <= 0) { car.smokeT = 0.12; this.puff(car.x + Math.cos(car.a) * (car.hl - 3), car.y + Math.sin(car.a) * (car.hl - 3)); }
  }
  // auto destruido: explota, queda chamuscado y abollado, y se quema un rato (luego solo humea)
  wreck(car) {
    if (car.wrecked) return;
    car.wrecked = true;
    car.sprite.setTint(0x3b302a);
    car.scorch = this.add.image(car.x, car.y, 'scorch').setRotation(car.a).setDepth(car.sprite.depth + 0.1).setDisplaySize(car.hl * 2.15, car.hw * 2.3);
    car.burn = 30; car.fireT = 0;
    this.burning.push(car);
    const fx = this.add.circle(car.x, car.y, 10, 0xffb030, 0.9).setDepth(17).setBlendMode(Phaser.BlendModes.ADD);
    this.tweens.add({ targets: fx, scale: 4, alpha: 0, duration: 450, onComplete: () => fx.destroy() });
    for (let i = 0; i < 10; i++) this.flame(car.x + rnd(-8, 8), car.y + rnd(-8, 8), 1.8);
    this.jolt(300, 0.012);
    if (window.SND) SND.play('boom');
  }
  flame(x, y, big = 1) {
    const f = this.add.circle(x, y, rnd(2.5, 4.5) * big, Math.random() < 0.5 ? 0xff6a00 : 0xffc23a, 0.95).setDepth(16).setBlendMode(Phaser.BlendModes.ADD);
    this.tweens.add({ targets: f, y: y - rnd(10, 18) * big, x: x + rnd(-3, 3), scale: 0.2, alpha: 0, duration: rnd(350, 600), onComplete: () => f.destroy() });
  }
  blackSmoke(x, y) {
    const s = this.add.circle(x, y, 5, 0x1e1e1e, 0.55).setDepth(15);
    this.tweens.add({ targets: s, scale: 4, alpha: 0, y: y - 22, x: x + rnd(-6, 6), duration: 1600, onComplete: () => s.destroy() });
  }
  updateBurning(dt) {
    const f = this.focus(), R = this.viewR() + 60;
    this.burning = this.burning.filter(c => {
      if (!c.sprite.active) { c.scorch.destroy(); return false; }
      c.scorch.setPosition(c.x, c.y).setRotation(c.a);
      if (dist(c.x, c.y, f.x, f.y) > R) return true; // fuera de la vista no se dibuja el fuego
      c.burn -= dt; c.fireT -= dt;
      if (c.fireT > 0) return true;
      const hx = c.x + Math.cos(c.a) * c.hl * 0.45, hy = c.y + Math.sin(c.a) * c.hl * 0.45; // el cofre
      if (c.burn > 0) { c.fireT = 0.06; this.flame(hx + rnd(-5, 5), hy + rnd(-5, 5), 1.3); this.flame(c.x + rnd(-6, 6), c.y + rnd(-5, 5)); if (Math.random() < 0.35) this.blackSmoke(hx, hy - 6); }
      else { c.fireT = 0.35; this.blackSmoke(hx, hy); }
      return true;
    });
  }

  puff(x, y) {
    const s = this.add.circle(x, y, 5, 0x555555, 0.6).setDepth(15);
    this.tweens.add({ targets: s, scale: 3, alpha: 0, y: y - 10, duration: 900, onComplete: () => s.destroy() });
  }

  // multa por chocar una patrulla (con unos segundos de gracia entre multas)
  hitPoli(sp) {
    if (sp < 40 || this.time.now < (this.poliT || 0)) return;
    this.poliT = this.time.now + 5000;
    const fine = Math.min(state.money, Math.round(rnd(150, 400) * Math.min(2, sp / 120) / 10) * 10);
    state.money -= fine; save(); updateStats();
    this.cameras.main.flash(250, 40, 80, 255);
    toast('🚓 ' + pick(FRASES_POLI), fine > 0 ? 'Multa: -$' + fine : 'No traías ni para la mordida. Te dejaron ir de lástima.', 3);
  }

  // count: en vez de si/no, cuenta cuantos puntos chocan (para saber si se encaja mas o menos)
  carBlocked(x, y, a, self, count) {
    this.lastHit = null;
    const c = Math.cos(a), s = Math.sin(a);
    const hl = self ? self.hl : 14, hw = self ? self.hw : 6;
    let n = 0;
    for (const [u, v] of [[hl, hw], [hl, -hw], [-hl, hw], [-hl, -hw], [hl + 2, 0], [0, hw], [0, -hw]]) if (blocked(x + c * u - s * v, y + s * u + c * v)) { if (!count) return true; n++; }
    // los demas vehiculos son capsulas a lo largo de su eje
    const h = Math.max(0, hl - hw), pts = [[x, y], [x + c * h, y + s * h], [x - c * h, y - s * h]];
    for (const list of [this.cars, this.parked]) for (const o of list) {
      if (o === self || Math.abs(o.x - x) > 70 || Math.abs(o.y - y) > 70) continue;
      for (const [px, py] of pts) if (axisDist(px, py, o) < o.hw + hw + 1) { this.lastHit = o; if (!count) return true; n += 1 + (o.hw + hw + 1 - axisDist(px, py, o)) / 4; }
    }
    return count ? n : false;
  }

  toggleCar() {
    if (this.inCar) {
      const car = this.inCar, a = car.a;
      if (Math.hypot(car.vx, car.vy) > 60) return;
      let ex = null;
      for (const side of [1, -1]) { const x = car.x - Math.sin(a) * (car.hw + 8) * side, y = car.y + Math.cos(a) * (car.hw + 8) * side; if (!blocked(x, y)) { ex = [x, y]; break; } }
      if (!ex) { toast('No puedes bajarte aquí', ''); return; }
      car.vx = car.vy = 0;
      this.parked.push(car); this.inCar = null;
      this.player.x = ex[0]; this.player.y = ex[1];
      this.player.sprite.setVisible(true).setPosition(ex[0], ex[1]);
      this.cameras.main.startFollow(this.player.sprite, true, 0.15, 0.15);
      if (this.taxi) { this.endTaxi(false, 'Te bajaste del taxi.'); }
      this.setObjective();
      return;
    }
    const p = this.player;
    let best = null, bd = 56;
    for (const c of this.parked) { const d = dist(c.x, c.y, p.x, p.y); if (d < bd) { bd = d; best = c; } }
    for (const c of this.cars) { const d = dist(c.x, c.y, p.x, p.y); if (d < bd) { bd = d; best = c; } }
    if (!best) return;
    if (best.hp <= 0) { toast('Ese auto ya no sirve', ''); return; }
    if (best.poli) { toast('🚓 ¿Robarle la patrulla a la poli?', 'Ni lo pienses, compa.', 2); return; }
    if (this.cars.includes(best)) {
      this.cars.splice(this.cars.indexOf(best), 1);
      // el conductor sale corriendo
      const g = nearestOnGraph(walkG, best.x, best.y);
      if (g) {
        const ped = { e: g.e, dir: 1, s: g.s, side: pedSide(g.e, g.s, 1, best.x, best.y, 0), speed: 60, st: 'flee', t: 4, x: best.x, y: best.y, a: 0,
          sprite: this.walker(best.x, best.y, 2.2) };
        this.peds.push(ped);
      }
      if (best.moto) this.startDelivery();
      else toast(pick(FRASES_ROBO), best.T.name + (best.dirty ? ' bien madreado' : ' de agencia'), 2.4);
    } else this.parked.splice(this.parked.indexOf(best), 1);
    best.vx = best.vy = 0;
    this.inCar = best; this.staminaBar.clear(); this.stamina = STAMINA; this.tired = false; // manejando descansas
    this.player.sprite.setVisible(false);
    this.cameras.main.startFollow(best.sprite, true, 0.15, 0.15);
    this.setObjective();
  }

  updateTraffic(dt) {
    const pl = this.inCar || this.player;
    // torreta de las patrullas
    const blink = 'poli' + ((this.time.now / 280 | 0) % 2);
    for (const c of this.cars) if (c.poli && c.sprite.texture.key !== blink) c.sprite.setTexture(blink);
    const neon = 'antro' + ((this.time.now / 600 | 0) % 2);
    for (const c of chinas) if (c.icon.texture.key !== neon + c.up) c.icon.setTexture(neon + c.up);
    const tmp = this.tmp;
    for (const c of this.cars) {
      const hx = Math.cos(c.a), hy = Math.sin(c.a);
      const ax = c.x + hx * (c.hl + 13), ay = c.y + hy * (c.hl + 13);
      let stop = this.inCar ? axisDist(ax, ay, pl) < pl.hw + 10 : dist(ax, ay, pl.x, pl.y) < 16;
      if (!stop) for (const o of this.cars) { if (o !== c && axisDist(ax, ay, o) < o.hw + 8) { stop = true; break; } }
      if (!stop) for (const o of this.parked) { if (axisDist(ax, ay, o) < o.hw + 8) { stop = true; break; } }
      if (!stop) for (const o of this.peds) { if (o.st === 'walk' && dist(ax, ay, o.x, o.y) < 9) { stop = true; break; } }
      let want = stop ? 0 : c.max;
      for (const i of topesNear(c.x, c.y)) if (dist(c.x, c.y, topes[i].x, topes[i].y) < 45) want = Math.min(want, 35);
      c.speed += Math.max(-300 * dt, Math.min(90 * dt, want - c.speed));
      c.s += c.speed * dt;
      while (c.s > c.e.len) {
        const nx = nextEdge(traffic, c.e, c.dir);
        if (!nx) { c.s = c.e.len; c.speed = 0; break; }
        c.s -= c.e.len; c.e = nx.e; c.dir = nx.dir; c.lat = laneLat(nx.e, c.lane);
      }
      edgePos(c.e, c.s, c.dir, c.lat, tmp);
      c.x += (tmp.x - c.x) * Math.min(1, dt * 12); c.y += (tmp.y - c.y) * Math.min(1, dt * 12);
      c.a += angDiff(c.a, tmp.a) * Math.min(1, dt * 7);
      c.sprite.setPosition(c.x, c.y).setRotation(c.a);
    }
    // choques del jugador contra autos
    if (this.inCar) {
      const me = this.inCar;
      for (const o of this.cars.concat(this.parked)) {
        if (Math.abs(o.x - me.x) > 70 || Math.abs(o.y - me.y) > 70) continue;
        // punto de mi eje mas cercano al eje del otro
        const h = Math.max(0, me.hl - me.hw), c = Math.cos(me.a), s = Math.sin(me.a);
        let best = null;
        for (const t of [-h, 0, h]) { const px = me.x + c * t, py = me.y + s * t, q = axisPoint(px, py, o), d = dist(px, py, q[0], q[1]); if (!best || d < best[0]) best = [d, px - q[0], py - q[1]]; }
        const [d, ddx, ddy] = best, R = me.hw + o.hw + 4;
        if (d < R && d > 0) {
          const nx = ddx / d, ny = ddy / d, sp = Math.hypot(me.vx, me.vy);
          me.x += nx * (R - d); me.y += ny * (R - d);
          const vn = me.vx * nx + me.vy * ny; if (vn < 0) { me.vx -= 1.4 * vn * nx; me.vy -= 1.4 * vn * ny; }
          if (o.poli) this.hitPoli(sp);
          if (sp > 120) { this.jolt(100, 0.006); me.hp -= sp / 25; o.speed = 0; }
        }
      }
    }
  }

  updatePeds(dt) {
    const tmp = this.tmp, car = this.inCar;
    const csp = car ? Math.hypot(car.vx, car.vy) : 0;
    for (const p of this.peds) {
      if (p.st === 'down') {
        p.t -= dt; if (p.t <= 0) { p.st = 'flee'; p.t = 5; p.sprite.setScale(1 / SPR).clearTint(); p.sprite.anims.resume(); p.sprite.anims.timeScale = 2.2; }
        continue;
      }
      if (car && csp > 50 && axisDist(p.x, p.y, car) < car.hw + 3) {
        p.st = 'down'; p.t = 2.5; p.sprite.setScale(1.2 / SPR, 0.6 / SPR).setTint(0xaaaaaa); p.sprite.anims.pause();
        if (Math.random() < 0.7) toast(pick(FRASES_ATROPELLO), '', 1.8);
        continue;
      }
      if (p.st === 'flee') { p.t -= dt; if (p.t <= 0) { p.st = 'walk'; p.sprite.anims.timeScale = p.speed / 20; } }
      const sp = p.st === 'flee' ? 70 : p.speed;
      p.s += sp * dt;
      if (p.s > p.e.len) {
        const nx = nextEdge(walkG, p.e, p.dir);
        if (nx) { p.s -= p.e.len; p.e = nx.e; p.dir = nx.dir; p.side = pedSide(p.e, p.s, p.dir, p.x, p.y, 0.12); }
        else { p.s = 0; p.dir = -p.dir; p.side = -p.side; }
      }
      edgePos(p.e, p.s, p.dir, p.side, tmp);
      if (!blocked(tmp.x, tmp.y) || blocked(p.x, p.y)) { p.x += (tmp.x - p.x) * Math.min(1, dt * 10); p.y += (tmp.y - p.y) * Math.min(1, dt * 10); }
      else { p.dir = -p.dir; p.s = p.e.len - p.s; }
      p.a = tmp.a;
      p.sprite.setPosition(p.x, p.y).setRotation(p.a);
    }
  }

  // la gente te habla si te le pegas caminando (una frase distinta cada vez hasta agotarlas)
  pedChat(dt) {
    const b = this.bubble;
    this.chatCool -= dt;
    if (b.ped) {
      b.t -= dt;
      this.placeBubble();
      if (b.t <= 0 || b.ped.st === 'down' || dist(b.ped.x, b.ped.y, this.player.x, this.player.y) > 140) { b.ped = null; b.el.classList.remove('on'); }
    }
    if (this.inCar || this.chatCool > 0) return;
    const pl = this.player;
    for (const p of this.peds) {
      if (p.st !== 'walk' || p.talked || dist(p.x, p.y, pl.x, pl.y) > 14) continue;
      if (!this.chatDeck.length) this.chatDeck = Phaser.Utils.Array.Shuffle(FRASES_PEATON.slice());
      p.talked = true; b.ped = p; b.t = 4.5; this.chatCool = 2.5;
      const fr = this.chatDeck.pop();
      b.el.className = 'hud bubble ' + fr.k;
      b.el.textContent = fr.t;
      // cada globo sale un poco chueco, como de historieta
      b.el.style.setProperty('--tilt', (Math.random() * 5 - 2.5).toFixed(1) + 'deg');
      this.placeBubble();
      void b.el.offsetWidth; b.el.classList.add('on'); // reinicia la animacion de entrada
      if (window.SND) SND.play('chat');
      break;
    }
  }

  // el globo es HTML: se coloca sobre la cabeza del peaton pasando de coordenadas del mundo a pixeles CSS
  placeBubble() {
    const b = this.bubble, cam = this.cameras.main, v = cam.worldView, k = cam.zoom / DPR;
    const hw = b.el.offsetWidth / 2 + 8; // que no se salga por los lados
    b.el.style.left = Math.max(hw, Math.min(window.innerWidth - hw, (b.ped.x - v.x) * k)) + 'px';
    b.el.style.top = ((b.ped.y - 10 - v.y) * k) + 'px';
  }

  // ----- Tijuana de noche (premio de los 25 lugares) -----
  // Una capa oscura del tamaño de la pantalla (RenderTexture fija a la camara) a la que cada cuadro se le "borran"
  // las luces con texturas suaves; encima, resplandores de color en el mundo con mezcla aditiva.
  updateNight(time, dt, f) {
    const n = this.night, want = (state.night && this.perk.noche) || (this.fiesta && this.fiesta.on) ? 1 : 0; // la fiesta es de noche
    n.a += Math.max(-dt * 1.2, Math.min(dt * 1.2, want - n.a));
    let gi = 0;
    if (n.a > 0.001) {
      // la capa sobra un 10% por cada lado: mientras cambia el zoom (al subir o bajar del carro) no se ve la orilla
      const P = 0.1;
      if (!n.rt) {
        n.rt = this.add.renderTexture(0, 0, this.scale.width * (1 + 2 * P), this.scale.height * (1 + 2 * P)).setOrigin(0).setScrollFactor(0).setDepth(19);
        this.scale.on('resize', (gs) => n.rt.resize(gs.width * (1 + 2 * P), gs.height * (1 + 2 * P)));
      }
      const cam = this.cameras.main, z = cam.zoom, v = cam.worldView, rt = n.rt, W = this.scale.width, H = this.scale.height, ox = W * P, oy = H * P;
      // los objetos fijos a la camara tambien se amplian con el zoom: se compensa para que la capa empiece en (-ox, -oy) de la pantalla
      rt.setVisible(true).setScale(1 / z).setPosition(W / 2 - (W / 2 + ox) / z, H / 2 - (H / 2 + oy) / z);
      rt.clear(); rt.fill(0x0b1030, 0.64 * n.a);
      let ci = 0;
      const vis = (x, y, r) => x > v.x - r && x < v.right + r && y > v.y - r && y < v.bottom + r;
      // luz que aclara la oscuridad (coordenadas de pantalla); r = radio en el mundo
      const cut = (key, x, y, r, a) => {
        if (!vis(x, y, r) || ci >= 180) return;
        let im = n.cut[ci]; if (!im) im = n.cut[ci] = this.make.image({ key, add: false });
        ci++;
        im.setTexture(key).setPosition((x - v.x) * z + ox, (y - v.y) * z + oy).setRotation(a || 0);
        if (key === 'cono') im.setOrigin(0, 0.5).setScale(r * z / 256); else im.setOrigin(0.5).setScale(2 * r * z / 128);
      };
      // resplandor de color en el mundo (encima de la oscuridad)
      const glow = (x, y, r, tint, alpha) => {
        if (!vis(x, y, r) || gi >= 120) return;
        let im = n.glow[gi]; if (!im) im = n.glow[gi] = this.add.image(0, 0, 'luz').setDepth(19.5).setBlendMode(Phaser.BlendModes.ADD);
        gi++;
        im.setVisible(true).setPosition(x, y).setScale(2 * r / 128).setTint(tint).setAlpha(alpha * n.a);
      };
      // faroles
      const c0 = Math.floor((v.x - 60) / 256), c1 = Math.floor((v.right + 60) / 256), r0 = Math.floor((v.y - 60) / 256), r1 = Math.floor((v.bottom + 60) / 256);
      for (let cx = c0; cx <= c1; cx++) for (let cy = r0; cy <= r1; cy++) for (const o of FAROLES.get(cx + ',' + cy) || []) { cut('luz', o.x, o.y, 38); glow(o.x, o.y, 22, 0xffb347, 0.28); }
      // lugares, taquerias y cafes
      for (const l of landmarks) { cut('luz', l.x, l.y, 75); glow(l.x, l.y, 45, 0xffe08a, 0.25); }
      for (const t of tacos) cut('luz', t.x, t.y, 30);
      for (const c of cafes) cut('luz', c.x, c.y, 26);
      // vehiculos: haz de los faros, calaveras rojas y la torreta de las patrullas
      const lights = (c) => {
        const fx = Math.cos(c.a), fy = Math.sin(c.a);
        cut('cono', c.x + fx * c.hl, c.y + fy * c.hl, c.moto ? 70 : 95, c.a);
        glow(c.x - fx * c.hl, c.y - fy * c.hl, c.moto ? 6 : 9, 0xff2020, 0.55);
        if (c.poli) glow(c.x, c.y, 16, Math.floor(time / 220) % 2 ? 0xff1a1a : 0x2a5bff, 0.75);
      };
      for (const c of this.cars) lights(c);
      if (this.fiesta) for (const L of this.fiesta.lights) { cut('luz', L.x, L.y, L.r); glow(L.x, L.y, L.r * 0.7, L.tint, 0.5 * L.a); } // cohetes
      if (this.inCar) lights(this.inCar);
      else cut('luz', this.player.x, this.player.y, 42);
      rt.erase(n.cut.slice(0, ci));
    } else if (n.rt) n.rt.setVisible(false);
    for (let i = gi; i < n.glow.length; i++) n.glow[i].setVisible(false);
  }

  // ----- la fiesta en la Plaza Santa Cecilia (al completar todo) -----
  plaza() { return landmarks.find(l => l.name === 'Plaza Santa Cecilia') || landmarks[0]; }
  inviteFiesta() { const p = this.plaza(); this.waypoint = { x: p.x, y: p.y, fiesta: true }; this.setObjective(); }
  // mariachis en medio circulo de un lado de la plaza, viendo hacia el centro; se quedan despues de la fiesta
  spawnMariachis() {
    if (this.mariachis) return;
    const P = this.plaza(); this.mariachis = [];
    for (let i = 0; i < 6; i++) {
      const a = Math.PI * (1.15 + i / 5 * 0.7);
      let r = 58, x, y;
      do { x = P.x + Math.cos(a) * r; y = P.y + Math.sin(a) * r; r -= 6; } while (blocked(x, y) && r > 20);
      const m = this.add.image(x, y, 'mariachi' + [0, 1, 0, 3, 2, 1][i]).setDepth(7).setScale(1 / SPR).setRotation(a + Math.PI);
      this.tweens.add({ targets: m, angle: m.angle + 7, duration: MARI_SWAY, yoyo: true, repeat: -1, ease: 'Sine.inOut', delay: i * 90 });
      this.mariachis.push(m);
    }
  }
  startFiesta() {
    const P = this.plaza();
    const fz = this.fiesta = { on: true, t: 0, P, crowd: [], lights: [], next: 1, said: 0, frases: Phaser.Utils.Array.Shuffle(FRASES_FIESTA()).slice(0, 5) };
    state.celebrated.push('fiesta'); save();
    this.waypoint = null; this.chatCool = 99; this.setObjective();
    this.spawnMariachis();
    if (window.SND) SND.mariachi(true);
    toast('🎉 ¡Fiesta en la Plaza Santa Cecilia!', '¡Que toquen los mariachis! Todo Tijuana vino a felicitarte.', 5);
    // la gente llega caminando y se queda alrededor, meciendose con la musica
    for (let i = 0; i < 16; i++) {
      const a = i / 16 * Math.PI * 2 + rnd(-0.15, 0.15); let r = rnd(85, 125), x, y;
      do { x = P.x + Math.cos(a) * r; y = P.y + Math.sin(a) * r; r -= 8; } while (blocked(x, y) && r > 50);
      if (blocked(x, y)) continue;
      const sx = x + Math.cos(a) * 160, sy = y + Math.sin(a) * 160, k = pedVariant();
      const s = this.add.sprite(sx, sy, 'ped' + k, 0).setDepth(6).setScale(1 / SPR).setRotation(a + Math.PI).setAlpha(0);
      s.play('walk' + k);
      this.tweens.add({ targets: s, x, y, alpha: 1, duration: 2200 + Math.random() * 1500, onComplete: () => {
        s.stop(); s.setFrame(0); this.tweens.add({ targets: s, angle: s.angle + 10, duration: MARI_SWAY, yoyo: true, repeat: -1, ease: 'Sine.inOut' }); } });
      fz.crowd.push(s);
    }
    // cohetes de colores entre la plaza y el Arco (esta 250 px al sur) y confeti cayendo
    fz.bursts = [0xff3d6e, 0xffd23f, 0x4fc3f7, 0x7cff6b, 0xff9a3c, 0xd36bff].map(tint => {
      const em = this.add.particles(0, 0, 'chispa', {
        speed: { min: 60, max: 180 }, angle: { min: 0, max: 360 }, lifespan: { min: 1000, max: 1700 }, gravityY: 45,
        scale: { start: 0.95, end: 0 }, alpha: { start: 1, end: 0 }, tint, blendMode: 'ADD', emitting: false }).setDepth(21);
      em.color = tint; return em;
    });
    fz.confeti = this.add.particles(0, 0, 'confeti', {
      x: { min: P.x - 170, max: P.x + 170 }, y: P.y - 140, lifespan: 4500, speedY: { min: 25, max: 55 }, speedX: { min: -20, max: 20 },
      rotate: { start: 0, end: 360 }, scale: { min: 0.8, max: 1.3 }, tint: [0xe91e63, 0xffeb3b, 0x2196f3, 0x4caf50, 0xff9800, 0x9c27b0], frequency: 45 }).setDepth(21);
  }
  launchCohete() {
    // salen del lado del Arco y estallan sobre la plaza, donde se ven
    const fz = this.fiesta, P = fz.P, x0 = P.x + rnd(-200, 200), y0 = P.y + rnd(60, 200), y1 = y0 - rnd(150, 230), x1 = x0 + rnd(-30, 30);
    const rocket = this.add.image(x0, y0, 'chispa').setDepth(21).setScale(0.5).setBlendMode(Phaser.BlendModes.ADD).setTint(0xfff2c0);
    const light = { x: x0, y: y0, r: 30, tint: 0xfff2c0, a: 1 }; fz.lights.push(light);
    if (window.SND) SND.play('cohete');
    this.tweens.add({ targets: rocket, x: x1, y: y1, duration: 750, ease: 'Quad.out', onUpdate: () => { light.x = rocket.x; light.y = rocket.y; }, onComplete: () => {
      rocket.destroy();
      const em = pick(fz.bursts); em.explode(70, x1, y1);
      light.r = 110; light.tint = em.color;
      this.tweens.add({ targets: light, a: 0, r: 60, duration: 1300, onComplete: () => fz.lights.splice(fz.lights.indexOf(light), 1) });
    } });
  }
  updateFiesta(time, dt, f) {
    const fz = this.fiesta;
    if (!fz) {
      // la fiesta empieza al llegar a la plaza (despues de completar todo)
      if (state.celebrated.includes('final') && !state.celebrated.includes('fiesta')) { const P = this.plaza(); if (dist(P.x, P.y, f.x, f.y) < 130) this.startFiesta(); }
      return;
    }
    if (!fz.on) return;
    fz.t += dt; this.chatCool = 99;
    if (fz.t < FIESTA_SECS - 4 && (fz.next -= dt) <= 0) { fz.next = rnd(0.5, 1.1); this.launchCohete(); }
    if (fz.t > 18) fz.confeti.stop();
    // felicitaciones, una cada ~5 s, de alguien de la multitud
    if (fz.said < fz.frases.length && fz.t > 4 + fz.said * 5 && fz.crowd.length) {
      const who = fz.crowd[(fz.said * 3) % fz.crowd.length], b = this.bubble, txt = fz.frases[fz.said++];
      b.ped = { x: who.x, y: who.y, st: 'fiesta' }; b.t = 4.4;
      b.el.className = 'hud bubble fiesta'; b.el.textContent = txt; b.el.style.setProperty('--tilt', (Math.random() * 5 - 2.5).toFixed(1) + 'deg');
      this.placeBubble(); void b.el.offsetWidth; b.el.classList.add('on');
      if (window.SND) SND.play('chat');
    }
    if (fz.t >= FIESTA_SECS) this.endFiesta();
  }
  endFiesta() {
    const fz = this.fiesta; fz.on = false; this.chatCool = 3;
    if (window.SND) SND.mariachi(false);
    state.money += 1000; save(); bigSound = true; updateStats();
    toast('🎉 ¡Viva Tijuana!', 'Ganaste $1,000 de la cooperacha. Los mariachis se quedan en la plaza. Tu Acta de Tijuanense está en ⚙️ Opciones.', 7);
    // la gente se va dispersando; los cohetes y el confeti terminan solos
    fz.crowd.forEach((s, i) => { this.tweens.killTweensOf(s); this.tweens.add({ targets: s, alpha: 0, delay: i * 120, duration: 900, onComplete: () => s.destroy() }); });
    this.time.delayedCall(4000, () => { fz.bursts.forEach(e => e.destroy()); fz.confeti.destroy(); this.fiesta = null; });
    this.setObjective();
  }

  // ----- premios por completar colecciones -----
  // se revisa despues de cada lugar, taco o cafe; cada premio se festeja una sola vez (state.celebrated)
  checkPerks() {
    const p = perks(), news = ['cafe', 'taco', 'noche', 'final'].filter(k => p[k] && !state.celebrated.includes(k));
    this.perk = p;
    if (!news.length) return;
    state.celebrated.push(...news); save();
    // si se ganan varios a la vez, los avisos salen uno tras otro
    news.forEach((k, i) => this.time.delayedCall(i * 6500 + 1500, () => this.celebrate(k)));
  }
  celebrate(k) {
    if (window.SND) SND.play('fanfare');
    if (k === 'cafe') toast('☕ ¡Barista de la Revu!', 'Te tomaste los ' + cafes.length + ' cafés. Ya puedes correr sin cansarte.', 6);
    if (k === 'taco') {
      this.spawnSpecial('troca', 40);
      toast('🌮 ¡Taquero honorario!', 'Te comiste los ' + tacos.length + ' tacos. Cualquier taquería te repara el carro, y aquí cerca te dejaron una troca de tacos.', 6.5);
    }
    if (k === 'noche') { showPerkButtons(); toast('★ ¡Cronista de Tijuana!', 'Conoces los ' + landmarks.length + ' lugares. Se desbloqueó Tijuana de noche: búscala en ⚙️ Opciones (o tecla L).', 6.5); }
    if (k === 'final') {
      this.spawnSpecial('zonkey', 40); showPerkButtons();
      toast('🏆 ¡Ya eres tijuanense!', 'Completaste todo. Aquí cerca te espera un burro cebra dorado y... ¡hay fiesta en la Plaza Santa Cecilia! Sigue los puntos verdes.', 8);
      this.inviteFiesta();
    }
  }
  // estaciona la troca o el burro en la calle mas cercana, a `ahead` px de donde estas
  spawnSpecial(kind, ahead) {
    const f = this.inCar || this.player, n = nearEdge(traffic, f.x, f.y);
    if (!n) return;
    const e = n.e, s = Math.max(5, Math.min(e.len - 5, n.s + (n.s + ahead < e.len ? ahead : -ahead)));
    const pos = edgePos(e, s, 1, laneLat(e, e.one ? 3 : 1), {});
    const car = this.makeCar(pos.x, pos.y, pos.a, { [kind]: true });
    car.special = kind; this.parked.push(car);
    return car;
  }

  // ----- actividades -----
  checkActivities(dt, f, sp) {
    for (const l of landmarks) {
      if (l.found || dist(l.x, l.y, f.x, f.y) > 110) continue;
      l.found = true; state.money += 100; save(); bigSound = true; updateStats();
      const n = landmarks.filter(q => q.found).length;
      toast('★ ' + l.name, l.desc + '  (+$100)' + (n === landmarks.length ? ' ¡Conoces todo el Centro!' : ''), 5);
      this.setObjective();
    }
    for (const t of tacos) {
      // taquero honorario: cualquier taqueria te deja el carro como nuevo (cada una una vez por minuto)
      if (this.perk.taco && this.inCar && this.inCar.hp < this.inCar.maxHp && !(t.cool > 0) && sp < 70 && dist(t.x, t.y, f.x, f.y) < 45) {
        t.cool = 60; this.inCar.hp = this.inCar.maxHp;
        toast('🌮 ' + t.name, pick(['"¿Lo de siempre, jefe?" Te dejaron el carro como nuevo.', 'El taquero le dio una pasadita al motor con el trapo del comal. Quedó al cien.',
          '"Para el taquero honorario, servicio completo." Carro reparado.']), 3);
      }
      if (t.cool > 0) t.cool -= dt;
      if (t.eaten || dist(t.x, t.y, f.x, f.y) > 40 || sp > 70) continue;
      t.eaten = true; state.money += 25; save(); updateStats();
      if (this.inCar) this.inCar.hp = Math.min(this.inCar.maxHp, this.inCar.hp + 30);
      toast('🌮 ' + t.name, pick(['¡Qué buenos de asada!', 'Birria con consomé, uff.', 'Al pastor con piña.', 'Unos de adobada, de rigor.']) + '  (+$25)', 3);
    }
    for (const c of cafes) {
      if (c.drunk || dist(c.x, c.y, f.x, f.y) > 40 || sp > 70) continue;
      c.drunk = true; state.money += 20; save(); updateStats();
      toast('☕ ' + c.name, pick(FRASES_CAFE) + '  (+$20)', 3);
    }
    this.checkPerks();
    for (const e of EGGS) {
      if (e.got || dist(e.x, e.y, f.x, f.y) > 45 || sp > 90) continue;
      e.got = true; state.money += e.pay; save(); bigSound = true; updateStats();
      const n = EGGS.filter(q => q.got).length;
      toast('🥚 ' + e.name + ' (+$' + e.pay + ')', e.say + (n === EGGS.length ? '  ¡Encontraste todos los secretos de Tijuana!' : '  Secreto ' + n + ' de ' + EGGS.length + '.'), 6);
      this.tweens.add({ targets: e.icon, alpha: 0, scale: 1.2, duration: 900, delay: 1500, onComplete: () => e.icon.setVisible(false) });
    }
    for (const c of chinas) {
      c.cool -= dt;
      if (c.cool > 0 || dist(c.x, c.y, f.x, f.y) > 40 || sp > 70) continue;
      c.cool = 30;
      if (state.money <= 0) { toast('🏮 ' + c.name, 'No traes ni para el arroz frito. Te sacaron a la calle.', 3); continue; }
      const loss = Math.min(state.money, Math.round(rnd(80, 220) / 10) * 10);
      state.money -= loss; save(); updateStats();
      toast('🏮 ' + c.name, pick(['Pediste "el combo especial" y saliste sin cartera.', 'Te dijeron que la orden de la casa era barata. No lo era.',
        'Entraste por unas costillitas y salió carísimo.', 'La cuenta llegó más larga que el menú.']) + '  (-$' + loss + ')', 4);
    }
    const dl = this.delivery;
    if (dl) {
      dl.time -= dt;
      if (dl.time <= 0) this.endDelivery(false);
      else if (dist(dl.x, dl.y, f.x, f.y) < 50 && sp < 60) this.endDelivery(true);
    }
    const tx = this.taxi;
    if (tx) {
      if (tx.phase === 'drop') {
        tx.time -= dt;
        if (tx.time <= 0) { this.endTaxi(false, 'Tardaste mucho, el pasajero se bajó.'); return; }
      }
      if (dist(tx.x, tx.y, f.x, f.y) < (tx.phase === 'pick' ? 45 : 70) && sp < 45) {
        if (tx.phase === 'pick') {
          tx.ped.destroy();
          const far = landmarks.filter(l => dist(l.x, l.y, f.x, f.y) > 700);
          const dest = pick(far.length ? far : landmarks);
          const d = dist(dest.x, dest.y, f.x, f.y);
          Object.assign(tx, { phase: 'drop', x: dest.x, y: dest.y, name: dest.name, time: d / 95 + 20, d });
          toast('Pasajero a bordo', '"Lléveme a ' + dest.name + ', por favor."', 3);
        } else {
          const pay = Math.round(40 + tx.d / 12 + tx.time * 3);
          state.money += pay; save(); updateStats();
          this.endTaxi(true, 'Llegaste a ' + tx.name + '. Ganaste $' + pay + '.');
        }
        this.setObjective();
      }
    }
  }
  startDelivery() {
    if (this.delivery) { toast(pick(FRASES_MOTO), 'Ya traes un pedido pendiente, ¡apúrale!', 3); return; }
    const f = this.inCar || this.player;
    let spot = null, mid = null;
    for (let i = 0; i < 40 && !spot; i++) {
      const e = randomEdgeNear(walkG, f.x, f.y, 700, 1600); if (!e || e.c > 6) continue;
      const s = rnd(0, e.len), q = edgePos(e, s, 1, e.w / 2 + 1.5 * M, {});
      if (!blocked(q.x, q.y)) { spot = q; mid = edgePos(e, s, 1, 0, {}); }
    }
    if (!spot) return;
    const d = dist(spot.x, spot.y, f.x, f.y), street = streetAt(spot.x, spot.y) || 'una calle del Centro';
    const order = pick(PEDIDOS), dog = order === PERRO_PEDIDO || Math.random() < 0.15;
    // quien recibe espera en la banqueta viendo hacia la calle
    const face = Math.atan2(mid.y - spot.y, mid.x - spot.x);
    let who;
    if (dog) {
      who = this.add.sprite(spot.x, spot.y, 'perro', 0).setDepth(6).setScale(1 / SPR).setRotation(face).play('cola');
    } else {
      who = this.add.sprite(spot.x, spot.y, 'ped' + pedVariant(), 0).setDepth(6).setScale(1 / SPR).setRotation(face);
      this.tweens.add({ targets: who, angle: who.angle + 8, duration: 700, yoyo: true, repeat: -1, ease: 'Sine.inOut' });
    }
    this.delivery = { x: spot.x, y: spot.y, street, order, time: d / 85 + 20, d, dog, who };
    toast(pick(FRASES_MOTO), 'Pedido: ' + this.delivery.order + '. Llévalo a ' + street + '.', 4.5);
    this.setObjective();
  }
  endDelivery(ok) {
    const dl = this.delivery; this.delivery = null; hud.timer.style.display = 'none';
    if (ok) {
      const pay = Math.round(50 + dl.d / 10 + dl.time * 2), tip = Math.random() < 0.5 ? Math.round(rnd(5, 60)) : 0;
      state.deliveries++;
      state.money += pay + tip; save(); updateStats();
      const msg = dl.order === PERRO_PEDIDO ? CLIENTES_PERRO_BIRRIA : pick(dl.dog ? CLIENTES_PERRO : CLIENTES);
      toast('¡Pedido entregado!', msg + ' (+$' + pay + (tip ? ' y $' + tip + ' de propina' : '') + ')', 4.5);
    } else toast('Pedido cancelado', pick(CANCELADOS), 4);
    // el que recibio da un saltito de gusto y se mete; si se cancelo, nomas se mete
    const w = dl.who; this.tweens.killTweensOf(w);
    if (ok) this.tweens.add({ targets: w, scale: 1.4 / SPR, duration: 160, yoyo: true, repeat: 1 });
    this.tweens.add({ targets: w, alpha: 0, delay: ok ? 1200 : 0, duration: 600, onComplete: () => w.destroy() });
    this.setObjective();
  }
  startTaxi() {
    if (!this.inCar) { toast('Necesitas un auto', 'Roba uno con E y luego presiona T.'); return; }
    if (this.inCar.moto) { toast('En moto no caben pasajeros', 'A menos que sea tu compadre. Roba un auto para hacer taxi.'); return; }
    if (this.taxi) { this.endTaxi(false, 'Dejaste de trabajar de taxista.'); return; }
    if (this.inCar.hp <= 0) return;
    const f = this.inCar;
    let spot = null;
    for (let i = 0; i < 30 && !spot; i++) {
      const e = randomEdgeNear(walkG, f.x, f.y, 250, 650); if (!e || e.c > 6) continue;
      const q = edgePos(e, rnd(0, e.len), 1, e.w / 2 + 1.5 * M, {});
      if (!blocked(q.x, q.y)) spot = q;
    }
    if (!spot) { toast('No hay pasaje por aquí', 'Intenta en otra calle.'); return; }
    const ped = this.add.sprite(spot.x, spot.y, 'ped0', 0).setDepth(6).setScale(1 / SPR);
    this.taxi = { phase: 'pick', x: spot.x, y: spot.y, ped };
    toast('Taxi libre', 'Recoge al pasajero marcado en verde.', 2.5);
    this.setObjective();
  }
  endTaxi(ok, msg) {
    if (this.taxi && this.taxi.ped && this.taxi.phase === 'pick') this.taxi.ped.destroy();
    this.taxi = null; hud.timer.style.display = 'none';
    if (ok) { state.rides++; save(); }
    toast(ok ? '¡Viaje completado!' : 'Viaje cancelado', msg + (ok ? ' Presiona T para otro.' : ''), 3.5);
    this.setObjective();
  }
  setObjective() {
    let t = '';
    if (this.taxi) t = this.taxi.phase === 'pick' ? 'Taxi: recoge al pasajero' : 'Taxi: lleva al pasajero a ' + this.taxi.name;
    else if (this.delivery) t = 'Entrega: ' + this.delivery.order + ' en ' + this.delivery.street;
    else if (this.waypoint && this.waypoint.fiesta) t = '🎉 Ve a la fiesta en la Plaza Santa Cecilia';
    else if (this.waypoint) t = '📍 Sigue la ruta verde a tu destino';
    hud.obj.textContent = t; // vacio = no se muestra (las instrucciones estan en Opciones)
    $('bE').textContent = this.inCar ? 'BAJAR' : 'SUBIR'; // el boton tactil dice lo que va a hacer
  }
  goal() {
    if (this.taxi) return this.taxi;
    if (this.delivery) return this.delivery;
    if (this.waypoint) return this.waypoint;
    return null;
  }

  // camino al objetivo: puntos verdes tenues sobre las calles que avanzan hacia el destino
  updateRoute(time, dt, f) {
    const g = this.goal(), gr = this.routeG;
    gr.clear();
    if (!g || dist(g.x, g.y, f.x, f.y) < 40) { this.route = null; return; }
    // se recalcula seguido (te sales del camino, el pasajero ya subio...) pero no en cada cuadro
    this.routeT -= dt;
    if (this.routeT <= 0 || !this.route || this.routeGoal !== g || this.routeGX !== g.x || this.routeGY !== g.y) {
      this.routeT = 0.5; this.routeGoal = g; this.routeGX = g.x; this.routeGY = g.y;
      this.route = findRoute(f.x, f.y, g.x, g.y);
    }
    const r = this.route; if (!r) return;
    const v = this.cameras.main.worldView, SP = 14, M0 = 20;
    gr.fillStyle(0x57d16b, 0.32);
    // los puntos se recorren hacia el destino; los primeros pixeles se saltan para no tapar al jugador
    let d = 18 + (time / 1000 * 22) % SP, acc = 0;
    for (let i = 0; i < r.length - 2; i += 2) {
      const x0 = r[i], y0 = r[i + 1], dx = r[i + 2] - x0, dy = r[i + 3] - y0, l = Math.hypot(dx, dy);
      for (; d < acc + l; d += SP) {
        const t = (d - acc) / l, x = x0 + dx * t, y = y0 + dy * t;
        if (x > v.x - M0 && x < v.right + M0 && y > v.y - M0 && y < v.bottom + M0) gr.fillCircle(x, y, 2.2);
      }
      acc += l;
    }
  }

  updateMarkers(time, f) {
    const pulse = 0.75 + Math.sin(time / 250) * 0.15;
    for (const m of this.marks) {
      const near = dist(m.l.x, m.l.y, f.x, f.y) < 700;
      m.ring.setVisible(!m.l.found).setScale(pulse * 3.4 / SPR);
      if (m.found !== m.l.found) { m.found = m.l.found; if (m.l.found) m.star.setTint(0x9a9a9a).setAlpha(0.85); else m.star.clearTint().setAlpha(1); }
      m.label.setVisible(near);
    }
    for (const t of tacos) { t.icon.setAlpha(t.eaten ? 0.7 : 1); t.label.setVisible(!t.eaten && dist(t.x, t.y, f.x, f.y) < 300); }
    for (const c of cafes) { c.icon.setAlpha(c.drunk ? 0.7 : 1); c.label.setVisible(!c.drunk && dist(c.x, c.y, f.x, f.y) < 300); }
    for (const c of chinas) c.label.setVisible(dist(c.x, c.y, f.x, f.y) < 300);
    const g = this.goal();
    this.target.setVisible(!!g);
    if (g) this.target.setPosition(g.x, g.y).setScale(pulse * (this.taxi && this.taxi.phase === 'pick' ? 1.3 : 2) / SPR);
    if (this.waypoint && !this.waypoint.fiesta && dist(this.waypoint.x, this.waypoint.y, f.x, f.y) < 60) { this.waypoint = null; toast('Llegaste a tu destino', '', 1.5); }
  }

  updateHud(dt, f) {
    if (toastT > 0) { toastT -= dt; if (toastT <= 0) hud.toast.classList.remove('on'); }
    this.nameT -= dt;
    if (this.nameT <= 0) {
      this.nameT = 0.4;
      const n = streetAt(f.x, f.y);
      if (n && n !== lastStreet) { lastStreet = n; hud.street.innerHTML = ''; hud.street.textContent = n; const sm = document.createElement('small'); sm.textContent = 'Zona Centro · Tijuana'; hud.street.appendChild(sm); layoutTop(); hud.street.classList.add('on'); streetT = 3; }
    }
    if (streetT > 0) { streetT -= dt; if (streetT <= 0) hud.street.classList.remove('on'); }
    const tt = this.taxi && this.taxi.phase === 'drop' ? Math.ceil(this.taxi.time) + 's' : this.delivery ? '🛵 ' + Math.ceil(this.delivery.time) + 's' : null;
    if (tt && tt !== this.lastTimer) { this.lastTimer = tt; if (hud.timer.style.display !== 'block') layoutTop(); hud.timer.style.display = 'block'; hud.timer.textContent = tt; }
    if (!tt) this.lastTimer = null;
    // flecha hacia el objetivo
    const g = this.goal(), cam = this.cameras.main;
    if (g && dist(g.x, g.y, f.x, f.y) > 160) {
      const a = Math.atan2(g.y - f.y, g.x - f.x), r = Math.min(window.innerWidth, window.innerHeight) * 0.36;
      hud.arrow.style.display = 'block';
      hud.arrow.style.left = (window.innerWidth / 2 + Math.cos(a) * r - 14) + 'px';
      hud.arrow.style.top = (window.innerHeight / 2 + Math.sin(a) * r - 15) + 'px';
      hud.arrow.style.transform = 'rotate(' + (a + Math.PI / 2) + 'rad)';
    } else hud.arrow.style.display = 'none';
    // el minimapa a 30 cuadros por segundo basta
    this.miniT = !this.miniT; if (this.miniT) drawMini(this, f);
  }
}

// ---------- minimapa en pantalla ----------
function drawMarkers(c, sx, sy, ox, oy, scene, f, big) {
  const P = (x, y) => [(x - ox) * sx, (y - oy) * sy];
  c.textAlign = 'center'; c.textBaseline = 'middle';
  for (const t of tacos) if (!t.eaten) { const [x, y] = P(t.x, t.y); c.fillStyle = '#ff9f1c'; c.beginPath(); c.arc(x, y, big ? 4 : 2.5, 0, 7); c.fill(); }
  for (const k of cafes) if (!k.drunk) { const [x, y] = P(k.x, k.y); c.fillStyle = '#a0662f'; c.strokeStyle = '#f3e1c8'; c.lineWidth = 1; c.beginPath(); c.arc(x, y, big ? 4 : 2.5, 0, 7); c.fill(); c.stroke(); }
  for (const k of chinas) { const [x, y] = P(k.x, k.y); c.fillStyle = '#e53935'; c.fillRect(x - (big ? 4 : 2.5), y - (big ? 4 : 2.5), big ? 8 : 5, big ? 8 : 5); }
  for (const l of landmarks) {
    const [x, y] = P(l.x, l.y);
    c.font = (big ? 22 : 15) + 'px sans-serif'; c.lineWidth = 3; c.strokeStyle = '#000'; c.strokeText('★', x, y);
    c.fillStyle = l.found ? '#aaa' : '#ffd23f'; c.fillText('★', x, y);
    if (big) { c.font = 'bold 12px sans-serif'; c.strokeText(l.name, x, y - 16); c.fillStyle = '#fff'; c.fillText(l.name, x, y - 16); }
  }
  const g = scene.goal();
  if (g) { const [x, y] = P(g.x, g.y); c.fillStyle = '#57d16b'; c.strokeStyle = '#000'; c.lineWidth = 2; c.beginPath(); c.arc(x, y, big ? 8 : 5, 0, 7); c.fill(); c.stroke(); }
  const [px, py] = P(f.x, f.y);
  c.save(); c.translate(px, py); c.rotate(f.a); c.fillStyle = '#fff'; c.strokeStyle = '#000'; c.lineWidth = 2;
  const k = big ? 1.6 : 1; c.beginPath(); c.moveTo(8 * k, 0); c.lineTo(-5 * k, 5 * k); c.lineTo(-2 * k, 0); c.lineTo(-5 * k, -5 * k); c.closePath(); c.fill(); c.stroke(); c.restore();
}
function drawMini(scene, f) {
  const cv = hud.mini, c = cv.getContext('2d'), W = cv.width, H = cv.height;
  const ox = f.x - W / 2 / MS, oy = f.y - H / 2 / MS;
  c.fillStyle = '#222'; c.fillRect(0, 0, W, H);
  // solo el pedazo visible del mapa completo
  const sx = Math.max(0, -ox * -MS), sy = Math.max(0, oy * MS), sw = Math.min(W, miniFull.width - sx), sh = Math.min(H, miniFull.height - sy);
  if (sw > 0 && sh > 0) c.drawImage(miniFull, sx, sy, sw, sh, sx - ox * MS, sy - oy * MS, sw, sh);
  drawMarkers(c, MS, MS, ox, oy, scene, f, false);
}
// ---------- mapa grande: pantalla completa, se arrastra, se acerca y se marca el destino ----------
// La vista es un centro (cx, cy) en el mundo y una escala s (puntos de pantalla por pixel del mundo).
// De lejos se dibuja miniFull (todo el mapa, chico); de cerca se dibujan calles, edificios y nombres solo de lo
// que se ve. Mientras arrastras o pellizcas va la version rapida y al soltar se pinta el detalle.
let bigOpen = false, bigScene = null;
const BM = { cx: 0, cy: 0, s: 0.3, W: 0, H: 0, dpr: 1, pts: new Map(), gesture: null, detailT: 0, raf: 0 };
const BM_DETAIL = 0.16, BM_NAMES = 0.3, BM_ICONS = 0.22, BM_MAX = 1.4;
const bmMin = () => Math.min(BM.W / WORLD_W, BM.H / WORLD_H) * 0.95;
function bmClamp() {
  BM.s = Math.max(bmMin(), Math.min(BM_MAX, BM.s));
  const hw = BM.W / 2 / BM.s, hh = BM.H / 2 / BM.s;
  BM.cx = hw * 2 >= WORLD_W ? WORLD_W / 2 : Math.max(hw, Math.min(WORLD_W - hw, BM.cx));
  BM.cy = hh * 2 >= WORLD_H ? WORLD_H / 2 : Math.max(hh, Math.min(WORLD_H - hh, BM.cy));
}
const bmX = (x) => (x - BM.cx) * BM.s + BM.W / 2, bmY = (y) => (y - BM.cy) * BM.s + BM.H / 2;
function bmResize() {
  const cv = $('bigc'); BM.W = window.innerWidth; BM.H = window.innerHeight; BM.dpr = Math.min(window.devicePixelRatio || 1, 2);
  cv.width = Math.round(BM.W * BM.dpr); cv.height = Math.round(BM.H * BM.dpr);
}
// pinta en el siguiente cuadro; el detalle espera a que dejes de mover el mapa
function bmDraw(detail) {
  cancelAnimationFrame(BM.raf); clearTimeout(BM.detailT);
  BM.raf = requestAnimationFrame(() => renderBig(detail));
  if (!detail) BM.detailT = setTimeout(() => bmDraw(true), 140);
}
function renderBig(detail) {
  if (!bigOpen || !bigScene) return;
  const c = $('bigc').getContext('2d'), s = BM.s, f = bigScene.focus();
  c.setTransform(BM.dpr, 0, 0, BM.dpr, 0, 0);
  c.lineJoin = 'round'; // si no, el contorno de las letras como la M deja picos negros
  c.fillStyle = '#4d493e'; c.fillRect(0, 0, BM.W, BM.H);
  c.drawImage(miniFull, bmX(0), bmY(0), WORLD_W * s, WORLD_H * s);
  // --- detalle de lo que se ve (al soltar y ya de cerca) ---
  if (detail && s >= BM_DETAIL) {
    const x0 = BM.cx - BM.W / 2 / s, y0 = BM.cy - BM.H / 2 / s, x1 = BM.cx + BM.W / 2 / s, y1 = BM.cy + BM.H / 2 / s;
    const A = new Set(), B = new Set(), R = new Set();
    for (let cx = Math.floor(x0 / CHUNK); cx <= Math.floor(x1 / CHUNK); cx++) for (let cy = Math.floor(y0 / CHUNK); cy <= Math.floor(y1 / CHUNK); cy++) {
      const k = cx + ',' + cy;
      (chunkAreas.get(k) || []).forEach(i => A.add(i)); (chunkBlds.get(k) || []).forEach(i => B.add(i)); (chunkRoads.get(k) || []).forEach(i => R.add(i));
    }
    c.save(); c.setTransform(BM.dpr * s, 0, 0, BM.dpr * s, BM.dpr * (BM.W / 2 - BM.cx * s), BM.dpr * (BM.H / 2 - BM.cy * s));
    c.fillStyle = '#6d6858'; c.fillRect(x0, y0, x1 - x0, y1 - y0);
    for (const i of A) { const a = areas[i]; c.fillStyle = AREA_COL[a.k]; trace(c, a.p, true); c.fill(); }
    c.fillStyle = '#9a917e'; c.strokeStyle = 'rgba(0,0,0,0.25)'; c.lineWidth = 1 / s;
    for (const i of B) { trace(c, blds[i].p, true); c.fill(); if (s > 0.45) c.stroke(); }
    c.lineCap = 'round'; c.lineJoin = 'round';
    const rs = [...R].map(i => roads[i]).sort((a, b) => b.c - a.c); // las grandes encima
    for (const r of rs) {
      if (r.c > 9) { if (r.c === 11) { c.strokeStyle = COL.water; c.lineWidth = ROAD_W[11] * M; trace(c, r.p); c.stroke(); } continue; }
      c.strokeStyle = r.c <= 2 ? '#f2d16b' : r.c <= 6 ? '#2e2e33' : r.c === 7 ? '#55555a' : '#c8bda4';
      c.lineWidth = Math.max(ROAD_W[r.c] * M, (r.c <= 2 ? 5 : r.c <= 6 ? 3.5 : 2) / s); trace(c, r.p); c.stroke();
    }
    c.fillStyle = 'rgba(30,36,30,0.85)';
    c.beginPath(); c.moveTo(x0, 0); c.lineTo(x1, 0); c.lineTo(x1, borderY(x1)); c.lineTo(x0, borderY(x0)); c.closePath(); c.fill();
    c.restore();
    // nombres de calles: uno por nombre, en el tramo visible mas largo, sin encimarse
    if (s >= BM_NAMES) {
      const best = new Map();
      for (const r of rs) {
        if (r.n < 0 || r.c > 6) continue;
        const p = r.p;
        for (let q = 0; q < p.length - 2; q += 2) {
          const ax = bmX(p[q]), ay = bmY(p[q + 1]), bx = bmX(p[q + 2]), by = bmY(p[q + 3]), L = Math.hypot(bx - ax, by - ay);
          if (L < 60 || Math.min(ax, bx) < 10 || Math.max(ax, bx) > BM.W - 10 || Math.min(ay, by) < 10 || Math.max(ay, by) > BM.H - 10) continue;
          const nm = D.names[r.n], o = best.get(nm);
          if (!o || L > o.L) best.set(nm, { L, x: (ax + bx) / 2, y: (ay + by) / 2, a: Math.atan2(by - ay, bx - ax), major: r.c <= 3 });
        }
      }
      const placed = [];
      c.textAlign = 'center'; c.textBaseline = 'middle';
      for (const [nm, o] of [...best].sort((a, b) => (b[1].major - a[1].major) || (b[1].L - a[1].L))) {
        c.font = 'bold ' + (o.major ? 12 : 11) + 'px sans-serif';
        const w = Math.min(c.measureText(nm).width, o.L - 6), box = [o.x - w / 2 - 4, o.y - w / 2 - 4, o.x + w / 2 + 4, o.y + w / 2 + 4];
        if (w < c.measureText(nm).width * 0.98 || placed.some(b => b[0] < box[2] && b[2] > box[0] && b[1] < box[3] && b[3] > box[1])) continue;
        placed.push(box);
        let a = o.a; if (a > Math.PI / 2) a -= Math.PI; if (a < -Math.PI / 2) a += Math.PI;
        c.save(); c.translate(o.x, o.y); c.rotate(a);
        c.lineJoin = 'round'; c.lineWidth = 3; c.strokeStyle = 'rgba(0,0,0,0.75)'; c.strokeText(nm, 0, 0); c.fillStyle = o.major ? '#fff3c4' : '#f2f2f2'; c.fillText(nm, 0, 0);
        c.restore();
      }
    }
  }
  // --- ruta al destino ---
  const r = bigScene.route, g = bigScene.goal();
  if (g && r) {
    c.save(); c.strokeStyle = 'rgba(87,209,107,0.95)'; c.lineWidth = 4; c.setLineDash([8, 6]); c.lineCap = 'round';
    c.beginPath(); for (let i = 0; i < r.length; i += 2) { const X = bmX(r[i]), Y = bmY(r[i + 1]); if (i) c.lineTo(X, Y); else c.moveTo(X, Y); } c.stroke(); c.restore();
  }
  // --- lugares, tacos, cafes y comida china ---
  const icons = s >= BM_ICONS, on = (X, Y) => X > -30 && X < BM.W + 30 && Y > -30 && Y < BM.H + 30;
  c.textAlign = 'center'; c.textBaseline = 'middle';
  const emoji = (e, X, Y, done) => { c.globalAlpha = done ? 0.35 : 1; c.font = (icons ? 15 : 10) + 'px sans-serif'; c.fillText(e, X, Y); c.globalAlpha = 1; };
  // la comida china es un farolito rojo dibujado (el emoji 🏮 no sale en color en todos los lienzos)
  const farol = (X, Y, k) => { c.fillStyle = '#c62828'; c.beginPath(); c.ellipse(X, Y, 5 * k, 6 * k, 0, 0, 7); c.fill(); c.fillStyle = '#ffd23f';
    c.fillRect(X - 3 * k, Y - 7 * k, 6 * k, 2 * k); c.fillRect(X - 3 * k, Y + 5 * k, 6 * k, 2 * k); c.strokeStyle = 'rgba(0,0,0,0.5)'; c.lineWidth = 1; c.beginPath(); c.moveTo(X, Y - 6 * k); c.lineTo(X, Y + 6 * k); c.stroke(); };
  for (const k of chinas) { const X = bmX(k.x), Y = bmY(k.y); if (on(X, Y)) farol(X, Y, icons ? 1.1 : 0.6); }
  for (const t of tacos) { const X = bmX(t.x), Y = bmY(t.y); if (on(X, Y)) { if (icons) emoji('🌮', X, Y, t.eaten); else if (!t.eaten) { c.fillStyle = '#ff9f1c'; c.beginPath(); c.arc(X, Y, 3, 0, 7); c.fill(); } } }
  for (const k of cafes) { const X = bmX(k.x), Y = bmY(k.y); if (on(X, Y)) { if (icons) emoji('☕', X, Y, k.drunk); else if (!k.drunk) { c.fillStyle = '#a0662f'; c.beginPath(); c.arc(X, Y, 3, 0, 7); c.fill(); } } }
  const lsz = icons ? 30 : 20;
  for (const l of landmarks) {
    const X = bmX(l.x), Y = bmY(l.y); if (!on(X, Y)) continue;
    const img = bigScene.textures.exists(l.icon) && bigScene.textures.get(l.icon).getSourceImage();
    c.save(); if (l.found) { c.globalAlpha = 0.6; c.filter = 'grayscale(1)'; }
    if (img) c.drawImage(img, X - lsz / 2, Y - lsz / 2, lsz, lsz); else { c.font = '18px sans-serif'; c.fillStyle = '#ffd23f'; c.fillText('★', X, Y); }
    c.restore();
    if (s >= 0.12) { c.font = 'bold 12px sans-serif'; c.lineWidth = 3; c.strokeStyle = '#000'; c.strokeText(l.name, X, Y + lsz / 2 + 9); c.fillStyle = l.found ? '#bbb' : '#fff'; c.fillText(l.name, X, Y + lsz / 2 + 9); }
  }
  // --- destino y tu posicion ---
  if (g) { const X = bmX(g.x), Y = bmY(g.y); c.fillStyle = '#57d16b'; c.strokeStyle = '#000'; c.lineWidth = 2; c.beginPath(); c.arc(X, Y, 8, 0, 7); c.fill(); c.stroke(); c.fillStyle = '#fff'; c.beginPath(); c.arc(X, Y, 3, 0, 7); c.fill(); }
  const PX = bmX(f.x), PY = bmY(f.y);
  c.save(); c.translate(PX, PY); c.rotate(f.a); c.fillStyle = '#ffd23f'; c.strokeStyle = '#000'; c.lineWidth = 2;
  c.beginPath(); c.moveTo(13, 0); c.lineTo(-8, 8); c.lineTo(-3, 0); c.lineTo(-8, -8); c.closePath(); c.fill(); c.stroke(); c.restore();
  // leyenda con lo que llevas
  $('mlegend').textContent = `📍 Tú · ★ ${landmarks.filter(l => l.found).length}/${landmarks.length} · 🌮 ${tacos.filter(t => t.eaten).length}/${tacos.length} · ☕ ${cafes.filter(k => k.drunk).length}/${cafes.length} · 🏮 cuidado`;
}
function bmZoomAt(factor, sx, sy) {
  const wx = BM.cx + (sx - BM.W / 2) / BM.s, wy = BM.cy + (sy - BM.H / 2) / BM.s;
  BM.s *= factor; bmClamp();
  BM.cx = wx - (sx - BM.W / 2) / BM.s; BM.cy = wy - (sy - BM.H / 2) / BM.s; bmClamp();
  bmDraw(false);
}
function bmCenterMe() { const f = bigScene.focus(); BM.cx = f.x; BM.cy = f.y; bmClamp(); bmDraw(false); }
function setupBigMap(scene) {
  bigScene = scene;
  const cv = $('bigc');
  // el mapa grande se abre tocando (o con clic en) el minimapa
  $('mini').addEventListener('click', () => { if (!bigOpen) toggleBigMap(); });
  // arrastrar con un dedo (o el raton), pellizcar con dos; un toque sin moverse marca el destino
  cv.addEventListener('pointerdown', (ev) => {
    cv.setPointerCapture(ev.pointerId); BM.pts.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
    if (BM.pts.size === 1) BM.gesture = { tap: true, x0: ev.clientX, y0: ev.clientY, t0: performance.now() };
    else { BM.gesture.tap = false; const [a, b] = [...BM.pts.values()]; BM.gesture.d0 = Math.hypot(a.x - b.x, a.y - b.y); BM.gesture.s0 = BM.s; }
  });
  cv.addEventListener('pointermove', (ev) => {
    const p = BM.pts.get(ev.pointerId); if (!p) return;
    const g = BM.gesture, dx = ev.clientX - p.x, dy = ev.clientY - p.y;
    p.x = ev.clientX; p.y = ev.clientY;
    if (BM.pts.size === 1) {
      if (Math.hypot(ev.clientX - g.x0, ev.clientY - g.y0) > 8) g.tap = false;
      if (!g.tap) { BM.cx -= dx / BM.s; BM.cy -= dy / BM.s; bmClamp(); bmDraw(false); }
    } else if (BM.pts.size === 2) {
      const [a, b] = [...BM.pts.values()], d = Math.hypot(a.x - b.x, a.y - b.y);
      bmZoomAt(g.s0 * d / g.d0 / BM.s, (a.x + b.x) / 2, (a.y + b.y) / 2);
    }
  });
  const up = (ev) => {
    if (!BM.pts.has(ev.pointerId)) return;
    BM.pts.delete(ev.pointerId);
    const g = BM.gesture;
    if (BM.pts.size === 0 && g && g.tap && performance.now() - g.t0 < 500) {
      const x = BM.cx + (ev.clientX - BM.W / 2) / BM.s, y = BM.cy + (ev.clientY - BM.H / 2) / BM.s;
      if (x > 0 && y > 0 && x < WORLD_W && y < WORLD_H) {
        const f = scene.focus();
        scene.waypoint = { x, y }; scene.route = findRoute(f.x, f.y, x, y); scene.routeGoal = scene.waypoint; scene.routeGX = x; scene.routeGY = y; scene.routeT = 0.5;
        scene.setObjective(); toast('Destino marcado', 'Sigue la ruta verde. Cierra el mapa con ✕ o M.', 2.5); bmDraw(true);
      }
    }
  };
  cv.addEventListener('pointerup', up); cv.addEventListener('pointercancel', up);
  cv.addEventListener('wheel', (ev) => { ev.preventDefault(); bmZoomAt(ev.deltaY < 0 ? 1.18 : 1 / 1.18, ev.clientX, ev.clientY); }, { passive: false });
  $('mzin').addEventListener('click', () => bmZoomAt(1.5, BM.W / 2, BM.H / 2));
  $('mzout').addEventListener('click', () => bmZoomAt(1 / 1.5, BM.W / 2, BM.H / 2));
  $('mzme').addEventListener('click', bmCenterMe);
  $('mzclose').addEventListener('click', toggleBigMap);
  window.addEventListener('resize', () => { if (bigOpen) { bmResize(); bmClamp(); bmDraw(true); } });
}
function toggleBigMap() {
  bigOpen = !bigOpen;
  $('bigmap').style.display = bigOpen ? 'block' : 'none';
  dormir();
  if (bigOpen) {
    // se abre centrado en ti, viendo unos 2600 px del mundo a lo ancho (varias cuadras, con nombres de calles)
    bmResize(); BM.s = BM.W / 2600; const f = bigScene.focus(); BM.cx = f.x; BM.cy = f.y; bmClamp(); bmDraw(true);
  }
}

// ---------- controles ----------
const touch = { x: 0, y: 0, active: false, brake: false, rev: false, pressed: {} };
function readControls(k) {
  if (touch.active) return { x: touch.x, y: touch.y, stick: true, brake: touch.brake, rev: touch.rev, run: Math.hypot(touch.x, touch.y) > 0.85 };
  const L = k.LEFT.isDown || k.A.isDown, R = k.RIGHT.isDown || k.D.isDown, U = k.UP.isDown || k.W.isDown, Dn = k.DOWN.isDown || k.S.isDown;
  return { x: (R ? 1 : 0) - (L ? 1 : 0), y: (Dn ? 1 : 0) - (U ? 1 : 0), up: U, down: Dn, rev: k.R.isDown, brake: k.SPACE.isDown || touch.brake, run: k.SHIFT.isDown };
}
function setupTouch() {
  const coarse = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
  if (!coarse) return;
  document.body.classList.add('touch');
  const stick = $('stick'), knob = $('knob');
  let id = null;
  const move = (e) => {
    const r = stick.getBoundingClientRect(), cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    let dx = (e.clientX - cx) / (r.width / 2), dy = (e.clientY - cy) / (r.height / 2);
    const m = Math.hypot(dx, dy); if (m > 1) { dx /= m; dy /= m; }
    touch.x = dx; touch.y = dy; touch.active = true;
    knob.style.left = (40 + dx * 40) + 'px'; knob.style.top = (40 + dy * 40) + 'px';
  };
  stick.addEventListener('pointerdown', (e) => { id = e.pointerId; stick.setPointerCapture(id); move(e); });
  stick.addEventListener('pointermove', (e) => { if (e.pointerId === id) move(e); });
  const up = (e) => { if (e.pointerId !== id) return; id = null; touch.x = touch.y = 0; knob.style.left = knob.style.top = '40px'; };
  stick.addEventListener('pointerup', up); stick.addEventListener('pointercancel', up);
  touch.active = true;
  const btn = (el, key) => $(el).addEventListener('pointerdown', (e) => { e.preventDefault(); touch.pressed[key] = true; });
  btn('bE', 'E'); btn('bT', 'T');
  const bB = $('bB');
  bB.addEventListener('pointerdown', () => { touch.brake = true; });
  bB.addEventListener('pointerup', () => { touch.brake = false; });
  bB.addEventListener('pointercancel', () => { touch.brake = false; });
  const bR = $('bR');
  bR.addEventListener('pointerdown', (e) => { e.preventDefault(); touch.rev = true; });
  for (const ev of ['pointerup', 'pointercancel', 'pointerleave']) bR.addEventListener(ev, () => { touch.rev = false; });
}

// ---------- arranque ----------
// ---------- Acta de Tijuanense (premio por completar todo) ----------
// Un certificado dibujado en un lienzo de 1600 x 1100 con tus numeros; se descarga (web) o se comparte (Android)
function drawActa() {
  const cv = $('actac'), x = cv.getContext('2d'), W = cv.width, H = cv.height, sc = window.TJGTA && TJGTA.scene.scenes[0];
  const name = (state.name || '').trim() || 'Tijuanense de corazón';
  // papel y marco
  const bg = x.createRadialGradient(W / 2, H / 2, 100, W / 2, H / 2, W * 0.7); bg.addColorStop(0, '#fbf3df'); bg.addColorStop(1, '#ead9b2');
  x.fillStyle = bg; x.fillRect(0, 0, W, H);
  x.strokeStyle = '#7a5a2a'; x.lineWidth = 10; x.strokeRect(30, 30, W - 60, H - 60);
  x.strokeStyle = '#b8954f'; x.lineWidth = 3; x.strokeRect(48, 48, W - 96, H - 96);
  // papel picado colgando arriba
  const cols = ['#e91e63', '#ff9800', '#4caf50', '#2196f3', '#9c27b0', '#ffeb3b', '#f44336'];
  x.strokeStyle = '#5d4037'; x.lineWidth = 2; x.beginPath(); x.moveTo(60, 70); x.quadraticCurveTo(W / 2, 100, W - 60, 70); x.stroke();
  for (let i = 0; i < 13; i++) {
    const px = 70 + i * ((W - 220) / 12), t = (px + 40 - 60) / (W - 120), py = 70 + 4 * 30 * t * (1 - t);
    x.fillStyle = cols[i % cols.length]; x.beginPath(); x.moveTo(px, py); x.lineTo(px + 80, py); x.lineTo(px + 80, py + 70);
    for (let k = 0; k < 5; k++) x.lineTo(px + 80 - k * 16 - 8, py + (k % 2 ? 70 : 60));
    x.lineTo(px, py + 70); x.closePath(); x.fill();
    x.save(); x.globalCompositeOperation = 'destination-out'; x.beginPath(); x.arc(px + 40, py + 32, 12, 0, 7); x.fill();
    for (const [dx, dy] of [[-22, 18], [22, 18], [-22, 48], [22, 48]]) { x.beginPath(); x.arc(px + 40 + dx, py + dy, 5, 0, 7); x.fill(); }
    x.restore();
  }
  // vuelve a pintar el papel donde el papel picado hizo agujeros (destination-out tambien borra el fondo)
  x.save(); x.globalCompositeOperation = 'destination-over'; x.fillStyle = bg; x.fillRect(0, 0, W, H); x.restore();
  const txt = (s, y, font, c, al = 'center', xx = W / 2) => { x.font = font; x.fillStyle = c; x.textAlign = al; x.textBaseline = 'alphabetic'; x.fillText(s, xx, y); };
  txt('ACTA DE TIJUANENSE', 250, 'bold 92px Georgia, serif', '#7b1f2b');
  txt('ZONA CENTRO · ZONA RÍO · TIJUANA, BAJA CALIFORNIA', 300, 'bold 26px sans-serif', '#7a5a2a');
  txt('Se hace constar que', 380, 'italic 36px Georgia, serif', '#3b2a17');
  txt(name, 470, 'bold 76px Georgia, serif', '#1a237e');
  x.strokeStyle = '#7a5a2a'; x.lineWidth = 2; x.beginPath(); x.moveTo(380, 492); x.lineTo(W - 380, 492); x.stroke();
  txt('conoce los ' + landmarks.length + ' lugares, se comió los ' + tacos.length + ' tacos de la ruta y se tomó los ' + cafes.length + ' cafés.', 560, '32px Georgia, serif', '#3b2a17');
  txt('Por lo tanto, y con todas las de la ley (y del taquero), es oficialmente tijuanense.', 605, 'italic 30px Georgia, serif', '#3b2a17');
  // numeros
  const stats = [['$' + state.money.toLocaleString('es-MX'), 'en la bolsa'], [state.deliveries, 'entregas'], [state.rides, 'viajes de taxi'], [EGGS.filter(e => e.got).length + '/' + EGGS.length, 'secretos']];
  stats.forEach(([v, l], i) => { const cx = 330 + i * 313;
    x.fillStyle = 'rgba(122,90,42,0.12)'; x.beginPath(); x.roundRect(cx - 130, 650, 260, 130, 16); x.fill();
    txt(String(v), 725, 'bold 54px sans-serif', '#2e7d32', 'center', cx); txt(l, 765, '24px sans-serif', '#5d4037', 'center', cx); });
  // frase de la calle
  const fr = pick(FRASES_PEATON).t;
  x.font = 'italic 28px Georgia, serif'; const words = ('"' + fr + '"').split(' '); let line = '', y = 850; const lines = [];
  for (const w of words) { if (x.measureText(line + w).width > 880) { lines.push(line); line = ''; } line += w + ' '; } lines.push(line);
  lines.slice(0, 2).forEach((l, i) => txt(l.trim(), y + i * 38, 'italic 28px Georgia, serif', '#4e342e'));
  txt('— un peatón cualquiera', y + Math.min(2, lines.length) * 38 + 6, '22px sans-serif', '#7a5a2a');
  // fecha y firma
  txt(new Date().toLocaleDateString('es-MX', { day: 'numeric', month: 'long', year: 'numeric' }), 1010, '26px sans-serif', '#3b2a17', 'left', 110);
  x.strokeStyle = '#3b2a17'; x.lineWidth = 2; x.beginPath(); x.moveTo(110, 1020); x.lineTo(470, 1020); x.stroke();
  txt('Fecha de expedición', 1048, '20px sans-serif', '#7a5a2a', 'left', 110);
  // sello rojo con el burro cebra dorado
  const sx = W - 215, sy = 925;
  x.strokeStyle = 'rgba(183,28,28,0.85)'; x.lineWidth = 6; x.beginPath(); x.arc(sx, sy, 110, 0, 7); x.stroke(); x.lineWidth = 2; x.beginPath(); x.arc(sx, sy, 92, 0, 7); x.stroke();
  x.save(); x.translate(sx, sy); x.font = 'bold 22px sans-serif'; x.fillStyle = 'rgba(183,28,28,0.9)'; x.textAlign = 'center';
  const label = 'H. CONSEJO DEL TACO · TJ RUSH · ';
  for (let i = 0; i < label.length; i++) { x.save(); x.rotate(-Math.PI / 2 + i / label.length * Math.PI * 2); x.fillText(label[i], 0, -98); x.restore(); }
  x.restore();
  if (sc && sc.textures.exists('zonkey')) { const im = sc.textures.get('zonkey').getSourceImage(); x.save(); x.translate(sx, sy); x.rotate(-0.5); x.drawImage(im, -75, -75 * im.height / im.width, 150, 150 * im.height / im.width); x.restore(); }
}
function openActa() {
  if (!perks().final) return;
  $('actaname').value = state.name || '';
  drawActa(); $('actabox').style.display = 'flex';
}
$('actaclose').addEventListener('click', () => { $('actabox').style.display = 'none'; });
$('actaname').addEventListener('input', () => { state.name = $('actaname').value; save(); drawActa(); });
// el teclado del juego no debe mover al jugador mientras escribes tu nombre
$('actaname').addEventListener('keydown', (ev) => ev.stopPropagation());
$('actasave').addEventListener('click', async () => {
  const url = $('actac').toDataURL('image/png'), C = window.Capacitor;
  if (C && C.isNativePlatform && C.isNativePlatform() && C.Plugins.Filesystem && C.Plugins.Share) {
    // Android: se guarda en la cache de la app y se abre el menu de compartir del telefono
    try {
      const r = await C.Plugins.Filesystem.writeFile({ path: 'acta-tijuanense.png', data: url.split(',')[1], directory: 'CACHE' });
      await C.Plugins.Share.share({ title: 'Mi Acta de Tijuanense', text: '¡Ya soy tijuanense! #TJRush', files: [r.uri] });
    } catch (e) { if (!/cancel/i.test(String(e && e.message))) toast('No se pudo compartir', String(e && e.message || e), 3); }
  } else {
    const a = document.createElement('a'); a.href = url; a.download = 'acta-tijuanense.png'; document.body.appendChild(a); a.click(); a.remove();
  }
});

// la noche se prende y apaga en Opciones o con la tecla L (solo si ya conoces los 25 lugares)
function toggleNight() {
  if (!perks().noche) return;
  state.night = !state.night; save(); renderOptions();
}
function toggleSound() { if (window.SND) SND.toggle(); renderOptions(); }
// los premios se muestran en Opciones; se llama al ganarlos
function showPerkButtons() { renderOptions(); }

// ---------- menu de opciones: tu avance, ajustes y controles ----------
let optsOpen = false;
function renderOptions() {
  const p = perks(), n = (a, k) => a.filter(o => o[k]).length;
  const rows = [
    ['★ Lugares', n(landmarks, 'found'), landmarks.length, 'Tijuana de noche'],
    ['🌮 Tacos', n(tacos, 'eaten'), tacos.length, 'las taquerías te reparan el carro y una troca de tacos'],
    ['☕ Cafés', n(cafes, 'drunk'), cafes.length, 'correr sin cansarte'],
  ];
  if (EGGS.some(e => e.got)) rows.push(['🥚 Secretos', n(EGGS, 'got'), EGGS.length, '']);
  $('optprog').innerHTML = '';
  for (const [name, v, tot, prize] of rows) {
    const d = document.createElement('div'); d.className = 'prog' + (v >= tot ? ' done' : '');
    d.innerHTML = '<div></div><div class="bar"><i></i></div><small></small>';
    d.firstChild.textContent = name + '  ' + v + '/' + tot; d.querySelector('i').style.width = (v / tot * 100) + '%';
    d.lastChild.textContent = prize ? (v >= tot ? '✓ ' : 'Premio: ') + prize : '';
    $('optprog').appendChild(d);
  }
  const extra = document.createElement('div'); extra.className = 'prog';
  extra.innerHTML = '<small></small>';
  extra.firstChild.textContent = '$' + state.money.toLocaleString('es-MX') + ' · ' + state.deliveries + ' entregas · ' + state.rides + ' viajes de taxi · ' +
    (p.final ? '🏆 ¡Completaste todo!' : 'Completa todo: burro cebra dorado, fiesta y Acta');
  $('optprog').appendChild(extra);
  const muted = window.SND && SND.muted, key = (k) => document.body.classList.contains('touch') ? '' : '  (' + k + ')'; // teclas solo en PC
  $('optsnd').textContent = (muted ? '🔇 Sonido: apagado' : '🔊 Sonido: encendido') + key('N');
  $('optnight').disabled = !p.noche;
  $('optnight').textContent = p.noche ? (state.night ? '☀️ Volver al día' : '🌙 Tijuana de noche') + key('L') : '🔒 Tijuana de noche · conoce los ' + landmarks.length + ' lugares';
  for (const b of document.querySelectorAll('#optcal button')) b.classList.toggle('on', b.dataset.q === CALIDAD);
  $('optfps').textContent = (verFps ? '📈 Ver cuadros por segundo: sí' : '📈 Ver cuadros por segundo: no');
  $('optacta').disabled = !p.final;
  $('optacta').textContent = p.final ? '📜 Ver mi Acta de Tijuanense' : '🔒 Acta de Tijuanense · completa todo';
}
function toggleOptions() {
  const sc = window.TJGTA && TJGTA.scene.scenes[0];
  optsOpen = !optsOpen;
  $('opts').style.display = optsOpen ? 'flex' : 'none';
  if (optsOpen) { renderOptions(); if (window.SND && sc) SND.update(false, 0, 0); }
  // el juego se detiene mientras ves el menu
  if (sc) { if (optsOpen) sc.scene.pause(); else sc.scene.resume(); }
  dormir();
}
// con el menu o el mapa grande abiertos el juego no se dibuja (ahorra bateria); al cerrarlos sigue
function dormir() {
  const g = window.TJGTA; if (!g) return;
  if (optsOpen || bigOpen) g.loop.sleep(); else g.loop.wake();
}
// calidad grafica: se guarda y se recarga el juego con la nueva
for (const b of document.querySelectorAll('#optcal button')) b.addEventListener('click', () => {
  if (b.dataset.q === CALIDAD) return;
  try { localStorage.setItem('tjrush-calidad', b.dataset.q); } catch (e) { /* sin almacenamiento */ }
  save(); location.reload();
});
// contador de cuadros por segundo (para ver si el celular va fluido)
let verFps = false;
try { verFps = localStorage.getItem('tjrush-fps') === '1'; } catch (e) { /* sin almacenamiento */ }
$('optfps').addEventListener('click', () => {
  verFps = !verFps;
  try { localStorage.setItem('tjrush-fps', verFps ? '1' : '0'); } catch (e) { /* sin almacenamiento */ }
  $('fps').style.display = verFps && window.TJGTA ? 'block' : 'none'; renderOptions();
});
setInterval(() => {
  const g = window.TJGTA; if (!verFps || !g || optsOpen || bigOpen) return;
  $('fps').style.display = 'block'; $('fps').textContent = Math.round(g.loop.actualFps) + ' fps';
}, 500);
$('optbtn').addEventListener('click', toggleOptions);
$('optclose').addEventListener('click', toggleOptions);
$('optsnd').addEventListener('click', toggleSound);
$('optnight').addEventListener('click', toggleNight);
$('optacta').addEventListener('click', () => { toggleOptions(); openActa(); });

// ---------- respaldo de la partida: exportar a un archivo e importarlo ----------
function optMsg(t) { $('optmsg').textContent = t; clearTimeout(optMsg.t); optMsg.t = setTimeout(() => { $('optmsg').textContent = ''; }, 5000); }
// El archivo va firmado (HMAC-SHA256) y con los datos revueltos para que no se pueda editar a mano:
// si alguien cambia algo, la firma ya no coincide y no se importa. La clave vive en el codigo, asi que
// esto frena a los curiosos, no a alguien decidido (para eso haria falta un servidor).
const FIRMA_CLAVE = ['tj', 'rush', 'zonkey', 'santa-cecilia', '1889'].join('·');
const enc = new TextEncoder(), dec = new TextDecoder();
async function firmar(texto) {
  const k = await crypto.subtle.importKey('raw', enc.encode(FIRMA_CLAVE), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return [...new Uint8Array(await crypto.subtle.sign('HMAC', k, enc.encode(texto)))].map(v => v.toString(16).padStart(2, '0')).join('');
}
// revuelve con XOR contra la clave y pasa a base64 (y al reves)
function revolver(bytes) { const k = enc.encode(FIRMA_CLAVE); return bytes.map((v, i) => v ^ k[i % k.length] ^ (i * 31 & 255)); }
const aB64 = (bytes) => { let t = ''; for (const v of bytes) t += String.fromCharCode(v); return btoa(t); };
const deB64 = (t) => Uint8Array.from(atob(t), ch => ch.charCodeAt(0));
// que la partida tenga sentido: solo lugares, tacos, cafes y secretos que existen, y premios que corresponden
function partidaValida(p) {
  const subset = (a, valid) => Array.isArray(a) && a.every(x => valid.includes(x)) && new Set(a).size === a.length;
  const num = (v, max) => Number.isInteger(v) && v >= 0 && v <= max;
  if (!p || typeof p !== 'object' || !Number.isFinite(p.money) || Math.abs(p.money) > 1e7) return false;
  if (!subset(p.found, landmarks.map(l => l.name)) || !subset(p.eaten || [], tacos.map(t => t.name)) ||
      !subset(p.cafes || [], cafes.map(c => c.name)) || !subset(p.eggs || [], EGGS.map(e => e.k))) return false;
  if (!num(p.deliveries || 0, 1e5) || !num(p.rides || 0, 1e5) || (p.name != null && (typeof p.name !== 'string' || p.name.length > 32))) return false;
  const lleno = (a, all) => (a || []).length === all.length;
  const ok = { cafe: lleno(p.cafes, cafes), taco: lleno(p.eaten, tacos), noche: lleno(p.found, landmarks) };
  ok.final = ok.cafe && ok.taco && ok.noche;
  const cel = p.celebrated || [];
  if (!subset(cel, ['cafe', 'taco', 'noche', 'final', 'fiesta'])) return false;
  if (cel.some(k => k !== 'fiesta' && !ok[k]) || (cel.includes('fiesta') && !cel.includes('final')) || (p.night && !ok.noche)) return false;
  return true;
}
async function exportarPartida() {
  save();
  const hoy = new Date().toISOString().slice(0, 10), name = 'tjrush-partida-' + hoy + '.json', C = window.Capacitor;
  let data;
  try {
    const datos = aB64(revolver(enc.encode(JSON.stringify(state))));
    data = JSON.stringify({ juego: 'TJ Rush', v: 2, fecha: hoy, datos, firma: await firmar(datos) });
  } catch (e) { optMsg('No se pudo exportar en este navegador.'); return; }
  // en la app: se comparte el archivo (Drive, WhatsApp, correo, Archivos...); en la web se descarga
  if (C && C.Plugins && C.Plugins.Filesystem && C.Plugins.Share) {
    try {
      const r = await C.Plugins.Filesystem.writeFile({ path: name, data, directory: 'CACHE', encoding: 'utf8' });
      await C.Plugins.Share.share({ title: 'Mi partida de TJ Rush', files: [r.uri] });
      optMsg('Guarda el archivo en Drive, Archivos o mándatelo por WhatsApp.');
    } catch (e) { if (!/cancel/i.test(String(e && e.message))) optMsg('No se pudo exportar: ' + (e && e.message)); }
    return;
  }
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([data], { type: 'application/json' }));
  a.download = name; document.body.appendChild(a); a.click(); a.remove();
  optMsg('Se descargó ' + name);
}
async function importarPartida(f) {
  let j = null, p = null;
  try { j = JSON.parse(await f.text()); } catch (e) { /* no es JSON */ }
  if (j && j.juego !== 'TJ Rush' && 'money' in j) { optMsg('Es un respaldo viejo sin firma; ya no se puede importar desde el juego.'); return; }
  if (!j || j.juego !== 'TJ Rush') { optMsg('Ese archivo no es una partida de TJ Rush.'); return; }
  try {
    if (typeof j.datos !== 'string' || j.firma !== await firmar(j.datos)) throw new Error('firma');
    p = JSON.parse(dec.decode(revolver(deB64(j.datos))));
  } catch (e) { optMsg('Este archivo fue modificado o está dañado; no se puede importar.'); return; }
  if (!partidaValida(p)) { optMsg('Esta partida no tiene sentido (¿la editaron?); no se puede importar.'); return; }
  const n = (a) => (Array.isArray(a) ? a.length : 0);
  if (!confirm('¿Cambiar tu partida por la del archivo?\n\n$' + p.money.toLocaleString('es-MX') + ' · ★ ' + n(p.found) + ' lugares · 🌮 ' + n(p.eaten) +
    ' tacos · ☕ ' + n(p.cafes) + ' cafés\n\nLa partida que tienes ahora se pierde (expórtala antes si la quieres).')) return;
  p.t = Date.now();
  const json = JSON.stringify(p);
  try { localStorage.setItem(SAVE_KEY, json); } catch (e) { /* sin almacenamiento */ }
  if (PREFS) await PREFS.set({ key: SAVE_KEY, value: json }).catch(() => {});
  noGuardar = true; location.reload();
}
$('optexport').addEventListener('click', exportarPartida);
$('optimport').addEventListener('click', () => $('optimpfile').click());
$('optimpfile').addEventListener('change', (ev) => { const f = ev.target.files[0]; ev.target.value = ''; if (f) importarPartida(f); });
// version: en la app la del paquete de Android; en la web no hay numero
(() => {
  const A = window.Capacitor && Capacitor.Plugins && Capacitor.Plugins.App;
  $('optver').textContent = 'TJ Rush · versión web';
  if (A) A.getInfo().then(i => { $('optver').textContent = 'TJ Rush ' + i.version + ' (compilación ' + i.build + ')'; }).catch(() => {});
})();
// O o Esc abren y cierran el menu (con el juego en pausa Phaser no lee el teclado, por eso va aqui)
window.addEventListener('keydown', (ev) => {
  if (($('intro').style.display !== 'none' && !optsOpen) || $('actabox').style.display === 'flex' || ev.target.tagName === 'INPUT') return;
  if (ev.key === 'o' || ev.key === 'O' || (ev.key === 'Escape' && optsOpen)) toggleOptions();
});
function start() {
  if (window.TJGTA) return;
  if (optsOpen) toggleOptions();
  $('intro').style.display = 'none';
  if (window.SND) SND.init();
  $('optbtn').style.display = 'block';
  setupTouch();
  showPerkButtons();
  const game = new Phaser.Game({
    type: Phaser.AUTO, parent: 'game', backgroundColor: '#2a2a2a',
    // el lienzo mide DPR veces la ventana y se muestra a 1/DPR (la camara compensa en baseZoom)
    scale: { mode: Phaser.Scale.NONE, width: window.innerWidth * DPR, height: window.innerHeight * DPR, zoom: 1 / DPR },
    scene: [Main], fps: { target: 60, smoothStep: false },
  });
  window.addEventListener('resize', () => game.scale.resize(window.innerWidth * DPR, window.innerHeight * DPR));
  window.TJGTA = game; game.dbg = { VTYPES, vehicleTexture, state, drawChunk, baches, landmarks, tacos, cafes, perks, blocked, inWater, onRoad, waterAreas, roads, PED_VARIANTS };
}
$('go').addEventListener('click', start);

// ---------- portada: continuar, partida nueva y opciones ----------
const hayPartida = () => state.money > 0 || landmarks.some(l => l.found) || tacos.some(t => t.eaten) || cafes.some(c => c.drunk) ||
  EGGS.some(e => e.got) || state.deliveries > 0 || state.rides > 0;
function renderIntro() {
  const n = (a, k) => a.filter(o => o[k]).length, hay = hayPartida();
  $('go').textContent = hay ? '▶ CONTINUAR' : '▶ JUGAR';
  $('reset').style.display = hay ? '' : 'none';
  $('resumen').innerHTML = hay ? '<b>$' + state.money.toLocaleString('es-MX') + '</b> · ★ ' + n(landmarks, 'found') + '/' + landmarks.length +
    ' · 🌮 ' + n(tacos, 'eaten') + '/' + tacos.length + ' · ☕ ' + n(cafes, 'drunk') + '/' + cafes.length : '';
}
// partida nueva: borra dinero, colecciones, premios y contadores (pide tocar dos veces) y entra a jugar
(() => {
  const b = $('reset');
  b.addEventListener('click', () => {
    if (!b.classList.contains('confirm')) { b.classList.add('confirm'); b.textContent = '¿Seguro? Toca otra vez para borrar todo'; return; }
    Object.assign(state, { money: 0, celebrated: [], deliveries: 0, rides: 0, night: false });
    landmarks.forEach(l => { l.found = false; }); tacos.forEach(t => { t.eaten = false; }); cafes.forEach(c => { c.drunk = false; }); EGGS.forEach(e => { e.got = false; });
    save(); updateStats();
    start();
  });
})();
$('introopts').addEventListener('click', toggleOptions);
window.addEventListener('keydown', function onKey(e) {
  if (e.key === 'Enter' && $('intro').style.display !== 'none' && !optsOpen) { window.removeEventListener('keydown', onKey); start(); }
});

// ---------- como app de Android: boton Atras y pausa al salir ----------
const APP = window.Capacitor && Capacitor.Plugins && Capacitor.Plugins.App;
let lastBack = 0;
function aviso(t) {
  const a = $('introaviso'); a.textContent = t;
  clearTimeout(aviso.t); aviso.t = setTimeout(() => { a.textContent = ''; }, 2000);
}
// Atras cierra lo que este abierto (acta, mapa, opciones); jugando abre la pausa; en la portada, dos veces para salir
function onBack() {
  if ($('actabox').style.display === 'flex') { $('actabox').style.display = 'none'; return; }
  if (optsOpen) { toggleOptions(); return; }
  if (bigOpen) { toggleBigMap(); return; }
  if (window.TJGTA) { toggleOptions(); return; }
  if (Date.now() - lastBack < 2000) { save(); APP.exitApp(); return; }
  lastBack = Date.now(); aviso('Toca Atrás otra vez para salir');
}
// al cambiar de app, apagar la pantalla o recibir una llamada: se guarda, se pausa con el menu abierto y se calla
function onHide() {
  save();
  if (window.TJGTA && !optsOpen) toggleOptions();
  if (window.SND) SND.suspend();
}
function onShow() { if (window.SND) SND.resume(); }
document.addEventListener('visibilitychange', () => { if (document.hidden) onHide(); else onShow(); });
if (APP) {
  APP.addListener('backButton', onBack);
  APP.addListener('pause', onHide);
  APP.addListener('resume', onShow);
  // en la app se puede salir desde Opciones (en la web no hace falta)
  $('optexit').style.display = '';
  $('optexit').addEventListener('click', () => { save(); APP.exitApp(); });
}

// la primera vez en la app, la partida pasa tambien al almacen nativo
if (PREFS && hayPartida()) save();
// en celular las Opciones de la portada ya muestran los controles tactiles
if (window.matchMedia && window.matchMedia('(pointer: coarse)').matches) document.body.classList.add('touch');
renderIntro();
$('intro').style.display = 'flex';
$('cargando').remove();
updateStats();
})();
