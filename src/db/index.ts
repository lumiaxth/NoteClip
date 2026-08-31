import Dexie, { type Table } from 'dexie';
import { browser } from 'wxt/browser';
import type { PendingCapture, Snippet, Tag } from '@/types';
import { uuid } from '@/utils/id';

class NoteClipDB extends Dexie {
  snippets!: Table<Snippet, string>;
  tags!: Table<Tag, string>;
  pendingCaptures!: Table<PendingCapture, string>;

  constructor() {
    super('noteclip');
    this.version(1).stores({
      snippets: 'id, timestamp, starred, kind, *tags, url',
      tags: 'id, name',
      pendingCaptures: 'id, timestamp',
    });
  }
}

export const db = new NoteClipDB();

const UPDATED_KEY = 'noteclip:updated';

/** Notify all open panels to refresh after any data mutation. */
export async function bumpVersion(): Promise<void> {
  await browser.storage.local.set({ [UPDATED_KEY]: Date.now() });
}

export interface NewSnippet {
  kind: 'text' | 'image';
  text?: string;
  image?: Blob;
  url: string;
  title: string;
  tags?: string[];
}

export async function addSnippet(data: NewSnippet): Promise<Snippet> {
  const snip: Snippet = {
    id: uuid(),
    kind: data.kind,
    text: data.text,
    image: data.image,
    url: data.url,
    title: data.title,
    comment: '',
    tags: data.tags ?? [],
    starred: false,
    timestamp: Date.now(),
  };
  await db.snippets.add(snip);
  await bumpVersion();
  return snip;
}

export async function deleteSnippet(id: string): Promise<void> {
  await db.snippets.delete(id);
  await bumpVersion();
}

export async function setComment(id: string, comment: string): Promise<void> {
  await db.snippets.update(id, { comment });
  await bumpVersion();
}

export async function toggleStar(id: string): Promise<void> {
  const s = await db.snippets.get(id);
  if (!s) return;
  await db.snippets.update(id, { starred: !s.starred });
  await bumpVersion();
}

export async function setSnippetTags(id: string, tags: string[]): Promise<void> {
  await db.snippets.update(id, { tags });
  await bumpVersion();
}

export async function createTag(name: string): Promise<Tag | null> {
  const n = name.trim();
  if (!n) return null;
  const existing = await db.tags.where('name').equals(n).first();
  if (existing) return existing;
  const tag: Tag = { id: uuid(), name: n, createdAt: Date.now() };
  await db.tags.add(tag);
  await bumpVersion();
  return tag;
}

export async function deleteTag(id: string): Promise<void> {
  await db.transaction('rw', db.tags, db.snippets, async () => {
    await db.tags.delete(id);
    const snips = await db.snippets.toArray();
    for (const s of snips) {
      if (s.tags.includes(id)) {
        await db.snippets.update(s.id, { tags: s.tags.filter((x) => x !== id) });
      }
    }
  });
  await bumpVersion();
}

export async function renameTag(id: string, name: string): Promise<Tag | null> {
  const n = name.trim();
  if (!n) return null;
  const existing = await db.tags.where('name').equals(n).first();
  if (existing && existing.id !== id) return null;
  await db.tags.update(id, { name: n });
  await bumpVersion();
  return (await db.tags.get(id)) ?? null;
}

export interface ListFilter {
  query?: string;
  starredOnly?: boolean;
  tagId?: string;
}

export async function listSnippets(filter: ListFilter = {}): Promise<Snippet[]> {
  let items = await db.snippets.toArray();
  if (filter.starredOnly) items = items.filter((s) => s.starred);
  if (filter.tagId) items = items.filter((s) => s.tags.includes(filter.tagId!));
  const q = (filter.query ?? '').trim().toLowerCase();
  if (q) {
    items = items.filter(
      (s) =>
        (s.text ?? '').toLowerCase().includes(q) ||
        (s.title ?? '').toLowerCase().includes(q) ||
        (s.comment ?? '').toLowerCase().includes(q),
    );
  }
  items.sort((a, b) => b.timestamp - a.timestamp);
  return items;
}
