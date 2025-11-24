import { gmailSyncService } from '../services/gmail-sync-service';
import { query } from '../config/database';

export class GmailSyncJob {
  private static instance: GmailSyncJob;
  private syncInterval: NodeJS.Timeout | null = null;
  private readonly SYNC_INTERVAL_MS = 5 * 60 * 1000;
  private isRunning = false;

  private constructor() {}

  public static getInstance(): GmailSyncJob {
    if (!GmailSyncJob.instance) {
      GmailSyncJob.instance = new GmailSyncJob();
    }
    return GmailSyncJob.instance;
  }

  /**
   * Start the background sync job
   */
  public start(): void {
    if (this.syncInterval) {
      console.log('⚠️  Gmail sync job already running');
      return;
    }

    console.log('🚀 Starting Gmail sync job (every 5 minutes)...');

    this.runSync();

    this.syncInterval = setInterval(() => {
      this.runSync();
    }, this.SYNC_INTERVAL_MS);

    console.log('✅ Gmail sync job started');
  }

  /**
   * Stop the background sync job
   */
  public stop(): void {
    if (this.syncInterval) {
      clearInterval(this.syncInterval);
      this.syncInterval = null;
      console.log('🛑 Gmail sync job stopped');
    }
  }

  /**
   * Run sync for all active integrations
   */
  private async runSync(): Promise<void> {
    if (this.isRunning) {
      console.log('⏳ Gmail sync already in progress, skipping...');
      return;
    }

    this.isRunning = true;

    try {
      const result = await query(
        `SELECT user_id, sync_status 
         FROM gmail_integrations 
         WHERE sync_status != 'error' 
         AND (last_sync_at IS NULL OR last_sync_at < NOW() - INTERVAL '5 minutes')`
      );

      const userIds = result.rows.map(r => r.user_id);

      if (userIds.length === 0) {
        return;
      }

      console.log(`🔄 Running Gmail sync for ${userIds.length} user(s)...`);

      for (const userId of userIds) {
        try {
          await gmailSyncService.incrementalSync(userId);
        } catch (error) {
          console.error(`❌ Error syncing user ${userId}:`, error);
        }
      }

      console.log(`✅ Gmail sync batch completed`);
    } catch (error) {
      console.error('❌ Gmail sync job error:', error);
    } finally {
      this.isRunning = false;
    }
  }

  /**
   * Force sync for a specific user (manual trigger)
   */
  public async forceSyncUser(userId: string): Promise<void> {
    try {
      console.log(`⚡ Force syncing user: ${userId}`);
      await gmailSyncService.incrementalSync(userId);
    } catch (error) {
      console.error(`❌ Force sync error for user ${userId}:`, error);
      throw error;
    }
  }

  /**
   * Get job status
   */
  public getStatus(): {
    running: boolean;
    interval: number;
  } {
    return {
      running: this.syncInterval !== null,
      interval: this.SYNC_INTERVAL_MS,
    };
  }
}

export const gmailSyncJob = GmailSyncJob.getInstance();

