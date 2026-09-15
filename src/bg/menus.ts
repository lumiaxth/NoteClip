import { browser } from 'wxt/browser';
import { t } from '@/utils/i18n';
import { addSnippet } from '@/db';
import { startCapture } from './capture';
import { saveImageFromUrl } from './messages';

export const MENU_SAVE_SELECTION = 'nc-save-selection';
export const MENU_CAPTURE = 'nc-capture';
export const MENU_SAVE_IMAGE = 'nc-save-image';

export function setupMenus(): void {
  browser.contextMenus.create({
    id: MENU_SAVE_SELECTION,
    title: t('contextSaveSelection'),
    contexts: ['selection'],
  });
  browser.contextMenus.create({
    id: MENU_CAPTURE,
    title: t('contextCapture'),
    contexts: ['page'],
  });
  browser.contextMenus.create({
    id: MENU_SAVE_IMAGE,
    title: t('contextSaveImage'),
    contexts: ['image'],
  });
}

export async function flashBadge(text: string): Promise<void> {
  if (text === '!') {
    // Make the failure signal clearly visible on any toolbar.
    await browser.action.setBadgeBackgroundColor({ color: '#d93025' });
  }
  await browser.action.setBadgeText({ text });
  setTimeout(() => void browser.action.setBadgeText({ text: '' }), 2000);
}

export interface MenuClickInfo {
  menuItemId: string | number;
  selectionText?: string;
  srcUrl?: string;
  frameId?: number;
}

export interface TabLike {
  id?: number;
  url?: string;
  title?: string;
}

export function handleMenuClick(info: MenuClickInfo, tab?: TabLike): void {
  const pageUrl = tab?.url ?? '';
  const pageTitle = tab?.title ?? '';
  if (info.menuItemId === MENU_SAVE_SELECTION && info.selectionText) {
    void addSnippet({
      kind: 'text',
      text: info.selectionText,
      url: pageUrl,
      title: pageTitle,
    })
      .then(() => flashBadge('✓'))
      .catch(() => flashBadge('!'));
  } else if (info.menuItemId === MENU_CAPTURE) {
    void startCapture();
  } else if (info.menuItemId === MENU_SAVE_IMAGE && info.srcUrl) {
    void saveImageFromMenu(info.srcUrl, pageUrl, pageTitle, tab?.id, info.frameId)
      .then(() => flashBadge('✓'))
      .catch(() => flashBadge('!'));
  }
}

/**
 * Context-menu image saves have no click coordinates, so the nearby post
 * text and source anchor are fetched from the content script (it looks the
 * <img> up by src), then the save proceeds with those overrides.
 */
export async function saveImageFromMenu(
  srcUrl: string,
  pageUrl: string,
  fallbackTitle: string,
  tabId?: number,
  frameId?: number,
): Promise<void> {
  let title = fallbackTitle;
  let sourceUrl: string | undefined;
  if (tabId != null) {
    try {
      const resp = (await Promise.race([
        browser.tabs.sendMessage(tabId, { type: 'clipPageTitle', src: srcUrl }, { frameId }),
        new Promise<undefined>((resolve) => setTimeout(resolve, 500)),
      ])) as { ok: boolean; title?: string; url?: string } | undefined;
      if (resp && resp.title) title = resp.title;
      if (resp && resp.url) sourceUrl = resp.url;
    } catch {
      // Content script missing → keep the tab title.
    }
  }
  await saveImageFromUrl(srcUrl, pageUrl, title, { tabId, frameId, sourceUrl });
}
