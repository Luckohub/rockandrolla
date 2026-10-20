// Rockanrola - automated browser check over the Chrome DevTools Protocol.
// Dependency-free (Node 22+ for the global WebSocket).
//
//   node scripts/browser-test.mjs [--browser chrome|edge] [--rom path\to\rom.sfc]
//
// Without --rom it verifies everything that does not need the game: page
// load, console, failed requests, engine download/initialisation, and that
// wrong files are rejected with a useful message. With --rom (your own
// legal copy, read locally) it also boots the game, presses Start, measures
// frame rate and audio, exercises pause/reset/snapshots and saves
// screenshots to build/browser-test/.
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = fileURLToPath(new URL('.', import.meta.url));
const repo = resolve(here, '..');
const args = process.argv.slice(2);
const opt = (name, fallback) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : fallback; };
const browserName = opt('browser', 'chrome');
const romPath = opt('rom', null);
const localRom = args.includes('--local-rom');
const port = Number(opt('port', 8089));
const debugPort = 9300 + Math.floor(Math.random() * 500);

const BROWSERS = {
  chrome: ['C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
           `${process.env.LOCALAPPDATA}\\Google\\Chrome\\Application\\chrome.exe`],
  edge: ['C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
         'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'],
};
const exe = (BROWSERS[browserName] || []).find((p) => existsSync(p));
if (!exe) { console.error(`No se encontró ${browserName}`); process.exit(2); }

