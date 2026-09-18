# CAR WARS 3D — arquitectura

Juego de coches 3D para Chrome/Chromebook que se ejecuta **desde archivos locales**
(`file://`) y **sin conexión**: ni CDNs, ni `fetch`, ni módulos ES, ni recursos externos.
Cada `<script>` clásico define un IIFE que cuelga todo del namespace global `window.CW`
(atajo `G`). El orden de carga de `car_wars.html` es el orden de dependencias.

```
car_wars.html            ← doble clic para jugar
css/style.css            ← menú, HUD, controles táctiles (nada externo, ni fuentes)
js/core.js       G        utilidades: clamp/lerp/damp, ruido value/fbm, color, store, errores
js/math3d.js     G.M      matrices 4x4 column-major, vectores, persp/lookAt/ortho, proyección
js/textures.js   G.Tex    texturas procedurales dibujadas en <canvas> 2D (asfalto, roca, fachadas…)
js/primitives.js G.Builder constructor de geometría (loft, tube, poly, box, sphere, rock, peak, mesa, ribbon)
js/renderer.js   G.Renderer/GLSL  WebGL2 diferido: materiales en UBO, instancing, sombras PCF,
                                  skydome procedural, nubes FBM, partículas billboard
js/meshes.js     G.Assets  materiales por clave, mallas base (wheel/plane/beam), kits de 5 coches
js/mapdata.js    G.Path/G.MAPS  splines Catmull-Rom → centro de pista, peralte, elevación,
                               límite de curvatura, máscara de distancia 2D (G.Mask)
js/world.js      G.World  construye el mundo del mapa: terreno, pista, aceras, bordillos,
                           decorado instanciado, ciudad, túnel, checkpoints, parrilla, minimapa
js/entities.js   G.Car/G.physics/G.aiDrive/G.FX  físicas arcade con derrape, IA, colisiones, partículas
js/ui.js         G.Input/G.HUD/G.Screens  teclado+mando+táctil, velocímetro y minimapa 2D, menús
js/audio.js      G.Sound  motor de audio WebAudio 100 % procedural (motor, rodadas, viento, música)
js/game.js       G.Game/G.MODES/G.boot  bucle, 5 modos de juego, cámara, luces dinámicas, récords
tools/*.js       verificaciones en Node, sin GPU (stubdom.js finge canvas 2D y WebGL2)
```

## Pipeline de un fotograma

1. `Game.frame(ts)` acumula tiempo y simula a paso fijo `1/100 s` (máx. 6 subpasos).
2. Cada subpaso: entrada → `aiDrive` para los rivales → `physics` por coche → `carCollisions`
   → progreso/vueltas/checkpoints → efectos (`FX.update`).
3. `updateCam` (4 cámaras: persecución, capó, cinemática, ala) y `updateLights`
   (≤ 16 luces dinámicas: faroles cercanos + faros/pilotos/nitro de los coches próximos).
4. `Game.draw` re- instancia los coches (un grupo por pieza, compartido por estilo),
   los anillos de checkpoint y fija `R.shadowCenter` sobre el jugador; luego
   `R.render(dt)`: **shadow pass** (ortográfico, 1024–2048², sólo grupos estáticos y cuerpos)
   → **skydome** procedural → **opaques** (frustum culling por esfera por instancia,
   materiales en un UBO de 40 entradas, tintes por instancia) → **partículas** aditivas
   → **translúcidos** (cristales, haces de luz, humo).
5. `HUD.draw` pinta en un 2D `canvas` superpuesto: velocímetro, marcha, nitro, minimapa,
   tiempos y avisos.

## Convenciones que hay que respetar al tocar el código

* **Espacio**: `+Y` arriba, avance = `+Z`, `yaw` medido desde `+Z` hacia `+X`
  (`forward = (sin yaw, cos yaw)`), igual que `M.fromRotYPivot`.
* **Matrices** column-major `Float32Array(16)`. Los floats `m[3], m[7], m[11]` de la última
  columna transportan el **tinte por instancia** (`M.setColor`; `null` = sin tinte).
* **Mallas** en espacio local del objeto; las del kit de coche ya están en espacio del coche,
  por eso se componen con identidad y sólo varían las ruedas.
