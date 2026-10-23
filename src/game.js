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
const EXTRA_UP = 100; // lo mas que se eleva un techo (px)
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
// banqueta que se dibuja por clase: las autopistas solo llevan un acotamiento angosto (nadie camina ahi y sus
// banquetas llenaban los cruces de rampas de listones sin sentido)
const BANQ = ROAD_W.map((w, c) => c === 0 ? 0.8 : SIDEWALK);
const COL = {
  ground: '#8f8875', sidewalk: '#b4ab98', curb: '#9d9481', asphalt: '#3c3c41', paving: '#c5b89e',
  footway: '#c9bda3', rail: '#6b5a48', water: '#2f5f7f', yellow: '#e6c13a', white: '#8a8a90',
  us: 'rgba(52,60,48,0.82)', fence: '#5b3f2a',
};
// tipos de area (ver tools/prep_data.py): 0 parque, 1 cancha, 2 plaza, 3 escuela, 4 comercio, 5 industria,
// 6 vivienda, 7 agua, 8 arena (las trampas del golf)
const AREA_COL = ['#5f8a3f', '#6a9a48', '#c9bc9f', '#a39a82', '#9b927d', '#a08c66', '#958e7a', '#2f5f7f', '#dcc89a'];
const AREA_PLAZA = 2, AREA_AGUA = 7, AREA_ARENA = 8;
const TEX_CANAL = 'canal', TEX_SENDERO = 'sendero', TEX_BANQUETA = 'banqueta', TEX_ASFALTO = 'asfalto', TEX_TIERRA = 'tierra', TEX_TECHO = 'techo', TEX_ACCESO = 'acceso'; // los andadores (clase 9) no son area, pero usan su propia textura
const ROOFS = ['#b9a98c', '#c9b89c', '#a39483', '#8f8a84', '#c3a27b', '#d2c5ae', '#9d7c64', '#7f8a90',
  '#b07d62', '#a8a8a0', '#c7b18a', '#8d9a86', '#bfa99a', '#d6cfc0'];

function pts(arr) { const a = new Float32Array(arr.length); for (let i = 0; i < arr.length; i++) a[i] = arr[i] * S; return a; }
// los datos guardan el primer punto completo y los demas como diferencia con el anterior (ver tools/prep_data.py)
function ptsD(arr) {
  const a = new Float32Array(arr.length); let x = 0, y = 0;
  for (let i = 0; i < arr.length; i += 2) { x += arr[i]; y += arr[i + 1]; a[i] = x * S; a[i + 1] = y * S; }
  return a;
}
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
// ¿el punto cae dentro de la carroceria de un carro (rectangulo girado)? r es el margen para el cuerpo de la persona
function insideCar(c, x, y, r) {
  const dx = x - c.x, dy = y - c.y, L = c.hl + r, W = c.hw + r;
  if (dx * dx + dy * dy > L * L + W * W) return false;
  const ca = Math.cos(c.a), sa = Math.sin(c.a);
  return Math.abs(dx * ca + dy * sa) < L && Math.abs(dy * ca - dx * sa) < W;
}
function hashTexto(t) { let h = 0; for (let i = 0; i < t.length; i++) h = Math.imul(h ^ t.charCodeAt(i), 0x9e3779b1); return (h >>> 0).toString(36); }
// llave numerica de una celda de rejilla (pesa mucho menos que el texto 'x,y')
const GK = (cx, cy) => cx * 1048576 + cy;
function hash(i) { i = Math.imul(i ^ 61, 0x9e3779b1); i ^= i >>> 15; return (i >>> 0); }
const dist = (ax, ay, bx, by) => Math.hypot(ax - bx, ay - by);
const angDiff = (a, b) => { let d = b - a; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; return d; };
const rnd = (a, b) => a + Math.random() * (b - a);
const pick = (arr) => arr[(Math.random() * arr.length) | 0];

// ancho de cada calle (m): las avenidas divididas vienen como una linea por sentido, y cada una con el ancho de la
// avenida completa se enciman en una plancha de asfalto sin camellon (Via Rapida, Paseo Centenario, Paseo de los
// Heroes...); un sentido lleva 3 carriles
const ANCHO_UN_SENTIDO = [12, 12, 11, 11, 8];
const roadW = (c, f) => (f & 2) && c < ANCHO_UN_SENTIDO.length ? ANCHO_UN_SENTIDO[c] : ROAD_W[c];
const roads = D.roads.map(([c, n, f, co], i) => { const p = ptsD(co), w = roadW(c, f); return { i, c, n, f, p, w, bb: bbox(p, (w / 2 + 3) * M), curvy: curviness(p) > 0.0024 }; });
const areas = D.areas.map(([k, co]) => { const p = ptsD(co); return { k, p, bb: bbox(p, 0) }; });
// los datos crudos ya no se usan (las lineas quedaron en Float32Array): se sueltan para no tenerlos dos veces
D.roads = D.areas = null;
// la linea fronteriza: puntos de oeste a este; borderY da su altura en cualquier x (entre puntos, en linea recta)
const B = pts(D.border);
function borderY(x) {
  let lo = 1, hi = B.length / 2 - 1;
  while (lo < hi) { const m = (lo + hi) >> 1; if (B[m * 2] < x) lo = m + 1; else hi = m; }
  const i = lo * 2;
  return B[i - 1] + (x - B[i - 2]) * (B[i + 1] - B[i - 1]) / ((B[i] - B[i - 2]) || 1);
}
// la linea entre x0 y x1 (con sus vueltas), para pintarla
function fronteraPts(x0, x1) {
  const o = [x0, borderY(x0)];
  for (let i = 0; i < B.length; i += 2) if (B[i] > x0 && B[i] < x1) o.push(B[i], B[i + 1]);
  o.push(x1, borderY(x1));
  return o;
}
// algunas posiciones del juego estan en metros desde la esquina noroeste del primer mapa (zonas, paros, un
// secreto); D.o dice donde cae esa esquina ahora (si el mapa crece al norte o al oeste, ya no es el origen)
const REF_X = (D.o ? D.o[0] : 0) * S, REF_Y = (D.o ? D.o[1] : 0) * S;
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
  // la llave 'payaso' se queda: asi la reconocen las partidas que ya lo habian encontrado
  { k: 'payaso', name: 'La Bailarina sin Cabeza', near: 'Glorieta Cuauhtémoc', dx: 60, dy: -40, pay: 250,
    say: '(Una bailarina de lentejuelas gira y gira... sin cabeza. Se detiene frente a ti, te deja unos billetes de los años 30 que todavía sirven y se desvanece.)' },
  { k: 'alien', name: 'Un Alien', near: 'Parque México', dx: -40, dy: 35, pay: 200,
    say: '"Vine a estudiar a los terrícolas y me quedé por los tacos. Toma, en mi planeta este papel no vale nada."' },
  { k: 'gamer', name: 'El Gamer de la FrikiPlaza', near: 'FrikiPlaza', dx: 35, dy: 30, pay: 200,
    say: '"¿Una reta de Street Fighter? ...No manches, ni la vi venir. Toma, te ganaste el premio del torneo."' },
  // fase 1: Otay y La Mesa
  { k: 'aviones', name: 'El Señor de los Aviones', near: 'Aeropuerto de Tijuana', dx: -60, dy: 70, pay: 200,
    say: '"Ese es un 737. Ese también. Y ese. Todos son 737, pero yo los apunto igual. Ten, por hacerme compañía."' },
  { k: 'elote', name: 'Un Elote con Todo', near: 'Las 5 y 10', dx: 45, dy: -35, pay: 150,
    say: '(Mayonesa, queso, chile y limón. Nadie sabe de quién es, pero trae un billete enrollado en el palito. Buen provecho.)' },
  // fase 2: la Presa y el estadio de los Toros
  { k: 'pescador', name: 'El Pescador de la Presa', near: 'Presa Rodríguez', dx: 50, dy: -45, pay: 200,
    say: '"Aquí no pica nada desde hace años, pero yo vengo por la paz. Ten, cómprate un pescado en el mercado."' },
  { k: 'jonron', name: 'La Pelota del Jonrón', near: 'Estadio de los Toros', dx: 60, dy: 45, pay: 250,
    say: '(Una pelota firmada que voló del estadio hasta aquí. Trae un billete pegado con cinta y una nota: "Para el que la encuentre".)' },
  // fase 3: Playas
  { k: 'surfista', name: 'El Surfista de Playas', near: 'Malecón de Playas', dx: -35, dy: 60, pay: 200,
    say: '"Hoy no hay olas, carnal, pero el taco de pescado está de diez. Ten, invítate uno."' },
  { k: 'pelicano', name: 'Un Pelícano Tijuanense', near: 'Faro de Playas', dx: -30, dy: 55, pay: 150,
    say: '(Un pelícano te mira fijo, abre el pico... y suelta un billete mojado. Mejor no preguntes de dónde lo sacó.)' },
  // fase 4: las orillas
  { k: 'venado', name: 'Un Venado de Natura', near: 'Natura', dx: 40, dy: 50, pay: 200,
    say: '(Un venado de verdad, muy quitado de la pena, comiéndose el pasto del parque. A sus pies hay un billete. Él no lo necesita.)' },
  { k: 'concha', name: 'Una Concha de Mar', near: 'San Antonio del Mar', dx: -40, dy: 35, pay: 150,
    say: '(Una concha enorme y brillante. Adentro, en lugar de perla, hay un billete enrollado. El mar también hace paros.)' },
  // fase 5: en las orillas, la historia de la ciudad: hechos recientes, nostalgia y consejos de aqui
  { k: 'rodadora', name: 'Una Rodadora de Santa Ana', near: 'Mirador del Cerro Colorado', dx: 55, dy: 45, pay: 300,
    say: '(Una rodadora llega con el viento caliente del este y se atora en tu pie, con un billete enredado.) Consejo: cuando sopla la Santa Ana toma agua, cierra ventanas y no hagas lumbre. Una chispa y se quema el cerro.' },
  { k: 'mochila', name: 'La Señora de la Mochila', near: 'El Florido', dx: -45, dy: 50, pay: 300,
    say: '"El Domingo de Pascua de 2010 tembló 7.2 cerca de Mexicali y aquí se mecieron hasta los tinacos. Desde entonces traigo mi mochila: agua, linterna, radio y copia de papeles. Ten, pa\' que armes la tuya."' },
  { k: 'haiti', name: 'El Cocinero Haitiano', near: 'Central Camionera', dx: 50, dy: 60, pay: 300,
    say: '"En 2016 llegamos miles de Haití pensando en cruzar, y muchos nos quedamos. Hoy hay arroz con frijol rojo a dos cuadras de la birria. Tijuana siempre ha sido de los que llegan. Ten, y vienes a probarlo."' },
  { k: 'visa', name: 'Una Visa Olvidada', near: 'Garita de Otay', dx: 30, dy: 170, pay: 300,
    say: '(Una visa tirada, con un billete adentro.) De 2020 a 2021 la línea estuvo cerrada para paseos casi 20 meses y muchas familias no se vieron en todo ese tiempo. Por eso aquí nadie se queja de la fila... bueno, casi nadie.' },
  { k: 'nortec', name: 'El DJ del Nortec', near: 'Universidad Tecnológica', dx: 70, dy: 80, pay: 300,
    say: '"Por ahí del 2000 a unos compas se les ocurrió mezclar tambora y acordeón con música electrónica, y medio mundo bailó con el sonido de Tijuana. Le pusieron Nortec. Ten, pa\' unos audífonos."' },
  { k: 'chamarra', name: 'La Señora de la Chamarra', near: 'El Muro en la Playa', dx: 70, dy: 45, pay: 300,
    say: '"¿A la playa sin chamarra? Aquí es mayo gris y junio nublado: el sol sale en la tarde, si sale. Y en septiembre, cuando ya quieres suéter, es cuando más calor hace. Ten, cómprate una sudadera."' },
  { k: 'coyote', name: 'Un Coyote del Cañón', near: 'Mirador del Cañón del Sainz', dx: 45, dy: -50, pay: 300,
    say: '(Un coyote te mira desde la orilla del cañón y se va sin prisa; dejó un billete.) Consejo: no les des de comer, y cuando llueva no cruces el arroyo: en un ratito baja con todo y arrastra carros.' },
  { k: 'mona', name: 'El Vecino de La Mona', near: 'Aeropuerto de Tijuana', dx: 130, dy: 120, pay: 300,
    say: '"En 1989, para los cien años de la ciudad, un escultor hizo por aquí una mujer de concreto de 17 metros y se fue a vivir adentro. Le dicen La Mona. En Tijuana hasta las estatuas tienen recámara. Ten."' },
  { k: 'topografo', name: 'El Topógrafo de 1889', near: 'El Colef', dx: -50, dy: 55, pay: 300,
    say: '(Un señor de bigote, con su plano enrollado y su tripié.) "Es julio de 1889 y estoy trazando un pueblito junto al río. ¿Que ya somos millones? Ah, caray. Ten, a ver si todavía te sirven estos pesos."' },
  // referencias que se quedan siempre en su lugar (fija: no se quitan al encontrarlas; r: de que tan lejos cuentan).
  // canal: va adentro del canal del rio, en la orilla mas cercana al lugar (ver lugarEnCanal)
  { k: 'cachorros', name: 'Rescate en el Canal', near: 'Plaza Río Tijuana', dx: 0, dy: 0, pay: 300, fija: true, canal: true, r: 150,
    say: '(Seis perritos con chalequito y casco de colores jalan una soga para sacar a un señor del canal del río.) El señor nomás quería sacar su chancla. Te dejaron una propina por echar porras.' },
  // mar: en el agua, mar adentro de la orilla que queda al poniente del lugar (cuenta desde la playa)
  { k: 'delfines', name: 'Los Delfines de Playas', near: 'El Muro en la Playa', dx: 0, dy: 70, pay: 300, fija: true, mar: true, r: 130,
    say: '(Tres delfines se asoman junto al muro que se mete al mar, te ven y se ríen con su risita de delfín.) "Ustedes hacen fila horas para cruzar; nosotros nomás nadamos para allá y para acá." Te aventaron una moneda que alguien tiró al mar.' },
  // libre: va justo ahi (a media ladera), no en la banqueta de la calle mas cercana
  { k: 'senderistas', name: 'Los Senderistas Perdidos', near: 'Mirador del Cerro Colorado', dx: -45, dy: -60, pay: 300, fija: true, libre: true, r: 70,
    say: '(Cuatro senderistas con mochila, bastones y un mapa al revés discuten en plena ladera.) Llevan tres horas perdidos a sesenta metros del mirador, con las antenas a la vista y toda la ciudad allá abajo. Te dieron una lana para que no le cuentes a nadie.' },
  // en un llano vacio del Cañón del Sainz (sin calles, casas ni agua cerca), en metros como el raton. Va derecho (rot)
  // y quieto, que el monolito no se mece
  { k: 'monolito', name: 'El Monolito del Llano', at: [6602, 12632], pay: 300, fija: true, libre: true, rot: 0, quieto: true, r: 110,
    say: '(Nueve vacas formadas en un círculo perfecto miran, sin parpadear, una losa negra que apareció en medio del llano.) Nadie sabe quién la puso ni desde cuándo. Una vaca te pasó una moneda con la pezuña y volvió a su lugar.' },
  // en un terreno vacio de Natura (sin calles, casas ni agua cerca)
  { k: 'gnomos', name: 'Los Gnomos Conspiradores', at: [12382, 13312], pay: 300, fija: true, libre: true, rot: 0, quieto: true, r: 70,
    say: '(Cinco gnomos de jardín en bolita, alrededor de un tronquito con una vela y un plano marcado con una X, se quedan quietitos en cuanto te ven.) Uno te guiñó el ojo y te pasó un billete "para que no hayas visto nada".' },
  // en un baldio de Otay (sin calles, casas ni agua cerca)
  { k: 'lucha', name: 'El Ring del Baldío', at: [8982, 1752], pay: 300, fija: true, libre: true, rot: 0, quieto: true, r: 80,
    say: '(En un baldío, dos luchadores enmascarados ensayan llaves en un ring hecho con cuerdas de tendedero, con su réferi y todo.) "¡A dos de tres caídas!" Te dieron una lana por ser el público.' },
  // en un llano del Cañón del Sainz (sin calles, casas ni agua cerca): las huellas dan vueltas en circulo
  { k: 'piloto', name: 'El Piloto Perdido', at: [8302, 11612], pay: 300, fija: true, libre: true, rot: 0, quieto: true, r: 80,
    say: '(Un piloto de la carrera de mil millas por la península, con casco y el traje lleno de polvo, ve un mapa que no le cuadra junto a su buggy.) "¿Esto es Ensenada?" Te dio una lana para que no le digas a nadie que se perdió.' },
  // en un terreno perdido de San Antonio del Mar (sin calles, casas ni agua cerca): habla solo
  { k: 'programador', name: 'El Programador Solitario', at: [-3598, 12632], pay: 300, fija: true, libre: true, rot: 0, quieto: true, r: 70,
    say: '(Un programador despeinado, con su laptop conectada a una extensión que se pierde en el monte, le habla a un patito de hule.) "¿Tú también encontraste este lugar? Entonces sí funciona." Te pasó una lana "por probar el juego".' },
  // en el monte de Terrazas del Valle (sin calles, casas ni agua cerca)
  { k: 'banda', name: 'La Banda del Monte', at: [18162, 9912], pay: 300, fija: true, libre: true, rot: 0, quieto: true, r: 80,
    say: '(En pleno monte, una banda completa, con tuba, tambora, trompetas, clarinetes y trombón, le toca con todo el corazón a un nopal.) "Nos dijeron que aquí era la boda." Te pasaron una lana para que les pidas una canción.' },
  // en el monte de La Presa (sin calles, casas ni agua cerca)
  { k: 'chupacabras', name: 'El Chupacabras Jubilado', at: [13742, 9912], pay: 300, fija: true, libre: true, rot: 0, quieto: true, r: 70,
    say: '(En pleno monte, el mismísimo chupacabras toma horchata en una silla de playa, junto a una cabra que duerme tranquilita.) "Ya nadie me tiene miedo; ahora me piden selfies." Te dio un billete medio mordido.' },
  // las mascotas de las escuelas, afuera de su campus
  { k: 'cimarrones', name: 'Los Cimarrones de la UABC', near: 'UABC Campus Tijuana', dx: 55, dy: -45, pay: 300, fija: true, r: 70,
    say: '(Unos borregos cimarrones con bufanda verde y dorada pastan afuera de la UABC.) El cimarrón vive en las sierras de Baja California y es la mascota de la universidad. Estos ya van en octavo semestre. Te dejaron una lana para las copias.' },
  { k: 'galgos', name: 'Los Galgos del Tec', near: 'Tecnológico de Tijuana', dx: -55, dy: 45, pay: 300, fija: true, r: 70,
    say: '(Tres galgos con sudadera azul pasan corriendo frente al Tecnológico.) Son la mascota del Tec de Tijuana: flacos, rapidísimos y siempre corriendo a la primera clase. A uno se le cayó un billete y ni regresó por él.' },
  // este no tiene un lugar cerca: va en metros desde la esquina noroeste del mapa, en plena Zona Norte
  { k: 'raton', name: 'La Botarga del Ratón Amarillo', at: [395, 615], pay: 200,
    say: '"¡Foto con el ratón, foto! ...No soy pirata, soy edición limitada. Ten, por no preguntar de qué caricatura soy."' },
].map(e => {
  if (e.at) return { ...e, x: REF_X + e.at[0] * M, y: REF_Y + e.at[1] * M, got: false };
  const l = landmarks.find(q => q.name === e.near) || landmarks[0]; return { ...e, x: l.x + e.dx * M, y: l.y + e.dy * M, got: false };
});

// ---------- indices espaciales ----------
// Rejilla compacta: los numeros de cada celda seguidos en V, y O dice donde empieza cada celda que tiene algo. Las
// celdas vacias no ocupan: un bit por celda dice si tiene algo, y para saber cual es se cuentan los bits prendidos
// antes de ella (rank: la cuenta hasta cada palabra de 32 bits + los bits de la palabra). Antes O tenia un numero por
// cada celda del rectangulo y, con toda la ciudad, las rejillas finas (calles, rio, baches) pesaban decenas de MB casi
// todo en celdas vacias. Se arma en dos pasadas sin Map ni ordenar. enumera(emit) llama emit(cx, cy, i) por cada
// celda de cada elemento, en orden; el mismo i seguido en la misma celda cuenta una vez. celda(cx, cy) da el numero de
// la celda (para O[c] y O[c + 1]) o -1 si esta vacia o fuera. get(k) da los numeros de la celda k = GK(cx, cy) (un
// Int32Array: sirve con for...of y forEach, pero .map da otro Int32Array) o undefined.
const bits1 = (x) => { x -= (x >>> 1) & 0x55555555; x = (x & 0x33333333) + ((x >>> 2) & 0x33333333); return Math.imul((x + (x >>> 4)) & 0x0F0F0F0F, 0x01010101) >>> 24; };
function rejillaDensa(enumera) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  enumera((cx, cy) => { if (cx < x0) x0 = cx; if (cx > x1) x1 = cx; if (cy < y0) y0 = cy; if (cy > y1) y1 = cy; });
  if (x0 > x1) return { O: new Int32Array(1), V: new Int32Array(0), celda: () => -1, get: () => undefined };
  const W = x1 - x0 + 1, N = W * (y1 - y0 + 1);
  // primera pasada: cuantos hay en cada celda (arreglos de todo el rectangulo, pero solo mientras se arma)
  let cnt = new Int32Array(N), ult = new Int32Array(N).fill(-1);
  enumera((cx, cy, i) => { const c = (cy - y0) * W + cx - x0; if (ult[c] !== i) { ult[c] = i; cnt[c]++; } });
  const NW = (N + 31) >>> 5, bits = new Uint32Array(NW), rank = new Int32Array(NW);
  let M = 0;
  for (let w = 0; w < NW; w++) {
    rank[w] = M; let b = 0;
    for (let c = w << 5, e = Math.min(N, c + 32), k = 0; c < e; c++, k++) if (cnt[c]) { b |= 1 << k; M++; }
    bits[w] = b;
  }
  const O = new Int32Array(M + 1);
  for (let c = 0, m = 0; c < N; c++) if (cnt[c]) { O[m + 1] = O[m] + cnt[c]; m++; }
  cnt = null;
  const idx = (c) => { const w = c >>> 5, k = c & 31, b = bits[w]; return (b >>> k) & 1 ? rank[w] + bits1(b & ((1 << k) - 1)) : -1; };
  // segunda pasada: los numeros en su lugar
  const V = new Int32Array(O[M]), pos = O.slice(0, M); ult.fill(-1);
  enumera((cx, cy, i) => { const c = (cy - y0) * W + cx - x0; if (ult[c] !== i) { ult[c] = i; V[pos[idx(c)]++] = i; } });
  ult = null;
  const celda = (cx, cy) => (cx < x0 || cx > x1 || cy < y0 || cy > y1 ? -1 : idx((cy - y0) * W + cx - x0));
  return {
    O, V, celda,
    get(k) { const cx = Math.round(k / 1048576), c = celda(cx, k - cx * 1048576); return c < 0 ? undefined : V.subarray(O[c], O[c + 1]); },
  };
}
function gridIndex(items, cell, bbKey, pad) {
  return rejillaDensa((emit) => items.forEach((it, i) => {
    const b = it[bbKey], d = pad ? pad(it) : 0;
    for (let cx = Math.floor((b[0] - d) / cell); cx <= Math.floor((b[2] + d) / cell); cx++)
      for (let cy = Math.floor((b[1] - d) / cell); cy <= Math.floor((b[3] + d) / cell); cy++) emit(cx, cy, i);
  }));
}
// las lineas (calles) van solo en las celdas por donde pasan, con su margen: con su rectangulo completo, una
// avenida larga en diagonal llenaba miles de celdas que ni toca (y con el mapa grande eso es mucha memoria)
function gridLineas(items, cell, pad) {
  return rejillaDensa((emit) => items.forEach((it, i) => {
    const p = it.p, d = pad(it);
    for (let q = 0; q + 3 < p.length; q += 2) {
      const x0 = Math.floor((Math.min(p[q], p[q + 2]) - d) / cell), x1 = Math.floor((Math.max(p[q], p[q + 2]) + d) / cell);
      const y0 = Math.floor((Math.min(p[q + 1], p[q + 3]) - d) / cell), y1 = Math.floor((Math.max(p[q + 1], p[q + 3]) + d) / cell);
      for (let cx = x0; cx <= x1; cx++) for (let cy = y0; cy <= y1; cy++) emit(cx, cy, i);
    }
  }));
}
const roadPad = (r) => (r.w / 2 + 3) * M; // el mismo margen que su caja (r.bb)
const chunkRoads = gridLineas(roads, CHUNK, roadPad);
// el pasto y el agua con margen: sus orillas (ver orillaPasto y haloLago) se salen unos pixeles del poligono
const chunkAreas = gridIndex(areas, CHUNK, 'bb', a => (a.k === 0 || a.k === 1 || a.k === AREA_AGUA ? 10 : 0));
const BCELL = 64;

// ---------- edificios por regiones ----------
// Los edificios (lo que mas pesa del mapa) vienen en regiones de REG_PX x REG_PX (data/reg/X_Y.js) que se cargan
// cerca de donde andas y se sueltan de lejos. D.regs dice hasta donde llegan los edificios de cada region (su
// caja, que se sale un poco del cuadro). Un trozo del mapa solo se pinta cuando ya estan todas las que lo tocan.
const REG_PX = (D.reg || 8192) * S;
const REG_PAD = 160;         // lo que se sale un edificio con su sombra y techo, y donde se buscan los arboles
const REG_MAX = 40;          // regiones cargadas a la vez (de mas, se sueltan las mas lejanas)
const REG_CERCA = 1.6;       // ... pero nunca las que estan a menos de esto (en regiones) de ti
const regiones = new Map();  // clave -> { k, n, bb, estado: 0 sin cargar, 1 cargando, 2 lista, b: edificios, uso }
Object.entries(D.regs || {}).forEach(([k, bb], n) => regiones.set(k, { k, n, bb: [bb[0] * S - REG_PAD, bb[1] * S - REG_PAD, bb[2] * S + REG_PAD, bb[3] * S + REG_PAD], estado: 0, b: null, uso: 0 }));
const gridAdd = (g, it, b, cell) => {
  for (let cx = Math.floor(b[0] / cell); cx <= Math.floor(b[2] / cell); cx++) for (let cy = Math.floor(b[1] / cell); cy <= Math.floor(b[3] / cell); cy++) {
    const k = GK(cx, cy); let a = g.get(k); if (!a) g.set(k, a = []); a.push(it);
  }
};
const regGrid = new Map();
for (const r of regiones.values()) gridAdd(regGrid, r, r.bb, REG_PX);
const chunkBlds = new Map(), bldGrid = new Map(), chunkEst = new Map(), chunkSuelo = new Map();
// techos de las casas (las casitas de las colonias y las casas chicas del mapa): casi todas con impermeabilizante
// blanco o rojo (terracota), y una que otra de concreto pelon o lamina. Y los de las plazas comerciales
const TECHOS_CASITA = ['#e4e1d8', '#d9d5ca', '#ece9e1', '#cfcabd', '#e0dcd0', '#b4533d', '#a8473a', '#c0644a', '#9e4134', '#b85a44',
  '#c96f52', '#a9a397', '#9a948a', '#8e9399'];
const TECHOS_PLAZA = ['#c9c6bf', '#b5b8bb', '#d6d2c8', '#bdb6a8'];
// Un estacionamiento (de tools/rellenar.py): rectangulo con el frente a la calle (p0 -> p1) y el fondo hacia p3.
// Adentro van filas dobles de cajones con su pasillo en medio, y entre una fila doble y otra una
// jardinera con postes de luz. cajones: donde se estacionan los carros (centro y angulo, de nariz al pasillo).
const CAJON_W = 3.4 * M, CAJON_L = 7.6 * M, PASILLO = 8 * M, JARDINERA = 1.6 * M; // a la medida de los carros del juego (un sedan mide 6 m)
function estacionamiento(p, id, reg) {
  const ux = p[2] - p[0], uy = p[3] - p[1], lu = Math.hypot(ux, uy), vx = p[6] - p[0], vy = p[7] - p[1], lv = Math.hypot(vx, vy);
  const U = [ux / lu, uy / lu], V = [vx / lv, vy / lv], P = (s, t) => [p[0] + U[0] * s + V[0] * t, p[1] + U[1] * s + V[1] * t];
  const filas = [], jardineras = [], cajones = [], av = Math.atan2(V[1], V[0]);
  const modulo = 2 * CAJON_L + PASILLO, n = Math.max(1, Math.floor((lv - 1.5 * M + JARDINERA) / (modulo + JARDINERA)));
  let t = 1.5 * M; // el frente: banquetita de la calle
  const nc = Math.floor((lu - 4 * M) / CAJON_W), s0 = (lu - nc * CAJON_W) / 2;
  for (let m = 0; m < n; m++) {
    filas.push([t, 1], [t + CAJON_L + PASILLO, -1]); // fila de cajones y hacia donde ve la nariz (1: al fondo)
    for (const [t0, sent] of [[t, 1], [t + CAJON_L + PASILLO, -1]]) for (let i = 0; i < nc; i++) {
      const [x, y] = P(s0 + (i + 0.5) * CAJON_W, t0 + CAJON_L / 2);
      cajones.push({ x, y, a: sent > 0 ? av + Math.PI : av });
    }
    t += modulo;
    if (m < n - 1) { jardineras.push(t); t += JARDINERA; }
  }
  return { id, reg, p, U, V, lu, lv, P, filas, jardineras, cajones, nc, s0, bb: bbox(p, 0),
    cx: (p[0] + p[4]) / 2, cy: (p[1] + p[5]) / 2, r: Math.hypot(lu, lv) / 2 };
}
// ¿(x, y) cae en un estacionamiento (con margen m)? (ahi no van arboles)
function enEstacionamiento(x, y, m) {
  for (const e of chunkEst.get(GK(Math.floor(x / CHUNK), Math.floor(y / CHUNK))) || []) {
    const dx = x - e.p[0], dy = y - e.p[1], s = dx * e.U[0] + dy * e.U[1], t = dx * e.V[0] + dy * e.V[1];
    if (s > -m && s < e.lu + m && t > -m && t < e.lv + m) return true;
  }
  return false;
}
// ¿(x, y) cae en una cancha (con margen m)? (ahi tampoco van arboles)
function enCancha(x, y, m) {
  for (const e of chunkSuelo.get(GK(Math.floor(x / CHUNK), Math.floor(y / CHUNK))) || []) {
    if (e.tipo !== 'cancha') continue;
    const dx = x - e.p[0], dy = y - e.p[1], s = dx * e.U[0] + dy * e.U[1], t = dx * e.V[0] + dy * e.V[1];
    if (s > -m && s < e.lu + m && t > -m && t < e.lv + m) return true;
  }
  return false;
}
// Lo de adentro de las manzanas (de tools/rellenar.py): patios atras de las casitas, lotes baldios y canchas de
// tierra. Son rectangulos (p0 -> p1 y p0 -> p3); se pintan en el piso del trozo y no estorban el paso.
function suelo(tipo, p, id, reg) {
  const ux = p[2] - p[0], uy = p[3] - p[1], lu = Math.hypot(ux, uy), vx = p[6] - p[0], vy = p[7] - p[1], lv = Math.hypot(vx, vy);
  const U = [ux / lu, uy / lu], V = [vx / lv, vy / lv];
  return { tipo, id, reg, p, U, V, lu, lv, P: (s, t) => [p[0] + U[0] * s + V[0] * t, p[1] + U[1] * s + V[1] * t], bb: bbox(p, 4) };
}
const PISO_PATIO = ['#b3ab9b', '#9c8f76', '#8f9064', '#b88f72', '#a7a49c'];   // concreto, tierra, pasto seco, loseta, cemento
const ROPA = ['#d9443a', '#3b7fd1', '#f2f2f2', '#f0c23b', '#4fae5c', '#e27fb0', '#7a5bb5', '#2e2e2e'];
// ---------- jardines de las casas ----------
// pasto corto de varios tipos (regado, kikuyo, seco, amarillento y con calvas de tierra) en manchones de orilla
// irregular, y plantas de las que hay en las casas de Tijuana: arbustos, bugambilias, magueyes, nopales y rosales.
// Todo va pintado en el piso del trozo (no estorba el paso).
const TONOS_PASTO = ['rgba(80,140,40,0.2)', 'rgba(35,75,20,0.22)', 'rgba(205,185,105,0.42)', 'rgba(170,160,70,0.3)', 'rgba(110,150,60,0.12)'];
function manchonPasto(ctx, x, y, rad, rnd) {
  const tono = (rnd() * TONOS_PASTO.length) | 0, n = 4 + ((rnd() * 4) | 0), bolas = [];
  for (let i = 0; i < n; i++) { const a = rnd() * 6.283, d = rad * rnd() * 0.6; bolas.push([x + Math.cos(a) * d, y + Math.sin(a) * d, rad * (0.35 + rnd() * 0.35)]); }
  ctx.beginPath(); for (const [a, b, r] of bolas) { ctx.moveTo(a + r, b); ctx.arc(a, b, r, 0, 7); }
  ctx.fillStyle = areaFill(ctx, 0); ctx.fill(); ctx.fillStyle = TONOS_PASTO[tono]; ctx.fill();
  // calvas de tierra en el seco y el amarillento
  if (tono >= 2 && tono <= 3) { ctx.fillStyle = 'rgba(140,125,95,0.55)'; ctx.beginPath(); for (let i = 0; i < 3; i++) { const [a, b, r] = bolas[(rnd() * n) | 0], q = r * 0.3 * rnd() + 0.6; ctx.moveTo(a + q, b); ctx.arc(a, b, q, 0, 7); } ctx.fill(); }
  // la orilla: hojitas que se salen para que no sea un circulo
  const o = new Path2D(), c = new Path2D();
  for (const [a, b, r] of bolas) for (let k = 0; k < r * 3; k++) {
    const q = rnd() * 6.283, l = 0.5 + rnd() * 0.9, px = a + Math.cos(q) * r * 0.97, py = b + Math.sin(q) * r * 0.97, d = q + (rnd() - 0.5) * 1.2;
    (k % 2 ? o : c).moveTo(px, py); (k % 2 ? o : c).lineTo(px + Math.cos(d) * l, py + Math.sin(d) * l);
  }
  ctx.lineCap = 'round'; ctx.lineWidth = 0.5;
  ctx.strokeStyle = tono === 2 ? 'rgba(150,130,70,0.45)' : 'rgba(40,70,20,0.4)'; ctx.stroke(o);
  ctx.strokeStyle = tono === 2 ? 'rgba(215,200,130,0.45)' : 'rgba(140,180,80,0.4)'; ctx.stroke(c);
}
const PLANTAS = ['arbusto', 'bugambilia', 'maguey', 'nopal', 'rosal', 'arbusto', 'bugambilia'];
function planta(ctx, x, y, que, rnd) {
  const bola = (a, b, r, col) => { ctx.fillStyle = col; ctx.beginPath(); ctx.arc(a, b, r, 0, 7); ctx.fill(); };
  if (que === 'maguey' || que === 'nopal') {
    ctx.fillStyle = 'rgba(0,0,0,0.25)'; ctx.beginPath(); ctx.ellipse(x + 1.5, y + 1.8, 3.2, 2.6, 0, 0, 7); ctx.fill();
  }
  if (que === 'maguey') { // pencas puntiagudas en estrella, azul grisaceo
    const n = 9 + ((rnd() * 4) | 0), L = 3 + rnd() * 2, a0 = rnd() * 6.3;
    for (let i = 0; i < n; i++) {
      const a = a0 + i / n * 6.283, l = L * (0.7 + rnd() * 0.35), w = 0.32;
      ctx.fillStyle = i % 2 ? '#7d9a90' : '#9bb5a8'; ctx.beginPath(); ctx.moveTo(x + Math.cos(a - w) * 0.8, y + Math.sin(a - w) * 0.8);
      ctx.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l); ctx.lineTo(x + Math.cos(a + w) * 0.8, y + Math.sin(a + w) * 0.8); ctx.fill();
    }
    bola(x, y, 0.8, '#6f8a80');
  } else if (que === 'nopal') { // pencas ovaladas verdes con sus espinitas
    for (let i = 0; i < 4 + rnd() * 3; i++) {
      const a = rnd() * 6.283, d = rnd() * 2.2, px = x + Math.cos(a) * d, py = y + Math.sin(a) * d;
      ctx.fillStyle = i % 2 ? '#4f7f34' : '#649a42'; ctx.beginPath(); ctx.ellipse(px, py, 1.9, 1.2, rnd() * 3, 0, 7); ctx.fill();
      ctx.fillStyle = 'rgba(230,230,200,0.7)'; ctx.fillRect(px - 0.5, py - 0.3, 0.3, 0.3); ctx.fillRect(px + 0.4, py + 0.2, 0.3, 0.3);
    }
    if (rnd() < 0.4) bola(x + 1.2, y - 1.5, 0.6, '#c2304a'); // una tuna
  } else { // arbustos: bolitas oscuras con luz, y flores segun el tipo
    const r = que === 'rosal' ? 1.6 + rnd() : 2 + rnd() * 1.6, bs = [];
    for (let i = 0; i < 4; i++) { const a = rnd() * 6.283, d = r * 0.5 * rnd(); bs.push([x + Math.cos(a) * d, y + Math.sin(a) * d, r * (0.55 + rnd() * 0.3)]); }
    ctx.fillStyle = 'rgba(0,0,0,0.25)'; ctx.beginPath(); for (const [a, b, q] of bs) { ctx.moveTo(a + 1.4 + q, b + 1.6); ctx.arc(a + 1.4, b + 1.6, q, 0, 7); } ctx.fill();
    ctx.fillStyle = que === 'bugambilia' ? '#3d5a2a' : '#2f5526'; ctx.beginPath(); for (const [a, b, q] of bs) { ctx.moveTo(a + q, b); ctx.arc(a, b, q, 0, 7); } ctx.fill();
    for (const [a, b, q] of bs) bola(a - q * 0.25, b - q * 0.25, q * 0.6, '#4f7a38');
    const flor = que === 'bugambilia' ? ['#d0257a', '#e0459a', '#b81c66'][(rnd() * 3) | 0] : que === 'rosal' ? ['#d6303a', '#f2d24a', '#f4f0e8', '#e98fb0'][(rnd() * 4) | 0] : null;
    if (flor) { ctx.fillStyle = flor; const n = que === 'bugambilia' ? 14 : 6; for (let i = 0; i < n; i++) { const [a, b, q] = bs[(rnd() * bs.length) | 0], t = rnd() * 6.283, d = rnd() * q; ctx.beginPath(); ctx.arc(a + Math.cos(t) * d, b + Math.sin(t) * d, 0.55 + rnd() * 0.35, 0, 7); ctx.fill(); } }
  }
}
// arbolito de patio (limonero, naranjo o aguacate) pintado en el piso, con su sombra
function arbolPatio(ctx, x, y, rnd) {
  const que = (rnd() * 3) | 0, R = que === 2 ? 4.5 + rnd() * 1.5 : 3.2 + rnd() * 1.2;
  ctx.fillStyle = 'rgba(0,0,0,0.25)'; ctx.beginPath(); ctx.arc(x + R * 0.4, y + R * 0.45, R, 0, 7); ctx.fill();
  const bs = []; for (let i = 0; i < 5; i++) { const a = i / 5 * 6.283 + rnd(), d = R * 0.4; bs.push([x + Math.cos(a) * d, y + Math.sin(a) * d, R * (0.5 + rnd() * 0.15)]); }
  ctx.fillStyle = que === 2 ? '#24401f' : '#2d5124'; ctx.beginPath(); ctx.arc(x, y, R * 0.6, 0, 7); for (const [a, b, q] of bs) { ctx.moveTo(a + q, b); ctx.arc(a, b, q, 0, 7); } ctx.fill();
  ctx.fillStyle = que === 2 ? '#3b6130' : '#4a7a36'; for (const [a, b, q] of bs) { ctx.beginPath(); ctx.arc(a - q * 0.25, b - q * 0.25, q * 0.6, 0, 7); ctx.fill(); }
  if (que < 2) { ctx.fillStyle = que ? '#f0a020' : '#e8d43a'; for (let i = 0; i < 7; i++) { const [a, b, q] = bs[i % 5], t = rnd() * 6.283; ctx.beginPath(); ctx.arc(a + Math.cos(t) * q * 0.7, b + Math.sin(t) * q * 0.7, 0.6, 0, 7); ctx.fill(); } }
}
// jardincitos alrededor de las casas: manchones de pasto y plantas pegados a la casa, por fuera (lo que caiga en la
// calle o la banqueta lo tapan despues; lo que caiga bajo la casa, la casa). No en zonas de comercio o industria
function* pintarJardines(ctx, bl, ar) {
  const zonas = ar.filter(a => a.k === 4 || a.k === 5); let hay = 0;
  for (const b of bl) {
    if (!b.casa && !(b.h < 12 && hash(b.id * 7 + 1) % 4 === 0)) continue;
    const rnd = mulberry(b.id * 31 + 7); if (rnd() > 0.85) continue;
    const mx = (b.bb[0] + b.bb[2]) / 2, my = (b.bb[1] + b.bb[3]) / 2;
    if (zonas.length && zonas.some(a => mx >= a.bb[0] && mx <= a.bb[2] && my >= a.bb[1] && my <= a.bb[3] && pip(mx, my, a.p))) continue;
    const orilla = (o) => { const lado = (rnd() * 4) | 0, t = rnd(), w = b.bb[2] - b.bb[0], h = b.bb[3] - b.bb[1];
      return lado === 0 ? [b.bb[0] + w * t, b.bb[1] - o] : lado === 1 ? [b.bb[2] + o, b.bb[1] + h * t] : lado === 2 ? [b.bb[0] + w * t, b.bb[3] + o] : [b.bb[0] - o, b.bb[1] + h * t]; };
    const n = 2 + ((rnd() * 4) | 0);
    for (let i = 0; i < n; i++) { const [x, y] = orilla(1 + rnd() * 8); manchonPasto(ctx, x, y, 6 + rnd() * 9, rnd); }
    const m = (rnd() * 4) | 0;
    for (let i = 0; i < m; i++) { const [x, y] = orilla(1.5 + rnd() * 3); planta(ctx, x, y, PLANTAS[(rnd() * PLANTAS.length) | 0], rnd); }
    if (++hay % 12 === 0) yield; // de doce en doce casas: una colonia llena de casas costaba un paso muy largo
  }
  if (hay % 12) yield;
}
function pintarSuelo(ctx, e) {
  const { P, lu, lv } = e, r = mulberry(e.id * 2654435761);
  const caja = (s0, t0, s1, t1) => { ctx.beginPath(); for (const [s, t] of [[s0, t0], [s1, t0], [s1, t1], [s0, t1]]) ctx.lineTo(...P(s, t)); ctx.closePath(); };
  const bolita = (s, t, rad, col) => { const [x, y] = P(s, t); ctx.fillStyle = col; ctx.beginPath(); ctx.arc(x, y, rad, 0, 7); ctx.fill(); };
  const rot = Math.atan2(e.U[1], e.U[0]);
  if (e.tipo === 'patio') {
    // piso, barda alrededor (menos del lado de la casa) y las cosas del patio
    // la mitad de los patios son de pasto (regado, kikuyo, seco...), los demas de concreto, tierra o loseta
    const verde = e.id % 10 < 5;
    caja(0, 0, lu, lv);
    if (verde) { ctx.fillStyle = areaFill(ctx, 0); ctx.fill(); ctx.fillStyle = TONOS_PASTO[e.id % TONOS_PASTO.length]; ctx.fill(); }
    else { ctx.fillStyle = PISO_PATIO[e.id % PISO_PATIO.length]; ctx.fill(); }
    ctx.lineCap = 'butt';
    const barda = (w, col, o) => { ctx.strokeStyle = col; ctx.lineWidth = w; ctx.beginPath(); ctx.moveTo(...P(o, 0)); ctx.lineTo(...P(o, lv - o)); ctx.lineTo(...P(lu - o, lv - o)); ctx.lineTo(...P(lu - o, 0)); ctx.stroke(); };
    barda(3.4, 'rgba(0,0,0,0.25)', 0.2); barda(2.2, '#cfc6b3', 1.1);
    // plantas pegadas a la barda y, en algunos, un limonero, naranjo o aguacate
    if (lu > 12 && lv > 10) {
      const np = (verde ? 2 : 0) + ((r() * 3) | 0);
      for (let k = 0; k < np; k++) { const enS = r() < 0.5, [x, y] = enS ? P(4 + r() * (lu - 8), lv - 4) : P(r() < 0.5 ? 4 : lu - 4, 4 + r() * (lv - 8)); planta(ctx, x, y, PLANTAS[(r() * PLANTAS.length) | 0], r); }
      if (lu > 20 && lv > 16 && r() < (verde ? 0.45 : 0.2)) { const [x, y] = P(lu * (0.25 + r() * 0.5), lv * (0.35 + r() * 0.4)); arbolPatio(ctx, x, y, r); }
    }
    const n = 2 + (r() * 3 | 0), puestos = [];
    for (let k = 0; k < n; k++) {
      const que = (r() * 8) | 0, s = 5 + r() * (lu - 10), t = 4 + r() * (lv - 8);
      if (lu < 14 || lv < 12 || puestos.some(([a, b]) => Math.abs(a - s) < 9 && Math.abs(b - t) < 9)) continue;
      puestos.push([s, t]);
      if (que === 0 && lu > 26) { // tendedero con ropa
        const t0 = Math.min(lv - 5, t), [x0, y0] = P(5, t0), [x1, y1] = P(lu - 5, t0);
        ctx.strokeStyle = 'rgba(40,40,40,0.7)'; ctx.lineWidth = 0.6; ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
        for (let q = 8; q < lu - 8; q += 4 + r() * 3) {
          const [x, y] = P(q, t0); ctx.save(); ctx.translate(x, y); ctx.rotate(rot);
          ctx.fillStyle = ROPA[(r() * ROPA.length) | 0]; ctx.fillRect(-1.6, -0.3, 3.2, 2.2 + r() * 2); ctx.restore();
        }
      } else if (que === 1) { bolita(s + 0.6, t + 0.6, 2.4, 'rgba(0,0,0,0.3)'); bolita(s, t, 2.3, '#e9e6df'); bolita(s, t, 1, '#8b8f94'); } // tanque de gas
      else if (que === 2) { for (let m = 0; m < 3; m++) { bolita(s + m * 3, t, 1.5, '#b4603e'); bolita(s + m * 3, t, 1, '#4f8a3a'); } } // macetas
      else if (que === 3) { bolita(s, t, 2.6, '#222'); ctx.strokeStyle = '#777'; ctx.lineWidth = 0.4; for (let m = -1; m <= 1; m++) { ctx.beginPath(); ctx.moveTo(...P(s - 2, t + m)); ctx.lineTo(...P(s + 2, t + m)); ctx.stroke(); } } // asador
      else if (que === 4) { caja(s - 3, t - 2.5, s + 3, t + 2.5); ctx.fillStyle = '#8a5a35'; ctx.fill(); caja(s - 3, t - 2.5, s + 3, t); ctx.fillStyle = '#6b4226'; ctx.fill(); bolita(s, t + 1.6, 1, '#2a1c12'); } // casita del perro
      else if (que === 5) { caja(s - 2.5, t - 2, s + 2.5, t + 2); ctx.fillStyle = '#9fa3a6'; ctx.fill(); caja(s - 1.5, t - 1.2, s + 1.5, t + 1.2); ctx.fillStyle = '#6f8fa3'; ctx.fill(); } // lavadero
      else if (que === 6) { for (let m = 0; m < 2; m++) { caja(s + m * 4 - 1.3, t - 1.3, s + m * 4 + 1.3, t + 1.3); ctx.fillStyle = '#f4f2ec'; ctx.fill(); } } // sillas de plastico
      else { ctx.strokeStyle = '#1d1d1d'; ctx.lineWidth = 1.2; const [x, y] = P(s, t); ctx.beginPath(); ctx.arc(x, y, 2.2, 0, 7); ctx.stroke(); } // llanta
    }
  } else if (e.tipo === 'baldio') {
    // yerbas secas, llantas, basurita y a veces una malla ciclonica
    caja(0, 0, lu, lv); ctx.fillStyle = 'rgba(110,98,60,0.06)'; ctx.fill();
    const n = Math.round(lu * lv / 90);
    for (let k = 0; k < n; k++) {
      const [x, y] = P(r() * lu, r() * lv), c = r() < 0.6 ? '#7d7a45' : r() < 0.5 ? '#94864f' : '#5f6b3a';
      ctx.strokeStyle = c; ctx.lineWidth = 0.8; ctx.beginPath();
      for (let m = 0; m < 4; m++) { const a = r() * 6.3, l = 1.5 + r() * 2.5; ctx.moveTo(x, y); ctx.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l); }
      ctx.stroke();
    }
    for (let k = 0; k < 1 + r() * 3; k++) { const [x, y] = P(r() * lu, r() * lv); ctx.strokeStyle = '#1b1b1b'; ctx.lineWidth = 1.3; ctx.beginPath(); ctx.arc(x, y, 2.2, 0, 7); ctx.stroke(); }
    for (let k = 0; k < lu * lv / 400; k++) { const [x, y] = P(r() * lu, r() * lv); ctx.fillStyle = ROPA[(r() * ROPA.length) | 0]; ctx.fillRect(x, y, 1.2, 0.8); }
    if (r() < 0.5) { ctx.setLineDash([1.5, 1.5]); ctx.strokeStyle = 'rgba(150,155,160,0.8)'; ctx.lineWidth = 0.8; caja(1, 1, lu - 1, lv - 1); ctx.stroke(); ctx.setLineDash([]); }
  } else {
    // cancha de tierra: rayas de cal medio borradas y porterias
    caja(0, 0, lu, lv); ctx.fillStyle = '#b4a17c'; ctx.fill();
    for (let k = 0; k < 14; k++) { const [x, y] = P(r() * lu, r() * lv); ctx.fillStyle = 'rgba(120,100,70,0.18)'; ctx.beginPath(); ctx.arc(x, y, 4 + r() * 8, 0, 7); ctx.fill(); }
    const m = 5, cal = 'rgba(245,242,230,0.6)';
    ctx.strokeStyle = cal; ctx.lineWidth = 1.2; caja(m, m, lu - m, lv - m); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(...P(lu / 2, m)); ctx.lineTo(...P(lu / 2, lv - m)); ctx.stroke();
    const [cx, cy] = P(lu / 2, lv / 2); ctx.beginPath(); ctx.arc(cx, cy, Math.min(lv / 6, 18), 0, 7); ctx.stroke();
    for (const [s0, s1] of [[m, m + 18], [lu - m, lu - m - 18]]) { caja(s0, lv / 2 - 22, s1, lv / 2 + 22); ctx.stroke(); }
    ctx.strokeStyle = '#fafafa'; ctx.lineWidth = 1.6;
    for (const [s0, s1] of [[m, m - 4], [lu - m, lu - m + 4]]) {
      ctx.beginPath(); ctx.moveTo(...P(s0, lv / 2 - 9)); ctx.lineTo(...P(s1, lv / 2 - 9)); ctx.lineTo(...P(s1, lv / 2 + 9)); ctx.lineTo(...P(s0, lv / 2 + 9)); ctx.stroke();
    }
  }
}
// el estacionamiento en el trozo: asfalto con orilla de concreto, rayas de los cajones, jardineras y postes de luz
function pintarEstacionamiento(ctx, e) {
  const { P, lu, nc, s0 } = e;
  trace(ctx, e.p, true); ctx.fillStyle = areaFill(ctx, TEX_ASFALTO); ctx.fill();
  ctx.fillStyle = 'rgba(255,250,235,0.07)'; ctx.fill();
  ctx.lineWidth = 2.2; ctx.strokeStyle = COL.curb; ctx.stroke();
  ctx.strokeStyle = 'rgba(236,234,222,0.7)'; ctx.lineWidth = 1.1; ctx.beginPath();
  for (const [t0] of e.filas) {
    for (let i = 0; i <= nc; i++) { const s = s0 + i * CAJON_W; ctx.moveTo(...P(s, t0)); ctx.lineTo(...P(s, t0 + CAJON_L)); }
    ctx.moveTo(...P(s0, t0)); ctx.lineTo(...P(s0 + nc * CAJON_W, t0));
  }
  ctx.stroke();
  for (const t0 of e.jardineras) {
    ctx.beginPath(); for (const [s, t] of [[s0, t0], [s0 + nc * CAJON_W, t0], [s0 + nc * CAJON_W, t0 + JARDINERA], [s0, t0 + JARDINERA]]) ctx.lineTo(...P(s, t));
    ctx.closePath(); ctx.fillStyle = areaFill(ctx, 0); ctx.fill(); ctx.lineWidth = 1.2; ctx.strokeStyle = COL.curb; ctx.stroke();
  }
  // postes: en las jardineras, o a la orilla del fondo si no hay
  const postes = e.jardineras.length ? e.jardineras.map(t => t + JARDINERA / 2) : [e.lv - 1.2 * M];
  for (const t of postes) for (let s = 6 * M; s < lu - 3 * M; s += 22 * M) {
    const [x, y] = P(s, t);
    ctx.fillStyle = 'rgba(0,0,0,0.3)'; ctx.beginPath(); ctx.arc(x + 2, y + 2, 2.6, 0, 7); ctx.fill();
    ctx.fillStyle = '#4a4d52'; ctx.beginPath(); ctx.arc(x, y, 2.6, 0, 7); ctx.fill();
    ctx.fillStyle = '#e8e2c8'; ctx.beginPath(); ctx.arc(x - 0.6, y - 0.6, 1.1, 0, 7); ctx.fill();
  }
}
const gridDel = (g, reg, b, cell) => {
  for (let cx = Math.floor(b[0] / cell); cx <= Math.floor(b[2] / cell); cx++) for (let cy = Math.floor(b[1] / cell); cy <= Math.floor(b[3] / cell); cy++) {
    const k = GK(cx, cy), a = g.get(k); if (!a) continue;
    const q = a.filter(o => o.reg !== reg); if (q.length) g.set(k, q); else g.delete(k);
  }
};
const alCargarRegion = []; // avisos: (region) => ...
// plazas comerciales: los edificios de las zonas comerciales del mapa (landuse retail/commercial), las plazas que puso
// rellenar.py y los de junto a los centros comerciales conocidos llevan fachadas de tiendas (ver fachadaTiendas)
const PLAZAS_CONOCIDAS = landmarks.filter(l => /^(Plaza Río Tijuana|Plaza de la Tecnología|FrikiPlaza|Galerías Hipódromo|Macroplaza)$/.test(l.name));
function zonaComercial(x, y) {
  for (const i of chunkAreas.get(GK(Math.floor(x / CHUNK), Math.floor(y / CHUNK))) || []) {
    const a = areas[i]; if (a.k === 4 && x >= a.bb[0] && x <= a.bb[2] && y >= a.bb[1] && y <= a.bb[3] && pip(x, y, a.p)) return true;
  }
  return false;
}
function esComercio(p, h, tipo, casa) {
  if (tipo === 2) return true;
  if (tipo === 1 || casa || h > 20) return false;
  let ar = 0, cx = 0, cy = 0; const n = p.length / 2;
  for (let i = 0; i < n; i++) { const j = (i + 1) % n; ar += p[i * 2] * p[j * 2 + 1] - p[j * 2] * p[i * 2 + 1]; cx += p[i * 2]; cy += p[i * 2 + 1]; }
  ar = Math.abs(ar) / 2 / (M * M); cx /= n; cy /= n; // m2 y el centro
  if (ar < 150) return false;
  return zonaComercial(cx, cy) || (ar >= 300 && PLAZAS_CONOCIDAS.some(l => Math.hypot(l.x - cx, l.y - cy) < 350));
}
// cada archivo de region llama a esto con sus edificios en texto (JSON)
window.TJ_REG = (k, txt) => {
  const r = regiones.get(k); if (!r || r.estado === 2) return;
  const base = r.n * 100000;
  // ademas de los edificios: lo que puso tools/rellenar.py: casitas (tipo 1, con el fondo de su patio en dm) y
  // plazas (2), estacionamientos (h = -1), lotes baldios (-2) y canchas de tierra (-3)
  r.b = []; r.est = []; r.suelo = [];
  JSON.parse(txt).forEach(([h, co, tipo, patio], i) => {
    const p = ptsD(co);
    if (h === -1) { r.est.push(estacionamiento(p, base + i, k)); return; }
    if (h < 0) { r.suelo.push(suelo(h === -2 ? 'baldio' : 'cancha', p, base + i, k)); return; }
    if (patio) {
      // el patio va atras de la casa (p0 -> p1 es el frente, hacia la calle) y del mismo ancho
      const vx = p[6] - p[0], vy = p[7] - p[1], lv = Math.hypot(vx, vy), d = patio * S;
      const ax = vx / lv * d, ay = vy / lv * d;
      r.suelo.push(suelo('patio', [p[6], p[7], p[4], p[5], p[4] + ax, p[5] + ay, p[6] + ax, p[7] + ay], base + i, k));
    }
    const bb = bbox(p, 0), sh = Math.min(h * 0.45, 30) * M / 5 * 1.6, hc = hash(co[0] * 7 + co[1]);
    // una casa: las casitas de rellenar.py y los edificios chicos de una o dos plantas del mapa (de hasta 18 m de lado)
    const casa = tipo === 1 || (tipo !== 2 && h < 8 && bb[2] - bb[0] < 90 && bb[3] - bb[1] < 90);
    const techos = casa ? TECHOS_CASITA : tipo === 2 ? TECHOS_PLAZA : ROOFS;
    // id: el orden de dibujo dentro de un trozo no depende de que region cargo primero
    const b = { id: base + i, reg: k, h, p, sh, bb, sbb: bbox(p, Math.max(sh, EXTRA_UP) + 2), col: techos[hc % techos.length], casita: tipo === 1, casa };
    if (esComercio(p, h, tipo, casa)) b.comercio = true;
    if (esDomo(b)) { const R = (bb[2] - bb[0] + bb[3] - bb[1]) / 4; b.esfera = R; b.casa = false; b.sh = R * 0.4; b.L = EXTRA_UP; b.sbb = bbox(p, R * 2.4 + 4); if (!DOMOS.some(o => o.id === b.id)) DOMOS.push(b); }
    r.b.push(b);
  });
  for (const b of r.b) { gridAdd(chunkBlds, b, b.sbb, CHUNK); gridAdd(bldGrid, b, b.bb, BCELL); }
  for (const e of r.est) gridAdd(chunkEst, e, e.bb, CHUNK);
  for (const e of r.suelo) gridAdd(chunkSuelo, e, e.bb, CHUNK);
  for (const a of chunkBlds.values()) if (a.length > 1 && a[a.length - 1].reg === k) a.sort((x, y) => x.id - y.id);
  r.estado = 2; r.uso = performance.now();
  for (const f of alCargarRegion) f(r);
};
function pedirRegion(r) {
  if (r.estado) return;
  r.estado = 1;
  const el = document.createElement('script');
  el.src = 'data/reg/' + r.k + '.js';
  el.onload = () => el.remove();
  // sin el archivo (no deberia pasar) la region se da por lista y vacia, para que el mapa no se quede esperando
  el.onerror = () => { el.remove(); if (r.estado === 1) window.TJ_REG(r.k, '[]'); };
  document.body.appendChild(el);
}
function soltarRegion(r) {
  for (const b of r.b) { gridDel(chunkBlds, r.k, b.sbb, CHUNK); gridDel(bldGrid, r.k, b.bb, BCELL); }
  for (const e of r.est) gridDel(chunkEst, r.k, e.bb, CHUNK);
  for (const e of r.suelo) gridDel(chunkSuelo, r.k, e.bb, CHUNK);
  r.b = null; r.est = null; r.suelo = null; r.estado = 0;
}
// las regiones que tocan el rectangulo; las pide si faltan y dice si ya estan todas
function regionesListas(x0, y0, x1, y1) {
  let ok = true; const t = performance.now(), vistas = new Set();
  for (let cx = Math.floor(x0 / REG_PX); cx <= Math.floor(x1 / REG_PX); cx++) for (let cy = Math.floor(y0 / REG_PX); cy <= Math.floor(y1 / REG_PX); cy++) {
    for (const r of regGrid.get(GK(cx, cy)) || []) {
      if (vistas.has(r) || r.bb[0] > x1 || r.bb[2] < x0 || r.bb[1] > y1 || r.bb[3] < y0) continue;
      vistas.add(r); r.uso = t;
      if (r.estado !== 2) { ok = false; pedirRegion(r); }
    }
  }
  return ok;
}
// suelta las regiones que llevan mas tiempo sin usarse, lejos de (x, y), si hay demasiadas cargadas
function soltarLejanas(x, y) {
  const cargadas = [...regiones.values()].filter(r => r.estado === 2);
  if (cargadas.length <= REG_MAX) return;
  const lejos = cargadas.filter(r => Math.max(r.bb[0] - x, x - r.bb[2], r.bb[1] - y, y - r.bb[3]) > REG_CERCA * REG_PX).sort((a, b) => a.uso - b.uso);
  for (const r of lejos.slice(0, cargadas.length - REG_MAX)) soltarRegion(r);
}
// espera a que esten las regiones del rectangulo (al arrancar)
function esperarRegiones(x0, y0, x1, y1) {
  return new Promise(ok => { const t = () => regionesListas(x0, y0, x1, y1) ? ok() : setTimeout(t, 20); t(); });
}
const NCELL = 128;
const named = roads.map((r, i) => i).filter(i => roads[i].n >= 0 && roads[i].c <= 9);
const nameGrid = gridLineas(named.map(i => roads[i]), NCELL, roadPad);

function inBuilding(x, y) {
  const a = bldGrid.get(GK(Math.floor(x / BCELL), Math.floor(y / BCELL)));
  if (!a) return false;
  for (const b of a) { if (x < b.bb[0] || x > b.bb[2] || y < b.bb[1] || y > b.bb[3]) continue; if (pip(x, y, b.p)) return true; }
  return false;
}
// Las calles se dibujan encima de los edificios, asi que su franja (con banqueta) siempre es transitable.
// Cada tramo son 6 numeros en un solo arreglo (SEG): x0 y0 x1 y1, media franja con banqueta y medio asfalto;
// las celdas guardan el numero de tramo (un arreglo por tramo pesaba demasiado con el mapa grande)
const RCELL = 64;
const SEG = (() => {
  let n = 0;
  for (const r of roads) if (r.c <= 7) n += r.p.length / 2 - 1;
  return new Float32Array(Math.max(0, n) * 6);
})();
{
  let n = 0;
  for (const r of roads) {
    if (r.c > 7) continue;
    const half = (r.w / 2 + (r.c <= 6 ? SIDEWALK : 0.5)) * M, p = r.p;
    for (let q = 0; q < p.length - 2; q += 2, n++) {
      const o = n * 6;
      SEG[o] = p[q]; SEG[o + 1] = p[q + 1]; SEG[o + 2] = p[q + 2]; SEG[o + 3] = p[q + 3]; SEG[o + 4] = half; SEG[o + 5] = r.w / 2 * M;
    }
  }
}
// cada tramo en las celdas que toca su franja con banqueta
const RSG = rejillaDensa((emit) => {
  for (let n = 0, o = 0; o < SEG.length; n++, o += 6) {
    const h = SEG[o + 4];
    const x0 = Math.floor((Math.min(SEG[o], SEG[o + 2]) - h) / RCELL), x1 = Math.floor((Math.max(SEG[o], SEG[o + 2]) + h) / RCELL);
    const y0 = Math.floor((Math.min(SEG[o + 1], SEG[o + 3]) - h) / RCELL), y1 = Math.floor((Math.max(SEG[o + 1], SEG[o + 3]) + h) / RCELL);
    for (let cx = x0; cx <= x1; cx++) for (let cy = y0; cy <= y1; cy++) emit(cx, cy, n);
  }
});
const celdaSeg = (x, y) => RSG.celda(Math.floor(x / RCELL), Math.floor(y / RCELL));
function onRoad(x, y) {
  const c = celdaSeg(x, y); if (c < 0) return false;
  for (let j = RSG.O[c], e = RSG.O[c + 1]; j < e; j++) { const o = RSG.V[j] * 6; if (segDist(x, y, SEG[o], SEG[o + 1], SEG[o + 2], SEG[o + 3]) < SEG[o + 4]) return true; }
  return false;
}
function onAsfalto(x, y, pad) {
  const c = celdaSeg(x, y); if (c < 0) return false;
  for (let j = RSG.O[c], e = RSG.O[c + 1]; j < e; j++) { const o = RSG.V[j] * 6; if (segDist(x, y, SEG[o], SEG[o + 1], SEG[o + 2], SEG[o + 3]) < SEG[o + 5] + pad) return true; }
  return false;
}
// agua (el canal del rio Tijuana y demas): las areas de agua y la linea del rio. Como con los edificios,
// la franja de una calle encima (los puentes) si se puede pasar
const waterAreas = areas.filter(a => a.k === AREA_AGUA);
// los canales (el del rio Tijuana, el Alamar y los arroyos entubados): las aguas largas, angostas y mas o menos
// derechas (no el mar, la presa ni los estanques). Se pintan como canalizacion de concreto (ver pintarCanal):
// la barda, el talud (b px) y el piso (f px), y el agua nomas en medio
for (const a of waterAreas) {
  const p = a.p, n = p.length;
  let A = 0, P = 0;
  for (let i = 0; i < n; i += 2) { const j = (i + 2) % n; A += p[i] * p[j + 1] - p[j] * p[i + 1]; P += Math.hypot(p[j] - p[i], p[j + 1] - p[i + 1]); }
  A = Math.abs(A) / 2;
  const W = 2 * A / P, largo = P * P / (4 * Math.PI * A), derecho = Math.hypot(a.bb[2] - a.bb[0], a.bb[3] - a.bb[1]) / (P / 2);
  if (largo >= 5 && W < 700 && derecho >= 0.6) a.canal = { b: Math.max(5, Math.min(45, W * 0.16)), f: Math.max(3, Math.min(80, W * 0.18)) };
  else a.lago = { W, giro: 1, orilla: null };
}
// el mapa trae algunos lagos repetidos (el mismo poligono dos veces): el segundo no se pinta
{ const vistos = new Set();
  for (const a of waterAreas) if (a.lago) { const k = a.bb.map(Math.round).join() + ',' + a.p.length; if (vistos.has(k)) a.lago.dup = true; vistos.add(k); } }
const WCELL = 256; // celdas grandes: los poligonos de agua son pocos pero enormes
const waterGrid = gridIndex(waterAreas, WCELL, 'bb');
// los arroyos chicos (lineas de clase 11 que van casi todo fuera de las areas de agua) se omiten: no se pintan ni
// estorban. En el mapa pasaban por debajo de las calles y salian por encima en partes, tapaban el paso y quedaban
// edificios encima del agua. Se quedan las lineas del rio grande (el Rio Tijuana por la Zona Rio y desde la presa, el
// Alamar), que van sobre todo dentro de su canalizacion
const enAreaAgua = (x, y) => { const c = waterGrid.get(GK(Math.floor(x / WCELL), Math.floor(y / WCELL)));
  return !!c && c.some(i => { const w = waterAreas[i]; return x >= w.bb[0] && x <= w.bb[2] && y >= w.bb[1] && y <= w.bb[3] && pip(x, y, w.p); }); };
for (const r of roads) if (r.c === 11) {
  let L = 0, dentro = 0; const p = r.p;
  for (let q = 0; q < p.length - 2; q += 2) { const l = Math.hypot(p[q + 2] - p[q], p[q + 3] - p[q + 1]); L += l; if (enAreaAgua((p[q] + p[q + 2]) / 2, (p[q + 1] + p[q + 3]) / 2)) dentro += l; }
  r.rio = dentro >= L * 0.5;
}
const esRio = (r) => r.c === 11 && r.rio;
// los rios (lineas de clase 11): sus tramos en un arreglo (x0 y0 x1 y1) y en una rejilla densa, como las calles
const RIO_W = ROAD_W[11] / 2 * M;
const RIO = (() => {
  const o = [];
  for (const r of roads) if (esRio(r)) for (let q = 0; q < r.p.length - 2; q += 2) o.push(r.p[q], r.p[q + 1], r.p[q + 2], r.p[q + 3]);
  return new Float32Array(o);
})();
const riverSegGrid = rejillaDensa((emit) => {
  for (let n = 0, o = 0; o < RIO.length; n++, o += 4) {
    for (let cx = Math.floor((Math.min(RIO[o], RIO[o + 2]) - RIO_W) / RCELL); cx <= Math.floor((Math.max(RIO[o], RIO[o + 2]) + RIO_W) / RCELL); cx++)
      for (let cy = Math.floor((Math.min(RIO[o + 1], RIO[o + 3]) - RIO_W) / RCELL); cy <= Math.floor((Math.max(RIO[o + 1], RIO[o + 3]) + RIO_W) / RCELL); cy++) emit(cx, cy, n);
  }
});
function inWater(x, y) {
  const a = waterGrid.get(GK(Math.floor(x / WCELL), Math.floor(y / WCELL)));
  if (a) for (const i of a) { const w = waterAreas[i]; if (x >= w.bb[0] && x <= w.bb[2] && y >= w.bb[1] && y <= w.bb[3] && pip(x, y, w.p)) return true; }
  const s = riverSegGrid.get(GK(Math.floor(x / RCELL), Math.floor(y / RCELL)));
  if (s) for (const g of s) { const o = g * 4; if (segDist(x, y, RIO[o], RIO[o + 1], RIO[o + 2], RIO[o + 3]) < RIO_W) return true; }
  return false;
}
// La ciudad se pierde en la neblina en las orillas del mapa (oeste, sur y este; al norte esta la linea):
// la neblina es espesa en la orilla y se abre hacia adentro en NIEBLA_ANCHO; no se puede pasar de NIEBLA px
// (ahi ya casi no se ve nada). La camara puede asomarse NIEBLA_FUERA px mas alla, que es pura neblina.
const NIEBLA = 40 * M, NIEBLA_ANCHO = 170 * M, NIEBLA_FUERA = 80 * M;
const NIEBLA_TRAMO = 4096; // largo de las franjas de nubes de la neblina (ver makeNiebla)
const NIEBLA_LEJOS = 100 * M; // los paros y los destinos de taxi y entregas no caen tan adentro de la neblina
function enNiebla(x, y, d) { return x < d || x > WORLD_W - d || y > WORLD_H - d; }
function blocked(x, y) {
  return y < 4 || enNiebla(x, y, NIEBLA) || y < borderY(x) + 6 || ((inBuilding(x, y) || inWater(x, y)) && !onRoad(x, y));
}
function laneLat(e, k) {
  if (e.c <= MAJOR) return e.one ? [-1, 0, 1, 1][k & 3] * e.w / 3 : [1, 3][k & 1] * e.w / 8; // un sentido: 3 carriles (el 3 es el de la derecha)
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
// la zona de la ciudad (para el letrero de la calle), aproximada en metros desde la esquina noroeste del primer mapa:
// el canal del rio va de (500, 60) a (5900, 2950); 'a' es lo que se avanza a lo largo del canal y 'p' lo que
// se aleja de el hacia el surponiente. Donde no hay una zona clara (los cerros del sur) dice solo Tijuana.
function zonaDe(px, py) {
  const x = (px - REF_X) / M, y = (py - REF_Y) / M;
  // fase 4, el sur (al sur de 32.4435): San Antonio del Mar en la Escenica, Santa Fe y Natura
  if (y >= 11000) {
    if (x < -2500) return y > 12300 ? 'San Antonio del Mar' : 'Playas de Tijuana';
    if (x < 4500) return 'Santa Fe';
    if (x >= 9000 && x < 16000 && y >= 13000) return 'Natura';
    if (x < 9000) return 'Cañón del Sainz';
  }
  // fase 4, el oriente (de -116.878 para alla): El Florido y Terrazas del Valle
  if (x >= 15955) return y >= 9300 ? 'Terrazas del Valle' : 'El Florido';
  // fase 3: Playas, al poniente de -117.0864 (de la linea a la Escenica)
  if (x < -3600) return 'Playas de Tijuana';
  // el primer mapa (hasta 5913 m al oriente y 4755 al sur)
  if (x <= 5913 && y <= 4755) {
    const a = (x - 500) * 0.8816 + (y - 60) * 0.4718, p = -(x - 500) * 0.4718 + (y - 60) * 0.8816;
    if (y < 780 && x < 1350) return 'Zona Norte';
    if ((x < 1800 && y < 2150) || (p >= -500 && a < 1800)) return 'Zona Centro';
    if (p >= -700 && p < 1400 && a < 3900) return 'Zona Río';
    if (p > 0 && a >= 3900) return x > 4450 ? 'Hipódromo' : y > 3200 ? 'Chapultepec' : 'Agua Caliente';
    if (x >= 3600 && x < 5300 && y < 900) return 'Libertad';
  }
  // fase 1, al oriente de -116.9915: el aeropuerto junto a la linea, Otay al norte de 32.515 y La Mesa al sur
  // fase 2, al oriente de -116.96 y al sur de 32.478: el Cerro Colorado y La Presa
  if (x >= 8259 && y >= 7200) return Math.hypot(x - 14022, y - 7674) < 900 ? 'Cerro Colorado' : 'La Presa';
  if (x >= 5300) {
    if (y < 774 && x < 8730) return 'Aeropuerto';
    if (y < 3096) return 'Otay';
    if (Math.hypot(x - 7715, y - 4843) < 450) return 'Las 5 y 10';
    return 'La Mesa';
  }
  return 'Tijuana';
}
function streetAt(x, y) {
  let best = null, bd = 70;
  const cx = Math.floor(x / NCELL), cy = Math.floor(y / NCELL);
  for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) {
    const a = nameGrid.get(GK(cx + i, cy + j)); if (!a) continue;
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
  const key = (x, y) => Math.round(x * 4) * 4194304 + Math.round(y * 4);
  const cnt = new Map();
  const sel = roads.filter(filter);
  for (const r of sel) {
    const p = r.p, n = p.length / 2;
    for (let i = 0; i < n; i++) { const k = key(p[i * 2], p[i * 2 + 1]); cnt.set(k, (cnt.get(k) || 0) + (i === 0 || i === n - 1 ? 2 : 1)); }
  }
  const nodeId = new Map(), nodes = [], edges = [], adj = [];
  const node = (x, y) => { const k = key(x, y); let id = nodeId.get(k); if (id === undefined) { id = adj.length; nodeId.set(k, id); nodes.push(x, y); adj.push([]); } return id; };
  for (const r of sel) {
    const p = r.p, n = p.length / 2;
    let start = 0;
    for (let i = 1; i < n; i++) {
      if (i < n - 1 && cnt.get(key(p[i * 2], p[i * 2 + 1])) < 2) continue;
      const ep = p.subarray(start * 2, i * 2 + 2); // una vista de la linea de la calle, sin copiarla
      const cum = [0];
      for (let q = 2; q < ep.length; q += 2) cum.push(cum[cum.length - 1] + Math.hypot(ep[q] - ep[q - 2], ep[q + 1] - ep[q - 1]));
      const len = cum[cum.length - 1];
      if (len > 2) {
        // (cum en Float32Array: la mitad de memoria que el arreglo normal)
        const e = { p: ep, cum: Float32Array.from(cum), len, a: node(ep[0], ep[1]), b: node(ep[ep.length - 2], ep[ep.length - 1]),
          one: oneways && (r.f & 2) !== 0, puente: (r.f & 1) !== 0, w: r.w * M, c: r.c, n: r.n, id: edges.length };
        edges.push(e);
        adj[e.a].push({ e, dir: 1 });
        if (!e.one) adj[e.b].push({ e, dir: -1 });
      }
      start = i;
    }
  }
  // la rejilla da numeros de tramo (g.edges[i]); los nodos van como x, y seguidos en un Float32Array
  const GC = 256, grid = rejillaDensa((emit) => {
    for (const e of edges) for (let q = 0; q < e.p.length; q += 2) emit(Math.floor(e.p[q] / GC), Math.floor(e.p[q + 1] / GC), e.id);
  });
  return { nodes: new Float32Array(nodes), nN: adj.length, edges, adj, grid, GC };
}
const inMx = (r) => { const p = r.p; for (let i = 0; i < p.length; i += 2) if (p[i + 1] < borderY(p[i]) + 30) return false; return true; };
const traffic = buildGraph(r => r.c <= 6 && !(r.f & 4) && inMx(r), true);
// ---------- sobreruedas ----------
// Los mercados sobre ruedas de Tijuana en la calle donde se ponen (SanDiegoRed, Noro, ZETA). En la realidad cada uno
// es un dia o dos a la semana; aqui estan siempre. La calle queda cerrada a los carros (fuera del trafico y de las
// rutas, con vallas donde cruza otra calle) pero se camina: puestos con lona a los lados y la gente comprando en medio.
// cerca: un punto junto a la calle (px); largo: cuanto ocupa (m), centrado ahi
const SOBRERUEDAS = [
  { k: 'zonaNorte', nombre: 'Sobreruedas de la Zona Norte', calle: 'Avenida Miguel F. Martínez', cerca: [46800, 14300], largo: 400,
    dato: 'En la vida real, sábados y domingos, de la calle Primera rumbo a la línea.' },
  { k: 'villa', nombre: 'Sobreruedas de la Villa', calle: 'Avenida Antonio Villareal', cerca: [39600, 30700], largo: 500,
    dato: 'En la colonia Francisco Villa. En la vida real, los domingos (llega temprano).' },
  { k: 'playas', nombre: 'Sobreruedas de Playas', calle: 'Calle Paseo del Pedregal', cerca: [9530, 30500], largo: 300,
    dato: 'En la vida real, los lunes en Playas de Tijuana.' },
  { k: 'bellasArtes', nombre: 'Sobreruedas de Otay Bellas Artes', calle: 'Boulevard de las Bellas Artes', cerca: [97300, 11720], largo: 500,
    dato: 'De los más grandes: va de la garita de Otay rumbo al bulevar Internacional. En la vida real, los domingos.' },
  { k: 'modulos', nombre: 'Sobreruedas de Otay Módulos', calle: 'Avenida Sor Juana Inés de la Cruz', cerca: [101700, 8700], largo: 400,
    dato: 'En la vida real, los domingos desde las 6 de la mañana.' },
  { k: 'florido', nombre: 'Sobreruedas de El Florido', calle: 'Calle del Saucillo', cerca: [143000, 49300], largo: 450,
    dato: 'En la vida real, lunes, jueves y fines de semana (el fin es cuando más se llena).' },
  { k: 'curva', nombre: 'Sobreruedas de La Curva', calle: 'Calle Ruta Mariano Matamoros', cerca: [126000, 48000], largo: 600,
    dato: 'Por la Curva del Mariano Matamoros, rumbo al Pípila y Villa Fontana. En la vida real, los domingos.' },
  { k: 'taboada', nombre: 'Sobreruedas de la Sánchez Taboada', calle: 'Calle Cruz del Sur', cerca: [78200, 52800], largo: 400,
    dato: 'En la colonia Sánchez Taboada, sobre la Cruz del Sur.' },
];
const PUESTO_D = 2.6 * M;     // fondo de un puesto (lo ancho es lo que mide a lo largo de la calle)
const tianguis = [];          // tramos cerrados (de traffic): { e, t0, t1, sr } (t0..t1: lo que va de esquina a esquina)
const puestos = [];           // puestos y vallas: { x, y, a, l, d, cara, seed, valla, bb }
{
  const porNodo = new Map(), add = (n, e) => { let a = porNodo.get(n); if (!a) porNodo.set(n, a = []); a.push(e); };
  for (const e of traffic.edges) { add(e.a, e); add(e.b, e); }
  const tmp = {};
  for (const sr of SOBRERUEDAS) {
    const R = sr.largo / 2 * M, mios = traffic.edges.filter(e => D.names[e.n] === sr.calle);
    // el punto de la calle mas cercano a 'cerca'
    let bd = 1e9;
    for (const e of mios) for (let q = 0; q < e.p.length; q += 2) { const d = Math.hypot(e.p[q] - sr.cerca[0], e.p[q + 1] - sr.cerca[1]); if (d < bd) { bd = d; sr.x = e.p[q]; sr.y = e.p[q + 1]; } }
    sr.R = R; sr.tramos = [];
    if (bd > 300) { console.warn('sobreruedas sin calle', sr.k); continue; }
    for (const e of mios) { edgePos(e, e.len / 2, 1, 0, tmp); if (Math.hypot(tmp.x - sr.x, tmp.y - sr.y) < R && !e.cerrada) { e.cerrada = sr; sr.tramos.push(e); } }
  }
  // donde da a una calle abierta se corta (el cruce queda libre) y se pone una valla
  const corte = (n) => { let w = 0; for (const o of porNodo.get(n)) if (!o.cerrada) w = Math.max(w, o.w); return w ? w / 2 + 3 * M : 0; };
  for (const e of traffic.edges) {
    if (!e.cerrada) continue;
    const t0 = corte(e.a), t1 = e.len - corte(e.b);
    if (t1 - t0 < 6 * M) continue;
    const T = { e, t0, t1, sr: e.cerrada }, rnd0 = mulberry(e.id * 7919 + 13);
    tianguis.push(T);
    // las vallas: de banqueta a banqueta
    for (const [t, lado] of [[t0, 1], [t1, -1]]) {
      if (t <= 0 || t >= e.len) continue;
      edgePos(e, t + lado * M, 1, 0, tmp);
      const h = e.w / 2 + SIDEWALK * M;
      puestos.push({ x: tmp.x, y: tmp.y, a: tmp.a, l: h * 2, valla: true, seed: (rnd0() * 1e9) | 0, bb: [tmp.x - h, tmp.y - h, tmp.x + h, tmp.y + h] });
    }
    // filas de puestos en las orillas del asfalto viendo hacia en medio; en las avenidas anchas, otra doble en medio
    const lats = [e.w / 2 - PUESTO_D / 2 - 0.3 * M, -(e.w / 2 - PUESTO_D / 2 - 0.3 * M)];
    if (e.w >= 15 * M) lats.push(PUESTO_D / 2 + 0.2 * M, -(PUESTO_D / 2 + 0.2 * M));
    for (const lat of lats) {
      let t = t0 + 1.5 * M;
      for (;;) {
        const l = (3 + rnd0() * 1.6) * M;
        if (t + l > t1 - 1.5 * M) break;
        if (rnd0() < 0.08) { t += 3 * M; continue; } // un hueco: por ahi se pasa a la banqueta
        edgePos(e, t + l / 2, 1, lat, tmp);
        const c = Math.abs(lat) < e.w / 4 ? Math.sign(lat) : -Math.sign(lat); // hacia donde ve: al pasillo
        puestos.push({ x: tmp.x, y: tmp.y, a: tmp.a, l, d: PUESTO_D, cara: c, seed: (rnd0() * 1e9) | 0, bb: [tmp.x - 12, tmp.y - 12, tmp.x + 12, tmp.y + 12] });
        t += l + rnd0() * 0.6 * M;
      }
    }
  }
  for (const A of traffic.adj) for (let i = A.length - 1; i >= 0; i--) if (A[i].e.cerrada) A.splice(i, 1);
}
const chunkPuestos = new Map();
for (const p of puestos) gridAdd(chunkPuestos, p, p.bb, CHUNK);
// lo cerrado a los carros: el asfalto y las banquetas de los tramos, de valla a valla (tramitos de x0 y0 x1 y1 media-franja)
const TCERR = 128, cerrGrid = new Map();
for (const T of tianguis) {
  const e = T.e, h = e.w / 2 + SIDEWALK * M, a = {}, b = {}, n = Math.max(1, Math.ceil((T.t1 - T.t0) / 10));
  for (let i = 0; i < n; i++) {
    edgePos(e, T.t0 + (T.t1 - T.t0) * i / n, 1, 0, a); edgePos(e, T.t0 + (T.t1 - T.t0) * (i + 1) / n, 1, 0, b);
    const sg = [a.x, a.y, b.x, b.y, h];
    gridAdd(cerrGrid, sg, [Math.min(a.x, b.x) - h, Math.min(a.y, b.y) - h, Math.max(a.x, b.x) + h, Math.max(a.y, b.y) + h], TCERR);
  }
}
function enSobreruedas(x, y) {
  const a = cerrGrid.get(GK(Math.floor(x / TCERR), Math.floor(y / TCERR))); if (!a) return false;
  for (const g of a) if (segDist(x, y, g[0], g[1], g[2], g[3]) < g[4]) return true;
  return false;
}
// calles de las que el trafico ya no podria salir (un sentido que acaba en nada, cachitos sueltos): se buscan las
// componentes fuertemente conexas (Tarjan sin recursion) y los tramos fuera de las grandes quedan como trampa.
// Ahi no aparecen carros ni se meten (el jugador si puede entrar)
(function marcarTrampas(g) {
  const N = g.nN, idx = new Int32Array(N).fill(-1), low = new Int32Array(N), onS = new Uint8Array(N), comp = new Int32Array(N), it = new Int32Array(N);
  const S = [], call = [], size = []; let c = 0;
  for (let s = 0; s < N; s++) {
    if (idx[s] >= 0) continue;
    idx[s] = low[s] = c++; S.push(s); onS[s] = 1; call.push(s);
    while (call.length) {
      const v = call[call.length - 1], A = g.adj[v];
      if (it[v] < A.length) {
        const o = A[it[v]++], w = o.dir > 0 ? o.e.b : o.e.a;
        if (idx[w] < 0) { idx[w] = low[w] = c++; S.push(w); onS[w] = 1; call.push(w); }
        else if (onS[w] && idx[w] < low[v]) low[v] = idx[w];
      } else {
        call.pop();
        if (call.length) { const u = call[call.length - 1]; if (low[v] < low[u]) low[u] = low[v]; }
        if (low[v] === idx[v]) { let w, k = 0; do { w = S.pop(); onS[w] = 0; comp[w] = size.length; k++; } while (w !== v); size.push(k); }
      }
    }
  }
  g.trampas = 0;
  for (const e of g.edges) if ((e.trampa = comp[e.a] !== comp[e.b] || size[comp[e.a]] < 40 || !!e.cerrada)) g.trampas++;
})(traffic);
// andadores (clases 8 y 9) que quedan dentro de una calle ya ensanchada se ignoran: si no, la gente camina sobre el asfalto
const footwayOnRoad = (r) => { let n = 0; for (let i = 0; i < r.p.length; i += 2) if (onRoad(r.p[i], r.p[i + 1])) n++; return n * 2 > r.p.length / 3; };
const walkG = buildGraph(r => r.c >= 2 && r.c <= 9 && r.c !== 7 && inMx(r) && !(r.c >= 8 && footwayOnRoad(r)), false);
// los tramos para caminar que van por un sobreruedas (ahi aparece la gente que va de compras)
const walkTianguis = [];
{
  const t = {};
  for (const e of walkG.edges) {
    if (e.c > 6) continue;
    edgePos(e, e.len / 2, 1, 0, t);
    if (enSobreruedas(t.x, t.y)) { e.tianguis = true; walkTianguis.push(e); }
  }
}
// por donde camina la gente en un sobreruedas: en los pasillos, entre las filas de puestos
function latTianguis(e) {
  const fuera = e.w / 2 - PUESTO_D - 0.8 * M;
  if (e.w >= 15 * M) { const dentro = PUESTO_D + 0.8 * M; return (Math.random() < 0.5 ? 1 : -1) * rnd(dentro, Math.max(dentro, fuera)); }
  return rnd(-fuera, fuera);
}
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
  // seguir por otra calle; si no hay, la vuelta en U; meterse a una trampa (ver marcarTrampas) solo si no queda de otra
  const sal = g.adj[n].filter(o => o.e !== e);
  let opts = sal.filter(o => !o.e.trampa);
  if (!opts.length) opts = g.adj[n].filter(o => o.e === e);
  if (!opts.length) opts = sal;
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
    const a = g.grid.get(GK(Math.floor(px / g.GC), Math.floor(py / g.GC)));
    if (a && a.length) return g.edges[pick(a)];
  }
  return null;
}
// lo mismo pero solo en las celdas de alrededor (rapido); s queda medido a lo largo del tramo, mas el angulo del segmento
function nearestOnGraphCerca(g, x, y) {
  const cx = Math.floor(x / g.GC), cy = Math.floor(y / g.GC);
  let best = null, bd = 1e9;
  for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
    const ids = g.grid.get(GK(cx + dx, cy + dy)); if (!ids) continue;
    for (const id of ids) {
      const e = g.edges[id], p = e.p;
      for (let q = 0; q < p.length - 2; q += 2) {
        const d = segDist(x, y, p[q], p[q + 1], p[q + 2], p[q + 3]);
        if (d < bd) {
          const sx = p[q + 2] - p[q], sy = p[q + 3] - p[q + 1], l = Math.hypot(sx, sy) || 1;
          const t = Math.max(0, Math.min(1, ((x - p[q]) * sx + (y - p[q + 1]) * sy) / (l * l)));
          bd = d; best = { e, s: e.cum[q / 2] + t * l, a: Math.atan2(sy, sx), d };
        }
      }
    }
  }
  return best;
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
    const q = edgePos(e, s, 1, side * (e.w / 2 + 1.2 * M), {}), k = GK(Math.floor(q.x / 256), Math.floor(q.y / 256));
    let a = FAROLES.get(k); if (!a) FAROLES.set(k, a = []);
    if (a.some(o => Math.abs(o.x - q.x) < 35 && Math.abs(o.y - q.y) < 35)) continue; // calles encimadas
    a.push({ x: q.x, y: q.y });
  }
}

// ---------- ruta al destino (la linea tenue de puntos de las entregas, el taxi y el destino marcado) ----------
// se usa la red del trafico pero en los dos sentidos: en moto o a pie nadie respeta los sentidos
const routeAdj = Array.from({ length: traffic.nN }, () => []);
for (const e of traffic.edges) if (!e.cerrada) { routeAdj[e.a].push({ e, to: e.b, dir: 1 }); routeAdj[e.b].push({ e, to: e.a, dir: -1 }); }
// el punto de la red mas cercano a (x, y): solo se buscan las celdas de alrededor
function nearEdge(g, x, y) {
  const cx = Math.floor(x / g.GC), cy = Math.floor(y / g.GC);
  for (let r = 1; r <= 3; r++) {
    let best = null, bd = 1e9;
    for (let i = cx - r; i <= cx + r; i++) for (let j = cy - r; j <= cy + r; j++) for (const id of g.grid.get(GK(i, j)) || []) {
      const e = g.edges[id], p = e.p;
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
  const N = g.nN, cost = new Float64Array(N).fill(Infinity), prev = new Array(N);
  const h = (n) => Math.hypot(g.nodes[n * 2] - B.x, g.nodes[n * 2 + 1] - B.y);
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
  const coah = traffic.edges.filter(e => e.n >= 0 && D.names[e.n] === 'Calle Coahuila');
  for (const e of coah) {
    if (out.length >= CHINA_NAMES.length) break;
    if (e.len < 120) continue;
    edgePos(e, e.len / 2, 1, (out.length % 2 ? -1 : 1) * (e.w / 2 + 1.5 * M), tmp);
    if (out.some(o => dist(o.x, o.y, tmp.x, tmp.y) < 300) || enNiebla(tmp.x, tmp.y, NIEBLA_LEJOS)) continue; // (la calle sigue hasta la neblina)
    out.push({ name: CHINA_NAMES[out.length], x: tmp.x, y: tmp.y, cool: 0 });
  }
  return out;
})();

// ---------- el yonke (ficticio) de la Calle Baja California: ahi se venden los carros robados ----------
// pagan segun el modelo, menos si llega madreado; el precio es lo que dan por uno de agencia sin un rayon
const YONKE_PRECIO = { 'Sedán': 220, 'Vocho': 140, 'Troca': 300, 'Camioneta': 320, 'Tsurito': 180, 'Combi': 240, 'Muscle car': 480,
  'Lowrider': 420, 'Calafia': 260, 'Camión de carga': 360, 'Bólido italiano': 1200, 'Camión urbano': 380, 'Pipa de gas': 340 };
const YONKE = (() => {
  const wx = REF_X + 470 * M, wy = REF_Y + 455 * M, tmp = {};
  let best = null, bd = Infinity;
  for (const e of traffic.edges) {
    if (e.len < 60) continue;
    edgePos(e, e.len / 2, 1, 0, tmp);
    const d = dist(tmp.x, tmp.y, wx, wy);
    if (d < bd && d < 600 && streetAt(tmp.x, tmp.y) === 'Calle Baja California') { bd = d; best = e; }
  }
  const e = best || nearEdge(traffic, wx, wy).e;
  edgePos(e, e.len / 2, 1, e.w / 2 + 1.5 * M, tmp);
  return { name: 'Yonke El Güero', x: tmp.x, y: tmp.y, cool: 0, msgT: 0, k: 1, puesto: false };
})();
// los demas yonkes, repartidos por la ciudad y en las orillas (donde pagan un poquito mas: pocos llegan hasta alla).
// Cada uno junto a un lugar (o en metros, at) y en una calle de colonia; el terreno se escoge cuando ya estan los
// edificios de alrededor (ver ponerYonkes): el primero donde el corralon no cae encima de una casa
const YONKES_MAS = [
  { name: 'Yonke Los Compadres', near: 'Macroplaza', k: 1 },
  { name: 'Autopartes El Chato', near: 'Garita de Otay', k: 1.05 },
  { name: 'Yonke La Gaviota', near: 'Faro de Playas', dx: 450, dy: 250, k: 0.95 },
  { name: 'Yonke El Florido', near: 'El Florido', k: 1 },
  { name: 'Yonke El Hipódromo', near: 'Estadio Caliente', k: 1 },
  { name: 'Yonke La Camionera', near: 'Central Camionera', k: 1 },
  // los de las orillas
  { name: 'Deshuesadero La Presa', near: 'Presa Rodríguez', k: 1.1 },
  { name: 'Yonke El Mezquite', near: 'Santa Fe', k: 1.05 },
  { name: 'Fierros Natura', near: 'Natura', k: 1.1 },
  { name: 'Yonke del Cerro', near: 'Mirador del Cerro Colorado', k: 1.1 },
  { name: 'Yonke Las Olas', near: 'El Colef', k: 1.05 },
  { name: 'Fierros del Mar', near: 'San Antonio del Mar', k: 1.15 },
  { name: 'Chatarrera del Sainz', near: 'Mirador del Cañón del Sainz', k: 1.15 },
];
const YONKES = [YONKE, ...YONKES_MAS.map(o => {
  const l = o.near && landmarks.find(q => q.name === o.near);
  const tx = l ? l.x + (o.dx || 0) * M : REF_X + o.at[0] * M, ty = l ? l.y + (o.dy || 0) * M : REF_Y + o.at[1] * M, tmp = {};
  // las calles de colonia cercanas (las mas cercanas primero), de los dos lados
  const cands = [];
  for (const e of traffic.edges) {
    if (e.c < 3 || e.c > 6 || e.len < 80 || e.trampa) continue;
    edgePos(e, e.len / 2, 1, 0, tmp);
    const d = dist(tmp.x, tmp.y, tx, ty) + (e.c === 3 ? 300 : 0); // de preferencia en calle de colonia
    if (d < 3000) cands.push([d, e]);
  }
  cands.sort((a, b) => a[0] - b[0]);
  if (!cands.length) return null;
  const e = cands[0][1]; edgePos(e, e.len / 2, 1, e.w / 2 + 1.5 * M, tmp);
  return { name: o.name, x: tmp.x, y: tmp.y, cool: 0, msgT: 0, k: o.k, puesto: false, cands: cands.slice(0, 14).map(c => c[1]) };
}).filter(Boolean)];

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
    topes.push({ e, x: q.x, y: q.y, a: q.a, w: e.w, bb: [q.x - 40, q.y - 40, q.x + 40, q.y + 40] });
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
function topesNear(x, y) { return topeGrid.get(GK(Math.floor(x / TCELL), Math.floor(y / TCELL))) || []; }
// puentes: como el mapa es plano y no se puede pasar por debajo, todos (calles, andadores y tren) se pintan a nivel
// como cualquier calle y se cruzan con las de abajo como en un crucero.
const chunkBaches = gridIndex(baches, CHUNK, 'bb');

// ---------- altos, postes de luz y señalamientos ----------
// No en todas las calles: lo suficiente para que se sienta natural. Van en la banqueta de la derecha (segun el
// sentido) y se pintan en el trozo despues de los edificios, parados como ellos (lo alto hacia el norte); si un
// edificio los taparia (ver bajoTecho) no se pintan. No estorban: se pasa por encima.
//   alto: en los cruceros, sobre todo donde una calle de colonia llega a una mas grande, con su raya en el piso
//   poste: postes de luz de un lado de la calle, cada ~30 m, en la mayoria de las avenidas y algunas calles
//   tope (aviso amarillo antes del tope), sentido (flecha de un sentido), vel (velocidad maxima), noest (no estacionarse)
// Son decenas de miles, asi que van en arreglos (como los arboles): posicion, rumbo, tipo, ancho de la calle (para la
// raya del alto) y un numero (la velocidad, o si la calle del alto es de un sentido)
const SEN_TIPOS = ['alto', 'poste', 'tope', 'sentido', 'vel', 'noest'];
const SENALES = (() => {
  const X = [], Y = [], A = [], T = [], W = [], V = [];
  const ocupado = new Set(), celda = (x, y) => GK(Math.floor(x / 14), Math.floor(y / 14));
  const poner = (t, e, s, dir, v) => {
    const lat = e.w / 2 + SIDEWALK * M * (t === 'poste' ? 0.3 : 0.6), q = edgePos(e, s, dir, lat, {});
    if (q.y < borderY(q.x) + 40 || onAsfalto(q.x, q.y, 0.3 * M)) return null;
    const c = celda(q.x, q.y); if (ocupado.has(c)) return null;
    ocupado.add(c);
    X.push(q.x); Y.push(q.y); A.push(q.a); T.push(SEN_TIPOS.indexOf(t)); W.push(Math.min(255, Math.round(e.w))); V.push(t === 'alto' ? +e.one : v || 0);
  };
  // los tramos que llegan a cada crucero (en los dos sentidos)
  // (en arreglos seguidos: un arreglo por crucero, con toda la ciudad, pesaba demasiado)
  const E = traffic.edges, ini = new Int32Array(traffic.nN + 1), cola = new Int32Array(E.length * 2);
  for (const e of E) { ini[e.a + 1]++; ini[e.b + 1]++; }
  for (let n = 0; n < traffic.nN; n++) ini[n + 1] += ini[n];
  const pos = ini.slice(0, traffic.nN);
  for (const e of E) { cola[pos[e.a]++] = e.id; cola[pos[e.b]++] = e.id; }
  for (let n = 0; n < traffic.nN; n++) {
    if (ini[n + 1] - ini[n] < 3) continue;
    const L = Array.from(cola.subarray(ini[n], ini[n + 1]), id => E[id]);
    for (const e of L) {
      if (e.c < 5 || e.len < 70) continue;
      const dir = n === e.b ? 1 : -1; if (dir < 0 && e.one) continue; // por ahi no se llega
      const otras = L.filter(o => o !== e), grande = otras.some(o => o.c < e.c);
      if (hash(e.id * 13 + n * 7) % 100 >= (grande ? 55 : 12)) continue;
      const atras = Math.max(...otras.map(o => o.w)) / 2 + SIDEWALK * M + 1.5 * M;
      if (atras > e.len * 0.4) continue;
      poner('alto', e, e.len - atras, dir);
    }
  }
  for (const e of traffic.edges) {
    if (e.len < 100) continue;
    const h = hash(e.id * 31 + 11);
    // postes de luz: casi todas las avenidas y una de cada cuatro calles de colonia
    if (e.c >= 2 && h % 100 < (e.c <= 4 ? 70 : 25)) {
      const dir = (h >> 8) & 1 ? 1 : -1;
      for (let s = 30 + (h >> 10) % 60; s < e.len - 30; s += 150) poner('poste', e, s, dir);
    }
    // velocidad maxima en las avenidas, flecha de un sentido y no estacionarse en algunas calles
    if (e.c >= 2 && e.c <= 4 && e.len > 300 && (h >> 4) % 4 === 0) poner('vel', e, e.len * 0.3, 1, e.c <= 3 ? 60 : 40);
    if (e.one && e.len > 80 && (h >> 6) % 3 === 0) poner('sentido', e, 9 * M, 1);
    if (e.c >= 4 && e.len > 200 && (h >> 12) % 12 === 0) poner('noest', e, e.len * 0.55, (h >> 14) & 1 ? 1 : -1);
  }
  // el aviso amarillo unos 20 m antes de los topes
  for (const t of topes) {
    const e = t.e;
    for (const dir of e.one ? [1] : [1, -1]) if (hash(e.id * 17 + dir + 5) % 10 < 4 && e.len / 2 > 26 * M) poner('tope', e, e.len / 2 - 20 * M, dir);
  }
  // TAP: si lo tapa un edificio (-1 falta ver, se ve al pintar el trozo con los edificios ya cargados)
  return { n: X.length, X: new Float32Array(X), Y: new Float32Array(Y), A: new Float32Array(A), T: new Uint8Array(T), W: new Uint8Array(W), V: new Uint8Array(V), TAP: new Int8Array(X.length).fill(-1) };
})();
// en los trozos que toca su dibujo (el poste sube unos 32 px y la sombra se va abajo a la derecha)
const chunkSenales = rejillaDensa((emit) => {
  for (let i = 0; i < SENALES.n; i++) {
    const x = SENALES.X[i], y = SENALES.Y[i];
    for (let cx = Math.floor((x - 16) / CHUNK); cx <= Math.floor((x + 24) / CHUNK); cx++)
      for (let cy = Math.floor((y - 40) / CHUNK); cy <= Math.floor((y + 22) / CHUNK); cy++) emit(cx, cy, i);
  }
});

// ---------- arboles ----------
// Tijuana es seca: pocos y repartidos. Algunas calles tienen arboles en la banqueta y la mayoria casi no;
// mas en los parques, una que otra palma en las plazas y alguno suelto en lotes y patios.
// La sombra se pinta dentro de los trozos del mapa; el arbol va encima de la gente y los carros (copasTrozo), asi
// la gente pasa por debajo de las copas. El tronco y lo grueso de la copa son solidos para el jugador (a pie y
// manejando) y para los carros (ver arbolEn y arbolEnCaja).
// Los edificios se cargan por regiones, asi que lo de no quedar dentro o detras de uno se revisa al pintar el
// trozo: en cada cuadrito de 30 px se queda el primer candidato (en orden) que no choca con un edificio.
// tipos: 0 laurel de la India, 1 palma, 2 jacaranda, 3 pirul, 4 eucalipto, 5 pino (los de la region).
// (localStorage tjrush-arboles = 'no' los quita)
const ARB_LAURO = 0, ARB_PALMA = 1, ARB_JACA = 2, ARB_PIRUL = 3, ARB_EUCA = 4, ARB_PINO = 5, ARB_TIPOS = 6, ARB_VAR = 5, ARB_SZ = 80;
// Los candidatos van en arreglos (con toda la ciudad son cientos de miles: como objetos pesaban decenas de MB):
// posicion, tipo, variante y la celda de 30 px (llave GK). Despues se agrupan por celda, en orden.
const ARB = (() => {
  const X = [], Y = [], T = [], V = [], C = [];
  try { if (localStorage.getItem('tjrush-arboles') === 'no') return { X, Y, T, V, C }; } catch (e) { }
  const enArea = (x, y, k) => (chunkAreas.get(GK(Math.floor(x / CHUNK), Math.floor(y / CHUNK))) || []).some(i => {
    const a = areas[i]; return (k < 0 || a.k === k) && x >= a.bb[0] && x <= a.bb[2] && y >= a.bb[1] && y <= a.bb[3] && pip(x, y, a.p);
  });
  // ni en el asfalto, ni dentro de un edificio o detras de uno (los techos se elevan hacia el norte y lo taparian),
  // ni en el agua o la arena, ni pegado a otro arbol
  const poner = (x, y, t, rnd) => {
    const c = GK(Math.floor(x / 30), Math.floor(y / 30));
    if (x < 20 || x > WORLD_W - 20 || y > WORLD_H - 20 || y < borderY(x) + 30) return;
    if (onAsfalto(x, y, M) || inWater(x, y) || enArea(x, y, AREA_ARENA)) return;
    X.push(x); Y.push(y); T.push(t); V.push((rnd() * ARB_VAR) | 0); C.push(c);
  };
  const tipo = (rnd, palma, jaca, pirul, euca = 0, pino = 0) => { const q = rnd(); let a = palma; if (q < a) return ARB_PALMA; if (q < (a += jaca)) return ARB_JACA;
    if (q < (a += pirul)) return ARB_PIRUL; if (q < (a += euca)) return ARB_EUCA; return q < a + pino ? ARB_PINO : ARB_LAURO; };
  // en la banqueta, a la orilla de afuera; las avenidas llevan mas palmas
  for (const r of roads) {
    if (r.c < 1 || r.c > 6 || (r.f & 1)) continue;
    // en las calles de colonia (c 5 y 6) un poco mas: la gente siembra su arbolito afuera de la casa
    const rnd = mulberry(r.i * 7919 + 5), prob = hash(r.i * 13 + 7) % 10 < 3 ? 0.4 : r.c >= 5 ? 0.09 : 0.04;
    const off = (r.w / 2 + SIDEWALK * 0.6) * M, p = r.p;
    for (let q = 0; q < p.length - 2; q += 2) {
      const dx = p[q + 2] - p[q], dy = p[q + 3] - p[q + 1], len = Math.hypot(dx, dy); if (len < 1) continue;
      const nx = -dy / len, ny = dx / len;
      for (let t = 6 * M; t < len - 6 * M; t += 11 * M) for (const lado of [-1, 1]) {
        if (rnd() >= prob) continue;
        poner(p[q] + dx * t / len + nx * off * lado, p[q + 1] + dy * t / len + ny * off * lado, tipo(rnd, r.c <= 3 ? 0.55 : 0.08, 0.12, 0.15, 0.08, 0.06), rnd);
      }
    }
  }
  // parques, plazas, escuelas y casas, y alguno suelto en el resto (lotes baldios)
  const rejilla = (x0, y0, x1, y1, paso, seed, fn) => {
    const rnd = mulberry(seed);
    for (let y = Math.ceil(y0 / paso) * paso; y < y1; y += paso) for (let x = Math.ceil(x0 / paso) * paso; x < x1; x += paso)
      fn(x + (rnd() - 0.5) * paso * 0.8, y + (rnd() - 0.5) * paso * 0.8, rnd);
  };
  // [paso en m, probabilidad, palma, jacaranda, pirul, eucalipto, pino]; en la vivienda bastantes mas que antes
  const POR_AREA = { 0: [14, 0.45, 0.2, 0.1, 0.1, 0.15, 0.1], [AREA_PLAZA]: [16, 0.1, 0.7, 0.1, 0], 3: [20, 0.08, 0.2, 0.1, 0.3, 0.15, 0.1], 6: [16, 0.13, 0.12, 0.12, 0.2, 0.12, 0.12] };
  areas.forEach((a, i) => {
    const c = POR_AREA[a.k]; if (!c) return;
    rejilla(a.bb[0], a.bb[1], a.bb[2], a.bb[3], c[0] * M, i * 104729 + 3, (x, y, rnd) => {
      if (rnd() < c[1] && pip(x, y, a.p)) poner(x, y, tipo(rnd, c[2], c[3], c[4], c[5], c[6]), rnd);
    });
  });
  rejilla(0, 0, WORLD_W, WORLD_H, 24 * M, 4242, (x, y, rnd) => { if (rnd() < 0.08 && !enArea(x, y, -1)) poner(x, y, tipo(rnd, 0.1, 0.05, 0.35, 0.25, 0.1), rnd); });
  return { X, Y, T, V, C };
})();
const arboles = (() => {
  const n = ARB.X.length, X = new Float32Array(ARB.X), Y = new Float32Array(ARB.Y), T = new Uint8Array(ARB.T), V = new Uint8Array(ARB.V);
  // grupos: los candidatos de cada celda de 30 px seguidos y en su orden (G: grupo de cada uno; INI: donde empieza
  // cada grupo en ORD; OK: el que se quedo, -2 si falta ver, -1 si ninguno)
  const K = ARB.C, ORD = Int32Array.from({ length: n }, (_, i) => i).sort((a, b) => (K[a] - K[b]) || (a - b));
  const G = new Int32Array(n), INI = [];
  for (let j = 0; j < n; j++) { if (!j || K[ORD[j]] !== K[ORD[j - 1]]) INI.push(j); G[ORD[j]] = INI.length - 1; }
  INI.push(n);
  ARB.X = ARB.Y = ARB.T = ARB.V = ARB.C = null;
  return { length: n, X, Y, T, V, G, ORD, INI: Int32Array.from(INI), OK: new Int32Array(INI.length).fill(-2) };
})();
const chunkArboles = rejillaDensa((emit) => {
  for (let i = 0; i < arboles.length; i++) {
    const x = arboles.X[i], y = arboles.Y[i], h = ARB_SZ / 2;
    for (let cx = Math.floor((x - h) / CHUNK); cx <= Math.floor((x + h) / CHUNK); cx++) for (let cy = Math.floor((y - h) / CHUNK); cy <= Math.floor((y + h) / CHUNK); cy++) emit(cx, cy, i);
  }
});
// ¿este arbol si va? (con los edificios de alrededor ya cargados): en su celda se queda el primero que no choca
function arbolVa(i) {
  const A = arboles, g = A.G[i];
  if (A.OK[g] === -2) {
    A.OK[g] = -1;
    for (let j = A.INI[g]; j < A.INI[g + 1]; j++) {
      const q = A.ORD[j], x = A.X[q], y = A.Y[q];
      let libre = true;
      for (let d = 0; d <= 48 && libre; d += 8) if (inBuilding(x, y + d) || inBuilding(x - 12, y + d) || inBuilding(x + 12, y + d)) libre = false;
      if (libre && (enEstacionamiento(x, y, 12) || enCancha(x, y, 10) || trasDomo(x, y, 14))) libre = false;
      if (libre) { A.OK[g] = q; break; }
    }
  }
  return A.OK[g] === i;
}
// choques con los arboles: radio de lo solido por tipo (la palma solo el tronco). En el trozo de un punto vienen
// todos los arboles a menos de ARB_SZ / 2, y eso alcanza para un carro (el camion mide 58 de largo)
const ARB_R = [2.2 * M, 1.3 * M, 2.2 * M, 1.8 * M, 1.6 * M, 1.8 * M];
const arbolSirve = (i, x, y) => regionesListas(x, y, x, y) && arbolVa(i); // sin los edificios cargados aun no se sabe
function arbolEn(x, y, r) {
  const L = chunkArboles.get(GK(Math.floor(x / CHUNK), Math.floor(y / CHUNK))); if (!L) return false;
  for (const i of L) {
    const R = ARB_R[arboles.T[i]] + r, dx = arboles.X[i] - x, dy = arboles.Y[i] - y;
    if (dx * dx + dy * dy < R * R && arbolSirve(i, x, y)) return true;
  }
  return false;
}
// cuanto se mete un carro (centro x,y, direccion c,s y medio largo/ancho hl,hw) en los arboles; 0 si no toca
function arbolEnCaja(x, y, c, s, hl, hw) {
  const L = chunkArboles.get(GK(Math.floor(x / CHUNK), Math.floor(y / CHUNK))); if (!L) return 0;
  let n = 0;
  for (const i of L) {
    const dx = arboles.X[i] - x, dy = arboles.Y[i] - y, R = ARB_R[arboles.T[i]];
    const qu = Math.max(0, Math.abs(dx * c + dy * s) - hl), qv = Math.max(0, Math.abs(dy * c - dx * s) - hw), d = Math.hypot(qu, qv);
    if (d < R && arbolSirve(i, x, y)) n += 1 + (R - d) / 4;
  }
  return n;
}
// cada tipo tiene ARB_VAR dibujos; vistos desde arriba, con la sombra hacia el sureste (la luz viene del noroeste).
// parte 0: solo la sombra (va en el piso del trozo); 1: el arbol sin la sombra (va encima, ver arbolesAtlas)
const ARB_SPR = {};
function arbolSprite(t, v, parte) {
  const key = parte * 100 + t * 10 + v; if (ARB_SPR[key]) return ARB_SPR[key];
  const c = document.createElement('canvas'); c.width = c.height = ARB_SZ * RES;
  const x = c.getContext('2d', CTX2D); x.scale(RES, RES); x.translate(ARB_SZ / 2, ARB_SZ / 2);
  const rnd = mulberry(key * 977 + 11);
  if (t === ARB_PALMA) {
    // palma de abanico: hojas en estrella, unas secas abajo, y la sombra larga porque es alta
    const n = 10 + ((rnd() * 4) | 0), L = (2.8 + rnd() * 0.8) * M, a0 = rnd() * 6.3;
    const hoja = (a, l, w) => {
      x.beginPath(); x.moveTo(0, 0);
      x.quadraticCurveTo(Math.cos(a - 0.38) * l * 0.55, Math.sin(a - 0.38) * l * 0.55, Math.cos(a) * l, Math.sin(a) * l);
      x.quadraticCurveTo(Math.cos(a + 0.38) * l * 0.55, Math.sin(a + 0.38) * l * 0.55, 0, 0); x.fill();
    };
    x.fillStyle = 'rgba(0,0,0,0.24)'; x.save(); x.translate(7, 8); if (!parte) for (let i = 0; i < n; i++) hoja(a0 + i / n * 6.283, L, 0); x.restore();
    if (!parte) return ARB_SPR[key] = c;
    x.fillStyle = '#a08850'; for (let i = 0; i < 5; i++) hoja(a0 + 0.3 + i * 1.25, L * 0.8, 0);
    for (let i = 0; i < n; i++) { const a = a0 + i / n * 6.283 + (rnd() - 0.5) * 0.2; x.fillStyle = i % 2 ? '#7ea23a' : '#9cbc52'; hoja(a, L * (0.85 + rnd() * 0.2), 0); }
    x.strokeStyle = 'rgba(45,65,20,0.7)'; x.lineWidth = 0.6;
    for (let i = 0; i < n; i++) { const a = a0 + i / n * 6.283; x.beginPath(); x.moveTo(0, 0); x.lineTo(Math.cos(a) * L * 0.85, Math.sin(a) * L * 0.85); x.stroke(); }
    x.fillStyle = '#6b5a3a'; x.beginPath(); x.arc(0, 0, 2.2, 0, 7); x.fill();
  } else if (t === ARB_PINO) {
    // pino: estrellas de agujas oscuras, unas encima de otras, con la punta de cada rama mas clara
    const R = (3.3 + rnd() * 1.2) * M, ramas = [];
    for (let i = 0; i < 9; i++) { const a = i / 9 * 6.283 + rnd() * 0.4, d = R * (0.25 + rnd() * 0.4); ramas.push([Math.cos(a) * d, Math.sin(a) * d, R * (0.45 + rnd() * 0.2)]); }
    ramas.push([0, 0, R * 0.6]);
    const estrella = (cx, cy, r, col, w) => { x.strokeStyle = col; x.lineWidth = w; x.beginPath();
      for (let k = 0; k < 16; k++) { const a = k / 16 * 6.283 + rnd() * 0.3, l = r * (0.6 + rnd() * 0.4); x.moveTo(cx, cy); x.lineTo(cx + Math.cos(a) * l, cy + Math.sin(a) * l); } x.stroke(); };
    if (!parte) { x.fillStyle = 'rgba(0,0,0,0.28)'; x.beginPath(); for (const [a, b, r] of ramas) { x.moveTo(a + R * 0.35 + r * 0.8, b + R * 0.4); x.arc(a + R * 0.35, b + R * 0.4, r * 0.8, 0, 7); } x.fill(); return ARB_SPR[key] = c; }
    x.lineCap = 'round';
    x.fillStyle = '#1b3324'; x.beginPath(); for (const [a, b, r] of ramas) { x.moveTo(a + r * 0.7, b); x.arc(a, b, r * 0.7, 0, 7); } x.fill();
    for (const [a, b, r] of ramas) estrella(a, b, r, '#24452f', 1.1);
    for (const [a, b, r] of ramas) estrella(a - r * 0.15, b - r * 0.15, r * 0.8, '#3d6a45', 0.8);
    for (const [a, b, r] of ramas) estrella(a - r * 0.25, b - r * 0.25, r * 0.45, '#6e9a5e', 0.6);
  } else if (t === ARB_EUCA) {
    // eucalipto: alto y ralo, hojas verde grisaceo en manchones separados y ramas blancas que se asoman
    const R = (3.4 + rnd() * 1.6) * M, n = 7 + ((rnd() * 3) | 0), lob = [];
    for (let i = 0; i < n; i++) { const a = i / n * 6.283 + rnd() * 0.6, d = R * (0.3 + rnd() * 0.45); lob.push([Math.cos(a) * d, Math.sin(a) * d, R * (0.22 + rnd() * 0.16), a]); }
    lob.push([0, 0, R * 0.3, 0]);
    const bolas = (dx, dy, col) => { x.fillStyle = col; x.beginPath(); for (const [a, b, r] of lob) { x.moveTo(a + dx + r, b + dy); x.arc(a + dx, b + dy, r, 0, 7); } x.fill(); };
    if (!parte) { bolas(R * 0.5, R * 0.55, 'rgba(0,0,0,0.22)'); return ARB_SPR[key] = c; }
    x.lineCap = 'round'; x.strokeStyle = '#d8d0bf'; x.lineWidth = 1.3;
    x.beginPath(); for (const [a, b] of lob) { x.moveTo(0, 0); x.lineTo(a * 0.85, b * 0.85); } x.stroke();
    bolas(0, 0, '#56705a');
    for (const [a, b, r] of lob) { x.fillStyle = '#7f9a80'; x.beginPath(); x.arc(a - r * 0.2, b - r * 0.2, r * 0.7, 0, 7); x.fill(); }
    x.fillStyle = '#b3c4a8';
    for (let i = 0; i < 30; i++) { const [a, b, r] = lob[(rnd() * lob.length) | 0], q = rnd() * 6.283, d = rnd() * r; x.beginPath(); x.ellipse(a + Math.cos(q) * d - 1, b + Math.sin(q) * d - 1, 1.3, 0.5, rnd() * 3, 0, 7); x.fill(); }
  } else {
    // copa de varias bolitas: base oscura, luz arriba a la izquierda y unas hojitas
    const COLS = { [ARB_LAURO]: ['#2f5a2a', '#4a7a36', '#6d9a4a'], [ARB_JACA]: ['#4f437a', '#7f66b5', '#b39be0'], [ARB_PIRUL]: ['#4f5f2c', '#728640', '#9aa860'] }[t];
    const R = (t === ARB_PIRUL ? 2.6 + rnd() * 1 : 3.2 + rnd() * 1.6) * M, n = 6 + ((rnd() * 3) | 0);
    const lob = [[0, 0, R * 0.62]];
    for (let i = 0; i < n; i++) { const a = i / n * 6.283 + rnd() * 0.5, d = R * (0.35 + rnd() * 0.15); lob.push([Math.cos(a) * d, Math.sin(a) * d, R * (0.4 + rnd() * 0.15)]); }
    const bolas = (dx, dy, k, col) => { x.fillStyle = col; x.beginPath(); for (const [a, b, r] of lob) { x.moveTo(a * k + dx + r * k, b * k + dy); x.arc(a * k + dx, b * k + dy, r * k, 0, 7); } x.fill(); };
    if (!parte) { bolas(R * 0.3, R * 0.35, 1, 'rgba(0,0,0,0.26)'); return ARB_SPR[key] = c; }
    if (t === ARB_JACA) bolas(0, 0, 1, '#3f5a2c'); // la jacaranda deja ver hojas verdes entre las flores
    bolas(0, 0, t === ARB_JACA ? 0.95 : 1, COLS[0]);
    for (const [a, b, r] of lob) { x.fillStyle = COLS[1]; x.beginPath(); x.arc(a - r * 0.2, b - r * 0.2, r * 0.7, 0, 7); x.fill(); }
    x.fillStyle = COLS[2];
    for (let i = 0; i < 26; i++) { const a = rnd() * 6.283, d = rnd() * R * 0.8; x.beginPath(); x.arc(Math.cos(a) * d - R * 0.12, Math.sin(a) * d - R * 0.12, 0.7 + rnd() * 0.9, 0, 7); x.fill(); }
  }
  return ARB_SPR[key] = c;
}
// todos los arboles (sin sombra) en una sola textura, para que Phaser los dibuje de un jalon; cuadro t*ARB_VAR+v
function arbolesAtlas() {
  const S = ARB_SZ * RES, c = document.createElement('canvas'); c.width = S * ARB_VAR; c.height = S * ARB_TIPOS;
  const x = c.getContext('2d');
  for (let t = 0; t < ARB_TIPOS; t++) for (let v = 0; v < ARB_VAR; v++) x.drawImage(arbolSprite(t, v, 1), v * S, t * S);
  return c;
}
const bacheGrid = gridIndex(baches, TCELL, 'bb');
function bachesNear(x, y) { return bacheGrid.get(GK(Math.floor(x / TCELL), Math.floor(y / TCELL))) || []; }

// ---------- dibujo de trozos del mapa ----------
function trace(ctx, p, close) {
  ctx.beginPath(); ctx.moveTo(p[0], p[1]);
  for (let i = 2; i < p.length; i += 2) ctx.lineTo(p[i], p[i + 1]);
  if (close) ctx.closePath();
}
// texturas del pasto y del agua: un cuadro de TEX px del mundo que se repite sin costura (lo que se sale
// por una orilla se pinta tambien por la otra). El patron va en coordenadas del mundo, asi que los trozos casan
const TEX = 160;
function texTile(base, fn) {
  const c = document.createElement('canvas'); c.width = c.height = TEX * RES;
  // en memoria normal como los trozos (CTX2D): si el cuadro viviera en la tarjeta de video, cada trozo tendria
  // que bajarlo para usarlo de patron (en el celular eso da tirones)
  const x = c.getContext('2d', CTX2D); x.scale(RES, RES); x.fillStyle = base; x.fillRect(0, 0, TEX, TEX);
  let s = 7; const rnd = () => (s = Math.imul(s ^ (s >>> 15), 0x2c1b3c6d) + 0x6d2b79f5 >>> 0) / 4294967296;
  // dibuja algo en (px,py) y sus copias del otro lado si toca la orilla
  const wrap = (px, py, r, draw) => {
    for (const dx of [0, -TEX, TEX]) for (const dy of [0, -TEX, TEX]) {
      if (px + dx + r < 0 || px + dx - r > TEX || py + dy + r < 0 || py + dy - r > TEX) continue;
      draw(px + dx, py + dy);
    }
  };
  // manchas grandes y suaves para que no se vea parejo
  const mancha = (n, rmin, rmax, cols) => {
    for (let i = 0; i < n; i++) {
      const px = rnd() * TEX, py = rnd() * TEX, r = rmin + rnd() * (rmax - rmin), col = cols[i % cols.length];
      wrap(px, py, r, (X, Y) => { const g = x.createRadialGradient(X, Y, 0, X, Y, r); g.addColorStop(0, col); g.addColorStop(1, 'rgba(0,0,0,0)');
        x.fillStyle = g; x.fillRect(X - r, Y - r, r * 2, r * 2); });
    }
  };
  fn(x, rnd, wrap, mancha); return c;
}
// pasto: manchas claras y oscuras, hojitas cortas inclinadas y una que otra florecita o tierrita
function grassTile(base) {
  return texTile(base, (x, rnd, wrap, mancha) => {
    mancha(14, 14, 34, ['rgba(20,45,10,0.22)', 'rgba(200,220,120,0.13)', 'rgba(120,100,50,0.12)']);
    x.lineCap = 'round';
    for (let i = 0; i < 2600; i++) {
      const px = rnd() * TEX, py = rnd() * TEX, l = 1.2 + rnd() * 2.2, a = -Math.PI / 2 + (rnd() - 0.5) * 1.1, v = rnd();
      x.strokeStyle = v < 0.45 ? 'rgba(25,55,15,0.45)' : v < 0.85 ? 'rgba(150,190,90,0.40)' : 'rgba(215,225,140,0.45)';
      x.lineWidth = 0.45 + rnd() * 0.35;
      wrap(px, py, 4, (X, Y) => { x.beginPath(); x.moveTo(X, Y); x.lineTo(X + Math.cos(a) * l, Y + Math.sin(a) * l); x.stroke(); });
    }
    for (let i = 0; i < 18; i++) {
      const px = rnd() * TEX, py = rnd() * TEX, col = ['#f2efe0', '#f5d64a', '#e9a7c4'][i % 3];
      wrap(px, py, 2, (X, Y) => { x.fillStyle = col; x.beginPath(); x.arc(X, Y, 0.55, 0, 7); x.fill(); });
    }
  });
}
// agua: tonos que van y vienen y rayitas de olas, claras arriba y con su sombra abajo
function waterTile(base) {
  return texTile(base, (x, rnd, wrap, mancha) => {
    mancha(12, 20, 45, ['rgba(10,30,50,0.25)', 'rgba(120,180,210,0.14)']);
    x.lineCap = 'round';
    for (let i = 0; i < 70; i++) {
      const px = rnd() * TEX, py = rnd() * TEX, w = 4 + rnd() * 9, h = 0.8 + rnd() * 1.2;
      wrap(px, py, w + 2, (X, Y) => {
        x.lineWidth = 0.9; x.strokeStyle = 'rgba(15,40,60,0.35)';
        x.beginPath(); x.moveTo(X - w, Y + 0.9); x.quadraticCurveTo(X, Y - h + 0.9, X + w, Y + 0.9); x.stroke();
        x.lineWidth = 0.7; x.strokeStyle = 'rgba(210,235,250,' + (0.18 + rnd() * 0.2).toFixed(2) + ')';
        x.beginPath(); x.moveTo(X - w, Y); x.quadraticCurveTo(X, Y - h, X + w, Y); x.stroke();
      });
    }
  });
}
// arena: granitos claros y oscuros y las rayas del rastrillo, en curvas suaves
function sandTile(base) {
  return texTile(base, (x, rnd, wrap, mancha) => {
    mancha(10, 16, 36, ['rgba(150,120,60,0.16)', 'rgba(255,245,215,0.20)']);
    x.lineCap = 'round';
    for (let j = 0; j < TEX; j += 3.2) { // rayas del rastrillo: ondulan y cierran en la orilla del cuadro
      for (const [dy, col] of [[0.6, 'rgba(130,100,50,0.20)'], [0, 'rgba(255,248,225,0.30)']]) {
        x.strokeStyle = col; x.lineWidth = 0.6; x.beginPath();
        for (let i = 0; i <= TEX; i += 4) { const y = j + dy + Math.sin(i / TEX * Math.PI * 2 * 2) * 2.2; i ? x.lineTo(i, y) : x.moveTo(i, y); }
        x.stroke();
      }
    }
    for (let i = 0; i < 1800; i++) {
      const px = rnd() * TEX, py = rnd() * TEX, v = rnd();
      x.fillStyle = v < 0.5 ? 'rgba(120,95,50,0.35)' : v < 0.9 ? 'rgba(255,250,230,0.45)' : 'rgba(90,80,70,0.4)';
      wrap(px, py, 1, (X, Y) => x.fillRect(X, Y, 0.45, 0.45));
    }
  });
}
// plaza: losetas de 2 m, cada una de un tono un poco distinto, con sus juntas y manchas de uso
function plazaTile(base) {
  return texTile(base, (x, rnd, wrap, mancha) => {
    const L = 10; // 2 m (TEX es multiplo de L, asi las juntas casan al repetir)
    for (let j = 0; j < TEX; j += L) for (let i = 0; i < TEX; i += L) {
      const v = rnd();
      x.fillStyle = v < 0.4 ? 'rgba(255,250,235,' + (rnd() * 0.18).toFixed(2) + ')' : 'rgba(90,75,50,' + (rnd() * 0.12).toFixed(2) + ')';
      x.fillRect(i, j, L, L);
      x.fillStyle = 'rgba(255,255,255,0.12)'; x.fillRect(i + 0.5, j + 0.5, L - 1, 0.5); x.fillRect(i + 0.5, j + 0.5, 0.5, L - 1); // canto con luz
    }
    x.fillStyle = 'rgba(80,65,45,0.38)';
    for (let k = 0; k < TEX; k += L) { x.fillRect(k, 0, 0.55, TEX); x.fillRect(0, k, TEX, 0.55); } // juntas
    mancha(9, 10, 26, ['rgba(70,55,35,0.14)', 'rgba(255,250,230,0.12)']);
    for (let i = 0; i < 500; i++) { // polvito y piedritas
      const px = rnd() * TEX, py = rnd() * TEX;
      x.fillStyle = rnd() < 0.6 ? 'rgba(90,75,55,0.35)' : 'rgba(255,250,235,0.4)';
      wrap(px, py, 1, (X, Y) => x.fillRect(X, Y, 0.5, 0.5));
    }
  });
}
// andadores de los parques: grava fina apisonada, piedritas de varios tonos
function senderoTile(base) {
  return texTile(base, (x, rnd, wrap, mancha) => {
    mancha(16, 8, 22, ['rgba(110,90,60,0.16)', 'rgba(255,250,235,0.16)']);
    for (let i = 0; i < 2200; i++) {
      const px = rnd() * TEX, py = rnd() * TEX, r = 0.25 + rnd() * 0.45, v = rnd();
      const col = v < 0.4 ? 'rgba(120,100,70,0.45)' : v < 0.75 ? 'rgba(250,245,230,0.5)' : v < 0.9 ? 'rgba(160,140,120,0.5)' : 'rgba(80,70,60,0.45)';
      wrap(px, py, 1, (X, Y) => { x.fillStyle = col; x.beginPath(); x.arc(X, Y, r, 0, 7); x.fill(); });
    }
  });
}
// banquetas: concreto sin direccion (las calles van en todos los angulos), con grano, manchas de uso,
// grietitas y uno que otro chicle pegado
function banquetaTile(base) {
  return texTile(base, (x, rnd, wrap, mancha) => {
    mancha(14, 8, 24, ['rgba(80,70,55,0.14)', 'rgba(255,252,240,0.14)', 'rgba(60,55,50,0.10)']);
    for (let i = 0; i < 1600; i++) {
      const px = rnd() * TEX, py = rnd() * TEX;
      x.fillStyle = rnd() < 0.55 ? 'rgba(90,80,65,0.30)' : 'rgba(255,252,240,0.35)';
      wrap(px, py, 1, (X, Y) => x.fillRect(X, Y, 0.45, 0.45));
    }
    x.lineCap = 'round'; x.lineJoin = 'round';
    for (let i = 0; i < 7; i++) { // grietitas en zigzag
      let px = rnd() * TEX, py = rnd() * TEX; const a0 = rnd() * 7, n = 3 + (rnd() * 3 | 0), seg = [];
      for (let k = 0; k <= n; k++) { seg.push([px, py]); const a = a0 + (rnd() - 0.5) * 1.4; px += Math.cos(a) * 2.5; py += Math.sin(a) * 2.5; }
      wrap(seg[0][0], seg[0][1], 16, (X, Y) => { x.strokeStyle = 'rgba(60,52,42,0.45)'; x.lineWidth = 0.4; x.beginPath();
        for (const [qx, qy] of seg) x.lineTo(X + qx - seg[0][0], Y + qy - seg[0][1]); x.stroke(); });
    }
    for (let i = 0; i < 12; i++) { // chicles
      const px = rnd() * TEX, py = rnd() * TEX, r = 0.35 + rnd() * 0.3;
      wrap(px, py, 1, (X, Y) => { x.fillStyle = 'rgba(55,50,45,0.55)'; x.beginPath(); x.arc(X, Y, r, 0, 7); x.fill(); });
    }
  });
}
// concreto del canal: manchas de humedad y de lama, puntitos y una que otra grieta
function canalTile(base) {
  return texTile(base, (x, rnd, wrap, mancha) => {
    mancha(16, 10, 34, ['rgba(70,75,60,0.16)', 'rgba(250,248,240,0.16)', 'rgba(90,110,70,0.10)']);
    for (let i = 0; i < 1400; i++) {
      const px = rnd() * TEX, py = rnd() * TEX;
      x.fillStyle = rnd() < 0.5 ? 'rgba(70,68,60,0.30)' : 'rgba(250,248,240,0.30)';
      wrap(px, py, 1, (X, Y) => x.fillRect(X, Y, 0.45, 0.45));
    }
    x.lineCap = 'round';
    for (let i = 0; i < 5; i++) {
      let px = rnd() * TEX, py = rnd() * TEX; const a0 = rnd() * 7, seg = [];
      for (let k = 0; k <= 5; k++) { seg.push([px, py]); const a = a0 + (rnd() - 0.5) * 1.2; px += Math.cos(a) * 3; py += Math.sin(a) * 3; }
      wrap(seg[0][0], seg[0][1], 20, (X, Y) => { x.strokeStyle = 'rgba(55,52,45,0.4)'; x.lineWidth = 0.4; x.beginPath();
        for (const [qx, qy] of seg) x.lineTo(X + qx - seg[0][0], Y + qy - seg[0][1]); x.stroke(); });
    }
  });
}
// asfalto: piedrita fina clara y oscura y tonos que van y vienen (las manchas, grietas y baches van aparte)
function asfaltoTile(base) {
  return texTile(base, (x, rnd, wrap, mancha) => {
    mancha(16, 10, 30, ['rgba(0,0,0,0.16)', 'rgba(120,120,125,0.10)', 'rgba(90,80,70,0.08)']);
    for (let i = 0; i < 3200; i++) {
      const px = rnd() * TEX, py = rnd() * TEX, v = rnd();
      x.fillStyle = v < 0.45 ? 'rgba(20,20,22,0.40)' : v < 0.9 ? 'rgba(150,150,155,0.30)' : 'rgba(190,185,175,0.35)';
      wrap(px, py, 1, (X, Y) => x.fillRect(X, Y, 0.45, 0.45));
    }
  });
}
// tierra (el terreno entre edificios y los lotes): manchas de tierra clara y oscura, piedritas y matitas
// de zacate seco
function tierraTile(base) {
  return texTile(base, (x, rnd, wrap, mancha) => {
    mancha(18, 10, 32, ['rgba(70,55,35,0.20)', 'rgba(230,215,180,0.16)', 'rgba(120,95,60,0.14)']);
    for (let i = 0; i < 1800; i++) {
      const px = rnd() * TEX, py = rnd() * TEX, v = rnd();
      x.fillStyle = v < 0.5 ? 'rgba(60,48,32,0.35)' : v < 0.9 ? 'rgba(235,225,200,0.35)' : 'rgba(150,140,130,0.5)';
      wrap(px, py, 1, (X, Y) => x.fillRect(X, Y, 0.5, 0.5));
    }
    for (let i = 0; i < 40; i++) { // piedritas
      const px = rnd() * TEX, py = rnd() * TEX, r = 0.5 + rnd() * 0.7;
      wrap(px, py, 2, (X, Y) => { x.fillStyle = 'rgba(40,32,25,0.35)'; x.beginPath(); x.arc(X + 0.3, Y + 0.3, r, 0, 7); x.fill();
        x.fillStyle = 'rgba(200,190,175,0.85)'; x.beginPath(); x.arc(X, Y, r, 0, 7); x.fill(); });
    }
    x.lineCap = 'round';
    for (let i = 0; i < 22; i++) { // matitas de zacate seco
      const px = rnd() * TEX, py = rnd() * TEX, n = 4 + (rnd() * 5 | 0), seco = rnd() < 0.6;
      wrap(px, py, 4, (X, Y) => {
        for (let k = 0; k < n; k++) { const a = -Math.PI / 2 + (k / (n - 1) - 0.5) * 1.8, l = 1.5 + (k % 3) * 0.6;
          x.strokeStyle = seco ? 'rgba(170,150,90,0.75)' : 'rgba(110,125,60,0.7)'; x.lineWidth = 0.4;
          x.beginPath(); x.moveTo(X, Y); x.lineTo(X + Math.cos(a) * l, Y + Math.sin(a) * l); x.stroke(); }
      });
    }
  });
}
// techos: capa transparente que va encima del color de cada techo (hay 14 colores): grano, manchas de humedad
// y partes deslavadas del impermeabilizante
function techoTile() {
  return texTile('rgba(0,0,0,0)', (x, rnd, wrap, mancha) => {
    mancha(14, 8, 26, ['rgba(0,0,0,0.12)', 'rgba(255,255,255,0.10)']);
    for (let i = 0; i < 5; i++) { // manchas de humedad: unos cuantos borrones encimados, de forma irregular
      const px = rnd() * TEX, py = rnd() * TEX;
      for (let k = 0; k < 4; k++) {
        const qx = px + (rnd() - 0.5) * 10, qy = py + (rnd() - 0.5) * 7, r = 2.5 + rnd() * 4;
        wrap(qx, qy, r + 1, (X, Y) => { const g = x.createRadialGradient(X, Y, 0, X, Y, r);
          g.addColorStop(0, 'rgba(20,15,10,0.10)'); g.addColorStop(1, 'rgba(20,15,10,0)'); x.fillStyle = g; x.fillRect(X - r, Y - r, r * 2, r * 2); });
      }
    }
    for (let i = 0; i < 2000; i++) {
      const px = rnd() * TEX, py = rnd() * TEX;
      x.fillStyle = rnd() < 0.55 ? 'rgba(0,0,0,0.22)' : 'rgba(255,255,255,0.22)';
      wrap(px, py, 1, (X, Y) => x.fillRect(X, Y, 0.45, 0.45));
    }
  });
}
let TEXTURAS = null; const PATRONES = {};
// relleno para un tipo de area (o null si va de color parejo); el patron se escala para medir TEX px del mundo
const SIN_TEXTURAS = (() => { try { return localStorage.getItem('tjrush-texturas') === 'no'; } catch (e) { return false; } })();
const PLANO = { [TEX_ACCESO]: '#5d5a55', [TEX_CANAL]: '#b2ab9e', [TEX_SENDERO]: COL.footway, [TEX_BANQUETA]: COL.sidewalk, [TEX_ASFALTO]: COL.asphalt, [TEX_TIERRA]: COL.ground };
function areaFill(ctx, k) {
  if (SIN_TEXTURAS) return PLANO[k] || AREA_COL[k];
  if (!TEXTURAS) TEXTURAS = { 0: grassTile(AREA_COL[0]), 1: grassTile(AREA_COL[1]), [AREA_AGUA]: waterTile(COL.water), [AREA_ARENA]: sandTile(AREA_COL[AREA_ARENA]),
    [AREA_PLAZA]: plazaTile(AREA_COL[AREA_PLAZA]), [TEX_SENDERO]: senderoTile(COL.footway),
    [TEX_BANQUETA]: banquetaTile(COL.sidewalk), [TEX_ASFALTO]: asfaltoTile(COL.asphalt), [TEX_ACCESO]: asfaltoTile('#5d5a55'),
    [TEX_TIERRA]: tierraTile(COL.ground), [TEX_CANAL]: canalTile('#b2ab9e'), [TEX_TECHO]: techoTile(), 3: tierraTile(AREA_COL[3]), 4: tierraTile(AREA_COL[4]), 5: tierraTile(AREA_COL[5]), 6: tierraTile(AREA_COL[6]) };
  const t = TEXTURAS[k]; if (!t) return AREA_COL[k];
  // un patron por textura, hecho una sola vez y compartido por todos los trozos (un patron sirve en cualquier lienzo)
  let p = PATRONES[k];
  if (!p) { p = PATRONES[k] = ctx.createPattern(t, 'repeat'); p.setTransform(new DOMMatrix().scale(1 / RES)); }
  return p;
}
// mugre: manchas, aceite, grietas, baches y alcantarillas, siempre igual para la misma calle
function grime(ctx, list, cx, cy) {
  const X0 = cx * CHUNK - 40, Y0 = cy * CHUNK - 40, X1 = X0 + CHUNK + 80, Y1 = Y0 + CHUNK + 80;
  for (const r of list) {
    if (r.c > 7) continue;
    const w = r.w * M;
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
// los altos, postes y señalamientos del trozo (ver SENALES): la raya del alto en el piso, la sombra y lo parado
// (el poste se eleva hacia arriba y un poco a la derecha, como los edificios; el letrero mira hacia acá)
function pintarSenales(ctx, k) {
  for (const i of chunkSenales.get(k) || []) {
    const S = SENALES, x = S.X[i], y = S.Y[i], t = SEN_TIPOS[S.T[i]], a = S.A[i];
    if (S.TAP[i] < 0) S.TAP[i] = bajoTecho(x, y) || inBuilding(x, y) ? 1 : 0;
    if (S.TAP[i]) continue;
    const nx = -Math.sin(a), ny = Math.cos(a); // hacia la derecha de la calle
    if (t === 'alto') {
      // raya blanca de alto de la orilla a la mitad (toda la calle si es de un sentido)
      const lat = S.W[i] / 2 + SIDEWALK * M * 0.6, c = { x: x - nx * lat, y: y - ny * lat }, w = S.W[i] / 2 - 1, iz = S.V[i] ? -w : 0;
      ctx.strokeStyle = 'rgba(236,233,224,0.85)'; ctx.lineWidth = 0.7 * M; ctx.lineCap = 'butt';
      ctx.beginPath(); ctx.moveTo(c.x + nx * iz, c.y + ny * iz); ctx.lineTo(c.x + nx * w, c.y + ny * w); ctx.stroke(); ctx.lineCap = 'round';
    }
    const H = t === 'poste' ? 32 : 14, tx = x + H * LEAN, ty = y - H;
    // sombra en el piso hacia abajo a la derecha
    ctx.strokeStyle = 'rgba(0,0,0,0.28)'; ctx.lineWidth = t === 'poste' ? 2 : 1.4;
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + H * 0.45, y + H * 0.45); ctx.stroke();
    if (t === 'poste') { ctx.beginPath(); ctx.moveTo(x + H * 0.45, y + H * 0.45); ctx.lineTo(x + H * 0.45 - nx * 11, y + H * 0.45 - ny * 11); ctx.stroke(); }
    // el tubo
    ctx.fillStyle = 'rgba(0,0,0,0.35)'; ctx.beginPath(); ctx.ellipse(x, y, 1.6, 1, 0, 0, 7); ctx.fill();
    ctx.strokeStyle = t === 'poste' ? '#6f7377' : '#8b8f94'; ctx.lineWidth = t === 'poste' ? 2 : 1.1;
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(tx, ty); ctx.stroke();
    if (t === 'poste') {
      // brazo hacia la calle y la lampara
      const lx = tx - nx * 11, ly = ty - ny * 11;
      ctx.strokeStyle = '#6f7377'; ctx.lineWidth = 1.4; ctx.beginPath(); ctx.moveTo(tx, ty); ctx.lineTo(lx, ly); ctx.stroke();
      ctx.save(); ctx.translate(lx, ly); ctx.rotate(Math.atan2(-ny, -nx));
      ctx.fillStyle = '#3d4044'; ctx.beginPath(); ctx.ellipse(0, 0, 3.4, 1.9, 0, 0, 7); ctx.fill();
      ctx.fillStyle = '#f4ecc8'; ctx.beginPath(); ctx.ellipse(0.3, 0, 2.4, 1.1, 0, 0, 7); ctx.fill();
      ctx.restore();
      continue;
    }
    ctx.save(); ctx.translate(tx, ty);
    ctx.fillStyle = 'rgba(0,0,0,0.3)'; ctx.translate(0.6, 0.6);
    const placa = () => {
      ctx.beginPath();
      if (t === 'alto') for (let j = 0; j < 8; j++) { const a = (j + 0.5) / 8 * Math.PI * 2; ctx.lineTo(Math.cos(a) * 5, Math.sin(a) * 5); }
      else if (t === 'tope') { ctx.moveTo(0, -5.5); ctx.lineTo(5.5, 0); ctx.lineTo(0, 5.5); ctx.lineTo(-5.5, 0); }
      else if (t === 'sentido') ctx.rect(-6, -2.6, 12, 5.2);
      else if (t === 'vel') ctx.rect(-4, -5, 8, 10);
      else ctx.arc(0, 0, 4.6, 0, 7);
      ctx.closePath();
    };
    placa(); ctx.fill(); ctx.translate(-0.6, -0.6);
    ctx.lineWidth = 0.7; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    if (t === 'alto') {
      placa(); ctx.fillStyle = '#c62828'; ctx.fill(); ctx.strokeStyle = '#fff'; ctx.stroke();
      ctx.fillStyle = '#fff'; ctx.font = 'bold 3px sans-serif'; ctx.fillText('ALTO', 0, 0.2);
    } else if (t === 'tope') {
      placa(); ctx.fillStyle = '#f2c230'; ctx.fill(); ctx.strokeStyle = '#2a2a2a'; ctx.stroke();
      ctx.fillStyle = '#2a2a2a'; ctx.beginPath(); ctx.moveTo(-3, 1.6); ctx.quadraticCurveTo(0, -2.2, 3, 1.6); ctx.closePath(); ctx.fill();
    } else if (t === 'sentido') {
      placa(); ctx.fillStyle = '#1d1d1d'; ctx.fill(); ctx.strokeStyle = '#eee'; ctx.stroke();
      // la flecha hacia donde va la calle (vista de frente: a la izquierda o a la derecha)
      const d = Math.cos(a) < 0 ? -1 : 1;
      ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.moveTo(-4 * d, -0.6); ctx.lineTo(1.5 * d, -0.6); ctx.lineTo(1.5 * d, -1.8); ctx.lineTo(4.4 * d, 0);
      ctx.lineTo(1.5 * d, 1.8); ctx.lineTo(1.5 * d, 0.6); ctx.lineTo(-4 * d, 0.6); ctx.closePath(); ctx.fill();
    } else if (t === 'vel') {
      placa(); ctx.fillStyle = '#f7f7f2'; ctx.fill(); ctx.strokeStyle = '#2a2a2a'; ctx.stroke();
      ctx.strokeStyle = '#c62828'; ctx.lineWidth = 0.9; ctx.beginPath(); ctx.arc(0, -0.6, 3, 0, 7); ctx.stroke();
      ctx.fillStyle = '#1d1d1d'; ctx.font = 'bold 3px sans-serif'; ctx.fillText(String(S.V[i]), 0, -0.4);
      ctx.font = 'bold 1.6px sans-serif'; ctx.fillText('km/h', 0, 3.6);
    } else {
      placa(); ctx.fillStyle = '#f7f7f2'; ctx.fill(); ctx.strokeStyle = '#c62828'; ctx.lineWidth = 1; ctx.stroke();
      ctx.fillStyle = '#1d1d1d'; ctx.font = 'bold 5px sans-serif'; ctx.fillText('E', 0, 0.3);
      ctx.strokeStyle = '#c62828'; ctx.lineWidth = 0.9; ctx.beginPath(); ctx.moveTo(-3.2, -3.2); ctx.lineTo(3.2, 3.2); ctx.stroke();
    }
    ctx.restore();
  }
}
// Edificios con volumen (vista oblicua fija, como si la camara estuviera un poco al sur).
// Por cada grupo de alturas se pinta una capa con los techos, se le borra lo que cae sobre calles y
// banquetas (para que coincida con donde se puede pasar) y se apila varias veces hacia arriba en un
// tono mas oscuro: eso forma las paredes del frente. Se hace una sola vez por trozo del mapa,
// asi que no cuesta nada mientras se juega.
// cada piso mide PISO px de pared (unos 3 m, como el resto del mapa) y un edificio muestra pisos completos: una
// planta, dos plantas... y las torres se quedan en 6 (si no, taparian media pantalla)
const PISO = 16, PISOS = [[4.5, 1], [8, 2], [13, 3], [18, 4], [26, 5], [1e9, 6]];
const LIFTS = PISOS.map(([hm, f]) => [hm, f * PISO + 2]); // [altura maxima en m, elevacion del techo en px] (elevacion - 2 multiplo de PISO: ver la pila de paredes)
const bRoof = document.createElement('canvas'), bWall = document.createElement('canvas'), bWall2 = document.createElement('canvas'), bWin = document.createElement('canvas'), bStack = document.createElement('canvas');
// las capas son EXTRA_UP px mas altas que el trozo: los techos de abajo se elevan y entran a este trozo
// y LEAN_PAD px mas anchas a la izquierda: los techos se recargan un poco a la derecha (se ve la pared oeste)
const LEAN = 0.25, LEAN_PAD = Math.ceil(EXTRA_UP * LEAN) + 2;
// las capas miden BW x BH pixeles del mundo pero tienen RES veces mas pixeles; sus contextos dibujan
// escalados por RES, y al copiar entre capas el rectangulo de origen va en pixeles de la capa (x RES)
const BW = CHUNK + 2 + LEAN_PAD, BH = CHUNK + 2 + EXTRA_UP;
for (const c of [bRoof, bWall, bWall2, bWin, bStack]) { c.width = BW * RES; c.height = BH * RES; c.getContext('2d', CTX2D).setTransform(RES, 0, 0, RES, 0, 0); }
const blit = (dst, src, sx, sy, sw, sh, dx, dy, dw, dh) => dst.drawImage(src, sx * RES, sy * RES, sw * RES, sh * RES, dx, dy, dw, dh);
// cada piso de la pared son PISO capas (de abajo para arriba): la losa del entrepiso, pared, las ventanas y pared
const wallLayer = (k) => { const m = k % PISO; return m < 2 ? bWall2 : m < 5 || m > 11 ? bWall : bWin; };
// donde va el tinaco de un edificio (en su planta), o null si no tiene
function tinaco(b) {
  const bw = b.bb[2] - b.bb[0], bh = b.bb[3] - b.bb[1], hh = hash(b.p.length * 31 + (b.bb[0] | 0));
  if (!(bw > 22 && bh > 22 && hh % 5 < (b.casa ? 4 : 2))) return null;
  const x = b.bb[0] + bw * (0.3 + (hh >> 4) % 40 / 100), y = b.bb[1] + bh * (0.3 + (hh >> 10) % 40 / 100);
  // en una casa en L el punto puede caer fuera de la azotea: ahi no va
  return [[0, 0], [4, 0], [-4, 0], [0, 4], [0, -4]].every(([dx, dy]) => pip(x + dx, y + dy, b.p)) ? [x, y] : null;
}
// calentador solar en algunas casas: el tanque blanco arriba (al norte) y los tubos de vidrio viendo al sur.
// Va en la mitad de la azotea que no tiene el tinaco; devuelve su esquina de arriba a la izquierda o null
const CAL_W = 11, CAL_H = 10;
function calentador(b) {
  if (!b.casa) return null;
  const bw = b.bb[2] - b.bb[0], bh = b.bb[3] - b.bb[1], hh = hash(b.p.length * 17 + (b.bb[1] | 0) * 3);
  if (bw < 30 || bh < 26 || hh % 10 >= 3) return null;
  const tq = tinaco(b), izq = tq ? tq[0] > b.bb[0] + bw / 2 : hh & 32;
  const x = izq ? b.bb[0] + bw * 0.12 : b.bb[2] - bw * 0.12 - CAL_W, y = b.bb[1] + bh * (0.15 + (hh >> 6) % 30 / 100);
  // que quede todo adentro de la azotea
  for (const [px, py] of [[x, y], [x + CAL_W, y], [x, y + CAL_H], [x + CAL_W, y + CAL_H]]) if (!pip(px, py, b.p)) return null;
  return [x, y];
}
function pintarCalentador(g, x, y) {
  g.fillStyle = 'rgba(0,0,0,0.3)'; g.fillRect(x + 1.5, y + 1.5, CAL_W, CAL_H); // sombra
  g.fillStyle = '#7d8086'; g.fillRect(x, y + 2.6, CAL_W, CAL_H - 2.6); // el marco de aluminio
  g.fillStyle = '#1d2a44'; g.fillRect(x + 0.6, y + 3.1, CAL_W - 1.2, CAL_H - 3.7); // los tubos
  g.fillStyle = 'rgba(150,180,215,0.55)';
  for (let tx = x + 1.1; tx < x + CAL_W - 0.8; tx += 1.2) g.fillRect(tx, y + 3.1, 0.45, CAL_H - 3.7); // el brillo de cada tubo
  g.fillStyle = '#e9e9e6'; g.fillRect(x - 0.3, y, CAL_W + 0.6, 2.8); // el tanque
  g.fillStyle = 'rgba(0,0,0,0.18)'; g.fillRect(x - 0.3, y + 1.9, CAL_W + 0.6, 0.9);
}
// La Bola del CECUT: el domo del cine es una esfera color arena (Ramirez Vazquez y Rosen, 1982). En el mapa viene
// como un edificio redondo y chaparro; se reconoce por su lugar y su forma y se pinta como esfera (ver pintarEsfera)
const DOMO_CECUT = [55437, 19301], DOMOS = [];
function esDomo(b) {
  const w = b.bb[2] - b.bb[0], h = b.bb[3] - b.bb[1];
  return b.p.length >= 32 && Math.abs(w - h) < w * 0.1 && Math.hypot((b.bb[0] + b.bb[2]) / 2 - DOMO_CECUT[0], (b.bb[1] + b.bb[3]) / 2 - DOMO_CECUT[1]) < 60;
}
// la esfera vista como los edificios (lo alto se corre hacia arriba y un poco a la derecha): queda un ovalo un poco mas
// alto que ancho, apoyado en su base. Por encima: sombreado con luz del noroeste y las juntas de los paneles
// (paralelos y meridianos) en la mitad que se ve
function siluetaDomo(b) {
  const R = b.esfera * 0.78, gx = (b.bb[0] + b.bb[2]) / 2, gy = (b.bb[1] + b.bb[3]) / 2;
  return { R, gx, gy, cx: gx + R * LEAN, cy: gy - R * 0.8, K: 1.12 };
}
// ¿(x, y) queda detras de la esfera? (ahi no van arboles: su copa saldria encima de la esfera)
const trasDomo = (x, y, m) => DOMOS.some(b => { const { R, cx, cy, K } = siluetaDomo(b); return ((x - cx) / (R + m)) ** 2 + ((y - cy) / (R * K + m)) ** 2 < 1; });
function pintarEsfera(ctx, b) {
  // (el poligono del mapa incluye la base redonda: la esfera es un poco mas chica que el)
  const { R, gx, gy, cx, cy, K } = siluetaDomo(b);
  // la base de concreto y la sombra en el piso
  trace(ctx, b.p, true); ctx.fillStyle = '#b3a892'; ctx.fill(); ctx.lineWidth = 2; ctx.strokeStyle = 'rgba(60,50,35,0.45)'; ctx.stroke();
  ctx.fillStyle = 'rgba(0,0,0,0.28)'; ctx.beginPath(); ctx.ellipse(gx + R * 0.4, gy + R * 0.05, R * 0.95, R * 0.6, 0, 0, 7); ctx.fill();
  ctx.save(); ctx.translate(cx, cy);
  ctx.save(); ctx.scale(1, K);
  const g = ctx.createRadialGradient(-R * 0.38, -R * 0.42, R * 0.05, -R * 0.1, -R * 0.1, R * 1.2);
  g.addColorStop(0, '#f3e6c6'); g.addColorStop(0.4, '#dcc08c'); g.addColorStop(0.78, '#b8955f'); g.addColorStop(1, '#7a613b');
  ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, 0, R, 0, 7); ctx.fill();
  ctx.restore();
  // juntas de los paneles: un punto (X, Y, Z) de la esfera cae en (X, 0.5 Y - Z) y se ve si Y + 0.5 Z > 0
  const pr = (la, lo) => { const X = R * Math.cos(la) * Math.cos(lo), Y = R * Math.cos(la) * Math.sin(lo), Z = R * Math.sin(la); return [X, 0.5 * Y - Z, Y + 0.5 * Z > 0]; };
  const linea = (f, n) => { let pen = false; for (let i = 0; i <= n; i++) { const [x, y, v] = f(i / n); if (v) { if (pen) ctx.lineTo(x, y); else ctx.moveTo(x, y); pen = true; } else pen = false; } };
  ctx.beginPath();
  for (let la = -40; la <= 80; la += 10) linea(t => pr(la * Math.PI / 180, t * 6.283), 96);
  for (let lo = 0; lo < 360; lo += 12) linea(t => pr((-90 + t * 180) * Math.PI / 180, lo * Math.PI / 180), 60);
  ctx.lineWidth = 0.9; ctx.strokeStyle = 'rgba(95,70,40,0.32)'; ctx.stroke();
  ctx.save(); ctx.translate(-0.5, -0.5); ctx.lineWidth = 0.5; ctx.strokeStyle = 'rgba(255,248,225,0.22)'; ctx.stroke(); ctx.restore();
  // brillo y orilla
  ctx.save(); ctx.scale(1, K);
  const br = ctx.createRadialGradient(-R * 0.42, -R * 0.48, 0, -R * 0.42, -R * 0.48, R * 0.45);
  br.addColorStop(0, 'rgba(255,252,240,0.45)'); br.addColorStop(1, 'rgba(255,252,240,0)');
  ctx.fillStyle = br; ctx.beginPath(); ctx.arc(0, 0, R, 0, 7); ctx.fill();
  ctx.lineWidth = 1.4 / K; ctx.strokeStyle = 'rgba(60,45,25,0.55)'; ctx.stroke();
  ctx.restore();
  ctx.restore();
}
function* drawBuildings(ctx, bl, rs, cx, cy) {
  const g = bRoof.getContext('2d');
  let lo = 0;
  for (const [hmax, L] of LIFTS) {
    const group = bl.filter(b => b.h >= lo && b.h < hmax && !b.esfera); lo = hmax;
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
      if (b.h >= 7 && b.bb[2] - b.bb[0] > 30 && b.bb[3] - b.bb[1] > 30) {
        const mx = (b.bb[0] + b.bb[2]) / 2, my = (b.bb[1] + b.bb[3]) / 2;
        g.save(); g.translate(mx, my); g.scale(0.8, 0.8); g.translate(-mx, -my);
        trace(g, b.p, true); g.fillStyle = 'rgba(255,255,255,0.10)'; g.fill(); g.restore();
        if (hash(b.p.length + (mx | 0)) % 3 === 0) { g.fillStyle = 'rgba(60,60,60,0.55)'; g.fillRect(mx - 6, my - 4, 12, 8); }
      }
    }
    // textura de los techos: una sola capa encima de todo el grupo (source-atop: solo donde ya hay techo)
    if (!SIN_TEXTURAS) {
      g.globalCompositeOperation = 'source-atop'; g.fillStyle = areaFill(g, TEX_TECHO);
      g.fillRect(rx0 - 1 - LEAN_PAD + cx * CHUNK, ry0 - 1 + cy * CHUNK, rw, rh); g.globalCompositeOperation = 'source-over';
    }
    // borrar lo que cae sobre calles y banquetas
    g.globalCompositeOperation = 'destination-out'; g.lineCap = 'round'; g.strokeStyle = '#000';
    for (const r of rs) {
      if (r.c > 7) continue;
      g.lineWidth = (r.c <= 6 ? r.w + SIDEWALK * 2 : r.w + 1) * M;
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
      yield; // una capa por paso: con los edificios altos cada una cuesta varios milisegundos en el celular
    }
    // apilar la pared L veces: se arma un piso (PISO capas) y se duplica la pila sobre si misma (1, 2, 4 pisos...)
    // en vez de pintar capa por capa; las que sobran se pintan una por una
    const st = bStack.getContext('2d');
    // (el patron se repite cada PISO capas y PISO*LEAN es entero, asi que duplicar la pila lo conserva)
    const lx = (k) => Math.round(k * LEAN);
    const top = L - 2, base = Math.min(top, PISO);
    st.clearRect(0, Math.max(0, ry0 - L - 1), BW, rh + L + 2); cp(st, bWall2, 0, 0);
    for (let k = 1; k < base; k++) { cp(st, wallLayer(k), lx(k), -k); if (k === PISO / 2) yield; }
    yield;
    // al duplicar, la pila ya mide n capas: se copia el rectangulo crecido hacia arriba (un duplicado por paso)
    const cps = (dx, dy, n) => blit(st, bStack, rx0, ry0 - n, rw + lx(n), rh + n, rx0 + dx, ry0 - n + dy, rw + lx(n), rh + n);
    let n = base;
    while (n * 2 <= top) { cps(lx(n), -n, n); n *= 2; yield; }
    if (n < top) cps(lx(top - n), n - top, n); // lo que falta: la misma pila corrida (top - n es multiplo de PISO)
    cp(st, bWall, lx(top), -top); cp(st, bWall2, lx(top + 1), -top - 1); // cornisa clara arriba
    yield;
    ctx.save(); ctx.setTransform(RES, 0, 0, RES, 0, 0);
    const sy0 = Math.max(0, ry0 - L - 1), sw = Math.min(BW - rx0, rw + lx(L) + 1);
    blit(ctx, bStack, rx0, sy0, sw, ry1 - sy0, rx0 - LEAN_PAD, sy0, sw, ry1 - sy0);
    ctx.restore();
    // las tiendas de las plazas comerciales, en la planta baja (antes del techo: el techo va encima)
    for (const b of group) if (b.comercio) fachadaTiendas(ctx, b);
    ctx.save(); ctx.setTransform(RES, 0, 0, RES, 0, 0);
    blit(ctx, bRoof, rx0, ry0, rw, rh, rx0 + lx(L) - LEAN_PAD, ry0 - L, rw, rh);
    ctx.restore();
    yield;
    // tinacos negros (de rigor) y calentadores solares: ya sobre el techo elevado. Si fueran en la capa del techo
    // se apilarian con las paredes y saldrian como columnas negras al frente de la casa. Donde el techo quedo
    // borrado por una calle o banqueta (ver arriba) tampoco van
    ctx.save(); ctx.translate(lx(L), -L);
    for (const b of group) {
      const tq = tinaco(b);
      if (tq && ![[0, 0], [3.5, 0], [-3.5, 0], [0, 3.5], [0, -3.5]].some(([dx, dy]) => onRoad(tq[0] + dx, tq[1] + dy))) {
        const [tx, ty] = tq;
        ctx.fillStyle = 'rgba(0,0,0,0.35)'; ctx.beginPath(); ctx.arc(tx + 1.5, ty + 1.5, 3.4, 0, 7); ctx.fill();
        ctx.fillStyle = '#1c1c1c'; ctx.beginPath(); ctx.arc(tx, ty, 3.4, 0, 7); ctx.fill();
        ctx.fillStyle = '#3a3a3a'; ctx.beginPath(); ctx.arc(tx - 0.8, ty - 0.8, 1.6, 0, 7); ctx.fill();
      }
      const cs = calentador(b); if (cs && !onRoad(cs[0], cs[1]) && !onRoad(cs[0] + CAL_W, cs[1] + CAL_H) && !onRoad(cs[0], cs[1] + CAL_H) && !onRoad(cs[0] + CAL_W, cs[1])) pintarCalentador(ctx, cs[0], cs[1]);
    }
    ctx.restore();
    yield;
  }
  for (const b of bl) if (b.esfera) pintarEsfera(ctx, b);
}
// Las fachadas de una plaza comercial: en cada pared que da al sur (las que se ven), la planta baja partida en locales
// de 5 a 8 m, cada uno con su aparador de vidrio, su toldo de rayas y su letrero de color. La pared sube como las
// capas del edificio: a la altura k, (x + k LEAN, y - k). Donde la pared quedo borrada por la banqueta, no van.
const TIENDAS = ['#e53935', '#1e88e5', '#fdd835', '#43a047', '#8e24aa', '#fb8c00', '#00acc1', '#d81b60', '#6d4c41', '#3949ab'];
function fachadaTiendas(ctx, b) {
  const p = b.p, n = p.length / 2;
  let ar = 0; for (let i = 0; i < n; i++) { const j = (i + 1) % n; ar += p[i * 2] * p[j * 2 + 1] - p[j * 2] * p[i * 2 + 1]; }
  const sg = ar > 0 ? 1 : -1; // para que la normal salga hacia afuera
  const P = (x, y, k) => [x + k * LEAN, y - k];
  const quad = (a, b2, c, d) => { ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b2[0], b2[1]); ctx.lineTo(c[0], c[1]); ctx.lineTo(d[0], d[1]); ctx.closePath(); };
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n, x0 = p[i * 2], y0 = p[i * 2 + 1], x1 = p[j * 2], y1 = p[j * 2 + 1], dx = x1 - x0, dy = y1 - y0, len = Math.hypot(dx, dy);
    if (len < 18) continue;
    const nx = -dy / len * -sg, ny = dx / len * -sg; // normal hacia afuera
    if (ny < 0.35) continue; // solo las que dan al sur
    const ux = dx / len, uy = dy / len, cuantas = Math.max(1, Math.round(len / (6.5 * M))), w = len / cuantas;
    for (let t = 0; t < cuantas; t++) {
      const s0 = t * w + 1.2, s1 = (t + 1) * w - 1.2, ax = x0 + ux * s0, ay = y0 + uy * s0, bx = x0 + ux * s1, by = y0 + uy * s1;
      // si ahi la pared quedo borrada por la banqueta, no hay tienda
      if (onRoad((ax + bx) / 2 - nx * 1.5, (ay + by) / 2 - ny * 1.5)) continue;
      const col = TIENDAS[hash(Math.round(ax) * 31 + Math.round(ay) * 7 + b.id) % TIENDAS.length];
      // el aparador: vidrio oscuro con un reflejo, y la puerta en medio
      quad(P(ax, ay, 1), P(bx, by, 1), P(bx, by, 9), P(ax, ay, 9)); ctx.fillStyle = 'rgba(38,62,82,0.92)'; ctx.fill();
      const m = 0.35; quad(P(ax + (bx - ax) * m, ay + (by - ay) * m, 2), P(ax + (bx - ax) * (m + 0.1), ay + (by - ay) * (m + 0.1), 2), P(ax + (bx - ax) * (m + 0.25), ay + (by - ay) * (m + 0.25), 8), P(ax + (bx - ax) * (m + 0.15), ay + (by - ay) * (m + 0.15), 8));
      ctx.fillStyle = 'rgba(220,240,255,0.28)'; ctx.fill();
      const ma = 0.5, pw = Math.min(0.14, 3.5 / (s1 - s0)); quad(P(ax + (bx - ax) * (ma - pw), ay + (by - ay) * (ma - pw), 1), P(ax + (bx - ax) * (ma + pw), ay + (by - ay) * (ma + pw), 1), P(ax + (bx - ax) * (ma + pw), ay + (by - ay) * (ma + pw), 7.5), P(ax + (bx - ax) * (ma - pw), ay + (by - ay) * (ma - pw), 7.5));
      ctx.fillStyle = 'rgba(255,236,170,0.55)'; ctx.fill(); // la puerta con luz
      // el letrero arriba, del color de la tienda, con unas letras blancas
      quad(P(ax, ay, 12), P(bx, by, 12), P(bx, by, 15.5), P(ax, ay, 15.5)); ctx.fillStyle = col; ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.85)'; ctx.lineWidth = 1.1; ctx.beginPath();
      const l0 = 0.25, l1 = 0.25 + 0.5 * (0.5 + (hash(b.id + t) % 5) / 10); const [qx0, qy0] = P(ax + (bx - ax) * l0, ay + (by - ay) * l0, 13.75), [qx1, qy1] = P(ax + (bx - ax) * l1, ay + (by - ay) * l1, 13.75);
      ctx.moveTo(qx0, qy0); ctx.lineTo(qx1, qy1); ctx.stroke();
      // el toldo de rayas, salido hacia la banqueta
      const ox = nx * 2.6, oy = ny * 2.6, rayas = Math.max(2, Math.round((s1 - s0) / 3));
      for (let r = 0; r < rayas; r++) {
        const f0 = r / rayas, f1 = (r + 1) / rayas, cx0 = ax + (bx - ax) * f0, cy0 = ay + (by - ay) * f0, cx1 = ax + (bx - ax) * f1, cy1 = ay + (by - ay) * f1;
        const a1 = P(cx0, cy0, 11.5), a2 = P(cx1, cy1, 11.5), a3 = P(cx1 + ox, cy1 + oy, 8.5), a4 = P(cx0 + ox, cy0 + oy, 8.5);
        quad(a1, a2, a3, a4); ctx.fillStyle = r % 2 ? '#f5f5f0' : col; ctx.fill();
      }
      ctx.fillStyle = 'rgba(0,0,0,0.18)'; quad(P(ax + ox, ay + oy, 8.5), P(bx + ox, by + oy, 8.5), P(bx + ox, by + oy, 7.6), P(ax + ox, ay + oy, 7.6)); ctx.fill(); // la orilla del toldo
    }
  }
}
// ¿lo tapa un edificio? Las paredes y el techo se elevan hacia el norte (capa k: k px arriba y k*LEAN a la derecha),
// asi que lo que esta en la banqueta o la calle detras (al norte) de un edificio queda debajo de su dibujo: un punto
// esta tapado si al bajar k px (y correrse k*LEAN a la izquierda) cae en un edificio que se eleva al menos k
// (y que ahi no esta borrado por una calle o banqueta). Ver ocultarTapados.
const elevacion = b => b.L || (b.L = LIFTS.find(([hm]) => b.h < hm)[1]);
function bajoTecho(x, y) {
  for (let k = 1; k <= EXTRA_UP; k += 3) {
    const px = x - k * LEAN, py = y + k;
    const a = bldGrid.get(GK(Math.floor(px / BCELL), Math.floor(py / BCELL))); if (!a) continue;
    for (const b of a) {
      if (px < b.bb[0] || px > b.bb[2] || py < b.bb[1] || py > b.bb[3] || elevacion(b) < k) continue;
      if (pip(px, py, b.p) && !onRoad(px, py)) return true;
    }
  }
  return false;
}
// esquinas redondeadas: donde se juntan dos calles, la guarnicion hace una curva de radio ESQ_R en vez del pico
// de 90 grados. Por cada cuña entre dos calles vecinas se rellena el pedacito entre las dos orillas y el arco: primero
// con la orilla polvosa y luego con asfalto (concentrico, ver la orilla polvosa en chunkSteps).
// Los vertices salen de las calles de los 9 trozos de alrededor (en el trozo de un vertice vienen todas sus calles).
// (localStorage tjrush-esquinas = 'no' las quita)
const ESQ_R = 4 * M, ESQ_POLVO = 4.5;
let ESQ_ON = true;
try { ESQ_ON = localStorage.getItem('tjrush-esquinas') !== 'no'; } catch (e) { }
function esquinasTrozo(cx, cy) {
  const out = [];
  if (!ESQ_ON) return out;
  const pad = 120, x0 = cx * CHUNK - pad, y0 = cy * CHUNK - pad, x1 = (cx + 1) * CHUNK + pad, y1 = (cy + 1) * CHUNK + pad;
  const vistas = new Set(), V = new Map();
  for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) for (const ri of chunkRoads.get(GK(cx + i, cy + j)) || []) {
    if (vistas.has(ri)) continue; vistas.add(ri);
    const r = roads[ri]; if (r.c > 6 || (r.f & 1)) continue;
    const p = r.p, n = p.length / 2, h = r.w * M / 2;
    for (let q = 0; q < n; q++) {
      const x = p[q * 2], y = p[q * 2 + 1];
      if (x < x0 || x > x1 || y < y0 || y > y1) continue;
      const k = Math.round(x * 2) * 1e6 + Math.round(y * 2);
      let v = V.get(k); if (!v) V.set(k, v = { x, y, d: [], n: 0 });
      v.n++;
      for (const o of [q - 1, q + 1]) {
        if (o < 0 || o >= n) continue;
        const dx = p[o * 2] - x, dy = p[o * 2 + 1] - y, L = Math.hypot(dx, dy);
        if (L > 1) v.d.push({ a: Math.atan2(dy, dx), ux: dx / L, uy: dy / L, L, h });
      }
    }
  }
  for (const v of V.values()) {
    if (v.n < 2 || v.d.length < 2) continue; // la vuelta de una sola calle ya sale redonda (lineJoin)
    v.d.sort((a, b) => a.a - b.a);
    for (let i = 0; i < v.d.length; i++) {
      const A = v.d[i], B = v.d[(i + 1) % v.d.length];
      let th = B.a - A.a; if (th <= 0) th += Math.PI * 2;
      if (th < 0.6 || th > 2.6) continue; // casi derecho (no hay pico) o muy cerrado
      out.push({ x: v.x, y: v.y, A, B, th });
    }
  }
  return out;
}
// la cuña entre las orillas de A y B (a k px hacia adentro del asfalto) cerrada con el arco
function esquinaPath(ctx, e, k) {
  const { A, B, th } = e, hA = A.h - k, hB = B.h - k;
  const nAx = -A.uy, nAy = A.ux, nBx = B.uy, nBy = -B.ux;
  const rx = nBx * hB - nAx * hA, ry = nBy * hB - nAy * hA, det = A.uy * B.ux - A.ux * B.uy;
  const sA = (-rx * B.uy + B.ux * ry) / det, tB = (A.ux * ry - A.uy * rx) / det;
  if (sA < 0 || tB < 0) return false;
  const tan = Math.tan(th / 2);
  // que la curva no se pase del tramo (cuadras chiquitas o calles en diagonal)
  const dT = Math.min((ESQ_R + k) / tan, A.L * 0.8 - sA, B.L * 0.8 - tB);
  const R = dT * tan - k; if (R < 2) return false;
  const Cx = e.x + nAx * hA + A.ux * sA, Cy = e.y + nAy * hA + A.uy * sA;
  const t1x = Cx + A.ux * dT, t1y = Cy + A.uy * dT, t2x = Cx + B.ux * dT, t2y = Cy + B.uy * dT;
  let bx = A.ux + B.ux, by = A.uy + B.uy; const bl = Math.hypot(bx, by); bx /= bl; by /= bl;
  const Rk = R + k, oc = Rk / Math.sin(th / 2), Ox = Cx + bx * oc, Oy = Cy + by * oc;
  const a1 = Math.atan2(t1y - Oy, t1x - Ox), a2 = Math.atan2(t2y - Oy, t2x - Ox);
  let da = a2 - a1; while (da > Math.PI) da -= Math.PI * 2; while (da < -Math.PI) da += Math.PI * 2;
  ctx.beginPath(); ctx.moveTo(Cx, Cy); ctx.lineTo(t1x, t1y); ctx.arc(Ox, Oy, Rk, a1, a2, da < 0); ctx.closePath();
  return true;
}
// Un trozo se pinta por pasos (generador): asi se reparte en varios cuadros y no da tirones.
// Las capas de los edificios (bRoof...) se comparten, asi que solo puede haber un trozo a medias a la vez.
// un puesto del sobreruedas visto desde arriba: la mesa con la mercancia hacia el pasillo y la lona encima del resto;
// una valla: vallas metalicas de banqueta a banqueta con un cono en cada orilla
const LONAS_PUESTO = ['#1f6fd1', '#1f6fd1', '#2b88d8', '#d23b3b', '#f0b429', '#2e9e5b', '#ef7d22', '#e64a8a', '#7b4fc0'];
const MERCANCIA = [
  ['#d9443a', '#3b7fd1', '#f2f2f2', '#f0c23b', '#4fae5c', '#e27fb0', '#2e2e2e'],   // ropa de paca
  ['#f28c28', '#e53935', '#7cb342', '#fdd835', '#8e24aa'],                        // fruta y verdura
  ['#ff5252', '#40c4ff', '#ffeb3b', '#69f0ae', '#e040fb'],                        // juguetes
  ['#8d9399', '#6b7177', '#a8aeb4', '#c9a227', '#5d4037'],                        // herramienta y fierro viejo
  ['#f5f5f5', '#212121', '#e53935', '#1e88e5', '#ffb300'],                        // tenis
  ['#3e7d32', '#558b2f', '#7cb342', '#c0602b', '#e57373'],                        // plantas en maceta
  ['#c58c4f', '#e8c07a', '#a0522d', '#f3d9a4', '#7a4a2b'],                        // pan, churros y dulces
  ['#9e9e9e', '#795548', '#607d8b', '#ffc107', '#4caf50', '#e91e63'],             // chacharas
];
function pintarPuesto(ctx, p) {
  const r = mulberry(p.seed);
  ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.a);
  if (p.valla) {
    const h = p.l / 2;
    ctx.fillStyle = 'rgba(0,0,0,0.25)'; ctx.fillRect(-1, -h + 1.5, 3.5, p.l - 3);
    for (let v = -h + 2, i = 0; v < h - 2; v += 9, i++) {
      const w = Math.min(8, h - 2 - v);
      ctx.fillStyle = '#9aa0a6'; ctx.fillRect(-0.8, v, 1.6, w);
      ctx.strokeStyle = '#c9ced3'; ctx.lineWidth = 0.4; for (let k = v + 1.5; k < v + w; k += 1.5) { ctx.beginPath(); ctx.moveTo(-0.8, k); ctx.lineTo(0.8, k); ctx.stroke(); }
      ctx.fillStyle = '#5f656b'; ctx.fillRect(-2.2, v, 4.4, 0.9); // las patas
    }
    for (const v of [-h + 1.5, h - 1.5]) { ctx.fillStyle = '#ff6d00'; ctx.beginPath(); ctx.arc(-4, v, 1.8, 0, 7); ctx.fill(); ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(-4, v, 0.8, 0, 7); ctx.fill(); }
    ctx.restore(); return;
  }
  const L = p.l / 2, Dd = p.d / 2, c = p.cara, mesa = 1.1 * M; // c: de que lado (v) esta el pasillo
  // sombra
  ctx.fillStyle = 'rgba(0,0,0,0.22)'; ctx.fillRect(-L + 1.5, -Dd + 1.5, p.l, p.d);
  // la mesa hacia el pasillo, con la mercancia regada
  const v0 = c > 0 ? Dd - mesa : -Dd;
  ctx.fillStyle = '#8a6a48'; ctx.fillRect(-L + 0.6, v0, p.l - 1.2, mesa);
  const merc = MERCANCIA[(r() * MERCANCIA.length) | 0], tipo = MERCANCIA.indexOf(merc);
  for (let k = 0, n = Math.round(p.l * 1.2); k < n; k++) {
    const u = -L + 1.2 + r() * (p.l - 2.4), v = v0 + 0.8 + r() * (mesa - 1.6);
    ctx.fillStyle = merc[(r() * merc.length) | 0];
    if (tipo === 1 || tipo === 5 || tipo === 6) { ctx.beginPath(); ctx.arc(u, v, 0.6 + r() * 0.5, 0, 7); ctx.fill(); }
    else ctx.fillRect(u - 0.8, v - 0.6, 1.2 + r() * 0.8, 0.9 + r() * 0.6);
  }
  // cajas y costales atras, debajo de la lona (se asoman por la orilla)
  ctx.fillStyle = '#b08a5a'; ctx.fillRect(-L + 1 + r() * (p.l - 5), c > 0 ? -Dd - 0.6 : Dd - 2.4, 3, 3);
  // la lona: del fondo hasta la mitad de la mesa, con su caida y la costura de en medio
  const col = LONAS_PUESTO[(r() * LONAS_PUESTO.length) | 0], lv0 = c > 0 ? -Dd - 0.5 : -Dd + mesa / 2, lv1 = c > 0 ? Dd - mesa / 2 : Dd + 0.5;
  ctx.fillStyle = col; ctx.fillRect(-L, lv0, p.l, lv1 - lv0);
  const g = ctx.createLinearGradient(0, lv0, 0, lv1);
  g.addColorStop(0, c > 0 ? 'rgba(0,0,0,0.18)' : 'rgba(255,255,255,0.16)'); g.addColorStop(1, c > 0 ? 'rgba(255,255,255,0.16)' : 'rgba(0,0,0,0.18)');
  ctx.fillStyle = g; ctx.fillRect(-L, lv0, p.l, lv1 - lv0);
  if (r() < 0.35) { ctx.fillStyle = 'rgba(255,255,255,0.75)'; for (let u = -L + 1; u < L; u += 3) ctx.fillRect(u, lv0, 1.5, lv1 - lv0); } // lona rayada
  ctx.strokeStyle = 'rgba(0,0,0,0.25)'; ctx.lineWidth = 0.5; ctx.beginPath(); ctx.moveTo(0, lv0); ctx.lineTo(0, lv1); ctx.stroke();
  ctx.strokeRect(-L, lv0, p.l, lv1 - lv0);
  ctx.restore();
}
// lo que carga cada vendedor de la fila (ver VENDEDORES): dibujado viendo a la derecha (+x), en las manos
function makeMercancia(scene) {
  const S = 16, dibujos = {
    churros: (x) => { x.fillStyle = '#f3efe6'; x.fillRect(2, 4, 9, 8); x.strokeStyle = '#b08a52'; x.lineWidth = 0.6; x.strokeRect(2, 4, 9, 8);
      x.lineCap = 'round'; x.strokeStyle = '#c47f2c'; x.lineWidth = 1.4; for (let i = 0; i < 4; i++) { x.beginPath(); x.moveTo(3.5 + i * 2, 5); x.lineTo(5 + i * 2, 11); x.stroke(); } },
    agua: (x) => { x.fillStyle = '#7a5a3a'; x.fillRect(2, 3, 10, 10); for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) {
      x.fillStyle = ['#5fb4e8', '#e05a3a', '#f2c230'][(i + j) % 3]; x.beginPath(); x.arc(4 + i * 3, 5 + j * 3, 1.2, 0, 7); x.fill(); } },
    cobija: (x) => { for (let i = 0; i < 6; i++) { x.fillStyle = ['#c0392b', '#f1c40f', '#27ae60', '#2e86c1', '#8e44ad', '#e67e22'][i]; x.fillRect(1, 2 + i * 2, 11, 2); }
      x.strokeStyle = 'rgba(0,0,0,0.35)'; x.lineWidth = 0.5; x.strokeRect(1, 2, 11, 12); },
    yeso: (x) => { x.fillStyle = '#efe8da'; x.beginPath(); x.ellipse(6, 8, 4, 5, 0, 0, 7); x.fill(); x.fillStyle = '#4f8fd1'; x.beginPath(); x.ellipse(6, 9, 3, 3.2, 0, 0, 7); x.fill();
      x.fillStyle = '#f0c8a0'; x.beginPath(); x.arc(8.5, 6.5, 1.5, 0, 7); x.fill(); x.fillStyle = '#e8a0b0'; x.beginPath(); x.arc(4, 12, 1.4, 0, 7); x.fill(); },
    dulces: (x) => { x.fillStyle = '#b8864b'; x.beginPath(); x.ellipse(7, 8, 5.5, 5, 0, 0, 7); x.fill(); x.strokeStyle = '#8a5e2e'; x.lineWidth = 0.7; x.stroke();
      for (let i = 0; i < 8; i++) { x.fillStyle = ['#e74c3c', '#f1c40f', '#2ecc71', '#ecf0f1', '#9b59b6'][i % 5]; x.fillRect(3.5 + (i % 4) * 2, 6 + ((i / 4) | 0) * 2.6, 1.6, 1.6); } },
  };
  for (const k in dibujos) {
    const t = scene.textures.createCanvas('vende_' + k, S * SPR, S * SPR), x = t.getContext();
    x.scale(SPR, SPR); x.shadowColor = 'rgba(0,0,0,0.35)'; x.shadowBlur = 1.2; x.shadowOffsetX = 0.6; x.shadowOffsetY = 0.8;
    dibujos[k](x); t.refresh();
  }
}
// un canal (ver waterAreas): desde la orilla hacia adentro, la barda, el talud de concreto (claro arriba, oscuro
// abajo, con la sombra de la barda del lado de arriba a la izquierda, como la de los edificios), el piso de
// concreto con su humedad y en medio el hilo de agua verdosa. Todo es la misma figura con trazos cada vez mas
// delgados recortados al poligono: el grueso de un trazo pinta hasta su mitad hacia adentro
const AGUA_CANAL = 'rgba(70,115,85,0.32)', ORILLA = 'rgba(45,38,30,0.6)', BARDA = '#d8d2c6';
function pintarCanal(ctx, a) {
  const { b, f } = a.canal, conc = areaFill(ctx, TEX_CANAL);
  ctx.save(); ctx.lineJoin = 'round';
  trace(ctx, a.p, true); ctx.clip();
  ctx.fillStyle = areaFill(ctx, AREA_AGUA); ctx.fill(); ctx.fillStyle = AGUA_CANAL; ctx.fill();
  const tr = (w, col) => { ctx.lineWidth = w; ctx.strokeStyle = col; ctx.stroke(); };
  tr(2 * (b + f) + 3, 'rgba(225,235,225,0.35)'); // la orilla del agua, bajita
  tr(2 * (b + f) + 1.5, 'rgba(40,50,40,0.5)');
  tr(2 * (b + f), conc); tr(2 * (b + f), 'rgba(55,65,50,0.24)'); // el piso, humedo
  tr(2 * b + 2, 'rgba(0,0,0,0.28)'); // el pie del talud
  tr(2 * b, conc);
  for (const [k, al] of [[0.75, 0.09], [0.5, 0.09], [0.25, 0.1]]) tr(2 * b * k, 'rgba(255,253,245,' + al + ')'); // el talud aclara hacia arriba
  // la sombra de la barda: lo que queda dentro del canal pero fuera del canal corrido hacia abajo a la derecha
  const sx = Math.min(6, b * 0.5 + 2), sy = sx * 1.2;
  ctx.beginPath(); ctx.rect(a.bb[0] - 10, a.bb[1] - 10, a.bb[2] - a.bb[0] + 20, a.bb[3] - a.bb[1] + 20);
  ctx.moveTo(a.p[0] + sx, a.p[1] + sy); for (let i = 2; i < a.p.length; i += 2) ctx.lineTo(a.p[i] + sx, a.p[i + 1] + sy); ctx.closePath();
  ctx.fillStyle = 'rgba(0,0,0,0.22)'; ctx.fill('evenodd');
  trace(ctx, a.p, true); tr(7, 'rgba(40,35,30,0.25)'); tr(5, BARDA);
  ctx.restore();
  trace(ctx, a.p, true); ctx.lineWidth = 1; ctx.strokeStyle = ORILLA; ctx.stroke();
}
// los arroyos (lineas de clase 11) tambien van entubados: la barda, el talud, el piso y el hilo de agua
function pintarArroyo(ctx, r) {
  const w = r.w * M;
  ctx.save(); ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  trace(ctx, r.p);
  const tr = (k, col) => { ctx.lineWidth = k; ctx.strokeStyle = col; ctx.stroke(); };
  tr(w + 1.5, ORILLA); tr(w, BARDA); tr(w - 3, areaFill(ctx, TEX_CANAL));
  tr(w * 0.82, 'rgba(255,253,245,0.07)'); tr(w * 0.62 + 1.5, 'rgba(0,0,0,0.22)'); tr(w * 0.62, 'rgba(60,70,55,0.18)');
  tr(w * 0.3 + 2, 'rgba(225,235,225,0.3)'); tr(w * 0.3 + 0.8, 'rgba(40,50,40,0.5)');
  tr(w * 0.3, areaFill(ctx, AREA_AGUA)); tr(w * 0.3, AGUA_CANAL);
  ctx.restore();
}
// orilla del pasto: que no acabe en una raya derecha. Por fuera, un halo de tierra pisada y pasto seco; por
// dentro, el borde un poco mas seco; y sobre la raya, matitas del mismo pasto que se salen y unas hojitas
// sueltas hacia afuera. Todo sale del numero del lado del poligono, asi que los trozos vecinos casan
const ORILLA_PASTO = 9;
function ladosPasto(a, idx, X0, Y0, X1, Y1, fn) {
  const p = a.p, n = p.length / 2, m = ORILLA_PASTO;
  for (let i = 0; i < n; i++) {
    const ax = p[i * 2], ay = p[i * 2 + 1], j = (i + 1) % n, bx = p[j * 2], by = p[j * 2 + 1];
    if (Math.max(ax, bx) < X0 - m || Math.min(ax, bx) > X1 + m || Math.max(ay, by) < Y0 - m || Math.min(ay, by) > Y1 + m) continue;
    const len = Math.hypot(bx - ax, by - ay); if (len < 0.5) continue;
    fn(ax, ay, (bx - ax) / len, (by - ay) / len, len, mulberry(idx * 7919 + i * 31 + 5));
  }
}
function haloPasto(ctx, a) {
  ctx.lineJoin = 'round';
  trace(ctx, a.p, true);
  ctx.lineWidth = 9; ctx.strokeStyle = 'rgba(120,112,72,0.22)'; ctx.stroke();
  ctx.lineWidth = 5; ctx.strokeStyle = 'rgba(105,110,60,0.28)'; ctx.stroke();
}
function orillaPasto(ctx, a, idx, X0, Y0, X1, Y1) {
  if (a.giro === undefined) { let s = 0; const p = a.p; for (let i = 0, n = p.length; i < n; i += 2) { const j = (i + 2) % n; s += p[i] * p[j + 1] - p[j] * p[i + 1]; } a.giro = s > 0 ? 1 : -1; }
  const g = a.giro; // la normal hacia afuera de un lado (ux,uy) es (uy,-ux)*g en coordenadas de pantalla
  // por dentro: el borde mas seco y un poco mas oscuro justo en la raya
  ctx.save(); trace(ctx, a.p, true); ctx.clip(); ctx.lineJoin = 'round';
  ctx.lineWidth = 7; ctx.strokeStyle = 'rgba(160,150,80,0.16)'; ctx.stroke();
  ctx.lineWidth = 2.4; ctx.strokeStyle = 'rgba(30,45,15,0.18)'; ctx.stroke();
  ctx.restore();
  // matitas: circulitos del pasto encima de la raya, unos salidos y otros mordidos hacia adentro
  ctx.beginPath();
  const hojasO = new Path2D(), hojasC = new Path2D();
  ladosPasto(a, idx, X0, Y0, X1, Y1, (ax, ay, ux, uy, len, rnd) => {
    const nx = uy * g, ny = -ux * g;
    for (let t = rnd() * 2.5; t < len; t += 1.6 + rnd() * 2.2) {
      const o = (rnd() - 0.35) * 2.6, r = 0.9 + rnd() * 1.7, x = ax + ux * t + nx * o, y = ay + uy * t + ny * o;
      ctx.moveTo(x + r, y); ctx.arc(x, y, r, 0, 7);
      // hojitas que se asoman: casi derecho hacia afuera, ladeadas al azar
      if (rnd() < 0.8) {
        const l = 1.4 + rnd() * 2.4, d = (rnd() - 0.5) * 1.4, c = Math.cos(d), s = Math.sin(d);
        const hx = nx * c - ny * s, hy = nx * s + ny * c, bx = ax + ux * (t + rnd() * 1.5) + nx * (o + r * 0.5), by = ay + uy * (t + rnd()) + ny * (o + r * 0.5);
        const h = rnd() < 0.55 ? hojasO : hojasC; h.moveTo(bx, by); h.lineTo(bx + hx * l, by + hy * l);
      }
    }
  });
  ctx.fillStyle = areaFill(ctx, a.k); ctx.fill();
  ctx.lineCap = 'round'; ctx.lineWidth = 0.6;
  ctx.strokeStyle = 'rgba(35,65,20,0.55)'; ctx.stroke(hojasO);
  ctx.strokeStyle = 'rgba(150,180,85,0.5)'; ctx.stroke(hojasC);
}
// los lagos, la presa, los estanques y el mar: la orilla de lodo mojado por fuera; por dentro, el agua clarita y
// bajita junto a la orilla que se va haciendo honda, una rayita de espuma, la sombra del bordo arriba a la
// izquierda (el agua va mas abajo que la tierra) y unos tulares. Solo cuentan los lados que dan a tierra: donde un
// lago se junta con otra agua (la presa viene en pedazos, los canales que le llegan) no hay orilla
const ORILLA_LAGO = 40;
// lado i da a tierra? (se calcula la primera vez que un trozo lo necesita: la presa tiene mas de mil lados)
function esOrilla(a, i) {
  const L = a.lago, p = a.p, n = p.length / 2;
  if (!L.orilla) {
    let s = 0;
    for (let k = 0; k < n; k++) { const j = (k + 1) % n; s += p[k * 2] * p[j * 2 + 1] - p[j * 2] * p[k * 2 + 1]; }
    L.giro = s > 0 ? 1 : -1; L.orilla = new Int8Array(n).fill(-1);
  }
  if (L.orilla[i] < 0) {
    const j = (i + 1) % n, ax = p[i * 2], ay = p[i * 2 + 1], bx = p[j * 2], by = p[j * 2 + 1], len = Math.hypot(bx - ax, by - ay) || 1, g = L.giro;
    // un punto un poquito afuera del lado: si cae en otra agua, ese lado no es orilla
    const x = (ax + bx) / 2 + (by - ay) / len * g * 2, y = (ay + by) / 2 - (bx - ax) / len * g * 2;
    const c = waterGrid.get(GK(Math.floor(x / WCELL), Math.floor(y / WCELL)));
    L.orilla[i] = c && c.some(k => { const w = waterAreas[k]; return w !== a && !(w.lago && w.lago.dup) && x >= w.bb[0] && x <= w.bb[2] && y >= w.bb[1] && y <= w.bb[3] && pip(x, y, w.p); }) ? 0 : 1;
  }
  return L.orilla[i];
}
// el camino de la orilla dentro del trozo (con margen): tramos seguidos de lados que dan a tierra
function caminoOrilla(a, X0, Y0, X1, Y1) {
  const p = a.p, n = p.length / 2, m = ORILLA_LAGO, path = new Path2D(); let abierto = false, hay = false;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n, ax = p[i * 2], ay = p[i * 2 + 1], bx = p[j * 2], by = p[j * 2 + 1];
    if (Math.max(ax, bx) < X0 - m || Math.min(ax, bx) > X1 + m || Math.max(ay, by) < Y0 - m || Math.min(ay, by) > Y1 + m || !esOrilla(a, i)) { abierto = false; continue; }
    if (!abierto) path.moveTo(ax, ay);
    path.lineTo(bx, by); abierto = hay = true;
  }
  return hay ? path : null;
}
function haloLago(ctx, a, path) {
  const mar = a.lago.W > 5000;
  ctx.lineJoin = 'round'; ctx.lineCap = 'round';
  if (mar) { ctx.lineWidth = 16; ctx.strokeStyle = 'rgba(214,200,160,0.55)'; ctx.stroke(path); }
  ctx.lineWidth = 9; ctx.strokeStyle = mar ? 'rgba(150,135,100,0.45)' : 'rgba(110,98,70,0.35)'; ctx.stroke(path);
  ctx.lineWidth = 5; ctx.strokeStyle = mar ? 'rgba(120,105,75,0.4)' : 'rgba(80,70,50,0.4)'; ctx.stroke(path);
}
function pintarLago(ctx, a, idx, path, X0, Y0, X1, Y1) {
  const W = a.lago.W, D = Math.max(6, Math.min(W > 5000 ? 70 : 34, W * 0.3));
  ctx.save(); trace(ctx, a.p, true); ctx.clip(); ctx.lineJoin = 'round'; ctx.lineCap = 'round';
  const tr = (w, col) => { ctx.lineWidth = w; ctx.strokeStyle = col; ctx.stroke(path); };
  // lo bajito: capas que se enciman hacia la orilla, verde agua y luego arenoso
  for (const k of [1, 0.8, 0.62, 0.46, 0.32, 0.2]) tr(2 * D * k, 'rgba(105,150,135,0.085)');
  tr(Math.min(10, D * 0.5), 'rgba(150,140,100,0.22)');
  // la sombra del bordo: la misma orilla corrida abajo a la derecha, solo se queda del lado de arriba-izquierda
  ctx.save(); ctx.translate(2.5, 3); tr(6, 'rgba(15,25,30,0.22)'); ctx.restore();
  tr(2.4, 'rgba(225,238,235,0.45)'); // espuma
  ctx.restore();
  ctx.lineWidth = 1; ctx.strokeStyle = 'rgba(45,38,30,0.45)'; ctx.stroke(path);
  // la orilla no es una raya: bolitas de lodo que se meten al agua, piedritas y (no en el mar) tulares
  const p = a.p, n = p.length / 2, g = a.lago.giro, m = ORILLA_LAGO;
  const lodo = new Path2D(), piedra = new Path2D(), ver = new Path2D(), caf = new Path2D();
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n, ax = p[i * 2], ay = p[i * 2 + 1], bx = p[j * 2], by = p[j * 2 + 1], len = Math.hypot(bx - ax, by - ay);
    if (len < 1 || Math.max(ax, bx) < X0 - m || Math.min(ax, bx) > X1 + m || Math.max(ay, by) < Y0 - m || Math.min(ay, by) > Y1 + m || !esOrilla(a, i)) continue;
    const rnd = mulberry(idx * 6151 + i * 17 + 3), ux = (bx - ax) / len, uy = (by - ay) / len, nx = -uy * g, ny = ux * g; // hacia adentro
    for (let t = rnd() * 3; t < len; t += 1.4 + rnd() * 2.6) {
      const q = rnd() * 2.4 - 0.5, r = 0.7 + rnd() * 1.7, x = ax + ux * t + nx * q, y = ay + uy * t + ny * q;
      lodo.moveTo(x + r, y); lodo.arc(x, y, r, 0, 7);
      if (rnd() < 0.12) { const R = 0.5 + rnd() * 0.9, px = x + nx * (r + 0.5), py = y + ny * (r + 0.5); piedra.moveTo(px + R, py); piedra.arc(px, py, R, 0, 7); }
    }
    if (W >= 5000) continue;
    for (let t = rnd() * 40; t < len; t += 25 + rnd() * 60) {
      if (rnd() < 0.35) continue;
      const k = 3 + rnd() * 3, cx = ax + ux * t + nx * (1 + rnd() * 3), cy = ay + uy * t + ny * (1 + rnd() * 3), tallos = 12 + rnd() * 14;
      for (let q = 0; q < tallos; q++) {
        // tallos que salen de la mata hacia afuera, unos verdes y otros secos
        const ang = rnd() * Math.PI * 2, r = rnd() * k * 0.35, l = k * (0.5 + rnd() * 0.6), sx = cx + Math.cos(ang) * r, sy = cy + Math.sin(ang) * r;
        const h = q % 4 ? ver : caf; h.moveTo(sx, sy); h.lineTo(sx + Math.cos(ang) * l, sy + Math.sin(ang) * l);
      }
    }
  }
  ctx.fillStyle = 'rgba(105,92,66,0.55)'; ctx.fill(lodo);
  ctx.fillStyle = 'rgba(150,145,135,0.9)'; ctx.fill(piedra);
  ctx.lineCap = 'round'; ctx.lineWidth = 0.7; ctx.strokeStyle = 'rgba(55,90,35,0.9)'; ctx.stroke(ver);
  ctx.strokeStyle = 'rgba(150,130,75,0.85)'; ctx.stroke(caf);
}
function* chunkSteps(cx, cy) {
  const cv = document.createElement('canvas'); cv.width = cv.height = (CHUNK + 2) * RES;
  const ctx = cv.getContext('2d', CTX2D);
  ctx.scale(RES, RES); ctx.translate(1 - cx * CHUNK, 1 - cy * CHUNK);
  ctx.fillStyle = areaFill(ctx, TEX_TIERRA); ctx.fillRect(cx * CHUNK - 1, cy * CHUNK - 1, CHUNK + 2, CHUNK + 2);
  const k = GK(cx, cy);
  // el agua va encima de las demas areas (en el mapa a veces se enciman con el canal)
  const ia = Array.from(chunkAreas.get(k) || []), ar = ia.map(i => areas[i]), canales = ar.filter(a => a.canal);
  const X0 = cx * CHUNK, Y0 = cy * CHUNK, X1 = X0 + CHUNK, Y1 = Y0 + CHUNK, pasto = a => a.k === 0 || a.k === 1;
  // los halos del pasto antes que todas las areas: solo se ven sobre la tierra pelona
  for (const a of ar) if (pasto(a)) haloPasto(ctx, a);
  for (const a of ar) if (a.k !== AREA_AGUA) { ctx.fillStyle = areaFill(ctx, a.k); trace(ctx, a.p, true); ctx.fill(); }
  pintarRelieve(ctx, X0, Y0, X1, Y1); // los cerros y cañones (encima de las areas, debajo de lo demas)
  yield* pintarCerro(ctx, X0, Y0); // la tierra colorada y los matorrales del Cerro Colorado
  // (pasos cortos: en el celular un paso de mas de unos 8 ms ya hace que se brinque un cuadro)
  if (ar.length) yield;
  let hay = false;
  ar.forEach((a, n) => { if (pasto(a)) { orillaPasto(ctx, a, ia[n], X0, Y0, X1, Y1); hay = true; } });
  if (hay) yield; // las orillas del pasto cuestan un par de milisegundos en el celular: lo demas en otro cuadro
  const lagos = []; ar.forEach((a, n) => { if (a.lago && !a.lago.dup) { const c = caminoOrilla(a, X0, Y0, X1, Y1); lagos.push([a, ia[n], c]); } });
  for (const [a, , c] of lagos) if (c) haloLago(ctx, a, c);
  // los arroyos entubados antes que el agua: donde llegan a un lago o a un canal, el agua los tapa
  for (const r of chunkRoads.get(k) || []) if (esRio(roads[r])) pintarArroyo(ctx, roads[r]);
  for (const [a] of lagos) { ctx.fillStyle = areaFill(ctx, a.k); trace(ctx, a.p, true); ctx.fill(); }
  for (const [a, i, c] of lagos) if (c) pintarLago(ctx, a, i, c, X0, Y0, X1, Y1);
  for (const a of canales) pintarCanal(ctx, a);
  if (lagos.length || canales.length) yield;
  yield* pintarJardines(ctx, chunkBlds.get(k) || [], ar); // los jardines de una colonia cuestan unos milisegundos
  for (const e of chunkEst.get(k) || []) pintarEstacionamiento(ctx, e);
  const sl = chunkSuelo.get(k) || [];
  for (const e of sl) pintarSuelo(ctx, e);
  if (sl.length) yield; // los patios y lotes cuestan unos milisegundos: el resto del trozo en otro cuadro
  const rs = Array.from(chunkRoads.get(k) || [], i => roads[i]);
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  const asfalto = areaFill(ctx, TEX_ASFALTO);
  const pass = (list, width, color, filter, off) => {
    for (const r of list) {
      if (!filter(r)) continue;
      ctx.strokeStyle = typeof color === 'function' ? color(r) : color; ctx.lineWidth = width(r);
      for (const d of off ? off(r) : [0]) { trace(ctx, d ? offsetLine(r, d) : r.p); ctx.stroke(); }
    }
  };
  const ground = rs;
  // debajo de los edificios: agua, andadores y vias del tren
  const under = (list) => {
    pass(list, r => r.w * M, r => areaFill(ctx, r.c === 8 ? AREA_PLAZA : TEX_SENDERO), r => r.c === 8 || r.c === 9);
    pass(list, () => 3 * M, COL.rail, r => r.c === 10);
    ctx.setLineDash([2, 6]); pass(list, () => 3 * M, '#3a2d22', r => r.c === 10);
    ctx.setLineDash([]); pass(list, () => 1, '#9a9aa0', r => r.c === 10);
  };
  // encima de los edificios: calles con banqueta y lineas de carril
  const over = (list) => {
    // los puentes no llevan banqueta sino una barda de concreto angosta con su orilla oscura
    pass(list, r => (r.w + BANQ[r.c] * 2 + 0.5) * M, COL.curb, r => r.c <= 6);
    const banq = areaFill(ctx, TEX_BANQUETA);
    pass(list, r => (r.w + BANQ[r.c] * 2) * M, banq, r => r.c <= 6);
    // los accesos, estacionamientos y callejones (clase 7) van por debajo de las calles, sin banqueta y de asfalto
    // mas claro: se distinguen de las calles de verdad (el trafico no entra ahi) y no parecen calles que no llevan a nada.
    // Su orilla: una raya oscura y la guarnicion de concreto. Todo de color solido (con uno transparente, donde se
    // enciman dos pedazos se veia mas claro)
    pass(list, r => (r.w + 1.4) * M, '#46423a', r => r.c === 7);
    pass(list, r => (r.w + 1) * M, '#a39b8a', r => r.c === 7);
    pass(list, r => r.w * M - 2, areaFill(ctx, TEX_ACCESO), r => r.c === 7);
    // orilla polvosa junto a la banqueta; el asfalto limpio de los cruces la tapa
    pass(list, r => r.w * M, '#4b4842', r => r.c <= 6);
    pass(list, r => r.w * M - 9, asfalto, r => r.c <= 6);
    // esquinas redondeadas (ver esquinasTrozo)
    const esq = esquinasTrozo(cx, cy);
    ctx.fillStyle = '#4b4842'; for (const e of esq) if (esquinaPath(ctx, e, 0)) ctx.fill();
    ctx.fillStyle = asfalto; for (const e of esq) if (esquinaPath(ctx, e, ESQ_POLVO)) ctx.fill();
    // solo la raya de en medio que separa los dos sentidos (doble en avenidas, punteada en calles);
    // sin lineas de carril ni rayas en calles de un sentido: se mezclaban y ensuciaban el dibujo
    ctx.setLineDash([]);
    pass(list, () => 2, COL.yellow, r => r.c <= MAJOR && !(r.f & 2), () => [-2, 2]);
    ctx.setLineDash([16, 16]);
    pass(list, () => 2, COL.yellow, r => r.c === 4 && !(r.f & 2));
    ctx.setLineDash([]);
  };
  under(ground);
  const bl = chunkBlds.get(k) || [];
  ctx.fillStyle = 'rgba(0,0,0,0.26)';
  for (const b of bl) { ctx.save(); ctx.translate(b.sh, b.sh); trace(ctx, b.p, true); ctx.fill(); ctx.restore(); }
  yield;
  over(ground);
  grime(ctx, ground, cx, cy);
  roadMarks(ctx, k);
  for (const p of chunkPuestos.get(k) || []) pintarPuesto(ctx, p);

  yield;
  yield* drawBuildings(ctx, bl, rs, cx, cy);
  pintarSenales(ctx, k);
  // las sombras de los arboles (con mas arboles en las colonias, revisar cuales van cuesta)
  for (const i of chunkArboles.get(k) || []) { if (!arbolVa(i)) continue; ctx.drawImage(arbolSprite(arboles.T[i], arboles.V[i], 0), arboles.X[i] - ARB_SZ / 2, arboles.Y[i] - ARB_SZ / 2, ARB_SZ, ARB_SZ); }
  // lado de Estados Unidos
  const x0 = cx * CHUNK, x1 = x0 + CHUNK;
  const fr = fronteraPts(x0 - 2, x1 + 2);
  if (fr.some((v, i) => i % 2 && v > cy * CHUNK)) {
    ctx.beginPath(); ctx.moveTo(x0 - 2, cy * CHUNK - 2); ctx.lineTo(x1 + 2, cy * CHUNK - 2);
    for (let i = fr.length - 2; i >= 0; i -= 2) ctx.lineTo(fr[i], fr[i + 1]);
    ctx.closePath();
    ctx.fillStyle = COL.us; ctx.fill();
    ctx.strokeStyle = COL.fence; ctx.lineWidth = 7; ctx.beginPath(); for (let i = 0; i < fr.length; i += 2) ctx.lineTo(fr[i], fr[i + 1]); ctx.stroke();
    ctx.strokeStyle = '#2b1d12'; ctx.lineWidth = 7; ctx.setLineDash([2, 5]); ctx.stroke(); ctx.setLineDash([]);
    ctx.fillStyle = 'rgba(255,255,255,0.35)'; ctx.font = 'bold 28px sans-serif';
    for (let x = Math.ceil(x0 / 900) * 900 + 300; x < x1; x += 900) ctx.fillText('EE. UU.', x, borderY(x) - 60);
  }
  return cv;
}
// ---------- el relieve de verdad ----------
// Los cerros, cañones y mesas de Tijuana con sus alturas reales (ver tools/relieve.py): una capa de 16 m por pixel,
// clara donde le pega la luz del noroeste y oscura en las laderas de la sombra, que se estira encima del piso de cada
// trozo (y del minimapa), debajo de calles y casas. Se carga mientras estas en la portada.
const RELIEVE = new Image(), RELIEVE_PASO = 16 * M;
let relieveListo = false;
RELIEVE.onload = () => { relieveListo = true; };
RELIEVE.src = 'data/relieve.png';
// el pedazo del rectangulo (x0, y0)-(x1, y1) del mundo, en las coordenadas del mundo del lienzo
function pintarRelieve(ctx, x0, y0, x1, y1) {
  if (!relieveListo) return;
  const P = RELIEVE_PASO, sx = Math.max(0, Math.floor(x0 / P) - 1), sy = Math.max(0, Math.floor(y0 / P) - 1);
  const ex = Math.min(RELIEVE.width, Math.ceil(x1 / P) + 1), ey = Math.min(RELIEVE.height, Math.ceil(y1 / P) + 1);
  if (ex <= sx || ey <= sy) return;
  ctx.save(); ctx.imageSmoothingEnabled = true;
  ctx.drawImage(RELIEVE, sx, sy, ex - sx, ey - sy, sx * P, sy * P, (ex - sx) * P, (ey - sy) * P);
  ctx.restore();
}
// ---------- el Cerro Colorado ----------
// El sombreado ya lo pone el relieve de verdad (ver pintarRelieve); aqui va lo demas, con una altura inventada (un
// domo con lomas y cañadas, en metros): la tierra mas rojiza conforme se sube, matorrales en las laderas y piedras en
// las crestas. Va en el piso del trozo, debajo de calles y casas.
const CERRO = (() => { const l = landmarks.find(q => q.name === 'Mirador del Cerro Colorado'); return l && { x: l.x, y: l.y, R: 2100 }; })();
function ruidoV(x, y) { // ruido suave entre -1 y 1
  const xi = Math.floor(x), yi = Math.floor(y), fx = x - xi, fy = y - yi, u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy);
  const h = (i, j) => (hash(Math.imul(i, 73856093) ^ Math.imul(j, 19349663)) & 0xffff) / 32767.5 - 1;
  const a = h(xi, yi), b = h(xi + 1, yi), c = h(xi, yi + 1), d = h(xi + 1, yi + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
// altura en metros de un punto del mapa (px)
function alturaCerro(x, y) {
  const dx = (x - CERRO.x) / M, dy = (y - CERRO.y) / M, d = Math.hypot(dx, dy);
  if (d > CERRO.R) return 0;
  // el cuerpo: un domo un poco alargado de norte a sur, con otro mas chico al suroeste
  const e = Math.hypot(dx, dy / 1.3);
  let h = 400 * Math.exp(-((e / 700) ** 2)) + 140 * Math.exp(-(((dx + 650) ** 2 + (dy - 500) ** 2) / 380 ** 2));
  // lomas y cañadas que bajan del pico: crestas de ruido (1 - |ruido|) que cambian rapido alrededor (con el angulo,
  // en un circulo para que no haya costura, un poco chueco) y despacio hacia abajo, revueltas con otras sueltas;
  // mas marcadas a media ladera
  const an = Math.atan2(dy, dx) + 0.22 * ruidoV(dx / 260, dy / 260), ca = Math.cos(an), sa = Math.sin(an);
  let r = 0;
  // (hacia abajo: entre dos rebanadas de ruido sin relacion, para que no se tuerzan en espiral)
  const ds = d / 330, di = Math.floor(ds), df = ds - di, dt = df * df * (3 - 2 * df);
  for (const [k, w, o] of [[2.6, 1, 0], [6.2, 0.5, 17]]) {
    const a0 = ruidoV(ca * k + 37 * di + o, sa * k + 91 * di), a1 = ruidoV(ca * k + 37 * (di + 1) + o, sa * k + 91 * (di + 1));
    const n = 1 - Math.abs(a0 + (a1 - a0) * dt); r += n * n * w;
  }
  const n2 = 1 - Math.abs(ruidoV(dx / 300 + 40, dy / 300 + ruidoV(dx / 700, dy / 700)));
  r = r / 1.5 * 0.6 + n2 * n2 * 0.4;
  h += 110 * (e / 750) * Math.exp(-((e / 950) ** 2)) * (r - 0.35);
  h += 1.5 * ruidoV(dx / 40, dy / 40); // lo rugoso
  // y se pierde en lo plano
  const t = Math.min(1, Math.max(0, (CERRO.R - d) / 700));
  return h * t * t * (3 - 2 * t);
}
const CERRO_PASO = 8; // px entre muestras del sombreado
const cerroCv2 = document.createElement('canvas');
// pinta el relieve en el trozo (x0, y0), en dos pasos (en el celular cada uno cuesta unos milisegundos)
function* pintarCerro(ctx, x0, y0) {
  if (!CERRO || Math.hypot(x0 + CHUNK / 2 - CERRO.x, y0 + CHUNK / 2 - CERRO.y) > CERRO.R * M + CHUNK) return;
  const P = CERRO_PASO, N = CHUNK / P + 3, gx0 = Math.floor(x0 / P) - 1, gy0 = Math.floor(y0 / P) - 1;
  // alturas en la rejilla (con una orilla de mas para las pendientes)
  const H = new Float32Array((N + 2) * (N + 2));
  for (let j = 0; j < N + 2; j++) for (let i = 0; i < N + 2; i++) H[j * (N + 2) + i] = alturaCerro((gx0 + i - 1) * P, (gy0 + j - 1) * P);
  if (!H.some(v => v > 0.5)) return;
  cerroCv2.width = cerroCv2.height = N;
  const c2 = cerroCv2.getContext('2d'), tinte = c2.createImageData(N, N);
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const h = H[(j + 1) * (N + 2) + i + 1], o = (j * N + i) * 4;
    // la tierra colorada de arriba (por eso el nombre)
    tinte.data[o] = 168; tinte.data[o + 1] = 82; tinte.data[o + 2] = 48; tinte.data[o + 3] = Math.min(80, Math.max(0, h) * 0.22);
  }
  c2.putImageData(tinte, 0, 0);
  ctx.save(); ctx.imageSmoothingEnabled = true;
  ctx.drawImage(cerroCv2, gx0 * P, gy0 * P, N * P, N * P);
  ctx.restore();
  yield;
  // la altura de un punto del trozo, de la rejilla (mas barato que alturaCerro)
  const hAt = (x, y) => {
    const fx = Math.max(0, Math.min(N, x / P - gx0 + 1)), fy = Math.max(0, Math.min(N, y / P - gy0 + 1)), i = Math.floor(fx), j = Math.floor(fy), u = fx - i, v = fy - j, k = j * (N + 2) + i;
    return H[k] * (1 - u) * (1 - v) + H[k + 1] * u * (1 - v) + H[k + N + 2] * (1 - u) * v + H[k + N + 3] * u * v;
  };
  ctx.save();  // matorrales (chaparral) en las laderas, mas en las que dan al norte, y piedras en lo alto; cada 4 m uno o ninguno
  const C = 4 * M;
  for (let cy = Math.floor(y0 / C) - 1; cy <= Math.floor((y0 + CHUNK) / C); cy++) for (let cx = Math.floor(x0 / C) - 1; cx <= Math.floor((x0 + CHUNK) / C); cx++) {
    const r = mulberry(Math.imul(cx, 92821) ^ Math.imul(cy, 68917) ^ 0x5eed), x = (cx + r()) * C, y = (cy + r()) * C, h = hAt(x, y);
    if (h < 8) continue;
    const gy = hAt(x, y + P) - hAt(x, y - P), gx = hAt(x + P, y) - hAt(x - P, y), pend = Math.hypot(gx, gy) / (2 * P / M);
    const q = r();
    if (q < 0.05 + (gy < 0 ? 0.07 : 0) - h / 5000) { // matorral: verde olivo seco, con su sombrita
      const rr = (1.2 + r() * 1.6) * M;
      ctx.fillStyle = 'rgba(30,22,10,0.25)'; ctx.beginPath(); ctx.ellipse(x + rr * 0.35, y + rr * 0.35, rr, rr * 0.8, 0, 0, 7); ctx.fill();
      ctx.fillStyle = ['#6f7444', '#5f6a3c', '#7c7a4a', '#8a7f52'][(r() * 4) | 0]; ctx.beginPath(); ctx.ellipse(x, y, rr, rr * 0.85, r() * 3, 0, 7); ctx.fill();
      ctx.fillStyle = 'rgba(255,250,220,0.15)'; ctx.beginPath(); ctx.ellipse(x - rr * 0.3, y - rr * 0.3, rr * 0.5, rr * 0.4, 0, 0, 7); ctx.fill();
    } else if (q > 0.985 - Math.min(0.03, pend * 0.03) && h > 150) { // piedras: grises claras, de lado
      const rr = (0.6 + r() * 1.2) * M;
      ctx.fillStyle = 'rgba(30,20,10,0.3)'; ctx.beginPath(); ctx.ellipse(x + rr * 0.4, y + rr * 0.4, rr, rr * 0.7, 0.5, 0, 7); ctx.fill();
      ctx.fillStyle = ['#a39a8c', '#8f877b', '#b5ab9a'][(r() * 3) | 0]; ctx.beginPath(); ctx.ellipse(x, y, rr, rr * 0.7, r() * 3, 0, 7); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.25)'; ctx.beginPath(); ctx.ellipse(x - rr * 0.3, y - rr * 0.25, rr * 0.45, rr * 0.3, 0, 0, 7); ctx.fill();
    }
  }
  ctx.restore();
}
// el trozo completo de una vez (al arrancar y para pruebas)
function drawChunk(cx, cy) { const it = chunkSteps(cx, cy); let r; while (!(r = it.next()).done); return r.value; }

// ---------- minimapa ----------
// Por cuadros del tamano de una region (todo el mapa de un jalon ya no cabria en memoria al crecer la ciudad).
// Cada cuadro: areas, la capa de edificios (un PNG hecho por tools/prep_data.py, asi no hacen falta los
// edificios cargados) y encima las calles. Se guardan los ultimos MINI_MAX; de lejos (el mapa grande alejado)
// se usa miniVista, una version chica de todo que se va llenando con los cuadros que se pintan.
const MS = 0.08;
const MINI_PAD = 16;                                    // orilla extra de cada cuadro (px del mundo): sin uniones
const MT = Math.ceil((REG_PX + 2 * MINI_PAD) * MS);     // lado de un cuadro en px del minimapa
const MINI_MAX = 64;
const MV = 0.02;                                        // escala de miniVista
const miniCapas = new Set(D.mini || []);
const miniCuadros = new Map();                          // 'x_y' -> { cv, listo } (en orden de uso)
const miniVista = document.createElement('canvas');
miniVista.width = Math.ceil(WORLD_W * MV); miniVista.height = Math.ceil(WORLD_H * MV);
const miniEnVista = new Set();
const alPintarMini = [];                                // avisos: llego la capa de edificios de un cuadro
function pintarCuadro(tx, ty, cv, capa) {
  const c = cv.getContext('2d'), x0 = tx * REG_PX - MINI_PAD, y0 = ty * REG_PX - MINI_PAD, x1 = x0 + MT / MS, y1 = y0 + MT / MS;
  c.setTransform(1, 0, 0, 1, 0, 0);
  c.fillStyle = '#6d6858'; c.fillRect(0, 0, MT, MT);
  // lo que toca el cuadro, en el orden de los datos (como cuando se pintaba todo de una vez)
  const A = new Set(), R = new Set();
  for (let cx = Math.floor(x0 / CHUNK); cx <= Math.floor(x1 / CHUNK); cx++) for (let cy = Math.floor(y0 / CHUNK); cy <= Math.floor(y1 / CHUNK); cy++) {
    const k = GK(cx, cy);
    for (const i of chunkAreas.get(k) || []) A.add(i);
    for (const i of chunkRoads.get(k) || []) R.add(i);
  }
  c.setTransform(MS, 0, 0, MS, -x0 * MS, -y0 * MS);
  for (const i of [...A].sort((a, b) => a - b)) { const a = areas[i]; c.fillStyle = AREA_COL[a.k]; trace(c, a.p, true); c.fill(); }
  pintarRelieve(c, x0, y0, x1, y1);
  if (capa) { c.setTransform(1, 0, 0, 1, 0, 0); c.drawImage(capa, 0, 0); c.setTransform(MS, 0, 0, MS, -x0 * MS, -y0 * MS); }
  c.lineCap = 'round';
  // las calles se salen un poco de su caja (el grueso minimo): tambien las de junto
  for (const i of [...R].sort((a, b) => a - b)) {
    const r = roads[i];
    if (r.c > 9) { if (esRio(r)) { c.strokeStyle = COL.water; c.lineWidth = 60; trace(c, r.p); c.stroke(); } continue; }
    c.strokeStyle = r.c <= 2 ? '#f2d16b' : r.c <= 6 ? '#2e2e33' : r.c === 7 ? '#55555a' : '#c8bda4';
    c.lineWidth = Math.max(r.w * M, r.c <= 6 ? 50 : 25); trace(c, r.p); c.stroke();
  }
  // el otro lado
  if (borderY(x0) > y0 || borderY(x1) > y0) {
    const f = fronteraPts(x0, x1);
    c.fillStyle = 'rgba(30,36,30,0.85)';
    c.beginPath(); c.moveTo(x0, y0 - 1); c.lineTo(x1, y0 - 1); for (let i = f.length - 2; i >= 0; i -= 2) c.lineTo(f[i], f[i + 1]); c.closePath(); c.fill();
    c.strokeStyle = '#a0522d'; c.lineWidth = 40; c.beginPath(); for (let i = 0; i < f.length; i += 2) c.lineTo(f[i], f[i + 1]); c.stroke();
  }
  // y en chiquito para la vista de lejos
  const v = miniVista.getContext('2d'), p = MINI_PAD * MS; v.imageSmoothingQuality = 'high';
  v.drawImage(cv, p, p, REG_PX * MS, REG_PX * MS, tx * REG_PX * MV, ty * REG_PX * MV, REG_PX * MV, REG_PX * MV);
}
function miniCuadro(tx, ty) {
  const k = tx + '_' + ty;
  let q = miniCuadros.get(k);
  if (q) { miniCuadros.delete(k); miniCuadros.set(k, q); return q.cv; }
  // se reusa el lienzo del que lleva mas sin usarse
  let cv;
  if (miniCuadros.size >= MINI_MAX) { const [k0, q0] = miniCuadros.entries().next().value; miniCuadros.delete(k0); cv = q0.cv; q0.viejo = true; }
  else { cv = document.createElement('canvas'); cv.width = cv.height = MT; }
  q = { cv }; miniCuadros.set(k, q);
  pintarCuadro(tx, ty, cv, null);
  if (miniCapas.has(k)) {
    const img = new Image();
    img.onload = () => {
      if (miniCuadros.get(k) !== q) return; // ya se reuso para otro cuadro
      pintarCuadro(tx, ty, cv, img); miniEnVista.add(k);
      for (const f of alPintarMini) f();
    };
    img.src = 'data/reg/' + k + '.png';
  } else miniEnVista.add(k);
  return cv;
}
// el minimapa del rectangulo del mundo (x0, y0)-(x0 + w/s, y0 + h/s) en el lienzo c, a escala s. Pinta a lo
// mas 'nuevos' cuadros que no estaban hechos (los demas, de miniVista si ya estan ahi) y dice si alcanzo
function pintarMini(c, x0, y0, w, h, s, nuevos = Infinity) {
  const x1 = x0 + w / s, y1 = y0 + h / s;
  let todos = true;
  for (let tx = Math.max(0, Math.floor(x0 / REG_PX)); tx <= Math.min(Math.floor(x1 / REG_PX), Math.floor((WORLD_W - 1) / REG_PX)); tx++)
    for (let ty = Math.max(0, Math.floor(y0 / REG_PX)); ty <= Math.min(Math.floor(y1 / REG_PX), Math.floor((WORLD_H - 1) / REG_PX)); ty++) {
      // solo la parte de adentro (sin la orilla), pegada a la de junto, y nada mas alla de la orilla del mapa
      const ww = Math.min(REG_PX, WORLD_W - tx * REG_PX), hh = Math.min(REG_PX, WORLD_H - ty * REG_PX);
      const X = (tx * REG_PX - x0) * s, Y = (ty * REG_PX - y0) * s;
      if (!miniCuadros.has(tx + '_' + ty) && nuevos-- <= 0) {
        todos = false;
        if (miniEnVista.has(tx + '_' + ty)) c.drawImage(miniVista, tx * REG_PX * MV, ty * REG_PX * MV, ww * MV, hh * MV, X, Y, ww * s, hh * s);
        continue;
      }
      const cv = miniCuadro(tx, ty), p = MINI_PAD * MS;
      c.drawImage(cv, p, p, ww * MS, hh * MS, X, Y, ww * s, hh * s);
    }
  return todos;
}
// al llegar edificios o la capa de un cuadro, el mapa grande se vuelve a pintar
alCargarRegion.push(() => { if (bigOpen) bmDraw(true); });
alPintarMini.push(() => { if (bigOpen) bmDraw(true); });
// cuadros que faltan en miniVista (para irlos pintando de a poco con el mapa grande abierto)
function miniFaltan() {
  const o = [];
  for (let tx = 0; tx * REG_PX < WORLD_W; tx++) for (let ty = 0; ty * REG_PX < WORLD_H; ty++) if (!miniEnVista.has(tx + '_' + ty)) o.push([tx, ty]);
  return o;
}
{ const v = miniVista.getContext('2d'); v.fillStyle = '#6d6858'; v.fillRect(0, 0, miniVista.width, miniVista.height); }

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
// lo que se fue agregando despues (D.nuevos: Zona Norte, Chapultepec, Hipodromo...): quien ya habia completado
// una coleccion no pierde su premio por las cosas nuevas; para los demas cuentan todas
const NUEVOS = D.nuevos || {};
const completa = (k, all, have, cel) => all.every(n => have.includes(n)) ||
  ((cel || []).includes(k) && all.every(n => (NUEVOS[k] || []).includes(n) || have.includes(n)));
const nombres = (a) => a.map(q => q.name);
const perks = () => {
  const cel = state.celebrated;
  const p = { cafe: completa('cafe', nombres(cafes), nombres(cafes.filter(c => c.drunk)), cel), taco: completa('taco', nombres(tacos), nombres(tacos.filter(t => t.eaten)), cel),
    noche: completa('noche', nombres(landmarks), nombres(landmarks.filter(l => l.found)), cel) };
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
  const sc = window.TJGTA && TJGTA.scene && TJGTA.scene.scenes[0];
  if (sc && sc.player) state.pos = sc.posicion();
  state.t = Date.now();
  const json = JSON.stringify(state);
  try { localStorage.setItem(SAVE_KEY, json); } catch (e) { /* sin almacenamiento */ }
  if (PREFS) PREFS.set({ key: SAVE_KEY, value: json }).catch(() => {});
}

// ---------- frases ----------
// los coyotes: te ofrecen pasarte al otro lado en voz bajita ($ es el precio) y, si les pagas, te estafan
const COYOTE_OFERTA = [
  'Psst... ¿pa\'l otro lado? Sin fila y sin papeles. $ y mañana desayunas en San Diego.',
  'Oiga, joven... yo lo paso. Tengo un primo en la garita. Nomás $.',
  'Psst. Visa láser, pasaporte, lo que ocupe. $ y es suyo, sin preguntas.',
  'Conozco un túnel que ni la migra sabe. $, pero no le diga a nadie.',
  '¿Va pa\' Los Ángeles? Lo dejo allá hoy mismo. $, todo incluido.',
];
const COYOTE_PAGO = ['Simón. Espérame aquí, voy por la camioneta.', 'Trato hecho. No te muevas, ahorita vengo por ti.',
  'Ya estás. Nomás voy por los papeles a la vuelta.'];
const COYOTE_ESTAFA = ['Dijo que iba por la camioneta. Sigues esperando en la esquina.',
  'La "visa láser" que te dejó es una credencial del súper con tu foto pegada.',
  'El mapa del "túnel" que te dio es el menú de una taquería.',
  'Su "primo en la garita" no existe. Él tampoco contesta.',
  'Te dio una cita para cruzar... el 30 de febrero.'];
const FRASES_ROBO = [
  '¡Ey, mi carro!', '¡Ese carro tiene más multas que yo, suerte!', '¡Auxilio, me lo bajaron!', '¡No manches, todavía lo estoy pagando!',
  '¡Llévatelo, pero cámbiale el aceite!', '¡Ni lo laves, ya así está bonito!', '¡Le falta la segunda, ahí te encargo!',
  '¡Mi jefa me va a matar!', '¡Era de mi compadre, ni es mío!', '¡Chale, y con el tanque lleno!',
  '¡Ya ni la amuelas, compa!', '¡Ahí van mis 14 abonos!', '¡Al menos ponle gasolina, rata!',
  '¡Por lo menos devuélveme mis lentes!', '¡Se me olvidó adentro el pollo asado!', '¡Cuidado, frena con el de mano!',
  '¡Ese no tiene placas, buena suerte!', '¡Lo saqué del yonke ayer!', '¡Me lo lleva el diablo... y tú!',
  '¡Ni modo, me regreso en calafia!',
];
const FRASES_ATROPELLO = [
  '¡Ay, mi espalda!', '¡Fíjate, compa!', '¡Aguas!', '¡No soy de hule, perro!', '¡No seas gacho!',
  '¡Iba por unas tortillas nomás!', '¡Me tumbaste el elote!', '¡Ni el taxi de ruta me había atropellado tan feo!',
  '¡Ya llegué tarde a la maquila, gracias!', '¡Te voy a quemar en el Face!', '¡Le voy a decir a mi mamá!', '¡Estaba en la banqueta, menso!',
  '¡Ya me tocaba vacaciones, gracias!', '¡No vi el semáforo... porque no hay!', '¡Me arruinaste los tenis nuevos!',
  '¡Uy, eso va a dejar marca!', '¡Ese carro ni frenó, oiga!', '¡Me debes un tejuino!',
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
const FRASES_CANSADO = ['¡Te bofeaste!', 'Mucho taco y poco ejercicio.', 'Cinco segundos corriendo y ya pides ambulancia.', 'Tus pulmones acaban de presentar su renuncia.',
  'Tu último ejercicio fue levantarte del sillón, ¿verdad?', 'Échate un aguita, campeón.', 'Ya no das ni un paso más, ¿verdad?', 'Te faltó el aire, viejo lobo.',
  'Andas jadeando como perrito en agosto.', 'Hasta tu sombra se cansó de seguirte.', 'Te late el corazón hasta en las orejas.',
  'El gimnasio te sigue cobrando y ni te conoce.', 'Ya párale, que te va a dar el soponcio.'];
const STAMINA = 5; // segundos que aguantas corriendo
const FIESTA_SECS = 32;  // lo que dura la fiesta de la Plaza Santa Cecilia
const MARI_SWAY = 333;   // mecerse al compas del vals (un tiempo a 180 bpm)
// al llegar a un cafe
const FRASES_CAFE = ['Un americano para el camino.', 'Café de olla bien cargado.', 'Un latte con pan dulce.', 'Un cold brew, que hace calor.',
  'Un espresso doble, pa\' despertar hasta al compa.', 'Un capuchino con canela y un ratito de wifi.', 'Un matcha bien verde, pa\' sentirte fresa de la Zona Río.',
  'Un frappé de cajeta, ni modo, se antojó.', 'Un mocha con concha de chocolate.', 'Café con leche como el de la abuela.',
  'Un dirty chai: especias, espresso y cero arrepentimientos.', 'Un pour over y un barista explicándote el grano.', 'Un descafeinado... ¿y para qué viniste?'];
// la gente del sobreruedas (marchantes y clientes)
const FRASES_SOBRERUEDAS = ['¡Pásele, pásele! ¿Qué le damos?', '¡A diez, a diez, todo a diez pesos!',
  'Vine por unos tenis y ya llevo una licuadora, dos plantas y un perico de cerámica.', '¿En cuánto me lo deja? ¿Y si me llevo dos?',
  'Ropa de paca: la misma que en la tienda, pero con historia.', 'Aquí hay de todo: desde un tornillo hasta el control de la tele que perdiste hace años.',
  'Si no está en el sobreruedas, no existe.', 'Ya me tomé un champurrado, unos churros y un elote. Ahora sí, a comprar.',
  'Mi señora dijo "nomás vamos a ver". Llevamos tres horas.', '¡Llévele, llévele, que se acaba!',
  'En la vida real esto se pone un día a la semana. Aquí, diario. Qué suerte tienes.', 'Compré un cargador en veinte pesos. Si dura una semana, ya ganó.',
  'El de los churros es el mejor de Tijuana. No acepto discusiones.', '¿Se lo preparo con chile y limón?', '¡Las plantitas a tres por cien, aproveche!',
  'Ese juguete era de mi infancia. Ahora lo venden como antigüedad. Me siento viejo.', 'Aquí no pasan carros, joven. Hoy la calle es de nosotros.',
  'Fierro viejo, herramienta, discos, lo que busque: aquí está.', 'Le hago su rebaja porque es el primero del día. Siempre es el primero del día.',
  'Vine por fruta y me llevo una chamarra. Así pasa siempre.', 'Si regateas bonito, hasta la bolsa te regalan.',
  'Agárrese la cartera y el elote, que aquí se arremolina la gente.', 'Los domingos aquí viene media Tijuana y todas sus tías.',
  '¡Pruébelo sin compromiso, güero!', '¿Me cambia uno de quinientos? ¿No? Bueno, ahí le debo.'];
// los gatos de las azoteas: te critican a ti y al juego ($$ es tu dinero)
const FRASES_GATO = {
  siempre: ['Miau. Traducción: ese carro no combina con tus tenis.', '¿Otra vez tú? Hay toda una ciudad y vienes a mi azotea.',
    'Yo no tengo misión. Yo soy la misión.', 'Le doy a este juego cinco estrellas… de cincuenta.',
    'Los perros tienen animación de caminar. Yo tengo dignidad.', 'Me hicieron con unos óvalos y dos triángulos, y aun así me veo mejor que tú.',
    'Llevas un buen rato jugando y no has ido ni a una taquería. Qué decepción.', 'El juego es en 2D. Mi desprecio es en 3D.',
    'Tienes $$ y no me has comprado ni una lata de atún.', 'Yo ya estaba aquí antes de que cargara esta parte del mapa.',
    'Esa flecha te dice a dónde ir. A mí nadie me dice a dónde ir.', 'Me caigo de la azotea y caigo de pie. Tú pasas un tope y pierdes vida.',
    'Nueve vidas tengo yo. Tú una barrita. Piénsalo.', 'No me voy a mover. No me programaron para eso. Y tampoco quiero.',
    'Un error del programa me dejó en esta azotea. Me gustó. Aquí me quedo.', 'Si cierras la app yo sigo aquí, juzgándote. Es una función secreta.',
    'Los perros de abajo ladran. Yo opino. Hay niveles.', 'Tu personaje camina raro. No digo nada… bueno, ya lo dije.',
    '¿Me vas a tomar captura? Mi lado bueno es el izquierdo.', 'Quiero reportar un error: tú.',
    'Dicen que el programador agregó gatos porque se lo pidieron. Ojalá le pidan un mejor jugador.',
    'Con todo el mapa que hay y tú siempre en las mismas cuadras.', 'Miau. (No te lo voy a traducir. Es grosero.)',
    'Todos aquí abajo repiten las mismas frases. Yo también, pero con estilo.', '¿Ya guardaste la partida? Ah, se guarda sola. Ni eso haces.',
    'Este juego tiene pipas de gas que explotan y tú sigues aquí platicando con un gato.', 'Tengo menos cuadros de animación que un semáforo y más personalidad que tú.',
    'Ya sé que soy el mejor personaje del juego. No hace falta que me lo digas.', 'Si me tocas en la pantalla no pasa nada. Pero no lo intentes.',
    'Dame "me gusta" y suscríbete. Ah, no, eso es otra cosa.', 'Los árboles de aquí no se mueven con el viento. Yo sí me fijo en esas cosas.'],
  carro: ['Manejas como si el carro fuera prestado. Ah, no: es robado.', 'Esa vuelta fue sin direccional. Lo anoté.',
    'Desde aquí arriba se ve clarito que no sabes estacionarte.', 'Le diste a todos los baches de la colonia. Los conté.',
    '¿Ese carro lo escogiste o fue el primero que encontraste? Se nota.', 'Bájale al motor, que no me dejas dormir.',
    'Si chocas aquí abajo no cuentes conmigo de testigo.', 'Pita otra vez y te tiro una maceta. Es broma. No tengo maceta. Todavía.',
    'Ese carro está más madreado que tu reputación.'],
  rapido: ['Más despacio, que el juego no alcanza a dibujar las calles.', '¡Uy, qué rápido! Lástima que no hay premio por eso.',
    'A esa velocidad ni me vas a ver. Mejor: así no te tengo que ver yo.', 'Vas tan rápido que te dejaste la dignidad en el semáforo.'],
  pie: ['Caminando, ¿eh? Yo camino más bonito y ni animación tengo.', 'Corres un ratito y ya te cansas. Qué condición.',
    'Robarse un carro es picarle a un botón. Hasta yo podría, y no tengo pulgares.', 'Súbete a mi azotea… ah, no puedes. Ja.',
    'Todo te queda lejísimos y vas a pie. Valiente o despistado.'],
  noche: ['De noche todos los gatos son pardos. Y tú sigues manejando igual de mal.', 'El modo noche te queda. No se te ve la cara.',
    'Son las tantas y tú jugando. Yo por lo menos tengo excusa: soy gato.'],
  despierta: ['¿Me despertaste para esto?', 'Estaba soñando que el juego tenía multijugador. Gracias por arruinarlo.',
    'Zzz… ah, eres tú. Ahorita me vuelvo a dormir.', 'Me despiertas y ni atún traes.'],
  harto: ['Ya me aburriste. Me voy a dormir. No hagas ruido.', 'Se acabó la función. Miau.',
    'Ya no me programaron más frases. Igual que a ti, nomás que tú ni te diste cuenta.', 'Suficiente convivencia por hoy. Bye.'],
};
// al caer en un bache
const FRASES_BACHE = ['¡Ese bache tenía su propio código postal!', 'Ahí se fue la suspensión, compa.', 'Bache tijuanense: si lo tapan, lo extrañan.',
  '¡Uy! Ese ya hasta paga predial.', 'Gracias, Ayuntamiento.', '¿Bache o alberca? Ni el gobierno sabe.', 'Se te cayó hasta la placa.',
  'Ese bache ya estaba ahí cuando tu abuelo aprendió a manejar.', 'Directo a la llantera.', 'Ese bache se ve desde el avión.',
  'Ahí cabe un carro chiquito estacionado.', 'Ese bache ya sale en los mapas.',
  '¡Ese no era bache, era cráter!', 'Se me desacomodaron hasta los recuerdos.', 'Le diste tan duro que te tronó la espalda.',
  '¡Cayó la llanta y regresó sola!', 'Ese bache ya está en el escudo de la colonia.', 'Mañana le ponen una cruz y unas flores.',
  'Los de la llantera te mandan saludos.', 'Ese bache ya tiene su propio club de fans.', 'Con ese bache ya no necesitas topes.',
  'Un poquito más hondo y salías en Ensenada.', '¡Hasta el aromatizante se cayó!',
  'Dicen que si lo ves de noche te jala.', 'Ese bache tiene doble nacionalidad.', 'Tu llanta acaba de conocer el centro de la Tierra.',
  'Bache nuevo, el de ayer ya se lo llevó la lluvia.', 'Ahí iba a ser un pozo de agua, pero se quedó en bache.',
  '¡Se te salió el alma por la ventana!', 'El amortiguador pidió su liquidación.', 'Ya lo reportaste tres veces. Sigue ahí.'];
// la reaccion que va antes de la frase (las fuertes cuando caes rapido)
const REACCION_BACHE = ['🕳️', '😵', '😬', '🫨', '😖', '🙄', '🤕', '😩'];
const REACCION_BACHE_FUERTE = ['😱', '💀', '🤯', '😵‍💫', '🚑', '💥🕳️', '😭', '🛞💨'];
// lo que te dice la gente cuando te le pegas caminando, agrupado por tema:
// cada tema tiene su propio globo (ver .bubble en style.css)
const FRASES = {
  historia: [
    'En 1911 los magonistas tomaron Tijuana. Luego llegaron los gringos y tomaron... fotos con el burro cebra.',
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
    '¿Eres de Culiacán? Aquí todos tenemos un vecino de Sinaloa.',
    'Aquí todo es "estilo Sinaloa": mariscos, carne asada, hot dogs... nomás falta el café estilo Sinaloa.',
    'Si oyes tambora a las 3 de la mañana es el vecino de Mazatlán celebrando que es martes.',
    '¿Aguachile? Lo trajeron los sinaloenses y aquí nos lo quedamos, compa.',
    'Compa, si ves una troca con la tambora a todo volumen, no es fiesta, es un miércoles normal.',
    'Mi apá llegó de Los Mochis en el 85 "nomás por un rato". Aquí seguimos.',
    'Vi un letrero de "sushi estilo Sinaloa": empanizado, con queso y chile. Japón no sabe lo que se pierde.',
    'En Culiacán hace un calor que derrite. Aquí hace un frío que no entiendo. Extraño sudar.',
    'Le pones "estilo Sinaloa" a un taco y ya cuesta diez pesos más. Así funciona la economía.',
    'En Culiacán nunca vi un letrero de "estilo Sinaloa". Allá nomás le dicen comida.',
  ],
  pocho: [
    'Órale bro, ¿where queda la Revu? Mi abuela me mandó por unos tacos.',
    'Bro, mi outfit es todo de la Ross: diez dólares y me veo de Fashion Valley.',
    'Cruzo la línea diario, bro: con mi sueldo en San Diego nomás me alcanza para rentar un clóset.',
    'Hablo spanglish bien fluent: "voy a la marketa por unas groceries y regreso pronto, ¿okay?"',
    'Bro, este año sí ganan los Padres. Lo dije el año pasado, but this time for real. Nunca le pierdas la fe.',
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
    'Si te ofrecen un celular de los caros en 500 pesos en la Sexta, no es oferta, es examen de ética.',
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
    '¿Que el taco al vapor te cayó mal? No, mijo, tú le caíste mal al taco.',
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
    'El oficial me preguntó a qué iba. Le dije "a comprar papel de baño al mayoreo". Me dejó pasar con respeto.',
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
  // orgullo de colonia: las populares de fuera del centro (este, sur, Otay, Playas, Santa Fe)
  colonia: [
    'La Libertad es de las colonias más viejas de Tijuana. Aquí ya había vecinos cuando lo demás era puro monte.',
    'En la Libertad tenemos un cine Art Déco de 1932. Ya no pasan películas, pero la fachada sigue de estreno.',
    'Soy de la Sánchez Taboada. La levantaron las familias que se quedaron sin casa con la crecida del río en el 78. Aquí seguimos, y de pie.',
    'En la Sánchez los vecinos plantamos árboles en las laderas con nuestras propias manos. Cada uno tiene nombre.',
    'Sube al Cerro Colorado al amanecer: se ve toda Tijuana y hasta el mar. Las bancas las pusieron los mismos senderistas.',
    'En La Presa tenemos el Parque Esperanto, con tirolesa y todo. Ir a la presa ya no es nomás ver agua, ahora vuelas.',
    'Soy de la Mariano Matamoros: es tan grande que tiene su propio sobre ruedas, su propia banda de guerra y su propio taquero favorito.',
    'En la Matamoros los domingos huele a carne asada de cuadra en cuadra. Ese es nuestro perfume.',
    'En El Florido las fábricas le dan chamba a media ciudad, y los tacos de la entrada le dan vida a la otra media.',
    'En Villa Fontana todas las casitas eran iguales, pero cada quien la pintó a su modo. Así la encuentras de noche.',
    'A Terrazas del Valle llegamos cuando era puro cerro pelón. Ahora hay escuela, parque y panadería. Lo hicimos entre todos.',
    'A Natura, Villa del Campo y Valle Verde les dicen "allá lejos". Nosotros les decimos "la Tijuana nueva".',
    'En Otay está la UABC, y el terreno lo ganaron los estudiantes en el 71. Aquí la universidad se defendió desde el principio.',
    'Soy de Otay: tengo el aeropuerto, la garita, el Tec y la UABC a diez minutos. El centro del mundo, compa.',
    'En Otay se hacen teles, aparatos médicos y piezas de avión. Lo que traes en la bolsa capaz salió de aquí.',
    'En Los Pinos llevamos treinta años cuidando nuestro centro comunitario. Ahí aprendimos a jugar fut y a defender lo nuestro.',
    'Playas de Tijuana: el atardecer en el malecón no lo cambio por nada. Gratis y todos los días.',
    'Vivo en Playas: me levanto, veo el mar y el faro, y ya puedo con el tráfico de todo el día.',
    'En el Parque de la Amistad, en Playas, las familias se ven a través de la reja. Ahí aprendes lo que vale un abrazo.',
    'En Santa Fe somos tantos que vamos en primera y segunda sección. Cualquier día pedimos ser municipio.',
    'Santa Fe queda lejos del centro, pero a un brinco del mar. Los domingos de playa son nomás nuestros.',
  ],
  // los que se dan cuenta de que el mapa no es igualito a Tijuana: se esta mejorando, pero para que corra en un
  // celular hay que recortar, y unos edificios no salen como son. Ni modo
  mapa: [
    '¿Ese edificio? En la vida real es otro. Pero aquí es el que hay, ni modo.',
    'En la vida real para llegar a mi casa hay que subir un cerro. Aquí todo es planito. Ni modo.',
    'Si buscas tu casa y no está, no te sientas mal: la mía tampoco.',
    'Dicen que están mejorando el mapa. Yo llevo años esperando que me pongan banqueta.',
    'Esa calle en la vida real sí tiene salida. Aquí, nomás si tienes fe.',
    'Tijuana es puro cerro y bajada, pero aquí el mapa quedó más plano que una tortilla.',
    'Hay edificios que en la realidad son más altos. Aquí les recortaron pisos para que no se trabe el juego.',
    'Si ves algo raro en el mapa no es error, es arte moderno. Bueno, sí es error.',
    'Optimizar es quitarle cosas a la ciudad hasta que quepa en tu bolsillo.',
    'Allá afuera mi carro no sube mi calle de tan empinada. Aquí ni se despeina.',
    'El programador dice que el mapa es "casi" Tijuana. Ese "casi" pesa.',
    'Mi colonia aquí es más plana que en la realidad. Por fin no hay que subir cerros. ¡Qué descanso!',
    'Si un edificio aparece donde no va, hazte el que no lo viste. Yo así le hago.',
    'Cada actualización cambian algo. Ayer mi casa no tenía jardín y hoy sí. Ni me avisaron.',
    'La Bola del CECUT antes era un tambo chaparro. Ya la arreglaron. Ve a verla, quedó bonita.',
    'No todas las casas, tiendas y árboles están donde van. Eso sí, el tráfico quedó igualito.',
    'Los datos del mapa los hicieron voluntarios. Si algo está chueco, la culpa es repartida.',
    'Aquí todas las azoteas son planitas. En la vida real hay unas que ni el arquitecto entiende.',
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
const FRASES_CAMION = [
  '¡El camionero ni frenó!', '¡Súbale, súbale, que hay lugar!', '¡Hágase a un lado, que llevo prisa!',
  '¡El de la ruta se cree en la Fórmula 1!', '¡Ese chofer va tarde a la vuelta!', '¡Órale, que no es tu carril!',
  '¡Pásele, pásele, atrás hay lugar!', '¡El camión no frena, nomás pita!', '¡Ese chofer trae prisa por llegar a la base!',
];
// escenas de trafico (ver ESCENAS): lo que se dicen los del choque y el policia. A es al que le pegaron, B el que pego
// (en la carambola, B quedo en medio y C es el de atras); cada tipo de choque tiene sus frases y se revuelven con las de
// cualquier choque
const FRASES_CHOQUE = {
  A: ['¡Ya le hablé a mi seguro, ahí viene el ajustador!', '¡Usted venía volando!', '¡Yo aquí paso diario y nunca me había pasado!',
    '¡No mueva su carro hasta que llegue el ajustador!'],
  B: ['¡Si el golpe está chiquito, no exagere!', '¡Mi carro estaba recién lavado!', '¡Yo tengo testigos, ese señor del elote lo vio todo!',
    '¡Nos arreglamos con el seguro, no se ponga así!'],
  lado: {
    A: ['¡Usted se me cerró, señor!', '¡Traía la direccional desde la otra cuadra!', '¡Mire nomás cómo me dejó la puerta!'],
    B: ['¡Usted ni puso la direccional!', '¡Yo ya venía entrando, compa!', '¡Usted frenó de la nada!'],
  },
  glorieta: {
    A: ['¡En la glorieta tiene preferencia el que va adentro!', '¡Yo ya iba dando la vuelta!'],
    B: ['¡Esta glorieta nadie sabe cómo se usa!', '¡Aquí entra el que se avienta primero!'],
    poli: ['Tercer choque de la semana en esta glorieta...'],
  },
  alcance: {
    A: ['¡Usted me pegó por atrás, la culpa es suya!', '¡Guarde su distancia, señor!', '¡Frené porque se puso en amarillo!', '¡Me torció la defensa!'],
    B: ['¡Usted frenó de golpe!', '¡Ni se le prendieron las calaveras!', '¡Se me fueron los frenos, se lo juro!', '¡Yo venía viendo el semáforo, no a usted!'],
    poli: ['El de atrás siempre tiene la culpa, joven.'],
  },
  carambola: {
    A: ['¡Usted me pegó por atrás, la culpa es suya!', '¡Guarde su distancia, señor!', '¡Ya me tocó otra vez la defensa nueva!'],
    B: ['¡Yo quedé en medio, a mí que me paguen los dos!', '¡A mí me empujaron, yo venía frenando!', '¡Me pegaron de los dos lados!'],
    C: ['¡Yo nomás le di un toquecito!', '¡Es que el sol me dio en la cara!', '¡Esto lo arregla el seguro, no se pongan así!', '¡A mí ni me vean!'],
    poli: ['Tres carros y nadie tuvo la culpa. Qué raro.', 'El de hasta atrás, venga para acá.'],
  },
  esquinazo: {
    A: ['¡Usted se pasó el alto!', '¡Yo tenía el verde!', '¡Mire nomás cómo me dejó la salpicadera!'],
    B: ['¡Estaba en amarillo, todavía alcanzaba!', '¡Usted salió de la nada!', '¡Yo ya iba a medio crucero!'],
    poli: ['A ver, ¿quién tenía el verde? Los dos, ¿verdad?'],
  },
  moto: {
    A: ['¡No me vio, yo iba en mi carril!', '¡Se me regó todo el pedido!', '¡Ya me va a pagar los tacos que se me tiraron!', '¡Usted ni volteó al espejo!'],
    B: ['¡Usted venía entre los carros!', '¡Se me apareció de la nada!', '¡Ni luces traía la moto!'],
    poli: ['¿Está bien, joven? Qué bueno que traía casco.'],
  },
  poli: ['A ver, a ver, uno por uno, señores.', 'Ya viene el ajustador, no muevan los carros.', 'Tercer choque de la semana en este crucero...',
    'Calmados, que así no nos vamos a entender.', 'Licencia y tarjeta de circulación, por favor.'],
  // sin patrulla: la estan esperando
  sinPoli: ['¿Y la patrulla? Ya van veinte minutos...', '¡Ahorita que llegue el de tránsito vemos quién tiene la razón!'],
  miron: ['Joven, circule, aquí no hay nada que ver.', 'No se arrime, que esto va para largo.', 'Siga su camino, compa.'],
  testigo: ['¡Joven! Usted lo vio, ¿verdad que él tuvo la culpa?', '¿Me hace un paro? Háblele a la patrulla, que a mí no me contestan.'],
};
const FRASES_RATERO = [
  '¡Bájate, compa, que ando con prisa!', '¡Ese carrito está bien bonito, me lo llevo!', '¡Ahorita te lo regreso... algún día!',
  '¡Gracias por calentármelo!', '¡Uy, con el motor prendido y todo!', '¡Hágase pa\'llá, que este ya es mío!',
  '¡Muévete, que voy tarde!', '¡Te lo cuido, no te apures!',
];
const FRASES_RATERO_MANEJA = ['¡Yiiijaaa!', '¡Agárrenme si pueden!', '¡Este sí corre!', '¡Abran paso!', '¡Nos vemos en el yonke!', '¡Ni el semáforo me para!'];
const FRASES_RATERO_FALLA = ['¡Ni modo, otro día!', '¡Uy, este sí se puso listo!', '¡Ya ni robar se puede en paz!', '¡Ahí la próxima!'];
const FRASES_ROBADO = [
  '¡Oye, ese es mi carro!', '¡Regrésame el carro, ratero!', '¡Ey! ¡Que alguien lo pare!', '¡No manches, ni el seguro le puse!',
  '¡Oye! ¡Ese carro me lo robé yo primero!', '¡Ahí va mi carro... y mis tacos!', '¡Hey! ¡Ni las gracias dio!',
];
// lo que dicen los personajes de la calle (ver TIPOS_CALLE)
const FRASES_TIPO = {
  elotero: ['"¡Elotes, elote en vaso! ¿Con todo, joven?"', '"Con mayonesa, queso y chile del que pica. Así se come aquí."', '"Llevo veinte años en esta esquina. La esquina ya es mía."', '"¿Elote o vaso? El vaso no se te cae en la camisa."'],
  paletero: ['"¡Paletas de fresa, de mango con chile, de nuez!"', '"Si oyes la campanita, ya llegué."', '"En verano soy el señor más querido de la colonia."', '"La de arroz con leche se acaba primero. Apúrate."'],
  turista: ['"Excuse me... ¿dónde queda la Avenida Revolución?"', '"My friend dice que los tacos de aquí son los mejores del mundo. Tiene razón."', '"Crucé la línea nomás por un taco. Valió la pena."', '"¿Cuánto por la foto con el burro cebra?"'],
  albanil: ['"Ahí nomás, una losa más y nos vamos."', '"El patrón dice que para el viernes. ¿Cuál viernes? No dijo."', '"Esta cubeta tiene más años que tú."', '"Echa la mezcla, que se seca."'],
  mandado: ['"Vengo del mercado y ya subió el jitomate otra vez."', '"Hoy hay caldo de albóndigas. Si quieres, pásate."', '"Si ves a mi viejo, dile que ya voy."', '"Me dieron el pilón de cilantro. Hay que saber pedir."'],
  carriola: ['"Shhh, apenas se durmió."', '"Si lo despiertas, tú lo duermes."', '"Venimos del parque. Él feliz, yo agotada."', '"Ya dijo su primera palabra: taco."'],
  corredor: ['"¡No me puedo parar, voy en mi mejor tiempo!"', '"Subí el Cerro Colorado corriendo. Bueno, caminando."', '"Corro para poder comer más tacos."', '"Diez kilómetros y luego unos de adobada."'],
  luchador: ['"Esta máscara no me la quito ni para dormir."', '"¿Rudos o técnicos? ¡Técnicos, siempre!"', '"Mi abuelita me hizo esta máscara. Es sagrada."', '"Si me ves sin máscara, no me conoces."'],
  maquila: ['"Salí del turno de la mañana. Ahora a la segunda chamba."', '"En la línea armamos piezas para medio mundo."', '"El camión de la maquila me dejó, como siempre."', '"Hoy es quincena. Hoy invito los tacos."'],
  estudiante: ['"Voy tarde a la secundaria. Otra vez."', '"Mañana hay examen de mate y no estudié nada."', '"Me dejaron tarea de la historia de Tijuana. ¿Tú sabes algo?"', '"En el recreo vendo dulces. Soy empresario."'],
  globero: ['"¡Globos! Hay de corazón, de estrella y de dinosaurio."', '"Un día de Santa Ana casi salgo volando para San Diego."', '"El rojo es el que más se vende. Nadie sabe por qué."'],
  musico: ['"¿Una canción, joven? Por diez pesos le toco la que quiera."', '"Me sé todas las de antes. Las de ahora no les entiendo."', '"Toco en los camiones. Los choferes me odian."'],
};
// el carro del pan: como se oye la bocina (va y viene) y lo que grita el panadero
const FRASES_PAN_CANCION = [
  '♪ ¡El panadero con el pan! ♪ ¡El panadero con el pan! ♪',
  '♪ Ahí viene el panadero con el pan... con el pan... ♪ (la bocina truena un poquito)',
  '♪ ¡El panaderooo con el paaan! ♪ (a todo volumen y medio rayado)',
  '♪ ¡El pa-na-de-ro con el pan! ♪ (se traba la grabación) ♪ ...con el pan, con el pan, con el pan ♪',
  '♪ ¡El panadero con el pan! ♪ (todos los perros de la cuadra le contestan)',
];
const ZONAS_SIN_PAN = new Set(['Zona Centro', 'Zona Norte', 'Zona Río']);
// lo que te "dice" un perro cuando te le acercas: un solo emoji. Casi siempre lo de siempre (hueso, popo, amor)
// y de vez en cuando algo que nadie entiende
// lo que dicen los secretos que se quedan en su lugar (EGGS con fija) cuando pasas cerca, y su globo
const FRASES_FIJAS = {
  // el señor que estan sacando del canal
  cachorros: [
  '¡Jálenle, cachorros, jálenle!', '¡El de rosa, el de rosa sí está jalando!', '¡Ya casi, ya casi... ya no!',
  '¡Nomás era mi chancla, no hacía falta tanto!', '¡Gracias, perritos! ¿Aceptan croquetas o transferencia?',
  '¡Que alguien les avise que ya me puedo parar, el agua me llega a la cintura!',
  '¡Yo nomás venía a ver si estaba la marea alta!',
  ],
  lucha: [
    '¡A dos de tres caídas, sin límite de tiempo!', 'Rudos contra técnicos, y el baldío de testigo.',
    'Ensayamos para la función del sábado. Las cuerdas son del tendedero de mi mamá.', '¡Esta plancha va con dedicatoria para mi suegra!',
    'El réferi es mi primo. Por eso siempre gano.', 'Mi máscara no se toca. Ni para lavarla.',
    '¡Uno! ¡Dos! ...¡se levantó! ¡Qué barbaridad!', 'Si vas a grabar, de mi lado bueno. El izquierdo.',
    'Debajo de la máscara hay otra máscara. Por si acaso.',
  ],
  piloto: [
    '¿Esto es Ensenada? ...¿Cómo que Tijuana?', 'Iba en primer lugar. Luego le hice caso al GPS.',
    'Llevo mil millas... y como doscientas de más.', '¿No ha visto pasar a los demás? Iban para allá. O para acá.',
    'El copiloto se bajó a preguntar en un puesto de tacos. Hace tres horas.', 'Si me ven en las noticias, digan que fue estrategia.',
    'Polvo, piedras, cactus y ahora una colonia. Esta etapa está difícil.', 'Ya di tres vueltas a este llano. Ya me sé cada piedra.',
    'Ya no corro: ahora vivo aquí. Ya hasta me saludan los vecinos.',
  ],
  programador: [
    'Nomás arreglo este bug y me voy a dormir. Eso dije hace tres días.', 'Patito, explícame otra vez por qué esto no sirve.',
    '¿Por qué los carros atravesaban los choques? ...Ya, ya lo arreglé. Creo.', 'Funciona en mi máquina. Mi máquina está en el monte.',
    'Otro pedido: "agrega unos gnomos conspirando". Va, ¿por qué no?', 'Compilando... compilando... ¿y si mejor voy por unos tacos?',
    'El mapa tiene un millón de edificios y yo aquí, solito.', 'Nota mental: los perritos del canal no son referencia a nada. A nada.',
    'Si alguien llega hasta aquí, le pongo un secreto. ...Ah, ya llegó uno.', 'Si funciona, no le muevas. Si no funciona, tampoco.',
    'Me vine al monte para que ya no me pidan más secretos. No funcionó.',
    // trabaja con una IA
    'Yo nomás le digo a la IA "instálala y súbela" y ella hace lo demás. Soy un genio.', 'La IA dice que ya quedó. La IA siempre dice que ya quedó.',
    'Le pedí a la IA unos gnomos conspirando y me los hizo. Ahora sospecho de ella.', 'Le expliqué Tijuana a la IA. Ahora quiere tacos de adobada y no tiene boca.',
    'Mi compañero de trabajo es una IA. No pide aumento, pero tampoco trae tacos.', '¿Quién escribió este código? Pues... fue trabajo en equipo.',
    'Le pedí a la IA que los carros no atravesaran los choques. Lo arregló a la tercera. Igual que yo.', 'La IA escribe el código y yo decido qué tan chistosos quedan los gnomos. Reparto justo.',
  ],
  banda: [
    '¡Y pura banda, compa!', 'Esta va dedicada al nopal, que no se ha ido en toda la noche.',
    'Nos contrataron para una boda. Creo que nos dieron mal la dirección.', 'Llevamos tocando desde el sábado. Hoy es martes.',
    'El de la tuba ya no siente los labios, pero no se raja.', '¿Otra? ¡Otra! ...el nopal pidió otra.',
    'Se cobra por hora, pero al nopal le fiamos.', 'Aquí en el monte nadie se queja del ruido. Ensayamos a gusto.',
  ],
  chupacabras: [
    'Ya no se espanta nadie. En los noventa salía en todos los noticieros.', 'No, no chupo cabras. Soy vegetariano desde el 2003.',
    'La cabra es mi amiga. Se llama Lupe. Déjala dormir.', 'Me dicen leyenda. Yo prefiero "clásico".',
    'Los del ovni y yo tenemos un grupo de chat. Puros memes.', '¿Una foto? Va, pero que salga borrosa, si no nadie la cree.',
    'Antes esto era puro rancho. Ahora hay fraccionamientos hasta aquí.', 'Horchata. Siempre horchata. El sabor de la leyenda.',
  ],
  gnomos: [
    'Shhh... alguien viene. Todos quietos, somos adornos.', 'Fase uno: los jardines. Fase dos: los camellones. Fase tres: la Zona Río.',
    'Nadie sospecha de un señor de cerámica con gorrito.', 'El de la casa catorce nos dejó afuera en la lluvia. Pagará.',
    '¿Trajeron las semillas? ¿Y las tijeras de podar? Bien.', 'Votemos: ¿plan A o plan B? ...Gana el plan G, de gnomo.',
    'Los flamingos de plástico están con nosotros.', 'Nos sacaron del jardín por "pasados de moda". Error.',
    'Si alguien pregunta, estamos jugando lotería.',
  ],
  monolito: [
    '...Muuu.', '(Las vacas miran el monolito. El monolito no dice nada. Nadie dice nada.)',
    'Llegó anoche. Desde entonces ya sabemos usar herramientas.', 'Antes rumiábamos pasto. Ahora rumiamos ideas.',
    '♪ Taaa... taaaa... ¡TAAAAN! ♪', 'Si lo tocas suena un coro. Mejor no lo toques.',
    'No sabemos qué es, pero le hacemos guardia.', 'La de la esquina dice que es un refrigerador muy elegante.',
    'Muuu... digo, la verdad está ahí afuera.',
  ],
  delfines: [
    'Miren, otro humano tomándose una foto con el muro. Qué originales.', 'Ustedes necesitan pasaporte. Nosotros, aletas.',
    '¿Y ese qué hace? Ah, está "surfeando". Ya se cayó otra vez.', 'Los humanos ponen muros en el mar. El mar nomás se ríe.',
    'Dicen que somos muy inteligentes. Con esa competencia, no está difícil.', 'Ahí va uno metiéndose al agua en mayo. Bienvenido al mayo gris, campeón.',
    'No, no te vamos a llevar en el lomo. Esto no es parque acuático.', 'Pagan por ver el atardecer desde un restaurante. Nosotros lo vemos gratis diario.',
    'Ese lleva media hora buscando dónde estacionarse. Nosotros llegamos nadando.', 'Le echan limón a todo. Hasta a nosotros nos miran con antojo.',
  ],
  senderistas: [
    '¿Alguien sabe para dónde queda Tijuana? ...Ah, es todo eso de abajo.', 'Según el mapa estamos en Ensenada.',
    'Sigan las antenas... no, esas no, las otras antenas.', 'Ya le marqué a mi mamá. Dice que nos ve desde la azotea.',
    '¡Que nadie se separe! ...¿Y el Beto?', 'Llevamos tres horas dándole vueltas a la misma piedra.',
    'Tranquilos, todavía nos queda media barra de granola para los cuatro.', '¿Y si le preguntamos al señor de los elotes? Está aquí nomás.',
    'Yo digo que es por la derecha. Bueno, mi otra derecha.',
  ],
  cimarrones: [
    'Beee... digo, ¡arriba los Cimarrones!', 'Vengo de la biblioteca. Bueno, de comerme el pasto de afuera de la biblioteca.',
    'Examen de cálculo a las siete. Aquí nomás andamos rumiando.', 'Estos cuernos no son para pelear, son para cargar las copias.',
    '¿Fila en la cafetería? Yo me salto la barda, soy de montaña.', 'En la sierra quedamos pocos. Aquí en la UABC somos miles.',
    'Mi tesis es sobre el pasto de Otay. Llevo cuatro años en el trabajo de campo.',
  ],
  galgos: [
    '¡Arriba los Galgos del Tec!', 'Corremos porque ya va a empezar la clase de termodinámica.',
    'Un galgo de ingeniería no corre: optimiza la trayectoria.', 'Llevo tres semestres buscando dónde estacionarme.',
    'Ingeniero en sistemas y en los cien metros planos.', '¿Me pasas la tarea? Te la cambio por una galleta.',
    'Si el profe no ha llegado en quince minutos, nos vamos. Somos galgos, no tortugas.',
  ],
};
const PERRO_DICE = ['🦴', '🦴', '🦴', '💩', '💩', '❤️', '❤️', '🥰', '🐾', '🍖', '🎾', '😋'];
const PERRO_ENIGMA = ['🌕', '👁️', '🔮', '🛸', '⏳', '🗝️', '🌀', '♾️', '🪐', '📜', '🕯️', '🧿', '🌵', '🪞', '🦉', '⚖️', '🧭', '🎻', '🌑', '🫖'];
const FRASES_PAN = [
  '¡Lleve su pan! ¡Conchas, cuernitos, orejas, bolillo calientito!',
  '¡Salga, señito, que ya pasó el pan! ¡Hay pan dulce y hay pan de sal!',
  '¡Marranitos, polvorones, campechanas! ¡Tres por veinte!',
  '¡Bolillo pa\'l susto, concha pa\'l café!',
  '¡Ya llegó el pan, ya llegó el pan! ¡Pásele, que se enfría!',
  '¡Pan de elote, pan de nata, empanadas de piña y de cajeta!',
  'Joven, ¿una concha? La de chocolate es la buena, la de vainilla es pa\'l que no sabe.',
  '¡Pan recién horneado! Bueno, de en la mañana, pero está bueno.',
  '¡No me paro, eh! Si quiere pan, chífleme fuerte o córrale.',
  '¡Orejas grandotas, como las de mi compadre!',
  '¡Cuernitos, chilindrinas, besos y bigotes! ...son panes, no se espante.',
  '¡Hay rosca todo el año! Si le sale el muñequito, me invita los tamales.',
];
const FRASES_FUGA = ['¡Le pegaste a la pipa del gas!', '¡Huele a gas!', '¡Se está saliendo el gas!', '¡Cuidado con la pipa!'];
const FRASES_PIPA = ['¡Voló la pipa del gas!', '¡Se escuchó hasta San Diego!', '¡Explotó la pipa!', '¡Ahora sí hubo gas para toda la colonia!'];
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
  '3 tacos de adobada y un tejuino', 'una pizza con piña y chiles en vinagre', '12 donas y un té de manzanilla para la panza',
  'un caldo de res a las 40 grados', 'una birria para un perro con depresión', 'una ensalada César, de donde nació',
  'unos churros y una mantita para el frío', 'un café de olla para un influencer', 'una torta de jamón sin jamón',
  'un elote con todo y un abrazo', 'unos tamales para la junta del condominio', 'sushi empanizado con queso',
  'unos raspados en pleno diciembre', 'una sopa instantánea "gourmet"', 'un pozole tamaño piscina',
  'un pay de queso para disculparse con la suegra', 'unas papas locas y pañuelos desechables',
  'un pastel de tres leches que ya va en dos leches', 'unas tostadas de ceviche sin que se rompa ninguna',
  'un champurrado para la junta de vecinos', 'unos hot dogs con tocino del carrito de la esquina',
  'unas flautas para el ensayo de la banda', 'un pan de elote para la maestra', 'unos tamales de elote con crema y un atole',
];
const CLIENTES = [
  '"¿Y la salsa?" Así nomás te recibió.', 'Te pagó con monedas de 50 centavos, una por una.',
  'Te abrió en pijama de dinosaurio y te dijo "gracias, mi rey".', 'Te calificó con 5 estrellas y un emoji de calavera.',
  '"Tenía todo para cocinar, pero me ganó la flojera", te dijo con la estufa limpiecita atrás.', 'Te pidió que le cambiaras un foco ya que ibas a estar ahí.',
  '"Déjalo en la puerta", dijo el señor desde la puerta.',
  'Te ofreció la mitad de su pedido. Era tuyo de todas formas.', 'Te dio de propina un boleto de la rifa de la parroquia.',
  'Te recibió un niño de seis años con los billetes contados: "quédese con el cambio, señor".',
  '"¿Tú eres el de la moto?" "Sí." "Ah, pensé que eras más alto."', 'Te dio las gracias y una bolsa de limones de su árbol.',
  'La señora te hizo esperar para darte un tóper de frijoles "pa\' que no andes con hambre".',
  'Te recibió toda la familia en la puerta, como si regresaras de la guerra.', 'Te calificó con cinco estrellas. La reseña dice: "llegó".',
  'Te pagó con dólares, pesos y un vale de despensa. Sacaste la calculadora.', 'Te pagó y te mandó saludos para su primo que también reparte. No lo conoces.',
];
// clientes especiales: a veces quien te espera en la banqueta es alguien muy particular, con su propio pedido, su
// dibujo (egg_ + k, ver makeEggs) y lo que dice al recibir (dice) o si se cancela (mal)
const CLIENTES_RAROS = [
  { k: 'cholo', quien: 'un cholo buena onda',
    pedidos: ['unos tacos de cabeza para la carne asada del barrio', 'un champurrado para su jefita', 'unas conchas para el desayuno de su abuelita', 'un pastel de cumpleaños para su jefita'],
    dice: ['"Gracias, carnal. Cualquier cosa, aquí en el barrio estamos pa\' servirte." Te dio propina y un saludo de puño.',
      '"Simón, justo a tiempo. Es pa\' la familia." Te invitó a la carne asada del domingo.',
      '"Ese, qué buena onda que llegaste rápido. Cuídate en la bajada, que está bien empinada."',
      '"Ni te preocupes por el cambio, homie. En el barrio todo es con respeto."'],
    mal: '"No pasa nada, carnal, otro día será." Igual se canceló el pedido, pero te dio un saludo de puño.' },
  { k: 'robot', quien: 'un robot',
    pedidos: ['un litro de aceite de cocina, para él', 'unos tornillos con chile y limón', 'una pila de 9 volts y un tamal de rajas', 'un taco de adobada "para probar qué es eso"'],
    dice: ['"PEDIDO RECIBIDO. CALIFICACIÓN: CINCO ESTRELLAS. SATISFACCIÓN: 87%. FALTÓ SALSA."',
      '"BIP. ESTO NO ES ACEITE DE MOTOR. ES ACEITE DE COCINA. ...LO ACEPTO." Te pagó con las monedas exactas.',
      'Te escaneó de arriba abajo con un láser rojo: "HUMANO PUNTUAL. QUÉ RARO." Y te dio propina.',
      '"PROCESANDO GRATITUD... GRACIAS, CARNAL." Alguien le está enseñando a hablar como de aquí.'],
    mal: '"TIEMPO DE ESPERA EXCEDIDO. ME APAGO DE TRISTEZA." Y se quedó parado con los ojitos en rojo.' },
  { k: 'otaku', quien: 'un otaku disfrazado',
    pedidos: ['un ramen con huevo, como en el anime', 'unos onigiris de machaca', 'un té de burbujas con chamoy', 'unos dangos y un café de olla'],
    dice: ['"¡Arigató, repartidor-san!" Te hizo una reverencia con todo y espada de foami.',
      'Venía disfrazado de héroe de anime, con peluca de picos amarillos. Dice que su poder especial es llegar tarde a todos lados.',
      '"Es para la convención: me falta el capítulo final del disfraz." Te pagó con billetes doblados como grullitas.',
      'Te pagó y gritó el nombre de su ataque especial. Los vecinos ya ni voltean.'],
    mal: '"Mi personaje nunca se rinde... pero yo sí, ya me dio hambre." Y cerró la puerta muy dramático.' },
  { k: 'xolofan', quien: 'un fan de los Xolos con su xolo',
    pedidos: ['unas alitas para ver el partido', 'una hielera de aguas frescas para el estadio', 'unos tacos de birria pa\'l medio tiempo', 'unos churros para festejar el gol'],
    dice: ['"¡Xolos, Xolos! ¡Llegaste justo para el medio tiempo!" Te pintó una raya roja en el cachete.',
      '"Si ganamos hoy te doy doble propina. Si perdemos, también, pa\' que no se diga."',
      'Su xolo pelón traía la playera del equipo. Los dos te ladraron de emoción (él también).',
      '"¿Tú le vas a los Xolos? ¿No? Bueno, aquí está tu propina... pero piénsalo."'],
    mal: '"Ya terminó el partido y perdimos, y para acabarla, sin alitas." Su xolo te vio feo.' },
  { k: 'luchador', quien: 'un luchador enmascarado',
    pedidos: ['un licuado de plátano con avena y dos conchas', 'una docena de huevos para su desayuno de campeón', 'un caldo de pollo para la lesión'],
    dice: ['"¡Gracias, amigo! Hoy lucho en la arena y necesito energía." Te firmó un autógrafo en el ticket.',
      'Te abrió la puerta con la máscara puesta. Dice que nadie, ni su mamá, le ha visto la cara.',
      'Te dio una llave de cariño y te soltó con propina. Dolió poquito.'],
    mal: '"Llegaste tarde y ya me fui a entrenar." La nota estaba pegada en la puerta, firmada con una máscara.' },
  { k: 'abuegamer', quien: 'una abuelita gamer',
    pedidos: ['unos tamales y pilas para el control', 'un té de canela para la desvelada', 'unas galletas de animalito y un café para el torneo'],
    dice: ['"Pásale, mijo, nomás termino esta partida." Ganó. Te pagó sin quitarse los audífonos.',
      '"Los chamacos del otro lado del mundo no me pueden ganar." Te dio propina y una galleta.',
      'Tenía un control en cada mano y te firmó con la nariz. Es leyenda en el barrio.'],
    mal: '"Ay, mijo, ya me agarró el sueño. Mañana te la gano, eh." Y se metió con todo y control.' },
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
  'El cliente puso mal la dirección: vive en Tecate.', 'Te abrió un señor que nunca pidió nada, pero se quedó con el pedido "por si acaso".',
  'Al cliente se le acabó la pila y ya no contestó. A ti se te acabó la paciencia.',
];
// paros: gente de las colonias (lejos de los lugares tipicos) que te pide que le lleves algo a alguien.
// quien te lo pide, su icono, lo que dice, lo que llevas, a donde, como termina (fin) o si tardas (mal);
// prisa: el tiempo es mas justo (se enfria, ya empezo la fiesta...)
// "a" + destino, con la contraccion: a la veterinaria, al panteon
const aDonde = (a) => a.startsWith('el ') ? 'al ' + a.slice(3) : 'a ' + a;
const PAROS = [
  { k: 'gato', quien: 'Doña Cuca', ico: '🐱', prisa: true, cosa: 'a Michi en su jaula', a: 'la veterinaria',
    pide: '"Mijo, ¿me haces un paro? Lleva a Michi al veterinario, se tragó una liga del pelo. Ya ni maúlla, nomás me juzga."',
    fin: '"Ya salió la liga... y un arete de la vecina", dijo el veterinario. Doña Cuca dice que de eso no se habla.',
    mal: 'Michi se salió de la jaula en un semáforo. Ahora vive en un taller mecánico y lo tratan como rey.' },
  { k: 'pozole', quien: 'Don Beto', ico: '🍲', prisa: true, cosa: 'una olla de pozole', a: 'la casa de la jefa de Don Beto',
    pide: '"Hazme el paro: llévale este pozole a mi jefa. Si le llega frío, me deshereda. Otra vez."',
    fin: '"¡Ay, mi Beto! Ni viene, pero manda pozole." La señora te dio una tostada y la bendición.',
    mal: 'Llegó frío. La jefa de Don Beto ya cambió el testamento. Le dejó todo al perico.' },
  { k: 'carta', quien: 'Ramiro', ico: '💌', cosa: 'una carta', a: 'la casa de Yesenia, su ex',
    pide: '"Llévale esta carta a Yesenia. No le digas que lloré... bueno, si pregunta, dile que tantito."',
    fin: 'Yesenia leyó la carta, suspiró y dijo: "Dile que lo quise mucho, pero ya me voy a Ensenada." Te dio para un refresco.',
    mal: 'La neblina mojó la carta y se corrió la tinta. Ramiro dice que es una señal del universo.' },
  { k: 'flores', quien: 'Don Chema', ico: '🌹', cosa: 'un ramo de flores', a: 'el panteón, con su Rosita',
    pide: '"Hoy cumplimos cincuenta años de casados. Llévale estas flores a mi Rosita al panteón; mis rodillas ya no llegan."',
    fin: 'Dejaste las flores. Un colibrí se paró en ellas un ratito. Don Chema dice que fue Rosita, que le mandó decir que sí se acuerda.',
    mal: 'Se marchitaron en el camino. Don Chema dice que no importa, que Rosita siempre prefirió las de plástico. Se le quebró la voz.' },
  { k: 'aro', quien: 'Kevin', ico: '💡', prisa: true, cosa: 'su aro de luz', a: 'el sobre ruedas',
    pide: '"Bro, hazme el paro, llévame el aro de luz al sobre ruedas. Tengo live en cinco minutos y sin luz me veo de verdad."',
    fin: '"¡Ya estamos en vivo, banda!" Lo vieron tres personas. Dos son su mamá desde dos celulares.',
    mal: 'Empezó el live sin luz. Los comentarios dicen "¿eres tú o es el Chupacabras?". Va a ser viral, pero no como él quería.' },
  { k: 'pinata', quien: 'Doña Mago', ico: '🎉', prisa: true, cosa: 'una piñata de dinosaurio', a: 'una fiesta infantil',
    pide: '"¡La fiesta ya empezó y no llegó la piñata! Hay treinta niños con palos y azúcar. Corre, mijo."',
    fin: 'Los niños deshicieron la piñata en cuatro segundos. Uno lloró porque no le tocó nada. Otro se llevó la cabeza del dinosaurio.',
    mal: 'Sin piñata, los niños le pegaron al pastel. La fiesta ahora es leyenda en la colonia.' },
  { k: 'dentadura', quien: 'Doña Mary', ico: '🦷', prisa: true, cosa: 'la dentadura de Don Toño', a: 'la birriería donde está Don Toño',
    pide: '"Mi viejo se fue a la birria y dejó la dentadura en el vaso. Llévasela antes de que pida, que luego nomás sorbe."',
    fin: 'Don Toño se puso la dentadura, sonrió como comercial y pidió doble de birria. Te invitó un taco.',
    mal: 'Llegaste tarde: Don Toño ya se había tomado el consomé... con popote. Dice que así sabe igual.' },
  { k: 'lonche', quien: 'Doña Toñita', ico: '🥪', cosa: 'el lonche de su hijo', a: 'la fila de la garita, donde está su hijo',
    pide: '"Mi hijo cruza a trabajar y se le olvidó el lonche. Va a estar horas en la fila y no come nada allá. Llévaselo, ándale."',
    fin: 'Su hijo abrió el lonche: burritos de machaca y una notita que dice "pórtate bien, te quiero". No dijo nada. Se le hizo un nudo en la garganta.',
    mal: 'La fila avanzó y su hijo ya cruzó sin lonche. Doña Toñita dice que mañana le pone el doble.' },
  { k: 'gallo', quien: 'El Güero de la tiendita', ico: '🐓', cosa: 'un gallo', a: 'la casa de su compadre',
    pide: '"Llévale este gallo a mi compadre, es regalo. Canta a las tres de la mañana y ya no lo aguanto... digo, para que lo disfrute."',
    fin: 'El compadre lo recibió feliz. Esa misma noche, a las tres de la mañana, dejó de estar feliz.',
    mal: 'El gallo se escapó y se subió a un poste. Ahora le canta a toda la colonia. Nadie sabe de quién es. Todos sospechan del Güero.' },
  { k: 'vestido', quien: 'Brenda', ico: '👗', prisa: true, cosa: 'el vestido de XV años', a: 'el salón de fiestas',
    pide: '"¡Mi prima ya está en el salón en bata y el vestido sigue aquí! El chambelán está temblando. ¡Vuela!"',
    fin: 'Llegó el vestido justo a tiempo. Bailaron el vals y lloró hasta el DJ.',
    mal: 'La quinceañera bailó el vals en bata. Dice que fue un "estilo". Las tías no opinan igual.' },
  { k: 'tupper', quien: 'Don Ruperto', ico: '🥡', cosa: 'el tupper de la vecina', a: 'la casa de la vecina',
    pide: '"Devuélvele el tupper a la vecina. Ya pasaron tres meses. Si no se lo regreso, me declara la guerra."',
    fin: '"¿Y la tapa?", te preguntó. Te miró feo. La tapa nunca se recupera, así es la vida.',
    mal: 'La vecina ya compró tuppers nuevos y puso un letrero en su puerta: "No se prestan tuppers. Sí, Ruperto, va por ti".' },
  { k: 'control', quien: 'Doña Licha', ico: '📺', prisa: true, cosa: 'el control de la tele', a: 'la casa del compadre, donde está su esposo',
    pide: '"Mi viejo se llevó el control a ver los Xolos con su compadre. ¡Y ya va a empezar mi novela! Tráemelo... digo, llévaselo a él, que lo devuelva."',
    fin: 'El esposo devolvió el control "sin querer". Doña Licha ganó la guerra del control. Por esta semana.',
    mal: 'Se acabó la novela. Doña Licha no le habla a su esposo. El esposo dice que es lo más tranquilo que ha estado.' },
  { k: 'pez', quien: 'Chuyito', ico: '🐟', cosa: 'a Nemo, su pez', a: 'la casa de su abuela',
    pide: '"¿Me haces un paro? Lleva a mi pez a casa de mi abuela. Mi mamá dice que en mi cuarto se va a morir de tristeza."',
    fin: 'La abuela le puso nombre nuevo: Don Pescado. Ya tiene pecera con castillo y le cuenta chismes.',
    mal: 'Nemo llegó mareado pero vivo. La abuela dice que así llega todo el que viene por la Vía Rápida.' },
  { k: 'anillo', quien: 'Paty', ico: '💍', prisa: true, cosa: 'un anillo', a: 'el mirador, con el novio de Paty',
    pide: '"Mi novio me va a pedir matrimonio en el mirador y dejó el anillo en mi casa. ¡Pero yo no sé nada, eh! Llévaselo."',
    fin: '"¡Sí, sí quiero!", gritó Paty, que no sabía nada. Te invitaron a la boda. Va a haber carne asada.',
    mal: 'El novio se le declaró con un anillo de la máquina de chicles. Paty dijo que sí. Dice que lo que vale es la intención.' },
  { k: 'medicina', quien: 'Doña Ofelia', ico: '💊', cosa: 'las medicinas de su comadre', a: 'la casa de su comadre',
    pide: '"Mi comadre vive sola y se le acabaron sus pastillas de la presión. Yo ya no manejo. ¿Me haces el paro?"',
    fin: 'La comadre te agarró la mano: "Dios te lo pague, mijo." Luego te pagó ella, por si Dios se tarda.',
    mal: 'Su vecino llegó antes con las pastillas. La comadre está bien. Doña Ofelia dice que igual eres buena gente.' },
  { k: 'trofeo', quien: 'El Profe Chuy', ico: '🏆', cosa: 'el trofeo del torneo', a: 'la cancha de la colonia',
    pide: '"Hoy es la final del torneo de la colonia y el trofeo está en mi casa. Sin trofeo, no hay final. Sin final, hay pleito."',
    fin: 'Ganó el equipo de los señores de cincuenta. Los jóvenes piden revancha. Los señores piden pomada.',
    mal: 'Jugaron sin trofeo. Al ganador le dieron un garrafón de agua. Lo levantó igual de orgulloso.' },
  // perritos y gatitos (recibe: 'perro' = quien te recibe es un perro)
  { k: 'bano', quien: 'Don Lencho', ico: '🐶', cosa: 'a Firulais', a: 'la estética canina',
    pide: '"¿Me haces el paro de llevar a Firulais a que lo bañen? Ya huele a tenis de secundaria. Él cree que huele bien."',
    fin: 'Firulais salió bañado, con moñito y perfume de vainilla. Está ofendidísimo. No te va a hablar en una semana.',
    mal: 'Firulais se echó a un charco en el camino y llegó peor. En la estética dicen que eso ya es otro precio.' },
  { k: 'adopcion', quien: 'Mariana la rescatista', ico: '🐾', cosa: 'a una perrita rescatada', a: 'la casa de su nueva familia',
    pide: '"La encontré en la canalización, flaquita y con miedo. Ya la curamos y una familia la quiere adoptar. ¿Se la llevas?"',
    fin: 'La niña de la casa la abrazó y le puso Princesa. La perrita movió la cola tan fuerte que se cayó. Mariana lloró por teléfono.',
    mal: 'La familia se cansó de esperar... pero al rato volvieron a llamar: la quieren igual. Mariana dice que lo vuelvas a intentar.' },
  { k: 'gatitos', quien: 'Doña Chayo', ico: '🐈', cosa: 'dos gatitos en una caja', a: 'la casa de su sobrina',
    pide: '"Mi gata tuvo seis gatitos en mi cajón de calcetines. Llévale estos dos a mi sobrina, que dijo que sí los quiere... creo."',
    fin: 'La sobrina dijo que solo quería uno. Se quedó con los dos. Y con la caja. Y ya pregunta por los otros cuatro.',
    mal: 'Los gatitos se salieron de la caja y se durmieron en tu asiento. Te los regresaron. Ahora te ven como su mamá.' },
  { k: 'gato_vecino', quien: 'Don Fito', ico: '😾', cosa: 'al gato del vecino', a: 'la casa del vecino de Don Fito',
    pide: '"El gato del vecino se subió a mi techo hace tres días y ya se cree el dueño. Regrésaselo. Con cuidado, que rasguña."',
    fin: 'El vecino ni sabía que se había ido. El gato te vio con desprecio, se subió al techo y se quedó viendo para la casa de Don Fito.',
    mal: 'El gato se bajó solito a medio camino y volvió al techo de Don Fito. Ya hasta le pusieron plato.' },
  { k: 'canelo', quien: 'Doña Rosa', ico: '🐕', prisa: true, cosa: 'a Canelo, su perro viejito', a: 'el veterinario',
    pide: '"Canelo ya está viejito, ya casi no camina y tiene cita con el veterinario. Yo no tengo carro. ¿Lo llevas tú? Con cariño, por favor."',
    fin: 'El veterinario dijo que Canelo está viejito pero bien, que nomás necesita sus vitaminas y mucho cariño. De eso le sobra. Doña Rosa lloró de gusto.',
    mal: 'Llegaron tarde a la cita, pero el veterinario los atendió igual. Canelo le movió la cola. Doña Rosa dice que eso es lo que importa.' },
  { k: 'croquetas', quien: 'Don Memo', ico: '🦴', recibe: 'perro', cosa: 'un costal de croquetas', a: 'el albergue de perritos',
    pide: '"En el albergue se les acabaron las croquetas y son como cuarenta perros. Llévales este costal, ándale, que ya ni ladran de hambre."',
    fin: 'Cuarenta perros te ladraron al mismo tiempo. La encargada dice que es "gracias" en perro. Uno te siguió hasta el carro.',
    mal: 'Llegaste tarde, pero los perros te recibieron como si fueras el ídolo de la colonia. Dicen que no importa la hora si traes croquetas.' },
  { k: 'cumple_gato', quien: 'Yaretzi', ico: '🎂', prisa: true, cosa: 'un pastel de atún', a: 'la fiesta de cumpleaños de Señor Bigotes',
    pide: '"¡Hoy cumple dos años Señor Bigotes y el pastel de atún sigue aquí! Ya están los invitados: tres gatos y mi tía. ¡Córrele!"',
    fin: 'Señor Bigotes ignoró el pastel, se metió a la caja en que venía y no salió en toda la fiesta. Fue un éxito.',
    mal: 'Los invitados se comieron las botanas. Señor Bigotes se comió una planta. Nadie cantó las mañanitas.' },
  // los del sur (zona: 'sur'): las colonias entre los cerros y el Campestre, que se quedaban vacias
  { k: 'carbon', quien: 'Don Chuy', ico: '🥩', prisa: true, zona: 'sur', cosa: 'una bolsa de carbón', a: 'la carne asada de su compadre',
    pide: '"Llévale el carbón a mi compadre. Ya llegaron los invitados, ya está la carne, ya está la salsa... y no hay con qué prender."',
    fin: 'Llegó el carbón y por fin arrancó la carne asada. Te dieron la primera tortilla con carne, como a los héroes.',
    mal: 'Prendieron el asador con cartón y periódico. Salió tanto humo que llegaron los bomberos. Se quedaron a comer.' },
  { k: 'guitarra', quien: 'Rigo el de la banda', ico: '🎸', prisa: true, zona: 'sur', cosa: 'la guitarra de Rigo', a: 'el salón de la quinceañera',
    pide: '"Mi grupo toca en unos XV y se me olvidó la guitarra. Sin guitarra soy nomás un señor con sombrero."',
    fin: 'Tocaron toda la noche y le dedicaron una canción "al compa que trajo la guitarra". Ya eres famoso en un salón de fiestas.',
    mal: 'Rigo tocó con una guitarra de juguete de un sobrino. Nadie notó la diferencia. Eso le dolió más que nada.' },
  { k: 'maqueta', quien: 'Doña Lupita', ico: '🪐', prisa: true, zona: 'sur', cosa: 'una maqueta del sistema solar', a: 'la secundaria',
    pide: '"Mi hijo dejó la maqueta del sistema solar y la entrega es ya. Cuidado con Saturno, que el anillo se despega."',
    fin: 'Llegó completa, menos Plutón, que se cayó en un tope. El maestro dijo que de todas formas ya no es planeta. Diez.',
    mal: 'No le aceptaron la maqueta tarde. Expuso el sistema solar con naranjas de la cooperativa. Le pusieron ocho.' },
  { k: 'album', quien: 'Rocío', ico: '📷', prisa: true, zona: 'sur', cosa: 'un álbum de fotos', a: 'la central de autobuses, con su papá',
    pide: '"Mi papá se va a vivir a Mexicali y no alcancé a despedirme. Llévale este álbum a la central, su camión sale en un rato."',
    fin: 'Su papá abrió el álbum en la sala de espera. En la última foto decía "vuelve pronto". Se subió al camión llorando y sonriendo.',
    mal: 'El camión ya había salido. Rocío dice que se lo manda por paquetería, que lo importante es que le llegue. Se le quebró la voz.' },
  { k: 'tortuga', quien: 'Ximena', ico: '🐢', zona: 'sur', cosa: 'a Manuelita, su tortuga', a: 'la casa de su tía',
    pide: '"Me voy de vacaciones y Manuelita se queda con mi tía. No la apures, ella va a su ritmo. Tú sí apúrate."',
    fin: 'Manuelita llegó bien, se comió una hoja de lechuga en diez minutos y se durmió en el sol. Vida de lujo.',
    mal: 'Tardaste tanto que la tía dice que la tortuga hubiera llegado antes caminando. Manuelita no opina, está dormida.' },
  { k: 'menudo', quien: 'Doña Cheli', ico: '🍜', prisa: true, zona: 'sur', cosa: 'un menudo bien caliente', a: 'la casa de su yerno',
    pide: '"Llévale este menudo a mi yerno, que anoche se desveló viendo la pelea y hoy no es persona. Que no se enfríe."',
    fin: 'El yerno se tomó el menudo y volvió a ser persona. Dijo que Doña Cheli es la mejor suegra del mundo. Ella lo grabó en video.',
    mal: 'Llegó tibio. El yerno se lo tomó igual, pero ahora Doña Cheli le recuerda en cada comida que "no fue culpa de ella".' },
  { k: 'llaves', quien: 'Doña Bertha', ico: '🔑', prisa: true, zona: 'sur', cosa: 'las llaves de la casa', a: 'la casa de su hijo',
    pide: '"Mi hijo se quedó afuera de la casa con el bebé y yo traigo las llaves. ¡Y ya empezó a lloviznar! Llévaselas, mijo."',
    fin: 'Abrieron la puerta justo antes del aguacero. El bebé ni se enteró: venía dormido y babeando feliz.',
    mal: 'Se mojaron todos. El bebé se rió todo el rato. El hijo de Doña Bertha dice que fue el mejor día de la vida del niño.' },
  { k: 'perico', quien: 'Don Goyo', ico: '🦜', zona: 'sur', cosa: 'a Paco, su perico', a: 'el veterinario',
    pide: '"Lleva a Paco al veterinario, ya no canta. Bueno, sí habla, pero repite cosas que le enseñó mi sobrino y no se pueden decir."',
    fin: 'El veterinario dijo que Paco está sano. En la sala de espera gritó "¡ya llegó el pozole!" y todos le aplaudieron.',
    mal: 'De tanto esperar en el carro, Paco se aprendió el claxon. Ahora pita igualito y los vecinos se asoman a ver quién llegó.' },
  // los del oriente (zona: 'oriente'): un poco sospechosos... y al final todo es de lo mas inocente
  { k: 'paquete', quien: 'El Flaco', ico: '📦', prisa: true, zona: 'oriente', cosa: 'un paquete envuelto en cinta canela', a: 'una casa con el portón verde',
    pide: '"Lleva este paquete. No lo abras. No preguntes. Y si alguien te pregunta... di que son tamales."',
    fin: 'Lo abrieron enfrente de ti: eran tamales. De verdad eran tamales. El Flaco nomás es muy dramático.',
    mal: 'Los tamales llegaron fríos. La señora del portón verde dice que ya no le vuelve a encargar nada al Flaco. El Flaco dice que "así es este negocio".' },
  { k: 'portafolio', quien: 'Un señor de lentes oscuros', ico: '🕶️', zona: 'oriente', cosa: 'un portafolio con "los documentos"', a: 'una mesa del fondo en una cafetería',
    pide: '"Lleva este portafolio. Adentro van los documentos. Si te sigue un carro negro, da tres vueltas a la glorieta. Si te sigue uno blanco, nomás saluda."',
    fin: 'Era su tarea de la clase de inglés para adultos. "Los documentos" eran sus apuntes. El carro negro era su esposa, que le llevaba el lonche.',
    mal: 'Llegó tarde a la clase. La maestra le puso "absent". Él dice que es un nombre en clave.' },
  { k: 'hielera', quien: 'La Güera', ico: '🧊', prisa: true, zona: 'oriente', cosa: 'una hielera muy pesada', a: 'una fiesta en una cochera',
    pide: '"Lleva esta hielera. Pesa porque... pesa. No la voltees y no la abras, que se sale lo bueno."',
    fin: 'Era raspado de tamarindo para treinta niños. Pesaba porque era mucho raspado. La Güera es la heroína de la fiesta.',
    mal: 'Llegó derretido. Ahora es agua de tamarindo. Los niños dicen que igual cuenta.' },
  { k: 'sobre', quien: 'Don Nadie', ico: '✉️', zona: 'oriente', cosa: 'un sobre cerrado', a: 'su contacto',
    pide: '"Entrégale este sobre a mi contacto. Él sabe. Tú no sabes. Nadie sabe. Ni yo sé bien, pero tú llévalo."',
    fin: 'El contacto abrió el sobre: era la receta secreta del pozole de la abuela de Don Nadie. Te hicieron jurar que no la viste.',
    mal: 'El contacto ya se había ido. Don Nadie dice que la receta seguirá siendo secreta otro año. Igual nadie la entiende: dice "sal al gusto".' },
  { k: 'llanta', quien: 'El Chato', ico: '⚙️', zona: 'oriente', cosa: 'una llanta con todo y rin', a: 'un taller',
    pide: '"Lleva esta llanta al taller. No es robada. Bueno... no sabemos. Es una llanta, no habla."',
    fin: 'En el taller la reconocieron: era del carro del dueño del taller. Te dieron las gracias y te miraron raro un buen rato.',
    mal: 'El taller ya había cerrado. Dejaste la llanta recargada en la cortina. En la mañana ya no estaba. El ciclo de la vida.' },
  { k: 'costal', quien: 'El Tío Rafa', ico: '🧺', prisa: true, zona: 'oriente', cosa: 'un costal que huele raro', a: 'el terreno de atrás de la iglesia',
    pide: '"Lleva este costal al terreno de atrás de la iglesia. Ahí te esperan. No veas adentro. Huele raro, pero es normal. Creo."',
    fin: 'Era abono de caballo para el huerto de las señoras de la parroquia. Sí olía raro. Sí era normal. Te regalaron unos rábanos.',
    mal: 'Las señoras ya habían sembrado sin abono. Dicen que los jitomates van a salir tristes y que es culpa del Tío Rafa.' },
  { k: 'papeles', quien: 'El Licenciado', ico: '📁', prisa: true, zona: 'oriente', cosa: 'unos papeles importantes', a: 'la notaría',
    pide: '"Lleva estos papeles a la notaría antes de que cierren. Que no los vea mi hermano. Ni mi otro hermano. Ni mi mamá."',
    fin: 'Eran las escrituras del terreno de la abuela. Ahora toda la familia se pelea... pero en la notaría, como debe ser.',
    mal: 'Cerró la notaría. Los hermanos se enteraron. La comida del domingo va a estar tensa.' },
  { k: 'caja', quien: 'Chava', ico: '❓', zona: 'oriente', cosa: 'una caja que se mueve', a: 'la casa de su primo',
    pide: '"Lleva esta caja con mi primo. Si se mueve, es normal. Si hace ruidos, también. No la sacudas. Por favor no la sacudas."',
    fin: 'Eran tres conejitos para el cumpleaños de la sobrina de Chava. Por eso se movía. La niña gritó tan fuerte que se oyó en San Diego.',
    mal: 'Los conejitos llegaron bien, pero la fiesta ya había acabado. La sobrina dice que es el mejor regalo de "después de cumpleaños".' },
  // los de Otay (zona: 'otay'): estudiantes, aeropuerto y garita
  { k: 'tarea', quien: 'Brayan', ico: '📚', prisa: true, zona: 'otay', cosa: 'la tarea de cálculo de su compa', a: 'el salón donde lo esperan',
    pide: '"¡Ayúdame! Mi compa dejó su tarea de cálculo en mi mochila y entrega en un rato. Si reprueba, me va a cobrar los tacos que le debo."',
    fin: 'Llegaste justo cuando el profe pasaba lista. El compa de Brayan te juró amistad eterna y te dio para la gasolina.',
    mal: 'Llegaste tarde. El profe dijo "a extraordinario" con una sonrisa que dio miedo.' },
  { k: 'maleta', quien: 'Doña Chayo', ico: '🧳', prisa: true, zona: 'otay', cosa: 'la maleta de su hija', a: 'la esquina donde la espera su hija',
    pide: '"Mi hija se va a Guadalajara y dejó la maleta en la sala. ¡Llévasela, que el avión no espera y ella tampoco!"',
    fin: 'La hija abrió la maleta para checar: puros tóperes con mole de su mamá. Lloró tantito y te dio una propina.',
    mal: 'El avión se fue sin la maleta. La hija llegó a Guadalajara con lo puesto y una foto del mole.' },
  { k: 'burritos', quien: 'Don Memo el trailero', ico: '🌯', zona: 'otay', cosa: 'unos burritos de machaca', a: 'el patio donde espera su compadre',
    pide: '"Mi compadre lleva horas esperando para cruzar con el tráiler y no ha comido. Llévale estos burritos, que con hambre se pone sentimental."',
    fin: 'El compadre se comió tres burritos de un jalón y te dijo "eres un ángel" con la boca llena.',
    mal: 'Llegaste tarde: el compadre ya se había comido unas galletas de la guantera. Dice que nunca te lo va a perdonar.' },
  { k: 'papalote', quien: 'Santi', ico: '🪁', zona: 'otay', cosa: 'su papalote', a: 'el parque donde lo espera su abuelo',
    pide: '"El viento se llevó mi papalote al techo de la vecina y ya me lo bajó. ¿Se lo llevas a mi abuelo al parque? Yo no puedo cruzar la calle solo."',
    fin: 'El abuelo de Santi lo hizo volar más alto que nunca. Te dio un dulce de tamarindo y las gracias.',
    mal: 'El papalote se atoró en un poste en el camino. Ahora es parte del paisaje de Otay.' },
  // los de La Mesa (zona: 'lamesa'): fiestas, bodas y el partido
  { k: 'pastel', quien: 'Doña Toña', ico: '🎂', prisa: true, zona: 'lamesa', cosa: 'un pastel de tres pisos', a: 'los quince de su nieta',
    pide: '"¡Los quince de mi nieta empiezan en un rato y el pastel sigue aquí! Llévalo derechito y sin brincar topes, que son tres pisos."',
    fin: 'El pastel llegó entero y la quinceañera lloró de la emoción. Te dieron una rebanada y un recuerdito con tu nombre mal escrito.',
    mal: 'El pastel llegó tarde y con un piso de menos. La quinceañera dice que así se ve más moderno.' },
  { k: 'zapatos', quien: 'Don Panchito', ico: '👞', prisa: true, zona: 'lamesa', cosa: 'unos zapatos recién boleados', a: 'la casa de su yerno, que hoy se casa',
    pide: '"Mi yerno se casa en un rato y dejó los zapatos aquí para bolearlos. Quedaron como espejo. Ve, que no se va a casar descalzo."',
    fin: 'El novio llegó a la iglesia con los zapatos brillando. Don Panchito dice que fue lo mejor de la boda.',
    mal: 'El novio se casó en chanclas. Esas fotos van a salir en todas las fiestas de la familia por los próximos cincuenta años.' },
  { k: 'radio', quien: 'Lalo el del tianguis', ico: '📻', zona: 'lamesa', cosa: 'un radio recién arreglado', a: 'la casa de Don Cirilo',
    pide: '"Arreglé el radio de Don Cirilo. Llévaselo antes de que empiece el partido de los Xolos, que si se lo pierde me cobra el radio, el partido y el coraje."',
    fin: 'Don Cirilo prendió el radio justo para el gol. Gritó tanto que se oyó hasta las 5 y 10.',
    mal: 'Don Cirilo oyó el partido en el celular de su nieto, con la señal cortándose. Dice que ese gol no cuenta.' },
  { k: 'tamales', quien: 'Doña Lencha', ico: '🫔', prisa: true, zona: 'lamesa', cosa: 'una olla de tamales', a: 'la posada de la colonia',
    pide: '"¡Los tamales para la posada! Si llegan fríos, la vecina de enfrente va a decir que los suyos son mejores, y eso no lo voy a permitir."',
    fin: 'Los tamales de Doña Lencha se acabaron en diez minutos. La vecina de enfrente pidió la receta. Victoria total.',
    mal: 'Llegaron tibios. La vecina de enfrente no dijo nada, pero sonrió. Doña Lencha no duerme desde entonces.' },
  // los de La Presa y el Cerro Colorado (zona: 'presa')
  { k: 'cana', quien: 'Don Chencho', ico: '🎣', zona: 'presa', cosa: 'una caña de pescar', a: 'la casa de su compadre',
    pide: '"Mi compadre me prestó su caña para ir a la presa y no pesqué ni un resfriado. Devuélvesela antes de que se dé cuenta de que le rompí el carrete."',
    fin: 'El compadre ni notó lo del carrete. Te regaló un pescado congelado "de la presa", con etiqueta del súper.',
    mal: 'El compadre ya se dio cuenta. Ahora Don Chencho le debe una caña, un carrete y una disculpa.' },
  { k: 'guante', quien: 'Kevin', ico: '🧤', prisa: true, zona: 'presa', cosa: 'su guante de béisbol', a: 'el campo donde juega su equipo',
    pide: '"¡Juego en un rato y se me olvidó el guante! Sin guante el coach me manda a la banca... o peor, de bat boy."',
    fin: 'Kevin atrapó la última bola del juego. El coach dice que fue suerte; Kevin dice que fue el guante.',
    mal: 'Kevin jugó con el guante prestado de su hermana, que es zurda. Mejor ni contamos cómo le fue.' },
  { k: 'garrafon', quien: 'Doña Cata', ico: '💧', prisa: true, zona: 'presa', cosa: 'un garrafón de agua', a: 'la casa de su hermana',
    pide: '"Mi hermana se quedó sin agua y a su cerro no sube el camión del garrafón. Llévale este, que hace un calorón."',
    fin: 'La hermana de Doña Cata te dio un vaso de agua de jamaica bien fría. Dice que eres su héroe.',
    mal: 'Llegaste tarde: la hermana ya había hervido agua de la llave. Dice que sabe a tubo.' },
  { k: 'uniforme', quien: 'Doña Rosy', ico: '👕', prisa: true, zona: 'presa', cosa: 'el uniforme de la escolta', a: 'la escuela de su hijo',
    pide: '"¡Hoy mi hijo lleva la bandera en la escolta y dejó el uniforme planchado en la silla! Llévaselo, que si sale en pants, me muero."',
    fin: 'El niño marchó con el uniforme impecable. Doña Rosy grabó todo el video... en vertical.',
    mal: 'El niño marchó en pants. La directora dijo que "lo importante es participar". Doña Rosy no está de acuerdo.' },
  // los de Playas (zona: 'playas'): el mar, el malecon y las ballenas
  { k: 'nieve', quien: 'Doña Pera', ico: '🍦', prisa: true, zona: 'playas', cosa: 'unas nieves de garrafa', a: 'la casa de su comadre',
    pide: '"¡Llévale estas nieves a mi comadre antes de que se derritan! Son de garrafa, de las de antes; si llegan aguadas, me deja de hablar."',
    fin: 'Llegaron firmes. La comadre se comió la de mango antes de darte las gracias. A ti te tocó la de vainilla.',
    mal: 'Llegó un caldito de nieve. La comadre dice que así también se toma, con popote.' },
  { k: 'tabla', quien: 'Leo el surfo', ico: '🏄', zona: 'playas', cosa: 'una tabla de surf', a: 'la casa de su primo',
    pide: '"Mi primo se va a surfear a Ensenada y se le olvidó la tabla. Llévasela antes de que se vaya, que sin tabla nomás va a nadar."',
    fin: 'El primo de Leo amarró la tabla al techo y arrancó feliz. Te dejó unas calcomanías y un "¡aloha, carnal!".',
    mal: 'El primo ya se había ido. Dice que nadó muy bonito.' },
  { k: 'binoculares', quien: 'Don Rubén', ico: '🔭', zona: 'playas', cosa: 'unos binoculares', a: 'la casa de su vecino',
    pide: '"Mi vecino quiere ver las ballenas grises que pasan frente a Playas y le presto mis binoculares. Llévaselos, que la temporada no espera."',
    fin: 'El vecino vio dos ballenas y un barco que se le hizo pirata. Te dio un abrazo y un café de olla.',
    mal: 'Llegaste tarde: el vecino ya vio las ballenas... en el celular de su nieto.' },
  { k: 'ceviche', quien: 'Doña Bety', ico: '🦐', prisa: true, zona: 'playas', cosa: 'un pedido de ceviche', a: 'la casa de un cliente',
    pide: '"Me pidieron un ceviche para llevar y mi repartidor se fue a ver el atardecer al malecón. ¿Me haces el paro? Que no se caliente."',
    fin: 'El cliente le dio cinco estrellas a Doña Bety y una a su repartidor. A ti te tocó la propina.',
    mal: 'El ceviche llegó tibio. El cliente dice que sabía "a playa"; Doña Bety no sabe si eso es bueno o malo.' },
  // los de El Florido y Terrazas (zona: 'florido') y los del sur: Santa Fe, el Cañón del Sainz y Natura (zona: 'natura')
  { k: 'mudanza', quien: 'Don Héctor', ico: '📦', zona: 'florido', cosa: 'una caja de la mudanza', a: 'la casa nueva de su hija',
    pide: '"Mi hija se cambió para acá y se le quedó la caja de los trastes. Llévasela, que no ha comido más que en platos de cartón."',
    fin: 'La hija de Don Héctor estrenó los trastes con unos frijoles de la olla. Te tocó un plato.',
    mal: 'Llegaste tarde: ya había comprado trastes en el tianguis. Ahora tiene el doble y no le caben.' },
  { k: 'lonchera', quien: 'Doña Isa', ico: '🍱', prisa: true, zona: 'florido', cosa: 'la lonchera de su esposo', a: 'la maquiladora donde trabaja',
    pide: '"¡Mi viejo se fue a la maquila sin su lonchera! Si no come, regresa de un humor que ni el perro lo aguanta."',
    fin: 'El esposo de Doña Isa se comió sus burritos en el descanso. Dice que le supieron a gloria.',
    mal: 'El esposo comió papitas de la máquina. Regresó de malas y el perro se escondió debajo de la troca.' },
  { k: 'telescopio', quien: 'Sofía', ico: '🌙', prisa: true, zona: 'natura', cosa: 'su telescopio', a: 'el parque donde la espera su club de astronomía',
    pide: '"Hoy hay luna llena y mi club de astronomía se junta en el parque. Llévales mi telescopio, ¡que la luna no espera!"',
    fin: 'Vieron los cráteres de la luna y a Saturno con sus anillos. Sofía dice que ya eres miembro honorario del club.',
    mal: 'Para cuando llegaste ya se había nublado. Vieron la luna... en un video.' },
  { k: 'plantitas', quien: 'Don Lupe', ico: '🌱', zona: 'natura', cosa: 'unas plantitas de chile', a: 'el huerto de su compadre',
    pide: '"Le prometí a mi compadre unas plantitas de chile para su huerto. Cuídalas, que el viento de aquí se lleva hasta las ganas."',
    fin: 'El compadre las plantó en fila. Dice que en tres meses te toca la primera salsa.',
    mal: 'Las plantitas llegaron marchitas. El compadre las regó con tanto cariño que una sí revivió.' },
];

// ---------- HUD ----------
const $ = (id) => document.getElementById(id);
const hud = { money: $('money'), counts: $('counts'), obj: $('obj'), street: $('street'), toast: $('toast'), timer: $('timer'), arrow: $('arrow'), mini: $('mini') };
hud.arrowRot = hud.arrow.querySelector('.rot'); hud.arrowDist = hud.arrow.querySelector('.dist');
$('credit').textContent = D.src;
let toastT = 0, streetT = 0, lastStreet = '';
// la columna de avisos va entre el panel de dinero y el minimapa; si no cabe ahi (pantalla angosta), debajo de los dos.
// Se recalcula cada vez que aparece un aviso porque el panel cambia de ancho con el texto
function layoutTop() {
  const t = $('topmsg').style, st = $('stats').getBoundingClientRect(), mi = hud.mini.getBoundingClientRect();
  if (mi.left - st.right >= 220) { t.left = (st.right + 12) + 'px'; t.right = (window.innerWidth - mi.left + 12) + 'px'; t.top = '10px'; }
  else {
    // debajo del panel y del minimapa, a lo ancho; si ahi queda el boton de opciones (celular vertical),
    // los mensajes le dejan libre su columna para no taparlo
    const top = Math.max(st.bottom, mi.bottom) + 8, op = $('optbtn').getBoundingClientRect();
    t.left = '12px'; t.top = top + 'px';
    t.right = (op.width && op.bottom > top ? window.innerWidth - op.left + 8 : 12) + 'px';
  }
}
// aviso cuando tu vehiculo queda destruido
function avisoDeshuesado(car) {
  if (car.T === VT_DEPORTIVA) toast('💥 ¡Moto hecha pedazos!', pick(['Te dije que con cuidadito. Bájate con E y roba otra cosa.', 'Mucho motor y poco frenado. Bájate con E y busca otro.']));
  else toast('¡Auto deshuesado!', 'Bájate con E y roba otro.');
}
function toast(title, body, secs) { layoutTop(); hud.toast.innerHTML = '<b></b><span></span>'; hud.toast.firstChild.textContent = title; hud.toast.lastChild.textContent = body || ''; hud.toast.classList.add('on'); toastT = secs || 3.5; }
// sonido de dinero: se compara contra el ultimo saldo mostrado (bigSound = fanfarria en vez de monedas; sonidoCompra:
// lo que gastas a gusto en el telefono suena alegre y no con el trombon triste de cuando pierdes)
let lastMoney = state.money, bigSound = false, sonidoCompra = null;
function updateStats() {
  const dm = state.money - lastMoney; lastMoney = state.money;
  if (window.SND) { if (dm > 0) SND.play(bigSound ? 'fanfare' : 'gain', dm); else if (dm < 0) SND.play(sonidoCompra || 'loss'); }
  bigSound = false; sonidoCompra = null;
  hud.money.textContent = '$' + state.money.toLocaleString('es-MX');
  // cada contador en su propio span (no se parte); si no cabe en una linea, se brinca entre contadores (ver #counts)
  const cs = [`★ ${landmarks.filter(l => l.found).length}/${landmarks.length}`, `🌮 ${tacos.filter(t => t.eaten).length}/${tacos.length}`,
    `☕ ${cafes.filter(c => c.drunk).length}/${cafes.length}`];
  if (EGGS.some(e => e.got)) cs.push(`🥚 ${EGGS.filter(e => e.got).length}/${EGGS.length}`);
  if ((state.paros || []).length) cs.push(`🤝 ${state.paros.length}/${PAROS.length}`);
  // (los separadores van en su span: en vertical se quitan y los contadores se acomodan junto al dinero)
  hud.counts.replaceChildren(...cs.flatMap((t, i) => { const e = document.createElement('span'); e.textContent = t; if (!i) return [e]; const sp = document.createElement('span'); sp.className = 'sep'; sp.textContent = ' · '; return [sp, e]; }));
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
// moto deportiva: la mas rapida de todas, pero al primer choque se hace pedazos (fragil); sale poco en el trafico
// bicis y patinetas: raras, estacionadas en la banqueta sin candado. No se rompen, no hacen ruido, la poli no les
// hace caso y van mas rapido que caminando (62) pero un poco mas lento que corriendo (112). Ver makeBicis y poneBici
const VT_BICI = {
  ruta: { name: 'Bici de ruta', bici: 'ruta', L: 18, W: 6, top: 104, acc: 95, steer: 3.6, hp: 100 },
  montana: { name: 'Bici de montaña', bici: 'montana', L: 18, W: 7, top: 96, acc: 105, steer: 3.9, hp: 100 },
  patineta: { name: 'Patineta', bici: 'patineta', L: 14, W: 7, top: 88, acc: 80, steer: 4.2, hp: 100 },
};
const BICI_AVISO = {
  ruta: ['🚲 ¡Bici de ruta!', 'Delgadita y rápida. No se rompe, no hace ruido y la poli ni te pela.'],
  montana: ['🚵 ¡Bici de montaña!', 'Llantas gordas, aguanta baches y banquetas. No se rompe y la poli ni te pela.'],
  patineta: ['🛹 ¡Patineta!', 'Más lenta que correr, pero no te cansas. No se rompe y la poli ni te pela.'],
};
// ---------- las apps del telefono que gastan tu dinero ----------
// TeleTJ: te aparece (con todo y carro) junto a un lugar de cada zona. Caro a proposito
const TELE_PRECIO = 1500;
const TELE_DESTINOS = [
  { zona: 'Zona Centro', lugar: 'Arco Monumental', ico: '🌉' }, { zona: 'Zona Río', lugar: 'Plaza Río Tijuana', ico: '🛍️' },
  { zona: 'Playas de Tijuana', lugar: 'Faro de Playas', ico: '🏖️' }, { zona: 'Hipódromo', lugar: 'Estadio Caliente', ico: '⚽' },
  { zona: 'La Mesa', lugar: 'Macroplaza', ico: '🏬' }, { zona: 'Otay', lugar: 'Aeropuerto de Tijuana', ico: '✈️' },
  { zona: 'Cerro Colorado', lugar: 'Mirador del Cerro Colorado', ico: '⛰️' }, { zona: 'La Presa', lugar: 'Presa Rodríguez', ico: '💧' },
  { zona: 'Santa Fe', lugar: 'Santa Fe', ico: '🏘️' }, { zona: 'Natura', lugar: 'Natura', ico: '🌲' },
];
const TELE_LLEGADA = ['Te mareaste un poquito, pero ya estás aquí.', 'Llegaste con el pelo parado y oliendo a ozono.', 'Un señor te vio aparecer y se persignó.',
  'Se te quedó un calcetín en el camino. Ni modo.', 'Más rápido que la Vía Rápida a las seis de la tarde. Bueno, eso no es difícil.'];
// BiciTJ: la bici o patineta te la dejan junto a ti
const BICI_TIENDA = [
  { k: 'patineta', ico: '🛹', precio: 400, det: 'Más lenta que correr, pero no te cansas.' },
  { k: 'ruta', ico: '🚲', precio: 700, det: 'Delgadita y rápida.' },
  { k: 'montana', ico: '🚵', precio: 900, det: 'Llantas gordas: aguanta baches y banquetas.' },
];
// Antojos: pides, esperas al repartidor y llega... con lo que llegue. No da nada: es por el gusto
const MENU_ANTOJOS = [
  { ico: '🌮', nombre: 'Tacos de adobada con todo', det: 'Con todo es con todo.', precio: 90,
    llega: ['Llegaron con todo: hasta con una servilleta autografiada por el taquero.', 'Llegaron calientitos. El repartidor se comió uno "para probar que no estuvieran envenenados".'] },
  { ico: '🍲', nombre: 'Caldo de res', det: 'Ideal para los 40 grados de agosto.', precio: 120,
    llega: ['Llegó hirviendo. Afuera hacen 38 grados. Lo disfrutas igual.', 'Llegó sin cuchara. El repartidor te ofreció la suya. Dijiste que no.'] },
  { ico: '🍣', nombre: 'Sushi con queso crema y chiles toreados', det: 'Estilo Tijuana: empanizado por fuera, feliz por dentro.', precio: 150,
    llega: ['Llegó empanizado, con queso crema y bañado en salsa de anguila. Japón no lo reconoce. Tijuana sí.', 'Te mandaron tres salsas, cinco limones y cero palillos.'] },
  { ico: '🌭', nombre: 'Hot dog con tocino del carrito', det: 'Del carrito de la esquina, el de siempre.', precio: 60,
    llega: ['Llegó envuelto en aluminio, con su chile güero y una cebolla asada de regalo.', 'Llegó con más tocino que hot dog. Así debe ser.'] },
  { ico: '🌽', nombre: 'Elote en vaso con todo', det: 'Mayonesa, queso, chile y fe.', precio: 50,
    llega: ['Llegó el elote. El vaso venía tan lleno que el repartidor traía queso hasta en las cejas.'] },
  { ico: '🫓', nombre: 'Una sola tortilla, bien calientita', det: 'Para el antojo exacto.', precio: 5,
    llega: ['Llegó una tortilla. Una. En una caja de pizza. Con propina incluida en la cuenta.', 'El repartidor cruzó media ciudad por una tortilla. Te miró con respeto.'] },
  { ico: '🥤', nombre: 'Agua de horchata tamaño cubeta', det: 'Para compartir (o no).', precio: 45,
    llega: ['Llegó la cubeta de horchata. El repartidor la traía en la cabeza.'] },
  { ico: '🍕', nombre: 'Pizza con piña y chiles en vinagre', det: 'La polémica en una caja.', precio: 130,
    llega: ['Llegó la pizza. Un vecino que pasaba la vio y se fue indignado.', 'Llegó tibia, pero los chiles en vinagre la revivieron.'] },
  { ico: '🥗', nombre: 'Ensalada', det: 'Para la foto.', precio: 110,
    llega: ['Llegó la ensalada. El repartidor te preguntó si estabas bien.', 'Llegó la ensalada... con una orden de papas que nadie pidió. El universo sabe.'] },
  { ico: '🎁', nombre: 'Combo misterioso del día', det: 'Ni el restaurante sabe qué trae.', precio: 77,
    llega: ['Abriste el combo misterioso: una gordita, un pan de elote y un llavero del Xolos.', 'El combo misterioso era un caldo de pollo y una carta de amor que no es para ti.', 'Era un tamal. Adentro, otro tamal más chiquito.'] },
];
// lo que dice el repartidor al llegar (y si llega con algo que no era)
const REPARTIDOR_DICE = ['¿Usted pidió esto? Ojalá que sí.', 'Me perdí tres veces, pero aquí estoy.', 'Cinco estrellitas, ¿eh? Tengo familia.',
  'La app decía que vivía en el mar. Casi me meto.', 'Vine a pie porque se me ponchó la moto. De nada.'];
// lo que le contestas al repartidor (la calificacion, la propina...) y como se despide el
const RESPUESTA_CLIENTE = ['Te voy a poner cinco estrellas. Y una carita feliz.', 'Ahí te van veinte de propina. No te los gastes en un solo lugar.',
  'Cuatro estrellas: le faltó salsa a tu sonrisa.', 'Te dejo propina en la app... cuando me acuerde de la contraseña.',
  'Gracias, compa. Cinco estrellas y mi bendición.', 'Te pongo cinco estrellas si me dices dónde compraste esa mochila.',
  'Toma, de propina un chicle. Está casi nuevo.', 'Tres estrellas: llegaste rápido, pero me asustaste.',
  'Si viene completo, te ganaste calificación de campeón.', 'Propina no traigo, pero te doy un consejo: no te metas a la Vía Rápida a las seis.'];
const REPARTIDOR_ADIOS = ['¡Gracias, jefe! Provecho.', '¡Que lo disfrute! Y califíqueme bien, porfa.', 'Provechito. Me voy, que traigo otros doce pedidos.',
  '¡Ándele pues! Nos vemos en el siguiente antojo.', 'Con eso me alcanza para la gasolina... de la mitad del camino.', '¡Gracias! Si se enfría, no fue mi culpa.'];
const PEDIDO_EQUIVOCADO = ['Te trajeron un pozole. Dicen que es lo mismo.', 'Te trajeron el pedido de un tal "Beto". Él no va a comer hoy.', 'Llegó una pizza de queso. El repartidor juró que era lo que pediste.'];
const VT_DEPORTIVA = { name: 'Moto deportiva', L: 22, W: 9, top: 370, acc: 240, steer: 3.3, hp: 50, fragil: true };
const DEPORTIVA_COLS = [['#d10a0a', '#f4f4f4'], ['#7ed321', '#151515'], ['#1f5fbf', '#f4f4f4']]; // carenado y franja
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
// personajes de la calle con su propio atuendo, sus cosas y sus frases (ver FRASES_TIPO); van despues de los comunes
// en PED_VARIANTS. tipo: para las frases; prop: lo que cargan o empujan; shift: se recorre para que quepa el carrito
const TIPOS_CALLE = [
  { tipo: 'elotero', female: false, age: 'adulto', build: 'gordo', skin: '#8d5a36', shirt: '#f4f4f4', pants: '#3b3b3b', hair: 'corto', hairCol: '#111', hat: 'paja', hatCol: '#e2c27a', mandil: '#2e7d32', prop: 'elotes', empuja: true, shift: -3.5, speed: 0.55 },
  { tipo: 'paletero', female: false, age: 'viejo', build: 'delgado', skin: '#a8714a', shirt: '#fafafa', pants: '#2c3e66', hair: 'corto', hairCol: '#bdbdbd', hat: 'gorra', hatCol: '#fafafa', prop: 'paletas', empuja: true, shift: -3.5, speed: 0.55 },
  { tipo: 'turista', female: false, age: 'adulto', build: 'gordo', skin: '#f2b8a0', shirt: '#00897b', flores: true, pants: '#d7ccc8', hair: 'corto', hairCol: '#c9a227', hat: 'paja', hatCol: '#f0dca0', prop: 'camara', speed: 0.8 },
  { tipo: 'turista', female: true, age: 'adulto', build: 'normal', skin: '#f5c6b0', shirt: '#e91e63', flores: true, pants: '#fafafa', hair: 'largo', hairCol: '#e0b84a', hat: 'paja', hatCol: '#f0dca0', prop: 'camara', speed: 0.8 },
  { tipo: 'albanil', female: false, age: 'adulto', build: 'normal', skin: '#8d5a36', shirt: '#9e9e9e', polvo: true, pants: '#1d3f8f', hair: 'corto', hairCol: '#111', hat: 'casco', hatCol: '#fbc02d', prop: 'cubeta', speed: 0.9 },
  { tipo: 'mandado', female: true, age: 'adulto', build: 'gordo', skin: '#a8714a', shirt: '#7b1fa2', mandil: '#f8bbd0', pants: '#3b3b3b', skirt: '#4e342e', hair: 'chongo', hairCol: '#2a1a10', prop: 'bolsas', speed: 0.8 },
  { tipo: 'carriola', female: true, age: 'joven', build: 'delgado', skin: '#c68e5f', shirt: '#4fc3f7', pants: '#283593', hair: 'cola', hairCol: '#111', prop: 'carriola', empuja: true, shift: -3.5, speed: 0.75 },
  { tipo: 'corredor', female: false, age: 'joven', build: 'delgado', skin: '#c68e5f', shirt: '#c6ff00', pants: '#212121', hair: 'corto', hairCol: '#111', hat: 'banda', hatCol: '#ff1744', speed: 2.3 },
  { tipo: 'corredor', female: true, age: 'joven', build: 'delgado', skin: '#e0b08a', shirt: '#ff4081', pants: '#212121', hair: 'cola', hairCol: '#5a3a22', hat: 'banda', hatCol: '#00e5ff', speed: 2.2 },
  { tipo: 'luchador', female: false, age: 'joven', build: 'gordo', skin: '#a8714a', shirt: '#1a1a1a', pants: '#1f2a38', hair: 'corto', hairCol: '#111', hat: 'mascara', hatCol: '#d32f2f', speed: 1 },
  { tipo: 'maquila', female: true, age: 'adulto', build: 'normal', skin: '#c68e5f', shirt: '#1e88e5', bata: true, gafete: true, pants: '#3b3b3b', hair: 'cola', hairCol: '#2a1a10', speed: 1 },
  { tipo: 'maquila', female: false, age: 'adulto', build: 'normal', skin: '#8d5a36', shirt: '#1e88e5', bata: true, gafete: true, pants: '#3b3b3b', hair: 'corto', hairCol: '#111', speed: 1 },
  { tipo: 'estudiante', female: true, age: 'nino', build: 'delgado', skin: '#c68e5f', shirt: '#fafafa', pants: '#283593', skirt: '#283593', hair: 'cola', hairCol: '#111', pack: '#e53935', speed: 1.1, k: 0.8 },
  { tipo: 'estudiante', female: false, age: 'nino', build: 'normal', skin: '#a8714a', shirt: '#fafafa', pants: '#5d6d7e', hair: 'corto', hairCol: '#111', pack: '#1e88e5', speed: 1.1, k: 0.8 },
  { tipo: 'globero', female: false, age: 'viejo', build: 'delgado', skin: '#a8714a', shirt: '#ff9800', pants: '#5a4632', hair: 'calvo', hairCol: '#bdbdbd', hat: 'vaquero', hatCol: '#d7b98a', prop: 'globos', speed: 0.6 },
  { tipo: 'musico', female: false, age: 'adulto', build: 'delgado', skin: '#8d5a36', shirt: '#5d4037', pants: '#1f2a38', hair: 'rizado', hairCol: '#111', prop: 'guitarra', speed: 0.8 },
].map(V => Object.assign({ k: 1 }, V));
const I_TIPOS = PED_VARIANTS.length;
PED_VARIANTS.push(...TIPOS_CALLE);
// la gente que camina en la calle: uno de cada cuatro es un personaje
const pedCalle = () => Math.random() < 0.25 ? I_TIPOS + ((Math.random() * TIPOS_CALLE.length) | 0) : pedVariant();
// carritos que empujan los personajes (adelante de la persona, de x = 6 a 15)
function drawCarrito(x, k) {
  const rr = (X, Y, w, h, r, f) => { x.fillStyle = f; x.beginPath(); x.roundRect(X, Y, w, h, r); x.fill(); };
  x.fillStyle = 'rgba(0,0,0,0.25)'; x.beginPath(); x.roundRect(7, -4.2, 9.5, 9.5, 1); x.fill();
  x.strokeStyle = '#616161'; x.lineWidth = 0.6; x.beginPath(); x.moveTo(5.3, -3.2); x.lineTo(5.3, 3.2); x.moveTo(5.3, -2.8); x.lineTo(6.5, -2.8); x.moveTo(5.3, 2.8); x.lineTo(6.5, 2.8); x.stroke(); // manubrio
  if (k === 'elotes') {
    rr(6.5, -4.5, 9, 9, 1, '#b0bec5'); rr(7, -4, 8, 8, 0.8, '#cfd8dc');
    x.fillStyle = '#90a4ae'; x.beginPath(); x.arc(9.5, -1.5, 2, 0, 7); x.fill(); // la olla
    for (let i = 0; i < 4; i++) { x.fillStyle = '#fbc02d'; x.beginPath(); x.ellipse(12.8, -2.6 + i * 1.6, 1.7, 0.6, 0, 0, 7); x.fill(); x.fillStyle = '#7cb342'; x.fillRect(14.2, -2.9 + i * 1.6, 0.8, 0.6); }
    x.fillStyle = '#fff'; x.fillRect(8, 2, 2.2, 1.6); x.fillStyle = '#e53935'; x.fillRect(10.6, 2, 1.6, 1.6); // mayonesa y chile
  } else if (k === 'paletas') {
    rr(6.5, -4.5, 9, 9, 1, '#fafafa'); x.strokeStyle = '#bdbdbd'; x.lineWidth = 0.4; x.strokeRect(6.7, -4.3, 8.6, 8.6);
    rr(7.4, -3.6, 7.2, 7.2, 0.6, '#1e88e5'); // la tapa
    x.fillStyle = '#fff'; x.font = 'bold 2.2px sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText('PALETAS', 11, 0.2);
    x.fillStyle = '#fdd835'; x.beginPath(); x.arc(15, -3.6, 0.8, 0, 7); x.fill(); // la campanita
  } else if (k === 'carriola') {
    x.strokeStyle = '#424242'; x.lineWidth = 0.6; x.strokeRect(6.5, -3.4, 7.5, 6.8);
    rr(6.8, -3.2, 7, 6.4, 2.2, '#f8bbd0'); // la cobijita
    x.fillStyle = '#e0b08a'; x.beginPath(); x.arc(12, 0, 1.3, 0, 7); x.fill(); // el bebe
    x.fillStyle = '#283593'; x.beginPath(); x.arc(13.5, 0, 3.6, -Math.PI / 2, Math.PI / 2); x.closePath(); x.fill(); // el toldo
    x.strokeStyle = 'rgba(255,255,255,0.4)'; x.lineWidth = 0.3; x.beginPath(); x.arc(13.5, 0, 2.6, -Math.PI / 2, Math.PI / 2); x.stroke();
  }
}
// una persona vista desde arriba mirando a la derecha (+x); sw entre -1 y 1 es el paso de la caminata
function drawPerson(x, V, sw) {
  x.save(); x.translate(V.shift || 0, 0); x.scale(V.k, V.k); x.lineCap = 'round';
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
  // lo que empuja va adelante: carrito de elotes, de paletas o la carriola (las manos quedan en el manubrio)
  if (V.empuja) drawCarrito(x, V.prop);
  if (V.empuja) {
    for (const side of [-1, 1]) {
      x.strokeStyle = V.shirt; x.lineWidth = 2.4; x.beginPath(); x.moveTo(0, side * (arm - 0.2)); x.lineTo(3.2, side * 3.2); x.stroke();
      x.strokeStyle = V.skin; x.lineWidth = 1.8; x.beginPath(); x.moveTo(3.2, side * 3.2); x.lineTo(5, side * 2.8); x.stroke();
      x.fillStyle = V.skin; x.beginPath(); x.arc(5.3, side * 2.8, 1.2, 0, 7); x.fill();
    }
  }
  // brazos: se mueven al reves que las piernas; el viejito con baston lo lleva en la mano derecha
  if (!V.empuja) for (const side of [-1, 1]) {
    const off = -sw * 4.5 * side * (V.age === 'viejo' ? 0.6 : 1);
    x.strokeStyle = V.shirt; x.lineWidth = V.build === 'gordo' ? 2.8 : 2.4;
    x.beginPath(); x.moveTo(0, side * (arm - 0.2)); x.lineTo(off * 0.7, side * (arm + 0.6)); x.stroke();
    x.fillStyle = V.skin; x.beginPath(); x.arc(off, side * (arm + 0.7), 1.3, 0, 7); x.fill();
    if (V.cane && side === 1) { x.strokeStyle = '#5d4037'; x.lineWidth = 0.9; x.beginPath(); x.moveTo(off, arm + 0.7); x.lineTo(off + 3.6, arm + 1.2); x.stroke(); }
    const hy = side * (arm + 0.7);
    // bolsas del mandado (una en cada mano) y la cubeta del albañil (en la derecha)
    if (V.prop === 'bolsas') {
      x.fillStyle = side < 0 ? '#ff7043' : '#fdd835'; x.beginPath(); x.roundRect(off - 2, hy + side * 0.6 - 1.4, 4, 2.8, 0.8); x.fill();
      x.fillStyle = '#43a047'; x.beginPath(); x.arc(off + (side < 0 ? 0.8 : -0.6), hy + side * 0.6, 0.9, 0, 7); x.fill(); // algo verde asomando
    }
    if (V.prop === 'cubeta' && side === 1) {
      x.fillStyle = '#78909c'; x.beginPath(); x.arc(off, hy + 1.6, 2, 0, 7); x.fill();
      x.fillStyle = '#b0a58f'; x.beginPath(); x.arc(off, hy + 1.6, 1.5, 0, 7); x.fill(); // mezcla
      x.strokeStyle = '#37474f'; x.lineWidth = 0.4; x.beginPath(); x.arc(off, hy + 1.6, 2, 0, 7); x.stroke();
    }
  }
  // mochila en la espalda
  if (V.pack) { x.fillStyle = V.pack; x.beginPath(); x.roundRect(-tx - 1.8, -2.6, 2.4, 5.2, 0.8); x.fill(); }
  // torso (con panza si es gordo); la bata de la maquila es mas larga
  if (V.bata) { x.fillStyle = shade(V.shirt, 0.85); x.beginPath(); x.ellipse(-1, 0, tx + 1, ty + 0.4, 0, 0, 7); x.fill(); }
  x.fillStyle = V.shirt; x.beginPath(); x.ellipse(-0.3, 0, tx, ty, 0, 0, 7); x.fill();
  x.strokeStyle = 'rgba(0,0,0,0.4)'; x.lineWidth = 0.7; x.stroke();
  if (V.flores || V.polvo || V.mandil) {
    x.save(); x.beginPath(); x.ellipse(-0.3, 0, tx, ty, 0, 0, 7); x.clip();
    // camisa hawaiana: flores de colores
    if (V.flores) for (const [fx, fy, c] of [[-1.5, -3, '#ffeb3b'], [0.8, -1.2, '#ff5722'], [-1, 1.5, '#ffffff'], [1, 3.4, '#ffeb3b'], [-2.2, 3.8, '#ff5722'], [0.2, -4.2, '#ffffff']]) {
      x.fillStyle = c; for (let a = 0; a < 6.3; a += 1.26) { x.beginPath(); x.arc(fx + Math.cos(a) * 0.55, fy + Math.sin(a) * 0.55, 0.45, 0, 7); x.fill(); }
    }
    if (V.polvo) { x.fillStyle = 'rgba(230,220,200,0.55)'; for (const [fx, fy] of [[-1, -2], [0.5, 1], [-2, 2.5], [1, -3.5], [-0.5, 3.8]]) { x.beginPath(); x.arc(fx, fy, 0.7, 0, 7); x.fill(); } }
    if (V.mandil) { x.fillStyle = V.mandil; x.beginPath(); x.ellipse(1.6, 0, tx * 0.75, ty * 0.8, 0, 0, 7); x.fill(); x.strokeStyle = 'rgba(255,255,255,0.6)'; x.lineWidth = 0.35; x.setLineDash([0.6, 0.6]); x.stroke(); x.setLineDash([]); }
    x.restore();
  }
  if (V.gafete) { x.fillStyle = '#fff'; x.fillRect(1.2, -3, 1.2, 1.6); x.fillStyle = '#1565c0'; x.fillRect(1.2, -3, 1.2, 0.5); }
  if (V.prop === 'camara') {
    x.strokeStyle = '#212121'; x.lineWidth = 0.4; x.beginPath(); x.moveTo(1.2, -3.8); x.lineTo(2.6, 0); x.lineTo(1.2, 3.8); x.stroke();
    x.fillStyle = '#212121'; x.fillRect(2.2, -1.3, 1.6, 2.6); x.fillStyle = '#90a4ae'; x.beginPath(); x.arc(3.9, 0, 0.7, 0, 7); x.fill();
  }
  if (V.prop === 'guitarra') {
    x.fillStyle = '#a0622d'; x.beginPath(); x.ellipse(4.2, 2, 3.4, 2.6, 0.5, 0, 7); x.fill();
    x.fillStyle = '#3e2410'; x.beginPath(); x.arc(4.2, 2, 0.9, 0, 7); x.fill();
    x.strokeStyle = '#5d3a1a'; x.lineWidth = 1; x.beginPath(); x.moveTo(5.5, 0); x.lineTo(9, -4.5); x.stroke();
  }
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
  if (V.hat === 'paja') { // sombrero de paja de ala ancha
    x.fillStyle = V.hatCol; x.beginPath(); x.arc(0.6, 0, 4.6, 0, 7); x.fill();
    x.strokeStyle = 'rgba(120,90,30,0.45)'; x.lineWidth = 0.3; for (const r of [1.6, 2.6, 3.6, 4.3]) { x.beginPath(); x.arc(0.6, 0, r, 0, 7); x.stroke(); }
    x.strokeStyle = '#6d4c41'; x.lineWidth = 0.6; x.beginPath(); x.arc(0.6, 0, 2.2, 0, 7); x.stroke();
  }
  if (V.hat === 'casco') { // casco de obra con su cresta y la visera adelante
    x.fillStyle = V.hatCol; x.beginPath(); x.ellipse(1.2, 0, 3.6, 3.1, 0, -1.2, 1.2); x.fill();
    x.beginPath(); x.arc(0.5, 0, 2.9, 0, 7); x.fill();
    x.strokeStyle = 'rgba(0,0,0,0.3)'; x.lineWidth = 0.5; x.stroke();
    x.strokeStyle = shade(V.hatCol, 0.7); x.lineWidth = 0.8; x.beginPath(); x.moveTo(-2.2, 0); x.lineTo(3.2, 0); x.stroke();
  }
  if (V.hat === 'mascara') { // mascara de luchador: tapa toda la cabeza, con los ojos ribeteados y las agujetas atras
    x.fillStyle = V.hatCol; x.beginPath(); x.arc(0.5, 0, 2.9, 0, 7); x.fill();
    x.strokeStyle = '#fff'; x.lineWidth = 0.5;
    for (const ey of [-1.1, 1.1]) { x.beginPath(); x.ellipse(2.2, ey, 0.8, 0.6, 0, 0, 7); x.stroke(); }
    x.fillStyle = '#ffd600'; x.beginPath(); x.moveTo(3.2, 0); x.lineTo(-1, -1.6); x.lineTo(-0.2, 0); x.lineTo(-1, 1.6); x.closePath(); x.fill();
    x.strokeStyle = '#fafafa'; x.lineWidth = 0.35; x.beginPath(); x.moveTo(-2.3, -0.6); x.lineTo(-3.4, -1.2); x.moveTo(-2.3, 0.6); x.lineTo(-3.4, 1.2); x.stroke();
  }
  if (V.hat === 'banda') { x.strokeStyle = V.hatCol; x.lineWidth = 0.9; x.beginPath(); x.arc(0.6, 0, 2.35, 0, 7); x.stroke(); }
  if (V.prop === 'globos') { // racimo de globos amarrados a la mano izquierda
    const hx = 0, hy = -6;
    const G = [[2, -9.5, '#e53935'], [4.4, -8.6, '#fdd835'], [0, -10.6, '#1e88e5'], [3, -11.2, '#43a047'], [5.6, -10.6, '#8e24aa'], [1.2, -8, '#ff7043']];
    x.strokeStyle = 'rgba(255,255,255,0.7)'; x.lineWidth = 0.25; x.beginPath(); for (const [gx, gy] of G) { x.moveTo(hx, hy); x.lineTo(gx, gy); } x.stroke();
    for (const [gx, gy, c] of G) { x.fillStyle = c; x.beginPath(); x.ellipse(gx, gy, 1.5, 1.7, 0, 0, 7); x.fill(); x.fillStyle = 'rgba(255,255,255,0.5)'; x.beginPath(); x.arc(gx - 0.5, gy - 0.6, 0.45, 0, 7); x.fill(); }
  }
  if (V.prop === 'elotes') { // la sombrilla del carrito de elotes, encima de todo
    const ux = 10, R = 5;
    for (let i = 0; i < 8; i++) { x.fillStyle = i % 2 ? '#fafafa' : '#e53935'; x.beginPath(); x.moveTo(ux, 0); x.arc(ux, 0, R, i * Math.PI / 4, (i + 1) * Math.PI / 4); x.closePath(); x.fill(); }
    x.strokeStyle = 'rgba(0,0,0,0.3)'; x.lineWidth = 0.4; x.beginPath(); x.arc(ux, 0, R, 0, 7); x.stroke();
    x.fillStyle = '#555'; x.beginPath(); x.arc(ux, 0, 0.6, 0, 7); x.fill();
  }
  if (V.hat === 'gorro') { // gorro de estambre con su doblez
    x.fillStyle = V.hatCol; x.beginPath(); x.arc(0.3, 0, 2.75, 0, 7); x.fill();
    x.strokeStyle = 'rgba(255,255,255,0.18)'; x.lineWidth = 0.4; x.beginPath(); for (let a = -2.2; a <= 2.2; a += 0.55) { x.moveTo(0.3, 0); x.lineTo(0.3 + Math.cos(a + Math.PI) * 2.5, Math.sin(a + Math.PI) * 2.5); } x.stroke();
    x.strokeStyle = 'rgba(0,0,0,0.45)'; x.lineWidth = 0.9; x.beginPath(); x.arc(0.3, 0, 2.3, -1.2, 1.2); x.stroke();
  }
  if (V.hat === 'vaquero') {
    x.fillStyle = V.hatCol; x.beginPath(); x.ellipse(0.7, 0, 4.4, 4.0, 0, 0, 7); x.fill(); x.strokeStyle = 'rgba(0,0,0,0.35)'; x.lineWidth = 0.5; x.stroke();
    x.fillStyle = 'rgba(0,0,0,0.18)'; x.beginPath(); x.ellipse(0.5, 0, 2.4, 2.1, 0, 0, 7); x.fill();
    x.strokeStyle = '#4e342e'; x.lineWidth = 0.6; x.beginPath(); x.ellipse(0.5, 0, 2.5, 2.2, 0, 0, 7); x.stroke();
  }
  x.restore();
}
// el jugador, con mas detalle que la gente de la calle: tenis blancos con suela y agujetas, mezclilla con costuras,
// camisa amarilla de manga corta con cuello y sombra en los pliegues, reloj, orejas, patillas y gorra roja con
// gajos, boton y visera. Mira a la derecha (+x); sw = balanceo de la caminata (-1..1)
function drawPlayer(x, sw) {
  const k = 1.1;
  x.save(); x.scale(k, k); x.lineCap = 'round'; x.lineJoin = 'round';
  const ell = (c, ex, ey, rx, ry, a) => { x.fillStyle = c; x.beginPath(); x.ellipse(ex, ey, rx, ry, a || 0, 0, 7); x.fill(); };
  // sombra
  ell('rgba(0,0,0,0.28)', 1.3, 1.3, 4.6, 6.6);
  // piernas de mezclilla con su costura y tenis blancos (suela gris, puntera y agujetas)
  for (const side of [-1, 1]) {
    const off = sw * 6.5 * side, y = side * 2;
    x.strokeStyle = '#1b3a82'; x.lineWidth = 3.1; x.beginPath(); x.moveTo(0, y); x.lineTo(off, y); x.stroke();
    x.strokeStyle = 'rgba(255,255,255,0.18)'; x.lineWidth = 0.9; x.beginPath(); x.moveTo(0, y - side * 0.6); x.lineTo(off, y - side * 0.6); x.stroke();
    x.strokeStyle = '#e0a84a'; x.lineWidth = 0.35; x.beginPath(); x.moveTo(0, y + side * 0.9); x.lineTo(off, y + side * 0.9); x.stroke();
    ell('#9e9e9e', off + 0.9, y, 2.2, 1.6);
    ell('#f5f5f5', off + 0.9, y, 1.9, 1.3);
    ell('#d32f2f', off + 2.2, y, 0.6, 0.9);
    x.strokeStyle = '#bdbdbd'; x.lineWidth = 0.3; x.beginPath(); for (const d of [-0.2, 0.5, 1.2]) { x.moveTo(off + d, y - 0.6); x.lineTo(off + d, y + 0.6); } x.stroke();
  }
  // torso: camisa con luz en los hombros, pliegues, costura de los hombros y el cuello
  const g = x.createRadialGradient(0.6, 0, 0.5, 0, 0, 5.4);
  g.addColorStop(0, '#ffe57a'); g.addColorStop(0.6, '#ffd23f'); g.addColorStop(1, '#d9a91c');
  x.fillStyle = g; x.beginPath(); x.ellipse(-0.3, 0, 2.9, 5.3, 0, 0, 7); x.fill();
  x.strokeStyle = 'rgba(80,50,0,0.5)'; x.lineWidth = 0.6; x.stroke();
  x.strokeStyle = 'rgba(120,80,0,0.35)'; x.lineWidth = 0.35;
  x.beginPath(); x.moveTo(-1.8, -3.4); x.quadraticCurveTo(-0.6, -1.8, -1.6, 0); x.moveTo(-1.8, 3.4); x.quadraticCurveTo(-0.6, 1.8, -1.6, 0); x.stroke();
  x.beginPath(); x.moveTo(0.4, -4.6); x.lineTo(-0.4, -3.2); x.moveTo(0.4, 4.6); x.lineTo(-0.4, 3.2); x.stroke();
  // brazos por fuera de los hombros: manga corta amarilla, antebrazo, mano y reloj en la izquierda
  for (const side of [-1, 1]) {
    const off = -sw * 3.6 * side, y0 = side * 5.4, y1 = side * 6.1;
    x.strokeStyle = '#8a5a36'; x.lineWidth = 2.3; x.beginPath(); x.moveTo(-0.2, y0); x.lineTo(off, y1); x.stroke();
    x.strokeStyle = '#c68e5f'; x.lineWidth = 1.7; x.beginPath(); x.moveTo(-0.2, y0); x.lineTo(off, y1); x.stroke();
    ell('#e8b923', -0.3, side * 5.1, 1.9, 1.45);
    ell('#ffd23f', -0.2, side * 5.0, 1.6, 1.15);
    ell('#7a4e2e', off + Math.sign(off || 1) * 0.5, y1 + side * 0.1, 1.3, 1.25); ell('#c08657', off + Math.sign(off || 1) * 0.5, y1 + side * 0.1, 1.05, 1); // mano
    if (side === -1) { const wx = off * 0.8 + (off >= 0 ? -0.3 : 0.3); x.strokeStyle = '#1a1a1a'; x.lineWidth = 0.9; x.beginPath(); x.moveTo(wx, y1 - 0.75); x.lineTo(wx, y1 + 0.75); x.stroke(); x.fillStyle = '#cfd8dc'; x.fillRect(wx - 0.25, y1 - 0.3, 0.5, 0.6); }
  }
  // cuello de la camisa por delante de la nuca
  x.fillStyle = '#f2c22c'; x.beginPath(); x.moveTo(2.2, -1.9); x.lineTo(3.3, 0); x.lineTo(2.2, 1.9); x.lineTo(1.4, 0); x.closePath(); x.fill();
  x.strokeStyle = 'rgba(80,50,0,0.5)'; x.lineWidth = 0.3; x.stroke();
  // cabeza: orejas, cara, nariz, patillas y nuca
  ell('#b97f52', 0.9, -2.6, 0.75, 0.6); ell('#b97f52', 0.9, 2.6, 0.75, 0.6);
  ell('#c68e5f', 0.9, 0, 2.5, 2.5);
  ell('#b07548', 3.2, 0, 0.55, 0.45); // nariz
  ell('#111', -0.4, 0, 1.4, 2.4); // nuca con el pelo corto
  x.fillStyle = '#111'; x.fillRect(0.2, -2.4, 1.1, 0.5); x.fillRect(0.2, 1.9, 1.1, 0.5); // patillas
  // gorra roja: corona con gajos, boton, visera con sombra y orilla
  ell('rgba(0,0,0,0.3)', 2.6, 0.25, 1.8, 2.1); // sombra de la visera en la cara
  x.fillStyle = '#b52f22'; x.beginPath(); x.moveTo(1.9, -1.8); x.quadraticCurveTo(4.6, -1.9, 4.6, 0); x.quadraticCurveTo(4.6, 1.9, 1.9, 1.8); x.closePath(); x.fill();
  x.strokeStyle = '#7f1d14'; x.lineWidth = 0.35; x.beginPath(); x.moveTo(4.2, -1.3); x.quadraticCurveTo(4.7, 0, 4.2, 1.3); x.stroke();
  const gc = x.createRadialGradient(0.8, -0.6, 0.3, 0.4, 0, 2.8);
  gc.addColorStop(0, '#ef5a4a'); gc.addColorStop(1, '#a8281b');
  x.fillStyle = gc; x.beginPath(); x.arc(0.3, 0, 2.3, 0, 7); x.fill();
  x.strokeStyle = 'rgba(0,0,0,0.35)'; x.lineWidth = 0.35; x.stroke();
  x.strokeStyle = 'rgba(90,15,10,0.6)'; x.lineWidth = 0.3; x.beginPath();
  for (const a of [0, Math.PI / 3, -Math.PI / 3, Math.PI * 2 / 3, -Math.PI * 2 / 3]) { x.moveTo(0.3, 0); x.lineTo(0.3 + Math.cos(a) * 2.2, Math.sin(a) * 2.2); }
  x.stroke();
  ell('#7f1d14', 0.3, 0, 0.45, 0.45); // boton de arriba
  x.fillStyle = '#f5f5f5'; x.fillRect(-2.0, -0.8, 0.45, 1.6); // ajustador de atras
  x.restore();
}
function makeTextures(scene) {
  makeLights(scene); makeFiesta(scene); makeMoto(scene); makeDeportiva(scene); makeEscolta(scene); makePerro(scene); makePerros(scene); makeGatos(scene); makeLandmarkIcons(scene); makeTrocaTacos(scene); makeZonkey(scene); makeTaxi(scene); makePolice(scene); makeUrbano(scene); makePipaGas(scene); makePanadero(scene); makeBicis(scene); makeExplosiones(scene); makeTacoStands(scene); makeCafes(scene); makePinesComida(scene); makeChinas(scene); makeYonke(scene); makeEggs(scene); makeScorch(scene);
  // personas vistas desde arriba, mirando a la derecha; 8 cuadros de caminata (el cuadro 0 es parado).
  // Una textura por variante de PED_VARIANTS ('ped0'...) y la del jugador ('pedP'); ver drawPerson.
  // Se dibujan a SPR veces la resolucion y el sprite se muestra a escala 1 / SPR para que se vean nitidas.
  const PF = PED_FRAME * SPR;
  const sheet = (key, V, draw) => {
    const t = scene.textures.createCanvas('ped' + key, PF * 8, PF), x = t.getContext();
    for (let f = 0; f < 8; f++) {
      x.save(); x.translate(f * PF + PF / 2, PF / 2); x.scale(SPR, SPR);
      if (draw) draw(x, Math.sin(f / 8 * Math.PI * 2)); else drawPerson(x, V, Math.sin(f / 8 * Math.PI * 2));
      x.restore();
      t.add(f, 0, f * PF, 0, PF, PF);
    }
    t.refresh();
    scene.anims.create({ key: 'walk' + key, frames: Array.from({ length: 8 }, (_, f) => ({ key: 'ped' + key, frame: f })), frameRate: 9, repeat: -1 });
  };
  PED_VARIANTS.forEach((V, i) => sheet(i, V));
  sheet(PLAYER_SHIRT, PLAYER_LOOK, drawPlayer);
  sheet('C', COYOTE_LOOK);
  sheet('R', RATERO_LOOK);
  sheet('T', POLI_LOOK); // el de transito de las escenas de trafico
  makeAros(scene);
}
// aros de los lugares y de los destinos (ver crearAro): cuatro capas en blanco que se tiñen del color del aro,
// de ARO x ARO unidades a SPR veces la resolucion. Las orillas oscuras no se tiñen y lo separan del piso.
const ARO = 128;
function makeAros(scene) {
  const capa = (k, fn) => { const t = scene.textures.createCanvas(k, ARO * SPR, ARO * SPR), x = t.getContext(); x.scale(SPR, SPR); x.translate(ARO / 2, ARO / 2); fn(x); t.refresh(); };
  const arco = (x, r, w, col, a0 = 0, a1 = 7) => { x.strokeStyle = col; x.lineWidth = w; x.beginPath(); x.arc(0, 0, r, a0, a1); x.stroke(); };
  // la luz en el piso: un disco suave, mas fuerte en la orilla del aro
  capa('aroLuz', (x) => {
    const g = x.createRadialGradient(0, 0, 0, 0, 0, 60);
    g.addColorStop(0, 'rgba(255,255,255,0.10)'); g.addColorStop(0.75, 'rgba(255,255,255,0.28)'); g.addColorStop(0.88, 'rgba(255,255,255,0.18)'); g.addColorStop(1, 'rgba(255,255,255,0)');
    x.fillStyle = g; x.beginPath(); x.arc(0, 0, 60, 0, 7); x.fill();
  });
  // el aro: grueso, con orilla oscura y una linea delgada por dentro
  capa('aroBase', (x) => {
    arco(x, 50, 11, 'rgba(0,0,0,0.45)'); arco(x, 50, 6.5, '#fff');
    arco(x, 50, 1.6, 'rgba(255,255,255,0.9)'); // brillo
    arco(x, 41, 3.2, 'rgba(0,0,0,0.3)'); arco(x, 41, 1.6, 'rgba(255,255,255,0.75)');
    // cuatro marcas hacia el centro
    x.lineCap = 'round';
    for (let i = 0; i < 4; i++) {
      const a = i * Math.PI / 2 + Math.PI / 4, c = Math.cos(a), sn = Math.sin(a);
      x.strokeStyle = 'rgba(0,0,0,0.45)'; x.lineWidth = 6; x.beginPath(); x.moveTo(c * 34, sn * 34); x.lineTo(c * 27, sn * 27); x.stroke();
      x.strokeStyle = '#fff'; x.lineWidth = 3; x.stroke();
    }
  });
  // por fuera, un anillo de rayitas que gira
  capa('aroGiro', (x) => {
    x.lineCap = 'round';
    for (let i = 0; i < 16; i++) { const a = i / 16 * Math.PI * 2; arco(x, 59, 5, 'rgba(0,0,0,0.35)', a, a + 0.22); arco(x, 59, 2.6, '#fff', a, a + 0.22); }
  });
  // la onda que sale del aro y se desvanece
  capa('aroOnda', (x) => { arco(x, 58, 3, 'rgba(255,255,255,0.9)'); arco(x, 58, 7, 'rgba(255,255,255,0.25)'); });
  // el pin que flota sobre los destinos (y su sombra en el piso, que no se tine)
  const pin = (x) => { x.beginPath(); x.moveTo(0, 26); x.bezierCurveTo(-6, 14, -20, 4, -20, -12); x.arc(0, -12, 20, Math.PI, 0); x.bezierCurveTo(20, 4, 6, 14, 0, 26); x.closePath(); };
  capa('aroPin', (x) => {
    pin(x); x.fillStyle = '#fff'; x.fill(); x.lineWidth = 4; x.strokeStyle = 'rgba(0,0,0,0.55)'; x.stroke();
    x.fillStyle = 'rgba(0,0,0,0.18)'; x.beginPath(); x.arc(5, -8, 18, 0, 7); x.save(); pin(x); x.clip(); x.fill(); x.restore(); // sombreado
    x.fillStyle = 'rgba(255,255,255,0.85)'; x.beginPath(); x.ellipse(-7, -19, 5, 3, -0.6, 0, 7); x.fill(); // brillo
    x.fillStyle = 'rgba(0,0,0,0.5)'; x.beginPath(); x.arc(0, -12, 7.5, 0, 7); x.fill();
    x.fillStyle = '#fff'; x.beginPath(); x.arc(0, -12, 5.5, 0, 7); x.fill();
  });
  capa('aroSombra', (x) => { const g = x.createRadialGradient(0, 0, 0, 0, 0, 14); g.addColorStop(0, 'rgba(0,0,0,0.45)'); g.addColorStop(1, 'rgba(0,0,0,0)'); x.fillStyle = g; x.beginPath(); x.ellipse(0, 0, 14, 7, 0, 0, 7); x.fill(); });
}
const PLAYER_SHIRT = 'P'; // textura 'pedP' y animacion 'walkP'
// el jugador: camisa amarilla, pantalon de mezclilla y gorra roja (como siempre)
// el coyote: un señor flaco, todo de oscuro y con gorra negra; se pierde entre la gente (ver ofrecerCoyote)
// el ratero: sudadera guinda con gorro de estambre negro; anda por las banquetas esperando que alguien se pare
const POLI_LOOK = { female: false, age: 'adulto', build: 'normal', skin: '#a8714a', shirt: '#1b2a4a', pants: '#141d33', hair: 'corto', hairCol: '#111', hat: 'gorra', hatCol: '#0d1830', k: 1 };
const RATERO_LOOK = { female: false, age: 'joven', build: 'delgado', skin: '#b07a50', shirt: '#6d1f2f', pants: '#2b2b2b', hair: 'corto', hairCol: '#111', hat: 'gorro', hatCol: '#1a1a1a', k: 1 };
const COYOTE_LOOK = { female: false, age: 'adulto', build: 'delgado', skin: '#a8714a', shirt: '#2b2b2b', pants: '#1f2a38', hair: 'corto', hairCol: '#111', hat: 'gorra', hatCol: '#151515', k: 1 };
const PLAYER_LOOK = { female: false, age: 'adulto', build: 'normal', skin: '#c68e5f', shirt: '#ffd23f', pants: '#1d3f8f', hair: 'corto', hairCol: '#111', hat: 'gorra', hatCol: '#c0392b', k: 1 };
// taxi libre clasico de Tijuana: guayin roja con franjas negras y crema.
// Se dibuja a SPR veces la resolucion y el sprite va a escala 1 / SPR.
// moto de repartidor (scooter) vista desde arriba mirando a la derecha, con su caja termica; una textura por
// color ('moto0'...), a SPR veces la resolucion
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
// perros callejeros de varias razas, vistos desde arriba mirando a la derecha; cuatro cuadros de caminata
// (patas cruzadas y la cola de un lado a otro). Textura 'perro<i>' y animacion 'perroAnda<i>'
const RAZAS = [
  { body: '#c58747', dark: '#a86b33', ear: '#7a4520', pata: '#8a5426', paliacate: '#c62828', k: 1 },
  { body: '#2b2b2b', dark: '#1c1c1c', ear: '#111', pata: '#1a1a1a', pecho: '#d9d9d9', k: 1 },
  { body: '#f2f2f2', dark: '#e2e2e2', ear: '#3a3a3a', pata: '#d0d0d0', manchas: '#3a3a3a', k: 1 },
  { body: '#e8c08a', dark: '#d4a66a', ear: '#c99a5e', pata: '#c99a5e', orejotas: true, k: 0.62 },
  { body: '#7d7f86', dark: '#66686e', ear: '#55575c', pata: '#5b5d63', collar: '#1e88e5', ancho: true, k: 1.1 },
  { body: '#8d6e4c', dark: '#6d5236', ear: '#5d4030', pata: '#5d4030', peludo: true, k: 1 },
];
function makePerros(scene) {
  const FW = 24, FH = 16;
  RAZAS.forEach((D, i) => {
    const t = scene.textures.createCanvas('perro' + i, FW * 4 * SPR, FH * SPR), x = t.getContext();
    for (let f = 0; f < 4; f++) {
      const ph = [1, 0, -1, 0][f], cola = [1, 0.3, -1, -0.3][f], W = D.ancho ? 1.2 : 1;
      x.save(); x.scale(SPR, SPR); x.translate(f * FW + 11, FH / 2); x.scale(D.k, D.k);
      const ell = (c, ex, ey, rx, ry, a) => { x.fillStyle = c; x.beginPath(); x.ellipse(ex, ey, rx, ry, a || 0, 0, 7); x.fill(); };
      ell('rgba(0,0,0,0.25)', 1, 1, 8, 4.2 * W);
      x.strokeStyle = D.dark; x.lineWidth = D.peludo ? 2.4 : 1.6; x.lineCap = 'round';
      x.beginPath(); x.moveTo(-6, 0); x.quadraticCurveTo(-8.5, cola * 2.5, -9.5, cola * 4); x.stroke();
      // patas: la delantera de un lado va con la trasera del otro
      for (const [px, py, s] of [[-4, -3.3, 1], [-4, 3.3, -1], [3, -3.1, -1], [3, 3.1, 1]]) ell(D.pata, px + ph * s * 1.3, py * W, 1.4, 1, 0);
      ell(D.body, -0.5, 0, 6.5, 3.4 * W);
      if (D.peludo) { x.strokeStyle = D.dark; x.lineWidth = 0.5; x.beginPath(); for (let a = 0; a < 6.3; a += 0.45) { const ex = -0.5 + Math.cos(a) * 6.3, ey = Math.sin(a) * 3.3 * W; x.moveTo(ex, ey); x.lineTo(ex + Math.cos(a) * 0.9, ey + Math.sin(a) * 0.9); } x.stroke(); }
      ell(D.dark, -1.5, 0, 4, 1.4 * W);
      if (D.manchas) for (const [mx, my, r] of [[-3, -1.5, 1.3], [1, 1.6, 1.1], [-0.8, -0.2, 0.9], [3, -1.2, 0.8]]) ell(D.manchas, mx, my, r, r * 0.8);
      if (D.pecho) ell(D.pecho, 4.3, 0, 1, 1.8);
      if (D.paliacate) { ell(D.paliacate, 5, 0, 1.5, 3); x.fillStyle = '#fff'; for (const py of [-1.6, 0, 1.6]) x.fillRect(4.7, py - 0.3, 0.6, 0.6); }
      if (D.collar) { ell(D.collar, 5, 0, 0.8, 2.9 * W); ell('#fdd835', 5.6, 0, 0.5, 0.5); }
      ell(D.body, 7.5, 0, 2.8, 2.5 * (D.ancho ? 1.1 : 1));
      if (D.orejotas) { ell(D.ear, 6.4, -3, 2.2, 1.3, -0.7); ell(D.ear, 6.4, 3, 2.2, 1.3, 0.7); ell('#f3b8a8', 6.4, -3, 1.2, 0.6, -0.7); ell('#f3b8a8', 6.4, 3, 1.2, 0.6, 0.7); }
      else { ell(D.ear, 6.6, -2.4, 1.5, 0.9, -0.5); ell(D.ear, 6.6, 2.4, 1.5, 0.9, 0.5); }
      ell(D.ancho ? D.dark : D.body, 9.6, 0, 1.4, 1.5); // hocico
      x.fillStyle = '#1a1a1a'; x.beginPath(); x.arc(10.4, 0, 0.8, 0, 7); x.fill();
      x.restore();
      t.add(f, 0, f * FW * SPR, 0, FW * SPR, FH * SPR);
    }
    t.refresh();
    scene.anims.create({ key: 'perroAnda' + i, frames: [0, 1, 2, 3].map(f => ({ key: 'perro' + i, frame: f })), frameRate: 10, repeat: -1 });
  });
}
// gatos de azotea vistos desde arriba mirando a la derecha: tres cuadros sentado (la cola de un lado a otro)
// y uno echado, hecho bolita. Textura 'gato<i>' y animacion 'gatoCola<i>'
const PELAJES = [
  { body: '#e08a3c', dark: '#b8642a', rayas: true },                          // naranja atigrado
  { body: '#2a2a2a', dark: '#141414', oreja: '#3a2a2a' },                       // negro
  { body: '#8c8f95', dark: '#5f6268', rayas: true },                          // gris atigrado
  { body: '#f2f2f0', dark: '#dcdcd8', manchas: ['#2a2a2a'] },                 // blanco con manchas
  { body: '#f3ece0', dark: '#ddd2c0', manchas: ['#d9822b', '#2a2a2a'] },      // calico
  { body: '#e9dcc6', dark: '#d3c2a6', punta: '#5a4232' },                     // siames
];
function makeGatos(scene) {
  const FW = 20, FH = 18;
  PELAJES.forEach((D, i) => {
    const t = scene.textures.createCanvas('gato' + i, FW * 4 * SPR, FH * SPR), x = t.getContext();
    for (let f = 0; f < 4; f++) {
      x.save(); x.scale(SPR, SPR); x.translate(f * FW + 9, FH / 2);
      const ell = (c, ex, ey, rx, ry, a) => { x.fillStyle = c; x.beginPath(); x.ellipse(ex, ey, rx, ry, a || 0, 0, 7); x.fill(); };
      const oreja = (s) => { x.fillStyle = D.punta || D.oreja || D.body; x.beginPath(); x.moveTo(4.6, s * 1.2); x.lineTo(6.6, s * 3.3); x.lineTo(6.9, s * 0.7); x.closePath(); x.fill();
        x.fillStyle = '#e8a3a0'; x.beginPath(); x.moveTo(5.3, s * 1.4); x.lineTo(6.4, s * 2.6); x.lineTo(6.5, s * 1.1); x.closePath(); x.fill(); };
      const manchas = (pts) => { if (D.manchas) pts.forEach(([mx, my, r], j) => ell(D.manchas[j % D.manchas.length], mx, my, r, r * 0.8)); };
      x.strokeStyle = D.body; x.lineCap = 'round';
      if (f < 3) {
        ell('rgba(0,0,0,0.25)', 0.8, 0.8, 5.6, 4.4);
        // la cola sale de atras y se enrosca por un lado; la punta va y viene
        const c = [1, 0, -1][f];
        x.lineWidth = 1.5; x.beginPath(); x.moveTo(-4, 0.5); x.quadraticCurveTo(-6, 4.5, -2 + c * 1.2, 5.2 + c * 0.6); x.stroke();
        if (D.punta) { x.strokeStyle = D.punta; x.beginPath(); x.moveTo(-3 + c * 1.2, 5.3 + c * 0.6); x.lineTo(-2 + c * 1.2, 5.2 + c * 0.6); x.stroke(); }
        ell(D.body, -1, 0, 4.4, 3.8);                 // ancas
        ell(D.dark, -1.5, 0, 2.8, 1);                 // lomo
        if (D.rayas) { x.strokeStyle = D.dark; x.lineWidth = 0.6; for (const rx of [-3.2, -1.6, 0]) { x.beginPath(); x.moveTo(rx, -3); x.quadraticCurveTo(rx + 0.8, 0, rx, 3); x.stroke(); } }
        manchas([[-2.5, -1.8, 1.4], [0.2, 1.6, 1.1]]);
        ell(D.body, 2.6, 0, 2.4, 2.4);                 // pecho
        ell(D.punta || D.body, 3.9, -1.1, 0.8, 0.6); ell(D.punta || D.body, 3.9, 1.1, 0.8, 0.6); // patitas
        oreja(-1); oreja(1);
        ell(D.body, 5, 0, 2.3, 2.5);                   // cabeza
        if (D.rayas) { x.strokeStyle = D.dark; x.lineWidth = 0.5; for (const ry of [-0.7, 0.7]) { x.beginPath(); x.moveTo(4, ry); x.lineTo(5.8, ry * 0.6); x.stroke(); } }
        if (D.manchas) ell(D.manchas[0], 5.3, -1, 1, 0.9);
        if (D.punta) ell(D.punta, 6.3, 0, 1, 1.3);
      } else {
        // echado, hecho bolita, con la cola por fuera y la cabeza metida
        ell('rgba(0,0,0,0.25)', 0.8, 0.8, 5, 4.6);
        x.lineWidth = 1.5; x.beginPath(); x.arc(0, 0, 4.6, 0.4, 2.6); x.stroke();
        ell(D.body, 0, 0, 4.4, 4);
        ell(D.dark, -0.8, -0.5, 2.6, 1.6, -0.6);
        if (D.rayas) { x.strokeStyle = D.dark; x.lineWidth = 0.6; for (const a of [-2.4, -1.8, -1.2]) { x.beginPath(); x.moveTo(Math.cos(a) * 2, Math.sin(a) * 2); x.lineTo(Math.cos(a) * 4.2, Math.sin(a) * 3.8); x.stroke(); } }
        manchas([[-2, 1.4, 1.3], [1.2, -2, 1]]);
        oreja(1); ell(D.body, 2.8, 1.4, 2.1, 2, 0.4);
        if (D.punta) ell(D.punta, 3.6, 1.8, 1, 1.1);
      }
      x.restore();
      t.add(f, 0, f * FW * SPR, 0, FW * SPR, FH * SPR);
    }
    t.refresh();
    scene.anims.create({ key: 'gatoCola' + i, frames: [0, 1, 2, 1].map(f => ({ key: 'gato' + i, frame: f })), frameRate: 2.5, repeat: -1 });
  });
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
// colores de la caja y la chamarra (sin logos de ninguna aplicacion): [principal, oscuro, claro]
const MOTO_COLS = [['#1e8f4e', '#0d4a28', '#5cc98a'], ['#ef7d1a', '#8a4208', '#ffb366'], ['#c62828', '#6d1010', '#ef6a6a'], ['#1f6fc0', '#0d3a6b', '#6aaef0']];
function makeMoto(scene) {
  MOTO_COLS.forEach(([col, osc, clr], i) => {
    const t = scene.textures.createCanvas('moto' + i, 26 * SPR, 14 * SPR), x = t.getContext();
    x.scale(SPR, SPR);
    const rr = (px, py, w, h, r, fill) => { x.fillStyle = fill; x.beginPath(); x.roundRect(px, py, w, h, r); x.fill(); };
    x.fillStyle = 'rgba(0,0,0,0.3)'; x.beginPath(); x.ellipse(14, 8.6, 11.5, 4.6, 0, 0, 7); x.fill();
    // llantas con dibujo y salpicadera de adelante
    for (const [px, w] of [[2.2, 5.6], [20.4, 5.3]]) {
      rr(px, 5.6, w, 2.8, 1.3, '#151515');
      x.strokeStyle = '#3a3a3a'; x.lineWidth = 0.35; x.beginPath();
      for (let q = px + 0.8; q < px + w - 0.4; q += 0.9) { x.moveTo(q, 5.8); x.lineTo(q, 8.2); } x.stroke();
    }
    rr(19.4, 5.8, 3.8, 2.4, 1, col); rr(19.8, 6.2, 2.8, 0.6, 0.3, clr);
    // escape cromado a la derecha, de atras
    rr(4.2, 9.3, 7.2, 1.5, 0.75, '#8d9399'); rr(4.6, 9.5, 6.4, 0.5, 0.25, '#d6dadf'); x.fillStyle = '#333'; x.beginPath(); x.arc(4.6, 10.05, 0.45, 0, 7); x.fill();
    // cuerpo de scooter: piso para los pies y el frente
    x.fillStyle = '#2b2d31'; x.beginPath(); x.moveTo(8, 4.6); x.lineTo(16, 4.4); x.quadraticCurveTo(19.5, 4.6, 20.4, 7); x.quadraticCurveTo(19.5, 9.4, 16, 9.6); x.lineTo(8, 9.4); x.closePath(); x.fill();
    x.fillStyle = '#44474d'; x.beginPath(); x.moveTo(9, 5.2); x.lineTo(16, 5.1); x.quadraticCurveTo(18.6, 5.4, 19.2, 7); x.lineTo(9, 7); x.closePath(); x.fill();
    x.fillStyle = col; x.beginPath(); x.moveTo(16.6, 4.6); x.quadraticCurveTo(20, 5, 20.9, 7); x.quadraticCurveTo(20, 9, 16.6, 9.4); x.quadraticCurveTo(18, 7, 16.6, 4.6); x.fill();
    // manubrio con puños, espejos y el faro
    x.strokeStyle = '#1a1a1a'; x.lineWidth = 0.9; x.lineCap = 'round'; x.beginPath(); x.moveTo(18.6, 2.4); x.quadraticCurveTo(19.6, 7, 18.6, 11.6); x.stroke();
    x.fillStyle = '#0d0d0d'; x.fillRect(17.6, 1.6, 1.8, 1.3); x.fillRect(17.6, 11.1, 1.8, 1.3);
    x.strokeStyle = '#777'; x.lineWidth = 0.35; x.beginPath(); x.moveTo(19, 3.4); x.lineTo(20.2, 1.4); x.moveTo(19, 10.6); x.lineTo(20.2, 12.6); x.stroke();
    for (const py of [1.1, 12.9]) { x.fillStyle = '#222'; x.beginPath(); x.ellipse(20.4, py, 0.9, 0.7, 0, 0, 7); x.fill(); x.fillStyle = '#9fc3d8'; x.beginPath(); x.ellipse(20.5, py, 0.55, 0.4, 0, 0, 7); x.fill(); }
    x.fillStyle = '#fff6b0'; x.beginPath(); x.ellipse(20.5, 7, 0.7, 1.4, 0, 0, 7); x.fill(); x.fillStyle = '#ffffff'; x.beginPath(); x.ellipse(20.7, 6.6, 0.3, 0.45, 0, 0, 7); x.fill();
    // caja termica atras: sombra, costados, tapa con ribete, franja reflejante y un dibujito de bolsa de comida
    x.fillStyle = 'rgba(0,0,0,0.35)'; x.fillRect(1.6, 2.6, 8.6, 9.6);
    rr(0.6, 1.4, 8.8, 11.2, 0.9, osc);
    rr(1.1, 1.9, 7.8, 10.2, 0.7, col);
    x.fillStyle = clr; x.fillRect(1.1, 1.9, 7.8, 0.7); x.fillRect(1.1, 1.9, 0.6, 10.2);
    x.strokeStyle = osc; x.lineWidth = 0.4; x.strokeRect(2, 2.8, 6, 8.4);
    x.fillStyle = 'rgba(235,240,245,0.9)'; x.fillRect(1.1, 10.4, 7.8, 0.8);
    x.fillStyle = '#f5f5f5'; x.beginPath(); x.roundRect(3.3, 5, 3.4, 3.4, 0.5); x.fill();
    x.strokeStyle = osc; x.lineWidth = 0.4; x.beginPath(); x.arc(5, 5.8, 0.9, Math.PI, 0); x.stroke(); x.strokeRect(3.9, 5.8, 2.2, 2.1);
    // calavera roja
    x.fillStyle = '#e53935'; x.fillRect(0.1, 5.6, 0.6, 2.8);
    // repartidor: espalda con la chamarra (con franja reflejante), brazos al manubrio con guantes y casco con mica
    x.fillStyle = 'rgba(0,0,0,0.3)'; x.beginPath(); x.ellipse(13.6, 7.6, 3, 4.4, 0, 0, 7); x.fill();
    x.strokeStyle = osc; x.lineWidth = 1.7; x.beginPath(); x.moveTo(13.2, 3.4); x.quadraticCurveTo(16, 2.2, 17.8, 2.3); x.moveTo(13.2, 10.6); x.quadraticCurveTo(16, 11.8, 17.8, 11.7); x.stroke();
    x.strokeStyle = col; x.lineWidth = 1.2; x.beginPath(); x.moveTo(13.2, 3.4); x.quadraticCurveTo(16, 2.2, 17.4, 2.3); x.moveTo(13.2, 10.6); x.quadraticCurveTo(16, 11.8, 17.4, 11.7); x.stroke();
    x.fillStyle = '#1b1b1b'; x.beginPath(); x.arc(17.9, 2.3, 0.75, 0, 7); x.arc(17.9, 11.7, 0.75, 0, 7); x.fill();
    x.fillStyle = osc; x.beginPath(); x.ellipse(12.8, 7, 2.9, 4.5, 0, 0, 7); x.fill();
    x.fillStyle = col; x.beginPath(); x.ellipse(12.9, 7, 2.5, 4.1, 0, 0, 7); x.fill();
    x.fillStyle = 'rgba(235,240,245,0.85)'; x.fillRect(11.2, 3.2, 0.7, 7.6);
    x.fillStyle = '#e9ecef'; x.beginPath(); x.arc(14.2, 7, 2.5, 0, 7); x.fill();
    x.fillStyle = '#ffffff'; x.beginPath(); x.arc(13.6, 6.3, 1.1, 0, 7); x.fill();
    x.fillStyle = col; x.fillRect(11.8, 6.55, 3.4, 0.9);
    x.fillStyle = '#1d2733'; x.beginPath(); x.moveTo(15.4, 5.3); x.quadraticCurveTo(17.2, 7, 15.4, 8.7); x.quadraticCurveTo(16.2, 7, 15.4, 5.3); x.fill();
    x.strokeStyle = '#9aa3ab'; x.lineWidth = 0.3; x.beginPath(); x.arc(14.2, 7, 2.5, 0, 7); x.stroke();
    t.refresh();
  });
}
// moto deportiva vista desde arriba mirando a la derecha: carenado de color con franja, piloto agachado de
// chamarra negra y casco; una textura por color ('deportiva0'...), a SPR veces la resolucion
function makeDeportiva(scene) {
  DEPORTIVA_COLS.forEach(([col, raya], i) => {
    const t = scene.textures.createCanvas('deportiva' + i, 28 * SPR, 14 * SPR), x = t.getContext();
    x.scale(SPR, SPR);
    x.fillStyle = 'rgba(0,0,0,0.3)'; x.beginPath(); x.ellipse(15, 8.4, 12, 3.6, 0, 0, 7); x.fill();
    // llantas anchas (la de atras mas gruesa) y el escape
    x.fillStyle = '#111'; x.beginPath(); x.roundRect(1.5, 5.4, 6.5, 3.2, 1.2); x.fill(); x.beginPath(); x.roundRect(20.5, 5.7, 5.5, 2.6, 1.1); x.fill();
    x.fillStyle = '#9aa0a6'; x.beginPath(); x.roundRect(3, 8.6, 6, 1.6, 0.8); x.fill();
    // carenado: angosto atras, ancho en el tanque y en punta adelante
    x.fillStyle = shade(col, 0.6); x.beginPath(); x.moveTo(3, 7); x.lineTo(9, 4.3); x.lineTo(17, 3.6); x.lineTo(24, 5.4); x.lineTo(26.2, 7);
    x.lineTo(24, 8.6); x.lineTo(17, 10.4); x.lineTo(9, 9.7); x.closePath(); x.fill();
    x.fillStyle = col; x.beginPath(); x.moveTo(3.6, 7); x.lineTo(9, 4.8); x.lineTo(17, 4.2); x.lineTo(23.5, 5.7); x.lineTo(25.4, 7);
    x.lineTo(23.5, 8.3); x.lineTo(17, 9.8); x.lineTo(9, 9.2); x.closePath(); x.fill();
    x.fillStyle = raya; x.fillRect(4, 6.4, 21, 1.2);
    // parabrisas ahumado y faro
    x.fillStyle = 'rgba(29,39,51,0.85)'; x.beginPath(); x.moveTo(19.5, 4.8); x.lineTo(23, 5.8); x.lineTo(23, 8.2); x.lineTo(19.5, 9.2); x.closePath(); x.fill();
    x.fillStyle = '#fff6b0'; x.fillRect(25, 6.2, 1.2, 1.6);
    x.fillStyle = '#ff3b30'; x.fillRect(2.6, 6.3, 1, 1.4);
    // piloto agachado: espalda, brazos a los semimanubrios y casco con visera
    x.fillStyle = '#1b1b1f'; x.beginPath(); x.ellipse(12.5, 7, 3.6, 3.3, 0, 0, 7); x.fill();
    x.strokeStyle = '#1b1b1f'; x.lineWidth = 1.4; x.beginPath(); x.moveTo(13.5, 4.4); x.lineTo(18.6, 4.3); x.moveTo(13.5, 9.6); x.lineTo(18.6, 9.7); x.stroke();
    x.fillStyle = raya; x.fillRect(10, 6.5, 4, 1);
    x.fillStyle = col; x.beginPath(); x.arc(16.2, 7, 2.5, 0, 7); x.fill();
    x.fillStyle = '#1d2733'; x.beginPath(); x.arc(16.9, 7, 1.8, -1.1, 1.1); x.fill();
    x.fillStyle = 'rgba(255,255,255,0.5)'; x.beginPath(); x.arc(15.5, 6, 0.7, 0, 7); x.fill();
    t.refresh();
  });
}
// escoltas privadas: camionetas negras polarizadas con torreta ambar y blanca (no son policias); andan en
// pares, la de atras sigue a la de adelante, y van un poco mas rapido que el trafico. Dos texturas para el destello.
const VT_ESCOLTA = { name: 'Camioneta de escolta', L: 36, W: 17, top: 245, acc: 125, steer: 2.4, hp: 150 };
function makeEscolta(scene) {
  const L = VT_ESCOLTA.L, W = VT_ESCOLTA.W;
  for (const f of [0, 1]) {
    const t = scene.textures.createCanvas('escolta' + f, (L + 5) * SPR, (W + 5) * SPR), x = t.getContext();
    x.scale(SPR, SPR); x.translate(1, 1);
    drawVehicle(x, 3, '#16181b', false);
    // brillo del negro sobre el cofre y el techo
    x.fillStyle = 'rgba(255,255,255,0.1)'; x.fillRect(27, 3, 7, 1.6); x.fillRect(8, 3.6, 12, 1.4);
    // barra de luces delgada sobre el parabrisas: ambar y blanco, alternando
    x.fillStyle = '#0c0c0c'; x.fillRect(21.6, 2.2, 2.2, W - 4.4);
    const a = f === 0;
    x.fillStyle = a ? '#ffb300' : '#6b4a00'; x.fillRect(21.9, 2.5, 1.6, W / 2 - 2.7);
    x.fillStyle = a ? '#5a5a5a' : '#ffffff'; x.fillRect(21.9, W / 2 + 0.2, 1.6, W / 2 - 2.7);
    x.fillStyle = a ? 'rgba(255,179,0,0.35)' : 'rgba(255,255,255,0.35)';
    x.beginPath(); x.arc(22.7, a ? 4.5 : W - 4.5, 4.2, 0, 7); x.fill();
    // destellos en la parrilla
    x.fillStyle = a ? '#ffffff' : '#ffb300'; x.fillRect(L - 1.2, W / 2 - 3, 1.2, 1.6); x.fillRect(L - 1.2, W / 2 + 1.4, 1.2, 1.6);
    t.refresh();
  }
}
// camion urbano de ruta: largo, blanco con franjas del color de su ruta, letrero de ruta encendido al frente y el
// aire acondicionado en el techo. Los choferes van a todo lo que da, se cambian de carril y no frenan por nadie.
const VT_URBANO = { name: 'Camión urbano', L: 58, W: 20, top: 190, acc: 80, steer: 1.7, hp: 230 };
const URBANO_COLS = ['#1565c0', '#2e7d32', '#e65100'];
function makeUrbano(scene) {
  const { L, W } = VT_URBANO;
  URBANO_COLS.forEach((col, k) => {
    const t = scene.textures.createCanvas('urbano' + k, (L + 5) * SPR, (W + 5) * SPR), x = t.getContext();
    x.scale(SPR, SPR); x.translate(1, 1);
    const rr = (X, Y, w, h, r, f) => { x.fillStyle = f; x.beginPath(); x.roundRect(X, Y, w, h, r); x.fill(); };
    x.fillStyle = 'rgba(0,0,0,0.35)'; x.beginPath(); x.roundRect(2, 2, L, W, 3); x.fill();
    rr(0, 0, L, W, 3, '#f1efe8');
    // franjas de la ruta a los costados, con la punta inclinada hacia el frente
    x.fillStyle = col; x.fillRect(1, 0.3, L - 8, 2); x.fillRect(1, W - 2.3, L - 8, 2);
    x.beginPath(); x.moveTo(L - 7, 0.3); x.lineTo(L - 3, 0.3); x.lineTo(L - 7, 2.3); x.fill();
    x.beginPath(); x.moveTo(L - 7, W - 0.3); x.lineTo(L - 3, W - 0.3); x.lineTo(L - 7, W - 2.3); x.fill();
    // ventanillas asomando por las orillas del techo
    x.fillStyle = GLASS; for (let i = 0; i < 9; i++) { x.fillRect(5 + i * 5.4, 2.3, 4.4, 1); x.fillRect(5 + i * 5.4, W - 3.3, 4.4, 1); }
    // techo con el aire acondicionado y dos escotillas
    rr(4, 3.6, L - 12, W - 7.2, 1.5, '#e2dfd5');
    rr(22, 5, 14, W - 10, 1.2, '#c9c5b8');
    x.strokeStyle = 'rgba(0,0,0,0.18)'; x.lineWidth = 0.5; x.beginPath(); for (let i = 24; i < 36; i += 2) { x.moveTo(i, 5.6); x.lineTo(i, W - 5.6); } x.stroke();
    x.fillStyle = '#b8b4a7'; x.fillRect(9, W / 2 - 2.2, 4.4, 4.4); x.fillRect(41, W / 2 - 2.2, 4.4, 4.4);
    // parabrisas grande y el letrero de ruta en ambar
    x.fillStyle = GLASS; x.fillRect(L - 4.6, 1.8, 3.4, W - 3.6);
    x.fillStyle = '#1a1a1a'; x.fillRect(L - 7.8, 3.4, 2.6, W - 6.8);
    x.fillStyle = '#ffb300'; for (let i = 0; i < 5; i++) x.fillRect(L - 7.4, 4.4 + i * (W - 9) / 5, 1.8, (W - 9) / 5 - 0.7);
    x.fillStyle = 'rgba(255,255,255,0.25)'; x.fillRect(L - 4, 2.6, 0.9, W - 5.2);
    x.fillStyle = GLASS; x.fillRect(0.6, 3.5, 1.4, W - 7);
    x.fillStyle = '#fff6b0'; x.fillRect(L - 1.6, 1.4, 1.6, 2.8); x.fillRect(L - 1.6, W - 4.2, 1.6, 2.8);
    x.fillStyle = '#ff3b30'; x.fillRect(0, 1.4, 1.3, 2.8); x.fillRect(0, W - 4.2, 1.3, 2.8);
    x.fillStyle = shade(col, 0.6); x.fillRect(L - 4, -1, 1.6, 1.2); x.fillRect(L - 4, W - 0.2, 1.6, 1.2); // espejos
    x.strokeStyle = 'rgba(0,0,0,0.45)'; x.lineWidth = 0.6; x.beginPath(); x.roundRect(0, 0, L, W, 3); x.stroke();
    t.refresh();
  });
}
// bicis y patinetas vistas desde arriba, de frente hacia +x: 'bici_k' sola (estacionada) y 'bici_k_r' con quien la
// maneja (casco, playera y brazos al manubrio; en la patineta, parado de lado). Lienzo 26 x 14 con el centro en (13, 7)
function makeBicis(scene) {
  for (const k in VT_BICI) for (const r of [false, true]) {
    const t = scene.textures.createCanvas('bici_' + k + (r ? '_r' : ''), 26 * SPR, 14 * SPR), x = t.getContext();
    x.scale(SPR, SPR); x.translate(13, 7); x.lineCap = 'round';
    const ln = (c, w, pts) => { x.strokeStyle = c; x.lineWidth = w; x.beginPath(); pts.forEach(([a, b], i) => i ? x.lineTo(a, b) : x.moveTo(a, b)); x.stroke(); };
    const el = (c, cx, cy, rx, ry, a) => { x.fillStyle = c; x.beginPath(); x.ellipse(cx, cy, rx, ry, a || 0, 0, 7); x.fill(); };
    el('rgba(0,0,0,0.28)', 1, 1, k === 'patineta' ? 8.5 : 10.5, r ? 4.4 : 2.4);
    if (k === 'patineta') {
      // tabla con lija negra, puntas levantadas y las cuatro ruedas asomando
      for (const ex of [-5, 5]) for (const ey of [-2.6, 2.6]) el('#f4e04d', ex, ey, 1, 0.7);
      x.fillStyle = '#6d4c41'; x.beginPath(); x.roundRect(-8, -2.4, 16, 4.8, 2.4); x.fill();
      x.fillStyle = '#212121'; x.beginPath(); x.roundRect(-7.2, -1.9, 14.4, 3.8, 1.9); x.fill();
      x.fillStyle = '#e53935'; x.fillRect(-1.5, -1.9, 3, 3.8); // calcomania
      for (let i = 0; i < 4; i++) ln('#9e9e9e', 0.25, [[-5.6 + (i % 2) * 11.2, -1.2], [-5.6 + (i % 2) * 11.2, 1.2]]);
      if (r) { // parado de lado: un pie en cada truck, hombros a lo largo de la tabla y brazos para equilibrar
        el('#1e1e1e', -4.6, 0, 1.6, 1.1); el('#1e1e1e', 4.4, 0.4, 1.6, 1.1, 0.4);
        ln('#2e5c8a', 2.2, [[-4, 0], [-1, 0.6]]); ln('#2e5c8a', 2.2, [[4, 0.3], [1, 0.6]]);
        ln('#d7a07a', 1.1, [[-4.6, -1.6], [-8.2, -3.6]]); ln('#d7a07a', 1.1, [[4.6, -1.6], [8, -0.6]]);
        el('#f57c00', 0, 0, 5, 2.8); el('#ffa040', -0.6, -0.5, 3.6, 1.8);
        el('#3e2723', 0.4, 0, 2.2, 2.2); el('#1565c0', 0.8, 0, 2.3, 2.3); el('#1e88e5', 1.6, 0, 1.2, 2.1); // gorra al frente
      }
    } else {
      const ruta = k === 'ruta', col = ruta ? '#d32f2f' : '#2e7d32', lt = ruta ? '#ff7961' : '#60ad5e';
      // llantas: delgadas las de ruta, gordas y con taquetes las de montaña
      for (const ex of [-6, 6]) {
        x.fillStyle = '#151515'; x.beginPath(); x.roundRect(ex - 3.6, ruta ? -0.55 : -0.95, 7.2, ruta ? 1.1 : 1.9, 0.9); x.fill();
        if (!ruta) for (let q = -3; q <= 3; q += 1) el('#3a3a3a', ex + q, 0, 0.2, 1.1);
      }
      ln(col, 1.1, [[-6, 0], [-1.6, 0], [3.6, 0], [6, 0]]); ln(lt, 0.4, [[-5, -0.2], [3.4, -0.2]]); // cuadro
      if (!ruta) { ln('#757575', 0.9, [[4.2, -0.9], [6, -0.9]]); ln('#757575', 0.9, [[4.2, 0.9], [6, 0.9]]); } // suspension
      el('#212121', -1.8, 0, 1.6, 0.8); // asiento
      if (ruta) { ln('#212121', 0.8, [[3.4, -2.6], [4.4, -2.8], [5, -2.2]]); ln('#212121', 0.8, [[3.4, 2.6], [4.4, 2.8], [5, 2.2]]); ln('#424242', 0.8, [[3.6, -2.6], [3.6, 2.6]]); }
      else { ln('#424242', 0.8, [[3.8, -4], [3.8, 4]]); el('#111', 3.8, -4, 0.6, 0.9); el('#111', 3.8, 4, 0.6, 0.9); }
      el('#9e9e9e', 0.6, 0.7, 0.9, 0.9); // pedales
      if (r) { // ciclista: piernas a los pedales, espalda, brazos al manubrio y casco
        ln('#263238', 1.4, [[-1.4, -1.4], [0.8, -1.6]]); ln('#263238', 1.4, [[-1.4, 1.4], [0.2, 1.8]]);
        const bx = ruta ? 3.6 : 3.8, by = ruta ? 2.6 : 3.6;
        ln('#d7a07a', 1.1, [[-0.4, -2.4], [bx, -by]]); ln('#d7a07a', 1.1, [[-0.4, 2.4], [bx, by]]);
        el(ruta ? '#fdd835' : '#5d4037', -1.4, 0, 2.6, 3.4); // jersey o mochila
        if (ruta) ln('#1e88e5', 0.6, [[-3.6, 0], [0.8, 0]]);
        el('#d7a07a', 0.9, 0, 1.6, 1.6);
        el(ruta ? '#ffffff' : '#ff6f00', 0.8, 0, 2, 1.8); // casco
        for (const v of [-0.9, 0, 0.9]) ln(ruta ? '#9e9e9e' : '#bf360c', 0.3, [[-0.6, v], [2.2, v]]);
      }
    }
    t.refresh();
  }
}
// pipa de gas LP: cabina roja adelante y el tanque blanco (un cilindro visto desde arriba) con su franja y el
// letrero de GAS; va despacio vendiendo por las colonias. Dos golpes y explota (ver golpeGas).
const VT_GAS = { name: 'Pipa de gas', L: 50, W: 19, top: 165, acc: 70, steer: 1.9, hp: 210 };
function makePipaGas(scene) {
  const { L, W } = VT_GAS, t = scene.textures.createCanvas('pipa', (L + 5) * SPR, (W + 5) * SPR), x = t.getContext();
  x.scale(SPR, SPR); x.translate(1, 1);
  const rr = (X, Y, w, h, r, f) => { x.fillStyle = f; x.beginPath(); x.roundRect(X, Y, w, h, r); x.fill(); };
  x.fillStyle = 'rgba(0,0,0,0.35)'; x.beginPath(); x.roundRect(2, 2, L, W, 4); x.fill();
  rr(0.5, 1, 37, W - 2, 1.5, '#4a4a4a'); // chasis
  // tanque: degradado de lado a lado para que se vea redondo, con las tapas en las puntas
  const g = x.createLinearGradient(0, 0.5, 0, W - 0.5);
  g.addColorStop(0, '#9e9e9e'); g.addColorStop(0.3, '#ffffff'); g.addColorStop(0.55, '#f2f2f2'); g.addColorStop(1, '#8c8c8c');
  x.fillStyle = g; x.beginPath(); x.roundRect(0, 0.5, 36, W - 1, (W - 1) / 2); x.fill();
  x.strokeStyle = 'rgba(0,0,0,0.35)'; x.lineWidth = 0.5; x.stroke();
  x.fillStyle = '#1e5aa8'; x.fillRect(6, 0.8, 24, 2.2); x.fillRect(6, W - 3, 24, 2.2); // franja azul a los costados
  x.fillStyle = '#c62828'; x.fillRect(6, 3, 24, 0.8); x.fillRect(6, W - 3.8, 24, 0.8);
  // letrero de GAS sobre el tanque, la escotilla y las valvulas de atras
  x.save(); x.translate(17, W / 2); x.fillStyle = '#c62828'; x.font = 'bold 6.2px sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle';
  x.fillText('GAS', 0, 0.3); x.restore();
  x.fillStyle = '#b0b0b0'; x.beginPath(); x.arc(30.5, W / 2, 2.2, 0, 7); x.fill(); x.strokeStyle = '#666'; x.lineWidth = 0.5; x.stroke();
  x.fillStyle = '#d4a017'; x.fillRect(1.2, W / 2 - 1.5, 2.6, 3);
  x.fillStyle = '#2b2b2b'; x.beginPath(); x.arc(4.5, W - 3.2, 1.8, 0, 7); x.fill(); // carrete de la manguera
  // cabina roja con parabrisas, espejos y faros
  rr(37.5, 0.3, L - 37.5, W - 0.6, 3, '#c62828');
  rr(38.5, 2, 5.5, W - 4, 1, '#a51f1f');
  x.fillStyle = GLASS; x.fillRect(44.2, 2, 3, W - 4);
  x.fillStyle = 'rgba(255,255,255,0.2)'; x.fillRect(44.8, 2.8, 0.8, W - 5.6);
  x.fillStyle = '#7a1414'; x.fillRect(43, -1, 1.6, 1.2); x.fillRect(43, W - 0.2, 1.6, 1.2);
  x.fillStyle = '#fff6b0'; x.fillRect(L - 1.6, 1.6, 1.6, 2.6); x.fillRect(L - 1.6, W - 4.2, 1.6, 2.6);
  x.fillStyle = '#ff3b30'; x.fillRect(0, 2, 1.2, 2.4); x.fillRect(0, W - 4.4, 1.2, 2.4);
  t.refresh();
}
// el carro del pan: una guayín vieja color crema con una puerta de otro color, una concha gigante de fibra de
// vidrio en el techo (ya despintada), la bocina amarrada adelante y la cajuela abierta con las charolas de pan.
// Anda despacio por las colonias con su cancioncita (ver FRASES_PAN)
const VT_PAN = { name: 'Carro del pan', L: 42, W: 18, top: 150, acc: 75, steer: 2.2, hp: 150 };
function makePanadero(scene) {
  const { L, W } = VT_PAN, t = scene.textures.createCanvas('panadero', (L + 5) * SPR, (W + 5) * SPR), x = t.getContext();
  x.scale(SPR, SPR); x.translate(1, 1);
  const rr = (X, Y, w, h, r, f) => { x.fillStyle = f; x.beginPath(); x.roundRect(X, Y, w, h, r); x.fill(); };
  x.fillStyle = 'rgba(0,0,0,0.35)'; x.beginPath(); x.roundRect(2, 2, L, W, 4); x.fill();
  // carroceria crema con la puerta de atras izquierda azul (de otro carro) y un golpe en la defensa
  const g = x.createLinearGradient(0, 0, 0, W);
  g.addColorStop(0, '#c9b98a'); g.addColorStop(0.3, '#f3e7c0'); g.addColorStop(0.7, '#efe2b6'); g.addColorStop(1, '#bba977');
  rr(0, 0, L, W, 3.5, g);
  x.fillStyle = '#5b86b0'; x.fillRect(13, 0.2, 9, 2.6);
  x.strokeStyle = 'rgba(0,0,0,0.3)'; x.lineWidth = 0.5; x.beginPath(); x.roundRect(0, 0, L, W, 3.5); x.stroke();
  x.fillStyle = '#8a7a52'; x.fillRect(L - 1.2, 2, 1.2, W - 4); x.fillStyle = '#6d6040'; x.fillRect(L - 1.4, W - 6, 1.4, 2.5); // defensa chueca
  // cajuela abierta atras: las charolas con conchas, cuernitos y bolillos
  rr(0.6, 2, 9, W - 4, 1, '#5a3d22');
  for (let i = 0; i < 3; i++) for (let j = 0; j < 4; j++) {
    const cx = 2.4 + i * 2.8, cy = 4 + j * 3.4;
    if ((i + j) % 3 === 0) { x.fillStyle = '#f8c9d4'; x.beginPath(); x.arc(cx, cy, 1.25, 0, 7); x.fill(); x.fillStyle = '#c98a4b'; x.fillRect(cx - 1.2, cy - 0.15, 2.4, 0.3); }
    else if ((i + j) % 3 === 1) { x.fillStyle = '#d99a4e'; x.beginPath(); x.ellipse(cx, cy, 1.4, 0.8, 0.5, 0, 7); x.fill(); }
    else { x.fillStyle = '#e8b878'; x.beginPath(); x.ellipse(cx, cy, 1.3, 0.9, 0, 0, 7); x.fill(); x.strokeStyle = '#a8692c'; x.lineWidth = 0.25; x.beginPath(); x.moveTo(cx - 0.6, cy); x.lineTo(cx + 0.6, cy); x.stroke(); }
  }
  // techo y vidrios
  rr(10, 1.6, 24, W - 3.2, 2, '#e2d4a6');
  x.fillStyle = GLASS; x.fillRect(34, 2.4, 3.2, W - 4.8); x.fillRect(10.2, 2.8, 1.6, W - 5.6);
  x.fillStyle = 'rgba(255,255,255,0.2)'; x.fillRect(34.6, 3.2, 0.8, W - 6.4);
  // la concha gigante en el techo: costra de azucar rosa y blanca con su cuadricula, y la orilla de pan dorado
  const cx = 22, cy = W / 2;
  x.fillStyle = '#c98a4b'; x.beginPath(); x.ellipse(cx, cy, 9.4, 7.4, 0, 0, 7); x.fill();
  const h = x.createRadialGradient(cx - 2, cy - 2, 1, cx, cy, 8.4); h.addColorStop(0, '#ffe3ea'); h.addColorStop(1, '#e7a3b5');
  x.fillStyle = h; x.beginPath(); x.ellipse(cx, cy, 8.4, 6.5, 0, 0, 7); x.fill();
  x.save(); x.clip(); x.strokeStyle = '#b8794a'; x.lineWidth = 0.55;
  for (let k = -16; k <= 16; k += 3) { x.beginPath(); x.moveTo(cx + k - 8, cy - 8); x.lineTo(cx + k + 8, cy + 8); x.stroke(); x.beginPath(); x.moveTo(cx + k + 8, cy - 8); x.lineTo(cx + k - 8, cy + 8); x.stroke(); }
  x.fillStyle = 'rgba(255,255,255,0.35)'; x.fillRect(cx - 9, cy - 1, 4, 3); // lo despintado
  x.restore();
  // la bocina amarrada adelante del techo, viendo para el frente, con su cable
  x.fillStyle = '#9e9e9e'; x.beginPath(); x.moveTo(31.5, cy - 1.2); x.lineTo(36.5, cy - 3); x.lineTo(36.5, cy + 3); x.lineTo(31.5, cy + 1.2); x.closePath(); x.fill();
  x.strokeStyle = '#555'; x.lineWidth = 0.4; x.stroke(); x.fillStyle = '#333'; x.fillRect(36.2, cy - 2.6, 0.6, 5.2);
  x.strokeStyle = '#222'; x.lineWidth = 0.3; x.beginPath(); x.moveTo(31.5, cy); x.quadraticCurveTo(30, cy + 4, 34, cy + 6); x.stroke();
  // espejos, faros (uno fundido) y calaveras
  x.fillStyle = '#7a6a45'; x.fillRect(32, -1, 1.6, 1.2); x.fillRect(32, W - 0.2, 1.6, 1.2);
  x.fillStyle = '#fff6b0'; x.fillRect(L - 1.6, 1.6, 1.6, 2.6); x.fillStyle = '#8a8a7a'; x.fillRect(L - 1.6, W - 4.2, 1.6, 2.6);
  x.fillStyle = '#ff3b30'; x.fillRect(0, 2, 1.2, 2.4); x.fillRect(0, W - 4.4, 1.2, 2.4);
  t.refresh();
}
// explosiones: 'onda' es el anillo de la onda expansiva y 'mancha' el tizne que deja en el piso
function makeExplosiones(scene) {
  let t = scene.textures.createCanvas('onda', 128, 128), x = t.getContext();
  const g = x.createRadialGradient(64, 64, 40, 64, 64, 63);
  g.addColorStop(0, 'rgba(255,255,255,0)'); g.addColorStop(0.7, 'rgba(255,255,255,0.9)'); g.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = g; x.fillRect(0, 0, 128, 128); t.refresh();
  t = scene.textures.createCanvas('mancha', 96, 96); x = t.getContext();
  const r = mulberry(11);
  for (let i = 0; i < 22; i++) {
    const a = r() * 6.3, d = r() * 26, rad = 8 + r() * 16;
    const h = x.createRadialGradient(48 + Math.cos(a) * d, 48 + Math.sin(a) * d, 0, 48 + Math.cos(a) * d, 48 + Math.sin(a) * d, rad);
    h.addColorStop(0, 'rgba(10,8,6,0.5)'); h.addColorStop(1, 'rgba(10,8,6,0)');
    x.fillStyle = h; x.fillRect(0, 0, 96, 96);
  }
  // rayones que salen del centro
  x.strokeStyle = 'rgba(15,12,10,0.45)'; x.lineCap = 'round';
  for (let i = 0; i < 16; i++) { const a = r() * 6.3, l = 26 + r() * 20; x.lineWidth = 1 + r() * 2; x.beginPath(); x.moveTo(48 + Math.cos(a) * 12, 48 + Math.sin(a) * 12); x.lineTo(48 + Math.cos(a) * l, 48 + Math.sin(a) * l); x.stroke(); }
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
  // franja blanca a lo largo de los dos costados, de la defensa de adelante a la de atras
  x.fillStyle = '#f4f1ea'; x.fillRect(2.2, 0.8, L - 4.4, 1.2); x.fillRect(2.2, W - 2, L - 4.4, 1.2);
  // cofre y cajuela rojos con un brillo a lo largo
  x.fillStyle = 'rgba(255,255,255,0.13)'; x.fillRect(29, 3, L - 31.5, 2.2); x.fillRect(0.8, 3.5, 1, W - 7);
  // techo largo de guayin, negro, con las ventanas laterales asomando por las orillas hasta atras
  x.fillStyle = BLACK; x.beginPath(); x.roundRect(3.6, 2.4, 21, W - 4.8, 1.4); x.fill();
  x.fillStyle = '#34465a'; x.fillRect(4.2, 2.4, 19.8, 1); x.fillRect(4.2, W - 3.4, 19.8, 1);
  x.fillStyle = 'rgba(255,255,255,0.08)'; x.fillRect(6, 4.6, 16, 2.2);
  // parabrisas y medallon trasero
  x.fillStyle = '#2b3a4a'; x.fillRect(24.6, 3.4, 4, W - 6.8); x.fillRect(1.8, 4, 1.8, W - 8);
  x.fillStyle = 'rgba(255,255,255,0.18)'; x.fillRect(25.4, 4.2, 1, W - 8.4);
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
const LONAS = [['#d62828', '#f4efe6'], ['#f77f00', '#fcbf49'], ['#2a9d8f', '#e9f5db'], ['#1d4e89', '#f4efe6'], ['#2e7d32', '#f1f8e9']];
// medidas del puesto en px del mundo (la textura va a SPR veces la resolucion)
const PUESTO_W = 58, PUESTO_H = 52;
function makeTacoStands(scene) {
  // 'u': con el letrero de cabeza, para los puestos que quedan girados al reves (como los cafes)
  for (const u of ['', 'u']) LONAS.forEach(([c1, c2], v) => {
    const t = scene.textures.createCanvas('puesto' + v + u, PUESTO_W * SPR, PUESTO_H * SPR), x = t.getContext();
    x.scale(SPR, SPR); x.translate(5, 3);
    const rnd = mulberry(v * 71 + 5);
    const circ = (c, cx, cy, r) => { x.fillStyle = c; x.beginPath(); x.arc(cx, cy, r, 0, 7); x.fill(); };
    const rrect = (c, x0, y0, w, h, r) => { x.fillStyle = c; x.beginPath(); x.roundRect(x0, y0, w, h, r); x.fill(); };
    // sombra suave de todo el puesto (hacia abajo a la derecha)
    x.save(); x.shadowColor = 'rgba(0,0,0,0.45)'; x.shadowBlur = 4; x.shadowOffsetX = 2; x.shadowOffsetY = 2.5;
    rrect('rgba(0,0,0,0.01)', 0, 0, 42, 18, 1); rrect('rgba(0,0,0,0.01)', 1, 17, 40, 12, 1.5); x.restore();
    // ---- el carrito de lamina (abajo de la lona, se asoma al frente) ----
    const lam = x.createLinearGradient(0, 17, 0, 29); lam.addColorStop(0, '#d5dadd'); lam.addColorStop(0.5, '#a9b0b5'); lam.addColorStop(1, '#868d92');
    rrect(lam, 1, 17, 40, 12, 1.5); x.strokeStyle = '#5d6469'; x.lineWidth = 0.6; x.beginPath(); x.roundRect(1, 17, 40, 12, 1.5); x.stroke();
    x.strokeStyle = 'rgba(255,255,255,0.55)'; x.lineWidth = 0.5; x.beginPath(); x.moveTo(2.5, 18.2); x.lineTo(39.5, 18.2); x.stroke(); // brillo del filo
    // comal con la carne picada, cebolla y cilantro
    rrect('#1e1e1e', 4, 19.5, 13, 7.5, 2.5); rrect('#3a3a3a', 4.6, 20, 11.8, 6.5, 2.2);
    for (let i = 0; i < 22; i++) { const px = 5.5 + rnd() * 10, py = 21 + rnd() * 4.5; circ(['#8a3b12', '#b5521b', '#6e2c0c', '#c9672a'][i % 4], px, py, 0.55 + rnd() * 0.45); }
    for (let i = 0; i < 7; i++) circ('#f4f1e6', 5.8 + rnd() * 9.5, 21.2 + rnd() * 4, 0.35);
    for (let i = 0; i < 7; i++) circ('#3f9a2f', 5.8 + rnd() * 9.5, 21.2 + rnd() * 4, 0.35);
    // salsas en molcajete: roja, verde y la de aguacate
    for (const [cx, col] of [[20.5, '#b3201b'], [24.5, '#3f8f2f'], [28.5, '#9ccc65']]) { circ('#4e4a45', cx, 21, 1.9); circ(col, cx, 21, 1.4); circ('rgba(255,255,255,0.35)', cx - 0.5, 20.5, 0.45); }
    // limones partidos
    for (const [cx, cy] of [[20, 25.5], [22.2, 26.3], [24.4, 25.6]]) { circ('#5c9e2f', cx, cy, 1.1); circ('#c5e1a5', cx, cy, 0.75); }
    // platos con su bolsita y las tortillas
    for (let i = 0; i < 3; i++) { circ('rgba(0,0,0,0.15)', 31.5 + i * 0.4, 25.3 - i * 0.6, 2.6); circ('#f7f7f2', 31.2 + i * 0.4, 25 - i * 0.6, 2.5); }
    circ('rgba(255,255,255,0.7)', 30.4, 23.3, 0.6);
    circ('#e9d9b0', 37.2, 22.8, 2.6); circ('#f5e8c6', 37, 22.6, 2.1); x.strokeStyle = 'rgba(150,120,70,0.5)'; x.lineWidth = 0.3; x.beginPath(); x.arc(37, 22.6, 1.3, 0, 7); x.stroke();
    // ---- la lona a rayas, con los olanes al frente ----
    const W = 42, H = 15, n = 7;
    for (let i = 0; i < n; i++) { x.fillStyle = i % 2 ? c2 : c1; x.fillRect(i * W / n, 0, W / n + 0.05, H); }
    for (let i = 0; i < n * 2; i++) { x.fillStyle = Math.floor(i / 2) % 2 ? c2 : c1; x.beginPath(); x.arc(i * W / n / 2 + W / n / 4, H, W / n / 4, 0, Math.PI); x.fill(); }
    const som = x.createLinearGradient(0, 0, 0, H + 1.5); som.addColorStop(0, 'rgba(255,255,255,0.28)'); som.addColorStop(0.35, 'rgba(255,255,255,0)'); som.addColorStop(1, 'rgba(0,0,0,0.22)');
    x.fillStyle = som; x.fillRect(0, 0, W, H + 1.6);
    x.strokeStyle = 'rgba(0,0,0,0.35)'; x.lineWidth = 0.4; x.beginPath(); x.moveTo(0, H / 2); x.lineTo(W, H / 2); x.stroke(); // la costura (la lona va en dos aguas)
    x.strokeStyle = 'rgba(0,0,0,0.5)'; x.lineWidth = 0.7; x.strokeRect(0, 0, W, H);
    for (const [px, py] of [[0, 0], [W, 0], [0, H], [W, H]]) { circ('#3a3a3a', px, py, 1); circ('#9e9e9e', px - 0.25, py - 0.25, 0.4); } // los tubos
    // letrero pintado a mano, con un taquito
    x.save(); if (u) { x.translate(20.75, 7.4); x.rotate(Math.PI); x.translate(-20.75, -7.4); }
    rrect('rgba(0,0,0,0.35)', 8.4, 3.6, 25.5, 8.4, 1.6); rrect('#fff4d6', 8, 3.2, 25.5, 8.4, 1.6);
    x.strokeStyle = c1; x.lineWidth = 0.7; x.beginPath(); x.roundRect(8.6, 3.8, 24.3, 7.2, 1.2); x.stroke();
    x.font = 'bold 5.4px "Trebuchet MS", sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle';
    x.lineWidth = 1; x.strokeStyle = '#3b2a17'; x.strokeText('TACOS', 23.5, 7.6); x.fillStyle = c1 === '#f77f00' ? '#c1121f' : c1; x.fillText('TACOS', 23.5, 7.6);
    // taquito: tortilla doblada con su relleno
    x.save(); x.translate(12.7, 7.8); x.rotate(-0.25);
    x.fillStyle = '#e8c27a'; x.beginPath(); x.arc(0, 0.6, 2.8, Math.PI, 0); x.closePath(); x.fill();
    circ('#b5521b', -1, -0.5, 0.6); circ('#3f9a2f', 0.2, -0.9, 0.45); circ('#b5521b', 1, -0.4, 0.55); circ('#f4f1e6', 0.1, 0, 0.4);
    x.strokeStyle = '#a57b35'; x.lineWidth = 0.4; x.beginPath(); x.arc(0, 0.6, 2.8, Math.PI, 0); x.stroke(); x.restore();
    x.restore();
    // ---- el trompo de pastor a un lado: la carne en capas, la pina arriba y la lumbre detras ----
    const tx = 45.5, ty = 11;
    const fuego = x.createRadialGradient(tx + 2, ty, 0, tx + 2, ty, 6); fuego.addColorStop(0, 'rgba(255,170,40,0.75)'); fuego.addColorStop(1, 'rgba(255,90,0,0)');
    x.fillStyle = fuego; x.beginPath(); x.arc(tx + 2, ty, 6, 0, 7); x.fill();
    circ('#2b2b2b', tx, ty, 4.6);
    for (const [r, c] of [[4.1, '#7a2e0e'], [3.4, '#b5521b'], [2.7, '#d9742c'], [2, '#a8441a']]) circ(c, tx, ty, r);
    x.strokeStyle = 'rgba(60,20,5,0.6)'; x.lineWidth = 0.35; for (const r of [3.7, 3, 2.3]) { x.beginPath(); x.arc(tx, ty, r, 0.4, 5.6); x.stroke(); }
    circ('#f2c94c', tx, ty, 1.3); circ('#ffe082', tx - 0.3, ty - 0.3, 0.6);
    x.fillStyle = '#4caf50'; for (let k = 0; k < 5; k++) { const a = k / 5 * 6.283; x.beginPath(); x.ellipse(tx + Math.cos(a) * 1.3, ty + Math.sin(a) * 1.3, 1.1, 0.35, a, 0, 7); x.fill(); }
    // ---- bancos de plastico, viendo a la calle ----
    for (const [a, b, c] of [[7, 37, '#c62828'], [17, 39, '#1565c0'], [27, 37, '#f5f5f5'], [36, 39, '#c62828']]) {
      circ('rgba(0,0,0,0.28)', a + 1, b + 1.2, 3.1);
      const g = x.createRadialGradient(a - 1, b - 1, 0.3, a, b, 3.1); g.addColorStop(0, 'rgba(255,255,255,0.45)'); g.addColorStop(0.35, c); g.addColorStop(1, c);
      circ(g, a, b, 3.1); x.strokeStyle = 'rgba(0,0,0,0.35)'; x.lineWidth = 0.4; x.beginPath(); x.arc(a, b, 3.1, 0, 7); x.stroke();
      circ('rgba(0,0,0,0.22)', a, b, 0.9); // el hoyito del asiento
    }
    t.refresh();
  });
  // el vapor del comal
  const vp = scene.textures.createCanvas('vapor', 16 * SPR, 16 * SPR), vx = vp.getContext();
  const vg = vx.createRadialGradient(8 * SPR, 8 * SPR, 0, 8 * SPR, 8 * SPR, 8 * SPR); vg.addColorStop(0, 'rgba(255,255,255,0.7)'); vg.addColorStop(1, 'rgba(255,255,255,0)');
  vx.fillStyle = vg; vx.fillRect(0, 0, 16 * SPR, 16 * SPR); vp.refresh();
}
// el puesto va en la banqueta de la calle mas cercana (del lado donde esta la taqueria),
// con el mostrador y los bancos viendo hacia la calle. Devuelve [x, y, rotacion].
// fachada de cafe vista desde arriba: toldo pegado al edificio (atras), mesitas con sombrilla
// y un pizarron en la banqueta (adelante). Tres estilos de toldo.
const TOLDOS = [['#5d3a1a', '#efe3c8', '#efe3c8'], ['#1f4d3a', '#f4f1e8', '#f4f1e8'], ['#1d1d1d', '#c9a26b', '#f0e6d2'], ['#8e2b2b', '#f3e9dc', '#f3e9dc']];
// medidas del cafe en px del mundo (la textura va a SPR veces la resolucion); el toldo va arriba, pegado a la fachada
const CAFE_W = 60, CAFE_H = 46;
function makeCafes(scene) {
  // 'u': el letrero va de cabeza dentro del dibujo, para los cafes que quedan girados al reves (asi se lee derecho)
  for (const u of ['', 'u']) TOLDOS.forEach(([c1, c2, tx], v) => {
    const t = scene.textures.createCanvas('cafe' + v + u, CAFE_W * SPR, CAFE_H * SPR), x = t.getContext();
    x.scale(SPR, SPR); x.translate(4, 2);
    const circ = (c, cx, cy, r) => { x.fillStyle = c; x.beginPath(); x.arc(cx, cy, r, 0, 7); x.fill(); };
    const rrect = (c, x0, y0, w, h, r) => { x.fillStyle = c; x.beginPath(); x.roundRect(x0, y0, w, h, r); x.fill(); };
    const W = 50, H = 13, n = 10;
    // sombra del toldo sobre la banqueta
    x.save(); x.shadowColor = 'rgba(0,0,0,0.45)'; x.shadowBlur = 4; x.shadowOffsetY = 3; rrect('rgba(0,0,0,0.01)', 0, 0, W, H + 2, 1); x.restore();
    // ---- toldo a rayas con olanes, luz arriba y sombra hacia la orilla ----
    for (let i = 0; i < n; i++) { x.fillStyle = i % 2 ? c2 : c1; x.fillRect(i * W / n, 0, W / n + 0.05, H); }
    for (let i = 0; i < n; i++) { x.fillStyle = i % 2 ? c2 : c1; x.beginPath(); x.arc(i * W / n + W / n / 2, H, W / n / 2, 0, Math.PI); x.fill(); }
    const som = x.createLinearGradient(0, 0, 0, H + 2.5); som.addColorStop(0, 'rgba(255,255,255,0.25)'); som.addColorStop(0.4, 'rgba(255,255,255,0)'); som.addColorStop(1, 'rgba(0,0,0,0.25)');
    x.fillStyle = som; x.fillRect(0, 0, W, H + 2.6);
    x.strokeStyle = 'rgba(0,0,0,0.4)'; x.lineWidth = 0.6; x.strokeRect(0, 0, W, H);
    // letrero: la palabra y una tacita humeando
    x.save(); if (u) { x.translate(25, 6.5); x.rotate(Math.PI); x.translate(-25, -6.5); }
    rrect('rgba(0,0,0,0.3)', 13.4, 2.9, 24, 8, 1.5); rrect(c1, 13, 2.5, 24, 8, 1.5);
    x.strokeStyle = tx; x.lineWidth = 0.5; x.beginPath(); x.roundRect(13.7, 3.2, 22.6, 6.6, 1.1); x.stroke();
    x.font = 'bold 5.2px Georgia, serif'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillStyle = tx; x.fillText('CAFÉ', 28, 6.7);
    x.fillStyle = tx; x.beginPath(); x.moveTo(15.8, 5.6); x.lineTo(20.2, 5.6); x.lineTo(19.6, 8.6); x.lineTo(16.4, 8.6); x.closePath(); x.fill();
    x.strokeStyle = tx; x.lineWidth = 0.5; x.beginPath(); x.arc(20.3, 6.9, 0.9, -1.4, 1.4); x.stroke();
    x.lineWidth = 0.35; x.beginPath(); x.moveTo(17.2, 5); x.quadraticCurveTo(16.6, 4.3, 17.3, 3.7); x.moveTo(18.8, 5); x.quadraticCurveTo(18.2, 4.3, 18.9, 3.7); x.stroke();
    x.restore();
    // ---- macetas a los lados de la puerta ----
    for (const px of [2.5, 47.5]) {
      circ('rgba(0,0,0,0.25)', px + 0.8, 20.8, 3); circ('#a0522d', px, 20, 3); circ('#7a3d1f', px, 20, 2.3);
      for (let k = 0; k < 6; k++) { const a = k / 6 * 6.283; circ(k % 2 ? '#2e7d32' : '#43a047', px + Math.cos(a) * 1.4, 20 + Math.sin(a) * 1.4, 1.5); }
      circ('#66bb6a', px - 0.4, 19.6, 0.9);
    }
    // ---- mesitas redondas con sus sillas, tazas y un pan dulce ----
    const mesa = (mx, my, conPan) => {
      for (const a of [Math.PI * 0.85, Math.PI * 0.15, Math.PI * 1.5]) { // sillas de bistro
        const cx = mx + Math.cos(a) * 6, cy = my + Math.sin(a) * 6;
        circ('rgba(0,0,0,0.25)', cx + 0.6, cy + 0.7, 2.4); circ('#5d4037', cx, cy, 2.4); circ('#8d6e63', cx, cy, 1.7);
        x.strokeStyle = 'rgba(0,0,0,0.3)'; x.lineWidth = 0.25; x.beginPath(); x.arc(cx, cy, 1.1, 0, 7); x.stroke();
      }
      circ('rgba(0,0,0,0.3)', mx + 0.8, my + 1, 4.6);
      const g = x.createRadialGradient(mx - 1.5, my - 1.5, 0.5, mx, my, 4.5); g.addColorStop(0, '#a1887f'); g.addColorStop(1, '#6d4c41');
      circ(g, mx, my, 4.5); x.strokeStyle = '#4e342e'; x.lineWidth = 0.45; x.beginPath(); x.arc(mx, my, 4.5, 0, 7); x.stroke();
      x.strokeStyle = 'rgba(62,39,35,0.35)'; x.lineWidth = 0.2; x.beginPath(); x.arc(mx, my, 3.2, 0.3, 2.4); x.arc(mx, my, 2.1, 3.4, 5.2); x.stroke(); // vetas
      const taza = (cx, cy) => {
        circ('rgba(0,0,0,0.25)', cx + 0.3, cy + 0.35, 1.55); circ('#fafafa', cx, cy, 1.55);
        circ('#5d3a1a', cx, cy, 0.95); circ('#d7b98e', cx - 0.2, cy - 0.2, 0.42);
        x.strokeStyle = '#fafafa'; x.lineWidth = 0.5; x.beginPath(); x.arc(cx + 1.75, cy, 0.5, -1.2, 1.2); x.stroke(); // asa
      };
      if (conPan) { // una taza y una concha en su servilleta
        taza(mx - 1.6, my - 1);
        x.save(); x.translate(mx + 1.5, my + 1.3); x.rotate(0.5); x.fillStyle = '#fafafa'; x.fillRect(-1.9, -1.9, 3.8, 3.8); x.restore();
        circ('#e8b04a', mx + 1.5, my + 1.3, 1.45); circ('#f8bbd0', mx + 1.5, my + 1.3, 1.2);
        x.strokeStyle = '#d48aa6'; x.lineWidth = 0.22; x.beginPath();
        for (const d of [-0.5, 0.5]) { x.moveTo(mx + 1.5 + d, my + 0.3); x.lineTo(mx + 1.5 + d, my + 2.3); x.moveTo(mx + 0.5, my + 1.3 + d); x.lineTo(mx + 2.5, my + 1.3 + d); }
        x.stroke();
      } else { // una taza y el periodico
        x.save(); x.translate(mx - 1.2, my + 1); x.rotate(-0.35); x.fillStyle = '#eeeeee'; x.fillRect(-2.2, -1.5, 4.4, 3);
        x.strokeStyle = 'rgba(0,0,0,0.35)'; x.lineWidth = 0.18; x.beginPath(); for (const yy of [-0.8, -0.2, 0.4, 1]) { x.moveTo(-1.8, yy); x.lineTo(1.8, yy); } x.stroke(); x.restore();
        taza(mx + 1.7, my - 1.2);
      }
    };
    mesa(10, 28, true); mesa(40, 28, false);
    // ---- pizarron de caballete en medio, con el menu en gis y una tacita dibujada ----
    circ('rgba(0,0,0,0.25)', 26.2, 31, 4);
    rrect('#6d4c41', 21.8, 25.5, 8.4, 10.2, 0.8); rrect('#263238', 22.6, 26.3, 6.8, 8.6, 0.5);
    x.strokeStyle = 'rgba(255,255,255,0.8)'; x.lineWidth = 0.3; x.beginPath();
    x.moveTo(23.6, 27.6); x.lineTo(28.4, 27.6);
    for (const yy of [31.4, 32.6, 33.8]) { x.moveTo(23.4, yy); x.lineTo(26.8, yy); x.moveTo(27.4, yy); x.lineTo(28.4, yy); }
    x.stroke();
    x.strokeStyle = '#ffcc80'; x.beginPath(); x.moveTo(24.6, 28.6); x.lineTo(27.2, 28.6); x.lineTo(26.8, 30.4); x.lineTo(25, 30.4); x.closePath(); x.stroke();
    // tapete en la puerta
    rrect('#d7ccc8', 20.5, 16.4, 11, 3.4, 0.6); rrect(c1, 21.1, 16.9, 9.8, 2.4, 0.4);
    t.refresh();
  });
}
// lo solido de los puestos de tacos y de los cafes (no se camina ni se maneja encima): cajas [u0, v0, u1, v1] y
// circulos [u, v, r] en px del mundo, relativos al centro del dibujo sin girar (u a lo ancho, v hacia el frente)
const SOLIDO_PUESTO = { cajas: [[-24, -23, 18, 6], [16, -18, 27, -6]], circs: [] };            // carrito con su lona y el trompo
const SOLIDO_CAFE = { cajas: [[-26, -21, 24, -5]], circs: [[-16, 7, 7.5], [14, 7, 7.5], [0, 9.5, 4]] }; // toldo, mesitas y pizarron
const CCELL = 64, comidaGrid = new Map();
function solidoComida(x, y, rot, forma) {
  const o = { x, y, c: Math.cos(rot), s: Math.sin(rot), f: forma };
  gridAdd(comidaGrid, o, [x - 34, y - 34, x + 34, y + 34], CCELL);
}
function enComida(x, y, pad = 0) {
  const a = comidaGrid.get(GK(Math.floor(x / CCELL), Math.floor(y / CCELL))); if (!a) return false;
  for (const o of a) {
    const dx = x - o.x, dy = y - o.y, u = dx * o.c + dy * o.s, v = -dx * o.s + dy * o.c;
    for (const b of o.f.cajas) if (u > b[0] - pad && u < b[2] + pad && v > b[1] - pad && v < b[3] + pad) return true;
    for (const c of o.f.circs) if (Math.hypot(u - c[0], v - c[1]) < c[2] + pad) return true;
  }
  return false;
}
// el siguiente paso de alguien que camina por la banqueta (gente y perros: o.e, o.s, o.dir, o.side) queda en tmp.
// Si ahi hay un puesto de tacos o un cafe, lo rodea corriendose de lado (o.desv) y al pasarlo regresa poco a poco a
// su carril. Devuelve false si no hay por donde (o algo mas lo tapa): entonces se da la vuelta
const pasoQ = {};
function pasoBanqueta(o, tmp) {
  const d0 = o.desv || 0;
  // libre a ese lado: donde va a pisar, un poco adelante (para hacerse a un lado a tiempo) y un poco atras (donde
  // todavia va su cuerpo, que sigue al punto con retraso: no corta la esquina)
  const libre = (lat) => {
    for (const ds of [0, 10, -10]) { edgePos(o.e, Math.max(0, Math.min(o.e.len, o.s + ds)), o.dir, lat, pasoQ); if (enComida(pasoQ.x, pasoQ.y, 2) || (!ds && blocked(pasoQ.x, pasoQ.y))) return false; }
    return true;
  };
  const ir = (lat) => { o.desv = lat - o.side; edgePos(o.e, o.s, o.dir, lat, tmp); return true; };
  edgePos(o.e, o.s, o.dir, o.side + d0, tmp);
  if (blocked(o.x, o.y) || enComida(o.x, o.y, 0)) return true; // ya estaba atorado o encima de un puesto: que se salga
  if (d0) { const nd = Math.abs(d0) <= 1 ? 0 : d0 - Math.sign(d0); if (libre(o.side + nd)) return ir(o.side + nd); } // de regreso a su carril
  if (libre(o.side + d0)) return true;
  if (blocked(tmp.x, tmp.y) && !enComida(tmp.x, tmp.y, 2)) return false; // lo tapa otra cosa (como antes)
  for (const k of [5, -5, 10, -10, 15, -15, 20, -20, 26, -26, 32, -32, 40, -40]) if (libre(o.side + d0 + k)) return ir(o.side + d0 + k);
  return false;
}
// pines de las taquerias y cafes que te faltan: gota de color con borde blanco, brillo y el emoji adentro
// ('pinTaco', 'pinCafe'; PIN_W x PIN_H px del mundo, la punta abajo al centro)
const PIN_W = 20, PIN_H = 27;
const COMIDA = { taco: { pin: 'pinTaco', col: '#f57c00', luz: 0xff9f1c, emoji: '🌮', fondo: 'rgba(170,60,0,0.88)' },
  cafe: { pin: 'pinCafe', col: '#8d5524', luz: 0xd7a46a, emoji: '☕', fondo: 'rgba(62,39,35,0.88)' } };
function makePinesComida(scene) {
  for (const C of Object.values(COMIDA)) {
    const t = scene.textures.createCanvas(C.pin, PIN_W * SPR, PIN_H * SPR), x = t.getContext();
    x.scale(SPR, SPR); x.translate(PIN_W / 2, 10);
    const gota = () => { x.beginPath(); x.moveTo(0, 16); x.bezierCurveTo(-3, 10, -9, 5, -9, -0.5); x.arc(0, -0.5, 9, Math.PI, 0); x.bezierCurveTo(9, 5, 3, 10, 0, 16); x.closePath(); };
    x.save(); x.shadowColor = 'rgba(0,0,0,0.45)'; x.shadowBlur = 2; x.shadowOffsetY = 1; gota(); x.fillStyle = C.col; x.fill(); x.restore();
    gota(); x.lineWidth = 1.4; x.strokeStyle = '#fff'; x.stroke();
    x.fillStyle = 'rgba(255,255,255,0.95)'; x.beginPath(); x.arc(0, -0.5, 5.9, 0, 7); x.fill();
    x.font = '7.8px "Noto Color Emoji", "Apple Color Emoji", "Segoe UI Emoji", sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle';
    x.fillText(C.emoji, 0, 0.2);
    x.fillStyle = 'rgba(255,255,255,0.55)'; x.beginPath(); x.ellipse(-4.6, -5.2, 1.8, 1, -0.7, 0, 7); x.fill(); // brillo
    t.refresh();
  }
}
// "comida china": local grande con marquesina de neon, faroles rojos, alfombra, cordon y cadenero.
// Dos texturas para que el neon parpadee. El frente (alfombra) va hacia abajo.
function makeChinas(scene) {
  // se dibuja en 88 x 64 unidades (el local mide 80 x 36 y adelante va la banqueta), a 1.2 px del mundo por
  // unidad (el tamano de siempre) y a SPR veces la resolucion
  const K = 1.2;
  for (const k of ['0', '1', '0u', '1u']) {
    const f = +k[0], up = k.length > 1; // 'u': letrero volteado para locales que quedan "de cabeza"
    const t = scene.textures.createCanvas('antro' + k, Math.round(88 * K * SPR), Math.round(64 * K * SPR)), x = t.getContext();
    x.scale(K * SPR, K * SPR); x.translate(4, 3);
    const neon = f ? '#3ff0ff' : '#ff3fa4', rnd = mulberry(77);
    const circ = (c, cx, cy, r) => { x.fillStyle = c; x.beginPath(); x.arc(cx, cy, r, 0, 7); x.fill(); };
    const ell = (c, cx, cy, rx, ry) => { x.fillStyle = c; x.beginPath(); x.ellipse(cx, cy, rx, ry, 0, 0, 7); x.fill(); };
    // sombra
    x.save(); x.shadowColor = 'rgba(0,0,0,0.5)'; x.shadowBlur = 5; x.shadowOffsetX = 2.5; x.shadowOffsetY = 3; x.fillStyle = '#000'; x.fillRect(0, 0, 80, 36); x.restore();
    // ---- techo de tejas rojas con la cumbrera dorada y las esquinas levantadas ----
    x.fillStyle = '#5a0f12'; x.fillRect(0, 0, 80, 24);
    for (let row = 0; row < 6; row++) for (let i = 0; i < 20; i++) {
      const cx = i * 4 + (row % 2) * 2, cy = 2 + row * 3.8;
      const g = x.createLinearGradient(0, cy - 2, 0, cy + 2); g.addColorStop(0, '#b3261e'); g.addColorStop(1, '#6e1414');
      x.fillStyle = g; x.beginPath(); x.arc(cx, cy, 2.2, 0, Math.PI); x.fill();
    }
    const brillo = x.createLinearGradient(0, 0, 80, 24); brillo.addColorStop(0, 'rgba(255,255,255,0.14)'); brillo.addColorStop(1, 'rgba(0,0,0,0.2)');
    x.fillStyle = brillo; x.fillRect(0, 0, 80, 24);
    x.fillStyle = '#d4a017'; x.fillRect(0, 10.6, 80, 1.6); x.fillStyle = '#ffe082'; x.fillRect(0, 10.6, 80, 0.5); // cumbrera
    x.strokeStyle = '#d4a017'; x.lineWidth = 1.2; x.strokeRect(0.6, 0.6, 78.8, 22.8);
    x.lineCap = 'round'; x.lineWidth = 1.6;
    for (const [cx, cy, sx, sy] of [[0, 0, -1, -1], [80, 0, 1, -1], [0, 24, -1, 1], [80, 24, 1, 1]]) { // esquinas levantadas
      x.beginPath(); x.moveTo(cx - sx * 4, cy); x.quadraticCurveTo(cx + sx * 1.5, cy, cx + sx * 2.5, cy + sy * 2.5); x.stroke();
      circ('#ffe082', cx + sx * 2.5, cy + sy * 2.5, 0.9);
    }
    // ---- la marquesina: laca roja, filo dorado, neon y el letrero ----
    x.fillStyle = '#8e0f1a'; x.fillRect(2, 24, 76, 12);
    x.fillStyle = 'rgba(255,255,255,0.12)'; x.fillRect(2, 24, 76, 3);
    x.strokeStyle = '#d4a017'; x.lineWidth = 0.8; x.strokeRect(2.4, 24.4, 75.2, 11.2);
    for (const gx of [6, 74]) { x.strokeStyle = '#d4a017'; x.lineWidth = 0.6; x.strokeRect(gx - 2.2, 26.8, 4.4, 6.4); x.strokeRect(gx - 1.1, 27.9, 2.2, 4.2); } // grecas
    x.save(); x.shadowColor = neon; x.shadowBlur = 5; x.strokeStyle = neon; x.lineWidth = 1; x.strokeRect(10.5, 25.6, 59, 8.8);
    x.fillStyle = '#ffe14d'; x.font = 'bold 7px "Trebuchet MS", sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle';
    x.translate(40, 30.2); if (up) x.rotate(Math.PI); x.fillText('COMIDA CHINA', 0, 0); x.restore();
    // ---- tira de faroles al frente (los de la punta prenden y apagan con el neon) ----
    x.strokeStyle = '#3a2a1a'; x.lineWidth = 0.4; x.beginPath(); x.moveTo(2, 37); x.quadraticCurveTo(40, 40, 78, 37); x.stroke();
    for (let i = 0; i < 7; i++) {
      const lx = 6 + i * 11.3, ly = 37.6 + Math.sin(i / 6 * Math.PI) * 1.4, on = (i + f) % 2 === 0;
      if (on) { const gl = x.createRadialGradient(lx, ly, 0, lx, ly, 5); gl.addColorStop(0, 'rgba(255,120,60,0.55)'); gl.addColorStop(1, 'rgba(255,60,30,0)'); x.fillStyle = gl; x.beginPath(); x.arc(lx, ly, 5, 0, 7); x.fill(); }
      ell(on ? '#ff3b2f' : '#b3141f', lx, ly, 2.1, 2.6); ell('rgba(255,255,255,0.3)', lx - 0.6, ly - 0.8, 0.6, 0.9);
      x.fillStyle = '#d4a017'; x.fillRect(lx - 1, ly - 2.9, 2, 0.7); x.fillRect(lx - 1, ly + 2.2, 2, 0.7);
    }
    // ---- puerta, alfombra roja con filo dorado y dos leones de piedra ----
    x.fillStyle = '#0d0d0d'; x.fillRect(33, 34, 14, 3); circ('#d4a017', 38.6, 35.5, 0.5); circ('#d4a017', 41.4, 35.5, 0.5);
    x.fillStyle = '#b3141f'; x.fillRect(35, 37, 10, 15); x.strokeStyle = '#d4a017'; x.lineWidth = 0.5; x.strokeRect(35.6, 37, 8.8, 14.6);
    for (const lx of [31, 49]) {
      circ('rgba(0,0,0,0.3)', lx + 0.6, 41.6, 2.6); circ('#9e9e9e', lx, 41, 2.5);
      for (let j = 0; j < 8; j++) { const a = j / 8 * 6.283; circ('#7d7d7d', lx + Math.cos(a) * 1.7, 41 + Math.sin(a) * 1.7, 0.75); } // la melena
      circ('#bdbdbd', lx, 41, 1.2); circ('#424242', lx - 0.45, 40.7, 0.22); circ('#424242', lx + 0.45, 40.7, 0.22);
    }
    // cordon de terciopelo con postes dorados
    x.strokeStyle = '#8e0f2a'; x.lineWidth = 0.9;
    for (const sx of [29, 51]) {
      x.beginPath(); x.moveTo(sx, 45); x.quadraticCurveTo(sx + (sx < 40 ? -1.5 : 1.5), 49, sx, 53); x.stroke();
      for (const py of [45, 53]) { circ('rgba(0,0,0,0.3)', sx + 0.4, py + 0.4, 1.3); circ('#e8c35a', sx, py, 1.2); circ('#fff3c4', sx - 0.35, py - 0.35, 0.4); }
    }
    // el cadenero: traje negro, lentes oscuros y su auricular
    ell('rgba(0,0,0,0.3)', 55, 47.6, 3.4, 4.2); ell('#111', 54.5, 47, 3.3, 4.2);
    circ('#7a5236', 54.5, 47, 1.8); x.fillStyle = '#000'; x.fillRect(53.4, 46.3, 2.3, 0.8); circ('#e0e0e0', 56.1, 47.4, 0.35);
    // la fila afuera del cordon
    for (const [px, py, c, h] of [[24, 44, '#2980b9', '#3b2414'], [23.4, 49.5, '#8e44ad', '#111'], [25, 55, '#27ae60', '#a0522d'], [23.8, 60, '#e67e22', '#3b2414']]) {
      ell('rgba(0,0,0,0.25)', px + 0.5, py + 0.6, 1.9, 2.7); ell(c, px, py, 1.8, 2.6); circ(h, px, py, 1.3);
      circ(c, px + (rnd() < 0.5 ? -1.9 : 1.9), py + 0.3, 0.6); // un brazo, con el celular en la mano
    }
    t.refresh();
  }
}
// el yonke visto desde arriba: terreno de tierra con malla ciclonica, carros deshuesados apilados, llantas,
// la caseta del yonkero y el letrero en el porton. El porton va hacia abajo; 'u' voltea el letrero.
function makeYonke(scene) {
  // 100 x 70 unidades a 1.5 px del mundo por unidad (el tamano de siempre) y a SPR veces la resolucion
  const K = 1.5;
  for (const k of ['', 'u']) {
    const t = scene.textures.createCanvas('yonke' + k, Math.round(100 * K * SPR), Math.round(70 * K * SPR)), x = t.getContext(), r = mulberry(23);
    x.scale(K * SPR, K * SPR); x.translate(3, 3);
    const W = 92, H = 56;
    const circ = (c, cx, cy, rr) => { x.fillStyle = c; x.beginPath(); x.arc(cx, cy, rr, 0, 7); x.fill(); };
    // ---- el terreno: tierra con charcos de aceite, huellas de llanta y basurita ----
    x.save(); x.shadowColor = 'rgba(0,0,0,0.45)'; x.shadowBlur = 4; x.shadowOffsetX = 2; x.shadowOffsetY = 2.5; x.fillStyle = '#7d6b52'; x.fillRect(0, 0, W, H); x.restore();
    const tierra = x.createLinearGradient(0, 0, W, H); tierra.addColorStop(0, '#8a7759'); tierra.addColorStop(1, '#6f5e46'); x.fillStyle = tierra; x.fillRect(0, 0, W, H);
    for (let i = 0; i < 90; i++) { x.fillStyle = r() < 0.5 ? 'rgba(60,45,30,0.3)' : 'rgba(180,160,125,0.28)'; x.beginPath(); x.ellipse(r() * W, r() * H, 0.6 + r() * 3.5, 0.4 + r() * 2, r() * 3, 0, 7); x.fill(); }
    x.strokeStyle = 'rgba(50,38,25,0.35)'; x.lineWidth = 1.4; x.setLineDash([1.2, 0.8]); // huellas que entran por el porton
    for (const dx of [-3, 3]) { x.beginPath(); x.moveTo(46 + dx, H); x.quadraticCurveTo(44 + dx, 40, 34 + dx, 30); x.stroke(); }
    x.setLineDash([]);
    for (let i = 0; i < 7; i++) { // charcos de aceite con su brillo tornasol
      const cx = 8 + r() * (W - 16), cy = 8 + r() * (H - 16), rx = 2 + r() * 3.5, ry = 1.4 + r() * 2.2, a = r() * 3;
      x.fillStyle = 'rgba(12,12,18,0.55)'; x.beginPath(); x.ellipse(cx, cy, rx, ry, a, 0, 7); x.fill();
      const g = x.createLinearGradient(cx - rx, cy, cx + rx, cy); g.addColorStop(0, 'rgba(120,60,200,0.25)'); g.addColorStop(0.5, 'rgba(40,200,180,0.2)'); g.addColorStop(1, 'rgba(230,180,40,0.2)');
      x.fillStyle = g; x.beginPath(); x.ellipse(cx - rx * 0.2, cy - ry * 0.2, rx * 0.5, ry * 0.4, a, 0, 7); x.fill();
    }
    for (let i = 0; i < 14; i++) { x.fillStyle = ['#9e9e9e', '#5d4037', '#b0bec5', '#795548'][i % 4]; x.save(); x.translate(4 + r() * (W - 8), 4 + r() * (H - 8)); x.rotate(r() * 3); x.fillRect(-0.8, -0.3, 1.6, 0.6); x.restore(); } // fierritos
    // ---- carros deshuesados: oxidados, sin puertas ni llantas, unos con el cofre abierto ----
    const cols = ['#8e3b2f', '#3f5f7a', '#6b6b4a', '#7a7a7a', '#5b3f6b', '#a0522d', '#2f5a3f', '#c2a14a', '#2e4a6b', '#9a8a6a'];
    const car = (cx, cy, a, c, alto) => {
      x.save(); x.translate(cx, cy); x.rotate(a);
      x.fillStyle = 'rgba(0,0,0,' + (alto ? 0.45 : 0.32) + ')'; x.beginPath(); x.roundRect(-6.4 + (alto ? 1.2 : 0.6), -3 + (alto ? 1.4 : 0.7), 14, 6.8, 1.4); x.fill();
      const g = x.createLinearGradient(0, -3.4, 0, 3.4); g.addColorStop(0, shade(c, 1.2)); g.addColorStop(1, shade(c, 0.75));
      x.fillStyle = g; x.beginPath(); x.roundRect(-7, -3.4, 14, 6.8, 1.6); x.fill();
      for (let i = 0; i < 6; i++) { x.fillStyle = r() < 0.6 ? 'rgba(140,70,20,0.6)' : 'rgba(90,45,15,0.6)'; x.beginPath(); x.ellipse(-6 + r() * 12, -2.6 + r() * 5.2, 0.5 + r() * 1.4, 0.4 + r() * 0.9, r() * 3, 0, 7); x.fill(); } // oxido
      // cabina sin vidrios: se ven los asientos
      x.fillStyle = '#1d2a33'; x.fillRect(-2.8, -2.8, 6, 5.6);
      x.fillStyle = '#4e342e'; x.fillRect(-2.1, -2.2, 1.8, 1.8); x.fillRect(-2.1, 0.4, 1.8, 1.8); x.fillRect(0.8, -2.2, 1.8, 4.4);
      x.strokeStyle = 'rgba(200,220,230,0.5)'; x.lineWidth = 0.25; x.beginPath(); x.moveTo(3.2, -2.6); x.lineTo(3.8, -0.4); x.lineTo(3.3, 1.2); x.stroke(); // vidrio estrellado
      if (r() < 0.4) { x.fillStyle = shade(c, 0.6); x.fillRect(4, -3, 2.6, 6); x.fillStyle = '#37474f'; x.fillRect(4.4, -2, 1.8, 4); } // cofre abierto, el motor
      x.strokeStyle = 'rgba(0,0,0,0.55)'; x.lineWidth = 0.35; x.beginPath(); x.roundRect(-7, -3.4, 14, 6.8, 1.6); x.stroke();
      x.fillStyle = 'rgba(255,255,255,0.18)'; x.fillRect(-6.4, -3, 12.8, 0.6);
      x.restore();
    };
    [[12, 10, 0.05], [12, 18.5, -0.04], [26, 10, 0.1], [26, 18, 0.02], [44, 9, -0.08], [70, 12, 1.4], [79, 12, 1.5], [70, 30, 1.6], [83, 36, 1.45], [58, 10, 0.12]].forEach(([cx, cy, a], i) => car(cx, cy, a, cols[i % cols.length]));
    car(19, 14, 0.3, cols[5], true); car(35, 13.5, -0.2, cols[6], true); car(74.5, 21, 1.5, cols[8], true); // los de arriba de la pila
    // ---- pila de llantas, una con agua y otra ya tirada ----
    const llanta = (lx, ly, rr) => { circ('rgba(0,0,0,0.3)', lx + 0.5, ly + 0.6, rr); circ('#151515', lx, ly, rr); x.strokeStyle = '#2b2b2b'; x.lineWidth = 0.35; x.beginPath(); x.arc(lx, ly, rr * 0.75, 0, 7); x.stroke(); circ('#4a4a4a', lx, ly, rr * 0.42); circ('#6b6b6b', lx - 0.2, ly - 0.2, rr * 0.2); };
    for (let i = 0; i < 9; i++) llanta(48 + (i % 3) * 4.4, 26 + ((i / 3) | 0) * 4.4, 2.3);
    llanta(51.5, 30, 2.3); llanta(54, 28, 2.3); // las de arriba
    circ('#1f3a4a', 52.4, 34.8, 0.9); // agua estancada
    llanta(62, 44, 2.4); llanta(26, 50, 2.2);
    // ---- motor sobre una tarima, una grua con su gancho ----
    x.fillStyle = '#a1887f'; x.fillRect(30, 27, 10, 8); x.strokeStyle = '#6d4c41'; x.lineWidth = 0.3; for (const yy of [29, 31, 33]) { x.beginPath(); x.moveTo(30, yy); x.lineTo(40, yy); x.stroke(); }
    x.fillStyle = '#455a64'; x.beginPath(); x.roundRect(31.3, 28.2, 7.4, 5.4, 0.8); x.fill(); x.fillStyle = '#263238';
    for (let i = 0; i < 3; i++) { x.fillRect(32.2 + i * 2.2, 27.6, 1.3, 1.3); } x.fillStyle = '#90a4ae'; x.fillRect(31.8, 30.4, 6.4, 0.5);
    x.strokeStyle = '#f9a825'; x.lineWidth = 1.2; x.beginPath(); x.moveTo(41, 36); x.lineTo(36.5, 31); x.stroke(); // pluma de la grua
    x.strokeStyle = '#424242'; x.lineWidth = 0.35; x.beginPath(); x.moveTo(36.5, 31); x.lineTo(36.5, 29.5); x.stroke(); circ('#616161', 36.5, 29.3, 0.5);
    circ('#f9a825', 41, 36, 1.4);
    // ---- caseta del yonkero: lamina acanalada, ventanita, tinaco y un perro echado ----
    x.save(); x.shadowColor = 'rgba(0,0,0,0.4)'; x.shadowBlur = 2; x.shadowOffsetX = 1; x.shadowOffsetY = 1.2; x.fillStyle = '#9e9e9e'; x.fillRect(6, 32, 18, 13); x.restore();
    const lam = x.createLinearGradient(6, 0, 24, 0); for (let i = 0; i <= 8; i++) lam.addColorStop(i / 8, i % 2 ? '#8a8f93' : '#b5babd'); x.fillStyle = lam; x.fillRect(6, 32, 18, 13);
    x.fillStyle = 'rgba(140,70,20,0.5)'; x.fillRect(16, 38, 6, 5); x.fillRect(7, 33, 3, 2);
    x.strokeStyle = 'rgba(0,0,0,0.4)'; x.lineWidth = 0.4; x.strokeRect(6, 32, 18, 13);
    circ('#1c1c1c', 10, 41.5, 2.2); circ('#3a3a3a', 9.5, 41, 1); // tinaco
    x.fillStyle = '#c68b4e'; x.beginPath(); x.ellipse(27.5, 46, 2.6, 1.4, 0.2, 0, 7); x.fill(); circ('#a8713c', 29.8, 45.5, 1.1); // el perro del yonke
    x.fillStyle = '#7a4a22'; x.beginPath(); x.ellipse(30.4, 44.9, 0.5, 0.35, 0.5, 0, 7); x.fill();
    // ---- malla ciclonica con postes, alambre de puas arriba y el porton abierto abajo ----
    x.save(); x.strokeStyle = 'rgba(176,190,197,0.35)'; x.lineWidth = 0.18;
    x.beginPath(); x.rect(-1, -1, W + 2, H + 2); x.rect(1.2, 1.2, W - 2.4, H - 2.4); x.clip('evenodd');
    for (let i = -H; i < W + H; i += 1.4) { x.beginPath(); x.moveTo(i, -1); x.lineTo(i + H + 2, H + 1); x.moveTo(i, H + 1); x.lineTo(i + H + 2, -1); x.stroke(); }
    x.restore();
    x.strokeStyle = '#b0bec5'; x.lineWidth = 0.7;
    x.beginPath(); x.moveTo(34, H); x.lineTo(0, H); x.lineTo(0, 0); x.lineTo(W, 0); x.lineTo(W, H); x.lineTo(58, H); x.stroke();
    x.strokeStyle = '#78909c'; x.lineWidth = 0.35; x.setLineDash([0.5, 1]);
    x.beginPath(); x.moveTo(34, H + 0.9); x.lineTo(-0.9, H + 0.9); x.lineTo(-0.9, -0.9); x.lineTo(W + 0.9, -0.9); x.lineTo(W + 0.9, H + 0.9); x.lineTo(58, H + 0.9); x.stroke(); x.setLineDash([]);
    for (let i = 0; i <= 8; i++) for (const [px, py] of [[i * W / 8, 0], ...(i * W / 8 < 34 || i * W / 8 > 58 ? [[i * W / 8, H]] : [])]) { circ('rgba(0,0,0,0.3)', px + 0.4, py + 0.4, 1.1); circ('#78909c', px, py, 1); circ('#cfd8dc', px - 0.3, py - 0.3, 0.35); }
    for (let i = 1; i < 6; i++) for (const px of [0, W]) { circ('#78909c', px, i * H / 6, 1); circ('#cfd8dc', px - 0.3, i * H / 6 - 0.3, 0.35); }
    // hojas del porton, de tubo con malla
    x.strokeStyle = '#90a4ae'; x.lineWidth = 0.9; x.beginPath(); x.moveTo(34, H); x.lineTo(30, H + 9); x.moveTo(58, H); x.lineTo(62, H + 9); x.stroke();
    circ('#78909c', 34, H, 1.2); circ('#78909c', 58, H, 1.2);
    // ---- el letrero sobre el porton: lamina amarilla, letras pintadas a mano y unas llaves ----
    x.fillStyle = '#212121'; x.fillRect(36.5, H - 9, 1, 9); x.fillRect(54.5, H - 9, 1, 9);
    x.save(); x.shadowColor = 'rgba(0,0,0,0.45)'; x.shadowBlur = 1.5; x.shadowOffsetY = 1; x.fillStyle = '#fdd835'; x.beginPath(); x.roundRect(32, H - 13.5, 28, 9, 1); x.fill(); x.restore();
    x.fillStyle = 'rgba(140,70,20,0.35)'; x.fillRect(32, H - 6.5, 6, 2); x.fillRect(55, H - 13.5, 4, 1.5);
    x.strokeStyle = '#212121'; x.lineWidth = 0.6; x.beginPath(); x.roundRect(32, H - 13.5, 28, 9, 1); x.stroke();
    for (const [px, py] of [[33.2, H - 12.3], [58.8, H - 12.3], [33.2, H - 5.7], [58.8, H - 5.7]]) circ('#616161', px, py, 0.35); // tornillos
    x.save(); x.translate(46, H - 9); if (k) x.rotate(Math.PI);
    x.font = 'bold 5.2px "Trebuchet MS", sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle';
    x.lineWidth = 0.9; x.strokeStyle = '#212121'; x.strokeText('YONKE', 2.6, 0.2); x.fillStyle = '#c62828'; x.fillText('YONKE', 2.6, 0.2);
    x.strokeStyle = '#424242'; x.lineWidth = 0.8; x.lineCap = 'round'; x.beginPath(); x.moveTo(-12.4, 2.4); x.lineTo(-10.2, 0); x.stroke(); // llave de tuercas
    x.beginPath(); x.arc(-9.7, -0.5, 0.9, -0.6, 3.6); x.stroke();
    x.restore();
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
    'Plaza de la Tecnología': ['#00695c', () => { // celular sobre un circuito
      for (const [a, b, c2, d2] of [[-20, -8, -9, -8], [-20, 6, -9, 6], [9, -12, 20, -12], [9, 2, 20, 2], [9, 12, 16, 12]]) { line('#4db6ac', 1, [[a, b], [c2, d2]]); circ('#b2dfdb', a === -20 ? a : c2, b, 1.6); }
      x.beginPath(); x.roundRect(-9, -18, 18, 34, 3.5); fill('#1c1c1c');
      x.beginPath(); x.roundRect(-7.5, -14.5, 15, 25, 1.5); fill('#4fc3f7');
      rect('rgba(255,255,255,0.35)', -7.5, -14.5, 15, 3);
      const apps = ['#ffd23f', '#ef5350', '#66bb6a', '#ab47bc', '#ff7043', '#29b6f6', '#ec407a', '#9ccc65', '#ffca28'];
      for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) rect(apps[r * 3 + c], -5.6 + c * 4.2, -10 + r * 5, 3, 3);
      circ('#555', 0, 13.2, 1.4); rect('#555', -2.5, -16.6, 5, 0.9);
    }],
    'FrikiPlaza': ['#6a1b9a', () => { // control de videojuego
      x.beginPath(); x.moveTo(-14, -6); x.lineTo(14, -6); x.quadraticCurveTo(21, -6, 21, 4); x.quadraticCurveTo(21, 15, 14, 13); x.lineTo(8, 7); x.lineTo(-8, 7);
      x.lineTo(-14, 13); x.quadraticCurveTo(-21, 15, -21, 4); x.quadraticCurveTo(-21, -6, -14, -6); fill('#eceff1');
      rect('#37474f', -15.5, -1, 9, 3); rect('#37474f', -12.5, -4, 3, 9); // cruceta
      circ('#e53935', 13, -2, 2); circ('#43a047', 9, 1.5, 2); circ('#1e88e5', 17, 1.5, 2); circ('#fdd835', 13, 5, 2);
      rect('#90a4ae', -4, 0, 3, 1.4); rect('#90a4ae', 1, 0, 3, 1.4);
      for (const [sx2, sy2] of [[-14, -15], [15, -16], [0, -16]]) txt('#ffd23f', 6, '★', sx2, sy2);
    }],
    'Parque México': ['#2e7d32', () => { // arboles, banca y la bandera
      line('#cfd8dc', 1.2, [[10, 14], [10, -18]]); flagMx(10.6, -18, 11, 7);
      for (const [tx, ty, r] of [[-12, -4, 8], [-2, -9, 6]]) { rect('#5d4037', tx - 1, ty, 2.4, 14); circ('#1b5e20', tx, ty, r); circ('#43a047', tx - r * 0.25, ty - r * 0.3, r * 0.65); }
      rect('#8d6e63', -14, 11, 18, 2.4); rect('#6d4c41', -13, 13.4, 1.6, 4); rect('#6d4c41', 1.4, 13.4, 1.6, 4);
      rect('rgba(255,255,255,0.18)', -22, 17, 44, 3);
    }],
    'Templo de San Francisco': ['#8d6e63', () => { // fachada con espadana de campanas y el cordon franciscano
      rect('#f0e3c8', -14, -4, 28, 22);
      x.beginPath(); x.moveTo(-9, -4); x.lineTo(-9, -14); x.quadraticCurveTo(0, -22, 9, -14); x.lineTo(9, -4); x.closePath(); fill('#f0e3c8');
      for (const bx2 of [-4, 4]) { x.beginPath(); x.moveTo(bx2 - 2.4, -8); x.lineTo(bx2 - 2.4, -11); x.arc(bx2, -11, 2.4, Math.PI, 0); x.lineTo(bx2 + 2.4, -8); fill('#5d4037'); circ('#e3b341', bx2, -9.5, 1.4); }
      line('#5d4037', 1.2, [[0, -18], [0, -24]]); line('#5d4037', 1.2, [[-2.4, -21.5], [2.4, -21.5]]);
      x.beginPath(); x.moveTo(-4, 18); x.lineTo(-4, 9); x.arc(0, 9, 4, Math.PI, 0); x.lineTo(4, 18); fill('#6d4c41');
      circ('#90caf9', 0, 1, 2.4); ring('#a1887f', 0.8, 0, 1, 2.4);
      line('#c8a46a', 1, [[-14, -2], [-10, 1], [-14, 4], [-10, 7]]); circ('#c8a46a', -10, 7, 1); // cordon con nudo
    }],
    'Antiguo Casino Agua Caliente': ['#00695c', () => { // el minarete con su cupula y unas palmas
      rect('rgba(255,255,255,0.18)', -22, 16, 44, 3);
      rect('#f3e3c3', -4.5, -8, 9, 25); for (let i = 0; i < 4; i++) rect('#d9c49c', -4.5, -4 + i * 5.5, 9, 0.8);
      rect('#e0b46c', -6.5, -10, 13, 2.5); rect('#e0b46c', -6, 6, 12, 1.6);
      x.beginPath(); x.moveTo(-5, -10); x.quadraticCurveTo(-5, -19, 0, -21); x.quadraticCurveTo(5, -19, 5, -10); fill('#2e9d8f');
      for (const cx2 of [-2.4, 2.4]) { x.beginPath(); x.moveTo(cx2 - 1.2, 2); x.lineTo(cx2 - 1.2, -1); x.arc(cx2, -1, 1.2, Math.PI, 0); x.lineTo(cx2 + 1.2, 2); fill('#5d4037'); }
      line('#ffd23f', 1, [[0, -21], [0, -25]]); circ('#ffd23f', 0, -25.5, 1);
      for (const sx of [-1, 1]) { line('#6d4c41', 1.6, [[sx * 15, 17], [sx * 14, 2]]); for (let i = 0; i < 5; i++) { const a = -Math.PI / 2 + (i - 2) * 0.6; ell('#43a047', sx * 14 + Math.cos(a) * 5, 2 + Math.sin(a) * 3 + 2, 4.5, 1.3, a); } }
    }],
    'Club Campestre': ['#2e7d32', () => { // green con banderita y pelota de golf
      ell('#66bb6a', 0, 8, 20, 10); ell('#81c784', -2, 6, 13, 6);
      ell('#1b1b1b', 4, 7, 2.6, 1.3);
      line('#eceff1', 1.2, [[4, 7], [4, -18]]); poly('#e53935', [[4, -18], [16, -14], [4, -10]]);
      circ('#ffffff', -9, 9, 2.6); for (const [dx, dy] of [[-0.8, -0.6], [0.6, 0.2], [-0.2, 0.9]]) circ('#cfd8dc', -9 + dx, 9 + dy, 0.4);
    }],
    'Hipódromo de Agua Caliente': ['#6d4c41', () => { // herradura de la suerte con sus clavos (abierta hacia abajo)
      const a0 = Math.PI / 2 + 0.75, a1 = Math.PI * 2.5 - 0.75;
      ring('#78909c', 8, 0, -1, 12, a0, a1); ring('#cfd8dc', 5, 0, -1, 12, a0, a1); ring('rgba(255,255,255,0.6)', 1, 0, -1, 13.5, a0 + 0.3, a1 - 0.3);
      for (let i = 0; i < 6; i++) { const a = a0 + 0.35 + i * (a1 - a0 - 0.7) / 5; circ('#37474f', Math.cos(a) * 12, -1 + Math.sin(a) * 12, 1.1); }
    }],
    'Estadio Caliente': ['#b71c1c', () => { // balon con los colores de los Xolos
      circ('#1a1a1a', 0, 0, 16); circ('#fafafa', 0, 0, 14.5);
      const pent = (cx2, cy2, r, c) => { x.beginPath(); for (let i = 0; i < 5; i++) { const a = -Math.PI / 2 + i * Math.PI * 2 / 5; i ? x.lineTo(cx2 + Math.cos(a) * r, cy2 + Math.sin(a) * r) : x.moveTo(cx2 + Math.cos(a) * r, cy2 + Math.sin(a) * r); } x.closePath(); fill(c); };
      pent(0, 0, 5, '#c62828');
      for (let i = 0; i < 5; i++) { const a = -Math.PI / 2 + i * Math.PI * 2 / 5 + Math.PI / 5; pent(Math.cos(a) * 11.5, Math.sin(a) * 11.5, 4, i % 2 ? '#1a1a1a' : '#c62828'); line('#1a1a1a', 0.8, [[Math.cos(a) * 4.4, Math.sin(a) * 4.4], [Math.cos(a) * 8, Math.sin(a) * 8]]); }
      ring('rgba(0,0,0,0.25)', 1, 0, 0, 14.5);
    }],
    'Galerías Hipódromo': ['#4527a0', () => { // palomitas del cine
      x.beginPath(); x.moveTo(-11, -4); x.lineTo(11, -4); x.lineTo(8, 18); x.lineTo(-8, 18); x.closePath(); fill('#fafafa');
      x.save(); x.clip(); for (let i = -10; i < 12; i += 5) rect('#e53935', i, -4, 2.5, 22); x.restore();
      for (const [px, py, r] of [[-8, -6, 4], [-2, -8, 4.5], [5, -7, 4.2], [9, -4, 3.4], [-5, -11, 3.6], [2, -13, 3.8], [8, -10, 3]]) circ('#fff3c4', px, py, r);
      for (const [px, py] of [[-7, -8], [0, -11], [6, -9], [3, -6]]) circ('#ffd54f', px, py, 1.2);
    }],
    // fase 1: Otay, el Aeropuerto, La Mesa y las 5 y 10
    'Garita de Otay': ['#455a64', () => { // trailer de maquiladora haciendo fila
      rect('rgba(255,255,255,0.18)', -22, 13, 44, 2);
      x.beginPath(); x.roundRect(-21, -9, 27, 18, 1.5); fill('#eceff1'); rect('#cfd8dc', -21, 5, 27, 4);
      for (let i = -18; i < 5; i += 4) rect('rgba(0,0,0,0.08)', i, -8, 1, 13);
      x.beginPath(); x.moveTo(7, -5); x.lineTo(16, -5); x.lineTo(21, 1); x.lineTo(21, 9); x.lineTo(7, 9); x.closePath(); fill('#c62828');
      x.beginPath(); x.moveTo(10, -3); x.lineTo(15.5, -3); x.lineTo(19, 1.5); x.lineTo(10, 1.5); x.closePath(); fill('#90caf9');
      rect('#9e9e9e', 8.5, -11, 1.6, 7); // escape
      for (const wx of [-16, -10, 12, 18]) { circ('#212121', wx, 10.5, 3.2); circ('#9e9e9e', wx, 10.5, 1.3); }
    }],
    'Aeropuerto de Tijuana': ['#1565c0', () => { // avion visto desde abajo
      x.save(); x.rotate(-0.6);
      ell('#fafafa', 0, 0, 4, 21); // fuselaje
      poly('#e3f2fd', [[-3, -3], [-22, 6], [-22, 9], [-3, 4]]); poly('#e3f2fd', [[3, -3], [22, 6], [22, 9], [3, 4]]);
      poly('#e3f2fd', [[-2, 14], [-9, 19], [-9, 21], [-1, 18]]); poly('#e3f2fd', [[2, 14], [9, 19], [9, 21], [1, 18]]);
      ell('#90a4ae', -11, 5, 1.8, 3.5); ell('#90a4ae', 11, 5, 1.8, 3.5); // turbinas
      ell('#1e88e5', 0, -16, 2.2, 2.6); rect('#1e88e5', -0.5, -12, 1, 24);
      x.restore();
    }],
    'UABC Campus Tijuana': ['#00695c', () => { // birrete con borla
      poly('#1b1b1b', [[0, -12], [22, -3], [0, 6], [-22, -3]]);
      x.beginPath(); x.moveTo(-12, 1); x.lineTo(-12, 9); x.quadraticCurveTo(0, 16, 12, 9); x.lineTo(12, 1); x.lineTo(0, 6); x.closePath(); fill('#2b2b2b');
      line('#ffd23f', 1.2, [[0, -3], [16, 2], [16, 13]]); circ('#ffd23f', 16, 14, 2.2);
      circ('#ffd23f', 0, -3, 1.6);
    }],
    'Tecnológico de Tijuana': ['#1a237e', () => { // engrane
      x.beginPath();
      for (let i = 0; i < 24; i++) { const a = i / 24 * Math.PI * 2, r = i % 2 ? 15 : 19.5, b0 = a - 0.11, b1 = a + 0.11; x.lineTo(Math.cos(b0) * r, Math.sin(b0) * r); x.lineTo(Math.cos(b1) * r, Math.sin(b1) * r); }
      x.closePath(); fill('#b0bec5');
      circ('#eceff1', 0, 0, 11); circ('#1a237e', 0, 0, 6); circ('rgba(255,255,255,0.35)', -3, -3, 2);
    }],
    'Central Camionera': ['#6d4c41', () => { // camion de pasajeros de frente
      x.beginPath(); x.roundRect(-15, -19, 30, 34, 4); fill('#f5f5f5');
      rect('#1565c0', -15, -19, 30, 5); rect('#1565c0', -15, 7, 30, 3);
      x.beginPath(); x.roundRect(-12, -12, 24, 15, 2); fill('#4fc3f7'); line('#0277bd', 1, [[0, -12], [0, 3]]);
      circ('#ffee58', -10, 11, 2); circ('#ffee58', 10, 11, 2); rect('#424242', -5, 10, 10, 2);
      rect('#212121', -13, 15, 5, 5); rect('#212121', 8, 15, 5, 5);
      txt('#fff', 3.4, 'TIJUANA', 0, -16.5);
    }],
    'Las 5 y 10': ['#c2185b', () => { // semaforo junto al letrero del crucero
      x.beginPath(); x.roundRect(-20, -8, 26, 16, 3); fill('#2e7d32'); x.strokeStyle = '#fff'; x.lineWidth = 1; x.stroke();
      txt('#fff', 9, '5 y 10', -7, 0.5);
      x.beginPath(); x.roundRect(9, -17, 10, 28, 3); fill('#212121');
      circ('#e53935', 14, -11, 3); circ('#5d4037', 14, -3, 3); circ('#5d4037', 14, 5, 3);
      rect('#424242', 13, 11, 2, 9);
    }],
    'Museo El Trompo': ['#e65100', () => { // trompo bailando con su cordon
      x.beginPath(); x.moveTo(0, 19); x.lineTo(-14, -2); x.quadraticCurveTo(0, -14, 14, -2); x.closePath(); fill('#ff9800');
      x.save(); x.clip(); for (let i = -2; i < 3; i++) rect(i % 2 ? '#ffe0b2' : '#ef6c00', i * 6 - 3, -15, 3, 36); x.restore();
      ell('#ffcc80', 0, -4, 14, 4.5); rect('#8d6e63', -1.5, -14, 3, 9); circ('#5d4037', 0, -14, 2);
      line('#795548', 1.4, [[0, 19], [0, 22]]);
      line('#fff8e1', 1, [[-6, -6], [-14, -14], [-19, -9], [-15, -18]]);
      line('rgba(255,255,255,0.7)', 1, [[-22, 14], [-14, 18]]); line('rgba(255,255,255,0.7)', 1, [[14, 18], [22, 14]]);
    }],
    'Parque Morelos': ['#2e7d32', () => { // lago con lancha y arboles
      ell('#42a5f5', 0, 8, 20, 9); ell('#90caf9', -5, 5, 8, 2.5);
      x.beginPath(); x.moveTo(-5, 9); x.lineTo(7, 9); x.lineTo(5, 13); x.lineTo(-3, 13); x.closePath(); fill('#ff7043');
      line('#5d4037', 1, [[1, 9], [1, 3]]); poly('#fff', [[1.5, 3], [6, 7.5], [1.5, 7.5]]);
      for (const [tx, ty, r] of [[-13, -9, 7], [-3, -13, 8], [9, -10, 7], [17, -4, 5]]) { rect('#5d4037', tx - 1, ty + r - 3, 2, 5); circ('#66bb6a', tx, ty, r); circ('rgba(255,255,255,0.18)', tx - r / 3, ty - r / 3, r / 2.5); }
    }],
    'CEART Tijuana': ['#880e4f', () => { // telon rojo con reflector
      rect('#4a148c', -20, -16, 40, 32);
      x.beginPath(); x.moveTo(-22, -18); x.lineTo(-4, -18); x.quadraticCurveTo(-6, 0, -16, 18); x.lineTo(-22, 18); x.closePath(); fill('#c62828');
      x.beginPath(); x.moveTo(22, -18); x.lineTo(4, -18); x.quadraticCurveTo(6, 0, 16, 18); x.lineTo(22, 18); x.closePath(); fill('#c62828');
      for (const sx of [-1, 1]) for (let i = 0; i < 3; i++) line('rgba(0,0,0,0.25)', 0.8, [[sx * (18 - i * 4), -18], [sx * (19 - i * 3), 18]]);
      rect('#ffd23f', -22, -20, 44, 4);
      poly('rgba(255,245,157,0.45)', [[0, -16], [-7, 16], [7, 16]]);
      circ('#ffd23f', 0, 3, 2.2); line('#ffd23f', 1.2, [[0, 5], [0, 11]]); line('#ffd23f', 1, [[0, 7], [-3, 4]]); line('#ffd23f', 1, [[0, 7], [3, 4]]);
    }],
    // fase 2: Diaz Ordaz, Cerro Colorado y la Presa
    'Mundo Divertido': ['#6a1b9a', () => { // rueda de la fortuna
      line('#b0bec5', 2, [[0, 0], [-10, 20]]); line('#b0bec5', 2, [[0, 0], [10, 20]]); rect('#78909c', -14, 19, 28, 2.5);
      ring('#eceff1', 1.6, 0, 0, 15);
      for (let i = 0; i < 8; i++) { const a = i / 8 * Math.PI * 2; line('rgba(236,239,241,0.8)', 0.8, [[0, 0], [Math.cos(a) * 15, Math.sin(a) * 15]]); }
      ['#e53935', '#fdd835', '#43a047', '#1e88e5', '#fb8c00', '#8e24aa', '#00acc1', '#f06292'].forEach((c, i) => { const a = i / 8 * Math.PI * 2; x.beginPath(); x.roundRect(Math.cos(a) * 15 - 2.6, Math.sin(a) * 15 - 1, 5.2, 4.6, 1.2); fill(c); });
      circ('#ffd23f', 0, 0, 2.4);
    }],
    'Macroplaza': ['#ad1457', () => { // carrito del super con bolsas
      line('#eceff1', 1.8, [[-19, -12], [-13, -12], [-8, 8], [13, 8]]);
      poly('#eceff1', [[-12, -6], [17, -6], [13, 4], [-9, 4]]);
      x.save(); x.beginPath(); x.moveTo(-12, -6); x.lineTo(17, -6); x.lineTo(13, 4); x.lineTo(-9, 4); x.closePath(); x.clip();
      for (let i = -10; i < 18; i += 4) line('#ad1457', 0.8, [[i, -6], [i - 2, 4]]); x.restore();
      poly('#ffd23f', [[-6, -6], [-4, -15], [4, -15], [6, -6]]); poly('#4fc3f7', [[5, -6], [7, -12], [13, -12], [14, -6]]);
      circ('#263238', -6, 13, 2.6); circ('#263238', 11, 13, 2.6);
    }],
    'Estadio de los Toros': ['#b71c1c', () => { // pelota de beisbol y bat
      x.save(); x.rotate(-0.8); x.beginPath(); x.roundRect(-3, -22, 6, 30, 3); fill('#c8a26a'); rect('#8d6e63', -2, 4, 4, 8); circ('#8d6e63', 0, 13, 3); x.restore();
      circ('#fafafa', 4, 3, 12); ring('rgba(0,0,0,0.15)', 1, 4, 3, 12);
      // costuras: dos curvas cerca de las orillas, con sus puntadas
      for (const [cx2, a0] of [[-12, 0], [20, Math.PI]]) {
        ring('#e53935', 1.1, cx2, 3, 12.5, a0 - 0.75, a0 + 0.75);
        for (let k = -3; k <= 3; k++) { const a = a0 + k * 0.2, px = cx2 + Math.cos(a) * 12.5, py = 3 + Math.sin(a) * 12.5, nx = Math.cos(a), ny = Math.sin(a);
          line('#e53935', 0.6, [[px - ny * 1.3 - nx * 0.8, py + nx * 1.3 - ny * 0.8], [px - ny * 1.3 + nx * 0.8, py + nx * 1.3 + ny * 0.8]]); }
      }
    }],
    'Mirador del Cerro Colorado': ['#e65100', () => { // cerro rojizo, la ciudad abajo y el catalejo del mirador
      circ('#fff59d', -10, -10, 6);
      poly('#c1440e', [[-24, 14], [-4, -8], [6, 0], [12, -4], [24, 14]]); poly('#8d2c0a', [[-4, -8], [2, -2], [-6, 14], [-24, 14]]);
      for (let i = 0; i < 7; i++) rect('rgba(255,255,255,0.7)', -16 + i * 5, 10 - (i % 3) * 2, 2.5, 4 + (i % 3) * 2);
      line('#37474f', 1.6, [[12, -4], [12, -14]]); x.save(); x.translate(12, -15); x.rotate(-0.4); x.beginPath(); x.roundRect(-6, -2.2, 12, 4.4, 1.5); fill('#546e7a'); circ('#90caf9', -6, 0, 2); x.restore();
    }],
    'Presa Rodríguez': ['#0277bd', () => { // la cortina de la presa con el agua detras
      x.beginPath(); x.moveTo(-24, -4); x.quadraticCurveTo(0, -14, 24, -4); x.lineTo(24, -24); x.lineTo(-24, -24); x.closePath(); fill('#4fc3f7');
      for (let i = 0; i < 4; i++) line('rgba(255,255,255,0.6)', 1, [[-14 + i * 8, -18 + (i % 2) * 3], [-9 + i * 8, -18 + (i % 2) * 3]]);
      x.beginPath(); x.moveTo(-24, -4); x.quadraticCurveTo(0, -14, 24, -4); x.lineTo(20, 16); x.quadraticCurveTo(0, 8, -20, 16); x.closePath(); fill('#cfd8dc');
      for (let i = -16; i <= 16; i += 6.4) line('#90a4ae', 1.1, [[i, -7 - (1 - (i / 24) ** 2) * 2], [i * 0.85, 12 - (1 - (i / 20) ** 2) * 3]]);
      line('#eceff1', 1.2, [[-24, -4], [-12, -8.5], [0, -9], [12, -8.5], [24, -4]]);
      x.beginPath(); x.moveTo(-6, 13); x.quadraticCurveTo(0, 22, 6, 13); fill('#81d4fa');
    }],
    // fase 3: Playas y la Escenica
    'Casa de la Cultura': ['#795548', () => { // edificio de los años 30 con ventanas de arco y una nota musical
      rect('#efebe9', -18, -8, 36, 22); poly('#d7ccc8', [[-20, -8], [0, -18], [20, -8]]);
      for (const wx of [-13, -4, 5]) { x.beginPath(); x.moveTo(wx, 6); x.lineTo(wx, -1); x.arc(wx + 3.5, -1, 3.5, Math.PI, 0); x.lineTo(wx + 7, 6); x.closePath(); fill('#5d4037'); }
      rect('#8d6e63', -2, 7, 4, 7); rect('#a1887f', -20, 14, 40, 2);
      circ('#ffd23f', 13, -14, 2); line('#ffd23f', 1.2, [[14.8, -14], [14.8, -21], [18, -19.5]]);
    }],
    'El Muro en la Playa': ['#0277bd', () => { // la reja que entra al mar, con murales
      rect('#ffe0b2', -24, 6, 48, 18); x.beginPath(); x.moveTo(-24, 6); x.quadraticCurveTo(0, 2, 24, 8); x.lineTo(24, 24); x.lineTo(-24, 24); x.closePath(); fill('#4fc3f7');
      line('rgba(255,255,255,0.8)', 1, [[-22, 9], [-14, 7.5], [-6, 9]]); line('rgba(255,255,255,0.8)', 1, [[2, 10], [10, 8.5], [18, 10]]);
      const cs = ['#e53935', '#fdd835', '#43a047', '#1e88e5', '#8e24aa', '#fb8c00'];
      for (let i = 0; i < 12; i++) { const xx = -21 + i * 3.8, top = -18 + i * 0.6, bot = 16 - Math.max(0, i - 5) * 1.2; rect(cs[i % cs.length], xx, top, 2.2, bot - top); }
      rect('rgba(0,0,0,0.25)', -22, -18, 46, 1.4);
    }],
    'Faro de Playas': ['#1565c0', () => { // faro blanco con franjas rojas y su luz
      poly('rgba(255,245,157,0.45)', [[0, -15], [-22, -24], [-22, -8]]); poly('rgba(255,245,157,0.45)', [[0, -15], [22, -24], [22, -8]]);
      poly('#fafafa', [[-5, -12], [5, -12], [8, 18], [-8, 18]]);
      x.save(); x.beginPath(); x.moveTo(-5, -12); x.lineTo(5, -12); x.lineTo(8, 18); x.lineTo(-8, 18); x.closePath(); x.clip();
      for (let i = 0; i < 3; i++) rect('#e53935', -10, -6 + i * 9, 20, 4); x.restore();
      rect('#37474f', -6, -15, 12, 3); circ('#fff59d', 0, -18, 3.5); poly('#37474f', [[-4, -20], [4, -20], [0, -25]]);
      rect('#795548', -11, 18, 22, 3);
    }],
    'Malecón de Playas': ['#ef6c00', () => { // atardecer en el mar con palmera
      x.save(); x.beginPath(); x.arc(0, 0, 24, 0, 7); x.clip();
      rect('#ffb74d', -24, -24, 48, 24); circ('#fff176', 2, 2, 9); rect('#0288d1', -24, 2, 48, 22);
      for (let i = 0; i < 4; i++) rect('rgba(255,241,118,0.7)', -6 + i % 2 * 2, 5 + i * 3, 16 - i * 3, 1.2);
      x.restore();
      line('#6d4c41', 2.2, [[-13, 18], [-11, 4], [-13, -8]]);
      for (const a of [-2.6, -2, -1.2, -0.5, 0.2]) line('#2e7d32', 2.4, [[-13, -8], [-13 + Math.cos(a) * 10, -8 + Math.sin(a) * 7 + 3]]);
    }],
    'El Colef': ['#00695c', () => { // libro abierto frente al mar
      rect('#4fc3f7', -22, -18, 44, 12); circ('#fff176', 12, -14, 3.2);
      poly('#fafafa', [[0, -2], [-20, -6], [-20, 16], [0, 19]]); poly('#eceff1', [[0, -2], [20, -6], [20, 16], [0, 19]]);
      line('#90a4ae', 1, [[0, -2], [0, 19]]);
      for (let i = 0; i < 4; i++) { line('#b0bec5', 0.8, [[-17, -1 + i * 4], [-3, 1.5 + i * 4]]); line('#b0bec5', 0.8, [[3, 1.5 + i * 4], [17, -1 + i * 4]]); }
    }],
    // fase 4: las orillas
    'Santa Fe': ['#5d4037', () => { // filas de casitas iguales
      for (let r = 0; r < 3; r++) for (let c = 0; c < 4; c++) {
        const hx = -19 + c * 10 + (r % 2) * 2, hy = -12 + r * 11;
        rect(['#ffe0b2', '#ffccbc', '#fff9c4'][r], hx, hy, 8, 6); poly('#bf360c', [[hx - 1, hy], [hx + 4, hy - 4], [hx + 9, hy]]); rect('#6d4c41', hx + 3, hy + 3, 2, 3);
      }
    }],
    'San Antonio del Mar': ['#0277bd', () => { // casa en el acantilado frente al mar
      rect('#4fc3f7', -24, 2, 48, 22);
      for (let i = 0; i < 3; i++) line('rgba(255,255,255,0.8)', 1.2, [[-22 + i * 6, 8 + i * 5], [-16 + i * 6, 6 + i * 5], [-10 + i * 6, 8 + i * 5]]);
      poly('#a1887f', [[0, 24], [4, 4], [24, 2], [24, 24]]);
      rect('#fafafa', 8, -8, 13, 11); poly('#e53935', [[6, -8], [14.5, -15], [23, -8]]); rect('#4fc3f7', 10, -5, 4, 4); rect('#795548', 16, -4, 3, 7);
      circ('#fff176', -12, -12, 5);
    }],
    'Mirador del Cañón del Sainz': ['#6d4c41', () => { // el canon entre cerros, con el sol
      circ('#ffcc80', 0, -12, 6);
      poly('#a1887f', [[-24, -4], [-10, -6], [-3, 18], [-24, 18]]); poly('#8d6e63', [[24, -2], [9, -5], [3, 18], [24, 18]]);
      poly('#5d4037', [[-10, -6], [-3, 18], [3, 18], [9, -5], [0, 4]]);
      line('#66bb6a', 1.4, [[-20, -4], [-17, -6]]); line('#66bb6a', 1.4, [[15, -3], [19, -5]]);
      rect('#37474f', -16, -10, 1.5, 6); rect('#37474f', -19, -11, 7, 1.5); // barandal del mirador
    }],
    'Natura': ['#2e7d32', () => { // aguila con las alas abiertas
      x.beginPath(); x.moveTo(0, -6);
      x.quadraticCurveTo(-10, -16, -24, -8); x.lineTo(-17, -6); x.lineTo(-21, -2); x.lineTo(-13, -2); x.lineTo(-15, 2); x.quadraticCurveTo(-6, 0, -3, 6);
      x.lineTo(-5, 16); x.lineTo(0, 13); x.lineTo(5, 16); x.lineTo(3, 6);
      x.quadraticCurveTo(6, 0, 15, 2); x.lineTo(13, -2); x.lineTo(21, -2); x.lineTo(17, -6); x.lineTo(24, -8); x.quadraticCurveTo(10, -16, 0, -6); x.closePath(); fill('#5d4037');
      circ('#fafafa', 0, -8, 3.4); poly('#ffb300', [[1.5, -8], [5.5, -7], [1.5, -5.6]]); circ('#212121', 0.6, -9, 0.7);
    }],
    'El Florido': ['#c2185b', () => { // flor grande con sus petalos
      for (let i = 0; i < 8; i++) { const a = i / 8 * Math.PI * 2; ell(i % 2 ? '#f48fb1' : '#f06292', Math.cos(a) * 10, Math.sin(a) * 10 - 2, 7, 4.2, a); }
      circ('#ffd54f', 0, -2, 6); circ('#ffb300', 0, -2, 3.5);
      line('#43a047', 2, [[0, 6], [0, 20]]); ell('#66bb6a', 5, 15, 4, 2, -0.5);
    }],
    'Universidad Tecnológica': ['#283593', () => { // foco encendido
      for (let i = 0; i < 7; i++) { const a = -Math.PI + i * Math.PI / 6; line('rgba(255,241,118,0.8)', 1.4, [[Math.cos(a) * 15, -4 + Math.sin(a) * 15], [Math.cos(a) * 20, -4 + Math.sin(a) * 20]]); }
      circ('#fff176', 0, -4, 11); x.beginPath(); x.moveTo(-6, 4); x.lineTo(-4, 11); x.lineTo(4, 11); x.lineTo(6, 4); x.closePath(); fill('#fff176');
      line('#f9a825', 1, [[-3, 0], [-1.5, -5], [0, 0], [1.5, -5], [3, 0]]);
      rect('#90a4ae', -4.5, 11, 9, 3); rect('#78909c', -4.5, 14, 9, 3); rect('#546e7a', -2.5, 17, 5, 2);
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
// el punto de la orilla de un canal (como el del rio Tijuana) mas cercano a (x, y), con su direccion hacia adentro y
// lo que mide su talud (b) y su piso (f) antes del agua (ver pintarCanal)
function lugarEnCanal(x, y) {
  let best = null;
  for (const a of areas) {
    if (!a.canal || x < a.bb[0] - 600 || x > a.bb[2] + 600 || y < a.bb[1] - 600 || y > a.bb[3] + 600) continue;
    const p = a.p, n = p.length / 2;
    for (let i = 0; i < n; i++) {
      const x0 = p[i * 2], y0 = p[i * 2 + 1], x1 = p[(i + 1) % n * 2], y1 = p[(i + 1) % n * 2 + 1], dx = x1 - x0, dy = y1 - y0, l2 = dx * dx + dy * dy || 1;
      const t = Math.max(0.2, Math.min(0.8, ((x - x0) * dx + (y - y0) * dy) / l2)), qx = x0 + dx * t, qy = y0 + dy * t, d = Math.hypot(x - qx, y - qy);
      if (best && d >= best.d) continue;
      const l = Math.sqrt(l2); let nx = -dy / l, ny = dx / l;
      if (!pip(qx + nx * 4, qy + ny * 4, p)) { nx = -nx; ny = -ny; }
      // que quepa: el agua tiene que seguir adentro del canal
      if (!pip(qx + nx * (a.canal.b + a.canal.f + 20), qy + ny * (a.canal.b + a.canal.f + 20), p)) continue;
      best = { d, x: qx, y: qy, nx, ny, b: a.canal.b, f: a.canal.f };
    }
  }
  return best;
}
// la patrulla de cachorros: seis perritos con chalequito y casco de colores jalando una soga (de arriba hacia abajo:
// los perritos y luego la soga hasta el agua, L px mas abajo). Mirando hacia arriba (-y); en px del mundo, a 5x
const CACHORROS = [ // pelo, pelo oscuro, chaleco/casco
  ['#a8743f', '#5b3a1e', '#1e5bd8'], ['#f4f1ea', '#2b2b2b', '#d62828'], ['#d9b27c', '#8d6a3f', '#f2c230'],
  ['#9aa0a6', '#5f6368', '#2e9e44'], ['#6d4527', '#3e2614', '#f57c1f'], ['#efd9b4', '#b8956a', '#f06ba8'],
];
function makeCachorros(scene, L) {
  const K = 1.9, W = 60, H = Math.ceil(L + 40), t = scene.textures.createCanvas('egg_cachorros', W * 5, H * 5), x = t.getContext(); // K: del tamaño de los perros de la calle
  x.scale(5, 5);
  const ell = (c, cx, cy, rx, ry, a) => { x.fillStyle = c; x.beginPath(); x.ellipse(cx, cy, rx, ry, a || 0, 0, 7); x.fill(); };
  const cx = W / 2, top = 12, py = top + L; // la cabeza del primero y el señor en el agua
  // la soga, de las manos del señor a la boca del primero, con su torcido
  x.lineCap = 'round';
  const soga = (c, w, o) => { x.strokeStyle = c; x.lineWidth = w; x.beginPath(); x.moveTo(cx + o, py - 3 * K); x.quadraticCurveTo(cx + 3 + o, (top + py) / 2 + 8, cx + o, top - 2 * K); x.stroke(); };
  soga('rgba(0,0,0,0.3)', 2, 1.4); soga('#b98a4e', 1.6, 0); x.setLineDash([1, 1.5]); soga('#7a5428', 0.8, 0); x.setLineDash([]);
  // los cachorros en fila, uno de cada lado de la soga, echados para atras jalando
  CACHORROS.forEach(([pelo, oscuro, col], i) => {
    const lado = i % 2 ? 1 : -1, dx = cx + lado * 3.4 * K, dy = top + (2 + i * 6.2) * K, a = lado * 0.18;
    x.save(); x.translate(dx, dy); x.rotate(a); x.scale(K, K);
    ell('rgba(0,0,0,0.3)', 1, 1.4, 3, 4.6);
    for (const [px, pyy] of [[-2.1, -1.6], [2.1, -1.6], [-2, 2.8], [2, 2.8]]) ell(oscuro, px, pyy, 0.9, 1.2); // patas abiertas, haciendo fuerza
    ell(pelo, 0, 1, 2.5, 3.8); // cuerpo
    if (i === 1) for (const [sx, sy] of [[-1, 2.6], [1.2, 0.4], [0.3, 3.6], [-1.3, -0.2]]) ell('#2b2b2b', sx, sy, 0.45, 0.4); // manchas
    x.fillStyle = col; x.beginPath(); x.roundRect(-2.2, -1.4, 4.4, 3.6, 0.9); x.fill(); // chaleco
    x.fillStyle = 'rgba(255,255,255,0.85)'; x.beginPath(); x.arc(0, 0.4, 0.9, 0, 7); x.fill(); // placa
    x.fillStyle = col; x.beginPath(); x.arc(0, 0.4, 0.45, 0, 7); x.fill();
    x.strokeStyle = oscuro; x.lineWidth = 0.7; x.beginPath(); x.moveTo(0, 4.6); x.quadraticCurveTo(lado * 1.4, 5.8, lado * 0.6, 7); x.stroke(); // cola
    ell(pelo, 0, -3.6, 2, 1.9); // cabeza
    ell(oscuro, -1.8, -3.4, 0.8, 1.4, -0.4); ell(oscuro, 1.8, -3.4, 0.8, 1.4, 0.4); // orejas
    x.fillStyle = col; x.beginPath(); x.arc(0, -3.9, 1.65, Math.PI, 0); x.fill(); // casco
    ell(pelo, -lado * 0.9, -5.2, 0.9, 0.8); ell('#1b1b1b', -lado * 1.1, -5.9, 0.4, 0.3); // hocico mordiendo la soga
    x.restore();
  });
  x.save(); x.translate(cx, py); x.scale(K, K); x.translate(-cx, -py);
  // el agua alrededor del señor: ondas y espuma
  for (const [r, al] of [[9, 0.25], [6.5, 0.4], [4.2, 0.55]]) { x.strokeStyle = 'rgba(235,245,240,' + al + ')'; x.lineWidth = 0.5; x.beginPath(); x.ellipse(cx, py + 1, r, r * 0.6, 0, 0, 7); x.stroke(); }
  // el señor, con el agua hasta el pecho: los hombros apenas, las manos agarrando la soga y la cara de susto
  ell('rgba(60,90,80,0.55)', cx, py + 2.4, 4.4, 2.4);
  ell('#3b6ea5', cx, py + 2, 3.6, 1.8); // la camisa mojada
  x.strokeStyle = '#d8a27a'; x.lineWidth = 1.1; x.beginPath(); x.moveTo(cx - 3, py + 1.6); x.lineTo(cx - 0.6, py - 2.6); x.moveTo(cx + 3, py + 1.6); x.lineTo(cx + 0.6, py - 2.6); x.stroke();
  ell('#d8a27a', cx - 0.5, py - 2.8, 0.8, 0.8); ell('#d8a27a', cx + 0.5, py - 2.8, 0.8, 0.8); // las manos
  ell('#d8a27a', cx, py + 0.4, 2, 2); ell('#2a1c14', cx, py + 1, 2, 1.3); // cabeza con pelo
  ell('rgba(255,255,255,0.8)', cx + 3.8, py - 0.5, 0.6, 0.4); ell('rgba(255,255,255,0.8)', cx - 4, py + 2.6, 0.5, 0.35); // gotitas
  // la chancla flotando
  x.save(); x.translate(cx + 6.5, py + 4.5); x.rotate(0.6); ell('#ffd600', 0, 0, 1, 2.2); x.fillStyle = '#1565c0'; x.fillRect(-1, -0.6, 2, 0.6); x.restore();
  x.restore();
  t.refresh();
  return { W, H, top, py };
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
    payaso(x0) { // la bailarina sin cabeza: un fantasma de los tiempos del casino girando con su vestido de lentejuelas
      // resplandor fantasmal
      x.fillStyle = rad(16, 16, 15.5, 'rgba(210,235,255,0.6)', 'rgba(120,160,255,0)'); x.beginPath(); x.arc(16, 16, 15.5, 0, 7); x.fill();
      x.globalAlpha = 0.88;
      // falda de vuelo abierta por el giro, en gajos de dos tonos y holan festoneado
      for (let i = 0; i < 12; i++) { const a = i / 12 * Math.PI * 2 + 0.2; x.fillStyle = i % 2 ? '#d81b60' : '#ad1457'; x.beginPath(); x.moveTo(16, 16); x.arc(16, 16, 11, a, a + Math.PI / 6 + 0.02); x.closePath(); x.fill(); }
      for (let i = 0; i < 24; i++) { const a = i / 24 * Math.PI * 2; ell('#f8bbd0', 16 + Math.cos(a) * 11, 16 + Math.sin(a) * 11, 1.5, 1.5); }
      for (let i = 0; i < 34; i++) { const a = i * 2.4, r = 2.5 + (i % 8) * 1.1; ell(i % 3 ? '#fff59d' : '#ffffff', 16 + Math.cos(a) * r, 16 + Math.sin(a) * r, 0.35, 0.35); } // lentejuelas
      x.strokeStyle = 'rgba(255,255,255,0.5)'; x.lineWidth = 0.4; // estela del giro
      for (const r of [12.8, 13.9]) { x.beginPath(); x.arc(16, 16, r, 0.3, 1.9); x.stroke(); x.beginPath(); x.arc(16, 16, r, 3.4, 5); x.stroke(); }
      // brazos en alto, palidos, con guantes largos
      ell('#efe6f5', 11.2, 13.2, 1, 3.4, -0.9); ell('#efe6f5', 20.8, 13.2, 1, 3.4, 0.9);
      ball(9, 11, 1, '#ffffff', '#d1c4e9'); ball(23, 11, 1, '#ffffff', '#d1c4e9');
      // corset y, donde va la cabeza, solo el cuello del vestido y un hilito de niebla
      x.fillStyle = rad(16, 16, 4, '#c2185b', '#6a0d36'); x.beginPath(); x.ellipse(16, 16, 3.8, 2.8, 0, 0, 7); x.fill();
      for (let i = 0; i < 7; i++) ell('#fafafa', 13.6 + i * 0.8, 14.3 + Math.abs(i - 3) * 0.25, 0.35, 0.35); // collar de perlas
      ell('#f8bbd0', 16, 14.2, 1.5, 0.8); ell('#4a0f2a', 16, 14.2, 0.9, 0.45);
      ell('rgba(255,255,255,0.55)', 16, 12.3, 1.2, 1.6); ell('rgba(255,255,255,0.35)', 16.8, 10.2, 1.7, 1.3); ell('rgba(255,255,255,0.18)', 15.6, 8.2, 2.2, 1.4);
      x.globalAlpha = 1;
    },
    alien(x0) { // alien verde de ojos negros, saludando con un taco en la mano; a un lado, su platillo volador estacionado
      shadow(16, 17, 13, 12);
      // platillo: disco metalico con domo de vidrio y lucecitas
      ball(23.5, 22.5, 6.6, '#eceff1', '#78909c', '#455a64');
      x.strokeStyle = 'rgba(0,0,0,0.3)'; x.lineWidth = 0.3; x.beginPath(); x.arc(23.5, 22.5, 4.6, 0, 7); x.stroke();
      ball(23.5, 22.5, 2.9, 'rgba(200,245,250,0.95)', 'rgba(0,151,167,0.9)', '#006064');
      for (let i = 0; i < 8; i++) { const a = i / 8 * Math.PI * 2; ell(i % 2 ? '#76ff03' : '#ffea00', 23.5 + Math.cos(a) * 5.7, 22.5 + Math.sin(a) * 5.7, 0.55, 0.55); }
      // cuerpo flaquito y brazos largos
      shoulders(12, 16, '#aed581', '#558b2f', 4.2, 2.8);
      ell('#8bc34a', 7.6, 17.4, 0.9, 3, 0.5); ball(6.4, 20, 0.9, '#aed581', '#558b2f');
      ell('#8bc34a', 16.6, 12.6, 0.9, 3.2, -0.9); ball(18.8, 10.6, 0.9, '#aed581', '#558b2f');
      // el taco
      x.save(); x.translate(20.6, 8.8); x.rotate(-0.5);
      x.fillStyle = '#f3cf7a'; x.beginPath(); x.arc(0, 0, 2.6, Math.PI, 0); x.closePath(); x.fill();
      x.fillStyle = '#a8401a'; x.beginPath(); x.arc(0, 0, 1.8, Math.PI, 0); x.closePath(); x.fill();
      ell('#43a047', -0.8, -0.9, 0.4, 0.4); ell('#43a047', 0.7, -1.1, 0.4, 0.4); x.restore();
      // cabezota de bulbo con ojos negros rasgados
      x.fillStyle = rad(12, 11, 6, '#c5e1a5', '#689f38'); x.beginPath(); x.ellipse(12, 11.5, 4.6, 5.4, 0, 0, 7); x.fill();
      x.strokeStyle = 'rgba(0,0,0,0.45)'; x.lineWidth = 0.35; x.stroke();
      ell('#0d0d0d', 10, 11, 1.5, 2.5, 0.5); ell('#0d0d0d', 14, 11, 1.5, 2.5, -0.5);
      ell('rgba(255,255,255,0.75)', 9.6, 10.1, 0.4, 0.55); ell('rgba(255,255,255,0.75)', 13.6, 10.1, 0.4, 0.55);
      line('#33691e', 0.3, [[11.2, 14.6], [12, 15], [12.8, 14.6]]); // sonrisita
    },
    gamer(x0) { // gamer en su silla con audifonos con luces, control y una lata de refresco
      shadow(16, 17, 11, 12);
      // silla gamer: respaldo negro con franjas moradas
      x.fillStyle = '#1b1b1b'; x.beginPath(); x.roundRect(9, 18, 14, 11, 2.5); x.fill();
      x.fillStyle = '#8e24aa'; x.fillRect(12, 18.5, 1.6, 10); x.fillRect(18.4, 18.5, 1.6, 10);
      ell('#1b1b1b', 7.6, 17, 1.6, 5); ell('#1b1b1b', 24.4, 17, 1.6, 5); // descansabrazos
      // sudadera con gorro y brazos hacia el control
      shoulders(16, 17, '#5e35b1', '#311b92', 6, 4);
      ell('#4527a0', 16, 19.6, 3.6, 2);
      ell('#5e35b1', 11.6, 13.4, 1.4, 3, -0.4); ell('#5e35b1', 20.4, 13.4, 1.4, 3, 0.4);
      // control con botones
      x.fillStyle = '#eceff1'; x.beginPath(); x.ellipse(13.6, 9.6, 2.2, 2, 0, 0, 7); x.ellipse(18.4, 9.6, 2.2, 2, 0, 0, 7); x.fill();
      x.fillRect(13.6, 8, 4.8, 3); ell('#c99a6b', 12.6, 10.6, 1, 1); ell('#c99a6b', 19.4, 10.6, 1, 1);
      for (const [bx, by, c] of [[18.6, 8.8, '#e53935'], [19.6, 9.8, '#43a047']]) ell(c, bx, by, 0.45, 0.45);
      line('#37474f', 0.6, [[12.6, 9.6], [14.4, 9.6]]); line('#37474f', 0.6, [[13.5, 8.7], [13.5, 10.5]]);
      // cabeza con pelo despeinado y audifonos con luz verde
      ball(16, 16, 2.9, '#3b2414', '#1e120a');
      for (let i = 0; i < 6; i++) { const a = i * 1.05; line('#2a170b', 0.6, [[16 + Math.cos(a) * 2, 16 + Math.sin(a) * 2], [16 + Math.cos(a) * 3.3, 16 + Math.sin(a) * 3.3]]); }
      x.strokeStyle = '#212121'; x.lineWidth = 0.9; x.beginPath(); x.arc(16, 16, 3.3, Math.PI * 0.9, Math.PI * 2.1); x.stroke();
      ball(12.6, 16.4, 1.5, '#424242', '#111'); ball(19.4, 16.4, 1.5, '#424242', '#111');
      ell('#76ff03', 12.6, 16.4, 0.6, 0.6); ell('#76ff03', 19.4, 16.4, 0.6, 0.6);
      // lata de refresco y bolsa de papitas en el suelo
      ball(26, 24, 1.6, '#ef5350', '#b71c1c', '#7f0000'); ell('#cfd8dc', 26, 24, 0.8, 0.8);
      x.fillStyle = '#ffb300'; x.save(); x.translate(5.5, 25); x.rotate(-0.4); x.fillRect(-2, -2.6, 4, 5.2); x.fillStyle = '#e53935'; x.fillRect(-2, -0.6, 4, 1.2); x.restore();
    },
    aviones(x0) { // senor en su silla plegable con binoculares, gorra y su libreta de aviones
      shadow(15, 16, 11, 11);
      // silla plegable de rayas
      x.fillStyle = '#1565c0'; x.fillRect(8.5, 13, 13, 9); x.fillStyle = '#e3f2fd'; for (let i = 0; i < 4; i++) x.fillRect(8.5, 14 + i * 2.2, 13, 0.9);
      line('#90a4ae', 0.6, [[8.3, 12.5], [8.3, 23]]); line('#90a4ae', 0.6, [[21.7, 12.5], [21.7, 23]]);
      // libreta en las piernas
      x.save(); x.translate(15, 23); x.rotate(-0.15); x.fillStyle = '#fff8e1'; x.fillRect(-3, -2, 6, 4);
      for (let i = 0; i < 3; i++) line('#90a4ae', 0.2, [[-2.4, -1 + i * 1.1], [2.4, -1 + i * 1.1]]); x.restore();
      // camisa a cuadros y brazos subiendo los binoculares
      shoulders(15, 15, '#e57373', '#b71c1c', 5.6, 3.6);
      for (let i = 0; i < 4; i++) line('rgba(255,255,255,0.35)', 0.25, [[10.5 + i * 3, 12], [10.5 + i * 3, 18]]);
      ell('#c99a6b', 11, 11, 1.4, 2.4, 0.5); ell('#c99a6b', 19, 11, 1.4, 2.4, -0.5);
      // cabeza con gorra hacia el cielo
      ball(15, 11.5, 3.6, '#d4a373', '#a47148');
      x.fillStyle = '#2e7d32'; x.beginPath(); x.arc(15, 11.8, 3.7, Math.PI, 0); x.fill(); x.fillRect(12.8, 8.9, 4.4, 1.6);
      // binoculares
      x.fillStyle = '#212121'; x.beginPath(); x.roundRect(11.6, 6, 2.6, 4, 0.8); x.roundRect(15.8, 6, 2.6, 4, 0.8); x.fill();
      line('#212121', 0.6, [[14.2, 8], [15.8, 8]]); ell('#80deea', 12.9, 6.2, 0.9, 0.5); ell('#80deea', 17.1, 6.2, 0.9, 0.5);
      // un avioncito pasando
      x.save(); x.translate(25, 4.5); x.rotate(0.4); ell('#eceff1', 0, 0, 3.4, 0.8); x.fillStyle = '#eceff1';
      x.beginPath(); x.moveTo(-0.4, 0); x.lineTo(-1.8, -2.6); x.lineTo(0.6, -0.4); x.lineTo(0.6, 0.4); x.lineTo(-1.8, 2.6); x.closePath(); x.fill(); x.restore();
    },
    elote(x0) { // elote con mayonesa, queso, chile y limon en su palito
      shadow(16, 16, 6, 13);
      x.save(); x.translate(16, 16); x.rotate(0.55);
      line('#c8a26a', 1.2, [[0, 10], [0, 15.5]]); // palito
      x.fillStyle = rad(0, -1, 8, '#ffe082', '#f9a825'); x.beginPath(); x.ellipse(0, -1, 4.8, 11.5, 0, 0, 7); x.fill();
      for (let r = -10; r <= 8; r += 1.6) for (let c = -3; c <= 3; c += 1.5) { if (c * c / 16 + r * r / 120 > 1) continue; ell('rgba(255,248,200,0.7)', c, r, 0.55, 0.65); }
      // mayonesa en zigzag, queso, chile y limon
      x.strokeStyle = '#fffde7'; x.lineWidth = 1; x.beginPath(); for (let i = 0; i <= 10; i++) x.lineTo(i % 2 ? 2.8 : -2.8, -10 + i * 1.9); x.stroke();
      for (let i = 0; i < 26; i++) ell('#fafafa', Math.sin(i * 2.3) * 3.6, -10 + (i * 0.73) % 19, 0.5, 0.4);
      for (let i = 0; i < 30; i++) ell('#d84315', Math.cos(i * 1.7) * 3.8, -11 + (i * 0.67) % 20, 0.32, 0.32);
      x.restore();
      x.fillStyle = '#7cb342'; x.beginPath(); x.moveTo(24, 24); x.arc(24, 24, 3.4, 3.6, 5.6); x.closePath(); x.fill();
      line('#dcedc8', 0.3, [[24, 24], [21.2, 22.4]]);
    },
    pescador(x0) { // senor con sombrero en su cubeta volteada, cana de pescar y la cubeta de los pescados (vacia)
      shadow(15, 17, 11, 11);
      // cana y sedal hacia el agua
      line('#8d6e63', 0.7, [[17, 13], [29, 2]]); line('rgba(255,255,255,0.8)', 0.2, [[29, 2], [30, 9]]); ell('#e53935', 30, 9.2, 0.6, 0.6);
      // cubeta de los pescados, vacia
      ball(6, 24, 3.4, '#90a4ae', '#546e7a', 'rgba(0,0,0,0.4)'); ell('#37474f', 6, 24, 2.6, 2.6); ell('rgba(129,212,250,0.5)', 6, 24, 2, 2);
      // camisa y brazos
      shoulders(15, 16, '#81c784', '#2e7d32', 5.4, 3.5);
      ell('#c99a6b', 18.5, 13.4, 1.2, 2.2, -0.7);
      // sombrero de palma
      ball(15, 14.5, 5.2, '#f3e5ab', '#c8a26a', 'rgba(0,0,0,0.35)'); ball(15, 14.5, 2.8, '#fff3c4', '#d7b56d');
      line('#8d6e63', 0.6, [[12.2, 14.5], [17.8, 14.5]]);
    },
    jonron(x0) { // pelota de beisbol firmada sobre el pasto, con su billete pegado
      shadow(16, 16, 9, 9);
      ell('#66bb6a', 16, 16, 12, 10); for (let i = 0; i < 18; i++) line('#43a047', 0.4, [[6 + i * 1.2, 18 + (i % 3)], [6.5 + i * 1.2, 15.5 + (i % 2)]]);
      ball(16, 15, 7, '#ffffff', '#d6d6d6', 'rgba(0,0,0,0.35)');
      x.strokeStyle = '#e53935'; x.lineWidth = 0.5;
      x.beginPath(); x.arc(9.5, 15, 5.2, -1, 1); x.stroke(); x.beginPath(); x.arc(22.5, 15, 5.2, Math.PI - 1, Math.PI + 1); x.stroke();
      line('#1a237e', 0.35, [[13, 13], [14.5, 12], [15.5, 14], [17, 12.5], [18.5, 14]]); // la firma
      x.save(); x.translate(22, 21); x.rotate(-0.3); x.fillStyle = '#a5d6a7'; x.fillRect(-4, -2, 8, 4); x.strokeStyle = '#2e7d32'; x.lineWidth = 0.3; x.strokeRect(-4, -2, 8, 4);
      x.fillStyle = '#2e7d32'; x.font = 'bold 2.2px sans-serif'; x.textAlign = 'center'; x.fillText('$', 0, 0.8); x.restore();
    },
    surfista(x0) { // surfista acostado en su tabla, con traje de neopreno
      shadow(16, 16, 6, 14);
      x.save(); x.translate(16, 16); x.rotate(0.35);
      x.fillStyle = rad(0, 0, 14, '#fff59d', '#fbc02d'); x.beginPath(); x.ellipse(0, 0, 4.6, 14, 0, 0, 7); x.fill();
      x.strokeStyle = 'rgba(0,0,0,0.35)'; x.lineWidth = 0.35; x.stroke();
      x.fillStyle = '#e53935'; x.fillRect(-0.6, -13, 1.2, 26); x.fillStyle = '#1e88e5'; x.fillRect(-4.4, 4, 8.8, 1.2);
      // el surfista: piernas, cuerpo de neopreno y cabeza mojada
      line('#212121', 1.4, [[-1.2, 4], [-1.6, 11]]); line('#212121', 1.4, [[1.2, 4], [1.6, 11]]);
      x.fillStyle = '#263238'; x.beginPath(); x.ellipse(0, -1, 2.8, 5.4, 0, 0, 7); x.fill();
      line('#263238', 1.1, [[-2.4, -4], [-5.6, -8.5]]); line('#263238', 1.1, [[2.4, -4], [5.6, -8.5]]);
      ball(0, -7.8, 2.2, '#d4a373', '#a47148'); x.fillStyle = '#5d4037'; x.beginPath(); x.arc(0, -8.2, 2.2, Math.PI, 0); x.fill();
      x.restore();
      for (let i = 0; i < 3; i++) line('rgba(255,255,255,0.7)', 0.5, [[3 + i * 2, 29 - i], [8 + i * 2, 28 - i]]);
    },
    pelicano(x0) { // pelicano cafe visto desde arriba, con su picote y un billete
      shadow(16, 17, 9, 12);
      // alas plegadas
      x.fillStyle = rad(16, 18, 9, '#a1887f', '#5d4037'); x.beginPath(); x.ellipse(16, 18, 6.4, 9.5, 0, 0, 7); x.fill();
      for (let i = 0; i < 5; i++) line('rgba(62,39,35,0.6)', 0.35, [[11.5 + i * 0.4, 13 + i * 2.6], [20.5 - i * 0.4, 13 + i * 2.6]]);
      // cola
      x.fillStyle = '#4e342e'; x.beginPath(); x.moveTo(13.5, 26.5); x.lineTo(16, 30.5); x.lineTo(18.5, 26.5); x.closePath(); x.fill();
      // cuello y cabeza blanca con copete amarillo
      ball(16, 8.5, 3.3, '#fafafa', '#cfd8dc', 'rgba(0,0,0,0.3)'); ell('#fdd835', 16, 7.6, 1.4, 1);
      ell('#1a1a1a', 14.6, 8.4, 0.45, 0.45); ell('#1a1a1a', 17.4, 8.4, 0.45, 0.45);
      // picote con su bolsa naranja y el billete
      x.fillStyle = '#ffb74d'; x.beginPath(); x.moveTo(14.8, 5.6); x.lineTo(16, -1.8); x.lineTo(17.2, 5.6); x.closePath(); x.fill();
      x.save(); x.translate(20, 1.5); x.rotate(0.5); x.fillStyle = '#a5d6a7'; x.fillRect(-3, -1.5, 6, 3); x.strokeStyle = '#2e7d32'; x.lineWidth = 0.25; x.strokeRect(-3, -1.5, 6, 3); x.restore();
    },
    venado(x0) { // venado cola blanca visto desde arriba, comiendo pasto
      shadow(16, 17, 8, 13);
      ell('#9ccc65', 16, 4, 6, 3); for (let i = 0; i < 6; i++) line('#689f38', 0.4, [[12 + i * 1.6, 5.5], [12.4 + i * 1.6, 2.5]]);
      // patas
      for (const [px, py] of [[12.5, 12], [19.5, 12], [12.8, 23], [19.2, 23]]) line('#6d4c41', 1.1, [[px, py], [px + (px < 16 ? -1.2 : 1.2), py + 1.5]]);
      // cuerpo con su lomo mas oscuro y la colita blanca
      x.fillStyle = rad(16, 17, 8, '#c8a26a', '#8d6e63'); x.beginPath(); x.ellipse(16, 17.5, 5, 8.5, 0, 0, 7); x.fill();
      ell('rgba(93,64,55,0.5)', 16, 17.5, 1.6, 7); ell('#fafafa', 16, 26.3, 1.6, 1.3);
      // cuello y cabeza agachada hacia el pasto, con orejas y cuernitos
      ell('#a1887f', 16, 9.5, 2.4, 3); ball(16, 6.5, 2.4, '#bcaaa4', '#8d6e63');
      ell('#8d6e63', 13.3, 7.8, 1.6, 0.8, -0.5); ell('#8d6e63', 18.7, 7.8, 1.6, 0.8, 0.5);
      line('#5d4037', 0.5, [[15, 7.5], [13, 10.5], [12, 10]]); line('#5d4037', 0.5, [[17, 7.5], [19, 10.5], [20, 10]]);
      ell('#212121', 16, 4.3, 0.7, 0.5);
      x.save(); x.translate(23.5, 25); x.rotate(0.2); x.fillStyle = '#a5d6a7'; x.fillRect(-3.4, -1.7, 6.8, 3.4); x.strokeStyle = '#2e7d32'; x.lineWidth = 0.25; x.strokeRect(-3.4, -1.7, 6.8, 3.4); x.restore();
    },
    concha(x0) { // concha de abanico rosada en la arena, con un billete enrollado
      ell('#f3e5ab', 16, 17, 13, 11); for (let i = 0; i < 14; i++) ell('rgba(188,170,120,0.6)', 6 + (i * 7) % 20, 9 + (i * 5) % 16, 0.4, 0.4);
      shadow(16, 17, 9, 8);
      x.fillStyle = rad(16, 13, 11, '#ffccbc', '#ef9a9a'); x.beginPath(); x.moveTo(16, 25); x.arc(16, 25, 12, Math.PI * 1.18, Math.PI * 1.82); x.closePath(); x.fill();
      x.strokeStyle = 'rgba(0,0,0,0.3)'; x.lineWidth = 0.35; x.stroke();
      for (let i = 0; i < 9; i++) { const a = Math.PI * 1.2 + i * Math.PI * 0.075; line('rgba(191,54,12,0.45)', 0.45, [[16, 25], [16 + Math.cos(a) * 12, 25 + Math.sin(a) * 12]]); }
      x.fillStyle = '#ef9a9a'; x.fillRect(13, 24, 6, 2.5);
      x.save(); x.translate(16, 19); x.rotate(-0.4); x.fillStyle = '#a5d6a7'; x.beginPath(); x.ellipse(0, 0, 3.2, 1.2, 0, 0, 7); x.fill(); x.strokeStyle = '#2e7d32'; x.lineWidth = 0.25; x.stroke(); x.restore();
    },
    raton(x0) { // botarga de raton amarillo (de dudosa procedencia): orejotas, cachetes, colita, cierre y su letrero de FOTO
      shadow(15, 17, 12, 12);
      // letrero de carton
      x.save(); x.translate(25.5, 24.5); x.rotate(0.25);
      x.fillStyle = '#c8a26a'; x.fillRect(-4.2, -3.2, 8.4, 6.4); x.strokeStyle = '#8d6e63'; x.lineWidth = 0.3; x.strokeRect(-4.2, -3.2, 8.4, 6.4);
      x.fillStyle = '#212121'; x.font = 'bold 2.3px sans-serif'; x.textAlign = 'center'; x.fillText('FOTO', 0, -0.4); x.fillStyle = '#c62828'; x.fillText('$20', 0, 2.1);
      x.restore();
      // colita delgada con rizo
      line('#f9a825', 0.9, [[15, 22], [12.8, 25.5], [15.5, 28.5], [18.6, 27.2]]);
      // patotas y cuerpo de peluche con panza clara y el cierre de la botarga
      ell('#fbc02d', 11, 23.4, 2.3, 1.6); ell('#fbc02d', 19, 23.4, 2.3, 1.6);
      x.fillStyle = rad(15, 18, 7, '#fff176', '#f9a825'); x.beginPath(); x.ellipse(15, 18.2, 6.3, 5.6, 0, 0, 7); x.fill();
      x.strokeStyle = 'rgba(0,0,0,0.4)'; x.lineWidth = 0.35; x.stroke();
      ell('#fff9c4', 15, 19.2, 3.4, 3);
      line('#9e9e9e', 0.35, [[15, 15.6], [15, 23.4]]); for (let i = 0; i < 6; i++) line('#bdbdbd', 0.2, [[14.6, 16.2 + i * 1.2], [15.4, 16.2 + i * 1.2]]);
      // brazos saludando con guantes blancos
      ell('#fdd835', 8.2, 15, 1.6, 2.9, 0.6); ell('#fdd835', 21.8, 15, 1.6, 2.9, -0.6);
      ball(7, 12.8, 1.3, '#ffffff', '#d6d6d6', '#999'); ball(23, 12.8, 1.3, '#ffffff', '#d6d6d6', '#999');
      // orejotas redondas
      ball(9.4, 5.8, 3.3, '#fff176', '#f9a825', 'rgba(0,0,0,0.4)'); ell('#f8bbd0', 9.4, 5.8, 1.9, 1.9);
      ball(20.6, 5.8, 3.3, '#fff176', '#f9a825', 'rgba(0,0,0,0.4)'); ell('#f8bbd0', 20.6, 5.8, 1.9, 1.9);
      // cabezota con un ojo mas grande que el otro (es pirata, pero no le digas)
      x.fillStyle = rad(15, 10.5, 7, '#fff59d', '#fbc02d'); x.beginPath(); x.ellipse(15, 10.8, 6.2, 5.4, 0, 0, 7); x.fill();
      x.strokeStyle = 'rgba(0,0,0,0.4)'; x.lineWidth = 0.35; x.stroke();
      ell('#1a1a1a', 12.7, 10, 0.9, 1.2); ell('#1a1a1a', 17.4, 10.3, 1.2, 1.5);
      ell('#fff', 12.4, 9.6, 0.3, 0.35); ell('#fff', 17, 9.8, 0.4, 0.45);
      ell('#ff8a65', 11, 12.4, 1.2, 0.8); ell('#ff8a65', 19, 12.4, 1.2, 0.8); // cachetes
      ell('#5d4037', 15, 12, 0.8, 0.55); line('#5d4037', 0.3, [[13.8, 13.3], [15, 13.9], [16.2, 13.3]]);
      for (const s of [-1, 1]) for (const dy of [-0.4, 0.5]) line('rgba(93,64,55,0.7)', 0.2, [[15 + s * 1.4, 12.3 + dy * 0.3], [15 + s * 4.2, 12 + dy * 1.6]]); // bigotes
    },
    rodadora(x0) { // rodadora seca hecha bola, con su estela de polvo y un billete enredado
      for (let i = 0; i < 4; i++) ell('rgba(205,180,130,' + (0.35 - i * 0.07) + ')', 8 - i * 2.4, 19 + i * 1.2, 4 - i * 0.6, 2.6 - i * 0.4);
      shadow(18, 17, 9, 8.5);
      ell('rgba(120,90,50,0.35)', 18, 16, 9, 8.6);
      let s = 7;
      const rr = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
      for (let i = 0; i < 70; i++) { // ramitas enredadas
        const a = rr() * 6.3, r = 2 + rr() * 7, b = a + 0.8 + rr() * 1.6, q = 2 + rr() * 7;
        line(i % 3 ? '#a68552' : '#d4b77c', 0.25 + rr() * 0.25, [[18 + Math.cos(a) * r, 16 + Math.sin(a) * r * 0.95], [18 + Math.cos(b) * q, 16 + Math.sin(b) * q * 0.95]]);
      }
      x.save(); x.translate(21, 13); x.rotate(0.7); x.fillStyle = '#a5d6a7'; x.fillRect(-3, -1.4, 6, 2.8); x.strokeStyle = '#2e7d32'; x.lineWidth = 0.25; x.strokeRect(-3, -1.4, 6, 2.8); x.restore();
      line('#8d6e47', 0.35, [[19, 12], [23, 14.5]]); line('#8d6e47', 0.35, [[20.5, 15], [22, 11.5]]); // ramas encima del billete
    },
    mochila(x0) { // senora con su mochila de emergencias naranja a la espalda, linterna y garrafon de agua
      shadow(15, 17, 12, 11);
      // garrafon de agua a un lado
      ball(24.5, 23, 3.4, 'rgba(225,245,255,0.95)', 'rgba(100,170,220,0.9)', '#4a8ab8'); ell('#1e88e5', 24.5, 23, 1.2, 1.2);
      // brazos y la linterna prendida
      ell('#7b5e57', 8, 17.5, 1.5, 3, 0.4); ell('#7b5e57', 21, 13, 1.5, 3, -1.1);
      x.fillStyle = 'rgba(255,245,170,0.45)'; x.beginPath(); x.moveTo(24, 11); x.lineTo(31, 6); x.lineTo(31, 14); x.closePath(); x.fill();
      x.fillStyle = '#424242'; x.fillRect(22.5, 10.3, 2.4, 1.3); ell('#fff59d', 25, 11, 0.5, 0.7);
      // blusa y la mochila encima de la espalda (se ve desde arriba)
      shoulders(14, 15, '#9fa8da', '#5c6bc0', 6, 3.8);
      x.fillStyle = rad(14, 19, 6, '#ffb74d', '#e65100'); x.beginPath(); x.roundRect(9.6, 16, 8.8, 8.5, 2); x.fill();
      x.strokeStyle = '#bf360c'; x.lineWidth = 0.35; x.stroke();
      x.fillStyle = '#ef6c00'; x.beginPath(); x.roundRect(10.8, 20.4, 6.4, 3.4, 1); x.fill();
      line('#fafafa', 0.6, [[12.6, 22.1], [15.4, 22.1]]); line('#e53935', 0.6, [[14, 20.8], [14, 23.4]]); // cruz de primeros auxilios
      line('#5d4037', 0.6, [[11, 16], [10.6, 13]]); line('#5d4037', 0.6, [[17, 16], [17.4, 13]]); // tirantes
      // cabeza con chongo canoso
      ball(14, 12, 3, '#d7ccc8', '#8d8d8d', 'rgba(0,0,0,0.35)'); ball(14, 14.2, 1.4, '#eeeeee', '#9e9e9e');
      ell('#c99a6b', 14, 9.8, 1.8, 1); // frente asomando
    },
    haiti(x0) { // cocinero con gorro blanco, mandil con los colores de Haiti y su plato de arroz con frijol rojo
      shadow(15, 17, 12, 11);
      // brazos sosteniendo el plato
      ell('#5d4037', 8, 18, 1.6, 3.2, 0.3); ell('#5d4037', 20.5, 15, 1.6, 3.2, -0.9);
      // filipina blanca y el mandil azul y rojo
      shoulders(14, 16, '#ffffff', '#cfd8dc', 6.2, 4);
      x.save(); x.beginPath(); x.ellipse(14, 16, 6.2, 4, 0, 0, 7); x.clip();
      x.fillStyle = '#00209f'; x.fillRect(7, 11, 14, 5.4); x.fillStyle = '#d21034'; x.fillRect(7, 16.4, 14, 5); x.restore();
      // el plato: arroz con frijol rojo, platano frito y ensalada picosita
      ball(24, 20, 5, '#ffffff', '#e0e0e0', '#9e9e9e');
      ell('#8d4b3a', 23, 19.6, 3, 2.6); for (let i = 0; i < 16; i++) ell('#5a1f1a', 21 + (i * 7) % 5 + 0.3, 18 + (i * 3) % 4, 0.35, 0.25);
      for (let i = 0; i < 3; i++) ell('#f4b942', 25.6 + i * 0.4, 22 - i * 1.3, 1.2, 0.6, 0.5);
      ell('#e53935', 26.5, 18.2, 0.9, 0.7); ell('#ff8a65', 25.6, 17.3, 0.8, 0.6);
      // cabeza con gorro de chef esponjado
      ball(14, 12, 2.9, '#5d4037', '#3e2723');
      for (let i = 0; i < 6; i++) { const a = i / 6 * Math.PI * 2; ball(14 + Math.cos(a) * 2.3, 11 + Math.sin(a) * 2.3, 2, '#ffffff', '#cfd8dc'); }
      ball(14, 11, 2.4, '#ffffff', '#e0e0e0');
    },
    visa(x0) { // visa laser tirada en el asfalto, con su foto, banda y un billete asomando
      ell('rgba(0,0,0,0.28)', 17.5, 18, 11.5, 8);
      x.save(); x.translate(16, 16); x.rotate(-0.25);
      x.fillStyle = '#e8f1f5'; x.beginPath(); x.roundRect(-11, -7, 22, 14, 1.4); x.fill();
      x.strokeStyle = '#90a4ae'; x.lineWidth = 0.35; x.stroke();
      x.fillStyle = '#1565c0'; x.fillRect(-11, -7, 22, 2.6); x.fillStyle = '#c62828'; x.fillRect(-11, -4.4, 22, 0.6);
      x.fillStyle = '#fff'; x.font = 'bold 2px sans-serif'; x.textAlign = 'center'; x.fillText('VISA', -5, -5);
      x.fillStyle = '#bcaaa4'; x.fillRect(-9.6, -2.8, 6, 7.6); ball(-6.6, -0.4, 1.8, '#d7a983', '#a1785a'); ell('#3e2723', -6.6, -1.6, 1.9, 0.8); ell('#546e7a', -6.6, 4, 2.6, 1.6);
      for (let i = 0; i < 4; i++) { x.fillStyle = '#90a4ae'; x.fillRect(-2, -2.2 + i * 1.7, 11 - (i % 2) * 3, 0.6); }
      for (let i = 0; i < 9; i++) ell(i % 2 ? '#ffd54f' : '#80deea', 4 + i * 0.7, 5 - Math.sin(i) * 0.4, 0.5, 0.5); // holograma
      x.restore();
      x.save(); x.translate(24, 24.5); x.rotate(0.35); x.fillStyle = '#a5d6a7'; x.fillRect(-4, -1.8, 8, 3.6); x.strokeStyle = '#2e7d32'; x.lineWidth = 0.25; x.strokeRect(-4, -1.8, 8, 3.6);
      x.fillStyle = '#2e7d32'; x.font = 'bold 2.2px sans-serif'; x.textAlign = 'center'; x.fillText('$', 0, 0.8); x.restore();
    },
    nortec(x0) { // DJ con audifonos frente a su mesa: dos tornamesas y un acordeon arriba de la mesa
      shadow(16, 18, 13, 11);
      // mesa con dos tornamesas y el mezclador
      x.fillStyle = '#263238'; x.beginPath(); x.roundRect(3, 3, 26, 11, 1.2); x.fill(); x.strokeStyle = '#000'; x.lineWidth = 0.3; x.stroke();
      for (const cx of [8.5, 23.5]) {
        ball(cx, 8.5, 4.2, '#424242', '#111'); for (const r of [3.4, 2.6, 1.8]) { x.strokeStyle = 'rgba(255,255,255,0.12)'; x.lineWidth = 0.2; x.beginPath(); x.arc(cx, 8.5, r, 0, 7); x.stroke(); }
        ell(cx === 8.5 ? '#00e5ff' : '#ff4081', cx, 8.5, 1.2, 1.2); ell('#eee', cx, 8.5, 0.25, 0.25);
        line('#bdbdbd', 0.4, [[cx + 3.8, 4.6], [cx + 2, 7.6]]);
      }
      x.fillStyle = '#37474f'; x.fillRect(13.6, 4.4, 4.8, 8.4); for (let i = 0; i < 3; i++) { ell('#76ff03', 15 + i * 1, 6 + i * 2, 0.4, 0.4); line('#90a4ae', 0.35, [[14.4, 10.8], [17.6, 10.8]]); }
      // brazos sobre las tornamesas y sudadera
      ell('#3949ab', 9, 15, 1.5, 3, -0.6); ell('#3949ab', 23, 15, 1.5, 3, 0.6);
      shoulders(16, 19.5, '#5c6bc0', '#283593', 6.2, 4);
      // cabeza con gorra al reves y audifonos grandes
      ball(16, 18, 3, '#6d4c41', '#3e2723');
      x.fillStyle = '#212121'; x.beginPath(); x.arc(16, 18, 3.1, 0, Math.PI); x.fill(); x.fillRect(14.3, 20.6, 3.4, 1.6); // gorra con la visera para atras
      x.strokeStyle = '#eceff1'; x.lineWidth = 0.6; x.beginPath(); x.arc(16, 18, 3.4, Math.PI * 1.05, Math.PI * 1.95); x.stroke();
      ball(12.5, 18, 1.3, '#ff4081', '#880e4f'); ball(19.5, 18, 1.3, '#ff4081', '#880e4f');
      // notas en el aire
      x.fillStyle = 'rgba(255,255,255,0.85)'; x.font = 'bold 3px sans-serif'; x.textAlign = 'center'; x.fillText('♪', 5, 22); x.fillText('♫', 27, 24);
    },
    chamarra(x0) { // senora con chamarra esponjada y gorro, termo de cafe, entre la neblina del mar
      for (let i = 0; i < 6; i++) ell('rgba(220,228,235,0.35)', 4 + i * 5, 6 + (i % 3) * 9, 7, 3.5);
      shadow(15, 17, 11, 11);
      // brazos esponjados, uno con el termo
      ell('#c62828', 8, 17, 2, 3.4, 0.35); ell('#c62828', 21.5, 14.5, 2, 3.4, -0.8);
      ball(24, 12.6, 1.8, '#90a4ae', '#455a64', '#263238'); ell('rgba(255,255,255,0.55)', 25.5, 10.8, 1.3, 0.8); ell('rgba(255,255,255,0.35)', 26.8, 9.4, 1.6, 0.9); // vapor
      // chamarra con costuras de esponjado
      shoulders(14.5, 16.5, '#ef5350', '#b71c1c', 6.6, 4.4);
      for (let i = -1; i <= 1; i++) { x.strokeStyle = 'rgba(80,0,0,0.45)'; x.lineWidth = 0.3; x.beginPath(); x.ellipse(14.5, 16.5, 6.6 - Math.abs(i) * 0, 4.4, 0, i * 0.5 + 0.6, i * 0.5 + 2.5); x.stroke(); }
      line('#9e9e9e', 0.3, [[14.5, 12.2], [14.5, 20.8]]);
      // gorro tejido con borla
      ball(14.5, 13, 3.1, '#fdd835', '#f57f17', 'rgba(0,0,0,0.35)');
      for (let i = 0; i < 5; i++) line('rgba(140,80,0,0.45)', 0.25, [[12.2 + i * 1.15, 11], [12.2 + i * 1.15, 15]]);
      ball(14.5, 12.4, 1.1, '#ffffff', '#e0e0e0');
    },
    coyote(x0) { // coyote flaco visto desde arriba, volteando, en tierra de cañon con matorral
      ell('#d7c29b', 16, 16, 14, 12); for (let i = 0; i < 12; i++) ell('rgba(140,110,70,0.35)', 4 + (i * 9) % 24, 6 + (i * 7) % 20, 0.6, 0.5);
      for (const [cx, cy] of [[5, 7], [27, 25]]) for (let k = 0; k < 5; k++) ell(k % 2 ? '#6b7d3a' : '#8a9a52', cx + Math.cos(k * 1.3) * 1.6, cy + Math.sin(k * 1.3) * 1.4, 1.6, 1.3);
      shadow(16, 17, 6, 12);
      for (const [px, py, s] of [[13, 10, -1], [19, 10, 1], [13.4, 21, -1], [18.6, 21, 1]]) line('#7a6248', 1, [[px, py], [px + s * 1.4, py + 1.4]]);
      // cola esponjada con la punta negra
      x.fillStyle = rad(17, 26, 4, '#b39b78', '#7a6248'); x.beginPath(); x.ellipse(17.6, 26.6, 1.8, 3.8, -0.25, 0, 7); x.fill(); ell('#2b2118', 18.4, 29.6, 1.1, 1);
      // cuerpo gris pardo con el lomo mas oscuro
      x.fillStyle = rad(16, 16, 8, '#c2ab88', '#8a7356'); x.beginPath(); x.ellipse(16, 16.5, 4.2, 8, 0, 0, 7); x.fill();
      ell('rgba(70,55,40,0.45)', 16, 16, 1.4, 6.5);
      // cabeza volteando a verte, orejas paradas y hocico
      x.save(); x.translate(15.4, 7); x.rotate(-0.45);
      ball(0, 0, 2.6, '#cdb894', '#8a7356'); ell('#b8a07c', 0, -2.8, 1.2, 1.8); ell('#2b2118', 0, -4.4, 0.5, 0.4);
      x.fillStyle = '#9b8466'; for (const s of [-1, 1]) { x.beginPath(); x.moveTo(s * 1, 0.4); x.lineTo(s * 2.8, 2.6); x.lineTo(s * 2.4, -0.6); x.closePath(); x.fill(); }
      ell('#ffca28', -1, -0.9, 0.35, 0.3); ell('#ffca28', 1, -0.9, 0.35, 0.3);
      x.restore();
      x.save(); x.translate(24, 15); x.rotate(-0.3); x.fillStyle = '#a5d6a7'; x.fillRect(-3, -1.4, 6, 2.8); x.strokeStyle = '#2e7d32'; x.lineWidth = 0.25; x.strokeRect(-3, -1.4, 6, 2.8); x.restore();
    },
    mona(x0) { // escultor con martillo y cincel junto a su maqueta de concreto con puertita y ventanas
      shadow(16, 17, 13, 12);
      // la maqueta: bloque de concreto con puerta, ventanitas y polvo alrededor
      for (let i = 0; i < 10; i++) ell('rgba(200,200,200,0.5)', 18 + (i * 7) % 12, 4 + (i * 5) % 12, 0.6, 0.5);
      x.fillStyle = rad(23, 10, 9, '#e0ddd5', '#9e9a90'); x.beginPath(); x.roundRect(17, 3, 12, 13, 2); x.fill();
      x.strokeStyle = 'rgba(0,0,0,0.4)'; x.lineWidth = 0.35; x.stroke();
      x.fillStyle = '#6d4c41'; x.fillRect(21.6, 12.6, 2.8, 3.4); ell('#ffd54f', 24, 14.4, 0.25, 0.25);
      for (const [wx, wy] of [[19, 5], [25.6, 5], [19, 9], [25.6, 9]]) { x.fillStyle = '#4fc3f7'; x.fillRect(wx, wy, 2.2, 2); x.strokeStyle = '#fff'; x.lineWidth = 0.2; x.strokeRect(wx, wy, 2.2, 2); }
      // escultor: overol, brazos con martillo y cincel
      ell('#c99a6b', 9, 13, 1.4, 3, -0.7); ell('#c99a6b', 13.8, 11.6, 1.4, 3, 0.9);
      line('#78909c', 0.6, [[11, 10], [15.6, 8.6]]); x.fillStyle = '#546e7a'; x.fillRect(14.4, 7.4, 2.6, 2.2); // martillo
      line('#b0bec5', 0.5, [[7.6, 10.6], [9.6, 7.2]]); // cincel
      shoulders(11, 17, '#5c7cfa', '#364fc7', 5.6, 3.8);
      line('#364fc7', 0.6, [[8.8, 14], [9.4, 20]]); line('#364fc7', 0.6, [[13.2, 14], [12.6, 20]]);
      // cabeza con pelo blanco y lentes, llena de polvo de cemento
      ball(11, 15.6, 2.8, '#f5f5f5', '#bdbdbd', 'rgba(0,0,0,0.35)'); ell('#c99a6b', 11, 13.4, 1.6, 0.9);
      for (let i = 0; i < 6; i++) ell('rgba(255,255,255,0.7)', 8 + i * 1.3, 18 + (i % 3) * 1.4, 0.4, 0.3);
    },
    topografo(x0) { // topografo de sombrero y saco, con su teodolito en tripie y el plano del pueblo extendido
      shadow(15, 17, 12, 12);
      // plano en el suelo: el rio y las calles del pueblito, con sus diagonales
      x.save(); x.translate(9, 24); x.rotate(-0.15);
      x.fillStyle = '#f3e5c0'; x.fillRect(-7, -4.5, 14, 9); x.strokeStyle = '#a1887f'; x.lineWidth = 0.3; x.strokeRect(-7, -4.5, 14, 9);
      line('#4a90c2', 0.5, [[-7, 3.5], [-2, 1], [3, 2.5], [7, 0.5]]);
      for (let i = -5; i <= 5; i += 2.5) line('#6d4c41', 0.2, [[i, -4], [i, 0.5]]); for (let j = -3.5; j <= 0; j += 1.5) line('#6d4c41', 0.2, [[-6, j], [6, j]]);
      line('#6d4c41', 0.25, [[-5, -4], [0, -1.5], [5, -4]]);
      x.fillStyle = '#5d4037'; x.font = 'bold 1.3px serif'; x.textAlign = 'center'; x.fillText('1889', 4.6, 3.6);
      x.restore();
      ell('#c8a26a', 2.6, 24, 0.9, 4.8); // el rollo
      // tripie con el teodolito de laton
      for (const a of [0.3, 2.4, 4.4]) line('#6d4c41', 0.7, [[23, 9], [23 + Math.cos(a) * 6, 9 + Math.sin(a) * 6]]);
      ball(23, 9, 2.2, '#ffe082', '#b8860b', '#7a5a10'); x.fillStyle = '#5d4037'; x.fillRect(21, 8.4, 4, 1.2); ell('#90caf9', 25, 9, 0.5, 0.5);
      // brazo hacia el aparato y saco cafe de la epoca
      ell('#5d4037', 19, 11.6, 1.5, 3, -1.1); ell('#5d4037', 9.4, 15.6, 1.5, 3, 0.4);
      shoulders(14, 15, '#795548', '#3e2723', 6, 3.9);
      line('#fafafa', 0.6, [[13, 12], [14, 14], [15, 12]]); // cuello de camisa
      // sombrero de ala con cinta
      ball(14, 13, 5, '#a1887f', '#5d4037', 'rgba(0,0,0,0.4)'); ball(14, 13, 2.8, '#8d6e63', '#4e342e');
      x.strokeStyle = '#212121'; x.lineWidth = 0.5; x.beginPath(); x.arc(14, 13, 3, 0, 7); x.stroke();
    },
    // ----- clientes especiales de las entregas (CLIENTES_RAROS): personas paradas viendo hacia abajo (+y) -----
    cholo(x0) { // camisa de cuadros abotonada hasta arriba, cabeza rapada, lentes oscuros y saludando de paz
      shadow(16, 16, 9, 7);
      ell('#c99a6b', 8.4, 18, 1.5, 3, 0.3); ell('#c99a6b', 23.6, 18.4, 1.5, 3, -0.3);
      line('#c99a6b', 0.6, [[24.4, 21], [24.8, 23]]); line('#c99a6b', 0.6, [[25.2, 21], [26.2, 22.8]]); // la paz
      x.save(); x.beginPath(); x.ellipse(16, 16, 7, 4.4, 0, 0, 7); x.clip();
      x.fillStyle = '#5c6f86'; x.fillRect(8, 11, 16, 10);
      for (let i = 0; i < 8; i++) { x.fillStyle = 'rgba(30,40,55,0.55)'; x.fillRect(8.6 + i * 2, 11, 0.8, 10); x.fillRect(8, 12 + i * 1.3, 16, 0.5); }
      x.restore(); x.strokeStyle = 'rgba(0,0,0,0.5)'; x.lineWidth = 0.35; x.beginPath(); x.ellipse(16, 16, 7, 4.4, 0, 0, 7); x.stroke();
      ball(16, 16, 3.3, '#a07a55', '#6d4c33'); // cabeza rapada
      for (let i = 0; i < 16; i++) ell('rgba(30,20,15,0.45)', 13.6 + (i * 7) % 5, 13.6 + (i * 3) % 4, 0.25, 0.25);
      x.fillStyle = '#0d0d0d'; x.beginPath(); x.roundRect(13.3, 18, 5.4, 1.3, 0.5); x.fill(); // lentes
      ell('rgba(255,255,255,0.4)', 14.4, 18.4, 0.6, 0.25);
    },
    robot(x0) { // robot cuadrado de lamina con antena de foquito, visor azul y brazos de manguera
      shadow(16, 16, 9, 7);
      for (const s of [-1, 1]) { line('#78909c', 1.2, [[16 + s * 6.4, 15], [16 + s * 8.4, 18], [16 + s * 7.8, 21]]); ball(16 + s * 7.8, 21.6, 1.2, '#cfd8dc', '#607d8b', '#37474f'); }
      x.fillStyle = rad(16, 15, 9, '#eceff1', '#90a4ae'); x.beginPath(); x.roundRect(9.4, 10.6, 13.2, 9.4, 1.6); x.fill();
      x.strokeStyle = '#455a64'; x.lineWidth = 0.4; x.stroke();
      for (const [a, b] of [[10.4, 11.6], [21.6, 11.6], [10.4, 19], [21.6, 19]]) ell('#607d8b', a, b, 0.35, 0.35); // remaches
      x.fillStyle = '#b0bec5'; x.beginPath(); x.roundRect(12, 12, 8, 6.8, 1); x.fill(); x.strokeStyle = '#546e7a'; x.lineWidth = 0.3; x.stroke(); // cabeza
      x.fillStyle = '#0d47a1'; x.fillRect(12.6, 17, 6.8, 1.6); ell('#4fc3f7', 14.4, 17.8, 0.7, 0.45); ell('#4fc3f7', 17.6, 17.8, 0.7, 0.45);
      line('#455a64', 0.4, [[16, 12], [16, 8.6]]); ball(16, 8, 1, '#ff8a80', '#d50000');
      ell('rgba(255,82,82,0.25)', 16, 8, 2.2, 2.2);
    },
    otaku(x0) { // disfrazado de heroe de anime: peluca de picos amarillos, traje naranja con azul y espada de foami
      shadow(16, 16, 10, 8);
      x.save(); x.translate(23.5, 18); x.rotate(0.5); // espada de foami
      x.fillStyle = '#e0e0e0'; x.fillRect(-0.9, -1, 1.8, 11); x.strokeStyle = '#9e9e9e'; x.lineWidth = 0.3; x.strokeRect(-0.9, -1, 1.8, 11);
      x.fillStyle = '#8d6e63'; x.fillRect(-2.2, -1.8, 4.4, 1); x.fillStyle = '#5d4037'; x.fillRect(-0.6, -5, 1.2, 3.2); x.restore();
      ell('#ff9800', 8.4, 17.6, 1.6, 3, 0.3); ell('#ff9800', 22.6, 16.6, 1.6, 3, -0.6);
      shoulders(16, 16, '#ffb74d', '#ef6c00', 6.6, 4.2);
      x.fillStyle = '#1565c0'; x.fillRect(13, 12.2, 6, 7.6); // chaleco azul
      ell('#c62828', 16, 19.8, 3, 0.7); // la bandita roja
      // peluca de picos
      x.fillStyle = '#ffd600'; x.beginPath();
      for (let i = 0; i < 14; i++) { const a = i / 14 * Math.PI * 2, r = i % 2 ? 2.4 : 5.4; const px = 16 + Math.cos(a) * r, py = 15.4 + Math.sin(a) * r; i ? x.lineTo(px, py) : x.moveTo(px, py); }
      x.closePath(); x.fill(); x.strokeStyle = '#f57f17'; x.lineWidth = 0.35; x.stroke();
      ball(16, 15.4, 2.4, '#fff59d', '#fbc02d');
    },
    xolofan(x0) { // aficionado con la playera rojinegra, bufanda y cara pintada, con su xolo pelon a un lado
      shadow(13, 15, 9, 7); shadow(24, 23, 4, 6);
      // el xolo: gris pelon con su playerita y orejotas
      ell('#5d5d63', 24, 24.5, 2.6, 4.2); x.save(); x.beginPath(); x.ellipse(24, 24.5, 2.6, 4.2, 0, 0, 7); x.clip();
      for (let i = 0; i < 4; i++) { x.fillStyle = i % 2 ? '#111' : '#c62828'; x.fillRect(21, 21.5 + i * 1.3, 6, 1.3); } x.restore();
      line('#4a4a50', 0.5, [[24, 28.6], [25.6, 30.4]]);
      ball(24, 20.2, 1.8, '#6b6b72', '#3f3f45');
      x.fillStyle = '#4a4a50'; for (const s of [-1, 1]) { x.beginPath(); x.moveTo(24 + s * 0.8, 19.4); x.lineTo(24 + s * 2.8, 17); x.lineTo(24 + s * 2, 20); x.closePath(); x.fill(); }
      // el aficionado: brazos arriba con la bufanda estirada
      ell('#c99a6b', 6.4, 12.6, 1.4, 3, -0.6); ell('#c99a6b', 19.6, 12.6, 1.4, 3, 0.6);
      x.save(); x.translate(13, 9); for (let i = 0; i < 9; i++) { x.fillStyle = i % 2 ? '#111' : '#d32f2f'; x.fillRect(-9 + i * 2, -1, 2, 2); } x.restore();
      x.save(); x.beginPath(); x.ellipse(13, 15, 6.6, 4.2, 0, 0, 7); x.clip();
      for (let i = 0; i < 7; i++) { x.fillStyle = i % 2 ? '#111' : '#d32f2f'; x.fillRect(6 + i * 2, 10, 2, 10); } x.restore();
      x.strokeStyle = 'rgba(0,0,0,0.5)'; x.lineWidth = 0.35; x.beginPath(); x.ellipse(13, 15, 6.6, 4.2, 0, 0, 7); x.stroke();
      ball(13, 15, 3, '#c99a6b', '#8d6e4a'); x.fillStyle = '#2b1d14'; x.beginPath(); x.arc(13, 15, 3, Math.PI * 1.05, Math.PI * 1.95); x.fill();
      line('#d32f2f', 0.7, [[11.4, 16.4], [11.4, 17.6]]); line('#111', 0.7, [[14.6, 16.4], [14.6, 17.6]]); // cachetes pintados
    },
    luchador(x0) { // luchador con mascara de colores, capa brillante y cinturon de campeon
      shadow(16, 16, 11, 8);
      x.fillStyle = rad(16, 12, 10, '#ffeb3b', '#c49000'); x.beginPath(); x.moveTo(8, 14); x.quadraticCurveTo(16, 2, 24, 14); x.lineTo(22, 11); x.quadraticCurveTo(16, 6, 10, 11); x.closePath(); x.fill(); // capa
      ell('#d7a07a', 7.4, 17, 2, 3.4, 0.3); ell('#d7a07a', 24.6, 17, 2, 3.4, -0.3);
      shoulders(16, 16, '#e0b08a', '#b07d58', 7.4, 4.6);
      x.fillStyle = '#ffca28'; x.fillRect(11, 19, 10, 1.5); ell('#fff59d', 16, 19.7, 1.6, 1); // cinturon
      // mascara: azul con flamas plateadas y ojos blancos
      ball(16, 15.4, 3.6, '#2979ff', '#0d47a1', '#0a2a6b');
      x.fillStyle = '#e0e0e0'; x.beginPath(); x.moveTo(16, 11.8); x.lineTo(14.6, 14.6); x.lineTo(16, 13.8); x.lineTo(17.4, 14.6); x.closePath(); x.fill();
      ell('#fff', 14.6, 17, 1, 0.6, -0.3); ell('#fff', 17.4, 17, 1, 0.6, 0.3); ell('#111', 14.6, 17.1, 0.4, 0.3); ell('#111', 17.4, 17.1, 0.4, 0.3);
      line('#ff1744', 0.4, [[13, 14], [12.6, 16.6]]); line('#ff1744', 0.4, [[19, 14], [19.4, 16.6]]);
    },
    abuegamer(x0) { // abuelita de chongo con audifonos de diadema y un control en las manos, con su chal tejido
      shadow(16, 16, 9, 7);
      ell('#e1bfa0', 11.6, 20, 1.5, 2.6, 0.6); ell('#e1bfa0', 20.4, 20, 1.5, 2.6, -0.6);
      x.fillStyle = '#37474f'; x.beginPath(); x.roundRect(12, 20.6, 8, 3.2, 1.4); x.fill(); // control
      ell('#ff5252', 18.4, 21.8, 0.45, 0.45); ell('#69f0ae', 17.4, 22.6, 0.45, 0.45); x.fillStyle = '#90a4ae'; x.fillRect(13.2, 21.8, 2, 0.6); x.fillRect(13.9, 21.1, 0.6, 2);
      shoulders(16, 16, '#b39ddb', '#7e57c2', 6.4, 4.2);
      for (let i = 0; i < 6; i++) ell('rgba(255,255,255,0.35)', 11.5 + i * 1.8, 18.6 - Math.abs(i - 2.5) * 0.5, 0.5, 0.5); // chal tejido
      ball(16, 15, 3, '#eeeeee', '#9e9e9e', 'rgba(0,0,0,0.3)'); ball(16, 12.6, 1.5, '#f5f5f5', '#a0a0a0'); // canas y chongo
      ell('#e1bfa0', 16, 17.4, 1.7, 0.9);
      x.strokeStyle = '#212121'; x.lineWidth = 0.7; x.beginPath(); x.arc(16, 15, 3.4, Math.PI * 0.95, Math.PI * 0.05, false); x.stroke();
      ball(12.5, 15.4, 1.3, '#00e5ff', '#006064'); ball(19.5, 15.4, 1.3, '#00e5ff', '#006064');
      line('#ffd54f', 0.35, [[13.7, 17.6], [18.3, 17.6]]); // lentes de cadenita
    },
  };
  // un borrego cimarron visto desde arriba, mirando hacia abajo (+y), con los cuernos enroscados (grandes: el macho)
  const cimarron = (cx, cy, a, cuernos, bufanda) => {
    x.save(); x.translate(cx, cy); x.rotate(a);
    ell('rgba(0,0,0,0.3)', 1, 1.2, 3.4, 5.4);
    x.fillStyle = rad(0, 0, 5, '#b98a5a', '#7a5434'); x.beginPath(); x.ellipse(0, -0.5, 3.2, 5, 0, 0, 7); x.fill(); // cuerpo cafe
    ell('#f1ead9', 0, -4.6, 2.2, 1.3); // la nalga blanca
    ell('#2b2016', 0, -6.1, 0.5, 0.8); // colita
    if (bufanda) { x.fillStyle = '#0f7a3f'; x.fillRect(-2.6, 2.4, 5.2, 1.3); x.fillStyle = '#d4a017'; x.fillRect(-2.6, 2.8, 5.2, 0.45); x.fillStyle = '#0f7a3f'; x.fillRect(1.6, 2.6, 1, 2.6); }
    ell('#8a6240', 0, 5, 1.8, 2.2); ell('#efe6d2', 0, 6.6, 1.1, 0.8); // cabeza y hocico claro
    x.lineCap = 'round';
    for (const l of [-1, 1]) { // cuernos: un arco enroscado de cada lado
      x.strokeStyle = '#d8c39a'; x.lineWidth = cuernos ? 1.4 : 0.9; x.beginPath();
      x.arc(l * (cuernos ? 2.6 : 1.9), 4.6, cuernos ? 1.9 : 1.1, l > 0 ? Math.PI * 1.1 : -Math.PI * 0.1, l > 0 ? Math.PI * 2.6 : Math.PI * 1.4, l < 0); x.stroke();
      x.strokeStyle = 'rgba(90,70,40,0.6)'; x.lineWidth = 0.3; x.stroke();
    }
    ell('#1b1b1b', -0.7, 5.6, 0.3, 0.3); ell('#1b1b1b', 0.7, 5.6, 0.3, 0.3); // ojos
    x.restore();
  };
  // un galgo corriendo visto desde arriba, mirando hacia abajo (+y): flaco y largo, patas estiradas
  const galgo = (cx, cy, a, pelo, oscuro, sudadera) => {
    x.save(); x.translate(cx, cy); x.rotate(a);
    ell('rgba(0,0,0,0.28)', 1, 1.2, 2.2, 7);
    x.strokeStyle = oscuro; x.lineWidth = 0.7; x.lineCap = 'round';
    x.beginPath(); x.moveTo(-1.4, 3); x.lineTo(-2.2, 6.6); x.moveTo(1.4, 3); x.lineTo(2.2, 6.6); x.moveTo(-1.3, -3); x.lineTo(-2.1, -6.8); x.moveTo(1.3, -3); x.lineTo(2.1, -6.8); x.stroke(); // patas
    x.fillStyle = rad(0, 0, 4, pelo, oscuro); x.beginPath(); x.ellipse(0, 0, 1.9, 5.4, 0, 0, 7); x.fill();
    if (sudadera) { x.fillStyle = '#1b3a8a'; x.beginPath(); x.ellipse(0, 0.6, 2, 3.4, 0, 0, 7); x.fill(); x.fillStyle = '#fff'; x.fillRect(-0.3, -1.6, 0.6, 3.6); }
    x.beginPath(); x.moveTo(0, -5); x.quadraticCurveTo(1.6, -8, 0.4, -10.4); x.stroke(); // cola larga y delgada
    ell(pelo, 0, 6.2, 1.1, 1.5); ell(pelo, 0, 8.2, 0.7, 1.6); ell('#1b1b1b', 0, 9.6, 0.4, 0.3); // cuello, cabeza alargada y nariz
    ell(oscuro, -0.9, 6.6, 0.5, 0.9, -0.5); ell(oscuro, 0.9, 6.6, 0.5, 0.9, 0.5); // orejitas para atras
    x.restore();
  };
  // los delfines asomandose: lomo gris con su aleta, el pico, la espuma y uno a medio brinco (con su sombra en el agua)
  draw.delfines = () => {
    const delfin = (cx, cy, a, k, brinco) => {
      x.save(); x.translate(cx, cy); x.rotate(a); x.scale(k, k);
      if (brinco) ell('rgba(10,40,60,0.3)', 2.2, 2.4, 2.2, 6); // su sombra en el agua
      else for (const [r, al] of [[5.4, 0.25], [4, 0.45]]) { x.strokeStyle = 'rgba(240,250,255,' + al + ')'; x.lineWidth = 0.45; x.beginPath(); x.ellipse(0, 0.5, r * 0.75, r * 1.5, 0, 0, 7); x.stroke(); }
      x.fillStyle = rad(0, 0, 6, '#9fb2c0', '#4f6575'); x.beginPath(); x.ellipse(0, 0, 2, 5.4, 0, 0, 7); x.fill(); // el lomo
      x.fillStyle = '#7d93a3'; x.beginPath(); x.ellipse(0, 6, 0.75, 1.4, 0, 0, 7); x.fill(); // el pico
      x.fillStyle = '#3e5262'; x.beginPath(); x.moveTo(-0.3, -1.4); x.lineTo(0.3, -1.4); x.lineTo(0.1, -3.6); x.closePath(); x.fill(); // la aleta
      x.fillStyle = '#5a7080'; x.beginPath(); x.moveTo(0, -5); x.lineTo(-2, -7); x.lineTo(0, -6.2); x.lineTo(2, -7); x.closePath(); x.fill(); // la cola
      ell('#1b1b1b', -1.1, 3.8, 0.28, 0.32); ell('#1b1b1b', 1.1, 3.8, 0.28, 0.32); // ojitos
      ell('rgba(255,255,255,0.35)', -0.6, -0.5, 0.5, 2.6); // el brillo mojado
      x.restore();
    };
    delfin(9, 18, 0.35, 0.95, false); delfin(23, 15, -0.3, 1, false); delfin(16, 9, 0.05, 0.85, true);
    for (const [px, py] of [[5, 25], [27, 23], [13, 3], [20, 4], [11, 27]]) ell('rgba(255,255,255,0.6)', px, py, 0.6, 0.35); // gotitas
  };
  // los senderistas, en bolita alrededor del mapa: gorra, mochila de color y bastones
  draw.senderistas = () => {
    const uno = (cx, cy, a, gorra, mochila, playera) => {
      x.save(); x.translate(cx, cy); x.rotate(a);
      shadow(0, 0, 3.6, 3);
      x.strokeStyle = '#5f6368'; x.lineWidth = 0.45; x.beginPath(); x.moveTo(-3.4, 1); x.lineTo(-4.6, -2.6); x.moveTo(3.4, 1); x.lineTo(4.6, -2.6); x.stroke(); // bastones
      x.fillStyle = mochila; x.beginPath(); x.roundRect(-2.2, -3.6, 4.4, 3.2, 1); x.fill(); // la mochila (atras)
      x.fillStyle = 'rgba(0,0,0,0.25)'; x.fillRect(-2.2, -2.2, 4.4, 0.5);
      shoulders(0, 0.6, playera, playera, 3.4, 2.2);
      ball(0, 1.2, 1.6, '#e0b48c', '#b9855c'); // cabeza
      x.fillStyle = gorra; x.beginPath(); x.arc(0, 1.1, 1.65, Math.PI * 0.95, Math.PI * 2.05); x.fill(); x.fillRect(-1.4, 1.6, 2.8, 1.1); // gorra con visera hacia el centro
      x.restore();
    };
    uno(10, 10, -0.8, '#e53935', '#1e88e5', '#ffb74d'); uno(22, 10, 0.8, '#43a047', '#f4511e', '#90caf9');
    uno(10, 22, -2.3, '#fdd835', '#6d4c41', '#ce93d8'); uno(22, 22, 2.3, '#1e88e5', '#8e24aa', '#a5d6a7');
    // el mapa en medio, al reves (la rosa de los vientos apuntando para abajo)
    x.save(); x.translate(16, 16); x.rotate(0.3);
    x.fillStyle = '#f3e9cf'; x.fillRect(-3.4, -2.4, 6.8, 4.8); x.strokeStyle = '#b89c6a'; x.lineWidth = 0.25; x.strokeRect(-3.4, -2.4, 6.8, 4.8);
    line('#5d8f4e', 0.35, [[-3, 1], [-1, -0.5], [1, 0.8], [3, -1]]); line('#4a7fb5', 0.3, [[-3, -1.8], [-0.5, -1], [3, -1.6]]);
    x.fillStyle = '#c62828'; x.beginPath(); x.moveTo(2.2, 1.9); x.lineTo(1.8, 0.7); x.lineTo(2.6, 0.7); x.closePath(); x.fill(); x.font = 'bold 0.9px sans-serif'; x.fillText('N', 1.85, 2.3);
    x.restore();
  };
  draw.cimarrones = () => {
    cimarron(10, 13, 0.3, true, true); cimarron(21, 11, -0.2, false, false); cimarron(16, 23, 0.1, false, true);
    ell('#7cb342', 6, 25, 2, 1.2); ell('#689f38', 26, 24, 1.6, 1); ell('#8bc34a', 24, 4, 1.4, 0.9); // matitas de pasto
  };
  draw.galgos = () => {
    galgo(8, 15, 0.12, '#9e9e9e', '#5f5f5f', true); galgo(16, 18, 0.04, '#d8b07a', '#9c7240', false); galgo(24, 14, -0.08, '#2f2f2f', '#111', true);
    x.strokeStyle = 'rgba(255,255,255,0.5)'; x.lineWidth = 0.4; for (const px of [5, 13, 21, 27]) { x.beginPath(); x.moveTo(px, 2); x.lineTo(px, 5); x.stroke(); } // rayitas de velocidad
  };
  // las vacas en circulo mirando el monolito: un dibujo grande (120 en vez de 32: unos 48 m)
  draw.monolito = () => {
    const c = 60;
    // el pasto pisoteado del circulo
    x.strokeStyle = 'rgba(120,95,55,0.35)'; x.lineWidth = 9; x.beginPath(); x.arc(c, c, 40, 0, 7); x.stroke();
    ell('rgba(110,140,70,0.25)', c, c, 30, 30);
    // nueve vacas pintas, cada una viendo hacia el centro
    for (let i = 0; i < 9; i++) {
      const a = i / 9 * Math.PI * 2 + 0.2, vx = c + Math.cos(a) * 40, vy = c + Math.sin(a) * 40;
      x.save(); x.translate(vx, vy); x.rotate(a - Math.PI / 2); // +y hacia afuera: la cabeza (-y) al centro
      ell('rgba(0,0,0,0.3)', 1.4, 1.6, 4.4, 7.4);
      x.fillStyle = rad(0, 0, 7, '#ffffff', '#d8d4cc'); x.beginPath(); x.ellipse(0, 0.5, 4, 7, 0, 0, 7); x.fill();
      x.save(); x.clip(); const r = mulberry(i * 31 + 5); // manchas negras
      for (let j = 0; j < 4; j++) ell('#1d1d1d', (r() - 0.5) * 6, (r() - 0.5) * 11, 1.2 + r() * 1.6, 1 + r() * 1.8, r() * 3);
      x.restore();
      x.strokeStyle = '#1d1d1d'; x.lineWidth = 0.5; x.beginPath(); x.moveTo(0, 7.2); x.quadraticCurveTo(1.2, 9, 0.4, 10); x.stroke(); // cola
      ell('#f1ede6', 0, -7.4, 2.4, 2.6); ell('#1d1d1d', 0.6, -7.8, 1.2, 1.1); // cabeza
      ell('#f2a7a7', 0, -9.6, 1.6, 1); // el hocico rosa
      ell('#e8dcc0', -2.3, -8.2, 0.9, 0.5, -0.4); ell('#e8dcc0', 2.3, -8.2, 0.9, 0.5, 0.4); // cuernitos
      x.restore();
    }
    // el monolito: una losa negra parada (sube hacia arriba y un poco a la derecha, como los edificios) y su sombra
    const L = 0.25, Hm = 34, w = 9, b = c + 5, l = c - w / 2; // (1 de ancho por 4 de alto, como debe ser)
    x.fillStyle = 'rgba(0,0,0,0.35)'; x.beginPath(); x.moveTo(l, b); x.lineTo(l + w, b); x.lineTo(l + w + Hm * 0.55, b + Hm * 0.55); x.lineTo(l + Hm * 0.55, b + Hm * 0.55); x.closePath(); x.fill();
    x.fillStyle = '#050505'; x.beginPath(); x.moveTo(l, b); x.lineTo(l + w, b); x.lineTo(l + w + Hm * L, b - Hm); x.lineTo(l + Hm * L, b - Hm); x.closePath(); x.fill(); // el frente
    x.fillStyle = '#1c1c1e'; x.beginPath(); x.moveTo(l + Hm * L, b - Hm); x.lineTo(l + w + Hm * L, b - Hm); x.lineTo(l + w + Hm * L + 0.6, b - Hm - 2.4); x.lineTo(l + Hm * L + 0.6, b - Hm - 2.4); x.closePath(); x.fill(); // arriba, delgadita
    line('rgba(150,160,180,0.45)', 0.35, [[l + w, b], [l + w + Hm * L, b - Hm]]); // el filo con el reflejo
  };
  // los gnomos en bolita alrededor de un tronquito con una vela y el plano; uno de vigia con su catalejo
  draw.gnomos = () => {
    const c = 24;
    ell('rgba(255,210,120,0.18)', c, c, 13, 13); ell('rgba(255,210,120,0.22)', c, c, 8, 8); // la luz de la vela
    // el tronquito con el plano encima y la vela
    shadow(c, c, 5, 4.4); ell('#7a5230', c, c, 4.6, 4); ell('#9b6b3f', c, c, 3.8, 3.2); x.strokeStyle = 'rgba(60,35,15,0.6)'; x.lineWidth = 0.25; x.beginPath(); x.arc(c, c, 2.4, 0, 7); x.arc(c, c, 1.2, 0, 7); x.stroke();
    x.save(); x.translate(c - 0.6, c + 0.4); x.rotate(-0.2); x.fillStyle = '#f1e4c3'; x.fillRect(-3, -2, 5.2, 3.6);
    line('#8d6e63', 0.2, [[-2.5, 1], [-1, -0.6], [0.6, 0.6], [1.8, -1.2]]); line('#c62828', 0.35, [[0.9, -1.4], [1.9, -0.4]]); line('#c62828', 0.35, [[1.9, -1.4], [0.9, -0.4]]); x.restore();
    ell('#f5f0e1', c + 2.6, c - 1.6, 0.6, 0.6); ell('#ffd54f', c + 2.6, c - 2.4, 0.35, 0.6); // la vela
    const gnomo = (gx, gy, a, gorro, ropa) => {
      x.save(); x.translate(gx, gy); x.rotate(a); // +y hacia donde ve
      shadow(0, 0, 3, 3);
      ell(ropa, 0, -0.4, 2.8, 2.6); // el cuerpito asomando
      ell('#f4f1ea', 0, 1.8, 1.8, 1.6); // las barbas, hacia el frente
      ell('#f2c09a', 0, 1, 0.6, 0.5); // la nariz
      x.restore();
      // el gorro picudo: parado, con la punta hacia arriba y un poco a la derecha (como los edificios), sin girar
      x.fillStyle = rad(gx, gy - 1, 3, gorro, '#7f1d1d'); x.beginPath(); x.ellipse(gx, gy - 0.4, 2.3, 1.5, 0, 0, Math.PI); x.lineTo(gx + 1.3, gy - 5.2); x.closePath(); x.fill();
      line('rgba(255,255,255,0.35)', 0.35, [[gx - 1.2, gy - 0.8], [gx + 0.9, gy - 4.4]]); ell('#7f1d1d', gx + 1.3, gy - 5.2, 0.35, 0.35);
    };
    // cuatro alrededor del tronco, viendo hacia el (el angulo: hacia donde ven)
    const G = [[0, '#d32f2f', '#1565c0'], [1.3, '#c62828', '#2e7d32'], [2.6, '#e53935', '#6a1b9a'], [4.2, '#b71c1c', '#ef6c00']];
    for (const [a, g, r] of G) { const gx = c + Math.cos(a) * 7.5, gy = c + Math.sin(a) * 7.5; gnomo(gx, gy, Math.atan2(c - gy, c - gx) - Math.PI / 2, g, r); }
    // el vigia, viendo hacia afuera con su catalejo
    const vx = c - 13, vy = c + 9; gnomo(vx, vy, Math.atan2(vy - c, vx - c) - Math.PI / 2, '#d32f2f', '#795548');
    const av = Math.atan2(vy - c, vx - c); line('#b8860b', 0.9, [[vx + Math.cos(av) * 2, vy + Math.sin(av) * 2], [vx + Math.cos(av) * 4.6, vy + Math.sin(av) * 4.6]]);
  };
  // el chupacabras en su silla de playa con su horchata, la hielera, el radio y la cabra dormida junto
  draw.chupacabras = () => {
    // la silla de playa (vista desde arriba, con las tiras de colores) y su sombra
    shadow(20, 24, 9, 10);
    x.fillStyle = '#9e9e9e'; x.fillRect(12.4, 15, 15.2, 18);
    ['#e53935', '#fdd835', '#43a047', '#1e88e5'].forEach((c, i) => { x.fillStyle = c; for (let j = 0; j < 2; j++) x.fillRect(13 + (i + j * 4) * 1.75, 15.6, 1.5, 16.8); });
    // el chupacabras sentado: cuerpo gris verdoso, picos morados en el lomo, brazos largos y ojos rojos
    x.fillStyle = rad(20, 22, 8, '#8fa58a', '#4d6150'); x.beginPath(); x.ellipse(20, 22.5, 5.6, 7, 0, 0, 7); x.fill();
    for (let i = 0; i < 5; i++) { const py = 17 + i * 2.6; x.fillStyle = '#7b3fa0'; x.beginPath(); x.moveTo(18.8, py); x.lineTo(21.2, py); x.lineTo(20, py - 2.4); x.closePath(); x.fill(); }
    line('#4d6150', 1.4, [[15, 21], [11.6, 26], [12.6, 29]]); line('#4d6150', 1.4, [[25, 21], [28.6, 25], [28, 28]]); // brazos
    line('#2b2b2b', 0.35, [[11.6, 29.6], [10.8, 30.8]]); line('#2b2b2b', 0.35, [[12.6, 29.8], [12.4, 31.2]]); // garritas
    ell('#6e8470', 20, 30, 3.6, 3); // la cabeza (hacia abajo: nos ve)
    ell('#ff1744', 18.5, 31.2, 1.1, 0.8, -0.3); ell('#ff1744', 21.5, 31.2, 1.1, 0.8, 0.3); ell('#fff', 18.2, 30.9, 0.3, 0.25); ell('#fff', 21.2, 30.9, 0.3, 0.25);
    // la horchata en la mano, con su popote
    ell('#f5ecd7', 28.6, 28.6, 1.6, 1.6); ell('#e6d6b0', 28.6, 28.6, 1.2, 1.2); line('#e53935', 0.4, [[28.6, 28.6], [29.8, 26.6]]);
    // la hielera y el radio
    shadow(35, 20, 4, 3); x.fillStyle = '#1565c0'; x.beginPath(); x.roundRect(31.5, 17, 7, 5.6, 1); x.fill(); x.fillStyle = '#fafafa'; x.fillRect(31.5, 17, 7, 1.6);
    x.fillStyle = '#424242'; x.beginPath(); x.roundRect(5, 14, 5.4, 3.4, 0.6); x.fill(); ell('#9e9e9e', 6.4, 15.7, 0.9, 0.9); line('#bdbdbd', 0.25, [[9.4, 14], [11.4, 11]]);
    line('rgba(255,255,255,0.7)', 0.3, [[11.6, 15.2], [12.6, 14.6]]); line('rgba(255,255,255,0.7)', 0.3, [[11.8, 16.6], [13, 16.4]]); // la musiquita
    // la cabra dormida, echada y hecha bolita
    shadow(36, 37, 6, 4); x.fillStyle = rad(36, 36, 6, '#ffffff', '#d7ccc8'); x.beginPath(); x.ellipse(36, 36.5, 5.6, 3.6, 0.2, 0, 7); x.fill();
    ell('#bcaaa4', 31, 35, 2, 1.6, -0.3); ell('#8d6e63', 30.2, 33.8, 0.5, 1, -0.6); ell('#8d6e63', 31.6, 33.6, 0.5, 1, 0.4); // cabeza y cuernitos
    line('#5d4037', 0.3, [[30.4, 35.2], [31.2, 35.4]]); // ojo cerrado
    x.fillStyle = 'rgba(255,255,255,0.85)'; x.font = 'bold 2.2px sans-serif'; x.fillText('z', 33, 31.4); x.font = 'bold 1.6px sans-serif'; x.fillText('z', 34.6, 29.8);
  };
  // la banda en medio circulo tocandole a un nopal: texanas blancas, camisas iguales y cada quien con su instrumento
  draw.banda = () => {
    const c = 24, cy = 30;
    // el nopal: pencas verdes con espinitas y una tuna
    shadow(c + 1, cy + 6, 4, 2.5);
    for (const [px, py, a, k] of [[0, 4, 0, 1], [-2.6, 0.4, -0.5, 0.8], [2.4, 0.6, 0.45, 0.85], [0.4, -2.6, 0.1, 0.75]]) {
      x.save(); x.translate(c + px, cy + py); x.rotate(a); ell('#4f8a3a', 0, 0, 2 * k, 3 * k); ell('rgba(255,255,255,0.18)', -0.5 * k, -0.6 * k, 0.8 * k, 1.4 * k);
      for (let j = 0; j < 4; j++) ell('#e9e3c9', (j % 2 - 0.5) * 1.6 * k, (j - 1.5) * 1.2 * k, 0.15, 0.15); x.restore();
    }
    ell('#c2185b', c + 1.8, cy - 4.4, 0.8, 0.9); // la tuna
    // los musicos en medio circulo arriba del nopal, viendolo
    const M7 = ['tuba', 'trompeta', 'clarinete', 'tambora', 'trombon', 'clarinete', 'trompeta'];
    M7.forEach((ins, i) => {
      const a = Math.PI + (i + 0.5) / M7.length * Math.PI, mx = c + Math.cos(a) * 15, my = cy + Math.sin(a) * 14;
      x.save(); x.translate(mx, my); x.rotate(Math.atan2(cy - my, c - mx) - Math.PI / 2); // +y hacia el nopal
      shadow(0, 0, 3.6, 3);
      shoulders(0, 0, '#9c1f2e', '#5e0f1a', 3.2, 2.1); // camisa vino de la banda
      x.fillStyle = '#d4a017'; x.fillRect(-2.6, -0.3, 5.2, 0.5); // el bordado dorado
      // el instrumento, hacia el frente
      if (ins === 'tuba') { ell('#c99a2e', -1.6, 0.6, 2.4, 2.2); ell('#f2cf66', -1.6, 0.6, 1.7, 1.5); ell('#8a6514', -1.6, 0.6, 0.8, 0.7); }
      else if (ins === 'tambora') { ell('#7a4a22', 0, 2.8, 2.6, 2.6); ell('#efe6d2', 0, 2.8, 2.1, 2.1); ell('#d4a017', 2.4, 1.4, 1, 1); line('#5d4037', 0.35, [[-1, 1], [-0.4, 3]]); }
      else if (ins === 'trompeta') { line('#d4a017', 0.6, [[0, 1], [0, 4.4]]); ell('#f2cf66', 0, 4.8, 0.9, 0.6); }
      else if (ins === 'clarinete') { line('#1b1b1b', 0.6, [[0, 1], [0, 4.6]]); ell('#555', 0, 4.9, 0.6, 0.45); }
      else { line('#d4a017', 0.5, [[0.5, 1], [0.5, 6]]); line('#d4a017', 0.5, [[-0.5, 1], [-0.5, 6]]); ell('#f2cf66', -1.6, 3, 0.9, 0.7); } // trombon
      ell('#f4f1ea', 0, -0.4, 2.3, 2.3); ell('#e0dccf', 0, -0.4, 1.4, 1.4); // la texana blanca, vista desde arriba
      x.restore();
    });
    // las notitas en el aire
    x.fillStyle = 'rgba(255,255,255,0.85)'; x.font = 'bold 3px sans-serif';
    for (const [nx, ny, t] of [[10, 8, '♪'], [36, 9, '♫'], [24, 4, '♪'], [42, 22, '♫'], [6, 22, '♪']]) x.fillText(t, nx, ny);
  };
  // el programador en su mesita plegable: laptop prendida, taza de cafe, patito de hule, papelitos y la extension
  // naranja que se va lejos
  draw.programador = () => {
    ell('rgba(120,190,255,0.16)', 22, 19, 13, 9); // la luz de la pantalla en el piso
    // la extension, enroscada y perdiendose hacia la orilla
    x.strokeStyle = '#ff8f00'; x.lineWidth = 0.7; x.lineCap = 'round'; x.beginPath(); x.moveTo(27, 18);
    x.bezierCurveTo(34, 20, 30, 30, 37, 31); x.bezierCurveTo(42, 32, 40, 40, 44, 43); x.stroke();
    // la mesita plegable con su sombra
    shadow(22, 18, 10, 6); x.fillStyle = '#d7c4a0'; x.fillRect(12, 12, 20, 11); x.strokeStyle = 'rgba(90,70,40,0.6)'; x.lineWidth = 0.3; x.strokeRect(12, 12, 20, 11);
    // la laptop: teclado y pantalla (inclinada hacia arriba, prendida)
    x.fillStyle = '#5f6368'; x.fillRect(17, 16, 9, 5.4); x.fillStyle = '#3c4043'; for (let i = 0; i < 3; i++) x.fillRect(17.8, 16.8 + i * 1.2, 7.4, 0.7);
    x.fillStyle = '#202124'; x.fillRect(17, 12.6, 9, 3.2); x.fillStyle = '#8ad4ff'; x.fillRect(17.6, 13.1, 7.8, 2.3);
    x.fillStyle = '#2e7d32'; for (let i = 0; i < 3; i++) x.fillRect(18, 13.5 + i * 0.6, 2 + (i * 3 % 5), 0.3); // codigo en la pantalla
    // la taza, el patito y los papelitos
    ell('#ffffff', 29, 15, 1.5, 1.5); ell('#4e342e', 29, 15, 1.1, 1.1); line('#ffffff', 0.4, [[30.4, 15], [31.2, 15.6]]);
    ell('#fdd835', 14.6, 15, 1.4, 1.2); ell('#fdd835', 14.6, 13.6, 0.9, 0.8); ell('#ff8f00', 14.6, 12.9, 0.5, 0.3); ell('#1b1b1b', 14.3, 13.5, 0.15, 0.15); // el patito
    [['#fff176', 13.4, 19.2], ['#80deea', 15.6, 20.2], ['#f48fb1', 28.4, 20]].forEach(([c, px, py]) => { x.fillStyle = c; x.fillRect(px, py, 2, 2); });
    // tazas vacias regadas
    ell('#eeeeee', 9, 24, 1.2, 1.2); ell('#bdbdbd', 9, 24, 0.8, 0.8); ell('#eeeeee', 34, 10, 1.1, 1.1); ell('#bdbdbd', 34, 10, 0.7, 0.7);
    // la silla y el programador, de espaldas a nosotros (sudadera gris, audifonos en el cuello y el pelo parado)
    shadow(22, 28, 6, 4); x.fillStyle = '#37474f'; x.fillRect(17.5, 25, 9, 5.5);
    shoulders(22, 26.4, '#616161', '#303030', 5, 3.2);
    line('#212121', 0.8, [[18.2, 24.8], [17.6, 22]]); line('#212121', 0.8, [[25.8, 24.8], [26.4, 22]]); // brazos al teclado
    x.strokeStyle = '#212121'; x.lineWidth = 0.6; x.beginPath(); x.arc(22, 25.6, 2.6, Math.PI * 0.1, Math.PI * 0.9); x.stroke(); // audifonos al cuello
    ball(22, 24.2, 2, '#e0b48c', '#b9855c');
    x.fillStyle = '#3e2723'; x.beginPath(); for (let i = 0; i < 9; i++) { const a = Math.PI * (1 + i / 8); x.lineTo(22 + Math.cos(a) * (2.2 + (i % 2) * 0.8), 24.4 + Math.sin(a) * (2.2 + (i % 2) * 0.8)); } x.closePath(); x.fill(); // pelo parado
    // un nopalito de compañia
    ell('#4f8a3a', 7, 9, 1.6, 2.4); ell('#4f8a3a', 8.6, 7, 1.1, 1.6, 0.5);
  };
  // el buggy de carreras del desierto lleno de polvo, las huellas dando vueltas y el piloto con su mapa
  draw.piloto = () => {
    // las huellas: vueltas y vueltas en el llano
    x.strokeStyle = 'rgba(90,70,45,0.35)'; x.lineWidth = 0.6; x.setLineDash([0.8, 0.6]);
    for (const [r, o] of [[17, 0], [14, 1.3], [19.5, 2.6]]) for (const d of [-1.2, 1.2]) { x.beginPath(); x.ellipse(24, 24, r + d, (r + d) * 0.75, o, 0, 7); x.stroke(); }
    x.setLineDash([]);
    ell('rgba(205,180,140,0.35)', 17, 28, 11, 7); // la polvareda
    // el buggy: chasis, jaula, llantotas, refaccion atras y barra de luces
    x.save(); x.translate(18, 25); x.rotate(-0.35);
    shadow(0, 0, 6.5, 11);
    for (const [wx, wy] of [[-5.2, -6.6], [5.2, -6.6], [-5.2, 6.4], [5.2, 6.4]]) { x.fillStyle = '#1b1b1b'; x.beginPath(); x.roundRect(wx - 1.6, wy - 2.6, 3.2, 5.2, 1); x.fill(); x.fillStyle = '#444'; x.fillRect(wx - 1.6, wy - 0.3, 3.2, 0.6); }
    x.fillStyle = '#e65100'; x.beginPath(); x.roundRect(-4.2, -9, 8.4, 18, 2); x.fill(); // la carroceria naranja
    x.fillStyle = '#fafafa'; x.fillRect(-0.9, -9, 1.8, 18); // la franja
    x.strokeStyle = '#263238'; x.lineWidth = 0.6; x.strokeRect(-3.2, -3.6, 6.4, 7.6); line('#263238', 0.6, [[-3.2, -3.6], [3.2, 4]]); // la jaula
    x.fillStyle = '#fffde7'; x.fillRect(-3.8, -9.6, 7.6, 0.9); for (let i = 0; i < 5; i++) ell('#fff59d', -3 + i * 1.5, -9.2, 0.45, 0.35); // barra de luces
    ell('#1b1b1b', 0, 8, 2, 1.4); ell('#555', 0, 8, 1, 0.7); // la llanta de refaccion
    x.fillStyle = '#fff'; x.fillRect(-2.6, -0.4, 5.2, 3); x.fillStyle = '#111'; x.font = 'bold 2.4px sans-serif'; x.textAlign = 'center'; x.fillText('113', 0, 2.1); // el numero
    x.fillStyle = 'rgba(190,160,115,0.35)'; x.fillRect(-4.2, 2, 8.4, 7); // polvo en la parte de atras
    x.restore();
    // el piloto parado junto, con su casco y el mapa abierto
    shadow(35, 18, 3.6, 3);
    shoulders(35, 18.6, '#1565c0', '#0d3c75', 3.2, 2.1); x.fillStyle = '#ffeb3b'; x.fillRect(32, 18.2, 6, 0.6); // el traje con franja
    ball(35, 18, 1.9, '#fafafa', '#9e9e9e', 'rgba(0,0,0,0.4)'); x.fillStyle = '#d32f2f'; x.fillRect(33.2, 17.6, 3.6, 0.6); // el casco
    x.save(); x.translate(35, 22.4); x.rotate(0.12); x.fillStyle = '#f3e9cf'; x.fillRect(-3.4, -1.6, 6.8, 3.6); x.strokeStyle = '#b89c6a'; x.lineWidth = 0.2; x.strokeRect(-3.4, -1.6, 6.8, 3.6);
    line('#c62828', 0.3, [[-2.8, 1.2], [-1, -0.6], [1, 0.6], [2.8, -1]]); x.fillStyle = '#c62828'; x.font = 'bold 1.6px sans-serif'; x.fillText('?', 2.4, 1.6); x.restore();
    // un sahuaro de los que ya conoce
    ell('#558b2f', 8, 10, 1.4, 1.4); ell('#558b2f', 6.6, 9, 0.7, 1.4); ell('#558b2f', 9.4, 11, 0.7, 1.4);
  };
  // el ring del baldio: lona, esquineros y cuerdas de colores, dos luchadores enmascarados (uno volando en plancha),
  // el referi de rayas y unas sillas de plastico para el publico
  draw.lucha = () => {
    const c = 24, R = 13;
    shadow(c + 1, c + 1.5, R + 1, R + 1);
    x.fillStyle = '#e8e4da'; x.fillRect(c - R, c - R, 2 * R, 2 * R); // la lona
    x.strokeStyle = 'rgba(120,110,90,0.35)'; x.lineWidth = 0.4; x.strokeRect(c - R + 2, c - R + 2, 2 * R - 4, 2 * R - 4);
    [['#d32f2f', 0], ['#fafafa', 1.2], ['#1565c0', 2.4]].forEach(([col, o]) => { x.strokeStyle = col; x.lineWidth = 0.5; x.strokeRect(c - R - 0.6 + o * 0.25, c - R - 0.6 + o * 0.25, 2 * R + 1.2 - o * 0.5, 2 * R + 1.2 - o * 0.5); });
    for (const [px, py] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) ell('#424242', c + px * (R + 0.4), c + py * (R + 0.4), 1.1, 1.1); // esquineros
    // las sillas de plastico afuera
    for (const [sx, sy] of [[5, 44], [10, 45], [38, 44], [43, 43], [44, 6]]) { x.fillStyle = '#fafafa'; x.fillRect(sx - 1.6, sy - 1.6, 3.2, 3.2); x.fillStyle = '#e0e0e0'; x.fillRect(sx - 1.6, sy - 1.6, 3.2, 0.8); }
    // un luchador tirado en la lona (el que va a recibir) y el otro volando en plancha, con su sombra en la lona
    const luchador = (lx, ly, a, piel, mascara, raya, malla, k) => {
      x.save(); x.translate(lx, ly); x.rotate(a); x.scale(k, k);
      ell(malla, 0, 2, 2.6, 3.2); // la malla
      line(piel, 1.2, [[-2.6, -0.6], [-5, -2.4]]); line(piel, 1.2, [[2.6, -0.6], [5, -2.4]]); // los brazos abiertos
      line(malla, 1.3, [[-1.2, 4.6], [-2, 7.4]]); line(malla, 1.3, [[1.2, 4.6], [2, 7.4]]); // las piernas
      ell(piel, 0, -0.6, 3, 2); // el torso
      ball(0, -3.4, 1.9, mascara, mascara); x.fillStyle = raya; x.fillRect(-0.4, -5.2, 0.8, 3.4); // la mascara con su raya
      ell('#fff', -0.8, -3.2, 0.5, 0.35); ell('#fff', 0.8, -3.2, 0.5, 0.35);
      x.restore();
    };
    luchador(c - 3, c + 4, 0.3, '#d9a77c', '#1565c0', '#cfd8dc', '#263238', 1);
    ell('rgba(0,0,0,0.25)', c + 3, c + 1, 4, 3.4); // la sombra del que vuela
    luchador(c + 1, c - 6, Math.PI + 0.5, '#c68e5f', '#ffd600', '#d32f2f', '#b71c1c', 1.15);
    // el referi de rayas en la esquina
    x.save(); x.translate(c + 9, c + 8); shadow(0, 0, 2.4, 2);
    x.fillStyle = '#fafafa'; x.beginPath(); x.ellipse(0, 0.4, 2.6, 1.8, 0, 0, 7); x.fill();
    x.save(); x.clip(); for (let i = -3; i < 3; i++) { x.fillStyle = '#212121'; x.fillRect(i * 1.1, -2, 0.55, 5); } x.restore();
    ball(0, -0.8, 1.3, '#d9a77c', '#a8714a'); x.restore();
  };
  const GRANDE = { monolito: 120, gnomos: 48, chupacabras: 44, banda: 48, programador: 44, piloto: 48, lucha: 48 };
  for (const k in draw) {
    const n = GRANDE[k] || 32, t = scene.textures.createCanvas('egg_' + k, n * 5, n * 5);
    x = t.getContext(); x.save(); x.scale(5, 5); draw[k](x); x.restore(); t.refresh();
  }
}
// las calles cuyo trazo pasa a menos de R px de (x, y) (mas o menos: las de las celdas de alrededor), en su orden
function roadsNear(x, y, R) {
  const s = new Set();
  for (let cx = Math.floor((x - R) / CHUNK); cx <= Math.floor((x + R) / CHUNK); cx++) for (let cy = Math.floor((y - R) / CHUNK); cy <= Math.floor((y + R) / CHUNK); cy++)
    for (const i of chunkRoads.get(GK(cx, cy)) || []) s.add(i);
  return [...s].sort((a, b) => a - b).map(i => roads[i]);
}
// (pad hasta 15: la celda de chunkRoads tiene las calles a menos de su medio ancho + 15 px)
function onAsphalt(x, y, pad) {
  for (const r of roadsNear(x, y, 0)) {
    if (r.c > 7 || x < r.bb[0] || x > r.bb[2] || y < r.bb[1] || y > r.bb[3]) continue;
    for (let i = 0; i < r.p.length - 2; i += 2) if (segDist(x, y, r.p[i], r.p[i + 1], r.p[i + 2], r.p[i + 3]) < r.w / 2 * M + pad) return true;
  }
  return false;
}
// hay algun punto libre a menos de R de (x, y)? (se revisa en circulos cada 4 px)
function reachable(x, y, R) {
  for (let r = 0; r <= R; r += 4) for (let k = 0; k < 16; k++) { const a = k / 16 * Math.PI * 2; if (!blocked(x + Math.cos(a) * r, y + Math.sin(a) * r)) return true; }
  return false;
}
// como reachable, pero ademas de ahi se puede salir caminando a una calle (un patio dentro de un edificio
// no cuenta): busqueda a lo ancho en una rejilla de 4 px. Si llega al tope de celdas es un area abierta grande
// (un parque, el golf), no un patio encerrado: tambien cuenta
function walkableTo(x, y, R) {
  const G = 4, seen = new Set(), q = [];
  for (let dx = -R; dx <= R; dx += G) for (let dy = -R; dy <= R; dy += G) {
    if (dx * dx + dy * dy > R * R) continue;
    const i = Math.round((x + dx) / G), j = Math.round((y + dy) / G), k = GK(i, j);
    if (!seen.has(k)) { seen.add(k); if (!blocked(i * G, j * G)) q.push(i, j); }
  }
  for (let h = 0; h < q.length; h += 2) {
    const i = q[h], j = q[h + 1];
    if (h >= 16000 || onRoad(i * G, j * G)) return true;
    for (const [a, c] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const k = GK(i + a, j + c); if (seen.has(k)) continue; seen.add(k);
      if (!blocked((i + a) * G, (j + c) * G)) q.push(i + a, j + c);
    }
  }
  return false;
}
// la banqueta mas cercana de verdad (el punto mas cercano de cualquier calle, por lejos que este), a la mitad
// de la banqueta y del lado del lugar: ahi siempre se puede caminar. Para los lugares dentro de edificios enormes
function nearestSidewalk(x, y) {
  let best = null;
  for (const r of roads) {
    if (r.c > 6 || r.f & 1) continue;
    const p = r.p;
    for (let i = 0; i < p.length - 2; i += 2) {
      const ax = p[i], ay = p[i + 1], dx = p[i + 2] - ax, dy = p[i + 3] - ay, L2 = dx * dx + dy * dy || 1;
      const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / L2)), qx = ax + dx * t, qy = ay + dy * t, d = Math.hypot(x - qx, y - qy);
      if (!best || d < best.d) best = { d, qx, qy, r };
    }
  }
  if (!best || best.d < 1) return [x, y];
  const off = (best.r.w / 2 + SIDEWALK / 2) * M, k = off / best.d;
  return [best.qx + (x - best.qx) * k, best.qy + (y - best.qy) * k];
}
function sidewalkSpot(x, y, extra = 17) {
  const cands = [];
  for (const r of roadsNear(x, y, 200 + CHUNK)) {
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
      const off = r.w / 2 * M + extra, px = qx + nx * off, py = qy + ny * off;
      if (!onAsphalt(px, py, 15)) return [px, py, Math.atan2(-ny, -nx) - Math.PI / 2];
    }
  }
  return [x, y, 0];
}

// ---------- escena ----------
// ---------- escenas de trafico ----------
// Los cruceros donde mas se choca en Tijuana (estudio Mision Cero 2015-2023, SSPCM y Bomberos 2025-2026): al acercarte
// a veces hay un choque (7 de cada 10 veces, ver BOLSA_ESCENAS) y al alejarte se quita. Cada una va en su calle (calle,
// y si hace falta clase), en el punto mas cercano a cerca (px del mapa), en el carril derecho y en el sentido de la
// calle; atras la recorre hacia atras (para que no quede a media interseccion). tipos: los choques que pueden tocar
// ahi (ver armarEscena); repetir uno lo hace mas comun.
const ESCENA_CARROS = [0, 1, 3, 4]; // sedan, vocho, camioneta y tsurito (los grandes no caben en el choque)
const ESCENA_TIPOS = ['lado', 'alcance', 'esquinazo', 'carambola', 'moto'];
const ESCENAS = [
  { k: 'santaFe', lugar: 'la Glorieta Santa Fe', calle: 'Glorieta Santa Fe', cerca: [49820, 67439], glorieta: true,
    dato: 'Aquí es común que choquen: nadie sabe quién tiene la preferencia.', tipos: ['lado', 'lado', 'esquinazo', 'alcance', 'moto'] },
  { k: 'aldrete', lugar: 'Aldrete y Negrete', calle: 'Avenida Aldrete', cerca: [50434, 14726], atras: 30,
    dato: 'El crucero con más choques de Tijuana.' },
  { k: 'pedregal', lugar: 'Parque Baja California y Pedregal', calle: 'Avenida Paseo del Pedregal', cerca: [13904, 27987], atras: 30,
    dato: 'El segundo crucero con más choques de la ciudad.' },
  { k: 'lazaroVR', lugar: 'Lázaro Cárdenas y la Vía Rápida', calle: 'Boulevard Lázaro Cárdenas', cerca: [84115, 27278],
    dato: 'El tercer crucero con más choques de la ciudad.' },
  { k: 'cuauhtemoc', lugar: 'la Glorieta Cuauhtémoc', calle: 'Calle Paseo de los Héroes', cerca: [58326, 22103], glorieta: true,
    dato: 'Paseo de los Héroes y Cuauhtémoc: de los cruceros más chocados.', tipos: ['lado', 'lado', 'esquinazo', 'alcance', 'moto'] },
  { k: 'vrPoniente', lugar: 'la Vía Rápida Poniente', calle: 'Avenida Vía Rápida Poniente', clase: 1, cerca: [57604, 19790],
    dato: 'Aquí van rápido y nadie guarda su distancia.', tipos: ['alcance', 'alcance', 'carambola', 'carambola', 'lado'] },
  { k: 'cincoYDiez', lugar: 'Las 5 y 10', calle: 'Boulevard Salvador Rosas Magallón', cerca: [82155, 36470], atras: 70,
    dato: 'Díaz Ordaz y Rosas Magallón: de los cruceros más chocados.' },
  { k: 'blvd2000', lugar: 'el Bulevar 2000', calle: 'Corredor 2000 Tijuana-Rosarito', clase: 1, cerca: [140359, 57925],
    dato: 'El bulevar con más choques de Tijuana: mucha velocidad y poca luz.', tipos: ['alcance', 'carambola', 'carambola', 'lado', 'moto'] },
].map(E => {
  const n = D.names.indexOf(E.calle), [cx, cy] = E.cerca;
  let b = null;
  for (const r of roads) {
    if (r.n !== n || (r.f & 1) || (E.clase != null && r.c !== E.clase)) continue; // en puentes no
    for (let i = 0; i < r.p.length - 2; i += 2) {
      const x1 = r.p[i], y1 = r.p[i + 1], dx = r.p[i + 2] - x1, dy = r.p[i + 3] - y1, l = dx * dx + dy * dy || 1;
      const t = Math.max(0, Math.min(1, ((cx - x1) * dx + (cy - y1) * dy) / l)), x = x1 + t * dx, y = y1 + t * dy, d = Math.hypot(cx - x, cy - y);
      if (!b || d < b.d) b = { d, x, y, a: Math.atan2(dy, dx), w: r.w * M };
    }
  }
  if (!b || b.d > 200) return null;
  // al carril de la derecha (a un cuarto del ancho desde el centro de la calle)
  const fx = Math.cos(b.a), fy = Math.sin(b.a), at = E.atras || 0, lado = b.w * 0.25;
  return { ...E, x: b.x - fx * at - fy * lado, y: b.y - fy * at + fx * lado, a: b.a, R: 140, tipos: E.tipos || ESCENA_TIPOS, on: null, nada: false };
}).filter(Boolean);
// de cada 10 veces que llegas a uno de esos lugares, en 7 hay choque: se sacan de una bolsa con 7 si y 3 no
// (revuelta), y al vaciarse se vuelve a llenar
const BOLSA_ESCENAS = [];
const tocaChoque = () => {
  if (!BOLSA_ESCENAS.length) {
    BOLSA_ESCENAS.push(...Array(7).fill(true), ...Array(3).fill(false));
    for (let i = BOLSA_ESCENAS.length - 1; i > 0; i--) { const j = (Math.random() * (i + 1)) | 0; [BOLSA_ESCENAS[i], BOLSA_ESCENAS[j]] = [BOLSA_ESCENAS[j], BOLSA_ESCENAS[i]]; }
  }
  return BOLSA_ESCENAS.pop();
};

// ---------- la fila de las garitas ----------
// En San Ysidro y en Otay siempre hay fila para cruzar a Estados Unidos. Los carriles que llegan a la linea son de
// un sentido y no tienen salida (el trafico no se mete: son trampas, ver marcarTrampas); desde la caseta (cerca, px
// del mapa; y los carriles que se llaman como en carriles, que en el mapa no llegan hasta la linea) se recorren
// hacia atras hasta largo px y se llenan sus carriles de carros, defensa con defensa, dejando libres los cruces con
// otras calles. Los carros no se mueven: aparecen al acercarte (ver updateFila) como estacionados que no se pueden robar.
const GARITAS = [
  { k: 'sanYsidro', nombre: 'la Garita de San Ysidro', cerca: [53500, 12900], largo: 2000, carriles: [], tipos: [0, 0, 0, 1, 2, 3, 3, 3, 4, 4, 5, 6, 7],
    dato: 'De los cruces fronterizos más transitados del mundo.' },
  { k: 'otay', nombre: 'la Garita de Otay', cerca: [95750, 8700], largo: 2400, carriles: ['Linea Global Entry SENTRI', 'Línea (Ready Lane)'], tipos: [0, 0, 1, 2, 2, 3, 3, 3, 4, 4, 5, 9, 9],
    dato: 'El otro cruce a San Diego, el de la Mesa de Otay.' },
];
const FRASES_FILA = [
  '¡Ya llevo tres horas aquí y no he avanzado ni un carro!',
  'Salí de madrugada para ganarle a la fila. Todos pensaron lo mismo.',
  'La aplicación decía 45 minutos. La aplicación miente.',
  'Ya me terminé la música dos veces. Voy por la tercera.',
  'Ya compré churros, una cobija, un Cristo de yeso y unos chicles. Y sigo aquí.',
  'Joven, ¿no trae un cargador? Se me está acabando la pila.',
  '¡No se meta, compa! Aquí todos estamos haciendo fila.',
  'Mi jefe en San Diego no me cree que la fila estaba así. Le voy a mandar foto.',
  'Dicen que el carril de en medio avanza más rápido. Mentira.',
  'El de enfrente apagó el carro. Ya sabemos cómo va a estar.',
  'Si avanzo un carro más, lo celebro con un tamal.',
  '¿Me cuida el lugar? Voy al baño... a mi casa.',
  'Cuando llegue a la caseta me van a preguntar a qué voy. A trabajar, oficial, como diario.',
  'Aquí desayuno, aquí como y a veces aquí ceno.',
  'Traigo la visa en una mano y el burrito en la otra. Listo para todo.',
  'Ya me sé el nombre de los vendedores, de sus hijos y de sus perros.',
  'Bajé la ventana para ver si avanzaba más rápido. No funcionó.',
  'Cuando era niño esta fila ya estaba aquí. Creo que es el mismo carro de enfrente.',
];
const FRASES_FILA_ROBO = [
  'Si se lo quitas, el dueño pierde su lugar en la fila. Eso aquí es peor que robarle el carro.',
  'Nadie suelta su lugar en la fila. Ni a la fuerza.',
  'Además no lo podrías mover: está encajonado entre los de la fila.',
  'El señor lleva dos horas ahí. No le hagas eso.',
];
// los vendedores que caminan entre los carros de la fila (ver updateVendedores): lo que venden y lo que gritan
const VENDEDORES = {
  churros: ['¡Churros, churros calientitos!', '¡Lleve sus churros, tres por veinte!', 'Joven, ¿un churrito para la espera?', '¡Con cajeta o con chocolate, usted diga!'],
  agua: ['¡Agua, agua fría!', '¡Aguas, refrescos, jugos!', 'Con este calor y esta fila, el agua no es gasto, es inversión.', '¡Bien heladita, compa, para aguantar la fila!'],
  cobija: ['¡Cobijas, cobijas! Para la casa o para la fila.', 'Esta es de tigre, mire, bien suavecita.', '¡Llévese la cobija, que en la madrugada hace frío en la fila!', 'Matrimonial o individual, igual no avanza la fila.'],
  yeso: ['¡Figuras de yeso, alcancías, virgencitas!', 'Llévele una virgencita a su mamá, compa.', 'Esta alcancía de cochinito aguanta hasta lo que ahorra en la garita.', '¡El burrito de yeso pintado a mano, recuerdo de Tijuana!'],
  dulces: ['¡Chicles, cacahuates, dulces de tamarindo!', '¡Semillas, papitas, pistaches!', 'Llévese su chicle para la espera, de a cinco pesos.', '¡Obleas, palanquetas, jamoncillos!'],
};
const FRASES_VENDEDOR = ['Aquí trabajo diario: la fila es mi oficina.', '¿Va para el otro lado? Llévese algo de recuerdo.', 'Usted no compra, pero la de atrás sí. Ahí voy.', 'Si la fila avanzara rápido, yo me quedaba sin chamba.'];
const filaSlots = [], chunkFila = new Map(), NADA = [];
{
  const tmp = {}, entra = new Map(); // nodo -> tramos de un sentido que llegan ahi
  for (const e of traffic.edges) if (e.one) { if (!entra.has(e.b)) entra.set(e.b, []); entra.get(e.b).push(e); }
  // para no encimar carros donde se juntan dos carriles (o donde la calle viene dos veces): celdas de 16 px
  const FC = 16, puestos = new Map(), libre = (x, y) => {
    const cx = Math.floor(x / FC), cy = Math.floor(y / FC);
    for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) for (const s of puestos.get(GK(cx + i, cy + j)) || []) if (Math.hypot(s.x - x, s.y - y) < 16) return false;
    return true;
  };
  const toca = new Map(); // nodo -> tramos que llegan o salen de ahi
  for (const e of traffic.edges) for (const n of [e.a, e.b]) { if (!toca.has(n)) toca.set(n, []); toca.get(n).push(e); }
  for (const G of GARITAS) {
    const [gx, gy] = G.cerca, cola = [], fila = new Map(); // tramo -> que tan lejos de la caseta acaba
    const nombres = G.carriles.map(c => D.names.indexOf(c));
    let sx = 0, sy = 0, n0 = 0;
    for (const e of traffic.edges) {
      if (!e.one) continue;
      const bx = e.p[e.p.length - 2], by = e.p[e.p.length - 1];
      const llega = !traffic.adj[e.b].length && Math.hypot(bx - gx, by - gy) < 900 && by - borderY(bx) < 700;
      if (!llega && !(nombres.includes(e.n) && Math.hypot(bx - gx, by - gy) < 3000)) continue;
      cola.push(e); fila.set(e, 0);
      if (llega) { sx += bx; sy += by; n0++; }
    }
    G.x = n0 ? sx / n0 : gx; G.y = n0 ? sy / n0 : gy; G.n = 0; G.tramos = [];
    if (!n0) { console.warn('garita sin carriles', G.k); continue; }
    // el ultimo tramo, hasta la linea: las calles que llegan a la caseta quedan fuera del trafico (ver inMx), asi que
    // los carriles de la fila acaban unos 70 m antes. Desde donde acaba cada carril se sigue la calle de verdad
    // (hasta 4 pedazos) y se corta a unos metros de la linea; queda como un tramo mas de la fila, sin nodos
    for (const e of [...cola]) {
      if (traffic.adj[e.b].length) continue;
      let x = e.p[e.p.length - 2], y = e.p[e.p.length - 1], w = e.w, c = e.c; const pts = [x, y], usadas = new Set();
      for (let paso = 0; paso < 4 && y - borderY(x) > 14; paso++) {
        let sig = null, rev = false;
        for (const ri of chunkRoads.get(GK(Math.floor(x / CHUNK), Math.floor(y / CHUNK))) || NADA) {
          const r = roads[ri];
          if (r.c > 6 || usadas.has(r) || inMx(r) || r.bb[0] > x || r.bb[2] < x || r.bb[1] > y || r.bb[3] < y) continue;
          const n = r.p.length;
          if (Math.hypot(r.p[0] - x, r.p[1] - y) < 4) { sig = r; rev = false; break; }
          if (!(r.f & 2) && Math.hypot(r.p[n - 2] - x, r.p[n - 1] - y) < 4) { sig = r; rev = true; break; }
        }
        if (!sig) break;
        usadas.add(sig); w = sig.w * M; c = sig.c;
        const q = sig.p, n = q.length / 2;
        for (let i = 1; i < n; i++) {
          const j = rev ? n - 1 - i : i, nx = q[j * 2], ny = q[j * 2 + 1], db = ny - borderY(nx);
          if (db <= 14) { const da = y - borderY(x), f = (da - 14) / ((da - db) || 1); x += (nx - x) * f; y += (ny - y) * f; pts.push(x, y); break; }
          x = nx; y = ny; pts.push(x, y);
        }
      }
      if (pts.length < 4) continue;
      const cum = [0];
      for (let q = 2; q < pts.length; q += 2) cum.push(cum[cum.length - 1] + Math.hypot(pts[q] - pts[q - 2], pts[q + 1] - pts[q - 1]));
      if (cum[cum.length - 1] < 20) continue;
      const pe = { p: new Float32Array(pts), cum: Float32Array.from(cum), len: cum[cum.length - 1], w, c, one: true, puente: false, n: -1, id: 900000 + e.id, a: null, b: null, final: true };
      e.sigue = true; fila.set(pe, 0);
    }
    for (let i = 0; i < cola.length; i++) {
      const e = cola[i], d1 = fila.get(e) + e.len;
      if (d1 < G.largo) for (const o of entra.get(e.a) || []) if (o.trampa && !o.cerrada && !fila.has(o)) { fila.set(o, d1); cola.push(o); }
    }
    // en cada punta, lo que hay que dejar libre: el ancho de las calles que cruzan o salen de ahi
    const libreEn = (n) => { let w = 0; for (const o of toca.get(n) || NADA) if (!fila.has(o)) w = Math.max(w, o.w / 2 + 3 * M); return w; };
    // y donde la cruza otra calle sin tocarla en un nodo (si no es un puente que pasa por arriba, ni otra calle que
    // va encimada a lo largo del carril)
    const cruce = (x, y, a, e) => {
      for (const id of traffic.grid.get(GK(Math.floor(x / traffic.GC), Math.floor(y / traffic.GC))) || []) {
        const o = traffic.edges[id]; if (fila.has(o) || o.puente || e.puente) continue;
        for (let q = 0; q < o.p.length - 2; q += 2) {
          if (segDist(x, y, o.p[q], o.p[q + 1], o.p[q + 2], o.p[q + 3]) >= o.w / 2 + 2 * M) continue;
          if (Math.abs(Math.sin(Math.atan2(o.p[q + 3] - o.p[q + 1], o.p[q + 2] - o.p[q]) - a)) > 0.4) return true;
        }
      }
      return false;
    };
    for (const [e, d0] of fila) {
      const rr = mulberry(e.id * 131 + 7), ta = libreEn(e.a), tb = libreEn(e.b), tramo = { e, t0: Infinity, t1: -Infinity, G };
      for (const k of e.c <= MAJOR ? [0, 1, 2] : [0]) {
        // la cabeza de la fila, un poco antes de la caseta (en el tramo final, ya junto a la linea; y donde el carril sigue
        // hacia la linea, sin hueco)
        let t = e.len - tb - (d0 || tb || e.sigue || e.final ? rr() * 6 : 4 * M + rr() * 10);
        for (;;) {
          const ti = G.tipos[(rr() * G.tipos.length) | 0], T = VTYPES[ti];
          t -= T.L / 2;
          if (t < ta + T.L / 2 || d0 + e.len - t > G.largo) break;
          edgePos(e, t, 1, laneLat(e, k) + (rr() - 0.5) * 2.5, tmp);
          if (!blocked(tmp.x, tmp.y) && libre(tmp.x, tmp.y) && !cruce(tmp.x, tmp.y, tmp.a, e)) {
            const s = { x: tmp.x, y: tmp.y, a: tmp.a + (rr() - 0.5) * 0.07, ti, ci: (rr() * T.cols.length) | 0, d: rr() < 0.4 ? 1 + ((rr() * DIRTY_SEEDS) | 0) : 0, G, car: null };
            filaSlots.push(s); G.n++; tramo.t0 = Math.min(tramo.t0, t); tramo.t1 = Math.max(tramo.t1, t);
            const key = GK(Math.floor(s.x / FC), Math.floor(s.y / FC)); if (!puestos.has(key)) puestos.set(key, []); puestos.get(key).push(s);
            gridAdd(chunkFila, s, [s.x, s.y, s.x, s.y], CHUNK);
          }
          t -= T.L / 2 + 3 + rr() * 5; // defensa con defensa (algunos dejan su espacito)
        }
      }
      if (tramo.t1 - tramo.t0 > 40) G.tramos.push(tramo);
    }
  }
}

class Main extends Phaser.Scene {
  constructor() { super('main'); }

  create() {
    makeTextures(this);
    this.chunks = new Map();
    this.cars = []; this.peds = []; this.parked = [];
    this.fila = []; this.filaGrid = new Map(); // los de la fila de la garita (ver updateFila)
    this.vendedores = []; // y los que venden entre los carros (ver updateVendedores)
    this.tmp = {};
    this.cameras.main.setBounds(-NIEBLA_FUERA, 0, WORLD_W + 2 * NIEBLA_FUERA, WORLD_H + NIEBLA_FUERA);
    this.makeNiebla();
    this.cameras.main.setBackgroundColor('#2a2a2a');
    this.keys = this.input.keyboard.addKeys('W,A,S,D,UP,DOWN,LEFT,RIGHT,SHIFT,SPACE,E,ENTER,F,T,M,R,N,L');
    this.input.keyboard.addCapture('SPACE,UP,DOWN,LEFT,RIGHT');

    // marcadores de lugares y tacos
    this.marks = [];
    for (const l of landmarks) {
      // (se pasan a la banqueta si quedaban dentro de un edificio, cuando llegan los de alrededor: ver acomodarLugares)
      const ring = this.crearAro(0xffd23f, 3);
      // la insignia del lugar flota un poco (cada una a su ritmo)
      const star = this.add.image(l.x, l.y, l.icon).setDepth(20).setScale(0.62 / SPR);
      this.tweens.add({ targets: star, y: l.y - 3, duration: 900 + Math.random() * 300, yoyo: true, repeat: -1, ease: 'Sine.inOut', delay: Math.random() * 900 });
      const label = this.add.text(l.x, l.y - 34, l.name, { fontSize: '15px', fontStyle: 'bold', color: '#fff', stroke: '#000', strokeThickness: 4, resolution: TXT_RES }).setOrigin(0.5).setDepth(20);
      this.marks.push({ l, ring, star, label });
    }
    this.paroCool = 0; this.colocarParos();
    for (const t of tacos) {
      const [sx, sy, rot] = sidewalkSpot(t.x, t.y);
      t.x = sx; t.y = sy;
      t.icon = this.add.image(t.x, t.y, 'puesto' + (hash(t.name.length * 31 + (t.x | 0)) % LONAS.length) + (Math.cos(rot) < -0.3 ? 'u' : '')).setScale(1 / SPR).setRotation(rot).setDepth(6);
      // vapor que sale del comal (el comal queda abajo a la izquierda del dibujo, girado con el puesto)
      const ox = 10.5 + 5 - PUESTO_W / 2, oy = 23 + 3 - PUESTO_H / 2, c = Math.cos(rot), sn = Math.sin(rot);
      t.vapor = [0, 1].map(i => this.add.image(t.x + ox * c - oy * sn, t.y + ox * sn + oy * c, 'vapor').setDepth(6.5).setAlpha(0).setScale(0.4 / SPR));
      t.vapor.forEach((v, i) => this.tweens.add({ targets: v, y: v.y - 10, alpha: { from: 0.55, to: 0 }, scale: { from: 0.35 / SPR, to: 0.9 / SPR }, duration: 1600, delay: i * 800 + Math.random() * 400, repeat: -1 }));
      this.adornosComida(t, COMIDA.taco); solidoComida(t.x, t.y, rot, SOLIDO_PUESTO);
    }
    for (const c of cafes) {
      // el toldo queda pegado a la fachada, del lado de la banqueta que da al edificio
      const [sx, sy, rot] = sidewalkSpot(c.x, c.y, (SIDEWALK + 0.5) * M + 2);
      c.x = sx; c.y = sy;
      c.icon = this.add.image(c.x, c.y, 'cafe' + (hash(c.name.length * 17 + (c.x | 0)) % TOLDOS.length) + (Math.cos(rot) < -0.3 ? 'u' : '')).setScale(1 / SPR).setRotation(rot).setDepth(6);
      // vapor de las tazas de las dos mesitas (abajo en el dibujo, girado con el cafe)
      const cs = Math.cos(rot), sn = Math.sin(rot);
      c.vapor = [[10 + 4 - CAFE_W / 2, 28 + 2 - CAFE_H / 2], [40 + 4 - CAFE_W / 2, 28 + 2 - CAFE_H / 2]].map(([ox, oy], i) => {
        const v = this.add.image(c.x + ox * cs - oy * sn, c.y + ox * sn + oy * cs, 'vapor').setDepth(6.5).setAlpha(0);
        this.tweens.add({ targets: v, y: v.y - 7, alpha: { from: 0.45, to: 0 }, scale: { from: 0.2 / SPR, to: 0.55 / SPR }, duration: 1800, delay: i * 900 + Math.random() * 500, repeat: -1 });
        return v;
      });
      this.adornosComida(c, COMIDA.cafe); solidoComida(c.x, c.y, rot, SOLIDO_CAFE);
    }
    for (const c of chinas) {
      // la entrada (punta de la alfombra) queda en la banqueta; el local se mete hacia el edificio
      const [sx, sy, rot] = sidewalkSpot(c.x, c.y, (SIDEWALK + 0.5) * M + 2);
      c.x = sx; c.y = sy;
      const bx = -Math.sin(rot), by = Math.cos(rot); // hacia el frente del local (la calle)
      c.up = Math.cos(rot) < -0.3 ? 'u' : '';
      c.icon = this.add.image(sx - bx * 30, sy - by * 30, 'antro0' + c.up).setScale(1 / SPR).setRotation(rot).setDepth(6);
      const hh = Math.abs(Math.cos(rot)) * 40 + Math.abs(Math.sin(rot)) * 54;
      c.label = this.add.text(c.icon.x, c.icon.y - hh - 8, c.name, { fontSize: '12px', color: '#ff8a80', stroke: '#000', strokeThickness: 3, resolution: TXT_RES }).setOrigin(0.5).setDepth(19);
    }
    { const Y = YONKE, [sx, sy, rot] = sidewalkSpot(Y.x, Y.y, (SIDEWALK + 0.5) * M + 2); this.ponerYonke(Y, sx, sy, rot); }
    for (const e of EGGS) {
      if (e.canal) {
        // adentro del canal: los perritos en el piso y la soga hasta el agua (si no hay canal cerca, en la banqueta)
        const c = lugarEnCanal(e.x, e.y);
        if (c) {
          const d0 = c.b + c.f * 0.05, d1 = c.b + c.f + 22, T = makeCachorros(this, d1 - d0), rot = Math.atan2(-c.ny, -c.nx) + Math.PI / 2;
          // el centro de la imagen: entre los perritos (d0) y el agua (d1), con la parte de arriba hacia la orilla
          const dm = d0 - T.top + T.H / 2;
          e.x = c.x + c.nx * (d0 + 10); e.y = c.y + c.ny * (d0 + 10);
          e.icon = this.add.image(c.x + c.nx * dm, c.y + c.ny * dm, 'egg_cachorros').setScale(1 / 5).setRotation(rot).setDepth(4.6);
          // jalan y aflojan
          this.tweens.add({ targets: e.icon, x: e.icon.x - c.nx * 1.2, y: e.icon.y - c.ny * 1.2, duration: 700, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
          e.persona = { x: c.x + c.nx * d1, y: c.y + c.ny * d1 };
          continue;
        }
      }
      if (e.mar) {
        // hacia el poniente hasta el agua; los delfines unos 30 m mar adentro y lo que cuenta es la orilla
        let ox = null;
        for (let x = e.x; x > e.x - 4000; x -= 10) if (inWater(x, e.y) && inWater(x - 60, e.y) && inWater(x - 150, e.y)) { ox = x; break; }
        if (ox !== null) {
          e.x = ox + 15;
          e.icon = this.add.image(ox - 150, e.y, 'egg_delfines').setScale(0.55).setDepth(4.6);
          e.persona = { x: ox - 150, y: e.y - 10 };
          // nadan de un lado a otro, despacito
          this.tweens.add({ targets: e.icon, y: e.y + 26, duration: 3200, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
          this.tweens.add({ targets: e.icon, rotation: 0.12, duration: 1700, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
          continue;
        }
      }
      const [sx, sy, rot] = e.libre && !blocked(e.x, e.y) && !onRoad(e.x, e.y) ? [e.x, e.y, e.rot ?? 0.4] : sidewalkSpot(e.x, e.y, (SIDEWALK + 0.5) * M);
      e.x = sx; e.y = sy;
      e.icon = this.add.image(sx, sy, 'egg_' + e.k).setScale(0.4).setRotation(rot).setDepth(7).setVisible(!e.got || e.fija);
      if (e.fija) e.persona = { x: sx, y: sy - (e.k === 'monolito' ? 40 : 0) };
      if (e.fija && !e.quieto) { this.tweens.add({ targets: e.icon, rotation: rot + 0.06, duration: 900, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' }); }
    }
    this.stamina = STAMINA; this.tired = false; this.burning = []; this.perros = []; this.gatos = []; this.gatoProx = 0; this.fuegos = []; this.manchas = []; this.blastLights = [];
    this.chatDeck = []; this.chatCool = 0;
    this.bubble = { el: $('bubble'), ped: null, t: 0 };
    this.staminaBar = this.add.graphics().setDepth(20);
    this.target = this.crearAro(0x57d16b, 4, true);
    this.route = null; this.routeT = 0;

    // el jugador aparece donde se quedo la ultima vez (con su carro) o donde se eligio al arrancar (ver elegirInicio)
    const { pos, side } = INICIO;
    this.player = { x: side.x, y: side.y, a: side.a ?? pos.a, sprite: this.add.sprite(side.x, side.y, 'ped' + PLAYER_SHIRT, 0).setDepth(12).setScale(1 / SPR) };
    this.inCar = null;
    if (pos) {
      const car = this.makeCar(pos.x, pos.y, pos.a, INICIO.v || { taxi: true });
      if (INICIO.hp != null) car.hp = Math.max(1, Math.min(car.maxHp, INICIO.hp));
      if (INICIO.dentro) { this.inCar = car; this.player.sprite.setVisible(false); if (car.bici) car.sprite.setTexture('bici_' + car.bici + '_r'); } else this.parked.push(car);
      this.ultimoCarro = car;
    }
    this.cameras.main.startFollow((this.inCar || this.player).sprite, true, 0.15, 0.15);
    this.guardaT = 15;
    this.cameras.main.setZoom(this.baseZoom());

    this.taxi = null; this.waypoint = null;
    this.perk = perks();
    this.night = { a: state.night && this.perk.noche ? 1 : 0, rt: null, cut: [], glow: [] };
    if (state.celebrated.includes('taco')) this.spawnSpecial('troca', 60);
    if (state.celebrated.includes('final')) this.spawnSpecial('zonkey', 110);
    // la fiesta: si ya fue, los mariachis se quedan en la plaza; si falta, sigue la invitacion
    this.fiesta = null;
    if (state.celebrated.includes('fiesta')) this.spawnMariachis();
    else if (state.celebrated.includes('final')) this.time.delayedCall(4000, () => { this.inviteFiesta(); toast('🎉 Te esperan en la Plaza Santa Cecilia', 'La fiesta no empieza sin ti. Sigue la flecha.', 5); });
    this.populate(true);
    updateStats();
    this.setObjective();
    this.nameT = 0; this.spawnT = 0;
    setupBigMap(this);
  }

  // donde quedaste, para volver ahi al abrir otra vez (en metros desde la esquina de referencia, asi aguanta que
  // el mapa crezca): tu y tu carro (en el que vas o del que te bajaste, si sigue cerca y sirve)
  posicion() {
    const m = (x, y, a) => [Math.round((x - REF_X) / M * 10) / 10, Math.round((y - REF_Y) / M * 10) / 10, Math.round(a * 100) / 100];
    const P = this.inCar || this.player, r = { p: m(P.x, P.y, P.a) };
    const car = this.inCar || this.ultimoCarro;
    const v = car && (car.moto ? { moto: true } : car.T === VT_DEPORTIVA ? { deportiva: true } : car.T === VT_TAXI ? { taxi: true } :
      car.T === VT_URBANO ? { urbano: true } : car.gas ? { gas: true } : car.pan ? { pan: true } : car.bici ? { bici: car.bici } : car.v && !car.special ? car.v : null);
    if (v && car.hp > 0 && !car.wrecked && (car === this.inCar || (this.parked.includes(car) && dist(car.x, car.y, P.x, P.y) < 400)))
      r.c = { p: m(car.x, car.y, car.a), v, hp: Math.round(car.hp), dentro: car === this.inCar };
    return r;
  }

  // en celular vertical se aleja un poco: la pantalla es angosta y si no casi no se ve a los lados
  baseZoom() {
    const chico = Math.min(window.innerWidth, window.innerHeight) < 600, vertical = window.innerHeight > window.innerWidth;
    return (chico ? (vertical ? 1.2 : 1.45) : 1.8) * DPR;
  }

  walker(x, y, rate) {
    const i = pedCalle(), V = PED_VARIANTS[i];
    const s = this.add.sprite(x, y, 'ped' + i, 0).setDepth(5).setScale(1 / SPR);
    s.play({ key: 'walk' + i, startFrame: (Math.random() * 8) | 0 }); s.anims.timeScale = rate * V.speed;
    s.pace = V.speed; // los viejitos caminan mas despacio
    s.tipo = V.tipo;
    return s;
  }

  // o: { moto, taxi, ti (tipo), ci (color), dirty o d (cual mugre) }; sin tipo se escoge uno al azar
  carSpec(o = {}) {
    if (o.moto) return { T: VT_MOTO, key: 'moto' + ((Math.random() * MOTO_COLS.length) | 0), ox: 0.5, oy: 0.5, dirty: false };
    if (o.deportiva) return { T: VT_DEPORTIVA, key: 'deportiva' + ((Math.random() * DEPORTIVA_COLS.length) | 0), ox: 15 / 28, oy: 0.5, dirty: false };
    if (o.taxi) return { T: VT_TAXI, key: 'taxi', ox: 0.5, oy: 0.5, dirty: false };
    if (o.troca) return { T: VT_TROCA_TACOS, key: 'troca_tacos', ox: (VT_TROCA_TACOS.L / 2 + 3) / (VT_TROCA_TACOS.L + 6), oy: 0.5, dirty: false };
    if (o.zonkey) return { T: VT_ZONKEY, key: 'zonkey', ox: (VT_ZONKEY.L / 2 + 3) / (VT_ZONKEY.L + 6), oy: 0.5, dirty: false };
    if (o.escolta) return { T: VT_ESCOLTA, key: 'escolta0', ox: (VT_ESCOLTA.L / 2 + 1) / (VT_ESCOLTA.L + 5), oy: (VT_ESCOLTA.W / 2 + 1) / (VT_ESCOLTA.W + 5), dirty: false };
    if (o.urbano) return { T: VT_URBANO, key: 'urbano' + ((Math.random() * URBANO_COLS.length) | 0), ox: (VT_URBANO.L / 2 + 1) / (VT_URBANO.L + 5), oy: (VT_URBANO.W / 2 + 1) / (VT_URBANO.W + 5), dirty: false };
    if (o.bici && VT_BICI[o.bici]) return { T: VT_BICI[o.bici], key: 'bici_' + o.bici, ox: 0.5, oy: 0.5, dirty: false };
    if (o.pan) return { T: VT_PAN, key: 'panadero', ox: (VT_PAN.L / 2 + 1) / (VT_PAN.L + 5), oy: (VT_PAN.W / 2 + 1) / (VT_PAN.W + 5), dirty: false };
    if (o.gas) return { T: VT_GAS, key: 'pipa', ox: (VT_GAS.L / 2 + 1) / (VT_GAS.L + 5), oy: (VT_GAS.W / 2 + 1) / (VT_GAS.W + 5), dirty: false };
    if (o.poli) return { T: VT_POLI, key: 'poli0', ox: (VT_POLI.L / 2 + 1) / (VT_POLI.L + 5), oy: (VT_POLI.W / 2 + 1) / (VT_POLI.W + 5), dirty: false };
    const ti = o.ti ?? randomVType(), T = VTYPES[ti], ci = o.ci ?? (Math.random() * T.cols.length) | 0;
    const dirty = o.d != null ? o.d > 0 : o.dirty ?? Math.random() < 0.45, d = o.d ?? (dirty ? 1 + ((Math.random() * DIRTY_SEEDS) | 0) : 0);
    return { T, key: vehicleTexture(this, ti, ci, d), ox: (T.L / 2 + 1) / (T.L + 5), oy: (T.W / 2 + 1) / (T.W + 5), dirty, v: { ti, ci, d } };
  }
  makeCar(x, y, a, o) {
    const sp = o && o.T ? o : this.carSpec(o), T = sp.T, f = sp.dirty ? 0.7 : 1;
    return { x, y, a, vx: 0, vy: 0, T, dirty: sp.dirty, moto: T === VT_MOTO, dosRuedas: T === VT_MOTO || T === VT_DEPORTIVA || !!T.bici, bici: T.bici, poli: T === VT_POLI, gas: T === VT_GAS, pan: T === VT_PAN, hp: Math.round(T.hp * f), maxHp: Math.round(T.hp * f),
      top: T.top * (sp.dirty ? 0.92 : 1), acc: T.acc * (sp.dirty ? 0.9 : 1), hl: T.L / 2 - 1, hw: T.W / 2 - 1, v: sp.v,
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
    // los edificios de alrededor se piden con tiempo (media region mas alla, y el doble hacia donde vas);
    // de vez en cuando se sueltan los de lejos
    const RP = REG_PX / 2;
    regionesListas(v.x + Math.min(0, ax * 2) - RP, v.y + Math.min(0, ay * 2) - RP, v.right + Math.max(0, ax * 2) + RP, v.bottom + Math.max(0, ay * 2) + RP);
    if ((this.soltarT = (this.soltarT || 0) - dt) < 0) { this.soltarT = 2; soltarLejanas(v.centerX, v.centerY); }
    const want = [];
    for (let cx = cx0; cx <= cx1; cx++) for (let cy = cy0; cy <= cy1; cy++) {
      if (cx * CHUNK >= WORLD_W || cy * CHUNK >= WORLD_H || this.chunks.has(cx + ',' + cy)) continue;
      // sin sus edificios todavia no (llegan en unos milisegundos)
      if (!regionesListas(cx * CHUNK, cy * CHUNK, (cx + 1) * CHUNK, (cy + 1) * CHUNK)) continue;
      const seen = cx * CHUNK < v.right && (cx + 1) * CHUNK > v.x && cy * CHUNK < v.bottom && (cy + 1) * CHUNK > v.y;
      want.push([cx, cy, Math.hypot((cx + 0.5) * CHUNK - px, (cy + 0.5) * CHUNK - py) - (seen ? 1e6 : 0)]);
    }
    const add = (cx, cy, cv) => {
      const k = cx + ',' + cy, tk = 'ch' + k;
      this.textures.addCanvas(tk, cv);
      this.chunks.set(k, this.add.image(cx * CHUNK - 1, cy * CHUNK - 1, tk).setOrigin(0).setDepth(0).setScale(1 / RES));
      this.copasTrozo(cx, cy, k);
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
      if (cx < cx0 - KEEP || cx > cx1 + KEEP || cy < cy0 - KEEP || cy > cy1 + KEEP) {
        img.destroy(); this.textures.remove('ch' + k); this.chunks.delete(k);
        for (const a of this.copas.get(k) || []) a.destroy();
        this.copas.delete(k);
      }
    }
  }
  // los arboles de un trozo (los que tienen ahi el centro), encima de la gente y los carros: la sombra ya quedo en el piso
  copasTrozo(cx, cy, k) {
    if (!this.copas) {
      this.copas = new Map();
      const tx = this.textures.addCanvas('arboles', arbolesAtlas()), S = ARB_SZ * RES;
      for (let t = 0; t < ARB_TIPOS; t++) for (let v = 0; v < ARB_VAR; v++) tx.add(t * ARB_VAR + v, 0, v * S, t * S, S, S);
    }
    const L = [];
    for (const i of chunkArboles.get(GK(cx, cy)) || []) {
      const x = arboles.X[i], y = arboles.Y[i];
      if (Math.floor(x / CHUNK) !== cx || Math.floor(y / CHUNK) !== cy || !arbolVa(i)) continue;
      L.push(this.add.image(x, y, 'arboles', arboles.T[i] * ARB_VAR + arboles.V[i]).setDepth(13).setScale(1 / RES));
    }
    this.copas.set(k, L);
  }

  // lo que pasa detras de un edificio (ver bajoTecho) se desvanece en vez de verse encima del techo;
  // tu y tu carro quedan como fantasma para que no te pierdas
  ocultarTapados(dt) {
    const v = this.cameras.main.worldView, k = Math.min(1, dt * 12), P = this.player;
    const ve = (x, y) => x > v.x - 40 && x < v.right + 40 && y > v.y - 40 && y < v.bottom + 40;
    const fade = (o, sp, min) => {
      if (!sp || !sp.visible || !ve(o.x, o.y)) return;
      const t = (o.fila ? (o.techo ??= bajoTecho(o.x, o.y)) : bajoTecho(o.x, o.y)) ? min : 1;
      if (sp.alpha !== t) sp.setAlpha(Math.abs(t - sp.alpha) < 0.02 ? t : sp.alpha + (t - sp.alpha) * k);
      if (o.scorch) o.scorch.setAlpha(sp.alpha);
    };
    for (const p of this.peds) if (!p.dead) fade(p, p.sprite, 0);
    for (const d of this.perros) if (!d.dead && d.st !== 'vete') fade(d, d.sprite, 0);
    if (this.ratero) fade(this.ratero, this.ratero.sprite, 0);
    for (const L of [this.cars, this.parked]) for (const c of L) if (c !== this.inCar) fade(c, c.sprite, 0);
    for (const c of this.fila) if (c.techo !== false || c.sprite.alpha !== 1) fade(c, c.sprite, 0); // los que no tapa nada ya quedaron
    if (this.inCar) fade(this.inCar, this.inCar.sprite, 0.4); else fade(P, P.sprite, 0.4);
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
      if (e.trampa) continue;
      const dir = e.one ? 1 : (Math.random() < 0.5 ? 1 : -1), s = rnd(0, e.len);
      const lane = (Math.random() * 4) | 0, lat = laneLat(e, lane);
      const q = edgePos(e, s, dir, lat, {});
      if (initial ? dist(q.x, q.y, p.x, p.y) < 160 : (inView(q.x, q.y) || dist(q.x, q.y, p.x, p.y) < R)) continue;
      const moto = Math.random() < 0.3 && this.cars.filter(c => c.moto).length < 5;
      const poli = !moto && Math.random() < 0.15 && this.cars.filter(c => c.poli).length < 3;
      const deportiva = !moto && !poli && Math.random() < 0.15 && this.cars.filter(c => c.T === VT_DEPORTIVA).length < 2;
      // camiones urbanos por las calles grandes y pipas de gas por donde sea
      const otro = moto || poli || deportiva;
      const urbano = !otro && e.c <= 4 && Math.random() < 0.25 && this.cars.filter(c => c.T === VT_URBANO).length < 4;
      const gas = !otro && !urbano && Math.random() < 0.1 && this.cars.filter(c => c.gas).length < 2;
      // el carro del pan nomas en las calles de las colonias (no en el Centro, la Zona Norte ni la Zona Rio), uno a la vez
      const pan = !otro && !urbano && !gas && (e.c === 5 || e.c === 6) && Math.random() < 0.12 && !this.cars.some(c => c.pan) && !ZONAS_SIN_PAN.has(zonaDe(q.x, q.y));
      const spec = this.carSpec({ moto, poli, deportiva, urbano, gas, pan });
      if (this.cars.some(c => dist(c.x, c.y, q.x, q.y) < 26 + c.hl + spec.T.L / 2)) continue;
      const car = this.makeCar(q.x, q.y, q.a, spec);
      Object.assign(car, { e, dir, s, lat, lane, speed: 0, max: rnd(50, 80) * (e.c <= 2 ? 1.2 : 1) * (moto ? 1.15 : poli ? 1.1 : deportiva ? 1.35 : car.top / 230) });
      // transporte publico (el urbano y las calafias): van rapidisimo, rebasan, no frenan en los topes y se paran
      // de golpe a subir pasaje
      if (urbano || spec.T.name === 'Calafia') Object.assign(car, { rutero: true, max: rnd(95, 120) * (e.c <= 2 ? 1.15 : 1), latS: lat, paradaT: rnd(12, 30), carrilT: 0, clxT: 0 });
      if (gas) Object.assign(car, { max: rnd(36, 50), paradaT: rnd(15, 35), golpes: 0 });
      if (pan) Object.assign(car, { max: rnd(30, 42), paradaT: rnd(10, 25) });
      // conductores erraticos: zigzaguean, no frenan por nadie y tarde o temprano se estrellan
      if (!otro && !car.rutero && !gas && !pan && Math.random() < 0.06 && this.cars.filter(c => c.loco).length < 2) {
        Object.assign(car, { loco: true, ph: rnd(0, 6), wf: rnd(1.6, 2.6), max: car.max * 1.45, locoT: rnd(5, 14), derrape: 0 });
      }
      this.cars.push(car);
      if (Math.random() < 0.05 && this.cars.filter(c => c.escolta).length < 4) this.convoy(e, dir, lane, (x, y) => !inView(x, y) && dist(x, y, p.x, p.y) > (initial ? 160 : R));
    }
    n = 0;
    while (this.peds.length < Q.gente && n++ < 6) {
      const e = randomEdgeNear(walkG, p.x, p.y, initial ? 60 : R + 20, R + 250); if (!e) break;
      const side = e.c >= 8 ? rnd(-3, 3) : (Math.random() < 0.5 ? 1 : -1) * (e.w / 2 + rnd(0.6, 2.2) * M);
      const ped = { e, dir: Math.random() < 0.5 ? 1 : -1, s: rnd(0, e.len), side, speed: rnd(14, 26), st: 'walk', t: 0, x: 0, y: 0, a: 0 };
      edgePos(e, ped.s, ped.dir, ped.side, ped);
      if (blocked(ped.x, ped.y) || enComida(ped.x, ped.y, 2) || !regionesListas(ped.x, ped.y, ped.x, ped.y) || (!initial && inView(ped.x, ped.y))) continue;
      ped.sprite = this.walker(ped.x, ped.y, ped.speed / 20);
      ped.speed *= ped.sprite.pace; ped.tipo = ped.sprite.tipo;
      this.peds.push(ped);
    }
    // en un sobreruedas cercano, gente de compras en los pasillos (aparte de la de la calle)
    if (walkTianguis.length && SOBRERUEDAS.some(sr => dist(sr.x, sr.y, p.x, p.y) < sr.R + R + 400)) {
      // (aqui si aparecen a la vista, pero lejos de ti y desvaneciendose: ver ocultarTapados)
      const cerca = walkTianguis.filter(e => Math.abs(e.p[0] - p.x) < R + 300 && Math.abs(e.p[1] - p.y) < R + 300);
      n = 0;
      while (cerca.length && this.peds.filter(q => q.tianguis).length < Q.gente && n++ < 4) {
        const e = pick(cerca);
        const ped = { e, dir: Math.random() < 0.5 ? 1 : -1, s: rnd(0, e.len), side: latTianguis(e), speed: rnd(10, 18), st: 'walk', t: rnd(1, 6), x: 0, y: 0, a: 0, tianguis: true, ph: rnd(0, 6) };
        edgePos(e, ped.s, ped.dir, ped.side, ped);
        if (!regionesListas(ped.x, ped.y, ped.x, ped.y) || dist(ped.x, ped.y, p.x, p.y) < 60) continue;
        ped.sprite = this.walker(ped.x, ped.y, ped.speed / 20).setAlpha(0);
        ped.speed *= ped.sprite.pace; ped.tipo = ped.sprite.tipo;
        this.peds.push(ped);
      }
    }
    // coyotes: raros, solo a menos de 250 m de la linea y nunca mas de dos
    if (Math.random() < 0.006 && p.y - borderY(p.x) < 400 * M && this.peds.filter(q => q.coyote).length < 2) {
      const e = randomEdgeNear(walkG, p.x, p.y, initial ? 60 : R + 20, R + 250);
      if (e && e.c < 8) {
        const side = (Math.random() < 0.5 ? 1 : -1) * (e.w / 2 + rnd(0.6, 2) * M);
        const ped = { e, dir: Math.random() < 0.5 ? 1 : -1, s: rnd(0, e.len), side, speed: rnd(11, 16), st: 'walk', t: rnd(3, 8), x: 0, y: 0, a: 0, coyote: true, ph: rnd(0, 6) };
        edgePos(e, ped.s, ped.dir, ped.side, ped);
        if (ped.y - borderY(ped.x) < 250 * M && !blocked(ped.x, ped.y) && regionesListas(ped.x, ped.y, ped.x, ped.y) && (initial || !inView(ped.x, ped.y))) {
          ped.sprite = this.add.sprite(ped.x, ped.y, 'pedC', 0).setDepth(5).setScale(1 / SPR);
          ped.sprite.play({ key: 'walkC', startFrame: (Math.random() * 8) | 0 }); ped.sprite.anims.timeScale = ped.speed / 20;
          this.peds.push(ped);
        }
      }
    }
    // perros callejeros por las banquetas (los de la jauria aparte)
    n = 0;
    while (this.perros.filter(d => !d.jauria).length < (Q.gente > 20 ? 4 : 3) && n++ < 3) {
      const e = randomEdgeNear(walkG, p.x, p.y, initial ? 60 : R + 20, R + 250); if (!e) break;
      const side = e.c >= 8 ? rnd(-3, 3) : (Math.random() < 0.5 ? 1 : -1) * (e.w / 2 + rnd(0.6, 2.2) * M);
      const d = { e, dir: Math.random() < 0.5 ? 1 : -1, s: rnd(0, e.len), side, speed: rnd(20, 34), st: 'walk', t: rnd(3, 8), x: 0, y: 0, a: 0 };
      edgePos(e, d.s, d.dir, d.side, d);
      if (blocked(d.x, d.y) || enComida(d.x, d.y, 2) || !regionesListas(d.x, d.y, d.x, d.y) || (!initial && inView(d.x, d.y))) continue;
      this.perros.push(this.perroSprite(d));
    }
    // gatos en las azoteas de las casas (hasta dos a la vez y no siempre: mas raros que los perros)
    const now = this.time.now;
    if (this.gatos.length < 2 && now > this.gatoProx) {
      const c = this.inCar, va = c && Math.hypot(c.vx, c.vy) > 40 ? Math.atan2(c.vy, c.vx) : undefined;
      const g = this.buscarAzotea(p.x, p.y, initial ? 120 : R + 20, R + 220, initial ? null : inView, va);
      if (g && !this.gatos.some(o => o.b === g.b)) { this.gatos.push(this.gatoSprite(g)); this.gatoProx = now + rnd(8000, 20000); }
      else this.gatoProx = now + 2000;
    }
    this.poneBici(p, R, initial, inView);
    const far = R + 520;
    this.parked = this.parked.filter(c => { if (!c.bici || c === this.ultimoCarro || dist(c.x, c.y, p.x, p.y) < far * (c.comprada ? 6 : 2)) return true; c.sprite.destroy(); return false; });
    this.gatos = this.gatos.filter(c => { if (dist(c.x, c.y, p.x, p.y) > far) { c.sprite.destroy(); if (this.bubble.ped === c) this.bubble.t = 0; this.gatoProx = Math.max(this.gatoProx, now + rnd(10000, 25000)); return false; } return true; });
    this.perros = this.perros.filter(c => { if (dist(c.x, c.y, p.x, p.y) > far) { c.sprite.destroy(); return false; } return true; });
    this.cars = this.cars.filter(c => { if (!c.escena && dist(c.x, c.y, p.x, p.y) > far) { c.sprite.destroy(); return false; } return true; });
    this.peds = this.peds.filter(c => { if (dist(c.x, c.y, p.x, p.y) > far) { c.sprite.destroy(); return false; } return true; });
  }
  // bicis y patinetas: de vez en cuando una sin candado en la banqueta, viendo a lo largo de la calle (raras: una cada
  // minuto o dos, y nunca si ya hay otra suelta cerca). Al pasar junto a ella a pie, un aviso para que la veas
  // ----- las apps del telefono -----
  // TeleTJ: se cobra, se oscurece la pantalla, se cargan los edificios de alla y apareces en la banqueta (o en la
  // calle, si vas en carro)
  async teletransportar(d) {
    const l = landmarks.find(q => q.name === d.lugar); if (!l || state.money < TELE_PRECIO || this.teleporting) return;
    this.teleporting = true;
    state.money -= TELE_PRECIO; save(); sonidoCompra = 'tele'; updateStats();
    const cam = this.cameras.main; cam.fadeOut(300, 255, 255, 255);
    await new Promise(ok => this.time.delayedCall(320, ok));
    await esperarRegiones(l.x - 1200, l.y - 1200, l.x + 1200, l.y + 1200);
    const car = this.inCar;
    if (car && !car.bici) {
      const n = nearEdge(traffic, l.x, l.y), q = edgePos(n.e, n.s, 1, n.e.one ? 0 : n.e.w / 4, {});
      car.x = q.x; car.y = q.y; car.a = q.a; car.vx = car.vy = 0; car.sprite.setPosition(car.x, car.y).setRotation(car.a);
    } else {
      const [x, y] = nearestSidewalk(l.x, l.y), o = car || this.player;
      o.x = x; o.y = y; if (car) { car.vx = car.vy = 0; } o.sprite.setPosition(x, y);
    }
    const f = this.focus(); cam.centerOn(f.x, f.y);
    this.updateChunks(true); // lo de alrededor de una vez (detras de la pantalla blanca)
    cam.fadeIn(500, 255, 255, 255);
    this.teleporting = false;
    toast('🌀 TeleTJ: ' + d.zona + ' (-$' + TELE_PRECIO.toLocaleString('es-MX') + ')', pick(TELE_LLEGADA), 4);
  }
  // BiciTJ: la bici te la dejan a un lado, lista para subirte
  comprarBici(b) {
    if (state.money < b.precio) return;
    const f = this.focus(), a = Math.random() * 6.28;
    let x = f.x, y = f.y;
    for (let k = 0; k < 12; k++) { const tx = f.x + Math.cos(a + k) * 16, ty = f.y + Math.sin(a + k) * 16; if (!blocked(tx, ty)) { x = tx; y = ty; break; } }
    state.money -= b.precio; save(); sonidoCompra = 'compra'; updateStats();
    if (window.SND) this.time.delayedCall(450, () => SND.play('timbreBici'));
    const bici = this.makeCar(x, y, Math.random() * 6.28, this.carSpec({ bici: b.k }));
    bici.comprada = true; this.parked.push(bici);
    this.tweens.add({ targets: bici.sprite, scale: { from: bici.sprite.scale * 1.6, to: bici.sprite.scale }, duration: 400, ease: 'Back.easeOut' });
    toast(b.ico + ' ¡Llegó tu ' + VT_BICI[b.k].name.toLowerCase() + '! (-$' + b.precio + ')', 'Te la dejaron aquí junto. Súbete con ' + (document.body.classList.contains('touch') ? 'SUBIR' : 'E') + '.', 4);
  }
  // Antojos: se cobra y en un rato llega el repartidor caminando hasta donde estes
  pedirComida(c) {
    if (state.money < c.precio || this.pedido) return;
    state.money -= c.precio; save(); sonidoCompra = 'pedido'; updateStats();
    this.pedido = { c, t: rnd(18, 35), rep: null };
    toast('🍔 Pediste: ' + c.nombre + ' (-$' + c.precio + ')', 'Llega en unos ' + Math.round(this.pedido.t) + ' segundos, según la app. Ajá.', 3.5);
  }
  updatePedido(dt) {
    const pd = this.pedido; if (!pd) return;
    const f = this.focus();
    // donde aparece: a unos 200 px de ti, donde se pueda estar parado (calle, banqueta, monte...). Antes era la
    // banqueta mas cercana, y en el Cerro Colorado quedaba tan lejos que nunca llegaba
    const cerca = () => {
      for (let k = 0; k < 24; k++) {
        const a = Math.random() * 6.28, R = 200 - k * 6, x = f.x + Math.cos(a) * R, y = f.y + Math.sin(a) * R;
        if (!blocked(x, y)) return [x, y];
      }
      return [f.x + 30, f.y];
    };
    if (!pd.rep) {
      if ((pd.t -= dt) > 0) return;
      // aparece a la vuelta y camina derechito hasta ti
      const [x, y] = cerca();
      pd.rep = { x, y, a: 0, sprite: this.walker(x, y, 1.6), escena: true, t: 0 };
      return;
    }
    const r = pd.rep, d = dist(r.x, r.y, f.x, f.y);
    // ya entrego: platican tantito (el dice algo, tu le contestas y se despide) y luego se va y desaparece
    if (pd.fase === 'platica') {
      if (d > 450) pd.paso = 9; // te fuiste: se queda hablando solo
      r.a = Math.atan2(f.y - r.y, f.x - r.x); r.sprite.setRotation(r.a);
      if ((pd.pt -= dt) > 0) return;
      if (pd.paso === 1) { this.globo(f, 'jugador', pick(RESPUESTA_CLIENTE), 3.2); pd.paso = 2; pd.pt = 3.4; return; }
      if (pd.paso === 2) { this.globo(r, 'repartidor', pick(REPARTIDOR_ADIOS), 2.6); pd.paso = 3; pd.pt = 1.2; return; }
      pd.fase = 'vete'; pd.fin = 3; r.a += Math.PI; r.sprite.anims.resume();
      return;
    }
    if (pd.fase === 'vete') {
      r.x += Math.cos(r.a) * 70 * dt; r.y += Math.sin(r.a) * 70 * dt; r.sprite.setPosition(r.x, r.y).setRotation(r.a);
      if ((pd.fin -= dt) <= 0) { r.sprite.destroy(); this.pedido = null; }
      else r.sprite.setAlpha(Math.min(1, pd.fin));
      return;
    }
    // te fuiste lejos (en carro no te alcanza a pie): vuelve a aparecer cerca. Y si de plano no llega en un minuto
    // (algo le estorba), igual te entrega: "te encontro a la tercera"
    if (d > 450) { [r.x, r.y] = cerca(); r.sprite.setPosition(r.x, r.y); }
    r.t += dt;
    if (d > 22 && r.t < 60) {
      r.a = Math.atan2(f.y - r.y, f.x - r.x); const v = Math.min(d - 20, 95 * dt);
      r.x += Math.cos(r.a) * v; r.y += Math.sin(r.a) * v; r.sprite.setPosition(r.x, r.y).setRotation(r.a);
      return;
    }
    // llego: se para frente a ti, dice algo y te entrega (con lo que llegue)
    const mal = Math.random() < 0.15;
    r.sprite.anims.pause(); r.sprite.setFrame(0);
    this.globo(r, 'repartidor', pick(REPARTIDOR_DICE), 3.2);
    toast('🛵 ¡Llegó tu pedido! ' + pd.c.ico, mal ? pick(PEDIDO_EQUIVOCADO) : pick(pd.c.llega), 5);
    if (window.SND) SND.play('timbre');
    pd.fase = 'platica'; pd.paso = 1; pd.pt = 3.4; pd.fin = 0;
  }
  poneBici(p, R, initial, inView) {
    const now = this.time.now;
    if (!this.inCar) for (const c of this.parked) if (c.suelta && !c.vista && dist(c.x, c.y, p.x, p.y) < 110) {
      c.vista = true;
      toast('🚲 ' + (c.bici === 'patineta' ? 'Una patineta' : 'Una ' + c.T.name.toLowerCase()) + ' sin candado', 'Alguien la dejó aquí. ' + (document.body.classList.contains('touch') ? 'Toca SUBIR' : 'Presiona E') + ' para usarla.', 3);
    }
    if (this.biciProx === undefined) this.biciProx = now + rnd(15000, 40000);
    if (now < this.biciProx) return;
    if (this.parked.some(c => c.suelta && dist(c.x, c.y, p.x, p.y) < R * 3)) { this.biciProx = now + 10000; return; }
    for (let n = 0; n < 6; n++) {
      const e = randomEdgeNear(traffic, p.x, p.y, initial ? 120 : R + 40, R + 300); if (!e) break;
      if (e.c > 6 || e.trampa || e.puente) continue;
      const lado = Math.random() < 0.5 ? 1 : -1, q = edgePos(e, rnd(0.2, 0.8) * e.len, 1, lado * (e.w / 2 + SIDEWALK * M * 0.45), {});
      if (blocked(q.x, q.y) || arbolEn(q.x, q.y, 6) || enComida(q.x, q.y, 6) || !regionesListas(q.x, q.y, q.x, q.y) || (!initial && inView(q.x, q.y))) continue;
      if (this.parked.some(c => dist(c.x, c.y, q.x, q.y) < 30)) continue;
      const k = pick(['ruta', 'ruta', 'montana', 'montana', 'montana', 'patineta', 'patineta']);
      const car = this.makeCar(q.x, q.y, q.a + (Math.random() < 0.5 ? Math.PI : 0), this.carSpec({ bici: k }));
      car.suelta = true; this.parked.push(car);
      this.biciProx = now + rnd(60000, 120000);
      return;
    }
    this.biciProx = now + 3000;
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
    if ((this.guardaT -= dt) <= 0) { this.guardaT = 15; save(); } // por si cierran la app sin que avise
    this.updateTraffic(dt);
    this.updatePeds(dt);
    this.updatePedido(dt);
    this.updatePerros(dt);
    this.updateGatos(dt);
    this.updateRatero(dt);
    this.updateEscenas(dt);
    this.updateLotes(dt);
    this.updateFila(dt);
    this.updateVendedores(dt);
    this.updateSobreruedas();
    this.pedChat(dt);
    this.updateBurning(dt);
    this.ocultarTapados(dt);

    const f = this.focus();
    this.updateNiebla(dt, f);
    const cam = this.cameras.main;
    const sp = this.inCar ? Math.hypot(this.inCar.vx, this.inCar.vy) : 0;
    const z = this.baseZoom() * (this.inCar ? 1 - Math.min(sp / 320, 1) * 0.15 : 1.1) * (this.fiesta && this.fiesta.on ? 0.72 : 1); // la fiesta se ve de mas lejos
    cam.setZoom(cam.zoom + (z - cam.zoom) * Math.min(1, dt * 2));
    // al manejar, la camara se adelanta en la direccion del auto para ver lo que viene
    if (window.SND) { let near = 0; for (const o of this.cars) if (Math.abs(o.x - f.x) < 350 && Math.abs(o.y - f.y) < 350) near++; SND.update(!!this.inCar && !this.inCar.bici, sp, near); }
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
      // los arboles como los carros: no te metes en uno, pero si apareciste encima si te puedes salir
      // (lo mismo con los puestos de tacos y los cafes)
      const arb = (x1, y1) => (arbolEn(x1, y1, 3) && !arbolEn(p.x, p.y, 3)) || (enComida(x1, y1, 2) && !enComida(p.x, p.y, 2));
      if (!blocked(nx, p.y) && !this.carBlocks(p.x, p.y, nx, p.y, 3) && !arb(nx, p.y)) p.x = nx;
      if (!blocked(p.x, ny) && !this.carBlocks(p.x, p.y, p.x, ny, 3) && !arb(p.x, ny)) p.y = ny;
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

  // a pie los carros son solidos: no te puedes meter en uno, pero si uno se te encima si puedes salirte
  carBlocks(x0, y0, x1, y1, r) {
    for (const list of [this.cars, this.parked, this.filaEn(x1, y1)]) for (const c of list) if (insideCar(c, x1, y1, r) && !insideCar(c, x0, y0, r)) return true;
    return false;
  }
  // los carros de la fila que estan cerca de un punto (hasta 64 px; son muchos y se buscan en su rejilla)
  filaEn(x, y) {
    const b = this.filaBB;
    if (!this.fila.length || x < b[0] || y < b[1] || x > b[2] || y > b[3]) return NADA;
    const out = [], cx = Math.floor(x / 64), cy = Math.floor(y / 64);
    for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) { const L = this.filaGrid.get(GK(cx + i, cy + j)); if (L) for (const c of L) out.push(c); }
    return out;
  }

  driveCar(car, c, dt) {
    if (car.bici) car.hp = car.maxHp;
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
    // llanta ponchada (karma por atropellar un perrito): no corre y se jala de lado
    const pon = car.ponchada;
    if (pon) {
      pon.t -= dt;
      if (pon.t <= 0) { car.ponchada = null; toast('🔧 Ya inflaste la llanta como pudiste', 'Ahora sí, a manejar con cuidadito.', 2.5); }
      else if (Math.abs(fwd) > 20 && (pon.humoT -= dt) <= 0) { pon.humoT = 0.4; this.puff(car.x - Math.sin(car.a) * car.hw * pon.lado, car.y + Math.cos(car.a) * car.hw * pon.lado); }
    }
    const TOP = car.top * (car.ponchada ? 0.5 : 1), ACC = car.acc * (car.ponchada ? 0.7 : 1);
    if (thr > 0) fwd += (fwd < 0 ? 420 : ACC * (1 - Math.max(0, fwd) / (TOP + 30))) * thr * dt;
    else if (thr < 0) fwd += (fwd > 0 ? -520 : -150) * -thr * dt;
    else fwd -= Math.sign(fwd) * Math.min(Math.abs(fwd), 90 * dt);
    fwd = Math.max(car.dosRuedas ? -40 : -80, Math.min(TOP, fwd));
    if (c.brake) fwd -= Math.sign(fwd) * Math.min(Math.abs(fwd), 160 * dt);
    const grip = c.brake ? 0.9 : 9;
    lat -= lat * Math.min(1, grip * dt);
    const turn = Math.max(-1, Math.min(1, fwd / 90));
    car.a += steer * car.T.steer * turn * dt * (c.brake ? 1.35 : 1);
    if (car.ponchada) car.a += car.ponchada.lado * 0.4 * turn * dt;
    const nfx = Math.cos(car.a), nfy = Math.sin(car.a);
    car.vx = nfx * fwd - nfy * lat; car.vy = nfy * fwd + nfx * lat;

    const nx = car.x + car.vx * dt, ny = car.y + car.vy * dt;
    const hit = (x, y) => this.carBlocked(x, y, car.a, car);
    // si ya quedo encajado, se vale moverse mientras no se encaje mas (asi siempre puede salir)
    const stuck = hit(car.x, car.y) ? this.carBlocked(car.x, car.y, car.a, car, true) : 0;
    this.choqueSobre = false;
    if (!hit(nx, ny) || (stuck && this.carBlocked(nx, ny, car.a, car, true) <= stuck)) { car.x = nx; car.y = ny; }
    else {
      const speed = Math.hypot(car.vx, car.vy), hitObj = this.lastHit;
      if (this.choqueSobre && car === this.inCar && this.time.now > (this.sobreAvisoT || 0)) {
        this.sobreAvisoT = this.time.now + 9000;
        toast('🚧 Calle cerrada: hay sobreruedas', 'Aquí no pasan carros. Bájate con E y date una vuelta a pie.', 3.5);
      }
      if (!hit(nx, car.y)) { car.x = nx; car.vy *= -0.2; car.vx *= 0.8; }
      else if (!hit(car.x, ny)) { car.y = ny; car.vx *= -0.2; car.vy *= 0.8; }
      else { car.vx *= -0.3; car.vy *= -0.3; }
      if (hitObj && hitObj.poli && car === this.inCar) this.hitPoli(speed);
      if (speed > 110) {
        this.jolt(120, Math.min(0.012, speed / 30000));
        if (car === this.inCar && window.SND) SND.play('crash', speed / 250);
        car.hp -= speed / 14;
        if (car.hp <= 0 && !broken) { this.wreck(car); avisoDeshuesado(car); }
      }
      if (car.T.fragil && speed > 45 && !car.wrecked) { car.hp = 0; this.wreck(car); avisoDeshuesado(car); } // la deportiva: al primer choque
      if (car.gas && speed > 80) this.golpeGas(car);
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
          const dmg = car.bici ? 0 : (car.dosRuedas ? 1.5 : 1) * (inB.r / 9) * (4 + sp / 18);
          car.hp -= dmg; car.vx *= 0.8; car.vy *= 0.8;
          this.jolt(160, Math.min(0.012, sp / 20000));
          if (window.SND) SND.play('crash', 0.35);
          toast(pick(sp > 140 ? REACCION_BACHE_FUERTE : REACCION_BACHE) + ' ' + pick(FRASES_BACHE), car.bici ? 'Brincaste, pero la ' + (car.bici === 'patineta' ? 'patineta' : 'bici') + ' ni se inmutó.' : 'Tu auto: -' + Math.round(dmg) + ' de vida', 2);
          if (car.hp <= 0 && !broken) { this.wreck(car); toast('¡Auto deshuesado!', 'El bache ganó. Bájate con E y roba otro.'); }
        }
      }
      car.bache = inB;
    }
    car.sprite.setPosition(car.x, car.y).setRotation(car.a);
    if (car.hp <= 0 && !car.wrecked) { this.wreck(car); avisoDeshuesado(car); }
    car.smokeT = (car.smokeT || 0) - dt;
    if (car.hp < car.maxHp * 0.35 && car.smokeT <= 0) { car.smokeT = 0.12; this.puff(car.x + Math.cos(car.a) * (car.hl - 3), car.y + Math.sin(car.a) * (car.hl - 3)); }
  }
  // auto destruido: explota, queda chamuscado y abollado, y se quema un rato (luego solo humea).
  // k = tamaño de la explosion (1 un carro, mas grande la pipa de gas)
  wreck(car, k = 1) {
    if (car.bici) { car.hp = car.maxHp; return; } // las bicis y patinetas no se rompen
    if (car.wrecked) return;
    if (car.gas && !car.boom) { this.explotarGas(car); return; }
    car.wrecked = true;
    car.sprite.setTint(0x3b302a);
    // el golpe lo levanta y lo deja chueco
    car.a += rnd(-0.35, 0.35) * Math.min(k, 1.5); car.sprite.setRotation(car.a);
    this.tweens.add({ targets: car.sprite, scaleX: 1.22 / SPR, scaleY: 1.22 / SPR, duration: 110 * k, yoyo: true, ease: 'Quad.out' });
    car.scorch = this.add.image(car.x, car.y, 'scorch').setRotation(car.a).setDepth(car.sprite.depth + 0.1).setDisplaySize(car.hl * 2.15, car.hw * 2.3);
    car.burn = 30 * Math.min(k, 1.6); car.fireT = 0; car.burnK = k > 1 ? 1.6 : 1;
    this.burning.push(car);
    this.explosion(car.x, car.y, k, car);
  }
  // la explosion: destello, bola de fuego, chispas, pedazos, humo negro, onda expansiva, tizne en el piso,
  // luz de noche, sacudida y el estruendo. Lejos de la vista solo se hace el daño (ver onda).
  explosion(x, y, k = 1, src = null) {
    this.onda(x, y, k, src);
    const f = this.focus(), d = dist(x, y, f.x, f.y);
    const cerca = src === this.inCar ? 0 : d;
    if (window.SND && cerca < this.viewR() * (k > 1 ? 2 : 1)) SND.play('boom', { k, v: 1 - 0.7 * Math.min(1, cerca / (this.viewR() * (k > 1 ? 2 : 1))) });
    const fuerza = Math.max(0, 1 - cerca / (220 * k));
    if (fuerza > 0) this.jolt(220 + 200 * k * fuerza, Math.min(0.03, (0.006 + 0.012 * fuerza) * k));
    if (d > this.viewR() + 120 * k) return;
    // si estallan muchas juntas (en cadena), cada una suelta menos particulas
    const now = this.time.now;
    this.booms = (this.booms || []).filter(t => now - t < 1500); this.booms.push(now);
    const q = this.booms.length > 3 ? 0.5 : 1, fx = this.fxSet(k > 1.5 ? 'g' : 'c');
    const ADD = Phaser.BlendModes.ADD;
    const core = this.add.image(x, y, 'luz').setDepth(18).setBlendMode(ADD).setTint(0xffe2a0).setAlpha(0.9).setScale(0.15 * k);
    this.tweens.add({ targets: core, scale: (k > 1 ? 0.8 : 1.15) * k, alpha: 0, duration: 220 + 50 * k, ease: 'Quad.out', onComplete: () => core.destroy() });
    [0xffffff, 0xffa040].forEach((tint, i) => {
      const ring = this.add.image(x, y, 'onda').setDepth(17.9).setBlendMode(ADD).setTint(tint).setAlpha(0.85).setScale(0.08);
      this.tweens.add({ targets: ring, scale: (0.95 + i * 0.35) * k, alpha: 0, duration: 380 + i * 220 + 80 * k, ease: 'Cubic.out', onComplete: () => ring.destroy() });
    });
    fx.fuego.explode(Math.round(24 * k * q), x, y);
    fx.chispas.explode(Math.round(18 * k * q), x, y);
    fx.pedazos.explode(Math.round(10 * k * q), x, y);
    this.time.delayedCall(90, () => fx.humo.explode(Math.round(12 * k * q), x, y));
    // la pipa: estallidos secundarios alrededor y charcos de fuego que se quedan ardiendo
    if (k > 1.5) {
      for (let i = 0; i < 4; i++) this.time.delayedCall(140 + i * 120, () => {
        const ex = x + rnd(-45, 45), ey = y + rnd(-45, 45);
        fx.fuego.explode(Math.round(10 * q), ex, ey); fx.chispas.explode(Math.round(6 * q), ex, ey);
      });
      for (let i = 0; i < 6; i++) {
        const a = rnd(0, 6.3), r = rnd(20, 75), px = x + Math.cos(a) * r, py = y + Math.sin(a) * r;
        if (!blocked(px, py)) this.fuegos.push({ x: px, y: py, t: rnd(8, 16), ft: rnd(0, 0.3) });
      }
      this.flashPantalla(0.5 * fuerza);
    } else if (fuerza > 0.5) this.flashPantalla(0.22 * fuerza);
    // tizne en el piso (los mas viejos se van borrando)
    const m = this.add.image(x, y, 'mancha').setDepth(1).setRotation(rnd(0, 6.3)).setScale(0.7 * k).setAlpha(0.9);
    this.manchas.push(m);
    if (this.manchas.length > 24) this.manchas.shift().destroy();
    this.tweens.add({ targets: m, alpha: 0, delay: 45000, duration: 8000, onComplete: () => { const i = this.manchas.indexOf(m); if (i >= 0) this.manchas.splice(i, 1); m.destroy(); } });
    // luz para la noche
    const L = { x, y, r: 70 * k, a: 1 }; this.blastLights.push(L);
    this.tweens.add({ targets: L, a: 0, r: 100 * k, duration: 900 + 400 * k, onComplete: () => this.blastLights.splice(this.blastLights.indexOf(L), 1) });
  }
  // emisores de particulas de las explosiones (c de carro y g de la pipa), se crean la primera vez
  fxSet(t) {
    this.fx = this.fx || {};
    if (this.fx[t]) return this.fx[t];
    const k = t === 'g' ? 2.4 : 1, ADD = Phaser.BlendModes.ADD, A = { min: 0, max: 360 };
    const e = (tex, depth, cfg) => this.add.particles(0, 0, tex, Object.assign({ emitting: false, angle: A }, cfg)).setDepth(depth);
    return (this.fx[t] = {
      humo: e('luz', 17.4, { lifespan: { min: 1800, max: 3000 + 600 * k }, speed: { min: 8 * k, max: 40 * k }, scale: { start: 0.22 * k, end: 0.95 * k }, alpha: { start: 0.55, end: 0 }, tint: [0x1c1c1c, 0x2a2a2a, 0x3b3633, 0x4a4440], accelerationY: -10 }),
      fuego: e('luz', 17.5, { lifespan: { min: 350, max: 650 + 200 * k }, speed: { min: 15 * k, max: 115 * k }, scale: { start: (k > 1 ? 0.22 : 0.3) * k, end: 0.04 }, alpha: { start: 0.9, end: 0 }, color: [0xffe7a0, 0xffd14a, 0xff7a1a, 0xc4300a, 0x3a1206], colorEase: 'quad.out', blendMode: ADD }),
      pedazos: e('confeti', 17.6, { lifespan: { min: 600, max: 1100 + 200 * k }, speed: { min: 70 * k, max: 230 * k }, scale: { start: 1.6, end: 0.9 }, rotate: { start: 0, end: 720 }, alpha: { start: 1, end: 0.3 }, tint: [0x161616, 0x3d3d3d, 0x6b6b6b, 0x8a5a2a] }),
      chispas: e('chispa', 17.7, { lifespan: { min: 250, max: 600 }, speed: { min: 120 * k, max: 320 * k }, scale: { start: 0.7, end: 0 }, color: [0xffffff, 0xffe27a, 0xff9a2a], blendMode: ADD }),
    });
  }
  // destello naranja en toda la pantalla (mas fuerte mientras mas cerca)
  flashPantalla(a) {
    if (a < 0.05) return;
    if (!this.flashR) {
      const W = this.scale.width, H = this.scale.height;
      this.flashR = this.add.rectangle(-W, -H, W * 3, H * 3, 0xffc070).setOrigin(0).setScrollFactor(0).setDepth(25).setBlendMode(Phaser.BlendModes.ADD).setAlpha(0);
      this.scale.on('resize', (gs) => this.flashR.setPosition(-gs.width, -gs.height).setSize(gs.width * 3, gs.height * 3));
    }
    this.tweens.killTweensOf(this.flashR);
    this.flashR.setAlpha(Math.min(0.6, a));
    this.tweens.add({ targets: this.flashR, alpha: 0, duration: 450, ease: 'Quad.out' });
  }
  // onda expansiva: daña y avienta lo que este cerca; los que quedan sin vida estallan en cadena (un poco despues)
  onda(x, y, k, src) {
    const R = k > 1.5 ? 160 : 55, DMG = k > 1.5 ? 300 : 45;
    const me = this.inCar;
    const todos = this.cars.concat(this.parked, this.filaEn(x, y)); if (me) todos.push(me);
    for (const o of todos) {
      if (o === src || o.wrecked) continue;
      const d = dist(x, y, o.x, o.y); if (d > R) continue;
      const f = 1 - d / R, ang = Math.atan2(o.y - y, o.x - x);
      o.hp -= DMG * f;
      if (o === me) { me.vx += Math.cos(ang) * 260 * f; me.vy += Math.sin(ang) * 260 * f; }
      else o.speed = 0;
      if (o.gas) { if (!o.boom) this.time.delayedCall(rnd(250, 500), () => { if (!o.wrecked) this.explotarGas(o); }); }
      else if (o.hp <= 0) this.time.delayedCall(rnd(80, 320), () => { if (o.wrecked) return; this.wreck(o); if (o === this.inCar) avisoDeshuesado(o); });
    }
    if (k <= 1.5) return;
    // la gente sale volando al piso y luego corre
    for (const p of this.peds) {
      if (p.st === 'down' || p.dead || dist(x, y, p.x, p.y) > R * 1.3) continue;
      p.st = 'down'; p.t = rnd(2, 3.5); p.sprite.setScale(1.2 / SPR, 0.6 / SPR).setTint(0xaaaaaa); p.sprite.anims.pause();
    }
    if (!me) {
      const p = this.player, d = dist(x, y, p.x, p.y);
      if (d < R) {
        const ang = Math.atan2(p.y - y, p.x - x), emp = 40 * (1 - d / R), nx = p.x + Math.cos(ang) * emp, ny = p.y + Math.sin(ang) * emp;
        if (!blocked(nx, ny) && !arbolEn(nx, ny, 3)) { p.x = nx; p.y = ny; p.sprite.setPosition(nx, ny); }
        toast('💥 ¡Te aventó la onda expansiva!', 'Estuvo cerca. Mejor no te acerques a las pipas.', 2.5);
      }
    }
  }
  // pipa de gas: con cada golpe fuerte lleva la cuenta; al primero se empieza a salir el gas y al segundo explota
  golpeGas(c) {
    if (!c.gas || c.wrecked || c.boom || this.time.now < (c.golpeT || 0)) return;
    c.golpeT = this.time.now + 700; c.golpes = (c.golpes || 0) + 1;
    if (c.golpes >= 2) { this.explotarGas(c); return; }
    c.fuga = true; c.fugaT = 0;
    const f = this.focus();
    if (dist(c.x, c.y, f.x, f.y) < this.viewR()) {
      toast('⚠️ ' + pick(FRASES_FUGA), 'Otro golpe y vuela. ¡Aléjate!', 3);
      if (window.SND) SND.play('fuga');
    }
  }
  explotarGas(c) {
    if (c.boom || c.wrecked) return;
    c.boom = true; c.hp = 0; c.fuga = false;
    const f = this.focus();
    if (c === this.inCar) toast('💥 ¡Volaste con todo y pipa!', 'Bájate con E, si te quedó con qué.', 3.5);
    else if (dist(c.x, c.y, f.x, f.y) < this.viewR() * 1.5) toast('💥 ' + pick(FRASES_PIPA), '', 3);
    this.wreck(c, 2.6);
  }
  // el gas que se sale: vapor blanco con su silbido
  fugaGas(c, dt) {
    if ((c.fugaT -= dt) > 0) return;
    c.fugaT = 0.12;
    const f = this.focus(); if (dist(c.x, c.y, f.x, f.y) > this.viewR() + 60) return;
    const hx = Math.cos(c.a), hy = Math.sin(c.a), bx = c.x - hx * c.hl * 0.2 + rnd(-4, 4), by = c.y - hy * c.hl * 0.2 + rnd(-4, 4);
    const v = this.add.image(bx, by, 'vapor').setDepth(11).setAlpha(0.7).setScale(0.5 / SPR);
    this.tweens.add({ targets: v, x: bx + rnd(-14, 14), y: by + rnd(-14, 14), alpha: 0, scale: 1.6 / SPR, duration: 900, onComplete: () => v.destroy() });
  }
  // el chofer de la ruta: te pega por detras (o al de enfrente) y sigue como si nada
  embestir(c, o) {
    const now = this.time.now;
    if (c.speed < 40 || now < (c.embT || 0)) return;
    c.embT = now + 2500;
    const hx = Math.cos(c.a), hy = Math.sin(c.a), sp = c.speed;
    c.speed *= 0.35;
    if (o === this.inCar) {
      o.vx += hx * sp * 0.8; o.vy += hy * sp * 0.8; o.hp -= 4 + sp / 12;
      this.jolt(160, 0.008);
      if (window.SND) SND.play('crash', 0.5);
      toast('🚌 ' + pick(FRASES_CAMION), 'Tu auto: -' + Math.round(4 + sp / 12) + ' de vida', 2.2);
      if (o.gas) this.golpeGas(o);
      if (o.hp <= 0 && !o.wrecked) { this.wreck(o); avisoDeshuesado(o); }
      return;
    }
    o.speed = 0; o.hp -= sp / 8;
    const f = this.focus();
    if (window.SND && dist(c.x, c.y, f.x, f.y) < this.viewR()) SND.play('crash', 0.3);
    if (o.gas) this.golpeGas(o);
    else if (o.hp <= 0) this.wreck(o);
  }
  // rebasar: se pasa a otro carril del mismo sentido si esta libre (solo en calles grandes)
  cambiarCarril(c) {
    const now = this.time.now, e = c.e;
    if (now < (c.carrilT || 0) || e.c > MAJOR) return false;
    c.carrilT = now + 900;
    const cands = e.one ? [0, 1, 2] : [c.lane ^ 1], tmp = {};
    for (const k of cands) {
      const lat = laneLat(e, k); if (Math.abs(lat - c.lat) < 1) continue;
      let libre = true;
      for (const ds of [-c.hl - 12, 0, c.hl + 35]) {
        edgePos(e, Math.max(0, Math.min(e.len, c.s + ds)), c.dir, lat, tmp);
        const pl = this.inCar;
        if (pl && axisDist(tmp.x, tmp.y, pl) < pl.hw + c.hw + 3) libre = false;
        for (const o of this.cars) if (o !== c && Math.abs(o.x - tmp.x) < 80 && Math.abs(o.y - tmp.y) < 80 && axisDist(tmp.x, tmp.y, o) < o.hw + c.hw + 3) { libre = false; break; }
        if (!libre) break;
      }
      if (libre) { c.lane = k; c.lat = lat; return true; }
    }
    return false;
  }
  claxon(c) {
    const now = this.time.now;
    if (now < (c.clxT || 0)) return;
    c.clxT = now + rnd(2500, 5000);
    const f = this.focus(), d = dist(c.x, c.y, f.x, f.y), R = this.viewR();
    if (window.SND && d < R) SND.play('claxon', 0.3 + 0.7 * (1 - d / R));
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
      const K = c.burnK || 1;
      if (c.burn > 0) {
        c.fireT = 0.06; this.flame(hx + rnd(-5, 5) * K, hy + rnd(-5, 5) * K, 1.3 * K); this.flame(c.x + rnd(-6, 6) * K, c.y + rnd(-5, 5) * K, K);
        if (K > 1) this.flame(c.x - Math.cos(c.a) * c.hl * 0.5 + rnd(-6, 6), c.y - Math.sin(c.a) * c.hl * 0.5 + rnd(-6, 6), 1.4);
        if (Math.random() < 0.35 * K) this.blackSmoke(hx, hy - 6);
      }
      else { c.fireT = 0.35; this.blackSmoke(hx, hy); }
      return true;
    });
    // charcos de gas ardiendo alrededor de donde estallo la pipa
    this.fuegos = this.fuegos.filter(q => {
      q.t -= dt; if (q.t <= 0) return false;
      if (dist(q.x, q.y, f.x, f.y) > R || (q.ft -= dt) > 0) return true;
      q.ft = 0.09; this.flame(q.x + rnd(-4, 4), q.y + rnd(-4, 4), q.t > 3 ? 1.2 : 0.7);
      if (Math.random() < 0.12) this.blackSmoke(q.x, q.y - 4);
      return true;
    });
  }

  puff(x, y) {
    const s = this.add.circle(x, y, 5, 0x555555, 0.6).setDepth(15);
    this.tweens.add({ targets: s, scale: 3, alpha: 0, y: y - 10, duration: 900, onComplete: () => s.destroy() });
  }

  // convoy de escoltas: dos camionetas en fila sobre la misma calle (lejos: donde libre(x, y) lo permita)
  convoy(e, dir, lane, libre) {
    if (e.c > 4 || e.len < 140) return false;
    const s0 = rnd(80, e.len), lane2 = lane & 1 ? 1 : 3, lat = laneLat(e, lane2);
    const q1 = edgePos(e, s0, dir, lat, {}), q2 = edgePos(e, s0 - 55, dir, lat, {});
    if (!libre(q1.x, q1.y) || !libre(q2.x, q2.y) || this.cars.some(c => dist(c.x, c.y, q1.x, q1.y) < 70 || dist(c.x, c.y, q2.x, q2.y) < 70)) return false;
    const vel = rnd(68, 85) * (e.c <= 2 ? 1.2 : 1) * 1.3; // un poco mas rapido que el trafico
    const jefe = this.makeCar(q1.x, q1.y, q1.a, this.carSpec({ escolta: true }));
    Object.assign(jefe, { e, dir, s: s0, lat, lane: lane2, speed: vel * 0.8, max: vel, escolta: true, ruta: [] });
    const cola = this.makeCar(q2.x, q2.y, q2.a, this.carSpec({ escolta: true }));
    Object.assign(cola, { e, dir, s: s0 - 55, lat, lane: lane2, speed: vel * 0.8, max: vel * 1.12, escolta: true, jefe }); // alcanza a la de adelante
    this.cars.push(jefe, cola);
    return true;
  }
  // conductor erratico: de repente se le va de lado; si pega con otro carro o con algo fuera de la calle, se estrella
  locoChoca(c, hx, hy, dt) {
    c.locoT -= dt;
    if (c.locoT <= 0 && !c.derrapeV) c.derrapeV = (Math.random() < 0.5 ? -1 : 1) * rnd(25, 45);
    if (c.derrapeV) c.derrape += c.derrapeV * dt;
    const fx = c.x + hx * (c.hl + 2), fy = c.y + hy * (c.hl + 2);
    let otro = null;
    if (c.speed > 35) for (const o of this.cars.concat(this.parked, this.filaEn(c.x, c.y))) if (o !== c && Math.abs(o.x - c.x) < 60 && Math.abs(o.y - c.y) < 60 && axisDist(fx, fy, o) < o.hw + 1) { otro = o; break; }
    const pared = c.derrapeV && (blocked(fx, fy) || arbolEn(fx, fy, 0) || Math.abs(c.derrape) > c.e.w / 2 + 14 * M);
    if (!otro && !pared) return false;
    c.speed = 0; c.hp = 0; this.wreck(c);
    if (c.robado) { c.robado = false; const f = this.focus(); if (dist(c.x, c.y, f.x, f.y) < this.viewR() * 1.5) toast('💥 ¡El ratero chocó tu carro!', 'Y salió corriendo. Ni modo, a buscar otro.', 3); }
    // al de enfrente le va peor si iba de frente o muy rapido; las patrullas y escoltas solo se paran
    if (otro && !otro.wrecked && this.cars.includes(otro)) { otro.speed = 0; if (otro.gas) this.golpeGas(otro); else if (!otro.poli && !otro.escolta && Math.random() < 0.5) { otro.hp = 0; this.wreck(otro); } }
    const f = this.focus();
    if (dist(c.x, c.y, f.x, f.y) < this.viewR() && this.time.now > (this.locoAvisoT || 0)) {
      this.locoAvisoT = this.time.now + 20000;
      toast('💥 ' + pick(['¡Se estrelló!', '¡Uy, ese no llegó!', '¡Tremendo choque!']), pick(['Iba mandando mensajes en el celular.', 'Quería ganarle al semáforo.', 'Manejaba como si el carro fuera rentado.', 'Iba tarde a la chamba y ahora va a llegar más tarde.']), 2.6);
    }
    return true;
  }

  // multa por chocar una patrulla (con unos segundos de gracia entre multas)
  hitPoli(sp) {
    if (this.inCar && this.inCar.bici) return; // en bici o patineta la poli ni te pela
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
    for (const [u, v] of [[hl, hw], [hl, -hw], [-hl, hw], [-hl, -hw], [hl + 2, 0], [0, hw], [0, -hw]]) {
      const px = x + c * u - s * v, py = y + s * u + c * v;
      if (blocked(px, py) || enComida(px, py) || (enSobreruedas(px, py) && (this.choqueSobre = true))) { if (!count) return true; n++; }
    }
    const arb = arbolEnCaja(x, y, c, s, hl, hw);
    if (arb) { if (!count) return true; n += arb; }
    // los demas vehiculos son capsulas a lo largo de su eje
    const h = Math.max(0, hl - hw), pts = [[x, y], [x + c * h, y + s * h], [x - c * h, y - s * h]];
    for (const list of [this.cars, this.parked, this.filaEn(x, y)]) for (const o of list) {
      if (o === self || Math.abs(o.x - x) > 70 || Math.abs(o.y - y) > 70) continue;
      for (const [px, py] of pts) if (axisDist(px, py, o) < o.hw + hw + 1) { this.lastHit = o; if (!count) return true; n += 1 + (o.hw + hw + 1 - axisDist(px, py, o)) / 4; }
    }
    return count ? n : false;
  }

  toggleCar() {
    if (!this.inCar && this.coy) { this.pagarCoyote(); return; }
    if (!this.inCar && this.paroOfer) { this.aceptarParo(); return; }
    if (this.inCar) {
      const car = this.inCar, a = car.a;
      if (Math.hypot(car.vx, car.vy) > 60) return;
      let ex = null;
      // por la puerta del conductor (la izquierda); si esta tapada, por la del copiloto
      for (const side of [-1, 1]) { const x = car.x - Math.sin(a) * (car.hw + 8) * side, y = car.y + Math.cos(a) * (car.hw + 8) * side; if (!blocked(x, y) && !arbolEn(x, y, 3)) { ex = [x, y]; break; } }
      if (!ex) { toast('No puedes bajarte aquí', ''); return; }
      car.vx = car.vy = 0;
      this.parked.push(car); this.inCar = null; this.ultimoCarro = car;
      if (car.bici) car.sprite.setTexture('bici_' + car.bici);
      this.player.x = ex[0]; this.player.y = ex[1];
      this.player.sprite.setVisible(true).setPosition(ex[0], ex[1]);
      this.cameras.main.startFollow(this.player.sprite, true, 0.15, 0.15);
      if (this.taxi) { this.endTaxi(false, 'Te bajaste del taxi.'); }
      this.setObjective();
      return;
    }
    const p = this.player;
    let best = null, bd = 56, fila = null;
    for (const c of this.parked) { const d = dist(c.x, c.y, p.x, p.y); if (d < bd) { bd = d; best = c; } }
    for (const c of this.filaEn(p.x, p.y)) if (dist(c.x, c.y, p.x, p.y) < 56) fila = c;
    for (const c of this.cars) { const d = dist(c.x, c.y, p.x, p.y); if (d < bd) { bd = d; best = c; } }
    if (!best) { if (fila) toast('🚗 Ese carro va en la fila de la garita', pick(FRASES_FILA_ROBO), 2.5); return; }
    if (best.hp <= 0) { toast('Ese auto ya no sirve', ''); return; }
    if (best.poli) { toast('🚓 ¿Robarle la patrulla a la poli?', 'Ni lo pienses, compa.', 2); return; }
    if (best.escena) { toast('Ese carro está esperando al ajustador', 'Mejor busca otro, compa.', 2); return; }
    const recuperado = best.robado;
    if (this.cars.includes(best)) {
      this.cars.splice(this.cars.indexOf(best), 1);
      if (best.robado) {
        best.robado = false; best.loco = false;
        if (this.bubble.ped === best) this.bubble.t = 0;
        toast('🔑 ¡Recuperaste tu carro!', pick(['"¡Y no vuelvas!"', '"¡Órale, a correr!"', '"Ese carro tiene dueño, compa."']), 3);
      }
      // el conductor sale corriendo
      const g = nearestOnGraph(walkG, best.x, best.y);
      if (g) {
        const ped = { e: g.e, dir: 1, s: g.s, side: pedSide(g.e, g.s, 1, best.x, best.y, 0), speed: 60, st: 'flee', t: 4, x: best.x, y: best.y, a: 0,
          sprite: this.walker(best.x, best.y, 2.2) };
        this.peds.push(ped);
      }
      if (recuperado) { /* ya se aviso arriba */ }
      else if (best.moto) this.startDelivery();
      else if (best.T === VT_DEPORTIVA) toast('🏍️ ¡Moto deportiva!', 'Corre como ninguna, pero al primer choque se hace pedazos. Con cuidadito.', 3);
      else if (best.pan) toast('🥖 ¡Te robaste el carro del pan!', 'La bocina no se apaga y las conchas van brincando atrás. Ahora tú eres el panadero.', 3.5);
      else if (best.gas) toast('⛽ ¡Te robaste una pipa de gas!', 'Dos golpes fuertes y vuela con todo y tú. Maneja suavecito.', 3.5);
      else if (best.T === VT_URBANO) toast('🚌 ¡Te robaste el camión de la ruta!', '¡Súbale, súbale! Hoy no se cobra pasaje.', 3);
      else toast(pick(FRASES_ROBO), best.T.name + (best.dirty ? ' bien tijuaneado' : ' de agencia'), 2.4);
    } else this.parked.splice(this.parked.indexOf(best), 1);
    best.vx = best.vy = 0;
    this.inCar = best; this.staminaBar.clear(); this.stamina = STAMINA; this.tired = false; // manejando descansas
    if (best.bici) { best.sprite.setTexture('bici_' + best.bici + '_r'); if (best.suelta) { best.suelta = false; toast(...BICI_AVISO[best.bici], 3.5); } }
    this.player.sprite.setVisible(false);
    this.cameras.main.startFollow(best.sprite, true, 0.15, 0.15);
    this.setObjective();
  }

  updateTraffic(dt) {
    const pl = this.inCar || this.player;
    // torreta de las patrullas
    const blink = 'poli' + ((this.time.now / 280 | 0) % 2);
    for (const c of this.cars) if (c.poli && c.sprite.texture.key !== blink) c.sprite.setTexture(blink);
    const strobe = 'escolta' + ((this.time.now / 170 | 0) % 2);
    for (const c of this.cars) if (c.escolta && !c.wrecked && c.sprite.texture.key !== strobe) c.sprite.setTexture(strobe);
    const neon = 'antro' + ((this.time.now / 600 | 0) % 2);
    for (const c of chinas) if (c.icon.texture.key !== neon + c.up) c.icon.setTexture(neon + c.up);
    const tmp = this.tmp, choques = ESCENAS.filter(E => E.on);
    for (const c of this.cars) {
      if (c.wrecked || c.quieto) continue; // los deshuesados (y los de las escenas) se quedan donde quedaron
      const hx = Math.cos(c.a), hy = Math.sin(c.a);
      if (c.loco && this.locoChoca(c, hx, hy, dt)) continue;
      // el transporte publico frena hasta el ultimo momento (se le pega al de adelante)
      const look = c.rutero ? 7 : 13, gap = c.rutero ? 3 : 8;
      const ax = c.x + hx * (c.hl + look), ay = c.y + hy * (c.hl + look);
      let stop = this.inCar ? axisDist(ax, ay, pl) < pl.hw + (c.rutero ? 3 : 10) : dist(ax, ay, pl.x, pl.y) < 16, bloq = null;
      if (stop && c.rutero && this.inCar) { this.embestir(c, pl); if (this.cambiarCarril(c)) stop = false; else this.claxon(c); }
      if (!stop && !c.loco) for (const o of this.cars) {
        if (o === c || axisDist(ax, ay, o) >= o.hw + gap) continue;
        // un deshuesado en el camino: se le da la vuelta por un lado
        if (o.escena) continue; // los del choque: ver rodeaChoque
        if (o.wrecked || o.quieto) { if (!c.desvioT) { const lado = ((o.x - c.x) * -hy + (o.y - c.y) * hx) > 0 ? -1 : 1; c.desvio = lado * (o.hw + c.hw + 6); c.desvioT = 3; } continue; }
        stop = true; bloq = o; break;
      }
      if (!stop) for (const L of [this.parked, this.filaEn(ax, ay)]) for (const o of L) { if (Math.abs(o.x - ax) < 60 && Math.abs(o.y - ay) < 60 && axisDist(ax, ay, o) < o.hw + gap) { stop = true; bloq = o; break; } }
      if (!stop) for (const o of this.peds) { if (o.st === 'walk' && dist(ax, ay, o.x, o.y) < 9) { stop = true; break; } }
      // si alguien le estorba: a veces se lo lleva de corbata, y si hay carril libre se cambia; si no, claxon
      if (c.rutero && bloq) {
        if (c.speed > 70 && Math.random() < 0.3) this.embestir(c, bloq);
        if (this.cambiarCarril(c)) stop = false; else this.claxon(c);
      }
      // un choque adelante: se le da la vuelta si hay por donde, y si no se esperan (y se hace la fila)
      const rodea = choques.length && !c.loco && !stop ? this.rodeaChoque(c, choques, dt) : 0; // (el que ya espera a otro, no busca)
      if (rodea === 2) stop = true;
      // paradas: el camion a subir pasaje, la pipa a vender gas y el del pan a esperar a las señoras
      if (c.paradaT !== undefined) {
        if (c.paradaS > 0) { stop = true; if ((c.paradaS -= dt) <= 0) c.paradaT = c.gas || c.pan ? rnd(20, 45) : rnd(15, 35); }
        else if ((c.paradaT -= dt) <= 0 && !stop) c.paradaS = c.gas || c.pan ? rnd(4, 7) : rnd(2, 3.5);
      }
      let want = stop ? 0 : rodea === 1 ? Math.min(c.max, 35) : c.max;
      if (!c.rutero) for (const i of topesNear(c.x, c.y)) if (dist(c.x, c.y, topes[i].x, topes[i].y) < 45) want = Math.min(want, 35);
      c.speed += Math.max((c.rutero ? -420 : -300) * dt, Math.min((c.rutero ? 150 : 90) * dt, want - c.speed));
      if (c.gas && c.fuga) this.fugaGas(c, dt);
      c.s += c.speed * dt;
      while (c.s > c.e.len) {
        // la escolta de atras toma las mismas vueltas que la de adelante
        const j = c.jefe, nx = j && !j.wrecked && this.cars.includes(j) && j.ruta.length ? j.ruta.shift() : c.sig || nextEdge(traffic, c.e, c.dir);
        c.sig = null;
        if (!nx) { c.s = c.e.len; c.speed = 0; break; }
        if (c.ruta) c.ruta.push(nx);
        c.s -= c.e.len; c.e = nx.e; c.dir = nx.dir; c.lat = laneLat(nx.e, c.lane);
      }
      let lat = c.lat;
      // el volantazo para rodear el choque (poco a poco)
      if (c.esq || c.esqS) { c.esqS = (c.esqS || 0) + ((c.esq || 0) - (c.esqS || 0)) * Math.min(1, dt * 2.5); if (!c.esq && Math.abs(c.esqS) < 0.1) c.esqS = 0; lat += c.esqS; }
      if (c.desvioT) { c.desvioT = Math.max(0, c.desvioT - dt); lat += c.desvio * Math.min(1, c.desvioT * 2); }
      if (c.loco) lat += Math.sin(this.time.now / 1000 * c.wf + c.ph) * c.e.w * 0.28 + c.derrape;
      if (c.rutero) { c.latS += (lat - c.latS) * Math.min(1, dt * 5); lat = c.latS; } // el volantazo al cambiarse de carril
      edgePos(c.e, c.s, c.dir, lat, tmp);
      c.x += (tmp.x - c.x) * Math.min(1, dt * 12); c.y += (tmp.y - c.y) * Math.min(1, dt * 12);
      c.a += angDiff(c.a, tmp.a) * Math.min(1, dt * 7);
      c.sprite.setPosition(c.x, c.y).setRotation(c.a);
    }
    // la cancioncita de la pipa de gas cuando anda cerca
    if (window.SND && (this.gasMelT = (this.gasMelT || 0) - dt) <= 0) {
      this.gasMelT = 2;
      const f = this.focus(), R = this.viewR() * 1.3;
      let d = Infinity; for (const c of this.cars) if (c.gas && !c.wrecked) d = Math.min(d, dist(c.x, c.y, f.x, f.y));
      if (d < R) { this.gasMelT = rnd(9, 13); SND.play('gasLP', 0.35 + 0.65 * (1 - d / R)); }
    }
    // el carro del pan: su cancioncita por la bocina y, si pasas cerca, el globo con la cancion o lo que ofrece
    if ((this.panT = (this.panT || 0) - dt) <= 0) {
      this.panT = 1;
      const f = this.focus(), R = this.viewR() * 1.2, c = this.cars.find(q => q.pan && !q.wrecked && q !== this.inCar);
      const d = c ? dist(c.x, c.y, f.x, f.y) : Infinity;
      if (d < R) {
        this.panT = rnd(6, 9);
        if (window.SND) SND.play('panLP', 0.35 + 0.65 * (1 - d / R));
        if (!this.bubble.ped && d < 260) {
          this.panCancion = !this.panCancion;
          this.globo(c, 'pan', pick(this.panCancion ? FRASES_PAN_CANCION : FRASES_PAN), 4.5);
        }
      }
    }
    // choques del jugador contra autos
    if (this.inCar) {
      const me = this.inCar;
      for (const o of this.cars.concat(this.parked, this.filaEn(me.x, me.y))) {
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
          if (sp > 55) { if (o.gas) this.golpeGas(o); if (me.gas) this.golpeGas(me); }
          if (sp > 120) { this.jolt(100, 0.006); me.hp -= sp / 25; o.speed = 0; }
          if (me.T.fragil && sp > 45) me.hp = 0; // la deportiva no aguanta ni un rozon
        }
      }
    }
  }

  // ----- perros -----
  perroSprite(d) {
    d.raza = (Math.random() * RAZAS.length) | 0;
    d.sprite = this.add.sprite(d.x, d.y, 'perro' + d.raza, 0).setDepth(5).setScale(1 / SPR).setOrigin(11 / 24, 0.5);
    d.sprite.play({ key: 'perroAnda' + d.raza, startFrame: (Math.random() * 4) | 0 }); d.sprite.anims.timeScale = d.speed / 26;
    return d;
  }
  // caminan por la banqueta, se paran a olfatear y le ladran a quien pasa; los de la jauria te persiguen
  updatePerros(dt) {
    const car = this.inCar, csp = car ? Math.hypot(car.vx, car.vy) : 0, f = this.focus(), tmp = this.tmp, now = this.time.now;
    for (const d of this.perros) {
      // atropellado
      if (car && !car.bici && csp > 40 && d.st !== 'flee' && d.st !== 'vete' && axisDist(d.x, d.y, car) < car.hw + 2) { this.atropellaPerro(d, car); continue; }
      if (d.st === 'flee' || d.st === 'vete' || d.st === 'jauria') {
        // corriendo en linea recta (rodeando lo que estorbe): huyendo de ti o persiguiendote
        d.t -= dt;
        // cada perro de la jauria le cae por un lado distinto
        // (alrededor del carro: en una elipse un poco mas grande que la carroceria)
        const o = d.ofs || 0, ca = car ? Math.cos(car.a) : 1, sa = car ? Math.sin(car.a) : 0;
        const lx = Math.cos(o) * (car ? car.hl + 5 : 7), ly = Math.sin(o) * (car ? car.hw + 5 : 7);
        const gx = f.x + lx * ca - ly * sa, gy = f.y + lx * sa + ly * ca;
        let a = d.st === 'jauria' ? Math.atan2(gy - d.y, gx - d.x) : d.a;
        // la jauria rodea el carro (o a ti) sin encimarse
        const pegado = d.st === 'jauria' && dist(d.x, d.y, gx, gy) < 4;
        const v = pegado ? 0 : (d.st === 'jauria' ? d.speed : 150) * dt;
        for (const da of [0, 0.6, -0.6, 1.3, -1.3, 2.2, -2.2]) {
          const nx = d.x + Math.cos(a + da) * v, ny = d.y + Math.sin(a + da) * v;
          if (!blocked(nx, ny) && !(enComida(nx, ny, 1) && !enComida(d.x, d.y, 1))) { d.x = nx; d.y = ny; a += da; break; }
        }
        d.a = a; d.sprite.setPosition(d.x, d.y).setRotation(a);
        if (d.st === 'jauria') {
          if (d.t <= 0) { d.st = 'vete'; d.t = 3; d.a = a + Math.PI; continue; }
          if (now > (d.ladraT || 0)) { d.ladraT = now + rnd(1200, 2600); if (window.SND && dist(d.x, d.y, f.x, f.y) < this.viewR()) SND.play('ladrido', 0.8); }
          this.mordida(d);
        } else {
          d.sprite.setAlpha(Math.min(1, d.t));
          if (d.t <= 0) { d.sprite.destroy(); d.dead = true; }
        }
        continue;
      }
      // olfatea un rato y sigue
      d.t -= dt;
      if (d.t <= 0) { d.st = d.st === 'walk' ? 'idle' : 'walk'; d.t = d.st === 'idle' ? rnd(1.5, 4) : rnd(4, 10); if (d.st === 'idle') { d.sprite.stop(); d.sprite.setFrame(0); } else d.sprite.play({ key: 'perroAnda' + d.raza, startFrame: 1 }); }
      // le ladra a quien pasa cerca
      if (now > (d.ladraT || 0) && dist(d.x, d.y, f.x, f.y) < (car ? 45 : 35)) { d.ladraT = now + rnd(4000, 9000); if (window.SND) SND.play('ladrido', 0.5); }
      // y te dice algo (un emoji), si no hay otro globo y no vas volando
      if (now > (d.diceT || 0) && csp < 60 && !(this.bubble.ped && this.bubble.t > 0) && dist(d.x, d.y, f.x, f.y) < 40) {
        d.diceT = now + rnd(12000, 20000);
        this.globo(d, 'perro', pick(Math.random() < 0.3 ? PERRO_ENIGMA : PERRO_DICE), 2.5);
      }
      if (d.st === 'idle') { d.sprite.setRotation(d.a + Math.sin(now / 400 + d.s) * 0.3); continue; }
      d.s += d.speed * dt;
      if (d.s > d.e.len) {
        const nx = nextEdge(walkG, d.e, d.dir);
        if (nx) { d.s -= d.e.len; d.e = nx.e; d.dir = nx.dir; d.side = pedSide(d.e, d.s, d.dir, d.x, d.y, 0.12); }
        else { d.s = 0; d.dir = -d.dir; d.side = -d.side; }
      }
      if (pasoBanqueta(d, tmp)) { d.x += (tmp.x - d.x) * Math.min(1, dt * 10); d.y += (tmp.y - d.y) * Math.min(1, dt * 10); }
      else { d.dir = -d.dir; d.s = d.e.len - d.s; }
      d.a = tmp.a;
      d.sprite.setPosition(d.x, d.y).setRotation(d.a);
    }
    if (this.perros.some(d => d.dead)) this.perros = this.perros.filter(d => !d.dead);
  }
  // ----- sobreruedas: un aviso al llegar (otra vez si te alejas y vuelves) -----
  updateSobreruedas() {
    const f = this.focus();
    for (const sr of SOBRERUEDAS) {
      if (!sr.tramos || !sr.tramos.length) continue;
      const d = dist(sr.x, sr.y, f.x, f.y);
      if (d > sr.R + 1500) sr.avisado = false;
      else if (!sr.avisado && d < sr.R + 120) {
        sr.avisado = true;
        toast('🛍️ ' + sr.nombre, sr.dato + ' Aquí se pone todos los días; la calle está cerrada a los carros.', 5);
      }
    }
  }
  // ----- gatos de azotea -----
  // una casa (de una o dos plantas, no una bodega) a una distancia entre r0 y r1, y un lugar en su azotea
  // donde quepa el gato: que la azotea no este borrada por una calle, que no lo tape otro edificio ni un arbol.
  // Devuelve donde se ve el gato (el techo se dibuja L px arriba y L*LEAN a la derecha de la planta)
  // (a0: si va en carro, de preferencia por donde va, para que se lo tope)
  buscarAzotea(x0, y0, r0, r1, inView, a0) {
    for (let n = 0; n < 10; n++) {
      const a = a0 === undefined ? Math.random() * 6.283 : a0 + rnd(-0.9, 0.9), d = rnd(r0, r1), qx = x0 + Math.cos(a) * d, qy = y0 + Math.sin(a) * d;
      const L0 = bldGrid.get(GK(Math.floor(qx / BCELL), Math.floor(qy / BCELL))); if (!L0 || !L0.length) continue;
      const b = pick(L0), bw = b.bb[2] - b.bb[0], bh = b.bb[3] - b.bb[1];
      if (b.h >= 9 || bw < 22 || bh < 22 || bw > 160 || bh > 160) continue;
      const L = elevacion(b), lx = Math.round(L * LEAN);
      for (let m = 0; m < 6; m++) {
        const fx = rnd(b.bb[0] + 6, b.bb[2] - 6), fy = rnd(b.bb[1] + 6, b.bb[3] - 6);
        const tq = tinaco(b); if (tq && dist(fx, fy, tq[0], tq[1]) < 11) continue;
        const cs = calentador(b); if (cs && fx > cs[0] - 6 && fx < cs[0] + CAL_W + 6 && fy > cs[1] - 6 && fy < cs[1] + CAL_H + 6) continue;
        if (![[0, 0], [6, 0], [-6, 0], [0, 6], [0, -6]].every(([ox, oy]) => pip(fx + ox, fy + oy, b.p) && !onRoad(fx + ox, fy + oy))) continue;
        const x = fx + lx, y = fy - L;
        if ((inView && inView(x, y)) || !regionesListas(x, y, x, y) || arbolEn(x, y, 14) || this.tapaOtro(x, y, b)) continue;
        return { x, y, b, a: Math.random() * 6.283 };
      }
    }
    return null;
  }
  // ¿a (x, y) lo tapa el dibujo de un edificio que no es b? (como bajoTecho)
  tapaOtro(x, y, b0) {
    for (let k = 1; k <= EXTRA_UP; k += 2) {
      const px = x - k * LEAN, py = y + k, a = bldGrid.get(GK(Math.floor(px / BCELL), Math.floor(py / BCELL))); if (!a) continue;
      for (const b of a) if (b !== b0 && px >= b.bb[0] && px <= b.bb[2] && py >= b.bb[1] && py <= b.bb[3] && elevacion(b) >= k && pip(px, py, b.p) && !onRoad(px, py)) return true;
    }
    return false;
  }
  gatoSprite(g) {
    g.pelaje = (Math.random() * PELAJES.length) | 0; g.dijo = 0; g.hablaT = 0; g.t = rnd(8, 20);
    g.st = Math.random() < 0.4 ? 'dormido' : 'sentado';
    g.sprite = this.add.sprite(g.x, g.y, 'gato' + g.pelaje, 3).setDepth(12.5).setScale(1 / SPR).setOrigin(9 / 20, 0.5).setRotation(g.a);
    if (g.st === 'sentado') g.sprite.play({ key: 'gatoCola' + g.pelaje, startFrame: (Math.random() * 4) | 0 });
    return g;
  }
  // se quedan en su azotea: te siguen con la mirada y te dicen lo que piensan de ti y del juego
  // (unas cuantas veces; luego se aburren y se duermen)
  updateGatos(dt) {
    const f = this.focus(), car = this.inCar, now = this.time.now, b = this.bubble;
    for (const c of this.gatos) {
      const d = dist(c.x, c.y, f.x, f.y), cerca = d < (car ? 110 : 80);
      if (c.st === 'dormido') {
        // se despierta si te le acercas (si no se ha hartado de ti)
        if (cerca && !c.harto) { c.st = 'sentado'; c.desperto = true; c.sprite.play({ key: 'gatoCola' + c.pelaje }); c.hablaT = now + 600; }
        else continue;
      }
      if (d < 170) {
        // voltea a verte, despacito, como juzgando
        let da = Math.atan2(f.y - c.y, f.x - c.x) - c.a; da = Math.atan2(Math.sin(da), Math.cos(da));
        c.a += da * Math.min(1, dt * 2.5); c.sprite.setRotation(c.a);
      } else if ((c.t -= dt) <= 0) { c.st = 'dormido'; c.sprite.stop(); c.sprite.setFrame(3); c.t = rnd(8, 20); continue; }
      if (cerca && now > c.hablaT && !(b.ped && b.t > 0)) {
        this.globo(c, 'gato', this.fraseGato(c, car), 5);
        if (window.SND) SND.play('miau');
        c.hablaT = now + rnd(9000, 15000);
        if (c.harto) { c.st = 'dormido'; c.sprite.stop(); c.sprite.setFrame(3); }
      }
    }
  }
  fraseGato(c, car) {
    const F = FRASES_GATO, sp = car ? Math.hypot(car.vx, car.vy) : 0;
    if (!this.gatoMazo || !this.gatoMazo.length) this.gatoMazo = Phaser.Utils.Array.Shuffle(F.siempre.slice());
    let t;
    if (++c.dijo >= 4) { c.harto = true; t = pick(F.harto); }
    else if (c.desperto) { c.desperto = false; t = pick(F.despierta); }
    else if (car && sp > 150 && Math.random() < 0.6) t = pick(F.rapido);
    else if (Math.random() < 0.35) t = pick(car ? F.carro : F.pie);
    else if (this.night && this.night.a > 0.5 && Math.random() < 0.3) t = pick(F.noche);
    else t = this.gatoMazo.pop();
    return pick(['😼', '😾', '🙄', '😹', '🐈', '😺', '🐈‍⬛']) + ' ' + t.replace('$$', '$' + state.money.toLocaleString('es-MX'));
  }
  // el perrito sale chillando y corriendo (ofendido, pero entero); y luego viene el karma
  atropellaPerro(d, car) {
    d.st = 'flee'; d.t = 3; d.a = Math.atan2(d.y - car.y, d.x - car.x);
    d.sprite.play({ key: 'perroAnda' + d.raza }); d.sprite.anims.timeScale = 2.5;
    this.tweens.add({ targets: d.sprite, scaleX: 1.3 / SPR, scaleY: 0.7 / SPR, duration: 120, yoyo: true });
    if (window.SND) SND.play('aullido');
    this.jolt(90, 0.003);
    if (d.jauria) return; // a los de la jauria nomas los espantas
    toast('🐕 ¡Atropellaste a un perrito!', 'Salió corriendo, ofendido. Y el karma ya viene en camino...', 3);
    if (this.time.now < (this.karmaT || 0)) return;
    this.karmaT = this.time.now + 20000;
    this.time.delayedCall(1800, () => this.karma());
  }
  // el castigo, al azar: la jauria del barrio, una llanta ponchada o la multa por el video que se hizo viral
  karma() {
    const ops = [['jauria', 4], ['multa', 2.5]];
    if (this.inCar && !this.inCar.ponchada && !this.inCar.wrecked) ops.push(['ponchadura', 3.5]);
    if (this.perros.some(d => d.st === 'jauria')) ops.shift();
    let r = Math.random() * ops.reduce((s, o) => s + o[1], 0), k = ops[0][0];
    for (const [n, w] of ops) { if ((r -= w) < 0) { k = n; break; } }
    if (k === 'jauria') {
      const f = this.focus(); let n = 0;
      for (let i = 0; i < 40 && n < 5; i++) {
        const a = rnd(0, 6.3), R = rnd(150, 230), x = f.x + Math.cos(a) * R, y = f.y + Math.sin(a) * R;
        if (blocked(x, y) || !regionesListas(x, y, x, y)) continue;
        const d = this.perroSprite({ x, y, a: a + Math.PI, s: 0, speed: rnd(118, 138), st: 'jauria', t: rnd(26, 32), jauria: true, ofs: n * 1.26 + rnd(-0.3, 0.3) });
        d.sprite.anims.timeScale = 2.4; this.perros.push(d); n++;
      }
      toast('🐕🐕🐕 ¡Llegó la jauría!', 'Los compas del perrito vienen por venganza. ¡Pélate!', 3.5);
      if (window.SND) { SND.play('ladrido', 1); setTimeout(() => SND.play('ladrido', 0.9), 350); }
    } else if (k === 'ponchadura') {
      this.inCar.ponchada = { t: 45, lado: Math.random() < 0.5 ? -1 : 1, humoT: 0 };
      toast('💨 ¡Se te ponchó una llanta!', 'El karma no perdona. El carro se jala de lado y no corre. Aguanta 45 s o cambia de carro.', 4);
      if (window.SND) { SND.play('fuga'); SND.play('crash', 0.2); }
      this.jolt(150, 0.006);
    } else {
      const amt = Math.min(state.money, Math.round(rnd(150, 350) / 10) * 10);
      state.money -= amt; save(); updateStats();
      toast('📱 ¡Alguien lo grabó todo!', amt > 0 ? 'Se hizo viral: "Conductor atropella perrito en Tijuana". Pagaste el veterinario: -$' + amt : 'Se hizo viral y no traías ni para el veterinario. Te ganaste la fama y ya.', 4.5);
    }
  }
  // la jauria muerde: al carro le baja vida; a pie te cansa
  mordida(d) {
    const now = this.time.now, car = this.inCar;
    if (now < (d.mordT || 0)) return;
    const pega = car ? axisDist(d.x, d.y, car) < car.hw + 7 : dist(d.x, d.y, this.player.x, this.player.y) < 10;
    if (!pega) return;
    d.mordT = now + rnd(1100, 1500);
    if (car) {
      if (car.wrecked) return;
      car.hp -= 2; this.jolt(70, 0.003);
      if (now > (this.mordAviso || 0)) { this.mordAviso = now + 8000; toast('🐕 ¡Te están mordiendo las llantas!', 'Arráncate, que no se cansan.', 2.5); }
      if (car.hp <= 0) { this.wreck(car); avisoDeshuesado(car); }
    } else {
      this.stamina = Math.max(0, this.stamina - 2); if (this.stamina === 0) this.tired = true; // te cansan (ya no puedes correr)
      if (now > (this.mordAviso || 0)) { this.mordAviso = now + 8000; toast('🐕 ¡Te están mordiendo los tobillos!', 'Súbete a un carro, ¡ya!', 2.5); }
    }
    if (window.SND) SND.play('ladrido', 0.7);
  }

  // ----- el ratero -----
  // si te quedas parado en el carro unos segundos, a veces sale uno corriendo de la banqueta hacia tu puerta: si llega,
  // te baja y se va manejando como loco. Si arrancas antes, se rinde; si lo alcanzas, recuperas el carro con E.
  updateRatero(dt) {
    const car = this.inCar, r = this.ratero;
    this.rateroCool = (this.rateroCool ?? 40) - dt;
    this.gritosRatero(dt);
    if (!r) {
      this.paradoT = car && Math.hypot(car.vx, car.vy) < 8 ? (this.paradoT || 0) + dt : 0;
      if (this.paradoT < 4 || this.rateroCool > 0) return;
      if (car.wrecked || car.T === VT_TROCA_TACOS || car.T === VT_ZONKEY || this.taxi || this.delivery || this.paro || this.fiesta) return;
      this.rateroCool = 2; // cada dos segundos se echa el volado
      if (Math.random() < 0.4) this.llegaRatero(car);
      return;
    }
    r.t -= dt;
    if (r.st === 'huye') {
      // se va corriendo lejos del carro y desaparece
      const a = r.a, nx = r.x + Math.cos(a) * 80 * dt, ny = r.y + Math.sin(a) * 80 * dt;
      if (!blocked(nx, ny)) { r.x = nx; r.y = ny; } else r.a += 1.2;
      r.sprite.setPosition(r.x, r.y).setRotation(r.a).setAlpha(Math.min(1, r.t));
      if (r.t <= 0) { r.sprite.destroy(); if (this.bubble.ped === r) this.bubble.t = 0; this.ratero = null; }
      return;
    }
    const c = r.car, sp = Math.hypot(c.vx, c.vy);
    if (this.inCar !== c || sp > 45 || r.t <= 0) { this.rateroFalla(); return; }
    // va a la puerta del conductor (o a la otra si esa esta tapada)
    let k = c.hw + 5, tx = c.x + Math.sin(c.a) * k, ty = c.y - Math.cos(c.a) * k;
    if (blocked(tx, ty)) { tx = c.x - Math.sin(c.a) * k; ty = c.y + Math.cos(c.a) * k; }
    const d = dist(r.x, r.y, tx, ty);
    if (d > 260) { this.rateroFalla(); return; }
    if (d < 6) { if (sp < 20) this.robarCarro(r); return; }
    let a = Math.atan2(ty - r.y, tx - r.x);
    const v = Math.min(78 * dt, d);
    for (const da of [0, 0.7, -0.7, 1.4, -1.4]) {
      const nx = r.x + Math.cos(a + da) * v, ny = r.y + Math.sin(a + da) * v;
      if (!blocked(nx, ny)) { r.x = nx; r.y = ny; a += da; break; }
    }
    r.a = a; r.sprite.setPosition(r.x, r.y).setRotation(a);
  }
  llegaRatero(car) {
    for (let i = 0; i < 16; i++) {
      const a = rnd(0, 6.3), R = rnd(90, 130), x = car.x + Math.cos(a) * R, y = car.y + Math.sin(a) * R;
      if (blocked(x, y) || !regionesListas(x, y, x, y)) continue;
      // que pueda llegar en linea recta, sin edificios de por medio
      let ok = true;
      for (let t = 0.1; t < 0.95; t += 0.1) if (blocked(x + (car.x - x) * t, y + (car.y - y) * t)) { ok = false; break; }
      if (!ok) continue;
      const sprite = this.add.sprite(x, y, 'pedR', 0).setDepth(9).setScale(1 / SPR);
      sprite.play('walkR'); sprite.anims.timeScale = 2.4;
      this.ratero = { x, y, a: Math.atan2(car.y - y, car.x - x), sprite, car, st: 'va', t: 12 };
      this.rateroCool = rnd(70, 120);
      toast('⚠️ ¡Aguas, un ratero!', 'Viene corriendo por tu carro. ¡Arráncate!', 3);
      this.globo(this.ratero, 'ratero', pick(['"¡Quieto ahí, compa!"', '"¡Ese carro está bonito!"', '"¡Espérame tantito!"', '"¡No te vayas, eh!"']), 2.5);
      return;
    }
  }
  rateroFalla() {
    const r = this.ratero;
    r.st = 'huye'; r.t = 3; r.a = Math.atan2(r.y - r.car.y, r.x - r.car.x);
    this.globo(r, 'ratero', '"' + pick(FRASES_RATERO_FALLA) + '"', 2.5);
    if (this.inCar === r.car) toast('😎 ¡Te le pelaste al ratero!', '', 2);
  }
  // el robo: te bajan por tu puerta y el carro se va al trafico con el ratero manejando como loco
  robarCarro(r) {
    const car = r.car, P = this.player;
    r.sprite.destroy(); this.ratero = null;
    car.vx = car.vy = 0; this.inCar = null;
    const k = car.hw + 13, fx = car.x + Math.sin(car.a) * k, fy = car.y - Math.cos(car.a) * k;
    const [ex, ey] = !blocked(fx, fy) ? [fx, fy] : !blocked(r.x, r.y) ? [r.x, r.y] : [car.x - Math.sin(car.a) * k, car.y + Math.cos(car.a) * k];
    P.x = ex; P.y = ey; P.a = car.a;
    P.sprite.setVisible(true).setPosition(ex, ey).setRotation(car.a);
    this.cameras.main.startFollow(P.sprite, true, 0.15, 0.15);
    this.staminaBar.clear();
    this.jolt(220, 0.008);
    if (window.SND) SND.play('crash', 0.25);
    toast('😱 ' + pick(FRASES_ROBADO), 'Te bajaron del carro. Si lo alcanzas, recupéralo con E.', 4);
    const g = nearestOnGraphCerca(traffic, car.x, car.y);
    if (!g) { this.parked.push(car); this.setObjective(); return; }
    const dir = g.e.one ? 1 : Math.cos(g.a - car.a) >= 0 ? 1 : -1, lane = (Math.random() * 4) | 0;
    Object.assign(car, { e: g.e, dir, s: dir > 0 ? g.s : g.e.len - g.s, lat: laneLat(g.e, lane), lane, speed: 0, max: 150,
      robado: true, loco: true, ph: rnd(0, 6), wf: rnd(1.6, 2.6), locoT: rnd(10, 18), derrape: 0, derrapeV: 0, desvioT: 0, gritoT: 3.5 });
    this.cars.push(car);
    this.carRobado = car;
    this.globo(car, 'ratero', '"' + pick(FRASES_RATERO) + '"', 3);
    if (window.SND) SND.play('claxon', 0.8);
    this.setObjective();
  }
  // mientras se lo lleva, va gritando y pitando
  gritosRatero(dt) {
    const c = this.carRobado;
    if (!c) return;
    if (!c.robado || c.wrecked || !this.cars.includes(c)) { this.carRobado = null; return; }
    if ((c.gritoT -= dt) > 0) return;
    c.gritoT = rnd(4, 6.5);
    const f = this.focus();
    if (dist(c.x, c.y, f.x, f.y) > this.viewR()) return;
    this.globo(c, 'ratero', '"' + pick(FRASES_RATERO_MANEJA) + '"', 2.2);
    this.claxon(c);
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
      if (p.st === 'flee') { p.t -= dt; if (p.t <= 0) { p.st = 'walk'; p.sprite.anims.timeScale = p.speed / 20; if (p.paid) { p.sprite.destroy(); p.dead = true; continue; } } }
      if (p.coyote && p.st === 'walk') {
        // deambula: camina un rato, se para y mira a los lados; si te esta ofreciendo, se queda viendote
        const ofrece = this.coy && this.coy.p === p;
        p.t -= dt;
        if (p.t <= 0 && !ofrece) { p.idle = !p.idle; p.t = p.idle ? rnd(2.5, 5) : rnd(5, 10); }
        if (p.idle || ofrece) {
          if (p.sprite.anims.isPlaying) { p.sprite.stop(); p.sprite.setFrame(0); }
          const pl = this.player;
          p.sprite.setRotation(ofrece ? Math.atan2(pl.y - p.y, pl.x - p.x) : p.a + Math.sin(this.time.now / 700 + p.ph) * 0.9);
          continue;
        }
        if (!p.sprite.anims.isPlaying) p.sprite.play({ key: 'walkC', startFrame: 1 });
      }
      if (p.tianguis && p.st === 'walk') {
        // en el sobreruedas: camina un rato y se para a ver un puesto
        if ((p.t -= dt) <= 0) { p.idle = !p.idle; p.t = p.idle ? rnd(2, 6) : rnd(3, 9); }
        if (p.idle) {
          if (p.sprite.anims.isPlaying) p.sprite.anims.pause();
          p.sprite.setRotation(p.a + Math.sign(p.side || 1) * 1.3 + Math.sin(this.time.now / 900 + p.ph) * 0.4);
          continue;
        }
        if (p.sprite.anims.isPaused) p.sprite.anims.resume();
      }
      const sp = p.st === 'flee' ? 70 : p.speed;
      // si tiene un carro enfrente se espera; si no se quita en un rato, se da la vuelta
      const ax = p.x + Math.cos(p.a) * 5, ay = p.y + Math.sin(p.a) * 5;
      if (this.carBlocks(p.x, p.y, ax, ay, 2)) {
        p.wait = (p.wait || 0) + dt;
        if (p.sprite.anims.isPlaying) p.sprite.anims.pause();
        if (p.wait > 2.5) { p.wait = 0; p.dir = -p.dir; p.s = p.e.len - p.s; p.side = -p.side; p.a += Math.PI; }
        continue;
      }
      if (p.wait) { p.wait = 0; p.sprite.anims.resume(); }
      p.s += sp * dt;
      if (p.s > p.e.len) {
        const nx = nextEdge(walkG, p.e, p.dir);
        // los del sobreruedas no se salen: al llegar a la orilla se dan la vuelta
        if (nx && (!p.tianguis || nx.e.tianguis)) { p.s -= p.e.len; p.e = nx.e; p.dir = nx.dir; p.side = p.tianguis ? latTianguis(p.e) : pedSide(p.e, p.s, p.dir, p.x, p.y, 0.12); }
        else { p.s = 0; p.dir = -p.dir; p.side = -p.side; }
      }
      if (pasoBanqueta(p, tmp)) { p.x += (tmp.x - p.x) * Math.min(1, dt * 10); p.y += (tmp.y - p.y) * Math.min(1, dt * 10); }
      else { p.dir = -p.dir; p.s = p.e.len - p.s; }
      p.a = tmp.a;
      p.sprite.setPosition(p.x, p.y).setRotation(p.a);
    }
    if (this.peds.some(p => p.dead)) this.peds = this.peds.filter(p => !p.dead);
  }

  // la gente te habla si te le pegas caminando (una frase distinta cada vez hasta agotarlas)
  pedChat(dt) {
    const b = this.bubble;
    this.chatCool -= dt;
    if (b.ped) {
      b.t -= dt;
      this.placeBubble();
      if (b.t <= 0 || b.ped.st === 'down' || dist(b.ped.x, b.ped.y, this.focus().x, this.focus().y) > (b.ped.robado || b.ped.escena || b.ped.fila || b.ped.vende ? 260 : 140)) { b.ped = null; b.el.classList.remove('on'); }
    }
    const cy = this.coy;
    if (cy) { cy.t -= dt; if (cy.t <= 0 || this.inCar || dist(cy.p.x, cy.p.y, this.player.x, this.player.y) > 70) { this.coy = null; this.setObjective(); } }
    if (this.inCar || this.chatCool > 0) return;
    const pl = this.player;
    for (const p of this.peds) {
      if (p.coyote && p.st === 'walk' && !p.offered && dist(p.x, p.y, pl.x, pl.y) < 28) { this.ofrecerCoyote(p); break; }
      if (p.coyote || p.st !== 'walk' || p.talked || dist(p.x, p.y, pl.x, pl.y) > 14) continue;
      if (!this.chatDeck.length) this.chatDeck = Phaser.Utils.Array.Shuffle(FRASES_PEATON.slice());
      p.talked = true; b.ped = p; b.t = 4.5; this.chatCool = 2.5;
      // los personajes casi siempre hablan de lo suyo
      const fr = p.tianguis && Math.random() < 0.75 ? { k: 'tianguis', t: pick(FRASES_SOBRERUEDAS) }
        : p.tipo && Math.random() < 0.8 ? { k: 'colonia', t: pick(FRASES_TIPO[p.tipo]) } : this.chatDeck.pop();
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

  // el coyote te habla bajito; con E (o el boton PAGAR) lo contratas... y te estafa
  globo(p, k, t, secs) {
    const b = this.bubble;
    b.ped = p; b.t = secs; b.el.className = 'hud bubble ' + k; b.el.textContent = t;
    b.el.style.setProperty('--tilt', (Math.random() * 5 - 2.5).toFixed(1) + 'deg');
    this.placeBubble(); void b.el.offsetWidth; b.el.classList.add('on');
  }
  ofrecerCoyote(p) {
    p.offered = true; this.chatCool = 2.5;
    const price = Math.round(rnd(300, 800) / 50) * 50, how = document.body.classList.contains('touch') ? 'toca PAGAR' : 'E para pagar';
    this.coy = { p, price, t: 8 };
    this.globo(p, 'coyote', pick(COYOTE_OFERTA).replace('$', '$' + price) + '  (' + how + ')', 8);
    if (window.SND) SND.play('chat');
    this.setObjective();
  }
  pagarCoyote() {
    const { p, price } = this.coy;
    this.coy = null; p.idle = false; p.t = rnd(6, 10);
    if (state.money < price) { this.globo(p, 'coyote', '¿Y la lana? Así no se puede, compa.', 3); this.setObjective(); return; }
    state.money -= price; save(); updateStats();
    this.globo(p, 'coyote', pick(COYOTE_PAGO), 3.5);
    // se va "por la camioneta" y ya no vuelve
    p.paid = true; p.st = 'flee'; p.t = 5; p.sprite.play({ key: 'walkC', startFrame: 1 }); p.sprite.anims.timeScale = 2.2;
    this.time.delayedCall(9000, () => toast('🤫 Te estafó el coyote (-$' + price + ')', pick(COYOTE_ESTAFA), 5));
    this.setObjective();
  }

  // ----- paros: cada personaje se para en una banqueta de colonia, lejos de los lugares tipicos y de los otros;
  // siempre en el mismo lugar (se recorren las calles en un orden fijo) -----
  colocarParos() {
    const lejos = (x, y, list, r) => list.every(q => dist(q.x, q.y, x, y) > r);
    // el orden sale de donde queda cada calle (en metros desde la referencia fija), no de su numero: asi no se
    // revuelven cuando el mapa crece y llegan calles nuevas
    const orden = (e) => { const q = edgePos(e, e.len / 2, 1, 0, {}); return hash(Math.round((q.x - REF_X) / M) * 7919 + Math.round((q.y - REF_Y) / M) * 31 + 3); };
    const cands = walkG.edges.filter(e => e.c <= 6 && e.len > 40).map(e => [orden(e), e]).sort((a, b) => a[0] - b[0]).map(q => q[1]);
    // las zonas de algunos paros (metros, x0 y0 x1 y1): el sur, entre los cerros y el Campestre; el oriente
    // (el quinto numero, si esta, es la separacion minima en metros con los demas paros; si no, 600)
    // fase 1: Otay (al norte de 32.515) y La Mesa (al sur), al oriente de -116.9915; fase 2: La Presa y el Cerro
    // Colorado (al oriente de -116.96 y al sur de 32.486)
    const ZONAS = { sur: [1300, 2800, 4600, 4755], oriente: [4300, 200, 5913, 4755, 500], otay: [5300, -1600, 12300, 3096], lamesa: [5300, 3096, 12300, 6400],
      presa: [8259, 6303, 16000, 11700], playas: [-8900, -200, -3600, 11700],
      florido: [15955, 2000, 23300, 11610], natura: [-8900, 11610, 23300, 17000] };
    this.paros = [];
    // primero los que tienen zona (tienen menos lugar), luego los demas; la lista queda en el orden de PAROS
    for (const P of [...PAROS.filter(P => P.zona), ...PAROS.filter(P => !P.zona)]) {
      const z = ZONAS[P.zona];
      let q = null, mid = null, e = null;
      for (const c of cands) {
        const t = edgePos(c, c.len / 2, 1, c.w / 2 + 1.5 * M, {});
        if (z && (t.x < REF_X + z[0] * M || t.y < REF_Y + z[1] * M || t.x > REF_X + z[2] * M || t.y > REF_Y + z[3] * M)) continue;
        if (t.y < borderY(t.x) + 300 || t.x < 200 || t.y < 200 || t.x > WORLD_W - 200 || t.y > WORLD_H - 200) continue;
        if (!lejos(t.x, t.y, landmarks, 450 * M) || !lejos(t.x, t.y, this.paros, ((z && z[4]) || 600) * M) || blocked(t.x, t.y) || enNiebla(t.x, t.y, NIEBLA_LEJOS) || !walkableTo(t.x, t.y, 10)) continue;
        q = t; mid = edgePos(c, c.len / 2, 1, 0, {}); e = c; break;
      }
      if (!q) continue;
      const face = Math.atan2(mid.y - q.y, mid.x - q.x);
      const npc = this.add.sprite(q.x, q.y, 'ped' + (hash(e.id) % N_PEDS), 0).setDepth(6).setScale(1 / SPR).setRotation(face);
      const ico = this.add.text(q.x, q.y - 20, P.ico, { fontSize: '18px', resolution: TXT_RES }).setOrigin(0.5).setDepth(20);
      this.tweens.add({ targets: ico, y: q.y - 24, duration: 800, yoyo: true, repeat: -1, ease: 'Sine.inOut' });
      this.paros.push({ ...P, x: q.x, y: q.y, npc, ico, hecho: (state.paros || []).includes(P.k) });
    }
    this.paros.sort((a, b) => PAROS.findIndex(P => P.k === a.k) - PAROS.findIndex(P => P.k === b.k));
  }
  checkParos(dt, f, sp) {
    const of = this.paroOfer;
    if (of) { of.t -= dt; if (of.t <= 0 || this.inCar || dist(of.p.x, of.p.y, this.player.x, this.player.y) > 70) { this.paroOfer = null; this.setObjective(); } }
    for (const p of this.paros) p.ico.setAlpha(p.hecho ? 0.35 : 1);
    // el paro en curso: llegar a tiempo (a pie o en carro, despacio)
    const pr = this.paro;
    if (pr) {
      pr.time -= dt;
      if (pr.time <= 0) this.endParo(false);
      else if (dist(pr.x, pr.y, f.x, f.y) < 50 && sp < 60) this.endParo(true);
    }
    if (this.inCar || this.paroOfer || this.paroCool > 0) { this.paroCool -= dt; return; }
    const pl = this.player;
    for (const p of this.paros) {
      if (dist(p.x, p.y, pl.x, pl.y) > 30 || (pr && pr.de === p)) continue;
      this.paroCool = 6;
      if (p.hecho) { this.globo(p, 'paro', pick(['"¡Gracias otra vez por el paro!"', '"Ya quedó, ¿eh? Te debo una."', '"Cuando ocupes algo, aquí andamos."']), 3); break; }
      if (this.paro || this.delivery || this.taxi) { this.globo(p, 'paro', '"Te iba a pedir un paro, pero ya andas ocupado. Termina lo tuyo y vuelve."', 4); break; }
      const how = document.body.classList.contains('touch') ? 'toca ACEPTAR' : 'E para aceptar';
      this.paroOfer = { p, t: 9 };
      this.globo(p, 'paro', p.pide + '  (' + how + ')', 9);
      if (window.SND) SND.play('chat');
      this.setObjective();
      break;
    }
  }
  aceptarParo() {
    const p = this.paroOfer.p; this.paroOfer = null;
    if (this.bubble.ped === p) this.bubble.t = 0; // se cierra el globo de la peticion (el aviso dice a donde ir)
    let spot = null, mid = null;
    for (let i = 0; i < 60 && !spot; i++) {
      const e = randomEdgeNear(walkG, p.x, p.y, 1500, 3500); if (!e || e.c > 6) continue;
      const s = rnd(0, e.len), q = edgePos(e, s, 1, e.w / 2 + 1.5 * M, {});
      if (!blocked(q.x, q.y) && !enNiebla(q.x, q.y, NIEBLA_LEJOS) && q.y > borderY(q.x) + 150) { spot = q; mid = edgePos(e, s, 1, 0, {}); }
    }
    if (!spot) { this.globo(p, 'paro', '"Mejor al rato, que no me acuerdo ni de la dirección."', 3); this.setObjective(); return; }
    const d = dist(spot.x, spot.y, p.x, p.y), street = streetAt(spot.x, spot.y) || 'una calle de Tijuana';
    // quien recibe espera en la banqueta, viendo hacia la calle
    const face = Math.atan2(mid.y - spot.y, mid.x - spot.x);
    let who;
    if (p.recibe === 'perro') who = this.add.sprite(spot.x, spot.y, 'perro', 0).setDepth(6).setScale(1 / SPR).setRotation(face).play('cola');
    else {
      who = this.add.sprite(spot.x, spot.y, 'ped' + pedVariant(), 0).setDepth(6).setScale(1 / SPR).setRotation(face);
      this.tweens.add({ targets: who, angle: who.angle + 8, duration: 700, yoyo: true, repeat: -1, ease: 'Sine.inOut' });
    }
    this.paro = { de: p, x: spot.x, y: spot.y, street, d, who, time: p.prisa ? d / 80 + 25 : d / 55 + 60 };
    toast('🤝 Paro para ' + p.quien, 'Lleva ' + p.cosa + ' ' + aDonde(p.a) + ', en ' + street + '.' + (p.prisa ? ' ¡Tiene prisa!' : ''), 5);
    this.setObjective();
  }
  endParo(ok) {
    const pr = this.paro, p = pr.de; this.paro = null; hud.timer.style.display = 'none';
    if (ok) {
      const pay = Math.round((60 + pr.d / 9 + pr.time * 2) / 5) * 5, nuevo = !p.hecho;
      p.hecho = true; state.paros = this.paros.filter(q => q.hecho).map(q => q.k);
      state.money += pay; save(); bigSound = nuevo; updateStats();
      const n = state.paros.length;
      toast('🤝 ¡Paro cumplido! (+$' + pay + ')', p.fin + (nuevo ? (n === this.paros.length ? '  ¡Ya le hiciste el paro a toda la ciudad!' : '  Paro ' + n + ' de ' + this.paros.length + '.') : ''), 7);
    } else toast('🤝 Se te pasó el tiempo', p.mal + '  (' + p.quien + ' te espera para intentarlo otra vez)', 6);
    const w = pr.who; this.tweens.killTweensOf(w);
    if (ok) this.tweens.add({ targets: w, scale: 1.4 / SPR, duration: 160, yoyo: true, repeat: 1 });
    this.tweens.add({ targets: w, alpha: 0, delay: ok ? 1500 : 0, duration: 600, onComplete: () => w.destroy() });
    this.setObjective();
  }

  // el globo es HTML: se coloca sobre la cabeza del peaton pasando de coordenadas del mundo a pixeles CSS
  // ----- carros en los estacionamientos (ver estacionamiento) -----
  // se llenan al acercarte (sin que se vea el lugar, salvo al arrancar) y se vacian al alejarte; los que te
  // llevaste o moviste ya no son del estacionamiento
  updateLotes(dt) {
    if ((this.lotT = (this.lotT ?? 0) - dt) > 0) return;
    const inicial = !this.lotes; this.lotT = 0.5; this.lotes = this.lotes || new Set();
    const f = this.focus(), R = this.viewR(), v = this.cameras.main.worldView;
    for (const L of this.lotes) {
      if (dist(L.cx, L.cy, f.x, f.y) < R + 900 + L.r) continue;
      for (const c of L.carros) {
        const i = this.parked.indexOf(c);
        if (i >= 0 && c !== this.inCar && dist(c.x, c.y, c.x0, c.y0) < 2) { c.sprite.destroy(); this.parked.splice(i, 1); }
      }
      L.carros = null; this.lotes.delete(L);
    }
    const A = R + 500, vistos = new Set();
    for (let cx = Math.floor((f.x - A) / CHUNK); cx <= Math.floor((f.x + A) / CHUNK); cx++) for (let cy = Math.floor((f.y - A) / CHUNK); cy <= Math.floor((f.y + A) / CHUNK); cy++) {
      for (const L of chunkEst.get(GK(cx, cy)) || []) {
        if (vistos.has(L) || this.lotes.has(L)) continue;
        vistos.add(L);
        if (dist(L.cx, L.cy, f.x, f.y) > A + L.r) continue;
        const seVe = L.bb[0] < v.right + 40 && L.bb[2] > v.x - 40 && L.bb[1] < v.bottom + 40 && L.bb[3] > v.y - 40;
        if (seVe && !inicial) continue;
        // unos mas llenos que otros (siempre los mismos cajones para el mismo estacionamiento y la misma vuelta)
        const rnd = mulberry(L.id * 31 + ((Math.random() * 1e6) | 0)), lleno = 0.3 + rnd() * 0.5;
        L.carros = [];
        for (const q of L.cajones) {
          if (rnd() > lleno) continue;
          if (this.parked.some(c => Math.abs(c.x - q.x) < 14 && Math.abs(c.y - q.y) < 14) || (this.inCar && dist(this.inCar.x, this.inCar.y, q.x, q.y) < 20)) continue;
          const car = this.makeCar(q.x, q.y, q.a + (rnd() - 0.5) * 0.08, this.carSpec({ ti: pick([0, 0, 1, 3, 3, 4, 4, 5, 6]) }));
          car.x0 = car.x; car.y0 = car.y; this.parked.push(car); L.carros.push(car);
        }
        this.lotes.add(L);
      }
    }
  }
  // ----- la fila de las garitas (ver GARITAS) -----
  // los carros aparecen al acercarte (sin que se vea su lugar, salvo al arrancar) y se quitan al alejarte; un aviso
  // al llegar, y de vez en cuando alguien de la fila pita o te dice algo
  updateFila(dt) {
    if ((this.filaT = (this.filaT ?? 0) - dt) > 0) return;
    const inicial = !this.filaOn; this.filaT = 0.4; this.filaOn = this.filaOn || new Set();
    const f = this.focus(), R = this.viewR(), v = this.cameras.main.worldView, A = R + 220; // R: lo mas lejos que se ve
    for (const s of this.filaOn) {
      if (dist(s.x, s.y, f.x, f.y) < A + 200) continue;
      const c = s.car, L = this.filaGrid.get(c.k);
      c.sprite.destroy(); L.splice(L.indexOf(c), 1);
      if (this.bubble.ped === c) this.bubble.t = 0;
      s.car = null; this.filaOn.delete(s);
    }
    if (this.fila.length !== this.filaOn.size) this.fila = [...this.filaOn].map(s => s.car);
    this.filaBB = [Infinity, Infinity, -Infinity, -Infinity]; // donde hay (con margen), para no buscar donde no
    // donde no estorbe: ni tu, ni tu carro (si lo dejaste en la fila), ni otros
    const otros = this.cars.concat(this.parked, [this.player]);
    for (let cx = Math.floor((f.x - A) / CHUNK); cx <= Math.floor((f.x + A) / CHUNK); cx++) for (let cy = Math.floor((f.y - A) / CHUNK); cy <= Math.floor((f.y + A) / CHUNK); cy++) {
      for (const s of chunkFila.get(GK(cx, cy)) || []) {
        if (s.car || dist(s.x, s.y, f.x, f.y) > A) continue;
        if (!inicial && s.x > v.x - 40 && s.x < v.right + 40 && s.y > v.y - 40 && s.y < v.bottom + 40) continue;
        if (otros.some(o => Math.abs(o.x - s.x) < 30 && Math.abs(o.y - s.y) < 30)) continue;
        const car = this.makeCar(s.x, s.y, s.a, this.carSpec({ ti: s.ti, ci: s.ci, d: s.d }));
        car.fila = s.G; car.k = GK(Math.floor(s.x / 64), Math.floor(s.y / 64)); s.car = car; this.fila.push(car); this.filaOn.add(s);
        if (!this.filaGrid.has(car.k)) this.filaGrid.set(car.k, []); this.filaGrid.get(car.k).push(car);
      }
    }
    const bb = this.filaBB;
    for (const c of this.fila) { bb[0] = Math.min(bb[0], c.x - 130); bb[1] = Math.min(bb[1], c.y - 130); bb[2] = Math.max(bb[2], c.x + 130); bb[3] = Math.max(bb[3], c.y + 130); }
    this.ponerVendedores(f, A, v, inicial);
    // los de la fila que se ven cerca: el aviso al llegar y el ambiente
    const cerca = [];
    for (const s of this.filaOn) if (s.car && !s.car.wrecked && dist(s.x, s.y, f.x, f.y) < R * 0.8) cerca.push(s.car);
    for (const G of GARITAS) {
      const n = cerca.filter(c => c.fila === G).length;
      if (!n && dist(G.x, G.y, f.x, f.y) > G.largo + R + 600) G.avisado = false;
      else if (n >= 6 && !G.avisado) {
        G.avisado = true;
        toast('🚗 La fila de ' + G.nombre, G.dato + ' Aquí siempre hay fila para cruzar a Estados Unidos: los carros no se mueven.', 5);
      }
    }
    if (!cerca.length || (this.filaHablaT = (this.filaHablaT ?? 2) - 0.4) > 0) return;
    this.filaHablaT = rnd(2.5, 5);
    const c = pick(cerca);
    if (window.SND && Math.random() < 0.6) SND.play('pito', 0.3 + 0.7 * Math.max(0, 1 - dist(c.x, c.y, f.x, f.y) / R));
    const junto = cerca.filter(o => dist(o.x, o.y, f.x, f.y) < 220);
    if (!this.bubble.ped && junto.length && Math.random() < 0.7) this.globo(pick(junto), 'fila', pick(FRASES_FILA), 4);
  }
  // ----- vendedores entre los carros de la fila (ver VENDEDORES) -----
  // hasta seis donde hay carros de la fila cerca; aparecen fuera de la vista y se van al alejarte. Caminan por el
  // hueco entre dos carriles (o junto al carril, si es uno solo) y se paran en las ventanillas a ofrecer
  ponerVendedores(f, A, v, inicial) {
    this.vendedores = this.vendedores.filter(o => {
      if (dist(o.x, o.y, f.x, f.y) < A + 200 && this.fila.length) return true;
      o.sprite.destroy(); o.carga.destroy(); if (this.bubble.ped === o) this.bubble.t = 0; return false;
    });
    if (this.fila.length < 20 || this.vendedores.length >= 6) return;
    if (!this.textures.exists('vende_churros')) makeMercancia(this);
    const trs = []; for (const G of GARITAS) for (const T of G.tramos || []) { const p = T.e.p, m = p.length >> 2 << 1; if (dist(p[m], p[m + 1], f.x, f.y) < A + T.e.len / 2) trs.push(T); }
    for (let n = 0; n < 3 && trs.length && this.vendedores.length < 6; n++) {
      const T = pick(trs), e = T.e, lat = pick(e.c <= MAJOR ? [-e.w / 6, e.w / 6] : [-11, 11]), sv = rnd(T.t0, T.t1), q = edgePos(e, sv, 1, lat, {});
      const d = dist(q.x, q.y, f.x, f.y);
      if (d > A || d < 60 || !this.filaEn(q.x, q.y).length || this.vendedores.some(o => dist(o.x, o.y, q.x, q.y) < 120)) continue;
      if (!inicial && q.x > v.x - 40 && q.x < v.right + 40 && q.y > v.y - 40 && q.y < v.bottom + 40) continue;
      const k = pick(Object.keys(VENDEDORES)), speed = rnd(12, 17);
      const sprite = this.walker(q.x, q.y, speed / 20).setDepth(10.2);
      const carga = this.add.image(q.x, q.y, 'vende_' + k).setDepth(10.3).setScale(1 / SPR);
      this.vendedores.push({ T, lat, s: sv, dir: Math.random() < 0.5 ? 1 : -1, speed: speed * sprite.pace, st: 'walk', t: rnd(2, 6), lado: 1, x: q.x, y: q.y, a: q.a, k, sprite, carga, vende: true, hablaT: 0, ph: rnd(0, 6) });
    }
  }
  updateVendedores(dt) {
    if (!this.vendedores.length) return;
    const car = this.inCar, csp = car ? Math.hypot(car.vx, car.vy) : 0, f = this.focus(), tmp = this.tmp, now = this.time.now;
    for (const o of this.vendedores) {
      // atropellado: al piso un rato (la mercancia tambien)
      if (o.st === 'down') {
        if ((o.t -= dt) <= 0) { o.st = 'walk'; o.t = rnd(2, 5); o.sprite.setScale(1 / SPR).clearTint(); o.sprite.anims.resume(); o.carga.setVisible(true); }
        continue;
      }
      if (car && csp > 50 && axisDist(o.x, o.y, car) < car.hw + 3) {
        o.st = 'down'; o.t = 2.5; o.sprite.setScale(1.2 / SPR, 0.6 / SPR).setTint(0xaaaaaa); o.sprite.anims.pause(); o.carga.setVisible(false);
        if (Math.random() < 0.7) toast(pick(FRASES_ATROPELLO), '', 1.8);
        continue;
      }
      // camina un rato y se para en una ventanilla a ofrecer; a veces se regresa
      if ((o.t -= dt) <= 0) {
        if (o.st === 'walk') { o.st = 'para'; o.t = rnd(2, 4.5); o.lado = Math.random() < 0.5 ? 1 : -1; }
        else { o.st = 'walk'; o.t = rnd(3, 8); if (Math.random() < 0.25) o.dir = -o.dir; }
      }
      // si se te pega (a pie o en carro despacito) te ofrece lo suyo
      const d = dist(o.x, o.y, f.x, f.y), habla = this.bubble.ped === o;
      if (!this.bubble.ped && now > o.hablaT && d < (car ? 45 : 26) && csp < 40) {
        o.hablaT = now + 12000;
        this.globo(o, 'vendedor', pick(Math.random() < 0.8 ? VENDEDORES[o.k] : FRASES_VENDEDOR), 3.5);
        if (window.SND) SND.play('chat');
      }
      if (o.st === 'para' || habla) {
        if (o.sprite.anims.isPlaying) o.sprite.anims.pause();
        const mira = habla && d < 60 ? Math.atan2(f.y - o.y, f.x - o.x) : o.a + o.lado * Math.PI / 2 + Math.sin(now / 500 + o.ph) * 0.15;
        o.sprite.setRotation(mira);
        o.carga.setPosition(o.x + Math.cos(mira) * 4.5, o.y + Math.sin(mira) * 4.5).setRotation(mira);
        continue;
      }
      if (o.sprite.anims.isPaused) o.sprite.anims.resume();
      o.s += o.dir * o.speed * dt;
      if (o.s < o.T.t0 || o.s > o.T.t1) { o.s = Math.max(o.T.t0, Math.min(o.T.t1, o.s)); o.dir = -o.dir; }
      edgePos(o.T.e, o.s, 1, o.lat, tmp);
      o.x = tmp.x; o.y = tmp.y; o.a = tmp.a + (o.dir < 0 ? Math.PI : 0);
      o.sprite.setPosition(o.x, o.y).setRotation(o.a);
      o.carga.setPosition(o.x + Math.cos(o.a) * 4.5, o.y + Math.sin(o.a) * 4.5).setRotation(o.a);
    }
    // el pregon: de vez en cuando uno de los que se ven grita lo que vende
    if ((this.pregonT = (this.pregonT ?? 3) - dt) <= 0) {
      this.pregonT = rnd(5, 9);
      const L = this.vendedores.filter(o => o.st !== 'down' && dist(o.x, o.y, f.x, f.y) < 260);
      if (L.length && !this.bubble.ped) { const o = pick(L); this.globo(o, 'vendedor', pick(VENDEDORES[o.k]), 3); }
    }
  }
  // ¿lo que esta en (x, y) le pega a algo de un choque? (los carros, la moto, la patrulla y la gente parada)
  enChoque(L, x, y, pad) {
    for (const E of L) {
      if (Math.abs(E.x - x) > 160 || Math.abs(E.y - y) > 160) continue;
      for (const o of E.on.carros) if (axisDist(x, y, o) < o.hw + pad) return true;
      for (const p of E.on.gente) if (dist(x, y, p.x, p.y) < pad - 2) return true; // (pasan rozandolos: la gente se hace a un lado)
    }
    return false;
  }
  // Un carro del trafico cerca de un choque: busca por donde pasar sin pegarle a nada (su carril si esta libre; si no,
  // el carril de al lado o hasta el de los que vienen de frente, si no viene nadie) y se va recorriendo hacia alla.
  // Si no hay por donde, o todavia no termina de hacerse a un lado, frena: los de atras se forman (la fila sale
  // sola, cada quien frena por el de adelante). Devuelve 0 nada, 1 ir despacio, 2 detenerse.
  rodeaChoque(c, L, dt) {
    if (!L.some(E => Math.abs(E.x - c.x) < 320 && Math.abs(E.y - c.y) < 320)) { c.esq = 0; return 0; }
    if ((c.esqT = (c.esqT || 0) - dt) > 0) return c.esqR;
    c.esqT = 0.15;
    // por donde va a ir: su calle y la siguiente (se decide desde ahorita; ver updateTraffic). Si puede, se sigue
    // por una calle donde no este el choque (como cualquiera que ve el relajo desde la esquina)
    const q = this.tmp2 || (this.tmp2 = {}), pad = c.hw + 3;
    if (!c.sig && !c.jefe && c.e.len - c.s < 200) {
      const pega = (nx) => { for (let d = 0; d <= 110; d += 8) { edgePos(nx.e, Math.min(d, nx.e.len), nx.dir, laneLat(nx.e, c.lane), q); if (this.enChoque(L, q.x, q.y, pad)) return true; } return false; };
      for (let k = 0; k < 5; k++) { const nx = nextEdge(traffic, c.e, c.dir); if (!nx) break; if (!c.sig || !pega(nx)) c.sig = nx; if (!pega(c.sig)) break; }
    }
    const sig = c.sig;
    // el desvio se mueve con el carro: sigue igual al pasar a la siguiente calle (ver updateTraffic)
    const punto = (d, off) => {
      const s2 = c.s + d;
      if (s2 <= c.e.len || !sig) edgePos(c.e, Math.min(s2, c.e.len), c.dir, c.lat + off, q);
      else edgePos(sig.e, s2 - c.e.len, sig.dir, laneLat(sig.e, c.lane) + off, q);
      return q;
    };
    // hasta donde se puede avanzar con ese desvio (desde la defensa de atras: tambien al irse de lado)
    const libre = (off, hasta) => {
      for (let d = -c.hl; d <= c.hl + hasta; d += 7) { const o = punto(d, off); if (this.enChoque(L, o.x, o.y, pad)) return d - c.hl; }
      return Infinity;
    };
    const hx = Math.cos(c.a), hy = Math.sin(c.a);
    // que quepa en su calle y, si ya va a llegar a la otra, tambien en esa (hasta pisando la raya de la orilla)
    const llega = sig && c.e.len - c.s < c.hl + 140, latS = llega ? laneLat(sig.e, c.lane) : 0;
    const cabe = (e, lat) => Math.abs(lat) <= e.w / 2 - c.hw + 1;
    // ¿viene alguien de frente? (solo cuenta el que va avanzando: los que esperan del otro lado no)
    const vienen = () => this.cars.some(o => o !== c && !o.quieto && !o.wrecked && o.speed > 5 && Math.cos(o.a - c.a) < -0.5 &&
      Math.abs(o.x - c.x) < 220 && Math.abs(o.y - c.y) < 220 && (o.x - c.x) * hx + (o.y - c.y) * hy > 0);
    const sirve = (off) => {
      if (!cabe(c.e, c.lat + off) || (llega && !cabe(sig.e, latS + off))) return false;
      if (libre(off, 140) !== Infinity) return false;
      // meterse al carril de enfrente solo si no viene nadie
      return (c.e.one || c.lat + off - c.hw >= 0) && (!llega || sig.e.one || latS + off - c.hw >= 0) || !vienen();
    };
    // irse de lado sin pegarle a nada en el camino (todo el carro, no solo lo de enfrente)
    const pasa = (off) => { const a = c.esqS || 0; for (const f of [0.34, 0.67, 1]) if (libre(a + (off - a) * f, 0) < 0) return false; return true; };
    let meta = null;
    if (sirve(0) && pasa(0)) meta = 0;
    else if (c.esq && sirve(c.esq)) meta = c.esq;
    else {
      const ops = [];
      const h = c.e.w / 2 - c.hw + 1;
      for (let lat = -h; lat <= h; lat += 4) ops.push(lat - c.lat);
      ops.sort((a, b) => Math.abs(a) - Math.abs(b));
      for (const off of ops) if (off && sirve(off) && pasa(off)) { meta = off; break; }
    }
    if (meta !== null) c.esq = meta;
    else if (!pasa(c.esq || 0)) c.esq = c.esqS || 0; // se queda donde va
    // con el desvio que lleva ahorita: ¿cuanto puede avanzar?
    const d = libre(c.esqS || 0, 70);
    return c.esqR = d < 12 ? 2 : d < 70 ? 1 : 0;
  }
  // ----- escenas de trafico (ver ESCENAS) -----
  // aparecen cuando te acercas sin que se vea el lugar (7 de cada 10 veces), y se quitan al alejarte
  updateEscenas(dt) {
    const f = this.focus(), R = this.viewR(), v = this.cameras.main.worldView;
    for (const E of ESCENAS) {
      const d = dist(E.x, E.y, f.x, f.y), M0 = E.R + 60;
      const seVe = E.x > v.x - M0 && E.x < v.right + M0 && E.y > v.y - M0 && E.y < v.bottom + M0;
      if (!E.on) {
        // esta vez no hubo choque: hasta que te alejes y vuelvas
        if (E.nada) { if (d > R + 600) E.nada = false; continue; }
        if (d < R + 350 && !seVe) { if (tocaChoque()) this.armarEscena(E); else E.nada = true; }
        continue;
      }
      const S = E.on;
      if (d > R + 600 || S.carros.some(c => !this.cars.includes(c))) { this.quitarEscena(E); continue; }
      S.t += dt;
      if (!S.avisado && d < R * 0.8) {
        S.avisado = true;
        toast(S.titulo, E.dato + ' ' + (S.poli ? 'Ya llegó la patrulla y nadie se pone de acuerdo.' : 'Todavía no llega la patrulla.'), 4);
      }
      // intermitentes de los chocados y humito del que se dio de frente
      const prende = (this.time.now / 450 | 0) % 2 === 0;
      for (const l of S.luces) l.setVisible(prende && !l.carro.wrecked);
      if (S.humo && d < R + 100 && (S.humoT -= dt) <= 0) {
        const c = S.humo; S.humoT = 0.35;
        this.puff(c.x + Math.cos(c.a) * (c.hl - 2), c.y + Math.sin(c.a) * (c.hl - 2));
      }
      // la gente: si los atropellas caen un rato; si no, voltean a ver a quien le hablan y patalean al hablar
      const car = this.inCar, csp = car ? Math.hypot(car.vx, car.vy) : 0;
      for (const p of S.gente) {
        if (p.down > 0) { if ((p.down -= dt) <= 0) p.sprite.setScale(1 / SPR).clearTint(); continue; }
        if (car && csp > 50 && axisDist(p.x, p.y, car) < car.hw + 3) {
          p.down = 2.5; p.sprite.setScale(1.2 / SPR, 0.6 / SPR).setTint(0xaaaaaa);
          if (Math.random() < 0.7) toast(pick(FRASES_ATROPELLO), '', 1.8);
          continue;
        }
        const habla = this.bubble.ped === p, mira = habla ? p.a : Math.atan2(p.mira.y - p.y, p.mira.x - p.x);
        p.sprite.setRotation(mira + (habla ? Math.sin(S.t * 13) * 0.22 : Math.sin(S.t * 1.3 + p.ph) * 0.12));
        p.sprite.setFrame(habla ? [0, 2, 0, 6][(S.t * 8 | 0) % 4] : 0);
      }
      // el pleito: hablan por turnos cuando estas cerca (si nadie mas te esta hablando). Si te arrimas a pie, el de
      // transito te corre; sin patrulla, el chocado te pide que seas su testigo
      if ((S.turnoT -= dt) <= 0 && d < 260 && (!this.bubble.ped || this.bubble.ped.escena)) {
        const G = S.gente, T = G.find(p => p.quien === 'poli') || G[0], aPie = !this.inCar && dist(T.x, T.y, f.x, f.y) < 70;
        const toca = aPie && Math.random() < 0.5 ? 'miron' : S.orden[S.turno++ % S.orden.length];
        const p = toca === 'miron' ? T : G.find(q => q.quien === toca);
        if (p.down <= 0) {
          // el que habla voltea a ver al otro (el policia, a ti si te esta corriendo)
          p.a = toca === 'miron' ? Math.atan2(f.y - p.y, f.x - p.x) : Math.atan2(p.mira.y - p.y, p.mira.x - p.x);
          const F = FRASES_CHOQUE, ti = F[S.tipo], gl = E.glorieta && S.tipo !== 'carambola' ? F.glorieta : {};
          const fr = toca === 'miron' ? (S.poli ? F.miron : F.testigo)
            : toca === 'poli' ? [...F.poli, ...(ti.poli || []), ...(gl.poli || [])]
            : toca === 'C' ? ti.C
            : [...F[toca], ...ti[toca], ...(gl[toca] || []), ...(S.poli ? [] : F.sinPoli)];
          this.globo(p, p.quien === 'poli' ? 'transito' : 'pleito', pick(fr), 2.5);
          if (window.SND) SND.play('chat');
        }
        S.turnoT = 2.9;
      }
    }
  }
  // Los choques (E.tipos): lado (B se le metio a A por la derecha, en la puerta de atras), alcance (B le pego a A por
  // atras), carambola (C le pego a B y B a A), esquinazo (B se paso el alto y le pego a A en la esquina de enfrente,
  // los dos quedaron chuecos) y moto (A iba en moto y quedo tirada enfrente del carro de B). Casi siempre ya llego
  // la patrulla, atras de todos con la torreta prendida. La gente se para al lado de A, del lado donde no estorba.
  armarEscena(E) {
    if (!this.textures.exists('vidrios')) {
      // vidrios y pedacitos de calavera regados en el piso
      const t = this.textures.createCanvas('vidrios', 40 * SPR, 28 * SPR), x = t.getContext(), r = mulberry(77);
      x.scale(SPR, SPR);
      for (let i = 0; i < 46; i++) {
        const cx = 20 + (r() - 0.5) * 34, cy = 14 + (r() - 0.5) * 22, s = 0.5 + r() * 1.4;
        x.fillStyle = i % 7 === 0 ? 'rgba(200,40,30,0.9)' : i % 5 === 0 ? 'rgba(240,160,40,0.9)' : 'rgba(215,235,245,' + (0.55 + r() * 0.4).toFixed(2) + ')';
        x.beginPath(); x.moveTo(cx, cy - s); x.lineTo(cx + s, cy + s * 0.6); x.lineTo(cx - s * 0.8, cy + s * 0.4); x.closePath(); x.fill();
      }
      t.refresh();
    }
    const tipo = pick(E.tipos), poli = Math.random() < 0.8;
    const titulo = { lado: '💥 Choque en ', alcance: '💥 Alcance en ', esquinazo: '💥 Choque en ', carambola: '💥 Carambola en ', moto: '🛵 Moto tirada en ' }[tipo] + E.lugar;
    const S = { tipo, poli, titulo, carros: [], gente: [], luces: [], extra: [], humo: null, humoT: 0, t: 0, turno: 0, turnoT: 1 };
    // todo se mide desde A: l hacia su derecha y f hacia adelante
    const a = E.a, fx = Math.cos(a), fy = Math.sin(a), rx = -fy, ry = fx;
    const P = (l, f) => [E.x + rx * l + fx * f, E.y + ry * l + fy * f];
    const madreado = () => 1 + ((Math.random() * DIRTY_SEEDS) | 0);
    const sA = tipo === 'moto' ? this.carSpec({ moto: true }) : this.carSpec({ ti: pick(ESCENA_CARROS), d: tipo === 'lado' || Math.random() < 0.5 ? 0 : madreado() });
    const sB = this.carSpec({ ti: pick(ESCENA_CARROS), d: madreado() }), sP = this.carSpec({ poli: true });
    const hlA = sA.T.L / 2, hwA = sA.T.W / 2, hlB = sB.T.L / 2, hwB = sB.T.W / 2, hlP = sP.T.L / 2;
    const carros = [], vidrios = [];
    let lado = -1, fin = -hlA; // de que lado de A se para la gente y donde acaba el choque por atras (para la patrulla)
    if (tipo === 'lado') {
      const atras = hlA * 0.35;
      carros.push([0, 0, a, sA], [hwA + hlB + 1, -atras, a - Math.PI / 2 + 0.3, sB]);
      vidrios.push([hwA + 4, -atras]);
    } else if (tipo === 'alcance' || tipo === 'carambola') {
      carros.push([0, 0, a + 0.05, sA], [1.5, -(hlA + hlB + 1), a - 0.08, sB]);
      vidrios.push([0, -hlA - 1]);
      fin = -(hlA + 2 * hlB + 1);
      if (tipo === 'carambola') {
        const sC = this.carSpec({ ti: pick(ESCENA_CARROS), d: madreado() }), hlC = sC.T.L / 2;
        carros.push([-1, fin - hlC - 1, a + 0.07, sC]);
        vidrios.push([0.5, fin - 1]);
        fin -= 2 * hlC + 1;
      }
    } else if (tipo === 'esquinazo') {
      // B venia de la izquierda, hacia la derecha de A y un poco hacia atras; su defensa quedo en la esquina de A
      const g = Math.PI / 2 + 0.5; // hacia donde iba B, medido desde el frente de A
      carros.push([0, 0, a + 0.25, sA], [-hwA - Math.sin(g) * (hlB + 1) + 2, hlA - Math.cos(g) * (hlB + 1) - 2, a + g, sB]);
      vidrios.push([-hwA + 2, hlA + 2]);
      lado = 1;
    } else {
      // la moto quedo tirada de lado enfrente de B, que la alcanzo por atras
      carros.push([0, hlA + 6, a + Math.PI / 2 + 0.35, sA], [1, -hlB + 2, a - 0.06, sB]);
      vidrios.push([0, 4]);
      fin = -2 * hlB + 2;
    }
    if (poli) carros.push([5, fin - hlP - 16, a + 0.12, sP]);
    for (const [l, f, ang, spec] of carros) {
      const [x, y] = P(l, f), car = this.makeCar(x, y, ang, spec);
      Object.assign(car, { quieto: true, escena: true, speed: 0 });
      this.cars.push(car); S.carros.push(car);
      if (car.poli || car.moto) continue;
      // intermitentes en las cuatro esquinas
      for (const [kx, ky] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
        const lx = x + Math.cos(ang) * car.hl * kx - Math.sin(ang) * car.hw * ky, ly = y + Math.sin(ang) * car.hl * kx + Math.cos(ang) * car.hw * ky;
        const lz = this.add.image(lx, ly, 'luz').setDepth(10.5).setBlendMode(Phaser.BlendModes.ADD).setTint(0xffa000).setScale(10 / 128).setAlpha(0.9);
        lz.carro = car; S.luces.push(lz);
      }
    }
    // al que se dio de frente le sale humito del cofre (en la carambola, al de hasta atras)
    if (tipo !== 'lado' && tipo !== 'moto') S.humo = S.carros[tipo === 'carambola' ? 2 : 1];
    // los vidrios donde se pegaron
    for (const [l, f] of vidrios) S.extra.push(this.add.image(...P(l, f), 'vidrios').setDepth(4.5).setScale(1 / SPR).setRotation(a + Math.random() * 0.6 - 0.3));
    // los conductores al lado de A, frente a frente, y el de transito un poco mas atras (pegaditos a los carros:
    // si no, tapaban toda la calle y nadie podia pasar)
    const iz = (tipo === 'moto' ? hwB : hwA) + 6, m = tipo === 'moto' ? 0 : hlA;
    const lugares = [[iz, m * 0.15, 'A'], [iz + 3, -m * 0.75 - (tipo === 'moto' ? hlB : 0), 'B']];
    if (tipo === 'carambola') lugares.push([iz + 2, fin * 0.7, 'C']);
    if (poli) lugares.push([iz + 8, tipo === 'carambola' ? fin * 0.35 : -m * 0.3 - (tipo === 'moto' ? hlB * 0.5 : 0), 'poli']);
    for (const [l, f, quien] of lugares) {
      const [x, y] = P(lado * l, f);
      const sprite = this.add.sprite(x, y, quien === 'poli' ? 'pedT' : 'ped' + pedVariant(), 0).setDepth(6).setScale(1 / SPR);
      S.gente.push({ x, y, a: 0, sprite, quien, escena: true, down: 0, ph: Math.random() * 6, st: 'escena' });
    }
    // cada conductor mira al otro (el de atras de la carambola, a los dos de enfrente) y el policia a todos
    const G = S.gente, [A, B] = G, C = G.find(p => p.quien === 'C'), T = G.find(p => p.quien === 'poli');
    A.mira = B; B.mira = C && Math.random() < 0.5 ? C : A;
    if (C) C.mira = { x: (A.x + B.x) / 2, y: (A.y + B.y) / 2 };
    if (T) { const ch = G.filter(p => p !== T); T.mira = { x: ch.reduce((s, p) => s + p.x, 0) / ch.length, y: ch.reduce((s, p) => s + p.y, 0) / ch.length }; }
    S.orden = [...(C ? ['A', 'B', 'C', 'A', 'B', 'C'] : ['A', 'B', 'A', 'B']), ...(poli ? ['poli'] : [])];
    E.on = S;
  }
  quitarEscena(E) {
    const S = E.on; E.on = null;
    if (S.gente.includes(this.bubble.ped)) { this.bubble.t = 0; }
    this.cars = this.cars.filter(c => !S.carros.includes(c));
    for (const c of S.carros) { c.sprite.destroy(); if (c.scorch) c.scorch.destroy(); }
    for (const o of [...S.gente.map(p => p.sprite), ...S.luces, ...S.extra]) o.destroy();
  }

  placeBubble() {
    const b = this.bubble, cam = this.cameras.main, v = cam.worldView, k = cam.zoom / DPR;
    const hw = b.el.offsetWidth / 2 + 8; // que no se salga por los lados
    b.el.style.left = Math.max(hw, Math.min(window.innerWidth - hw, (b.ped.x - v.x) * k)) + 'px';
    b.el.style.top = ((b.ped.y - 10 - v.y) * k) + 'px';
  }

  // ----- neblina en las orillas del mapa -----
  // Cada orilla lleva una franja con un degradado (pura neblina afuera y en la orilla, que se abre hacia adentro)
  // y encima dos capas de nubes que se repiten a lo largo y se van moviendo despacio, a distinta velocidad.
  makeNiebla() {
    const L = NIEBLA_FUERA + NIEBLA_ANCHO, TW = 512, TH = 256; // las texturas: TW a lo largo de la orilla, TH a lo ancho
    const alfa = (u) => { const d = u * L - NIEBLA_FUERA; if (d < 15 * M) return 1; const t = Math.min(1, (d - 15 * M) / (NIEBLA_ANCHO - 15 * M)); return (1 - t) * (1 - t) * (1 - t * 0.4); };
    // degradado: u = 0 afuera, u = 1 adentro. Mide 3 x 250 a proposito: con medidas potencia de 2 la textura
    // se repite y la orilla de afuera (cerrada) se cuela como una raya en la de adentro
    const GH = 250, g = this.textures.createCanvas('niebla', 3, GH), gx = g.getContext();
    for (let i = 0; i < GH; i++) { gx.fillStyle = 'rgba(214,220,224,' + alfa(i / (GH - 1)).toFixed(3) + ')'; gx.fillRect(0, i, 3, 1); }
    g.refresh();
    for (const [k, seed, n] of [['nieblaA', 7, 34], ['nieblaB', 21, 22]]) {
      const t = this.textures.createCanvas(k, TW, TH), x = t.getContext(), rnd = mulberry(seed);
      for (let i = 0; i < n; i++) { // nubes suaves, repetidas en las dos puntas para que la franja no tenga costura
        const cx = rnd() * TW, cy = TH * (0.15 + rnd() * 0.75), r = 40 + rnd() * 70;
        for (const dx of [-TW, 0, TW]) {
          const gr = x.createRadialGradient(cx + dx, cy, 0, cx + dx, cy, r);
          gr.addColorStop(0, 'rgba(232,236,240,0.55)'); gr.addColorStop(1, 'rgba(232,236,240,0)');
          x.fillStyle = gr; x.beginPath(); x.ellipse(cx + dx, cy, r * 1.6, r, 0, 0, 7); x.fill();
        }
      }
      // que se desvanezcan hacia adentro igual que el degradado (y no tapen nada mas alla de la franja).
      // Las dos puntas van transparentes: la textura tambien se repite a lo ancho y una orilla se colaria en la otra
      // (afuera no hace falta: ahi el degradado ya es neblina cerrada)
      x.globalCompositeOperation = 'destination-in';
      for (let i = 0; i < TH; i++) { x.fillStyle = 'rgba(0,0,0,' + (i < 8 || i > TH - 9 ? 0 : Math.min(1, alfa(i / (TH - 1)) * 1.6)).toFixed(3) + ')'; x.fillRect(0, i, TW, 1); }
      t.refresh();
    }
    // cada orilla: la esquina de donde sale la textura y su giro. Sin girar, la textura va a lo largo hacia +x
    // y de afuera hacia adentro hacia +y; girada, "adentro" queda hacia el centro del mapa
    const W = WORLD_W, H = WORLD_H, F = NIEBLA_FUERA;
    const lados = [
      { x: -F, y: H + F + L, a: -Math.PI / 2, len: H + F + 2 * L }, // oeste: a lo largo hacia el norte, adentro hacia +x
      { x: W + F, y: -L, a: Math.PI / 2, len: H + F + 2 * L }, // este: hacia el sur, adentro hacia -x
      { x: W + F + L, y: H + F, a: Math.PI, len: W + 2 * F + 2 * L }, // sur: hacia el oeste, adentro hacia -y
    ];
    // las nubes son franjas de NIEBLA_TRAMO que se recorren a lo largo de su orilla siguiendo a la camara: Phaser
    // le hace a cada tileSprite un lienzo de su tamaño y una franja de toda la orilla (mas de 32 mil px desde que el
    // mapa es toda la ciudad) Firefox no la acepta y el juego se quedaba sin imagen
    this.niebla = []; this.nieblaNubes = [];
    lados.forEach((l, li) => {
      const g = this.add.image(0, 0, 'niebla').setDisplaySize(l.len, L);
      g.setOrigin(0, 0).setPosition(l.x, l.y).setRotation(l.a).setDepth(22); this.niebla.push(g);
      ['nieblaA', 'nieblaB'].forEach((k, ki) => {
        const o = this.add.tileSprite(0, 0, Math.min(NIEBLA_TRAMO, l.len), TH, k).setScale(1, L / TH);
        o.setOrigin(0, 0).setRotation(l.a).setDepth(22); this.niebla.push(o);
        this.nieblaNubes.push({ o, l, vel: ki ? -5 : 9, base: (li * 3 + ki + 1) * 97 });
      });
    });
    this.nieblaT = 0; this.nieblaAviso = 0; this.bordoAviso = 0;
  }
  updateNiebla(dt, f) {
    this.nieblaT += dt;
    const noche = this.night ? this.night.a : 0, c = Phaser.Display.Color.Interpolate.ColorWithColor({ r: 255, g: 255, b: 255 }, { r: 58, g: 64, b: 88 }, 100, noche * 100);
    const tint = Phaser.Display.Color.GetColor(c.r, c.g, c.b);
    for (const o of this.niebla) o.setTint(tint);
    const cm = this.cameras.main.midPoint;
    for (const n of this.nieblaNubes) {
      const { o, l } = n, ca = Math.cos(l.a), sa = Math.sin(l.a);
      const off = Math.round(Math.max(0, Math.min(l.len - o.width, (cm.x - l.x) * ca + (cm.y - l.y) * sa - o.width / 2)));
      o.setPosition(l.x + ca * off, l.y + sa * off);
      o.tilePositionX = this.nieblaT * n.vel + n.base + off;
    }
    // al toparte con la neblina, un aviso de vez en cuando
    this.nieblaAviso -= dt;
    if (this.nieblaAviso <= 0 && enNiebla(f.x, f.y, NIEBLA + 4 * M)) {
      this.nieblaAviso = 25;
      toast('🌫️ Pura neblina', pick(['No se ve nada más allá. Mejor da la vuelta.', 'Se cerró la neblina de la costa. Por aquí ya no se puede.', 'Ni los faros sirven con esta neblina. Regrésate a la ciudad.']), 3.5);
    }
    // al llegar al bordo de la frontera: sin visa no se pasa
    this.bordoAviso -= dt;
    if (this.bordoAviso <= 0 && f.y < borderY(f.x) + 10 * M) {
      this.bordoAviso = 25;
      toast('🛂 Sin visa no hay pase', pick(['Del otro lado es Estados Unidos y no traes visa. Ni modo, a seguir disfrutando Tijuana.',
        'Para cruzar se necesita visa y hacer la fila en la garita. Aquí no hay atajos.',
        '¿Visa? ¿Cuál visa? Primero la cita en el consulado; por mientras, quédate de este lado.']), 3.5);
    }
  }

  // ----- Tijuana de noche (premio por conocer todos los lugares) -----
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
      for (let cx = c0; cx <= c1; cx++) for (let cy = r0; cy <= r1; cy++) for (const o of FAROLES.get(GK(cx, cy)) || []) { cut('luz', o.x, o.y, 38); glow(o.x, o.y, 22, 0xffb347, 0.28); }
      // lugares, taquerias y cafes
      for (const l of landmarks) { cut('luz', l.x, l.y, 75); glow(l.x, l.y, 45, 0xffe08a, 0.25); }
      for (const t of tacos) cut('luz', t.x, t.y, 30);
      for (const c of cafes) cut('luz', c.x, c.y, 26);
      // vehiculos: haz de los faros, calaveras rojas y la torreta de las patrullas
      const lights = (c) => {
        const fx = Math.cos(c.a), fy = Math.sin(c.a);
        cut('cono', c.x + fx * c.hl, c.y + fy * c.hl, c.dosRuedas ? 70 : 95, c.a);
        glow(c.x - fx * c.hl, c.y - fy * c.hl, c.dosRuedas ? 6 : 9, 0xff2020, 0.55);
        if (c.poli) glow(c.x, c.y, 16, Math.floor(time / 220) % 2 ? 0xff1a1a : 0x2a5bff, 0.75);
        if (c.escolta) glow(c.x, c.y, 15, Math.floor(time / 170) % 2 ? 0xffb300 : 0xffffff, 0.7);
      };
      for (const c of this.cars) if (!c.wrecked) lights(c);
      for (const L of this.blastLights) { cut('luz', L.x, L.y, L.r * L.a + 10); glow(L.x, L.y, L.r * 0.8, 0xff9a3a, 0.8 * L.a); } // explosiones
      for (const c of this.burning) if (c.burn > 0) { const r = 26 * (c.burnK || 1) * (0.9 + 0.1 * Math.sin(time / 70 + c.x)); cut('luz', c.x, c.y, r * 1.6); glow(c.x, c.y, r, 0xff7a1a, 0.45); }
      for (const q of this.fuegos) { cut('luz', q.x, q.y, 28); glow(q.x, q.y, 16, 0xff7a1a, 0.4); }
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
      toast('🏆 ¡Ya eres tijuanense!', 'Completaste todo. Aquí cerca te espera un burro cebra dorado y... ¡hay fiesta en la Plaza Santa Cecilia! Sigue la flecha.', 8);
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
      toast('★ ' + l.name, l.desc + '  (+$100)' + (n === landmarks.length ? ' ¡Ya conoces todos los lugares!' : ''), 5);
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
      t.eaten = true; state.money += 25; save(); updateStats(); this.quitarPin(t);
      if (this.inCar) this.inCar.hp = Math.min(this.inCar.maxHp, this.inCar.hp + 30);
      toast('🌮 ' + t.name, pick(['¡Qué buenos de asada!', 'Birria con consomé, uff.', 'Al pastor con piña.', 'Unos de adobada, de rigor.']) + '  (+$25)', 3);
    }
    for (const c of cafes) {
      if (c.drunk || dist(c.x, c.y, f.x, f.y) > 40 || sp > 70) continue;
      c.drunk = true; state.money += 20; save(); updateStats(); this.quitarPin(c);
      toast('☕ ' + c.name, pick(FRASES_CAFE) + '  (+$20)', 3);
    }
    this.checkPerks();
    for (const e of EGGS) {
      const now = this.time.now;
      if (e.fija && e.persona && !this.bubble.ped && now > (e.dicT || 0) && dist(e.persona.x, e.persona.y, f.x, f.y) < 220) {
        // los que se quedan: de vez en cuando dicen algo (el señor del canal, las mascotas de las escuelas)
        e.dicT = now + rnd(14000, 22000);
        this.globo(e.persona, e.k, pick(FRASES_FIJAS[e.k]), 3.5);
      }
      if (e.got || dist(e.x, e.y, f.x, f.y) > (e.r || 45) || sp > 90) continue;
      e.got = true; state.money += e.pay; save(); bigSound = true; updateStats();
      const n = EGGS.filter(q => q.got).length;
      toast('🥚 ' + e.name + ' (+$' + e.pay + ')', e.say + (n === EGGS.length ? '  ¡Encontraste todos los secretos de Tijuana!' : '  Secreto ' + n + ' de ' + EGGS.length + '.'), Math.max(6, e.say.length / 22));
      if (!e.fija) this.tweens.add({ targets: e.icon, alpha: 0, scale: 1.2, duration: 900, delay: 1500, onComplete: () => e.icon.setVisible(false) });
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
    this.checkYonke(dt, f, sp);
    this.checkParos(dt, f, sp);
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
  // el yonke: el porton queda en la banqueta y el terreno se mete hacia la cuadra
  ponerYonke(Y, sx, sy, rot) {
    Y.x = sx; Y.y = sy; Y.puesto = true;
    const bx = -Math.sin(rot), by = Math.cos(rot);
    Y.icon = this.add.image(sx - bx * 44, sy - by * 44, 'yonke' + (Math.cos(rot) < -0.3 ? 'u' : '')).setScale(1 / SPR).setRotation(rot).setDepth(6);
    const hh = Math.abs(Math.cos(rot)) * 52 + Math.abs(Math.sin(rot)) * 75;
    Y.label = this.add.text(Y.icon.x, Y.icon.y - hh - 8, '🔧 ' + Y.name, { fontSize: '13px', fontStyle: 'bold', color: '#ffd54f', stroke: '#000', strokeThickness: 3, resolution: TXT_RES }).setOrigin(0.5).setDepth(19);
  }
  // los demas yonkes se ponen cuando te acercas y ya estan los edificios de alrededor: en la primera calle candidata
  // donde el corralon (unos 100 x 70 px hacia adentro de la cuadra) no cae encima de una casa, del agua ni de otra calle
  ponerYonkes(f) {
    if ((this.yonkesT = (this.yonkesT || 0) - 1) > 0) return;
    this.yonkesT = 60; // (una vez por segundo)
    for (const Y of YONKES) {
      if (Y.puesto || dist(Y.x, Y.y, f.x, f.y) > 2500 || !regionesListas(Y.x - 900, Y.y - 900, Y.x + 900, Y.y + 900)) continue;
      const tmp = {};
      let ok = null;
      for (const e of Y.cands) for (const lado of [1, -1]) {
        if (ok) break;
        edgePos(e, e.len / 2, 1, lado * (e.w / 2 + 1.5 * M), tmp);
        const [sx, sy, rot] = sidewalkSpot(tmp.x, tmp.y, (SIDEWALK + 0.5) * M + 2), bx = -Math.sin(rot), by = Math.cos(rot), ux = Math.cos(rot), uy = Math.sin(rot);
        let libre = true;
        for (let dd = 18; dd <= 78 && libre; dd += 12) for (let aa = -46; aa <= 46 && libre; aa += 15) {
          const x = sx - bx * dd + ux * aa, y = sy - by * dd + uy * aa;
          if (inBuilding(x, y) || onRoad(x, y) || inWater(x, y)) libre = false;
        }
        if (libre) ok = [sx, sy, rot];
      }
      if (ok) this.ponerYonke(Y, ...ok);
      else { // ni modo: en la primera, aunque se encime
        const e = Y.cands[0]; edgePos(e, e.len / 2, 1, e.w / 2 + 1.5 * M, tmp); this.ponerYonke(Y, ...sidewalkSpot(tmp.x, tmp.y, (SIDEWALK + 0.5) * M + 2));
      }
    }
  }
  // ----- los yonkes: entras con un carro robado y te lo compran -----
  checkYonke(dt, f, sp) {
    this.ponerYonkes(f);
    for (const Y of YONKES) { Y.cool -= dt; Y.msgT -= dt; }
    const Y = YONKES.find(q => q.puesto && dist(q.x, q.y, f.x, f.y) <= 50), car = this.inCar;
    if (!Y || !car || sp > 45) return;
    const base = YONKE_PRECIO[car.T.name] * Y.k;
    if (!base || !VTYPES.includes(car.T)) { // taxi, moto, troca de tacos, burro: esos no se venden
      if (Y.msgT <= 0) { Y.msgT = 8; toast('🔧 ' + Y.name, '"¿' + (car.moto ? 'La moto del repartidor' : 'Eso') + '? No, compa, eso no lo compro. Tráeme un carro."', 3); }
      return;
    }
    if (Y.cool > 0) {
      if (Y.msgT <= 0) { Y.msgT = 8; toast('🔧 ' + Y.name, '"Todavía ando desarmando el otro. Vuelve en ' + Math.ceil(Y.cool) + ' segundos."', 3); }
      return;
    }
    // el precio baja con lo madreado: sin vida vale una quinta parte
    const pay = Math.max(20, Math.round(base * (0.2 + 0.8 * Math.max(0, car.hp) / (car.T.hp)) / 10) * 10);
    Y.cool = 45; state.money += pay; state.vendidos = (state.vendidos || 0) + 1; save(); bigSound = true; updateStats();
    const frase = car.T.name === 'Bólido italiano' ? '"¡¿Un italiano?! No preguntes de dónde saqué tanto billete."'
      : car.hp < car.T.hp * 0.45 ? pick(['"Puro fierro viejo, pero algo se le saca."', '"Este ya no arranca ni empujado. Te doy lo que vale la chatarra."', '"¿Lo trajiste o lo arrastraste?"'])
      : pick(['"Está bonito. Nadie va a preguntar, ¿verdad?"', '"Las placas ni las quiero ver."', '"Ese en dos horas ya es refacción."', '"Buen ojo, compa. Tráeme más de esos."']);
    toast('🔧 ' + Y.name + ' (+$' + pay + ')', frase + '  ' + car.T.name + ' vendido.', 4.5);
    // te bajas en la banqueta, junto al porton, y el carro se queda adentro
    car.sprite.destroy(); if (car.scorch) car.scorch.destroy();
    this.inCar = null;
    this.player.x = Y.x; this.player.y = Y.y;
    this.player.sprite.setVisible(true).setPosition(Y.x, Y.y);
    this.cameras.main.startFollow(this.player.sprite, true, 0.15, 0.15);
    this.setObjective();
  }
  startDelivery() {
    if (this.delivery) { toast(pick(FRASES_MOTO), 'Ya traes un pedido pendiente, ¡apúrale!', 3); return; }
    const f = this.inCar || this.player;
    let spot = null, mid = null;
    for (let i = 0; i < 40 && !spot; i++) {
      const e = randomEdgeNear(walkG, f.x, f.y, 700, 1600); if (!e || e.c > 6) continue;
      const s = rnd(0, e.len), q = edgePos(e, s, 1, e.w / 2 + 1.5 * M, {});
      if (!blocked(q.x, q.y) && !enNiebla(q.x, q.y, NIEBLA_LEJOS)) { spot = q; mid = edgePos(e, s, 1, 0, {}); }
    }
    if (!spot) return;
    const d = dist(spot.x, spot.y, f.x, f.y), street = streetAt(spot.x, spot.y) || 'una calle de Tijuana';
    let order = pick(PEDIDOS);
    const dog = order === PERRO_PEDIDO || Math.random() < 0.15, raro = !dog && Math.random() < 0.3 ? pick(CLIENTES_RAROS) : null;
    if (raro) order = pick(raro.pedidos);
    // quien recibe espera en la banqueta viendo hacia la calle
    const face = Math.atan2(mid.y - spot.y, mid.x - spot.x);
    let who;
    if (dog) {
      who = this.add.sprite(spot.x, spot.y, 'perro', 0).setDepth(6).setScale(1 / SPR).setRotation(face).play('cola');
    } else if (raro) { // (los dibujos ven hacia abajo, +y)
      who = this.add.image(spot.x, spot.y, 'egg_' + raro.k).setDepth(6).setScale(0.2).setRotation(face - Math.PI / 2);
      this.tweens.add({ targets: who, angle: who.angle + 6, duration: 600, yoyo: true, repeat: -1, ease: 'Sine.inOut' });
    } else {
      who = this.add.sprite(spot.x, spot.y, 'ped' + pedVariant(), 0).setDepth(6).setScale(1 / SPR).setRotation(face);
      this.tweens.add({ targets: who, angle: who.angle + 8, duration: 700, yoyo: true, repeat: -1, ease: 'Sine.inOut' });
    }
    this.delivery = { x: spot.x, y: spot.y, street, order, time: d / 85 + 20, d, dog, raro, who };
    toast(pick(FRASES_MOTO), 'Pedido: ' + this.delivery.order + '. Llévalo a ' + street + (raro ? '. Lo recibe ' + raro.quien : '') + '.', 4.5);
    this.setObjective();
  }
  endDelivery(ok) {
    const dl = this.delivery; this.delivery = null; hud.timer.style.display = 'none';
    if (ok) {
      const pay = Math.round(50 + dl.d / 10 + dl.time * 2), tip = Math.random() < 0.5 ? Math.round(rnd(5, 60)) : 0;
      state.deliveries++;
      state.money += pay + tip; save(); updateStats();
      const msg = dl.raro ? pick(dl.raro.dice) : dl.order === PERRO_PEDIDO ? CLIENTES_PERRO_BIRRIA : pick(dl.dog ? CLIENTES_PERRO : CLIENTES);
      toast('¡Pedido entregado!', msg + ' (+$' + pay + (tip ? ' y $' + tip + ' de propina' : '') + ')', dl.raro ? 6 : 4.5);
    } else toast('Pedido cancelado', dl.raro ? dl.raro.mal : pick(CANCELADOS), dl.raro ? 5 : 4);
    // el que recibio da un saltito de gusto y se mete; si se cancelo, nomas se mete
    const w = dl.who; this.tweens.killTweensOf(w);
    if (ok) this.tweens.add({ targets: w, scale: w.scale * 1.4, duration: 160, yoyo: true, repeat: 1 });
    this.tweens.add({ targets: w, alpha: 0, delay: ok ? 1200 : 0, duration: 600, onComplete: () => w.destroy() });
    this.setObjective();
  }
  startTaxi() {
    if (!this.inCar) { toast('Necesitas un auto', 'Roba uno con E y luego presiona T.'); return; }
    if (this.inCar.bici) { toast('En ' + (this.inCar.bici === 'patineta' ? 'patineta' : 'bici') + ' no caben pasajeros', 'Bueno, en los diablitos de atrás sí, pero no. Roba un auto para hacer taxi.'); return; }
    if (this.inCar.dosRuedas) { toast('En moto no caben pasajeros', 'A menos que sea tu compadre. Roba un auto para hacer taxi.'); return; }
    if (this.taxi) { this.endTaxi(false, 'Dejaste de trabajar de taxista.'); return; }
    if (this.inCar.hp <= 0) return;
    const f = this.inCar;
    let spot = null;
    for (let i = 0; i < 30 && !spot; i++) {
      const e = randomEdgeNear(walkG, f.x, f.y, 250, 650); if (!e || e.c > 6) continue;
      const q = edgePos(e, rnd(0, e.len), 1, e.w / 2 + 1.5 * M, {});
      if (!blocked(q.x, q.y) && !enNiebla(q.x, q.y, NIEBLA_LEJOS)) spot = q;
    }
    if (!spot) { toast('No hay pasaje por aquí', 'Intenta en otra calle.'); return; }
    const ped = this.add.sprite(spot.x, spot.y, 'ped0', 0).setDepth(6).setScale(1 / SPR);
    this.taxi = { phase: 'pick', x: spot.x, y: spot.y, ped };
    toast('Taxi libre', 'Recoge al pasajero: sigue la flecha.', 2.5);
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
    else if (this.paro) t = '🤝 Paro: lleva ' + this.paro.de.cosa + ' ' + aDonde(this.paro.de.a);
    else if (this.waypoint && this.waypoint.fiesta) t = '🎉 Ve a la fiesta en la Plaza Santa Cecilia';
    else if (this.waypoint) t = '📍 Sigue la flecha a tu destino';
    hud.obj.textContent = t; // vacio = no se muestra (las instrucciones estan en Opciones)
    $('bE').textContent = this.inCar ? 'BAJAR' : this.coy ? 'PAGAR' : this.paroOfer ? 'ACEPTAR' : 'SUBIR'; // el boton tactil dice lo que va a hacer
  }
  goal() {
    if (this.taxi) return this.taxi;
    if (this.delivery) return this.delivery;
    if (this.paro) return this.paro;
    if (this.waypoint) return this.waypoint;
    return null;
  }

  // camino al objetivo por las calles: ya no se pinta en el juego (lo guia la flecha), pero el mapa grande lo dibuja
  updateRoute(time, dt, f) {
    const g = this.goal();
    if (!g || dist(g.x, g.y, f.x, f.y) < 40) { this.route = null; return; }
    // se recalcula seguido (te sales del camino, el pasajero ya subio...) pero no en cada cuadro
    this.routeT -= dt;
    if (this.routeT <= 0 || !this.route || this.routeGoal !== g || this.routeGX !== g.x || this.routeGY !== g.y) {
      this.routeT = 0.5; this.routeGoal = g; this.routeGX = g.x; this.routeGY = g.y;
      this.route = findRoute(f.x, f.y, g.x, g.y);
    }
  }


  // las taquerias y cafes que te faltan se notan desde lejos: una luz que late en el piso, un pin flotando con
  // su emoji (y su sombra) y el nombre en una etiqueta de color. Ya visitados quedan solo el puesto, mas apagado
  adornosComida(o, C) {
    o.ph = Math.random() * 6.283;
    o.glow = this.add.image(o.x, o.y, 'luz').setDepth(3).setTint(C.luz).setBlendMode(Phaser.BlendModes.ADD).setScale(0.6).setVisible(false);
    o.sombraPin = this.add.image(o.x, o.y - 6, 'aroSombra').setDepth(6.6).setScale(0.45).setVisible(false);
    o.pin = this.add.image(o.x, o.y - 8, C.pin).setOrigin(0.5, 1).setDepth(19.5).setScale(1 / SPR).setVisible(false);
    o.label = this.add.text(o.x, o.y - 40, o.name, { fontFamily: 'system-ui, "Noto Sans", sans-serif', fontSize: '12px', fontStyle: 'bold', color: '#fff',
      backgroundColor: C.fondo, padding: { x: 5, y: 2 }, resolution: TXT_RES }).setOrigin(0.5, 1).setDepth(19).setVisible(false);
  }
  moverAdornos(o, hecho, f, time) {
    const d = dist(o.x, o.y, f.x, f.y), ver = !hecho && d < 900;
    o.icon.setAlpha(hecho ? 0.7 : 1);
    o.label.setVisible(!hecho && d < 420);
    o.glow.setVisible(ver); o.sombraPin.setVisible(ver);
    if (!o.pop) o.pin.setVisible(ver);
    if (!ver) return;
    const b = Math.sin(time / 320 + o.ph); // el pin sube y baja; su sombra se achica cuando sube
    if (!o.pop) o.pin.y = o.y - 17 - (b + 1) * 2.5;
    o.sombraPin.setScale(0.45 - (b + 1) * 0.05).setAlpha(0.8 - (b + 1) * 0.15);
    o.glow.setAlpha(0.32 + 0.14 * Math.sin(time / 520 + o.ph)).setScale(0.55 + 0.05 * Math.sin(time / 520 + o.ph));
    o.label.y = o.y - 46 - (b + 1) * 2.5;
  }
  // al visitarlo, el pin se infla y se desvanece hacia arriba
  quitarPin(o) {
    if (!o.pin) return;
    o.pop = true;
    this.tweens.add({ targets: o.pin, y: o.pin.y - 14, scale: 1.8 / SPR, alpha: 0, duration: 650, ease: 'Back.out',
      onComplete: () => { o.pop = false; o.pin.setVisible(false).setAlpha(1).setScale(1 / SPR); } });
  }
  // un aro (ver makeAros): luz en el piso, el aro, las rayitas que giran y una onda que sale cada tanto
  // con pin: ademas un pin que flota en medio (para los destinos, que no traen insignia)
  crearAro(color, depth, conPin) {
    const a = { partes: ['aroLuz', 'aroBase', 'aroGiro', 'aroOnda'].map((k, i) => this.add.image(0, 0, k).setDepth(depth + i * 0.01).setTint(color)), color, fase: Math.random() * 1000 };
    if (conPin) { a.sombra = this.add.image(0, 0, 'aroSombra').setDepth(depth + 0.05); a.pin = this.add.image(0, 0, 'aroPin').setDepth(20).setTint(color).setOrigin(0.5, 0.7); }
    return a;
  }
  // d = diametro en px del mundo
  moverAro(a, x, y, d, time, visible, color) {
    for (const o of a.partes) o.setVisible(visible);
    if (a.pin) { a.pin.setVisible(visible); a.sombra.setVisible(visible); }
    if (!visible) return;
    if (color !== undefined && color !== a.color) { a.color = color; for (const o of a.partes) o.setTint(color); if (a.pin) a.pin.setTint(color); }
    const [luz, base, giro, onda] = a.partes, t = time + a.fase, k = d / ARO / SPR;
    const late = 1 + Math.sin(t / 260) * 0.05, ola = (t % 1400) / 1400;
    for (const o of a.partes) o.setPosition(x, y);
    luz.setScale(k * late).setAlpha(0.9);
    base.setScale(k * late * 0.92);
    giro.setScale(k).setRotation(t / 1800);
    onda.setScale(k * (0.85 + ola * 0.5)).setAlpha((1 - ola) * 0.8);
    if (a.pin) {
      // el pin sube y baja; la sombra se achica cuando sube
      const alto = (Math.sin(t / 300) + 1) / 2, kp = Math.max(0.55, d / 115) / SPR;
      a.pin.setPosition(x, y - 6 - alto * 8).setScale(kp);
      a.sombra.setPosition(x, y + 2).setScale(kp * (1.1 - alto * 0.3)).setAlpha(0.9 - alto * 0.3);
    }
  }

  updateMarkers(time, f) {
    for (const m of this.marks) {
      if (m.label.x !== m.l.x || m.label.y !== m.l.y - 34) { // lo acababan de acomodar en su banqueta
        this.tweens.killTweensOf(m.star); m.star.setPosition(m.l.x, m.l.y); m.label.setPosition(m.l.x, m.l.y - 34);
        this.tweens.add({ targets: m.star, y: m.l.y - 3, duration: 1000, yoyo: true, repeat: -1, ease: 'Sine.inOut' });
      }
      const near = dist(m.l.x, m.l.y, f.x, f.y) < 700;
      this.moverAro(m.ring, m.l.x, m.l.y, 165, time, !m.l.found && dist(m.l.x, m.l.y, f.x, f.y) < 1600);
      if (m.found !== m.l.found) { m.found = m.l.found; if (m.l.found) m.star.setTint(0x9a9a9a).setAlpha(0.85); else m.star.clearTint().setAlpha(1); }
      m.label.setVisible(near);
    }
    for (const t of tacos) this.moverAdornos(t, t.eaten, f, time);
    for (const c of cafes) this.moverAdornos(c, c.drunk, f, time);
    for (const c of chinas) c.label.setVisible(dist(c.x, c.y, f.x, f.y) < 300);
    for (const Y of YONKES) if (Y.label) Y.label.setVisible(dist(Y.x, Y.y, f.x, f.y) < 400);
    const g = this.goal();
    // verde el destino; ambar donde recoges al pasajero y morado el de los paros (como su globo)
    const pick = this.taxi && this.taxi.phase === 'pick';
    if (g) this.moverAro(this.target, g.x, g.y, pick ? 80 : 115, time, true, pick ? 0xffb300 : g === this.paro ? 0xb07cff : 0x57d16b);
    else this.moverAro(this.target, 0, 0, 0, time, false);
    if (this.waypoint && !this.waypoint.fiesta && dist(this.waypoint.x, this.waypoint.y, f.x, f.y) < 60) { this.waypoint = null; toast('Llegaste a tu destino', '', 1.5); }
  }

  updateHud(dt, f) {
    if (toastT > 0) { toastT -= dt; if (toastT <= 0) hud.toast.classList.remove('on'); }
    this.nameT -= dt;
    if (this.nameT <= 0) {
      this.nameT = 0.4;
      const n = streetAt(f.x, f.y);
      if (n && n !== lastStreet) { lastStreet = n; hud.street.innerHTML = ''; hud.street.textContent = n; const sm = document.createElement('small'); sm.textContent = (z => z === 'Tijuana' ? 'Tijuana, B.C.' : z + ' · Tijuana')(zonaDe(f.x, f.y)); hud.street.appendChild(sm); layoutTop(); hud.street.classList.add('on'); streetT = 3; }
    }
    if (streetT > 0) { streetT -= dt; if (streetT <= 0) hud.street.classList.remove('on'); }
    const tt = this.taxi && this.taxi.phase === 'drop' ? Math.ceil(this.taxi.time) + 's' : this.delivery ? '🛵 ' + Math.ceil(this.delivery.time) + 's' : this.paro ? '🤝 ' + Math.ceil(this.paro.time) + 's' : null;
    if (tt && tt !== this.lastTimer) { this.lastTimer = tt; if (hud.timer.style.display !== 'block') layoutTop(); hud.timer.style.display = 'block'; hud.timer.textContent = tt; }
    if (!tt) this.lastTimer = null;
    // flecha hacia el objetivo
    const g = this.goal(), cam = this.cameras.main;
    if (g && dist(g.x, g.y, f.x, f.y) > 160) {
      const a = Math.atan2(g.y - f.y, g.x - f.x), r = Math.max(70, Math.min(window.innerWidth, window.innerHeight) * 0.22); // gira alrededor del jugador (la camara lo sigue al centro)
      // la flecha gira hacia el destino; la distancia va debajo, derechita
      hud.arrow.style.display = 'block';
      hud.arrow.style.left = (window.innerWidth / 2 + Math.cos(a) * r - 22) + 'px';
      hud.arrow.style.top = (window.innerHeight / 2 + Math.sin(a) * r - 22) + 'px';
      hud.arrowRot.style.transform = 'rotate(' + (a + Math.PI / 2) + 'rad)';
      const m = dist(g.x, g.y, f.x, f.y) / M, txt = m >= 1000 ? (m / 1000).toFixed(1) + ' km' : Math.round(m / 10) * 10 + ' m';
      if (txt !== this.arrowTxt) { this.arrowTxt = txt; hud.arrowDist.textContent = txt; }
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
  for (const p of scene.paros || []) if (!p.hecho) { const [x, y] = P(p.x, p.y); c.fillStyle = '#b388ff'; c.strokeStyle = '#2e1065'; c.lineWidth = 1; c.beginPath(); c.arc(x, y, big ? 4.5 : 3, 0, 7); c.fill(); c.stroke(); }
  // los secretos que te faltan: un signo de interrogacion tenue (sin decir que es)
  c.font = 'bold ' + (big ? 13 : 10) + 'px sans-serif'; c.lineWidth = 2.5; c.strokeStyle = 'rgba(40,20,70,0.55)'; c.fillStyle = 'rgba(240,232,255,0.82)';
  for (const e of EGGS) if (!e.got) { const [x, y] = P(e.x, e.y); c.strokeText('?', x, y); c.fillText('?', x, y); }
  for (const Y of YONKES) { const [x, y] = P(Y.x, Y.y), r = big ? 5 : 3.5; c.fillStyle = '#fdd835'; c.strokeStyle = '#000'; c.lineWidth = 1.5; c.beginPath(); c.rect(x - r, y - r, r * 2, r * 2); c.fill(); c.stroke(); }
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
  pintarMini(c, ox, oy, W, H, MS);
  drawMarkers(c, MS, MS, ox, oy, scene, f, false);
}
// ---------- mapa grande: pantalla completa, se arrastra, se acerca y se marca el destino ----------
// La vista es un centro (cx, cy) en el mundo y una escala s (puntos de pantalla por pixel del mundo).
// De lejos se dibujan los cuadros del minimapa (o miniVista si son demasiados); de cerca se dibujan calles,
// edificios y nombres solo de lo que se ve. Mientras arrastras o pellizcas va la version rapida y al soltar se pinta el detalle.
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
  // los cuadros que faltan se pintan unos cuantos por cuadro de animacion, sin trabar el mapa
  const x0 = BM.cx - BM.W / 2 / s, y0 = BM.cy - BM.H / 2 / s, x1 = BM.cx + BM.W / 2 / s, y1 = BM.cy + BM.H / 2 / s;
  const enVista = (Math.floor(x1 / REG_PX) - Math.floor(x0 / REG_PX) + 1) * (Math.floor(y1 / REG_PX) - Math.floor(y0 / REG_PX) + 1);
  let falta = false;
  if (enVista <= MINI_MAX - 8) falta = !pintarMini(c, x0, y0, BM.W, BM.H, s, 4);
  else {
    c.drawImage(miniVista, bmX(0), bmY(0), WORLD_W * s, WORLD_H * s);
    const q = miniFaltan(); for (const [tx, ty] of q.slice(0, 4)) miniCuadro(tx, ty);
    falta = q.length > 4;
  }
  if (falta) BM.raf = requestAnimationFrame(() => renderBig(detail));
  // --- detalle de lo que se ve (al soltar y ya de cerca); los edificios se cargan si faltan ---
  if (detail && s >= BM_DETAIL) {
    regionesListas(x0, y0, x1, y1);
    const A = new Set(), B = new Set(), R = new Set();
    for (let cx = Math.floor(x0 / CHUNK); cx <= Math.floor(x1 / CHUNK); cx++) for (let cy = Math.floor(y0 / CHUNK); cy <= Math.floor(y1 / CHUNK); cy++) {
      const k = GK(cx, cy);
      (chunkAreas.get(k) || []).forEach(i => A.add(i)); (chunkBlds.get(k) || []).forEach(i => B.add(i)); (chunkRoads.get(k) || []).forEach(i => R.add(i));
    }
    c.save(); c.setTransform(BM.dpr * s, 0, 0, BM.dpr * s, BM.dpr * (BM.W / 2 - BM.cx * s), BM.dpr * (BM.H / 2 - BM.cy * s));
    c.fillStyle = '#6d6858'; c.fillRect(x0, y0, x1 - x0, y1 - y0);
    for (const i of A) { const a = areas[i]; c.fillStyle = AREA_COL[a.k]; trace(c, a.p, true); c.fill(); }
    c.fillStyle = '#9a917e'; c.strokeStyle = 'rgba(0,0,0,0.25)'; c.lineWidth = 1 / s;
    for (const b of B) { trace(c, b.p, true); c.fill(); if (s > 0.45) c.stroke(); }
    c.lineCap = 'round'; c.lineJoin = 'round';
    const rs = [...R].map(i => roads[i]).sort((a, b) => b.c - a.c); // las grandes encima
    for (const r of rs) {
      if (r.c > 9) { if (esRio(r)) { c.strokeStyle = COL.water; c.lineWidth = ROAD_W[11] * M; trace(c, r.p); c.stroke(); } continue; }
      c.strokeStyle = r.c <= 2 ? '#f2d16b' : r.c <= 6 ? '#2e2e33' : r.c === 7 ? '#55555a' : '#c8bda4';
      c.lineWidth = Math.max(r.w * M, (r.c <= 2 ? 5 : r.c <= 6 ? 3.5 : 2) / s); trace(c, r.p); c.stroke();
    }
    c.fillStyle = 'rgba(30,36,30,0.85)';
    { const f = fronteraPts(x0, x1); c.beginPath(); c.moveTo(x0, y0 - 1); c.lineTo(x1, y0 - 1); for (let i = f.length - 2; i >= 0; i -= 2) c.lineTo(f[i], f[i + 1]); c.closePath(); c.fill(); }
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
  for (const YK of YONKES) { const X = bmX(YK.x), Y = bmY(YK.y); if (on(X, Y)) { if (icons) { c.font = '17px sans-serif'; c.fillText('🔧', X, Y); c.font = 'bold 11px sans-serif'; c.lineWidth = 3; c.strokeStyle = '#000'; c.strokeText('Yonke', X, Y + 14); c.fillStyle = '#fdd835'; c.fillText('Yonke', X, Y + 14); }
    else { c.fillStyle = '#fdd835'; c.strokeStyle = '#000'; c.lineWidth = 1; c.fillRect(X - 3.5, Y - 3.5, 7, 7); c.strokeRect(X - 3.5, Y - 3.5, 7, 7); } } }
  // los secretos que te faltan: un signo de interrogacion tenue
  c.font = 'bold ' + (icons ? 15 : 10) + 'px sans-serif'; c.lineWidth = 3; c.strokeStyle = 'rgba(40,20,70,0.55)'; c.fillStyle = 'rgba(240,232,255,0.82)';
  for (const e of EGGS) { if (e.got) continue; const X = bmX(e.x), Y = bmY(e.y); if (on(X, Y)) { c.strokeText('?', X, Y); c.fillText('?', X, Y); } }
  for (const p of bigScene.paros || []) { const X = bmX(p.x), Y = bmY(p.y); if (on(X, Y)) { if (icons) emoji('🤝', X, Y, p.hecho); else if (!p.hecho) { c.fillStyle = '#b388ff'; c.beginPath(); c.arc(X, Y, 3.5, 0, 7); c.fill(); } } }
  for (const t of tacos) { const X = bmX(t.x), Y = bmY(t.y); if (on(X, Y)) { if (icons) emoji('🌮', X, Y, t.eaten); else if (!t.eaten) { c.fillStyle = '#ff9f1c'; c.beginPath(); c.arc(X, Y, 3, 0, 7); c.fill(); } } }
  for (const k of cafes) { const X = bmX(k.x), Y = bmY(k.y); if (on(X, Y)) { if (icons) emoji('☕', X, Y, k.drunk); else if (!k.drunk) { c.fillStyle = '#a0662f'; c.beginPath(); c.arc(X, Y, 3, 0, 7); c.fill(); } } }
  const lsz = icons ? 30 : 20;
  for (const l of landmarks) {
    const X = bmX(l.x), Y = bmY(l.y); if (!on(X, Y)) continue;
    const img = bigScene.textures.exists(l.icon) && bigScene.textures.get(l.icon).getSourceImage();
    c.save(); if (l.found) { c.globalAlpha = 0.6; c.filter = 'grayscale(1)'; }
    if (img) c.drawImage(img, X - lsz / 2, Y - lsz / 2, lsz, lsz); else { c.font = '18px sans-serif'; c.fillStyle = '#ffd23f'; c.fillText('★', X, Y); }
    c.restore();
    if (s >= 0.12) { c.font = 'italic bold 12px "Trebuchet MS", sans-serif'; c.lineWidth = 3; c.strokeStyle = '#000'; c.strokeText(l.name, X, Y + lsz / 2 + 9); c.fillStyle = l.found ? '#bbb' : '#ffe680'; c.fillText(l.name, X, Y + lsz / 2 + 9); }
  }
  // --- destino y tu posicion ---
  if (g) { const X = bmX(g.x), Y = bmY(g.y); c.fillStyle = '#57d16b'; c.strokeStyle = '#000'; c.lineWidth = 2; c.beginPath(); c.arc(X, Y, 8, 0, 7); c.fill(); c.stroke(); c.fillStyle = '#fff'; c.beginPath(); c.arc(X, Y, 3, 0, 7); c.fill(); }
  const PX = bmX(f.x), PY = bmY(f.y);
  c.fillStyle = 'rgba(255,122,60,0.3)'; c.strokeStyle = 'rgba(255,122,60,0.9)'; c.lineWidth = 2; c.beginPath(); c.arc(PX, PY, 17, 0, 7); c.fill(); c.stroke();
  c.save(); c.translate(PX, PY); c.rotate(f.a); c.fillStyle = '#ffd23f'; c.strokeStyle = '#000'; c.lineWidth = 2;
  c.beginPath(); c.moveTo(13, 0); c.lineTo(-8, 8); c.lineTo(-3, 0); c.lineTo(-8, -8); c.closePath(); c.fill(); c.stroke(); c.restore();
  // leyenda con lo que llevas
  const n = (a, k) => a.filter(o => o[k]).length;
  const ley = `<span class="t">Mapa</span><span>★ <b>${n(landmarks, 'found')}</b>/${landmarks.length}</span><span>🌮 <b>${n(tacos, 'eaten')}</b>/${tacos.length}</span>` +
    `<span>☕ <b>${n(cafes, 'drunk')}</b>/${cafes.length}</span><span class="clave">➤ tú · 🤝 paros · 🔧 yonke · 🏮 cuidado · ? secreto</span>`;
  if (BM.ley !== ley) $('mlegend').innerHTML = BM.ley = ley;
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
        scene.setObjective(); toast('Destino marcado', 'Sigue la flecha. Cierra el mapa con ✕ o M.', 2.5); bmDraw(true);
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
  txt('TIJUANA, BAJA CALIFORNIA', 300, 'bold 26px sans-serif', '#7a5a2a');
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

// la noche se prende y apaga en Opciones o con la tecla L (solo si ya conoces todos los lugares)
function toggleNight() {
  if (!perks().noche) return;
  state.night = !state.night; save(); renderOptions();
}
function toggleSound() { if (window.SND) SND.toggle(); renderOptions(); }
// los premios se muestran en Opciones; se llama al ganarlos
function showPerkButtons() { renderOptions(); }

// ---------- menu de opciones: tu avance, ajustes y controles ----------
let optsOpen = false;
// Mi avance (en el telefono): el total, tus numeros y cada coleccion con su barra y su premio; al tocarla se abre lo
// que llevas por zona (de los secretos y los paros, solo los que ya hiciste: los demas son "???")
function renderAvance(p) {
  const n = (a, k) => a.filter(o => o[k]).length, paros = (state.paros || []).length;
  const cols = [
    { ico: '★', name: 'Lugares', a: landmarks, k: 'found', premio: 'Tijuana de noche', ok: p.noche, zonas: true, nombres: true },
    { ico: '🌮', name: 'Tacos', a: tacos, k: 'eaten', premio: 'las taquerías te reparan el carro y una troca de tacos', ok: p.taco, zonas: true },
    { ico: '☕', name: 'Cafés', a: cafes, k: 'drunk', premio: 'correr sin cansarte', ok: p.cafe, zonas: true },
    { ico: '🥚', name: 'Secretos', a: EGGS, k: 'got', premio: '', secretos: true },
    { ico: '🤝', name: 'Paros', v: paros, tot: PAROS.length, premio: '' },
  ];
  let tv = 0, tt = 0;
  for (const c of cols) { c.v = c.v ?? n(c.a, c.k); c.tot = c.tot ?? c.a.length; tv += c.v; tt += c.tot; }
  const pct = Math.floor(tv / tt * 100), box = $('optprog'); box.innerHTML = '';
  const el = (tag, cls, txt) => { const e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; };
  // el total con su anillo
  const top = el('div', 'av-top'), ring = el('div', 'av-anillo');
  ring.style.setProperty('--p', pct); ring.appendChild(el('b', null, pct + '%')); ring.appendChild(el('small', null, 'de Tijuana'));
  const meta = el('div', 'av-meta');
  meta.appendChild(el('b', null, p.final ? '🏆 ¡Completaste todo!' : 'Tu meta'));
  meta.appendChild(el('span', null, p.final ? 'Ya eres tijuanense de corazón. Tu Acta te espera.' : 'Conoce todos los lugares y prueba todos los tacos y cafés: burro cebra dorado, fiesta y Acta.'));
  top.appendChild(ring); top.appendChild(meta); box.appendChild(top);
  // tus numeros
  const grid = el('div', 'av-grid');
  for (const [i, v, t] of [['💵', '$' + state.money.toLocaleString('es-MX'), 'en la cartera'], ['📦', state.deliveries, 'entregas'], ['🚕', state.rides, 'viajes de taxi'],
    ['🔧', state.vendidos || 0, 'carros vendidos'], ['🤝', paros, 'paros hechos'], ['🥚', n(EGGS, 'got'), 'secretos']]) {
    const d = el('div', 'av-num'); d.appendChild(el('i', null, i)); d.appendChild(el('b', null, String(v))); d.appendChild(el('small', null, t)); grid.appendChild(d);
  }
  box.appendChild(grid);
  // las colecciones
  box.appendChild(el('h4', null, 'Colecciones'));
  for (const c of cols) {
    const det = el('details', 'av-col' + (c.v >= c.tot ? ' done' : '')), sum = el('summary');
    sum.innerHTML = '<span class="ico"></span><span class="txt"><b></b><span class="bar"><i></i></span><small></small></span><span class="cnt"></span>';
    sum.querySelector('.ico').textContent = c.ico; sum.querySelector('b').textContent = c.name;
    sum.querySelector('i').style.width = (c.v / c.tot * 100) + '%'; sum.querySelector('.cnt').textContent = c.v + '/' + c.tot;
    sum.querySelector('small').textContent = c.premio ? (c.ok ? '✓ Premio: ' : 'Premio: ') + c.premio : c.secretos ? 'Búscalos en los "?" del mapa' : 'Favores para la gente de las colonias';
    det.appendChild(sum);
    const body = el('div', 'av-det');
    if (c.zonas) {
      // por zona: cuantos llevas y, de los lugares, cuales
      const z = new Map();
      for (const o of c.a) { const k = zonaDe(o.x, o.y); if (!z.has(k)) z.set(k, []); z.get(k).push(o); }
      for (const [zona, l] of [...z.entries()].sort((a, b) => a[0].localeCompare(b[0], 'es'))) {
        const v = l.filter(o => o[c.k]).length, row = el('div', 'av-zona' + (v === l.length ? ' done' : ''));
        row.appendChild(el('span', null, zona)); row.appendChild(el('b', null, v + '/' + l.length)); body.appendChild(row);
        if (c.nombres) { const ul = el('div', 'av-nombres'); for (const o of l) ul.appendChild(el('span', o[c.k] ? 'si' : 'no', (o[c.k] ? '✓ ' : '') + o.name)); body.appendChild(ul); }
      }
    } else if (c.secretos) {
      const ul = el('div', 'av-nombres'); for (const e of EGGS) ul.appendChild(el('span', e.got ? 'si' : 'no', e.got ? e.name : '???')); body.appendChild(ul);
    } else {
      const ul = el('div', 'av-nombres'); for (const q of PAROS) { const h = (state.paros || []).includes(q.k); ul.appendChild(el('span', h ? 'si' : 'no', h ? q.ico + ' ' + q.quien : '???')); } body.appendChild(ul);
    }
    det.appendChild(body); box.appendChild(det);
  }
}
function renderOptions() {
  const p = perks();
  renderAvance(p);
  const muted = window.SND && SND.muted, key = (k) => document.body.classList.contains('touch') ? '' : '  (' + k + ')'; // teclas solo en PC
  // interruptores: prendido o apagado, con su notita (y la tecla, en la PC)
  const sw = (id, on, nota) => { const e = $(id); e.classList.toggle('on', on); e.querySelector('small').textContent = nota; };
  sw('optsnd', !muted, (muted ? 'Apagado' : 'Prendido') + key('N'));
  $('optnight').disabled = !p.noche;
  sw('optnight', !!(p.noche && state.night), p.noche ? (state.night ? 'Prendida' : 'Apagada') + key('L') : '🔒 Conoce los ' + landmarks.length + ' lugares para ganarla');
  for (const r of document.querySelectorAll('[data-vol]')) { r.value = Math.round((window.SND ? SND.nivel(r.dataset.vol) : 1) * 100); r.disabled = muted; }
  for (const b of document.querySelectorAll('#optcal button')) b.classList.toggle('on', b.dataset.q === CALIDAD);
  for (const b of document.querySelectorAll('#optori button')) b.classList.toggle('on', b.dataset.o === orientacion);
  $('optfps').classList.toggle('on', verFps);
  $('optacta').disabled = !p.final;
  $('optacta').textContent = p.final ? '📜 Ver mi Acta de Tijuanense' : '🔒 Acta de Tijuanense · completa todo';
}
function toggleOptions() {
  const sc = window.TJGTA && TJGTA.scene.scenes[0];
  optsOpen = !optsOpen;
  $('opts').style.display = optsOpen ? 'flex' : 'none';
  if (optsOpen) { celPagina('home'); renderOptions(); if (window.SND && sc) SND.update(false, 0, 0); }
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
// orientacion de la pantalla: gira con el telefono, o fija horizontal o vertical (solo en la app;
// es un plugin propio, OrientacionPlugin.java, que tambien la aplica al abrir)
const ORI = (window.Capacitor && Capacitor.Plugins && Capacitor.Plugins.Orientacion) || null;
let orientacion = 'auto';
try { orientacion = localStorage.getItem('tjrush-orientacion') || 'auto'; } catch (e) { /* sin almacenamiento */ }
if (!ORI) $('optori').style.display = 'none';
for (const b of document.querySelectorAll('#optori button')) b.addEventListener('click', () => {
  orientacion = b.dataset.o;
  try { localStorage.setItem('tjrush-orientacion', orientacion); } catch (e) { /* sin almacenamiento */ }
  ORI.set({ modo: orientacion }).catch(() => {});
  renderOptions();
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
// el fondo de pantalla del telefono: "YO ♥ TIJUANA" en pixeles, con el atardecer, el sol en el horizonte y la silueta
// del Arco y la ciudad. Se pinta una vez en chiquito y se estira sin suavizar (image-rendering: pixelated); uno
// alargado para el telefono parado y otro casi cuadrado para cuando la pantalla va acostada
(() => {
  const F = { Y: ['10001', '10001', '01010', '00100', '00100', '00100', '00100'], O: ['01110', '10001', '10001', '10001', '10001', '10001', '01110'],
    T: ['11111', '00100', '00100', '00100', '00100', '00100', '00100'], I: ['01110', '00100', '00100', '00100', '00100', '00100', '01110'],
    J: ['00111', '00010', '00010', '00010', '00010', '10010', '01100'], U: ['10001', '10001', '10001', '10001', '10001', '10001', '01110'],
    A: ['01110', '10001', '10001', '11111', '10001', '10001', '10001'], N: ['10001', '11001', '10101', '10011', '10001', '10001', '10001'] };
  const CORAZON = ['0110110', '1111111', '1111111', '0111110', '0011100', '0001000'];
  const CIELO = ['#1a0f2e', '#24123c', '#341650', '#4a1a5e', '#661e66', '#86246a', '#a62e66', '#c43d5c', '#de5650', '#ef7444', '#f7963a', '#fbb93a'];
  // W x H, donde va el "YO ♥" (yT) y la linea del horizonte (hz)
  const fondo = (W, H, yT, hz) => {
    const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
    const g = cv.getContext('2d'), px = (x, y, c, w = 1, h = 1) => { g.fillStyle = c; g.fillRect(x, y, w, h); }, cx = W / 2;
    // el cielo en franjas, con un poco de tramado entre una y otra, y unas estrellas
    const fr = hz / CIELO.length;
    for (let y = 0; y < hz; y++) {
      const i = Math.min(CIELO.length - 1, Math.floor(y / fr)), f = (y % fr) / fr;
      for (let x = 0; x < W; x++) px(x, y, f > 0.7 && (x + y) % 2 && i + 1 < CIELO.length ? CIELO[i + 1] : CIELO[i]);
    }
    const r = mulberry(1889);
    for (let k = 0; k < W / 6; k++) px((r() * W) | 0, (r() * hz * 0.25) | 0, '#fff7d6');
    // el sol a medio meter, con sus rayas
    for (let y = hz - 16; y < hz; y++) for (let x = cx - 14; x < cx + 14; x++) { const d = Math.hypot(x - cx + 0.5, y - hz); if (d < 14 && !(y > hz - 10 && y % 3 === 0)) px(x, y, d < 9 ? '#ffe680' : '#ffc94a'); }
    // el piso y la silueta de la ciudad, con ventanitas prendidas
    px(0, hz, '#2a1238', W, H - hz);
    for (let x = 0, k = 0; x < W; k++) {
      const w = 4 + ((r() * 3) | 0), y = hz + 2 + ((r() * 9) | 0) - (Math.abs(x - cx) < 20 ? -6 : 0);
      if (Math.abs(x + w / 2 - cx) > 17) { px(x, y, '#1c0b28', w, H - y); for (let yy = y + 2; yy < H - 2; yy += 3) for (let xx = x + 1; xx < x + w - 1; xx += 2) if (r() < 0.3) px(xx, yy, '#ffd36b'); }
      x += w;
    }
    // el Arco Monumental: un arco parabolico grueso
    for (let x = Math.round(cx - 16.5); x <= Math.round(cx + 16.5); x++) { const t = (x - cx) / 16.5, y = Math.round(hz - 3 + 26 * t * t); if (y < H) px(x, y, '#130720', 1, 3); }
    for (let y = hz; y < H; y++) { px(Math.round(cx - 16.5), y, '#130720', 2, 1); px(Math.round(cx + 15.5), y, '#130720', 2, 1); }
    // las letras (5 x 7, con su sombrita) y el corazon
    const capa = (filas, x0, y0, k, c) => filas.forEach((f, j) => [...f].forEach((b, i) => { if (b === '1') px(x0 + i * k, y0 + j * k, c, k, k); }));
    const texto = (t, x0, y0, k, c) => { for (const [dx, col] of [[1, '#2a0d24'], [0, c]]) { let x = x0; for (const ch of t) { capa(F[ch], x + dx, y0 + dx, k, col); x += 6 * k; } } };
    const anchoYO = 2 * 6 * 2 + 14, x1 = Math.round(cx - anchoYO / 2);
    texto('YO', x1, yT, 2, '#ffffff');
    capa(CORAZON, x1 + 25, yT + 2, 2, '#2a0d24'); capa(CORAZON, x1 + 24, yT + 1, 2, '#e8243c'); px(x1 + 26, yT + 3, '#ff8a9a', 2, 2);
    texto('TIJUANA', Math.round(cx - 20.5), yT + 20, 1, '#ffe680');
    return 'url(' + cv.toDataURL() + ')';
  };
  const home = document.getElementById('pag-home');
  home.style.setProperty('--fondo-v', fondo(64, 128, 54, 100));
  home.style.setProperty('--fondo-h', fondo(100, 104, 60, 92));
})();
// ---------- el telefono: la pantalla de inicio con sus apps ----------
let celPag = 'home';
function celPagina(k) {
  celPag = k;
  for (const el of document.querySelectorAll('.cel-pag')) el.classList.toggle('on', el.id === 'pag-' + k);
  const d = new Date(), h = d.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' });
  $('celhora').textContent = h; $('celreloj').textContent = h;
  $('celfecha').textContent = d.toLocaleDateString('es-MX', { weekday: 'long', day: 'numeric', month: 'long' });
  $('celsaldo').textContent = '$' + state.money.toLocaleString('es-MX');
  if (k === 'tele' || k === 'bici' || k === 'comida') renderTienda(k);
  if (k === 'controles') ctlTab(document.body.classList.contains('touch') ? 'touch' : 'pc');
}
// atras dentro del telefono: a la pantalla de inicio; ya en el inicio, se cierra
function celAtras() { if (celPag !== 'home') celPagina('home'); else toggleOptions(); }
for (const b of document.querySelectorAll('.app')) b.addEventListener('click', () => {
  if (b.dataset.app === 'mapa') { toggleOptions(); if (window.TJGTA && !bigOpen) toggleBigMap(); return; }
  celPagina(b.dataset.app);
});
for (const b of document.querySelectorAll('.cel-atras')) b.addEventListener('click', () => celPagina('home'));
// Controles: la pestaña de lo tactil o del teclado (abre en la de tu aparato)
function ctlTab(t) {
  for (const b of document.querySelectorAll('.ctl-tabs button')) b.classList.toggle('on', b.dataset.ctl === t);
  $('ctltouch').classList.toggle('on', t === 'touch'); $('ctlpc').classList.toggle('on', t === 'pc');
}
for (const b of document.querySelectorAll('.ctl-tabs button')) b.addEventListener('click', () => ctlTab(b.dataset.ctl));
$('celhome').addEventListener('click', () => celPagina('home'));
// cerrar tocando afuera del telefono
$('opts').addEventListener('click', (ev) => { if (ev.target === $('opts')) toggleOptions(); });
// las apps que gastan tu dinero (TeleTJ, BiciTJ, Antojos): solo jugando
function renderTienda(k) {
  const sc = window.TJGTA && TJGTA.scene.scenes[0], lista = $(k === 'tele' ? 'telelista' : k === 'bici' ? 'bicilista' : 'comidalista');
  lista.innerHTML = '';
  if (k === 'comida') {
    const pd = sc && sc.pedido;
    $('comidaestado').innerHTML = pd ? '🛵 <b>Tu pedido va en camino</b><br>' + pd.c.nombre + '<br><small>' +
      (pd.rep ? 'El repartidor ya anda cerca. Asómate.' : 'Llega en unos ' + Math.max(1, Math.ceil(pd.t)) + ' segundos (según la app).') + '</small>' : '';
  }
  const items = k === 'tele' ? TELE_DESTINOS.map(d => ({ ico: d.ico, nombre: d.zona, det: d.lugar, precio: TELE_PRECIO, ir: () => sc.teletransportar(d) }))
    : k === 'bici' ? BICI_TIENDA.map(b => ({ ico: b.ico, nombre: VT_BICI[b.k].name, det: b.det, precio: b.precio, ir: () => sc.comprarBici(b) }))
    : MENU_ANTOJOS.map(c => ({ ico: c.ico, nombre: c.nombre, det: c.det, precio: c.precio, ir: () => sc.pedirComida(c) }));
  for (const it of items) {
    const b = document.createElement('button'); b.className = 'cel-item';
    b.innerHTML = '<span class="ico"></span><span class="txt"><span></span><small></small></span><span class="precio"></span>';
    b.querySelector('.ico').textContent = it.ico; b.querySelector('.txt span').textContent = it.nombre; b.querySelector('small').textContent = it.det;
    b.querySelector('.precio').textContent = '$' + it.precio.toLocaleString('es-MX');
    b.disabled = !sc || state.money < it.precio || (k === 'comida' && !!sc.pedido);
    b.addEventListener('click', () => { if (b.disabled) return; toggleOptions(); it.ir(); });
    lista.appendChild(b);
  }
  if (!sc) { const m = document.createElement('p'); m.className = 'cel-intro'; m.textContent = 'Entra al juego para usar esta app.'; lista.prepend(m); }
}
$('optbtn').addEventListener('click', toggleOptions);
$('optclose').addEventListener('click', toggleOptions);
$('optsnd').addEventListener('click', toggleSound);
// los volumenes (al soltar suena un clic para oir como quedo)
for (const r of document.querySelectorAll('[data-vol]')) {
  r.addEventListener('input', () => { if (window.SND) SND.nivel(r.dataset.vol, r.value / 100); });
  r.addEventListener('change', () => { if (window.SND && r.dataset.vol === 'sfx') SND.play('chat'); });
}
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
      !subset(p.cafes || [], cafes.map(c => c.name)) || !subset(p.eggs || [], EGGS.map(e => e.k)) || !subset(p.paros || [], PAROS.map(q => q.k))) return false;
  if (!num(p.deliveries || 0, 1e5) || !num(p.rides || 0, 1e5) || !num(p.vendidos || 0, 1e5) || (p.name != null && (typeof p.name !== 'string' || p.name.length > 32))) return false;
  const ok = { cafe: completa('cafe', nombres(cafes), p.cafes || [], p.celebrated), taco: completa('taco', nombres(tacos), p.eaten || [], p.celebrated),
    noche: completa('noche', nombres(landmarks), p.found, p.celebrated) };
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
  $('optver').textContent = 'versión web';
  if (A) A.getInfo().then(i => { $('optver').textContent = 'versión ' + i.version + ' · compilación ' + i.build; }).catch(() => {});
})();
// O o Esc abren y cierran el menu (con el juego en pausa Phaser no lee el teclado, por eso va aqui)
window.addEventListener('keydown', (ev) => {
  if (($('intro').style.display !== 'none' && !optsOpen) || $('actabox').style.display === 'flex' || ev.target.tagName === 'INPUT') return;
  if (ev.key === 'Escape' && optsOpen) celAtras();
  else if (ev.key === 'o' || ev.key === 'O') toggleOptions();
});
// el jugador aparece donde se quedo (ver posicion) o, la primera vez, en una calle al azar, en la banqueta y con
// un auto estacionado al lado
let INICIO = null;
function inicioGuardado() {
  const q = state.pos, ok = (p) => Array.isArray(p) && p.length === 3 && p.every(Number.isFinite);
  if (!q || !ok(q.p)) return null;
  const w = (p) => ({ x: REF_X + p[0] * M, y: REF_Y + p[1] * M, a: p[2] });
  const side = w(q.p), c = q.c && ok(q.c.p) && q.c.v && typeof q.c.v === 'object' ? q.c : null;
  if (side.x < NIEBLA || side.x > WORLD_W - NIEBLA || side.y > WORLD_H - NIEBLA || side.y < borderY(side.x) + 6) return null;
  const v = c && (c.v.ti != null ? (VTYPES[c.v.ti] && Number.isInteger(c.v.ci) && c.v.ci >= 0 && c.v.ci < VTYPES[c.v.ti].cols.length &&
    Number.isInteger(c.v.d) && c.v.d >= 0 && c.v.d <= DIRTY_SEEDS ? { ti: c.v.ti, ci: c.v.ci, d: c.v.d } : null)
    : ['moto', 'deportiva', 'taxi', 'urbano', 'gas'].find(k => c.v[k]));
  if (!v) return { side, pos: null, guardado: true };
  return { side, pos: w(c.p), v: typeof v === 'string' ? { [v]: true } : v, hp: Number.isFinite(c.hp) ? c.hp : null, dentro: !!c.dentro, guardado: true };
}
// ya con los edificios cargados: ¿no quedo dentro de un edificio (porque cambio el mapa)?
const inicioLibre = (I) => !blocked(I.side.x, I.side.y) && (!I.pos || I.dentro || !blocked(I.pos.x, I.pos.y));
function elegirInicio() {
  let pos, side;
  for (let tries = 0; tries < 200; tries++) {
    const e = pick(traffic.edges);
    if (e.c < 2 || e.c > 5 || e.len < 80) continue;
    const sAt = rnd(30, e.len - 30);
    side = edgePos(e, sAt, 1, e.w / 2 + 1.5 * M, {});
    pos = edgePos(e, sAt, 1, laneLat(e, e.one ? 3 : 1), {});
    if (!blocked(side.x, side.y) && side.y > borderY(side.x) + 150) break;
  }
  return { pos, side };
}
// si un lugar queda en medio de un edificio grande o del agua (Palacio Municipal, Hipodromo, Estadio), su marca
// se pasa a la banqueta mas cercana; si no, habria que atinarle a un rincon para descubrirlo (se descubre a
// menos de 110 px) o de plano no se podria. Hacen falta los edificios de alrededor de cada lugar, asi que cada uno
// se acomoda cuando llegan los de su region (al acercarte, o al verlo de cerca en el mapa grande), no todos al
// arrancar: la primera vez eran unas 60 regiones (5 MB) de golpe. Lo ya calculado se guarda (con las posiciones
// originales como llave).
function acomodarLugares() {
  const LLAVE = 'tjrush-lugares', firma = landmarks.map(l => l.x.toFixed(1) + ',' + l.y.toFixed(1)).join(';') + '|' + hashTexto(JSON.stringify(D.regs));
  let pos = null;
  try {
    const c = JSON.parse(localStorage.getItem(LLAVE) || 'null');
    if (c && c.firma === firma && Array.isArray(c.pos) && c.pos.length === landmarks.length) pos = c.pos;
  } catch (e) { /* se calcula */ }
  pos = pos || landmarks.map(() => null);
  landmarks.forEach((l, i) => { if (pos[i]) { l.x = pos[i][0]; l.y = pos[i][1]; } });
  const R = 700;
  const acomodar = async (l, i) => {
    l.acomodando = true;
    await esperarRegiones(l.x - R, l.y - R, l.x + R, l.y + R);
    if (!walkableTo(l.x, l.y, 40)) [l.x, l.y] = nearestSidewalk(l.x, l.y);
    pos[i] = [l.x, l.y];
    try { localStorage.setItem(LLAVE, JSON.stringify({ firma, pos })); } catch (e) { /* sin almacenamiento */ }
  };
  alCargarRegion.push(r => landmarks.forEach((l, i) => {
    if (!pos[i] && !l.acomodando && l.x + R > r.bb[0] && l.x - R < r.bb[2] && l.y + R > r.bb[1] && l.y - R < r.bb[3]) acomodar(l, i);
  }));
}
let arrancando = false;
async function start() {
  if (window.TJGTA || arrancando) return;
  arrancando = true;
  if (optsOpen) toggleOptions();
  // antes de entrar: los lugares en su banqueta y los edificios de donde vas a aparecer
  $('go').textContent = 'Cargando el mapa…';
  INICIO = inicioGuardado() || elegirInicio();
  // lo que se ve al aparecer (la camara ve unos 500 x 250 px); lo demas llega mientras juegas
  const R = 1200, s = INICIO.side;
  acomodarLugares();
  await esperarRegiones(s.x - R, s.y - R, s.x + R, s.y + R);
  if (!relieveListo) await Promise.race([new Promise(ok => RELIEVE.addEventListener('load', ok)), new Promise(ok => setTimeout(ok, 6000))]);
  if (INICIO.guardado && !inicioLibre(INICIO)) {
    INICIO = elegirInicio(); const t = INICIO.side;
    await esperarRegiones(t.x - R, t.y - R, t.x + R, t.y + R);
  }
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
  window.TJGTA = game; game.dbg = { YONKES, SENALES, VENDEDORES, GARITAS, filaSlots, chunkFila, enComida, comidaGrid, walkG, edgePos, pasoBanqueta, SOBRERUEDAS, tianguis, puestos, chunkPuestos, pintarPuesto, walkTianguis, enSobreruedas, findRoute, ESCENAS, tocaChoque, WORLD_W, WORLD_H, regiones, esperarRegiones, chunkBlds, miniCuadros, miniVista, borderY, INICIO, traffic, nextEdge, arboles, arbolVa, arbolEn, bajoTecho, chinas, VTYPES, vehicleTexture, state, drawChunk, chunkSteps, areaFill, baches, landmarks, tacos, cafes, perks, EGGS, YONKE, partidaValida, zonaDe, blocked, inWater, onRoad, walkableTo, waterAreas, roads, areas, PED_VARIANTS };
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
    Object.assign(state, { money: 0, celebrated: [], deliveries: 0, rides: 0, vendidos: 0, night: false, paros: [] });
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
  if (optsOpen) { celAtras(); return; }
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
