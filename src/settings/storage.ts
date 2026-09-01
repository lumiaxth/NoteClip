import { browser } from 'wxt/browser';
import { DEFAULT_SETTINGS, type Settings } from './types';

export const SETTINGS_KEY = 'noteclip:settings';

export async function loadSettings(): Promise<Settings> {
  const stored = await browser.storage.local.get(SETTINGS_KEY);
  const raw = stored[SETTINGS_KEY] as Partial<Settings> | undefined;
  const merged: Settings = { ...DEFAULT_SETTINGS, ...(raw ?? {}) };
  // Nested objects need a deep default merge in case older stored data
  // predates a field (or carries a partial object).
  merged.autoSaveImages = { ...DEFAULT_SETTINGS.autoSaveImages, ...(raw?.autoSaveImages ?? {}) };
  return merged;
}

export async function saveSettings(patch: Partial<Settings>): Promise<Settings> {
  const current = await loadSettings();
  const next: Settings = { ...current, ...patch };
  await browser.storage.local.set({ [SETTINGS_KEY]: next });
  return next;
}
