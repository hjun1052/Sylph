/**
 * FlowPass - Cryptographic utilities
 * Handles key derivation (Argon2id) and encryption (AES-256-GCM)
 */

import * as crypto from 'crypto';
import argon2 from 'argon2';
import type { KDFConfig } from './types';

/**
 * Generate a cryptographically secure random salt
 * @param length - Salt length in bytes (default: 32)
 * @returns base64-encoded salt
 */
export function generateSalt(length = 32): string {
  return crypto.randomBytes(length).toString('base64');
}

/**
 * Generate a cryptographically secure random nonce for AES-GCM
 * @returns base64-encoded nonce (12 bytes)
 */
export function generateNonce(): string {
  return crypto.randomBytes(12).toString('base64');
}

/**
 * Derive a 256-bit key from master password using Argon2id
 * @param masterPassword - User's master password
 * @param config - KDF configuration (salt and parameters)
 * @returns 32-byte derived key
 */
export async function deriveKey(
  masterPassword: string,
  config: KDFConfig
): Promise<Buffer> {
  const salt = Buffer.from(config.salt, 'base64');

  // Type assertion needed because @types/argon2 is outdated (v0.14 vs actual v0.44)
  const hash = await argon2.hash(masterPassword, {
    type: 2, // argon2id
    salt,
    saltLength: salt.length,
    timeCost: config.params.time,
    memoryCost: config.params.memory,
    parallelism: config.params.parallelism,
    hashLength: 32,
    raw: true, // Return raw buffer instead of encoded string
  } as any);

  return Buffer.isBuffer(hash) ? hash : Buffer.from(hash);
}

/**
 * Encrypt plaintext using AES-256-GCM
 * @param plaintext - Data to encrypt
 * @param key - 32-byte encryption key
 * @param nonce - 12-byte nonce (IV)
 * @returns Object containing ciphertext and authentication tag
 */
export function encrypt(
  plaintext: string,
  key: Buffer,
  nonce: Buffer
): { ciphertext: string; tag: string } {
  const cipher = crypto.createCipheriv('aes-256-gcm', key, nonce);

  let ciphertext = cipher.update(plaintext, 'utf8', 'base64');
  ciphertext += cipher.final('base64');

  const tag = cipher.getAuthTag().toString('base64');

  return { ciphertext, tag };
}

/**
 * Decrypt ciphertext using AES-256-GCM
 * @param ciphertext - base64-encoded encrypted data
 * @param key - 32-byte encryption key
 * @param nonce - 12-byte nonce (IV)
 * @param tag - 16-byte authentication tag
 * @returns Decrypted plaintext
 * @throws Error if authentication fails or decryption fails
 */
export function decrypt(
  ciphertext: string,
  key: Buffer,
  nonce: Buffer,
  tag: Buffer
): string {
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, nonce);
  decipher.setAuthTag(tag);

  let plaintext = decipher.update(ciphertext, 'base64', 'utf8');
  plaintext += decipher.final('utf8');

  return plaintext;
}

/**
 * Compute HMAC-SHA256 for additional integrity verification
 * @param key - HMAC key
 * @param data - Data to authenticate
 * @returns base64-encoded HMAC
 */
export function computeHMAC(key: Buffer, data: string): string {
  const hmac = crypto.createHmac('sha256', key);
  hmac.update(data);
  return hmac.digest('base64');
}

/**
 * Verify HMAC-SHA256
 * @param key - HMAC key
 * @param data - Data to verify
 * @param expectedMAC - Expected HMAC value (base64)
 * @returns true if MAC is valid
 */
export function verifyHMAC(key: Buffer, data: string, expectedMAC: string): boolean {
  const computed = computeHMAC(key, data);
  return crypto.timingSafeEqual(
    Buffer.from(computed, 'base64'),
    Buffer.from(expectedMAC, 'base64')
  );
}

/**
 * Securely zero out a buffer
 * @param buffer - Buffer to zero
 */
export function zeroBuffer(buffer: Buffer): void {
  if (buffer && Buffer.isBuffer(buffer)) {
    buffer.fill(0);
  }
}

/**
 * Hash a hostname for site index
 * @param hostname - Hostname to hash
 * @param salt - Salt for hashing
 * @returns base64-encoded hash
 */
export function hashHostname(hostname: string, salt: string): string {
  const hmac = crypto.createHmac('sha256', salt);
  hmac.update(hostname.toLowerCase());
  return hmac.digest('base64');
}

/**
 * Generate a secure random password
 * @param length - Password length (default: 16)
 * @param options - Character set options
 * @returns Generated password
 */
export function generatePassword(
  length = 16,
  options: {
    uppercase?: boolean;
    lowercase?: boolean;
    numbers?: boolean;
    symbols?: boolean;
  } = {}
): string {
  const {
    uppercase = true,
    lowercase = true,
    numbers = true,
    symbols = true,
  } = options;

  let charset = '';
  if (uppercase) charset += 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  if (lowercase) charset += 'abcdefghijklmnopqrstuvwxyz';
  if (numbers) charset += '0123456789';
  if (symbols) charset += '!@#$%^&*()_+-=[]{}|;:,.<>?';

  if (charset.length === 0) {
    throw new Error('At least one character set must be enabled');
  }

  const randomBytes = crypto.randomBytes(length);
  let password = '';

  for (let i = 0; i < length; i++) {
    const randomIndex = randomBytes[i] % charset.length;
    password += charset[randomIndex];
  }

  return password;
}

/**
 * Create default KDF configuration
 * @returns Default KDF config with generated salt
 */
export function createDefaultKDFConfig(): KDFConfig {
  return {
    type: 'argon2id',
    salt: generateSalt(32),
    params: {
      time: 3,
      memory: 65536, // 64 MiB
      parallelism: 1,
    },
  };
}
