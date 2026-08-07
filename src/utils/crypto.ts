import crypto from 'crypto';
import bcrypt from 'bcryptjs';

export const cryptoUtils = {
  // Generate random token
  generateToken(length: number = 32): string {
    return crypto.randomBytes(length).toString('hex');
  },

  // Generate random API key
  generateApiKey(): { key: string; hash: string } {
    const key = `dl_${crypto.randomBytes(24).toString('hex')}`;
    const hash = this.hashString(key);
    return { key, hash };
  },

  // Hash string using SHA256
  hashString(str: string): string {
    return crypto.createHash('sha256').update(str).digest('hex');
  },

  // Hash password with bcrypt
  async hashPassword(password: string): Promise<string> {
    return await bcrypt.hash(password, 10);
  },

  // Verify password
  async verifyPassword(password: string, hash: string): Promise<boolean> {
    return await bcrypt.compare(password, hash);
  },

  // Encrypt data (AES-256-GCM)
  encrypt(text: string, secret: string): string {
    const iv = crypto.randomBytes(16);
    const key = crypto.scryptSync(secret, 'salt', 32);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    const encrypted = Buffer.concat([
      cipher.update(text, 'utf8'),
      cipher.final(),
    ]);
    const tag = cipher.getAuthTag();
    return Buffer.concat([iv, tag, encrypted]).toString('base64');
  },

  // Decrypt data (AES-256-GCM)
  decrypt(encrypted: string, secret: string): string {
    const data = Buffer.from(encrypted, 'base64');
    const iv = data.subarray(0, 16);
    const tag = data.subarray(16, 32);
    const encryptedData = data.subarray(32);
    const key = crypto.scryptSync(secret, 'salt', 32);
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    const decrypted = Buffer.concat([
      decipher.update(encryptedData),
      decipher.final(),
    ]);
    return decrypted.toString('utf8');
  },

  // Generate secure random password
  generateSecurePassword(length: number = 16): string {
    const charset = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*()';
    let password = '';
    const randomBytes = crypto.randomBytes(length);
    for (let i = 0; i < length; i++) {
      password += charset[randomBytes[i] % charset.length];
    }
    return password;
  },
};