import { defineBackground } from 'wxt/utils/define-background';
import { browser } from 'wxt/browser';
import { setupSidePanel } from '@/bg/sidepanel';
import { setupMenus, handleMenuClick } from '@/bg/menus';
import { setupMessageHandler } from '@/bg/messages';

export default defineBackground(() => {
  setupSidePanel();
  setupMenus();
  setupMessageHandler();

  browser.runtime.onInstalled.addListener(() => {
    browser.contextMenus.removeAll();
    setupMenus();
  });

  browser.contextMenus.onClicked.addListener((info, tab) => {
    handleMenuClick(info, tab);
  });
});
