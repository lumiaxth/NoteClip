export type ThemeMode = 'system' | 'light' | 'dark';

export type AutoSaveMode = 'off' | 'all' | 'sites';

export interface AutoSaveImages {
  /** off: disabled; all: every site; sites: only the listed domains */
  mode: AutoSaveMode;
  /** Domain list for the `sites` mode, one entry per row, e.g. weibo.com */
  sites: string[];
}

export interface Settings {
  theme: ThemeMode;
  /** Accent color as hex, e.g. #4f46e5 */
  accent: string;
  /** Show the floating clip button on web pages */
  floatingButton: boolean;
  /** Auto-save downloaded images into the notebook */
  autoSaveImages: AutoSaveImages;
  backupReminder: boolean;
  /** Reminder interval in days */
  backupReminderDays: number;
  lastBackupAt?: number;
}

export const DEFAULT_SETTINGS: Settings = {
  theme: 'system',
  accent: '#4f46e5',
  floatingButton: true,
  autoSaveImages: { mode: 'off', sites: [] },
  backupReminder: false,
  backupReminderDays: 7,
};

export const BACKUP_INTERVALS: { value: number; label: string }[] = [
  { value: 7, label: 'settingsReminderWeekly' },
  { value: 14, label: 'settingsReminderBiweekly' },
  { value: 30, label: 'settingsReminderMonthly' },
];
