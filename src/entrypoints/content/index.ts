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

    function hide(): void {
      if (visible) {
        btn.style.display = 'none';
        visible = false;
      }
    }

    function show(): void {
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
      const text = sel.toString().trim();
      if (!text) return '';
      if (isEditable(document.activeElement)) return '';
      if (isEditable(sel.anchorNode?.parentElement ?? null)) return '';
      return text;
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

    document.addEventListener('mouseup', () => {
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
      if (visible && !getSelectionText()) hide();
    });

    window.addEventListener('scroll', hide, true);
    window.addEventListener('resize', hide);
    document.addEventListener('mousedown', (e) => {
      if (!btn.contains(e.target as Node)) hide();
    });

    btn.addEventListener('mousedown', (e) => e.preventDefault());

    btn.addEventListener('click', async () => {
      const text = lastText || getSelectionText();
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
        resp = undefined;
      }
      if (resp?.ok) {
        btn.textContent = t('floatingSaved');
        setTimeout(() => {
          btn.textContent = t('floatingCapture');
          hide();
        }, 1200);
      } else {
        hide();
      }
    });

    document.documentElement.appendChild(btn);
  },
});
