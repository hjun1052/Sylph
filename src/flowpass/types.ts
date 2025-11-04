/**
 * FlowPass - Password Manager for Sylph
 * Core type definitions
 */

/**
 * Single credential entry in the vault
 */
export type VaultEntry = {
  id: string;
  name: string;
  urls: string[];
  username: string;
  password: string; // decrypted in memory only
  notes: string;
  customFields: Array<{ id: string; label: string; value: string; type?: 'text' | 'password' }>;
  createdAt: number;
  updatedAt: number;
  lastUsedAt: number;
  totpSecret?: string;
  tags?: string[];
};

/**
 * In-memory vault structure
 */
export type Vault = {
  version: number;
  entries: Map<string, VaultEntry>;
  siteIndex: Map<string /* hashed host */, Set<string /* entryId */>>;
  neverSave: Set<string /* hashed host */>;
};

/**
 * Serialized vault (for JSON storage)
 */
export type SerializedVault = {
  version: number;
  entries: Record<string, VaultEntry>;
  neverSave: string[];
};

/**
 * KDF configuration
 */
export type KDFConfig = {
  type: 'argon2id';
  salt: string; // base64
  params: {
    time: number;
    memory: number; // in KiB
    parallelism: number;
  };
};

/**
 * FlowPass configuration (stored unencrypted)
 */
export type FlowPassConfig = {
  version: number;
  kdf: KDFConfig;
  keychainMode: 'manual' | 'keychain';
  autoLockMinutes: number;
};

/**
 * Encrypted vault file format
 */
export type EncryptedVault = {
  version: number;
  nonce: string; // base64, 12 bytes
  ciphertext: string; // base64
  tag: string; // base64, 16 bytes
  mac?: string; // base64, HMAC-SHA256 (optional)
};

/**
 * Vault status
 */
export type VaultStatus = 'locked' | 'unlocking' | 'unlocked';

/**
 * Credential match candidate for autofill
 */
export type CredentialMatch = {
  entryId: string;
  name: string;
  username: string;
  lastUsedAt: number;
};

/**
 * Login capture data
 */
export type CapturedLogin = {
  host: string;
  url: string;
  username: string;
  password: string;
  timestamp: number;
};

/**
 * Password audit result
 */
export type PasswordAudit = {
  weak: VaultEntry[];
  reused: Array<{ password: string; entries: VaultEntry[] }>;
  old: VaultEntry[]; // not changed in 90+ days
};

/**
 * Import/Export format
 */
export type ExportFormat = 'encrypted' | 'csv' | 'json';

export type ImportSource = 'csv' | 'json';

/**
 * Column mapping for CSV import
 */
export type CSVColumnMapping = {
  name?: number;
  url?: number;
  username?: number;
  password?: number;
  notes?: number;
};
