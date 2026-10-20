// Rockanrola - builds the PUBLIC copy of the site in build/public.
//
//   node scripts/prepare-public.mjs [outDir]
//
// The public site is the guest page: it lets someone join an online game
// as player 2. It must never contain the game engine (web/engine/, the
// WebAssembly translation of the game) or any ROM, so this script copies
// web/ without them and then fails if anything game-related slipped in.
// Use its output for any host (GitHub Pages, Cloudflare Pages, Netlify...).
import { cpSync, existsSync, readdirSync, rmSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = fileURLToPath(new URL('.', import.meta.url));
const repo = resolve(here, '..');
const src = join(repo, 'web');
const out = resolve(process.argv[2] || join(repo, 'build', 'public'));
const FORBIDDEN = /\.(sfc|smc|swc|fig|zip|7z|rar|wasm|bin|pcm|ppm)$/i;

rmSync(out, { recursive: true, force: true });
cpSync(src, out, {
  recursive: true,
  filter: (p) => {
    const rel = relative(src, p).replace(/\\/g, '/');
    return !(rel === 'engine' || rel.startsWith('engine/') || FORBIDDEN.test(rel));
  },
});

const files = [];
(function walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p); else files.push(relative(out, p).replace(/\\/g, '/'));
  }
})(out);
const bad = files.filter((f) => FORBIDDEN.test(f) || f.startsWith('engine/'));
if (bad.length || existsSync(join(out, 'engine'))) {
  console.error(`ERROR: la copia pública contiene archivos del juego o del motor: ${bad.join(', ')}`);
  process.exit(1);
}
console.log(`Copia pública lista en ${out} (${files.length} archivos, sin motor ni ROM):`);
for (const f of files.sort()) console.log(`  ${f}`);
