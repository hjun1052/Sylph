/**
 * FlowPass - Vault Manager
 * Handles vault loading, saving, encryption/decryption
 */

import { promises as fs } from 'fs';
import path from 'path';
import * as crypto from './crypto';
import type {
  Vault,
  VaultEntry,
  SerializedVault,
  EncryptedVault,
  FlowPassConfig,
  KDFConfig,
} from './types';

/**
 * Create an empty vault
 */
export function createEmptyVault(): Vault {
  return {
    version: 1,
    entries: new Map(),
    siteIndex: new Map(),
    neverSave: new Set(),
  };
}

/**
 * Serialize vault to JSON-compatible object
 */
export function serializeVault(vault: Vault): SerializedVault {
  return {
    version: vault.version,
    entries: Object.fromEntries(vault.entries),
    neverSave: Array.from(vault.neverSave),
  };
}

/**
 * Deserialize vault from JSON object
 */
export function deserializeVault(data: SerializedVault): Vault {
  const vault: Vault = {
    version: data.version,
    entries: new Map(Object.entries(data.entries)),
    siteIndex: new Map(),
    neverSave: new Set(data.neverSave),
  };

  // Rebuild site index
  rebuildSiteIndex(vault);

  return vault;
}

/**
 * Rebuild site index from vault entries
 */
export function rebuildSiteIndex(vault: Vault): void {
  vault.siteIndex.clear();

  for (const [entryId, entry] of vault.entries) {
    for (const url of entry.urls) {
      try {
        const hostname = new URL(url).hostname;
        const hashedHost = crypto.hashHostname(hostname, 'site-index-salt');

        if (!vault.siteIndex.has(hashedHost)) {
          vault.siteIndex.set(hashedHost, new Set());
        }
        vault.siteIndex.get(hashedHost)!.add(entryId);
      } catch (error) {
        console.warn(`Invalid URL in entry ${entryId}: ${url}`, error);
      }
    }
  }
}

/**
 * Encrypt vault with master password
 */
export async function encryptVault(
  vault: Vault,
  masterPassword: string,
  config: FlowPassConfig
): Promise<EncryptedVault> {
  const key = await crypto.deriveKey(masterPassword, config.kdf);

  try {
    const plaintext = JSON.stringify(serializeVault(vault));
    const nonceStr = crypto.generateNonce();
    const nonce = Buffer.from(nonceStr, 'base64');

    const { ciphertext, tag } = crypto.encrypt(plaintext, key, nonce);

    // Optional: Compute HMAC for additional integrity
    const mac = crypto.computeHMAC(key, nonceStr + ciphertext + tag);

    return {
      version: 1,
      nonce: nonceStr,
      ciphertext,
      tag,
      mac,
    };
  } finally {
    crypto.zeroBuffer(key);
  }
}

/**
 * Decrypt vault with master password
 */
export async function decryptVault(
  encrypted: EncryptedVault,
  masterPassword: string,
  config: FlowPassConfig
): Promise<Vault> {
  const key = await crypto.deriveKey(masterPassword, config.kdf);

  try {
    const nonce = Buffer.from(encrypted.nonce, 'base64');
    const tag = Buffer.from(encrypted.tag, 'base64');

    // Optional: Verify HMAC
    if (encrypted.mac) {
      const valid = crypto.verifyHMAC(
        key,
        encrypted.nonce + encrypted.ciphertext + encrypted.tag,
        encrypted.mac
      );
      if (!valid) {
        throw new Error('Vault integrity check failed (HMAC mismatch)');
      }
    }

    const plaintext = crypto.decrypt(encrypted.ciphertext, key, nonce, tag);
    const serialized: SerializedVault = JSON.parse(plaintext);

    return deserializeVault(serialized);
  } catch (error) {
    if (error instanceof Error && error.message.includes('Unsupported state')) {
      throw new Error('Invalid master password or corrupted vault');
    }
    throw error;
  } finally {
    crypto.zeroBuffer(key);
  }
}

/**
 * Load FlowPass configuration from file
 */
export async function loadConfig(configPath: string): Promise<FlowPassConfig | null> {
  try {
    const raw = await fs.readFile(configPath, 'utf-8');
    const config = JSON.parse(raw) as FlowPassConfig;

    // Validate config
    if (!config.kdf || !config.kdf.salt || !config.kdf.params) {
      throw new Error('Invalid config: missing KDF configuration');
    }

    return config;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return null;
    }
    throw error;
  }
}

/**
 * Save FlowPass configuration to file
 */
