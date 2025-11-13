import { useState, useRef, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Send, Loader2, AlertCircle, Wifi, WifiOff, Sparkles, ChevronUp, CheckSquare, Calendar, Search, Zap, Mic } from "lucide-react";
import { TaskPreview } from "@/components/TaskPreview";
import { EventPreview } from "@/components/EventPreview";
import { StreamingProgress } from "@/components/StreamingProgress";
import { MicrophonePermissionModal } from "@/components/MicrophonePermissionModal";
import { useChat, ChatMessage } from "@/hooks/useChat";
import { useStreamingChat } from "@/hooks/useStreamingChat";
import { useVoiceRecorder } from "@/hooks/useVoiceRecorder";
import { useToast } from "@/hooks/use-toast";
import { ConnectionStatus, createConnectionMonitor } from "@/lib/connection-status";
import ReactMarkdown from "react-markdown";
import { motion, AnimatePresence } from "framer-motion";
import { MatrixAvatar, AvatarState } from "./MatrixAvatar";
import { PersonaModal } from "./PersonaModal";

interface Message extends ChatMessage {
  tasks?: Array<{
    id: string;
    title: string;
    description?: string;
    status: "pending" | "in_progress" | "completed" | "cancelled";
    priority: "low" | "medium" | "high" | "urgent";
    dueDate?: Date | string;
    tags?: string[];
    createdAt?: Date | string;
    updatedAt?: Date | string;
    metadata?: Record<string, any>;
  }>;
  events?: Array<{
    id: string;
    title: string;
    description?: string;
    startDate: Date | string;
    endDate: Date | string;
    location?: string;
    type: "meeting" | "appointment" | "deadline" | "reminder" | "other";
    status: "scheduled" | "in_progress" | "completed" | "cancelled";
    attendees?: string[];
    createdAt?: Date | string;
    updatedAt?: Date | string;
    metadata?: Record<string, any>;
  }>;
}

