import { browser } from 'wxt/browser';

/** Chromium only: clicking the toolbar icon opens the side panel. */
export function setupSidePanel(): void {
  const sidePanel = (browser as unknown as {
    sidePanel?: { setPanelBehavior?: (opts: { openPanelOnActionClick: boolean }) => Promise<void> };
  }).sidePanel;
  if (sidePanel?.setPanelBehavior) {
    void sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
  }
}
