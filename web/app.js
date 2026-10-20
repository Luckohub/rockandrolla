// Rockanrola - page controller.
//
// Loads the WebAssembly build of the Rock n' Roll Racing static recomp,
// verifies the user's ROM locally, and drives the core one video frame at a
// time: keyboard/gamepad in, RGBA frame and 32,040 Hz PCM out. Nothing here
// emulates or replaces the game; it only feeds and presents the core.

const ROM_SIZE = 1048576;
const COPIER_HEADER = 512;
const EXPECTED_SHA = '9d721753301278325c851f1843d669a697aed757dcf6495a31fc31ddf664b182';
const SNAPSHOT_PATH = '/rockanrola-snapshot.bin';
const AUDIO_TARGET_FRAMES = 2400;   // ~75 ms of 32,040 Hz audio in the worklet
const MAX_FRAMES_PER_TICK = 4;

import { buildLookup, loadKeymap, loadLayoutLabels, readGamepads } from './keymap.js';
import { createKeysUI } from './keys-ui.js';
import { HostSession, inviteLink, isLocalHost, normalizeCode } from './net.js';
import { createGuest } from './guest.js';
import { NET } from './config.js';

// Keyboard mapping: configurable, stored per browser (see keymap.js).
let keymap = loadKeymap();
let keyLookup = buildLookup(keymap);
let keysUI = null;   // created in init()
let guest = null;    // guest (player 2) screen controller

const $ = (id) => document.getElementById(id);

const state = {
  mod: null,
  loaded: false,
  running: false,
  paused: false,
  failed: false,
  starting: false,
  raf: 0,
  last: 0,
  acc: 0,
  fps: 60.0988,
  aspect: '4:3',
  muted: false,
  ctx2d: null,
  image: null,
  audio: { ctx: null, node: null, gain: null, ready: false, level: 0, underruns: 0, warned: false },
  stats: { frames: 0, cost: 0, samples: 0, since: 0 },
  romWaiter: null,
  host: null,          // HostSession while a room is open
  p2pad: 0,            // guest gamepad state (SNES controller 2)
  stream: null,        // { canvas, ctx } scaled copy sent to the guest
  pausedByDialog: false,
};

// ------------------------------------------------------------ small helpers
function show(id) {
  for (const s of document.querySelectorAll('main > .screen')) s.hidden = s.id !== id;
}

function toast(text, ms = 2600) {
  let el = document.querySelector('.toast');
  if (!el) {
    el = document.createElement('div');
    el.className = 'toast';
    el.setAttribute('role', 'status');
    document.body.appendChild(el);
  }
  el.textContent = text;
  el.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => { el.hidden = true; }, ms);
}

const STEP_ORDER = ['compat', 'motor', 'init', 'rom', 'arranque'];
function step(name, status) {
  const li = document.querySelector(`#pasos li[data-step="${name}"]`);
  if (li) { li.classList.remove('active', 'done', 'fail'); if (status) li.classList.add(status); }
  const done = document.querySelectorAll('#pasos li.done').length;
  $('barra').style.width = `${Math.round((done / STEP_ORDER.length) * 100)}%`;
}
function resetSteps() {
  for (const n of STEP_ORDER) step(n, null);
  $('pct-motor').textContent = '';
  $('estado').textContent = '';
}
function status(text) { $('estado').textContent = text; }

class StartError extends Error {
  constructor(message, detail) { super(message); this.detail = detail; }
}

function fatal(message, detail) {
  stopLoop();
  for (const n of STEP_ORDER) {
    const li = document.querySelector(`#pasos li[data-step="${n}"]`);
    if (li && li.classList.contains('active')) step(n, 'fail');
  }
  $('texto-error').textContent = message;
  const pre = $('detalle-error');
  pre.hidden = !detail;
  pre.textContent = detail || '';
  show('error');
}

function loadSetting(key, fallback) {
  try { const v = localStorage.getItem(`rockanrola.${key}`); return v === null ? fallback : JSON.parse(v); }
  catch { return fallback; }
}
function saveSetting(key, value) {
  try { localStorage.setItem(`rockanrola.${key}`, JSON.stringify(value)); } catch { /* optional */ }
}

// IndexedDB key/value store; every failure degrades to "not stored".
let dbPromise = null;
function db() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve) => {
      try {
        const req = indexedDB.open('rockanrola', 1);
        req.onupgradeneeded = () => req.result.createObjectStore('kv');
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => resolve(null);
        req.onblocked = () => resolve(null);
      } catch { resolve(null); }
    });
  }
  return dbPromise;
}
async function kvGet(key) {
  const d = await db(); if (!d) return null;
  return new Promise((resolve) => {
    try {
      const r = d.transaction('kv').objectStore('kv').get(key);
      r.onsuccess = () => resolve(r.result ?? null);
      r.onerror = () => resolve(null);
    } catch { resolve(null); }
  });
}
async function kvSet(key, value) {
  const d = await db(); if (!d) return false;
  return new Promise((resolve) => {
    try {
      const tx = d.transaction('kv', 'readwrite');
      tx.objectStore('kv').put(value, key);
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => resolve(false);
    } catch { resolve(false); }
  });
}
async function kvDel(key) {
  const d = await db(); if (!d) return;
  await new Promise((resolve) => {
    try {
      const tx = d.transaction('kv', 'readwrite');
      tx.objectStore('kv').delete(key);
      tx.oncomplete = tx.onerror = tx.onabort = () => resolve();
    } catch { resolve(); }
  });
}

