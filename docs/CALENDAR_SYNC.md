# Calendar Sync Integration Guide

> **Status:** Implementation guide for Gmail and Outlook calendar synchronization  
> **Last Updated:** November 2025  
> **Maintainer:** DerPlanner Dev Team

---

## Table of Contents

1. [Overview](#overview)
2. [Architecture](#architecture)
3. [Gmail Integration](#gmail-integration)
4. [Outlook Integration](#outlook-integration)
5. [Data Model](#data-model)
6. [Frontend Implementation](#frontend-implementation)
7. [Testing & Deployment](#testing--deployment)
8. [Troubleshooting](#troubleshooting)

---

## Overview

This guide outlines the implementation of calendar synchronization for DerPlanner, supporting both **Gmail** and **Outlook** calendar sources. The integration follows these principles:

- **No AI classifiers:** All matching is deterministic, based on structured calendar data and explicit user mappings.
- **SOLID principles:** Services are isolated; controllers remain thin.
- **Non-destructive:** User edits within DerPlanner are preserved; external changes are merged intelligently.
- **Transparent:** Users see sync status, can manually trigger syncs, and can disconnect anytime.

### Supported Features

| Feature | Gmail | Outlook |
|---------|-------|---------|
| Read calendar events | ✅ | ✅ |
| Incremental sync (delta) | ✅ | ✅ |
| Real-time updates (webhooks) | ✅ | ✅ |
| Write events back | ❌ (Phase 2) | ❌ (Phase 2) |
| Task import | ✅ (labels) | ✅ (To Do lists) |

---

## Architecture

### High-Level Flow

```
User Clicks "Connect Gmail/Outlook"
        ↓
OAuth Authorization (user browser)
        ↓
Backend receives auth code & exchanges for tokens
        ↓
Tokens stored encrypted in DB
        ↓
Initial sync: fetch all events + calendar items
        ↓
Events inserted/merged into DerPlanner `events` table
        ↓
UI automatically reflects new events (existing hooks)
        ↓
Incremental sync via delta queries or webhooks every N minutes
        ↓
Webhook/notification received → re-run sync service
```

### Service Layering

```
Express Routes (thin controllers)
    ↓
Auth Services (token management)
    ↓
Sync Services (event fetching & mapping)
    ↓
Repository Layer (database operations)
    ↓
PostgreSQL
```

### Database Schema (New Tables)

#### `gmail_integrations`

```sql
CREATE TABLE gmail_integrations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id VARCHAR(255) NOT NULL UNIQUE,
  access_token TEXT NOT NULL (ENCRYPTED),
  refresh_token TEXT NOT NULL (ENCRYPTED),
  expires_at TIMESTAMPTZ,
  history_id VARCHAR(255),
  label_filters JSONB DEFAULT '[]'::jsonb,
  last_sync_at TIMESTAMPTZ,
  sync_status VARCHAR(20) DEFAULT 'idle' CHECK (sync_status IN ('idle', 'syncing', 'error')),
  sync_error TEXT,
  watch_expiration TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX idx_gmail_user_id (user_id),
  INDEX idx_gmail_last_sync (last_sync_at)
);
```

#### `outlook_integrations`

```sql
CREATE TABLE outlook_integrations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id VARCHAR(255) NOT NULL UNIQUE,
  access_token TEXT NOT NULL (ENCRYPTED),
  refresh_token TEXT NOT NULL (ENCRYPTED),
  expires_at TIMESTAMPTZ,
  delta_token VARCHAR(2048),
  preferred_calendars JSONB DEFAULT '[]'::jsonb,
  preferred_todo_lists JSONB DEFAULT '[]'::jsonb,
  subscription_id VARCHAR(255),
  subscription_expiration TIMESTAMPTZ,
  last_sync_at TIMESTAMPTZ,
  sync_status VARCHAR(20) DEFAULT 'idle' CHECK (sync_status IN ('idle', 'syncing', 'error')),
  sync_error TEXT,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX idx_outlook_user_id (user_id),
  INDEX idx_outlook_last_sync (last_sync_at)
);
```

#### Extended `events` Table

Add these columns to track external sources:

```sql
ALTER TABLE events ADD COLUMN IF NOT EXISTS
  sync_source VARCHAR(20) CHECK (sync_source IN ('manual', 'gmail', 'outlook')),
  external_id JSONB DEFAULT '{}',
  last_external_sync TIMESTAMPTZ,
  is_read_only BOOLEAN DEFAULT false;

CREATE INDEX idx_events_sync_source ON events(sync_source);
CREATE INDEX idx_events_external_id ON events USING GIN(external_id);
```

**Note on `external_id`:** Store as JSONB mapping provider → ID string:
```json
{
  "gmail": "1234567890abc",
  "outlook": "AAMkAGY2YmNkYTEwLWQwMzMtNDIyYy04NzQ1LWI4MDU2MDI5ZjAzYQBGAAAAAABwRAXwBwEJSKuMGb9lRQcnBwCJkIl7nDFMS7nwZ..."
}
```

---

## Gmail Integration

### Phase 1: Google Cloud Setup

#### 1.1 Create Google Cloud Project

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create new project: `derplanner-gmail-sync`
3. Enable APIs:
   - Gmail API
   - Google Calendar API (optional, for future enhancements)

#### 1.2 Create OAuth 2.0 Credentials

1. Navigate to **APIs & Services > Credentials**
2. Click **Create Credentials > OAuth client ID**
3. Choose **Web application**
4. Authorized redirect URIs:
   - Development: `http://localhost:3001/api/integrations/google/callback`
   - Production: `https://api.derplanner.space/api/integrations/google/callback`
5. Download credentials JSON; copy `client_id` and `client_secret`

#### 1.3 Configure OAuth Consent Screen

1. Go to **OAuth Consent Screen**
2. Choose **External** user type
3. Fill required fields:
   - App name: `DerPlanner`
   - Support email: your email
   - Developer contact: your email
4. Add scopes:
   - `https://www.googleapis.com/auth/gmail.readonly` (read emails & labels)
   - `https://www.googleapis.com/auth/calendar.readonly` (optional, Phase 2)
5. Save & continue
6. Add yourself as test user

### Phase 2: Backend Implementation

#### 2.1 Environment Configuration

Add to `server/.env`:

```env
# Gmail / Google OAuth
GOOGLE_CLIENT_ID=your_client_id_here
GOOGLE_CLIENT_SECRET=your_client_secret_here
GOOGLE_REDIRECT_URI=http://localhost:3001/api/integrations/google/callback

# Token encryption (generate with: openssl rand -hex 32)
ENCRYPTION_KEY=your_32_byte_hex_key_here
```

Create `server/src/config/google.ts`:

```typescript
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
    if (!this.key || this.key.length !== 64) { // 32 bytes = 64 hex chars
      throw new Error('❌ ENCRYPTION_KEY not properly configured. Must be 64 hex characters.');
    }
  }
};
```

#### 2.2 Token Encryption Utility

Create `server/src/utils/encryption.ts`:

```typescript
import crypto from 'crypto';
import { encryptionConfig } from '../config/google';

const ALGORITHM = 'aes-256-gcm';

export class TokenEncryption {
  static encrypt(plaintext: string): string {
    const key = Buffer.from(encryptionConfig.key, 'hex');
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
    
    let encrypted = cipher.update(plaintext, 'utf-8', 'hex');
    encrypted += cipher.final('hex');
    
    const authTag = cipher.getAuthTag();
    return `${iv.toString('hex')}.${authTag.toString('hex')}.${encrypted}`;
  }
  
  static decrypt(ciphertext: string): string {
    const key = Buffer.from(encryptionConfig.key, 'hex');
    const [ivHex, authTagHex, encrypted] = ciphertext.split('.');
    
    const iv = Buffer.from(ivHex, 'hex');
    const authTag = Buffer.from(authTagHex, 'hex');
    
    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(authTag);
    
    let decrypted = decipher.update(encrypted, 'hex', 'utf-8');
    decrypted += decipher.final('utf-8');
    
    return decrypted;
  }
}
```

#### 2.3 Gmail Auth Service

Create `server/src/services/gmail-auth-service.ts`:

```typescript
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

export class GmailAuthService {
  private oauth2Client = new google.auth.OAuth2(
    googleConfig.clientId,
    googleConfig.clientSecret,
    googleConfig.redirectUri
  );

  /**
   * Generate OAuth authorization URL
   */
  generateAuthUrl(userId: string): string {
    const state = crypto.randomBytes(32).toString('hex');
    
    // Store state in session (ideally Redis, for now use temp storage)
    // In production, use Redis or session store
    console.log(`[TEMP] OAuth state for ${userId}: ${state}`);
    
    return this.oauth2Client.generateAuthUrl({
      access_type: 'offline',
      scope: [
        'https://www.googleapis.com/auth/gmail.readonly',
        'https://www.googleapis.com/auth/calendar.readonly',
      ],
      state,
      prompt: 'consent', // Force consent screen to get refresh token
    });
  }

  /**
   * Exchange authorization code for tokens
   */
  async exchangeCode(code: string, userId: string): Promise<void> {
    try {
      const { tokens } = await this.oauth2Client.getToken(code);
      
      const accessToken = tokens.access_token!;
      const refreshToken = tokens.refresh_token!;
      const expiresAt = tokens.expiry_date!;

      // Encrypt tokens before storing
      const encryptedAccessToken = TokenEncryption.encrypt(accessToken);
      const encryptedRefreshToken = TokenEncryption.encrypt(refreshToken);

      // Upsert into gmail_integrations table
      await query(
        `INSERT INTO gmail_integrations 
         (user_id, access_token, refresh_token, expires_at, sync_status)
         VALUES ($1, $2, $3, to_timestamp($4/1000), 'idle')
         ON CONFLICT (user_id) DO UPDATE SET
         access_token = EXCLUDED.access_token,
         refresh_token = EXCLUDED.refresh_token,
         expires_at = EXCLUDED.expires_at,
         updated_at = NOW()`,
        [userId, encryptedAccessToken, encryptedRefreshToken, expiresAt]
      );

      console.log(`✅ Gmail credentials stored for user: ${userId}`);
    } catch (error) {
      console.error('❌ Error exchanging OAuth code:', error);
      throw error;
    }
  }

  /**
   * Refresh access token if expired
   */
  async ensureValidToken(userId: string): Promise<string> {
    const result = await query(
      'SELECT access_token, refresh_token, expires_at FROM gmail_integrations WHERE user_id = $1',
      [userId]
    );

    if (result.rows.length === 0) {
      throw new Error('Gmail integration not found for user');
    }

    const { access_token: encrypted, refresh_token: encryptedRefresh, expires_at } = result.rows[0];
    const accessToken = TokenEncryption.decrypt(encrypted);
    const refreshToken = TokenEncryption.decrypt(encryptedRefresh);

    // Check if token expired
    if (new Date(expires_at) > new Date()) {
      return accessToken; // Still valid
    }

    // Token expired, refresh it
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
  }

  /**
   * Disconnect Gmail integration
   */
  async disconnect(userId: string): Promise<void> {
    // Delete credentials from database
    await query(
      'DELETE FROM gmail_integrations WHERE user_id = $1',
      [userId]
    );

    // TODO: Revoke tokens via Google API for security
    console.log(`✅ Disconnected Gmail for user: ${userId}`);
  }
}

export const gmailAuthService = new GmailAuthService();
```

#### 2.4 Gmail Sync Service

Create `server/src/services/gmail-sync-service.ts`:

```typescript
import { gmail_v1, google } from 'googleapis';
import * as ical from 'ical.js';
import { query } from '../config/database';
import { gmailAuthService } from './gmail-auth-service';
import { TokenEncryption } from '../utils/encryption';

interface GoogleCalendarEvent {
  id: string;
  title: string;
  description?: string;
  start: { dateTime: string; timeZone: string } | { date: string };
  end: { dateTime: string; timeZone: string } | { date: string };
  location?: string;
  attendees?: Array<{ email: string; displayName?: string }>;
  organizer?: { email: string; displayName?: string };
  source?: { title: string; url: string };
}

export class GmailSyncService {
  private gmail: gmail_v1.Gmail | null = null;

  /**
   * Initialize Gmail client with user's access token
   */
  private async initializeClient(userId: string): Promise<gmail_v1.Gmail> {
    const accessToken = await gmailAuthService.ensureValidToken(userId);
    
    const auth = new google.auth.OAuth2();
    auth.setCredentials({ access_token: accessToken });
    
    return google.gmail({ version: 'v1', auth });
  }

  /**
   * Perform initial sync: fetch all events from Gmail + calendar
   */
  async initialSync(userId: string): Promise<void> {
    try {
      console.log(`📥 Starting initial Gmail sync for user: ${userId}`);
      
      const gmail = await this.initializeClient(userId);
      
      // Update status to 'syncing'
      await query(
        'UPDATE gmail_integrations SET sync_status = $1 WHERE user_id = $2',
        ['syncing', userId]
      );

      // Fetch calendar invitations from Gmail
      const messages = await this.fetchCalendarInvitations(gmail, userId);
      
      // Parse and insert events
      for (const message of messages) {
        await this.processMessage(message, userId, gmail);
      }

      // Store history ID for incremental syncs
      const historyId = await this.getLatestHistoryId(gmail);
      await query(
        `UPDATE gmail_integrations 
         SET history_id = $1, last_sync_at = NOW(), sync_status = $2, sync_error = NULL
         WHERE user_id = $3`,
        [historyId, 'idle', userId]
      );

      console.log(`✅ Initial Gmail sync completed for user: ${userId}`);
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.error(`❌ Gmail sync error for user ${userId}:`, errorMsg);
      
      await query(
        `UPDATE gmail_integrations 
         SET sync_status = $1, sync_error = $2
         WHERE user_id = $3`,
        ['error', errorMsg.slice(0, 500), userId]
      );
      
      throw error;
    }
  }

  /**
   * Incremental sync: fetch only new/updated messages since last sync
   */
  async incrementalSync(userId: string): Promise<void> {
    try {
      console.log(`🔄 Starting incremental Gmail sync for user: ${userId}`);
      
      const result = await query(
        'SELECT history_id FROM gmail_integrations WHERE user_id = $1',
        [userId]
      );

      if (result.rows.length === 0) {
        console.warn(`⚠️  No Gmail integration found for user: ${userId}`);
        return;
      }

      const previousHistoryId = result.rows[0].history_id;

      if (!previousHistoryId) {
        // No previous sync, do initial sync
        await this.initialSync(userId);
        return;
      }

      const gmail = await this.initializeClient(userId);

      // Fetch history changes
      const changes = await gmail.users.history.list({
        userId: 'me',
        startHistoryId: previousHistoryId,
      });

      if (!changes.data.history) {
        console.log(`ℹ️  No new messages since last sync for user: ${userId}`);
        return;
      }

      // Process changed messages
      for (const historyItem of changes.data.history) {
        if (historyItem.messages) {
          for (const { id } of historyItem.messages) {
            const message = await gmail.users.messages.get({
              userId: 'me',
              id: id!,
              format: 'full',
            });
            await this.processMessage(message.data, userId, gmail);
          }
        }
      }

      const newHistoryId = changes.data.historyId;
      await query(
        `UPDATE gmail_integrations 
         SET history_id = $1, last_sync_at = NOW(), sync_status = $2
         WHERE user_id = $3`,
        [newHistoryId, 'idle', userId]
      );

      console.log(`✅ Incremental Gmail sync completed for user: ${userId}`);
    } catch (error) {
      console.error(`❌ Incremental sync error for user ${userId}:`, error);
      throw error;
    }
  }

  /**
   * Fetch calendar invitation messages
   */
  private async fetchCalendarInvitations(
    gmail: gmail_v1.Gmail,
    userId: string
  ): Promise<gmail_v1.Schema$Message[]> {
    // Query for messages with calendar invitations or .ics attachments
    const query = 'filename:ics OR subject:"invitation" OR subject:"calendar" label:INBOX';
    
    const response = await gmail.users.messages.list({
      userId: 'me',
      q: query,
      maxResults: 100,
    });

    const messageIds = response.data.messages?.map(m => m.id!) || [];
    const messages: gmail_v1.Schema$Message[] = [];

    for (const id of messageIds) {
      const message = await gmail.users.messages.get({
        userId: 'me',
        id,
        format: 'full',
      });
      messages.push(message.data);
    }

    return messages;
  }

  /**
   * Process a single Gmail message and extract calendar data
   */
  private async processMessage(
    message: gmail_v1.Schema$Message,
    userId: string,
    gmail: gmail_v1.Gmail
  ): Promise<void> {
    try {
      const headers = message.payload?.headers || [];
      const subject = headers.find(h => h.name === 'Subject')?.value || 'No Subject';
      const from = headers.find(h => h.name === 'From')?.value || 'Unknown';

      // Look for .ics attachments
      const parts = message.payload?.parts || [];
      
      for (const part of parts) {
        if (part.mimeType === 'text/calendar' || part.filename?.endsWith('.ics')) {
          const data = part.body?.data || part.body?.attachmentId;
          
          if (part.body?.attachmentId) {
            // Download attachment
            const attachment = await gmail.users.messages.attachments.get({
              userId: 'me',
              messageId: message.id!,
              id: part.body.attachmentId,
            });
            
            const icsContent = Buffer.from(attachment.data.data || '', 'base64').toString();
            await this.parseAndStoreCalendarData(icsContent, message.id!, userId);
          } else if (part.body?.data) {
            const icsContent = Buffer.from(part.body.data, 'base64').toString();
            await this.parseAndStoreCalendarData(icsContent, message.id!, userId);
          }
        }
      }
    } catch (error) {
      console.error(`⚠️  Error processing message ${message.id}:`, error);
    }
  }

  /**
   * Parse ICS calendar data and insert into events table
   */
  private async parseAndStoreCalendarData(
    icsContent: string,
    messageId: string,
    userId: string
  ): Promise<void> {
    try {
      // Parse ICS using ical.js
      const jcalData = ical.parse(icsContent);
      const comp = new ical.Component(jcalData);
      const vevents = comp.getAllSubcomponents('vevent');

      for (const vevent of vevents) {
        const summary = vevent.getFirstPropertyValue('summary') || 'Calendar Event';
        const dtstart = vevent.getFirstPropertyValue('dtstart');
        const dtend = vevent.getFirstPropertyValue('dtend');
        const description = vevent.getFirstPropertyValue('description') || null;
        const location = vevent.getFirstPropertyValue('location') || null;
        const uid = vevent.getFirstPropertyValue('uid');

        if (!dtstart || !dtend) {
          console.warn(`⚠️  Skipping event without start/end date: ${summary}`);
          continue;
        }

        // Check if event already exists (deduplicate)
        const existing = await query(
          `SELECT id FROM events 
           WHERE user_id = $1 
           AND external_id->>'gmail' = $2`,
          [userId, uid]
        );

        if (existing.rows.length > 0) {
          console.log(`ℹ️  Event already synced: ${summary}`);
          continue;
        }

        // Insert into events table
        await query(
          `INSERT INTO events 
           (title, description, start_date, end_date, location, type, status, user_id, sync_source, external_id, last_external_sync)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW())`,
          [
            summary,
            description,
            dtstart.toJSDate().toISOString(),
            dtend.toJSDate().toISOString(),
            location,
            'meeting', // Default type
            'scheduled',
            userId,
            'gmail',
            JSON.stringify({ gmail: uid }),
          ]
        );

        console.log(`✅ Synced event: ${summary}`);
      }
    } catch (error) {
      console.error(`❌ Error parsing ICS data:`, error);
    }
  }

  /**
   * Get latest history ID for incremental sync
   */
  private async getLatestHistoryId(gmail: gmail_v1.Gmail): Promise<string> {
    const profile = await gmail.users.getProfile({ userId: 'me' });
    return profile.data.historyId || '0';
  }
}

export const gmailSyncService = new GmailSyncService();
```

#### 2.5 Express Routes for Gmail Integration

Add to `server/src/routes/integrations.ts` (create if doesn't exist):

```typescript
import { Router, Request, Response } from 'express';
import { gmailAuthService } from '../services/gmail-auth-service';
import { gmailSyncService } from '../services/gmail-sync-service';
import { query } from '../config/database';

const router = Router();

/**
 * GET /api/integrations/google/url
 * Generate OAuth authorization URL
 */
router.get('/google/url', async (req: Request, res: Response) => {
  try {
    const userId = req.query.userId as string;
    
    if (!userId) {
      res.status(400).json({ success: false, error: 'userId required' });
      return;
    }

    const authUrl = gmailAuthService.generateAuthUrl(userId);
    
    res.json({
      success: true,
      data: { authUrl }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to generate auth URL'
    });
  }
});

/**
 * GET /api/integrations/google/callback
 * Handle OAuth callback
 */
router.get('/google/callback', async (req: Request, res: Response) => {
  try {
    const { code, state } = req.query;
    const userId = req.query.userId as string; // Pass userId in query

    if (!code || !userId) {
      res.status(400).json({ success: false, error: 'Missing code or userId' });
      return;
    }

    // Exchange code for tokens
    await gmailAuthService.exchangeCode(code as string, userId);

    // Redirect to frontend with success message
    res.redirect(`/?integrationStatus=gmail_connected`);
  } catch (error) {
    res.redirect(`/?integrationStatus=gmail_error&error=${encodeURIComponent(String(error))}`);
  }
});

/**
 * POST /api/integrations/google/sync
 * Manually trigger Gmail sync
 */
router.post('/google/sync', async (req: Request, res: Response) => {
  try {
    const userId = req.body.userId as string;

    if (!userId) {
      res.status(400).json({ success: false, error: 'userId required' });
      return;
    }

    // Start sync in background
    gmailSyncService.incrementalSync(userId).catch(err => 
      console.error('Background sync error:', err)
    );

    res.json({
      success: true,
      message: 'Sync initiated'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Sync failed'
    });
  }
});

/**
 * DELETE /api/integrations/google/disconnect
 * Disconnect Gmail integration
 */
router.delete('/google/disconnect', async (req: Request, res: Response) => {
  try {
    const userId = req.body.userId as string;

    if (!userId) {
      res.status(400).json({ success: false, error: 'userId required' });
      return;
    }

    await gmailAuthService.disconnect(userId);

    res.json({
      success: true,
      message: 'Gmail disconnected'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Disconnect failed'
    });
  }
});

/**
 * GET /api/integrations/google/status
 * Get Gmail integration status
 */
router.get('/google/status', async (req: Request, res: Response) => {
  try {
    const userId = req.query.userId as string;

    if (!userId) {
      res.status(400).json({ success: false, error: 'userId required' });
      return;
    }

    const result = await query(
      'SELECT user_id, sync_status, last_sync_at, sync_error FROM gmail_integrations WHERE user_id = $1',
      [userId]
    );

    if (result.rows.length === 0) {
      res.json({
        success: true,
        data: { connected: false }
      });
      return;
    }

    res.json({
      success: true,
      data: {
        connected: true,
        syncStatus: result.rows[0].sync_status,
        lastSyncAt: result.rows[0].last_sync_at,
        syncError: result.rows[0].sync_error,
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Status check failed'
    });
  }
});

export default router;
```

Mount in `server/src/server.ts`:

```typescript
import integrationsRouter from './routes/integrations';

app.use('/api/integrations', integrationsRouter);
```

### Phase 3: Background Sync Job

Create `server/src/jobs/gmail-sync-job.ts`:

```typescript
import { gmailSyncService } from '../services/gmail-sync-service';
import { query } from '../config/database';

export class GmailSyncJob {
  private static instance: GmailSyncJob;
  private syncInterval: NodeJS.Timeout | null = null;
  private readonly SYNC_INTERVAL_MS = 5 * 60 * 1000; // Every 5 minutes

  private constructor() {}

  public static getInstance(): GmailSyncJob {
    if (!GmailSyncJob.instance) {
      GmailSyncJob.instance = new GmailSyncJob();
    }
    return GmailSyncJob.instance;
  }

  public start(): void {
    if (this.syncInterval) {
      console.log('⚠️  Gmail sync job already running');
      return;
    }

    console.log('🚀 Starting Gmail sync job...');
    this.runSync(); // Run immediately
    
    this.syncInterval = setInterval(() => {
      this.runSync();
    }, this.SYNC_INTERVAL_MS);
  }

  public stop(): void {
    if (this.syncInterval) {
      clearInterval(this.syncInterval);
      this.syncInterval = null;
      console.log('🛑 Gmail sync job stopped');
    }
  }

  private async runSync(): Promise<void> {
    try {
      // Get all users with active Gmail integrations
      const result = await query(
        `SELECT user_id FROM gmail_integrations 
         WHERE sync_status != 'error' 
         AND (last_sync_at IS NULL OR last_sync_at < NOW() - INTERVAL '5 minutes')`
      );

      const userIds = result.rows.map(r => r.user_id);

      if (userIds.length === 0) {
        return; // No users to sync
      }

      console.log(`🔄 Running Gmail sync for ${userIds.length} users...`);

      for (const userId of userIds) {
        try {
          await gmailSyncService.incrementalSync(userId);
        } catch (error) {
          console.error(`Error syncing for user ${userId}:`, error);
        }
      }
    } catch (error) {
      console.error('❌ Gmail sync job error:', error);
    }
  }
}

export const gmailSyncJob = GmailSyncJob.getInstance();
```

Start in `server/src/server.ts`:

```typescript
import { gmailSyncJob } from './jobs/gmail-sync-job';

// After database initialization
gmailSyncJob.start();
```

---

## Outlook Integration

### Phase 1: Azure AD Setup

#### 1.1 Register Application in Azure AD

1. Go to [Azure Portal](https://portal.azure.com/) → **Azure AD** → **App registrations**
2. Click **New registration**
3. Name: `DerPlanner`
4. Supported account types: Select based on your tenant (Multi-tenant for production)
5. Redirect URI (Web): `http://localhost:3001/api/integrations/outlook/callback`
6. Click **Register**

#### 1.2 Configure API Permissions

1. In your app, go to **API Permissions**
2. Click **Add a permission** → **Microsoft Graph**
3. Select **Delegated permissions**
4. Search and select:
   - `Calendars.Read`
   - `Mail.Read` (for future task mapping)
   - `offline_access`
5. Click **Grant admin consent** (if you have tenant admin access)

#### 1.3 Create Client Secret

1. Go to **Certificates & secrets**
2. Click **New client secret**
3. Description: `DerPlanner API`
4. Expiry: 24 months
5. Copy the **Value** (not ID)

#### 1.4 Capture Application Details

From the **Overview** tab, note:
- Application (client) ID
- Directory (tenant) ID

### Phase 2: Backend Implementation

#### 2.1 Environment Configuration

Add to `server/.env`:

```env
# Outlook / Microsoft Graph
OUTLOOK_CLIENT_ID=your_client_id_here
OUTLOOK_CLIENT_SECRET=your_client_secret_here
OUTLOOK_TENANT_ID=your_tenant_id_here
OUTLOOK_REDIRECT_URI=http://localhost:3001/api/integrations/outlook/callback
```

Create `server/src/config/outlook.ts`:

```typescript
import dotenv from 'dotenv';

dotenv.config();

export const outlookConfig = {
  clientId: process.env.OUTLOOK_CLIENT_ID || '',
  clientSecret: process.env.OUTLOOK_CLIENT_SECRET || '',
  tenantId: process.env.OUTLOOK_TENANT_ID || 'common',
  redirectUri: process.env.OUTLOOK_REDIRECT_URI || 'http://localhost:3001/api/integrations/outlook/callback',
  
  validateConfig(): void {
    if (!this.clientId || !this.clientSecret) {
      throw new Error('❌ Outlook credentials not configured. Set OUTLOOK_CLIENT_ID and OUTLOOK_CLIENT_SECRET in .env');
    }
  }
};
```

#### 2.2 Outlook Auth Service

Create `server/src/services/outlook-auth-service.ts`:

```typescript
import axios from 'axios';
import { query } from '../config/database';
import { outlookConfig } from '../config/outlook';
import { TokenEncryption } from '../utils/encryption';
import crypto from 'crypto';

interface MicrosoftTokens {
  access_token: string;
  refresh_token: string;
  expires_in: number;
}

export class OutlookAuthService {
  /**
   * Generate OAuth authorization URL
   */
  generateAuthUrl(userId: string): string {
    const state = crypto.randomBytes(32).toString('hex');
    
    // Store state for verification (use Redis in production)
    console.log(`[TEMP] Outlook OAuth state for ${userId}: ${state}`);

    const params = new URLSearchParams({
      client_id: outlookConfig.clientId,
      response_type: 'code',
      scope: 'Calendars.Read Mail.Read offline_access',
      redirect_uri: outlookConfig.redirectUri,
      state,
    });

    return `https://login.microsoftonline.com/${outlookConfig.tenantId}/oauth2/v2.0/authorize?${params.toString()}`;
  }

  /**
   * Exchange authorization code for tokens
   */
  async exchangeCode(code: string, userId: string): Promise<void> {
    try {
      const params = new URLSearchParams({
        client_id: outlookConfig.clientId,
        client_secret: outlookConfig.clientSecret,
        code,
        redirect_uri: outlookConfig.redirectUri,
        grant_type: 'authorization_code',
        scope: 'Calendars.Read Mail.Read offline_access',
      });

      const response = await axios.post<MicrosoftTokens>(
        `https://login.microsoftonline.com/${outlookConfig.tenantId}/oauth2/v2.0/token`,
        params
      );

      const { access_token, refresh_token, expires_in } = response.data;
      const expiresAt = new Date(Date.now() + expires_in * 1000);

      // Encrypt tokens
      const encryptedAccessToken = TokenEncryption.encrypt(access_token);
      const encryptedRefreshToken = TokenEncryption.encrypt(refresh_token);

      // Upsert into outlook_integrations
      await query(
        `INSERT INTO outlook_integrations 
         (user_id, access_token, refresh_token, expires_at, sync_status)
         VALUES ($1, $2, $3, $4, 'idle')
         ON CONFLICT (user_id) DO UPDATE SET
         access_token = EXCLUDED.access_token,
         refresh_token = EXCLUDED.refresh_token,
         expires_at = EXCLUDED.expires_at,
         updated_at = NOW()`,
        [userId, encryptedAccessToken, encryptedRefreshToken, expiresAt.toISOString()]
      );

      console.log(`✅ Outlook credentials stored for user: ${userId}`);
    } catch (error) {
      console.error('❌ Error exchanging Outlook OAuth code:', error);
      throw error;
    }
  }

  /**
   * Refresh access token if expired
   */
  async ensureValidToken(userId: string): Promise<string> {
    const result = await query(
      'SELECT access_token, refresh_token, expires_at FROM outlook_integrations WHERE user_id = $1',
      [userId]
    );

    if (result.rows.length === 0) {
      throw new Error('Outlook integration not found for user');
    }

    const { access_token: encrypted, refresh_token: encryptedRefresh, expires_at } = result.rows[0];
    const accessToken = TokenEncryption.decrypt(encrypted);
    const refreshToken = TokenEncryption.decrypt(encryptedRefresh);

    // Check if token expired
    if (new Date(expires_at) > new Date()) {
      return accessToken; // Still valid
    }

    // Token expired, refresh it
    const params = new URLSearchParams({
      client_id: outlookConfig.clientId,
      client_secret: outlookConfig.clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
      scope: 'Calendars.Read Mail.Read offline_access',
    });

    const response = await axios.post<MicrosoftTokens>(
      `https://login.microsoftonline.com/${outlookConfig.tenantId}/oauth2/v2.0/token`,
      params
    );

    const { access_token: newAccessToken, expires_in } = response.data;
    const newExpiresAt = new Date(Date.now() + expires_in * 1000);
    const encryptedNewToken = TokenEncryption.encrypt(newAccessToken);

    await query(
      `UPDATE outlook_integrations 
       SET access_token = $1, expires_at = $2, updated_at = NOW()
       WHERE user_id = $3`,
      [encryptedNewToken, newExpiresAt.toISOString(), userId]
    );

    console.log(`🔄 Refreshed Outlook token for user: ${userId}`);
    return newAccessToken;
  }

  /**
   * Disconnect Outlook integration
   */
  async disconnect(userId: string): Promise<void> {
    await query(
      'DELETE FROM outlook_integrations WHERE user_id = $1',
      [userId]
    );

    console.log(`✅ Disconnected Outlook for user: ${userId}`);
  }
}

export const outlookAuthService = new OutlookAuthService();
```

#### 2.3 Outlook Sync Service

Create `server/src/services/outlook-sync-service.ts`:

```typescript
import axios, { AxiosInstance } from 'axios';
import { query } from '../config/database';
import { outlookAuthService } from './outlook-auth-service';

interface MicrosoftEvent {
  id: string;
  subject: string;
  bodyPreview: string;
  start: {
    dateTime: string;
    timeZone: string;
  };
  end: {
    dateTime: string;
    timeZone: string;
  };
  location?: {
    displayName: string;
  };
  attendees?: Array<{
    emailAddress: {
      name: string;
      address: string;
    };
  }>;
  organizer?: {
    emailAddress: {
      name: string;
      address: string;
    };
  };
  isReminderOn: boolean;
  reminderMinutesBeforeStart: number;
}

interface MicrosoftDeltaResponse {
  value: MicrosoftEvent[];
  '@odata.deltaLink'?: string;
  '@odata.nextLink'?: string;
}

export class OutlookSyncService {
  private graphClient: AxiosInstance | null = null;

  /**
   * Initialize Microsoft Graph client
   */
  private async initializeClient(userId: string): Promise<AxiosInstance> {
    const accessToken = await outlookAuthService.ensureValidToken(userId);

    return axios.create({
      baseURL: 'https://graph.microsoft.com/v1.0',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
    });
  }

  /**
   * Perform initial sync
   */
  async initialSync(userId: string): Promise<void> {
    try {
      console.log(`📥 Starting initial Outlook sync for user: ${userId}`);

      const client = await this.initializeClient(userId);

      await query(
        'UPDATE outlook_integrations SET sync_status = $1 WHERE user_id = $2',
        ['syncing', userId]
      );

      // Fetch all calendar events
      const response = await client.get<MicrosoftDeltaResponse>('/me/calendarview', {
        params: {
          startDateTime: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(), // Last 30 days
          endDateTime: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(), // Next year
          $orderby: 'start/dateTime',
          $select: 'id,subject,bodyPreview,start,end,location,attendees,organizer,isReminderOn,reminderMinutesBeforeStart',
        },
      });

      // Process events
      for (const event of response.data.value) {
        await this.insertEvent(event, userId);
      }

      // Store delta token for incremental syncs
      const deltaLink = response.data['@odata.deltaLink'];
      if (deltaLink) {
        const deltaToken = new URL(deltaLink).searchParams.get('$deltatoken');
        await query(
          `UPDATE outlook_integrations 
           SET delta_token = $1, last_sync_at = NOW(), sync_status = $2, sync_error = NULL
           WHERE user_id = $3`,
          [deltaToken, 'idle', userId]
        );
      }

      console.log(`✅ Initial Outlook sync completed for user: ${userId}`);
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.error(`❌ Outlook sync error for user ${userId}:`, errorMsg);

      await query(
        `UPDATE outlook_integrations 
         SET sync_status = $1, sync_error = $2
         WHERE user_id = $3`,
        ['error', errorMsg.slice(0, 500), userId]
      );

      throw error;
    }
  }

  /**
   * Incremental sync using delta queries
   */
  async incrementalSync(userId: string): Promise<void> {
    try {
      console.log(`🔄 Starting incremental Outlook sync for user: ${userId}`);

      const result = await query(
        'SELECT delta_token FROM outlook_integrations WHERE user_id = $1',
        [userId]
      );

      if (result.rows.length === 0) {
        console.warn(`⚠️  No Outlook integration found for user: ${userId}`);
        return;
      }

      const deltaToken = result.rows[0].delta_token;

      if (!deltaToken) {
        // No previous sync, do initial
        await this.initialSync(userId);
        return;
      }

      const client = await this.initializeClient(userId);

      // Fetch delta changes
      const response = await client.get<MicrosoftDeltaResponse>(
        '/me/calendarview/delta',
        {
          params: {
            $deltatoken: deltaToken,
          },
        }
      );

      // Process changed events
      for (const event of response.data.value) {
        await this.insertEvent(event, userId);
      }

      // Update delta token
      const newDeltaLink = response.data['@odata.deltaLink'];
      if (newDeltaLink) {
        const newDeltaToken = new URL(newDeltaLink).searchParams.get('$deltatoken');
        await query(
          `UPDATE outlook_integrations 
           SET delta_token = $1, last_sync_at = NOW(), sync_status = $2
           WHERE user_id = $3`,
          [newDeltaToken, 'idle', userId]
        );
      }

      console.log(`✅ Incremental Outlook sync completed for user: ${userId}`);
    } catch (error) {
      console.error(`❌ Incremental sync error for user ${userId}:`, error);
      throw error;
    }
  }

  /**
   * Insert or update an event in the database
   */
  private async insertEvent(event: MicrosoftEvent, userId: string): Promise<void> {
    try {
      // Check if event already exists
      const existing = await query(
        `SELECT id FROM events 
         WHERE user_id = $1 
         AND external_id->>'outlook' = $2`,
        [userId, event.id]
      );

      const attendeeEmails = event.attendees
        ?.map(a => a.emailAddress.address)
        .join(',') || '';

      const eventData = {
        title: event.subject,
        description: event.bodyPreview || null,
        startDate: event.start.dateTime,
        endDate: event.end.dateTime,
        location: event.location?.displayName || null,
        attendees: attendeeEmails ? attendeeEmails.split(',') : [],
        externalId: { outlook: event.id },
      };

      if (existing.rows.length > 0) {
        // Update existing event
        await query(
          `UPDATE events 
           SET title = $1, description = $2, start_date = $3, end_date = $4, 
               location = $5, attendees = $6, external_id = $7, last_external_sync = NOW()
           WHERE id = $8`,
          [
            eventData.title,
            eventData.description,
            eventData.startDate,
            eventData.endDate,
            eventData.location,
            eventData.attendees,
            JSON.stringify(eventData.externalId),
            existing.rows[0].id,
          ]
        );

        console.log(`🔄 Updated event: ${event.subject}`);
      } else {
        // Insert new event
        await query(
          `INSERT INTO events 
           (title, description, start_date, end_date, location, attendees, type, status, user_id, sync_source, external_id, last_external_sync)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NOW())`,
          [
            eventData.title,
            eventData.description,
            eventData.startDate,
            eventData.endDate,
            eventData.location,
            eventData.attendees,
            'meeting',
            'scheduled',
            userId,
            'outlook',
            JSON.stringify(eventData.externalId),
          ]
        );

        console.log(`✅ Synced event: ${event.subject}`);
      }
    } catch (error) {
      console.error(`⚠️  Error processing Outlook event ${event.id}:`, error);
    }
  }
}

export const outlookSyncService = new OutlookSyncService();
```

#### 2.4 Express Routes for Outlook

Add to `server/src/routes/integrations.ts`:

```typescript
/**
 * GET /api/integrations/outlook/url
 */
router.get('/outlook/url', (req: Request, res: Response) => {
  try {
    const userId = req.query.userId as string;

    if (!userId) {
      res.status(400).json({ success: false, error: 'userId required' });
      return;
    }

    const authUrl = outlookAuthService.generateAuthUrl(userId);

    res.json({
      success: true,
      data: { authUrl }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to generate auth URL'
    });
  }
});

/**
 * GET /api/integrations/outlook/callback
 */
router.get('/outlook/callback', async (req: Request, res: Response) => {
  try {
    const { code } = req.query;
    const userId = req.query.userId as string;

    if (!code || !userId) {
      res.status(400).json({ success: false, error: 'Missing code or userId' });
      return;
    }

    await outlookAuthService.exchangeCode(code as string, userId);
    res.redirect(`/?integrationStatus=outlook_connected`);
  } catch (error) {
    res.redirect(`/?integrationStatus=outlook_error&error=${encodeURIComponent(String(error))}`);
  }
});

/**
 * POST /api/integrations/outlook/sync
 */
router.post('/outlook/sync', async (req: Request, res: Response) => {
  try {
    const userId = req.body.userId as string;

    if (!userId) {
      res.status(400).json({ success: false, error: 'userId required' });
      return;
    }

    outlookSyncService.incrementalSync(userId).catch(err =>
      console.error('Background sync error:', err)
    );

    res.json({
      success: true,
      message: 'Sync initiated'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Sync failed'
    });
  }
});

/**
 * DELETE /api/integrations/outlook/disconnect
 */
router.delete('/outlook/disconnect', async (req: Request, res: Response) => {
  try {
    const userId = req.body.userId as string;

    if (!userId) {
      res.status(400).json({ success: false, error: 'userId required' });
      return;
    }

    await outlookAuthService.disconnect(userId);

    res.json({
      success: true,
      message: 'Outlook disconnected'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Disconnect failed'
    });
  }
});

/**
 * GET /api/integrations/outlook/status
 */
router.get('/outlook/status', async (req: Request, res: Response) => {
  try {
    const userId = req.query.userId as string;

    if (!userId) {
      res.status(400).json({ success: false, error: 'userId required' });
      return;
    }

    const result = await query(
      'SELECT user_id, sync_status, last_sync_at, sync_error FROM outlook_integrations WHERE user_id = $1',
      [userId]
    );

    if (result.rows.length === 0) {
      res.json({
        success: true,
        data: { connected: false }
      });
      return;
    }

    res.json({
      success: true,
      data: {
        connected: true,
        syncStatus: result.rows[0].sync_status,
        lastSyncAt: result.rows[0].last_sync_at,
        syncError: result.rows[0].sync_error,
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Status check failed'
    });
  }
});
```

#### 2.5 Background Sync Job for Outlook

Create `server/src/jobs/outlook-sync-job.ts`:

```typescript
import { outlookSyncService } from '../services/outlook-sync-service';
import { query } from '../config/database';

export class OutlookSyncJob {
  private static instance: OutlookSyncJob;
  private syncInterval: NodeJS.Timeout | null = null;
  private readonly SYNC_INTERVAL_MS = 5 * 60 * 1000; // Every 5 minutes

  private constructor() {}

  public static getInstance(): OutlookSyncJob {
    if (!OutlookSyncJob.instance) {
      OutlookSyncJob.instance = new OutlookSyncJob();
    }
    return OutlookSyncJob.instance;
  }

  public start(): void {
    if (this.syncInterval) {
      console.log('⚠️  Outlook sync job already running');
      return;
    }

    console.log('🚀 Starting Outlook sync job...');
    this.runSync();

    this.syncInterval = setInterval(() => {
      this.runSync();
    }, this.SYNC_INTERVAL_MS);
  }

  public stop(): void {
    if (this.syncInterval) {
      clearInterval(this.syncInterval);
      this.syncInterval = null;
      console.log('🛑 Outlook sync job stopped');
    }
  }

  private async runSync(): Promise<void> {
    try {
      const result = await query(
        `SELECT user_id FROM outlook_integrations 
         WHERE sync_status != 'error' 
         AND (last_sync_at IS NULL OR last_sync_at < NOW() - INTERVAL '5 minutes')`
      );

      const userIds = result.rows.map(r => r.user_id);

      if (userIds.length === 0) {
        return;
      }

      console.log(`🔄 Running Outlook sync for ${userIds.length} users...`);

      for (const userId of userIds) {
        try {
          await outlookSyncService.incrementalSync(userId);
        } catch (error) {
          console.error(`Error syncing for user ${userId}:`, error);
        }
      }
    } catch (error) {
      console.error('❌ Outlook sync job error:', error);
    }
  }
}

export const outlookSyncJob = OutlookSyncJob.getInstance();
```

Start in `server/src/server.ts`:

```typescript
import { outlookSyncJob } from './jobs/outlook-sync-job';

// After database initialization
outlookSyncJob.start();
```

---

## Data Model

### Events Table Updates

```sql
ALTER TABLE events ADD COLUMN IF NOT EXISTS
  sync_source VARCHAR(20) CHECK (sync_source IN ('manual', 'gmail', 'outlook')),
  external_id JSONB DEFAULT '{}',
  last_external_sync TIMESTAMPTZ,
  is_read_only BOOLEAN DEFAULT false;
```

### External ID Format

```json
{
  "gmail": "1234567890abc@gmail.com",
  "outlook": "AAMkAGY2YmNkYTEwLWQwMzMtNDIyYy04NzQ1LWI4MDU2MDI5ZjAzYQBGAAA..."
}
```

### Deduplication Logic

- Check if `external_id` contains a key matching the sync source
- If entry exists, **update** rather than insert
- If no entry exists, **insert** as new event
- Never overwrite user edits from DerPlanner (add UI indicator: "🔗 Synced from Gmail" with lock icon)

---

## Frontend Implementation

### 1. Create Integrations Component

Create `src/components/settings/IntegrationsCard.tsx`:

```typescript
import { useState, useEffect } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';

export const IntegrationsCard = ({ userId }: { userId: string }) => {
  const [gmailStatus, setGmailStatus] = useState<any>(null);
  const [outlookStatus, setOutlookStatus] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    refreshStatus();
  }, []);

  const refreshStatus = async () => {
    try {
      const gmailRes = await fetch(`/api/integrations/google/status?userId=${userId}`);
      const gmailData = await gmailRes.json();
      setGmailStatus(gmailData.data);

      const outlookRes = await fetch(`/api/integrations/outlook/status?userId=${userId}`);
      const outlookData = await outlookRes.json();
      setOutlookStatus(outlookData.data);
    } catch (error) {
      console.error('Error fetching integration status:', error);
    }
  };

  const handleGoogleConnect = async () => {
    try {
      const res = await fetch(`/api/integrations/google/url?userId=${userId}`);
      const { data } = await res.json();
      window.location.href = data.authUrl;
    } catch (error) {
      console.error('Error connecting Gmail:', error);
    }
  };

  const handleOutlookConnect = async () => {
    try {
      const res = await fetch(`/api/integrations/outlook/url?userId=${userId}`);
      const { data } = await res.json();
      window.location.href = data.authUrl;
    } catch (error) {
      console.error('Error connecting Outlook:', error);
    }
  };

  const handleSync = async (provider: 'gmail' | 'outlook') => {
    setLoading(true);
    try {
      await fetch(`/api/integrations/${provider}/sync`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId }),
      });
      refreshStatus();
    } catch (error) {
      console.error(`Error syncing ${provider}:`, error);
    } finally {
      setLoading(false);
    }
  };

  const handleDisconnect = async (provider: 'gmail' | 'outlook') => {
    try {
      await fetch(`/api/integrations/${provider}/disconnect`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId }),
      });
      refreshStatus();
    } catch (error) {
      console.error(`Error disconnecting ${provider}:`, error);
    }
  };

  return (
    <Card className="p-6 space-y-6">
      <h2 className="text-2xl font-bold">Calendar Integrations</h2>

      {/* Gmail */}
      <div className="border rounded-lg p-4 space-y-3">
        <div className="flex justify-between items-center">
          <h3 className="font-semibold flex items-center gap-2">
            📧 Gmail
            {gmailStatus?.connected && (
              <Badge className="bg-green-100 text-green-700">Connected</Badge>
            )}
          </h3>
        </div>

        {gmailStatus?.connected ? (
          <div className="space-y-2 text-sm">
            <p>Status: {gmailStatus.syncStatus}</p>
            {gmailStatus.lastSyncAt && (
              <p>Last sync: {new Date(gmailStatus.lastSyncAt).toLocaleString()}</p>
            )}
            {gmailStatus.syncError && (
              <p className="text-red-600">Error: {gmailStatus.syncError}</p>
            )}
            <div className="flex gap-2 pt-2">
              <Button 
                onClick={() => handleSync('gmail')} 
                disabled={loading}
                variant="outline"
              >
                Sync Now
              </Button>
              <Button 
                onClick={() => handleDisconnect('gmail')} 
                variant="destructive"
              >
                Disconnect
              </Button>
            </div>
          </div>
        ) : (
          <Button onClick={handleGoogleConnect} className="w-full">
            Connect Gmail
          </Button>
        )}
      </div>

      {/* Outlook */}
      <div className="border rounded-lg p-4 space-y-3">
        <div className="flex justify-between items-center">
          <h3 className="font-semibold flex items-center gap-2">
            📆 Outlook
            {outlookStatus?.connected && (
              <Badge className="bg-blue-100 text-blue-700">Connected</Badge>
            )}
          </h3>
        </div>

        {outlookStatus?.connected ? (
          <div className="space-y-2 text-sm">
            <p>Status: {outlookStatus.syncStatus}</p>
            {outlookStatus.lastSyncAt && (
              <p>Last sync: {new Date(outlookStatus.lastSyncAt).toLocaleString()}</p>
            )}
            {outlookStatus.syncError && (
              <p className="text-red-600">Error: {outlookStatus.syncError}</p>
            )}
            <div className="flex gap-2 pt-2">
              <Button 
                onClick={() => handleSync('outlook')} 
                disabled={loading}
                variant="outline"
              >
                Sync Now
              </Button>
              <Button 
                onClick={() => handleDisconnect('outlook')} 
                variant="destructive"
              >
                Disconnect
              </Button>
            </div>
          </div>
        ) : (
          <Button onClick={handleOutlookConnect} className="w-full">
            Connect Outlook
          </Button>
        )}
      </div>
    </Card>
  );
};
```

### 2. Update Events Display

In `src/components/DailyBriefing.tsx`, add source badge:

```typescript
{event.sync_source && event.sync_source !== 'manual' && (
  <Badge variant="outline" className="text-[10px] px-1.5 h-5">
    🔗 {event.sync_source === 'gmail' ? 'Gmail' : 'Outlook'}
  </Badge>
)}
```

---

## Testing & Deployment

### Unit Testing

Create `server/src/services/__tests__/gmail-sync.test.ts`:

```typescript
import { describe, it, expect, beforeEach, vi } from 'vitest';
import nock from 'nock';
import { gmailSyncService } from '../gmail-sync-service';

