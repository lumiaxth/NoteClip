import { browser } from 'wxt/browser';

const KOFI_URL = 'https://ko-fi.com/lumiaxth';
const AFDIAN_URL = 'https://ifdian.net/a/lumiaxth';

/** Store listing page (Edge Add-ons). */
export const STORE_URL =
  'https://microsoftedge.microsoft.com/addons/detail/eglgcgcpolnlhkmaepjejmlmpognelpd';

/** Chinese users land on Afdian, everyone else on Ko-Fi (per browser UI
 * language, so both the panel footer and the settings page agree). */
export function sponsorUrl(): string {
  try {
    const uiLang = browser.i18n.getUILanguage?.() ?? 'zh';
    return uiLang.toLowerCase().startsWith('zh') ? AFDIAN_URL : KOFI_URL;
  } catch {
    return AFDIAN_URL;
  }
}
