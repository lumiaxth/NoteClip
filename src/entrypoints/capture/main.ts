import { browser } from 'wxt/browser';
import { db, addSnippet } from '@/db';
import { t } from '@/utils/i18n';
import { initTheme } from '@/settings/theme';
import './style.css';

interface Rect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

function rectSize(r: Rect): { x: number; y: number; w: number; h: number } {
  const x = Math.min(r.x0, r.x1);
  const y = Math.min(r.y0, r.y1);
  return { x, y, w: Math.abs(r.x1 - r.x0), h: Math.abs(r.y1 - r.y0) };
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('image load failed'));
    img.src = src;
  });
}

/** Wait until the in-DOM <img> has decoded its source. */
function awaitImgReady(img: HTMLImageElement): Promise<void> {
  return new Promise((resolve) => {
    if (img.complete) return resolve();
    img.addEventListener('load', () => resolve(), { once: true });
    img.addEventListener('error', () => resolve(), { once: true });
  });
}

let fatalShown = false;

/** Recoverable full-page message so the user is never stuck. */
function showFatal(msg?: string): void {
  if (fatalShown) return;
  fatalShown = true;
  const overlay = document.getElementById('overlay');
  const msgEl = document.getElementById('overlay-msg');
  const close = document.getElementById('btn-close');
  if (msgEl) msgEl.textContent = msg || t('captureError');
  if (close) {
    close.hidden = false;
    close.addEventListener('click', () => window.close());
  }
  if (overlay) overlay.hidden = false;
}

window.addEventListener('error', () => showFatal());
window.addEventListener('unhandledrejection', (e) => {
  e.preventDefault();
  showFatal();
});

async function main(): Promise<void> {
  const token = new URLSearchParams(location.search).get('token');
  const hintEl = document.getElementById('hint')!;
  const btnFull = document.getElementById('btn-full') as HTMLButtonElement;
  const btnSave = document.getElementById('btn-save') as HTMLButtonElement;
  const btnCancel = document.getElementById('btn-cancel') as HTMLButtonElement;
  const holder = document.getElementById('holder') as HTMLElement;
  const img = document.getElementById('cap-img') as HTMLImageElement;
  const sel = document.getElementById('sel') as HTMLElement;
  const overlay = document.getElementById('overlay') as HTMLElement;
  const overlayMsg = document.getElementById('overlay-msg') as HTMLElement;
  const btnClose = document.getElementById('btn-close') as HTMLButtonElement;

  btnFull.textContent = t('captureFull');
  btnSave.textContent = t('captureConfirm');
  btnCancel.textContent = t('captureCancel');
  btnClose.textContent = t('close');
  hintEl.textContent = t('captureHint');

  function showMessage(msg: string, closable: boolean): void {
    overlayMsg.textContent = msg;
    btnClose.hidden = !closable;
    overlay.hidden = false;
  }

  btnClose.addEventListener('click', () => window.close());

  if (!token) {
    showMessage(t('captureInvalid'), true);
    return;
  }
  const pending = await db.pendingCaptures.get(token);
  if (!pending) {
    showMessage(t('captureInvalid'), true);
    return;
  }
  const pendingData = pending;

  let image: HTMLImageElement;
  try {
    image = await loadImage(pendingData.dataUrl);
  } catch {
    showMessage(t('captureInvalid'), true);
    return;
  }
  img.src = pendingData.dataUrl;
  await awaitImgReady(img);

  let scale = 1;
  function fit(): void {
    const maxW = window.innerWidth - 24;
    const maxH = window.innerHeight - 80;
    const raw = Math.min(1, maxW / image.naturalWidth, maxH / image.naturalHeight);
    scale = Number.isFinite(raw) && raw > 0 ? raw : 1;
    const w = Math.round(image.naturalWidth * scale);
    const h = Math.round(image.naturalHeight * scale);
    img.style.width = `${w}px`;
    img.style.height = `${h}px`;
    holder.style.width = `${w}px`;
    holder.style.height = `${h}px`;
  }
  fit();
  window.addEventListener('resize', fit);

  let rect: Rect | null = null;
  let drag = false;
  let startX = 0;
  let startY = 0;

  function toLocal(e: PointerEvent): { x: number; y: number } {
    const r = holder.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  function drawSel(): void {
    if (!rect) {
      sel.hidden = true;
      return;
    }
    const { x, y, w, h } = rectSize(rect);
    sel.hidden = w < 2 || h < 2;
    sel.style.left = `${Math.max(0, x)}px`;
    sel.style.top = `${Math.max(0, y)}px`;
    sel.style.width = `${w}px`;
    sel.style.height = `${h}px`;
  }

  holder.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    drag = true;
    try {
      holder.setPointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
    const p = toLocal(e);
    startX = p.x;
    startY = p.y;
    rect = { x0: startX, y0: startY, x1: startX, y1: startY };
    drawSel();
  });

  holder.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const p = toLocal(e);
    rect!.x1 = Math.min(holder.clientWidth, Math.max(0, p.x));
    rect!.y1 = Math.min(holder.clientHeight, Math.max(0, p.y));
    drawSel();
  });

  holder.addEventListener('pointerup', (e) => {
    if (!drag) return;
    drag = false;
    try {
      holder.releasePointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
  });

  holder.addEventListener('dragstart', (e) => e.preventDefault());

  function selectAll(): void {
    rect = { x0: 0, y0: 0, x1: holder.clientWidth, y1: holder.clientHeight };
    drawSel();
  }

  function currentNaturalRect(): Rect | null {
    if (!rect) return null;
    const { x, y, w, h } = rectSize(rect);
    if (w < 2 || h < 2) return null;
    const inv = 1 / scale;
    return { x0: x * inv, y0: y * inv, x1: (x + w) * inv, y1: (y + h) * inv };
  }

  async function save(): Promise<void> {
    if (btnSave.disabled) return; // re-entry guard (e.g. pressing Enter twice)
    const nat = currentNaturalRect();
    if (!nat) {
      showMessage(t('captureHint'), true);
      return;
    }
    btnSave.disabled = true;
    const { x, y, w, h } = rectSize(nat);
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(w));
    canvas.height = Math.max(1, Math.round(h));
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(image, x, y, w, h, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
    if (blob) {
      await addSnippet({
        kind: 'image',
        image: blob,
        url: pendingData.tabUrl,
        title: pendingData.tabTitle,
      });
    }
    await db.pendingCaptures.delete(pendingData.id);
    showMessage(t('captureSavedAutoClose'), true);
    btnSave.disabled = true;
    setTimeout(() => window.close(), 3000);
  }

  function cancel(): void {
    void db.pendingCaptures.delete(pendingData.id).finally(() => window.close());
  }

  btnFull.addEventListener('click', selectAll);
  btnSave.addEventListener('click', () => void save());
  btnCancel.addEventListener('click', cancel);

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') cancel();
    if (e.key === 'Enter') void save();
  });
}

void main().catch((err) => {
  console.error('[NoteClip capture]', err);
  showFatal();
});

// Follow the user's accent color; the crop page itself stays dark.
void initTheme().then(() => {
  document.documentElement.style.setProperty('color-scheme', 'dark');
});