describe('GmailSyncService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    nock.cleanAll();
  });

  it('should parse and store calendar events from ICS', async () => {
    // Mock ICS content
    const icsContent = `
BEGIN:VCALENDAR
BEGIN:VEVENT
UID:test123
SUMMARY:Team Meeting
DTSTART:20250115T140000Z
DTEND:20250115T150000Z
END:VEVENT
END:VCALENDAR
    `;

    // Test parsing logic
    const { parseICS } = gmailSyncService;
    const events = parseICS(icsContent);
    
    expect(events).toHaveLength(1);
    expect(events[0].summary).toBe('Team Meeting');
  });

  it('should deduplicate events by Gmail messageId', async () => {
    // Test deduplication logic
  });

  it('should handle token refresh', async () => {
    // Test refresh flow
  });
});
```

### Integration Testing

Create `server/src/routes/__tests__/integrations.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import request from 'supertest';
import app from '../../server';

describe('Integration Routes', () => {
  it('GET /api/integrations/google/url should return auth URL', async () => {
    const res = await request(app)
      .get('/api/integrations/google/url')
      .query({ userId: 'test-user' });

    expect(res.status).toBe(200);
    expect(res.body.data.authUrl).toContain('accounts.google.com');
  });

  it('DELETE /api/integrations/google/disconnect should remove credentials', async () => {
    // Test disconnect
  });
});
```

### Manual Testing Checklist

- [ ] Connect Gmail → verify OAuth flow completes
- [ ] Check `gmail_integrations` table has encrypted tokens
- [ ] Trigger manual sync → verify events appear in `events` table
- [ ] Connect Outlook → verify OAuth flow completes
- [ ] Check `outlook_integrations` table has encrypted tokens
- [ ] Trigger manual sync → verify events appear in `events` table
- [ ] Open DailyBriefing → verify synced events display
- [ ] Manually edit a synced event → verify user changes preserved on next sync
- [ ] Disconnect → verify credentials removed from DB
- [ ] Check logs for errors and token refresh activities

### Deployment Steps

1. **Feature flag:** Add to config:
   ```typescript
   export const SYNC_FEATURES = {
     gmailEnabled: process.env.GMAIL_SYNC_ENABLED === 'true',
     outlookEnabled: process.env.OUTLOOK_SYNC_ENABLED === 'true',
   };
   ```

2. **Database migrations:** Run before deploy:
   ```bash
   npm run db:migrate -- create-integration-tables
   ```

3. **Environment variables:** Set in production:
   ```
   GOOGLE_CLIENT_ID=...
   GOOGLE_CLIENT_SECRET=...
   OUTLOOK_CLIENT_ID=...
   OUTLOOK_CLIENT_SECRET=...
   OUTLOOK_TENANT_ID=...
   ENCRYPTION_KEY=... (use strong key!)
   ```

4. **Start services:** Background jobs auto-start on server init

5. **Monitor:** Watch logs for sync errors and token issues

---

## Troubleshooting

### Gmail

| Issue | Solution |
|-------|----------|
| "Invalid grant" error | Token expired; user needs to reconnect |
| No events synced | Check `gmail_integrations.sync_error`; verify ICS attachments exist in Gmail |
| Rate limit (429) | Reduce sync frequency; implement exponential backoff |
| Tokens not decrypting | Verify `ENCRYPTION_KEY` is consistent across deployments |

### Outlook

| Issue | Solution |
|-------|----------|
| "Invalid OAuth scope" | Verify scopes in Azure AD match code |
| Delta token expired | Reset `delta_token` to NULL; re-run initial sync |
| No events synced | Check preferred calendars filter; verify user granted permissions |
| Subscription expired | Re-register watch endpoint (auto-handles in `watchRenewal` job) |

### General

| Issue | Solution |
|-------|----------|
| Duplicate events | Check `external_id` matching logic; verify deduplication query |
| Events not appearing in UI | Clear browser cache; verify `refreshEvents()` called; check `sync_source` filter |
| Token storage insecure | Verify `TokenEncryption` always used; never log tokens |
| Performance slow | Add indexes on `user_id`, `sync_source`, `external_id`; batch user syncs |

---

## Next Steps

1. **Phase 1 (MVP):** Manual sync only, read-only, feature-flagged
2. **Phase 2 (Webhooks):** Auto-sync via Gmail push notifications + Outlook subscription
3. **Phase 3 (Write-back):** Allow synced events to be edited in DerPlanner → written back to source
4. **Phase 4 (Tasks):** Sync Gmail labels + Outlook To Do lists as DerPlanner tasks

---

**Questions?** Contact the DerPlanner dev team or open an issue in the repo.

