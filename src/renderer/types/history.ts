export interface HistoryEntry {
  id: string;
  url: string;
  title: string;
  favicon?: string;
  visitCount: number;
  lastVisitTime: number;
  firstVisitTime: number;
  typedCount: number; // Number of times user typed this URL (vs clicked)
}

export interface HistoryDatabase {
  entries: Map<string, HistoryEntry>; // keyed by URL
  lastCleanup: number;
}

export const MAX_HISTORY_ENTRIES = 10000;
export const HISTORY_CLEANUP_INTERVAL = 24 * 60 * 60 * 1000; // 24 hours
export const HISTORY_STORAGE_KEY = 'sylph.history.database';
