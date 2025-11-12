import { retryWithBackoff } from './connection-status';
import { timezoneService } from './timezone';
import { getPersona } from './storage';

// API client for communicating with the Mastra server
const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';

export interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
}

export interface AgentRequest {
  message: string;
  context?: {
    userId?: string;
    sessionId?: string;
    conversationId?: string;
  };
  userId?: string;
}

export interface AgentResponse {
  message: string;
  actions?: Array<{
    type: string;
    data: any;
  }>;
  context?: {
    userId?: string;
    sessionId?: string;
    conversationId?: string;
  };
}

export interface Task {
  id: string;
  title: string;
  description?: string;
  status: 'pending' | 'in_progress' | 'completed' | 'cancelled';
  priority: 'low' | 'medium' | 'high' | 'urgent';
  dueDate?: string;
  createdAt: string;
  updatedAt: string;
  tags: string[];
  metadata?: Record<string, any>;
}

export interface Event {
  id: string;
  title: string;
  description?: string;
  startDate: string;
  endDate: string;
  location?: string;
  type: 'meeting' | 'appointment' | 'deadline' | 'reminder' | 'other';
  status: 'scheduled' | 'in_progress' | 'completed' | 'cancelled';
  createdAt: string;
  updatedAt: string;
  attendees: string[];
  metadata?: Record<string, any>;
  webhookConfig?: Record<string, any>;
}

export interface SearchRequest {
  query: string;
  filters?: Record<string, any>;
  limit?: number;
  threshold?: number;
}

export interface DailySummary {
  date: string;
  tasks: {
    total: number;
    completed: number;
    pending: number;
    inProgress: number;
  };
  events: {
    total: number;
    upcoming: number;
    completed: number;
  };
  message: string;
}

class ApiClient {
  private baseUrl: string;

  constructor(baseUrl: string = API_BASE_URL) {
    this.baseUrl = baseUrl;
  }

  async request<T>(
    endpoint: string,
    options: RequestInit = {},
    useRetry: boolean = true
  ): Promise<ApiResponse<T>> {
    const makeRequest = async (): Promise<ApiResponse<T>> => {
      try {
        const url = `${this.baseUrl}${endpoint}`;
        const response = await fetch(url, {
          headers: {
            'Content-Type': 'application/json',
            ...options.headers,
          },
          ...options,
        });

        const data = await response.json();

        if (!response.ok) {
          return {
            success: false,
            error: data.error || `HTTP ${response.status}: ${response.statusText}`,
          };
        }

        return data;
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Network error';
        
        // Rethrow for retry logic
        throw new Error(errorMessage);
      }
    };

    try {
      if (useRetry) {
        // Use retry logic with exponential backoff
        return await retryWithBackoff(makeRequest, {
          maxRetries: 3,
          initialDelay: 1000,
          maxDelay: 5000,
        });
      } else {
        return await makeRequest();
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Network error',
      };
    }
  }

  // Health check
  async healthCheck(): Promise<ApiResponse> {
    return this.request('/health');
  }

  // Task Agent
  async sendTaskMessage(request: AgentRequest): Promise<ApiResponse<AgentResponse>> {
    return this.request('/api/agent/task', {
      method: 'POST',
      body: JSON.stringify(request),
    });
  }

  // Event Agent
  async sendEventMessage(request: AgentRequest): Promise<ApiResponse<AgentResponse>> {
    return this.request('/api/agent/event', {
      method: 'POST',
      body: JSON.stringify(request),
    });
  }

  // General Agent (uses workflow)
  async sendGeneralMessage(request: AgentRequest): Promise<ApiResponse<AgentResponse>> {
    return this.request('/api/agent/general', {
      method: 'POST',
      body: JSON.stringify(request),
    });
  }

  // Daily Summary
  async getDailySummary(date?: string, userId?: string): Promise<ApiResponse<DailySummary>> {
    const params = new URLSearchParams();
    if (date) params.append('date', date);
    if (userId) params.append('userId', userId);
    
    const queryString = params.toString();
    const endpoint = queryString ? `/api/summary/daily?${queryString}` : '/api/summary/daily';
    
    return this.request(endpoint);
  }

