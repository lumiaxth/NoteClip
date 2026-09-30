import { browser } from 'wxt/browser';
import { db, deleteSnippetImage, snippetImages } from '@/db';

async function main(): Promise<void> {
  const id = new URLSearchParams(location.search).get('id');
  const holder = document.getElementById('viewer') as HTMLElement;
  const empty = document.getElementById('empty') as HTMLParagraphElement;
  const pager = document.getElementById('pager') as HTMLElement;
  const pagerPrev = document.getElementById('pager-prev') as HTMLButtonElement;
  const pagerNext = document.getElementById('pager-next') as HTMLButtonElement;
  const pagerCount = document.getElementById('pager-count') as HTMLElement;
  const pagerDelete = document.getElementById('pager-delete') as HTMLButtonElement;
  document.title = browser.i18n.getMessage('viewerTitle') || document.title;
  if (!id) {
    empty.hidden = false;
    return;
  }
  const snip = await db.snippets.get(id);
  if (!snip) {
    empty.textContent = browser.i18n.getMessage('viewerEmpty') || empty.textContent;
    empty.hidden = false;
    return;
  }
  const urls = snippetImages(snip)
    .map((blob) => URL.createObjectURL(blob))
    .filter((u): u is string => !!u);
  if (!urls.length) {
    empty.textContent = browser.i18n.getMessage('viewerEmpty') || empty.textContent;
    empty.hidden = false;
    return;
  }
  if (snip.title) document.title = `${document.title} · ${snip.title}`;
  holder.hidden = false;

  // One wrapper per picture; paging only toggles which wrapper is shown.
  // Blobs that fail to decode (e.g. live-photo video frames saved by older
  // versions) show a placeholder instead of a black screen.
  const frames = urls.map((url) => {
    const wrap = document.createElement('div');
    wrap.className = 'frame';
    wrap.hidden = true;
    const img = document.createElement('img');
    img.src = url;
    img.alt = snip.title || '';
    img.addEventListener('error', () => {
      img.remove();
      const note = document.createElement('p');
      note.className = 'frame-note';
      note.textContent =
        browser.i18n.getMessage('frameBroken') || '此张为实况视频帧，无法预览';
      wrap.appendChild(note);
    });
    wrap.appendChild(img);
    holder.appendChild(wrap);
    return wrap;
  });

  if (urls.length === 1) {
    frames[0]!.hidden = false;
    return; // no pager for single-image clips
  }

  let index = 0;
  const show = (k: number) => {
    index = Math.max(0, Math.min(k, urls.length - 1));
    for (let i = 0; i < frames.length; i++) frames[i]!.hidden = i !== index;
    pagerCount.textContent = `${index + 1}/${urls.length}`;
    pagerPrev.disabled = index === 0;
    pagerNext.disabled = index === urls.length - 1;
  };

  pager.hidden = false;
  pagerPrev.addEventListener('click', (e) => {
    e.preventDefault();
    show(index - 1);
  });
  pagerNext.addEventListener('click', (e) => {
    e.preventDefault();
    show(index + 1);
  });
  // Click the image's left/right half to page (right-click is unaffected).
  holder.addEventListener('click', (e) => {
    const imgLike = e.target as HTMLElement;
    if (!imgLike.closest('.frame')) return;
    if (e.clientX < window.innerWidth / 2) show(index - 1);
    else show(index + 1);
  });
  // Mouse wheel pages with a simple debounce so trackpad inertia doesn't
  // fly through the album.
  let lastWheelAt = 0;
  window.addEventListener('wheel', (e) => {
    const now = performance.now();
    if (now - lastWheelAt < 300) return;
    const amount = Math.abs(e.deltaY) >= 20 ? e.deltaY : Math.abs(e.deltaX) >= 20 ? e.deltaX : 0;
    if (!amount) return;
    lastWheelAt = now;
    show(amount > 0 ? index + 1 : index - 1);
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowLeft') show(index - 1);
    if (e.key === 'ArrowRight') show(index + 1);
    if (e.key === 'Home') show(0);
    if (e.key === 'End') show(urls.length - 1);
  });

  // Text delete action: small "删除 / Delete" in the pager bar; red on
  // hover marks the destructive action.
  pagerDelete.textContent = browser.i18n.getMessage('deleteShort') || '删除';
  let pagingDisabled = false;
  const disablePaging = () => {
    if (pagingDisabled) return;
    pagingDisabled = true;
    pager.hidden = true;
  };
  pagerDelete.addEventListener('click', async (e) => {
    e.preventDefault();
    if (pagingDisabled) return;
    const msg = browser.i18n.getMessage('deleteFrameConfirm') || '确定删除这张图片吗？';
    if (!window.confirm(msg)) return;
    try {
      const ok = await deleteSnippetImage(snip.id, index);
      if (!ok) return;
      urls.splice(index, 1);
      frames[index]!.remove(); // current frame element
      frames.splice(index, 1);
      if (urls.length === 1) {
        // Degrade to single-image viewer: kill nav, show the last one.
        disablePaging();
        show(0);
        return;
      }
      // Keep browsing position within the shrunken list.
      show(Math.min(index, urls.length - 1));
    } catch (err) {
      console.error('[NoteClip viewer] delete failed', err);
    }
  });
  show(0);
}

void main().catch((err) => {
  console.error('[NoteClip viewer]', err);
  const empty = document.getElementById('empty') as HTMLParagraphElement | null;
  if (empty) {
    empty.textContent = browser.i18n.getMessage('viewerEmpty') || empty.textContent;
    empty.hidden = false;
  }
});
