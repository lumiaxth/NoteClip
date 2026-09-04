import { browser } from 'wxt/browser';
import {
  listSnippets,
  deleteSnippet,
  deleteSnippets,
  addTagToSnippets,
  setComment,
  toggleStar,
  setSnippetTags,
  createTag,
  deleteTag,
  db,
} from '@/db';
import { downloadExport, downloadMarkdownExport, readExportFile, importData } from '@/db/io';
import type { Snippet, Tag } from '@/types';
import { t, relTime, fullTime } from '@/utils/i18n';
import { domainOf, esc, escHighlighted, textFragmentUrl } from '@/utils/format';

interface ViewState {
  query: string;
  starredOnly: boolean;
  tagId: string;
  kind: '' | 'text' | 'image';
}

const state: ViewState = { query: '', starredOnly: false, tagId: '', kind: '' };

/** Batch selection mode (multi-select delete/tag). */
const batch: { active: boolean; selected: Set<string> } = { active: false, selected: new Set<string>() };

const PAGE_SIZE = 30;

const objUrls = new Map<string, string>();
let toastTimer: number | undefined;
let tagMap = new Map<string, Tag>();
/** Known snippet ids for add-detection toasts; null until the first load. */
let knownIds: Set<string> | null = null;
/** Card currently showing the inline delete confirmation. */
let armedCard: HTMLElement | null = null;
/** Latest filtered result set + rendered-page cursor (scroll loading). */
let allItems: Snippet[] = [];
let page = 0;
let lastFilterCount = 0;

/** Short human-readable label: first few characters of the content. */
function snippetLabel(s: Snippet): string {
  const raw = s.kind === 'image' ? s.title || t('imageKind') : s.text ?? '';
  const oneLine = raw.replace(/\s+/g, ' ').trim();
  if (!oneLine) return t('imageKind');
  return oneLine.length > 10 ? oneLine.slice(0, 10) + '…' : oneLine;
}

/** Replace a card's delete button with inline confirm/cancel buttons. */
function armCardDelete(card: HTMLElement, id: string): void {
  const del = card.querySelector<HTMLButtonElement>('[data-action="delete"]');
  if (!del || card.querySelector('.nc-confirm-del')) return;
  const wrap = document.createElement('span');
  wrap.className = 'nc-confirm-del';
  const ok = document.createElement('button');
  ok.className = 'nc-action nc-action-danger';
  ok.dataset.action = 'delete-confirm';
  ok.dataset.id = id;
  ok.textContent = t('confirmDelete');
  const no = document.createElement('button');
  no.className = 'nc-action';
  no.dataset.action = 'delete-cancel';
  no.dataset.id = id;
  no.textContent = t('cancel');
  wrap.append(ok, no);
  del.replaceWith(wrap);
}

/** Restore the original delete button after a cancelled confirmation. */
function disarmCardDelete(card: HTMLElement): void {
  const wrap = card.querySelector('.nc-confirm-del');
  if (!wrap) return;
  const btn = document.createElement('button');
  btn.className = 'nc-action nc-action-delete';
  btn.dataset.action = 'delete';
  btn.dataset.id = card.dataset.id ?? '';
  btn.title = t('delete');
  btn.textContent = t('delete');
  wrap.replaceWith(btn);
}

function objUrl(id: string, blob: Blob | undefined): string | undefined {
  if (!blob) return undefined;
  let u = objUrls.get(id);
  if (!u) {
    u = URL.createObjectURL(blob);
    objUrls.set(id, u);
  }
  return u;
}

function revokeUrl(id: string): void {
  const u = objUrls.get(id);
  if (u) {
    URL.revokeObjectURL(u);
    objUrls.delete(id);
  }
}

function clearUrls(): void {
  objUrls.forEach((u) => URL.revokeObjectURL(u));
  objUrls.clear();
}

function toast(msg: string): void {
  let el = document.getElementById('nc-toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'nc-toast';
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.classList.add('show');
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => el?.classList.remove('show'), 2000);
}

