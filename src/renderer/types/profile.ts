export interface Profile {
  id: string;
  name: string;
  color: string;
  icon?: string;
  partition: string; // Electron partition name for session isolation
  isIncognito: boolean;
  createdAt: number;
}

export const DEFAULT_PROFILE_ID = 'profile-default';
export const DEFAULT_PROFILE_NAME = 'Default Profile';
export const PROFILES_STORAGE_KEY = 'sylph.profiles.list';
export const PROFILE_COLORS = [
  '#4fb276', // green
  '#60a5fa', // blue
  '#f472b6', // pink
  '#facc15', // yellow
  '#f97316', // orange
  '#a78bfa', // purple
  '#34d399', // emerald
  '#fb7185', // rose
];

export function createDefaultProfile(): Profile {
  return {
    id: DEFAULT_PROFILE_ID,
    name: DEFAULT_PROFILE_NAME,
    color: PROFILE_COLORS[0],
    partition: 'persist:sylph',
    isIncognito: false,
    createdAt: Date.now(),
  };
}

export function createIncognitoProfile(): Profile {
  return {
    id: `profile-incognito-${Date.now()}`,
    name: 'Incognito',
    color: '#6b7280', // gray
    icon: '🕵️',
    partition: `incognito-${Date.now()}`, // Each incognito session gets unique partition
    isIncognito: true,
    createdAt: Date.now(),
  };
}
