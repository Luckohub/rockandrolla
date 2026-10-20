# Informe de viabilidad técnica — Rockanrola

Fecha: 2026-10-20. Equipo de desarrollo: Windows 11 Pro 64 bits, i7-6700, 8 GB de RAM, GTX 1650 Super.

Este informe distingue entre lo **verificado** (ejecutado o leído en el código) y lo **no verificado** (inferido o pendiente). Las estimaciones de tiempo son orientativas.

## 1. Resumen

- **Estrategia elegida:** compilar a WebAssembly la recompilación estática de la versión de SNES (EE. UU.) publicada por Junior-Jones. El núcleo es C11/C++17 portable y se compila **sin modificar ni una línea** del proyecto original.
- **Estado:** versión parcialmente jugable. Con la ROM del usuario, el juego real corre en Chrome y Edge a 60 fps con sonido. Se recorrieron los menús hasta la selección de piloto, y funcionan la pausa y las instantáneas. Una carrera completa no se verificó todavía.
- **Impedimento para publicar el sitio:** el código generado es una traducción del programa original del juego y el repositorio de origen no tiene licencia propia. Publicarlo en `www.rockanrola.com.ar` requiere permisos que hoy no existen (sección 6).
- **Blizzard Arcade Collection:** no ofrece una vía técnica ni legal para un port web. Se documenta en la sección 2.

## 2. Prioridad 1 — Blizzard Arcade Collection

| Aspecto | Hallazgo | Estado |
|---|---|---|
| Plataformas | Battle.net (Windows 10+), Nintendo Switch, PS4, Xbox One | Verificado (fuentes públicas) |
| Contenido de Rock n' Roll Racing | Ediciones originales de SNES y Mega Drive con funciones de emulación (guardado rápido, rebobinado, remapeo, filtros) y una *Definitive Edition* con música con licencia en sus versiones originales, locutor mejorado, pantalla ancha y pantalla dividida para 4 jugadores | Verificado (anuncio de Blizzard y reseñas) |
| Tecnología interna | Desarrollada junto con Digital Eclipse. Las ediciones originales se ejecutan emuladas. No se encontró documentación técnica pública ni del emulador ni de la *Definitive Edition* | Parcial |
| Código fuente, SDK o herramientas oficiales | No existen públicamente | Verificado (búsqueda) |
| Formato de archivos | Datos empaquetados dentro de la instalación de Battle.net. No son ROM accesibles; extraerlos implicaría ingeniería inversa del contenedor del producto | No verificado: la colección no está instalada en este equipo |
| Licencia | El acuerdo de usuario de Blizzard no autoriza redistribuir ni publicar el contenido. La música con licencia de la *Definitive Edition* (temas de artistas reales) es imposible de redistribuir | Verificado en lo general |

**Conclusión:** no hay una ruta razonable. No existe código reutilizable, sus archivos no son ejecutables en un navegador, extraerlos queda fuera de lo permitido y la música con licencia impide cualquier redistribución. Lo más cercano a la experiencia de la colección es su **edición original de SNES**, que corresponde a la versión que implementa la recompilación elegida. Que la colección use exactamente la misma revisión de ROM que la versión de EE. UU. no está verificado. Las mejoras de la *Definitive Edition* no se pueden reproducir.

## 3. Prioridad 2 — Recompilaciones estáticas de SNES

### 3.1 Junior-Jones/Rock-N-Roll-Racing-SNES-Static-Recomp (elegida)

Inspeccionado en el commit `4f4a9a62cecd349ae7acdce8c4b75532f3733ca3` (versión 1.0.0, publicada el 2026-09-03).

