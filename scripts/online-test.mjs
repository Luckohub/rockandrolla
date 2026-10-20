// Rockanrola - end-to-end check of online play and key remapping.
//
//   node scripts/online-test.mjs [--browser chrome|edge] [--public]
//
// --public: the guest uses the PUBLIC copy (scripts/prepare-public.mjs)
// served under a non-localhost name (rockanrola.test, treated as a secure
// origin), the way a brother at home would open the published page.
//
// Needs your ROM in rom/ (local auto-start) and internet access to the
// PeerJS broker (0.peerjs.com). Opens two windows of one headless browser:
// the host plays the game, the guest joins with the room code. Checks that
// the guest receives the video, that the guest's keys drive SNES controller
// 2 inside the host's engine, latency reporting, pause from both sides,
// disconnection, and keyboard remapping. Screenshots: build/online-test/.
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = fileURLToPath(new URL('.', import.meta.url));
const repo = resolve(here, '..');
const args = process.argv.slice(2);
const opt = (name, fallback) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : fallback; };
const browserName = opt('browser', 'chrome');
const publicMode = args.includes('--public');
const port = Number(opt('port', 8088));
const debugPort = 9800 + Math.floor(Math.random() * 150);
const BROWSERS = {
  chrome: ['C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'],
  edge: ['C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'],
};
const exe = (BROWSERS[browserName] || []).find((p) => existsSync(p));
if (!exe) { console.error(`No se encontró ${browserName}`); process.exit(2); }
const outDir = join(repo, 'build', 'online-test');
mkdirSync(outDir, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` - ${detail}` : ''}`); };

class Cdp {
  constructor(url, label) { this.url = url; this.label = label; this.id = 1; this.pending = new Map(); this.errors = []; this.failed = []; }
  async connect() {
    this.ws = new WebSocket(this.url);
    await new Promise((r, j) => { this.ws.onopen = r; this.ws.onerror = j; });
    this.ws.onmessage = (ev) => {
      const m = JSON.parse(ev.data);
      if (m.id && this.pending.has(m.id)) { const p = this.pending.get(m.id); this.pending.delete(m.id); m.error ? p.reject(new Error(m.error.message)) : p.resolve(m.result); return; }
      if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') this.errors.push(m.params.args.map((a) => a.value ?? a.description ?? '').join(' '));
      if (m.method === 'Runtime.exceptionThrown') this.errors.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text);
      if (m.method === 'Network.responseReceived' && m.params.response.status >= 400) this.failed.push(`${m.params.response.status} ${m.params.response.url}`);
    };
    return this;
  }
  send(method, params = {}) {
    return new Promise((resolve, reject) => { const id = this.id++; this.pending.set(id, { resolve, reject }); this.ws.send(JSON.stringify({ id, method, params })); });
  }
  async eval(expression, userGesture = false) {
    const r = await this.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
    return r.result.value;
  }
  async waitFor(expression, ms, label) {
    const end = Date.now() + ms;
    while (Date.now() < end) { try { const v = await this.eval(expression); if (v) return v; } catch { /* navigating */ } await sleep(200); }
    throw new Error(`[${this.label}] tiempo agotado: ${label}`);
  }
  async shot(name) { const r = await this.send('Page.captureScreenshot', { format: 'png' }); writeFileSync(join(outDir, `${browserName}-${name}.png`), Buffer.from(r.data, 'base64')); }
  async key(code, key, type) {
    const vk = { ArrowRight: 39, ArrowLeft: 37, KeyP: 80, KeyQ: 81, KeyZ: 90, Enter: 13 }[code] || 0;
    await this.send('Input.dispatchKeyEvent', { type, code, key, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk });
  }
  async tap(code, key, ms = 120) { await this.key(code, key, 'keyDown'); await sleep(ms); await this.key(code, key, 'keyUp'); }
  async setup() {
    for (const d of ['Runtime', 'Network', 'Page']) await this.send(`${d}.enable`);
    await this.send('Emulation.setFocusEmulationEnabled', { enabled: true });
  }
}

const server = spawn(process.execPath, [join(here, 'serve.mjs'), String(port), join(repo, 'web')], {
  stdio: 'ignore', env: { ...process.env, ROCKANROLA_LOCAL_ROM: '1' },
});
const publicPort = port + 1;
const publicOrigin = `http://rockanrola.test:${publicPort}`;
let publicServer = null;
if (publicMode) {
  const prep = spawnSync(process.execPath, [join(here, 'prepare-public.mjs')], { encoding: 'utf8' });
  if (prep.status !== 0) { console.error(prep.stderr); process.exit(1); }
  publicServer = spawn(process.execPath, [join(here, 'serve.mjs'), String(publicPort), join(repo, 'build', 'public')], {
    stdio: 'ignore', env: { ...process.env, ROCKANROLA_LOCAL_ROM: '0' },
  });
}
const profile = mkdtempSync(join(tmpdir(), 'rockanrola-online-'));
const browser = spawn(exe, ['--headless=new', `--remote-debugging-port=${debugPort}`, `--user-data-dir=${profile}`,
  '--no-first-run', '--no-default-browser-check', '--autoplay-policy=no-user-gesture-required',
  // Automation: do not throttle windows the OS reports as hidden/occluded.
  '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding', '--disable-background-timer-throttling',
  '--disable-features=CalculateNativeWinOcclusion',
  '--window-size=1100,860',
  ...(publicMode ? [`--host-resolver-rules=MAP rockanrola.test 127.0.0.1`, `--unsafely-treat-insecure-origin-as-secure=${publicOrigin}`] : []),
  'about:blank'], { stdio: 'ignore' });
