/**
 * localStorage utilities for persisting chat state
 * Provides type-safe storage operations with error handling
 */

const STORAGE_KEYS = {
  USER_ID: 'derplanner-task-event-planner:user-id',
  SESSION_ID: 'derplanner-task-event-planner:session-id',
  CONVERSATION_ID: 'derplanner-task-event-planner:conversation-id',
  CHAT_HISTORY: 'derplanner-task-event-planner:chat-history',
  LAST_ACTIVITY: 'derplanner-task-event-planner:last-activity',
  PERSONA: 'derplanner-task-event-planner:persona',
  TASK_VIEW_MODE: 'derplanner-task-event-planner:task-view-mode',
  CALENDAR_VIEW_MODE: 'derplanner-task-event-planner:calendar-view-mode',
  ALARM_SETTINGS: 'derplanner-task-event-planner:alarm-settings',
  PUSH_SUBSCRIPTION: 'derplanner-task-event-planner:push-subscription',
} as const;

// Session expiry time (24 hours)
const SESSION_EXPIRY_MS = 24 * 60 * 60 * 1000;

/**
 * Generate a unique user ID
 */
export const generateUserId = (): string => {
  return `user-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
};

/**
 * Generate a unique session ID
 */
export const generateSessionId = (): string => {
  return `session-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
};

/**
 * Generate a unique conversation ID
 */
