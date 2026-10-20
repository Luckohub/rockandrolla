// Rockanrola - "Configurar teclas" dialog and the controls summary table.
import { ACTIONS, RESERVED, assign, defaultKeymap, keyLabel, saveKeymap } from './keymap.js';

const $ = (id) => document.getElementById(id);

export function createKeysUI({ getMap, setMap, onOpen, onClose }) {
  const dialog = $('dlg-teclas');
  const rows = $('remap-filas');
  const note = $('remap-aviso');
  let capture = null; // { id, slot, button }

  function renderSummary() {
    const body = $('resumen-teclas');
    if (!body) return;
    const map = getMap();
    body.replaceChildren(...ACTIONS.map(({ id, label }) => {
      const tr = document.createElement('tr');
      const name = document.createElement('td');
      name.textContent = label;
      tr.append(name, ...map[id].map((code) => {
        const td = document.createElement('td');
        if (code) { const k = document.createElement('kbd'); k.textContent = keyLabel(code); td.append(k); }
        return td;
      }));
      return tr;
    }));
  }

  function render() {
    const map = getMap();
    rows.replaceChildren(...ACTIONS.map(({ id, label }) => {
      const tr = document.createElement('tr');
      const name = document.createElement('th');
      name.scope = 'row';
      name.textContent = label;
      tr.append(name);
      for (const slot of [0, 1]) {
        const td = document.createElement('td');
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'btn key-slot';
        b.dataset.id = id;
        b.dataset.slot = String(slot);
        b.textContent = keyLabel(map[id][slot]);
        b.setAttribute('aria-label', `${label}, tecla ${slot + 1}: ${keyLabel(map[id][slot])}. Pulsá para cambiar`);
        b.addEventListener('click', () => startCapture(id, slot, b));
        td.append(b);
        tr.append(td);
      }
      return tr;
    }));
    renderSummary();
  }

  function stopCapture() {
    if (capture) capture.button.classList.remove('capturing');
    capture = null;
  }

  function startCapture(id, slot, button) {
    stopCapture();
    capture = { id, slot, button };
    button.classList.add('capturing');
    button.textContent = 'Pulsá una tecla…';
    note.textContent = 'Esc cancela · Supr o Retroceso deja la tecla vacía.';
  }

  // Capture phase on window so the game never sees keys while remapping.
  window.addEventListener('keydown', (e) => {
    if (!dialog.open) return;
    if (!capture) {
      // Keep game controls inert while the dialog is open; let Tab/Enter work.
      return;
    }
    e.preventDefault();
    e.stopImmediatePropagation();
    const { id, slot } = capture;
    if (e.code === 'Escape') { stopCapture(); render(); note.textContent = 'Sin cambios.'; return; }
    const map = getMap();
    if (e.code === 'Delete' || e.code === 'Backspace') {
      assign(map, id, slot, null);
      note.textContent = 'Tecla borrada.';
    } else if (RESERVED.has(e.code)) {
      note.textContent = `${keyLabel(e.code)} está reservada por la página. Elegí otra.`;
      return;
    } else {
      const from = assign(map, id, slot, e.code);
      note.textContent = from ? `${keyLabel(e.code)} se quitó de ${from}.` : `${keyLabel(e.code)} asignada.`;
    }
    stopCapture();
    saveKeymap(map);
    setMap(map);
    render();
  }, true);
  window.addEventListener('keyup', (e) => { if (dialog.open) e.stopImmediatePropagation(); }, true);

  // Esc while capturing must not close the dialog.
  dialog.addEventListener('cancel', (e) => { if (capture) e.preventDefault(); });
  dialog.addEventListener('close', () => { stopCapture(); onClose?.(); });

  $('btn-teclas-defecto').addEventListener('click', () => {
    const map = defaultKeymap();
    saveKeymap(map);
    setMap(map);
    render();
    note.textContent = 'Se restauraron las teclas predeterminadas.';
  });
  $('btn-teclas-cerrar').addEventListener('click', () => dialog.close());

  function open() {
    render();
    note.textContent = '';
    onOpen?.();
    if (!dialog.open) dialog.showModal();
  }

  for (const id of ['btn-teclas', 'btn-teclas-info', 'btn-teclas-invitado']) {
    const b = $(id);
    if (b) b.addEventListener('click', open);
  }
  renderSummary();
  return { open, renderSummary, isOpen: () => dialog.open };
}
