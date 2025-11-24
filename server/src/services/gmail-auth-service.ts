import { google } from 'googleapis';
import { query } from '../config/database';
import { googleConfig } from '../config/google';
import { TokenEncryption } from '../utils/encryption';
import crypto from 'crypto';

interface GoogleTokens {
  access_token: string;
  refresh_token: string;
  expires_at: number;
}

interface GmailIntegration {
  id: string;
  user_id: string;
  access_token: string;
  refresh_token: string;
  expires_at: string;
  history_id: string | null;
  sync_status: string;
  sync_error: string | null;
  created_at: string;
  updated_at: string;
}

export class GmailAuthService {
  private oauth2Client = new google.auth.OAuth2(
    googleConfig.clientId,
    googleConfig.clientSecret,
    googleConfig.redirectUri
  );

  private stateStore = new Map<string, { userId: string; createdAt: number }>();

  /**
   * Generate OAuth authorization URL with PKCE + state
   */
  generateAuthUrl(userId: string): string {
    googleConfig.validateConfig();

    const state = crypto.randomBytes(32).toString('hex');

    this.stateStore.set(state, {
      userId,
      createdAt: Date.now(),
    });

    console.log(`📌 Generated OAuth state for user ${userId}`);

    return this.oauth2Client.generateAuthUrl({
      access_type: 'offline',
      scope: [
        'https://www.googleapis.com/auth/gmail.readonly',
        'https://www.googleapis.com/auth/calendar.readonly',
      ],
      state,
      prompt: 'consent',
    });
  }

  /**
   * Validate OAuth state to prevent CSRF
   */
  private validateState(state: string): { userId: string } | null {
    const stateData = this.stateStore.get(state);

    if (!stateData) {
      console.warn('⚠️  Invalid OAuth state (not found)');
      return null;
    }

    if (Date.now() - stateData.createdAt > 10 * 60 * 1000) {
      console.warn('⚠️  Invalid OAuth state (expired)');
      this.stateStore.delete(state);
      return null;
    }

    this.stateStore.delete(state);
    return { userId: stateData.userId };
  }

  /**
   * Exchange authorization code for tokens
   */
  async exchangeCode(code: string, state: string): Promise<{ userId: string }> {
    try {
      const stateData = this.validateState(state);
      if (!stateData) {
        throw new Error('Invalid or expired OAuth state');
      }

      const { tokens } = await this.oauth2Client.getToken(code);

      const accessToken = tokens.access_token!;
      const refreshToken = tokens.refresh_token;
      const expiresAt = tokens.expiry_date!;

      if (!refreshToken) {
        throw new Error('No refresh token received. Ensure "offline" access is configured.');
      }

      const encryptedAccessToken = TokenEncryption.encrypt(accessToken);
      const encryptedRefreshToken = TokenEncryption.encrypt(refreshToken);

      await query(
        `INSERT INTO gmail_integrations 
         (user_id, access_token, refresh_token, expires_at, sync_status, label_filters)
         VALUES ($1, $2, $3, to_timestamp($4/1000), 'idle', '["INBOX"]'::jsonb)
         ON CONFLICT (user_id) DO UPDATE SET
           access_token = EXCLUDED.access_token,
           refresh_token = EXCLUDED.refresh_token,
           expires_at = EXCLUDED.expires_at,
           updated_at = NOW()`,
        [stateData.userId, encryptedAccessToken, encryptedRefreshToken, expiresAt]
      );

      console.log(`✅ Gmail credentials stored for user: ${stateData.userId}`);
      return { userId: stateData.userId };
    } catch (error) {
      console.error('❌ Error exchanging OAuth code:', error);
      throw error;
    }
  }

  /**
   * Refresh access token if expired
   */
  async ensureValidToken(userId: string): Promise<string> {
    try {
      const result = await query(
        'SELECT access_token, refresh_token, expires_at FROM gmail_integrations WHERE user_id = $1',
        [userId]
      );

      if (result.rows.length === 0) {
        throw new Error('Gmail integration not found for user');
      }

      const row = result.rows[0];
      const accessToken = TokenEncryption.decrypt(row.access_token);
      const refreshToken = TokenEncryption.decrypt(row.refresh_token);
      const expiresAt = new Date(row.expires_at);

      if (expiresAt > new Date()) {
        return accessToken;
      }

      this.oauth2Client.setCredentials({ refresh_token: refreshToken });
      const { credentials } = await this.oauth2Client.refreshAccessToken();

      const newAccessToken = credentials.access_token!;
      const newExpiresAt = credentials.expiry_date!;
      const encryptedNewToken = TokenEncryption.encrypt(newAccessToken);

      await query(
        `UPDATE gmail_integrations 
         SET access_token = $1, expires_at = to_timestamp($2/1000), updated_at = NOW()
         WHERE user_id = $3`,
        [encryptedNewToken, newExpiresAt, userId]
      );

      console.log(`🔄 Refreshed Gmail token for user: ${userId}`);
      return newAccessToken;
    } catch (error) {
      console.error('❌ Error ensuring valid token:', error);
      throw error;
    }
  }

  /**
   * Get Gmail integration status
   */
  async getIntegrationStatus(userId: string): Promise<GmailIntegration | null> {
    try {
      const result = await query(
        'SELECT * FROM gmail_integrations WHERE user_id = $1',
        [userId]
      );

      return result.rows.length > 0 ? result.rows[0] : null;
    } catch (error) {
      console.error('❌ Error fetching integration status:', error);
      return null;
    }
  }

  /**
   * Disconnect Gmail integration
   */
  async disconnect(userId: string): Promise<void> {
    try {
      await query('DELETE FROM gmail_integrations WHERE user_id = $1', [userId]);

      console.log(`✅ Disconnected Gmail for user: ${userId}`);
    } catch (error) {
      console.error('❌ Error disconnecting Gmail:', error);
      throw error;
    }
  }
}

export const gmailAuthService = new GmailAuthService();

