import { gmail_v1, google } from 'googleapis';
import * as ical from 'ical.js';
import { query } from '../config/database';
import { gmailAuthService } from './gmail-auth-service';
import { TokenEncryption } from '../utils/encryption';

interface CalendarEventPayload {
  id: string;
  title: string;
  description?: string;
  startDate: string;
  endDate: string;
  location?: string;
  attendees: string[];
  type: 'meeting' | 'appointment' | 'deadline' | 'reminder' | 'other';
  status: 'scheduled' | 'in_progress' | 'completed' | 'cancelled';
  externalId: { gmail: string };
}

export class GmailSyncService {
  private gmailClients = new Map<string, gmail_v1.Gmail>();

  /**
   * Initialize Gmail client for a user
   */
  private async initializeClient(userId: string): Promise<gmail_v1.Gmail> {
    if (this.gmailClients.has(userId)) {
      return this.gmailClients.get(userId)!;
    }

    const accessToken = await gmailAuthService.ensureValidToken(userId);

    const auth = new google.auth.OAuth2();
    auth.setCredentials({ access_token: accessToken });

    const gmail = google.gmail({ version: 'v1', auth });

    this.gmailClients.set(userId, gmail);

    setTimeout(() => {
      this.gmailClients.delete(userId);
    }, 3600000); // Clear after 1 hour

    return gmail;
  }

  /**
   * Perform initial sync: fetch all calendar events
   */
  async initialSync(userId: string): Promise<void> {
    try {
      console.log(`📥 Starting initial Gmail sync for user: ${userId}`);

      await query(
        'UPDATE gmail_integrations SET sync_status = $1 WHERE user_id = $2',
        ['syncing', userId]
      );

      const gmail = await this.initializeClient(userId);

      const messages = await this.fetchCalendarInvitations(gmail, userId);

      console.log(`📨 Found ${messages.length} potential calendar messages`);

      let syncedCount = 0;

      for (const message of messages) {
        try {
          const synced = await this.processMessage(message, userId, gmail);
          if (synced) syncedCount++;
        } catch (error) {
          console.warn(`⚠️  Failed to process message ${message.id}:`, error);
        }
      }

      const historyId = await this.getLatestHistoryId(gmail);

      await query(
        `UPDATE gmail_integrations 
         SET history_id = $1, last_sync_at = NOW(), sync_status = $2, sync_error = NULL
         WHERE user_id = $3`,
        [historyId, 'idle', userId]
      );

      console.log(`✅ Initial Gmail sync completed. Synced ${syncedCount} events for user: ${userId}`);
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.error(`❌ Gmail sync error for user ${userId}:`, errorMsg);

      await query(
        `UPDATE gmail_integrations 
         SET sync_status = $1, sync_error = $2, updated_at = NOW()
         WHERE user_id = $3`,
        ['error', errorMsg.slice(0, 500), userId]
      );

      throw error;
    }
  }

