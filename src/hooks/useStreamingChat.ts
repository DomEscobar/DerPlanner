import { useState, useCallback, useRef, useEffect } from 'react';
import { chatApi } from '@/lib/api';
import { getUserId, getSessionId, getConversationId, updateLastActivity, getPersona } from '@/lib/storage';
import { StreamStep } from '@/components/StreamingProgress';
import { parseMessageContent } from '@/lib/message-parser';

export interface StreamingChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
  isStreaming?: boolean;
  steps?: StreamStep[];
  currentMessage?: string;
  actions?: Array<{
    type: string;
    data: any;
  }>;
}

export interface UseStreamingChatOptions {
  userId?: string;
  sessionId?: string;
  conversationId?: string;
  onError?: (error: string) => void;
  onStepUpdate?: (step: StreamStep) => void;
}

export const useStreamingChat = (options: UseStreamingChatOptions = {}) => {
  const {
    userId: providedUserId,
    sessionId: providedSessionId,
    conversationId: providedConversationId,
    onError,
    onStepUpdate,
  } = options;

  const userId = providedUserId || getUserId();
  const sessionId = providedSessionId || getSessionId();
  const conversationId = providedConversationId || getConversationId();

  const [messages, setMessages] = useState<StreamingChatMessage[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isInitialized, setIsInitialized] = useState(false);
  const eventSourceRef = useRef<EventSource | null>(null);

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
          // Convert server messages to StreamingChatMessage format
          const chatMessages: StreamingChatMessage[] = history.map((msg: any) => {
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
        }
      } catch (error) {
        console.error('Error loading conversation history:', error);
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

  const sendStreamingMessage = useCallback(async (content: string) => {
    if (!content.trim() || isStreaming || !isInitialized) return;

    // Set loading state immediately
    setIsStreaming(true);

    // Add user message
    const userMessage: StreamingChatMessage = {
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

    // Add streaming assistant message
    const streamingMessageId = `assistant-${Date.now()}`;
    const streamingMessage: StreamingChatMessage = {
      id: streamingMessageId,
      role: 'assistant',
      content: '',
      timestamp: new Date(),
      isStreaming: true,
      steps: [],
      currentMessage: 'Connecting to AI network...',
    };

    // Add both user message and AI placeholder in one state update to prevent jumping
    setMessages(prev => [...prev, userMessage, streamingMessage]);

    try {
      // Create EventSource for SSE
      const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:3001';
      
      // For SSE with POST data, we need to use fetch first to get a URL with a token
      // or use a different approach. For now, let's use a simpler approach:
      // We'll use GET with query parameters for this demo
      
      const response = await fetch(`${apiUrl}/api/agent/stream`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          message: content,
          userId,
          context: {
            sessionId,
            conversationId,
            currentDateTime: new Date().toISOString(),
            timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
            persona: getPersona() || undefined,
          },
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to connect to streaming endpoint');
      }

      if (!response.body) {
        throw new Error('No response body');
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n\n');
        
        // Keep the last incomplete line in the buffer
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.trim() || !line.startsWith('data: ')) continue;
          
          try {
            const data = JSON.parse(line.slice(6)); // Remove 'data: ' prefix
            
            switch (data.type) {
              case 'connected':
                setMessages(prev => prev.map(msg => 
                  msg.id === streamingMessageId
                    ? { ...msg, currentMessage: 'Connected! Analyzing your request...' }
                    : msg
                ));
                break;

              case 'start':
                setMessages(prev => prev.map(msg => 
                  msg.id === streamingMessageId
                    ? { ...msg, currentMessage: data.message }
                    : msg
                ));
                break;

              case 'step':
                const step: StreamStep = data.step;
                
                setMessages(prev => prev.map(msg => {
                  if (msg.id === streamingMessageId) {
                    const existingSteps = msg.steps || [];
                    const stepIndex = existingSteps.findIndex(s => s.number === step.number);
                    
                    let updatedSteps: StreamStep[];
                    if (stepIndex >= 0) {
                      // Update existing step
                      updatedSteps = existingSteps.map((s, i) => 
                        i === stepIndex ? step : s
                      );
                    } else {
                      // Add new step
                      updatedSteps = [...existingSteps, step];
                    }
                    
                    return {
                      ...msg,
                      steps: updatedSteps,
                      currentMessage: step.action,
                    };
                  }
                  return msg;
                }));
                
                onStepUpdate?.(step);
                break;

              case 'complete':
                // Ensure content is always a string
                const responseContent = (typeof data.result.response === 'string' && data.result.response.trim())
                  ? data.result.response
                  : data.result.response?.message || data.result.message || 'I understand your request. How can I help you with your tasks or events?';
                
                const actions = data.result.actions || data.actions || [];
                
                // Parse message content for embedded task/event references
                const { tasks: parsedTasks, events: parsedEvents, cleanedText } = parseMessageContent(responseContent);
                
                // Merge parsed tasks/events with existing actions
                const mergedActions = [...actions];
                
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
                
                const finalContent = cleanedText || responseContent;
                
                setMessages(prev => prev.map(msg => 
                  msg.id === streamingMessageId
                    ? {
                        ...msg,
                        content: finalContent,
                        isStreaming: false,
                        currentMessage: undefined,
                        actions: mergedActions,
                      }
                    : msg
                ));
                
                // Store assistant message in database
                try {
                  await chatApi.storeMessage(
                    userId,
                    conversationId,
                    sessionId,
                    'assistant',
                    finalContent,
                    { actions: mergedActions }
                  );
                } catch (error) {
                  console.warn('Failed to store assistant message:', error);
                }
                
                setIsStreaming(false);
                updateLastActivity();
                break;

              case 'error':
                setMessages(prev => prev.map(msg => 
                  msg.id === streamingMessageId
                    ? {
                        ...msg,
                        content: `Error: ${data.error}`,
                        isStreaming: false,
                        currentMessage: undefined,
                      }
                    : msg
                ));
                onError?.(data.error);
                setIsStreaming(false);
                break;

              case 'done':
                setIsStreaming(false);
                break;
            }
          } catch (error) {
            console.error('Error parsing SSE data:', error);
          }
        }
      }
    } catch (error) {
      console.error('Streaming error:', error);
      
      setMessages(prev => prev.map(msg => 
        msg.id === streamingMessageId
          ? {
              ...msg,
              content: `Sorry, I encountered an error: ${error instanceof Error ? error.message : 'Unknown error'}`,
              isStreaming: false,
              currentMessage: undefined,
            }
          : msg
      ));
      
      onError?.(error instanceof Error ? error.message : 'Unknown error');
      setIsStreaming(false);
    }
  }, [userId, sessionId, conversationId, isStreaming, onError, onStepUpdate, isInitialized]);

  const cancelStreaming = useCallback(() => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }
    setIsStreaming(false);
    
    // Update the last streaming message to indicate cancellation
    setMessages(prev => prev.map(msg => 
      msg.isStreaming
        ? { ...msg, content: 'Request cancelled', isStreaming: false, currentMessage: undefined }
        : msg
    ));
  }, []);

  return {
    messages,
    isStreaming,
    isLoading,
    sendStreamingMessage,
    cancelStreaming,
    userId,
    sessionId,
    conversationId,
  };
};

