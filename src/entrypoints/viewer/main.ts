import { browser } from 'wxt/browser';
import { db } from '@/db';

async function main(): Promise<void> {
  const id = new URLSearchParams(location.search).get('id');
  const img = document.getElementById('img') as HTMLImageElement;
  const empty = document.getElementById('empty') as HTMLParagraphElement;
  document.title = browser.i18n.getMessage('viewerTitle') || document.title;
  if (!id) {
    empty.hidden = false;
    return;
  }
  const snip = await db.snippets.get(id);
  if (!snip?.image) {
    empty.textContent = browser.i18n.getMessage('viewerEmpty') || empty.textContent;
    empty.hidden = false;
    return;
  }
  img.src = URL.createObjectURL(snip.image);
  if (snip.title) document.title = `${document.title} · ${snip.title}`;
  img.hidden = false;
}

void main().catch((err) => {
  console.error('[NoteClip viewer]', err);
  const empty = document.getElementById('empty') as HTMLParagraphElement | null;
  if (empty) {
    empty.textContent = browser.i18n.getMessage('viewerEmpty') || empty.textContent;
    empty.hidden = false;
  }
});
