import { browser } from 'wxt/browser';
import { strFromU8, strToU8, unzip, zip, type Unzipped, type Zippable } from 'fflate';
import type { ExportFile, ExportSnippet, Snippet } from '@/types';
import { db, bumpVersion, listSnippets, type ListFilter } from '@/db';
import { uuid } from '@/utils/id';
import { buildMarkdownExport, markdownExportZip } from './markdown';

export type ProgressFn = (done: number, total: number) => void;

export interface BackupContent {
  data: ExportFile;
  images: Map<string, Uint8Array>;
}

export interface ImportPreview {
  total: number;
  imageCount: number;
  duplicates: number;
}

export interface ImportResult {
  imported: number;
  skipped: number;
  failed: number;
}

const MIME_BY_EXT: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
  bmp: 'image/bmp',
  avif: 'image/avif',
  svg: 'image/svg+xml',
};

const EXT_BY_MIME: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/bmp': 'bmp',
  'image/avif': 'avif',
  'image/svg+xml': 'svg',
};

function extForBlob(blob: Blob): string {
  return EXT_BY_MIME[blob.type.toLowerCase()] ?? 'png';
}

function mimeForExt(ext: string): string {
  return MIME_BY_EXT[ext] ?? 'image/png';
}

/**
 * Content fingerprint used to detect duplicate clips across devices/backups:
 * text clips hash by URL + normalized text, image clips by URL + byte size.
 */
function fingerprintOf(s: { kind: string; url: string; text?: string; imageSize?: number }): string {
  if (s.kind === 'image') return `i:${s.url}|${s.imageSize ?? 0}`;
  return `t:${s.url}|${(s.text ?? '').replace(/\s+/g, ' ')}`;
}

/** Convert a snippet's stored fingerprint into the same form as Snippet's. */
function fingerprintOfExport(s: ExportSnippet): string {
  return fingerprintOf({ kind: s.kind, url: s.url, text: s.text, imageSize: s.imageBytes });
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

async function readBytes(blob: Blob): Promise<ArrayBuffer> {
  return blob.arrayBuffer();
}

/**
 * Build a version-2 backup zip: data.json (no inline images) + images/ folder.
 * `noImages` excludes image clips entirely (lightweight text-only backup).
 */
export async function buildBackup(
  filter: ListFilter = {},
  opts: { noImages?: boolean; onProgress?: ProgressFn } = {},
): Promise<{ blob: Blob; filename: string }> {
  const noImages = opts.noImages === true;
  let snippets = await listSnippets(filter);
  if (noImages) snippets = snippets.filter((s) => s.kind === 'text');
  const tags = await db.tags.toArray();
  const usedTagIds = new Set(snippets.flatMap((s) => s.tags));
  const narrowed = !!(filter.query || filter.starredOnly || filter.tagId || filter.kind || noImages);
  const tagsForExport = narrowed ? tags.filter((t) => usedTagIds.has(t.id)) : tags;

  const images = new Map<string, Uint8Array>();
  const exportSnippets: ExportSnippet[] = [];
  const total = snippets.length;
  for (let i = 0; i < total; i++) {
    const s = snippets[i]!;
    let imageFile: string | undefined;
    let imageBytes: number | undefined;
    if (s.image) {
      imageFile = `images/${s.id}.${extForBlob(s.image)}`;
      imageBytes = s.image.size;
      images.set(imageFile, new Uint8Array(await readBytes(s.image)));
    }
    exportSnippets.push({
      id: s.id,
      kind: s.kind,
      text: s.text,
      imageFile,
      imageBytes,
      url: s.url,
      title: s.title,
      comment: s.comment,
      tags: s.tags,
      starred: s.starred,
      timestamp: s.timestamp,
    });
    opts.onProgress?.(i + 1, total);
  }

  const data: ExportFile = {
    app: 'NoteClip',
    version: 2,
    exportedAt: Date.now(),
    snippets: exportSnippets,
    tags: tagsForExport,
  };
  const files: Zippable = { 'data.json': strToU8(JSON.stringify(data)) };
  images.forEach((bytes, path) => {
    files[path] = bytes;
  });
  const zipped = await new Promise<Uint8Array>((resolve, reject) =>
    zip(files, (err, out) => (err ? reject(err) : resolve(out))),
  );
  const blob = new Blob([zipped as unknown as BlobPart], { type: 'application/zip' });
  const stamp = new Date().toISOString().slice(0, 10);
  return { blob, filename: `noteclip-backup-${stamp}.zip` };
}

export async function downloadExport(
  filter: ListFilter = {},
  opts: { noImages?: boolean; onProgress?: ProgressFn } = {},
): Promise<void> {
  const { blob, filename } = await buildBackup(filter, opts);
  // The export always runs from an extension page (panel/settings), where
  // object URLs are available and avoid the base64 size penalty.
  const url = URL.createObjectURL(blob);
  try {
    await browser.downloads.download({ url, filename, saveAs: true });
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }
}

/** Parse and validate a backup zip. Only version-2 zips are accepted. */
export async function readBackupZip(file: File): Promise<BackupContent> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const unzipped: Unzipped = await new Promise((resolve, reject) =>
    unzip(bytes, (err, out) => (err ? reject(err) : resolve(out))),
  );
  const dataEntry = unzipped['data.json'];
  if (!dataEntry) throw new Error('missing data.json');
  const data = JSON.parse(strFromU8(dataEntry)) as ExportFile;
  if (data.app !== 'NoteClip' || data.version !== 2) throw new Error('unsupported backup version');
  const images = new Map<string, Uint8Array>();
  for (const [path, entry] of Object.entries(unzipped)) {
    if (path !== 'data.json' && path.startsWith('images/')) images.set(path, entry);
  }
  return { data, images };
}

