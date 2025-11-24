import crypto from 'crypto';
import { encryptionConfig } from '../config/google';

const ALGORITHM = 'aes-256-gcm';

export class TokenEncryption {
  /**
   * Encrypt a token using AES-256-GCM
   * Returns format: iv.authTag.encrypted
   */
  static encrypt(plaintext: string): string {
    try {
      encryptionConfig.validateConfig();

      const key = Buffer.from(encryptionConfig.key, 'hex');
      const iv = crypto.randomBytes(16);
      const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

      let encrypted = cipher.update(plaintext, 'utf-8', 'hex');
      encrypted += cipher.final('hex');

      const authTag = cipher.getAuthTag();
      return `${iv.toString('hex')}.${authTag.toString('hex')}.${encrypted}`;
    } catch (error) {
      console.error('❌ Encryption error:', error);
      throw new Error('Failed to encrypt token');
    }
  }

  /**
   * Decrypt a token using AES-256-GCM
   */
  static decrypt(ciphertext: string): string {
    try {
      encryptionConfig.validateConfig();

      const [ivHex, authTagHex, encrypted] = ciphertext.split('.');

      if (!ivHex || !authTagHex || !encrypted) {
        throw new Error('Invalid ciphertext format');
      }

      const key = Buffer.from(encryptionConfig.key, 'hex');
      const iv = Buffer.from(ivHex, 'hex');
      const authTag = Buffer.from(authTagHex, 'hex');

      const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
      decipher.setAuthTag(authTag);

      let decrypted = decipher.update(encrypted, 'hex', 'utf-8');
      decrypted += decipher.final('utf-8');

      return decrypted;
    } catch (error) {
      console.error('❌ Decryption error:', error);
      throw new Error('Failed to decrypt token');
    }
  }
}

