import { browser } from 'wxt/browser';

export function t(key: string): string {
  const getMessage = (browser.i18n as unknown as { getMessage: (k: string) => string }).getMessage;
  return getMessage(key) || key;
}

export function relTime(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 60_000) return t('timeJustNow');
  const min = Math.floor(diff / 60_000);
  if (min < 60) return t('timeMinutesAgo').replace('{n}', String(min));
  const hours = Math.floor(min / 60);
  if (hours < 24) return t('timeHoursAgo').replace('{n}', String(hours));
  const days = Math.floor(hours / 24);
  if (days < 30) return t('timeDaysAgo').replace('{n}', String(days));
  return new Date(ts).toLocaleDateString();
}

export function fullTime(ts: number): string {
  return new Date(ts).toLocaleString();
}
