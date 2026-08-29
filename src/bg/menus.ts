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
  await browser.action.setBadgeText({ text });
  setTimeout(() => void browser.action.setBadgeText({ text: '' }), 2000);
}

export interface MenuClickInfo {
  menuItemId: string | number;
  selectionText?: string;
  srcUrl?: string;
}

export interface TabLike {
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
    }).then(() => flashBadge('✓'));
  } else if (info.menuItemId === MENU_CAPTURE) {
    void startCapture();
  } else if (info.menuItemId === MENU_SAVE_IMAGE && info.srcUrl) {
    void saveImageFromUrl(info.srcUrl, pageUrl, pageTitle)
      .then(() => flashBadge('✓'))
      .catch(() => flashBadge('!'));
  }
}
