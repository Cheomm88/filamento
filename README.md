# Filamento

**Dibujas música con luz, a un brazo de distancia.**

Experiencia VR sensorial para Meta Quest 3 (navegador, WebXR), pensada para jugarse sentado y solo con las manos. Candidata a los Premios INMERSIVA XR 2026, categoría *Mejor diseño de interacción*.

## Concepto

Oscuridad total. Delante de ti, una sola pieza de neón respira. Al tocarla aparecen seis más, desplegadas en arco al alcance del brazo.

- Coges una pieza con un pinch (índice + pulgar), la mueves y la sueltas: se queda flotando donde la dejaste.
- La **altura** de cada pieza es su nota, siempre dentro de la pentatónica menor de La (2 octavas), así que nunca suena disonante.
- Dos piezas a menos de 35 cm se unen con un **hilo de luz**. Cada pieza se une como máximo a sus 2 vecinas más cercanas.
- Al soltar una pieza, un **pulso** de luz sale de ella y recorre la cadena. Al llegar a cada pieza, esta suena y destella.
- La **distancia es tiempo**: piezas cerca = notas rápidas, lejos = lentas. Los tiempos se ajustan a una rejilla de semicorcheas a 96 BPM, de modo que varios circuitos siempre suenan juntos.
- **El descubrimiento:** si los hilos forman un bucle cerrado, el pulso sigue dando vueltas para siempre y la oscuridad respira. La niebla se tiñe del color del circuito con cada nota y aparece una capa armónica grave. Ningún texto lo anuncia.

Cada forma tiene su timbre: esfera = campana, anillo = pluck, tubo = pad, prisma = bajo, punto = percusión suave.

## Componer un tema

Después del primer bucle cerrado, Filamento se convierte en un instrumento para hacer canciones. Todo se revela poco a poco, sin texto:

- **La fuente:** bajo el arco aparece una fila de siluetas apagadas, una por forma. Pellizca una para sacar una pieza nueva; puedes repetir formas (hasta 32 piezas en total). Suelta una pieza sobre la fuente para retirarla.
- **Guardar un bucle:** agarra un bucle cerrado por su hilo y súbelo. Se encoge mientras sube y, si lo sueltas arriba, queda guardado en miniatura en la **cúpula**, sobre tu cabeza y al alcance del brazo. Sigue sonando y deja libre el área de trabajo para el siguiente bucle (caben 11).
- **Arreglar:** un pellizco corto sobre un bucle guardado lo silencia o lo reactiva. Así haces estrofa, estribillo y puente activando y desactivando capas.
- **Editar:** baja un bucle guardado al área de trabajo y recupera su tamaño. Como la altura es la nota, al moverlo arriba o abajo se transpone.
- **Todo cuadra en compases:** la duración de cada bucle se redondea a medios compases (8 semicorcheas) y empieza en el siguiente medio compás. Cualquier combinación de bucles suena como un tema.
- **Compartir:** el tema (formas, notas, ritmo, silencios) se guarda en la URL (`#t=…`). En pantalla aparece el botón **Compartir tema**; en VR aparece en la página de entrada al salir. Quien abre el enlace escucha tu tema en VR o en el móvil y puede seguir componiendo.

## Controles

| Acción | Manos | Mandos |
|---|---|---|
| Despertar la pieza inicial | Tocarla con un dedo o hacer pinch sobre ella | Gatillo sobre ella |
| Agarrar | Pinch cerca de la pieza (unos 6 cm) | Gatillo |
| Soltar | Abrir el pinch | Soltar el gatillo |
| Mover un bucle entero | Pinch sobre su hilo | Gatillo sobre su hilo |
| Silenciar o reactivar un bucle guardado | Pinch corto sobre él | Clic corto de gatillo |
| Reset | Juntar las palmas abiertas 1,5 s | Mantener ambos botones de agarre 1,5 s |

El primer reset limpia el área de trabajo y deja sonando los bucles guardados. Un segundo reset borra también el tema.

Toda la acción ocurre a menos de 60 cm de la cabeza y en un giro de menos de 90°.

## Modo pantalla (móvil, tablet, escritorio)

La misma URL funciona sin casco: **Jugar en pantalla** (o **Empezar**, si el dispositivo no tiene VR).

- Las piezas viven en un plano frontal. **Altura en la pantalla = nota**, **distancia = tiempo**, igual que en VR.
- Arrastra con el dedo (o con el ratón). Se pueden mover dos piezas a la vez.
- Los bucles guardados viven en dos filas arriba de la pantalla y la fuente en la fila de abajo. Arrastra un bucle por su hilo hacia arriba para guardarlo y toca uno guardado para silenciarlo.
- **Reset:** mantén dos dedos sobre la pantalla, sin tocar piezas, durante 1,5 s.
- El espacio de juego se adapta a la pantalla, en vertical o en apaisado: umbral de conexión, velocidad del pulso y franja de notas se reescalan.
- Leve paralaje con el giroscopio: al inclinar el móvil, la escena se mueve un poco.
- Audio con paneo estéreo, más ligero que el HRTF que se usa en VR.
- La pantalla no se apaga mientras juegas (Wake Lock).

