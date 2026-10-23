#!/usr/bin/env python3
"""Quita del mapa los edificios demasiado chicos para ser edificios.

Casi la mitad de los edificios de Overture/OpenStreetMap en Tijuana miden menos de 12 m2: tiras de bardas, tejabanes,
tinacos, cuartitos de azotea y pedazos sueltos pegados a las casas (de cuando se trazaron a mano o de las huellas
de satelite). En el juego salian como edificios miniatura con su techo y su sombra. El minimo para que un edificio
del mapa salga en el juego:
  - al menos MIN_AREA m2 (un cuarto de unos 3.5 x 3.5 m), y
  - al menos MIN_ANCHO m de ancho promedio (2 * area / perimetro; asi se van las bardas largas y delgadas)
Si no llega, simplemente no se pone nada en su lugar.

prep_data.py y rellenar.py usan chico() al leer los edificios, asi que con datos nuevos ya salen sin ellos. Esto es
para los datos ya hechos: quita los chicos de data/reg/ (solo los del mapa: las casitas, plazas, estacionamientos,
lotes y canchas de rellenar.py se quedan), ajusta el indice de regiones y rehace la capa del minimapa.

Uso: python3 tools/quitar_chicos.py [data/centro.js]   (necesita Pillow)
"""
import json, math, os, re, sys

MIN_AREA = 12     # m2
MIN_ANCHO = 1.5   # m


def chico(f):
    """f: contorno en dm, [x0, y0, x1, y1, ...] (sin repetir el primer punto)"""
    xs, ys, n = f[0::2], f[1::2], len(f) // 2
    if n < 3:
        return True
    area = abs(sum(xs[i] * ys[(i + 1) % n] - xs[(i + 1) % n] * ys[i] for i in range(n))) / 2 / 100
    per = sum(math.hypot(xs[(i + 1) % n] - xs[i], ys[(i + 1) % n] - ys[i]) for i in range(n)) / 10
    return area < MIN_AREA or 2 * area / per < MIN_ANCHO


def undelta(a):
    out, x, y = [], 0, 0
    for i in range(0, len(a), 2):
        x += a[i]; y += a[i + 1]; out += [x, y]
    return out


def caja(f):
    xs, ys = f[0::2], f[1::2]
    return [min(xs), min(ys), max(xs), max(ys)]


if __name__ == "__main__":
    from PIL import Image, ImageDraw
    OUT = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "data", "centro.js")
    REG_DIR = os.path.join(os.path.dirname(os.path.abspath(OUT)), "reg")
    MS, MINI_PAD = 0.08, 16   # como en prep_data.py (capa del minimapa)
    src = open(OUT, encoding="utf-8").read()
    D = json.loads(src[src.index("{"):src.rstrip().rstrip(";").rindex("}") + 1])
    REG = D["reg"]

    regs, antes, quitados = {}, 0, 0
    for fn in os.listdir(REG_DIR):
        if fn.endswith(".js"):
            t = open(os.path.join(REG_DIR, fn), encoding="utf-8").read()
            m = re.match(r"TJ_REG\('([^']+)','(.*)'\);\s*$", t, re.S)
            bs = json.loads(m.group(2))
            antes += len(bs)
            # los del mapa son [h, contorno]; lo de rellenar.py lleva tipo o tiene h < 0
            quedan = [b for b in bs if len(b) > 2 or b[0] < 0 or not chico(undelta(b[1]))]
            quitados += len(bs) - len(quedan)
            regs[m.group(1)] = quedan

    D["regs"] = {}
    peso = 0
    for k in sorted(regs):
        bs = regs[k]
        if not bs:
            os.remove(os.path.join(REG_DIR, k + ".js"))
            continue
        cs = [caja(undelta(b[1])) for b in bs]
        D["regs"][k] = [min(c[0] for c in cs), min(c[1] for c in cs), max(c[2] for c in cs), max(c[3] for c in cs)]
        j = json.dumps(bs, separators=(",", ":"))
        open(os.path.join(REG_DIR, k + ".js"), "w").write("TJ_REG('%s','%s');\n" % (k, j))
        peso += len(j)

    # ---- capa de edificios del minimapa (como en rellenar.py)
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
    print("quitados", quitados, "de", antes, "regiones", len(D["regs"]), "bytes", peso, "minimapa", len(mini))
