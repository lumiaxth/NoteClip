import { strToU8, zipSync } from 'fflate';
import type { Snippet, Tag } from '@/types';
import { db, listSnippets, type ListFilter } from '@/db';
import { uuid } from '@/utils/id';

const EXT_BY_MIME: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/bmp': 'bmp',
  'image/avif': 'avif',
  'image/svg+xml': 'svg',
};

function extFor(blob: Blob): string {
  return EXT_BY_MIME[blob.type.toLowerCase()] ?? 'png';
}

function pad(n: number, width: number): string {
  return String(n).padStart(width, '0');
}

function fileStamp(ts: number): string {
  const d = new Date(ts);
  return (
    `${d.getFullYear()}${pad(d.getMonth() + 1, 2)}${pad(d.getDate(), 2)}` +
    `-${pad(d.getHours(), 2)}${pad(d.getMinutes(), 2)}${pad(d.getSeconds(), 2)}`
  );
}

function escCell(s: string): string {
  return s.replace(/\r?\n/g, ' ').trim();
}

function fmtTime(ts: number): string {
  return new Date(ts).toLocaleString();
}

export interface MarkdownExport {
  md: string;
  /** zip-ready file entries: path → bytes */
  files: Record<string, Uint8Array>;
}

/** Build a Markdown document plus an images/ folder for a zip export. */
export async function buildMarkdownExport(filter: ListFilter = {}): Promise<MarkdownExport> {
  const snippets = await listSnippets(filter);
  const tagMap = new Map((await db.tags.toArray()).map((tag) => [tag.id, tag.name]));
  const items = [...snippets].sort((a, b) => a.timestamp - b.timestamp);

  const imageFiles: Record<string, Uint8Array> = {};
  const usedNames = new Set<string>();
  const parts: string[] = [
    '# 摘记本 NoteClip',
    '',
    `> 导出时间：${fmtTime(Date.now())}，共 ${items.length} 条摘记`,
    '',
  ];

  for (const s of items) {
    parts.push('---', '', `## ${s.title || '未命名'}`, '');
    const meta: string[] = [fmtTime(s.timestamp)];
    if (s.url) meta.push(`[来源](${s.url})`);
    const tagNames = s.tags.map((id) => tagMap.get(id)).filter(Boolean) as string[];
    if (tagNames.length) meta.push(tagNames.map((n) => `\`#${escCell(n)}\``).join(' '));
    if (s.starred) meta.push('★');
    parts.push(`- ${meta.join(' · ')}`, '');
    if (s.comment?.trim()) {
      parts.push(`> ${s.comment.replace(/\r?\n/g, '\n> ')}`, '');
    }

    if (s.kind === 'image' && s.image) {
      const stamp = fileStamp(s.timestamp);
      let name = `${stamp}-${s.id.slice(0, 6)}.${extFor(s.image)}`;
      while (usedNames.has(name)) name = `${stamp}-${uuid().slice(0, 6)}.${extFor(s.image)}`;
      usedNames.add(name);
      imageFiles[`images/${name}`] = new Uint8Array(await s.image.arrayBuffer());
      parts.push(`![${escCell(s.title || 'image')}](images/${name})`, '');
      if (s.text?.trim()) parts.push(s.text, '');
    } else if (s.text?.trim()) {
      parts.push(s.text, '');
    }
  }

  return { md: parts.join('\n'), files: imageFiles };
}

/** Assemble the export into a zip Blob (notes.md at the root + images/ folder). */
export function markdownExportZip(exportData: MarkdownExport): Blob {
  const files: Record<string, Uint8Array> = {
    'notes.md': strToU8(exportData.md),
  };
  for (const [path, bytes] of Object.entries(exportData.files)) {
    files[path] = bytes;
  }
  const zipped = zipSync(files);
  return new Blob([zipped as unknown as BlobPart], { type: 'application/zip' });
}
