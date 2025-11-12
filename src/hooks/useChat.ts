import { useState, useCallback, useRef, useEffect } from 'react';
import { chatApi, AgentResponse } from '@/lib/api';
import {
  getUserId,
  getSessionId,
  getConversationId,
  updateLastActivity,
  startNewConversation,
} from '@/lib/storage';
import { parseMessageContent } from '@/lib/message-parser';

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
  actions?: Array<{
    type: string;
    data: any;
  }>;
  isLoading?: boolean;
  error?: string;
}

export interface UseChatOptions {
  userId?: string;
  sessionId?: string;
  conversationId?: string;
  onError?: (error: string) => void;
  onSuccess?: (response: AgentResponse) => void;
}

const getWelcomeMessage = (): string => {
  const hour = new Date().getHours();
  let greeting = 'Hello';
  
  if (hour < 12) {
    greeting = 'Good morning';
  } else if (hour < 18) {
    greeting = 'Good afternoon';
  } else {
    greeting = 'Good evening';
  }
  
  return `${greeting}! 👋 I'm DerPlanner, your AI assistant. I'm here to help you manage tasks, schedule events, and stay organized.\n\n` +
    `You can tell me things like:\n` +
    `• "Add task: finish the report by Friday"\n` +
    `• "Schedule meeting with team tomorrow at 2pm"\n` +
    `• "Show me my tasks for today"\n\n` +
    `Just chat naturally - I understand context and can help you get things done! What would you like to work on?`;
};

