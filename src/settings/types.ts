export type ThemeMode = 'system' | 'light' | 'dark';

export interface Settings {
  theme: ThemeMode;
  /** Accent color as hex, e.g. #4f46e5 */
  accent: string;
  /** Show the floating clip button on web pages */
  floatingButton: boolean;
  backupReminder: boolean;
  /** Reminder interval in days */
  backupReminderDays: number;
  lastBackupAt?: number;
}

export const DEFAULT_SETTINGS: Settings = {
  theme: 'system',
  accent: '#4f46e5',
  floatingButton: true,
  backupReminder: false,
  backupReminderDays: 7,
};

export const BACKUP_INTERVALS: { value: number; label: string }[] = [
  { value: 7, label: 'settingsReminderWeekly' },
  { value: 14, label: 'settingsReminderBiweekly' },
  { value: 30, label: 'settingsReminderMonthly' },
];