**Instalable (PWA):** en Android, Chrome ofrece *Añadir a pantalla de inicio* y se abre a pantalla completa. Funciona sin conexión tras la primera visita. Para publicarlo en Play Store se puede empaquetar como TWA con [Bubblewrap](https://github.com/GoogleChromeLabs/bubblewrap) sin cambiar el código.

## Ejecutar en local

Requisitos: Node 20+.

```bash
npm install
npm run dev
```

Abre `http://localhost:5173`. En desarrollo se carga automáticamente [IWER](https://github.com/meta-quest/immersive-web-emulation-runtime), que emula un Quest 3 con hand tracking. Pulsa **Entrar en VR** y usa el panel de IWER para mover las manos y hacer pinch (campo *Pinch* o teclado). IWER no se incluye en el build de producción.

Para probar en el Quest desde tu red local, WebXR necesita HTTPS. La forma más rápida es desplegar en GitHub Pages; otra opción es un túnel HTTPS (por ejemplo `cloudflared` o `ngrok`) hacia el puerto 5173.

**Contador de FPS:** siempre activo en `npm run dev`. En producción se activa añadiendo `?fps` a la URL. Dentro de VR aparece como un pequeño panel en la esquina inferior de la vista.

## Desplegar en GitHub Pages

1. Crea un repositorio en GitHub y sube el proyecto a la rama `main`.
2. En el repositorio, ve a **Settings → Pages → Build and deployment** y en **Source** elige **GitHub Actions**.
3. Cada push a `main` ejecuta `.github/workflows/deploy.yml`, que compila y publica la carpeta `dist`. La URL pública (HTTPS) aparece en la pestaña *Actions* y en *Settings → Pages*.

Vite usa rutas relativas (`base: './'`), así que no hay que configurar el nombre del repo.

## Estructura

```
src/
  config.ts      Todas las constantes de diseño: colores, radios, velocidad, BPM, escala, niebla…
  main.ts        Arranque: página de entrada, sesión WebXR, IWER en desarrollo, bucle principal
  experience.ts  Orquestación: input → piezas → red → audio y atmósfera; agarrar/soltar, reset
  scene.ts       Renderer, niebla, polvo instanciado, resplandor de la niebla, título
  pieces.ts      Piezas: contornos planos y huecos (trazo de neón, interior negro) mirando al usuario, halo, onda por nota
  network.ts     Conexiones (grado ≤ 2), pulsos con reloj cuantizado, bucles a compás, constelaciones guardadas
  audio.ts       Web Audio: 5 timbres sintetizados, HRTF por pieza, reverb generada, compresor + limitador, drone
  input.ts       Interfaz común de punteros; manos (pinch por distancia entre articulaciones) y mandos; puntas de dedos
  touch.ts       Modo pantalla: cámara y espacio de juego adaptados a la pantalla, toques/ratón, giroscopio
  onboarding.ts  Título → pieza que respira → despliegue en arco
  dispenser.ts   Fuente de piezas (siluetas para sacar y retirar piezas)
  song.ts        Tema en la URL: codificar y decodificar los bucles guardados
  fps.ts         Contador de FPS de desarrollo
```

## Decisiones de diseño

- **Ritmo cuantizado:** la duración de cada tramo se redondea a 1–4 semicorcheas de un reloj global. Así se mantiene "cerca = rápido", pero nunca hay desfases.
- **Las piezas del arco inicial no se enlazan entre sí** hasta que mueves al menos una de ellas, para que la escena no aparezca ya conectada.
- **Las cadenas abiertas suenan una vez** al soltar una pieza. Solo un circuito cerrado suena de forma indefinida: es el premio.
- **Mientras arrastras** se ven hilos fantasma tenues hacia las piezas con las que conectarías. Las conexiones reales solo se fijan al soltar.
- **Margen de agarre:** durante los primeros 0,3 s del pinch también se acepta el agarre, porque al cerrar los dedos su punta se desplaza unos centímetros.

## Rendimiento

Sin sombras, sin luces, sin post-procesado. Todos los materiales son *unlit* y se comparten (uno por color). El polvo y las puntas de los dedos usan instancing. Los halos son sprites aditivos con una única textura generada por código. Cada pieza tiene un `PannerNode` HRTF, y las notas crean nodos efímeros que se liberan al terminar.
