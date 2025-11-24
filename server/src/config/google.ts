import dotenv from 'dotenv';

dotenv.config();

export const googleConfig = {
  clientId: process.env.GOOGLE_CLIENT_ID || '',
  clientSecret: process.env.GOOGLE_CLIENT_SECRET || '',
  redirectUri: process.env.GOOGLE_REDIRECT_URI || 'http://localhost:3001/api/integrations/google/callback',

  validateConfig(): void {
    if (!this.clientId || !this.clientSecret) {
      throw new Error('❌ Google OAuth credentials not configured. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in .env');
    }
  }
};

export const encryptionConfig = {
  key: process.env.ENCRYPTION_KEY || '',

  validateConfig(): void {
    if (!this.key || this.key.length !== 64) {
      throw new Error('❌ ENCRYPTION_KEY not properly configured. Must be 64 hex characters. Generate with: openssl rand -hex 32');
    }
  }
};