const outDir = join(repo, 'build', 'browser-test');
mkdirSync(outDir, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` - ${detail}` : ''}`); };

// ---------------------------------------------------------------- server
const server = spawn(process.execPath, [join(here, 'serve.mjs'), String(port), join(repo, 'web')], {
  stdio: ['ignore', 'pipe', 'pipe'],
  env: { ...process.env, ROCKANROLA_LOCAL_ROM: localRom ? '1' : '0' },
});
const serverLog = [];
server.stdout.on('data', (d) => serverLog.push(String(d)));
server.stderr.on('data', (d) => serverLog.push(String(d)));
await sleep(600);

// --------------------------------------------------------------- browser
const profile = mkdtempSync(join(tmpdir(), 'rockanrola-cdp-'));
const browser = spawn(exe, [
  '--headless=new', `--remote-debugging-port=${debugPort}`, `--user-data-dir=${profile}`,
  '--no-first-run', '--no-default-browser-check', '--autoplay-policy=no-user-gesture-required',
  '--window-size=1280,900', 'about:blank',
], { stdio: 'ignore' });

let target;
for (let i = 0; i < 50 && !target; i++) {
  await sleep(200);
  try {
    const list = await (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json();
    target = list.find((t) => t.type === 'page');
  } catch { /* not up yet */ }
}
if (!target) { console.error('No se pudo conectar con el navegador'); cleanup(2); }

const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
let nextId = 1;
const pending = new Map();
const consoleMessages = [];
const exceptions = [];
const failedRequests = [];
ws.onmessage = (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.id && pending.has(msg.id)) {
    const { resolve: res, reject } = pending.get(msg.id);
    pending.delete(msg.id);
    if (msg.error) reject(new Error(msg.error.message)); else res(msg.result);
    return;
  }
  if (msg.method === 'Runtime.consoleAPICalled') {
    consoleMessages.push({ type: msg.params.type, text: msg.params.args.map((a) => a.value ?? a.description ?? '').join(' ') });
  } else if (msg.method === 'Runtime.exceptionThrown') {
    exceptions.push(msg.params.exceptionDetails.exception?.description || msg.params.exceptionDetails.text);
  } else if (msg.method === 'Network.responseReceived') {
    const r = msg.params.response;
    if (r.status >= 400) failedRequests.push(`${r.status} ${r.url}`);
  } else if (msg.method === 'Network.loadingFailed') {
    if (!msg.params.canceled) failedRequests.push(`${msg.params.errorText} ${msg.params.requestId}`);
  } else if (msg.method === 'Log.entryAdded') {
    const e = msg.params.entry;
    if (e.level === 'error') consoleMessages.push({ type: 'browser-error', text: `${e.text} ${e.url || ''}` });
  }
};
const send = (method, params = {}) => new Promise((res, reject) => {
  const id = nextId++;
  pending.set(id, { resolve: res, reject });
  ws.send(JSON.stringify({ id, method, params }));
});
const evaluate = async (expression, userGesture = false) => {
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
  return r.result.value;
};
const waitFor = async (expression, timeoutMs, label) => {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    try { if (await evaluate(expression)) return true; } catch { /* page navigating */ }
    await sleep(150);
  }
  throw new Error(`Tiempo agotado esperando: ${label}`);
};
const screenshot = async (name) => {
  const r = await send('Page.captureScreenshot', { format: 'png' });
  const file = join(outDir, `${browserName}-${name}.png`);
  writeFileSync(file, Buffer.from(r.data, 'base64'));
  return file;
};
const visible = (id) => `!document.getElementById('${id}').hidden`;
const setFile = async (path) => {
  const { root } = await send('DOM.getDocument', { depth: -1 });
  const { nodeId } = await send('DOM.querySelector', { nodeId: root.nodeId, selector: '#input-rom' });
  await send('DOM.setFileInputFiles', { nodeId, files: [path] });
};
const key = async (code, keyName, type) => {
  const vk = { Enter: 13, KeyZ: 90, KeyP: 80, ArrowLeft: 37, ArrowRight: 39, ArrowUp: 38 }[code] || 0;
  await send('Input.dispatchKeyEvent', { type, code, key: keyName, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk });
};
const tap = async (code, keyName, holdMs = 120) => { await key(code, keyName, 'keyDown'); await sleep(holdMs); await key(code, keyName, 'keyUp'); };

class Done extends Error {}

async function gameChecks() {
    await sleep(6000);
    await screenshot('4-arranque');
    for (let i = 0; i < 6; i++) { await tap('Enter', 'Enter'); await sleep(1500); }
    await screenshot('5-tras-start');
    for (let i = 0; i < 4; i++) { await tap('KeyZ', 'z', 600); await tap('ArrowRight', 'ArrowRight', 300); }
    await sleep(3000);
    await screenshot('6-tras-controles');
    const autoPaused = await evaluate(visible('capa-pausa'));
    check('sin pausa automática inesperada', !autoPaused);
    if (autoPaused) await evaluate(`document.getElementById('btn-pausa').click()`, true);
    const hud = await evaluate(`document.getElementById('hud').textContent`);
    const fps = parseFloat(hud);
    check('ritmo de frames cercano a 60 fps', fps > 55 && fps < 65, hud);
    const stopped = await evaluate(visible('capa-error'));
    check('el núcleo estático no se detuvo', !stopped, stopped ? await evaluate(`document.getElementById('texto-error-juego').textContent`) : '');
    const pixels = await evaluate(`(() => { const c = document.getElementById('pantalla').getContext('2d').getImageData(0,0,256,224).data; let s = new Set(); for (let i = 0; i < c.length; i += 4*97) s.add(c[i] << 16 | c[i+1] << 8 | c[i+2]); return s.size; })()`);
    check('la imagen tiene contenido (colores distintos)', pixels > 4, `${pixels} colores muestreados`);
    const audio = await evaluate(`(() => { const h = document.getElementById('hud').textContent; return /audio en búfer/.test(h) ? h : null; })()`);
    check('audio activo y alimentado', !!audio, audio || 'sin audio');
    await tap('KeyP', 'p');
    await sleep(400);
    check('pausa con P', await evaluate(visible('capa-pausa')));
    await tap('KeyP', 'p');
    await sleep(400);
    check('reanuda con P', !(await evaluate(visible('capa-pausa'))));
    await evaluate(`document.getElementById('btn-guardar').click()`, true);
    await sleep(800);
    await evaluate(`document.getElementById('btn-cargar').click()`, true);
    await sleep(800);
    const t = await evaluate(`document.querySelector('.toast')?.textContent || ''`);
    check('guardar y cargar estado', /Estado cargado/.test(t), t);
    await screenshot('7-final');
}

function cleanup(code) {
  try { ws?.close(); } catch { /* ignore */ }
  try { browser.kill(); } catch { /* ignore */ }
  try { server.kill(); } catch { /* ignore */ }
  setTimeout(() => { try { rmSync(profile, { recursive: true, force: true }); } catch { /* locked */ } process.exit(code); }, 500);
}

try {
  await send('Runtime.enable');
  await send('Log.enable');
  await send('Network.enable');
  await send('Page.enable');
  await send('DOM.enable');
  // Keep the headless tab "visible/focused" so the page's auto-pause on
  // visibilitychange does not trigger (Edge headless reports hidden tabs).
  await send('Emulation.setFocusEmulationEnabled', { enabled: true });
  await send('Page.bringToFront');
  const version = await send('Browser.getVersion');
  console.log(`Navegador: ${version.product}`);

  await send('Page.navigate', { url: `http://localhost:${port}/` });
  if (localRom) {
    const t1 = Date.now();
    await waitFor(`${visible('juego')} || ${visible('rom')} || ${visible('error')}`, 30000, 'arranque directo');
    const ok = await evaluate(visible('juego'));
    check('arranque directo con la ROM de la carpeta rom, sin clics', ok,
      ok ? `${Date.now() - t1} ms hasta el juego` : await evaluate(`document.getElementById('error-rom').textContent || document.getElementById('texto-error').textContent`));
    if (ok) await gameChecks();
    throw new Done();
  }
  await waitFor(`document.readyState === 'complete' && ${visible('portada')}`, 10000, 'portada');
  check('portada visible', true);
  await screenshot('1-portada');

  const t0 = Date.now();
  await evaluate(`document.getElementById('btn-jugar').click()`, true);
  await waitFor(`${visible('rom')} || ${visible('error')} || ${visible('juego')}`, 30000, 'motor cargado');
  const loadMs = Date.now() - t0;
  const errorShown = await evaluate(visible('error'));
  check('motor descargado e inicializado', !errorShown, errorShown ? await evaluate(`document.getElementById('texto-error').textContent`) : `${loadMs} ms`);
  if (errorShown) throw new Error('El motor no inicializó');
  await screenshot('2-elegir-rom');

  // Wrong-size file.
  const tmp = mkdtempSync(join(tmpdir(), 'rockanrola-rom-'));
  const small = join(tmp, 'pequeno.sfc');
  writeFileSync(small, Buffer.alloc(4096, 0x55));
  await setFile(small);
  await waitFor(`!document.getElementById('error-rom').hidden && /bytes/.test(document.getElementById('error-rom').textContent)`, 10000, 'rechazo por tamaño');
  check('rechaza archivo de tamaño incorrecto', true, await evaluate(`document.getElementById('error-rom').textContent`));

  // Right size, wrong content (synthetic, not game data).
  const fake = join(tmp, 'falso.sfc');
  const buf = Buffer.alloc(1048576);
  for (let i = 0; i < buf.length; i++) buf[i] = (i * 2654435761) >>> 24;
  writeFileSync(fake, buf);
  await setFile(fake);
  await waitFor(`/SHA-256 obtenido/.test(document.getElementById('error-rom').textContent)`, 10000, 'rechazo por SHA-256');
  check('rechaza ROM con SHA-256 distinto', true, (await evaluate(`document.getElementById('error-rom').textContent`)).slice(0, 120) + '…');
  await screenshot('3-rom-rechazada');
  rmSync(tmp, { recursive: true, force: true });

  // The AudioWorklet runs without the game: feed it 0.5 s of a synthetic
  // 440 Hz tone at the core's 32,040 Hz rate and check it is consumed.
  const worklet = await evaluate(`(async () => {
    const ctx = new AudioContext();
    await ctx.resume();
    await ctx.audioWorklet.addModule('audio-worklet.js');
    const node = new AudioWorkletNode(ctx, 'rockanrola-audio', { numberOfInputs: 0, numberOfOutputs: 1,
      outputChannelCount: [2], processorOptions: { inputRate: 32040, capacity: 32768, prebuffer: 1600 } });
    node.connect(ctx.destination);
    const levels = [];
    node.port.onmessage = (e) => levels.push(e.data.frames);
    const n = 16020, f = new Float32Array(n * 2);
    for (let i = 0; i < n; i++) f[i * 2] = f[i * 2 + 1] = 0.1 * Math.sin(2 * Math.PI * 440 * i / 32040);
    node.port.postMessage({ type: 'pcm', samples: f }, [f.buffer]);
    await new Promise((r) => setTimeout(r, 300));
    const rate = ctx.sampleRate;
    await ctx.close();
    return { rate, levels };
  })()`, true);
  const lv = worklet.levels;
  check('worklet de audio carga y consume PCM', lv.length > 2 && lv[lv.length - 1] < lv[0],
    `dispositivo ${worklet.rate} Hz, búfer ${lv[0]} -> ${lv[lv.length - 1]} frames`);

  if (romPath) {
    await setFile(resolve(romPath));
    await waitFor(`${visible('juego')} || /SHA|bytes/.test(document.getElementById('error-rom').textContent)`, 20000, 'arranque con ROM');
    const inGame = await evaluate(visible('juego'));
    check('la ROM aportada es aceptada y el juego arranca', inGame, inGame ? '' : await evaluate(`document.getElementById('error-rom').textContent`));
    if (inGame) await gameChecks();
  }

  if (!romPath) {
    // Layout of the (empty) game area, without running the game: desktop
    // 1280x900 and a 390 px phone width.
    for (const [w, h, label] of [[1280, 900, 'escritorio'], [390, 844, 'telefono']]) {
      await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: w < 600 });
      await evaluate(`for (const s of document.querySelectorAll('main > .screen')) s.hidden = s.id !== 'juego'; true`);
      await sleep(400);
      const m = await evaluate(`(() => { const c = document.getElementById('pantalla').getBoundingClientRect();
        const t = document.querySelector('.toolbar').getBoundingClientRect();
        return { cw: c.width, ch: c.height, tw: t.width, scroll: document.documentElement.scrollWidth, vw: innerWidth }; })()`);
      const ratio = m.cw / m.ch;
      check(`diseño del área de juego (${label})`, m.cw > 200 && Math.abs(ratio - 4 / 3) < 0.02 && m.scroll <= m.vw,
        `lienzo ${Math.round(m.cw)}x${Math.round(m.ch)}, ancho de página ${m.scroll}/${m.vw}`);
      await screenshot(`8-area-juego-${label}`);
    }
    await send('Emulation.clearDeviceMetricsOverride');
  }

} catch (e) {
  if (!(e instanceof Done)) check('ejecución de la prueba', false, e.message);
  if (!(e instanceof Done)) { try { await screenshot('error'); } catch { /* ignore */ } }
}

const errors = consoleMessages.filter((m) => m.type === 'error' || m.type === 'browser-error');
check('sin errores en la consola', errors.length === 0, errors.map((e) => e.text).join(' | '));
check('sin excepciones de JavaScript', exceptions.length === 0, exceptions.join(' | '));
check('sin solicitudes fallidas', failedRequests.length === 0, failedRequests.join(' | '));
const info = consoleMessages.filter((m) => /rockanrola/.test(m.text)).map((m) => m.text);
if (info.length) console.log(`Consola: ${info.join(' | ')}`);

writeFileSync(join(outDir, `${browserName}-resultado.json`), JSON.stringify({ browser: browserName, rom: !!romPath, results, consoleMessages, exceptions, failedRequests, serverLog }, null, 2));
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} comprobaciones superadas (${browserName}). Capturas en build/browser-test/`);
cleanup(failed ? 1 : 0);
