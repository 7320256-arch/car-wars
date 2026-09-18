# CAR WARS 3D

Juego de coches **3D real (WebGL2)** en local: 4 circuitos, 5 modos, 5 coches, IA, derrapes,
sombras, partículas, minimapa, mando/táctil y sonido procedural. Sin dependencias, sin CDNs,
sin conexión: se abre con doble clic.

## Jugar (dos formas)

**A. Archivo único — recomendado para descargar/compartir**
Abre **`car_wars_standalone.html`** con Chrome (doble clic). Es *un solo archivo* de ~290 kB con
el CSS y los 12 .js incrustados: no necesita ninguna carpeta a su lado. Muévelo a donde quieras,
sigue funcionando. Se genera con `node tools/build-single.js` (después de tocar `js/`).

**B. Versión de proyecto (varios archivos, editable)**
Copia la **carpeta completa** `car_wars/` (con `js/` y `css/` dentro) y abre `car_wars/car_wars.html`.
⚠️ Si mueves sólo el `car_wars.html` fuera de la carpeta no habrá nada que cargar: en ese caso
la pantalla de carga lo dice («Falta el código del juego junto al HTML») en vez de quedarse en blanco.

En ambos casos: elegir circuito + modo + coche y pulsar **SALIR A PISTA**. No hace falta servidor
ni internet. Para servirlo por red local: `python3 -m http.server 8000` dentro de la carpeta y
abrir `http://localhost:8000/car_wars.html`.

## Controles

| acción | teclado | mando | táctil |
|---|---|---|---|
| acelerar / frenar | `W`/`S` o ↑/↓ | RT / LT | pedales derecha |
| girar | `A`/`D` o ←/→ | stick izq. | pads ◀ ▶ |
| freno de mano (derrape) | `Espacio` | ✕ o LB/RB | DERRAPE |
| nitro | `Shift` o `E` | ◻ | NITRO |
| cámara (4 vistas) | `C` | Back | — |
| reponer en pista | `R` | — | — |
| luces / minimapa / pausa | `L` / `Tab` / `P` o `Esc` | Start | — |
| silencio | `M` | — | — |

En pantallas táctiles los botones aparecen solos; con mando conectado se usa al instante
(no hay que pulsar nada). El primer clic/tecla activa el audio (política de Chrome).

## Qué incluye

* **4 circuitos**: Bahía del Sol (costero, con playa y agua), Neón Ciudad (nocturno, rascacielos
  con ventanas procedurales, neones, 86 faroles con luz real), Cañón Rojo (desierto, mesetas,
  **túnel** de 6 % de vuelta), Aeródromo 22 (oval ancho de pista de aterrizaje, peralte alto).
* **Sombras**: shadow-map (PCF) en media/alta y un *blob* de contacto en todas — incluidas
  móviles/qualidad baja — para que ningún coche «flote». La casilla «Sombras» del menú ahora sí manda.
* **Colisión con el escenario**: rocas, mesas, hangares, torres y muros tienen collider derivado del
  *bounding box de su propio mesh*, resuelto con barrido (no los atraviesas a 240 km/h) y colocados
  de forma que ningún sólido invada el asfalto.
* **Cámara con peso**: damping con constante de tiempo dependiente de la velocidad, retroceso al
  acelerar / zambullida al frenar, se sale fuera en el deslizamiento, alabeo en curva, *look-ahead*
  sobre la velocidad real y FOV que crece hasta +15° cerca de la punta de CADA coche.
* **5 modos**: Carrera (vueltas + clasificación + cuenta atrás), Crono CPA (checkpoint = tiempo),
  Drift Attack (cadenas y multiplicador), Persecución (detener 4 fugados) y V libre.
* **Físicas** arcade con derrape por límite de neumático, transferencia de carga, peralte
  y bacheado del terreno, daños, rebotes y colisiones coche-coche.
* **Render**: iluminación diferida con UBO de materiales, sombras PCF follow-cam, skydome
  procedural con nubes FBM, niebla por distancia, haz de faros, tintes por instancia,
  ~70 grupos y 60–100 k triángulos por mapa (instancing masivo de decorado).
* **Récords** locales por mapa y modo (vuelta rápida, tiempo de carrera, puntos de drift).

## Verificar el código

```
node tools/all.js
```

Siete suites que ejercitan shaders, geometría, mapas, físicas/IA, construcción del mundo
y el juego entero (simulación + render con GL simulado). Detalle en `docs/ARCHITECTURE.md`.