| Aspecto | Hallazgo |
|---|---|
| Versión implementada | Rock n' Roll Racing SNES, EE. UU., NTSC, ROM sin cabecera de 1 048 576 bytes, SHA-256 `9d721753…4b182`. Cualquier otra revisión se rechaza |
| Código reconstruido | `runtime/`: máquina SNES propia (bus LoROM, WRAM, DMA/HDMA, temporizadores, PPU con modos 1 y 7, ventanas, mezcla de color), DSP de audio propio de 32 fases |
| Código generado | `generated/current/v10_2/`: 24 835 contextos exactos de la CPU 65816 traducidos a C (86 archivos), 1 629 cuerpos de la CPU de audio SPC700 en C++ (19 archivos) y la tabla de tiempos |
| Componentes auxiliares | `analysis/`, `generator/`, `tools/` en Python (generación y verificación fuera de línea, no se usan para compilar). Frontend de Windows en `frontend/windows/` (Win32, GDI, DirectSound, SDL3 solo para mandos) |
| Sin intérprete | No hay intérprete, decodificador de instrucciones, JIT ni emulador de respaldo. Ante un estado no compilado se detiene y registra el motivo ("fail-closed") |
| Dependencias del núcleo | Ninguna, solo la biblioteca estándar de C/C++. Verificado con búsqueda de cabeceras de plataforma |
| Dependencia de Windows | Solo en `rnr_app_core.c`, para calcular el SHA-256 de la ROM con BCrypt. Se resolvió con cabeceras sustitutas y un SHA-256 portable (`port/shim/`), sin tocar el archivo original |
| Compilación reproducible | CMake + Visual Studio 2022 en el original. Rockanrola usa un Makefile propio que compila los mismos archivos con los mismos estándares y definiciones |
| Compatibilidad con Clang | El modo estricto `-Werror` del original falla en dos avisos que MSVC no emite: estructuras anónimas en una unión y un `memcpy` sobre un objeto C++ al cargar instantáneas. Ambos son intencionales; solo se desactivaron esos dos avisos |
| Recursos necesarios | La ROM del usuario. Gráficos, música, efectos y datos se leen de ella en tiempo de ejecución |
| Licencia | **No declara licencia propia.** GitHub muestra "zlib" porque detecta `SDL-LICENSE.txt`, que es la licencia de SDL. El código S-SMP deriva de Snes9x, cuya licencia prohíbe el uso comercial |
| Madurez | 1 estrella, 0 issues, sin trabajo futuro previsto según sus metadatos. El README declara que la demo de título funciona 180 s y que se probaron carreras, armas, turbo y audio |

### 3.2 fulalas/RockNRollRacingSNESRecomp (alternativa a vigilar)

- Creado el **2026-10-20**, el mismo día de este informe. Se revisaron el README y el árbol de archivos, pero no se clonó ni compiló.
- Se basa en el marco `snesrecomp` (RetroPortingToolKit) y en `recomp-ui`, ambos como submódulos.
- **Genera el código C en cada equipo a partir de la ROM del usuario** y no lo publica. Es más prudente legalmente, pero para la web obligaría a distribuir el código generado, con el mismo problema, o a generarlo dentro del navegador, lo cual no es viable.
- Licencia PolyForm Noncommercial 1.0.0.
- Agrega extras que no son del original: pantalla ancha, interpolación de movimiento y lógica a 30 FPS.
- Compila para Linux y Windows con Clang. Su compatibilidad con Emscripten no está evaluada.

## 4. Prioridad 3 — Mega Drive / Genesis

- No se encontró código fuente, desensamblado comentado, decompilación ni recompilación de la versión de Mega Drive. Se buscó en GitHub con tres variantes del nombre y en la web.
- Un port nativo exigiría crear desde cero una recompilación del 68000 y del Z80, más el chip de sonido FM YM2612 y el VDP. Es un proyecto de varios meses con mucha incertidumbre.
- La reconstrucción de SNES no sirve: CPU, chips de video y audio, y el propio código del juego son distintos.
- Diferencias de plataforma: la versión de SNES usa música con muestras (SPC700) y la de Mega Drive síntesis FM. El resto de las diferencias de contenido no fueron verificadas.
- La única vía práctica es la **emulación web**, por ejemplo con Genesis Plus GX compilado a WebAssembly, cuya licencia también es no comercial.

## 5. Prioridad 4 — Otras alternativas

| Opción | Evaluación |
|---|---|
| bestander/rocknroll-racing | Prueba de concepto de 2019. Es un emulador libretro de Genesis con un `index.html`; la ROM fue retirada del repositorio. Es emulación, no un port |
| DimaKirk/rrr3d (Motor Rock) | Remake 3D distinto del juego original. No sirve para fidelidad |
| Clones y trabajos académicos | Varios en JS, VB6, SFML o Three.js. Ninguno reproduce el juego |
| Reimplementación propia | Requiere reconstruir físicas, IA, pistas y audio a partir del binario. Años-persona; no tiene sentido existiendo la recompilación |
| Emulador SNES en WebAssembly | snes9x (no comercial) o bsnes/ares (GPL-3), por ejemplo vía EmulatorJS (GPL-3). Alta fidelidad, cualquier revisión de ROM, días de trabajo. **Es emulación web, no un port.** Su ventaja es legal: no distribuye código del juego |

## 6. Restricciones legales

