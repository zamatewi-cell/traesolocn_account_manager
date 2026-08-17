import { safeStorage } from 'electron';
import crypto from 'crypto';
import { logger } from '../utils/logger';

// Trae storage encryption constants (reverse-engineered from byteCrypto.js / trae-usage-monitor)
// MAGIC is 6 bytes: "tc" + version(0x05) + flags(0x10, 0x00, 0x00)
const TRAE_MAGIC = Buffer.from([0x74, 0x63, 0x05, 0x10, 0x00, 0x00]);
const TRAE_SALT_LEN = 32;
const TRAE_HASH_LEN = 64; // SHA-512
const TRAE_AES_KEY_LEN = 16; // AES-128
const TRAE_IV_LEN = 16;

// Hardcoded obfuscation key material (XOR pair from Trae source)
const TRAE_KEY_A = Buffer.from([
  82, 9, 106, 213, 48, 54, 165, 56, 191, 64, 163, 158, 129, 243, 215, 251,
  124, 227, 57, 130, 155, 47, 255, 135, 52, 142, 67, 68, 196, 222, 233, 203,
  84, 123, 148, 50, 166, 194, 35, 61, 238, 76, 149, 11, 66, 250, 195, 78,
  8, 46, 161, 102, 40, 217, 36, 178, 118, 91, 162, 73, 109, 139, 209, 37
]);

const TRAE_KEY_B = Buffer.from([
  31, 221, 168, 51, 136, 7, 199, 49, 177, 18, 16, 89, 39, 128, 236, 95,
  96, 81, 127, 169, 25, 181, 74, 13, 45, 229, 122, 159, 147, 201, 156, 239,
  160, 224, 59, 77, 174, 42, 245, 176, 200, 235, 187, 60, 131, 83, 153, 97,
  23, 43, 4, 126, 186, 119, 214, 38, 225, 105, 20, 99, 85, 33, 12, 125
]);

function getHardcodedPassword(): Buffer {
  const pw = Buffer.alloc(64);
  for (let i = 0; i < 64; i++) {
    pw[i] = TRAE_KEY_A[i] ^ TRAE_KEY_B[i];
  }
  return pw;
}

function sha512(data: Buffer): Buffer {
  return crypto.createHash('sha512').update(data).digest();
}

/**
 * Derive AES key and IV from per-blob salt
 * KDF: SHA512(SHA512(salt) + hardcodedPassword)
 */
function deriveKey(salt: Buffer): { key: Buffer; iv: Buffer } {
  const hardcodedPassword = getHardcodedPassword();
  const shaSalt = sha512(salt);
  const kdfBuf = Buffer.concat([shaSalt, hardcodedPassword]);
  const kdfOut = sha512(kdfBuf);
  return {
    key: kdfOut.subarray(0, TRAE_AES_KEY_LEN),
    iv: kdfOut.subarray(TRAE_AES_KEY_LEN, TRAE_AES_KEY_LEN + TRAE_IV_LEN)
  };
}

export interface CryptoService {
  encryptString(plainText: string): Buffer;
  decryptString(encrypted: Buffer): string;
  /**
   * Check whether a decrypted token looks like a valid Trae JWT access token.
   * A valid token starts with "eyJ" and has the standard 3-part JWT structure.
   */
  isValidToken(token: string): boolean;
  isEncryptionAvailable(): boolean;
  /**
   * Decrypt Trae's custom encrypted blob from storage.json
   * Format: base64(MAGIC(6) + per-blob-salt(32) + AES-128-CBC(SHA512(data) + data))
   * Returns parsed JSON or null on failure.
   */
  decryptTraeBlob(encryptedBase64: string): unknown | null;
  /**
   * Encrypt data in Trae's custom format (for writing back to storage if needed).
   */
  encryptTraeBlob(data: unknown): string;
}

class CryptoServiceImpl implements CryptoService {
  private isAvailable: boolean;

  constructor() {
    this.isAvailable = safeStorage.isEncryptionAvailable();
    logger.info('SafeStorage encryption available:', this.isAvailable);
  }

  encryptString(plainText: string): Buffer {
    if (!this.isAvailable) {
      logger.warn('Encryption not available, storing plaintext (fallback)');
      return Buffer.from(plainText, 'utf-8');
    }
    return safeStorage.encryptString(plainText);
  }

