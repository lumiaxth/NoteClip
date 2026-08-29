import { browser } from 'wxt/browser';
import {
  listSnippets,
  deleteSnippet,
  setComment,
  toggleStar,
  setSnippetTags,
  createTag,
  deleteTag,
  db,
} from '@/db';
import { downloadExport, readExportFile, importData } from '@/db/io';
import type { Snippet, Tag } from '@/types';
import { t, relTime, fullTime } from '@/utils/i18n';
import { domainOf, esc } from '@/utils/format';

interface ViewState {
  query: string;
  starredOnly: boolean;
  tagId: string;
}

const state: ViewState = { query: '', starredOnly: false, tagId: '' };

const objUrls = new Map<string, string>();
let toastTimer: number | undefined;
let tagMap = new Map<string, Tag>();

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
          s.text ? `<div class="nc-text nc-text-clip">${esc(s.text)}</div>` : ''
        }`
      : `<div class="nc-text" title="${esc(s.text ?? '')}">${esc(s.text ?? '')}</div>`;

  const tags = s.tags
    .map((tid) => {
      const tag = tagMap.get(tid);
      return tag
        ? `<span class="nc-chip-tag">#${esc(tag.name)}<button class="nc-tag-x" data-action="tag-remove" data-id="${s.id}" data-tag="${tid}" title="${t('deleteTag')}">×</button></span>`
        : '';
    })
    .join('');

  return `
    <article class="nc-card" data-id="${s.id}">
      <div class="nc-card-head">
        <span class="nc-time" title="${esc(fullTime(s.timestamp))}">${esc(relTime(s.timestamp))}</span>
        <span class="nc-badges">${s.kind === 'image' ? `<span class="nc-badge">${t('imageKind')}</span>` : ''}</span>
      </div>
      ${body}
      <div class="nc-meta">
        ${
          s.url
            ? `<a class="nc-title" href="${esc(s.url)}" target="_blank" rel="noopener noreferrer" title="${esc(s.title || s.url)}">${esc(s.title || domainOf(s.url))}</a>`
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
        <button class="nc-action" data-action="star" data-id="${s.id}" title="${s.starred ? t('unstarred') : t('starred')}">${s.starred ? '★' : '☆'}</button>
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
      <div class="nc-toolbar">
        <button id="nc-filter-star" class="nc-chip">★ ${t('filterStarred')}</button>
        <span class="nc-spacer"></span>
        <button id="nc-capture" class="nc-chip nc-primary">${t('screenshotBtn')}</button>
      </div>
      <div class="nc-toolbar nc-toolbar-2">
        <div class="nc-tagbar" id="nc-tagbar"></div>
        <div class="nc-toolbar-right">
          <button id="nc-export" class="nc-chip" title="${t('exportBtn')}">${t('exportBtn')}</button>
          <button id="nc-import" class="nc-chip" title="${t('importBtn')}">${t('importBtn')}</button>
          <input id="nc-import-file" type="file" accept=".json,application/json" hidden />
        </div>
      </div>
    </header>
    <main class="nc-main">
      <div class="nc-list" id="nc-list"></div>
      <div class="nc-empty" id="nc-empty" hidden></div>
    </main>
    <dialog id="nc-import-dialog" class="nc-dialog">
      <h3 class="nc-dialog-title">${t('importTitle')}</h3>
      <div class="nc-dialog-actions">
        <button data-mode="overwrite" class="nc-btn nc-primary">${t('importOverwrite')}</button>
        <button data-mode="merge" class="nc-btn">${t('importMerge')}</button>
        <button data-mode="cancel" class="nc-btn">${t('cancel')}</button>
      </div>
    </dialog>
    <datalist id="nc-tag-datalist"></datalist>
  `;

  const search = root.querySelector('#nc-search') as HTMLInputElement;
  const filterStar = root.querySelector('#nc-filter-star') as HTMLButtonElement;
  const capture = root.querySelector('#nc-capture') as HTMLButtonElement;
  const exportBtn = root.querySelector('#nc-export') as HTMLButtonElement;
  const importBtn = root.querySelector('#nc-import') as HTMLButtonElement;
  const importFile = root.querySelector('#nc-import-file') as HTMLInputElement;
  const list = root.querySelector('#nc-list') as HTMLElement;
  const empty = root.querySelector('#nc-empty') as HTMLElement;
  const tagbar = root.querySelector('#nc-tagbar') as HTMLElement;
  const datalist = root.querySelector('#nc-tag-datalist') as HTMLDataListElement;
  const dialog = root.querySelector('#nc-import-dialog') as HTMLDialogElement;

  async function refreshTags(): Promise<void> {
    tagMap = new Map((await db.tags.toArray()).map((tag) => [tag.id, tag]));
    const options = [...tagMap.values()]
      .map((tag) => `<option value="${esc(tag.name)}"></option>`)
      .join('');
    datalist.innerHTML = options;

    const chip = (tag: Tag, active: boolean) =>
      `<span class="nc-chip nc-tag-chip ${active ? 'active' : ''}" data-action="filter-tag" data-tag="${tag.id}">#${esc(tag.name)}<button class="nc-tag-x" data-action="tag-delete" data-tag="${tag.id}" title="${t('deleteTag')}">×</button></span>`;

    const allChip = `<span class="nc-chip nc-tag-chip ${!state.tagId ? 'active' : ''}" data-action="filter-tag" data-tag="">${t('filterAll')}</span>`;

    tagbar.innerHTML =
      allChip +
      [...tagMap.values()].map((tag) => chip(tag, state.tagId === tag.id)).join('') +
      `<input id="nc-new-tag" class="nc-new-tag" list="nc-tag-datalist" placeholder="${t('newTagPlaceholder')}" />`;
  }

  async function refresh(): Promise<void> {
    const items = await listSnippets(state);
    list.innerHTML = items.map(cardHtml).join('');
    const hasFilter = !!(state.query.trim() || state.starredOnly || state.tagId);
    empty.textContent = items.length ? '' : hasFilter ? t('emptyFiltered') : t('emptyAll');
    empty.hidden = items.length > 0;
    if (!items.length) list.innerHTML = '';
    filterStar.classList.toggle('active', state.starredOnly);
  }

  search.addEventListener('input', () => {
    state.query = search.value;
    void refresh();
  });

  filterStar.addEventListener('click', () => {
    state.starredOnly = !state.starredOnly;
    void refresh();
  });

  capture.addEventListener('click', async () => {
    const resp = await browser.runtime.sendMessage({ type: 'startCapture' });
    if (!resp?.ok) toast(t('captureFailed'));
  });

  exportBtn.addEventListener('click', () => {
    downloadExport().catch(() => toast(t('exportError')));
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
  list.addEventListener('click', (e) => {
    const target = e.target as HTMLElement;
    const el = target.closest<HTMLElement>('[data-action]');
    if (!el) return;
    const action = el.dataset.action;
    const id = el.dataset.id;

    if (action === 'star' && id) {
      void toggleStar(id).then(refresh);
    } else if (action === 'delete' && id) {
      const card = el.closest('.nc-card') as HTMLElement;
      if (!card.classList.contains('armed')) {
        card.classList.add('armed');
        el.textContent = t('deleteArmed');
        window.setTimeout(() => {
          card.classList.remove('armed');
          el.textContent = t('delete');
        }, 2500);
        return;
      }
      revokeUrl(id);
      void deleteSnippet(id).then(refresh);
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
    }
  });

  list.addEventListener('keydown', (e) => {
    const target = e.target as HTMLInputElement;
    if (target.dataset.action === 'tag-add-commit' && e.key === 'Enter') {
      e.preventDefault();
      void commitTagInput(target.dataset.id ?? '', target);
    }
  });

  list.addEventListener('blur', (e) => {
    const target = e.target as HTMLInputElement;
    if (target.dataset.action === 'tag-add-commit') {
      target.hidden = true;
      target.value = '';
    }
  });

  list.addEventListener('focusout', (e) => {
    const target = e.target as HTMLTextAreaElement;
    if (target.dataset.action === 'comment' && target.dataset.id) {
      void setComment(target.dataset.id, target.value.trim());
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
    if (tag) {
      const tags = [...currentTags(id), tag.id];
      await setSnippetTags(id, tags);
      await refreshTags();
      await refresh();
    }
    input.hidden = true;
    input.value = '';
  }

  // Tagbar delegation (filters + delete + new tag)
  tagbar.addEventListener('click', (e) => {
    const target = e.target as HTMLElement;
    const el = target.closest<HTMLElement>('[data-action]');
    if (!el) return;
    if (el.dataset.action === 'filter-tag') {
      state.tagId = el.dataset.tag ?? '';
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
