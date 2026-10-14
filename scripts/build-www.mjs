// Copia el juego (index.html, src/, data/) a www/, que es lo que Capacitor empaqueta en la app.
import { cpSync, rmSync, mkdirSync } from 'node:fs';
rmSync('www', { recursive: true, force: true });
mkdirSync('www');
for (const p of ['index.html', 'src', 'data']) cpSync(p, `www/${p}`, { recursive: true });
console.log('www/ listo');
