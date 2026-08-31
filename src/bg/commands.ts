import { browser } from 'wxt/browser';

type SidePanelLike = {
  open?: (opts: { tabId?: number; windowId?: number }) => Promise<void>;
};

function openPanelTab(): void {
  void browser.tabs.create({ url: browser.runtime.getURL('/popup.html') });
}

export function setupCommands(): void {
  browser.commands.onCommand.addListener((command, tab) => {
    if (command !== 'open-panel') return;
    const sidePanel = (browser as unknown as { sidePanel?: SidePanelLike }).sidePanel;
    // sidePanel.open() must be called synchronously in the gesture handler:
    // awaiting any API first loses the user-gesture state in MV3 workers.
    if (sidePanel?.open && tab?.id != null) {
      void sidePanel.open({ tabId: tab.id }).catch(openPanelTab);
      return;
    }
    // Firefox and gesture-less fallback: open the panel page in a tab.
    openPanelTab();
  });
}