export async function saveConfig(
  configPath: string,
  config: FlowPassConfig
): Promise<void> {
  const dir = path.dirname(configPath);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(configPath, JSON.stringify(config, null, 2), 'utf-8');
}

/**
 * Load encrypted vault from file
 */
export async function loadEncryptedVault(
  vaultPath: string
): Promise<EncryptedVault | null> {
  try {
    const raw = await fs.readFile(vaultPath, 'utf-8');
    const encrypted = JSON.parse(raw) as EncryptedVault;

    // Validate structure
    if (!encrypted.nonce || !encrypted.ciphertext || !encrypted.tag) {
      throw new Error('Invalid vault file: missing required fields');
    }

    return encrypted;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return null;
    }
    throw error;
  }
}

/**
 * Save encrypted vault to file
 */
export async function saveEncryptedVault(
  vaultPath: string,
  encrypted: EncryptedVault
): Promise<void> {
  const dir = path.dirname(vaultPath);
  await fs.mkdir(dir, { recursive: true });

  // Write to temp file first, then rename (atomic operation)
  const tempPath = `${vaultPath}.tmp`;
  await fs.writeFile(tempPath, JSON.stringify(encrypted, null, 2), 'utf-8');
  await fs.rename(tempPath, vaultPath);
}

/**
 * Create default FlowPass configuration
 */
export function createDefaultConfig(): FlowPassConfig {
  return {
    version: 1,
    kdf: crypto.createDefaultKDFConfig(),
    keychainMode: 'manual',
    autoLockMinutes: 10,
  };
}

/**
 * Add or update entry in vault
 */
export function setEntry(vault: Vault, entry: VaultEntry): void {
  vault.entries.set(entry.id, entry);
  entry.updatedAt = Date.now();

  // Update site index
  for (const url of entry.urls) {
    try {
      const hostname = new URL(url).hostname;
      const hashedHost = crypto.hashHostname(hostname, 'site-index-salt');

      if (!vault.siteIndex.has(hashedHost)) {
        vault.siteIndex.set(hashedHost, new Set());
      }
      vault.siteIndex.get(hashedHost)!.add(entry.id);
    } catch (error) {
      console.warn(`Invalid URL in entry ${entry.id}: ${url}`, error);
    }
  }
}

/**
 * Remove entry from vault
 */
export function deleteEntry(vault: Vault, entryId: string): boolean {
  const entry = vault.entries.get(entryId);
  if (!entry) return false;

  // Remove from site index
  for (const url of entry.urls) {
    try {
      const hostname = new URL(url).hostname;
      const hashedHost = crypto.hashHostname(hostname, 'site-index-salt');
      const entrySet = vault.siteIndex.get(hashedHost);
      if (entrySet) {
        entrySet.delete(entryId);
        if (entrySet.size === 0) {
          vault.siteIndex.delete(hashedHost);
        }
      }
    } catch (error) {
      // Ignore invalid URLs
    }
  }

  vault.entries.delete(entryId);
  return true;
}

/**
 * Get matching entries for a hostname
 */
export function getMatchingEntries(vault: Vault, hostname: string): VaultEntry[] {
  const hashedHost = crypto.hashHostname(hostname.toLowerCase(), 'site-index-salt');
  const entryIds = vault.siteIndex.get(hashedHost);

  if (!entryIds || entryIds.size === 0) {
    return [];
  }

  const entries = Array.from(entryIds)
    .map(id => vault.entries.get(id))
    .filter((entry): entry is VaultEntry => entry !== undefined);

  // Sort by lastUsedAt (most recent first)
  entries.sort((a, b) => b.lastUsedAt - a.lastUsedAt);

  return entries;
}

/**
 * Mark hostname as never save
 */
export function addNeverSaveHost(vault: Vault, hostname: string): void {
  const hashedHost = crypto.hashHostname(hostname.toLowerCase(), 'site-index-salt');
  vault.neverSave.add(hashedHost);
}

/**
 * Check if hostname is in never save list
 */
export function isNeverSaveHost(vault: Vault, hostname: string): boolean {
  const hashedHost = crypto.hashHostname(hostname.toLowerCase(), 'site-index-salt');
  return vault.neverSave.has(hashedHost);
}

/**
 * Remove hostname from never save list
 */
export function removeNeverSaveHost(vault: Vault, hostname: string): boolean {
  const hashedHost = crypto.hashHostname(hostname.toLowerCase(), 'site-index-salt');
  return vault.neverSave.delete(hashedHost);
}
