import { describe, it, expect, beforeEach } from 'vitest';
import {
  db,
  addSnippet,
  deleteSnippet,
  setComment,
  toggleStar,
  createTag,
  deleteTag,
  renameTag,
  listSnippets,
  setSnippetTags,
} from '@/db';
import { exportData, importData, blobToDataUrl, dataUrlToBlob } from '@/db/io';

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

describe('import/export', () => {
  it('round-trips blobs through data URLs', async () => {
    const blob = new Blob(['hello'], { type: 'text/plain' });
    const url = await blobToDataUrl(blob);
    expect(url.startsWith('data:text/plain;base64,')).toBe(true);
    const back = dataUrlToBlob(url);
    expect(await back.text()).toBe('hello');
  });

  it('export + overwrite import restores identical data', async () => {
    const tag = await createTag('read');
    const s = await addSnippet({ kind: 'text', text: 'quote', url: 'https://e.com', title: 'Essay', tags: [tag!.id] });
    await setComment(s.id, 'nice');
    await toggleStar(s.id);

    const file = await exportData();
    await db.snippets.clear();
    await db.tags.clear();
    await importData(file, 'overwrite');

    const items = await listSnippets();
    expect(items).toHaveLength(1);
    const first = items[0]!;
    expect(first.text).toBe('quote');
    expect(first.comment).toBe('nice');
    expect(first.starred).toBe(true);
    expect(first.tags).toEqual([tag!.id]);
    expect(await db.tags.toArray()).toHaveLength(1);
  });

  it('export/import keeps image blobs', async () => {
    const blob = new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' });
    await addSnippet({ kind: 'image', image: blob, url: 'u', title: 't' });
    const file = await exportData();
    await db.snippets.clear();
    await importData(file, 'overwrite');
    const items = await listSnippets();
    expect(items).toHaveLength(1);
    const first = items[0]!;
    expect(first.image).toBeInstanceOf(Blob);
    expect(new Uint8Array(await first.image!.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]));
  });

  it('merge import appends new ids and dedupes tags by name', async () => {
    const tag = await createTag('shared');
    await addSnippet({ kind: 'text', text: 'existing', url: 'u', title: 't' });

    const file = await exportData();
    file.tags.push({ id: 'old-tag-id', name: 'shared', createdAt: 0 });
    file.tags.push({ id: 'old-tag-id-2', name: 'new', createdAt: 0 });
    file.snippets.push({
      id: 'old-snippet-id',
      kind: 'text',
      text: 'imported',
      url: 'v',
      title: 't2',
      tags: ['old-tag-id'],
      starred: false,
      timestamp: 1,
    });

    await importData(file, 'merge');

    const tags = await db.tags.toArray();
    const names = tags.map((t) => t.name).sort();
    expect(names).toEqual(['new', 'shared']);

    const items = await listSnippets();
    expect(items).toHaveLength(2);
    const imported = items.find((s) => s.text === 'imported')!;
    expect(imported.id).not.toBe('old-snippet-id');
    const linked = tags.find((t) => t.id === imported.tags[0])!;
    expect(linked.name).toBe('shared');
  });
});
