import { browser } from 'wxt/browser';
import type { BgMessage, BgResponse, ClipFetchResponse } from '@/types';
import { addSnippet, logError } from '@/db';
import { dataUrlToBlob } from '@/db/io';
import { startCapture } from './capture';
import { flashBadge } from './menus';

/** Serial ids for the temporary DNR session rules (one per in-flight save). */
let dnrRuleSeq = 10000;

interface DnrApi {
  updateSessionRules: (details: {
    addRules?: {
      id: number;
      priority?: number;
      condition: { requestDomains: string[]; resourceTypes: string[] };
      action: {
        type: string;
        requestHeaders: { header: string; operation: string; value?: string }[];
      };
    }[];
    removeRuleIds?: number[];
  }) => Promise<void>;
}

function dnrApi(): DnrApi | undefined {
  return (browser as unknown as { declarativeNetRequest?: DnrApi }).declarativeNetRequest;
}

/**
 * Hotlink-protected CDNs (e.g. sinaimg.cn) reject requests without a
 * same-site Referer. A temporary session rule rewrites the Referer at the
 * network layer — the only way to do this in MV3. The rule applies to the
 * image's domain only and is removed right after the fetch.
 */
async function fetchWithPageReferer(url: string, referer: string): Promise<Blob> {
  const dnr = dnrApi();
  if (!dnr?.updateSessionRules) throw new Error('declarativeNetRequest unavailable');
  const ruleId = dnrRuleSeq++;
  const host = new URL(url).hostname;
  await dnr.updateSessionRules({
    addRules: [
      {
        id: ruleId,
        priority: 1,
        condition: { requestDomains: [host], resourceTypes: ['xmlhttprequest'] },
        action: {
          type: 'modifyHeaders',
          requestHeaders: [{ header: 'Referer', operation: 'set', value: referer }],
        },
      },
    ],
  });
  try {
    const res = await fetch(url, { referrerPolicy: 'no-referrer' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.blob();
  } finally {
    void dnr.updateSessionRules({ removeRuleIds: [ruleId] }).catch(() => undefined);
  }
}

/** Validate that a fetch response is a usable image blob. */
async function fetchBlob(url: string, init: RequestInit): Promise<Blob> {
  const res = await fetch(url, init);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const blob = await res.blob();
  if (!blob.type.startsWith('image/') && blob.type) {
    throw new Error(`unexpected content-type: ${blob.type}`);
  }
  return blob;
}

/**
 * Save an image found at `src`. http(s) URLs are fetched by the worker with a
 * retry matrix ending in a DNR Referer rewrite; blob:/data: URLs (and any
 * failure) fall back to the content script, which fetches from page context.
 */
export async function saveImageFromUrl(
  src: string,
  pageUrl: string,
  pageTitle: string,
  opts: { tabId?: number; frameId?: number } = {},
): Promise<void> {
  if (!/^https?:/i.test(src)) {
    return saveViaContentScript(src, pageUrl, pageTitle, opts);
  }
  let origin = '';
  try {
    origin = new URL(pageUrl).origin;
  } catch {
    origin = '';
  }
  if (!/^https?:/.test(origin)) {
    try {
      origin = new URL(src).origin;
    } catch {
      origin = '';
    }
  }

  const attempts: { label: string; run: () => Promise<Blob> }[] = [
    { label: 'no-referrer', run: () => fetchBlob(src, { referrerPolicy: 'no-referrer' }) },
    {
      label: 'origin+credentials',
      run: () => fetchBlob(src, { referrerPolicy: 'origin', credentials: 'include' }),
    },
    {
      label: 'full-referrer',
      run: () => fetchBlob(src, { referrerPolicy: 'unsafe-url', credentials: 'include' }),
    },
  ];
  if (origin) {
    attempts.push({
      label: `dnr-referer(${origin})`,
      run: () => fetchWithPageReferer(src, `${origin}/`),
    });
  }

  let lastError = '';
  for (const attempt of attempts) {
    try {
      const blob = await attempt.run();
      await addSnippet({ kind: 'image', image: blob, url: pageUrl, title: pageTitle });
      return;
    } catch (e) {
      lastError = `${attempt.label}: ${String(e)}`;
    }
  }
  try {
    return await saveViaContentScript(src, pageUrl, pageTitle, opts);
  } catch (e) {
    await logError('save-image', `${lastError || 'fetch failed'}; fallback: ${String(e)}`, pageUrl || src);
    throw new Error(lastError || 'image save failed');
  }
}

/** Route the fetch through the page context (supports blob:/data:/hotlink-protected URLs). */
async function saveViaContentScript(
  src: string,
  pageUrl: string,
  pageTitle: string,
  opts: { tabId?: number; frameId?: number },
): Promise<void> {
  if (opts.tabId == null) throw new Error('no tab to fetch from');
  const resp = (await browser.tabs.sendMessage(
    opts.tabId,
    { type: 'clipFetchImage', src },
    opts.frameId != null ? { frameId: opts.frameId } : undefined,
  )) as ClipFetchResponse | undefined;
  if (!resp?.ok || !('dataUrl' in resp) || !resp.dataUrl) throw new Error('page fetch failed');
  const blob = dataUrlToBlob(resp.dataUrl);
  await addSnippet({ kind: 'image', image: blob, url: pageUrl, title: pageTitle });
}

async function handle(msg: BgMessage, senderTabUrl?: string, senderTabTitle?: string): Promise<BgResponse> {
  switch (msg.type) {
    case 'saveText': {
      const snip = await addSnippet({ kind: 'text', text: msg.text, url: msg.url, title: msg.title });
      await flashBadge('✓');
      return { ok: true, id: snip.id };
    }
    case 'saveImage': {
      // Prefer the top-level tab's title/URL: content scripts may run inside
      // iframes where document.title is empty (e.g. embedded viewers).
      const pageUrl = senderTabUrl || msg.pageUrl;
      const pageTitle = senderTabTitle || msg.pageTitle;
      try {
        if (msg.dataUrl) {
          const blob = dataUrlToBlob(msg.dataUrl);
          await addSnippet({ kind: 'image', image: blob, url: pageUrl, title: pageTitle });
        } else if (msg.src) {
          await saveImageFromUrl(msg.src, pageUrl, pageTitle);
        } else {
          throw new Error('no image source');
        }
        await flashBadge('✓');
        return { ok: true };
      } catch (e) {
        await logError('save-image', String(e), pageUrl);
        return { ok: false, error: 'image-fetch' };
      }
    }
    case 'startCapture':
      return startCapture();
    default:
      return { ok: false, error: 'unknown' };
  }
}

export function setupMessageHandler(): void {
  browser.runtime.onMessage.addListener((message: unknown, sender) => {
    if (
      typeof message !== 'object' ||
      message === null ||
      typeof (message as { type?: unknown }).type !== 'string'
    ) {
      return;
    }
    return handle(message as BgMessage, sender.tab?.url, sender.tab?.title);
  });
}
