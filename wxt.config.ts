import { defineConfig } from 'wxt';

export default defineConfig({
  srcDir: 'src',
  manifestVersion: 3,
  modules: ['@wxt-dev/auto-icons'],
  autoIcons: {
    baseIconPath: 'assets/icon.svg',
  },
  suppressWarnings: {
    firefoxDataCollection: true,
  },
  manifest: ({ browser }) => {
    const isFirefox = browser === 'firefox';
    const permissions = ['storage', 'contextMenus', 'downloads'];
    if (!isFirefox) permissions.push('sidePanel');

    return {
      name: '__MSG_extensionName__',
      description: '__MSG_extensionDescription__',
      default_locale: 'zh_CN',
      permissions,
      host_permissions: ['<all_urls>'],
      action: isFirefox ? undefined : {},
      browser_specific_settings: {
        gecko: { id: 'noteclip@local.dev' },
      },
    };
  },
});