function withCString(mod, str, fn) {
  const size = mod.lengthBytesUTF8(str) + 1;
  const ptr = mod._malloc(size);
  try { mod.stringToUTF8(str, ptr, size); return fn(ptr); }
  finally { mod._free(ptr); }
}

async function fetchWithProgress(url, onProgress) {
  let res;
  try { res = await fetch(url); }
  catch (e) { throw new StartError('No se pudo descargar el motor. Revisá la conexión o el servidor.', `${url}: ${e.message}`); }
  if (res.status === 404 && !['localhost', '127.0.0.1', '[::1]'].includes(location.hostname)) {
    throw new StartError('Esta página pública no incluye el motor del juego, así que acá solo podés unirte a una partida online con el código que te pasaron.',
      'Para jugar como anfitrión, ejecutá Rockanrola en tu equipo (ver README) y abrí http://localhost.');
  }
  if (!res.ok) {
    throw new StartError(`El servidor respondió ${res.status} al pedir el motor.`,
      `${url}\nSi estás en desarrollo, compilá primero con scripts\\build.ps1 (ver README).`);
  }
  const total = Number(res.headers.get('content-length')) || 0;
  if (!res.body || !total) { const b = new Uint8Array(await res.arrayBuffer()); onProgress(1); return b; }
  const reader = res.body.getReader();
  const chunks = [];
  let got = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value); got += value.length;
    onProgress(Math.min(1, got / total));
  }
  const out = new Uint8Array(got);
  let o = 0;
  for (const c of chunks) { out.set(c, o); o += c.length; }
  return out;
}

// ------------------------------------------------------------------- audio
function ensureAudioContext() {
  // Must run synchronously inside the "Jugar" click so autoplay rules allow it.
  if (state.audio.ctx) { state.audio.ctx.resume().catch(() => {}); return; }
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return;
  try {
    state.audio.ctx = new AC({ latencyHint: 'interactive' });
    state.audio.ctx.resume().catch(() => {});
  } catch (e) {
    console.warn('AudioContext no disponible', e);
  }
}

async function setupAudio(inputRate) {
  const a = state.audio;
  if (a.ready || !a.ctx) {
    if (!a.ctx) toast('Este navegador no ofrece Web Audio: el juego funcionará sin sonido.', 5000);
    return;
  }
  if (!a.ctx.audioWorklet) {
    toast('Sin sonido: el navegador solo permite AudioWorklet en HTTPS o localhost.', 6000);
    return;
  }
  try {
    await a.ctx.audioWorklet.addModule('audio-worklet.js');
    a.node = new AudioWorkletNode(a.ctx, 'rockanrola-audio', {
      numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [2],
      processorOptions: { inputRate, capacity: 32768, prebuffer: 1600 },
    });
    a.gain = a.ctx.createGain();
    a.gain.gain.value = state.muted ? 0 : 1;
    a.node.connect(a.gain).connect(a.ctx.destination);
    a.node.port.onmessage = (e) => {
      if (e.data.type === 'level') { a.level = e.data.frames; a.underruns = e.data.underruns; }
    };
    a.ready = true;
  } catch (e) {
    console.warn('No se pudo iniciar el audio', e);
    toast('No se pudo iniciar el audio; el juego seguirá sin sonido.', 5000);
  }
}

function clearAudio() {
  if (state.mod) state.mod._rnrw_audio_discard();
  if (state.audio.node) state.audio.node.port.postMessage({ type: 'clear' });
  state.audio.level = 0;
}

function pumpAudio() {
  const mod = state.mod;
  const a = state.audio;
  if (!a.ready) { mod._rnrw_audio_discard(); return; }
  for (;;) {
    const n = mod._rnrw_audio_drain();
    if (!n) break;
    const ptr = mod._rnrw_audio_buffer();
    const src = new Int16Array(mod.HEAP16.buffer, ptr, n * 2);
    const f = new Float32Array(n * 2);
    for (let i = 0; i < f.length; i++) f[i] = src[i] / 32768;
    a.node.port.postMessage({ type: 'pcm', samples: f }, [f.buffer]);
    a.level += n;
    state.stats.samples += n;
    if (n < 8192) break;
  }
}

// ------------------------------------------------------------------- video
const CSS_FIT = typeof CSS !== 'undefined' && CSS.supports && CSS.supports('width', '1cqw');
function layoutCanvas() {
  const frame = $('marco');
  const canvas = $('pantalla');
  frame.dataset.aspect = state.aspect;
  if (CSS_FIT) return; // style.css fits the picture; JS sizing is only a fallback
  const w = frame.clientWidth, h = frame.clientHeight;
  if (!w || !h) return;
  const ar = state.aspect === '4:3' ? 4 / 3 : 256 / 224;
  let cw = w, ch = w / ar;
  if (ch > h) { ch = h; cw = h * ar; }
  canvas.style.width = `${Math.floor(cw)}px`;
  canvas.style.height = `${Math.floor(ch)}px`;
}

