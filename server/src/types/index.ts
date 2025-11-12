import { z } from 'zod';

// Task Schema
export const TaskSchema = z.object({
  id: z.string().uuid().optional(),
  title: z.string().min(1, 'Title is required'),
  description: z.string().optional(),
  status: z.enum(['pending', 'in_progress', 'completed', 'cancelled']).default('pending'),
  priority: z.enum(['low', 'medium', 'high', 'urgent']).default('medium'),
  dueDate: z.date().optional(),
  createdAt: z.date().default(() => new Date()),
  updatedAt: z.date().default(() => new Date()),
  tags: z.array(z.string()).default([]),
  metadata: z.record(z.any()).optional()
});

export type Task = z.infer<typeof TaskSchema>;

// Event Schema
export const EventSchema = z.object({
  id: z.string().uuid().optional(),
  title: z.string().min(1, 'Title is required'),
  description: z.string().optional(),
  startDate: z.date(),
  endDate: z.date(),
  location: z.string().optional(),
  type: z.enum(['meeting', 'appointment', 'deadline', 'reminder', 'other']).default('other'),
  status: z.enum(['scheduled', 'in_progress', 'completed', 'cancelled']).default('scheduled'),
  createdAt: z.date().default(() => new Date()),
  updatedAt: z.date().default(() => new Date()),
  attendees: z.array(z.string()).default([]),
  metadata: z.record(z.any()).optional()
});

export type Event = z.infer<typeof EventSchema>;

// API Response Types
export interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
}

export interface PaginatedResponse<T> extends ApiResponse<T[]> {
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

// Search and Filter Types
export interface TaskFilters {
  status?: Task['status'];
  priority?: Task['priority'];
  tags?: string[];
  dueDateFrom?: Date;
  dueDateTo?: Date;
  search?: string;
}

export interface EventFilters {
  type?: Event['type'];
  status?: Event['status'];
  startDateFrom?: Date;
  startDateTo?: Date;
  location?: string;
  search?: string;
}

// Memory and RAG Types
export interface MemoryContext {
  userId?: string;
  sessionId?: string;
  conversationId?: string;
  context?: Record<string, any>;
}

export interface RAGQuery {
  query: string;
  filters?: Record<string, any>;
  limit?: number;
  threshold?: number;
}

export interface RAGResult<T = any> {
  content: T;
  score: number;
  metadata: Record<string, any>;
}

// Agent Types
export interface AgentRequest {
  message: string;
  context?: MemoryContext;
  userId?: string;
}

export interface AgentResponse {
  message: string;
  actions?: Array<{
    type: string;
    data: any;
  }>;
  context?: MemoryContext;
}

// Webhook Configuration Schemas
export const WebhookConfigSchema = z.object({
  enabled: z.boolean().default(false),
  url: z.string().url('Must be a valid URL'),
  method: z.enum(['GET', 'POST', 'PUT', 'PATCH']).default('POST'),
  headers: z.record(z.string()).optional(),
  body: z.record(z.any()).optional(),
  triggerOffset: z.number().default(0).describe('Minutes before event start to trigger (0 = at start time)'),
  retryConfig: z.object({
    maxRetries: z.number().default(3),
    retryDelay: z.number().default(60000), // milliseconds
  }).optional(),
  authentication: z.object({
    type: z.enum(['none', 'bearer', 'basic', 'api_key']).default('none'),
    token: z.string().optional(),
    username: z.string().optional(),
    password: z.string().optional(),
    apiKey: z.string().optional(),
    apiKeyHeader: z.string().optional(),
  }).optional(),
});

export type WebhookConfig = z.infer<typeof WebhookConfigSchema>;

export const TaskWebhookConfigSchema = z.object({
  enabled: z.boolean().default(false),
  url: z.string().url('Must be a valid URL'),
  method: z.enum(['GET', 'POST', 'PUT', 'PATCH']).default('POST'),
  headers: z.record(z.string()).optional(),
  body: z.record(z.any()).optional(),
  triggerEvents: z.array(
    z.enum(['completed', 'status_changed', 'created', 'updated', 'deleted'])
  ).default(['completed']),
  triggerStatuses: z.array(
    z.enum(['pending', 'in_progress', 'completed', 'cancelled'])
  ).optional().describe('Only trigger when task reaches these statuses'),
  retryConfig: z.object({
    maxRetries: z.number().default(3),
    retryDelay: z.number().default(60000),
  }).optional(),
  authentication: z.object({
    type: z.enum(['none', 'bearer', 'basic', 'api_key']).default('none'),
    token: z.string().optional(),
    username: z.string().optional(),
    password: z.string().optional(),
    apiKey: z.string().optional(),
    apiKeyHeader: z.string().optional(),
  }).optional(),
});

export type TaskWebhookConfig = z.infer<typeof TaskWebhookConfigSchema>;

// Update Task Schema to include webhook_config
export const TaskSchemaWithWebhook = TaskSchema.extend({
  webhookConfig: TaskWebhookConfigSchema.optional(),
  webhookLastTriggered: z.date().optional(),
  webhookTriggerCount: z.number().default(0),
});

// Update Event Schema to include webhook_config
export const EventSchemaWithWebhook = EventSchema.extend({
  webhookConfig: WebhookConfigSchema.optional(),
  webhookLastTriggered: z.date().optional(),
  webhookTriggerCount: z.number().default(0),
});

export interface WebhookLog {
  id: string;
  eventId: string;
  triggeredAt: Date;
  triggerTime: Date;
  requestUrl: string;
  requestMethod: string;
  requestHeaders?: Record<string, string>;
  requestBody?: any;
  responseStatus?: number;
  responseBody?: string;
  errorMessage?: string;
  retryCount: number;
  success: boolean;
}

export interface TaskWebhookLog {
  id: string;
  taskId: string;
  triggeredAt: Date;
  triggerEvent: string;
  previousStatus?: string;
  newStatus?: string;
  requestUrl: string;
  requestMethod: string;
  requestHeaders?: Record<string, string>;
  requestBody?: any;
  responseStatus?: number;
  responseBody?: string;
  errorMessage?: string;
  retryCount: number;
  success: boolean;
}