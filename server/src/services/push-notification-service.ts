import webpush from 'web-push';
import { query } from '../config/database';

/**
 * Format date without timezone information
 * Returns date in format: YYYY-MM-DD HH:MM:SS
 */
function formatDateWithoutTimezone(date: Date | string | null | undefined): string | null {
  if (!date) return null;

  const d = typeof date === 'string' ? new Date(date) : date;
  if (isNaN(d.getTime())) return null;

  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const hours = String(d.getHours()).padStart(2, '0');
  const minutes = String(d.getMinutes()).padStart(2, '0');
  const seconds = String(d.getSeconds()).padStart(2, '0');

  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
}

interface PushSubscription {
  endpoint: string;
  keys: {
    p256dh: string;
    auth: string;
  };
}

interface AlarmSettings {
  enabled: boolean;
  minutesBefore: number;
  soundEnabled: boolean;
  showNotification: boolean;
}

export class PushNotificationService {
  private static instance: PushNotificationService;
  private checkInterval: NodeJS.Timeout | null = null;
  private readonly CHECK_INTERVAL_MS = 60000; // Check every minute

  private constructor() {
    this.initializeVapid();
  }

  public static getInstance(): PushNotificationService {
    if (!PushNotificationService.instance) {
      PushNotificationService.instance = new PushNotificationService();
    }
    return PushNotificationService.instance;
  }

  private initializeVapid(): void {
    const vapidPublicKey = process.env.VAPID_PUBLIC_KEY;
    const vapidPrivateKey = process.env.VAPID_PRIVATE_KEY;
    const vapidSubject = process.env.VAPID_SUBJECT || 'mailto:contact@derplanner.space';

    if (!vapidPublicKey || !vapidPrivateKey) {
      console.warn('⚠️  VAPID keys not configured. Push notifications will not work.');
      console.warn('   Run: npx web-push generate-vapid-keys');
      console.warn('   Then add VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY to your .env file');
      return;
    }

    webpush.setVapidDetails(
      vapidSubject,
      vapidPublicKey,
      vapidPrivateKey
    );

    console.log('✅ VAPID configured for push notifications');
  }

  /**
   * Start the push notification monitoring service
   */
  public start(): void {
    if (!process.env.VAPID_PUBLIC_KEY || !process.env.VAPID_PRIVATE_KEY) {
      console.log('⏭️  Push notification service disabled (VAPID keys not configured)');
      return;
    }

    if (this.checkInterval) {
      console.log('⚠️  Push notification service already running');
      return;
    }

    console.log('🔔 Starting push notification service...');
    this.checkUpcomingEvents(); // Run immediately
    this.checkInterval = setInterval(() => {
      this.checkUpcomingEvents();
    }, this.CHECK_INTERVAL_MS);

    console.log('✅ Push notification service started');
  }