function draw() {
  const mod = state.mod;
  const ptr = mod._rnrw_frame_rgba();
  state.image.data.set(mod.HEAPU8.subarray(ptr, ptr + 256 * 224 * 4));
  state.ctx2d.putImageData(state.image, 0, 0);
  if (state.stream) {
    const st = state.stream;
    st.ctx.drawImage(state.ctx2d.canvas, 0, 0, st.canvas.width, st.canvas.height);
    // Explicit capture: exactly one video frame per game frame drawn.
    for (const t of st.tracks) { if (t.readyState === 'live') t.requestFrame(); else st.tracks.delete(t); }
  }
}

// ------------------------------------------------------------------- input
function gameVisible() { return !$('juego').hidden; }

window.addEventListener('keydown', (e) => {
  if (!gameVisible() || !state.loaded || anyDialogOpen()) return;
  if (e.altKey || e.ctrlKey || e.metaKey) return;
  if (state.audio.ctx && state.audio.ctx.state === 'suspended' && !state.paused) state.audio.ctx.resume().catch(() => {});
  // Game buttons first, so any key (even P) can be assigned to a button.
  const mask = keyLookup.get(e.code);
  if (mask) {
    e.preventDefault();
    if (document.activeElement && document.activeElement.tagName === 'BUTTON') document.activeElement.blur();
    state.mod._rnrw_press(mask, e.repeat ? 1 : 0);
    return;
  }
  if (e.code === 'KeyP' || e.code === 'Escape') {
    if (e.code === 'Escape' && document.fullscreenElement) return; // the browser exits fullscreen
    if (!e.repeat) togglePause();
    e.preventDefault();
    return;
  }
  if (e.code === 'F2') { e.preventDefault(); if (!e.repeat) saveSnapshot(); return; }
  if (e.code === 'F4') { e.preventDefault(); if (!e.repeat) loadSnapshot(); }
});
window.addEventListener('keyup', (e) => {
  const mask = keyLookup.get(e.code);
  if (mask && state.loaded) { e.preventDefault(); state.mod._rnrw_release(mask); }
});
function anyDialogOpen() { return !!document.querySelector('dialog[open]'); }
window.addEventListener('blur', () => { if (state.loaded) state.mod._rnrw_release_all(); });
window.addEventListener('gamepadconnected', (e) => toast(`Mando conectado: ${e.gamepad.id}`));
window.addEventListener('gamepaddisconnected', () => toast('Mando desconectado'));

// --------------------------------------------------------------- main loop
function tick(t) {
  state.raf = requestAnimationFrame(tick);
  if (state.paused || state.failed) { state.last = t; return; }
  let dt = (t - state.last) / 1000;
  state.last = t;
  if (!(dt > 0) || dt > 0.25) dt = 1 / state.fps;

  // Keep the game clock locked to the audio device: nudge speed by <=1%
  // according to how much audio is queued in the worklet.
  let speed = 1;
  if (state.audio.ready) {
    const err = (AUDIO_TARGET_FRAMES - state.audio.level) / AUDIO_TARGET_FRAMES;
    speed = 1 + Math.max(-1, Math.min(1, err)) * 0.01;
  }
  state.acc += dt * state.fps * speed;
  let n = Math.floor(state.acc);
  if (n <= 0) return;
  state.acc -= n;
  if (n > MAX_FRAMES_PER_TICK) { n = MAX_FRAMES_PER_TICK; state.acc = 0; }

  const mod = state.mod;
  const t0 = performance.now();
  const ok = mod._rnrw_run_frames(n, readGamepads(), state.p2pad);
  const cost = performance.now() - t0;
  if (!ok) { coreStopped(mod.UTF8ToString(mod._rnrw_last_error())); return; }
  draw();
  pumpAudio();

  const s = state.stats;
  s.frames += n; s.cost += cost; s.draws = (s.draws || 0) + 1;
  if (t - s.since > 1000) {
    const secs = (t - s.since) / 1000;
    s.drawRate = s.draws / secs;
    s.draws = 0;
    const ms = state.audio.ready ? Math.round((state.audio.level / 32040) * 1000) : null;
    $('hud').textContent =
      `${(s.frames / secs).toFixed(1)} fps · ${(s.cost / Math.max(1, s.frames)).toFixed(2)} ms/frame de CPU` +
      (ms === null ? ' · sin audio' : ` · audio en búfer ${ms} ms · cortes ${state.audio.underruns}`);
    s.frames = 0; s.cost = 0; s.samples = 0; s.since = t;
  }
}

function startLoop() {
  stopLoop();
  state.running = true;
  state.last = performance.now();
  state.acc = 0;
  state.stats.since = state.last;
  state.raf = requestAnimationFrame(tick);
}
function stopLoop() {
  if (state.raf) cancelAnimationFrame(state.raf);
  state.raf = 0;
  state.running = false;
}

