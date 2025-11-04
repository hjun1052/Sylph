/**
 * FlowPass Service - Main process service for password management
 */

import { app } from 'electron';
import path from 'path';
import * as vaultManager from './vault-manager';
import * as crypto from './crypto';
import type {
  Vault,
  VaultEntry,
  VaultStatus,
  FlowPassConfig,
  CredentialMatch,
  CapturedLogin,
} from './types';

/**
 * FlowPass service singleton
 */
class FlowPassService {
  private vault: Vault | null = null;
  private status: VaultStatus = 'locked';
  private config: FlowPassConfig | null = null;
  private autoLockTimer: NodeJS.Timeout | null = null;
  private captureBuffer: CapturedLogin[] = [];

  /**
   * Get config file path for a profile
   */
  private getConfigPath(profileId: string): string {
    return path.join(
      app.getPath('userData'),
      'Profiles',
      profileId,
      'flowpass.config'
    );
  }

  /**
   * Get vault file path for a profile
   */
  private getVaultPath(profileId: string): string {
    return path.join(
      app.getPath('userData'),
      'Profiles',
      profileId,
      'flowpass.vault'
    );
  }

  /**
   * Initialize FlowPass for a profile
   */
  async initialize(profileId: string): Promise<{ hasVault: boolean; isConfigured: boolean }> {
    const configPath = this.getConfigPath(profileId);
    this.config = await vaultManager.loadConfig(configPath);

    const vaultPath = this.getVaultPath(profileId);
    const hasVault = (await vaultManager.loadEncryptedVault(vaultPath)) !== null;

    return {
      hasVault,
      isConfigured: this.config !== null,
    };
  }

  /**
   * Setup FlowPass with a new master password
   */
  async setup(profileId: string, masterPassword: string): Promise<void> {
    if (this.config) {
      throw new Error('FlowPass is already configured');
    }

    // Create new config
    this.config = vaultManager.createDefaultConfig();

    // Save config
    const configPath = this.getConfigPath(profileId);
    await vaultManager.saveConfig(configPath, this.config);

    // Create and save empty vault
    const emptyVault = vaultManager.createEmptyVault();
    const encrypted = await vaultManager.encryptVault(
      emptyVault,
      masterPassword,
      this.config
    );

    const vaultPath = this.getVaultPath(profileId);
    await vaultManager.saveEncryptedVault(vaultPath, encrypted);

    // Unlock the vault
    this.vault = emptyVault;
    this.status = 'unlocked';
    this.startAutoLockTimer();
  }

  /**
   * Unlock the vault with master password
   */
  async unlock(profileId: string, masterPassword: string): Promise<void> {
    if (!this.config) {
      throw new Error('FlowPass is not configured');
    }

    this.status = 'unlocking';

    try {
      const vaultPath = this.getVaultPath(profileId);
      const encrypted = await vaultManager.loadEncryptedVault(vaultPath);

      if (!encrypted) {
        throw new Error('Vault not found');
      }

      this.vault = await vaultManager.decryptVault(encrypted, masterPassword, this.config);
      this.status = 'unlocked';
      this.startAutoLockTimer();
    } catch (error) {
      this.status = 'locked';
      this.vault = null;
      throw error;
    }
  }

  /**
   * Lock the vault
   */
  lock(): void {
    if (this.vault) {
      // Zero out sensitive data
      for (const entry of this.vault.entries.values()) {
        if (entry.password) {
          // Overwrite password string (best effort)
          entry.password = '\0'.repeat(entry.password.length);
        }
      }
      this.vault = null;
    }

    this.status = 'locked';
    this.clearAutoLockTimer();
  }

  /**
   * Save the vault to disk
   */
  async saveVault(profileId: string, masterPassword: string): Promise<void> {
    if (!this.vault || !this.config) {
      throw new Error('Vault is not unlocked');
    }

    const encrypted = await vaultManager.encryptVault(
      this.vault,
      masterPassword,
      this.config
    );

    const vaultPath = this.getVaultPath(profileId);
    await vaultManager.saveEncryptedVault(vaultPath, encrypted);
  }

  /**
   * Get vault status
   */
  getStatus(): VaultStatus {
    return this.status;
  }

  /**
   * Get all entries (requires unlocked vault)
   */
  getEntries(): VaultEntry[] {
    if (!this.vault) {
      throw new Error('Vault is locked');
    }
    return Array.from(this.vault.entries.values());
  }

  /**
   * Get a single entry by ID
   */
  getEntry(entryId: string): VaultEntry | null {
    if (!this.vault) {
      throw new Error('Vault is locked');
    }
    return this.vault.entries.get(entryId) || null;
  }

  /**
   * Add or update an entry
   */
  setEntry(entry: VaultEntry): void {
    if (!this.vault) {
      throw new Error('Vault is locked');
    }
    vaultManager.setEntry(this.vault, entry);
    this.resetAutoLockTimer();
  }

  /**
   * Delete an entry
   */
  deleteEntry(entryId: string): boolean {
    if (!this.vault) {
      throw new Error('Vault is locked');
    }
    const result = vaultManager.deleteEntry(this.vault, entryId);
    this.resetAutoLockTimer();
    return result;
  }

