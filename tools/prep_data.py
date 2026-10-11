"""Convierte los GeoJSON de Overture Maps (derivados de OpenStreetMap) a un
archivo compacto data/centro.js que usa el juego.

Coordenadas de salida: metros locales, x hacia el este, y hacia el sur,
origen en la esquina noroeste del recuadro. Se guardan en decímetros (enteros).
Cada calle: [clase, indice_nombre, banderas(1=puente, 2=un sentido, 4=sin autos), coords].
"""
import json, math, sys, os

RAW = sys.argv[1] if len(sys.argv) > 1 else "raw"
OUT = sys.argv[2] if len(sys.argv) > 2 else os.path.join(os.path.dirname(__file__), "..", "data", "centro.js")

# mismo recuadro que download_overture.py (Centro + Zona Rio)
LON0, LAT0, LON1, LAT1 = map(float, os.environ.get("TJ_BBOX", "-117.048,32.517,-117.004,32.543").split(","))
KX = 111320 * math.cos(math.radians((LAT0 + LAT1) / 2))
KY = 110574

def border_lat(lon):
    # Linea fronteriza: recta desde el Pacifico (32.5343N, 117.1243W) hacia el este.
    return 32.5343 + (lon + 117.1243) * 0.0765

def P(lon, lat):
    return [round((lon - LON0) * KX * 10), round((LAT1 - lat) * KY * 10)]

def in_mx(lon, lat, margin=0.0):
    return lat < border_lat(lon) - margin

def load(n):
    return json.load(open(os.path.join(RAW, n + ".geojson")))["features"]

def flat(coords):
    out = []
    for lon, lat, *_ in coords:
        out += P(lon, lat)
    return out

W = round((LON1 - LON0) * KX)
H = round((LAT1 - LAT0) * KY)

# ---- calles
ROAD = {"motorway": 0, "trunk": 1, "primary": 2, "secondary": 3, "tertiary": 4, "residential": 5,
        "unclassified": 5, "living_street": 6, "unknown": 6, "service": 7, "pedestrian": 8,
        "footway": 9, "path": 9, "cycleway": 9, "track": 7}
names, name_ix = [], {}
roads = []
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
    bridge = 1 if any((rf.get("values") and "is_bridge" in rf["values"]) for rf in (p.get("road_flags") or [])) else 0
    ow, nocar = 0, 0
    for r in (p.get("access_restrictions") or []):
        w = r.get("when") or {}
        if r.get("access_type") == "denied":
            if w.get("heading") == "backward" and not w.get("mode"):
                ow = 1
            elif not w or (w.get("mode") and "motor_vehicle" in w["mode"]):
                nocar = 1
    roads.append([cls, ni, bridge | (ow << 1) | (nocar << 2), flat(cs)])

# ---- edificios
blds = []
for f in load("building"):
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
        blds.append([round(min(h, 120)), flat(ring[:-1])])

# ---- uso de suelo y agua
LU = {"park": 0, "grass": 0, "garden": 0, "meadow": 0, "playground": 0, "pitch": 1,
      "pedestrian": 2, "plaza": 2, "school": 3, "retail": 4, "commercial": 4, "construction": 5,
      "brownfield": 5, "industrial": 5, "railway": 5, "residential": 6}
areas = []
for f in load("land_use"):
    k = LU.get(f["properties"]["class"])
    if k is None:
        continue
    g = f["geometry"]
    polys = [g["coordinates"]] if g["type"] == "Polygon" else g["coordinates"]
    for poly in polys:
        areas.append([k, flat(poly[0][:-1])])
for f in load("water"):
    p, g = f["properties"], f["geometry"]
    if p["subtype"] in ("ocean",):
        continue
    if g["type"] == "Polygon":
        areas.append([7, flat(g["coordinates"][0][:-1])])
    elif g["type"] == "LineString":
        roads.append([11, -1, 4, flat(g["coordinates"])])

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

# cafes reales: los que tienen cafe en el nombre, sin bares ni negocios que no son cafeteria,
# repartidos para que queden al menos a 300 m uno de otro
import re
NOT_CAFE = re.compile(r"\b(bar|smoke|restaurant|restaurante|agency|barbershop|shopping|bistro|deli|pizza|taquer|cantina)", re.I)
cafes = []
for n, (lo, la) in sorted(places.items()):
    if n.strip().lower() == "café" or not re.search(r"\b(caf[eé]|coffee|cafeter[ií]a|espresso)\b", n, re.I) or NOT_CAFE.search(n):
        continue
    if not in_mx(lo, la, 0.0003) or not (LON0 < lo < LON1 and LAT0 < la < LAT1):
        continue
    x, y = P(lo, la)
    if all(math.hypot(x - c[1], y - c[2]) > 3000 for c in cafes):
        cafes.append([n.strip(), x, y])

border = flat([[LON0, border_lat(LON0)], [LON1, border_lat(LON1)]])

data = dict(w=W, h=H, names=names, roads=roads, blds=blds, areas=areas, landmarks=landmarks, tacos=tacos, cafes=cafes, border=border,
            src="Datos de mapa: Overture Maps Foundation / © colaboradores de OpenStreetMap (ODbL)")
s = json.dumps(data, separators=(",", ":"), ensure_ascii=False)
open(OUT, "w").write("window.TJ_DATA=" + s + ";\n")
print("tacos", len(tacos), "cafes", len(cafes), "landmarks", len(landmarks))
print("roads", len(roads), "blds", len(blds), "areas", len(areas), "bytes", len(s), "size m", W, H)