1. **ROM:** se usa la alternativa A. El usuario aporta su copia, se verifica por SHA-256 y se procesa solo en su navegador. Nunca se sube a un servidor y solo se guarda en IndexedDB si el usuario lo pide. No se descargó ninguna ROM.
2. **Código del juego traducido:** el wasm contiene la lógica ejecutable del juego traducida instrucción por instrucción desde la ROM, con operandos y tablas de parámetros. Gráficos y música no están incluidos, pero el programa en sí sí lo está, en forma traducida. Distribuirlo públicamente puede infringir los derechos de los titulares (Blizzard / Interplay), con independencia de la licencia del recompilador. **Este es el bloqueo principal para publicar el sitio** y también afecta al repositorio de origen. Se recomienda consultar a un abogado (en Argentina rige la Ley 11.723).
3. **Código del recompilador sin licencia:** sin una licencia explícita, el código de Junior-Jones no se puede redistribuir. Hay que pedirle al autor que agregue una, por ejemplo zlib, que es lo que GitHub sugiere por error.
4. **Snes9x:** el código S-SMP derivado obliga a un uso **no comercial**. Sin publicidad, cobros ni promoción comercial. El aviso se conserva en `web/legal/`.
5. **Marcas:** el sitio no usa logotipos ni arte del juego e incluye un descargo de no afiliación.
6. **Comprar Blizzard Arcade Collection** no otorga derechos de redistribución ni de publicación web.

## 7. Matriz de viabilidad

| Criterio | A. Blizzard Arcade Collection | B. Recomp SNES Junior-Jones (elegida) | C. Recomp SNES fulalas | D. Mega Drive nativo | E. Emulador SNES/MD en wasm |
|---|---|---|---|---|---|
| Fidelidad | Máxima para la *Definitive Edition*, pero inaccesible | Alta: ejecuta el código original traducido con tiempos exactos, sin extras | Alta, con extras opcionales | Alta en teoría | Alta, depende del emulador |
| Código disponible | Ninguno | Completo; sin licencia propia; Snes9x no comercial en el audio | Completo; PolyForm no comercial; muy nuevo | Ninguno | Abundante (GPL-3 o no comercial) |
| Compatibilidad web | Nula | **Verificada**: el juego real corre en el navegador | Sin evaluar (SDL3, OpenGL, submódulos) | No aplica | Probada por terceros |
| Trabajo necesario | No viable | Capa web: hecha. Falta probar con la ROM | Port de SDL3/GL y generación | Recompilador completo | Integración y UI |
| Dependencias | — | Emscripten 6.0.10 (Docker) | snesrecomp, recomp-ui, SDL3, Clang | Herramientas a crear | Núcleo libretro y frontend |
| Recursos originales | Archivos propietarios de Battle.net | ROM SNES EE. UU. del usuario | ROM SNES del usuario, también al compilar | ROM MD del usuario | ROM del usuario |
| Rendimiento | — | Medido: 60 fps en Chrome y Edge, 6–14 ms de CPU por frame tras dos optimizaciones del port | Sin medir | — | Conocido y suficiente en PC |
| Mantenimiento | — | Bajo: el original no prevé más cambios y la compilación está fijada | Alto: proyecto en movimiento | Muy alto | Bajo |
| Tiempo estimado | — | Prueba de concepto: hecha. Port completo: 1–3 semanas tras probar con la ROM, con incertidumbre sobre paradas del núcleo | 2–6 semanas, alta incertidumbre | 6–18 meses | 2–5 días |
| Resultado | Imposible | **Recompilación estática nativa en wasm** | Recompilación estática | Recompilación desde cero | Emulación web |
| Publicación legal | No | Bloqueada (sección 6) | Bloqueada por el mismo motivo | — | Posible con la ROM del usuario |

### Recomendación

**Estrategia principal: B.** Es la única opción que ya entrega un port nativo funcionando en el navegador, con el código del juego compilado a WebAssembly, sin emulador y sin modificar el proyecto original. Es la vía más corta hacia una experiencia web real para uso local.

**Para publicar el sitio**, B solo es viable si el autor de la recompilación agrega una licencia y si un asesoramiento legal concluye que se puede distribuir el código traducido. Si no, la alternativa publicable más cercana es **E, identificada explícitamente como emulación web**.

- **Se gana:** cualquier revisión de ROM y una distribución legalmente más limpia.
- **Se pierde:** la ejecución nativa y la ausencia de intérprete.

## 8. Arquitectura implementada

```
Navegador
 ├─ index.html / style.css / app.js   portada, carga, ROM, UI, bucle
 │    ├─ teclado (event.code) + Gamepad API  ─┐
 │    ├─ requestAnimationFrame, ritmo 60,0988 fps, enganchado al audio
 │    └─ IndexedDB: ROM opcional e instantánea (solo local)
 ├─ audio-worklet.js   búfer + remuestreo Hermite 32 040 Hz → dispositivo
 └─ engine/rockanrola.wasm (+ .js de Emscripten)
      ├─ port/src/rnr_web.c        API rnrw_* para JavaScript
      ├─ port/shim/                windows.h/bcrypt.h + SHA-256 portable
      ├─ upstream frontend         rnr_app_core.c, rnr_input_latch.c (sin cambios)
      └─ upstream núcleo estático  CPU 65816 AOT, PPU, DMA, SPC700 AOT, DSP
```