export const useChat = (options: UseChatOptions = {}) => {
  const {
    userId: providedUserId,
    sessionId: providedSessionId,
    conversationId: providedConversationId,
    onError,
    onSuccess,
  } = options;

  // Use persistent IDs from localStorage if not provided
  const userId = providedUserId || getUserId();
  const sessionId = providedSessionId || getSessionId();
  const conversationId = providedConversationId || getConversationId();

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isInitialized, setIsInitialized] = useState(false);
  const abortControllerRef = useRef<AbortController | null>(null);

  // Load conversation history from server on mount
  useEffect(() => {
    const loadHistory = async () => {
      try {
        setIsLoading(true);
        const history = await chatApi.getConversationHistory(
          userId,
          conversationId,
          sessionId,
          50
        );

        if (history && history.length > 0) {
          // Convert server messages to ChatMessage format
          const chatMessages: ChatMessage[] = history.map((msg: any) => {
            if (msg.role === 'assistant' && msg.content) {
              // Parse message content for embedded task/event references
              const { tasks: parsedTasks, events: parsedEvents, cleanedText } = parseMessageContent(msg.content);
              
              // Merge parsed tasks/events with existing actions
              const mergedActions = [...(msg.actions || [])];
              
              parsedTasks.forEach(task => {
                if (!mergedActions.some(action => action.type === 'task' && action.data.id === task.id)) {
                  mergedActions.push({ type: 'task', data: task });
                }
              });
              
              parsedEvents.forEach(event => {
                if (!mergedActions.some(action => action.type === 'event' && action.data.id === event.id)) {
                  mergedActions.push({ type: 'event', data: event });
                }
              });
              
              return {
                id: msg.id,
                role: msg.role,
                content: cleanedText || msg.content,
                timestamp: new Date(msg.timestamp),
                actions: mergedActions,
              };
            }
            
            return {
              id: msg.id,
              role: msg.role,
              content: msg.content,
              timestamp: new Date(msg.timestamp),
              actions: msg.actions,
            };
          });
          setMessages(chatMessages);
        } else {
          // No history, show welcome message
          setMessages([
            {
              id: 'welcome',
              role: 'assistant',
              content: getWelcomeMessage(),
              timestamp: new Date(),
            }
          ]);
        }
      } catch (error) {
        console.error('Error loading conversation history:', error);
        // Show welcome message on error
        setMessages([
          {
            id: 'welcome',
            role: 'assistant',
            content: getWelcomeMessage(),
            timestamp: new Date(),
          }
        ]);
      } finally {
        setIsLoading(false);
        setIsInitialized(true);
        updateLastActivity();
      }
    };

    if (!isInitialized) {
      loadHistory();
    }
  }, [userId, sessionId, conversationId, isInitialized]);

  const sendMessage = useCallback(async (content: string) => {
    if (!content.trim() || !isInitialized) return;
    
    const wasSending = isLoading;
    if (wasSending) return;

    // Set loading state immediately
    setIsLoading(true);

    // Add user message
    const userMessage: ChatMessage = {
      id: `user-${Date.now()}`,
      role: 'user',
      content: content.trim(),
      timestamp: new Date(),
    };

    // Store user message in database
    try {
      await chatApi.storeMessage(userId, conversationId, sessionId, 'user', content.trim());
    } catch (error) {
      console.warn('Failed to store user message:', error);
    }

    // Add loading message
    const loadingMessage: ChatMessage = {
      id: `loading-${Date.now()}`,
      role: 'assistant',
      content: '',
      timestamp: new Date(),
      isLoading: true,
    };

    // Add both user message and AI placeholder in one state update to prevent jumping
    setMessages(prev => [...prev, userMessage, loadingMessage]);

    try {
      // Cancel any ongoing request
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }

      // Create new abort controller
      abortControllerRef.current = new AbortController();

      // Send message to API
      const response = await chatApi.sendMessage(content, userId, {
        sessionId,
        conversationId,
      });

      // Parse message content for embedded task/event references
      const { tasks: parsedTasks, events: parsedEvents, cleanedText } = parseMessageContent(response.message);
      
      // Merge parsed tasks/events with existing actions
      const mergedActions = [...(response.actions || [])];
      
      // Add parsed tasks as actions if they don't already exist
      parsedTasks.forEach(task => {
        if (!mergedActions.some(action => action.type === 'task' && action.data.id === task.id)) {
          mergedActions.push({ type: 'task', data: task });
        }
      });
      
      // Add parsed events as actions if they don't already exist
      parsedEvents.forEach(event => {
        if (!mergedActions.some(action => action.type === 'event' && action.data.id === event.id)) {
          mergedActions.push({ type: 'event', data: event });
        }
      });

      // Remove loading message and add assistant response
      const assistantMessage: ChatMessage = {
        id: `assistant-${Date.now()}`,
        role: 'assistant',
        content: cleanedText || response.message,
        timestamp: new Date(),
        actions: mergedActions,
      };

      setMessages(prev => {
        const withoutLoading = prev.filter(msg => !msg.isLoading);
        return [...withoutLoading, assistantMessage];
      });

      // Store assistant message in database
      try {
        await chatApi.storeMessage(
          userId, 
          conversationId, 
          sessionId, 
          'assistant', 
          response.message,
          { actions: response.actions }
        );
      } catch (error) {
        console.warn('Failed to store assistant message:', error);
      }

      onSuccess?.(response);

    } catch (error) {
      // Remove loading message and add error message
      setMessages(prev => {
        const withoutLoading = prev.filter(msg => !msg.isLoading);
        const errorMessage = error instanceof Error ? error.message : 'An error occurred';
        
        return [
          ...withoutLoading,
          {
            id: `error-${Date.now()}`,
            role: 'assistant',
            content: `Sorry, I encountered an error: ${errorMessage}`,
            timestamp: new Date(),
            error: errorMessage,
          }
        ];
      });

      onError?.(error instanceof Error ? error.message : 'Unknown error');
    } finally {
      setIsLoading(false);
      abortControllerRef.current = null;
      updateLastActivity();
    }
  }, [userId, sessionId, conversationId, isInitialized, onError, onSuccess]);

  const sendTaskMessage = useCallback(async (content: string) => {
    if (!content.trim() || isLoading) return;

    // Set loading state immediately
    setIsLoading(true);

    const userMessage: ChatMessage = {
      id: `user-${Date.now()}`,
      role: 'user',
      content: content.trim(),
      timestamp: new Date(),
    };

    const loadingMessage: ChatMessage = {
      id: `loading-${Date.now()}`,
      role: 'assistant',
      content: '',
      timestamp: new Date(),
      isLoading: true,
    };

    setMessages(prev => [...prev, userMessage, loadingMessage]);

    try {
      const response = await chatApi.sendTaskMessage(content, userId, {
        sessionId,
        conversationId,
      });

      // Parse message content for embedded task/event references
      const { tasks: parsedTasks, events: parsedEvents, cleanedText } = parseMessageContent(response.message);
      
      // Merge parsed tasks/events with existing actions
      const mergedActions = [...(response.actions || [])];
      
      parsedTasks.forEach(task => {
        if (!mergedActions.some(action => action.type === 'task' && action.data.id === task.id)) {
          mergedActions.push({ type: 'task', data: task });
        }
      });
      
      parsedEvents.forEach(event => {
        if (!mergedActions.some(action => action.type === 'event' && action.data.id === event.id)) {
          mergedActions.push({ type: 'event', data: event });
        }
      });

      setMessages(prev => {
        const withoutLoading = prev.filter(msg => !msg.isLoading);
        return [
          ...withoutLoading,
          {
            id: `assistant-${Date.now()}`,
            role: 'assistant',
            content: cleanedText || response.message,
            timestamp: new Date(),
            actions: mergedActions,
          }
        ];
      });

      onSuccess?.(response);

    } catch (error) {
      setMessages(prev => {
        const withoutLoading = prev.filter(msg => !msg.isLoading);
        const errorMessage = error instanceof Error ? error.message : 'An error occurred';
        
        return [
          ...withoutLoading,
          {
            id: `error-${Date.now()}`,
            role: 'assistant',
            content: `Sorry, I encountered an error: ${errorMessage}`,
            timestamp: new Date(),
            error: errorMessage,
          }
        ];
      });

      onError?.(error instanceof Error ? error.message : 'Unknown error');
    } finally {
      setIsLoading(false);
    }
  }, [userId, sessionId, conversationId, isLoading, onError, onSuccess]);

  const sendEventMessage = useCallback(async (content: string) => {
    if (!content.trim() || isLoading) return;

    // Set loading state immediately
    setIsLoading(true);

    const userMessage: ChatMessage = {
      id: `user-${Date.now()}`,
      role: 'user',
      content: content.trim(),
      timestamp: new Date(),
    };

    const loadingMessage: ChatMessage = {
      id: `loading-${Date.now()}`,
      role: 'assistant',
      content: '',
      timestamp: new Date(),
      isLoading: true,
    };

    setMessages(prev => [...prev, userMessage, loadingMessage]);

    try {
      const response = await chatApi.sendEventMessage(content, userId, {
        sessionId,
        conversationId,
      });

      // Parse message content for embedded task/event references
      const { tasks: parsedTasks, events: parsedEvents, cleanedText } = parseMessageContent(response.message);
      
      // Merge parsed tasks/events with existing actions
      const mergedActions = [...(response.actions || [])];
      
      parsedTasks.forEach(task => {
        if (!mergedActions.some(action => action.type === 'task' && action.data.id === task.id)) {
          mergedActions.push({ type: 'task', data: task });
        }
      });
      
      parsedEvents.forEach(event => {
        if (!mergedActions.some(action => action.type === 'event' && action.data.id === event.id)) {
          mergedActions.push({ type: 'event', data: event });
        }
      });

      setMessages(prev => {
        const withoutLoading = prev.filter(msg => !msg.isLoading);
        return [
          ...withoutLoading,
          {
            id: `assistant-${Date.now()}`,
            role: 'assistant',
            content: cleanedText || response.message,
            timestamp: new Date(),
            actions: mergedActions,
          }
        ];
      });

      onSuccess?.(response);

    } catch (error) {
      setMessages(prev => {
        const withoutLoading = prev.filter(msg => !msg.isLoading);
        const errorMessage = error instanceof Error ? error.message : 'An error occurred';
        
        return [
          ...withoutLoading,
          {
            id: `error-${Date.now()}`,
            role: 'assistant',
            content: `Sorry, I encountered an error: ${errorMessage}`,
            timestamp: new Date(),
            error: errorMessage,
          }
        ];
      });

      onError?.(error instanceof Error ? error.message : 'Unknown error');
    } finally {
      setIsLoading(false);
    }
  }, [userId, sessionId, conversationId, isLoading, onError, onSuccess]);

  const clearMessages = useCallback(async () => {
    try {
      await chatApi.clearConversationHistory(userId, conversationId);
      setMessages([
        {
          id: 'welcome',
          role: 'assistant',
          content: getWelcomeMessage(),
          timestamp: new Date(),
        }
      ]);
    } catch (error) {
      console.error('Error clearing messages:', error);
    }
  }, [userId, conversationId]);

  const startNewChat = useCallback(async () => {
    try {
      const newConvId = startNewConversation();
      await chatApi.clearConversationHistory(userId, conversationId);
      setMessages([
        {
          id: 'welcome',
          role: 'assistant',
          content: getWelcomeMessage(),
          timestamp: new Date(),
        }
      ]);
      setIsInitialized(false); // Trigger reload
      return newConvId;
    } catch (error) {
      console.error('Error starting new chat:', error);
      return conversationId;
    }
  }, [userId, conversationId]);

  const cancelRequest = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    setIsLoading(false);
    
    // Remove any loading messages
    setMessages(prev => prev.filter(msg => !msg.isLoading));
  }, []);

  return {
    messages,
    isLoading,
    sendMessage,
    sendTaskMessage,
    sendEventMessage,
    clearMessages,
    startNewChat,
    cancelRequest,
    userId,
    sessionId,
    conversationId,
  };
};
