# Rockanrola

Rock ’n’ Roll Racing de Super Nintendo en el navegador, sin instalar nada y sin emulador.

Rockanrola compila a WebAssembly la [recompilación estática de Rock n' Roll Racing (SNES) de Junior-Jones](https://github.com/Junior-Jones/Rock-N-Roll-Racing-SNES-Static-Recomp). En esa recompilación, el código del juego ya fue traducido a C de antemano. Rockanrola le agrega una capa web: imagen en un `<canvas>`, sonido con Web Audio, teclado y mando con la Gamepad API, pausa, reinicio, pantalla completa e instantáneas.

> **Estado: jugable en local.** El juego real corre en Chrome y Edge a 60 fps, con sonido, controles, pausa e instantáneas. Una carrera completa todavía no se verificó de punta a punta. Ver [docs/PRUEBAS.md](docs/PRUEBAS.md).

> **No publicar todavía en internet.** Hay impedimentos legales sin resolver, explicados en [docs/INFORME-VIABILIDAD.md](docs/INFORME-VIABILIDAD.md#6-restricciones-legales).

## Qué necesitás para jugar

Una copia legal de la ROM de **Rock n' Roll Racing (USA)** para SNES:

| Dato | Valor |
|---|---|
| Formato | `.sfc` sin cabecera. Un `.smc` con cabecera de copiador de 512 bytes también se acepta |
| Tamaño | 1 048 576 bytes |
| SHA-256 | `9d721753301278325c851f1843d669a697aed757dcf6495a31fc31ddf664b182` |

- La ROM se verifica y se usa **solo en tu navegador**. No se sube a ningún servidor.
- Las versiones europea, japonesa, de Mega Drive o modificadas no son compatibles.
- Blizzard Arcade Collection no entrega su juego como ROM y Rockanrola no extrae sus archivos.

## Inicio rápido en Windows 11

Requisitos:

- Git.
- Docker Desktop, para compilar con Emscripten sin instalarlo en el sistema.
- Node.js 18 o superior, para el servidor local.

En PowerShell:

```powershell
git clone --recurse-submodules <url-de-este-repositorio> Rockanrola
cd Rockanrola
powershell -ExecutionPolicy Bypass -File scripts\build.ps1 -Tests
powershell -ExecutionPolicy Bypass -File scripts\serve.ps1
```

Abrí <http://localhost:8080>, pulsá **Jugar** y elegí tu ROM. Si ese puerto está ocupado, usá otro con `scripts\serve.ps1 -Port 8090`.

### Arranque directo

Si ponés tu ROM en la carpeta `rom/` del proyecto, el juego arranca solo al abrir la página. La carpeta acepta `.sfc`, `.smc` o `.zip`.

- El servidor local la entrega en la ruta `/local-rom` y solo escucha en 127.0.0.1.
- El navegador exige una tecla o un clic antes de reproducir sonido, y la página lo indica.
- La carpeta `rom/` está excluida de Git. Un hosting público no tiene esa ruta, así que la ROM nunca se publica.
- Para desactivarlo, iniciá el servidor con `ROCKANROLA_LOCAL_ROM=0`.

- La primera compilación descarga la imagen `emscripten/emsdk:6.0.10`, que ocupa unos 3,4 GB en disco.
- Después tarda menos de 2 minutos en este equipo.
- Abrir `web/index.html` con doble clic no funciona: el navegador necesita servir el motor por HTTP.

### Sin Docker

Usá WSL (la distribución Ubuntu ya instalada sirve), porque Git Bash no incluye `make`. Instalá emsdk 6.0.10 en una carpeta local y ejecutá desde la raíz del proyecto:

```sh
git clone https://github.com/emscripten-core/emsdk.git ~/emsdk
~/emsdk/emsdk install 6.0.10 && ~/emsdk/emsdk activate 6.0.10
source ~/emsdk/emsdk_env.sh
make -C port -j4 web tests
```

## Controles

| SNES | Teclado | Alternativa | Mando estándar |
|---|---|---|---|
| Cruceta | Flechas | | Cruceta o stick izquierdo |
| B | `Z` | `D` | Botón inferior |
| A | `X` | `F` | Botón derecho |
| Y | `A` | | Botón izquierdo |
| X | `S` | | Botón superior |
| L / R | `E` / `R` | | Hombros o gatillos |
| Start | `Enter` | `G` | Start / Menu |
| Select | `Espacio` | `T` | Back / View |

| Acción de la página | Tecla |
|---|---|
| Pausa y reanudar | `P` o `Esc` |
| Guardar estado | `F2` |
| Cargar estado | `F4` |
| Pantalla completa | Botón, o doble clic en la imagen |

Los dos juegos de teclas reproducen los perfiles "clásico" y "predeterminado" del lanzador original. La página se pausa sola al cambiar de pestaña.

**Cambiar las teclas:** usá el botón **Teclas** durante el juego, o **Configurar teclas** en la sección Controles.

- Cada botón del SNES admite dos teclas.
- Si asignás una tecla que ya estaba en uso, se quita de su lugar anterior.
- La configuración queda guardada en el navegador.
- Abrir la ventana pausa el juego, y cerrarla lo reanuda.
- `Esc`, `Tab` y `F1` a `F12` están reservadas. `P` pausa mientras no la asignes a un botón.

## Jugar online con otra persona

El juego corre en tu equipo, con tu ROM. La otra persona abre un enlace y ve tu pantalla en vivo, con sonido, y maneja el **mando 2** con su teclado o su mando. No necesita la ROM ni instalar nada.

1. Durante el juego, pulsá **Jugar online**. Se abre una sala con un código de 6 letras.
2. Pulsá **Copiar** y mandale el enlace a la otra persona.
3. La otra persona abre el enlace y pulsa **Unirse**. También puede pegar el código en la portada.
4. Para correr a dos jugadores, elijan ese modo en el menú del juego.

Detalles:

- **Conexión:** el servidor público gratuito de PeerJS solo presenta a los dos navegadores. Imagen, sonido y controles viajan directo entre los equipos por WebRTC. Si un NAT estricto lo impide, pasan por un relevo TURN de PeerJS.
- **Demora:** el jugador 2 ve la imagen y envía sus controles con la latencia de la conexión. Ese valor aparece en su pantalla. El jugador 1 juega sin demora.
- **Pestaña visible:** mantené visible la pestaña del juego, porque el navegador frena las pestañas ocultas.
- **Página del invitado:** el enlace apunta a `https://luckohub.github.io/rockandrolla/`. Esa página no contiene el motor ni la ROM, solo la interfaz para unirse. Para activarla una vez, andá en GitHub a **Settings → Pages → Source: GitHub Actions**. El flujo `.github/workflows/pages.yml` la publica en cada cambio.
- **Prueba en un solo equipo:** el enlace «Probar como invitado en este equipo» abre la misma sala en otra pestaña o navegador.

## Publicar la página de invitado gratis

La página que usa el invitado no contiene el motor ni la ROM, así que se puede publicar.

- **Armar la copia:** `node scripts/prepare-public.mjs` la arma en `build/public/` y verifica que no se cuele nada del juego.
- **Recomendado:** Cloudflare Pages, gratis, en `https://<nombre>.pages.dev`. Se publica con `scripts\publish-cloudflare.ps1 -Project <nombre>` o conectando el repositorio en Cloudflare.
- **Alternativas:** GitHub Pages, Netlify o un subdominio de is-a.dev.
- **Dominios propios:** `.xyz`, `.dev` o `.com.ar` son pagos, aunque baratos.

Los pasos completos están en [docs/DESPLIEGUE.md](docs/DESPLIEGUE.md#0-publicar-gratis-la-página-de-invitado-se-puede-hacer-ya). El sitio completo, con el motor, sigue sin poder publicarse por los motivos legales del informe.

## Estructura

| Carpeta | Contenido |
|---|---|
| `third_party/rnrr-recomp/` | Submódulo con la recompilación original, fijado en `4f4a9a6`. **No se modifica** |
| `port/shim/` | Sustitutos de `windows.h` y `bcrypt.h` con un SHA-256 portable. Es la única dependencia de Windows que había en el núcleo |
| `port/src/fast_snprintf.c`, `port/src/apu_sync_batch.c` | Optimizaciones del port que no cambian el resultado (ver informe, sección 8) |
| `port/src/controller_p2.c` | Conecta el mando 2 del SNES, que el lanzador original dejaba fijo en cero |
| `port/src/rnr_web.c` | API `rnrw_*` que el JavaScript usa para crear el juego, avanzar frames, leer imagen y audio, manejar la entrada y las instantáneas |
| `port/tests/`, `port/tools/` | Pruebas propias y una herramienta de rendimiento que usa tu ROM en Node |
| `port/Makefile` | Compilación con Emscripten |
| `web/` | El sitio estático: `index.html`, `style.css`, `app.js`, `audio-worklet.js`, `engine/` (generado) y `legal/` |
| `web/keymap.js`, `web/keys-ui.js` | Teclas configurables y su ventana |
| `web/net.js`, `web/guest.js`, `web/config.js`, `web/vendor/` | Juego online: sesiones de anfitrión e invitado, ajustes de red y PeerJS 1.5.5 |
| `scripts/` | `build.ps1`, `serve.ps1` y `serve.mjs`. También `browser-test.mjs`, para la prueba automática con Chrome o Edge, y `online-test.mjs`, para el juego online y el remapeo |
| `docs/` | Informe de viabilidad, dependencias, pruebas y despliegue |

## Pruebas

```powershell
# Pruebas sin ROM del núcleo y del port, en Node dentro del contenedor
powershell -ExecutionPolicy Bypass -File scripts\build.ps1 -Tests

# Prueba de la página en un navegador sin interfaz
node scripts\browser-test.mjs --browser chrome
node scripts\browser-test.mjs --browser edge

# Con tu ROM: arranca el juego, pulsa Start, mide fps y audio,
# prueba pausa e instantáneas, y guarda capturas en build\browser-test\
node scripts\browser-test.mjs --browser chrome --rom "C:\ruta\a\Rock n' Roll Racing (USA).sfc"

# Con la ROM en rom\: comprueba el arranque directo sin clics
node scripts\browser-test.mjs --browser chrome --local-rom

# Con la ROM en rom\ e internet: juego online de punta a punta y remapeo
node scripts\online-test.mjs --browser chrome

# Rendimiento del motor wasm en Node, con tu ROM
powershell -ExecutionPolicy Bypass -File scripts\build.ps1 -Bench
node build\tools\rnr_bench.js "C:\ruta\a\rom.sfc" 1800 build\ultimo-frame.ppm
```

## Documentación

- [Informe de viabilidad](docs/INFORME-VIABILIDAD.md): Blizzard Arcade Collection, SNES, Mega Drive, matriz comparativa, legalidad y futuros juegos.
- [Dependencias y licencias](docs/DEPENDENCIAS.md).
- [Pruebas realizadas y pendientes](docs/PRUEBAS.md).
- [Despliegue en un dominio propio](docs/DESPLIEGUE.md).

## Licencias

- El código propio de Rockanrola, en `port/`, `web/` y `scripts/`, usa la licencia zlib. Ver [LICENSE](LICENSE).
- El submódulo de Junior-Jones **no declara una licencia propia**.
- Su audio S-SMP deriva de Snes9x, cuya licencia es **solo para uso no comercial**. Ver [web/legal/NOTICES.txt](web/legal/NOTICES.txt).

Rock n' Roll Racing es obra y marca de sus titulares. Rockanrola no está afiliado a Blizzard Entertainment ni a Interplay, y no distribuye la ROM, la música ni los gráficos del juego.
