import { browser } from 'wxt/browser';
import { db, addSnippet } from '@/db';
import { t } from '@/utils/i18n';
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
    img.onerror = reject;
    img.src = src;
  });
}

async function main(): Promise<void> {
  const token = new URLSearchParams(location.search).get('token');
  const hintEl = document.getElementById('hint')!;
  const btnFull = document.getElementById('btn-full') as HTMLButtonElement;
  const btnSave = document.getElementById('btn-save') as HTMLButtonElement;
  const btnCancel = document.getElementById('btn-cancel') as HTMLButtonElement;
  const stage = document.getElementById('stage') as HTMLElement;
  const holder = document.getElementById('holder') as HTMLElement;
  const img = document.getElementById('cap-img') as HTMLImageElement;
  const sel = document.getElementById('sel') as HTMLElement;
  const overlay = document.getElementById('overlay') as HTMLElement;
  const overlayMsg = document.getElementById('overlay-msg') as HTMLElement;

  btnFull.textContent = t('captureFull');
  btnSave.textContent = t('captureConfirm');
  btnCancel.textContent = t('captureCancel');
  hintEl.textContent = t('captureHint');

  function showMessage(msg: string): void {
    overlayMsg.textContent = msg;
    overlay.hidden = false;
  }

  if (!token) {
    showMessage(t('captureInvalid'));
    return;
  }
  const pending = await db.pendingCaptures.get(token);
  if (!pending) {
    showMessage(t('captureInvalid'));
    return;
  }
  const pendingData = pending;

  let image: HTMLImageElement;
  try {
    image = await loadImage(pending.dataUrl);
  } catch {
    showMessage(t('captureInvalid'));
    return;
  }
  img.src = pending.dataUrl;

  let scale = 1;
  function fit(): void {
    const maxW = stage.clientWidth - 16;
    const maxH = stage.clientHeight - 16;
    scale = Math.min(1, maxW / image.naturalWidth, maxH / image.naturalHeight);
    img.style.width = `${Math.round(image.naturalWidth * scale)}px`;
    img.style.height = `${Math.round(image.naturalHeight * scale)}px`;
    holder.style.width = `${Math.round(image.naturalWidth * scale)}px`;
    holder.style.height = `${Math.round(image.naturalHeight * scale)}px`;
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
    holder.setPointerCapture(e.pointerId);
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
    holder.releasePointerCapture(e.pointerId);
  });

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
    const nat = currentNaturalRect();
    if (!nat) {
      showMessage(t('captureHint'));
      return;
    }
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
    showMessage(t('captureSaved'));
    btnSave.disabled = true;
    setTimeout(() => window.close(), 900);
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

  selectAll();
}

void main();
