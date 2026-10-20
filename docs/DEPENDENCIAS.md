# Dependencias y licencias

## Herramientas de compilación (fijadas)

| Herramienta | Versión | Uso | Instalación |
|---|---|---|---|
| Emscripten (emsdk) | 6.0.10 (`d6c521a7f054`), imagen Docker `emscripten/emsdk:6.0.10` | Compilador C/C++ a WebAssembly | Imagen de Docker; nada global |
| Docker Desktop | 29.8.2 (verificado) | Ejecuta la imagen de Emscripten | Requisito del desarrollador |
| GNU Make | Incluido en la imagen | `port/Makefile` | — |
| Node.js | 24.16.0 (verificado); mínimo 18; 22+ para `browser-test.mjs` | Servidor local, pruebas en navegador, pruebas wasm | Requisito del desarrollador |
| Git | 2.54.0 (verificado) | Submódulo | Requisito del desarrollador |

No se necesitan CMake, Ninja, Visual Studio, Python ni WSL2. Python 3 solo sirve como alternativa de servidor (`python -m http.server`).

## Código incluido en el módulo web

| Componente | Origen | Versión | Licencia | Notas |
|---|---|---|---|---|
| Núcleo estático de Rock n' Roll Racing | Junior-Jones/Rock-N-Roll-Racing-SNES-Static-Recomp | commit `4f4a9a62cecd` (v1.0.0) | **Sin licencia propia declarada** | `runtime/`, `generated/current/v10_2/`. Sin cambios |
| Biblioteca S-SMP derivada | Snes9x / byuu, vía el proyecto anterior | — | Licencia Snes9x: **solo uso no comercial** | Texto en `web/legal/SNES9X-LICENSE.txt` |
| `rnr_app_core.c`, `rnr_input_latch.c` | Frontend del proyecto anterior | Mismo commit | Sin licencia propia declarada | Sin cambios |
| `port/` (glue, shims, SHA-256, pruebas, herramientas) | Rockanrola | 0.1.0 | zlib | — |
| Bibliotecas de sistema de Emscripten (musl, libc++, libc++abi, compiler-rt) | Emscripten | 6.0.10 | MIT / NCSA / Apache-2.0 con excepción LLVM | Enlazadas estáticamente |

Componentes del proyecto original que **no** se usan en la web: SDL 3.4.10 (solo mandos en Windows), el lanzador Win32, DirectSound y el resampler del frontend de Windows.

## Código de la página

`web/*.html`, `*.css`, `*.js` y `scripts/*` son de Rockanrola (zlib). No se usan CDN.

| Biblioteca | Versión | Licencia | Uso |
|---|---|---|---|
| PeerJS (`web/vendor/peerjs-1.5.5.min.js`) | 1.5.5, paquete npm verificado por integridad SHA-512 | MIT. Incluye eventemitter3 (MIT), webrtc-adapter (BSD-3-Clause), @msgpack/msgpack (ISC) y peerjs-js-binarypack (MIT) | Solo para jugar online. Se carga únicamente al abrir una sala o unirse a una |

| Servicio externo | Uso | Alternativa |
|---|---|---|
| `0.peerjs.com`, gratuito, del proyecto PeerJS | Presenta a los dos navegadores y coordina la conexión | Servidor propio con `npx peerjs --port 9000` y `web/config.js` |
| STUN de Google y TURN de PeerJS | Atravesar NAT y, si hace falta, retransmitir | Servidores propios en `iceServers` de `web/config.js` |

## Recursos del juego

Ninguno. La ROM la aporta el usuario y se procesa en su navegador.
