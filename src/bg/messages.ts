import { browser } from 'wxt/browser';
import type { BgMessage, BgResponse, ClipFetchResponse } from '@/types';
import { addSnippet, logError } from '@/db';
import { dataUrlToBlob } from '@/db/io';
import { startCapture } from './capture';
import { flashBadge } from './menus';

/** Serial ids for the temporary DNR session rules (one per in-flight save). */
let dnrRuleSeq = 10000;

/** frameId of the message sender currently being handled (for fallback). */
let senderFrameId = 0;

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
  opts: { tabId?: number; frameId?: number; sourceUrl?: string } = {},
): Promise<void> {
  const blob = await fetchImageBlob(src, pageUrl, opts, 'save-image');
  await addSnippet({
    kind: 'image',
    image: blob,
    url: opts.sourceUrl || pageUrl,
    title: pageTitle,
  });
}

/**
 * Fetch an image as a Blob with the full fallback chain: worker retry matrix
 * (referrer variants + DNR Referer rewrite), then page-context fetch.
 */
async function fetchImageBlob(
  src: string,
  pageUrl: string,
  opts: { tabId?: number; frameId?: number } = {},
  source = 'save-image',
): Promise<Blob> {
  if (!/^https?:/i.test(src)) {
    return dataUrlToBlob(await fetchViaContentScript(src, opts));
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
      return await attempt.run();
    } catch (e) {
      lastError = `${attempt.label}: ${String(e)}`;
    }
  }
  try {
    return dataUrlToBlob(await fetchViaContentScript(src, opts));
  } catch (e) {
    await logError(source, `${lastError || 'fetch failed'}; fallback: ${String(e)}`, pageUrl || src);
    throw new Error(lastError || 'image fetch failed');
  }
}

/** Route the fetch through the page context (supports blob:/hotlink-protected URLs). */
async function fetchViaContentScript(
  src: string,
  opts: { tabId?: number; frameId?: number },
): Promise<string> {
  if (opts.tabId == null) throw new Error('no tab to fetch from');
  const resp = (await browser.tabs.sendMessage(
    opts.tabId,
    { type: 'clipFetchImage', src },
    opts.frameId != null ? { frameId: opts.frameId } : undefined,
  )) as ClipFetchResponse | undefined;
  if (!resp?.ok || !('dataUrl' in resp) || !resp.dataUrl) throw new Error('page fetch failed');
  return resp.dataUrl;
}

/** Encode a blob as a data URL without FileReader (works in MV3 workers). */
async function blobToDataUrl(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let bin = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return `data:${blob.type || 'image/png'};base64,${btoa(bin)}`;
}

interface SenderTabLike {
  id?: number;
  url?: string;
  title?: string;
}

async function handle(msg: BgMessage, senderTab?: SenderTabLike): Promise<BgResponse> {
  switch (msg.type) {
    case 'saveText': {
      const snip = await addSnippet({ kind: 'text', text: msg.text, url: msg.url, title: msg.title });
      await flashBadge('✓');
      return { ok: true, id: snip.id };
    }
    case 'saveImage': {
      // Content scripts extract the nearby post text (weibo body etc.) at
      // right-click time; when present it beats the generic tab title.
      const pageUrl = senderTab?.url || msg.pageUrl;
      const pageTitle = msg.pageTitle || senderTab?.title || '';
      // The snippet's source link prefers the post-specific anchor the
      // content script extracted; the tab URL stays for Referer fallbacks.
      const snippetUrl = msg.sourceUrl || pageUrl;
      try {
        if (msg.dataUrls?.length) {
          // Multi-image clip: all pictures land in ONE snippet.
          const blobs = msg.dataUrls.map(dataUrlToBlob);
          await addSnippet({
            kind: 'image',
            images: blobs,
            url: snippetUrl,
            title: pageTitle,
          });
        } else if (msg.dataUrl) {
          const blob = dataUrlToBlob(msg.dataUrl);
          await addSnippet({ kind: 'image', image: blob, url: snippetUrl, title: pageTitle });
        } else if (msg.src) {
          await saveImageFromUrl(msg.src, pageUrl, pageTitle, {
            tabId: senderTab?.id,
            frameId: senderFrameId,
            sourceUrl: msg.sourceUrl,
          });
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
    case 'fetchImage': {
      // Fetch an album original with the retry matrix and hand the bytes back
      // so the content script can build a single multi-image snippet.
      if (!msg.src || !/^https?:/i.test(msg.src)) return { ok: false, error: 'unsupported' };
      try {
        const blob = await fetchImageBlob(
          msg.src,
          senderTab?.url ?? msg.src,
          { tabId: senderTab?.id, frameId: senderFrameId },
          'fetch-image',
        );
        return { ok: true, dataUrl: await blobToDataUrl(blob) };
      } catch {
        // Errors are already logged inside fetchImageBlob.
        return { ok: false, error: 'fetch failed' };
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
    senderFrameId = sender.frameId ?? 0;
    return handle(message as BgMessage, sender.tab);
  });
}
