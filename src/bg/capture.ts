import { browser } from 'wxt/browser';
import type { BgResponse } from '@/types';
import { db } from '@/db';
import { uuid } from '@/utils/id';

/**
 * Capture the visible area of the active tab, stash it in IndexedDB,
 * then open the crop page in a new tab.
 */
export async function startCapture(): Promise<BgResponse> {
  try {
    const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
    if (!tab || tab.id == null || !/^https?:/.test(tab.url ?? '')) {
      return { ok: false, error: 'not-web' };
    }
    const options = { format: 'png' as const };
    const dataUrl =
      tab.windowId != null
        ? await browser.tabs.captureVisibleTab(tab.windowId, options)
        : await browser.tabs.captureVisibleTab(options);
    const token = uuid();
    await db.pendingCaptures.add({
      id: token,
      dataUrl,
      tabUrl: tab.url ?? '',
      tabTitle: tab.title ?? '',
      timestamp: Date.now(),
    });
    const captureUrl = browser.runtime.getURL('/capture.html') + `?token=${token}`;
    await browser.tabs.create({ url: captureUrl });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}
