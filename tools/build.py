"""Genera dist/tjgta.html: un solo archivo con el juego, Phaser y los datos del mapa."""
import os, re
ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
html = open(os.path.join(ROOT, "index.html"), encoding="utf-8").read()
def inline_css(m):
    return "<style>\n" + open(os.path.join(ROOT, m.group(1)), encoding="utf-8").read() + "</style>"
def inline_js(m):
    src = open(os.path.join(ROOT, m.group(1)), encoding="utf-8").read().replace("</script", "<\\/script")
    return "<script>\n" + src + "\n</script>"
html = re.sub(r'<link rel="stylesheet" href="([^"]+)">', inline_css, html)
html = re.sub(r'<script src="([^"]+)"></script>', inline_js, html)
os.makedirs(os.path.join(ROOT, "dist"), exist_ok=True)
out = os.path.join(ROOT, "dist", "tjgta.html")
open(out, "w", encoding="utf-8").write(html)
print(out, len(html.encode()))

# Version para publicar como Artifact: sin doctype/html/head/body (el visor los agrega).
art = re.sub(r'<!doctype html>\s*<html[^>]*>\s*<head>\s*', '', html, flags=re.I)
art = re.sub(r'<meta charset="utf-8">\s*<meta name="viewport"[^>]*>\s*', '', art)
art = art.replace('</head>\n<body>\n', '\n', 1).replace('</body>\n</html>\n', '')
out2 = os.path.join(ROOT, "dist", "tjgta-artifact.html")
open(out2, "w", encoding="utf-8").write(art)
print(out2, len(art.encode()))
