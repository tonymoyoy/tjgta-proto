"""Convierte los GeoJSON de Overture Maps (derivados de OpenStreetMap) a los datos del juego:
data/centro.js (calles, areas, lugares, frontera y el indice de regiones) y data/reg/ (los edificios,
partidos en regiones que el juego carga segun por donde andes, y su capa del minimapa en PNG).

Coordenadas de salida: metros locales, x hacia el este, y hacia el sur,
origen en la esquina noroeste del recuadro. Se guardan en decímetros (enteros); cada linea o poligono
lleva el primer punto completo y los demas como diferencia con el anterior (pesa mucho menos).
Cada calle: [clase, indice_nombre, banderas(1=puente, 2=un sentido, 4=sin autos), coords].
Cada edificio (en su region): [altura_m, coords].
"""
import json, math, sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from quitar_chicos import chico

RAW = sys.argv[1] if len(sys.argv) > 1 else "raw"
OUT = sys.argv[2] if len(sys.argv) > 2 else os.path.join(os.path.dirname(__file__), "..", "data", "centro.js")

# mismo recuadro que download_overture.py: Centro, Zona Norte, Zona Rio, Chapultepec, Hipodromo y Agua Caliente.
# Fase 1 (Otay, Aeropuerto, La Mesa y las 5 y 10) y fase 2 (Diaz Ordaz, Cerro Colorado y la Presa): al oriente hasta
# pasar el Cerro Colorado y al sur hasta la cortina de la Presa Rodriguez; el norte llega hasta donde pasa la linea
# fronteriza de verdad. Fase 3 (Playas y el principio de la Escenica): al poniente hasta el mar. Fase 4 (las
# orillas): al sur hasta el limite con Rosarito (Santa Fe, Natura, San Antonio del Mar) y al oriente hasta pasar
# El Florido y Terrazas del Valle. La escala este-oeste se queda con la
# latitud del primer recuadro (32.517-32.543); si el recuadro crece al norte o al oeste, todo se recorre junto con
# el origen y el juego lo compensa con 'o' (ver REF).
LON0, LAT0, LON1, LAT1 = map(float, os.environ.get("TJ_BBOX", "-117.142,32.390,-116.800,32.565").split(","))
KX = 111320 * math.cos(math.radians(32.53))
# punto de referencia fijo (la esquina noroeste del primer mapa): el juego tiene algunas posiciones en metros
# desde aqui (zonas, paros, secretos). Si el recuadro crece al norte o al oeste, el origen se mueve pero
# esas posiciones no: el juego les suma 'o', que es donde cae esta referencia en el mapa nuevo
REF = (-117.048, 32.543)
# regiones de edificios: cuadros de 8192 dm (819.2 m, 16 x 16 trozos del mapa del juego)
REG = 8192
REG_DIR = os.path.join(os.path.dirname(os.path.abspath(OUT)), "reg")
# capa de edificios del minimapa (mismos valores que MS y MINI_PAD en src/game.js): px del minimapa por px del
# mundo y orilla extra de cada cuadro (px del mundo) para que no se noten las uniones
MS, MINI_PAD = 0.08, 16
# el primer recuadro: lo de afuera es la ampliacion (ahi se buscan taquerias y cafes nuevos)
VIEJO = (-117.048, 32.517, -117.004, 32.543)
# lo ya publicado: sus lugares, tacos y cafes se conservan tal cual para no romper las partidas guardadas
PREV = None
if os.path.exists(OUT):
    t = open(OUT, encoding="utf-8").read()
    PREV = json.loads(t[t.index("=") + 1:t.rstrip().rindex(";")])
KY = 110574

def border_recta(lon):
    # aproximacion de la linea fronteriza: recta desde el Pacifico (32.5343N, 117.1243W) hacia el este
    return 32.5343 + (lon + 117.1243) * 0.0765

def linea_fronteriza():
    """La linea de verdad, de oeste a este: la orilla que comparten los poligonos de Mexico y de Estados Unidos
    (division_area, subtype country; tierra y mar, asi entra al mar). Sin shapely, la orilla norte del de Mexico
    cerca de la recta (sirve tierra adentro, pero en la costa se iria por la playa). Sin el archivo, la recta."""
    f = os.path.join(RAW, "division_area.geojson")
    if not os.path.exists(f) or os.environ.get("TJ_FRONTERA") == "recta":
        return None
    try:
        from shapely.geometry import shape, box
        from shapely.ops import unary_union
        caja = box(LON0 - 0.1, LAT0, LON1 + 0.1, LAT1 + 0.05)
        pais = {}
        for ft in json.load(open(f))["features"]:
            pr = ft["properties"]
            n = (pr.get("names") or {}).get("primary")
            if pr.get("subtype") == "country" and n in ("México", "United States"):
                pais.setdefault(n, []).append(shape(ft["geometry"]).intersection(caja))
        mx, us = unary_union(pais["México"]), unary_union(pais["United States"])
        comun = mx.buffer(0.00002).intersection(us.buffer(0.00002))
        vs = set()
        for g in (getattr(comun, "geoms", None) or [comun]):
            for lo, la in g.exterior.coords:
                vs.add((round(lo, 6), round(la, 6)))
        # de la franja angosta que comparten, el punto de en medio en cada tramo de longitud
        vs = sorted(vs)
        out, paso = [], 0.0005
        lo = vs[0][0]
        while lo <= vs[-1][0]:
            q = [la for a, la in vs if lo <= a < lo + paso]
            if q:
                out.append((lo + paso / 2, (min(q) + max(q)) / 2))
            lo += paso
        if len(out) > 2:
            return out
    except ImportError:
        print("sin shapely: frontera por la orilla norte de Mexico")
    vs = set()
    for ft in json.load(open(f))["features"]:
        if ft["properties"].get("subtype") != "country":
            continue
        g = ft["geometry"]
        for poly in ([g["coordinates"]] if g["type"] == "Polygon" else g["coordinates"]):
            for lo, la, *_ in poly[0]:
                # solo la parte de la frontera: cerca de la recta y un poco mas alla del recuadro
                if LON0 - 0.1 < lo < LON1 + 0.1 and abs(la - border_recta(lo)) < 0.006:
                    vs.add((lo, la))
    return sorted(vs) or None

