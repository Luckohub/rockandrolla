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

## Pendientes (requieren la ROM o equipos que no están disponibles)

| Prueba | Motivo |
|---|---|
| **Sesión de juego real**: arranque, menús, carrera, controles, armas | No hay ROM en el equipo y no se descarga. Con la ROM: `node scripts\browser-test.mjs --rom <ruta>` lo automatiza en parte |
| Ritmo real de 60 fps y costo por frame | Requiere la ROM. Además, `rnr_bench.js` mide la velocidad del motor en Node |
| Calidad y sincronía del audio del juego | Requiere la ROM |
| Imagen correcta | Requiere la ROM. La prueba compara capturas y cuenta colores |
| Instantáneas: guardar, cargar y persistir tras recargar | Requiere el juego en marcha |
| Reinicio | Requiere el juego en marcha |
| Mandos físicos | No hay un mando conectado durante la sesión |
| Pantalla completa | La prueba sin interfaz no la cubre; queda para verificación manual. El cambio de tamaño sí se probó con el área vacía |
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
