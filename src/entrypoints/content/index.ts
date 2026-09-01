import { defineContentScript } from 'wxt/utils/define-content-script';
import { browser } from 'wxt/browser';
import { t } from '@/utils/i18n';
import type { BgResponse, ClipFetchResponse } from '@/types';

export default defineContentScript({
  matches: ['<all_urls>'],
  allFrames: true,
  runAt: 'document_idle',
  main() {
    const btn = document.createElement('button');
    btn.textContent = t('floatingCapture');
    btn.setAttribute('type', 'button');
    btn.style.cssText = [
      'position:fixed',
      'z-index:2147483647',
      'display:none',
      'padding:6px 14px',
      'font:600 13px/1.4 system-ui,sans-serif',
      'color:#ffffff',
      'background:#4f46e5',
      'border:0',
      'border-radius:8px',
      'box-shadow:0 2px 10px rgba(0,0,0,.25)',
      'cursor:pointer',
    ].join(';');

    let visible = false;
    let lastText = '';
    /** Enabled by the "floating clip button" setting; live-updated. */
    let enabled = true;
    /** True while the user is pressing the button — page/selection events are ignored. */
    let pressing = false;

    function hide(): void {
      if (visible) {
        btn.style.display = 'none';
        visible = false;
      }
    }

    function show(): void {
      if (!enabled) return;
      btn.style.display = 'block';
      visible = true;
    }

    function isEditable(el: Element | null): boolean {
      if (!el) return false;
      const tag = el.tagName;
      return tag === 'INPUT' || tag === 'TEXTAREA' || (el as HTMLElement).isContentEditable;
    }

    function getSelectionText(): string {
      const sel = window.getSelection();
      if (!sel || sel.isCollapsed) return '';
      const raw = sel.toString();
      if (!raw.trim()) return '';
      if (isEditable(document.activeElement)) return '';
      if (isEditable(sel.anchorNode?.parentElement ?? null)) return '';
      return raw;
    }

    function positionButton(): void {
      const sel = window.getSelection();
      if (!sel || sel.rangeCount === 0) {
        hide();
        return;
      }
      const rect = sel.getRangeAt(0).getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) {
        hide();
        return;
      }
      const x = Math.max(4, Math.min(rect.left + rect.width / 2, window.innerWidth - 130));
      const y = Math.max(4, rect.top - 42);
      btn.style.left = `${x}px`;
      btn.style.top = `${y}px`;
    }

    document.addEventListener('mouseup', (e) => {
      if (pressing || btn.contains(e.target as Node)) return;
      const text = getSelectionText();
      if (!text) {
        hide();
        return;
      }
      lastText = text;
      positionButton();
      show();
    });

    document.addEventListener('selectionchange', () => {
      if (pressing) return;
      if (visible && !getSelectionText()) hide();
    });

    window.addEventListener('scroll', hide, true);
    window.addEventListener('resize', hide);
    document.addEventListener('mousedown', (e) => {
      if (!btn.contains(e.target as Node)) hide();
    });

    // Isolate the button from page handlers and keep the selection intact
    // while pressing, so the click event always lands on the button.
    btn.addEventListener('pointerdown', (e) => {
      pressing = true;
      e.stopPropagation();
    });
    btn.addEventListener('pointerup', (e) => e.stopPropagation());
    btn.addEventListener('mousedown', (e) => {
      e.preventDefault();
      e.stopPropagation();
    });
    btn.addEventListener('mouseup', (e) => e.stopPropagation());
    btn.addEventListener('dragstart', (e) => e.preventDefault());
    // If the press is aborted (released outside the button), no click event
    // will ever fire — release the flag so page events work again.
    window.addEventListener(
      'pointerup',
      (e) => {
        if (!btn.contains(e.target as Node)) pressing = false;
      },
      true,
    );

    function flash(label: string, failed: boolean, ms: number): void {
      btn.textContent = label;
      setTimeout(() => {
        btn.textContent = t('floatingCapture');
        if (!failed) hide();
      }, ms);
    }

    btn.addEventListener('click', async () => {
      pressing = false;
      const text = lastText;
      if (!text) return;
      let resp: BgResponse | undefined;
      try {
        resp = await browser.runtime.sendMessage({
          type: 'saveText',
          text,
          url: location.href,
          title: document.title,
        });
      } catch {
        resp = { ok: false };
      }
      // The background saves fire-and-forget; a missing response still means saved.
      if (resp?.ok !== false) {
        flash(t('floatingSaved'), false, 1200);
        lastText = '';
      } else {
        flash(t('floatingSaveFailed'), true, 1500);
      }
    });

    // ---------- Image clip fallback (protected sites: overlays, blob: URLs,
    // custom right-click menus that block the native context menu) ----------

    const imgBtn = document.createElement('button');
    imgBtn.textContent = t('floatingClipImage');
    imgBtn.setAttribute('type', 'button');
    imgBtn.style.cssText = btn.style.cssText;

    /** Image URL found under the right-click point; '' when none. */
    let imgTarget = '';
    let imgPressing = false;

    function hideImgBtn(): void {
      imgBtn.style.display = 'none';
    }

    function showImgBtnAt(x: number, y: number): void {
      if (!enabled) return;
      const w = 96;
      const h = 29;
      // Show above the click point so the site's own context menu (if any)
      // stays visible below the button.
      imgBtn.style.left = `${Math.max(4, Math.min(x + 10, window.innerWidth - w - 4))}px`;
      imgBtn.style.top = `${Math.max(4, y - h - 8)}px`;
      imgBtn.style.display = 'block';
    }

    /** Walk the stack of elements at the point: <img> first, then CSS backgrounds. */
    function findImageUrlAt(x: number, y: number): string {
      for (const el of document.elementsFromPoint(x, y)) {
        if (el instanceof HTMLImageElement && el.src) return el.src;
        if (el instanceof Element) {
          const bg = getComputedStyle(el).backgroundImage;
          const m = bg && bg !== 'none' ? /url\(["']?([^"')]+)["']?\)/.exec(bg) : null;
          if (m?.[1]) {
            try {
              return new URL(m[1], location.href).href;
            } catch {
              return '';
            }
          }
        }
      }
      return '';
    }

    // Decide after the event finishes dispatching: a page calling
    // preventDefault (custom menus) marks the event, and only then the
    // floating button is the sole entry point.
    document.addEventListener(
      'contextmenu',
      (e) => {
        if (!enabled || imgPressing) return;
        const url = findImageUrlAt(e.clientX, e.clientY);
        if (!url || !/^(https?|blob|data):/i.test(url)) return;
        const targetIsImg = e.target instanceof HTMLImageElement;
        setTimeout(() => {
          if (e.defaultPrevented || !targetIsImg) {
            imgTarget = url;
            showImgBtnAt(e.clientX, e.clientY);
          }
        }, 0);
      },
      true,
    );

    document.addEventListener('mousedown', (e) => {
      if (!imgBtn.contains(e.target as Node)) {
        hideImgBtn();
        imgTarget = '';
      }
    });
    window.addEventListener('scroll', hideImgBtn, true);
    window.addEventListener('resize', hideImgBtn);

    // Isolate the button from page handlers, mirroring the text clip button.
    imgBtn.addEventListener('pointerdown', (e) => {
      imgPressing = true;
      e.stopPropagation();
    });
    imgBtn.addEventListener('pointerup', (e) => e.stopPropagation());
    imgBtn.addEventListener('mousedown', (e) => {
      e.preventDefault();
      e.stopPropagation();
    });
    imgBtn.addEventListener('mouseup', (e) => e.stopPropagation());
    window.addEventListener(
      'pointerup',
      (e) => {
        if (!imgBtn.contains(e.target as Node)) imgPressing = false;
      },
      true,
    );

    /** Fetch an image from the page context (cookies, page referrer, blob: OK). */
    async function fetchAsDataUrl(src: string): Promise<string> {
      if (/^data:/i.test(src)) return src;
      const res = await fetch(src);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      return await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(blob);
      });
    }

    function flashImg(label: string, failed: boolean, ms: number): void {
      imgBtn.textContent = label;
      setTimeout(() => {
        imgBtn.textContent = t('floatingClipImage');
        if (!failed) hideImgBtn();
      }, ms);
    }

    imgBtn.addEventListener('click', async () => {
      imgPressing = false;
      const src = imgTarget;
      imgTarget = '';
      if (!src) return;
      flashImg(t('clippingNow'), false, 8000);
      try {
        const dataUrl = await fetchAsDataUrl(src);
        const resp = (await browser.runtime.sendMessage({
          type: 'saveImage',
          src,
          dataUrl,
          pageUrl: location.href,
          title: document.title,
        })) as BgResponse | undefined;
        if (resp?.ok !== false) flashImg(t('floatingSaved'), false, 1200);
        else flashImg(t('floatingSaveFailed'), true, 1500);
      } catch {
        flashImg(t('floatingSaveFailed'), true, 1500);
      }
    });

    // Background asks this frame to fetch an image from the page context.
    browser.runtime.onMessage.addListener((message: unknown) => {
      if (
        typeof message !== 'object' ||
        message === null ||
        (message as { type?: unknown }).type !== 'clipFetchImage'
      ) {
        return;
      }
      const src = (message as { src?: unknown }).src;
      if (typeof src !== 'string') {
        return Promise.resolve<ClipFetchResponse>({ ok: false, error: 'bad request' });
      }
      return fetchAsDataUrl(src)
        .then(
          (dataUrl): ClipFetchResponse => ({ ok: true, dataUrl }),
        )
        .catch(
          (e): ClipFetchResponse => ({ ok: false, error: String(e) }),
        );
    });

    // Settings: accent color + on/off toggle, applied live (both buttons).
    function applySettings(
      s: { accent?: string; floatingButton?: boolean } | undefined,
    ): void {
      if (s?.accent) {
        btn.style.background = s.accent;
        imgBtn.style.background = s.accent;
      }
      enabled = s?.floatingButton !== false;
      if (!enabled) {
        hide();
        hideImgBtn();
      }
    }
    void browser.storage.local.get('noteclip:settings').then((res) => {
      applySettings(res['noteclip:settings'] as { accent?: string; floatingButton?: boolean } | undefined);
    });
    browser.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local') return;
      const change = changes['noteclip:settings'];
      if (!change) return;
      applySettings(change.newValue as { accent?: string; floatingButton?: boolean } | undefined);
    });

    document.documentElement.appendChild(btn);
    document.documentElement.appendChild(imgBtn);
  },
});
