import { defineBackground } from 'wxt/utils/define-background';
import { browser } from 'wxt/browser';
import { setupSidePanel } from '@/bg/sidepanel';
import { setupMenus, handleMenuClick } from '@/bg/menus';
import { setupMessageHandler } from '@/bg/messages';
import { setupCommands } from '@/bg/commands';
import { setupReminder } from '@/bg/reminder';
import { db } from '@/db';

export default defineBackground(() => {
  setupSidePanel();
  setupMessageHandler();
  setupCommands();
  setupReminder();

  // Drop stale capture payloads (user closed the crop tab without saving).
  void db.pendingCaptures
    .where('timestamp')
    .below(Date.now() - 30 * 60 * 1000)
    .delete();

  browser.contextMenus.onClicked.addListener((info, tab) => {
    handleMenuClick(info, tab);
  });

  browser.runtime.onInstalled.addListener(async () => {
    await browser.contextMenus.removeAll();
    setupMenus();
  });
});
