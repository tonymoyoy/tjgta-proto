// Genera el icono de la app (todas las densidades), las pantallas de arranque de Android y src/img/icono.png
// dibujando scripts/arte-app.html en Chromium. Uso (desde la raiz, con Playwright instalado aparte): node scripts/arte-app.mjs
import { chromium } from 'playwright';
import fs from 'fs';
const ROOT = process.cwd(), RES = ROOT + '/android/app/src/main/res';
const b = await chromium.launch(); const p = await b.newPage();
await p.goto('file://' + ROOT + '/scripts/arte-app.html');
const put = async (file, expr) => { const d = await p.evaluate(expr); fs.writeFileSync(file, Buffer.from(d.split(',')[1], 'base64')); };
const D = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 };
for (const [k, m] of Object.entries(D)) {
  const dir = RES + '/mipmap-' + k;
  await put(dir + '/ic_launcher.png', `ARTE.icono(${48 * m}, false)`);
  await put(dir + '/ic_launcher_round.png', `ARTE.icono(${48 * m}, true)`);
  await put(dir + '/ic_launcher_foreground.png', `ARTE.frente(${108 * m})`);
  await put(dir + '/ic_launcher_background.png', `ARTE.fondo(${108 * m})`);
}
for (const f of fs.readdirSync(RES).filter(d => d.startsWith('drawable'))) {
  const s = RES + '/' + f + '/splash.png'; if (!fs.existsSync(s)) continue;
  const m = (await p.evaluate(`new Promise(r => { const i = new Image(); i.onload = () => r([i.width, i.height]); i.src = 'data:image/png;base64,${fs.readFileSync(s).toString('base64')}'; })`));
  await put(s, `ARTE.arranque(${m[0]}, ${m[1]})`);
}
fs.mkdirSync(ROOT + '/src/img', { recursive: true });
await put(ROOT + '/src/img/icono.png', 'ARTE.icono(256, false)');
await b.close();
