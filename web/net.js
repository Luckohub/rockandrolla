// Rockanrola - online sessions over WebRTC (PeerJS 1.5.5, MIT).
//
// HostSession: the person who runs the game. Publishes a room code, accepts
// one guest, streams the game's video+audio to them and receives the
// guest's controller events, which drive SNES player 2.
// GuestSession: the person who joins. Needs no ROM and no game engine.
//
// Messages on the data channel (JSON):
//   guest -> host  {t:'k', d:1|0, m:mask, r:0|1}  key down/up
//                  {t:'p', m:mask}                gamepad state
//                  {t:'ra'}                       release everything
//                  {t:'pause'}                    toggle pause
//                  {t:'ping', ts} / {t:'rtt', v}
//   host -> guest  {t:'pong', ts}  {t:'state', paused, failed}  {t:'busy'}
import { NET } from './config.js';

let peerLib = null;
export function loadPeerJs() {
  if (!peerLib) {
    peerLib = new Promise((resolve, reject) => {
      if (window.peerjs && window.peerjs.Peer) { resolve(window.peerjs.Peer); return; }
      const s = document.createElement('script');
      s.src = 'vendor/peerjs-1.5.5.min.js';
      s.onload = () => (window.peerjs && window.peerjs.Peer ? resolve(window.peerjs.Peer)
        : reject(new Error('PeerJS no expuso su API.')));
      s.onerror = () => reject(new Error('No se pudo cargar vendor/peerjs-1.5.5.min.js.'));
      document.head.appendChild(s);
    });
    peerLib.catch(() => { peerLib = null; });
  }
  return peerLib;
}

const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
function randomCode(n) {
  const a = new Uint32Array(n);
  crypto.getRandomValues(a);
  return Array.from(a, (v) => ALPHABET[v % ALPHABET.length]).join('');
}

// Accepts a bare code or a full invitation link.
export function normalizeCode(text) {
  const m = /[?&]sala=([A-Za-z0-9-]+)/.exec(text || '');
  return (m ? m[1] : (text || '')).toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12);
}

export function inviteLink(code, base = NET.guestUrl) {
  const url = new URL(base, location.href);
  url.search = `?sala=${code}`;
  url.hash = '';
  return url.toString();
}

const hostPeerId = (code) => `${NET.idPrefix}${code}`;

function peerOptions() {
  const o = { ...NET.peer, debug: 1 };
  if (NET.iceServers) o.config = { iceServers: NET.iceServers };
  return o;
}

export function explainPeerError(err) {
  switch (err && err.type) {
    case 'peer-unavailable': return 'No hay ninguna partida abierta con ese código. Revisá el código o pedile al anfitrión que abra la sala de nuevo.';
    case 'unavailable-id': return 'Ese código de sala ya está en uso.';
    case 'network': case 'server-error': case 'socket-error': case 'socket-closed':
      return 'No se pudo contactar al servidor de conexión (PeerJS). Revisá la conexión a internet.';
    case 'browser-incompatible': return 'Este navegador no soporta WebRTC.';
    case 'webrtc': return 'Falló la conexión directa entre los dos equipos (WebRTC).';
    default: return (err && err.message) || String(err);
  }
}

function lowLatencyReceivers(pc) {
  if (!pc) return;
  for (const r of pc.getReceivers()) {
    try {
      if ('jitterBufferTarget' in r) r.jitterBufferTarget = 0;
      else if ('playoutDelayHint' in r) r.playoutDelayHint = 0;
    } catch { /* optional */ }
  }
}

async function tuneSenders(pc) {
  for (const sender of pc.getSenders()) {
    if (!sender.track || sender.track.kind !== 'video') continue;
    try {
      const p = sender.getParameters();
      if (!p.encodings || !p.encodings.length) p.encodings = [{}];
      p.encodings[0].maxBitrate = NET.maxBitrate;
      p.encodings[0].maxFramerate = 60;
      p.degradationPreference = 'maintain-framerate';
      await sender.setParameters(p);
    } catch (e) { console.warn('[rockanrola] no se pudo ajustar el video', e); }
  }
}