function setPaused(paused) {
  state.paused = paused;
  $('capa-pausa').hidden = !paused;
  $('btn-pausa').textContent = paused ? 'Reanudar' : 'Pausa';
  $('btn-pausa').setAttribute('aria-pressed', String(paused));
  if (state.loaded) state.mod._rnrw_release_all();
  const ctx = state.audio.ctx;
  if (ctx) (paused ? ctx.suspend() : ctx.resume()).catch(() => {});
  if (!paused) state.last = performance.now();
  if (state.host) state.host.sendState({ paused });
}
function togglePause() { if (!state.failed) setPaused(!state.paused); }

document.addEventListener('visibilitychange', () => {
  if (document.hidden && state.running && !state.paused && !state.failed) setPaused(true);
});

function coreStopped(message) {
  state.failed = true;
  const ctx = state.audio.ctx;
  if (ctx) ctx.suspend().catch(() => {});
  $('texto-error-juego').textContent =
    'La recompilación llegó a un estado que no fue compilado de antemano y se detuvo ' +
    `para no ejecutar código incorrecto. Detalle técnico: ${message}`;
  $('capa-error').hidden = false;
  if (state.host) state.host.sendState({ failed: true });
  console.error('[rockanrola] static core stop:', message);
}

function resetGame() {
  const mod = state.mod;
  if (!mod || !state.loaded) return;
  if (!mod._rnrw_reset()) { coreStopped(mod.UTF8ToString(mod._rnrw_last_error())); return; }
  state.failed = false;
  $('capa-error').hidden = true;
  clearAudio();
  if (state.paused) setPaused(false);
  else if (state.audio.ctx) state.audio.ctx.resume().catch(() => {});
  toast('Juego reiniciado');
}

// -------------------------------------------------------------- snapshots
async function saveSnapshot() {
  const mod = state.mod;
  if (!state.loaded || state.failed) return;
  const ok = withCString(mod, SNAPSHOT_PATH, (p) => mod._rnrw_snapshot_save(p));
  if (!ok) { toast(`No se pudo guardar: ${mod.UTF8ToString(mod._rnrw_last_error())}`, 5000); return; }
  const bytes = mod.FS.readFile(SNAPSHOT_PATH);
  try { mod.FS.unlink(SNAPSHOT_PATH); } catch { /* ignore */ }
  const stored = await kvSet('snapshot', { bytes, date: Date.now() });
  toast(stored ? 'Estado guardado en este navegador' : 'Estado guardado solo hasta cerrar la página');
  if (!stored) state.memorySnapshot = bytes;
}

async function loadSnapshot() {
  const mod = state.mod;
  if (!state.loaded) return;
  const rec = await kvGet('snapshot');
  const bytes = rec ? rec.bytes : state.memorySnapshot;
  if (!bytes) { toast('Todavía no hay un estado guardado'); return; }
  mod.FS.writeFile(SNAPSHOT_PATH, bytes);
  const ok = withCString(mod, SNAPSHOT_PATH, (p) => mod._rnrw_snapshot_load(p));
  try { mod.FS.unlink(SNAPSHOT_PATH); } catch { /* ignore */ }
  if (!ok) { toast(`No se pudo cargar: ${mod.UTF8ToString(mod._rnrw_last_error())}`, 5000); return; }
  state.failed = false;
  $('capa-error').hidden = true;
  clearAudio();
  const when = rec ? new Date(rec.date).toLocaleString('es-AR') : 'esta sesión';
  toast(`Estado cargado (${when})`);
}

// --------------------------------------------------------------------- ROM
// Minimal ZIP reader: finds the first .sfc/.smc entry and inflates it with
// the browser's native DecompressionStream. No third-party code.
class RomFileError extends Error {}
async function unzipRom(bytes) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) {
    if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new RomFileError('El archivo .zip está dañado o no es un ZIP válido.');
  const count = dv.getUint16(eocd + 10, true);
  let p = dv.getUint32(eocd + 16, true);
  const entries = [];
  for (let k = 0; k < count && p + 46 <= bytes.length; k++) {
    if (dv.getUint32(p, true) !== 0x02014b50) break;
    const nameLen = dv.getUint16(p + 28, true);
    entries.push({
      flags: dv.getUint16(p + 8, true), method: dv.getUint16(p + 10, true),
      csize: dv.getUint32(p + 20, true), usize: dv.getUint32(p + 24, true),
      local: dv.getUint32(p + 42, true),
      name: new TextDecoder().decode(bytes.subarray(p + 46, p + 46 + nameLen)),
    });
    p += 46 + nameLen + dv.getUint16(p + 30, true) + dv.getUint16(p + 32, true);
  }
  const pick = entries.find((e) => /\.(sfc|smc)$/i.test(e.name)) ||
    entries.find((e) => e.usize === ROM_SIZE || e.usize === ROM_SIZE + COPIER_HEADER);
  if (!pick) throw new RomFileError('El .zip no contiene ningún archivo .sfc o .smc.');
  if (pick.flags & 1) throw new RomFileError('El .zip está protegido con contraseña. Descomprimilo primero.');
  const start = pick.local + 30 + dv.getUint16(pick.local + 26, true) + dv.getUint16(pick.local + 28, true);
  const data = bytes.subarray(start, start + pick.csize);
  if (pick.method === 0) return { bytes: data.slice(), name: pick.name };
  if (pick.method !== 8) throw new RomFileError('El .zip usa un método de compresión no soportado. Descomprimilo primero.');
  if (typeof DecompressionStream !== 'function') {
    throw new RomFileError('Este navegador no puede descomprimir .zip. Descomprimilo y elegí el archivo .sfc.');
  }
  const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return { bytes: new Uint8Array(await new Response(stream).arrayBuffer()), name: pick.name };
}

