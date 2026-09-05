import { describe, it, expect, beforeEach } from 'vitest';
import { db, addSnippet, createTag, setComment } from '@/db';
import { buildHtmlExport } from '@/db/htmlExport';

beforeEach(async () => {
  await db.delete();
  await db.open();
});

describe('html export', () => {
  it('embeds images as data urls and renders text clips with links and tags', async () => {
    const tag = await createTag('news');
    await addSnippet({ kind: 'text', text: 'line one', url: 'https://a.com/x', title: 'Essay', tags: [tag!.id] });
    const img = await addSnippet({
      kind: 'image',
      image: new Blob([new Uint8Array([137, 80])], { type: 'image/png' }),
      url: 'https://a.com/img',
      title: 'Photo',
    });
    await setComment(img.id, 'look');

    const html = await buildHtmlExport();

    expect(html).toContain('<!doctype html>');
    expect(html).toContain('data:image/png;base64');
    expect(html).toContain('line one');
    expect(html).toContain('#news');
    expect(html).toContain('look');
    // Text clips deep-link to the highlighted source position.
    expect(html).toContain('https://a.com/x#:~:text=line%20one');
  });

  it('honors filters and lightweight mode', async () => {
    await addSnippet({ kind: 'text', text: 'keep', url: 'u', title: 'k' });
    await addSnippet({ kind: 'image', image: new Blob([new Uint8Array([1])], { type: 'image/png' }), url: 'u', title: 'p' });
    await addSnippet({ kind: 'text', text: 'skip', url: 'u', title: 's' });

    const filtered = await buildHtmlExport({ query: 'keep' });
    expect(filtered).toContain('keep');
    expect(filtered).not.toContain('skip');

    const light = await buildHtmlExport({}, { noImages: true });
    expect(light).not.toContain('data:image');
    expect(light).not.toContain('<h2>p</h2>');
  });
});
