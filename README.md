# TJ Rush · Tijuana (prototipo)

Juego de vista cenital estilo GTA 2 en Tijuana, con calles, edificios y lugares reales. Hoy cubre unos 16 x 13 km: Centro, Zona Norte, Zona Río,
Chapultepec, Hipódromo, Agua Caliente, Libertad, el Aeropuerto, Otay, La Mesa, las 5 y 10, Díaz Ordaz, el Cerro Colorado y La Presa. La meta es toda la ciudad, por fases.
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
- Lugares ★: 48 lugares reales: del Centro (Arco, Plaza Santa Cecilia, Catedral, Caesar's, Jai Alai...), la Zona Río (CECUT, El Cubo, Las Tijeras, glorietas...),
  Agua Caliente e Hipódromo (Estadio Caliente, el Campestre...) Otay y La Mesa (Garita de Otay, Aeropuerto, UABC, Las 5 y 10, El Trompo, Parque Morelos...) y La Presa (Estadio de los Toros, Mirador del Cerro Colorado, Presa Rodríguez...).
- Ruta del taco 🌮: 154 taquerías reales del mapa.
- Cafés ☕: 132 cafés reales para coleccionar.
- Comida china 🏮: 6 locales ficticios en la Calle Coahuila; al entrar pierdes dinero (no se coleccionan).
- Repartidor 🛵: roba una moto de repartidor y entrega el pedido antes de que se acabe el tiempo.
- Taxi: recoge pasajeros y llévalos a un lugar antes de que se acabe el tiempo.
- Paros 🤝: 51 personajes en las colonias (lejos de los lugares típicos) te piden un favor: llevar al gato al veterinario, pozole a la jefa, flores al panteón, croquetas al albergue de perritos, una perrita rescatada con su nueva familia... Se aceptan con E (botón ACEPTAR), tienen tiempo y pagan según la distancia. Están en `PAROS` de src/game.js.
- Vehículos: 10 tipos (sedán, vocho, troca, camioneta, tsurito, combi, muscle car, lowrider, calafia, camión de carga), cada uno limpio o sucio y madreado. Los sucios aguantan menos golpes y corren un poco menos. Se dibujan en `vehicleTexture()` de src/game.js.
- Escoltas 🚙🚙: convoyes de dos camionetas negras con torreta ámbar (no son policías) que cruzan la ciudad en fila, un poco más rápido que el tráfico. Se pueden robar.
- Conductores erráticos 💥: algunos autos zigzaguean, no frenan por nadie y tarde o temprano se estrellan y quedan deshuesados; el tráfico les da la vuelta.
- Moto deportiva 🏍️: la más rápida del juego, pero se hace pedazos al primer choque. Sale seguido en el tráfico (máximo dos a la vez).
- Patrullas 🚓: trocas de policía en el tráfico (máximo 3). Si las chocas te cobran multa ($150–800 según la velocidad, una cada 5 s). No se pueden robar.
- Secretos 🥚: 15 personajes y cosas típicas de Tijuana escondidos cerca de los lugares (el burro cebra, la ensalada César, Javier Bátiz, el Mimo Moy, el señor de los aviones, el pescador de la Presa...). Al encontrarlos sueltan una frase y una lana. Están en `EGGS` de src/game.js.

  ![Los 15 secretos](docs/easter-eggs.png)

El progreso se guarda en el navegador.

## Estructura
- `src/game.js` lógica del juego (render del mapa en trozos, tráfico, peatones, actividades, HUD).
- `src/style.css` interfaz.
- `data/centro.js` el mapa sin edificios (calles, areas, lugares, frontera) y el indice de regiones.
- `data/reg/X_Y.js` los edificios, en regiones de 819 m que el juego carga cerca de donde andas y suelta de lejos
  (asi el mapa puede crecer a toda Tijuana sin cargar todo de un jalon); `data/reg/X_Y.png` la capa de edificios
  del minimapa de cada cuadro.
- `tools/download_overture.py` descarga datos de Overture Maps (S3 público) para un recuadro (variable `TJ_BBOX="xmin,ymin,xmax,ymax"`, igual en prep_data.py; por defecto Centro + Zona Río).
  Uso: `python3 download_overture.py transportation segment id,class,subtype,names,road_flags,access_restrictions`
  (también `buildings building ...`, `places place id,names`, `base land_use ...`, `base water ...`).
- `tools/prep_data.py RAW_DIR data/centro.js` convierte esos GeoJSON al formato del juego y genera `data/reg/`
  (aquí se eligen los lugares y taquerías). Necesita Pillow para la capa del minimapa.
- `tools/build.py` genera (no se suben al repo, ver .gitignore) `dist/tjgta.html` (todo en un archivo) y `dist/tjgta-artifact.html`.

## Datos
Overture Maps Foundation, derivados de © colaboradores de OpenStreetMap (ODbL). Recuadro:
lon -117.048 a -116.878, lat 32.438 a 32.559 (Centro, Zona Norte, Zona Río, Chapultepec, Hipódromo, Agua Caliente, Libertad, Aeropuerto, Otay, La Mesa, Cerro Colorado y La Presa). La línea fronteriza es la de verdad (la orilla norte del polígono de México en `division_area`).
