import '@/panel/app.css';
import './options.css';
import { browser } from 'wxt/browser';
import { initTheme } from '@/settings/theme';
import { loadSettings, saveSettings } from '@/settings/storage';
import { BACKUP_INTERVALS, type Settings } from '@/settings/types';
import { t, fullTime } from '@/utils/i18n';
import { db, createTag, renameTag, deleteTag, listErrors, clearErrors } from '@/db';
import { downloadExport, downloadMarkdownExport, readExportFile, importData } from '@/db/io';
import { esc } from '@/utils/format';

const ACCENT_PRESETS = ['#4f46e5', '#0ea5e9', '#10b981', '#f59e0b', '#ef4444', '#ec4899', '#8b5cf6'];

let settings: Settings;
let toastTimer: number | undefined;
let pendingImport: Awaited<ReturnType<typeof readExportFile>> | null = null;
/** Latest error report rows, for the per-row copy button. */
let latestErrors: Awaited<ReturnType<typeof listErrors>> = [];

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
  // Flat chip layout mirroring the panel tagbar: click the name to rename
  // inline, × to delete (with in-place confirmation).
  list.innerHTML = `<div class="nc-tag-chips">${tags
    .map(
      (tag) => `
      <span class="nc-chip-tag nc-tag-edit-chip" data-id="${tag.id}" data-name="${esc(tag.name)}">
        #<span class="tag-name" data-action="tag-rename">${esc(tag.name)}</span>
        <button class="nc-tag-x" data-action="tag-delete" data-id="${tag.id}" title="${esc(t('deleteTag'))}">×</button>
      </span>`,
    )
    .join('')}</div>`;
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

  // Temporarily disabled: auto-save downloaded images.
  // const mode = document.getElementById('autosave-mode') as HTMLSelectElement | null;
  // const sitesRow = document.getElementById('autosave-sites-row');
  // const sites = document.getElementById('autosave-sites') as HTMLTextAreaElement | null;
  // if (mode && sitesRow && sites) {
  //   const cfg = settings.autoSaveImages;
  //   mode.value = cfg.mode;
  //   sitesRow.hidden = cfg.mode !== 'sites';
  //   sites.value = cfg.sites.join('\n');
  //   mode.addEventListener('change', () => {
  //     const value = mode.value as Settings['autoSaveImages']['mode'];
  //     sitesRow.hidden = value !== 'sites';
  //     void saveSettings({ autoSaveImages: { ...settings.autoSaveImages, mode: value } }).then((s) => {
  //       settings = s;
  //       toast(t('settingsSaved'));
  //     });
  //   });
  //   const commitSites = () => {
  //     const list = sites.value
  //       .split('\n')
  //       .map((x) => x.trim())
  //       .filter(Boolean);
  //     void saveSettings({ autoSaveImages: { ...settings.autoSaveImages, sites: list } }).then((s) => {
  //       settings = s;
  //       toast(t('settingsSaved'));
  //     });
  //   };
  //   sites.addEventListener('change', commitSites);
  //   sites.addEventListener('blur', commitSites);
  // }
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

async function renderErrors(): Promise<void> {
  const list = document.getElementById('error-list');
  if (!list) return;
  const errors = await listErrors();
  latestErrors = errors;
  if (!errors.length) {
    list.innerHTML = `<p class="muted">${t('errorsEmpty')}</p>`;
    return;
  }
  list.innerHTML = errors
    .map(
      (e) => `
      <div class="error-row" data-id="${e.id}">
        <span class="error-time">${esc(fullTime(e.timestamp))}</span>
        <span class="error-source">${esc(e.source)}</span>
        <span class="error-message">${esc(e.message)}</span>
        ${e.url ? `<a class="error-url" href="${esc(e.url)}" target="_blank" rel="noopener noreferrer">${esc(e.url)}</a>` : ''}
        <button class="nc-btn nc-btn-mini" data-action="error-copy" data-id="${e.id}">${esc(t('copyAction'))}</button>
      </div>`,
    )
    .join('');
}

