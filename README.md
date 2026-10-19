# TJ Rush · Tijuana

Juego de vista cenital estilo GTA 2 en Tijuana, con calles, edificios y lugares reales. Cubre toda la ciudad, unos 32 x 19 km: de Playas
(con el mar) a El Florido y Terrazas del Valle, y de la línea al límite con Rosarito (Santa Fe, Natura, San Antonio del Mar), pasando por el
Centro, la Zona Río, Agua Caliente, Otay, La Mesa, las 5 y 10 y La Presa.
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
- Lugares ★: 59 lugares reales: del Centro (Arco, Plaza Santa Cecilia, Catedral, Caesar's, Jai Alai...), la Zona Río (CECUT, El Cubo, Las Tijeras, glorietas...),
  Agua Caliente e Hipódromo (Estadio Caliente, el Campestre...) Otay y La Mesa (Garita de Otay, Aeropuerto, UABC, Las 5 y 10, El Trompo, Parque Morelos...) La Presa (Estadio de los Toros, Mirador del Cerro Colorado, Presa Rodríguez...) Playas (El Muro en la Playa, Faro, Malecón, El Colef...) y las orillas (Santa Fe, Natura, El Florido...).
- Ruta del taco 🌮: 205 taquerías reales del mapa (las que llegaron con cada ampliación, a 700 m o más una de otra; desde la última, a 1.5 km).
- Cafés ☕: 176 cafés reales para coleccionar.
- Comida china 🏮: 6 locales ficticios en la Calle Coahuila; al entrar pierdes dinero (no se coleccionan).
- Repartidor 🛵: roba una moto de repartidor (scooter con caja térmica verde, naranja, roja o azul) y entrega el pedido antes de que se acabe el tiempo.
- Taxi: recoge pasajeros y llévalos a un lugar antes de que se acabe el tiempo.
- Paros 🤝: 59 personajes en las colonias (lejos de los lugares típicos) te piden un favor: llevar al gato al veterinario, pozole a la jefa, flores al panteón, croquetas al albergue de perritos, una perrita rescatada con su nueva familia... Se aceptan con E (botón ACEPTAR), tienen tiempo y pagan según la distancia. Están en `PAROS` de src/game.js.
- Vehículos: 10 tipos (sedán, vocho, troca, camioneta, tsurito, combi, muscle car, lowrider, calafia, camión de carga), cada uno limpio o sucio y madreado. Los sucios aguantan menos golpes y corren un poco menos. Se dibujan en `vehicleTexture()` de src/game.js.
- Escoltas 🚙🚙: convoyes de dos camionetas negras con torreta ámbar (no son policías) que cruzan la ciudad en fila, un poco más rápido que el tráfico. Se pueden robar.
- Conductores erráticos 💥: algunos autos zigzaguean, no frenan por nadie y tarde o temprano se estrellan y quedan deshuesados; el tráfico les da la vuelta.
- Moto deportiva 🏍️: la más rápida del juego, pero se hace pedazos al primer choque. Sale seguido en el tráfico (máximo dos a la vez).
- Transporte público 🚌: camiones urbanos (y las calafias) que van a todo lo que da, rebasan, no frenan en los topes, se paran de golpe a subir pasaje y, si te les atraviesas, te pegan por detrás y te pitan. Se pueden robar.
- Pipas de gas ⛽: andan despacio por las colonias con su cancioncita. Al primer golpe fuerte se les sale el gas; al segundo explotan y la onda expansiva revienta los carros de alrededor (en cadena). Se pueden robar, con cuidadito.
- Explosiones 💥: destello, bola de fuego, chispas, pedazos, onda expansiva, humo negro, tizne en el piso y luz de noche; los carros de junto salen dañados.
- Personajes de la calle 🌽: entre la gente caminan eloteros y paleteros con su carrito, turistas con camisa hawaiana y cámara, albañiles con casco y cubeta, señoras del mandado, mamás con carriola, corredores, luchadores enmascarados, gente de la maquila con bata y gafete, estudiantes de uniforme, el señor de los globos y músicos con guitarra. Cada uno tiene sus frases.
- Perros callejeros 🐕: de varias razas (caramelo con paliacate, negro, con manchas, chihuahua, gris y peludo); caminan por la banqueta, se paran a olfatear y le ladran a quien pasa. Si atropellas uno sale chillando (entero, pero ofendido) y te cae el karma al azar: llega la jauría del barrio y te persigue mordiendo las llantas (o los tobillos), se te poncha una llanta (no corre y se jala de lado 45 s) o alguien grabó el video y pagas el veterinario.
- Rateros 🦹: si te quedas parado en el carro unos segundos, a veces sale uno corriendo de la banqueta hacia tu puerta. Si llega, te baja y se va manejando como loco, gritando y pitando. Si arrancas antes, se rinde; si alcanzas tu carro, lo recuperas con E.
- Patrullas 🚓: trocas de policía en el tráfico (máximo 3). Si las chocas te cobran multa ($150–800 según la velocidad, una cada 5 s). No se pueden robar.
- Secretos 🥚: 19 personajes y cosas típicas de Tijuana escondidos cerca de los lugares (el burro cebra, la ensalada César, Javier Bátiz, el Mimo Moy, el señor de los aviones, el pescador de la Presa, el surfista de Playas, un venado en Natura...). Al encontrarlos sueltan una frase y una lana. Están en `EGGS` de src/game.js.

  ![Los 19 secretos](docs/easter-eggs.png)

El progreso se guarda en el navegador (en la app, también en el almacén del teléfono), junto con dónde te quedaste: al volver a abrir apareces en el mismo lugar, y si ibas manejando, en el mismo carro.

Los árboles son sólidos: no se pueden atravesar a pie ni en carro (chocar fuerte contra uno daña el carro, como una pared, y los conductores erráticos se estrellan con ellos). Las copas van encima: la gente camina por debajo de ellas.

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
  (aquí se eligen los lugares y taquerías). Necesita Pillow (capa del minimapa) y shapely (el mar y la línea fronteriza
  en la costa).
- `tools/build.py` genera (no se suben al repo, ver .gitignore) `dist/tjgta.html` (todo en un archivo) y `dist/tjgta-artifact.html`.

## Datos
Overture Maps Foundation, derivados de © colaboradores de OpenStreetMap (ODbL). Recuadro:
lon -117.142 a -116.800, lat 32.390 a 32.565 (de Playas a Terrazas del Valle y de la línea al límite con Rosarito). El mar es el polígono del océano de Overture recortado al recuadro. La línea fronteriza es la de verdad (la orilla norte del polígono de México en `division_area`).