// Unzips when needed; throws RomFileError with a user-facing message.
async function expandRom(rom) {
  const b = rom.bytes;
  const isZip = /\.zip$/i.test(rom.name || '') ||
    (b[0] === 0x50 && b[1] === 0x4b && b[2] === 0x03 && b[3] === 0x04);
  if (!isZip) return rom;
  try { return await unzipRom(b); }
  catch (e) {
    if (e instanceof RomFileError) throw e;
    throw new RomFileError(`No se pudo leer el .zip: ${e.message}`);
  }
}

// Local auto-start: scripts/serve.mjs serves the ROM from the repository's
// rom/ folder at /local-rom (127.0.0.1 only). Static hosts have no such
// route, so there this returns null and the normal ROM picker is used.
async function fetchLocalRom() {
  if (!['localhost', '127.0.0.1', '[::1]'].includes(location.hostname)) return null;
  try {
    const res = await fetch('local-rom', { cache: 'no-store' });
    if (res.status !== 200) return null;
    const name = decodeURIComponent(res.headers.get('X-Rom-Name') || 'rom.sfc');
    return { bytes: new Uint8Array(await res.arrayBuffer()), name, local: true };
  } catch { return null; }
}

function normalizeRom(bytes) {
  if (bytes.length === ROM_SIZE + COPIER_HEADER) return bytes.slice(COPIER_HEADER);
  return bytes;
}

function explainRomError(raw, bytes, sha) {
  if (/1 MiB/.test(raw)) {
    return `El archivo mide ${bytes.length.toLocaleString('es-AR')} bytes y se esperaba ` +
      `${ROM_SIZE.toLocaleString('es-AR')} (1 MiB). Si está comprimido en .7z o .rar, descomprimilo primero (los .zip se leen directamente).`;
  }
  if (/SHA-256/.test(raw)) {
    return 'El archivo no es la revisión soportada de Rock n\' Roll Racing para SNES (EE. UU.). ' +
      'Las versiones europea, japonesa, de Mega Drive o modificadas no son compatibles con esta recompilación. ' +
      `SHA-256 obtenido: ${sha}. Esperado: ${EXPECTED_SHA}.`;
  }
  return raw;
}

function createGame(bytes) {
  const mod = state.mod;
  const ptr = mod._malloc(bytes.length);
  mod.HEAPU8.set(bytes, ptr);
  const sha = mod.UTF8ToString(mod._rnrw_sha256_hex(ptr, bytes.length));
  const ok = mod._rnrw_create(ptr, bytes.length);
  mod._free(ptr);
  if (!ok) return { ok: false, sha, error: explainRomError(mod.UTF8ToString(mod._rnrw_last_error()), bytes, sha) };
  return { ok: true, sha };
}

function waitForRom(message) {
  show('rom');
  const err = $('error-rom');
  err.hidden = !message;
  err.textContent = message || '';
  $('recordar-rom').checked = loadSetting('rememberRom', false);
  return new Promise((resolve) => { state.romWaiter = resolve; });
}

async function handleRomFile(file) {
  if (!file || !state.romWaiter) return;
  if (file.size > 8 * 1024 * 1024) {
    $('error-rom').hidden = false;
    $('error-rom').textContent = 'El archivo es demasiado grande para ser esta ROM (se espera 1 MiB).';
    return;
  }
  let rom;
  try { rom = await expandRom({ bytes: new Uint8Array(await file.arrayBuffer()), name: file.name }); }
  catch (e) {
    $('error-rom').hidden = false;
    $('error-rom').textContent = e.message;
    return;
  }
  if (!state.romWaiter) return;
  const resolve = state.romWaiter;
  state.romWaiter = null;
  resolve(rom);
}

$('input-rom').addEventListener('change', (e) => {
  handleRomFile(e.target.files && e.target.files[0]);
  e.target.value = '';
});
const zone = $('zona-rom');
zone.addEventListener('dragover', (e) => { e.preventDefault(); zone.classList.add('over'); });
zone.addEventListener('dragleave', () => zone.classList.remove('over'));
zone.addEventListener('drop', (e) => {
  e.preventDefault();
  zone.classList.remove('over');
  handleRomFile(e.dataTransfer.files && e.dataTransfer.files[0]);
});
zone.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); $('input-rom').click(); }
});
$('recordar-rom').addEventListener('change', (e) => {
  saveSetting('rememberRom', e.target.checked);
  if (!e.target.checked) kvDel('rom');
});

