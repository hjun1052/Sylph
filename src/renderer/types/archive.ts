export interface ArchivedTab {
  id: string;
  url: string;
  title: string;
  favicon?: string;
  spaceId: string;
  archivedAt: number;
  lastAccessedAt: number;
}

export interface ArchiveSettings {
  enabled: boolean;
  autoArchiveAfterMinutes: number; // Archive tabs inactive for this many minutes
  maxArchivedTabs: number;
}

export const DEFAULT_ARCHIVE_SETTINGS: ArchiveSettings = {
  enabled: true,
  autoArchiveAfterMinutes: 30,
  maxArchivedTabs: 100,
};

export const ARCHIVE_STORAGE_KEY = 'sylph.archive.tabs';
export const ARCHIVE_SETTINGS_STORAGE_KEY = 'sylph.archive.settings';