export const generateConversationId = (): string => {
  return `conversation-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
};

/**
 * Get or create user ID
 */
export const getUserId = (): string => {
  try {
    let userId = localStorage.getItem(STORAGE_KEYS.USER_ID);
    
    if (!userId) {
      userId = generateUserId();
      localStorage.setItem(STORAGE_KEYS.USER_ID, userId);
    }
    
    return userId;
  } catch (error) {
    console.error('Error accessing user ID:', error);
    // Generate a fallback userId even if localStorage fails
    return generateUserId();
  }
};

/**
 * Get or create session ID
 * Creates a new session if the last one expired
 */
export const getSessionId = (): string => {
  try {
    const lastActivity = localStorage.getItem(STORAGE_KEYS.LAST_ACTIVITY);
    const sessionId = localStorage.getItem(STORAGE_KEYS.SESSION_ID);
    
    // Check if session expired
    if (lastActivity && sessionId) {
      const lastActivityTime = new Date(lastActivity).getTime();
      const now = Date.now();
      
      if (now - lastActivityTime < SESSION_EXPIRY_MS) {
        // Session is still valid
        updateLastActivity();
        return sessionId;
      }
    }
    
    // Create new session
    const newSessionId = generateSessionId();
    localStorage.setItem(STORAGE_KEYS.SESSION_ID, newSessionId);
    updateLastActivity();
    
    return newSessionId;
  } catch (error) {
    console.error('Error accessing session ID:', error);
    return `session-${Date.now()}`;
  }
};

/**
 * Get or create conversation ID
 */
export const getConversationId = (): string => {
  try {
    let conversationId = localStorage.getItem(STORAGE_KEYS.CONVERSATION_ID);
    
    if (!conversationId) {
      conversationId = generateConversationId();
      localStorage.setItem(STORAGE_KEYS.CONVERSATION_ID, conversationId);
    }
    
    return conversationId;
  } catch (error) {
    console.error('Error accessing conversation ID:', error);
    return `conversation-${Date.now()}`;
  }
};

/**
 * Update last activity timestamp
 */
export const updateLastActivity = (): void => {
  try {
    localStorage.setItem(STORAGE_KEYS.LAST_ACTIVITY, new Date().toISOString());
  } catch (error) {
    console.error('Error updating last activity:', error);
  }
};

/**
 * Save chat messages to localStorage
 */
export const saveChatHistory = (messages: any[]): void => {
  try {
    // Only save last 50 messages to avoid storage limits
    const messagesToSave = messages.slice(-50);
    localStorage.setItem(STORAGE_KEYS.CHAT_HISTORY, JSON.stringify(messagesToSave));
    updateLastActivity();
  } catch (error) {
    console.error('Error saving chat history:', error);
  }
};

/**
 * Load chat messages from localStorage
 */
export const loadChatHistory = (): any[] => {
  try {
    const stored = localStorage.getItem(STORAGE_KEYS.CHAT_HISTORY);
    
    if (!stored) {
      return [];
    }
    
    const messages = JSON.parse(stored);
    
    // Convert timestamp strings back to Date objects
    return messages.map((msg: any) => ({
      ...msg,
      timestamp: new Date(msg.timestamp),
    }));
  } catch (error) {
    console.error('Error loading chat history:', error);
    return [];
  }
};

/**
 * Clear all chat data
 */
export const clearChatData = (): void => {
  try {
    localStorage.removeItem(STORAGE_KEYS.CHAT_HISTORY);
    localStorage.removeItem(STORAGE_KEYS.CONVERSATION_ID);
    localStorage.removeItem(STORAGE_KEYS.LAST_ACTIVITY);
    // Keep user_id and session_id
  } catch (error) {
    console.error('Error clearing chat data:', error);
  }
};

/**
 * Start a new conversation
 */
export const startNewConversation = (): string => {
  try {
    clearChatData();
    const newConversationId = generateConversationId();
    localStorage.setItem(STORAGE_KEYS.CONVERSATION_ID, newConversationId);
    updateLastActivity();
    return newConversationId;
  } catch (error) {
    console.error('Error starting new conversation:', error);
    return `conversation-${Date.now()}`;
  }
};

/**
 * Check if session expired
 */
export const isSessionExpired = (): boolean => {
  try {
    const lastActivity = localStorage.getItem(STORAGE_KEYS.LAST_ACTIVITY);
    
    if (!lastActivity) {
      return true;
    }
    
    const lastActivityTime = new Date(lastActivity).getTime();
    const now = Date.now();
    
    return (now - lastActivityTime) >= SESSION_EXPIRY_MS;
  } catch (error) {
    console.error('Error checking session expiry:', error);
    return true;
  }
};

/**
 * Clear all storage (for logout)
 */
export const clearAllStorage = (): void => {
  try {
    Object.values(STORAGE_KEYS).forEach(key => {
      localStorage.removeItem(key);
    });
  } catch (error) {
    console.error('Error clearing all storage:', error);
  }
};

/**
 * Export storage for debugging
 */
export const exportStorage = (): Record<string, string | null> => {
  try {
    const data: Record<string, string | null> = {};
    Object.entries(STORAGE_KEYS).forEach(([key, storageKey]) => {
      data[key] = localStorage.getItem(storageKey);
    });
    return data;
  } catch (error) {
    console.error('Error exporting storage:', error);
    return {};
  }
};

/**
 * Get persona from localStorage
 */
export const getPersona = (): string | null => {
  try {
    return localStorage.getItem(STORAGE_KEYS.PERSONA);
  } catch (error) {
    console.error('Error getting persona:', error);
    return null;
  }
};

/**
 * Save persona to localStorage
 */
export const savePersona = (persona: string): void => {
  try {
    localStorage.setItem(STORAGE_KEYS.PERSONA, persona);
  } catch (error) {
    console.error('Error saving persona:', error);
    throw error;
  }
};

/**
 * Get task view mode from localStorage
 */
export const getTaskViewMode = (): "list" | "board" => {
  try {
    const viewMode = localStorage.getItem(STORAGE_KEYS.TASK_VIEW_MODE);
    if (viewMode === "list" || viewMode === "board") {
      return viewMode;
    }
    return "board";
  } catch (error) {
    console.error('Error getting task view mode:', error);
    return "board";
  }
};

/**
 * Save task view mode to localStorage
 */
export const saveTaskViewMode = (viewMode: "list" | "board"): void => {
  try {
    localStorage.setItem(STORAGE_KEYS.TASK_VIEW_MODE, viewMode);
  } catch (error) {
    console.error('Error saving task view mode:', error);
  }
};

/**
 * Get calendar view mode from localStorage
 */
export const getCalendarViewMode = (): "month" | "week" => {
  try {
    const viewMode = localStorage.getItem(STORAGE_KEYS.CALENDAR_VIEW_MODE);
    if (viewMode === "month" || viewMode === "week") {
      return viewMode;
    }
    return "week";
  } catch (error) {
    console.error('Error getting calendar view mode:', error);
    return "week";
  }
};

/**
 * Save calendar view mode to localStorage
 */
export const saveCalendarViewMode = (viewMode: "month" | "week"): void => {
  try {
    localStorage.setItem(STORAGE_KEYS.CALENDAR_VIEW_MODE, viewMode);
  } catch (error) {
    console.error('Error saving calendar view mode:', error);
  }
};

/**
 * Load IDs from URL parameters and save to localStorage if present
 * This enables sharing conversations via URL
 */
export const loadFromUrlParams = (): boolean => {
  try {
    const urlParams = new URLSearchParams(window.location.search);
    let hasParams = false;

    const userId = urlParams.get('userId');
    const sessionId = urlParams.get('sessionId');
    const conversationId = urlParams.get('conversationId');

    if (userId) {
      localStorage.setItem(STORAGE_KEYS.USER_ID, userId);
      hasParams = true;
    }

    if (sessionId) {
      localStorage.setItem(STORAGE_KEYS.SESSION_ID, sessionId);
      hasParams = true;
    }

    if (conversationId) {
      localStorage.setItem(STORAGE_KEYS.CONVERSATION_ID, conversationId);
      hasParams = true;
    }

    if (hasParams) {
      updateLastActivity();
      
      // Clean up URL parameters after loading them
      const newUrl = window.location.origin + window.location.pathname;
      window.history.replaceState({}, document.title, newUrl);
    }

    return hasParams;
  } catch (error) {
    console.error('Error loading from URL parameters:', error);
    return false;
  }
};

/**
 * Initialize IDs from URL params or localStorage
 * Call this early in app initialization
 */
export const initializeIds = (): { 
  userId: string; 
  sessionId: string; 
  conversationId: string;
  fromUrl: boolean;
} => {
  const fromUrl = loadFromUrlParams();
  
  return {
    userId: getUserId(),
    sessionId: getSessionId(),
    conversationId: getConversationId(),
    fromUrl,
  };
};

/**
 * Alarm settings interface
 */
export interface AlarmSettings {
  enabled: boolean;
  minutesBefore: number;
  soundEnabled: boolean;
  showNotification: boolean;
}

const DEFAULT_ALARM_SETTINGS: AlarmSettings = {
  enabled: false,
  minutesBefore: 15,
  soundEnabled: true,
  showNotification: true,
};

/**
 * Get alarm settings from localStorage
 */
export const getAlarmSettings = (): AlarmSettings => {
  try {
    const stored = localStorage.getItem(STORAGE_KEYS.ALARM_SETTINGS);
    if (!stored) {
      return DEFAULT_ALARM_SETTINGS;
    }
    return { ...DEFAULT_ALARM_SETTINGS, ...JSON.parse(stored) };
  } catch (error) {
    console.error('Error getting alarm settings:', error);
    return DEFAULT_ALARM_SETTINGS;
  }
};

/**
 * Save alarm settings to localStorage
 */
export const saveAlarmSettings = (settings: AlarmSettings): void => {
  try {
    localStorage.setItem(STORAGE_KEYS.ALARM_SETTINGS, JSON.stringify(settings));
  } catch (error) {
    console.error('Error saving alarm settings:', error);
    throw error;
  }
};

/**
 * Get push subscription from localStorage
 */
export const getPushSubscription = (): PushSubscription | null => {
  try {
    const stored = localStorage.getItem(STORAGE_KEYS.PUSH_SUBSCRIPTION);
    if (!stored) {
      return null;
    }
    return JSON.parse(stored);
  } catch (error) {
    console.error('Error getting push subscription:', error);
    return null;
  }
};

/**
 * Save push subscription to localStorage
 */
export const savePushSubscription = (subscription: PushSubscription): void => {
  try {
    localStorage.setItem(STORAGE_KEYS.PUSH_SUBSCRIPTION, JSON.stringify(subscription));
  } catch (error) {
    console.error('Error saving push subscription:', error);
    throw error;
  }
};

/**
 * Remove push subscription from localStorage
 */
export const removePushSubscription = (): void => {
  try {
    localStorage.removeItem(STORAGE_KEYS.PUSH_SUBSCRIPTION);
  } catch (error) {
    console.error('Error removing push subscription:', error);
  }
};