LINEA = linea_fronteriza()

def border_lat(lon):
    if not LINEA:
        return border_recta(lon)
    if lon <= LINEA[0][0]:
        return LINEA[0][1]
    for (a, b), (c, d) in zip(LINEA, LINEA[1:]):
        if lon <= c:
            return b + (d - b) * (lon - a) / ((c - a) or 1)
    return LINEA[-1][1]

def P(lon, lat):
    return [round((lon - LON0) * KX * 10), round((LAT1 - lat) * KY * 10)]

O = P(*REF)
if PREV:
    # lo de antes, al origen de ahora
    ox, oy = O[0] - (PREV.get("o") or [0, 0])[0], O[1] - (PREV.get("o") or [0, 0])[1]
    for l in PREV["landmarks"]:
        l[2] += ox; l[3] += oy
    for l in PREV["tacos"] + PREV["cafes"]:
        l[1] += ox; l[2] += oy

def in_mx(lon, lat, margin=0.0):
    return lat < border_lat(lon) - margin

def load(n):
    return json.load(open(os.path.join(RAW, n + ".geojson")))["features"]

def load_iter(n):
    """Las features una por una, leyendo el archivo por pedazos (el de edificios de toda la ciudad no cabe
    entero en memoria como objetos de python)."""
    dec = json.JSONDecoder()
    with open(os.path.join(RAW, n + ".geojson"), encoding="utf-8") as fh:
        buf = fh.read(1 << 22)
        i = buf.index("[", buf.index('"features"')) + 1
        while True:
            while i < len(buf) and buf[i] in " ,\n\r\t":
                i += 1
            if i < len(buf) and buf[i] == "]":
                return
            try:
                obj, j = dec.raw_decode(buf, i)
            except json.JSONDecodeError:
                mas = fh.read(1 << 22)
                if not mas:
                    return
                buf = buf[i:] + mas; i = 0
                continue
            yield obj
            i = j
            if i > (1 << 21):
                buf = buf[i:] + fh.read(1 << 22); i = 0

def flat(coords):
    out = []
    for lon, lat, *_ in coords:
        out += P(lon, lat)
    return out

def delta(f):
    """[x0, y0, x1, y1, ...] -> [x0, y0, x1-x0, y1-y0, ...]"""
    return f[:2] + [f[i] - f[i - 2] for i in range(2, len(f))]

W = round((LON1 - LON0) * KX)
H = round((LAT1 - LAT0) * KY)

# ---- calles
ROAD = {"motorway": 0, "trunk": 1, "primary": 2, "secondary": 3, "tertiary": 4, "residential": 5,
        "unclassified": 5, "living_street": 6, "unknown": 6, "service": 7, "pedestrian": 8,
        "footway": 9, "path": 9, "cycleway": 9, "track": 7}
names, name_ix = [], {}
roads = []
# los pedazos extra de las calles que se parten (ver partir); van al final para no mover los indices de las demas
extra_roads = []

def partir(cs, rangos):
    """Parte la linea cs en pedazos segun los rangos [a, b] (fraccion del largo) marcados como puente.
    Overture marca is_bridge solo en una parte del segmento (between); sin partir, el segmento entero
    se dibujaba como puente aunque el puente fuera solo el cruce del rio. Regresa [(es_puente, coords)]."""
    xy = [(lo * KX, la * KY) for lo, la, *_ in cs]
    cum = [0.0]
    for i in range(1, len(xy)):
        cum.append(cum[-1] + math.hypot(xy[i][0] - xy[i - 1][0], xy[i][1] - xy[i - 1][1]))
    L = cum[-1] or 1
    # cortes: bordes de los rangos, juntando los que se tocan
    rs = []
    for a, b in sorted(rangos):
        if rs and a <= rs[-1][1] + 1e-6:
            rs[-1][1] = max(rs[-1][1], b)
        else:
            rs.append([a, b])
    cortes, t = [], 0.0
    for a, b in rs:
        if a > t:
            cortes.append((False, t, a))
        cortes.append((True, a, b))
        t = b
    if t < 1:
        cortes.append((False, t, 1.0))
    def punto(d):
        for i in range(1, len(cum)):
            if d <= cum[i] or i == len(cum) - 1:
                k = (d - cum[i - 1]) / ((cum[i] - cum[i - 1]) or 1)
                lo0, la0 = cs[i - 1][0], cs[i - 1][1]
                return [lo0 + (cs[i][0] - lo0) * k, la0 + (cs[i][1] - la0) * k]
    # pedacitos de menos de 3 m no se separan: se pegan al pedazo vecino
    piezas = []
    for br, a, b in cortes:
        if piezas and (b - a) * L < 3:
            piezas[-1][2] = b
        elif piezas and (piezas[-1][2] - piezas[-1][1]) * L < 3:
            piezas[-1] = [br, piezas[-1][1], b]
        else:
            piezas.append([br, a, b])
    out = []
    for br, a, b in piezas:
        d0, d1 = a * L, b * L
        seg = [punto(d0)] + [list(cs[i][:2]) for i in range(len(cs)) if d0 < cum[i] < d1] + [punto(d1)]
        out.append((br, seg))
    return out