// ------------------------------------------------------------- start flow
async function loadEngine() {
  if (state.mod) { step('motor', 'done'); step('init', 'done'); return state.mod; }
  step('motor', 'active');
  status('Descargando el motor…');
  const wasm = await fetchWithProgress('engine/rockanrola.wasm', (p) => {
    $('pct-motor').textContent = `${Math.round(p * 100)}%`;
  });
  let factory;
  try { factory = (await import('./engine/rockanrola.js')).default; }
  catch (e) { throw new StartError('No se pudo cargar el cargador del motor (engine/rockanrola.js).', String(e)); }
  step('motor', 'done');
  step('init', 'active');
  status('Compilando WebAssembly e inicializando…');
  let mod;
  try {
    mod = await factory({
      wasmBinary: wasm.buffer,
      locateFile: (p) => `engine/${p}`,
      print: (t) => console.log('[core]', t),
      printErr: (t) => console.warn('[core]', t),
      onAbort: (what) => fatal('El motor se interrumpió de forma inesperada.', String(what)),
    });
  } catch (e) {
    throw new StartError('El navegador no pudo inicializar el módulo WebAssembly.', String(e && e.stack || e));
  }
  if (!mod._rnrw_selftest()) throw new StartError('La autoprueba SHA-256 del motor falló; la compilación está dañada.');
  console.info('[rockanrola]', mod.UTF8ToString(mod._rnrw_version()));
  state.fps = mod._rnrw_fps();
  state.mod = mod;
  step('init', 'done');
  return mod;
}

async function acquireRom() {
  step('rom', 'active');
  const remember = loadSetting('rememberRom', false);
  let candidate = null;
  let fromStore = false;
  if (remember) {
    const stored = await kvGet('rom');
    if (stored && stored.bytes) { candidate = { bytes: new Uint8Array(stored.bytes), name: stored.name }; fromStore = true; }
  }
  let message = null;
  let fromLocal = false;
  if (state.presetRom) {
    const preset = state.presetRom;
    state.presetRom = null;
    try { candidate = await expandRom(preset); fromLocal = true; fromStore = false; }
    catch (e) { message = `La ROM de la carpeta rom no se pudo usar: ${e.message}`; candidate = null; }
  }
  for (;;) {
    if (!candidate) {
      candidate = await waitForRom(message);
      show('carga');
    }
    status(`Verificando ${candidate.name || 'la ROM'}…`);
    const bytes = normalizeRom(candidate.bytes);
    const result = createGame(bytes);
    if (result.ok) {
      if ($('recordar-rom').checked || (fromStore && remember)) {
        saveSetting('rememberRom', true);
        if (!fromStore) kvSet('rom', { bytes, name: candidate.name || 'rom.sfc' });
      }
      step('rom', 'done');
      return;
    }
    if (fromStore) kvDel('rom');
    message = fromLocal ? `La ROM de la carpeta rom no es válida. ${result.error}` : result.error;
    candidate = null;
    fromStore = false;
    fromLocal = false;
  }
}

async function start() {
  if (state.starting) return;
  state.starting = true;
  ensureAudioContext();
  resetSteps();
  show('carga');
  try {
    step('compat', 'active');
    status('Comprobando compatibilidad…');
    if (typeof WebAssembly !== 'object' || typeof WebAssembly.instantiate !== 'function') {
      throw new StartError('Tu navegador no soporta WebAssembly. Probá con una versión actual de Chrome, Edge o Firefox.');
    }
    if (location.protocol === 'file:') {
      throw new StartError('Abriste la página como archivo local. Rockanrola necesita un servidor web: ejecutá scripts\\serve.ps1 y entrá a http://localhost:8080.');
    }
    step('compat', 'done');
    await loadEngine();
    await acquireRom();
    step('arranque', 'active');
    status('Arrancando…');
    await setupAudio(state.mod._rnrw_audio_rate());
    armAudioUnlock();
    state.loaded = true;
    state.failed = false;
    $('capa-error').hidden = true;
    clearAudio();
    step('arranque', 'done');
    show('juego');
    layoutCanvas();
    setPaused(false);
    startLoop();
    $('pantalla').focus?.();
  } catch (e) {
    console.error(e);
    if (e instanceof StartError) fatal(e.message, e.detail);
    else fatal('Ocurrió un error inesperado al iniciar.', String(e && e.stack || e));
  } finally {
    state.starting = false;
  }
}

// ---------------------------------------------------------- online (host)
// The host keeps running the game locally; the guest gets a 2x scaled copy
// of the picture plus the game audio, and sends controller 2 events back.
function hostStream() {
  if (!state.stream) {
    const canvas = document.createElement('canvas');
    canvas.width = 256 * NET.streamScale;
    canvas.height = 224 * NET.streamScale;
    const ctx = canvas.getContext('2d', { alpha: false });
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(state.ctx2d.canvas, 0, 0, canvas.width, canvas.height);
    state.stream = { canvas, ctx, tracks: new Set() };
  }
  // captureStream(0) + requestFrame() in draw(): the browser never skips or
  // duplicates frames on its own schedule.
  const stream = state.stream.canvas.captureStream(0);
  for (const t of stream.getVideoTracks()) {
    try { t.contentHint = 'motion'; } catch { /* optional */ }
    if (typeof t.requestFrame === 'function') state.stream.tracks.add(t);
  }
  const a = state.audio;
  if (a.ready && a.node) {
    if (!a.dest) { a.dest = a.ctx.createMediaStreamDestination(); a.node.connect(a.dest); }
    for (const t of a.dest.stream.getAudioTracks()) stream.addTrack(t);
  }
  return stream;
}

