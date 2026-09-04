import { browser } from 'wxt/browser';
import { loadSettings } from '@/settings/storage';
import { t } from '@/utils/i18n';

const ALARM = 'nc-backup-reminder';

export async function syncReminderAlarm(): Promise<void> {
  const s = await loadSettings();
  if (s.backupReminder) {
    const period = s.backupReminderDays * 24 * 60; // minutes
    await browser.alarms.create(ALARM, { periodInMinutes: period, delayInMinutes: period });
  } else {
    await browser.alarms.clear(ALARM);
  }
}

export function setupReminder(): void {
  browser.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name !== ALARM) return;
    void browser.notifications
      .create({
        type: 'basic',
        iconUrl: browser.runtime.getURL('/icons/128.png'),
        title: t('reminderTitle'),
        message: t('reminderBody'),
      })
      .catch(() => undefined);
  });

  // The backup reminder is the only notification; clicking it opens the
  // settings page where the export buttons live.
  browser.notifications.onClicked.addListener(() => {
    void browser.runtime.openOptionsPage();
  });

  browser.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes['noteclip:settings']) {
      void syncReminderAlarm();
    }
  });

  void syncReminderAlarm();
}
