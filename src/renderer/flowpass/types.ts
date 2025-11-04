/**
 * FlowPass Renderer Types
 */

export type VaultStatus = 'locked' | 'unlocking' | 'unlocked';

export type VaultEntry = {
  id: string;
  name: string;
  urls: string[];
  username: string;
  password: string;
  notes: string;
  customFields: Array<{ id: string; label: string; value: string; type?: 'text' | 'password' }>;
  createdAt: number;
  updatedAt: number;
  lastUsedAt: number;
  totpSecret?: string;
  tags?: string[];
};

export type FlowPassConfig = {
  version: number;
  kdf: {
    type: 'argon2id';
    salt: string;
    params: {
      time: number;
      memory: number;
      parallelism: number;
    };
  };
  keychainMode: 'manual' | 'keychain';
  autoLockMinutes: number;
};

export type FlowPassState = {
  status: VaultStatus;
  entries: VaultEntry[];
  config: FlowPassConfig | null;
  isInitialized: boolean;
  hasVault: boolean;
  isConfigured: boolean;
  error: string | null;
};