function onlineStatus(kind, value) {
  const hud = $('hud-online');
  if (kind === 'rtt') {
    if (state.host && state.host.connected) hud.textContent = `Jugador 2 conectado · latencia ida y vuelta ${Math.round(value)} ms`;
    return;
  }
  $('online-estado').textContent = value;
  if (kind === 'error') toast(value, 6000);
  if (kind === 'guest' || kind === 'waiting') {
    hud.hidden = false;
    hud.textContent = kind === 'guest' ? 'Jugador 2 conectado' : `Sala ${state.host?.code || ''} abierta · esperando al jugador 2`;
  }
}

function onGuestInput(ev) {
  const mod = state.mod;
  if (!mod || !state.loaded) return;
  switch (ev.type) {
    case 'down': mod._rnrw_p2_press(ev.mask, ev.repeat ? 1 : 0); break;
    case 'up': mod._rnrw_p2_release(ev.mask); break;
    case 'pad': state.p2pad = ev.mask; break;
    case 'releaseAll': mod._rnrw_p2_release_all(); state.p2pad = 0; break;
    case 'pause': togglePause(); toast(state.paused ? 'El jugador 2 pausó la partida' : 'El jugador 2 reanudó la partida'); break;
    default: break;
  }
}

function onGuestChange(connected) {
  if (connected) { toast('¡Jugador 2 conectado!'); return; }
  state.p2pad = 0;
  if (state.mod && state.loaded) state.mod._rnrw_p2_release_all();
  toast('El jugador 2 se desconectó');
}

async function openOnline() {
  const dlg = $('dlg-online');
  if (!dlg.open) dlg.showModal();
  if (state.host && state.host.code) return;
  $('online-invitacion').hidden = true;
  $('btn-online-cerrar-sala').hidden = true;
  $('online-estado').textContent = 'Abriendo una sala…';
  const host = new HostSession({ getStream: hostStream, onStatus: onlineStatus, onInput: onGuestInput, onGuest: onGuestChange });
  state.host = host;
  try {
    const code = await host.open();
    if (state.host !== host) { host.close(); return; }
    host.sendState({ paused: state.paused, failed: state.failed });
    $('online-codigo').textContent = code;
    $('online-enlace').value = inviteLink(code);
    $('online-local').href = inviteLink(code, location.href);
    $('online-invitacion').hidden = false;
    $('btn-online-cerrar-sala').hidden = false;
    onlineStatus('waiting', 'Sala abierta. Esperando al jugador 2…');
    $('btn-online').textContent = `Online · ${code}`;
  } catch (e) {
    state.host = null;
    $('online-estado').textContent = `No se pudo abrir la sala: ${e.message}`;
  }
}

function closeOnline() {
  if (state.host) state.host.close();
  state.host = null;
  state.p2pad = 0;
  if (state.mod && state.loaded) state.mod._rnrw_p2_release_all();
  $('hud-online').hidden = true;
  $('online-invitacion').hidden = true;
  $('btn-online-cerrar-sala').hidden = true;
  $('online-estado').textContent = 'Sala cerrada.';
  $('btn-online').textContent = 'Jugar online';
}