for f in load("segment"):
    p = f["properties"]
    if f["geometry"]["type"] != "LineString":
        continue
    cs = f["geometry"]["coordinates"]
    if not any(in_mx(lo, la) for lo, la, *_ in cs):
        continue
    if p["subtype"] == "rail":
        cls = 10
    else:
        cls = ROAD.get(p["class"])
        if cls is None:
            continue
    nm = (p.get("names") or {}).get("primary") or ""
    ni = -1
    if nm:
        if nm not in name_ix:
            name_ix[nm] = len(names); names.append(nm)
        ni = name_ix[nm]
    rangos = [rf.get("between") or [0, 1] for rf in (p.get("road_flags") or []) if rf.get("values") and "is_bridge" in rf["values"]]
    ow, nocar = 0, 0
    for r in (p.get("access_restrictions") or []):
        w = r.get("when") or {}
        if r.get("access_type") == "denied":
            if w.get("heading") == "backward" and not w.get("mode"):
                ow = 1
            elif not w or (w.get("mode") and "motor_vehicle" in w["mode"]):
                nocar = 1
    flags = (ow << 1) | (nocar << 2)
    if not rangos:
        roads.append([cls, ni, flags, flat(cs)])
        continue
    piezas = partir(cs, rangos)
    for k, (br, seg) in enumerate(piezas):
        (roads if k == 0 else extra_roads).append([cls, ni, flags | (1 if br else 0), flat(seg)])

# ---- edificios
blds = []
for f in load_iter("building"):
    g = f["geometry"]
    p = f["properties"]
    h = p.get("height") or ((p.get("num_floors") or 1) * 3.2)
    # algunos edificios vienen como varios poligonos
    for poly in ([g["coordinates"]] if g["type"] == "Polygon" else g["coordinates"]):
        ring = poly[0]
        lo = sum(c[0] for c in ring) / len(ring); la = sum(c[1] for c in ring) / len(ring)
        if not in_mx(lo, la, 0.00005):
            continue
        if not (LON0 < lo < LON1 and LAT0 < la < LAT1):
            continue
        f = flat(ring[:-1])
        if chico(f):  # bardas, tinacos y cuartitos: no son edificios (ver quitar_chicos.py)
            continue
        blds.append([round(min(h, 120)), f])

# ---- uso de suelo y agua
LU = {"park": 0, "grass": 0, "garden": 0, "meadow": 0, "playground": 0, "pitch": 1,
      "pedestrian": 2, "plaza": 2, "school": 3, "retail": 4, "commercial": 4, "construction": 5,
      "brownfield": 5, "industrial": 5, "railway": 5, "residential": 6,
      # el Club Campestre: el campo entero de pasto, fairways y greens mas claros, trampas de arena y lagos
      "golf_course": 0, "driving_range": 0, "fairway": 1, "green": 1, "bunker": 8, "water_hazard": 7}
areas = []
# el campo de golf completo va primero, para que sus greens, trampas y lagos queden encima
for f in sorted(load("land_use"), key=lambda f: f["properties"]["class"] != "golf_course"):
    k = LU.get(f["properties"]["class"])
    if k is None:
        continue
    g = f["geometry"]
    polys = [g["coordinates"]] if g["type"] == "Polygon" else g["coordinates"]
    for poly in polys:
        # lo que queda entero del otro lado de la linea no se pinta (se veia apagado debajo de EE. UU.)
        if not any(in_mx(lo, la) for lo, la, *_ in poly[0]):
            continue
        areas.append([k, flat(poly[0][:-1])])
# el mar: el poligono del oceano (viene en cuadros de un grado) recortado al recuadro y simplificado (~1.5 m)
mar = []
for f in load("water"):
    if f["properties"]["subtype"] != "ocean":
        continue
    try:
        from shapely.geometry import shape, box
        g = shape(f["geometry"]).intersection(box(LON0 - 0.01, LAT0 - 0.01, LON1 + 0.01, LAT1 + 0.01)).simplify(0.000015)
    except ImportError:
        print("sin shapely: no hay mar"); break
    for pg in (getattr(g, "geoms", None) or [g]):
        if pg.geom_type == "Polygon" and not pg.is_empty:
            mar.append([7, flat(list(pg.exterior.coords)[:-1])])
areas += mar
for f in load("water"):
    p, g = f["properties"], f["geometry"]
    if p["subtype"] in ("ocean",):
        continue
    if g["type"] == "Polygon":
        if any(in_mx(lo, la) for lo, la, *_ in g["coordinates"][0]):
            areas.append([7, flat(g["coordinates"][0][:-1])])
    elif g["type"] == "LineString" and any(in_mx(lo, la) for lo, la, *_ in g["coordinates"]):
        roads.append([11, -1, 4, flat(g["coordinates"])])

# playas y arenales (tema land): arena encima del mar
if os.path.exists(os.path.join(RAW, "land.geojson")):
    for f in load("land"):
        g = f["geometry"]
        if f["properties"].get("class") not in ("beach", "sand") or g["type"] not in ("Polygon", "MultiPolygon"):
            continue
        for poly in ([g["coordinates"]] if g["type"] == "Polygon" else g["coordinates"]):
            if any(in_mx(lo, la) for lo, la, *_ in poly[0]):
                areas.append([8, flat(poly[0][:-1])])

