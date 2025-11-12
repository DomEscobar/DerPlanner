import { query } from '../config/database';
import { WebhookConfig, TaskWebhookConfig, WebhookLog, TaskWebhookLog } from '../types';

export class WebhookService {
  private static instance: WebhookService;
  private pollingInterval: NodeJS.Timeout | null = null;
  private readonly CHECK_INTERVAL_MS = 60000; // Check every minute

  private constructor() {}

  public static getInstance(): WebhookService {
    if (!WebhookService.instance) {
      WebhookService.instance = new WebhookService();
    }
    return WebhookService.instance;
  }

  /**
   * Start the webhook monitoring service
   */
  public start(): void {
    if (this.pollingInterval) {
      console.log('⚠️  Webhook service already running');
      return;
    }

    console.log('🎣 Starting webhook monitoring service...');
    this.checkAndTriggerWebhooks(); // Run immediately
    this.pollingInterval = setInterval(() => {
      this.checkAndTriggerWebhooks();
    }, this.CHECK_INTERVAL_MS);
    
    console.log('✅ Webhook service started');
  }

  /**
   * Stop the webhook monitoring service
   */
  public stop(): void {
    if (this.pollingInterval) {
      clearInterval(this.pollingInterval);
      this.pollingInterval = null;
      console.log('🛑 Webhook service stopped');
    }
  }

  /**
   * Check for events that need webhook triggers
   */
  private async checkAndTriggerWebhooks(): Promise<void> {
    try {
      const now = new Date();
      const checkWindowEnd = new Date(now.getTime() + this.CHECK_INTERVAL_MS * 2);

      // Find events that:
      // 1. Have webhook enabled
      // 2. Are scheduled
      // 3. Start time (minus offset) is within our check window
      // 4. Haven't been triggered yet (or should be re-triggered)
      const result = await query(
        `SELECT 
          id, title, start_date, webhook_config, 
          webhook_last_triggered, webhook_trigger_count
         FROM events
         WHERE status = 'scheduled'
           AND webhook_config IS NOT NULL
           AND (webhook_config->>'enabled')::boolean = true
           AND start_date BETWEEN $1 AND $2
           AND (
             webhook_last_triggered IS NULL 
             OR webhook_last_triggered < start_date - INTERVAL '1 hour'
           )
         ORDER BY start_date ASC`,
        [now, checkWindowEnd]
      );

      if (result.rows.length > 0) {
        console.log(`🎯 Found ${result.rows.length} events with pending webhooks`);
      }

      for (const event of result.rows) {
        const webhookConfig: WebhookConfig = event.webhook_config;
        const triggerOffset = webhookConfig.triggerOffset || 0;
        const triggerTime = new Date(
          new Date(event.start_date).getTime() - triggerOffset * 60000
        );

        // Check if it's time to trigger
        if (triggerTime <= now) {
          console.log(`🔔 Triggering webhook for event: ${event.title}`);
          await this.executeWebhook(event.id, event, webhookConfig);
        }
      }
    } catch (error) {
      console.error('❌ Error checking webhooks:', error);
    }
  }

  /**
   * Execute a webhook with retry logic
   */
  public async executeWebhook(
    eventId: string,
    eventData: any,
    config: WebhookConfig,
    retryCount: number = 0
  ): Promise<boolean> {
    const maxRetries = config.retryConfig?.maxRetries || 3;
    const retryDelay = config.retryConfig?.retryDelay || 60000;

    try {
      // Build headers
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'User-Agent': 'DerPlanner-Task-Event-Planner-Webhook/1.0',
        ...config.headers,
      };

      // Add authentication
      if (config.authentication) {
        switch (config.authentication.type) {
          case 'bearer':
            if (config.authentication.token) {
              headers['Authorization'] = `Bearer ${config.authentication.token}`;
            }
            break;
          case 'basic':
            if (config.authentication.username && config.authentication.password) {
              const encoded = Buffer.from(
                `${config.authentication.username}:${config.authentication.password}`
              ).toString('base64');
              headers['Authorization'] = `Basic ${encoded}`;
            }
            break;
          case 'api_key':
            if (config.authentication.apiKey && config.authentication.apiKeyHeader) {
              headers[config.authentication.apiKeyHeader] = config.authentication.apiKey;
            }
            break;
        }
      }

      // Build request body with default data
      const defaultBody = {
        event: {
          id: eventData.id,
          title: eventData.title,
          description: eventData.description,
          startDate: eventData.start_date || eventData.startDate,
          endDate: eventData.end_date || eventData.endDate,
          location: eventData.location,
          type: eventData.type,
          attendees: eventData.attendees,
        },
        triggeredAt: new Date().toISOString(),
        retryCount,
      };
      
      // Merge custom body fields with default data
      const requestBody = config.body 
        ? { ...defaultBody, ...config.body }
        : defaultBody;

      // Execute HTTP request
      const startTime = Date.now();
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 30000);

