export type NotificationLevel = 'info' | 'success' | 'warning' | 'error';

export interface NotificationEntry {
  id: string;
  level: NotificationLevel;
  title?: string;
  message: string;
  timestamp: number;
  /** Toast has been dismissed (by timeout or manually) — still kept in history until clearAll(). */
  dismissed: boolean;
  /** Marked true once the user opens the history panel — drives the bell's unread badge. */
  read: boolean;
}
