// Rockanrola - keyboard mapping (shared by the host and the online guest).
//
// Keys are stored as KeyboardEvent.code values, so the mapping refers to
// physical key positions and works the same on any keyboard layout.

export const BTN = {
  B: 0x8000, Y: 0x4000, SELECT: 0x2000, START: 0x1000,
  UP: 0x0800, DOWN: 0x0400, LEFT: 0x0200, RIGHT: 0x0100,
  A: 0x0080, X: 0x0040, L: 0x0020, R: 0x0010,
};

// Order shown in the configuration dialog.
export const ACTIONS = [
  { id: 'UP', label: 'Arriba' },
  { id: 'DOWN', label: 'Abajo' },
  { id: 'LEFT', label: 'Izquierda' },
  { id: 'RIGHT', label: 'Derecha' },
  { id: 'B', label: 'B' },
  { id: 'A', label: 'A' },
  { id: 'Y', label: 'Y' },
  { id: 'X', label: 'X' },
  { id: 'L', label: 'L' },
  { id: 'R', label: 'R' },
  { id: 'START', label: 'Start' },
  { id: 'SELECT', label: 'Select' },
];

// The upstream launcher's two keyboard profiles ("classic" and "default")
// at once: they do not overlap.
export const DEFAULT_KEYMAP = Object.freeze({
  UP: ['ArrowUp', null], DOWN: ['ArrowDown', null],
  LEFT: ['ArrowLeft', null], RIGHT: ['ArrowRight', null],
  B: ['KeyZ', 'KeyD'], A: ['KeyX', 'KeyF'], Y: ['KeyA', null], X: ['KeyS', null],
  L: ['KeyE', null], R: ['KeyR', null],
  START: ['Enter', 'KeyG'], SELECT: ['Space', 'KeyT'],
});

// Keys the page keeps for itself: they can never be assigned.
export const RESERVED = new Set(['Escape', 'Tab', 'F1', 'F2', 'F3', 'F4', 'F5', 'F6',
  'F7', 'F8', 'F9', 'F10', 'F11', 'F12', 'MetaLeft', 'MetaRight', 'ContextMenu']);

const STORAGE_KEY = 'rockanrola.keymap.v1';

function copy(map) {
  const out = {};
  for (const { id } of ACTIONS) out[id] = [...(map[id] || [null, null])].slice(0, 2);
  return out;
}

export function loadKeymap() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      const map = copy(DEFAULT_KEYMAP);
      for (const { id } of ACTIONS) {
        const v = parsed[id];
        if (Array.isArray(v)) map[id] = [0, 1].map((i) => (typeof v[i] === 'string' && !RESERVED.has(v[i]) ? v[i] : null));
      }
      return map;
    }
  } catch { /* storage unavailable or corrupt: use defaults */ }
  return copy(DEFAULT_KEYMAP);
}

export function saveKeymap(map) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(map)); } catch { /* optional */ }
}

export function defaultKeymap() { return copy(DEFAULT_KEYMAP); }

// code -> SNES mask
export function buildLookup(map) {
  const lookup = new Map();
  for (const { id } of ACTIONS) for (const code of map[id]) if (code) lookup.set(code, (lookup.get(code) || 0) | BTN[id]);
  return lookup;
}

// Assigns `code` to slot `slot` of action `id`, removing it from wherever
// else it was. Returns the label of the action it was taken from, if any.
export function assign(map, id, slot, code) {
  let takenFrom = null;
  if (code) {
    for (const { id: other, label } of ACTIONS) {
      map[other] = map[other].map((c, i) => {
        if (c === code && !(other === id && i === slot)) { takenFrom = label; return null; }
        return c;
      });
    }
  }
  map[id][slot] = code;
  return takenFrom;
}

const NAMED = {
  ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→',
  Space: 'Espacio', Enter: 'Enter', NumpadEnter: 'Enter (num)', Backspace: 'Retroceso',
  ShiftLeft: 'Shift izq.', ShiftRight: 'Shift der.', ControlLeft: 'Ctrl izq.', ControlRight: 'Ctrl der.',
  AltLeft: 'Alt', AltRight: 'AltGr', CapsLock: 'Bloq Mayús', Insert: 'Insert', Delete: 'Supr',
  Home: 'Inicio', End: 'Fin', PageUp: 'Re Pág', PageDown: 'Av Pág',
  Minus: '-', Equal: '=', BracketLeft: '[', BracketRight: ']', Backslash: '\\',
  Semicolon: 'Ñ', Quote: '´', Backquote: 'º', Comma: ',', Period: '.', Slash: '-',
  IntlBackslash: '<', NumpadAdd: '+ (num)', NumpadSubtract: '- (num)',
  NumpadMultiply: '* (num)', NumpadDivide: '/ (num)', NumpadDecimal: '. (num)',
};

// Chrome/Edge can report what each physical key prints on the user's own
// layout (e.g. "ñ" on a Spanish keyboard); other browsers use NAMED.
let layoutMap = null;
export async function loadLayoutLabels() {
  try {
    if (navigator.keyboard && navigator.keyboard.getLayoutMap) layoutMap = await navigator.keyboard.getLayoutMap();
  } catch { layoutMap = null; }
}

export function keyLabel(code) {
  if (!code) return '—';
  const printed = layoutMap && layoutMap.get(code);
  if (printed && printed.trim() && !/^(Key|Digit)/.test(code)) return printed.toUpperCase();
  if (NAMED[code]) return NAMED[code];
  let m = /^Key([A-Z])$/.exec(code); if (m) return m[1];
  m = /^Digit(\d)$/.exec(code); if (m) return m[1];
  m = /^Numpad(\d)$/.exec(code); if (m) return `${m[1]} (num)`;
  return code;
}

// Standard-mapping gamepads -> SNES mask (any connected pad).
export function readGamepads() {
  if (!navigator.getGamepads) return 0;
  let pads;
  try { pads = navigator.getGamepads(); } catch { return 0; }
  let mask = 0;
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
