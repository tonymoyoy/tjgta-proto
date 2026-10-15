# TJ Rush · Zona Centro y Zona Río (prototipo)

Juego de vista cenital estilo GTA 2 en la Zona Centro y la Zona Río de Tijuana (unos 4.1 x 2.9 km), con calles, edificios y lugares reales.
Hecho con Phaser 3 (JavaScript); corre en el navegador.

## Jugar
- En línea: https://tonymoyoy.github.io/tjgta-proto/ (GitHub Pages sirve `index.html` desde `main`).
- Abre `dist/tjgta.html` en el navegador (un solo archivo, funciona sin internet).
- Para desarrollar: abre `index.html` (carga `src/` y `data/` por separado).

## Android
La app se arma con Capacitor a partir de los mismos archivos (`index.html`, `src/`, `data/`).
Requiere Node 22, JDK 21 y el Android SDK (`ANDROID_HOME`).
- `npm install` la primera vez.
- `npm run apk` copia el juego a `www/`, sincroniza `android/` y genera `android/app/build/outputs/apk/debug/app-debug.apk`.
- `npm run android` lo instala y abre en el celular conectado (depuración USB) o en el emulador.
- `npm run dev` sirve el juego en http://localhost:8080 para probar en el navegador.

## Controles
Flechas/WASD mover o manejar · E robar auto / bajarte · Espacio freno de mano · Shift correr ·
T trabajar de taxista · M mapa grande (toca para marcar destino). En celular hay joystick y botones.

## Actividades
- Lugares ★: 25 lugares reales: 16 del Centro (Arco, Plaza Santa Cecilia, Catedral, Caesar's, Jai Alai...) y 9 de la Zona Río (CECUT, El Cubo, Las Tijeras, glorietas Cuauhtémoc, Lincoln y Zaragoza, Plaza Río...).
- Ruta del taco 🌮: 18 taquerías reales del mapa.
- Cafés ☕: 24 cafés reales para coleccionar.
- Comida china 🏮: 6 locales ficticios en la Calle Coahuila; al entrar pierdes dinero (no se coleccionan).
- Repartidor 🛵: roba una moto de repartidor y entrega el pedido antes de que se acabe el tiempo.
- Taxi: recoge pasajeros y llévalos a un lugar antes de que se acabe el tiempo.
- Paros 🤝: 23 personajes en las colonias (lejos de los lugares típicos) te piden un favor: llevar al gato al veterinario, pozole a la jefa, flores al panteón, croquetas al albergue de perritos, una perrita rescatada con su nueva familia... Se aceptan con E (botón ACEPTAR), tienen tiempo y pagan según la distancia. Están en `PAROS` de src/game.js.
- Vehículos: 10 tipos (sedán, vocho, troca, camioneta, tsurito, combi, muscle car, lowrider, calafia, camión de carga), cada uno limpio o sucio y madreado. Los sucios aguantan menos golpes y corren un poco menos. Se dibujan en `vehicleTexture()` de src/game.js.
- Patrullas 🚓: trocas de policía en el tráfico (máximo 3). Si las chocas te cobran multa ($150–800 según la velocidad, una cada 5 s). No se pueden robar.
El progreso se guarda en el navegador.

## Estructura
- `src/game.js` lógica del juego (render del mapa en trozos, tráfico, peatones, actividades, HUD).
- `src/style.css` interfaz.
- `data/centro.js` mapa compacto generado.
- `tools/download_overture.py` descarga datos de Overture Maps (S3 público) para un recuadro (variable `TJ_BBOX="xmin,ymin,xmax,ymax"`, igual en prep_data.py; por defecto Centro + Zona Río).
  Uso: `python3 download_overture.py transportation segment id,class,subtype,names,road_flags,access_restrictions`
  (también `buildings building ...`, `places place id,names`, `base land_use ...`, `base water ...`).
- `tools/prep_data.py RAW_DIR data/centro.js` convierte esos GeoJSON al formato del juego
  (aquí se eligen los lugares y taquerías).
- `tools/build.py` genera (no se suben al repo, ver .gitignore) `dist/tjgta.html` (todo en un archivo) y `dist/tjgta-artifact.html`.

## Datos
Overture Maps Foundation, derivados de © colaboradores de OpenStreetMap (ODbL). Recuadro:
lon -117.048 a -116.985, lat 32.500 a 32.543 (Centro, Zona Norte, Zona Río, Chapultepec, Hipódromo y Agua Caliente). La línea fronteriza se aproxima con una recta.