      let response: Response;
      try {
        response = await fetch(config.url, {
          method: config.method,
          headers,
          body: config.method !== 'GET' ? JSON.stringify(requestBody) : undefined,
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timeoutId);
      }

      const responseText = await response.text();
      const duration = Date.now() - startTime;

      const success = response.ok;

      // Log the webhook execution
      await this.logWebhookExecution({
        eventId,
        triggerTime: new Date(),
        requestUrl: config.url,
        requestMethod: config.method,
        requestHeaders: headers,
        requestBody,
        responseStatus: response.status,
        responseBody: responseText.substring(0, 5000), // Limit log size
        errorMessage: success ? null : `HTTP ${response.status}: ${response.statusText}`,
        retryCount,
        success,
      });

      if (success) {
        // Update event with last triggered time
        await query(
          `UPDATE events 
           SET webhook_last_triggered = NOW(),
               webhook_trigger_count = webhook_trigger_count + 1
           WHERE id = $1`,
          [eventId]
        );

        console.log(`✅ Webhook executed successfully for event ${eventId} (${duration}ms)`);
        return true;
      } else {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      console.error(`❌ Webhook execution failed for event ${eventId}:`, errorMessage);

      // Log the failed attempt
      await this.logWebhookExecution({
        eventId,
        triggerTime: new Date(),
        requestUrl: config.url,
        requestMethod: config.method,
        requestHeaders: {},
        requestBody: config.body || {},
        errorMessage,
        retryCount,
        success: false,
      });

      // Retry logic
      if (retryCount < maxRetries) {
        console.log(`🔄 Retrying webhook in ${retryDelay}ms (attempt ${retryCount + 1}/${maxRetries})`);
        
        await new Promise(resolve => setTimeout(resolve, retryDelay));
        return this.executeWebhook(eventId, eventData, config, retryCount + 1);
      }

      return false;
    }
  }

