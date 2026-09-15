import type { Snippet } from '@/types';
import { browser } from 'wxt/browser';
import { db, listSnippets, snippetImages, type ListFilter } from '@/db';
import type { ProgressFn } from './io';
import { t, fullTime } from '@/utils/i18n';
import { esc, textFragmentUrl } from '@/utils/format';

const EXT_BY_MIME: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/bmp': 'bmp',
  'image/avif': 'avif',
};

/** Encode an image blob as a self-contained data URL (no FileReader needed). */
async function blobToDataUrl(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let bin = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return `data:${blob.type || 'image/png'};base64,${btoa(bin)}`;
}

const STYLE = `
  body { font: 14px/1.6 system-ui, -apple-system, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif; max-width: 720px; margin: 24px auto; padding: 0 16px; color: #1f2330; background: #fff; }
  h1 { font-size: 20px; }
  .meta { color: #8a8f9c; font-size: 12px; margin: 4px 0 10px; }
  .clip { border: 1px solid #e2e2ea; border-radius: 10px; padding: 14px 16px; margin: 14px 0; break-inside: avoid; }
  .clip h2 { font-size: 15px; margin: 0 0 6px; }
  .clip pre { white-space: pre-wrap; word-break: break-word; font: inherit; margin: 0; }
  .clip img { max-width: 100%; border-radius: 8px; display: block; margin: 6px 0; }
  blockquote { border-left: 3px solid #e2e2ea; margin: 8px 0; padding: 2px 10px; color: #555; }
  .tags span { background: #eef2ff; color: #4f46e5; border-radius: 6px; padding: 1px 7px; margin-right: 4px; font-size: 12px; }
  a { color: #4f46e5; }
`;

function tagNames(s: Snippet, tagMap: Map<string, string>): string[] {
  return s.tags.map((id) => tagMap.get(id)).filter((n): n is string => !!n);
}

/**
 * Build a single self-contained HTML file: images embedded as data URLs,
 * readable in any browser and importable into note apps.
 */
export async function buildHtmlExport(
  filter: ListFilter = {},
  opts: { noImages?: boolean; onProgress?: ProgressFn } = {},
): Promise<string> {
  const noImages = opts.noImages === true;
  let snippets = await listSnippets(filter);
  if (noImages) snippets = snippets.filter((s) => s.kind === 'text');
  const tagMap = new Map((await db.tags.toArray()).map((tag) => [tag.id, tag.name]));
  const items = [...snippets].sort((a, b) => a.timestamp - b.timestamp);

  const parts: string[] = [
    '<!doctype html>',
    `<html lang="en"><head><meta charset="UTF-8" /><meta name="viewport" content="width=device-width, initial-scale=1.0" /><title>${esc(t('markdownTitle'))}</title><style>${STYLE}</style></head><body>`,
    `<h1>${esc(t('markdownTitle'))}</h1>`,
    `<p class="meta">${esc(t('markdownMeta').replace('{time}', fullTime(Date.now())).replace('{n}', String(items.length)))}</p>`,
  ];

  for (let i = 0; i < items.length; i++) {
    const s = items[i]!;
    const names = tagNames(s, tagMap);
    const href = s.url ? textFragmentUrl(s.url, s.text) : '';
    const metaBits = [fullTime(s.timestamp)];
    if (href) metaBits.push(`<a href="${esc(href)}" target="_blank" rel="noopener noreferrer">${esc(t('markdownSource'))}</a>`);
    if (s.starred) metaBits.push('★');
    const tagHtml = names.length ? `<div class="tags">${names.map((n) => `<span>#${esc(n)}</span>`).join('')}</div>` : '';
    const comment = s.comment?.trim() ? `<blockquote>${esc(s.comment)}</blockquote>` : '';

    let inner = '';
    if (s.kind === 'image') {
      const blobs = snippetImages(s);
      const imgs: string[] = [];
      for (const blob of blobs) imgs.push(`<img src="${await blobToDataUrl(blob)}" alt="${esc(s.title)}" />`);
      inner = imgs.join('') + (s.text ? `<pre>${esc(s.text)}</pre>` : '');
    } else {
      inner = `<pre>${esc(s.text ?? '')}</pre>`;
    }

    parts.push(
      `<div class="clip"><h2>${esc(s.title || t('imageKind'))}</h2>` +
        `<div class="meta">${metaBits.join(' · ')}</div>` +
        `${inner}${comment}${tagHtml}</div>`,
    );
    opts.onProgress?.(i + 1, items.length);
  }

  parts.push('</body></html>');
  return parts.join('\n');
}

/** Build the single-file HTML export and hand it to the downloads API. */
export async function downloadHtmlExport(
  filter: ListFilter = {},
  opts: { noImages?: boolean; onProgress?: ProgressFn } = {},
): Promise<void> {
  const html = await buildHtmlExport(filter, opts);
  const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  try {
    await browser.downloads.download({
      url,
      filename: `noteclip-export-${new Date().toISOString().slice(0, 10)}.html`,
      saveAs: true,
    });
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }
}