// Compact WebRTC video statistics, for the HUD and scripts/online-test.mjs.
export async function videoStats(pc) {
  if (!pc) return null;
  const out = {};
  const report = await pc.getStats();
  report.forEach((r) => {
    if (r.kind !== 'video') return;
    if (r.type === 'outbound-rtp') {
      Object.assign(out, { sentFps: r.framesPerSecond, framesSent: r.framesSent, framesEncoded: r.framesEncoded,
        limitation: r.qualityLimitationReason, width: r.frameWidth, height: r.frameHeight,
        encoder: r.encoderImplementation, bytesSent: r.bytesSent });
    } else if (r.type === 'inbound-rtp') {
      Object.assign(out, { recvFps: r.framesPerSecond, framesDecoded: r.framesDecoded, framesDropped: r.framesDropped,
        framesReceived: r.framesReceived, jitterBufferMs: r.jitterBufferEmittedCount ? (1000 * r.jitterBufferDelay) / r.jitterBufferEmittedCount : null,
        decoder: r.decoderImplementation, width: r.frameWidth, height: r.frameHeight });
    }
  });
  return out;
}

export class HostSession {
  constructor({ getStream, onStatus, onInput, onGuest }) {
    this.getStream = getStream;
    this.onStatus = onStatus;
    this.onInput = onInput;
    this.onGuest = onGuest;
    this.peer = null;
    this.conn = null;
    this.media = null;
    this.code = null;
    this.rtt = null;
    this.lastState = { paused: false, failed: false };
  }

  get connected() { return !!(this.conn && this.conn.open); }

  stats() { return videoStats(this.media && this.media.peerConnection); }

  async open() {
    const Peer = await loadPeerJs();
    for (let attempt = 0; attempt < 3; attempt++) {
      const code = randomCode(6);
      try {
        await this._createPeer(Peer, code);
        this.code = code;
        return code;
      } catch (err) {
        if (!err || err.type !== 'unavailable-id') throw new Error(explainPeerError(err));
      }
    }
    throw new Error('No se pudo reservar un código de sala.');
  }

  _createPeer(Peer, code) {
    return new Promise((resolve, reject) => {
      let opened = false;
      const peer = new Peer(hostPeerId(code), peerOptions());
      peer.on('open', () => { opened = true; this.peer = peer; resolve(); });
      peer.on('error', (err) => {
        if (!opened) { peer.destroy(); reject(err); return; }
        if (err.type === 'peer-unavailable') return; // a guest left mid-call
        this.onStatus('error', explainPeerError(err));
      });
      peer.on('disconnected', () => {
        // Lost the broker (not the guest): keep the room code alive.
        if (!peer.destroyed) setTimeout(() => { try { peer.reconnect(); } catch { /* destroyed */ } }, 1500);
      });
      peer.on('connection', (conn) => this._accept(conn));
    });
  }

  _accept(conn) {
    if (this.connected) {
      conn.on('open', () => { conn.send({ t: 'busy' }); setTimeout(() => conn.close(), 400); });
      return;
    }
    this.conn = conn;
    conn.on('open', () => {
      this.onStatus('guest', 'Jugador 2 conectado. Enviando imagen…');
      this.onGuest(true);
      this._call(conn.peer);
      this.sendState(this.lastState);
    });
    conn.on('data', (msg) => this._onData(msg));
    conn.on('close', () => this._dropGuest('El jugador 2 se desconectó.'));
    conn.on('error', () => this._dropGuest('Se perdió la conexión con el jugador 2.'));
  }

  _call(guestId) {
    const stream = this.getStream();
    const media = this.peer.call(guestId, stream);
    this.media = media;
    const pc = media.peerConnection;
    if (pc) {
      pc.addEventListener('connectionstatechange', () => {
        if (pc.connectionState === 'connected') {
          tuneSenders(pc);
          this.onStatus('guest', 'Jugador 2 conectado.');
        } else if (pc.connectionState === 'failed') {
          this.onStatus('error', 'No se pudo enviar el video: la red bloquea la conexión directa y el relevo no respondió.');
        }
      });
    }
    media.on('error', (e) => console.warn('[rockanrola] media', e));
  }

  _onData(msg) {
    if (!msg || typeof msg !== 'object') return;
    switch (msg.t) {
      case 'ping': this._send({ t: 'pong', ts: msg.ts }); break;
      case 'rtt': this.rtt = Number(msg.v) || null; this.onStatus('rtt', this.rtt); break;
      case 'k': this.onInput({ type: msg.d ? 'down' : 'up', mask: msg.m & 0xfff0, repeat: !!msg.r }); break;
      case 'p': this.onInput({ type: 'pad', mask: msg.m & 0xfff0 }); break;
      case 'ra': this.onInput({ type: 'releaseAll' }); break;
      case 'pause': this.onInput({ type: 'pause' }); break;
      default: break;
    }
  }

