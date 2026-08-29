import { browser } from 'wxt/browser';
import type { BgMessage, BgResponse } from '@/types';
import { addSnippet } from '@/db';
import { startCapture } from './capture';
import { flashBadge } from './menus';

export async function saveImageFromUrl(src: string, pageUrl: string, pageTitle: string): Promise<void> {
  const res = await fetch(src, { credentials: 'include', mode: 'cors', referrerPolicy: 'no-referrer' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const blob = await res.blob();
  await addSnippet({ kind: 'image', image: blob, url: pageUrl, title: pageTitle });
}

async function handle(msg: BgMessage): Promise<BgResponse> {
  switch (msg.type) {
    case 'saveText': {
      const snip = await addSnippet({ kind: 'text', text: msg.text, url: msg.url, title: msg.title });
      await flashBadge('✓');
      return { ok: true, id: snip.id };
    }
    case 'saveImage': {
      try {
        await saveImageFromUrl(msg.src, msg.pageUrl, msg.pageTitle);
        await flashBadge('✓');
        return { ok: true };
      } catch {
        return { ok: false, error: 'image-fetch' };
      }
    }
    case 'startCapture':
      return startCapture();
  }
}

export function setupMessageHandler(): void {
  browser.runtime.onMessage.addListener((message: unknown) => {
    if (
      typeof message !== 'object' ||
      message === null ||
      typeof (message as { type?: unknown }).type !== 'string'
    ) {
      return;
    }
    return handle(message as BgMessage);
  });
}
