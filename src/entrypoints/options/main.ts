import '@/panel/app.css';
import './options.css';
import { browser } from 'wxt/browser';
import { initTheme } from '@/settings/theme';
import { loadSettings, saveSettings } from '@/settings/storage';
import { BACKUP_INTERVALS, type Settings } from '@/settings/types';
import { t, fullTime } from '@/utils/i18n';
import { db, createTag, renameTag, deleteTag } from '@/db';
import { downloadExport, readExportFile, importData } from '@/db/io';
import { esc } from '@/utils/format';

const ACCENT_PRESETS = ['#4f46e5', '#0ea5e9', '#10b981', '#f59e0b', '#ef4444', '#ec4899', '#8b5cf6'];

let settings: Settings;
let toastTimer: number | undefined;
let pendingImport: Awaited<ReturnType<typeof readExportFile>> | null = null;

function toast(msg: string): void {
  let el = document.getElementById('toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'toast';
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.classList.add('show');
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => el?.classList.remove('show'), 2000);
}

async function exportBackup(): Promise<void> {
  await downloadExport();
  await saveSettings({ lastBackupAt: Date.now() });
  settings = await loadSettings();
  renderLastBackup();
  toast(t('savedOk'));
}

function renderLastBackup(): void {
  const el = document.getElementById('last-backup');
  if (!el) return;
  el.textContent = settings.lastBackupAt
    ? t('lastBackupAt').replace('{time}', fullTime(settings.lastBackupAt))
    : t('lastBackupNone');
}

function renderTheme(): void {
  const row = document.getElementById('theme-row');
  if (!row) return;
  const modes: { value: Settings['theme']; key: string }[] = [
    { value: 'system', key: 'themeSystem' },
    { value: 'light', key: 'themeLight' },
    { value: 'dark', key: 'themeDark' },
  ];
  row.innerHTML = modes
    .map(
      (m) =>
        `<label class="radio-label"><input type="radio" name="theme" value="${m.value}" ${settings.theme === m.value ? 'checked' : ''} />${t(m.key)}</label>`,
    )
    .join('');
  row.querySelectorAll('input[name="theme"]').forEach((el) => {
    el.addEventListener('change', () => {
      void saveSettings({ theme: (el as HTMLInputElement).value as Settings['theme'] }).then(
        (s) => {
          settings = s;
          toast(t('settingsSaved'));
        },
      );
    });
  });

  const swatches = document.getElementById('swatches');
  if (swatches) {
    swatches.innerHTML = ACCENT_PRESETS.map(
      (c) =>
        `<button type="button" class="swatch ${settings.accent.toLowerCase() === c ? 'active' : ''}" data-color="${c}" style="background:${c}" title="${c}"></button>`,
    ).join('');
    swatches.querySelectorAll('.swatch').forEach((el) => {
      el.addEventListener('click', () => {
        const color = (el as HTMLElement).dataset.color!;
        void applyAccent(color);
      });
    });
  }
  const colorInput = document.getElementById('accent-color') as HTMLInputElement | null;
  if (colorInput) {
    colorInput.value = settings.accent;
    colorInput.addEventListener('change', () => {
      void applyAccent(colorInput.value);
    });
  }
}

async function applyAccent(color: string): Promise<void> {
  await saveSettings({ accent: color });
  settings = await loadSettings();
  renderTheme();
  toast(t('settingsSaved'));
}

async function renderTags(): Promise<void> {
  const list = document.getElementById('tag-list');
  if (!list) return;
  const tags = await db.tags.toArray();
  if (!tags.length) {
    list.innerHTML = `<p class="muted">${t('noTags')}</p>`;
    return;
  }
  list.innerHTML = tags
    .map(
      (tag) => `
      <div class="tag-row" data-id="${tag.id}" data-name="${esc(tag.name)}">
        <input type="text" data-action="tag-rename" value="${esc(tag.name)}" placeholder="${t('tagPlaceholder')}" />
        <button class="nc-btn danger" data-action="tag-delete" data-id="${tag.id}">${t('delete')}</button>
      </div>`,
    )
    .join('');
}

/** Replace a row's delete button with inline confirm/cancel buttons. */
function armDelete(row: HTMLElement, confirmAction: string, cancelAction: string): void {
  const del = row.querySelector<HTMLButtonElement>('[data-action="tag-delete"], [data-action="delete"]');
  if (!del || row.querySelector('.nc-confirm-del')) return;
  const wrap = document.createElement('span');
  wrap.className = 'nc-confirm-del';
  const ok = document.createElement('button');
  ok.className = 'nc-btn danger';
  ok.dataset.action = confirmAction;
  ok.textContent = t('confirmDelete');
  const no = document.createElement('button');
  no.className = 'nc-btn';
  no.dataset.action = cancelAction;
  no.textContent = t('cancel');
  wrap.append(ok, no);
  del.replaceWith(wrap);
}