  _send(msg) { if (this.connected) { try { this.conn.send(msg); } catch { /* closing */ } } }

  sendState(s) {
    this.lastState = { ...this.lastState, ...s };
    this._send({ t: 'state', ...this.lastState });
  }

  _dropGuest(text) {
    if (!this.conn) return;
    try { this.media && this.media.close(); } catch { /* ignore */ }
    this.media = null;
    this.conn = null;
    this.rtt = null;
    this.onGuest(false);
    this.onStatus('waiting', `${text} La sala sigue abierta.`);
  }

  close() {
    try { this.conn && this.conn.close(); } catch { /* ignore */ }
    try { this.media && this.media.close(); } catch { /* ignore */ }
    try { this.peer && this.peer.destroy(); } catch { /* ignore */ }
    const had = !!this.conn;
    this.peer = this.conn = this.media = null;
    this.code = null;
    if (had) this.onGuest(false);
  }
}

export class GuestSession {
  constructor({ onStream, onStatus, onState, onRtt, onClosed }) {
    Object.assign(this, { onStream, onStatus, onState, onRtt, onClosed });
    this.peer = null;
    this.conn = null;
    this.timer = 0;
    this.closed = false;
  }

  get connected() { return !!(this.conn && this.conn.open); }

  async join(code) {
    const Peer = await loadPeerJs();
    this.onStatus('Conectando con el servidor…');
    await new Promise((resolve, reject) => {
      const peer = new Peer(`${NET.idPrefix}g-${randomCode(10)}`, peerOptions());
      this.peer = peer;
      let joined = false;
      peer.on('open', () => {
        this.onStatus('Buscando la partida…');
        const conn = peer.connect(hostPeerId(code), { reliable: true, serialization: 'json' });
        this.conn = conn;
        conn.on('open', () => {
          joined = true;
          this.onStatus('Conectado. Esperando la imagen del anfitrión…');
          this.timer = setInterval(() => this._send({ t: 'ping', ts: performance.now() }), 1000);
          resolve();
        });
        conn.on('data', (msg) => this._onData(msg));
        conn.on('close', () => this._end('El anfitrión cerró la partida o se cortó la conexión.'));
      });
      peer.on('call', (call) => {
        this.pc = call.peerConnection;
        call.answer();
        call.on('stream', (stream) => { this.pc = call.peerConnection; lowLatencyReceivers(this.pc); this.onStream(stream); });
        const pc = call.peerConnection;
        if (pc) pc.addEventListener('connectionstatechange', () => {
          if (pc.connectionState === 'failed') this.onStatus('No llega la imagen: la red bloquea la conexión directa y el relevo no respondió.');
        });
      });
      peer.on('error', (err) => {
        const text = explainPeerError(err);
        if (!joined) { reject(new Error(text)); return; }
        this.onStatus(text);
      });
      setTimeout(() => { if (!joined) reject(new Error('El anfitrión no respondió. Revisá el código y que su página siga abierta.')); }, 20000);
    });
  }

  _onData(msg) {
    if (!msg || typeof msg !== 'object') return;
    if (msg.t === 'pong') {
      const rtt = performance.now() - msg.ts;
      this._send({ t: 'rtt', v: Math.round(rtt) });
      this.onRtt(rtt);
    } else if (msg.t === 'state') this.onState(msg);
    else if (msg.t === 'busy') this._end('La partida ya tiene un jugador 2 conectado.');
  }

  _send(msg) { if (this.connected) { try { this.conn.send(msg); } catch { /* closing */ } } }
  stats() { return videoStats(this.pc); }
  sendKey(down, mask, repeat) { this._send({ t: 'k', d: down ? 1 : 0, m: mask, r: repeat ? 1 : 0 }); }
  sendPad(mask) { this._send({ t: 'p', m: mask }); }
  releaseAll() { this._send({ t: 'ra' }); }
  requestPause() { this._send({ t: 'pause' }); }

  _end(text) {
    if (this.closed) return;
    this.closed = true;
    clearInterval(this.timer);
    try { this.peer && this.peer.destroy(); } catch { /* ignore */ }
    this.onClosed(text);
  }

  leave() { this._end('Saliste de la partida.'); }
}
