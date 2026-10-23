#!/usr/bin/env python3
"""El relieve de Tijuana: el sombreado de cerros, cañones y mesas para pintarlo debajo de calles y casas.

Baja las alturas reales de los Terrain Tiles (AWS Open Data, formato terrarium: altura = R*256 + G + B/256 - 32768,
en metros; vienen de SRTM y otras fuentes publicas), las pasa a la rejilla del mapa del juego (metros desde la
esquina noroeste, como prep_data.py) y saca el sombreado con la luz del noroeste (como los edificios). Lo guarda como
una capa de color con transparencia (data/relieve.png): claro donde le pega la luz, oscuro en las laderas de la
sombra y nada en lo plano y en el mar. El juego la estira encima del piso de cada trozo (ver pintarRelieve).

Uso: python3 tools/relieve.py [data/centro.js]   (necesita numpy y Pillow; los mosaicos se guardan en ~/.cache)
"""
import io, json, math, os, sys, urllib.request
import numpy as np
from PIL import Image

OUT = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "data", "centro.js")
DEST = os.path.join(os.path.dirname(os.path.abspath(OUT)), "relieve.png")
CACHE = os.path.expanduser("~/.cache/tjrush-terrarium")
URL = "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png"
Z = 13          # unos 16 m por pixel a esta latitud
PASO = 16       # metros por pixel de la capa
# mismo recuadro y proyeccion que prep_data.py
LON0, LAT0, LON1, LAT1 = map(float, os.environ.get("TJ_BBOX", "-117.142,32.390,-116.800,32.565").split(","))
KX = 111320 * math.cos(math.radians(32.53))
KY = 110574
# la luz (del noroeste y desde arriba, como en el juego), cuanto se exagera el relieve y que tan fuerte se pinta
LUZ = np.array([-0.55, -0.55, 0.63]); LUZ = LUZ / np.linalg.norm(LUZ)
EXAGERA = 1.6
CLARO, OSCURO = (255, 238, 205), (45, 26, 14)
A_CLARO, A_OSCURO = 210, 260   # alfa por unidad de sombreado (hasta MAX)
MAX_CLARO, MAX_OSCURO = 70, 105

src = open(OUT, encoding="utf-8").read()
D = json.loads(src[src.index("{"):src.rstrip().rstrip(";").rindex("}") + 1])
W, H = D["w"], D["h"]
nx, ny = math.ceil(W / PASO), math.ceil(H / PASO)

def tile_xy(lon, lat):
    n = 2 ** Z
    return (lon + 180) / 360 * n, (1 - math.log(math.tan(math.radians(lat)) + 1 / math.cos(math.radians(lat))) / math.pi) / 2 * n

def mosaico(tx, ty):
    os.makedirs(CACHE, exist_ok=True)
    f = os.path.join(CACHE, "%d_%d_%d.png" % (Z, tx, ty))
    if not os.path.exists(f):
        with urllib.request.urlopen(URL.format(z=Z, x=tx, y=ty), timeout=30) as r:
            open(f, "wb").write(r.read())
    a = np.asarray(Image.open(f).convert("RGB"), dtype=np.float64)
    return a[..., 0] * 256 + a[..., 1] + a[..., 2] / 256 - 32768

# los mosaicos que cubren el recuadro, pegados en una sola imagen de alturas
x0, y0 = tile_xy(LON0, LAT1); x1, y1 = tile_xy(LON0 + W / KX, LAT1 - H / KY)
tx0, ty0, tx1, ty1 = int(x0), int(y0), int(x1), int(y1)
big = np.zeros(((ty1 - ty0 + 1) * 256, (tx1 - tx0 + 1) * 256))
for ty in range(ty0, ty1 + 1):
    for tx in range(tx0, tx1 + 1):
        big[(ty - ty0) * 256:(ty - ty0 + 1) * 256, (tx - tx0) * 256:(tx - tx0 + 1) * 256] = mosaico(tx, ty)
print("mosaicos", (tx1 - tx0 + 1) * (ty1 - ty0 + 1))

# a la rejilla del juego (bilineal)
xs = (np.arange(nx) + 0.5) * PASO; ys = (np.arange(ny) + 0.5) * PASO
lon = LON0 + xs / KX; lat = LAT1 - ys / KY
n = 2 ** Z
px = ((lon + 180) / 360 * n - tx0) * 256 - 0.5
py = ((1 - np.log(np.tan(np.radians(lat)) + 1 / np.cos(np.radians(lat))) / np.pi) / 2 * n - ty0) * 256 - 0.5
PX, PY = np.meshgrid(px, py)
i0, j0 = np.floor(PX).astype(int), np.floor(PY).astype(int); fx, fy = PX - i0, PY - j0
i0 = np.clip(i0, 0, big.shape[1] - 2); j0 = np.clip(j0, 0, big.shape[0] - 2)
E = (big[j0, i0] * (1 - fx) * (1 - fy) + big[j0, i0 + 1] * fx * (1 - fy) + big[j0 + 1, i0] * (1 - fx) * fy + big[j0 + 1, i0 + 1] * fx * fy)
print("alturas", round(E.min()), round(E.max()), "m; rejilla", nx, ny)

# sombreado: la normal de la superficie contra la luz, menos lo que tendria lo plano
gy, gx = np.gradient(E * EXAGERA, PASO)   # (y hacia el sur, como el mapa)
nrm = np.sqrt(gx * gx + gy * gy + 1)
s = (-gx * LUZ[0] - gy * LUZ[1] + LUZ[2]) / nrm - LUZ[2]
s[np.abs(s) < 0.015] = 0   # lo casi plano, nada
mar = E <= 0.5
out = np.zeros((ny, nx, 4), dtype=np.uint8)
cl, os_ = s > 0, s < 0
out[cl, :3] = CLARO; out[cl, 3] = np.minimum(MAX_CLARO, s[cl] * A_CLARO).astype(np.uint8)
out[os_, :3] = OSCURO; out[os_, 3] = np.minimum(MAX_OSCURO, -s[os_] * A_OSCURO).astype(np.uint8)
out[mar] = 0
Image.fromarray(out, "RGBA").save(DEST, optimize=True)
print("guardado", DEST, os.path.getsize(DEST) // 1024, "KB")
