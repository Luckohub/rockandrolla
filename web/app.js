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

const BTN = {
  B: 0x8000, Y: 0x4000, SELECT: 0x2000, START: 0x1000,
  UP: 0x0800, DOWN: 0x0400, LEFT: 0x0200, RIGHT: 0x0100,
  A: 0x0080, X: 0x0040, L: 0x0020, R: 0x0010,
};

// Both upstream keyboard profiles ("classic" and "default") at once; they
// do not overlap. event.code keeps it independent of the keyboard layout.
const KEYMAP = {
  ArrowUp: BTN.UP, ArrowDown: BTN.DOWN, ArrowLeft: BTN.LEFT, ArrowRight: BTN.RIGHT,
  KeyZ: BTN.B, KeyD: BTN.B, KeyX: BTN.A, KeyF: BTN.A,
  KeyA: BTN.Y, KeyS: BTN.X, KeyE: BTN.L, KeyR: BTN.R,
  Enter: BTN.START, NumpadEnter: BTN.START, KeyG: BTN.START,
  Space: BTN.SELECT, KeyT: BTN.SELECT,
};

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
function layoutCanvas() {
  const frame = $('marco');
  const canvas = $('pantalla');
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
}

// ------------------------------------------------------------------- input
function pollGamepads() {
  if (!navigator.getGamepads) return 0;
  let mask = 0;
  let pads;
  try { pads = navigator.getGamepads(); } catch { return 0; }
  for (const gp of pads) {
    if (!gp || !gp.connected) continue;
    const b = (i) => !!(gp.buttons[i] && gp.buttons[i].pressed);
    if (b(0)) mask |= BTN.B;
    if (b(1)) mask |= BTN.A;
    if (b(2)) mask |= BTN.Y;
    if (b(3)) mask |= BTN.X;
    if (b(4) || b(6)) mask |= BTN.L;
    if (b(5) || b(7)) mask |= BTN.R;
    if (b(8)) mask |= BTN.SELECT;
    if (b(9)) mask |= BTN.START;
    if (b(12)) mask |= BTN.UP;
    if (b(13)) mask |= BTN.DOWN;
    if (b(14)) mask |= BTN.LEFT;
    if (b(15)) mask |= BTN.RIGHT;
    const x = gp.axes[0] || 0, y = gp.axes[1] || 0;
    if (x < -0.5) mask |= BTN.LEFT; else if (x > 0.5) mask |= BTN.RIGHT;
    if (y < -0.5) mask |= BTN.UP; else if (y > 0.5) mask |= BTN.DOWN;
  }
  return mask;
}

function gameVisible() { return !$('juego').hidden; }

window.addEventListener('keydown', (e) => {
  if (!gameVisible() || !state.loaded) return;
  if (e.altKey || e.ctrlKey || e.metaKey) return;
  if (state.audio.ctx && state.audio.ctx.state === 'suspended' && !state.paused) state.audio.ctx.resume().catch(() => {});
  if (e.code === 'KeyP' || e.code === 'Escape') {
    if (e.code === 'Escape' && document.fullscreenElement) return; // the browser exits fullscreen
    if (!e.repeat) togglePause();
    e.preventDefault();
    return;
  }
  if (e.code === 'F2') { e.preventDefault(); if (!e.repeat) saveSnapshot(); return; }
  if (e.code === 'F4') { e.preventDefault(); if (!e.repeat) loadSnapshot(); return; }
  const mask = KEYMAP[e.code];
  if (mask) {
    e.preventDefault();
    if (document.activeElement && document.activeElement.tagName === 'BUTTON') document.activeElement.blur();
    state.mod._rnrw_press(mask, e.repeat ? 1 : 0);
  }
});
window.addEventListener('keyup', (e) => {
  const mask = KEYMAP[e.code];
  if (mask && state.loaded) { e.preventDefault(); state.mod._rnrw_release(mask); }
});
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
  const ok = mod._rnrw_run_frames(n, pollGamepads());
  const cost = performance.now() - t0;
  if (!ok) { coreStopped(mod.UTF8ToString(mod._rnrw_last_error())); return; }
  draw();
  pumpAudio();

  const s = state.stats;
  s.frames += n; s.cost += cost;
  if (t - s.since > 1000) {
    const secs = (t - s.since) / 1000;
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
function normalizeRom(bytes) {
  if (bytes.length === ROM_SIZE + COPIER_HEADER) return bytes.slice(COPIER_HEADER);
  return bytes;
}

function explainRomError(raw, bytes, sha) {
  if (/1 MiB/.test(raw)) {
    return `El archivo mide ${bytes.length.toLocaleString('es-AR')} bytes y se esperaba ` +
      `${ROM_SIZE.toLocaleString('es-AR')} (1 MiB). Si está comprimido (.zip, .7z), descomprimilo primero.`;
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
  const bytes = new Uint8Array(await file.arrayBuffer());
  const resolve = state.romWaiter;
  state.romWaiter = null;
  resolve({ bytes, name: file.name });
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
    message = result.error;
    candidate = null;
    fromStore = false;
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
  if ('ResizeObserver' in window) new ResizeObserver(layoutCanvas).observe($('marco'));
  else window.addEventListener('resize', layoutCanvas);

  window.addEventListener('unhandledrejection', (e) => console.error('[rockanrola] promesa rechazada', e.reason));
}

init();
