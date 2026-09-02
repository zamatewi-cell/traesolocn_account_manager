import { createCipheriv, createDecipheriv, pbkdf2Sync, randomBytes } from 'crypto';
import type { ExportAccount } from '../../shared/types';

export interface EncryptedExportEnvelope {
  format: 'trae-account-manager-encrypted';
  version: 1;
  kdf: 'pbkdf2-sha256';
  iterations: number;
  salt: string;
  cipher: 'aes-256-gcm';
  iv: string;
  tag: string;
  ciphertext: string;
}

const EXPORT_AAD = Buffer.from('trae-account-manager-export-v1', 'utf-8');
const EXPORT_KDF_ITERATIONS = 210_000;

export function isEncryptedExportEnvelope(value: unknown): value is EncryptedExportEnvelope {
  if (!value || typeof value !== 'object') return false;
  const obj = value as Partial<EncryptedExportEnvelope>;
  return obj.format === 'trae-account-manager-encrypted' && obj.version === 1;
}

export function encryptExport(data: ExportAccount, password: string): EncryptedExportEnvelope {
  if (password.length < 8) throw new Error('备份密码至少需要 8 个字符');
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const key = pbkdf2Sync(password, salt, EXPORT_KDF_ITERATIONS, 32, 'sha256');
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(EXPORT_AAD);
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(data), 'utf-8'),
    cipher.final(),
  ]);
  return {
    format: 'trae-account-manager-encrypted',
    version: 1,
    kdf: 'pbkdf2-sha256',
    iterations: EXPORT_KDF_ITERATIONS,
    salt: salt.toString('base64'),
    cipher: 'aes-256-gcm',
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    ciphertext: ciphertext.toString('base64'),
  };
}

export function decryptExport(envelope: EncryptedExportEnvelope, password: string): unknown {
  if (!password) throw new Error('此备份已加密，请输入备份密码');
  if (
    envelope.kdf !== 'pbkdf2-sha256' ||
    envelope.cipher !== 'aes-256-gcm' ||
    envelope.iterations < 100_000 ||
    envelope.iterations > 1_000_000
  ) {
    throw new Error('不支持的备份加密格式');
  }
  try {
    const salt = Buffer.from(envelope.salt, 'base64');
    const iv = Buffer.from(envelope.iv, 'base64');
    const tag = Buffer.from(envelope.tag, 'base64');
    const ciphertext = Buffer.from(envelope.ciphertext, 'base64');
    const key = pbkdf2Sync(password, salt, envelope.iterations, 32, 'sha256');
    const decipher = createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAAD(EXPORT_AAD);
    decipher.setAuthTag(tag);
    const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    return JSON.parse(plaintext.toString('utf-8'));
  } catch {
    throw new Error('备份密码错误或文件已损坏');
  }
}
