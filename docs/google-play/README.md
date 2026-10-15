# TJ Rush en Google Play

Todo lo necesario para publicar la app. Las imágenes de esta carpeta ya tienen los tamaños que pide la tienda.

## 1. Archivos

| Qué | Archivo | Cómo se hace |
|---|---|---|
| Paquete para la tienda (AAB) | `android/app/build/outputs/bundle/release/app-release.aab` | `npm run aab` |
| APK firmada para compartir | `android/app/build/outputs/apk/release/app-release.apk` | `npm run apk:release` |
| Ícono 512×512 | `icono-512.png` | `node scripts/arte-app.mjs`, a partir del logo `scripts/logo-tjrush.jpg` |
| Gráfico destacado 1024×500 | `grafico-1024x500.png` | captura del juego + logo (`src/img/icono.png`) |
| Capturas de teléfono | `captura-1…7-*.png` (1536×864 y 864×1536) | capturas del juego |
| Aviso de privacidad | https://tonymoyoy.github.io/tjgta-proto/privacidad.html | `privacidad.html` (se publica al unir con `main`) |

### La llave de firma (¡importante!)

- Vive **fuera del repo**, en `~/tjrush-llaves/` (`tjrush-release.jks` y `keystore.properties` con las contraseñas).
  `android/app/build.gradle` la lee de ahí (o de la ruta en la variable `TJRUSH_KEYSTORE_PROPS`).
- **Respáldala** (USB, gestor de contraseñas, nube cifrada). Si se pierde, no se pueden publicar actualizaciones
  de las copias instaladas desde la APK firmada; con Play App Signing, Google puede cambiar la llave de *subida*.
- Huella SHA-256 del certificado: `3A:BB:D9:24:1C:7F:5B:00:8D:61:C0:4F:69:21:8F:DD:51:8E:A4:EF:C6:1C:57:81:5D:3C:BC:08:55:3E:66:DB`
- Al subir el primer AAB, Google ofrece **Play App Signing**: Google guarda la llave con la que firma la app
  y la tuya queda como llave de *subida*. Es lo recomendado. Consecuencia: las copias que instalaste a mano con la
  APK firmada no se actualizan desde Play (firma distinta); hay que exportar la partida, desinstalar e instalar desde Play.
- Las versiones de prueba (`npm run apk`, depuración) usan otra llave; para pasar de una a otra también hay que
  desinstalar (exporta la partida antes en ⚙️ Opciones → Tu partida).

### Antes de cada versión

En `android/app/build.gradle` sube `versionCode` (entero, siempre mayor) y `versionName` (lo que ve la gente).

## 2. Cuenta de desarrollador

- https://play.google.com/console · pago único de **25 USD** · verificación de identidad (INE/pasaporte).
- **Cuentas personales nuevas:** antes de publicar en producción hay que hacer una **prueba cerrada con al menos
  12 personas durante 14 días seguidos** (se les invita por correo; instalan desde Play). Conviene juntar a esas
  12 personas desde ya.

## 3. Ficha de la tienda

**Nombre** (máx. 30): `TJ Rush`

**Descripción breve** (máx. 80):
> Roba autos, haz taxi y recorre Tijuana del Centro al Hipódromo. Calles reales.

**Descripción completa** (máx. 4000):

> Recorre la Zona Centro, la Zona Norte, la Zona Río, Chapultepec y el Hipódromo de Tijuana en un juego de vista desde arriba, con las calles, los edificios y los lugares reales de la ciudad.
>
> 🚕 Súbete a lo que encuentres: vochos, tsuritos, trocas, calafias, lowriders y hasta el taxi libre de la Revu. Trabaja de taxista o róbale la moto a un repartidor y entrega su pedido antes de que se enfríe.
>
> 🤝 Hazle el paro a la gente de las colonias: lleva al gato al veterinario, el pozole a la jefa de Don Beto o el anillo que se le olvidó al novio de Paty.
>
> ★ Descubre los lugares de siempre: el Frontón Jai Alai, el Pasaje Rodríguez, el Hotel Caesar's, el Mercado Hidalgo, el Estadio Caliente y muchos más.
>
> 🌮 Haz la ruta del taco y colecciona los cafés de la ciudad. Cada colección completa tiene premio: correr sin cansarte, taquerías que te reparan el carro, la troca de tacos, Tijuana de noche… y si completas todo, el burro cebra dorado, una fiesta con mariachis y tu Acta de Tijuanense.
>
> 💬 La gente en la calle te habla: historia de la ciudad, futbol, la línea, el pocho, la comida y una que otra filosofía de banqueta.
>
> 🗺️ Mapa grande para marcar tu destino y una ruta que te lleva.
> 📱 Juega en horizontal o en vertical, con controles táctiles.
> 🔒 Sin anuncios, sin compras, sin cuentas. Tu partida se guarda en tu teléfono y puedes respaldarla en un archivo.
>
> Calles y edificios: © colaboradores de OpenStreetMap (ODbL) y Overture Maps Foundation.

**Categoría:** Juegos → Acción (alternativa: Aventura). **Etiquetas:** mundo abierto, conducción, México.

**Datos de contacto:** correo de desarrollador (obligatorio, lo pide la consola) y sitio web
`https://tonymoyoy.github.io/tjgta-proto/`.

**Imágenes:** ícono `icono-512.png`, gráfico destacado `grafico-1024x500.png`, de 2 a 8 capturas de teléfono
(`captura-*.png`). Sugerido: 2 calle, 3 avenida, 4 noche, 7 vertical, 5 mapa, 1 portada.

## 4. Contenido de la app (Panel → Contenido de la app)

- **Política de privacidad:** `https://tonymoyoy.github.io/tjgta-proto/privacidad.html`
- **Anuncios:** No contiene anuncios.
- **Acceso a la app:** Todas las funciones están disponibles sin restricciones (no hay inicio de sesión).
- **Seguridad de los datos:** No recopila datos · No comparte datos. (La exportación de partida y compartir el acta
  los inicia el usuario y van a la app que él elija; no los recibe el desarrollador.)
- **Público objetivo:** 13 años o más (no dirigida a niñas y niños: hay robo de autos y algunas referencias a alcohol).
- **App de noticias / salud / gobierno / préstamos:** No.
- **Cuestionario de clasificación (IARC)**, contestar con la verdad; lo que tiene el juego:
  - Violencia: choques entre autos y atropellar no muestran sangre ni heridas; la policía persigue (sin armas).
  - Actividad delictiva: **sí**, robo de autos (estilo caricatura, es el corazón del juego); un yonke que compra los carros robados; "coyotes" que ofrecen cruzarte la frontera y solo te estafan (pierdes dinero, nunca se cruza).
  - Lenguaje: groserías leves ("pinche").
  - Alcohol/drogas: referencias (tequila, michelada, bares de la Revolución); no se consumen en el juego.
  - Juegos de azar: no hay apuestas; solo dibujos de casino como parte de la historia de la ciudad.
  - Interacción entre usuarios, compras, ubicación: no.
  - Resultado esperado: alrededor de 12+/Adolescentes (lo decide el cuestionario).

## 5. Pasos para publicar

1. Crear la app en la consola (nombre TJ Rush, idioma español de México, juego, gratis).
2. Llenar "Contenido de la app" (sección 4) y la ficha (sección 3).
3. **Prueba cerrada:** subir `app-release.aab`, aceptar Play App Signing, agregar a los 12+ testers y esperar 14 días.
4. Solicitar acceso a producción, subir la versión y enviar a revisión (tarda de horas a unos días).
