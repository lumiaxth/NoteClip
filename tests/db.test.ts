import { describe, it, expect, beforeEach } from 'vitest';
import {
  db,
  addSnippet,
  deleteSnippet,
  deleteSnippetImage,
  deleteSnippets,
  addTagToSnippets,
  setComment,
  toggleStar,
  createTag,
  deleteTag,
  renameTag,
  listSnippets,
  setSnippetTags,
  snippetImages,
  logError,
  listErrors,
  clearErrors,
} from '@/db';
import {
  buildBackup,
  readBackupZip,
  importBackup,
  previewImport,
  dataUrlToBlob,
  type BackupContent,
} from '@/db/io';
import { buildMarkdownExport, markdownExportZip } from '@/db/markdown';
import type { ExportFile } from '@/types';
import { unzipSync, zipSync, strFromU8, strToU8 } from 'fflate';

/** Unpack a built backup blob into a BackupContent (small test data, sync ok). */
async function zipToContent(blob: Blob): Promise<BackupContent> {
  const unzipped = unzipSync(new Uint8Array(await blob.arrayBuffer()));
  const data = JSON.parse(strFromU8(unzipped['data.json']!)) as ExportFile;
  const images = new Map<string, Uint8Array>();
  for (const [path, bytes] of Object.entries(unzipped)) {
    if (path !== 'data.json' && path.startsWith('images/')) images.set(path, bytes);
  }
  return { data, images };
}

beforeEach(async () => {
  await db.delete();
  await db.open();
});

describe('snippets CRUD', () => {
  it('adds and lists snippets newest first', async () => {
    const a = await addSnippet({ kind: 'text', text: 'first', url: 'https://a.com', title: 'A' });
    const b = await addSnippet({ kind: 'text', text: 'second', url: 'https://b.com', title: 'B' });
    const items = await listSnippets();
    expect(items.map((s) => s.id)).toEqual([b.id, a.id]);
  });

  it('searches text, title and comment case-insensitively', async () => {
    await addSnippet({ kind: 'text', text: 'JavaScript tips', url: 'https://a.com', title: 'Article One' });
    await addSnippet({ kind: 'text', text: 'cooking', url: 'https://b.com', title: 'Recipe' });
    const byText = await listSnippets({ query: 'JAVASCRIPT' });
    expect(byText).toHaveLength(1);
    expect(byText[0]!.title).toBe('Article One');

    await setComment(byText[0]!.id, 'very useful');
    const byComment = await listSnippets({ query: 'Useful' });
    expect(byComment).toHaveLength(1);
  });

  it('filters by star and tag', async () => {
    const tag = await createTag('work');
    const s = await addSnippet({ kind: 'text', text: 'x', url: 'https://a.com', title: 'T', tags: [tag!.id] });
    await toggleStar(s.id);
    await setSnippetTags(s.id, [tag!.id]);

    expect(await listSnippets({ starredOnly: true })).toHaveLength(1);
    expect(await listSnippets({ tagId: tag!.id })).toHaveLength(1);
    expect(await listSnippets({ starredOnly: true, tagId: tag!.id })).toHaveLength(1);
    expect(await listSnippets({ starredOnly: false })).toHaveLength(1);
  });

  it('deletes a snippet', async () => {
    const s = await addSnippet({ kind: 'text', text: 'bye', url: 'u', title: 't' });
    await deleteSnippet(s.id);
    expect(await listSnippets()).toHaveLength(0);
  });

  it('deleting a tag removes it from snippets', async () => {
    const tag = await createTag('tmp');
    const s = await addSnippet({ kind: 'text', text: 'x', url: 'u', title: 't', tags: [tag!.id] });
    await deleteTag(tag!.id);
    const items = await listSnippets();
    expect(items).toHaveLength(1);
    const snip = items[0]!;
    expect(snip.id).toBe(s.id);
    expect(snip.tags).toEqual([]);
  });

  it('createTag dedupes by name', async () => {
    const a = await createTag('  Note  ');
    const b = await createTag('Note');
    expect(a?.id).toBe(b?.id);
  });

  it('renames a tag', async () => {
    const tag = await createTag('old');
    await renameTag(tag!.id, 'new name');
    expect((await db.tags.get(tag!.id))?.name).toBe('new name');
  });

  it('renameTag refuses a duplicate name', async () => {
    await createTag('a');
    const b = await createTag('b');
    const res = await renameTag(b!.id, 'a');
    expect(res).toBeNull();
    expect((await db.tags.get(b!.id))?.name).toBe('b');
  });
});