* **Texturas**: máx. 12 en slots (`MAX_TEX`), la unidad 12 es el mapa de sombras.
  Un material no usado no ocupa slot; el test falla si se supera.
* **Materiales** se buscan por clave en `W.mats` (`terrain, ground, water, shoulder, road,
  curb, grid, metal, rail, wall, rock, mount, building, lampGlow, neonSign, banner, roofTop,
  leaf, leafDry, bark, tire, plastic, checkpoint, paint, glass, dark, head, tail, rim, beam, neon`).
* Todo lo estático se `lock()`-ea tras construirlo (subida única al GPU); los grupos
  dinámicos se vacían con `clear()` cada fotograma.

## Pista y máscara (`mapdata.js`)

`G.makeTrack(spec)` toma `spec.ctrl` (puntos de control), cierra la spline, **limita la
curvatura** (`limitCurvature`, radio mínimo por mapa), remuestrea a paso uniforme, calcula
peralte (`bankProfile`), elevación (`elevProfile`), radios (`curveRadius`) y construye
`G.Mask`: una rejilla (288²) con distancia exacta al eje (transformada de distancia
vectorial de 2 pasadas) y el índice de segmento más cercano, con muestreo bilineal.
De ahí salen `dist`, `seg`, `pull` (hacia el eje), `grad` y `progress` — la misma
máscara decide el límite de pista, dónde se coloca el decorado y el progreso de vueltas.

### Límites de pista (colisiones) y cámara

`G.limitAt(world, x, z, idx, out)` busca el segmento de pista **más cercano dentro de una ventana
de índices** alrededor del último índice conocido del coche (`car.segIdx`, sembrado en el spawn y
refinado cada paso). Eso es lo que usa la colisión con el muro; `mask.dist()` (vecino *global*)
sólo se usa para referencias. La diferencia importa: en los 4 mapas hay "cuellos" donde dos tramos
pasan a ~15 m, y con la distancia global el coche quedaba "más cerca del otro tramo" que del suyo →
el límite se apagaba y te salías del mapa por encima de la valla.

La resolución es **continua (CCD)**: se mide la lateral en el punto de partida y en el de llegada
del subpaso, se interpola el instante de contacto `t`, se recoloca el coche en la cara interior de
la banda (`halfW + 0.95` m) y se refleja la componente saliente con 34 % de rebote. Además hay
caja dura en `±(world-4)` y el suelo es un plano duro (el coche nunca se hunde).
`Game.frame` simula a 120 Hz (100 Hz en calidad baja) con hasta 12 subpasos.

### Sólidos del escenario y sensación de peso

`World.build` deriva un collider circular del **bounding box del propio mesh** de cada roca, mesa,
hangar, silo, torre, muro o grada (`W.solids[]` + rejilla espacial de 18 m en `W.solidsNear`), y la
colisión resuelve el **segmento barrido** por el coche, así que no se atraviesa a ninguna velocidad.
Además, en la colocación se descarta cualquier实例 cuyo borde quede a <0.35 m del asfalto (medido con
la distancia exacta a la polilínea, no con la máscara suavizada).

El coche no sigue el relieve ciegamente fuera de la pista: `targetY` se limita a `pista.Y + 0.30 +
0.55·(desplome lateral)`, para que el terraplén junto a la valla no funcione como rampa de saltos.

En los choques coche-coche (`carCollisions`) la separación y el impulso se reparten por **masa
inversa**, hay fricción de chasis con tope de Coulomb, el par de giro se calcula como
brazo·impulso/(m·k) con tope, y el rebote es e=0.22. El chute viejo de guiñada metía ~448°/s en un
T-bone; ahora ~96°/s. La cámara lee `car.aLong/aLat` (aceleraciones suavizadas de la física) para
el retroceso, la zambullida, el alabeo y el FOV (hasta +15° según la punta de CADA coche).

La cámara (`Game.updateCam`) se recorta después de cada modo: por encima de `height.at()+1.35`,
dentro del corredor `limitD + 7.5` alrededor del tramo del coche y dentro de la caja del mundo,
para que no veas el vacío si el coche queda pegado a la valla.

### Derrape