  decryptString(encrypted: Buffer): string {
    if (!this.isAvailable) {
      return encrypted.toString('utf-8');
    }

    try {
      const decrypted = safeStorage.decryptString(encrypted);
      // safeStorage may "succeed" but return corrupted output (U+FFFD replacement
      // chars) when the buffer was NOT actually encrypted by safeStorage (e.g. it
      // was written by an older build using a different format). Detect this and
      // fall back to reading the raw bytes as UTF-8.
      if (decrypted.includes('\uFFFD')) {
        logger.warn('Decryption produced corrupted output, falling back to plaintext');
        return encrypted.toString('utf-8');
      }
      return decrypted;
    } catch (err) {
      logger.warn('Standard decryption failed, trying plaintext fallback');
      try {
        return encrypted.toString('utf-8');
      } catch {
        throw new Error('Failed to decrypt token. The token may be corrupted or encrypted by a different user.');
      }
    }
  }

  isValidToken(token: string): boolean {
    if (!token || typeof token !== 'string') return false;
    // Trae access tokens are JWT: header.payload.signature (3 dot-separated parts)
    const parts = token.split('.');
    return token.startsWith('eyJ') && parts.length === 3 && token.length > 100;
  }

  /**
   * Decrypt Trae's custom encrypted blob from storage.json
   * Based on trae-usage-monitor's decryptBase64Blob function.
   */
  decryptTraeBlob(encryptedBase64: string): unknown | null {
    try {
      const blob = Buffer.from(encryptedBase64.trim(), 'base64');

      if (blob.length < TRAE_MAGIC.length + TRAE_SALT_LEN + TRAE_HASH_LEN + 1) {
        logger.warn('decryptTraeBlob: blob too short');
        return null;
      }

      // Check magic header
      if (!blob.subarray(0, TRAE_MAGIC.length).equals(TRAE_MAGIC)) {
        logger.warn('decryptTraeBlob: invalid magic header', blob.subarray(0, 6).toString('hex'));
        return null;
      }

      // Extract per-blob salt (32 bytes after magic)
      const salt = blob.subarray(TRAE_MAGIC.length, TRAE_MAGIC.length + TRAE_SALT_LEN);
      const ciphertext = blob.subarray(TRAE_MAGIC.length + TRAE_SALT_LEN);

      // Derive key and IV
      const { key, iv } = deriveKey(salt);

      // Decrypt AES-128-CBC
      const decipher = crypto.createDecipheriv('aes-128-cbc', key, iv);
      decipher.setAutoPadding(true);
      const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);

      if (plaintext.length < TRAE_HASH_LEN) {
        logger.warn('decryptTraeBlob: plaintext too short');
        return null;
      }

      // First 64 bytes are SHA-512 hash of the actual data
      const expectedHash = plaintext.subarray(0, TRAE_HASH_LEN);
      const data = plaintext.subarray(TRAE_HASH_LEN);
      const actualHash = sha512(data);

      if (!expectedHash.equals(actualHash)) {
        logger.warn('decryptTraeBlob: integrity check failed (hash mismatch)');
        // Continue anyway - data might still be usable
      }

      const jsonStr = data.toString('utf-8');
      return JSON.parse(jsonStr);
    } catch (err) {
      logger.error('Failed to decrypt Trae blob:', err);
      return null;
    }
  }

  /**
   * Encrypt data in Trae's custom format.
   */
  encryptTraeBlob(data: unknown): string {
    const jsonStr = JSON.stringify(data);
    const dataBuf = Buffer.from(jsonStr, 'utf-8');

    // Generate random per-blob salt
    const salt = crypto.randomBytes(TRAE_SALT_LEN);

    // Derive key and IV
    const { key, iv } = deriveKey(salt);

    // Compute hash of data
    const hash = sha512(dataBuf);

    // Encrypt: AES-128-CBC(hash + data)
    const payload = Buffer.concat([hash, dataBuf]);
    const cipher = crypto.createCipheriv('aes-128-cbc', key, iv);
    cipher.setAutoPadding(true);
    const encrypted = Buffer.concat([cipher.update(payload), cipher.final()]);

    // Combine: MAGIC + salt + ciphertext
    const result = Buffer.concat([TRAE_MAGIC, salt, encrypted]);
    return result.toString('base64');
  }

  isEncryptionAvailable(): boolean {
    return this.isAvailable;
  }
}

// Singleton instance
let cryptoServiceInstance: CryptoService | null = null;

export function getCryptoService(): CryptoService {
  if (!cryptoServiceInstance) {
    cryptoServiceInstance = new CryptoServiceImpl();
  }
  return cryptoServiceInstance;
}