/** Restore the original delete button after a cancelled confirmation. */
function disarmDelete(row: HTMLElement, action: 'tag-delete' | 'delete'): void {
  const wrap = row.querySelector('.nc-confirm-del');
  if (!wrap) return;
  const btn = document.createElement('button');
  btn.className = 'nc-btn danger';
  btn.dataset.action = action;
  btn.dataset.id = row.dataset.id ?? '';
  btn.textContent = t('delete');
  wrap.replaceWith(btn);
}

async function renderClipping(): Promise<void> {
  const toggle = document.getElementById('floating-enabled') as HTMLInputElement | null;
  if (toggle) {
    toggle.checked = settings.floatingButton;
    toggle.addEventListener('change', () => {
      void saveSettings({ floatingButton: toggle.checked }).then((s) => {
        settings = s;
        toast(t('settingsSaved'));
      });
    });
  }
}

/** URL of the browser's extension-shortcut management page. */
function shortcutsPageUrl(): string {
  const ua = navigator.userAgent;
  if (ua.includes('Edg/')) return 'edge://extensions/shortcuts';
  if (ua.includes('Firefox')) return 'about:addons/shortcuts';
  return 'chrome://extensions/shortcuts';
}

async function renderShortcuts(): Promise<void> {
  const list = document.getElementById('shortcut-list');
  if (!list) return;
  const all = await browser.commands.getAll();
  const commands = all.filter((cmd) => cmd.name !== '_execute_action');
  list.innerHTML = commands
    .map((cmd) => {
      const name = cmd.name ?? '';
      const desc = cmd.description || name || '-';
      const key = cmd.shortcut || '-';
      return `<div class="shortcut-row">
        <span class="shortcut-desc">${esc(desc)}</span>
        <span class="shortcut-key">${esc(key)}</span>
        <button class="nc-btn" data-action="shortcut-open-settings">${t('shortcutOpenSettings')}</button>
      </div>`;
    })
    .join('');

  const hint = document.getElementById('shortcut-hint');
  if (hint) {
    hint.textContent = t('shortcutHint');
  }
}

async function renderReminder(): Promise<void> {
  const enabled = document.getElementById('reminder-enabled') as HTMLInputElement | null;
  const interval = document.getElementById('reminder-interval') as HTMLSelectElement | null;
  if (enabled) {
    enabled.checked = settings.backupReminder;
    enabled.addEventListener('change', () => {
      void saveSettings({ backupReminder: enabled.checked }).then((s) => {
        settings = s;
        toast(t('settingsSaved'));
      });
    });
  }
  if (interval) {
    interval.innerHTML = BACKUP_INTERVALS.map(
      (o) => `<option value="${o.value}">${t(o.label)}</option>`,
    ).join('');
    interval.value = String(settings.backupReminderDays);
    interval.addEventListener('change', () => {
      const days = Number(interval.value);
      if (Number.isFinite(days) && days > 0) {
        void saveSettings({ backupReminderDays: days }).then((s) => {
          settings = s;
          toast(t('settingsSaved'));
        });
      }
    });
  }
}

