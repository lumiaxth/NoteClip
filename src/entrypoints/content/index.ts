import { defineContentScript } from 'wxt/utils/define-content-script';
import { browser } from 'wxt/browser';
import { t } from '@/utils/i18n';
import type { BgResponse } from '@/types';

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

    // Settings: accent color + on/off toggle, applied live.
    function applySettings(s: { accent?: string; floatingButton?: boolean } | undefined): void {
      if (s?.accent) btn.style.background = s.accent;
      enabled = s?.floatingButton !== false;
      if (!enabled) hide();
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
  },
});