export const ChatInterface = () => {
  const [input, setInput] = useState("");
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>('online');
  const [useStreaming, setUseStreaming] = useState(true);
  const [messagesToShow, setMessagesToShow] = useState(10);
  const [personaModalOpen, setPersonaModalOpen] = useState(false);
  const [permissionModalOpen, setPermissionModalOpen] = useState(false);
  const [permissionStatus, setPermissionStatus] = useState<'requesting' | 'denied' | 'error'>('requesting');
  const scrollAreaRef = useRef<HTMLDivElement>(null);
  const { toast } = useToast();

  const {
    isRecording,
    isProcessing,
    startRecording,
    recordAndTranscribe,
    cancelRecording,
    requestPermission,
  } = useVoiceRecorder({
    onTranscription: async (text) => {
      if (useStreaming) {
        await sendStreamingMessage(text);
      } else {
        await sendMessage(text);
      }
      setPermissionModalOpen(false);
    },
    onError: (error) => {
      setPermissionModalOpen(false);
      toast({
        title: "Voice Recording Error",
        description: error,
        variant: "destructive",
      });
    },
    onPermissionStatus: (status) => {
      if (status === 'requesting') {
        setPermissionModalOpen(true);
        setPermissionStatus('requesting');
      } else if (status === 'granted') {
        setPermissionModalOpen(false);
      } else if (status === 'denied') {
        setPermissionStatus('denied');
      } else if (status === 'error') {
        setPermissionStatus('error');
      }
    },
  });

  // Monitor connection status
  useEffect(() => {
    const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:3001';
    const monitor = createConnectionMonitor(apiUrl);

    const unsubscribe = monitor.subscribe((status) => {
      setConnectionStatus(status);

      if (status === 'offline') {
        toast({
          title: "Connection Lost",
          description: "You're offline. Messages will be sent when connection is restored.",
          variant: "destructive",
        });
      } else if (status === 'online') {
      }
    });

    return () => {
      unsubscribe();
      monitor.destroy();
    };
  }, [toast]);

  // Regular chat hook
  const {
    messages: regularMessages,
    isLoading,
    sendMessage,
    clearMessages,
    startNewChat,
    userId,
    sessionId,
    conversationId,
  } = useChat({
    onError: (error) => {
      toast({
        title: "Error",
        description: error,
        variant: "destructive",
      });
    },
    onSuccess: (response) => {
      console.log('Chat response received:', response);
    },
  });

  // Streaming chat hook
  const {
    messages: streamingMessages,
    isStreaming,
    isLoading: isLoadingHistory,
    sendStreamingMessage,
    cancelStreaming,
  } = useStreamingChat({
    onError: (error) => {
      toast({
        title: "Streaming Error",
        description: error,
        variant: "destructive",
      });
    },
    onStepUpdate: (step) => {
      console.log('Step update:', step);
    },
  });

  // Use either regular or streaming messages based on mode
  const chatMessages = useStreaming ? streamingMessages : regularMessages;

  // Convert chat messages to display messages
  const allMessages: Message[] = chatMessages.map(msg => {
    const tasks = msg.actions
      ?.filter(action => action.type === 'task')
      .map((action, actionIndex) => ({
        id: action.data.id || `task-${msg.id}-${actionIndex}`,
        title: action.data.title || 'Task',
        description: action.data.description,
        status: (action.data.status || 'pending') as "pending" | "in_progress" | "completed" | "cancelled",
        priority: (action.data.priority || 'medium') as "low" | "medium" | "high" | "urgent",
        dueDate: action.data.dueDate || action.data.due_date,
        tags: action.data.tags,
        createdAt: action.data.createdAt || action.data.created_at,
        updatedAt: action.data.updatedAt || action.data.updated_at,
        metadata: action.data.metadata,
      }));

    const events = msg.actions
      ?.filter(action => action.type === 'event')
      .map((action, actionIndex) => ({
        id: action.data.id || `event-${msg.id}-${actionIndex}`,
        title: action.data.title || 'Event',
        description: action.data.description,
        startDate: action.data.startDate || action.data.start_date || new Date().toISOString(),
        endDate: action.data.endDate || action.data.end_date || new Date().toISOString(),
        location: action.data.location,
        type: (action.data.type || 'other') as "meeting" | "appointment" | "deadline" | "reminder" | "other",
        status: (action.data.status || 'scheduled') as "scheduled" | "in_progress" | "completed" | "cancelled",
        attendees: action.data.attendees,
        createdAt: action.data.createdAt || action.data.created_at,
        updatedAt: action.data.updatedAt || action.data.updated_at,
        metadata: action.data.metadata,
      }));


    return {
      ...msg,
      tasks,
      events,
    };
  });

  // Show only recent messages based on messagesToShow count
  const messages: Message[] = (() => {
    if (allMessages.length === 0) return [];

    // Show the last N messages based on messagesToShow
    const startIndex = Math.max(0, allMessages.length - messagesToShow);
    return allMessages.slice(startIndex);
  })();

  const handleSend = async () => {
    if (!input.trim() || isLoading || isStreaming) return;

    const messageToSend = input;
    setInput("");

    // Reset to show last 10 messages when sending new message
    setMessagesToShow(10);

    if (useStreaming) {
      await sendStreamingMessage(messageToSend);
    } else {
      await sendMessage(messageToSend);
    }
  };

  const handleMicPress = async (e: React.MouseEvent | React.TouchEvent) => {
    e.preventDefault();
    e.stopPropagation();

    // Prevent text selection during recording
    document.body.style.userSelect = 'none';
    document.body.style.webkitUserSelect = 'none';

    // Request permission first (will show modal only if needed)
    await requestPermission();
    
    // Start recording immediately after permission is granted
    await startRecording();

    const handleRecordingStop = async () => {
      cleanup();
      try {
        await recordAndTranscribe(userId);
      } catch (error) {
        console.error('Error processing audio:', error);
      }
    };

    const handleRecordingCancel = () => {
      cleanup();
      cancelRecording();
    };

    const cleanup = () => {
      // Re-enable text selection
      document.body.style.userSelect = '';
      document.body.style.webkitUserSelect = '';

      document.removeEventListener('pointerup', handleRecordingStop);
      document.removeEventListener('pointercancel', handleRecordingCancel);
      document.removeEventListener('touchend', handleRecordingStop);
      document.removeEventListener('touchcancel', handleRecordingCancel);
    };

    document.addEventListener('pointerup', handleRecordingStop, { once: true });
    document.addEventListener('pointercancel', handleRecordingCancel, { once: true });
    document.addEventListener('touchend', handleRecordingStop, { once: true });
    document.addEventListener('touchcancel', handleRecordingCancel, { once: true });
  };

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    if (scrollAreaRef.current) {
      scrollAreaRef.current.scrollTop = scrollAreaRef.current.scrollHeight;
    }
  }, [messages]);

  // Determine avatar state based on conversation context
  const getAvatarState = (): AvatarState => {
    if (connectionStatus === 'offline') return 'offline';
    if (isRecording) return 'recording';
    if (isStreaming || isLoadingHistory) return 'streaming';
    if (isLoading || isProcessing) return 'thinking';

    // Check last message for tasks/events/errors
    const lastMessage = messages[messages.length - 1];
    if (lastMessage?.error) return 'error';
    if (lastMessage?.tasks && lastMessage.tasks.length > 0) return 'task-created';
    if (lastMessage?.events && lastMessage.events.length > 0) return 'event-created';

    if (messages.length > 0 && !isStreaming && !isLoading) return 'success';

    return 'idle';
  };

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Connection Status Bar */}
      {connectionStatus !== 'online' && (
        <div className={`flex-shrink-0 px-4 py-2 text-sm flex items-center gap-2 ${connectionStatus === 'offline'
            ? 'bg-destructive text-destructive-foreground'
            : 'bg-yellow-500 text-white'
          }`}>
          {connectionStatus === 'offline' ? (
            <>
              <WifiOff className="h-4 w-4" />
              <span>You're offline. Reconnecting...</span>
            </>
          ) : (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              <span>Reconnecting...</span>
            </>
          )}
        </div>
      )}

      <div
        ref={scrollAreaRef}
        className="chat-scroll-area flex-1 min-h-0 p-4 relative"
      >
        {/* Matrix Avatar Background - Compact when messages exist, adaptive to state */}
        <MatrixAvatar
          compact={messages.length > 0}
          state={getAvatarState()}
          onClick={() => setPersonaModalOpen(true)}
        />

        {/* Persona Modal */}
        {userId && (
          <PersonaModal
            open={personaModalOpen}
            onOpenChange={setPersonaModalOpen}
            userId={userId}
            conversationId={conversationId}
            sessionId={sessionId}
          />
        )}

        {/* Microphone Permission Modal */}
        <MicrophonePermissionModal
          open={permissionModalOpen}
          status={permissionStatus}
          onRetry={() => {
            setPermissionStatus('requesting');
            requestPermission();
          }}
        />

        <div className="max-w-3xl mx-auto space-y-4 relative z-10">
          {/* Loading state - Show while fetching conversation history */}
          {isLoadingHistory && messages.length === 0 && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="flex flex-col items-center justify-center gap-6 pt-20"
            >
              <div className="flex flex-col items-center gap-4">
                <Loader2 className="h-12 w-12 text-primary animate-spin" />
                <div className="text-center space-y-2">
                  <p className="text-sm font-medium text-foreground">Loading your conversations...</p>
                  <p className="text-xs text-muted-foreground">Just a moment while we fetch your messages</p>
                </div>
              </div>
              {/* Loading skeleton for messages */}
              <div className="w-full max-w-2xl space-y-4 mt-8">
                {[...Array(3)].map((_, i) => (
                  <motion.div
                    key={`skeleton-${i}`}
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: i * 0.1 }}
                    className={`flex ${i % 2 === 0 ? 'justify-end' : 'justify-start'}`}
                  >
                    <div className={`rounded-2xl p-4 ${i % 2 === 0 ? 'bg-secondary' : 'bg-muted'} animate-pulse`}>
                      <div className="space-y-2">
                        <div className={`h-3 ${i % 2 === 0 ? 'w-32' : 'w-48'} bg-muted-foreground/20 rounded`}></div>
                        <div className={`h-3 ${i % 2 === 0 ? 'w-24' : 'w-40'} bg-muted-foreground/20 rounded`}></div>
                      </div>
                    </div>
                  </motion.div>
                ))}
              </div>
            </motion.div>
          )}

          {/* Welcome Suggestions - Show when no messages and not loading */}
          {!isLoadingHistory && messages.length === 0 && (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: 0.3 }}
              className="flex flex-col items-center justify-center gap-6 pt-8"
            >
              <div className="text-center space-y-3">
                <h1 className="text-3xl font-bold text-foreground">
                  Hi! I'm DerPlanner
                </h1>
                <div className="space-y-2">
                  <p className="text-sm text-muted-foreground">
                    Your task and event assistant. I can help you organize your day, schedule events, and manage tasks.
                  </p>
                  <p className="text-xs text-muted-foreground">
                    🚀 <span className="font-medium">Demo & Open Source</span> • Check out the code on{' '}
                    <a
                      href="https://github.com/DomEscobar/Zippy/blob/main/README.md"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-primary hover:underline font-medium"
                    >
                      GitHub
                    </a>
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 w-full max-w-2xl">
                <motion.button
                  whileHover={{ scale: 1.02, y: -2 }}
                  whileTap={{ scale: 0.98 }}
                  onClick={() => setInput("Create a task to review project documentation by Friday")}
                  className="group relative text-left p-5 rounded-xl bg-gradient-to-br from-background to-muted/30 hover:to-muted/50 border border-border hover:border-primary/50 transition-all shadow-sm hover:shadow-md"
                >
                  <div className="flex items-start gap-3">
                    <div className="flex-shrink-0 p-2 rounded-lg bg-primary/10 text-primary group-hover:bg-primary group-hover:text-primary-foreground transition-colors">
                      <CheckSquare className="h-4 w-4" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-semibold text-foreground mb-1">
                        Create Tasks
                      </div>
                      <p className="text-xs text-muted-foreground leading-relaxed">
                        Create a task to review project documentation by Friday
                      </p>
                    </div>
                  </div>
                </motion.button>

                <motion.button
                  whileHover={{ scale: 1.02, y: -2 }}
                  whileTap={{ scale: 0.98 }}
                  onClick={() => setInput("Schedule a team meeting tomorrow at 2pm for 1 hour")}
                  className="group relative text-left p-5 rounded-xl bg-gradient-to-br from-background to-muted/30 hover:to-muted/50 border border-border hover:border-primary/50 transition-all shadow-sm hover:shadow-md"
                >
                  <div className="flex items-start gap-3">
                    <div className="flex-shrink-0 p-2 rounded-lg bg-blue-500/10 text-blue-600 dark:text-blue-400 group-hover:bg-blue-500 group-hover:text-white transition-colors">
                      <Calendar className="h-4 w-4" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-semibold text-foreground mb-1">
                        Schedule Events
                      </div>
                      <p className="text-xs text-muted-foreground leading-relaxed">
                        Schedule a team meeting tomorrow at 2pm for 1 hour
                      </p>
                    </div>
                  </div>
                </motion.button>

                <motion.button
                  whileHover={{ scale: 1.02, y: -2 }}
                  whileTap={{ scale: 0.98 }}
                  onClick={() => setInput("What are my upcoming tasks?")}
                  className="group relative text-left p-5 rounded-xl bg-gradient-to-br from-background to-muted/30 hover:to-muted/50 border border-border hover:border-primary/50 transition-all shadow-sm hover:shadow-md"
                >
                  <div className="flex items-start gap-3">
                    <div className="flex-shrink-0 p-2 rounded-lg bg-purple-500/10 text-purple-600 dark:text-purple-400 group-hover:bg-purple-500 group-hover:text-white transition-colors">
                      <Search className="h-4 w-4" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-semibold text-foreground mb-1">
                        Check Tasks
                      </div>
                      <p className="text-xs text-muted-foreground leading-relaxed">
                        What are my upcoming tasks?
                      </p>
                    </div>
                  </div>
                </motion.button>

              </div>

              <div className="text-center">
                <p className="text-[10px] text-muted-foreground/70">
                  I understand natural language, so just type what you need!
                </p>
              </div>
            </motion.div>
          )}

          {/* Show load more button if there are more messages */}
          {messagesToShow < allMessages.length && (
            <div className="text-center py-2">
              <button
                onClick={() => setMessagesToShow(prev => Math.min(prev + 10, allMessages.length))}
                className="inline-flex items-center gap-2 text-xs font-medium text-muted-foreground hover:text-foreground bg-muted hover:bg-muted/80 px-4 py-2 rounded-full transition-colors"
              >
                <ChevronUp className="h-3 w-3" />
                <span>Load older messages ({allMessages.length - messagesToShow} hidden)</span>
              </button>
            </div>
          )}
          <AnimatePresence mode="popLayout">
            {messages.map((message, index) => {
              const isLastMessage = index === messages.length - 1;
              // Apply height to last AI message (including streaming/loading)
              const isLastAIMessage = isLastMessage && message.role === 'assistant';

              return (
                <motion.div
                  key={message.id}
                  initial={{ opacity: 0, y: 20, scale: 0.95 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.95 }}
                  transition={{ type: "spring", stiffness: 300, damping: 25, delay: index * 0.05 }}
                  className={`flex ${message.role === "user" ? "justify-end" : "justify-start"}`}
                >
                  <div
                    className={`rounded-2xl px-4 py-2 max-w-[85%] ${isLastAIMessage ? "min-h-[70svh]" : ""
                      } ${message.role === "user"
                        ? "bg-secondary text-secondary-foreground"
                        : message.error
                          ? "bg-destructive/10 border border-destructive/20"
                          : (message as any).isStreaming
                            ? "p-4"
                            : ""
                      }`}
                  >
                    {message.isLoading ? (
                      <div className="flex items-center gap-2">
                        <Loader2 className="h-4 w-4 animate-spin" />
                        <span className="text-sm">Thinking...</span>
                      </div>
                    ) : (message as any).isStreaming ? (
                      // Streaming mode - show progress
                      <StreamingProgress
                        steps={(message as any).steps || []}
                        currentMessage={(message as any).currentMessage}
                        isComplete={false}
                      />
                    ) : (
                      <>
                        {message.role === "user" ? (
                          <p className="text-sm leading-relaxed">{String(message.content || '')}</p>
                        ) : (
                          <>
                            <div className="text-sm leading-relaxed prose prose-sm max-w-none dark:prose-invert prose-a:text-blue-600 dark:prose-a:text-blue-400 prose-a:underline prose-a:font-medium hover:prose-a:text-blue-800 dark:hover:prose-a:text-blue-300">
                              <ReactMarkdown
                                components={{
                                  a: ({ node, ...props }) => (
                                    <a
                                      {...props}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300 underline font-medium transition-colors"
                                    />
                                  ),
                                }}
                              >
                                {typeof message.content === 'string'
                                  ? message.content
                                  : JSON.stringify(message.content, null, 2)}
                              </ReactMarkdown>
                            </div>
                            {/* Show completed steps if they exist */}
                            {(message as any).steps && (message as any).steps.length > 0 && (
                              <div className="mt-4 pt-4 border-t border-border/50">
                                <details className="group">
                                  <summary className="cursor-pointer text-xs text-muted-foreground hover:text-foreground transition-colors flex items-center gap-2">
                                    <Sparkles className="h-3 w-3" />
                                    <span>View execution steps ({(message as any).steps.length})</span>
                                  </summary>
                                  <div className="mt-3">
                                    <StreamingProgress
                                      steps={(message as any).steps}
                                      isComplete={true}
                                    />
                                  </div>
                                </details>
                              </div>
                            )}
                          </>
                        )}
                        {message.error && (
                          <div className="flex items-center gap-2 mt-2 text-destructive text-xs">
                            <AlertCircle className="h-3 w-3" />
                            <span>{message.error}</span>
                          </div>
                        )}
                        {message.tasks && message.tasks.length > 0 && (
                          <div className="mt-3">
                            <TaskPreview tasks={message.tasks} />
                          </div>
                        )}
                        {message.events && message.events.length > 0 && (
                          <div className="mt-3">
                            <EventPreview events={message.events} flattenRecurring={true} />
                          </div>
                        )}
                      </>
                    )}
                  </div>
                </motion.div>
              );
            })}
          </AnimatePresence>
        </div>
      </div>

      <div
        className="flex-shrink-0 border-t border-border bg-card p-4"
        style={{ paddingBottom: 'max(1rem, calc(env(safe-area-inset-bottom, 0px) + 0.5rem))', zIndex: 2 }}
      >
        <div className="max-w-3xl mx-auto space-y-3">
          {/* Mode Toggle and Input */}
          <div className="flex gap-2 items-center">
            <Input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyPress={(e) => e.key === "Enter" && !e.shiftKey && handleSend()}
              placeholder="Type your message here..."
              className="flex-1 bg-background border-border rounded-full px-4 h-9 text-sm select-none"
              disabled={isLoading || isStreaming || isRecording || isProcessing}
            />

            {!input.trim() && !isRecording && !isProcessing ? (
              <Button
                onPointerDown={handleMicPress}
                onTouchStart={handleMicPress}
                onContextMenu={(e) => e.preventDefault()}
                size="icon"
                variant="outline"
                className="rounded-full h-9 w-9 select-none"
                style={{ touchAction: 'none', WebkitTouchCallout: 'none' }}
                disabled={isLoading || isStreaming || connectionStatus === 'offline'}
                title="Hold to record voice message"
              >
                <Mic className="h-4 w-4" />
              </Button>
            ) : null}

            {(isRecording || isProcessing) && (
              <Button
                size="icon"
                variant="destructive"
                className="rounded-full h-9 w-9 animate-pulse"
                disabled
                title={isRecording ? "Recording... Release to send" : "Processing..."}
              >
                {isProcessing ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Mic className="h-4 w-4" />
                )}
              </Button>
            )}

            {input.trim() && !isRecording && !isProcessing && (
              <Button
                onClick={handleSend}
                size="icon"
                className="rounded-full h-9 w-9"
                disabled={isLoading || isStreaming || connectionStatus === 'offline'}
                title={connectionStatus === 'offline' ? 'Waiting for connection...' : 'Send message'}
              >
                {isLoading || isStreaming ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : connectionStatus === 'offline' ? (
                  <WifiOff className="h-4 w-4" />
                ) : (
                  <Send className="h-4 w-4" />
                )}
              </Button>
            )}

            {isStreaming && (
              <motion.button
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                onClick={cancelStreaming}
                className="text-xs font-medium px-2 py-1.5 rounded-full bg-red-100 dark:bg-red-950/30 border border-red-300 dark:border-red-700 text-red-700 dark:text-red-300 hover:bg-red-200 dark:hover:bg-red-950/20"
              >
                Cancel
              </motion.button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