# ---- lugares
places = {}
for f in load("place"):
    n = (f["properties"].get("names") or {}).get("primary")
    if n:
        places.setdefault(n, f["geometry"]["coordinates"])

def at(name):
    lo, la = places[name]
    return P(lo, la)

LANDMARKS = [
    ("El Arco", "Arco Monumental", "El Reloj Monumental marca la entrada a la Avenida Revolución, en la Calle Primera."),
    ("Plaza Santa Cecilia", "Plaza Santa Cecilia", "La plaza de los mariachis, considerada la cuna de Tijuana."),
    ("Iglesia de Nuestra Senora de Guadalupe", "Catedral de Guadalupe", "La catedral de Tijuana, en la Calle Segunda y Niños Héroes."),
    ("Muhti  - Museo de Historia de Tijuana", "Museo de Historia (MUHTI)", "Ocupa el antiguo Palacio Municipal de la ciudad."),
    ("Hotel Caesars", "Hotel Caesar's", "Aquí nació la ensalada César en los años 20."),
    ("Jai Alai Frontón Palacio", "Frontón Jai Alai", "El Palacio Frontón, ícono de la Revolución, hoy sede de conciertos."),
    ("Pasaje Rodriguez", "Pasaje Rodríguez", "Pasaje de galerías, cafés y arte local entre la Revu y la Constitución."),
    ("The Foreign Club ", "Foreign Club", "Edificio histórico de los tiempos de los casinos y la Ley Seca."),
    ("Museo de Cera de Tijuana", "Museo de Cera", "Museo de figuras de cera en la Calle Primera."),
    ("Parque Teniente Guerrero", "Parque Teniente Guerrero", "Uno de los parques más antiguos y queridos del Centro."),
    ("Teatro Zaragoza", "Teatro Zaragoza", "Teatro histórico frente al Parque Teniente Guerrero."),
    ("Mercado de Artesanías de Tijuana", "Mercado de Artesanías", "Puestos de artesanías, sarapes y piñatas junto a la línea."),
    ("Puente Fronterizo El Chaparral", "Puente El Chaparral", "Paso peatonal hacia la garita PedWest."),
    ("Garita de San Ysidro - Tijuana", "Garita de San Ysidro", "Uno de los cruces fronterizos más transitados del mundo."),
    ("Mercado Hidalgo", "Mercado Hidalgo", "Mercado tradicional de chiles, dulces y especias en la Zona Río."),
    ("Museo Del Taco", "Museo del Taco", "Un homenaje al platillo más sagrado de Tijuana."),
    # Zona Rio
    ("Centro Cultural Tijuana - CECUT", "CECUT", "El Centro Cultural Tijuana y su domo, La Bola, el símbolo de la Zona Río."),
    ("Museo El Cubo", "El Cubo", "Sala de exposiciones del CECUT, un cubo junto a La Bola."),
    ("Monumento Me'xico", "Monumento a México", "Las Tijeras: dos arcos gigantes en la glorieta de Paseo de los Héroes."),
    ("Monumento a Cuauhtémoc", "Glorieta Cuauhtémoc", "El emperador mexica cuida el tráfico de Paseo de los Héroes."),
    ("Monumento a Abraham Lincoln", "Glorieta Lincoln", "Lincoln rompiendo cadenas, regalo de los Estados Unidos a la ciudad."),
    ("Monumento al General Ignacio Zaragoza", "Glorieta Zaragoza", "El general de la Batalla de Puebla, al final de Paseo de los Héroes."),
    ("Plaza Río", "Plaza Río Tijuana", "El centro comercial clásico de la Zona Río."),
    ("Palacio Municipal", "Palacio Municipal", "El Ayuntamiento de Tijuana, junto al río."),
    ("Monumento Defensa Heroica de Tijuana", "Defensa Heroica", "Recuerda a quienes defendieron Tijuana en 1911."),
]
landmarks = [[title, desc] + at(src) for src, title, desc in LANDMARKS]
# lugares que Overture no trae con nombre: van con su coordenada de OpenStreetMap (lat, lon)
LANDMARKS_OSM = [
    ("Plaza de la Tecnología", "Celulares, computadoras y refacciones de todo: si aquí no lo encuentras, no existe.", 32.53469, -117.04059),
    ("FrikiPlaza", "Cómics, figuras, cartas y videojuegos: la meca friki de Tijuana.", 32.53438, -117.04152),
    ("Parque México", "Un respiro verde en la Zona Norte, a unos pasos de la línea.", 32.54015, -117.03691),
    ("Templo de San Francisco", "El templo de San Francisco de Asís, a una cuadra del Parque Teniente Guerrero.", 32.53336, -117.04645),
]
landmarks += [[title, desc] + P(lon, lat) for title, desc, lat, lon in LANDMARKS_OSM]
# ampliacion al sur y al oriente (Chapultepec, Hipodromo, Agua Caliente), con coordenadas de OpenStreetMap
LANDMARKS_P1 = [
    ("Antiguo Casino Agua Caliente", "El casino más lujoso del mundo en los años 30. Hoy es la Prepa Lázaro Cárdenas, con su minarete y su alberca.", 32.51608, -117.00357),
    ("Club Campestre", "El campo de golf de Tijuana, entre Chapultepec y el Hipódromo.", 32.50934, -117.00510),
    ("Hipódromo de Agua Caliente", "Carreras de caballos desde 1929 y luego de galgos; hoy casino y apuestas.", 32.50744, -116.99613),
    ("Estadio Caliente", "La casa de los Xolos. ¡Xolos, Xolos, Xolos!", 32.50620, -116.99322),
    ("Galerías Hipódromo", "Centro comercial frente al Estadio Caliente: cine, comida y aire acondicionado.", 32.50835, -116.99261),
]
landmarks += [[title, desc] + P(lon, lat) for title, desc, lat, lon in LANDMARKS_P1]
# fase 1: Otay, el Aeropuerto, La Mesa y las 5 y 10 (coordenadas de OpenStreetMap)
LANDMARKS_F1 = [
    ("Garita de Otay", "El otro cruce a San Diego: el de los tráileres de las maquiladoras de la Mesa de Otay.", 32.5472, -116.9398),
    ("Aeropuerto de Tijuana", "El Aeropuerto Internacional Abelardo L. Rodríguez, con la pista pegadita a la línea.", 32.5462, -116.9735),
    ("UABC Campus Tijuana", "La Universidad Autónoma de Baja California: aquí los Cimarrones estudian, corren y hacen fila en la cafetería.", 32.53339, -116.96443),
    ("Tecnológico de Tijuana", "El ITT, donde se han formado generaciones de ingenieros de la ciudad.", 32.53085, -116.98693),
    ("Central Camionera", "La Central de Autobuses de Tijuana: de aquí salen camiones a todo el país.", 32.51798, -116.95932),
    ("Las 5 y 10", "El crucero más famoso de La Mesa: tiendas, puestos, camiones y tráfico a todas horas.", 32.4992, -116.9658),
    ("Museo El Trompo", "Museo interactivo de ciencia y tecnología: aquí todo se puede tocar, girar y apachurrar.", 32.49525, -116.93828),
    ("Parque Morelos", "Uno de los parques más grandes de la ciudad, con zoológico, lago y mucho espacio para el día de campo.", 32.49899, -116.93998),
    ("CEART Tijuana", "El Centro Estatal de las Artes, junto al Parque Morelos: teatro, danza, música y exposiciones.", 32.49972, -116.94524),
]
landmarks += [[title, desc] + P(lon, lat) for title, desc, lat, lon in LANDMARKS_F1]
# fase 2: Diaz Ordaz, Cerro Colorado y la Presa (y dos de La Mesa que faltaban)
LANDMARKS_F2 = [
    ("Mundo Divertido", "Go-karts, juegos mecánicos y maquinitas: el parque de diversiones de toda la vida.", 32.50442, -116.95825),
    ("Macroplaza", "El centro comercial de La Mesa, sobre el Bulevar Insurgentes.", 32.49488, -116.93360),
    ("Estadio de los Toros", "La casa de los Toros de Tijuana: béisbol, porra y elotes en las gradas.", 32.48372, -116.91674),
    ("Mirador del Cerro Colorado", "Desde aquí arriba se ve casi toda la ciudad, y en días claros, hasta el mar.", 32.47355, -116.89917),
    ("Presa Rodríguez", "La presa Abelardo L. Rodríguez, de 1937: la cortina de concreto que guarda el agua del río Tijuana.", 32.44453, -116.90754),
]
landmarks += [[title, desc] + P(lon, lat) for title, desc, lat, lon in LANDMARKS_F2]
# fase 3: Playas de Tijuana y el principio de la Escenica (y la Casa de la Cultura, en la Altamira)
LANDMARKS_F3 = [
    ("Casa de la Cultura", "Un edificio de los años 30 en lo alto de la colonia Altamira, hoy lleno de talleres de arte, música y danza.", 32.53184, -117.05211),
    ("El Muro en la Playa", "Aquí la línea entra al mar: el muro con sus murales, el Parque de la Amistad y familias saludándose a través de la reja.", 32.53385, -117.12330),
    ("Faro de Playas", "El faro del malecón, junto a la línea: de aquí para el norte ya es otro país.", 32.53426, -117.12275),
    ("Malecón de Playas", "Mariscos, nieve, puestos de churros y el atardecer más bonito de la ciudad.", 32.52650, -117.12280),
    ("El Colef", "El Colegio de la Frontera Norte, con su terraza frente al mar en la Escénica.", 32.45646, -117.11119),
]
landmarks += [[title, desc] + P(lon, lat) for title, desc, lat, lon in LANDMARKS_F3]
# fase 4: las orillas (coordenadas de OpenStreetMap)
LANDMARKS_F4 = [
    ("Santa Fe", "Fraccionamientos de casitas iguales hasta donde alcanza la vista, con su unidad deportiva llena los domingos.", 32.43147, -117.03700),
    ("San Antonio del Mar", "Casas frente al mar a la orilla de la Escénica, ya rumbo a Rosarito.", 32.42393, -117.09693),
    ("Mirador del Cañón del Sainz", "Un mirador sobre el cañón: la ciudad de un lado y los cerros del sur del otro.", 32.42843, -116.96514),
    ("Natura", "El fraccionamiento de los parques con nombres de animales: el Águila, los Venados, el Flamenco...", 32.41295, -116.92033),
    ("El Florido", "La puerta oriente de la ciudad, rumbo a Tecate, con su parque y su unidad deportiva.", 32.46317, -116.85920),
    ("Universidad Tecnológica", "La UTT, en lo alto del oriente de la ciudad, donde empiezan los cerros rumbo a Tecate.", 32.46152, -116.82337),
]
landmarks += [[title, desc] + P(lon, lat) for title, desc, lat, lon in LANDMARKS_F4]
# lo que se fue agregando despues de la primera version: quien ya habia completado una coleccion no pierde su premio
NUEVOS = {"noche": [t for t, *_ in LANDMARKS_OSM + LANDMARKS_P1 + LANDMARKS_F1 + LANDMARKS_F2 + LANDMARKS_F3 + LANDMARKS_F4], "taco": [], "cafe": []}
if PREV:
    viejos = {l[0] for l in PREV["landmarks"]}
    landmarks = PREV["landmarks"] + [l for l in landmarks if l[0] not in viejos]
    for k, v in (PREV.get("nuevos") or {}).items():
        NUEVOS[k] = sorted(set(NUEVOS[k]) | set(v))