  /**
   * Get matching entries for a hostname
   */
  getMatches(hostname: string): CredentialMatch[] {
    if (!this.vault) {
      return [];
    }

    // Check if hostname is in never save list
    if (vaultManager.isNeverSaveHost(this.vault, hostname)) {
      return [];
    }

    const entries = vaultManager.getMatchingEntries(this.vault, hostname);

    return entries.map(entry => ({
      entryId: entry.id,
      name: entry.name,
      username: entry.username,
      lastUsedAt: entry.lastUsedAt,
    }));
  }

  /**
   * Get credentials for autofill
   */
  getCredentials(entryId: string): { username: string; password: string } | null {
    if (!this.vault) {
      return null;
    }

    const entry = this.vault.entries.get(entryId);
    if (!entry) {
      return null;
    }

    // Update lastUsedAt
    entry.lastUsedAt = Date.now();
    this.resetAutoLockTimer();

    return {
      username: entry.username,
      password: entry.password,
    };
  }

  /**
   * Capture login credentials
   */
  captureLogin(data: CapturedLogin): void {
    this.captureBuffer.push(data);
    // Keep only last 10 captures
    if (this.captureBuffer.length > 10) {
      this.captureBuffer.shift();
    }
  }

  /**
   * Get captured logins
   */
  getCapturedLogins(): CapturedLogin[] {
    return [...this.captureBuffer];
  }

  /**
   * Clear capture buffer
   */
  clearCaptureBuffer(): void {
    this.captureBuffer = [];
  }

  /**
   * Add hostname to never save list
   */
  addNeverSaveHost(hostname: string): void {
    if (!this.vault) {
      throw new Error('Vault is locked');
    }
    vaultManager.addNeverSaveHost(this.vault, hostname);
  }

  /**
   * Remove hostname from never save list
   */
  removeNeverSaveHost(hostname: string): boolean {
    if (!this.vault) {
      throw new Error('Vault is locked');
    }
    return vaultManager.removeNeverSaveHost(this.vault, hostname);
  }

  /**
   * Get FlowPass configuration
   */
  getConfig(): FlowPassConfig | null {
    return this.config;
  }

  /**
   * Update FlowPass configuration
   */
  async updateConfig(profileId: string, updates: Partial<FlowPassConfig>): Promise<void> {
    if (!this.config) {
      throw new Error('FlowPass is not configured');
    }

    this.config = { ...this.config, ...updates };

    const configPath = this.getConfigPath(profileId);
    await vaultManager.saveConfig(configPath, this.config);

    // Restart auto-lock timer if minutes changed
    if (updates.autoLockMinutes !== undefined) {
      this.startAutoLockTimer();
    }
  }

  /**
   * Start auto-lock timer
   */
  private startAutoLockTimer(): void {
    this.clearAutoLockTimer();

    if (!this.config || this.config.autoLockMinutes <= 0) {
      return;
    }

    const timeoutMs = this.config.autoLockMinutes * 60 * 1000;
    this.autoLockTimer = setTimeout(() => {
      this.lock();
    }, timeoutMs);
  }

  /**
   * Reset auto-lock timer
   */
  private resetAutoLockTimer(): void {
    if (this.status === 'unlocked') {
      this.startAutoLockTimer();
    }
  }

  /**
   * Clear auto-lock timer
   */
  private clearAutoLockTimer(): void {
    if (this.autoLockTimer) {
      clearTimeout(this.autoLockTimer);
      this.autoLockTimer = null;
    }
  }

  /**
   * Change master password
   */
  async changeMasterPassword(
    profileId: string,
    currentPassword: string,
    newPassword: string
  ): Promise<void> {
    if (!this.config || !this.vault) {
      throw new Error('Vault is not unlocked');
    }

    // Verify current password by attempting to decrypt
    const vaultPath = this.getVaultPath(profileId);
    const encrypted = await vaultManager.loadEncryptedVault(vaultPath);
    if (!encrypted) {
      throw new Error('Vault not found');
    }

    // This will throw if password is incorrect
    await vaultManager.decryptVault(encrypted, currentPassword, this.config);

    // Re-encrypt with new password
    const newEncrypted = await vaultManager.encryptVault(
      this.vault,
      newPassword,
      this.config
    );

    await vaultManager.saveEncryptedVault(vaultPath, newEncrypted);
  }

  /**
   * Export vault (encrypted)
   */
  async exportEncrypted(profileId: string): Promise<string> {
    const vaultPath = this.getVaultPath(profileId);
    const encrypted = await vaultManager.loadEncryptedVault(vaultPath);

    if (!encrypted) {
      throw new Error('Vault not found');
    }

    return JSON.stringify(encrypted, null, 2);
  }

  /**
   * Import entries from JSON
   */
  importEntries(entries: VaultEntry[]): void {
    if (!this.vault) {
      throw new Error('Vault is locked');
    }

    for (const entry of entries) {
      vaultManager.setEntry(this.vault, entry);
    }
  }
}

// Export singleton instance
export const flowPassService = new FlowPassService();