/** Storage footprint + clip counts, shown next to the backup controls. */
async function renderStorage(): Promise<void> {
  const el = document.getElementById('storage-stats');
  if (!el) return;
  const snippets = await db.snippets.toArray();
  const images = snippets.filter((s) => s.kind === 'image').length;
  let usage = 0;
  try {
    const est = await navigator.storage.estimate();
    usage = est.usage ?? 0;
  } catch {
    usage = 0;
  }
  const mb = (usage / (1024 * 1024)).toFixed(1);
  el.textContent = t('statsUsage')
    .replace('{n}', String(snippets.length))
    .replace('{img}', String(images))
    .replace('{s}', mb);
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
        <div class="row">
          <input type="checkbox" id="floating-enabled" />
          <label for="floating-enabled">${esc(t('floatingButtonEnable'))}</label>
        </div>
      </section>

      <!-- Temporarily disabled: auto-save downloaded images.
      <section>
        <h2>${esc(t('sectionClipping'))}</h2>
        <div class="row">
          <span class="setting-label">${esc(t('autoSaveLabel'))}</span>
          <select id="autosave-mode">
            <option value="off">${esc(t('autoSaveModeOff'))}</option>
            <option value="all">${esc(t('autoSaveModeAll'))}</option>
            <option value="sites">${esc(t('autoSaveModeSites'))}</option>
          </select>
        </div>
        <div class="row" id="autosave-sites-row" hidden>
          <textarea id="autosave-sites" class="site-list" placeholder="${esc(t('autoSaveSitesPlaceholder'))}"></textarea>
        </div>
        <p class="muted">${esc(t('autoSaveHint'))}</p>
      </section>
      -->

      <section>
        <h2>${esc(t('sectionData'))}</h2>
        <div class="row">
          <button class="nc-btn primary" id="btn-export">${esc(t('exportBtn'))}</button>
          <button class="nc-btn" id="btn-import">${esc(t('importBtn'))}</button>
          <input type="file" id="import-file" accept=".json,application/json" hidden />
        </div>
        <p class="muted" id="last-backup"></p>
        <p class="muted" id="storage-stats"></p>
        <dialog id="export-dialog" class="nc-dialog">
          <h3>${esc(t('exportTitle'))}</h3>
          <div class="nc-dialog-actions">
            <button data-format="json" class="nc-btn primary">${esc(t('exportJson'))}</button>
            <button data-format="markdown" class="nc-btn">${esc(t('exportMarkdown'))}</button>
            <button data-format="cancel" class="nc-btn">${esc(t('cancel'))}</button>
          </div>
        </dialog>
        <dialog id="import-dialog" class="nc-dialog">
          <h3>${esc(t('importTitle'))}</h3>
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

      <section>
        <h2>${esc(t('sectionErrors'))}</h2>
        <p class="muted">${esc(t('errorsHint'))}</p>
        <div class="row">
          <button class="nc-btn" id="btn-clear-errors">${esc(t('errorsClear'))}</button>
        </div>
        <div id="error-list"></div>
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
    (root.querySelector('#export-dialog') as HTMLDialogElement).showModal();
  });

  (root.querySelector('#export-dialog') as HTMLDialogElement).addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-format]');
    if (!btn) return;
    const format = btn.dataset.format as 'json' | 'markdown' | 'cancel';
    (e.currentTarget as HTMLDialogElement).close();
    if (format === 'cancel') return;
    const download = format === 'json' ? downloadExport : downloadMarkdownExport;
    download()
      .then(async () => {
        await saveSettings({ lastBackupAt: Date.now() });
        settings = await loadSettings();
        renderLastBackup();
        toast(t('savedOk'));
      })
      .catch(() => toast(t('exportError')));
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
    const chip = el.closest('.nc-tag-edit-chip') as HTMLElement;
    const action = el.dataset.action;
    if (action === 'tag-delete') {
      // In-place confirmation inside the chip.
      chip.innerHTML = `
        <button class="nc-btn danger nc-btn-mini" data-action="tag-delete-confirm" data-id="${chip.dataset.id}">${esc(t('confirmDelete'))}</button>
        <button class="nc-btn nc-btn-mini" data-action="tag-delete-cancel">${esc(t('cancel'))}</button>`;
    } else if (action === 'tag-delete-confirm') {
      const name = chip.dataset.name ?? '';
      void deleteTag(chip.dataset.id!).then(async () => {
        toast(t('deletedToast').replace('{n}', name));
        await renderTags();
      });
    } else if (action === 'tag-delete-cancel') {
      void renderTags();
    } else if (action === 'tag-rename') {
      const id = chip.dataset.id!;
      const name = chip.dataset.name ?? '';
      chip.innerHTML = `<input type="text" data-action="tag-rename-input" value="${esc(name)}" />`;
      const input = chip.querySelector<HTMLInputElement>('input')!;
      input.focus();
      input.select();
      const commit = () => {
        if (input.dataset.done) return;
        input.dataset.done = '1';
        const value = input.value.trim();
        if (!value || value === name) return void renderTags();
        void renameTag(id, value).then((res) => {
          if (!res) toast(t('tagConflict'));
          else toast(t('settingsSaved'));
          void renderTags();
        });
      };
      input.addEventListener('keydown', (ev) => {
        if (ev.key === 'Enter') commit();
        if (ev.key === 'Escape') renderTags();
      });
      input.addEventListener('focusout', commit);
    }
  });

  // Shortcuts delegation: open the browser's shortcut settings page.
  const shortcutList = root.querySelector('#shortcut-list') as HTMLElement;
  shortcutList.addEventListener('click', (e) => {
    const target = e.target as HTMLElement;
    if (!target.closest('[data-action="shortcut-open-settings"]')) return;
    void browser.tabs.create({ url: shortcutsPageUrl() }).catch(() => undefined);
  });

  const clearErrorsBtn = root.querySelector('#btn-clear-errors') as HTMLButtonElement;
  clearErrorsBtn.addEventListener('click', () => {
    void clearErrors().then(renderErrors);
  });

  // Copy a single error report row for easy bug reporting.
  const errorList = root.querySelector('#error-list') as HTMLElement;
  errorList.addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLElement>('[data-action="error-copy"]');
    if (!btn) return;
    const err = latestErrors.find((x) => x.id === btn.dataset.id);
    if (!err) return;
    const text = [fullTime(err.timestamp), err.source, err.message, err.url ?? '']
      .filter(Boolean)
      .join('\n');
    void navigator.clipboard.writeText(text).then(
      () => toast(t('copiedToast')),
      () => toast(t('copyFailToast')),
    );
  });

  renderTheme();
  renderLastBackup();
  await renderTags();
  await renderShortcuts();
  await renderClipping();
  await renderReminder();
  await renderErrors();
  await renderStorage();
}

void initTheme();
void initOptions(document.getElementById('app')!);
