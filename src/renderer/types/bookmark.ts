export interface Bookmark {
  id: string;
  title: string;
  url: string;
  favicon?: string;
  folderId: string | null; // null = root
  createdAt: number;
  updatedAt: number;
}

export interface BookmarkFolder {
  id: string;
  name: string;
  parentId: string | null; // null = root
  createdAt: number;
  updatedAt: number;
}

export interface BookmarkDatabase {
  bookmarks: Map<string, Bookmark>;
  folders: Map<string, BookmarkFolder>;
}

export const BOOKMARKS_STORAGE_KEY = 'sylph.bookmarks.database';
export const DEFAULT_FOLDER_ID = 'default';