  /**
   * Log webhook execution to database
   */
  private async logWebhookExecution(log: Omit<WebhookLog, 'id' | 'triggeredAt'> & { triggerTime: Date }): Promise<void> {
    try {
      await query(
        `INSERT INTO event_webhook_logs 
         (event_id, trigger_time, request_url, request_method, request_headers, request_body, 
          response_status, response_body, error_message, retry_count, success)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
        [
          log.eventId,
          log.triggerTime,
          log.requestUrl,
          log.requestMethod,
          JSON.stringify(log.requestHeaders),
          JSON.stringify(log.requestBody),
          log.responseStatus || null,
          log.responseBody || null,
          log.errorMessage || null,
          log.retryCount,
          log.success,
        ]
      );
    } catch (error) {
      console.error('❌ Error logging webhook execution:', error);
    }
  }

  /**
   * Get webhook logs for an event
   */
  public async getWebhookLogs(eventId: string, limit: number = 50): Promise<WebhookLog[]> {
    const result = await query(
      `SELECT * FROM event_webhook_logs 
       WHERE event_id = $1 
       ORDER BY triggered_at DESC 
       LIMIT $2`,
      [eventId, limit]
    );

    return result.rows;
  }

  /**
   * Test a webhook configuration
   */
  public async testWebhook(config: WebhookConfig, testEventData: any): Promise<{
    success: boolean;
    statusCode?: number;
    responseBody?: string;
    error?: string;
    duration: number;
  }> {
    const startTime = Date.now();
    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'User-Agent': 'DerPlanner-Task-Event-Planner-Webhook-Test/1.0',
        ...config.headers,
      };

      // Add authentication
      if (config.authentication) {
        switch (config.authentication.type) {
          case 'bearer':
            if (config.authentication.token) {
              headers['Authorization'] = `Bearer ${config.authentication.token}`;
            }
            break;
        }
      }

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000);

      let response: Response;
      try {
        response = await fetch(config.url, {
          method: config.method,
          headers,
          body: config.method !== 'GET' ? JSON.stringify(testEventData) : undefined,
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timeoutId);
      }

      const responseText = await response.text();
      const duration = Date.now() - startTime;

      return {
        success: response.ok,
        statusCode: response.status,
        responseBody: responseText.substring(0, 1000),
        duration,
      };
    } catch (error) {
      const duration = Date.now() - startTime;
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        duration,
      };
    }
  }

  /**
   * Execute a task webhook when status changes
   */
  public async executeTaskWebhook(
    taskId: string,
    taskData: any,
    config: TaskWebhookConfig,
    triggerEvent: string,
    previousStatus?: string,
    newStatus?: string,
    retryCount: number = 0
  ): Promise<boolean> {
    const maxRetries = config.retryConfig?.maxRetries || 3;
    const retryDelay = config.retryConfig?.retryDelay || 60000;

    // Check if this event should trigger the webhook
    if (!config.triggerEvents.includes(triggerEvent as any)) {
      console.log(`⏭️  Skipping webhook for task ${taskId}: event '${triggerEvent}' not in trigger list`);
      return false;
    }

    // If triggerStatuses is defined, check if new status matches
    if (config.triggerStatuses && config.triggerStatuses.length > 0) {
      if (!newStatus || !config.triggerStatuses.includes(newStatus as any)) {
        console.log(`⏭️  Skipping webhook for task ${taskId}: status '${newStatus}' not in trigger list`);
        return false;
      }
    }

    try {
      // Build headers
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'User-Agent': 'DerPlanner-Task-Event-Planner-Webhook/1.0',
        ...config.headers,
      };

      // Add authentication
      if (config.authentication) {
        switch (config.authentication.type) {
          case 'bearer':
            if (config.authentication.token) {
              headers['Authorization'] = `Bearer ${config.authentication.token}`;
            }
            break;
          case 'basic':
            if (config.authentication.username && config.authentication.password) {
              const encoded = Buffer.from(
                `${config.authentication.username}:${config.authentication.password}`
              ).toString('base64');
              headers['Authorization'] = `Basic ${encoded}`;
            }
            break;
          case 'api_key':
            if (config.authentication.apiKey && config.authentication.apiKeyHeader) {
              headers[config.authentication.apiKeyHeader] = config.authentication.apiKey;
            }
            break;
        }
      }

      // Build request body with default data
      const defaultBody = {
        task: {
          id: taskData.id,
          title: taskData.title,
          description: taskData.description,
          status: taskData.status,
          priority: taskData.priority,
          dueDate: taskData.due_date || taskData.dueDate,
          tags: taskData.tags,
        },
        event: {
          type: triggerEvent,
          previousStatus,
          newStatus,
          timestamp: new Date().toISOString(),
        },
        triggeredAt: new Date().toISOString(),
        retryCount,
      };
      
      // Merge custom body fields with default data
      const requestBody = config.body 
        ? { ...defaultBody, ...config.body }
        : defaultBody;

      // Execute HTTP request
      const startTime = Date.now();
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 30000);

      let response: Response;
      try {
        response = await fetch(config.url, {
          method: config.method,
          headers,
          body: config.method !== 'GET' ? JSON.stringify(requestBody) : undefined,
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timeoutId);
      }

      const responseText = await response.text();
      const duration = Date.now() - startTime;
      const success = response.ok;

      // Log the webhook execution
      await this.logTaskWebhookExecution({
        taskId,
        triggerEvent,
        previousStatus,
        newStatus,
        requestUrl: config.url,
        requestMethod: config.method,
        requestHeaders: headers,
        requestBody,
        responseStatus: response.status,
        responseBody: responseText.substring(0, 5000),
        errorMessage: success ? null : `HTTP ${response.status}: ${response.statusText}`,
        retryCount,
        success,
      });

      if (success) {
        // Update task with last triggered time
        await query(
          `UPDATE tasks 
           SET webhook_last_triggered = NOW(),
               webhook_trigger_count = webhook_trigger_count + 1
           WHERE id = $1`,
          [taskId]
        );

        console.log(`✅ Task webhook executed successfully for task ${taskId} (${duration}ms)`);
        return true;
      } else {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      console.error(`❌ Task webhook execution failed for task ${taskId}:`, errorMessage);

      // Log the failed attempt
      await this.logTaskWebhookExecution({
        taskId,
        triggerEvent,
        previousStatus,
        newStatus,
        requestUrl: config.url,
        requestMethod: config.method,
        requestHeaders: {},
        requestBody: config.body || {},
        errorMessage,
        retryCount,
        success: false,
      });

      // Retry logic
      if (retryCount < maxRetries) {
        console.log(`🔄 Retrying task webhook in ${retryDelay}ms (attempt ${retryCount + 1}/${maxRetries})`);
        await new Promise(resolve => setTimeout(resolve, retryDelay));
        return this.executeTaskWebhook(taskId, taskData, config, triggerEvent, previousStatus, newStatus, retryCount + 1);
      }

      return false;
    }
  }

  /**
   * Log task webhook execution to database
   */
  private async logTaskWebhookExecution(
    log: Omit<TaskWebhookLog, 'id' | 'triggeredAt'> & { 
      taskId: string;
      triggerEvent: string;
    }
  ): Promise<void> {
    try {
      await query(
        `INSERT INTO task_webhook_logs 
         (task_id, trigger_event, previous_status, new_status, request_url, request_method, 
          request_headers, request_body, response_status, response_body, error_message, 
          retry_count, success)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
        [
          log.taskId,
          log.triggerEvent,
          log.previousStatus || null,
          log.newStatus || null,
          log.requestUrl,
          log.requestMethod,
          JSON.stringify(log.requestHeaders),
          JSON.stringify(log.requestBody),
          log.responseStatus || null,
          log.responseBody || null,
          log.errorMessage || null,
          log.retryCount,
          log.success,
        ]
      );
    } catch (error) {
      console.error('❌ Error logging task webhook execution:', error);
    }
  }