function cardHtml(s: Snippet): string {
  const url = objUrl(s.id, s.image);
  const body =
    s.kind === 'image'
      ? `<div class="nc-img">${url ? `<img src="${url}" loading="lazy" alt="${t('imageKind')}" />` : ''}</div>${
          s.text ? `<div class="nc-text nc-text-clip">${escHighlighted(s.text, state.query)}</div>` : ''
        }`
      : `<div class="nc-text nc-text-clamped" title="${esc(s.text ?? '')}">${escHighlighted(s.text ?? '', state.query)}</div>
        <button class="nc-expand-btn" data-action="expand" data-id="${s.id}" hidden>${t('expandMore')}</button>`;

  const tags = s.tags
    .map((tid) => {
      const tag = tagMap.get(tid);
      return tag
        ? `<span class="nc-chip-tag">#${esc(tag.name)}<button class="nc-tag-x" data-action="tag-remove" data-id="${s.id}" data-tag="${tid}" title="${t('deleteTag')}">×</button></span>`
        : '';
    })
    .join('');

  const selected = batch.selected.has(s.id);
  const selectBox = batch.active
    ? `<span class="nc-select-box ${selected ? 'checked' : ''}" aria-hidden="true"></span>`
    : '';
  // Text clips deep-link to the highlighted position on the source page.
  const sourceHref = textFragmentUrl(s.url, s.text);

  return `
    <article class="nc-card ${selected ? 'selected' : ''}" data-id="${s.id}">
      <div class="nc-card-head">
        ${selectBox}
        <span class="nc-time" title="${esc(fullTime(s.timestamp))}">${esc(relTime(s.timestamp))}</span>
        <span class="nc-badges">${s.kind === 'image' ? `<span class="nc-badge">${t('imageKind')}</span>` : ''}</span>
      </div>
      ${body}
      <div class="nc-meta">
        ${
          s.url
            ? `<a class="nc-title" href="${esc(sourceHref)}" target="_blank" rel="noopener noreferrer" title="${esc(s.title || s.url)}">${escHighlighted(s.title || domainOf(s.url), state.query)}</a>`
            : `<span class="nc-title">${esc(s.title || '-')}</span>`
        }
        <span class="nc-domain">${esc(domainOf(s.url))}</span>
      </div>
      <div class="nc-comment-wrap">
        <textarea class="nc-comment" data-action="comment" data-id="${s.id}" rows="1" placeholder="${t('commentPlaceholder')}">${esc(s.comment ?? '')}</textarea>
      </div>
      <div class="nc-tags">
        ${tags}
        <span class="nc-chip-tag nc-tag-add">
          <button data-action="tag-add" data-id="${s.id}" title="${t('tagAdd')}">＋</button>
          <input class="nc-tag-input" list="nc-tag-datalist" placeholder="${t('tagPlaceholder')}" data-action="tag-add-commit" data-id="${s.id}" hidden />
        </span>
      </div>
      <div class="nc-card-actions">
        <button class="nc-action nc-star ${s.starred ? 'starred' : ''}" data-action="star" data-id="${s.id}" title="${s.starred ? t('unstarred') : t('starred')}">${s.starred ? '★' : '☆'}</button>
        <button class="nc-action" data-action="copy" data-id="${s.id}" title="${t('copyAction')}">${t('copyAction')}</button>
        <button class="nc-action nc-action-delete" data-action="delete" data-id="${s.id}" title="${t('delete')}">${t('delete')}</button>
      </div>
    </article>`;
}