// ------------------------------------------------------------------- wiring
function init() {
  const canvas = $('pantalla');
  state.ctx2d = canvas.getContext('2d', { alpha: false });
  state.image = state.ctx2d.createImageData(256, 224);
  state.aspect = loadSetting('aspect', '4:3') === '8:7' ? '8:7' : '4:3';
  state.muted = !!loadSetting('muted', false);
  $('btn-aspecto').textContent = state.aspect;
  $('btn-sonido').textContent = state.muted ? 'Activar sonido' : 'Silenciar';

  $('btn-jugar').addEventListener('click', start);
  $('btn-volver').addEventListener('click', start);
  $('btn-pausa').addEventListener('click', togglePause);
  $('btn-reiniciar').addEventListener('click', () => {
    if (window.confirm('¿Reiniciar el juego? Se pierde el progreso que no hayas guardado.')) resetGame();
  });
  $('btn-reiniciar-error').addEventListener('click', resetGame);
  $('btn-copiar-error').addEventListener('click', async () => {
    const mod = state.mod;
    const text = [
      'Rockanrola - diagnóstico',
      mod ? mod.UTF8ToString(mod._rnrw_version()) : 'motor no cargado',
      `frames: ${mod ? mod._rnrw_frames_run() : 0}`,
      `instrucciones: ${mod ? mod._rnrw_instructions() : 0}`,
      `error: ${mod ? mod.UTF8ToString(mod._rnrw_last_error()) : ''}`,
      `navegador: ${navigator.userAgent}`,
    ].join('\n');
    try { await navigator.clipboard.writeText(text); toast('Diagnóstico copiado'); }
    catch { window.prompt('Copiá el diagnóstico:', text); }
  });
  $('btn-guardar').addEventListener('click', saveSnapshot);
  $('btn-cargar').addEventListener('click', loadSnapshot);
  $('btn-sonido').addEventListener('click', () => {
    state.muted = !state.muted;
    saveSetting('muted', state.muted);
    if (state.audio.gain) state.audio.gain.gain.value = state.muted ? 0 : 1;
    $('btn-sonido').textContent = state.muted ? 'Activar sonido' : 'Silenciar';
  });
  $('btn-aspecto').addEventListener('click', () => {
    state.aspect = state.aspect === '4:3' ? '8:7' : '4:3';
    saveSetting('aspect', state.aspect);
    $('btn-aspecto').textContent = state.aspect;
    layoutCanvas();
  });
  const toggleFullscreen = async () => {
    const frame = $('marco');
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else if (frame.requestFullscreen) await frame.requestFullscreen();
      else toast('Este navegador no permite pantalla completa en esta página.');
    } catch (e) { toast('No se pudo activar la pantalla completa.'); console.warn(e); }
  };
  $('btn-completa').addEventListener('click', toggleFullscreen);
  canvas.addEventListener('dblclick', toggleFullscreen);
  document.addEventListener('fullscreenchange', () => {
    $('btn-completa').textContent = document.fullscreenElement ? 'Salir de pantalla completa' : 'Pantalla completa';
    layoutCanvas();
  });
  $('btn-rom').addEventListener('click', async () => {
    if (state.starting) return;
    stopLoop();
    state.loaded = false;
    if (state.mod) state.mod._rnrw_destroy();
    clearAudio();
    await kvDel('rom');
    start();
  });
  keysUI = createKeysUI({
    getMap: () => keymap,
    setMap: (m) => { keymap = m; keyLookup = buildLookup(m); if (state.loaded) state.mod._rnrw_release_all(); },
    onOpen: () => {
      if (gameVisible() && state.loaded && !state.paused && !state.failed) { state.pausedByDialog = true; setPaused(true); }
    },
    onClose: () => { if (state.pausedByDialog) { state.pausedByDialog = false; setPaused(false); } },
  });
  loadLayoutLabels().then(() => keysUI.renderSummary());

  guest = createGuest({
    show, toast, keysUI,
    getLookup: () => keyLookup,
    onLeave: () => { history.replaceState(null, '', location.pathname); show('portada'); },
  });
  $('btn-online').addEventListener('click', openOnline);
  $('btn-online-listo').addEventListener('click', () => $('dlg-online').close());
  $('btn-online-cerrar-sala').addEventListener('click', closeOnline);
  $('btn-copiar-enlace').addEventListener('click', async () => {
    const link = $('online-enlace').value;
    try { await navigator.clipboard.writeText(link); toast('Enlace copiado: mandáselo al jugador 2'); }
    catch { $('online-enlace').select(); toast('Copiá el enlace seleccionado con Ctrl+C'); }
  });
  $('form-unirse').addEventListener('submit', (e) => {
    e.preventDefault();
    const code = normalizeCode($('input-sala').value);
    const err = $('error-sala');
    if (code.length < 4) { err.hidden = false; err.textContent = 'Pegá el enlace completo o el código de 6 letras que te pasaron.'; return; }
    err.hidden = true;
    history.pushState(null, '', `?sala=${code}`);
    guest.open(code);
  });

  if (!isLocalHost()) $('nota-publica').hidden = false;

  // Small read-only hook for scripts/online-test.mjs and troubleshooting.
  window.__rockanrola = Object.freeze({
    p2Mask: () => (state.mod && state.loaded ? state.mod._rnrw_p2_last_mask() : 0),
    roomCode: () => (state.host ? state.host.code : null),
    guestConnected: () => !!(state.host && state.host.connected),
    hostVideoStats: () => (state.host ? state.host.stats() : null),
    drawsPerSecond: () => state.stats.drawRate || 0,
    guestVideoStats: () => guest.stats(),
  });

  if ('ResizeObserver' in window) new ResizeObserver(layoutCanvas).observe($('marco'));
  else window.addEventListener('resize', layoutCanvas);

  window.addEventListener('unhandledrejection', (e) => console.error('[rockanrola] promesa rechazada', e.reason));
}

// Browsers only start audio after a user gesture. When the game starts by
// itself, show a hint and resume audio on the first key, click or touch.
function armAudioUnlock() {
  const ctx = state.audio.ctx;
  const hint = $('aviso-sonido');
  if (!ctx || !state.audio.ready || ctx.state === 'running') { hint.hidden = true; return; }
  hint.hidden = false;
  const unlock = () => {
    if (state.paused) return;
    ctx.resume().then(() => {
      if (ctx.state === 'running') {
        hint.hidden = true;
        for (const t of ['keydown', 'pointerdown', 'touchstart']) window.removeEventListener(t, unlock, true);
      }
    }).catch(() => {});
  };
  for (const t of ['keydown', 'pointerdown', 'touchstart']) window.addEventListener(t, unlock, true);
}

async function autostart() {
  const rom = await fetchLocalRom();
  if (!rom) return; // normal flow: cover page and ROM picker
  console.info(`[rockanrola] arranque directo con la ROM local ${rom.name}`);
  state.presetRom = rom;
  start();
}

init();
// An invitation link (?sala=CODE) opens the guest screen; it never loads the
// engine or a ROM. Otherwise try the local ROM auto-start.
const invitedRoom = new URLSearchParams(location.search).get('sala');
if (invitedRoom) guest.open(invitedRoom);
else autostart();