  /**
   * Stop the push notification monitoring service
   */
  public stop(): void {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
      console.log('🛑 Push notification service stopped');
    }
  }

  /**
   * Subscribe a user to push notifications
   */
  public async subscribe(
    userId: string,
    subscription: PushSubscription,
    alarmSettings: AlarmSettings
  ): Promise<void> {
    try {
      // Check if subscription already exists
      const existing = await query(
        'SELECT id FROM push_subscriptions WHERE user_id = $1 AND endpoint = $2',
        [userId, subscription.endpoint]
      );

      if (existing.rows.length > 0) {
        // Update existing subscription
        await query(
          `UPDATE push_subscriptions 
           SET keys = $1, alarm_settings = $2, updated_at = NOW()
           WHERE user_id = $3 AND endpoint = $4`,
          [JSON.stringify(subscription.keys), JSON.stringify(alarmSettings), userId, subscription.endpoint]
        );
        console.log(`✅ Updated push subscription for user: ${userId}`);
      } else {
        // Create new subscription
        await query(
          `INSERT INTO push_subscriptions (user_id, endpoint, keys, alarm_settings)
           VALUES ($1, $2, $3, $4)`,
          [userId, subscription.endpoint, JSON.stringify(subscription.keys), JSON.stringify(alarmSettings)]
        );
        console.log(`✅ Created push subscription for user: ${userId}`);
      }
    } catch (error) {
      console.error('❌ Error subscribing to push notifications:', error);
      throw error;
    }
  }

  /**
   * Unsubscribe a user from push notifications
   */
  public async unsubscribe(userId: string, endpoint: string): Promise<void> {
    try {
      await query(
        'DELETE FROM push_subscriptions WHERE user_id = $1 AND endpoint = $2',
        [userId, endpoint]
      );
      console.log(`✅ Removed push subscription for user: ${userId}`);
    } catch (error) {
      console.error('❌ Error unsubscribing from push notifications:', error);
      throw error;
    }
  }

  /**
   * Get all subscriptions for a user
   */
  public async getUserSubscriptions(userId: string): Promise<any[]> {
    try {
      const result = await query(
        'SELECT * FROM push_subscriptions WHERE user_id = $1',
        [userId]
      );
      return result.rows;
    } catch (error) {
      console.error('❌ Error fetching user subscriptions:', error);
      return [];
    }
  }

  /**
   * Check for upcoming events and send notifications
   */
  private async checkUpcomingEvents(): Promise<void> {
    try {
      const now = new Date();

      // Get all active push subscriptions with their alarm settings
      const subscriptionsResult = await query(
        `SELECT ps.*
         FROM push_subscriptions ps
         WHERE ps.alarm_settings->>'enabled' = 'true'
           AND ps.alarm_settings->>'showNotification' = 'true'`
      );

      const subscriptions = subscriptionsResult.rows;

      if (subscriptions.length === 0) {
        return;
      }

      console.log(`🔍 Checking events for ${subscriptions.length} subscriptions...`);

      // For each subscription, check their events
      for (const sub of subscriptions) {
        const alarmSettings: AlarmSettings = sub.alarm_settings;
        const minutesBefore = alarmSettings.minutesBefore || 15;

        // Calculate the time window for notifications
        const notifyTime = new Date(now.getTime() + minutesBefore * 60000);
        const windowStart = new Date(notifyTime.getTime() - 30000); // 30 seconds before
        const windowEnd = new Date(notifyTime.getTime() + 30000); // 30 seconds after

        // Find events that should trigger notifications
        const eventsResult = await query(
          `SELECT id, title, description, start_date, location, type
           FROM events
           WHERE user_id = $1
             AND status = 'scheduled'
             AND start_date BETWEEN $2 AND $3
             AND (last_notification_sent IS NULL OR last_notification_sent < (start_date - INTERVAL '1 hour'))
           ORDER BY start_date ASC`,
          [sub.user_id, windowStart.toISOString(), windowEnd.toISOString()]
        );

        // Send notifications for each event
        for (const event of eventsResult.rows) {
          await this.sendEventNotification(sub, event, minutesBefore);

          // Mark notification as sent
          await query(
            'UPDATE events SET last_notification_sent = NOW() WHERE id = $1',
            [event.id]
          );
        }
      }
    } catch (error) {
      console.error('❌ Error checking upcoming events:', error);
    }
  }

  /**
   * Send a notification for an event
   */
  private async sendEventNotification(
    subscription: any,
    event: any,
    minutesBefore: number
  ): Promise<void> {
    try {
      // Parse keys if they're still stringified (PostgreSQL JSONB should auto-parse, but be safe)
      const keys = typeof subscription.keys === 'string'
        ? JSON.parse(subscription.keys)
        : subscription.keys;

      const pushSubscription: webpush.PushSubscription = {
        endpoint: subscription.endpoint,
        keys: keys,
      };

      const timeText = minutesBefore >= 60
        ? `${Math.floor(minutesBefore / 60)} hour${minutesBefore >= 120 ? 's' : ''}`
        : `${minutesBefore} minutes`;

      const payload = JSON.stringify({
        title: `📅 ${event.title}`,
        body: `Starting in ${timeText}${event.location ? ` at ${event.location}` : ''}`,
        icon: '/derplanner-192.png',
        badge: '/favicon.ico',
        tag: `event-${event.id}`,
        requireInteraction: false,
        data: {
          url: `/?event=${event.id}`,
          eventId: event.id,
          eventStartDate: formatDateWithoutTimezone(event.start_date),
          timestamp: formatDateWithoutTimezone(new Date()),
        },
      });

      await webpush.sendNotification(pushSubscription, payload);

      console.log(`✅ Sent notification for event: ${event.title} to user: ${subscription.user_id}`);

      // Log the notification
      await query(
        `INSERT INTO push_notification_logs (user_id, event_id, subscription_endpoint, payload, success)
         VALUES ($1, $2, $3, $4, $5)`,
        [subscription.user_id, event.id, subscription.endpoint, payload, true]
      );
    } catch (error: any) {
      console.error(`❌ Error sending push notification for event ${event.id}:`, error.message);

      // If subscription is invalid, remove it
      if (error.statusCode === 410 || error.statusCode === 404) {
        console.log(`🗑️  Removing invalid subscription: ${subscription.endpoint}`);
        await this.unsubscribe(subscription.user_id, subscription.endpoint);
      }

      // Log the failed notification
      await query(
        `INSERT INTO push_notification_logs (user_id, event_id, subscription_endpoint, payload, success, error_message)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [subscription.user_id, event.id, subscription.endpoint, JSON.stringify({}), false, error.message]
      );
    }
  }

  /**
   * Send a test notification
   */
  public async sendTestNotification(
    userId: string,
    subscription: PushSubscription
  ): Promise<{ success: boolean; error?: string }> {
    try {
      // Keys should already be in correct format from frontend
      const pushSubscription: webpush.PushSubscription = {
        endpoint: subscription.endpoint,
        keys: subscription.keys,
      };

      const payload = JSON.stringify({
        title: '🔔 Test Notification',
        body: 'Your event notifications are working correctly!',
        icon: '/derplanner-192.png',
        badge: '/favicon.ico',
        tag: 'test-notification',
        requireInteraction: false,
        data: {
          url: '/',
          timestamp: formatDateWithoutTimezone(new Date()),
        },
      });

      await webpush.sendNotification(pushSubscription, payload);

      console.log(`✅ Sent test notification to user: ${userId}`);

      return { success: true };
    } catch (error: any) {
      console.error('❌ Error sending test notification:', error.message);
      return { success: false, error: error.message };
    }
  }

  /**
   * Get notification logs for a user
   */
  public async getNotificationLogs(userId: string, limit: number = 50): Promise<any[]> {
    try {
      const result = await query(
        `SELECT * FROM push_notification_logs 
         WHERE user_id = $1 
         ORDER BY created_at DESC 
         LIMIT $2`,
        [userId, limit]
      );
      return result.rows;
    } catch (error) {
      console.error('❌ Error fetching notification logs:', error);
      return [];
    }
  }
}

export const pushNotificationService = PushNotificationService.getInstance();



