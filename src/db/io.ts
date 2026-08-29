import { browser } from 'wxt/browser';
import type { ExportFile, ExportSnippet, Snippet } from '@/types';
import { db, bumpVersion } from '@/db';
import { uuid } from '@/utils/id';

export function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

export function dataUrlToBlob(dataUrl: string): Blob {
  const comma = dataUrl.indexOf(',');
  const meta = comma === -1 ? dataUrl : dataUrl.slice(0, comma);
  const b64 = comma === -1 ? '' : dataUrl.slice(comma + 1);
  const mime = /data:([^;]+);/.exec(meta)?.[1] ?? 'image/png';
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

export async function exportData(): Promise<ExportFile> {
  const snippets = await db.snippets.toArray();
  const tags = await db.tags.toArray();
  const exportSnippets: ExportSnippet[] = await Promise.all(
    snippets.map(async (s) => ({
      id: s.id,
      kind: s.kind,
      text: s.text,
      imageDataUrl: s.image ? await blobToDataUrl(s.image) : undefined,
      url: s.url,
      title: s.title,
      comment: s.comment,
      tags: s.tags,
      starred: s.starred,
      timestamp: s.timestamp,
    })),
  );
  return { app: 'NoteClip', version: 1, exportedAt: Date.now(), snippets: exportSnippets, tags };
}

function toSnippet(s: ExportSnippet): Snippet {
  return {
    id: s.id,
    kind: s.kind,
    text: s.text,
    image: s.imageDataUrl ? dataUrlToBlob(s.imageDataUrl) : undefined,
    url: s.url ?? '',
    title: s.title ?? '',
    comment: s.comment,
    tags: s.tags ?? [],
    starred: !!s.starred,
    timestamp: s.timestamp,
  };
}

export async function importData(file: ExportFile, mode: 'overwrite' | 'merge'): Promise<void> {
  if (file.app !== 'NoteClip' || file.version !== 1) {
    throw new Error('invalid backup file');
  }
  if (mode === 'overwrite') {
    await db.transaction('rw', db.snippets, db.tags, async () => {
      await db.snippets.clear();
      await db.tags.clear();
      for (const tag of file.tags) {
        await db.tags.add({ id: tag.id, name: tag.name, createdAt: tag.createdAt ?? Date.now() });
      }
      for (const s of file.snippets) {
        await db.snippets.add(toSnippet(s));
      }
    });
  } else {
    await db.transaction('rw', db.snippets, db.tags, async () => {
      const existingTags = await db.tags.toArray();
      const byName = new Map(existingTags.map((tag) => [tag.name, tag.id]));
      const idMap = new Map<string, string>();
      for (const tag of file.tags) {
        const existingId = byName.get(tag.name);
        if (existingId) {
          idMap.set(tag.id, existingId);
        } else {
          const newId = uuid();
          idMap.set(tag.id, newId);
          await db.tags.add({ id: newId, name: tag.name, createdAt: Date.now() });
        }
      }
      for (const s of file.snippets) {
        if (await db.snippets.get(s.id)) continue;
        const snip = toSnippet(s);
        snip.id = uuid();
        snip.tags = (s.tags ?? []).map((id) => idMap.get(id) ?? id);
        await db.snippets.add(snip);
      }
    });
  }
  await bumpVersion();
}

export async function downloadExport(): Promise<void> {
  const data = await exportData();
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = await blobToDataUrl(blob);
  const stamp = new Date().toISOString().slice(0, 10);
  await browser.downloads.download({ url, filename: `noteclip-backup-${stamp}.json`, saveAs: true });
}

export function readExportFile(file: File): Promise<ExportFile> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        resolve(JSON.parse(String(reader.result)));
      } catch (e) {
        reject(e);
      }
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsText(file);
  });
}
