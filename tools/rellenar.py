#!/usr/bin/env python3
"""Rellena el terreno vacio del mapa: casitas en las colonias y estacionamientos en las avenidas.

En Overture/OpenStreetMap faltan muchas casas de las colonias de Tijuana, y el juego pintaba esos terrenos de
tierra. Esto se corre despues de prep_data.py (lee data/centro.js y data/reg/) y agrega a las regiones:
  - casitas: [h, contorno, 1] pegadas a la calle (de una o dos plantas), con su lotecito entre una y otra
  - patios: atras de cada casita, hasta donde haya lugar: su fondo (dm) va como cuarto numero de la casita
  - estacionamientos: [-1, contorno] junto a las avenidas (y en las zonas comerciales), a veces con su plaza
    atras: [7, contorno, 2]
  - en lo que quede vacio adentro de las manzanas (cerca de casas): lotes baldios [-2, contorno] y canchas de
    futbol de tierra [-3, contorno]
Solo donde no hay nada: ni edificios, ni calles con su banqueta, ni parques, plazas, escuelas, industria o agua, ni
cerca de los lugares, tacos, cafes, la comida china y el yonke. Siempre sale igual (el azar va sembrado por calle),
y se puede volver a correr: primero quita lo que haya puesto antes. Tambien rehace las capas del minimapa.

Uso: python3 tools/rellenar.py [data/centro.js]   (necesita numpy y Pillow)
"""
import json, math, os, random, re, sys
import numpy as np
from PIL import Image, ImageDraw, ImageFilter

OUT = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "data", "centro.js")
REG_DIR = os.path.join(os.path.dirname(os.path.abspath(OUT)), "reg")
REG = 8192           # lado de una region (dm)
CEL = 10             # la rejilla de ocupado: 1 m (10 dm)
PAD = 600            # lo que se mira alrededor de la region (dm)
MS, MINI_PAD = 0.08, 16   # como en prep_data.py (capa del minimapa)

# como en src/game.js: ancho de las calles por clase (m), de un sentido, y la banqueta
ROAD_W = [19, 19, 19, 18, 12, 10, 9, 6, 6, 2.5, 3, 10]
ANCHO_UN_SENTIDO = [12, 12, 11, 11, 8]
SIDEWALK = 2.5
# areas que no se tocan: 0 parque, 1 cancha, 2 plaza, 3 escuela, 5 industria, 7 agua, 8 arena (4 comercio y
# 6 vivienda si se pueden llenar)
AREA_LIBRE = {4, 6}
# la comida china y el yonke (los pone el juego junto a la banqueta: posiciones sacadas del juego, en dm)
PUNTOS_JUEGO = [(85470, 31268), (86807, 30846), (87642, 30784), (89209, 30332), (91298, 30405), (92995, 30332), (92844, 29055)]


def road_w(c, f):
    return ANCHO_UN_SENTIDO[c] if (f & 2) and c < len(ANCHO_UN_SENTIDO) else ROAD_W[c]


def undelta(a):
    out, x, y = [], 0, 0
    for i in range(0, len(a), 2):
        x += a[i]; y += a[i + 1]; out += [x, y]
    return out


def delta(f):
    out, px, py = [], 0, 0
    for i in range(0, len(f), 2):
        out += [f[i] - px, f[i + 1] - py]; px, py = f[i], f[i + 1]
    return out


def caja(f):
    xs, ys = f[0::2], f[1::2]
    return [min(xs), min(ys), max(xs), max(ys)]


src = open(OUT, encoding="utf-8").read()
D = json.loads(src[src.index("{"):src.rstrip().rstrip(";").rindex("}") + 1])
roads = [(c, n, f, undelta(co)) for c, n, f, co in D["roads"]]
areas = [(k, undelta(co)) for k, co in D["areas"]]
WX, WY = D["w"] * 10, D["h"] * 10
border = D["border"]

# ---- las regiones como estan, sin lo que se haya puesto antes
regs = {}
for fn in os.listdir(REG_DIR):
    if fn.endswith(".js"):
        t = open(os.path.join(REG_DIR, fn), encoding="utf-8").read()
        m = re.match(r"TJ_REG\('([^']+)','(.*)'\);\s*$", t, re.S)
        regs[m.group(1)] = [b for b in json.loads(m.group(2)) if len(b) == 2 and b[0] >= 0]  # sin lo puesto antes