export async function initOptions(root: HTMLElement): Promise<void> {
  settings = await loadSettings();

  root.innerHTML = `
    <div class="wrap">
      <h1>⚙ ${esc(t('settingsTitle'))}</h1>
      <p class="sub">${esc(t('settingsSubtitle'))}</p>

      <section>
        <h2>${esc(t('sectionAppearance'))}</h2>
        <div class="row" id="theme-row"></div>
        <div class="row">
          <span class="muted">${esc(t('settingsAccent'))}:</span>
          <div class="swatches" id="swatches"></div>
          <input type="color" id="accent-color" />
        </div>
      </section>

      <section>
        <h2>${esc(t('sectionClipping'))}</h2>
        <div class="row">
          <input type="checkbox" id="floating-enabled" />
          <label for="floating-enabled">${esc(t('floatingButtonEnable'))}</label>
        </div>
      </section>

      <section>
        <h2>${esc(t('sectionData'))}</h2>
        <div class="row">
          <button class="nc-btn primary" id="btn-export">${esc(t('exportBtn'))}</button>
          <button class="nc-btn" id="btn-import">${esc(t('importBtn'))}</button>
          <input type="file" id="import-file" accept=".json,application/json" hidden />
        </div>
        <p class="muted" id="last-backup"></p>
        <dialog id="import-dialog" class="nc-dialog">
          <h3 class="muted">${esc(t('importTitle'))}</h3>
          <div class="nc-dialog-actions">
            <button data-mode="overwrite" class="nc-btn primary">${esc(t('importOverwrite'))}</button>
            <button data-mode="merge" class="nc-btn">${esc(t('importMerge'))}</button>
            <button data-mode="cancel" class="nc-btn">${esc(t('cancel'))}</button>
          </div>
        </dialog>
      </section>

      <section>
        <h2>${esc(t('sectionTags'))}</h2>
        <div class="row">
          <input type="text" id="new-tag" placeholder="${esc(t('newTagPlaceholder'))}" style="flex:1" />
          <button class="nc-btn primary" id="btn-add-tag">${esc(t('add'))}</button>
        </div>
        <div id="tag-list"></div>
      </section>

      <section>
        <h2>${esc(t('sectionShortcuts'))}</h2>
        <div id="shortcut-list"></div>
        <p class="muted" id="shortcut-hint"></p>
      </section>

      <section>
        <h2>${esc(t('sectionReminder'))}</h2>
        <div class="row">
          <input type="checkbox" id="reminder-enabled" />
          <label for="reminder-enabled">${esc(t('reminderEnabled'))}</label>
          <select id="reminder-interval"></select>
        </div>
      </section>
    </div>
  `;

  const exportBtn = root.querySelector('#btn-export') as HTMLButtonElement;
  const importBtn = root.querySelector('#btn-import') as HTMLButtonElement;
  const importFile = root.querySelector('#import-file') as HTMLInputElement;
  const importDialog = root.querySelector('#import-dialog') as HTMLDialogElement;
  const newTag = root.querySelector('#new-tag') as HTMLInputElement;
  const addTagBtn = root.querySelector('#btn-add-tag') as HTMLButtonElement;
  const tagList = root.querySelector('#tag-list') as HTMLElement;

  exportBtn.addEventListener('click', () => {
    exportBackup().catch(() => toast(t('exportError')));
  });

  importBtn.addEventListener('click', () => importFile.click());

  importFile.addEventListener('change', async () => {
    const file = importFile.files?.[0];
    importFile.value = '';
    if (!file) return;
    try {
      pendingImport = await readExportFile(file);
      importDialog.showModal();
    } catch {
      toast(t('importError'));
    }
  });

  importDialog.addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-mode]');
    if (!btn) return;
    const mode = btn.dataset.mode as 'overwrite' | 'merge' | 'cancel';
    importDialog.close();
    if (mode === 'cancel' || !pendingImport) return;
    importData(pendingImport, mode)
      .then(() => toast(t('importDone')))
      .catch(() => toast(t('importError')))
      .finally(() => {
        pendingImport = null;
      });
  });

  addTagBtn.addEventListener('click', () => {
    void addNewTag();
  });
  newTag.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') void addNewTag();
  });

  async function addNewTag(): Promise<void> {
    const name = newTag.value.trim();
    if (!name) return;
    const tag = await createTag(name);
    if (tag) {
      newTag.value = '';
      await renderTags();
      toast(t('settingsSaved'));
    }
  }

  tagList.addEventListener('click', (e) => {
    const target = e.target as HTMLElement;
    const el = target.closest<HTMLElement>('[data-action]');
    if (!el) return;
    const row = el.closest('.tag-row') as HTMLElement;
    const action = el.dataset.action;
    if (action === 'tag-delete') {
      armDelete(row, 'tag-delete-confirm', 'tag-delete-cancel');
    } else if (action === 'tag-delete-confirm') {
      const name = row.dataset.name ?? '';
      void deleteTag(row.dataset.id!).then(async () => {
        toast(t('deletedToast').replace('{n}', name));
        await renderTags();
      });
    } else if (action === 'tag-delete-cancel') {
      disarmDelete(row, 'tag-delete');
    }
  });

  tagList.addEventListener('change', (e) => {
    const target = e.target as HTMLInputElement;
    if (target.dataset.action !== 'tag-rename') return;
    const row = target.closest('.tag-row') as HTMLElement;
    const id = row.dataset.id!;
    void renameTag(id, target.value).then((res) => {
      if (!res) {
        toast(t('tagConflict'));
        return renderTags();
      }
      toast(t('settingsSaved'));
    });
  });

  // Shortcuts delegation: open the browser's shortcut settings page.
  const shortcutList = root.querySelector('#shortcut-list') as HTMLElement;
  shortcutList.addEventListener('click', (e) => {
    const target = e.target as HTMLElement;
    if (!target.closest('[data-action="shortcut-open-settings"]')) return;
    void browser.tabs.create({ url: shortcutsPageUrl() }).catch(() => undefined);
  });

  renderTheme();
  renderLastBackup();
  await renderTags();
  await renderShortcuts();
  await renderClipping();
  await renderReminder();
}

void initTheme();
void initOptions(document.getElementById('app')!);
