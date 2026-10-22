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

## Controles

| Acción | Manos | Mandos |
|---|---|---|
| Despertar la pieza inicial | Tocarla con un dedo o hacer pinch sobre ella | Gatillo sobre ella |
| Agarrar | Pinch cerca de la pieza (unos 6 cm) | Gatillo |
| Soltar | Abrir el pinch | Soltar el gatillo |
| Reset | Juntar las palmas abiertas 1,5 s | Mantener ambos botones de agarre 1,5 s |

Toda la acción ocurre a menos de 60 cm de la cabeza y en un giro de menos de 90°.

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
  network.ts     Conexiones (grado ≤ 2), pulsos con reloj cuantizado, detección de circuitos
  audio.ts       Web Audio: 5 timbres sintetizados, HRTF por pieza, reverb generada, compresor + limitador, drone
  input.ts       Manos (pinch por distancia entre articulaciones) y mandos con una sola interfaz; puntas de dedos
  onboarding.ts  Título → pieza que respira → despliegue en arco
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
