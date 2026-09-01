import { defineConfig } from 'wxt';

export default defineConfig({
  srcDir: 'src',
  manifestVersion: 3,
  modules: ['@wxt-dev/auto-icons'],
  autoIcons: {
    baseIconPath: 'assets/icon.svg',
  },
  vite: () => ({
    build: {
      // Avoid modulepreload links: shared chunks are also used by content
      // scripts, which makes Chrome warn about cross-world preload mismatches.
      modulePreload: false,
    },
  }),
  suppressWarnings: {
    firefoxDataCollection: true,
  },
  manifest: ({ browser }) => {
    const isFirefox = browser === 'firefox';
    const permissions = [
      'storage',
      'contextMenus',
      'downloads',
      'alarms',
      'notifications',
      // Temporary session rules only: rewrite Referer when fetching
      // hotlink-protected images (rule applies to one domain, removed right
      // after the fetch). No static rules, no blocking.
      'declarativeNetRequest',
    ];
    if (!isFirefox) permissions.push('sidePanel');

    return {
      name: '__MSG_extensionName__',
      description: '__MSG_extensionDescription__',
      default_locale: 'zh_CN',
      permissions,
      host_permissions: ['<all_urls>'],
      action: isFirefox ? undefined : {},
      commands: {
        'open-panel': {
          suggested_key: { default: 'Alt+Shift+N' },
          description: '__MSG_cmdOpenPanel__',
        },
        'start-capture': {
          suggested_key: { default: 'Alt+Shift+S' },
          description: '__MSG_cmdStartCapture__',
        },
      },
      browser_specific_settings: {
        gecko: { id: 'noteclip@local.dev' },
      },
    };
  },
});
