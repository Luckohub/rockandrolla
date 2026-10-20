// Rockanrola - dependency-free static server for local development.
//   node scripts/serve.mjs [port] [root]
// Serves web/ on http://localhost:8080 with the correct WebAssembly MIME
// type. Binds to 127.0.0.1 only. Not meant for production hosting.
//
// Local auto-start: if the repository's rom/ folder holds your own ROM
// (.sfc, .smc or .zip), it is served at /local-rom so the page can boot the
// game without asking. This only exists on this local server, which listens
// on 127.0.0.1; a public static host has no such route, so the ROM is never
// published. Disable with ROCKANROLA_LOCAL_ROM=0; change the folder with
// ROCKANROLA_ROM_DIR.
import { createServer } from 'node:http';
import { readFile, readdir, stat } from 'node:fs/promises';
import { basename, extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = fileURLToPath(new URL('.', import.meta.url));
const port = Number(process.argv[2] || process.env.PORT || 8080);
const root = resolve(process.argv[3] || join(here, '..', 'web'));
const romDir = resolve(process.env.ROCKANROLA_ROM_DIR || join(here, '..', 'rom'));
const localRomEnabled = process.env.ROCKANROLA_LOCAL_ROM !== '0';

async function findLocalRom() {
  if (!localRomEnabled) return null;
  try {
    const names = (await readdir(romDir)).filter((n) => /\.(sfc|smc|zip)$/i.test(n)).sort();
    return names.length ? join(romDir, names[0]) : null;
  } catch { return null; }
}

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.wasm': 'application/wasm',
  '.json': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

export const CSP = "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; " +
  "style-src 'self'; img-src 'self' data:; connect-src 'self'; worker-src 'self'; " +
  "object-src 'none'; base-uri 'self'; form-action 'none'; frame-ancestors 'none'";

const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname === '/local-rom') {
    const rom = await findLocalRom();
    if (!rom) { res.writeHead(404, { 'Cache-Control': 'no-store' }).end(); return; }
    const body = await readFile(rom);
    res.writeHead(200, {
      'Content-Type': 'application/octet-stream',
      'Content-Length': body.length,
      'Cache-Control': 'no-store',
      'X-Rom-Name': encodeURIComponent(basename(rom)),
    });
    res.end(req.method === 'HEAD' ? undefined : body);
    return;
  }
  let path = decodeURIComponent(url.pathname);
  if (path.endsWith('/')) path += 'index.html';
  const file = normalize(join(root, path));
  if (file !== root && !file.startsWith(root + sep)) {
    res.writeHead(403).end('forbidden');
    return;
  }
  try {
    const info = await stat(file);
    if (!info.isFile()) throw new Error('not a file');
    const body = await readFile(file);
    res.writeHead(200, {
      'Content-Type': TYPES[extname(file).toLowerCase()] || 'application/octet-stream',
      'Content-Length': body.length,
      'Cache-Control': 'no-cache',
      'X-Content-Type-Options': 'nosniff',
      // Same policy as web/_headers, so local tests catch CSP problems.
      'Content-Security-Policy': CSP,
      'Referrer-Policy': 'no-referrer',
    });
    res.end(req.method === 'HEAD' ? undefined : body);
  } catch {
    console.warn(`404 ${req.method} ${url.pathname}`);
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('No encontrado');
  }
});

server.listen(port, '127.0.0.1', async () => {
  console.log(`Rockanrola en http://localhost:${port}/  (sirviendo ${root})`);
  const rom = await findLocalRom();
  console.log(rom ? `ROM local para arranque directo: ${rom}` : 'Sin ROM local: la página pedirá elegir una.');
});
