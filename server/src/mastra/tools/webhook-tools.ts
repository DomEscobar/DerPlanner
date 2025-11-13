import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { query } from '../../config/database';
import { TaskWebhookConfigSchema, WebhookConfigSchema } from '../../types';

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

/**
 * CURL Parser Utility
 * Extracts webhook configuration from CURL commands with robust parsing
 */
class CurlParser {
  private static readonly URL_REGEX = /https?:\/\/[^\s'"<>]+/;
  private static readonly METHOD_REGEX = /-X\s+(GET|POST|PUT|PATCH|DELETE)/i;
  private static readonly HEADER_REGEX = /-H\s+['"]([^:]+):\s*([^'"]+)['"]/g;
  private static readonly DATA_REGEX = /(?:--data(?:-raw|-binary)?|-d)\s+['"](.+?)['"]/s;
  
  static parse(curlCommand: string): {
    url: string;
    method: 'GET' | 'POST' | 'PUT' | 'PATCH';
    headers: Record<string, string>;
    body?: Record<string, any>;
    authentication: {
      type: 'none' | 'bearer' | 'basic' | 'api_key';
      token?: string;
      username?: string;
      password?: string;
    };
  } {
    // Clean up command
    const cleanCommand = curlCommand.replace(/\\\n/g, ' ').replace(/\s+/g, ' ').trim();
    
    // Extract URL
    const urlMatch = cleanCommand.match(this.URL_REGEX);
    if (!urlMatch) {
      throw new Error('No valid URL found in CURL command');
    }
    const url = urlMatch[0];
    
    // Validate URL format
    try {
      new URL(url);
    } catch {
      throw new Error(`Invalid URL format: ${url}`);
    }
    
    // Extract HTTP method
    const methodMatch = cleanCommand.match(this.METHOD_REGEX);
    const method = (methodMatch?.[1]?.toUpperCase() || 'POST') as 'GET' | 'POST' | 'PUT' | 'PATCH';
    
    // Validate method
    if (!['GET', 'POST', 'PUT', 'PATCH'].includes(method)) {
      throw new Error(`Unsupported HTTP method: ${method}. Only GET, POST, PUT, PATCH are supported.`);
    }
    
    // Extract headers
    const headers: Record<string, string> = {};
    const headerMatches = cleanCommand.matchAll(this.HEADER_REGEX);
    for (const match of headerMatches) {
      const headerName = match[1].trim();
      const headerValue = match[2].trim();
      headers[headerName] = headerValue;
    }
    
    // Extract body data
    let body: any = undefined;
    const dataMatch = cleanCommand.match(this.DATA_REGEX);
    if (dataMatch && dataMatch[1]) {
      try {
        // Try to parse as JSON
        body = JSON.parse(dataMatch[1]);
      } catch {
        // If not JSON, store as plain data field
        body = { data: dataMatch[1] };
      }
    }
    
    // Extract authentication from headers
    let authentication: any = { type: 'none' };
    
    if (headers['Authorization'] || headers['authorization']) {
      const authHeader = headers['Authorization'] || headers['authorization'];
      
      if (authHeader.startsWith('Bearer ')) {
        authentication = {
          type: 'bearer',
          token: authHeader.substring(7).trim()
        };
        // Remove from headers as it will be handled by webhook config
        delete headers['Authorization'];
        delete headers['authorization'];
      } else if (authHeader.startsWith('Basic ')) {
        // Decode basic auth
        try {
          const decoded = Buffer.from(authHeader.substring(6), 'base64').toString();
          const [username, password] = decoded.split(':');
          authentication = {
            type: 'basic',
            username,
            password
          };
          delete headers['Authorization'];
          delete headers['authorization'];
        } catch {
          authentication = { type: 'basic' };
        }
      }
    }
    
    // Check for API key in headers
    const apiKeyHeaders = ['X-API-Key', 'X-Api-Key', 'Api-Key', 'apikey'];
    for (const keyHeader of apiKeyHeaders) {
      const lowerKeyHeader = keyHeader.toLowerCase();
      const matchingHeader = Object.keys(headers).find(h => h.toLowerCase() === lowerKeyHeader);
      
      if (matchingHeader) {
        authentication = {
          type: 'api_key',
          apiKey: headers[matchingHeader],
          apiKeyHeader: matchingHeader
        };
        delete headers[matchingHeader];
        break;
      }
    }
    
    return {
      url,
      method,
      headers: Object.keys(headers).length > 0 ? headers : {},
      body,
      authentication
    };
  }
}

/**
 * URL Validator
 * Security validation for webhook URLs
 */
class WebhookUrlValidator {
  private static readonly BLOCKED_DOMAINS = [
    'localhost',
    '127.0.0.1',
    '0.0.0.0',
    '169.254.169.254' // AWS metadata endpoint
  ];
  
  private static readonly BLOCKED_PROTOCOLS = ['file:', 'ftp:'];
  
  static validate(url: string): { valid: boolean; error?: string } {
    try {
      const parsed = new URL(url);
      
      // Check protocol
      if (this.BLOCKED_PROTOCOLS.includes(parsed.protocol)) {
        return {
          valid: false,
          error: `Protocol ${parsed.protocol} is not allowed. Only HTTP/HTTPS are supported.`
        };
      }
      
      if (!['http:', 'https:'].includes(parsed.protocol)) {
        return {
          valid: false,
          error: 'Only HTTP and HTTPS protocols are supported'
        };
      }
      
      // Check for blocked domains (security)
      const hostname = parsed.hostname.toLowerCase();
      for (const blocked of this.BLOCKED_DOMAINS) {
        if (hostname === blocked || hostname.startsWith(blocked + ':')) {
          return {
            valid: false,
            error: `Cannot use ${blocked} as webhook destination for security reasons`
          };
        }
      }
      
      // Check for private IP ranges (optional - can be disabled in production)
      const privateIpPattern = /^(10\.|172\.(1[6-9]|2[0-9]|3[01])\.|192\.168\.)/;
      if (privateIpPattern.test(hostname)) {
        return {
          valid: false,
          error: 'Private IP addresses are not allowed for security reasons'
        };
      }
      
      return { valid: true };
    } catch (error) {
      return {
        valid: false,
        error: `Invalid URL format: ${error instanceof Error ? error.message : 'Unknown error'}`
      };
    }
  }
}

// ==================== TOOLS ====================

/**
 * Parse CURL Command Tool
 * Extracts webhook configuration from CURL commands
 */
export const parseCurlTool = createTool({
  id: 'parse_curl_command',
  description: 'Parse a CURL command to extract webhook configuration (URL, method, headers, auth, body). Use this when user provides a CURL command or API request example.',
  inputSchema: z.object({
    curlCommand: z.string().describe('The CURL command to parse (e.g., curl -X POST https://api.example.com/webhook -H "Authorization: Bearer token")')
  }),
  execute: async ({ context }) => {
    const { curlCommand } = context;
    
    try {
      // Validate input
      if (!curlCommand || curlCommand.trim().length === 0) {
        return {
          success: false,
          error: 'CURL command cannot be empty'
        };
      }
      
      // Parse CURL command
      const parsed = CurlParser.parse(curlCommand);
      
      // Validate URL
      const urlValidation = WebhookUrlValidator.validate(parsed.url);
      if (!urlValidation.valid) {
        return {
          success: false,
          error: urlValidation.error
        };
      }
      
      return {
        success: true,
        config: {
          enabled: true,
          url: parsed.url,
          method: parsed.method,
          headers: Object.keys(parsed.headers).length > 0 ? parsed.headers : undefined,
          body: parsed.body,
          authentication: parsed.authentication
        },
        message: `Parsed webhook config: ${parsed.method} ${parsed.url}`,
        details: {
          hasAuthentication: parsed.authentication.type !== 'none',
          hasCustomHeaders: Object.keys(parsed.headers).length > 0,
          hasBody: !!parsed.body
        }
      };
    } catch (error) {
      return {
        success: false,
        error: `Failed to parse CURL command: ${error instanceof Error ? error.message : 'Unknown error'}`
      };
    }
  }
});

/**
 * Configure Event Webhook Tool
 * Attaches webhook configuration to an event
 */
export const configureEventWebhookTool = createTool({
  id: 'configure_event_webhook',
  description: 'Configure a webhook for an event to trigger HTTP requests at the scheduled time. The webhook will execute when the event starts (with optional offset). Use after creating an event or when user wants to add automation.',
  inputSchema: z.object({
    eventId: z.string().uuid().describe('Event ID to attach webhook to'),
    url: z.string().url().describe('Webhook URL to call'),
    method: z.enum(['GET', 'POST', 'PUT', 'PATCH']).default('POST').describe('HTTP method'),
    headers: z.record(z.string()).optional().describe('Custom HTTP headers'),
    body: z.record(z.any()).optional().describe('Custom request body fields (will be merged with event data)'),
    triggerOffset: z.number().default(0).describe('Minutes before event start to trigger (0 = at start time, 30 = 30 minutes before)'),
    authentication: z.object({
      type: z.enum(['none', 'bearer', 'basic', 'api_key']).default('none'),
      token: z.string().optional(),
      username: z.string().optional(),
      password: z.string().optional(),
      apiKey: z.string().optional(),
      apiKeyHeader: z.string().optional()
    }).optional(),
    userId: z.string().describe('User ID for authorization')
  }),
  execute: async ({ context }) => {
    const { eventId, url, method, headers, body, triggerOffset, authentication, userId } = context;
    
    try {
      // Validate URL
      const urlValidation = WebhookUrlValidator.validate(url);
      if (!urlValidation.valid) {
        return {
          success: false,
          error: urlValidation.error
        };
      }
      
      // Verify event exists and belongs to user
      const eventCheck = await query(
        'SELECT id, title, start_date FROM events WHERE id = $1 AND user_id = $2',
        [eventId, userId]
      );
      
      if (eventCheck.rows.length === 0) {
        return {
          success: false,
          error: 'Event not found or you do not have permission to modify it'
        };
      }
      
      // Build webhook config
      const webhookConfig: any = {
        enabled: true,
        url,
        method,
        headers,
        body,
        triggerOffset: triggerOffset || 0,
        authentication: authentication || { type: 'none' },
        retryConfig: {
          maxRetries: 3,
          retryDelay: 60000
        }
      };
      
      // Validate against schema
      const validated = WebhookConfigSchema.parse(webhookConfig);
      
      // Update event with webhook config
      const result = await query(
        `UPDATE events 
         SET webhook_config = $1, updated_at = CURRENT_TIMESTAMP
         WHERE id = $2
         RETURNING id, title, webhook_config, start_date`,
        [JSON.stringify(validated), eventId]
      );
      
      const event = result.rows[0];
      const triggerTime = new Date(new Date(event.start_date).getTime() - (triggerOffset || 0) * 60000);
      
      return {
        success: true,
        event: {
          id: event.id,
          title: event.title,
          webhookEnabled: true,
          triggerTime: formatDateWithoutTimezone(triggerTime)
        },
        message: `Webhook configured for "${event.title}". Will trigger ${triggerOffset ? `${triggerOffset} minutes before` : 'at'} event start.`,
        webhookDetails: {
          url,
          method,
          hasAuthentication: validated.authentication?.type !== 'none',
          triggerOffset: triggerOffset || 0
        }
      };
    } catch (error) {
      console.error('Error configuring event webhook:', error);
      return {
        success: false,
        error: `Failed to configure webhook: ${error instanceof Error ? error.message : 'Unknown error'}`
      };
    }
  }
});

/**
 * Configure Task Webhook Tool
 * Attaches webhook configuration to a task
 */
export const configureTaskWebhookTool = createTool({
  id: 'configure_task_webhook',
  description: 'Configure a webhook for a task to trigger HTTP requests on status changes (completed, status_changed, created, updated, deleted). Use after creating a task or when user wants to add automation on task events.',
  inputSchema: z.object({
    taskId: z.string().uuid().describe('Task ID to attach webhook to'),
    url: z.string().url().describe('Webhook URL to call'),
    method: z.enum(['GET', 'POST', 'PUT', 'PATCH']).default('POST').describe('HTTP method'),
    headers: z.record(z.string()).optional().describe('Custom HTTP headers'),
    body: z.record(z.any()).optional().describe('Custom request body fields (will be merged with task data)'),
    triggerEvents: z.array(
      z.enum(['completed', 'status_changed', 'created', 'updated', 'deleted'])
    ).default(['completed']).describe('Events that trigger the webhook (default: completed)'),
    triggerStatuses: z.array(
      z.enum(['pending', 'in_progress', 'completed', 'cancelled'])
    ).optional().describe('Only trigger when task reaches these statuses (optional filter)'),
    authentication: z.object({
      type: z.enum(['none', 'bearer', 'basic', 'api_key']).default('none'),
      token: z.string().optional(),
      username: z.string().optional(),
      password: z.string().optional(),
      apiKey: z.string().optional(),
      apiKeyHeader: z.string().optional()
    }).optional(),
    userId: z.string().describe('User ID for authorization')
  }),
  execute: async ({ context }) => {
    const { taskId, url, method, headers, body, triggerEvents, triggerStatuses, authentication, userId } = context;
    
    try {
      // Validate URL
      const urlValidation = WebhookUrlValidator.validate(url);
      if (!urlValidation.valid) {
        return {
          success: false,
          error: urlValidation.error
        };
      }
      
      // Verify task exists and belongs to user
      const taskCheck = await query(
        'SELECT id, title, status FROM tasks WHERE id = $1 AND user_id = $2',
        [taskId, userId]
      );
      
      if (taskCheck.rows.length === 0) {
        return {
          success: false,
          error: 'Task not found or you do not have permission to modify it'
        };
      }
      
      // Build webhook config
      const webhookConfig: any = {
        enabled: true,
        url,
        method,
        headers,
        body,
        triggerEvents: triggerEvents || ['completed'],
        triggerStatuses,
        authentication: authentication || { type: 'none' },
        retryConfig: {
          maxRetries: 3,
          retryDelay: 60000
        }
      };
      
      // Validate against schema
      const validated = TaskWebhookConfigSchema.parse(webhookConfig);
      
      // Update task with webhook config
      const result = await query(
        `UPDATE tasks 
         SET webhook_config = $1, updated_at = CURRENT_TIMESTAMP
         WHERE id = $2
         RETURNING id, title, webhook_config, status`,
        [JSON.stringify(validated), taskId]
      );
      
      const task = result.rows[0];
      
      return {
        success: true,
        task: {
          id: task.id,
          title: task.title,
          currentStatus: task.status,
          webhookEnabled: true
        },
        message: `Webhook configured for "${task.title}". Will trigger on: ${(triggerEvents || ['completed']).join(', ')}.`,
        webhookDetails: {
          url,
          method,
          triggerEvents: validated.triggerEvents,
          hasAuthentication: validated.authentication?.type !== 'none',
          hasStatusFilter: !!validated.triggerStatuses && validated.triggerStatuses.length > 0
        }
      };
    } catch (error) {
      console.error('Error configuring task webhook:', error);
      return {
        success: false,
        error: `Failed to configure webhook: ${error instanceof Error ? error.message : 'Unknown error'}`
      };
    }
  }
});

/**
 * Get Webhook Status Tool
 * Retrieves webhook configuration and execution history
 */
export const getWebhookStatusTool = createTool({
  id: 'get_webhook_status',
  description: 'Get webhook configuration and execution logs for a task or event. Use this to check if a webhook is configured, view its settings, or see execution history.',
  inputSchema: z.object({
    id: z.string().uuid().describe('Task or Event ID'),
    type: z.enum(['task', 'event']).describe('Type of entity (task or event)'),
    userId: z.string().describe('User ID for authorization')
  }),
  execute: async ({ context }) => {
    const { id, type, userId } = context;
    
    try {
      const table = type === 'task' ? 'tasks' : 'events';
      const logTable = type === 'task' ? 'task_webhook_logs' : 'event_webhook_logs';
      const idColumn = type === 'task' ? 'task_id' : 'event_id';
      
      // Get webhook config
      const configResult = await query(
        `SELECT webhook_config, webhook_last_triggered, webhook_trigger_count, title 
         FROM ${table} WHERE id = $1 AND user_id = $2`,
        [id, userId]
      );
      
      if (configResult.rows.length === 0) {
        return {
          success: false,
          error: `${type === 'task' ? 'Task' : 'Event'} not found or you do not have permission to view it`
        };
      }
      
      const entity = configResult.rows[0];
      const webhookConfig = entity.webhook_config;
      
      if (!webhookConfig || !webhookConfig.enabled) {
        return {
          success: true,
          webhookEnabled: false,
          message: `No webhook configured for "${entity.title}"`
        };
      }
      
      // Get recent logs
      const logsResult = await query(
        `SELECT triggered_at, success, response_status, error_message, retry_count 
         FROM ${logTable} 
         WHERE ${idColumn} = $1 
         ORDER BY triggered_at DESC LIMIT 5`,
        [id]
      );
      
      const recentLogs = logsResult.rows.map(log => ({
        triggeredAt: formatDateWithoutTimezone(log.triggered_at),
        success: log.success,
        statusCode: log.response_status,
        error: log.error_message,
        retryCount: log.retry_count
      }));
      
      return {
        success: true,
        webhookEnabled: true,
        title: entity.title,
        config: {
          url: webhookConfig.url,
          method: webhookConfig.method,
          hasAuthentication: webhookConfig.authentication?.type !== 'none',
          authType: webhookConfig.authentication?.type,
          ...(type === 'event' && { triggerOffset: webhookConfig.triggerOffset }),
          ...(type === 'task' && { 
            triggerEvents: webhookConfig.triggerEvents,
            triggerStatuses: webhookConfig.triggerStatuses 
          })
        },
        statistics: {
          lastTriggered: formatDateWithoutTimezone(entity.webhook_last_triggered),
          totalTriggers: entity.webhook_trigger_count,
          recentExecutions: recentLogs.length
        },
        recentLogs,
        message: `Webhook is enabled for "${entity.title}". Triggered ${entity.webhook_trigger_count} times.`
      };
    } catch (error) {
      console.error('Error getting webhook status:', error);
      return {
        success: false,
        error: `Failed to get webhook status: ${error instanceof Error ? error.message : 'Unknown error'}`
      };
    }
  }
});

/**
 * Disable Webhook Tool
 * Disables webhook for a task or event
 */
export const disableWebhookTool = createTool({
  id: 'disable_webhook',
  description: 'Disable webhook for a task or event. Use when user wants to stop automatic HTTP triggers.',
  inputSchema: z.object({
    id: z.string().uuid().describe('Task or Event ID'),
    type: z.enum(['task', 'event']).describe('Type of entity (task or event)'),
    userId: z.string().describe('User ID for authorization')
  }),
  execute: async ({ context }) => {
    const { id, type, userId } = context;
    
    try {
      const table = type === 'task' ? 'tasks' : 'events';
      
      // Verify ownership
      const checkResult = await query(
        `SELECT id, title, webhook_config FROM ${table} WHERE id = $1 AND user_id = $2`,
        [id, userId]
      );
      
      if (checkResult.rows.length === 0) {
        return {
          success: false,
          error: `${type === 'task' ? 'Task' : 'Event'} not found or you do not have permission to modify it`
        };
      }
      
      const entity = checkResult.rows[0];
      
      if (!entity.webhook_config) {
        return {
          success: true,
          message: `No webhook configured for "${entity.title}"`
        };
      }
      
      // Disable webhook by setting enabled to false
      const updatedConfig = { ...entity.webhook_config, enabled: false };
      
      await query(
        `UPDATE ${table} 
         SET webhook_config = $1, updated_at = CURRENT_TIMESTAMP
         WHERE id = $2`,
        [JSON.stringify(updatedConfig), id]
      );
      
      return {
        success: true,
        message: `Webhook disabled for "${entity.title}"`
      };
    } catch (error) {
      console.error('Error disabling webhook:', error);
      return {
        success: false,
        error: `Failed to disable webhook: ${error instanceof Error ? error.message : 'Unknown error'}`
      };
    }
  }
});

