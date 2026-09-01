import { browser } from 'wxt/browser';
import { saveImageFromUrl } from './messages';
import { loadSettings } from '@/settings/storage';
import type { AutoSaveImages } from '@/settings/types';
import { t } from '@/utils/i18n';
import { domainOf } from '@/utils/format';

const IMAGE_EXT_RE = /\.(png|jpe?g|webp|gif|bmp|avif|svg)(\?|#|$)/i;
/** Recently processed URLs — downloads may fire more than once per file. */
const recentUrls = new Set<string>();

function isImageUrl(url: string, mime?: string): boolean {
  if (mime?.startsWith('image/')) return true;
  return IMAGE_EXT_RE.test(url);
}

/** Match a download against the site list (exact domain or subdomain suffix). */
function siteMatches(rule: string, host: string): boolean {
  const clean = rule.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
  if (!clean) return false;
  return host === clean || host.endsWith(`.${clean}`);
}

function allowedBySettings(cfg: AutoSaveImages, url: string, referrer: string): boolean {
  if (cfg.mode === 'off') return false;
  if (cfg.mode === 'all') return true;
  const refHost = referrer ? domainOf(referrer) : '';
  const urlHost = domainOf(url);
  return cfg.sites.some((rule) => siteMatches(rule, urlHost) || (refHost && siteMatches(rule, refHost)));
}

/** Auto-save a downloaded image into the notebook (per the user's settings). */
async function maybeSaveDownload(id: number): Promise<void> {
  const settings = await loadSettings();
  const cfg = settings.autoSaveImages;
  if (cfg.mode === 'off') return;

  const [item] = await browser.downloads.search({ id });
  if (!item) return;
  const url = item.finalUrl || item.url || '';
  if (!/^https?:/i.test(url)) return;
  if (!isImageUrl(url, item.mime)) return;

  // De-duplicate repeat events for the same file, but allow re-saving the
  // same URL later in the session (the user may want it twice).
  if (recentUrls.has(url)) return;
  recentUrls.add(url);
  if (recentUrls.size > 200) {
    const oldest = recentUrls.values().next().value;
    if (oldest) recentUrls.delete(oldest);
  }

  const referrer = (item as { referrer?: string }).referrer ?? '';
  if (!allowedBySettings(cfg, url, referrer)) return;

  const domain = domainOf(url) || url;
  const title = t('autoSaveTitle').replace('{d}', domain);
  try {
    await saveImageFromUrl(url, referrer || url, title);
  } catch (e) {
    // Errors are already logged inside saveImageFromUrl; avoid unhandled rejections.
    void e;
  }
}

/** Register the downloads listener that powers "auto-save downloaded images". */
export function setupAutoSave(): void {
  browser.downloads.onCreated.addListener((item) => {
    void maybeSaveDownload(item.id);
  });
}