blds = [undelta(b[1]) for bs in regs.values() for b in bs]
print("regiones", len(regs), "edificios", len(blds))

# indices por cuadro de region (lo que toca cada cuadro, con su orilla)
def indice(items, bbf):
    g = {}
    for i, it in enumerate(items):
        x0, y0, x1, y1 = bbf(it)
        for cx in range(int((x0 - PAD) // REG), int((x1 + PAD) // REG) + 1):
            for cy in range(int((y0 - PAD) // REG), int((y1 + PAD) // REG) + 1):
                g.setdefault((cx, cy), []).append(i)
    return g
g_bld = indice(blds, caja)
g_road = indice(roads, lambda r: caja(r[3]))
g_area = indice(areas, lambda a: caja(a[1]))
evitar = [(l[2], l[3], 450) for l in D["landmarks"]] + [(t[1], t[2], 100) for t in D["tacos"] + D["cafes"]] + \
    [(x, y, 300) for x, y in PUNTOS_JUEGO]

def border_y(x):
    for i in range(0, len(border) - 2, 2):
        if border[i] <= x <= border[i + 2]:
            t = (x - border[i]) / ((border[i + 2] - border[i]) or 1)
            return border[i + 1] + t * (border[i + 3] - border[i + 1])
    return border[1] if x < border[0] else border[-1]

nuevos = {}       # region -> lo que se le agrega
puestos = []      # todo lo puesto (para que las regiones de junto no se encimen)
g_puesto = {}
n_casas = n_est = n_plaza = n_patio = n_baldio = n_cancha = 0

def rect(x, y, dx, dy, nx, ny, t0, t1, e0, e1):
    # rectangulo a lo largo de la calle: de t0 a t1 sobre el tramo y de e0 a e1 hacia afuera
    return [x + dx * t0 + nx * e0, y + dy * t0 + ny * e0, x + dx * t1 + nx * e0, y + dy * t1 + ny * e0,
            x + dx * t1 + nx * e1, y + dy * t1 + ny * e1, x + dx * t0 + nx * e1, y + dy * t0 + ny * e1]

N = (REG + 2 * PAD) // CEL
for (RX, RY) in sorted({k for k in g_road}):
    if RX < 0 or RY < 0 or RX * REG > WX or RY * REG > WY:
        continue
    ox, oy = RX * REG - PAD, RY * REG - PAD
    G = lambda f: [((f[i] - ox) / CEL, (f[i + 1] - oy) / CEL) for i in range(0, len(f), 2)]
    occ = Image.new("L", (N, N), 0); d = ImageDraw.Draw(occ)
    cas = Image.new("L", (N, N), 0); dk = ImageDraw.Draw(cas)   # solo edificios y casas (para saber que es ciudad)
    com = Image.new("L", (N, N), 0); dc = ImageDraw.Draw(com)
    for i in g_area.get((RX, RY), []):
        k, f = areas[i]
        if len(f) < 6:
            continue
        if k == 4:
            dc.polygon(G(f), fill=255)   # comercio: ahi van mas estacionamientos
        elif k not in AREA_LIBRE:
            d.polygon(G(f), fill=255)
    for i in g_bld.get((RX, RY), []):
        if len(blds[i]) >= 6:
            d.polygon(G(blds[i]), fill=255); dk.polygon(G(blds[i]), fill=255)
    for i in g_road.get((RX, RY), []):
        c, n, f, p = roads[i]
        w = road_w(c, f) + 2 * SIDEWALK + 1 if c <= 6 else {7: 7.5, 8: 7, 9: 3, 10: 6, 11: 12}[c]
        d.line(G(p), fill=255, width=max(1, round(w)), joint="curve")
        for q in G(p)[::max(1, len(p) // 2 - 1)]:   # puntas redondas
            r = w / 2; d.ellipse([q[0] - r, q[1] - r, q[0] + r, q[1] + r], fill=255)
    for x, y, r in evitar:
        if ox - r < x < ox + N * CEL + r and oy - r < y < oy + N * CEL + r:
            q = ((x - ox) / CEL, (y - oy) / CEL); rr = r / CEL
            d.ellipse([q[0] - rr, q[1] - rr, q[0] + rr, q[1] + rr], fill=255)
    for j in g_puesto.get((RX, RY), []):
        d.polygon(G(puestos[j]), fill=255); dk.polygon(G(puestos[j]), fill=255)
    O = np.array(occ.filter(ImageFilter.MaxFilter(3))) > 0
    # Estados Unidos y fuera del mapa
    for gx in range(N):
        by = (border_y(ox + gx * CEL) - oy) / CEL + 4
        if by > 0:
            O[:min(N, int(by)), gx] = True
    if ox < 0: O[:, :int(-ox / CEL) + 1] = True
    if oy < 0: O[:int(-oy / CEL) + 1, :] = True
    O[:, max(0, int((WX - ox) / CEL)):] = True; O[max(0, int((WY - oy) / CEL)):, :] = True
    C = np.array(com) > 0

    def celdas(f, orilla):
        # las celdas cuyo centro cae en el rectangulo (con su orilla, en celdas)
        q = G(f); xs = [a for a, b in q]; ys = [b for a, b in q]
        x0, x1, y0, y1 = int(min(xs)) - 1, int(max(xs)) + 2, int(min(ys)) - 1, int(max(ys)) + 2
        if x0 < 0 or y0 < 0 or x1 > N or y1 > N:
            return None
        yy, xx = np.mgrid[y0:y1, x0:x1] + 0.5
        (ax, ay), (bx, by_), (_, _), (dx_, dy_) = q[0], q[1], q[2], q[3]
        ux, uy, vx, vy = bx - ax, by_ - ay, dx_ - ax, dy_ - ay
        lu, lv = math.hypot(ux, uy), math.hypot(vx, vy)
        s = ((xx - ax) * ux + (yy - ay) * uy) / lu; t = ((xx - ax) * vx + (yy - ay) * vy) / lv
        return (slice(y0, y1), slice(x0, x1)), (s > -orilla) & (s < lu + orilla) & (t > -orilla) & (t < lv + orilla)

    def libre(f):
        c = celdas(f, 0.5)
        return c is not None and not O[c[0]][c[1]].any()

    def marcar(f):
        c = celdas(f, 0)
        if c is not None:
            sub = O[c[0]]; sub[c[1]] = True

    aqui = []   # las casas puestas en esta region (para saber que es ciudad)

    def ocupar(f):
        x0, y0, x1, y1 = caja(f)
        puestos.append(f)
        for cx in range(int((x0 - PAD) // REG), int((x1 + PAD) // REG) + 1):
            for cy in range(int((y0 - PAD) // REG), int((y1 + PAD) // REG) + 1):
                g_puesto.setdefault((cx, cy), []).append(len(puestos) - 1)
        marcar(f)

    def poner(h, f, flag=None):
        global n_casas, n_est, n_plaza, n_baldio, n_cancha
        f = [round(v) for v in f]
        x0, y0, x1, y1 = caja(f)
        k = "%d_%d" % ((x0 + x1) // 2 // REG, (y0 + y1) // 2 // REG)
        e = [h, delta(f)] + ([flag] if flag else [])
        nuevos.setdefault(k, []).append(e)
        ocupar(f)
        if h >= 0: aqui.append(f)
        if h == -1: n_est += 1
        elif h == -2: n_baldio += 1
        elif h == -3: n_cancha += 1
        elif flag == 2: n_plaza += 1
        else: n_casas += 1
        return e

    def centro_aqui(f):
        x0, y0, x1, y1 = caja(f)
        return (x0 + x1) // 2 // REG == RX and (y0 + y1) // 2 // REG == RY

    def es_comercio(f):
        q = G(f); x = int(sum(a for a, b in q) / 4); y = int(sum(b for a, b in q) / 4)
        return 0 <= x < N and 0 <= y < N and C[y, x]

    # dos pasadas: primero los estacionamientos (necesitan terrenos grandes), luego las casitas
    for pasada in ("est", "casa"):
        for i in g_road.get((RX, RY), []):
            c, n, fl, p = roads[i]
            if c > 6 or (fl & 1) or (pasada == "casa" and c <= 1):
                continue
            half = road_w(c, fl) / 2 * 10 + SIDEWALK * 10
            for s in range(0, len(p) - 2, 2):
                x, y, x2, y2 = p[s], p[s + 1], p[s + 2], p[s + 3]
                L = math.hypot(x2 - x, y2 - y)
                if L < 80:
                    continue
                dx, dy = (x2 - x) / L, (y2 - y) / L
                for lado in (1, -1):
                    nx, ny = -dy * lado, dx * lado
                    rnd = random.Random(i * 1000003 + s * 101 + (lado + 1) + (7 if pasada == "est" else 0))
                    t = 30.0
                    while True:
                        if pasada == "est":
                            if c > 3 and c != 4 and c != 5:
                                break
                            lg, pr = rnd.uniform(360, 680), rnd.uniform(280, 520)
                            if t + lg > L - 30:
                                break
                            e0 = half + 18
                            f = rect(x, y, dx, dy, nx, ny, t, t + lg, e0, e0 + pr)
                            com_ = es_comercio(f)
                            quiere = rnd.random() < (0.7 if com_ else 0.3 if c <= 3 else 0)
                            if quiere and centro_aqui(f) and libre(f):
                                poner(-1, f)
                                # la plaza atras del estacionamiento
                                fp = rect(x, y, dx, dy, nx, ny, t + 30, t + lg - 30, e0 + pr + 40, e0 + pr + 40 + rnd.uniform(140, 240))
                                if rnd.random() < 0.75 and libre(fp):
                                    poner(7, fp, 2)
                                t += lg + 150
                            else:
                                t += 60
                        else:
                            ancho = rnd.uniform(70, 120) if c <= 3 else rnd.uniform(65, 100)
                            fondo, retiro = rnd.uniform(70, 120), rnd.uniform(18, 35)
                            if t + ancho > L - 15:
                                break
                            if rnd.random() < 0.06:   # un lote baldio de vez en cuando
                                t += ancho; continue
                            e0 = half + retiro
                            f = rect(x, y, dx, dy, nx, ny, t, t + ancho, e0, e0 + fondo)
                            if centro_aqui(f) and libre(f):
                                q = rnd.random()
                                h = 3 if q < (0.45 if c <= 3 else 0.66) else 6   # de una o dos plantas (de tres no: seria otra pasada al pintar el trozo)
                                e = poner(h, f, 1)
                                # su patio: lo mas hondo que quepa (de 3 a 14 m), del ancho de la casa
                                for pd in range(int(rnd.uniform(60, 140)), 25, -15):
                                    fp = rect(x, y, dx, dy, nx, ny, t, t + ancho, e0 + fondo + 8, e0 + fondo + 8 + pd)
                                    if libre(fp):
                                        e.append(pd + 8); ocupar([round(v) for v in fp]); n_patio += 1
                                        break
                                t += ancho + rnd.uniform(12, 30)
                            else:
                                t += 15
    # ---- adentro de las manzanas: lo que quedo vacio cerca de las casas (a menos de ~30 m), alineado con la
    # calle mas cercana: canchas de tierra y lotes baldios
    for f in aqui:
        dk.polygon(G(f), fill=255)
    ch = cas.resize((N // 4, N // 4), Image.BOX).point(lambda v: 255 if v else 0).filter(ImageFilter.MaxFilter(15))
    URB = np.array(ch) > 0
    muestras = {}
    for i in g_road.get((RX, RY), []):
        c, n, fl, p = roads[i]
        if c > 6:
            continue
        for s in range(0, len(p) - 2, 2):
            x, y, x2, y2 = p[s], p[s + 1], p[s + 2], p[s + 3]
            L = math.hypot(x2 - x, y2 - y)
            if L < 1:
                continue
            a = math.atan2(y2 - y, x2 - x)
            for k in range(0, int(L) + 1, 100):
                px, py = x + (x2 - x) * k / L, y + (y2 - y) * k / L
                muestras.setdefault((int(px // 400), int(py // 400)), []).append((px, py, a))

    def rumbo(x, y):
        best = None
        for bx in range(int(x // 400) - 3, int(x // 400) + 4):
            for by in range(int(y // 400) - 3, int(y // 400) + 4):
                for px, py, a in muestras.get((bx, by), ()):
                    dd = (px - x) ** 2 + (py - y) ** 2
                    if best is None or dd < best[0]:
                        best = (dd, a)
        return None if best is None or best[0] > 1200 ** 2 else best[1]

    rnd = random.Random(RX * 7919 + RY * 104729)
    for gy in range(PAD // CEL, (PAD + REG) // CEL, 14):
        for gx in range(PAD // CEL, (PAD + REG) // CEL, 14):
            if O[gy, gx] or not URB[min(gy // 4, URB.shape[0] - 1), min(gx // 4, URB.shape[1] - 1)]:
                continue
            x, y = ox + gx * CEL, oy + gy * CEL
            a = rumbo(x, y)
            if a is None:
                continue
            q = rnd.random()
            if q < 0.14:
                tipo, w, h = -3, rnd.uniform(320, 380), rnd.uniform(200, 240)
            elif q < 0.7:
                tipo, w, h = -2, rnd.uniform(140, 300), rnd.uniform(120, 260)
            else:
                continue
            ux, uy, vx, vy = math.cos(a), math.sin(a), -math.sin(a), math.cos(a)
            f = [x - ux * w / 2 - vx * h / 2, y - uy * w / 2 - vy * h / 2, x + ux * w / 2 - vx * h / 2, y + uy * w / 2 - vy * h / 2,
                 x + ux * w / 2 + vx * h / 2, y + uy * w / 2 + vy * h / 2, x - ux * w / 2 + vx * h / 2, y - uy * w / 2 + vy * h / 2]
            if libre(f):
                poner(tipo, f)
    if os.environ.get("TJ_DEBUG") == "%d_%d" % (RX, RY):
        Image.fromarray((O * 255).astype(np.uint8)).save(os.environ.get("TJ_DEBUG_PNG", "ocupado.png"))
        sys.exit(0)
    if (RX * 40 + RY) % 50 == 0:
        print("region", RX, RY, "casas", n_casas, "patios", n_patio, "estacionamientos", n_est, "plazas", n_plaza, "baldios", n_baldio, "canchas", n_cancha, flush=True)

print("casas", n_casas, "patios", n_patio, "estacionamientos", n_est, "plazas", n_plaza, "baldios", n_baldio, "canchas", n_cancha)

# ---- escribir las regiones (lo de antes y lo nuevo) y su caja en el indice
for k, b in nuevos.items():
    regs.setdefault(k, []).extend(b)
D["regs"] = {}
peso = 0
for k in sorted(regs):
    bs = regs[k]
    if not bs:
        continue
    cs = [caja(undelta(b[1])) for b in bs]
    D["regs"][k] = [min(c[0] for c in cs), min(c[1] for c in cs), max(c[2] for c in cs), max(c[3] for c in cs)]
    j = json.dumps(bs, separators=(",", ":"))
    open(os.path.join(REG_DIR, k + ".js"), "w").write("TJ_REG('%s','%s');\n" % (k, j))
    peso += len(j)
D["regs"] = dict(sorted(D["regs"].items()))

# ---- capa de edificios del minimapa (como en prep_data.py), ahora con las casitas y plazas
TPX = REG / 2
TS = math.ceil((TPX + 2 * MINI_PAD) * MS)
SS = 4
celdas = {}
for bs in regs.values():
    for b in bs:
        if b[0] < 0:
            continue
        f = undelta(b[1]); x0, y0, x1, y1 = caja(f)
        for cx in range(int((x0 / 2 - MINI_PAD) // TPX), int((x1 / 2 + MINI_PAD) // TPX) + 1):
            for cy in range(int((y0 / 2 - MINI_PAD) // TPX), int((y1 / 2 + MINI_PAD) // TPX) + 1):
                celdas.setdefault((cx, cy), []).append(f)
for fn in os.listdir(REG_DIR):
    if fn.endswith(".png"):
        os.remove(os.path.join(REG_DIR, fn))
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
D["mini"] = mini

s = json.dumps(D, separators=(",", ":"), ensure_ascii=False)
open(OUT, "w", encoding="utf-8").write("window.TJ_DATA=" + s + ";\n")
print("regiones", len(D["regs"]), "bytes", peso, "minimapa", len(mini))