  /**
   * Get task webhook logs
   */
  public async getTaskWebhookLogs(taskId: string, limit: number = 50): Promise<TaskWebhookLog[]> {
    const result = await query(
      `SELECT * FROM task_webhook_logs 
       WHERE task_id = $1 
       ORDER BY triggered_at DESC 
       LIMIT $2`,
      [taskId, limit]
    );

    return result.rows;
  }

  /**
   * Test a task webhook configuration
   */
  public async testTaskWebhook(config: TaskWebhookConfig, testTaskData: any): Promise<{
    success: boolean;
    statusCode?: number;
    responseBody?: string;
    error?: string;
    duration: number;
  }> {
    const startTime = Date.now();
    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'User-Agent': 'DerPlanner-Task-Event-Planner-Webhook-Test/1.0',
        ...config.headers,
      };

      if (config.authentication?.type === 'bearer' && config.authentication.token) {
        headers['Authorization'] = `Bearer ${config.authentication.token}`;
      }

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000);

      let response: Response;
      try {
        response = await fetch(config.url, {
          method: config.method,
          headers,
          body: config.method !== 'GET' ? JSON.stringify(testTaskData) : undefined,
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timeoutId);
      }

      const responseText = await response.text();
      const duration = Date.now() - startTime;

      return {
        success: response.ok,
        statusCode: response.status,
        responseBody: responseText.substring(0, 1000),
        duration,
      };
    } catch (error) {
      const duration = Date.now() - startTime;
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        duration,
      };
    }
  }
}

export const webhookService = WebhookService.getInstance();