  /**
   * Incremental sync using Gmail history API
   */
  async incrementalSync(userId: string): Promise<void> {
    try {
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
        await this.initialSync(userId);
        return;
      }

      console.log(`🔄 Starting incremental Gmail sync for user: ${userId}`);

      await query(
        'UPDATE gmail_integrations SET sync_status = $1 WHERE user_id = $2',
        ['syncing', userId]
      );

      const gmail = await this.initializeClient(userId);

      const changes = await gmail.users.history.list({
        userId: 'me',
        startHistoryId: previousHistoryId,
      });

      if (!changes.data.history || changes.data.history.length === 0) {
        console.log(`ℹ️  No new messages since last sync for user: ${userId}`);

        await query(
          'UPDATE gmail_integrations SET sync_status = $1 WHERE user_id = $2',
          ['idle', userId]
        );

        return;
      }

      let processedCount = 0;

      for (const historyItem of changes.data.history) {
        if (historyItem.messages) {
          for (const { id } of historyItem.messages) {
            try {
              const message = await gmail.users.messages.get({
                userId: 'me',
                id: id!,
                format: 'full',
              });

              const processed = await this.processMessage(message.data, userId, gmail);
              if (processed) processedCount++;
            } catch (error) {
              console.warn(`⚠️  Failed to fetch/process message ${id}:`, error);
            }
          }
        }
      }

      const newHistoryId = changes.data.historyId;

      await query(
        `UPDATE gmail_integrations 
         SET history_id = $1, last_sync_at = NOW(), sync_status = $2, sync_error = NULL
         WHERE user_id = $3`,
        [newHistoryId, 'idle', userId]
      );

      console.log(`✅ Incremental Gmail sync completed. Processed ${processedCount} messages for user: ${userId}`);
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.error(`❌ Incremental sync error for user ${userId}:`, errorMsg);

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
   * Fetch calendar invitation messages
   */
  private async fetchCalendarInvitations(
    gmail: gmail_v1.Gmail,
    userId: string
  ): Promise<gmail_v1.Schema$Message[]> {
    try {
      const integrationResult = await query(
        'SELECT label_filters FROM gmail_integrations WHERE user_id = $1',
        [userId]
      );

      if (integrationResult.rows.length === 0) {
        return [];
      }

      const labelFilters = integrationResult.rows[0].label_filters || ['INBOX'];

      const queries = [
        'filename:ics',
        'subject:"invitation"',
        'subject:"calendar"',
        'mimeType:"text/calendar"',
      ];

      const mailQuery = queries.map(q => `(${q})`).join(' OR ');

      const response = await gmail.users.messages.list({
        userId: 'me',
        q: mailQuery,
        maxResults: 100,
      });

      const messageIds = response.data.messages?.map(m => m.id!) || [];
      const messages: gmail_v1.Schema$Message[] = [];

      for (const id of messageIds) {
        try {
          const message = await gmail.users.messages.get({
            userId: 'me',
            id,
            format: 'full',
          });
          messages.push(message.data);
        } catch (error) {
          console.warn(`⚠️  Failed to fetch message ${id}:`, error);
        }
      }

      return messages;
    } catch (error) {
      console.error('❌ Error fetching calendar invitations:', error);
      return [];
    }
  }

  /**
   * Process a single Gmail message
   */
  private async processMessage(
    message: gmail_v1.Schema$Message,
    userId: string,
    gmail: gmail_v1.Gmail
  ): Promise<boolean> {
    try {
      const headers = message.payload?.headers || [];
      const subject = headers.find(h => h.name === 'Subject')?.value || 'No Subject';
      const messageId = message.id || 'unknown';

      const parts = message.payload?.parts || [message.payload] || [];

      let eventProcessed = false;

      for (const part of parts) {
        if (
          part?.mimeType === 'text/calendar' ||
          part?.filename?.toLowerCase().endsWith('.ics')
        ) {
          eventProcessed = await this.extractAndStoreCalendarData(
            part,
            messageId,
            userId,
            gmail,
            message.id!
          );

          if (eventProcessed) break;
        }
      }

      return eventProcessed;
    } catch (error) {
      console.warn(`⚠️  Error processing message ${message.id}:`, error);
      return false;
    }
  }

  /**
   * Extract calendar data from message part
   */
  private async extractAndStoreCalendarData(
    part: gmail_v1.Schema$MessagePart,
    messageId: string,
    userId: string,
    gmail: gmail_v1.Gmail,
    fullMessageId: string
  ): Promise<boolean> {
    try {
      let icsContent: string | null = null;

      if (part.body?.data) {
        icsContent = Buffer.from(part.body.data, 'base64').toString('utf-8');
      } else if (part.body?.attachmentId) {
        const attachment = await gmail.users.messages.attachments.get({
          userId: 'me',
          messageId: fullMessageId,
          id: part.body.attachmentId,
        });

        if (attachment.data.data) {
          icsContent = Buffer.from(attachment.data.data, 'base64').toString('utf-8');
        }
      }

      if (!icsContent) {
        return false;
      }

      return this.parseAndStoreCalendarData(icsContent, messageId, userId);
    } catch (error) {
      console.warn(`⚠️  Error extracting calendar data:`, error);
      return false;
    }
  }

  /**
   * Parse ICS and store events
   */
  private async parseAndStoreCalendarData(
    icsContent: string,
    gmailMessageId: string,
    userId: string
  ): Promise<boolean> {
    try {
      const jcalData = ical.parse(icsContent);
      const comp = new ical.Component(jcalData);
      const vevents = comp.getAllSubcomponents('vevent');

      if (vevents.length === 0) {
        return false;
      }

      let storedCount = 0;

      for (const vevent of vevents) {
        try {
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

          const startDate = this.getJSDate(dtstart);
          const endDate = this.getJSDate(dtend);

          const eventPayload: CalendarEventPayload = {
            id: uid,
            title: summary,
            description: description?.toString() || undefined,
            startDate: startDate.toISOString(),
            endDate: endDate.toISOString(),
            location: location?.toString() || undefined,
            attendees: [],
            type: 'meeting',
            status: 'scheduled',
            externalId: { gmail: uid },
          };

          await query(
            `INSERT INTO events 
             (title, description, start_date, end_date, location, type, status, user_id, sync_source, external_id, last_external_sync, created_at, updated_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW(), NOW(), NOW())`,
            [
              eventPayload.title,
              eventPayload.description,
              eventPayload.startDate,
              eventPayload.endDate,
              eventPayload.location,
              eventPayload.type,
              eventPayload.status,
              userId,
              'gmail',
              JSON.stringify(eventPayload.externalId),
            ]
          );

          console.log(`✅ Synced event: ${summary}`);
          storedCount++;
        } catch (error) {
          console.warn(`⚠️  Error processing ICS event:`, error);
        }
      }

      return storedCount > 0;
    } catch (error) {
      console.error(`❌ Error parsing ICS data:`, error);
      return false;
    }
  }

  /**
   * Convert ICS date to JS Date
   */
  private getJSDate(icalDate: any): Date {
    if (!icalDate) {
      return new Date();
    }

    if (typeof icalDate.toJSDate === 'function') {
      return icalDate.toJSDate();
    }

    if (typeof icalDate.toUnixTime === 'function') {
      return new Date(icalDate.toUnixTime() * 1000);
    }

    if (icalDate instanceof Date) {
      return icalDate;
    }

    return new Date(icalDate.toString());
  }

  /**
   * Get latest history ID
   */
  private async getLatestHistoryId(gmail: gmail_v1.Gmail): Promise<string> {
    try {
      const profile = await gmail.users.getProfile({ userId: 'me' });
      return profile.data.historyId || '0';
    } catch (error) {
      console.error('❌ Error getting history ID:', error);
      return '0';
    }
  }
}

export const gmailSyncService = new GmailSyncService();

