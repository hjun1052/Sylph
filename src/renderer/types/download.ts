export interface DownloadItem {
  id: string;
  filename: string;
  url: string;
  savePath: string;
  totalBytes: number;
  receivedBytes: number;
  startTime: number;
  endTime?: number;
  state: 'progressing' | 'completed' | 'cancelled' | 'interrupted';
  isPaused: boolean;
  canResume: boolean;
  error?: string;
  mimeType?: string;
}

export interface DownloadDatabase {
  downloads: Map<string, DownloadItem>;
  lastCleanup: number;
}

export const DOWNLOADS_STORAGE_KEY = 'sylph.downloads.database';
export const MAX_DOWNLOAD_HISTORY = 1000;