describe('zip backup export/import', () => {
  it('builds a version-2 zip with data.json and an images folder', async () => {
    const tag = await createTag('news');
    await addSnippet({ kind: 'text', text: 'alpha', url: 'https://a.com', title: 'A', tags: [tag!.id] });
    await addSnippet({ kind: 'image', image: new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' }), url: 'https://b.com', title: 'B' });

    const { blob } = await buildBackup();
    const content = await zipToContent(blob);

    expect(content.data.version).toBe(2);
    expect(content.data.snippets).toHaveLength(2);
    const imageSnip = content.data.snippets.find((s) => s.kind === 'image')!;
    expect(imageSnip.imageFile).toMatch(/^images\/.+\.png$/);
    expect(imageSnip.imageBytes).toBe(3);
    expect(content.images.get(imageSnip.imageFile!)).toEqual(new Uint8Array([1, 2, 3]));
    expect(content.data.tags.map((t) => t.name)).toEqual(['news']);
  });

  it('lightweight backup excludes image clips', async () => {
    await addSnippet({ kind: 'text', text: 't', url: 'u', title: 't' });
    await addSnippet({ kind: 'image', image: new Blob([new Uint8Array([1])], { type: 'image/png' }), url: 'u', title: 'p' });

    const { blob } = await buildBackup({}, { noImages: true });
    const content = await zipToContent(blob);
    expect(content.data.snippets).toHaveLength(1);
    expect(content.data.snippets[0]!.kind).toBe('text');
    expect(content.images.size).toBe(0);
  });

  it('round-trips through zip with overwrite import', async () => {
    const tag = await createTag('read');
    const s = await addSnippet({ kind: 'text', text: 'quote', url: 'https://e.com', title: 'Essay', tags: [tag!.id] });
    await setComment(s.id, 'nice');
    await toggleStar(s.id);
    await addSnippet({ kind: 'image', image: new Blob([new Uint8Array([9, 9])], { type: 'image/png' }), url: 'https://e.com/img', title: 'Pic' });

    const { blob } = await buildBackup();
    const content = await zipToContent(blob);
    await db.snippets.clear();
    await db.tags.clear();
    const result = await importBackup(content, 'overwrite');
    expect(result.imported).toBe(2);
    expect(result.failed).toBe(0);

    const items = await listSnippets();
    expect(items).toHaveLength(2);
    const text = items.find((x) => x.text === 'quote')!;
    expect(text.comment).toBe('nice');
    expect(text.starred).toBe(true);
    expect(text.tags).toHaveLength(1);
    const img = items.find((x) => x.kind === 'image')!;
    expect(new Uint8Array(await img.image!.arrayBuffer())).toEqual(new Uint8Array([9, 9]));
    expect(await db.tags.toArray()).toHaveLength(1);
  });

  it('merge import keeps source ids and dedupes tags by name', async () => {
    const tag = await createTag('shared');
    await addSnippet({ kind: 'text', text: 'existing', url: 'u', title: 't' });

    const content: BackupContent = {
      data: {
        app: 'NoteClip',
        version: 2,
        exportedAt: Date.now(),
        snippets: [
          { id: 'old-snippet-id', kind: 'text', text: 'imported', url: 'v', title: 't2', tags: ['old-tag-id'], starred: false, timestamp: 1 },
        ],
        tags: [
          { id: 'old-tag-id', name: 'shared', createdAt: 0 },
          { id: 'old-tag-id-2', name: 'new', createdAt: 0 },
        ],
      },
      images: new Map(),
    };
    const result = await importBackup(content, 'merge');
    expect(result.imported).toBe(1);

    const tags = await db.tags.toArray();
    const names = tags.map((t) => t.name).sort();
    expect(names).toEqual(['new', 'shared']);

    const items = await listSnippets();
    expect(items).toHaveLength(2);
    const imported = items.find((s) => s.text === 'imported')!;
    expect(imported.id).toBe('old-snippet-id');
    const linked = tags.find((t) => t.id === imported.tags[0])!;
    expect(linked.name).toBe('shared');
  });

  it('multi-image clips round-trip as imageFiles[]', async () => {
    const blobs = [
      new Blob([new Uint8Array([1, 1])], { type: 'image/png' }),
      new Blob([new Uint8Array([2, 2])], { type: 'image/jpeg' }),
      new Blob([new Uint8Array([3, 3])], { type: 'image/webp' }),
    ];
    await addSnippet({ kind: 'image', images: blobs, url: 'https://a.com/album', title: 'Album' });

    const { blob } = await buildBackup();
    const content = await zipToContent(blob);
    const album = content.data.snippets[0]!;
    expect(album.imageFiles).toHaveLength(3);
    expect(album.imageFile).toBeUndefined();

    await db.snippets.clear();
    const result = await importBackup(content, 'overwrite');
    expect(result.imported).toBe(1);
    const restored = (await listSnippets())[0]!;
    expect(restored.images).toHaveLength(3);
    expect(restored.image).toBeUndefined();
    expect(await snippetImages(restored)[0]!.text()).toBe('\u0001\u0001');
    expect(await snippetImages(restored)[2]!.text()).toBe('\u0003\u0003');
  });

  it('legacy single-imageFile backups import as single-image clips', async () => {
    const content: BackupContent = {
      data: {
        app: 'NoteClip',
        version: 2,
        exportedAt: 0,
        snippets: [
          {
            id: 'legacy-img',
            kind: 'image',
            imageFile: 'images/legacy.png',
            imageBytes: 2,
            url: 'u',
            title: 'legacy',
            tags: [],
            starred: false,
            timestamp: 1,
          },
        ],
        tags: [],
      },
      images: new Map([['images/legacy.png', new Uint8Array([7, 7])]]),
    };
    await importBackup(content, 'overwrite');
    const restored = (await listSnippets())[0]!;
    expect(restored.image).toBeInstanceOf(Blob);
    expect(restored.images).toBeUndefined();
    expect(new Uint8Array(await restored.image!.arrayBuffer())).toEqual(new Uint8Array([7, 7]));
  });

  it('multi-image markdown export writes one image per file', async () => {
    const blobs = [
      new Blob([new Uint8Array([1])], { type: 'image/png' }),
      new Blob([new Uint8Array([2])], { type: 'image/png' }),
    ];
    await addSnippet({ kind: 'image', images: blobs, url: 'u', title: 'Album' });
    const data = await buildMarkdownExport();
    const paths = Object.keys(data.files).sort();
    expect(paths).toHaveLength(2);
    expect(data.md.match(/!\[Album\]\(images\//g)).toHaveLength(2);
  });

  it('addSnippet normalizes one-image arrays into the legacy image field', async () => {
    const one = new Blob([new Uint8Array([9, 9])], { type: 'image/png' });
    const snip = await addSnippet({ kind: 'image', images: [one], url: 'u', title: 'single' });
    expect(snip.image).toBe(one);
    expect(snip.images).toBeUndefined();
    expect(snippetImages(snip)).toHaveLength(1);
  });

  it('deleteSnippetImage removes one picture and keeps the order', async () => {
    const blobs = [
      new Blob([new Uint8Array([1])], { type: 'image/png' }),
      new Blob([new Uint8Array([2])], { type: 'image/png' }),
      new Blob([new Uint8Array([3])], { type: 'image/png' }),
    ];
    const snip = await addSnippet({ kind: 'image', images: blobs, url: 'u', title: 'album' });

    expect(await deleteSnippetImage(snip.id, 1)).toBe(true);
    const updated = (await db.snippets.get(snip.id))!;
    expect(snippetImages(updated)).toHaveLength(2);
    expect(new Uint8Array(await snippetImages(updated)[0]!.arrayBuffer())).toEqual(
      new Uint8Array([1]),
    );
    expect(new Uint8Array(await snippetImages(updated)[1]!.arrayBuffer())).toEqual(
      new Uint8Array([3]),
    );

    expect(await deleteSnippetImage(snip.id, 9)).toBe(false);
  });

  it('deleteSnippetImage degrades to a single-image snippet at one picture left', async () => {
    const blobs = [
      new Blob([new Uint8Array([1])], { type: 'image/png' }),
      new Blob([new Uint8Array([2])], { type: 'image/png' }),
    ];
    const snip = await addSnippet({ kind: 'image', images: blobs, url: 'u', title: 'two' });

    expect(await deleteSnippetImage(snip.id, 0)).toBe(true);
    const updated = (await db.snippets.get(snip.id))!;
    expect(updated.images).toBeUndefined();
    expect(new Uint8Array(await updated.image!.arrayBuffer())).toEqual(new Uint8Array([2]));
  });

  it('previewImport detects duplicates by content fingerprint', async () => {
    await addSnippet({ kind: 'text', text: 'hello world', url: 'https://x.com', title: 't' });
    const content: BackupContent = {
      data: {
        app: 'NoteClip',
        version: 2,
        exportedAt: 0,
        snippets: [
          { id: 'other-device-id', kind: 'text', text: 'hello world', url: 'https://x.com', title: 't', tags: [], starred: false, timestamp: 1 },
          { id: 'new-one', kind: 'text', text: 'fresh', url: 'https://y.com', title: 't2', tags: [], starred: false, timestamp: 2 },
        ],
        tags: [],
      },
      images: new Map(),
    };
    const preview = await previewImport(content);
    expect(preview.total).toBe(2);
    expect(preview.duplicates).toBe(1);
  });

  it('importBackup skips duplicates only when requested', async () => {
    await addSnippet({ kind: 'text', text: 'hello world', url: 'https://x.com', title: 't' });
    const content: BackupContent = {
      data: {
        app: 'NoteClip',
        version: 2,
        exportedAt: 0,
        snippets: [
          { id: 'other-device-id', kind: 'text', text: 'hello world', url: 'https://x.com', title: 't', tags: [], starred: false, timestamp: 1 },
          { id: 'new-one', kind: 'text', text: 'fresh', url: 'https://y.com', title: 't2', tags: [], starred: false, timestamp: 2 },
        ],
        tags: [],
      },
      images: new Map(),
    };

    const r1 = await importBackup(content, 'merge', { skipDuplicates: true });
    expect(r1.skipped).toBe(1);
    expect(r1.imported).toBe(1);
    expect(await listSnippets()).toHaveLength(2);

    // Re-importing without skipping: the clip skipped in r1 now imports
    // (its id is not present), while 'new-one' is skipped by id.
    const r2 = await importBackup(content, 'merge');
    expect(r2.imported).toBe(1);
    expect(r2.skipped).toBe(1);
    expect(await listSnippets()).toHaveLength(3);
  });

  it('importBackup tolerates broken image entries', async () => {
    const content: BackupContent = {
      data: {
        app: 'NoteClip',
        version: 2,
        exportedAt: 0,
        snippets: [
          { id: 'bad', kind: 'image', imageFile: 'images/missing.png', url: 'u', title: 'bad', tags: [], starred: false, timestamp: 1 },
          { id: 'good', kind: 'text', text: 'ok', url: 'u2', title: 'g', tags: [], starred: false, timestamp: 2 },
        ],
        tags: [],
      },
      images: new Map(),
    };
    const result = await importBackup(content, 'overwrite');
    expect(result).toEqual({ imported: 1, skipped: 0, failed: 1 });
    const items = await listSnippets();
    expect(items).toHaveLength(1);
    expect(items[0]!.text).toBe('ok');
  });

  it('readBackupZip rejects non-version-2 data', async () => {
    const zipped = zipSync({
      'data.json': strToU8(JSON.stringify({ app: 'NoteClip', version: 1, snippets: [], tags: [] })),
    });
    const file = new File([zipped as unknown as BlobPart], 'backup.zip');
    await expect(readBackupZip(file)).rejects.toThrow();
  });

  it('dataUrlToBlob decodes base64 payloads', async () => {
    const url = 'data:text/plain;base64,' + btoa('hello');
    const back = dataUrlToBlob(url);
    expect(await back.text()).toBe('hello');
  });
});

describe('kind filter', () => {
  it('filters text-only and image snippets', async () => {
    await addSnippet({ kind: 'text', text: 'note', url: 'u', title: 't' });
    const blob = new Blob([new Uint8Array([1])], { type: 'image/png' });
    await addSnippet({ kind: 'image', image: blob, url: 'u', title: 'pic' });

    const texts = await listSnippets({ kind: 'text' });
    expect(texts).toHaveLength(1);
    expect(texts[0]!.text).toBe('note');

    const images = await listSnippets({ kind: 'image' });
    expect(images).toHaveLength(1);
    expect(images[0]!.kind).toBe('image');

    expect(await listSnippets({ kind: '' })).toHaveLength(2);
  });
});

describe('filtered export', () => {
  it('buildBackup respects filters and prunes unreferenced tags', async () => {
    const tagA = await createTag('a');
    const tagB = await createTag('b');
    await addSnippet({ kind: 'text', text: 'alpha', url: 'u', title: 't', tags: [tagA!.id] });
    await addSnippet({ kind: 'image', image: new Blob([new Uint8Array([1])], { type: 'image/png' }), url: 'u', title: 'pic', tags: [tagB!.id] });

    const full = await zipToContent((await buildBackup()).blob);
    expect(full.data.snippets).toHaveLength(2);
    expect(full.data.tags).toHaveLength(2);

    const filtered = await zipToContent((await buildBackup({ kind: 'text' })).blob);
    expect(filtered.data.snippets).toHaveLength(1);
    expect(filtered.data.snippets[0]!.text).toBe('alpha');
    expect(filtered.data.tags.map((t) => t.name)).toEqual(['a']);

    const byStar = await zipToContent((await buildBackup({ starredOnly: true })).blob);
    expect(byStar.data.snippets).toHaveLength(0);
    expect(byStar.data.tags).toHaveLength(0);
  });

  it('buildMarkdownExport honors filters', async () => {
    await addSnippet({ kind: 'text', text: 'keep me', url: 'u', title: 'k' });
    await addSnippet({ kind: 'text', text: 'skip me', url: 'u', title: 's' });
    const data = await buildMarkdownExport({ query: 'keep' });
    expect(data.md).toContain('keep me');
    expect(data.md).not.toContain('skip me');
  });
});

describe('bulk operations', () => {
  it('deleteSnippets removes many at once', async () => {
    const a = await addSnippet({ kind: 'text', text: 'a', url: 'u', title: 't' });
    const b = await addSnippet({ kind: 'text', text: 'b', url: 'u', title: 't' });
    await addSnippet({ kind: 'text', text: 'c', url: 'u', title: 't' });
    await deleteSnippets([a.id, b.id]);
    const items = await listSnippets();
    expect(items).toHaveLength(1);
    expect(items[0]!.text).toBe('c');
  });

  it('addTagToSnippets merges without losing existing tags', async () => {
    const t1 = await createTag('one');
    const t2 = await createTag('two');
    const s = await addSnippet({ kind: 'text', text: 'x', url: 'u', title: 't', tags: [t1!.id] });
    await addTagToSnippets([s.id], t2!.id);
    const snip = (await listSnippets())[0]!;
    expect([...snip.tags].sort()).toEqual([t1!.id, t2!.id].sort());
  });

  it('addTagToSnippets skips missing snippets', async () => {
    const tag = await createTag('x');
    await addTagToSnippets(['nonexistent-id'], tag!.id);
    expect(await listSnippets()).toHaveLength(0);
  });
});

describe('error log', () => {
  it('records and lists errors newest first', async () => {
    await logError('save-image', 'HTTP 403', 'https://a.com/pic.jpg');
    // Ensure distinct timestamps so newest-first ordering is deterministic.
    await new Promise((resolve) => setTimeout(resolve, 2));
    await logError('capture', 'not-web');
    const errors = await listErrors();
    expect(errors).toHaveLength(2);
    expect(errors[0]!.source).toBe('capture');
    expect(errors[1]!.url).toBe('https://a.com/pic.jpg');
  });

  it('caps the log at 100 entries', async () => {
    for (let i = 0; i < 105; i++) await logError('test', `e${i}`);
    const errors = await listErrors();
    expect(errors).toHaveLength(100);
    // Newest kept: e104 exists, e0 dropped.
    expect(errors.some((e) => e.message === 'e104')).toBe(true);
    expect(errors.some((e) => e.message === 'e0')).toBe(false);
  });

  it('clears all errors', async () => {
    await logError('test', 'x');
    await clearErrors();
    expect(await listErrors()).toHaveLength(0);
  });
});

describe('markdown export', () => {
  it('builds notes.md with image files and relative links', async () => {
    const tag = await createTag('news');
    await addSnippet({ kind: 'text', text: 'line one\nline two', url: 'https://e.com/a', title: 'Essay', tags: [tag!.id] });
    const blob = new Blob([new Uint8Array([137, 80])], { type: 'image/png' });
    await addSnippet({ kind: 'image', image: blob, url: 'https://e.com/b', title: 'Photo' });
    await setComment((await listSnippets({ kind: 'image' }))[0]!.id, 'look');

    const data = await buildMarkdownExport();
    expect(data.md).toContain('# 摘记本 NoteClip');
    expect(data.md).toContain('## Essay');
    expect(data.md).toContain('[来源](https://e.com/a)');
    expect(data.md).toContain('`#news`');
    expect(data.md).toContain('line one\nline two');
    expect(data.md).toMatch(/!\[Photo\]\(images\/[\w-]+\.png\)/);
    expect(data.md).toContain('> look');
    expect(Object.keys(data.files)).toHaveLength(1);

    const zip = markdownExportZip(data);
    const bytes = new Uint8Array(await zip.arrayBuffer());
    const entries = unzipSync(bytes);
    expect(Object.keys(entries)).toContain('notes.md');
    const md = strFromU8(entries['notes.md']!);
    expect(md).toBe(data.md);
    const imagePath = Object.keys(entries).find((p) => p.startsWith('images/'))!;
    expect(entries[imagePath]!.length).toBe(2);
  });
});