// Ends the whole browser: a polite CDP Browser.close first, then the full
// process tree (on Windows, killing only the parent leaves renderer and GPU
// processes running and they pile up across runs).
async function closeBrowser(child, closeViaCdp) {
  try { await Promise.race([closeViaCdp(), sleep(1500)]); } catch { /* already gone */ }
  await sleep(300);
  if (process.platform === 'win32') spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
  else { try { child.kill('SIGKILL'); } catch { /* ignore */ } }
}

let rootCdp = null;
async function cleanup(code) {
  await closeBrowser(browser, () => (rootCdp ? rootCdp.send('Browser.close') : Promise.resolve()));
  try { server.kill(); } catch { /* ignore */ }
  try { publicServer && publicServer.kill(); } catch { /* ignore */ }
  setTimeout(() => { try { rmSync(profile, { recursive: true, force: true }); } catch { /* locked */ } process.exit(code); }, 600);
}

let host, guest;
try {
  await sleep(700);
  let version;
  for (let i = 0; i < 50 && !version; i++) { await sleep(200); try { version = await (await fetch(`http://127.0.0.1:${debugPort}/json/version`)).json(); } catch { /* starting */ } }
  const root = await new Cdp(version.webSocketDebuggerUrl, 'browser').connect();
  rootCdp = root;
  console.log(`Navegador: ${version.Browser}`);
  const list = await (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json();
  host = await new Cdp(list.find((t) => t.type === 'page').webSocketDebuggerUrl, 'anfitrión').connect();
  // A separate window so neither page is a hidden background tab.
  const { targetId } = await root.send('Target.createTarget', { url: 'about:blank', newWindow: true });
  const list2 = await (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json();
  guest = await new Cdp(list2.find((t) => t.id === targetId).webSocketDebuggerUrl, 'invitado').connect();
  await host.setup();
  await guest.setup();

  // ---- Host starts the game from the local ROM and opens a room.
  await host.send('Page.navigate', { url: `http://localhost:${port}/` });
  await host.waitFor(`!document.getElementById('juego').hidden`, 30000, 'juego del anfitrión');
  await sleep(1500);
  await host.eval(`document.getElementById('btn-online').click()`, true);
  const code = await host.waitFor(`window.__rockanrola && window.__rockanrola.roomCode()`, 25000, 'código de sala (servidor PeerJS)');
  check('el anfitrión abre una sala en el servidor PeerJS', !!code, `código ${code}`);
  const link = await host.eval(`document.getElementById('online-enlace').value`);
  check('enlace de invitación generado', link.includes(`?sala=${code}`), link);
  await host.shot('1-anfitrion-sala');
  await host.eval(`document.getElementById('btn-online-listo').click()`, true);

  // ---- Guest joins with the code.
  const t0 = Date.now();
  const guestUrl = publicMode ? `${publicOrigin}/?sala=${code}` : `http://localhost:${port}/?sala=${code}`;
  await guest.send('Page.navigate', { url: guestUrl });
  await guest.waitFor(`!document.getElementById('invitado').hidden`, 10000, 'pantalla de invitado');
  if (publicMode) {
    const secure = await guest.eval(`window.isSecureContext && location.hostname`);
    check('el invitado abre la copia pública en un dominio no local', secure === 'rockanrola.test', `${guestUrl} (contexto seguro: ${!!secure})`);
  }
  const engineRequested = await guest.eval(`performance.getEntriesByType('resource').some((e) => /rockanrola\\.wasm|local-rom/.test(e.name))`);
  check('el invitado no descarga el motor ni la ROM', !engineRequested);
  await guest.eval(`document.getElementById('btn-unirse-ahora').click()`, true);
  await guest.waitFor(`document.getElementById('video-remoto').videoWidth > 0`, 30000, 'video en el invitado');
  const joinMs = Date.now() - t0;
  const dims = await guest.eval(`(() => { const v = document.getElementById('video-remoto'); return v.videoWidth + 'x' + v.videoHeight; })()`);
  check('el invitado recibe el video del juego', true, `${dims} en ${joinMs} ms`);
  await sleep(800);
  const overlay = await guest.eval(`document.getElementById('capa-invitado').hidden ? '' : document.getElementById('texto-invitado').textContent`);
  check('el video se reproduce sin avisos encima', overlay === '', overlay);
  check('el anfitrión ve al jugador 2 conectado', await host.waitFor(`window.__rockanrola.guestConnected()`, 10000, 'conexión'));
  // Let WebRTC's bandwidth estimate ramp up, then count decoded frames for 5 s.
  await sleep(4000);
  const hs0 = await host.eval(`window.__rockanrola.hostVideoStats()`);
  const gs0 = await guest.eval(`window.__rockanrola.guestVideoStats()`);
  const tStats = Date.now();
  const vq = await guest.eval(`new Promise((res) => { const v = document.getElementById('video-remoto'); const seen = new Set(); const t = performance.now();
    const cb = (now, md) => { seen.add(md.presentedFrames); if (performance.now() - t < 5000) v.requestVideoFrameCallback(cb); else res({ fps: seen.size / ((performance.now() - t) / 1000), w: v.videoWidth, h: v.videoHeight }); };
    v.requestVideoFrameCallback(cb); })`);
  const hostFps = parseFloat(await host.eval(`document.getElementById('hud').textContent`));
  const draws = await host.eval(`window.__rockanrola.drawsPerSecond()`);
  const hs = await host.eval(`window.__rockanrola.hostVideoStats()`);
  const gs = await guest.eval(`window.__rockanrola.guestVideoStats()`);
  // Rates from cumulative counters over the whole window (the instantaneous
  // framesPerSecond stat fluctuates from one sample to the next).
  const secs = (Date.now() - tStats) / 1000;
  hs.sentFps = (hs.framesSent - hs0.framesSent) / secs;
  gs.recvFps = (gs.framesDecoded - gs0.framesDecoded) / secs;
  gs.framesDropped -= gs0.framesDropped;
  // WebRTC's own counters are authoritative; the on-screen count is limited
  // by headless compositing when both windows share one machine.
  // Every frame the host draws must reach the guest. (The host's draw rate
  // follows requestAnimationFrame, which headless windows may throttle.)
  console.log(`  codificador: ${hs?.encoder} | decodificador: ${gs?.decoder}`);
  check('fluidez del video en el invitado (WebRTC)', gs && hs && draws >= 45 && hs.sentFps >= draws * 0.9 &&
    gs.recvFps >= draws * 0.9 && gs.framesDropped === 0,
    `enviados ${hs?.sentFps?.toFixed(1)} fps, decodificados ${gs?.recvFps?.toFixed(1)} fps, perdidos ${gs?.framesDropped}, búfer ${gs?.jitterBufferMs?.toFixed(0)} ms, ` +
    `limitación «${hs?.limitation}», ${(8 * (hs?.bytesSent || 0) / 1e6 / Math.max(1, (hs?.framesSent || 1) / 60)).toFixed(1)} Mbit/s; ` +
    `presentados en pantalla ${vq.fps.toFixed(0)}/s; anfitrión ${hostFps} fps de juego y ${draws.toFixed(0)} dibujados/s`);
  const hasAudio = await guest.eval(`document.getElementById('video-remoto').srcObject.getAudioTracks().length`);
  check('el invitado recibe la pista de audio', hasAudio > 0, `${hasAudio} pista(s)`);

  // ---- Guest keys drive SNES controller 2 in the host engine.
  await guest.key('ArrowRight', 'ArrowRight', 'keyDown');
  const held = await host.waitFor(`(window.__rockanrola.p2Mask() & 0x0100) ? window.__rockanrola.p2Mask() : 0`, 5000, 'mando 2 derecha');
  check('tecla del invitado llega como mando 2 (Derecha)', (held & 0x0100) !== 0, `máscara 0x${held.toString(16)}`);
  await guest.key('ArrowRight', 'ArrowRight', 'keyUp');
  const released = await host.waitFor(`window.__rockanrola.p2Mask() === 0 ? 'ok' : ''`, 5000, 'mando 2 suelto');
  check('soltar la tecla libera el mando 2', released === 'ok');
  await guest.tap('KeyZ', 'z', 60);
  await sleep(500);
  const latency = await guest.eval(`document.getElementById('hud-invitado').textContent`);
  check('latencia visible en el invitado', /latencia ida y vuelta \d+ ms/.test(latency), latency);
  await guest.shot('2-invitado-jugando');
  await host.shot('3-anfitrion-con-invitado');

  // ---- Pause from the guest reaches both screens.
  await guest.tap('KeyP', 'p');
  await host.waitFor(`!document.getElementById('capa-pausa').hidden`, 5000, 'pausa en el anfitrión');
  await guest.waitFor(`!document.getElementById('capa-pausa-invitado').hidden`, 5000, 'pausa en el invitado');
  check('el invitado puede pausar la partida', true);
  await guest.tap('KeyP', 'p');
  await host.waitFor(`document.getElementById('capa-pausa').hidden`, 5000, 'reanudar');
  check('el invitado puede reanudar la partida', true);

  // ---- Guest leaves; the host keeps the room open.
  await guest.eval(`document.getElementById('btn-salir-invitado').click()`, true);
  await host.waitFor(`!window.__rockanrola.guestConnected()`, 10000, 'desconexión');
  check('el anfitrión detecta la salida del invitado', true);

  // ---- Key remapping on the host: B -> Q.
  await host.eval(`document.getElementById('btn-teclas').click()`, true);
  await host.waitFor(`document.getElementById('dlg-teclas').open`, 3000, 'diálogo de teclas');
  const pausedByDialog = await host.eval(`!document.getElementById('capa-pausa').hidden`);
  check('abrir «Teclas» pausa el juego', pausedByDialog);
  await host.eval(`document.querySelector('.key-slot[data-id="B"][data-slot="0"]').click()`, true);
  await host.tap('KeyQ', 'q');
  await sleep(200);
  const slot = await host.eval(`document.querySelector('.key-slot[data-id="B"][data-slot="0"]').textContent`);
  await host.shot('4-remapeo');
  check('remapeo: B pasa a la tecla Q', slot === 'Q', `casilla muestra «${slot}»`);
  const stored = await host.eval(`JSON.parse(localStorage.getItem('rockanrola.keymap.v1')).B[0]`);
  check('remapeo guardado en el navegador', stored === 'KeyQ', stored);
  await host.eval(`document.getElementById('btn-teclas-defecto').click()`, true);
  const restored = await host.eval(`document.querySelector('.key-slot[data-id="B"][data-slot="0"]').textContent`);
  check('restaurar teclas predeterminadas', restored === 'Z', restored);
  await host.eval(`document.getElementById('btn-teclas-cerrar').click()`, true);
  await sleep(300);
  check('cerrar «Teclas» reanuda el juego', await host.eval(`document.getElementById('capa-pausa').hidden`));

  for (const p of [host, guest]) {
    check(`sin errores de consola (${p.label})`, p.errors.length === 0, p.errors.join(' | '));
    check(`sin solicitudes fallidas (${p.label})`, p.failed.length === 0, p.failed.join(' | '));
  }
} catch (e) {
  check('ejecución de la prueba', false, e.message);
  try { await host?.shot('error-anfitrion'); await guest?.shot('error-invitado'); } catch { /* ignore */ }
}
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} comprobaciones superadas (${browserName}). Capturas en build/online-test/`);
cleanup(failed ? 1 : 0);