- **Separación código/recursos:** el servidor solo aloja código. La ROM entra por el selector de archivos o por arrastre y no se transmite.
- **Hilo principal:** cada frame del juego es una llamada a wasm. No se necesitan hilos, `SharedArrayBuffer` ni cabeceras COOP/COEP.
- **Sincronía:** el reloj del juego avanza por tiempo real y se ajusta hasta ±1 % según el audio en cola, así se evitan cortes y deriva.
- **Pausa automática:** al ocultar la pestaña.

### Optimizaciones del port

La primera medición con la ROM dio 35 fps en WebAssembly, insuficiente. El perfil mostró dos costos ajenos al juego. Ambos se resolvieron sin editar el código original.

| Cambio | Causa | Efecto |
|---|---|---|
| `port/src/fast_snprintf.c` | La sincronización de audio limpia su mensaje de error con `snprintf(buf, n, "%s", "")` miles de veces por frame | Atajo exacto para el formato `"%s"`, misma semántica C99 |
| `port/src/apu_sync_batch.c` | El planificador sincroniza el procesador de audio en cada acceso al bus y copia su estado completo cada vez | Sincroniza como máximo una vez por línea de barrido y siempre antes de cada acceso a los puertos de audio. Se aplica redirigiendo tres funciones con `-D` solo al compilar `v10_2_machine.c` |

Comprobación de equivalencia con 1 800 frames del juego real: mismo hash de los 1 800 frames de video, mismo número de instrucciones (22 863 167) y audio PCM idéntico byte a byte. Solo cambian contadores de diagnóstico del audio. El motor pasó de 35 a 110 fps en Node, y en el navegador usa entre 6 y 14 ms de CPU por frame de los 16,6 ms disponibles.

## 9. Estimación del trabajo restante

| Tarea | Estimación | Depende de |
|---|---|---|
| Partida completa, varias pistas y modo de dos jugadores | 0,5–2 días | Prueba manual |
| Ajuste fino de audio y latencia, medición de rendimiento | 1–2 días | ROM |
| Paradas "fail-closed" del núcleo que aparezcan en rutas no probadas por el autor | Indeterminado: requiere regenerar con sus herramientas Python o pedir corrección al autor | Uso real |
| Controles táctiles para móviles | 2–3 días | — |
| Firefox y Safari | 0,5–1 día | Tener los navegadores |
| Gestiones legales para publicar | Externo | Autor y asesoría |

## 10. Futuras incorporaciones de juegos retro

La arquitectura sirve para otros juegos: un módulo wasm del motor, el recurso que aporta el usuario y un anfitrión JavaScript común (video, audio, entrada, guardado). Para cada candidato hay que evaluar lo mismo:

1. Existencia de una decompilación, recompilación o reimplementación.
2. Su licencia.
3. Si el código distribuido contiene lógica del juego.
4. Cómo se obtienen los recursos.

Ejemplos a evaluar, sin verificar todavía:

- Decompilaciones con ports web existentes, como Super Mario 64.
- Reimplementaciones de SNES que extraen los recursos de la ROM del usuario, como `snesrev/zelda3` o `snesrev/sm`.
- Otros juegos de Blizzard Arcade Collection: The Lost Vikings y Blackthorne. No se encontraron recompilaciones; hoy solo admiten emulación.

Mantener un único anfitrión JavaScript reutilizable reduce cada incorporación a compilar el motor y adaptar la entrada.

## Fuentes

- [Anuncio de Blizzard Arcade Collection](https://news.blizzard.com/blizzard/23617535/)
- [Blizzard Arcade Collection en Giant Bomb](https://giantbomb.com/wiki/Games/Blizzard_Arcade_Collection)
- [Reseña en Nintendo Life](https://www.nintendolife.com/reviews/switch-eshop/blizzard_arcade_collection)
- [Digital Eclipse en Wikipedia](https://en.wikipedia.org/wiki/Digital_Eclipse)
- [Rock n' Roll Racing en Wikipedia](https://en.wikipedia.org/wiki/Rock_n%27_Roll_Racing)
- [Junior-Jones/Rock-N-Roll-Racing-SNES-Static-Recomp](https://github.com/Junior-Jones/Rock-N-Roll-Racing-SNES-Static-Recomp)
- [fulalas/RockNRollRacingSNESRecomp](https://github.com/fulalas/RockNRollRacingSNESRecomp)
- [bestander/rocknroll-racing](https://github.com/bestander/rocknroll-racing)
