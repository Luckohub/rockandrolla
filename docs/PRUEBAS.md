# Pruebas realizadas y pendientes

Fecha: 2026-10-20. Equipo: Windows 11 Pro 22631, Chrome 155.0.8059.85, Edge 155.0.4283.62, Node 24.16.0, Emscripten 6.0.10.

## Realizadas y superadas

### Compilación

| Prueba | Resultado |
|---|---|
| Compilación limpia completa con `scripts\build.ps1 -Tests -Bench` | Correcta en 1,6 min. `rockanrola.wasm` mide 2,12 MB, unos 650 KB con gzip |
| Reproducibilidad: dos compilaciones limpias consecutivas | `rockanrola.wasm` idéntico bit a bit (SHA-256 `CFFE9540…0118D1`) |
| Núcleo del proyecto original con `-Wall -Wextra -Wpedantic -Werror` en Clang | Correcto. Solo se relajaron dos avisos en dos archivos C++ (ver informe) |

### Pruebas sin ROM ejecutadas en WebAssembly con Node

| Prueba | Origen | Resultado |
|---|---|---|
| `test_v10_2_native` (CPU estática, RTI, guardas de índice) | Original | PASS |
| `test_v10_2_machine` (máquina, reinicio, bus) | Original | PASS |
| `test_v10_2_ppu` | Original | PASS |
| `test_v10_2_audio` | Original | PASS |
| `test_v10_2_static_dsp` (DSP de 32 fases) | Original | PASS |
| `rnr_input_contract_test` (constantes de botones y retención de pulsaciones) | Original | PASS |
| `test_port_sha256` (vectores FIPS 180-4, incluido el millón de "a", directo y vía la API BCrypt sustituta) | Rockanrola | PASS |
| `test_port_rom_rejection` (el núcleo rechaza tamaños erróneos y datos sintéticos de 1 MiB con el mensaje correcto) | Rockanrola | PASS |

### Navegador (prueba automática con `scripts\browser-test.mjs`)

Ejecutada en Chrome y Edge con el servidor local y la misma política CSP prevista para producción: **10/10 comprobaciones superadas en cada navegador**.

1. La portada se muestra.
2. Al pulsar «Jugar», el motor se descarga, compila e inicializa, incluida la autoprueba SHA-256. Tarda unos 300 ms en local.
3. Un archivo de tamaño incorrecto se rechaza con un mensaje en español que indica el tamaño esperado.
4. Un archivo de 1 MiB que no es la ROM se rechaza mostrando el SHA-256 obtenido y el esperado.
5. El AudioWorklet carga bajo la CSP y consume PCM sintético de 32 040 Hz al ritmo correcto, con el dispositivo a 48 000 Hz.
6. No hay errores de consola.
7. No hay excepciones de JavaScript.
8. No hay solicitudes fallidas.
9. El área de juego (vacía, sin ejecutar el juego) mantiene la proporción 4:3 en escritorio: lienzo de 864×648 a 1280×900.
10. En un teléfono de 390 px de ancho, el lienzo mide 358×268 y no hay desplazamiento horizontal.

### Juego real con la ROM del usuario

ROM verificada: Rock n' Roll Racing (USA), SHA-256 `9d721753…4b182`, aportada por el usuario en `rom/` como `.zip` y `.sfc`.

| Prueba | Resultado |
|---|---|
| Motor en Node, 3 600 frames (60 s de juego) | Sin paradas del núcleo. Audio: 1 919 697 frames estéreo, esperado ~1 919 239 |
| Rendimiento del motor en Node, antes de optimizar | 35 fps: no alcanzaba tiempo real |
| Rendimiento del motor en Node, después de optimizar | 110 fps |
| Equivalencia de las optimizaciones, 1 800 frames | Hash de video, instrucciones y PCM idénticos |
| Arranque directo desde `rom/` sin clics, Chrome y Edge | 0,5–0,7 s hasta el juego |
| Ritmo en el navegador | 60,0 fps en Chrome y Edge. CPU por frame: 6–14 ms en Chrome, 11 ms en Edge |
| Menús con teclado | Los toques de Start llegan a la pantalla «Select Hero» |
| Audio | Activo, con 90–130 ms en búfer. Cortes contados: 1 en Chrome y hasta 12 en Edge sin interfaz. Falta verificarlo a oído |
| Pausa y reanudación con P, guardar y cargar estado | Correctos |
| Consola, excepciones, solicitudes fallidas | Sin errores |

`node scripts\browser-test.mjs --local-rom` superó 11/11 comprobaciones en Chrome y 12/12 en Edge. La de Edge incluye además la comprobación de pausa automática.

### Teclas, pantalla completa y juego online

| Prueba | Resultado |
|---|---|
| Pantalla completa con el juego real | La imagen 4:3 entra completa y centrada: lienzo de 1073×805 en una ventana de 1264×805. Ahora el ajuste se resuelve solo con CSS |
| Mando 2 en el hardware, con `rnr_p2_check.js` | El estado del jugador 2 llega a los registros `$421A/$421B` que lee el juego, sin afectar al jugador 1 |
| `node scripts\online-test.mjs`, dos ventanas del mismo navegador | 23/23 en Chrome y 23/23 en Edge |

`online-test.mjs` verifica lo siguiente:

- El anfitrión abre una sala en 0.peerjs.com.
- El invitado no descarga el motor ni la ROM.
- El video de 512×448 llega en unos 3 s, sin avisos encima y con pista de audio.
- WebRTC entrega al invitado cada cuadro que dibuja el anfitrión, a 55–60 por segundo, sin pérdidas y con 10–30 ms de búfer.
- Las teclas del invitado llegan como mando 2: Derecha da la máscara `0x100` y se libera al soltar.
- Se muestra la latencia de ida y vuelta.
- La pausa desde el invitado llega a ambas pantallas, y la salida del invitado se detecta.
- El remapeo de B a Q se aplica y se guarda, y se puede restaurar.
- Abrir y cerrar la ventana «Teclas» pausa y reanuda el juego.
- No hay errores de consola ni solicitudes fallidas en ninguna de las dos páginas.

Limitación de la prueba: corre en un solo equipo, sin una red real entre medio. Falta probar con tu hermano en otra conexión.

## Pendientes

| Prueba | Motivo |
|---|---|
| Juego online entre dos casas, con redes y NAT reales | Prueba manual |
| Carrera a dos jugadores de punta a punta | Prueba manual |
| Carrera completa, armas, turbo, compras y contraseñas | Prueba manual |
| Calidad del audio a oído y cortes en Edge | Prueba manual |
| Botón Reiniciar y persistencia de instantáneas tras recargar | Prueba manual |
| Mandos físicos | No hay un mando conectado durante la sesión |
| Pantalla completa en el monitor real del usuario | La prueba automática pasa; falta confirmar a mano que se corrigió el recorte |
| Firefox | No está instalado en el equipo |
| Safari y móviles | No disponibles. Además faltan controles táctiles |

## Cómo completar la verificación con tu ROM

```powershell
powershell -ExecutionPolicy Bypass -File scripts\build.ps1 -Tests -Bench
node build\tools\rnr_bench.js "C:\ruta\rom.sfc" 1800 build\ultimo-frame.ppm
node scripts\browser-test.mjs --browser chrome --rom "C:\ruta\rom.sfc"
node scripts\browser-test.mjs --browser edge --rom "C:\ruta\rom.sfc"
```

- `rnr_bench` debe informar más de 60 fps.
- Si el núcleo se detiene ("Static core stopped fail-closed"), el mensaje indica la dirección exacta del estado no compilado.
