// Rockanrola - guest (player 2) screen.
//
// Shows the host's game as a live WebRTC video and sends this person's
// keyboard/gamepad as SNES controller 2. It never loads the game engine or
// a ROM, so it also works on the public guest page.
import { GuestSession, normalizeCode } from './net.js';
import { readGamepads } from './keymap.js';

const $ = (id) => document.getElementById(id);

export function createGuest({ show, toast, getLookup, keysUI, onLeave }) {
  const video = $('video-remoto');
  const layer = $('capa-invitado');
  const layerText = $('texto-invitado');
  const joinBtn = $('btn-unirse-ahora');
  let session = null;
  let code = '';
  let pad = 0;
  let raf = 0;
  let rtt = null;
  let hostPaused = false;

  function setLayer(text, { button = false } = {}) {
    layer.hidden = !text;
    layerText.textContent = text || '';
    joinBtn.hidden = !button;
  }

  async function updateHud() {
    if (!session || !session.connected) { $('hud-invitado').textContent = ''; return; }
    let fps = null;
    try { const st = await session.stats(); fps = st && st.recvFps; } catch { /* stats optional */ }
    $('hud-invitado').textContent =
      `Sala ${code} · imagen ${fps == null ? '…' : `${Math.round(fps)} fps`} · latencia ida y vuelta ${rtt === null ? '…' : `${Math.round(rtt)} ms`}` +
      (hostPaused ? ' · pausado por el anfitrión' : '');
  }

  function pollPad() {
    raf = requestAnimationFrame(pollPad);
    const m = readGamepads();
    if (m !== pad && session) { pad = m; session.sendPad(m); }
  }

  function open(roomCode) {
    code = normalizeCode(roomCode);
    show('invitado');
    $('titulo-invitado').textContent = `Partida ${code}`;
    setLayer(`Vas a jugar como jugador 2 en la partida ${code}. La imagen y el sonido llegan desde el equipo del anfitrión.`, { button: true });
  }

  async function join() {
    if (session) return;
    setLayer('Conectando…');
    video.muted = !!loadMuted();
    session = new GuestSession({
      onStream: (stream) => {
        // PeerJS reports the same stream once per track (video, audio).
        if (video.srcObject === stream) return;
        video.srcObject = stream;
        setLayer('');
        video.play().catch((err) => {
          // Only a real autoplay block needs a tap; an "interrupted" play()
          // is superseded by the next one.
          if (err && err.name === 'NotAllowedError') setLayer('Tocá la pantalla para empezar a ver la partida.');
        });
      },
      onStatus: (text) => { if (!video.srcObject || /No llega/.test(text)) setLayer(text); },
      onState: (s) => {
        hostPaused = !!s.paused;
        $('capa-pausa-invitado').hidden = !s.paused;
      },
      onRtt: (v) => { rtt = v; },
      onClosed: (text) => {
        cleanup();
        setLayer(text, { button: false });
        $('btn-reintentar-invitado').hidden = false;
      },
    });
    try {
      await session.join(code);
      $('btn-reintentar-invitado').hidden = true;
      pollPad();
      clearInterval(open.hud);
      open.hud = setInterval(updateHud, 1000);
    } catch (e) {
      cleanup();
      setLayer(e.message);
      $('btn-reintentar-invitado').hidden = false;
    }
  }

  function cleanup() {
    cancelAnimationFrame(raf);
    clearInterval(open.hud);
    if (session && !session.closed) session.leave();
    session = null;
    pad = 0;
    video.srcObject = null;
    $('capa-pausa-invitado').hidden = true;
    $('hud-invitado').textContent = '';
  }

  const active = () => !$('invitado').hidden && session && session.connected && !keysUI.isOpen();

  window.addEventListener('keydown', (e) => {
    if (!active() || e.altKey || e.ctrlKey || e.metaKey) return;
    if (e.code === 'Escape' && document.fullscreenElement) return;
    const mask = getLookup().get(e.code);
    if (mask) {
      e.preventDefault();
      if (document.activeElement && document.activeElement.tagName === 'BUTTON') document.activeElement.blur();
      session.sendKey(true, mask, e.repeat);
      return;
    }
    if ((e.code === 'KeyP' || e.code === 'Escape') && !e.repeat) { e.preventDefault(); session.requestPause(); }
  });
  window.addEventListener('keyup', (e) => {
    if (!active()) return;
    const mask = getLookup().get(e.code);
    if (mask) { e.preventDefault(); session.sendKey(false, mask, false); }
  });
  window.addEventListener('blur', () => { if (active()) session.releaseAll(); });

  function loadMuted() { try { return JSON.parse(localStorage.getItem('rockanrola.guestMuted') || 'false'); } catch { return false; } }

  joinBtn.addEventListener('click', join);
  video.addEventListener('click', () => video.play().catch(() => {}));
  layer.addEventListener('click', (e) => { if (e.target === layer && video.srcObject) video.play().catch(() => {}); });
  video.addEventListener('playing', () => { if (/Tocá la pantalla/.test(layerText.textContent)) setLayer(''); });
  $('btn-reintentar-invitado').addEventListener('click', () => { $('btn-reintentar-invitado').hidden = true; join(); });
  $('btn-salir-invitado').addEventListener('click', () => { cleanup(); onLeave(); });
  $('btn-pausa-invitado').addEventListener('click', () => { if (session) session.requestPause(); });
  $('btn-sonido-invitado').addEventListener('click', () => {
    video.muted = !video.muted;
    try { localStorage.setItem('rockanrola.guestMuted', JSON.stringify(video.muted)); } catch { /* optional */ }
    $('btn-sonido-invitado').textContent = video.muted ? 'Activar sonido' : 'Silenciar';
  });
  $('btn-completa-invitado').addEventListener('click', async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await $('marco-invitado').requestFullscreen();
    } catch { toast('No se pudo activar la pantalla completa.'); }
  });
  video.addEventListener('dblclick', () => $('btn-completa-invitado').click());
  $('btn-sonido-invitado').textContent = loadMuted() ? 'Activar sonido' : 'Silenciar';

  return { open, join, leave: cleanup, stats: () => (session ? session.stats() : null) };
}