/** Compare backup contents against the local library for the import preview. */
export async function previewImport(content: BackupContent): Promise<ImportPreview> {
  const existing = await db.snippets.toArray();
  const fingerprints = new Set(existing.map((s) => fingerprintOf(s)));
  let duplicates = 0;
  let imageCount = 0;
  const seen = new Set<string>();
  for (const s of content.data.snippets) {
    const fp = fingerprintOfExport(s);
    if (fingerprints.has(fp) || seen.has(fp)) duplicates++;
    seen.add(fp);
    if (s.imageFile) imageCount++;
  }
  return { total: content.data.snippets.length, imageCount, duplicates };
}

function blobFromImageFile(path: string | undefined, images: Map<string, Uint8Array>): Blob | undefined {
  if (!path) return undefined;
  const bytes = images.get(path);
  if (!bytes) throw new Error(`missing image: ${path}`);
  const ext = path.split('.').pop()?.toLowerCase() ?? 'png';
  return new Blob([bytes as unknown as BlobPart], { type: mimeForExt(ext) });
}

function toSnippet(
  s: ExportSnippet,
  images: Map<string, Uint8Array>,
  idMap: Map<string, string>,
): Snippet {
  const tags = (s.tags ?? []).map((id) => idMap.get(id) ?? id);
  return {
    id: s.id,
    kind: s.kind,
    text: s.text,
    image: blobFromImageFile(s.imageFile, images),
    url: s.url ?? '',
    title: s.title ?? '',
    comment: s.comment,
    tags,
    starred: !!s.starred,
    timestamp: s.timestamp ?? Date.now(),
  };
}

/** Prepare the tag id map for merging (tags matched by name). */
async function prepareTagIdMap(data: ExportFile, mode: 'overwrite' | 'merge'): Promise<Map<string, string>> {
  const idMap = new Map<string, string>();
  if (mode === 'overwrite') {
    await db.tags.clear();
    for (const tag of data.tags) {
      await db.tags.add({ id: tag.id, name: tag.name, createdAt: tag.createdAt ?? Date.now() });
      idMap.set(tag.id, tag.id);
    }
    return idMap;
  }
  const existingTags = await db.tags.toArray();
  const byName = new Map(existingTags.map((tag) => [tag.name, tag.id]));
  for (const tag of data.tags) {
    const existingId = byName.get(tag.name);
    if (existingId) {
      idMap.set(tag.id, existingId);
    } else {
      const newId = uuid();
      idMap.set(tag.id, newId);
      await db.tags.add({ id: newId, name: tag.name, createdAt: Date.now() });
    }
  }
  return idMap;
}

/**
 * Import a backup with per-item error tolerance. Duplicate detection uses
 * content fingerprints (and ids); failed items are counted, not fatal.
 */
export async function importBackup(
  content: BackupContent,
  mode: 'overwrite' | 'merge',
  opts: { skipDuplicates?: boolean; onProgress?: ProgressFn } = {},
): Promise<ImportResult> {
  const snippets = content.data.snippets;
  const result: ImportResult = { imported: 0, skipped: 0, failed: 0 };

  if (mode === 'overwrite') {
    await db.snippets.clear();
  }
  const idMap = await prepareTagIdMap(content.data, mode);

  const existingIds = new Set<string>();
  const existingFps = new Set<string>();
  if (mode === 'merge') {
    const all = await db.snippets.toArray();
    for (const s of all) {
      existingIds.add(s.id);
      existingFps.add(fingerprintOf(s));
    }
  }
  const seenFps = new Set<string>();
  const total = snippets.length;

  for (let i = 0; i < total; i++) {
    const s = snippets[i]!;
    try {
      const fp = fingerprintOfExport(s);
      if (mode === 'merge') {
        if (existingIds.has(s.id) || (opts.skipDuplicates && (existingFps.has(fp) || seenFps.has(fp)))) {
          result.skipped++;
          continue;
        }
        seenFps.add(fp);
      }
      const snip = toSnippet(s, content.images, idMap);
      await db.snippets.add(snip);
      existingIds.add(snip.id);
      result.imported++;
    } catch {
      result.failed++;
    }
    opts.onProgress?.(i + 1, total);
    // Yield to the event loop periodically so progress UI can repaint.
    if (i % 20 === 19) await new Promise((resolve) => setTimeout(resolve, 0));
  }
  await bumpVersion();
  return result;
}

/** Build and download a Markdown export zip (notes.md + images/). */
export async function downloadMarkdownExport(
  filter: ListFilter = {},
  opts: { noImages?: boolean; onProgress?: ProgressFn } = {},
): Promise<void> {
  const data = await buildMarkdownExport(filter, opts);
  const blob = markdownExportZip(data);
  const url = URL.createObjectURL(blob);
  try {
    await browser.downloads.download({
      url,
      filename: `noteclip-export-${new Date().toISOString().slice(0, 10)}.zip`,
      saveAs: true,
    });
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }
}
