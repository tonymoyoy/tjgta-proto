// TJGTA: prototipo estilo GTA 2 en la Zona Centro de Tijuana.
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
function blocked(x, y) {
  return x < 4 || y < 4 || x > WORLD_W - 4 || y > WORLD_H - 4 || y < borderY(x) + 6 || (inBuilding(x, y) && !onRoad(x, y));
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

// ---------- detalles de la calle: pasos peatonales y topes ----------
function mulberry(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const crosswalks = [], topes = [], baches = [];
(() => {
  const inc = traffic.nodes.map(() => new Set());
  for (const e of traffic.edges) { inc[e.a].add(e); inc[e.b].add(e); }
  inc.forEach((set, n) => {
    if (set.size < 3) return;
    const es = [...set], maxW = Math.max(...es.map(e => e.w));
    for (const e of es) {
      if (e.c > 5) continue;
      const d = maxW / 2 + 3 * M + 8;
      if (e.len < d + 25) continue;
      const q = edgePos(e, d, e.a === n ? 1 : -1, 0, {});
      crosswalks.push({ x: q.x, y: q.y, a: q.a, w: e.w });
    }
  });
  for (const e of traffic.edges) {
    if (e.c < 4 || e.len < 160 || hash(e.id * 7 + 3) % 3 !== 0) continue;
    const q = edgePos(e, e.len / 2, 1, 0, {});
    topes.push({ x: q.x, y: q.y, a: q.a, w: e.w, bb: [q.x - 40, q.y - 40, q.x + 40, q.y + 40] });
  }
  crosswalks.forEach(c => { c.bb = [c.x - 60, c.y - 60, c.x + 60, c.y + 60]; });
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
const chunkCross = gridIndex(crosswalks, CHUNK, 'bb');
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
  for (const i of chunkCross.get(k) || []) {
    const c = crosswalks[i];
    ctx.save(); ctx.translate(c.x, c.y); ctx.rotate(c.a);
    ctx.fillStyle = 'rgba(205,202,192,0.7)';
    for (let l = -c.w / 2 + 4; l < c.w / 2 - 3; l += 6) ctx.fillRect(-8, l, 16, 3);
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
for (const c of [bRoof, bWall, bWall2, bWin, bStack]) { c.width = CHUNK + 2 + LEAN_PAD; c.height = CHUNK + 2 + EXTRA_UP; }
// cada piso de la pared son 4 capas: linea de entrepiso, dos de ventanas y pared
const wallLayer = (k) => { const m = k % 4; return m === 0 ? bWall2 : m === 3 ? bWall : bWin; };
function drawBuildings(ctx, bl, rs, cx, cy) {
  const g = bRoof.getContext('2d');
  let lo = 0;
  for (const [hmax, L] of LIFTS) {
    const group = bl.filter(b => b.h >= lo && b.h < hmax); lo = hmax;
    if (!group.length) continue;
    // solo se trabaja en el rectangulo que ocupan los edificios del grupo (en pixeles de la capa)
    let rx0 = 1e9, ry0 = 1e9, rx1 = -1e9, ry1 = -1e9;
    for (const b of group) { rx0 = Math.min(rx0, b.bb[0]); ry0 = Math.min(ry0, b.bb[1]); rx1 = Math.max(rx1, b.bb[2]); ry1 = Math.max(ry1, b.bb[3]); }
    rx0 = Math.max(0, Math.floor(rx0 - cx * CHUNK + LEAN_PAD - 3)); rx1 = Math.min(bRoof.width, Math.ceil(rx1 - cx * CHUNK + LEAN_PAD + 4));
    ry0 = Math.max(0, Math.floor(ry0 - cy * CHUNK - 3)); ry1 = Math.min(bRoof.height, Math.ceil(ry1 - cy * CHUNK + 4));
    if (rx1 <= rx0 || ry1 <= ry0) continue;
    const rw = rx1 - rx0, rh = ry1 - ry0;
    const cp = (dst, src, dx, dy) => dst.drawImage(src, rx0, ry0, rw, rh, rx0 + dx, ry0 + dy, rw, rh);
    g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, bRoof.width, bRoof.height);
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
    // apilar la pared L veces: se arman 4 capas y se duplica la pila sobre si misma (4, 8, 16...)
    // en vez de pintar capa por capa; las que sobran se pintan una por una
    const st = bStack.getContext('2d');
    // (el patron se repite cada 4 capas y 4*LEAN es entero, asi que duplicar la pila lo conserva)
    const lx = (k) => Math.round(k * LEAN);
    const top = L - 2, base = Math.min(top, 4);
    st.clearRect(0, Math.max(0, ry0 - L - 1), bStack.width, rh + L + 2); cp(st, bWall2, 0, 0);
    for (let k = 1; k < base; k++) cp(st, wallLayer(k), lx(k), -k);
    // al duplicar, la pila ya mide n capas: se copia el rectangulo crecido hacia arriba
    const cps = (dx, dy, n) => st.drawImage(bStack, rx0, ry0 - n, rw + lx(n), rh + n, rx0 + dx, ry0 - n + dy, rw + lx(n), rh + n);
    let n = base;
    while (n * 2 <= top) { cps(lx(n), -n, n); n *= 2; }
    if (n < top) cps(lx(top - n), n - top, n); // lo que falta: la misma pila corrida (top - n es multiplo de 4)
    cp(st, bWall, lx(top), -top); cp(st, bWall2, lx(top + 1), -top - 1); // cornisa clara arriba
    ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0);
    const sy0 = Math.max(0, ry0 - L - 1), sw = Math.min(bStack.width - rx0, rw + lx(L) + 1);
    ctx.drawImage(bStack, rx0, sy0, sw, ry1 - sy0, rx0 - LEAN_PAD, sy0, sw, ry1 - sy0);
    ctx.drawImage(bRoof, rx0, ry0, rw, rh, rx0 + lx(L) - LEAN_PAD, ry0 - L, rw, rh);
    ctx.restore();
  }
}
function drawChunk(cx, cy) {
  const cv = document.createElement('canvas'); cv.width = cv.height = CHUNK + 2;
  const ctx = cv.getContext('2d');
  ctx.translate(1 - cx * CHUNK, 1 - cy * CHUNK);
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
  over(ground);
  grime(ctx, ground, cx, cy);
  roadMarks(ctx, k);
  if (bridges.length) {
    pass(bridges, r => (ROAD_W[r.c] + 6) * M, 'rgba(0,0,0,0.35)', r => r.c <= 7);
    under(bridges); over(bridges); grime(ctx, bridges, cx, cy);
  }
  drawBuildings(ctx, bl, rs, cx, cy);
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
function save() {
  state.found = landmarks.filter(l => l.found).map(l => l.name);
  state.eaten = tacos.filter(t => t.eaten).map(t => t.name);
  state.cafes = cafes.filter(c => c.drunk).map(c => c.name);
  state.eggs = EGGS.filter(e => e.got).map(e => e.k);
  try { localStorage.setItem(SAVE_KEY, JSON.stringify(state)); } catch (e) { /* sin almacenamiento */ }
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
  'Su perro te recibió primero. El perro firmó.', '"Déjalo en la puerta", dijo el señor desde la puerta.',
  'Te ofreció la mitad de su pedido. Era tuyo de todas formas.', 'Te dio de propina un boleto de la rifa de la parroquia.',
];
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
function toast(title, body, secs) { hud.toast.innerHTML = '<b></b><span></span>'; hud.toast.firstChild.textContent = title; hud.toast.lastChild.textContent = body || ''; hud.toast.style.opacity = 1; toastT = secs || 3.5; }
// sonido de dinero: se compara contra el ultimo saldo mostrado (bigSound = fanfarria en vez de monedas)
let lastMoney = state.money, bigSound = false;
function updateStats() {
  const dm = state.money - lastMoney; lastMoney = state.money;
  if (window.SND) { if (dm > 0) SND.play(bigSound ? 'fanfare' : 'gain', dm); else if (dm < 0) SND.play('loss'); }
  bigSound = false;
  hud.money.textContent = '$' + state.money.toLocaleString('es-MX');
  hud.counts.textContent = `★ Lugares ${landmarks.filter(l => l.found).length}/${landmarks.length} · 🌮 Tacos ${tacos.filter(t => t.eaten).length}/${tacos.length} · ☕ Cafés ${cafes.filter(c => c.drunk).length}/${cafes.length}` +
    (EGGS.some(e => e.got) ? ` · 🥚 Secretos ${EGGS.filter(e => e.got).length}/${EGGS.length}` : '');
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
];
const VT_TAXI = { name: 'Taxi libre', L: 37, W: 16, top: 230, acc: 115, steer: 2.6, hp: 100 };
const VT_MOTO = { name: 'Moto de reparto', L: 19, W: 9.2, top: 210, acc: 150, steer: 3.4, hp: 60 };
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
  const t = scene.textures.createCanvas(key, (L + 5) * 2, (W + 5) * 2), x = t.getContext();
  x.scale(2, 2); x.translate(1, 1);
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

const SHIRTS = ['#d35400', '#2980b9', '#27ae60', '#8e44ad', '#c0392b', '#ecf0f1', '#16a085', '#7f8c8d', '#f39c12', '#2c3e50'];
function makeTextures(scene) {
  makeMoto(scene); makeTaxi(scene); makePolice(scene); makeTacoStands(scene); makeCafes(scene); makeChinas(scene); makeEggs(scene);
  // personas vistas desde arriba, mirando a la derecha; 8 cuadros de caminata (el cuadro 0 es parado).
  // Se dibujan al doble de resolucion y el sprite se muestra a escala 0.5 para que se vean nitidas.
  const PF = PED_FRAME * 2, SKIN = ['#c68e5f', '#a8714a', '#e0b08a', '#8d5a36'], PANTS = ['#2c3e66', '#3b3b3b', '#5a4632', '#1f2a38'];
  SHIRTS.concat(['#ffd23f']).forEach((c, i) => {
    const player = i === SHIRTS.length;
    const t = scene.textures.createCanvas('ped' + i, PF * 8, PF), x = t.getContext();
    const skin = player ? '#c68e5f' : SKIN[i % 4], pants = player ? '#1d3f8f' : PANTS[(i * 3) % 4];
    const hair = player ? '#111' : ['#3b2414', '#111', '#5a3a22', '#2a1a10'][i % 4];
    x.lineCap = 'round';
    for (let f = 0; f < 8; f++) {
      const sw = Math.sin(f / 8 * Math.PI * 2);
      x.save(); x.translate(f * PF + PF / 2, PF / 2); x.scale(2, 2);
      x.fillStyle = 'rgba(0,0,0,0.25)'; x.beginPath(); x.ellipse(1.2, 1.2, 4.5, 6.5, 0, 0, 7); x.fill();
      // piernas con zapatos: una adelante y otra atras
      for (const side of [-1, 1]) {
        const off = sw * 6.5 * side;
        x.strokeStyle = pants; x.lineWidth = 3;
        x.beginPath(); x.moveTo(0, side * 2); x.lineTo(off, side * 2); x.stroke();
        x.fillStyle = '#20160f'; x.beginPath(); x.ellipse(off + 0.8, side * 2, 1.9, 1.4, 0, 0, 7); x.fill();
      }
      // brazos: se mueven al reves que las piernas
      for (const side of [-1, 1]) {
        const off = -sw * 4.5 * side;
        x.strokeStyle = c; x.lineWidth = 2.4;
        x.beginPath(); x.moveTo(0, side * 4.6); x.lineTo(off * 0.7, side * 5.2); x.stroke();
        x.fillStyle = skin; x.beginPath(); x.arc(off, side * 5.3, 1.3, 0, 7); x.fill();
      }
      // torso
      x.fillStyle = c; x.beginPath(); x.ellipse(-0.3, 0, 2.8, 5.2, 0, 0, 7); x.fill();
      x.strokeStyle = 'rgba(0,0,0,0.4)'; x.lineWidth = 0.7; x.stroke();
      // cabeza: cara hacia adelante, pelo atras
      x.fillStyle = skin; x.beginPath(); x.arc(0.9, 0, 2.5, 0, 7); x.fill();
      x.fillStyle = hair; x.beginPath(); x.arc(0.5, 0, 2.6, Math.PI * 0.5, Math.PI * 1.5); x.closePath(); x.fill();
      x.beginPath(); x.ellipse(0.6, 0, 1.2, 2.5, 0, 0, 7); x.fill();
      if (player) { x.fillStyle = '#c0392b'; x.beginPath(); x.arc(0.4, 0, 2.7, Math.PI * 0.55, Math.PI * 1.45); x.closePath(); x.fill(); x.fillRect(0.2, -1.6, 3, 3.2); }
      x.restore();
      t.add(f, 0, f * PF, 0, PF, PF);
    }
    t.refresh();
    scene.anims.create({ key: 'walk' + i, frames: Array.from({ length: 8 }, (_, f) => ({ key: 'ped' + i, frame: f })), frameRate: 9, repeat: -1 });
  });
  const r = scene.textures.createCanvas('ring', 64, 64), x = r.getContext();
  x.strokeStyle = '#fff'; x.lineWidth = 5; x.beginPath(); x.arc(32, 32, 28, 0, 7); x.stroke(); r.refresh();
}
const PLAYER_SHIRT = SHIRTS.length;
// taxi libre clasico de Tijuana: guayin roja con franjas negras y crema.
// Se dibuja al doble de resolucion y el sprite va a escala 0.5.
// moto de repartidor vista desde arriba con su caja termica, a doble resolucion
function makeMoto(scene) {
  const t = scene.textures.createCanvas('moto', 52, 28), x = t.getContext();
  x.scale(2, 2);
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
    const t = scene.textures.createCanvas('poli' + f, (L + 5) * 2, (W + 5) * 2), x = t.getContext();
    x.scale(2, 2); x.translate(1, 1);
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
  const t = scene.textures.createCanvas('taxi', 80, 38), x = t.getContext();
  x.scale(2, 2);
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
// easter eggs vistos desde arriba, 64x64 a 2x (centro en 16,16)
function makeEggs(scene) {
  const ell = (x, c, cx, cy, rx, ry, a) => { x.fillStyle = c; x.beginPath(); x.ellipse(cx, cy, rx, ry, a || 0, 0, 7); x.fill(); };
  const shadow = (x, rx, ry) => ell(x, 'rgba(0,0,0,0.3)', 17.5, 17.5, rx, ry);
  const persona = (x, cx, cy, shirt, skin, hair) => { ell(x, shirt, cx, cy, 4.6, 3.4); ell(x, skin, cx, cy - 0.5, 2.4, 2.4); if (hair) ell(x, hair, cx, cy - 1.2, 2.4, 1.5); };
  const draw = {
    burro(x) { // burro pintado de cebra con su carretita de fotos
      shadow(x, 9, 13);
      x.fillStyle = '#c0392b'; x.fillRect(10, 20, 15, 9); x.fillStyle = '#f1c40f'; x.fillRect(11, 21, 13, 7);
      x.fillStyle = '#8e44ad'; x.fillRect(11, 24, 13, 1.5);
      ell(x, '#f4f1ea', 16, 12, 4.6, 8);
      x.strokeStyle = '#111'; x.lineWidth = 1.1;
      for (let i = 6; i <= 17; i += 2.6) { x.beginPath(); x.moveTo(11.6, i); x.quadraticCurveTo(16, i + 1.4, 20.4, i); x.stroke(); }
      ell(x, '#f4f1ea', 16, 3.2, 2.4, 3.2); ell(x, '#555', 16, 1, 1.6, 1.2);
      ell(x, '#222', 13.6, 4.6, 0.9, 2, -0.4); ell(x, '#222', 18.4, 4.6, 0.9, 2, 0.4);
      x.fillStyle = '#e74c3c'; x.fillRect(12, 9, 8, 1.6);
    },
    cesar(x) { // un tazon gigante de ensalada Cesar
      shadow(x, 12, 12); ell(x, '#e8e2d0', 16, 16, 12, 12); ell(x, '#cfc6ad', 16, 16, 10.5, 10.5);
      for (let i = 0; i < 14; i++) { const a = i * 2.4, r = 2 + (i % 5) * 1.6; ell(x, i % 2 ? '#6ab04c' : '#8bc34a', 16 + Math.cos(a) * r, 16 + Math.sin(a) * r, 3.4, 2, a); }
      for (let i = 0; i < 6; i++) { const a = i * 1.1 + 0.5; x.fillStyle = '#d9a441'; x.fillRect(15 + Math.cos(a) * 6, 15 + Math.sin(a) * 6, 2.2, 2.2); }
      x.fillStyle = '#fff8dc'; for (let i = 0; i < 18; i++) x.fillRect(9 + (i * 7) % 14, 10 + (i * 5) % 12, 1, 1);
    },
    xolo(x) { // xoloitzcuintle: gris, pelon, con su copete
      shadow(x, 6, 12); ell(x, '#4a4f55', 16, 17, 4.4, 8); ell(x, '#4a4f55', 16, 7, 2.8, 3.6);
      ell(x, '#3a3e43', 14, 4.6, 1, 2.4, -0.5); ell(x, '#3a3e43', 18, 4.6, 1, 2.4, 0.5);
      ell(x, '#f5f5f5', 16, 6.6, 1.2, 1.6); x.strokeStyle = '#4a4f55'; x.lineWidth = 1.2;
      x.beginPath(); x.moveTo(16, 24.5); x.quadraticCurveTo(19, 28, 17, 31); x.stroke();
      ell(x, '#c0392b', 16, 11, 3, 0.9);
    },
    batiz(x) { // rockero de pelo largo canoso, lentes oscuros y su guitarra electrica
      shadow(x, 10, 11);
      ell(x, '#c0392b', 22, 21, 4.4, 5.4, 0.5); ell(x, '#111', 22, 21, 1.4, 1.4);
      x.strokeStyle = '#3b2a1a'; x.lineWidth = 1.6; x.beginPath(); x.moveTo(19.5, 17.5); x.lineTo(13, 9); x.stroke();
      ell(x, '#151515', 15, 17, 5.6, 4);
      ell(x, '#e8e8e8', 15, 14, 4.4, 5.4); ell(x, '#c99a6b', 15, 12.2, 2.2, 2);
      x.fillStyle = '#111'; x.fillRect(12.8, 11.4, 4.4, 1.2);
    },
    gringo(x) { // turista quemado con sombrero de souvenir, camisa hawaiana y maleta
      shadow(x, 9, 9); x.fillStyle = '#95a5a6'; x.fillRect(20, 18, 6, 8);
      ell(x, '#f1c40f', 15, 16, 4.8, 3.6); for (let i = 0; i < 5; i++) ell(x, '#e84393', 12 + i * 1.6, 15 + (i % 2) * 2, 0.8, 0.8);
      ell(x, '#d4a017', 15, 15, 8, 8); ell(x, '#e58e26', 15, 15, 5.4, 5.4); ell(x, '#2ecc71', 15, 15, 7.2, 7.2); ell(x, '#d4a017', 15, 15, 6.4, 6.4);
      ell(x, '#ff8a80', 15, 15, 2.6, 2.6); ell(x, '#ff6f61', 15, 15, 1.4, 1.4);
    },
    mariachi(x) { // charro de negro con sombrero de ala ancha y guitarron
      shadow(x, 11, 11); ell(x, '#e5b25d', 23, 21, 5, 6.4, 0.6); ell(x, '#8a5a2b', 23, 21, 1.6, 1.6);
      x.strokeStyle = '#5a3b1c'; x.lineWidth = 1.4; x.beginPath(); x.moveTo(20, 16.5); x.lineTo(15, 10); x.stroke();
      ell(x, '#111', 15, 15, 5.5, 4); ell(x, '#2b2b2b', 15, 14, 9, 9); ell(x, '#d4af37', 15, 14, 9, 9); ell(x, '#2b2b2b', 15, 14, 8, 8);
      ell(x, '#1a1a1a', 15, 14, 3.6, 3.6); x.strokeStyle = '#d4af37'; x.lineWidth = 0.6; x.beginPath(); x.arc(15, 14, 5.6, 0, 7); x.stroke();
    },
    mimo(x) { // mimo: cara blanca, boina negra, playera de rayas y guantes blancos
      shadow(x, 9, 8);
      ell(x, '#f5f5f5', 16, 17, 5.4, 4);
      x.fillStyle = '#111'; for (let i = 0; i < 4; i++) x.fillRect(11 + i * 3, 13.4, 1.4, 7.2);
      ell(x, '#fff', 8.6, 13, 2, 2); ell(x, '#fff', 23.4, 13, 2, 2);
      ell(x, '#fff', 16, 15.5, 3, 3); ell(x, '#111', 16, 14.3, 3.3, 2.4); ell(x, '#111', 16, 12, 1, 1);
      ell(x, '#e74c3c', 16, 17.6, 1, 0.5);
    },
    payaso(x) { // payaso de crucero con peluca de colores y limones en el aire
      shadow(x, 8, 8); ell(x, '#3498db', 16, 17, 5, 3.8);
      for (let i = 0; i < 6; i++) ell(x, ['#e74c3c', '#f1c40f', '#2ecc71'][i % 3], 16 + Math.cos(i) * 3.3, 16 + Math.sin(i) * 3.3, 2.2, 2.2);
      ell(x, '#fbe9d0', 16, 16, 2.6, 2.6); ell(x, '#e74c3c', 16, 14.4, 1, 1);
      for (const [lx, ly] of [[8, 6], [16, 3], [24, 6]]) ell(x, '#7bc043', lx, ly, 1.8, 1.5);
    },
  };
  for (const k in draw) { const t = scene.textures.createCanvas('egg_' + k, 64, 64), x = t.getContext(); x.scale(2, 2); draw[k](x); t.refresh(); }
}
function onAsphalt(x, y, pad) {
  for (const r of roads) {
    if (r.c > 7 || x < r.bb[0] || x > r.bb[2] || y < r.bb[1] || y > r.bb[3]) continue;
    for (let i = 0; i < r.p.length - 2; i += 2) if (segDist(x, y, r.p[i], r.p[i + 1], r.p[i + 2], r.p[i + 3]) < ROAD_W[r.c] / 2 * M + pad) return true;
  }
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
    this.keys = this.input.keyboard.addKeys('W,A,S,D,UP,DOWN,LEFT,RIGHT,SHIFT,SPACE,E,ENTER,F,T,M,R,N');
    this.input.keyboard.addCapture('SPACE,UP,DOWN,LEFT,RIGHT');

    // marcadores de lugares y tacos
    this.marks = [];
    for (const l of landmarks) {
      const ring = this.add.image(l.x, l.y, 'ring').setDepth(3).setTint(0xffd23f).setAlpha(0.8);
      const star = this.add.text(l.x, l.y, '★', { fontSize: '30px', color: '#ffd23f', stroke: '#000', strokeThickness: 4 }).setOrigin(0.5).setDepth(20);
      const label = this.add.text(l.x, l.y - 34, l.name, { fontSize: '15px', fontStyle: 'bold', color: '#fff', stroke: '#000', strokeThickness: 4 }).setOrigin(0.5).setDepth(20);
      this.marks.push({ l, ring, star, label });
    }
    for (const t of tacos) {
      const [sx, sy, rot] = sidewalkSpot(t.x, t.y);
      t.x = sx; t.y = sy;
      t.icon = this.add.image(t.x, t.y, 'puesto' + (hash(t.name.length * 31 + (t.x | 0)) % LONAS.length)).setScale(0.55).setRotation(rot).setDepth(6);
      t.label = this.add.text(t.x, t.y - 26, t.name, { fontSize: '12px', color: '#ffe0a0', stroke: '#000', strokeThickness: 3 }).setOrigin(0.5).setDepth(19);
    }
    for (const c of cafes) {
      // el toldo queda pegado a la fachada, del lado de la banqueta que da al edificio
      const [sx, sy, rot] = sidewalkSpot(c.x, c.y, (SIDEWALK + 0.5) * M + 2);
      c.x = sx; c.y = sy;
      c.icon = this.add.image(c.x, c.y, 'cafe' + (hash(c.name.length * 17 + (c.x | 0)) % TOLDOS.length)).setScale(0.55).setRotation(rot).setDepth(6);
      c.label = this.add.text(c.x, c.y - 24, c.name, { fontSize: '12px', color: '#e8d2b5', stroke: '#000', strokeThickness: 3 }).setOrigin(0.5).setDepth(19);
    }
    for (const c of chinas) {
      // la entrada (punta de la alfombra) queda en la banqueta; el local se mete hacia el edificio
      const [sx, sy, rot] = sidewalkSpot(c.x, c.y, (SIDEWALK + 0.5) * M + 2);
      c.x = sx; c.y = sy;
      const bx = -Math.sin(rot), by = Math.cos(rot); // hacia el frente del local (la calle)
      c.up = Math.cos(rot) < -0.3 ? 'u' : '';
      c.icon = this.add.image(sx - bx * 30, sy - by * 30, 'antro0' + c.up).setScale(0.6).setRotation(rot).setDepth(6);
      const hh = Math.abs(Math.cos(rot)) * 40 + Math.abs(Math.sin(rot)) * 54;
      c.label = this.add.text(c.icon.x, c.icon.y - hh - 8, c.name, { fontSize: '12px', color: '#ff8a80', stroke: '#000', strokeThickness: 3 }).setOrigin(0.5).setDepth(19);
    }
    for (const e of EGGS) {
      const [sx, sy, rot] = sidewalkSpot(e.x, e.y, (SIDEWALK + 0.5) * M);
      e.x = sx; e.y = sy;
      e.icon = this.add.image(sx, sy, 'egg_' + e.k).setScale(0.9).setRotation(rot).setDepth(7).setVisible(!e.got);
    }
    this.stamina = STAMINA; this.tired = false;
    this.staminaBar = this.add.graphics().setDepth(20);
    this.target = this.add.image(0, 0, 'ring').setDepth(4).setTint(0x57d16b).setVisible(false);

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
    this.player = { x: side.x, y: side.y, a: pos.a, sprite: this.add.sprite(side.x, side.y, 'ped' + PLAYER_SHIRT, 0).setDepth(12).setScale(0.5) };
    const car = this.makeCar(pos.x, pos.y, pos.a, { taxi: true });
    this.parked.push(car);
    this.inCar = null;
    this.cameras.main.startFollow(this.player.sprite, true, 0.15, 0.15);
    this.cameras.main.setZoom(this.baseZoom());

    this.taxi = null; this.waypoint = null;
    this.populate(true);
    updateStats();
    this.setObjective();
    this.nameT = 0; this.spawnT = 0;
    setupBigMap(this);
  }

  baseZoom() { return Math.min(window.innerWidth, window.innerHeight) < 600 ? 1.45 : 1.8; } // antes 1.15 y 1.4

  walker(x, y, rate) {
    const i = (Math.random() * SHIRTS.length) | 0;
    const s = this.add.sprite(x, y, 'ped' + i, 0).setDepth(5).setScale(0.5);
    s.play({ key: 'walk' + i, startFrame: (Math.random() * 8) | 0 }); s.anims.timeScale = rate;
    return s;
  }

  // o: { moto, taxi, ti (tipo), ci (color), dirty }; sin tipo se escoge uno al azar
  carSpec(o = {}) {
    if (o.moto) return { T: VT_MOTO, key: 'moto', ox: 0.5, oy: 0.5, dirty: false };
    if (o.taxi) return { T: VT_TAXI, key: 'taxi', ox: 0.5, oy: 0.5, dirty: false };
    if (o.poli) return { T: VT_POLI, key: 'poli0', ox: (VT_POLI.L / 2 + 1) / (VT_POLI.L + 5), oy: (VT_POLI.W / 2 + 1) / (VT_POLI.W + 5), dirty: false };
    const ti = o.ti ?? randomVType(), T = VTYPES[ti], ci = o.ci ?? (Math.random() * T.cols.length) | 0;
    const dirty = o.dirty ?? Math.random() < 0.45, d = dirty ? 1 + ((Math.random() * DIRTY_SEEDS) | 0) : 0;
    return { T, key: vehicleTexture(this, ti, ci, d), ox: (T.L / 2 + 1) / (T.L + 5), oy: (T.W / 2 + 1) / (T.W + 5), dirty };
  }
  makeCar(x, y, a, o) {
    const sp = o && o.T ? o : this.carSpec(o), T = sp.T, f = sp.dirty ? 0.7 : 1;
    return { x, y, a, vx: 0, vy: 0, T, dirty: sp.dirty, moto: T === VT_MOTO, poli: T === VT_POLI, hp: Math.round(T.hp * f), maxHp: Math.round(T.hp * f),
      top: T.top * (sp.dirty ? 0.92 : 1), acc: T.acc * (sp.dirty ? 0.9 : 1), hl: T.L / 2 - 1, hw: T.W / 2 - 1,
      sprite: this.add.image(x, y, sp.key).setOrigin(sp.ox, sp.oy).setRotation(a).setDepth(10).setScale(0.5) };
  }

  // ----- trozos -----
  updateChunks(all) {
    const v = this.cameras.main.worldView;
    const cx0 = Math.max(0, Math.floor((v.x - 192) / CHUNK)), cy0 = Math.max(0, Math.floor((v.y - 192) / CHUNK));
    const cx1 = Math.floor((v.right + 192) / CHUNK), cy1 = Math.floor((v.bottom + 192) / CHUNK);
    // uno por cuadro; primero el que ya se ve (o el mas cercano al centro), luego los de reserva
    const want = [];
    for (let cx = cx0; cx <= cx1; cx++) for (let cy = cy0; cy <= cy1; cy++) {
      if (cx * CHUNK >= WORLD_W || cy * CHUNK >= WORLD_H || this.chunks.has(cx + ',' + cy)) continue;
      want.push([cx, cy, Math.hypot((cx + 0.5) * CHUNK - v.centerX, (cy + 0.5) * CHUNK - v.centerY)]);
    }
    if (!all) want.sort((a, b) => a[2] - b[2]).length = Math.min(1, want.length);
    for (const [cx, cy] of want) {
      const k = cx + ',' + cy, tk = 'ch' + k;
      this.textures.addCanvas(tk, drawChunk(cx, cy));
      this.chunks.set(k, this.add.image(cx * CHUNK - 1, cy * CHUNK - 1, tk).setOrigin(0).setDepth(0));
    }
    for (const [k, img] of this.chunks) {
      const [cx, cy] = k.split(',').map(Number);
      if (cx < cx0 - 4 || cx > cx1 + 4 || cy < cy0 - 4 || cy > cy1 + 4) { img.destroy(); this.textures.remove('ch' + k); this.chunks.delete(k); }
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
    while (this.cars.length < 18 && n++ < 6) {
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
    while (this.peds.length < 32 && n++ < 6) {
      const e = randomEdgeNear(walkG, p.x, p.y, initial ? 60 : R + 20, R + 250); if (!e) break;
      const side = e.c >= 8 ? rnd(-3, 3) : (Math.random() < 0.5 ? 1 : -1) * (e.w / 2 + rnd(0.6, 2.2) * M);
      const ped = { e, dir: Math.random() < 0.5 ? 1 : -1, s: rnd(0, e.len), side, speed: rnd(14, 26), st: 'walk', t: 0, x: 0, y: 0, a: 0 };
      edgePos(e, ped.s, ped.dir, ped.side, ped);
      if (blocked(ped.x, ped.y) || (!initial && inView(ped.x, ped.y))) continue;
      ped.sprite = this.walker(ped.x, ped.y, ped.speed / 20);
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
    if (J(k.M) || touch.pressed.M) toggleBigMap();
    if (J(k.N)) toggleSound();
    touch.pressed = {};

    if (this.inCar) this.driveCar(this.inCar, ctl, dt); else this.walk(ctl, dt);
    this.updateTraffic(dt);
    this.updatePeds(dt);

    const f = this.focus();
    const cam = this.cameras.main;
    const sp = this.inCar ? Math.hypot(this.inCar.vx, this.inCar.vy) : 0;
    const z = this.baseZoom() * (this.inCar ? 1 - Math.min(sp / 320, 1) * 0.15 : 1.1);
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
    this.updateHud(dt, f);
  }

  walk(c, dt) {
    const p = this.player;
    let mx = c.x, my = c.y;
    const m = Math.hypot(mx, my);
    if (m > 0.1) {
      // correr gasta aire; si se acaba, solo caminas hasta recuperarlo completo
      const running = c.run && !this.tired;
      if (running) {
        this.stamina -= dt;
        if (this.stamina <= 0) { this.stamina = 0; this.tired = true; toast('😮‍💨 ' + pick(FRASES_CANSADO), 'Camina un rato para recuperar el aire.', 2.4); if (window.SND) SND.play('tired'); }
      } else this.stamina = Math.min(STAMINA, this.stamina + dt * 0.8);
      const run = running ? 1.8 : 1, sp = 62 * run * Math.min(1, m);
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
        this.cameras.main.shake(120, Math.min(0.012, speed / 30000));
        if (car === this.inCar && window.SND) SND.play('crash', speed / 250);
        car.hp -= speed / 14;
        if (car.hp <= 0 && !broken) { car.sprite.setTint(0x444444); toast('¡Auto deshuesado!', 'Bájate con E y roba otro.'); }
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
        this.cameras.main.shake(180, Math.min(0.014, sp / 22000));
        if (car === this.inCar && window.SND) SND.play('crash', 0.2);
        car.vx *= 0.55; car.vy *= 0.55; car.hp -= sp / 45;
        if (Math.random() < 0.6) toast(pick(FRASES_TOPE), '', 1.6);
      } else if (sp > 25) this.cameras.main.shake(90, 0.003);
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
          this.cameras.main.shake(160, Math.min(0.012, sp / 20000));
          if (window.SND) SND.play('crash', 0.35);
          toast('🕳️ ' + pick(FRASES_BACHE), 'Tu auto: -' + Math.round(dmg) + ' de vida', 2);
          if (car.hp <= 0 && !broken) { car.sprite.setTint(0x444444); toast('¡Auto deshuesado!', 'El bache ganó. Bájate con E y roba otro.'); }
        }
      }
      car.bache = inB;
    }
    car.sprite.setPosition(car.x, car.y).setRotation(car.a);
    car.smokeT = (car.smokeT || 0) - dt;
    if (car.hp < car.maxHp * 0.35 && car.smokeT <= 0) { car.smokeT = 0.12; this.puff(car.x + Math.cos(car.a) * (car.hl - 3), car.y + Math.sin(car.a) * (car.hl - 3)); }
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
          if (sp > 120) { this.cameras.main.shake(100, 0.006); me.hp -= sp / 25; o.speed = 0; }
        }
      }
    }
  }

  updatePeds(dt) {
    const tmp = this.tmp, car = this.inCar;
    const csp = car ? Math.hypot(car.vx, car.vy) : 0;
    for (const p of this.peds) {
      if (p.st === 'down') {
        p.t -= dt; if (p.t <= 0) { p.st = 'flee'; p.t = 5; p.sprite.setScale(0.5).clearTint(); p.sprite.anims.resume(); p.sprite.anims.timeScale = 2.2; }
        continue;
      }
      if (car && csp > 50 && axisDist(p.x, p.y, car) < car.hw + 3) {
        p.st = 'down'; p.t = 2.5; p.sprite.setScale(0.6, 0.3).setTint(0xaaaaaa); p.sprite.anims.pause();
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
    let spot = null;
    for (let i = 0; i < 40 && !spot; i++) {
      const e = randomEdgeNear(walkG, f.x, f.y, 700, 1600); if (!e || e.c > 6) continue;
      const q = edgePos(e, rnd(0, e.len), 1, e.w / 2 + 1.5 * M, {});
      if (!blocked(q.x, q.y)) spot = q;
    }
    if (!spot) return;
    const d = dist(spot.x, spot.y, f.x, f.y), street = streetAt(spot.x, spot.y) || 'una calle del Centro';
    this.delivery = { x: spot.x, y: spot.y, street, order: pick(PEDIDOS), time: d / 85 + 20, d };
    toast(pick(FRASES_MOTO), 'Pedido: ' + this.delivery.order + '. Llévalo a ' + street + '.', 4.5);
    this.setObjective();
  }
  endDelivery(ok) {
    const dl = this.delivery; this.delivery = null; hud.timer.style.display = 'none';
    if (ok) {
      const pay = Math.round(50 + dl.d / 10 + dl.time * 2), tip = Math.random() < 0.5 ? Math.round(rnd(5, 60)) : 0;
      state.money += pay + tip; save(); updateStats();
      toast('¡Pedido entregado!', pick(CLIENTES) + ' (+$' + pay + (tip ? ' y $' + tip + ' de propina' : '') + ')', 4.5);
    } else toast('Pedido cancelado', pick(CANCELADOS), 4);
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
    const ped = this.add.sprite(spot.x, spot.y, 'ped0', 0).setDepth(6).setScale(0.5);
    this.taxi = { phase: 'pick', x: spot.x, y: spot.y, ped };
    toast('Taxi libre', 'Recoge al pasajero marcado en verde.', 2.5);
    this.setObjective();
  }
  endTaxi(ok, msg) {
    if (this.taxi && this.taxi.ped && this.taxi.phase === 'pick') this.taxi.ped.destroy();
    this.taxi = null; hud.timer.style.display = 'none';
    toast(ok ? '¡Viaje completado!' : 'Viaje cancelado', msg + (ok ? ' Presiona T para otro.' : ''), 3.5);
    this.setObjective();
  }
  setObjective() {
    let t = '';
    if (this.taxi) t = this.taxi.phase === 'pick' ? 'Taxi: recoge al pasajero' : 'Taxi: lleva al pasajero a ' + this.taxi.name;
    else if (this.delivery) t = 'Entrega: ' + this.delivery.order + ' en ' + this.delivery.street;
    else if (this.inCar && this.inCar.moto) t = 'Roba otra moto de repartidor para un pedido';
    else if (this.inCar) t = 'T: trabajar de taxista · M: mapa';
    else t = 'Busca ★, 🌮 y ☕ · E: robar un auto';
    hud.obj.textContent = t;
  }
  goal() {
    if (this.taxi) return this.taxi;
    if (this.delivery) return this.delivery;
    if (this.waypoint) return this.waypoint;
    return null;
  }

  updateMarkers(time, f) {
    const pulse = 0.75 + Math.sin(time / 250) * 0.15;
    for (const m of this.marks) {
      const near = dist(m.l.x, m.l.y, f.x, f.y) < 700;
      m.ring.setVisible(!m.l.found).setScale(pulse * 3.4);
      if (m.found !== m.l.found) { m.found = m.l.found; m.star.setColor(m.l.found ? '#bbbbbb' : '#ffd23f'); }
      m.label.setVisible(near);
    }
    for (const t of tacos) { t.icon.setAlpha(t.eaten ? 0.7 : 1); t.label.setVisible(!t.eaten && dist(t.x, t.y, f.x, f.y) < 300); }
    for (const c of cafes) { c.icon.setAlpha(c.drunk ? 0.7 : 1); c.label.setVisible(!c.drunk && dist(c.x, c.y, f.x, f.y) < 300); }
    for (const c of chinas) c.label.setVisible(dist(c.x, c.y, f.x, f.y) < 300);
    const g = this.goal();
    this.target.setVisible(!!g);
    if (g) this.target.setPosition(g.x, g.y).setScale(pulse * (this.taxi && this.taxi.phase === 'pick' ? 1.3 : 2));
    if (this.waypoint && dist(this.waypoint.x, this.waypoint.y, f.x, f.y) < 60) { this.waypoint = null; toast('Llegaste a tu destino', '', 1.5); }
  }

  updateHud(dt, f) {
    if (toastT > 0) { toastT -= dt; if (toastT <= 0) hud.toast.style.opacity = 0; }
    this.nameT -= dt;
    if (this.nameT <= 0) {
      this.nameT = 0.4;
      const n = streetAt(f.x, f.y);
      if (n && n !== lastStreet) { lastStreet = n; hud.street.innerHTML = ''; hud.street.textContent = n; const sm = document.createElement('small'); sm.textContent = 'Zona Centro · Tijuana'; hud.street.appendChild(sm); hud.street.style.opacity = 1; streetT = 3; }
    }
    if (streetT > 0) { streetT -= dt; if (streetT <= 0) hud.street.style.opacity = 0; }
    const tt = this.taxi && this.taxi.phase === 'drop' ? Math.ceil(this.taxi.time) + 's' : this.delivery ? '🛵 ' + Math.ceil(this.delivery.time) + 's' : null;
    if (tt && tt !== this.lastTimer) { this.lastTimer = tt; hud.timer.style.display = 'block'; hud.timer.textContent = tt; }
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
let bigOpen = false, bigScene = null;
function setupBigMap(scene) {
  bigScene = scene;
  const wrap = $('bigmap'), cv = $('bigc');
  cv.width = miniFull.width; cv.height = miniFull.height;
  wrap.addEventListener('pointerdown', (ev) => {
    if (ev.target === cv) {
      const r = cv.getBoundingClientRect();
      const x = (ev.clientX - r.left) / r.width * WORLD_W, y = (ev.clientY - r.top) / r.height * WORLD_H;
      scene.waypoint = { x, y }; renderBig(); toast('Destino marcado', 'Sigue la flecha verde.', 2);
      setTimeout(toggleBigMap, 350);
    } else toggleBigMap();
  });
}
function renderBig() {
  const cv = $('bigc'), c = cv.getContext('2d');
  c.drawImage(miniFull, 0, 0);
  drawMarkers(c, MS, MS, 0, 0, bigScene, bigScene.focus(), true);
}
function toggleBigMap() {
  bigOpen = !bigOpen;
  $('bigmap').style.display = bigOpen ? 'flex' : 'none';
  if (bigOpen) renderBig();
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
  btn('bE', 'E'); btn('bT', 'T'); btn('bM', 'M');
  const bB = $('bB');
  bB.addEventListener('pointerdown', () => { touch.brake = true; });
  bB.addEventListener('pointerup', () => { touch.brake = false; });
  bB.addEventListener('pointercancel', () => { touch.brake = false; });
  const bR = $('bR');
  bR.addEventListener('pointerdown', (e) => { e.preventDefault(); touch.rev = true; });
  for (const ev of ['pointerup', 'pointercancel', 'pointerleave']) bR.addEventListener(ev, () => { touch.rev = false; });
}

// ---------- arranque ----------
function toggleSound() { const m = SND.toggle(); $('snd').textContent = m ? '🔇' : '🔊'; }
function start() {
  $('intro').style.display = 'none';
  if (window.SND) { SND.init(); $('snd').style.display = 'block'; $('snd').textContent = SND.muted ? '🔇' : '🔊'; $('snd').addEventListener('click', toggleSound); }
  setupTouch();
  const game = new Phaser.Game({
    type: Phaser.AUTO, parent: 'game', backgroundColor: '#2a2a2a',
    scale: { mode: Phaser.Scale.RESIZE, width: window.innerWidth, height: window.innerHeight },
    scene: [Main], fps: { target: 60, smoothStep: false },
  });
  window.TJGTA = game; game.dbg = { VTYPES, vehicleTexture, state, drawChunk, baches };
}
$('go').addEventListener('click', start);
// reiniciar la partida: borra dinero y lugares, tacos y cafes descubiertos (pide tocar dos veces)
(() => {
  const b = $('reset');
  if (state.money > 0 || landmarks.some(l => l.found) || tacos.some(t => t.eaten) || cafes.some(c => c.drunk) || EGGS.some(e => e.got)) b.style.display = 'inline-block';
  b.addEventListener('click', () => {
    if (!b.classList.contains('confirm')) { b.classList.add('confirm'); b.textContent = '¿Seguro? Toca otra vez para borrar todo'; return; }
    state.money = 0;
    landmarks.forEach(l => { l.found = false; }); tacos.forEach(t => { t.eaten = false; }); cafes.forEach(c => { c.drunk = false; }); EGGS.forEach(e => { e.got = false; });
    save();
    b.classList.remove('confirm'); b.textContent = 'Partida reiniciada ✓'; b.disabled = true;
  });
})();
window.addEventListener('keydown', function onKey(e) {
  if (e.key === 'Enter' && $('intro').style.display !== 'none') { window.removeEventListener('keydown', onKey); start(); }
});
updateStats();
})();