TACOS = ["Tacos El Gordo", "Tacos Fiesta", "Tacos Guanajuato", "Tacos de Birria la 4ta", "Tacos El REY",
         "Tacos de Birria Noe", "Tacos al Pastor El Meño", "Tacos Rodriguez", "Taco Loco",
         "Tacos El Delicioso Tijuana", "Tacos Polo Sur", "Tacos Mike", "Tacos Javier", "Tacos Kokopelli",
         "Tacos Don Gallo", "Tacos Azul ", "Tacos Chuy", "Tacos Trini de tijuana los mejores"]
tacos = [[n.strip()] + at(n) for n in TACOS]
# Zona Rio: se agregan solo si quedan a mas de 250 m de las demas taquerias
TACOS_RIO = ["Tacos Aarón Río", "Tacos Los Paisas", "Tacos La Movida", "Tacos Tigre Toño", "Birria El Jefe Tijuana",
             "Tacos Los Troncos", "Tacos San Cosme", 'Taquería "Los Famosos"', "Tacos Varios Río", "Chefcito Fish&Shrimp Tacos",
             "Tacos de Pescado Alicia", "Taqualli tacos urbanos", "Tacos Puebla", "Tacos Chava", "Tacos El Poblano Jr",
             "Tacos a Vapor Juanito", "Tacos Hector", "Tacos El Mayor"]