Modelo de dos estados. Sin input de derrape, el régimen de giro está limitado por el círculo de
fricción (`yawRate ≤ a_lat/v`) y la fricción lateral trasera es muy alta (`gripLat` 27→18,
`latCap = 2.75·a_lat`): el coche **subvira** en vez de deslizar. Con `SHIFT`/`Espacio`
(`car.handbrake` o `car.driftKey`) el tope baja a `1.18·a_lat`, `gripLat` cae ~82 % y se permite
sobre-rotar (`1.62×`): el ángulo crece y `car.drifting` se activa a partir de 15° y 3.2 m/s de
deslizamiento con >9 m/s. `opts.driftAuto` (menú «Derrape: automático») permite además romper la
tracción sin tecla si el ángulo supera 23°. El modo Drift Attack puntúa con el mismo umbral.

El campo de alturas del mundo (`W.height`, rejilla 200²) **incluye el peralte y la
inclinación de la calzada** y decae a la cota base fuera de la pista; la malla de terreno
muestrea esa misma rejilla, así que el coche y lo que se ve coinciden exactamente.

## Modos de juego

| modo | regla | victoria/fin |
|---|---|---|
| `race` | 2–8 vueltas contra 5 IA, cuenta atrás, clasificación por progreso | puesto + mejor vuelta |
| `attack` | cronometrado: cada checkpoint suma 12 s | se acaba el tiempo |
| `drift` | 90 s sumando ángulo × velocidad, cadena y medidor de nitro | tiempo agotado |
| `chase` | eres la patrulla: quédate a < 7 m de cada fugado 1 s para detenerlo (+10 s) | 4 detenidos o tiempo |
| `free` | sin cronómetro, con tráfico IA, puedes salir a explorar | — |

Récords en `localStorage` (claves `cw_records`, `lap:<mapa>:<modo>`, `race:<mapa>`).

## Cómo ampliar

* **Mapa nuevo**: añade una entrada a `G.MAPS` en `js/mapdata.js` (`ctrl`, `w`, `world`,
  `elev`, `bank`, `minR`, `env`, `ground`, `road`, `props`, `decor`) → pasa `check-maps` y
  aparece solo en el menú. `node tools/check-maps.js` valida radios, cruces y pendientes.
* **Coche nuevo**: una entrada en `G.CARS` de `js/meshes.js` + su forma en `carPart`
  (usa `prof`/`plate`); las físicas leen `stats` y la IA el `grip`/`power`.
* **Pieza de decorado**: función en `scenery()` de `js/world.js` (partes → materiales) y
  úsala en `decor[].type`; el colocador ya respeta el anillo, la separación y el peralte.
* **Modo**: objeto en `MODES` de `js/game.js` con `setup/update/hud/checkpoint/lapDone`;
  `update` devuelve `false` para bloquear el control (cuenta atrás, tiempo agotado).

## Verificación (sin GPU ni navegador)

```
node tools/all.js          # ejecuta las 6 suites
```

| suite | qué comprueba |
|---|---|
| `check-shaders.js` | glslang valida los 10 GLSL (ES 3.0), con `MAX_TEX`/`MAX_MATS` reales |
| `check-geo.js` | 99 comprobaciones de primitivas: cerrados, normales, UV, `peak`/`mesa` |
| `check-maps.js` | 80: radios > 16 m, sin autointersecciones, peralte/elevación suaves, máscara exacta ±0.5 m |
| `check-physics.js` | 51: 0-100 y techo por coche, frenada, derrape con freno de mano, muro, terreno, IA 100 s en los 4 mapas, colisiones, pool de partículas |
| `check-world.js` | 190: los 4 mundos se construyen; matrices de instancia finitas; materiales/texturas dentro de límites; alturas y normales válidas; presupuesto de triángulos; `dispose()` limpio |
| `check-game.js` | 515: 4 mapas × 5 modos simulados y **dibujados** (GL simulado) sin excepciones; vueltas y checkpoints reales; HUD sin `NaN`/`undefined`; draw calls y luces acotados; cámaras; récords persistidos; pausa/respawn |

`tools/stubdom.js` pone el `document`, `navigator`, un `<canvas>` con contexto 2D falso y un
`WebGL2` Proxy que registra llamadas: el motor de render se ejecuta de verdad (culling, subida
de buffers, uniformes) sin GPU. Lo único que **no** puede validar este entorno es el aspecto
final de los shaders en pantalla y el rendimiento real.
