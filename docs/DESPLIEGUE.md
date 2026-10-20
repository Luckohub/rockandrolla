# Despliegue en www.rockanrola.com.ar

> **Antes de publicar:** resolvé los puntos legales del [informe](INFORME-VIABILIDAD.md#6-restricciones-legales).
>
> 1. El autor de la recompilación tiene que agregar una licencia que permita redistribuir.
> 2. Un asesoramiento legal tiene que confirmar si se puede distribuir el código del juego traducido.
> 3. El sitio no puede tener fines comerciales, por la licencia de Snes9x.
>
> Hasta entonces, usalo solo en `localhost`.

No se asume que el dominio esté registrado ni que exista un servidor.

## 0. Publicar gratis la página de invitado (se puede hacer ya)

Hay dos sitios distintos, y solo uno se puede publicar hoy:

| Sitio | Contenido | ¿Se puede publicar? |
|---|---|---|
| **Página de invitado**, armada por `node scripts/prepare-public.mjs` en `build/public/` | Interfaz, PeerJS y el reproductor de video. Sin motor ni ROM | **Sí.** No contiene código del juego. Sirve para que otra persona se una como jugador 2 |
| **Sitio completo**, que es `web/` con `engine/` | Además, el motor wasm con el programa del juego traducido | **No**, por los puntos legales de arriba |

El anfitrión sigue jugando desde su equipo, en `http://localhost:8090`. Solo el invitado usa la página pública.

### Dónde publicarla gratis

| Opción | Dirección resultante | Costo | Comentario |
|---|---|---|---|
| **Cloudflare Pages** (recomendada) | `rockanrola.pages.dev`, o el nombre que esté libre | Gratis | HTTPS automático, red rápida en Argentina, aplica `_headers` (CSP). Es un dominio `.dev` |
| GitHub Pages | `luckohub.github.io/rockandrolla` | Gratis | Ya está preparado (`.github/workflows/pages.yml`). Solo falta activarlo en Settings → Pages. No aplica `_headers` |
| Netlify | `rockanrola.netlify.app` | Gratis | Aplica `_headers` |
| is-a.dev | `rockanrola.is-a.dev` | Gratis | Subdominio para proyectos de desarrolladores. Se pide con un pull request al repositorio `is-a-dev/register` y lo aprueban personas, según sus reglas. Apunta a cualquiera de las opciones anteriores |
| Dominio propio `.xyz` o `.dev` | `rockanrola.xyz`, `rockanrola.dev` | **No es gratis** | Lo habitual es unos pocos dólares el primer año en `.xyz` y USD 10–15 por año en `.dev`, a verificar en el registrador. Cloudflare Registrar vende al costo. Se conecta a Cloudflare Pages como «custom domain» |
| `rockanrola.com.ar` | `www.rockanrola.com.ar` | Pago anual bajo en NIC Argentina | Era el dominio previsto. Se conecta igual que el anterior |

### Opción A: Cloudflare Pages desde GitHub (se actualiza solo)

1. Creá una cuenta gratis en <https://dash.cloudflare.com>.
2. Entrá a **Workers & Pages → Create → Pages → Connect to Git** y elegí `Luckohub/rockandrolla`.
3. Configurá el build:
   - Framework preset: **None**.
   - Build command: `node scripts/prepare-public.mjs public_out`
   - Build output directory: `public_out`
4. Elegí el nombre del proyecto, por ejemplo `rockanrola`, y pulsá **Save and Deploy**. Queda en `https://rockanrola.pages.dev`.
5. En `web/config.js`, cambiá `guestUrl` por esa dirección. Así los enlaces que genera tu equipo, en localhost, apuntan ahí. Subí el cambio a GitHub.

Cada `git push` vuelve a publicar la página. El script corta el build si encuentra un `.wasm` o una ROM.

### Opción B: Cloudflare Pages desde tu PC (sin conectar GitHub)

```powershell
powershell -ExecutionPolicy Bypass -File scripts\publish-cloudflare.ps1 -Project rockanrola
```

El script hace tres cosas:

1. Arma `build\public` sin motor ni ROM.
2. Muestra la lista de archivos.
3. Lo sube con Wrangler, la herramienta oficial de Cloudflare, mediante `npx`. La primera vez abre el navegador para iniciar sesión.

**Nunca subas la carpeta `web\` directamente**, porque en tu equipo contiene el motor compilado.

### Opción C: GitHub Pages

En GitHub, entrá a **Settings → Pages → Source: GitHub Actions** y volvé a ejecutar el flujo «Pagina de invitado» desde **Actions**. Queda en `https://luckohub.github.io/rockandrolla/`, que es la dirección que trae `web/config.js` por defecto.

### Comprobar la publicación

- Abrí la dirección pública. Tiene que aparecer la nota «Esta es la página pública…» y el formulario para unirse.
- En tu equipo, abrí una sala con **Jugar online** y abrí el enlace desde otro dispositivo, por ejemplo tu celular con datos móviles.
- `node scripts\online-test.mjs --public` simula este caso en un solo equipo, sirviendo la copia pública bajo un dominio que no es localhost.

## 1. Sitio completo: qué habría que publicar

Solo la carpeta `web/` después de compilar:

```
web/index.html  style.css  app.js  audio-worklet.js  _headers
web/engine/rockanrola.js  rockanrola.wasm
web/legal/NOTICES.txt  SNES9X-LICENSE.txt
```

Es un sitio 100 % estático: no hay backend, base de datos ni subida de archivos.

## 2. Requisitos del servidor

| Requisito | Detalle |
|---|---|
| HTTPS | Obligatorio. AudioWorklet y otras API solo funcionan en contextos seguros: HTTPS o localhost |
| MIME de `.wasm` | `application/wasm`. El cargador recibe el binario ya descargado, así que funcionaría igual con otro MIME, pero conviene configurarlo |
| Compresión | gzip o Brotli para `.wasm`, `.js`, `.css` y `.html`. El wasm pasa de 2,1 MB a unos 650 KB con gzip |
| Caché | `engine/*`: `Cache-Control: public, max-age=0, must-revalidate` con ETag, porque los nombres no llevan hash. Si se agrega un hash al nombre, se puede usar `max-age=31536000, immutable` |
| CORS | No hace falta: todo se sirve desde el mismo origen |
| COOP/COEP | **No hacen falta**: no se usan hilos ni `SharedArrayBuffer` |
| CSP | `default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self'; img-src 'self' data:; connect-src 'self' https://0.peerjs.com wss://0.peerjs.com; media-src 'self' blob: mediastream:; worker-src 'self'; object-src 'none'; base-uri 'self'; form-action 'none'; frame-ancestors 'none'`. Probada en Chrome y Edge |

## 3. Opciones de hosting

| Proveedor | Ventajas | Notas |
|---|---|---|
| Cloudflare Pages | Gratis, HTTPS automático, Brotli, lee `web/_headers` | Recomendado. Directorio de salida: `web`. Compilar en local o en CI y subir el resultado |
| Netlify | Igual que el anterior, lee `_headers` | — |
| GitHub Pages | Gratis | No permite cabeceras propias (CSP). Sirve `.wasm` con el MIME correcto |
| VPS con nginx | Control total | Ver la configuración de abajo |
| Hosting compartido con Apache | Habitual en proveedores de Argentina | Ver `.htaccess` abajo |

### nginx

```nginx
server {
    listen 443 ssl http2;
    server_name www.rockanrola.com.ar;
    root /var/www/rockanrola;          # contenido de web/
    ssl_certificate     /etc/letsencrypt/live/www.rockanrola.com.ar/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/www.rockanrola.com.ar/privkey.pem;

    types { application/wasm wasm; }
    gzip on;
    gzip_types application/wasm text/javascript application/javascript text/css text/plain;

    add_header X-Content-Type-Options nosniff always;
    add_header Referrer-Policy no-referrer always;
    add_header Content-Security-Policy "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self'; img-src 'self' data:; connect-src 'self' https://0.peerjs.com wss://0.peerjs.com; media-src 'self' blob: mediastream:; worker-src 'self'; object-src 'none'; base-uri 'self'; form-action 'none'; frame-ancestors 'none'" always;

    location /engine/ { add_header Cache-Control "public, max-age=0, must-revalidate" always; }
}
server { listen 80; server_name rockanrola.com.ar www.rockanrola.com.ar; return 301 https://www.rockanrola.com.ar$request_uri; }
```

### Apache (`.htaccess`)

```apache
AddType application/wasm .wasm
<IfModule mod_deflate.c>
  AddOutputFilterByType DEFLATE application/wasm text/javascript application/javascript text/css text/html
</IfModule>
<IfModule mod_headers.c>
  Header always set X-Content-Type-Options "nosniff"
  Header always set Referrer-Policy "no-referrer"
  Header always set Content-Security-Policy "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self'; img-src 'self' data:; connect-src 'self' https://0.peerjs.com wss://0.peerjs.com; media-src 'self' blob: mediastream:; worker-src 'self'; object-src 'none'; base-uri 'self'; form-action 'none'; frame-ancestors 'none'"
  <FilesMatch "^rockanrola\.(js|wasm)$">
    Header set Cache-Control "public, max-age=0, must-revalidate"
  </FilesMatch>
</IfModule>
```

## 4. Dominio `.com.ar`

1. Registrá `rockanrola.com.ar` en NIC Argentina (nic.ar). Se necesita clave fiscal de AFIP/ARCA.
2. Delegá los DNS al proveedor elegido, o creá un `CNAME` de `www` hacia el dominio del hosting.
3. Activá el certificado HTTPS. Los proveedores de la tabla lo emiten automáticamente; con nginx, usá Let's Encrypt con certbot.
4. Redirigí `rockanrola.com.ar` a `www.rockanrola.com.ar`.

## 5. Verificación después de publicar

Con `browser-test.mjs`, cambiando la URL, o a mano en las herramientas de desarrollo:

- `rockanrola.wasm` responde 200 con `Content-Type: application/wasm` y `Content-Encoding: gzip` o `br`.
- No hay errores de CSP ni solicitudes fallidas en la consola.
- El sonido funciona, lo que confirma HTTPS y AudioWorklet.