for n in TACOS_RIO:
    if n not in places:
        continue
    t = [n.strip().replace('"', '')] + at(n)
    if all(math.hypot(t[1] - o[1], t[2] - o[2]) > 2500 for o in tacos):
        tacos.append(t)
if PREV:
    tacos = PREV["tacos"][:]

def en_ampliacion(lo, la):
    return (LON0 < lo < LON1 and LAT0 < la < LAT1) and not (VIEJO[0] < lo < VIEJO[2] and VIEJO[1] < la < VIEJO[3])

# distancia minima (dm) entre las taquerias y cafes que llegan con cada ampliacion (las de antes se quedan): era
# 700 m y desde la fase 4 es 1.5 km, para que las colecciones no crezcan tanto
SEP_NUEVOS = 15000
# ampliacion: taquerias reales (nombre con taco, birria o taqueria), a mas de SEP_NUEVOS una de otra
import re
ES_TACO = re.compile(r"\b(tacos?|taquer[ií]a|birria)\b", re.I)
NO_TACO = re.compile(r"\b(bell|shop|bar|sushi|pizza|burger)\b", re.I)
# el juego es para 13+: nada de groserias en los nombres
GROSERO = re.compile(r"(ching|verga|pinche|cabr[oó]n|puta|put[ao]s|mamad|culer|pendej|pedo\b)", re.I)
for n, (lo, la) in sorted(places.items()):
    if not ES_TACO.search(n) or NO_TACO.search(n) or GROSERO.search(n) or not en_ampliacion(lo, la) or not in_mx(lo, la, 0.0003):
        continue
    t = [n.strip().replace('"', '')] + P(lo, la)
    if all(math.hypot(t[1] - o[1], t[2] - o[2]) > SEP_NUEVOS for o in tacos) and t[0] not in {o[0] for o in tacos}:
        tacos.append(t); NUEVOS["taco"].append(t[0])

# cafes reales: los que tienen cafe en el nombre, sin bares ni negocios que no son cafeteria,
# repartidos para que queden al menos a 300 m uno de otro (en la ampliacion, a 700 m)
NOT_CAFE = re.compile(r"\b(bar|smoke|restaurant|restaurante|agency|barbershop|shopping|bistro|deli|pizza|taquer|cantina|distribuci|ganoderma|"
                      r"internet|ciber|cyber|beauty|showroom|baño|chin[oa]|"
                      # cadenas (marcas ajenas)
                      r"\w*volada|starbucks|dunkin|tim hortons|oxxo|7.eleven|punta del cielo|cielito|italian coffee|the coffee bean)", re.I)
cafes = []
for n, (lo, la) in sorted(places.items()):
    if n.strip().lower() == "café" or not re.search(r"\b(caf[eé]|coffee|cafeter[ií]a|espresso)\b", n, re.I) or NOT_CAFE.search(n) or GROSERO.search(n):
        continue
    if not in_mx(lo, la, 0.0003) or not (LON0 < lo < LON1 and LAT0 < la < LAT1):
        continue
    x, y = P(lo, la)
    if PREV and not en_ampliacion(lo, la):
        continue
    if all(math.hypot(x - c[1], y - c[2]) > (SEP_NUEVOS if PREV else 3000) for c in (PREV["cafes"] if PREV else []) + cafes) and \
            n.strip() not in {c[0] for c in (PREV["cafes"] if PREV else []) + cafes}:
        cafes.append([n.strip(), x, y])
        if PREV: NUEVOS["cafe"].append(n.strip())
if PREV:
    cafes = PREV["cafes"] + cafes

# la frontera de oeste a este, pasando poco mas alla de las orillas del mapa
if LINEA:
    border = flat([[LON0 - 0.002, border_lat(LON0 - 0.002)]] + [v for v in LINEA if LON0 - 0.002 < v[0] < LON1 + 0.002] +
                  [[LON1 + 0.002, border_lat(LON1 + 0.002)]])