export async function mountPanel(root: HTMLElement): Promise<void> {
  root.innerHTML = `
    <header class="nc-header">
      <div class="nc-search-wrap">
        <input id="nc-search" type="search" class="nc-search" placeholder="${t('panelSearchPlaceholder')}" />
      </div>
      <div class="nc-toolbar" id="nc-toolbar">
        <button id="nc-filter-star" class="nc-chip nc-chip-star" title="${t('filterStarred')}">★</button>
        <button id="nc-filter-text" class="nc-chip">${t('filterText')}</button>
        <button id="nc-filter-image" class="nc-chip">${t('filterImage')}</button>
        <div class="nc-tagbar" id="nc-tagbar"></div>
      </div>
      <div class="nc-toolbar nc-batchbar" id="nc-batchbar" hidden>
        <span class="nc-selected-count" id="nc-selected-count"></span>
        <button id="nc-batch-all" class="nc-chip">${t('selectAll')}</button>
        <button id="nc-batch-tag" class="nc-chip">${t('batchTag')}</button>
        <button id="nc-batch-delete" class="nc-chip nc-chip-danger">${t('batchDelete')}</button>
        <span class="nc-spacer"></span>
        <button id="nc-batch-done" class="nc-chip nc-primary">${t('exitSelect')}</button>
      </div>
      <div class="nc-toolbar nc-toolbar-2" id="nc-toolbar-2">
        <button id="nc-filter-select" class="nc-chip">${t('selectMode')}</button>
        <span class="nc-spacer"></span>
        <button id="nc-capture" class="nc-chip nc-primary">${t('screenshotBtn')}</button>
        <button id="nc-settings" class="nc-chip" title="${t('settingsBtn')}">⚙</button>
        <button id="nc-export" class="nc-chip" title="${t('exportBtn')}">${t('exportBtn')}</button>
        <button id="nc-import" class="nc-chip" title="${t('importBtn')}">${t('importBtn')}</button>
        <input id="nc-import-file" type="file" accept=".json,application/json" hidden />
      </div>
    </header>
    <main class="nc-main" id="nc-main">
      <div class="nc-list" id="nc-list"></div>
      <div id="nc-sentinel" hidden></div>
      <div class="nc-empty" id="nc-empty" hidden></div>
    </main>
    <dialog id="nc-export-dialog" class="nc-dialog">
      <h3 class="nc-dialog-title">${t('exportTitle')}</h3>
      <label class="nc-export-filter">
        <input type="checkbox" id="nc-export-filtered" />
        <span id="nc-export-filtered-label"></span>
      </label>
      <div class="nc-dialog-actions">
        <button data-format="json" class="nc-btn nc-primary">${t('exportJson')}</button>
        <button data-format="markdown" class="nc-btn">${t('exportMarkdown')}</button>
        <button data-format="cancel" class="nc-btn">${t('cancel')}</button>
      </div>
    </dialog>
    <dialog id="nc-import-dialog" class="nc-dialog">
      <h3 class="nc-dialog-title">${t('importTitle')}</h3>
      <div class="nc-dialog-actions">
        <button data-mode="overwrite" class="nc-btn nc-primary">${t('importOverwrite')}</button>
        <button data-mode="merge" class="nc-btn">${t('importMerge')}</button>
        <button data-mode="cancel" class="nc-btn">${t('cancel')}</button>
      </div>
    </dialog>
    <dialog id="nc-batch-delete-dialog" class="nc-dialog">
      <h3 class="nc-dialog-title" id="nc-batch-delete-text"></h3>
      <div class="nc-dialog-actions">
        <button id="nc-batch-delete-ok" class="nc-btn nc-primary">${t('confirmDelete')}</button>
        <button id="nc-batch-delete-cancel" class="nc-btn">${t('cancel')}</button>
      </div>
    </dialog>
    <dialog id="nc-batch-tag-dialog" class="nc-dialog">
      <h3 class="nc-dialog-title" id="nc-batch-tag-text"></h3>
      <input type="text" id="nc-batch-tag-input" list="nc-tag-datalist" placeholder="${t('tagPlaceholder')}" />
      <div class="nc-dialog-tags" id="nc-batch-tag-chips"></div>
      <div class="nc-dialog-actions nc-dialog-actions-row">
        <button id="nc-batch-tag-ok" class="nc-btn nc-primary">${t('add')}</button>
        <button id="nc-batch-tag-cancel" class="nc-btn">${t('cancel')}</button>
      </div>
    </dialog>
    <datalist id="nc-tag-datalist"></datalist>
  `;

  const search = root.querySelector('#nc-search') as HTMLInputElement;
  const filterStar = root.querySelector('#nc-filter-star') as HTMLButtonElement;
  const filterText = root.querySelector('#nc-filter-text') as HTMLButtonElement;
  const filterImage = root.querySelector('#nc-filter-image') as HTMLButtonElement;
  const filterSelect = root.querySelector('#nc-filter-select') as HTMLButtonElement;
  const toolbar = root.querySelector('#nc-toolbar') as HTMLElement;
  const toolbar2 = root.querySelector('#nc-toolbar-2') as HTMLElement;
  const batchbar = root.querySelector('#nc-batchbar') as HTMLElement;
  const selectedCount = root.querySelector('#nc-selected-count') as HTMLElement;
  const batchAll = root.querySelector('#nc-batch-all') as HTMLButtonElement;
  const batchTagBtn = root.querySelector('#nc-batch-tag') as HTMLButtonElement;
  const batchDeleteBtn = root.querySelector('#nc-batch-delete') as HTMLButtonElement;
  const batchDone = root.querySelector('#nc-batch-done') as HTMLButtonElement;
  const batchDeleteDialog = root.querySelector('#nc-batch-delete-dialog') as HTMLDialogElement;
  const batchDeleteText = root.querySelector('#nc-batch-delete-text') as HTMLElement;
  const batchDeleteOk = root.querySelector('#nc-batch-delete-ok') as HTMLButtonElement;
  const batchDeleteCancel = root.querySelector('#nc-batch-delete-cancel') as HTMLButtonElement;
  const batchTagDialog = root.querySelector('#nc-batch-tag-dialog') as HTMLDialogElement;
  const batchTagText = root.querySelector('#nc-batch-tag-text') as HTMLElement;
  const batchTagInput = root.querySelector('#nc-batch-tag-input') as HTMLInputElement;
  const batchTagChips = root.querySelector('#nc-batch-tag-chips') as HTMLElement;
  const batchTagOk = root.querySelector('#nc-batch-tag-ok') as HTMLButtonElement;
  const batchTagCancel = root.querySelector('#nc-batch-tag-cancel') as HTMLButtonElement;
  const capture = root.querySelector('#nc-capture') as HTMLButtonElement;
  const settingsBtn = root.querySelector('#nc-settings') as HTMLButtonElement;
  const exportBtn = root.querySelector('#nc-export') as HTMLButtonElement;
  const importBtn = root.querySelector('#nc-import') as HTMLButtonElement;
  const importFile = root.querySelector('#nc-import-file') as HTMLInputElement;
  const list = root.querySelector('#nc-list') as HTMLElement;
  const mainEl = root.querySelector('#nc-main') as HTMLElement;
  const sentinel = root.querySelector('#nc-sentinel') as HTMLElement;
  const empty = root.querySelector('#nc-empty') as HTMLElement;
  const tagbar = root.querySelector('#nc-tagbar') as HTMLElement;
  const datalist = root.querySelector('#nc-tag-datalist') as HTMLDataListElement;
  const dialog = root.querySelector('#nc-import-dialog') as HTMLDialogElement;
  const exportDialog = root.querySelector('#nc-export-dialog') as HTMLDialogElement;
  const exportFiltered = root.querySelector('#nc-export-filtered') as HTMLInputElement;
  const exportFilteredLabel = root.querySelector('#nc-export-filtered-label') as HTMLElement;

  /** Render one page of cards and advance the cursor. */
  function appendPage(): void {
    const slice = allItems.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
    // insertAdjacentHTML keeps already-rendered cards (and their images) intact.
    list.insertAdjacentHTML('beforeend', slice.map(cardHtml).join(''));
    page++;
    sentinel.hidden = page * PAGE_SIZE >= allItems.length;
  }

  /** Re-render everything shown so far (e.g. selection toggled in batch mode). */
  function rerenderLoaded(): void {
    list.innerHTML = allItems.slice(0, page * PAGE_SIZE).map(cardHtml).join('');
  }

  /** Current filter as an export filter (batch/selection state excluded). */
  function currentFilter() {
    return { query: state.query, starredOnly: state.starredOnly, tagId: state.tagId, kind: state.kind };
  }

  function updateBatchbar(): void {
    selectedCount.textContent = t('selectedCount').replace('{n}', String(batch.selected.size));
  }

  function setSelectMode(active: boolean): void {
    batch.active = active;
    batch.selected.clear();
    filterSelect.classList.toggle('active', active);
    toolbar.hidden = active;
    toolbar2.hidden = active;
    batchbar.hidden = !active;
    if (active) {
      // Disarm any pending delete confirmation to avoid conflicting actions.
      if (armedCard) {
        disarmCardDelete(armedCard);
        armedCard = null;
      }
      updateBatchbar();
    }
    rerenderLoaded();
  }

  function toggleSelect(id: string): void {
    if (batch.selected.has(id)) batch.selected.delete(id);
    else batch.selected.add(id);
    const card = list.querySelector<HTMLElement>(`.nc-card[data-id="${id}"]`);
    if (card) {
      card.classList.toggle('selected', batch.selected.has(id));
      card.querySelector('.nc-select-box')?.classList.toggle('checked', batch.selected.has(id));
    }
    updateBatchbar();
  }

  async function copySnippet(s: Snippet): Promise<void> {
    try {
      if (s.kind === 'text' || !s.image) {
        if (s.text) await navigator.clipboard.writeText(s.text);
      } else {
        await copyImageBlob(s.image);
      }
      toast(t('copiedToast'));
    } catch {
      toast(t('copyFailToast'));
    }
  }

  async function copyImageBlob(blob: Blob): Promise<void> {
    const type = blob.type.toLowerCase();
    if (type === 'image/png' || type === 'image/jpeg' || type === 'image/webp') {
      await navigator.clipboard.write([new ClipboardItem({ [type]: blob })]);
      return;
    }
    // Unsupported formats are re-encoded as PNG via canvas.
    const bmp = await createImageBitmap(blob);
    const canvas = document.createElement('canvas');
    canvas.width = bmp.width;
    canvas.height = bmp.height;
    canvas.getContext('2d')!.drawImage(bmp, 0, 0);
    const png = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
    if (!png) throw new Error('canvas encode failed');
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': png })]);
  }

  async function refreshTags(): Promise<void> {
    tagMap = new Map((await db.tags.toArray()).map((tag) => [tag.id, tag]));
    const options = [...tagMap.values()]
      .map((tag) => `<option value="${esc(tag.name)}"></option>`)
      .join('');
    datalist.innerHTML = options;

    const chip = (tag: Tag, active: boolean) =>
      `<span class="nc-chip nc-tag-chip ${active ? 'active' : ''}" data-action="filter-tag" data-tag="${tag.id}">#${esc(tag.name)}<button class="nc-tag-x" data-action="tag-delete" data-tag="${tag.id}" title="${t('deleteTag')}">×</button></span>`;

    tagbar.innerHTML =
      [...tagMap.values()].map((tag) => chip(tag, state.tagId === tag.id)).join('') +
      `<input id="nc-new-tag" class="nc-new-tag" list="nc-tag-datalist" placeholder="${t('newTagPlaceholder')}" />`;
  }

  async function refresh(): Promise<void> {
    const items = await listSnippets(state);
    if (knownIds === null) {
      knownIds = new Set(items.map((s) => s.id));
    } else {
      const fresh = items.filter((s) => !knownIds!.has(s.id));
      // Exactly one new snippet (e.g. saved from a page) → user feedback.
      // Bulk additions (import) stay silent: they already show their own toast.
      if (fresh.length === 1) {
        toast(t('addedToast').replace('{n}', snippetLabel(fresh[0]!)));
      }
      for (const s of items) knownIds!.add(s.id);
    }

    allItems = items;
    lastFilterCount = items.length;
    page = 0;
    list.innerHTML = '';
    armedCard = null;
    if (items.length) appendPage();
    const hasFilter = !!(state.query.trim() || state.starredOnly || state.tagId || state.kind);
    empty.textContent = items.length ? '' : hasFilter ? t('emptyFiltered') : t('emptyAll');
    empty.hidden = items.length > 0;
    filterStar.classList.toggle('active', state.starredOnly);
    filterText.classList.toggle('active', state.kind === 'text');
    filterImage.classList.toggle('active', state.kind === 'image');

    // Show expand buttons only for clamped texts that actually overflow.
    requestAnimationFrame(() => {
      list.querySelectorAll<HTMLElement>('.nc-text.nc-text-clamped').forEach((text) => {
        const btn = text.nextElementSibling as HTMLButtonElement | null;
        if (btn?.dataset.action === 'expand') btn.hidden = text.scrollHeight <= text.clientHeight + 4;
      });
    });
  }

  // Scroll loading: render the next page when the sentinel comes into view.
  const loadMore = new IntersectionObserver(
    (entries) => {
      if (entries.some((e) => e.isIntersecting) && page * PAGE_SIZE < allItems.length) {
        appendPage();
        // Newly added clamped texts may need their expand button too.
        requestAnimationFrame(() => {
          list.querySelectorAll<HTMLElement>('.nc-text.nc-text-clamped').forEach((text) => {
            const btn = text.nextElementSibling as HTMLButtonElement | null;
            if (btn?.dataset.action === 'expand') btn.hidden = text.scrollHeight <= text.clientHeight + 4;
          });
        });
      }
    },
    { root: mainEl, rootMargin: '300px' },
  );
  loadMore.observe(sentinel);

  search.addEventListener('input', () => {
    state.query = search.value;
    void refresh();
  });

  filterStar.addEventListener('click', () => {
    state.starredOnly = !state.starredOnly;
    void refresh();
  });

  filterText.addEventListener('click', () => {
    state.kind = state.kind === 'text' ? '' : 'text';
    void refresh();
  });

  filterImage.addEventListener('click', () => {
    state.kind = state.kind === 'image' ? '' : 'image';
    void refresh();
  });

  filterSelect.addEventListener('click', () => setSelectMode(!batch.active));

  batchDone.addEventListener('click', () => setSelectMode(false));

  batchAll.addEventListener('click', () => {
    if (batch.selected.size >= allItems.length && allItems.length > 0) {
      batch.selected.clear();
    } else {
      batch.selected = new Set(allItems.map((s) => s.id));
    }
    updateBatchbar();
    rerenderLoaded();
  });

  batchDeleteBtn.addEventListener('click', () => {
    if (!batch.selected.size) return;
    batchDeleteText.textContent = t('batchDeleteConfirm').replace('{n}', String(batch.selected.size));
    batchDeleteDialog.showModal();
  });

  batchDeleteCancel.addEventListener('click', () => batchDeleteDialog.close());

  batchDeleteOk.addEventListener('click', async () => {
    const ids = [...batch.selected];
    batchDeleteDialog.close();
    for (const id of ids) revokeUrl(id);
    await deleteSnippets(ids);
    batch.selected.clear();
    toast(t('batchDeletedToast').replace('{n}', String(ids.length)));
    updateBatchbar();
    await refresh();
  });

  batchTagBtn.addEventListener('click', () => {
    if (!batch.selected.size) return;
    batchTagText.textContent = t('batchTagTitle').replace('{n}', String(batch.selected.size));
    batchTagInput.value = '';
    // Show existing tags as one-tap chips above the input.
    batchTagChips.innerHTML = [...tagMap.values()]
      .map((tag) => `<span class="nc-chip-tag nc-dialog-tag" data-tag-name="${esc(tag.name)}">#${esc(tag.name)}</span>`)
      .join('');
    batchTagDialog.showModal();
    batchTagInput.focus();
  });

  batchTagCancel.addEventListener('click', () => batchTagDialog.close());

  // Clicking an existing tag chip applies it immediately.
  batchTagChips.addEventListener('click', (e) => {
    const chip = (e.target as HTMLElement).closest<HTMLElement>('[data-tag-name]');
    if (!chip) return;
    void commitBatchTag(chip.dataset.tagName ?? '');
  });

  async function commitBatchTag(nameOverride?: string): Promise<void> {
    const name = (nameOverride ?? batchTagInput.value).trim();
    if (!name || !batch.selected.size) return;
    const tag = await createTag(name);
    if (!tag) {
      toast(t('tagConflict'));
      return;
    }
    const ids = [...batch.selected];
    await addTagToSnippets(ids, tag.id);
    batchTagDialog.close();
    toast(t('batchTagDoneToast').replace('{n}', String(ids.length)));
    await refreshTags();
    await refresh();
  }

  batchTagOk.addEventListener('click', () => void commitBatchTag());
  batchTagInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') void commitBatchTag();
    if (e.key === 'Escape') batchTagDialog.close();
  });

  capture.addEventListener('click', async () => {
    const resp = await browser.runtime.sendMessage({ type: 'startCapture' });
    if (!resp?.ok) toast(t('captureFailed'));
  });

  settingsBtn.addEventListener('click', () => {
    browser.runtime.openOptionsPage();
  });

  exportBtn.addEventListener('click', () => {
    exportFiltered.checked = false;
    exportFilteredLabel.textContent = t('exportFiltered').replace('{n}', String(lastFilterCount));
    exportDialog.showModal();
  });

  exportDialog.addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-format]');
    if (!btn) return;
    const format = btn.dataset.format as 'json' | 'markdown' | 'cancel';
    exportDialog.close();
    if (format === 'cancel') return;
    const filter = exportFiltered.checked ? currentFilter() : {};
    const download = format === 'json' ? downloadExport : downloadMarkdownExport;
    download(filter).catch(() => toast(t('exportError')));
  });

  importBtn.addEventListener('click', () => importFile.click());

  importFile.addEventListener('change', async () => {
    const file = importFile.files?.[0];
    importFile.value = '';
    if (!file) return;
    try {
      const data = await readExportFile(file);
      dialog.showModal();
      dialog.dataset.file = file.name;
      pendingImport = data;
    } catch {
      toast(t('importError'));
    }
  });

  let pendingImport: Awaited<ReturnType<typeof readExportFile>> | null = null;

  dialog.addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-mode]');
    if (!btn) return;
    const mode = btn.dataset.mode as 'overwrite' | 'merge' | 'cancel';
    dialog.close();
    if (mode === 'cancel' || !pendingImport) return;
    importData(pendingImport, mode)
      .then(async () => {
        clearUrls();
        toast(t('importDone'));
        await refreshTags();
        await refresh();
      })
      .catch(() => toast(t('importError')))
      .finally(() => {
        pendingImport = null;
      });
  });

  // List event delegation
  list.addEventListener('click', async (e) => {
    const target = e.target as HTMLElement;

    // Batch mode: a click anywhere on a card toggles its selection.
    if (batch.active) {
      const card = target.closest<HTMLElement>('.nc-card');
      if (card?.dataset.id) toggleSelect(card.dataset.id);
      return;
    }

    // Clicking an image opens it full-size in a new tab.
    if (target.tagName === 'IMG' && target.closest('.nc-img')) {
      const id = target.closest<HTMLElement>('.nc-card')?.dataset.id;
      if (id) {
        await browser.tabs.create({
          url: browser.runtime.getURL('/viewer.html') + `?id=${id}`,
          active: true,
        });
      }
      return;
    }

    const el = target.closest<HTMLElement>('[data-action]');
    if (!el) return;
    const action = el.dataset.action;
    const id = el.dataset.id;

    if (action === 'star' && id) {
      void toggleStar(id).then(refresh);
    } else if (action === 'copy' && id) {
      const snip = await db.snippets.get(id);
      if (snip) void copySnippet(snip);
    } else if (action === 'delete' && id) {
      const card = el.closest('.nc-card') as HTMLElement;
      if (armedCard && armedCard !== card) disarmCardDelete(armedCard);
      armedCard = card;
      armCardDelete(card, id);
    } else if (action === 'delete-confirm' && id) {
      const snip = await db.snippets.get(id);
      const label = snip ? snippetLabel(snip) : '';
      revokeUrl(id);
      await deleteSnippet(id);
      toast(t('deletedToast').replace('{n}', label));
      await refresh();
    } else if (action === 'delete-cancel' && id) {
      const card = el.closest('.nc-card') as HTMLElement;
      disarmCardDelete(card);
      armedCard = null;
    } else if (action === 'tag-remove' && id && el.dataset.tag) {
      void setSnippetTags(id, currentTags(id).filter((x) => x !== el.dataset.tag)).then(refresh);
    } else if (action === 'tag-add' && id) {
      const input = el
        .closest('.nc-tag-add')!
        .querySelector<HTMLInputElement>('input.nc-tag-input');
      if (input) {
        input.hidden = false;
        input.focus();
      }
    } else if (action === 'expand' && id) {
      const card = list.querySelector<HTMLElement>(`.nc-card[data-id="${id}"]`);
      const text = card?.querySelector<HTMLElement>('.nc-text.nc-text-clamped');
      if (!text) return;
      const open = text.classList.toggle('nc-text-open');
      el.textContent = open ? t('collapse') : t('expandMore');
    }
  });

  list.addEventListener('keydown', (e) => {
    const target = e.target as HTMLInputElement;
    if (target.dataset.action === 'tag-add-commit' && e.key === 'Enter') {
      e.preventDefault();
      void commitTagInput(target.dataset.id ?? '', target);
    }
  });

  // Clicking anywhere else auto-saves the pending tag input.
  // (blur does not bubble; focusout does.)
  list.addEventListener('focusout', (e) => {
    const target = e.target as HTMLInputElement;
    if (target.dataset.action !== 'tag-add-commit' || target.hidden) return;
    if (target.value.trim()) {
      void commitTagInput(target.dataset.id ?? '', target);
    } else {
      target.hidden = true;
    }
  });

  list.addEventListener('focusout', (e) => {
    const target = e.target as HTMLTextAreaElement;
    if (target.dataset.action === 'comment' && target.dataset.id) {
      void setComment(target.dataset.id, target.value);
    }
  });

  function currentTags(id: string): string[] {
    const card = list.querySelector<HTMLElement>(`.nc-card[data-id="${id}"]`);
    if (!card) return [];
    const tags: string[] = [];
    card.querySelectorAll<HTMLElement>('[data-action="tag-remove"]').forEach((x) => {
      if (x.dataset.tag) tags.push(x.dataset.tag);
    });
    return tags;
  }

  async function commitTagInput(id: string, input: HTMLInputElement): Promise<void> {
    const name = input.value.trim();
    if (!name) return;
    const tag = await createTag(name);
    if (!tag) {
      input.hidden = true;
      input.value = '';
      return;
    }
    // Ignore duplicates: the clip already carries this tag.
    if (currentTags(id).includes(tag.id)) {
      input.hidden = true;
      input.value = '';
      toast(t('tagConflict'));
      return;
    }
    await setSnippetTags(id, [...currentTags(id), tag.id]);
    input.hidden = true;
    input.value = '';
    await refreshTags();
    await refresh();
  }

  // Tagbar delegation (filters + delete + new tag).
  // Clicking the active tag chip again clears the tag filter
  // (the "All" chip was removed; toggle replaces it).
  tagbar.addEventListener('click', (e) => {
    const target = e.target as HTMLElement;
    const el = target.closest<HTMLElement>('[data-action]');
    if (!el) return;
    if (el.dataset.action === 'filter-tag') {
      const id = el.dataset.tag ?? '';
      state.tagId = state.tagId === id ? '' : id;
      void refresh();
      void refreshTags();
    } else if (el.dataset.action === 'tag-delete' && el.dataset.tag) {
      void deleteTag(el.dataset.tag).then(async () => {
        if (state.tagId === el.dataset.tag) {
          state.tagId = '';
          await refreshTags();
          await refresh();
        } else {
          await refreshTags();
        }
      });
    }
  });

  tagbar.addEventListener('keydown', (e) => {
    const input = e.target as HTMLInputElement;
    if (input.id !== 'nc-new-tag') return;
    if (e.key === 'Enter') {
      e.preventDefault();
      const name = input.value.trim();
      if (!name) return;
      void createTag(name).then(async () => {
        input.value = '';
        await refreshTags();
      });
    } else if (e.key === 'Escape') {
      input.value = '';
    }
  });

  // Blur auto-saves the new tag, mirroring the per-card tag input.
  // refreshTags() rebuilds the bar, which clears the input.
  tagbar.addEventListener('focusout', (e) => {
    const input = e.target as HTMLInputElement;
    if (input.id !== 'nc-new-tag' || !input.value.trim()) return;
    void createTag(input.value.trim()).then(refreshTags);
  });

  // Refresh when another extension page (capture page, background) mutates data
  browser.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes['noteclip:updated']) {
      void refresh();
    }
  });

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) void refresh();
  });

  await refreshTags();
  await refresh();
}
