// Rockanrola - online play settings.
//
// The host runs the game locally and streams it to the guest over WebRTC.
// PeerJS's free public broker (0.peerjs.com) only introduces the two
// browsers; video, audio and controls then travel directly between them,
// or through PeerJS's free TURN relay when a strict NAT/CGNAT prevents a
// direct path. To use your own broker, run `npx peerjs --port 9000` and set
// `peer: { host, port, path, secure }` below.
export const NET = {
  // Public page the guest opens. It contains no game code and no ROM, only
  // the page, PeerJS and the video player (see .github/workflows/pages.yml).
  guestUrl: 'https://luckohub.github.io/rockandrolla/',
  idPrefix: 'rockanrola-v1-',
  peer: { host: '0.peerjs.com', port: 443, path: '/', secure: true },
  // null keeps PeerJS defaults: Google STUN + PeerJS TURN relays.
  iceServers: null,
  // Video sent to the guest: the 256x224 picture scaled 2x without smoothing
  // so compression keeps pixel edges sharp.
  streamScale: 2,
  maxBitrate: 3_000_000,
};