else:
    border = flat([[LON0, border_lat(LON0)], [LON1, border_lat(LON1)]])

roads += extra_roads

# ---- calles cortadas que deberian estar unidas: en los datos muchas calles se quedan a unos metros de otra (de
# punta a punta o de punta a un costado) y en el juego quedaban cerradas por los dos lados. Si la punta suelta
# apunta hacia la otra calle (menos de UNE_ANG), esta cerca (UNE_PUNTA de punta a punta, UNE_LADO al costado) y en
# medio no hay edificios, agua ni otra calle, se agrega un tramo que las une (al final, para no mover los indices).
# Al costado se le mete un vertice a la otra calle para que el cruce sea un nodo del grafo de trafico.
UNE_PUNTA, UNE_LADO, UNE_ANG = 220, 150, math.radians(50)
def unir_calles():
    from shapely.geometry import LineString, Polygon, Point
    from shapely.strtree import STRtree
    auto = lambda r: r[0] <= 6 and not (r[2] & 5)
    usos = {}
    for r in roads:
        if r[0] > 6:
            continue
        f = r[3]; n = len(f) // 2
        for i in range(n):
            k = (f[2 * i], f[2 * i + 1]); usos[k] = usos.get(k, 0) + (1 if i in (0, n - 1) else 2)
    puntas = []  # (x, y, ux, uy, indice de la calle)
    for ri, r in enumerate(roads):
        if not auto(r):
            continue
        f = r[3]; n = len(f) // 2
        for i, j in ((0, 1), (n - 1, n - 2)):
            x, y = f[2 * i], f[2 * i + 1]
            if usos[(x, y)] != 1:
                continue
            # la direccion con la que llega a la punta (un punto unos metros atras)
            q = j; step = 1 if j > i else -1
            while 0 <= q + step < n and math.hypot(f[2 * q] - x, f[2 * q + 1] - y) < 30:
                q += step
            dx, dy = x - f[2 * q], y - f[2 * q + 1]; L = math.hypot(dx, dy)
            if L > 0:
                puntas.append((x, y, dx / L, dy / L, ri))
    C = 300
    rej = {}
    for p in puntas:
        rej.setdefault((p[0] // C, p[1] // C), []).append(p)
    lineas = [LineString(list(zip(r[3][0::2], r[3][1::2]))) for r in roads]
    arbol = STRtree(lineas)
    agua = [Polygon(list(zip(a[1][0::2], a[1][1::2]))).buffer(0) for a in areas if a[0] == 7 and len(a[1]) >= 6]
    arbol_agua = STRtree(agua)
    apunta = lambda p, tx, ty: math.acos(max(-1, min(1, ((tx - p[0]) * p[2] + (ty - p[1]) * p[3]) / (math.hypot(tx - p[0], ty - p[1]) or 1)))) < UNE_ANG
    usadas, cands = set(), []
    for p in puntas:
        if (p[0], p[1]) in usadas:
            continue
        best = None
        # de punta a punta (las dos apuntando una a la otra)
        for i in (-1, 0, 1):
            for j in (-1, 0, 1):
                for o in rej.get((p[0] // C + i, p[1] // C + j), []):
                    d = math.hypot(o[0] - p[0], o[1] - p[1])
                    if o[4] == p[4] or (o[0], o[1]) in usadas or d > UNE_PUNTA or d < 5 or not apunta(p, o[0], o[1]) or not apunta(o, p[0], p[1]):
                        continue
                    if not best or d < best[0]:
                        best = (d, o[0], o[1], o[4], None)
        # de punta al costado de otra calle
        if not best:
            pt = LineString([(p[0], p[1]), (p[0] + p[2] * UNE_LADO, p[1] + p[3] * UNE_LADO)])
            for li in arbol.query(pt):
                li = int(li); r = roads[li]
                if li == p[4] or not auto(r) or not lineas[li].intersects(pt):
                    continue
                x = lineas[li].intersection(pt)
                for g in (getattr(x, "geoms", None) or [x]):
                    if g.geom_type != "Point":
                        continue
                    d = math.hypot(g.x - p[0], g.y - p[1])
                    if d > 5 and (not best or d < best[0]):
                        best = (d, round(g.x), round(g.y), li, True)
        if not best:
            continue
        d, tx, ty, ti, lado = best
        seg = LineString([(p[0], p[1]), (tx, ty)])
        if any(int(k) not in (p[4], ti) and lineas[int(k)].intersects(seg) for k in arbol.query(seg)):
            continue
        if any(agua[int(k)].intersects(seg) for k in arbol_agua.query(seg)):
            continue
        cands.append([p, tx, ty, ti, lado, seg])
        usadas.add((p[0], p[1])); usadas.add((tx, ty))
    # que no pasen por un edificio (solo se revisan los que caen en las celdas de algun candidato)
    E = 500
    porcelda = {}
    for ci, c in enumerate(cands):
        x0, y0, x1, y1 = c[5].bounds
        for i in range(int(x0) // E, int(x1) // E + 1):
            for j in range(int(y0) // E, int(y1) // E + 1):
                porcelda.setdefault((i, j), []).append(ci)
    malos = set()
    for b in blds:
        f = b[1]; xs, ys = f[0::2], f[1::2]
        x0, y0, x1, y1 = min(xs), min(ys), max(xs), max(ys)
        cs = set()
        for i in range(x0 // E, x1 // E + 1):
            for j in range(y0 // E, y1 // E + 1):
                cs.update(porcelda.get((i, j), ()))
        cs -= malos
        if not cs:
            continue
        pg = Polygon(list(zip(xs, ys)))
        if not pg.is_valid:
            pg = pg.buffer(0)
        for ci in cs:
            if pg.intersects(cands[ci][5]):
                malos.add(ci)
    puestas = 0
    for ci, (p, tx, ty, ti, lado, seg) in enumerate(cands):
        if ci in malos:
            continue
        r = roads[p[4]]; t = roads[ti]
        if lado:
            # el vertice en el tramo de la otra calle mas cercano al cruce
            f = t[3]; bi, bd = 1, None
            for k in range(1, len(f) // 2):
                dd = LineString([(f[2 * k - 2], f[2 * k - 1]), (f[2 * k], f[2 * k + 1])]).distance(Point(tx, ty))
                if bd is None or dd < bd:
                    bi, bd = k, dd
            if (tx, ty) not in ((f[2 * bi - 2], f[2 * bi - 1]), (f[2 * bi], f[2 * bi + 1])):
                t[3] = f[:2 * bi] + [tx, ty] + f[2 * bi:]
        roads.append([max(r[0], t[0]), r[1], 0, [p[0], p[1], tx, ty]])
        puestas += 1
    print("calles unidas", puestas, "de", len(cands), "candidatas (", len(malos), "pasaban por un edificio ); puntas sueltas", len(puntas))
if os.environ.get("TJ_UNIR", "1") == "1":
    unir_calles()

# ---- regiones de edificios: cada edificio va en la region de su centro; el indice dice hasta donde
# llega cada region (lo que se sale de su cuadro) para saber cuales hacen falta para pintar un trozo
def caja(f):
    xs, ys = f[0::2], f[1::2]
    return [min(xs), min(ys), max(xs), max(ys)]
regs = {}
for b in blds:
    x0, y0, x1, y1 = caja(b[1])
    k = "%d_%d" % ((x0 + x1) // 2 // REG, (y0 + y1) // 2 // REG)
    r = regs.setdefault(k, {"bb": [x0, y0, x1, y1], "b": []})
    r["bb"] = [min(r["bb"][0], x0), min(r["bb"][1], y0), max(r["bb"][2], x1), max(r["bb"][3], y1)]
    r["b"].append([b[0], delta(b[1])])
os.makedirs(REG_DIR, exist_ok=True)
for f in os.listdir(REG_DIR):
    if f.endswith((".js", ".png")):
        os.remove(os.path.join(REG_DIR, f))
peso = 0
for k, r in sorted(regs.items()):
    # el JSON va como texto: asi el navegador no lo interpreta hasta que hace falta (no lleva comillas)
    j = json.dumps(r["b"], separators=(",", ":"))
    open(os.path.join(REG_DIR, k + ".js"), "w").write("TJ_REG('%s','%s');\n" % (k, j))
    peso += len(j)

# ---- capa de edificios del minimapa: un PNG por cuadro de region (todos los edificios que lo tocan),
# pintado como lo pintaba el juego (color de azotea, con orillas suavizadas)
from PIL import Image, ImageDraw
TPX = REG / 2  # px del mundo por cuadro (el juego usa 5 px por metro: 0.5 px por dm)
TS = math.ceil((TPX + 2 * MINI_PAD) * MS)
SS = 4
celdas = {}
for b in blds:
    x0, y0, x1, y1 = caja(b[1])
    for cx in range(int((x0 / 2 - MINI_PAD) // TPX), int((x1 / 2 + MINI_PAD) // TPX) + 1):
        for cy in range(int((y0 / 2 - MINI_PAD) // TPX), int((y1 / 2 + MINI_PAD) // TPX) + 1):
            celdas.setdefault((cx, cy), []).append(b[1])
mini = []
for (cx, cy), bs in sorted(celdas.items()):
    m = Image.new("L", (TS * SS, TS * SS), 0)
    d = ImageDraw.Draw(m)
    ox, oy = cx * TPX - MINI_PAD, cy * TPX - MINI_PAD
    for f in bs:
        pts_ = [((f[i] / 2 - ox) * MS * SS, (f[i + 1] / 2 - oy) * MS * SS) for i in range(0, len(f), 2)]
        if len(pts_) >= 3:
            d.polygon(pts_, fill=255)
    a = m.resize((TS, TS), Image.BOX)
    if not a.getbbox():
        continue
    img = Image.new("RGBA", (TS, TS), (0x9a, 0x91, 0x7e, 0))
    img.putalpha(a)
    img.save(os.path.join(REG_DIR, "%d_%d.png" % (cx, cy)), optimize=True)
    mini.append("%d_%d" % (cx, cy))

data = dict(w=W, h=H, o=O, reg=REG, regs={k: r["bb"] for k, r in sorted(regs.items())}, mini=mini, names=names,
            roads=[r[:3] + [delta(r[3])] for r in roads], areas=[[a[0], delta(a[1])] for a in areas],
            landmarks=landmarks, tacos=tacos, cafes=cafes, border=border, nuevos=NUEVOS,
            src="Datos de mapa: Overture Maps Foundation / © colaboradores de OpenStreetMap (ODbL)")
s = json.dumps(data, separators=(",", ":"), ensure_ascii=False)
open(OUT, "w").write("window.TJ_DATA=" + s + ";\n")
print("tacos", len(tacos), "cafes", len(cafes), "landmarks", len(landmarks))
print("roads", len(roads), "blds", len(blds), "areas", len(areas), "bytes", len(s), "size m", W, H)
print("regiones", len(regs), "bytes", peso, "minimapa", len(mini), "frontera", "real" if LINEA else "recta", "o", O)