  // Memory Management
  async getMemory(userId: string, sessionId?: string, conversationId?: string, limit?: number): Promise<ApiResponse> {
    const params = new URLSearchParams();
    if (sessionId) params.append('sessionId', sessionId);
    if (conversationId) params.append('conversationId', conversationId);
    if (limit) params.append('limit', limit.toString());
    
    const queryString = params.toString();
    const endpoint = queryString ? `/api/memory/${userId}?${queryString}` : `/api/memory/${userId}`;
    
    return this.request(endpoint);
  }

  async clearMemory(userId: string, sessionId?: string, conversationId?: string): Promise<ApiResponse> {
    const params = new URLSearchParams();
    if (sessionId) params.append('sessionId', sessionId);
    if (conversationId) params.append('conversationId', conversationId);
    
    const queryString = params.toString();
    const endpoint = queryString ? `/api/memory/${userId}?${queryString}` : `/api/memory/${userId}`;
    
    return this.request(endpoint, {
      method: 'DELETE',
    });
  }

  // RAG Search
  async search(request: SearchRequest): Promise<ApiResponse> {
    return this.request('/api/search', {
      method: 'POST',
      body: JSON.stringify(request),
    });
  }
}

// Create and export the API client instance
export const apiClient = new ApiClient();

// Helper functions for common operations
export const chatApi = {
  // Send a message to the general agent (recommended for most use cases)
  async sendMessage(message: string, userId: string, context?: any): Promise<AgentResponse> {
    const persona = getPersona();
    
    const response = await apiClient.sendGeneralMessage({
      message,
      userId,
      context: {
        ...context,
        currentDateTime: timezoneService.now(),
        timezone: timezoneService.getTimezone(),
        timezoneOffset: timezoneService.getTimezoneOffsetString(),
        persona: persona || undefined,
      },
    });

    if (response.success && response.data) {
      return response.data;
    }

    const errorMessage = response.error || 'Failed to send message';
    console.error('Chat API error:', errorMessage);
    throw new Error(errorMessage);
  },

  // Send a task-specific message
  async sendTaskMessage(message: string, userId: string, context?: any): Promise<AgentResponse> {
    const response = await apiClient.sendTaskMessage({
      message,
      userId,
      context: {
        ...context,
        currentDateTime: timezoneService.now(),
        timezone: timezoneService.getTimezone(),
        timezoneOffset: timezoneService.getTimezoneOffsetString(),
      },
    });

    if (response.success && response.data) {
      return response.data;
    }

    const errorMessage = response.error || 'Failed to send task message';
    console.error('Task API error:', errorMessage);
    throw new Error(errorMessage);
  },

  // Send an event-specific message
  async sendEventMessage(message: string, userId: string, context?: any): Promise<AgentResponse> {
    const response = await apiClient.sendEventMessage({
      message,
      userId,
      context: {
        ...context,
        currentDateTime: timezoneService.now(),
        timezone: timezoneService.getTimezone(),
        timezoneOffset: timezoneService.getTimezoneOffsetString(),
      },
    });

    if (response.success && response.data) {
      return response.data;
    }

    const errorMessage = response.error || 'Failed to send event message';
    console.error('Event API error:', errorMessage);
    throw new Error(errorMessage);
  },

  // Get daily summary
  async getDailySummary(userId: string): Promise<DailySummary> {
    const response = await apiClient.getDailySummary(undefined, userId);

    if (response.success && response.data) {
      return response.data;
    }

    const errorMessage = response.error || 'Failed to fetch daily summary';
    console.error('Daily summary error:', errorMessage);
    throw new Error(errorMessage);
  },

  // Search tasks and events
  async search(query: string, limit: number = 10): Promise<any[]> {
    const response = await apiClient.search({ query, limit });

    if (response.success && response.data) {
      return response.data;
    }

    const errorMessage = response.error || 'Failed to search';
    console.error('Search error:', errorMessage);
    throw new Error(errorMessage);
  },

  // Get conversation history from server
  async getConversationHistory(
    userId: string,
    conversationId?: string,
    sessionId?: string,
    limit?: number
  ): Promise<any[]> {
    const params = new URLSearchParams();
    params.append('userId', userId);
    if (conversationId) params.append('conversationId', conversationId);
    if (sessionId) params.append('sessionId', sessionId);
    if (limit) params.append('limit', limit.toString());

    const response = await apiClient.request<any[]>(`/api/conversation/history?${params.toString()}`);

    if (response.success && response.data) {
      return response.data;
    }

    const errorMessage = response.error || 'Failed to fetch conversation history';
    console.error('Conversation history error:', errorMessage);
    return [];
  },

  // Store a conversation message
  async storeMessage(
    userId: string,
    conversationId: string,
    sessionId: string,
    role: 'user' | 'assistant' | 'system',
    content: string,
    context?: any
  ): Promise<void> {
    const response = await apiClient.request('/api/conversation/message', {
      method: 'POST',
      body: JSON.stringify({
        userId,
        conversationId,
        sessionId,
        role,
        content,
        context
      })
    });

    if (!response.success) {
      const errorMessage = response.error || 'Failed to store message';
      console.error('Store message error:', errorMessage);
      throw new Error(errorMessage);
    }
  },

  // Clear conversation history
  async clearConversationHistory(userId: string, conversationId?: string): Promise<void> {
    const params = new URLSearchParams();
    params.append('userId', userId);
    if (conversationId) params.append('conversationId', conversationId);

    const response = await apiClient.request(
      `/api/conversation/history?${params.toString()}`,
      { method: 'DELETE' }
    );

    if (!response.success) {
      const errorMessage = response.error || 'Failed to clear conversation history';
      console.error('Clear conversation error:', errorMessage);
      throw new Error(errorMessage);
    }
  },

  // ==================== TASK CRUD OPERATIONS ====================
  
  // Get all tasks
  async getTasks(userId: string, filters?: { status?: string; priority?: string }): Promise<Task[]> {
    const params = new URLSearchParams();
    params.append('userId', userId);
    if (filters?.status) params.append('status', filters.status);
    if (filters?.priority) params.append('priority', filters.priority);

    const response = await apiClient.request<Task[]>(`/api/tasks?${params.toString()}`);

    if (response.success && response.data) {
      return response.data;
    }

    const errorMessage = response.error || 'Failed to fetch tasks';
    console.error('Get tasks error:', errorMessage);
    return [];
  },

  // Get a single task
  async getTask(taskId: string): Promise<Task | null> {
    const response = await apiClient.request<Task>(`/api/tasks/${taskId}`);

    if (response.success && response.data) {
      return response.data;
    }

    const errorMessage = response.error || 'Failed to fetch task';
    console.error('Get task error:', errorMessage);
    return null;
  },

  // Create a task
  async createTask(task: Partial<Task>, userId: string): Promise<Task> {
    const response = await apiClient.request<Task>('/api/tasks', {
      method: 'POST',
      body: JSON.stringify({ ...task, userId })
    });

    if (response.success && response.data) {
      return response.data;
    }

    const errorMessage = response.error || 'Failed to create task';
    console.error('Create task error:', errorMessage);
    throw new Error(errorMessage);
  },

  // Update a task
  async updateTask(taskId: string, updates: Partial<Task>): Promise<Task> {
    const response = await apiClient.request<Task>(`/api/tasks/${taskId}`, {
      method: 'PUT',
      body: JSON.stringify(updates)
    });

    if (response.success && response.data) {
      return response.data;
    }

    const errorMessage = response.error || 'Failed to update task';
    console.error('Update task error:', errorMessage);
    throw new Error(errorMessage);
  },

  // Delete a task
  async deleteTask(taskId: string): Promise<void> {
    const response = await apiClient.request<void>(`/api/tasks/${taskId}`, {
      method: 'DELETE'
    });

    if (!response.success) {
      const errorMessage = response.error || 'Failed to delete task';
      console.error('Delete task error:', errorMessage);
      throw new Error(errorMessage);
    }
  },

  // ==================== EVENT CRUD OPERATIONS ====================
  
  // Get all events
  async getEvents(userId: string, filters?: { type?: string; status?: string; upcoming?: boolean }): Promise<Event[]> {
    const params = new URLSearchParams();
    params.append('userId', userId);
    if (filters?.type) params.append('type', filters.type);
    if (filters?.status) params.append('status', filters.status);
    if (filters?.upcoming) params.append('upcoming', 'true');

    const response = await apiClient.request<Event[]>(`/api/events?${params.toString()}`);

    if (response.success && response.data) {
      return response.data;
    }

    const errorMessage = response.error || 'Failed to fetch events';
    console.error('Get events error:', errorMessage);
    return [];
  },

  // Get a single event
  async getEvent(eventId: string): Promise<Event | null> {
    const response = await apiClient.request<Event>(`/api/events/${eventId}`);

    if (response.success && response.data) {
      return response.data;
    }

    const errorMessage = response.error || 'Failed to fetch event';
    console.error('Get event error:', errorMessage);
    return null;
  },

  // Create an event
  async createEvent(event: Partial<Event>, userId: string): Promise<Event> {
    const response = await apiClient.request<Event>('/api/events', {
      method: 'POST',
      body: JSON.stringify({ ...event, userId })
    });

    if (response.success && response.data) {
      return response.data;
    }

    const errorMessage = response.error || 'Failed to create event';
    console.error('Create event error:', errorMessage);
    throw new Error(errorMessage);
  },

  // Update an event
  async updateEvent(eventId: string, updates: Partial<Event>): Promise<Event> {
    const response = await apiClient.request<Event>(`/api/events/${eventId}`, {
      method: 'PUT',
      body: JSON.stringify(updates)
    });

    if (response.success && response.data) {
      return response.data;
    }

    const errorMessage = response.error || 'Failed to update event';
    console.error('Update event error:', errorMessage);
    throw new Error(errorMessage);
  },

  // Delete an event
  async deleteEvent(eventId: string): Promise<void> {
    const response = await apiClient.request<void>(`/api/events/${eventId}`, {
      method: 'DELETE'
    });

    if (!response.success) {
      const errorMessage = response.error || 'Failed to delete event';
      console.error('Delete event error:', errorMessage);
      throw new Error(errorMessage);
    }
  },

  // ==================== EVENT WEBHOOK OPERATIONS ====================
  
  // Update event webhook configuration
  async updateEventWebhook(eventId: string, webhookConfig: any): Promise<void> {
    const response = await apiClient.request<void>(`/api/events/${eventId}/webhook`, {
      method: 'PUT',
      body: JSON.stringify({ webhookConfig })
    });

    if (!response.success) {
      const errorMessage = response.error || 'Failed to update event webhook';
      console.error('Update event webhook error:', errorMessage);
      throw new Error(errorMessage);
    }
  },

  // Test event webhook configuration
  async testEventWebhook(eventId: string, webhookConfig: any): Promise<any> {
    const response = await apiClient.request<any>(`/api/events/${eventId}/webhook/test`, {
      method: 'POST',
      body: JSON.stringify({ webhookConfig })
    });

    if (response.success && response.data) {
      return response.data;
    }

    const errorMessage = response.error || 'Failed to test event webhook';
    console.error('Test event webhook error:', errorMessage);
    throw new Error(errorMessage);
  },

  // Get event webhook logs
  async getEventWebhookLogs(eventId: string, limit: number = 50): Promise<any[]> {
    const response = await apiClient.request<any[]>(`/api/events/${eventId}/webhook/logs?limit=${limit}`);

    if (response.success && response.data) {
      return response.data;
    }

    const errorMessage = response.error || 'Failed to fetch event webhook logs';
    console.error('Get event webhook logs error:', errorMessage);
    return [];
  },

  // ==================== TASK WEBHOOK OPERATIONS ====================
  
  // Update task webhook configuration
  async updateTaskWebhook(taskId: string, webhookConfig: any): Promise<void> {
    const response = await apiClient.request<void>(`/api/tasks/${taskId}/webhook`, {
      method: 'PUT',
      body: JSON.stringify({ webhookConfig })
    });

    if (!response.success) {
      const errorMessage = response.error || 'Failed to update task webhook';
      console.error('Update task webhook error:', errorMessage);
      throw new Error(errorMessage);
    }
  },

  // Test task webhook configuration
  async testTaskWebhook(taskId: string, webhookConfig: any): Promise<any> {
    const response = await apiClient.request<any>(`/api/tasks/${taskId}/webhook/test`, {
      method: 'POST',
      body: JSON.stringify({ webhookConfig })
    });

    if (response.success && response.data) {
      return response.data;
    }

    const errorMessage = response.error || 'Failed to test task webhook';
    console.error('Test task webhook error:', errorMessage);
    throw new Error(errorMessage);
  },

  // Get task webhook logs
  async getTaskWebhookLogs(taskId: string, limit: number = 50): Promise<any[]> {
    const response = await apiClient.request<any[]>(`/api/tasks/${taskId}/webhook/logs?limit=${limit}`);

    if (response.success && response.data) {
      return response.data;
    }

    const errorMessage = response.error || 'Failed to fetch task webhook logs';
    console.error('Get task webhook logs error:', errorMessage);
    return [];
  },

  // ==================== TRANSCRIPTION ====================
  
  async transcribeAudio(audioBlob: Blob, userId: string): Promise<string> {
    const formData = new FormData();
    formData.append('audio', audioBlob, 'recording.webm');
    formData.append('userId', userId);

    const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:3001';
    
    try {
      const response = await fetch(`${apiUrl}/api/transcribe`, {
        method: 'POST',
        body: formData,
      });

      const data = await response.json();

      if (!data.success || !response.ok) {
        throw new Error(data.error || 'Transcription failed');
      }

      return data.data.text;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to transcribe audio';
      console.error('Transcription error:', errorMessage);
      throw new Error(errorMessage);
    }
  },

  // ==================== PUSH NOTIFICATIONS ====================
  
  // Get VAPID public key
  async getVapidPublicKey(): Promise<string> {
    const response: any = await apiClient.request('/api/push/public-key');
    
    if (response.success && response.publicKey) {
      return response.publicKey;
    }
    
    const errorMessage = response.error || 'Failed to get VAPID public key';
    console.error('VAPID key error:', errorMessage);
    throw new Error(errorMessage);
  },

  // Subscribe to push notifications
  async subscribeToPush(
    userId: string, 
    subscription: { endpoint: string; keys: { p256dh: string; auth: string } },
    alarmSettings: any
  ): Promise<void> {
    const response = await apiClient.request('/api/push/subscribe', {
      method: 'POST',
      body: JSON.stringify({ userId, subscription, alarmSettings })
    });

    if (!response.success) {
      const errorMessage = response.error || 'Failed to subscribe to push notifications';
      console.error('Push subscribe error:', errorMessage);
      throw new Error(errorMessage);
    }
  },

  // Unsubscribe from push notifications
  async unsubscribeFromPush(userId: string, endpoint: string): Promise<void> {
    const response = await apiClient.request('/api/push/unsubscribe', {
      method: 'POST',
      body: JSON.stringify({ userId, endpoint })
    });

    if (!response.success) {
      const errorMessage = response.error || 'Failed to unsubscribe from push notifications';
      console.error('Push unsubscribe error:', errorMessage);
      throw new Error(errorMessage);
    }
  },

  // Send test push notification
  async sendTestPush(
    userId: string,
    subscription: { endpoint: string; keys: { p256dh: string; auth: string } }
  ): Promise<{ success: boolean; error?: string }> {
    const response: any = await apiClient.request('/api/push/test', {
      method: 'POST',
      body: JSON.stringify({ userId, subscription })
    });

    if (response.success) {
      return { success: true };
    }

    const errorMessage = response.error || 'Failed to send test notification';
    console.error('Test push error:', errorMessage);
    throw new Error(errorMessage);
  },

  // Get push notification logs
  async getPushLogs(userId: string, limit: number = 50): Promise<any[]> {
    const response: any = await apiClient.request(`/api/push/logs/${userId}?limit=${limit}`);

    if (response.success && response.data) {
      return response.data;
    }

    const errorMessage = response.error || 'Failed to fetch push logs';
    console.error('Push logs error:', errorMessage);
    return [];
  },

  // Get user's push subscriptions
  async getPushSubscriptions(userId: string): Promise<any[]> {
    const response: any = await apiClient.request(`/api/push/subscriptions/${userId}`);

    if (response.success && response.data) {
      return response.data;
    }

    const errorMessage = response.error || 'Failed to fetch subscriptions';
    console.error('Push subscriptions error:', errorMessage);
    return [];
  }
};

export default apiClient;
