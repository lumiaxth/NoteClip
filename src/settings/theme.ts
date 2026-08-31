import { browser } from 'wxt/browser';
import { loadSettings } from './storage';
import type { Settings, ThemeMode } from './types';

const mql =
  typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia('(prefers-color-scheme: dark)')
    : undefined;

export function resolveTheme(mode: ThemeMode): 'light' | 'dark' {
  if (mode === 'light' || mode === 'dark') return mode;
  return mql?.matches ? 'dark' : 'light';
}

/** Apply theme + accent to the current document. */
export function applyTheme(settings: Settings): void {
  const root = document.documentElement;
  const theme = resolveTheme(settings.theme);
  root.dataset.theme = theme;
  root.style.setProperty('color-scheme', theme === 'dark' ? 'dark' : 'light');
  root.style.setProperty('--primary', settings.accent);
  root.style.setProperty('--primary-soft', `color-mix(in srgb, ${settings.accent} 14%, transparent)`);
  root.style.setProperty('--primary-softer', `color-mix(in srgb, ${settings.accent} 8%, transparent)`);
}

/** Initialize theme on a UI page and keep it in sync. Returns a cleanup fn. */
export async function initTheme(): Promise<() => void> {
  const settings = await loadSettings();
  applyTheme(settings);

  const onStorage = (
    changes: { [key: string]: { newValue?: unknown; oldValue?: unknown } },
    area: string,
  ): void => {
    if (area === 'local' && changes['noteclip:settings']) {
      const next = changes['noteclip:settings'].newValue as Settings | undefined;
      if (next) applyTheme(next);
    }
  };
  browser.storage.onChanged.addListener(onStorage);

  const onMedia = (): void => {
    void loadSettings().then(applyTheme);
  };
  if (mql) mql.addEventListener('change', onMedia);

  return () => {
    browser.storage.onChanged.removeListener(onStorage);
    mql?.removeEventListener('change', onMedia);
  };
}
