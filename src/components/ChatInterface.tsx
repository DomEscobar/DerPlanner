import { useState, useRef, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Send, Loader2, AlertCircle, Wifi, WifiOff, Sparkles, ChevronUp, Keyboard, History, X, ArrowUp } from "lucide-react";
import { TaskPreview } from "@/components/TaskPreview";
import { EventPreview } from "@/components/EventPreview";
import { StreamingProgress } from "@/components/StreamingProgress";
import { MicrophonePermissionModal } from "@/components/MicrophonePermissionModal";
import { DailyBriefing } from "@/components/DailyBriefing";
import { useChat, ChatMessage } from "@/hooks/useChat";
import { useStreamingChat } from "@/hooks/useStreamingChat";
import { useVoiceRecorder } from "@/hooks/useVoiceRecorder";
import { useToast } from "@/hooks/use-toast";
import { ConnectionStatus, createConnectionMonitor } from "@/lib/connection-status";
import ReactMarkdown from "react-markdown";
import { motion, AnimatePresence } from "framer-motion";
import { MatrixAvatar, AvatarState } from "./MatrixAvatar";
import { PersonaModal } from "./PersonaModal";
import { GlowingMicrophone } from "./GlowingMicrophone";

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
  const [showChatHistory, setShowChatHistory] = useState(false);
  const [showTextInput, setShowTextInput] = useState(false);
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
    setShowTextInput(false);
    setShowChatHistory(true);

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
        setShowChatHistory(true);
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

    const lastMessage = messages[messages.length - 1];
    if (lastMessage?.error) return 'error';
    if (lastMessage?.tasks && lastMessage.tasks.length > 0) return 'task-created';
    if (lastMessage?.events && lastMessage.events.length > 0) return 'event-created';

    if (messages.length > 0 && !isStreaming && !isLoading) return 'success';

    return 'idle';
  };

  return (
    <div className="flex flex-col h-full overflow-hidden relative bg-gradient-to-b from-background via-background to-background/80">
      {/* Connection Status Bar - Glassmorphic */}
      {connectionStatus !== 'online' && (
        <div className={`flex-shrink-0 px-4 py-3 text-sm flex items-center gap-2 backdrop-blur-xl border-b border-border/50 ${connectionStatus === 'offline'
          ? 'bg-destructive/20 text-destructive-foreground dark:text-destructive border-destructive/30'
          : 'bg-yellow-500/20 text-yellow-900 dark:text-yellow-200 border-yellow-500/30'
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
        className="chat-scroll-area flex-1 min-h-0 p-4 relative backdrop-blur-sm"
        style={{
          backgroundImage: 'radial-gradient(circle at 20% 50%, rgba(59, 130, 246, 0.05) 0%, transparent 50%), radial-gradient(circle at 80% 80%, rgba(168, 85, 247, 0.05) 0%, transparent 50%)',
        }}
      >
        {/* Matrix Avatar Background - Only show in chat history mode */}
        {showChatHistory && (
          <MatrixAvatar
            compact={messages.length > 0}
            state={getAvatarState()}
            onClick={() => setPersonaModalOpen(true)}
          />
        )}

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
          {/* Daily Briefing - Show by default */}
          {!showChatHistory && !isLoadingHistory && (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              transition={{ duration: 0.3 }}
            >
              <DailyBriefing />

              {/* Show chat history button - Floating near top right of content */}
              {allMessages.length > 0 && (
                <div className="flex justify-center pt-4">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setShowChatHistory(true)}
                    className="text-muted-foreground hover:text-primary text-xs"
                  >
                    <History className="h-3 w-3 mr-1.5" />
                    Recent activity ({allMessages.length})
                  </Button>
                </div>
              )}
            </motion.div>
          )}

          {/* Loading state */}
          {isLoadingHistory && messages.length === 0 && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="flex flex-col items-center justify-center gap-6 pt-20"
            >
              <div className="flex flex-col items-center gap-4">
                <Loader2 className="h-12 w-12 text-primary animate-spin" />
                <div className="text-center space-y-2">
                  <p className="text-sm font-medium text-foreground">Loading...</p>
                </div>
              </div>
            </motion.div>
          )}

          {/* Chat History */}
          {showChatHistory && (
            <>
              {/* Back to today button */}
              <div className="flex justify-between items-center sticky top-0 z-50 bg-background/60 backdrop-blur-xl border-b border-border/30 p-3 -mx-4 px-4 rounded-b-2xl shadow-lg">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setShowChatHistory(false)}
                  className="text-primary font-medium hover:bg-primary/10"
                >
                  <ChevronUp className="h-4 w-4 mr-1" />
                  Back to Briefing
                </Button>
              </div>

              {/* Show load more button if there are more messages */}
              {messagesToShow < allMessages.length && (
                <div className="text-center py-4">
                  <button
                    onClick={() => setMessagesToShow(prev => Math.min(prev + 10, allMessages.length))}
                    className="inline-flex items-center gap-2 text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-primary/10 backdrop-blur-xl bg-background/40 border border-border/50 px-4 py-2 rounded-full transition-all hover:border-primary/50"
                  >
                    <ChevronUp className="h-3 w-3" />
                    <span>Load older messages ({allMessages.length - messagesToShow} hidden)</span>
                  </button>
                </div>
              )}

              <AnimatePresence mode="popLayout">
                {messages.map((message, index) => {
                  const isLastMessage = index === messages.length - 1;
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
                      {isLastAIMessage ? (
                        <div className="min-h-[70svh] flex items-start max-w-[85%]">
                          <div
                            className={`rounded-3xl px-5 py-4 w-full shadow-xl backdrop-blur-xl border transition-all ${message.role === "user"
                                ? "bg-gradient-to-br from-primary to-primary/80 text-primary-foreground shadow-primary/30 border-primary/40"
                                : message.error
                                  ? "bg-destructive/15 border-destructive/40 backdrop-blur-xl shadow-destructive/20"
                                  : (message as any).isStreaming
                                    ? "bg-background/40 border-border/50 shadow-lg"
                                    : "bg-background/40 border-border/50 shadow-lg hover:shadow-xl hover:bg-background/50"
                              }`}
                          >
                            {message.isLoading ? (
                              <div className="flex items-center gap-2">
                                <Loader2 className="h-4 w-4 animate-spin" />
                                <span className="text-sm">Thinking...</span>
                              </div>
                            ) : (message as any).isStreaming ? (
                              <StreamingProgress
                                steps={(message as any).steps || []}
                                currentMessage={(message as any).currentMessage}
                                isComplete={false}
                              />
                            ) : (
                              <>
                                {message.role === "user" ? (
                                  <p className="text-sm leading-relaxed font-medium">{String(message.content || '')}</p>
                                ) : (
                                  <>
                                    <div className="text-sm leading-relaxed prose prose-sm max-w-none dark:prose-invert">
                                      <ReactMarkdown
                                        components={{
                                          a: ({ node, ...props }) => (
                                            <a
                                              {...props}
                                              target="_blank"
                                              rel="noopener noreferrer"
                                              className="text-primary hover:underline font-medium transition-colors"
                                            />
                                          ),
                                        }}
                                      >
                                        {typeof message.content === 'string'
                                          ? message.content
                                          : JSON.stringify(message.content, null, 2)}
                                      </ReactMarkdown>
                                    </div>
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
                        </div>
                      ) : (
                        <div
                          className={`rounded-3xl px-5 py-4 max-w-[85%] shadow-xl backdrop-blur-xl border transition-all ${message.role === "user"
                              ? "bg-gradient-to-br from-primary to-primary/80 text-primary-foreground shadow-primary/30 border-primary/40"
                              : message.error
                                ? "bg-destructive/15 border-destructive/40 backdrop-blur-xl shadow-destructive/20"
                                : (message as any).isStreaming
                                  ? "bg-background/40 border-border/50 shadow-lg"
                                  : "bg-background/40 border-border/50 shadow-lg hover:shadow-xl hover:bg-background/50"
                            }`}
                        >
                          {message.isLoading ? (
                            <div className="flex items-center gap-2">
                              <Loader2 className="h-4 w-4 animate-spin" />
                              <span className="text-sm">Thinking...</span>
                            </div>
                          ) : (message as any).isStreaming ? (
                            <StreamingProgress
                              steps={(message as any).steps || []}
                              currentMessage={(message as any).currentMessage}
                              isComplete={false}
                            />
                          ) : (
                            <>
                              {message.role === "user" ? (
                                <p className="text-sm leading-relaxed font-medium">{String(message.content || '')}</p>
                              ) : (
                                <>
                                  <div className="text-sm leading-relaxed prose prose-sm max-w-none dark:prose-invert">
                                    <ReactMarkdown
                                      components={{
                                        a: ({ node, ...props }) => (
                                          <a
                                            {...props}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="text-primary hover:underline font-medium transition-colors"
                                          />
                                        ),
                                      }}
                                    >
                                      {typeof message.content === 'string'
                                        ? message.content
                                        : JSON.stringify(message.content, null, 2)}
                                    </ReactMarkdown>
                                  </div>
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
                      )}
                    </motion.div>
                  );
                })}
              </AnimatePresence>

              <div className="h-24" /> {/* Spacer for bottom input */}
            </>
          )}
        </div>
      </div>

      {/* Floating Input Area - Positioned at bottom now that nav is at top */}
      <div
        className="absolute bottom-6 left-0 right-0 z-40 pointer-events-none flex justify-center"
      >
        <div className="pointer-events-auto max-w-3xl w-full px-4 flex flex-col items-center gap-4">

          {/* Text Input Mode - Slide up */}
          <AnimatePresence>
            {showTextInput && (
              <motion.div
                initial={{ opacity: 0, y: 20, scale: 0.9 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 20, scale: 0.9 }}
                className="w-full max-w-md"
              >
                <div className="backdrop-blur-xl rounded-3xl p-3 pl-5 flex gap-2 items-center shadow-2xl border border-border/50 bg-background/60 hover:bg-background/70 hover:border-border/80 transition-all">
                  <Input
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyPress={(e) => e.key === "Enter" && !e.shiftKey && handleSend()}
                    placeholder="What's on your mind?"
                    className="flex-1 bg-transparent border-none focus-visible:ring-0 focus-visible:ring-offset-0 placeholder:text-muted-foreground/50 h-10 text-foreground"
                    disabled={isLoading || isStreaming || isRecording || isProcessing}
                    autoFocus
                  />
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={() => setShowTextInput(false)}
                    className="rounded-full h-10 w-10 text-muted-foreground hover:text-foreground hover:bg-primary/10"
                  >
                    <X className="h-5 w-5" />
                  </Button>
                  <Button
                    onClick={handleSend}
                    size="icon"
                    className="rounded-full h-10 w-10 bg-gradient-to-br from-primary to-primary/80 text-primary-foreground shadow-lg hover:shadow-xl transition-all hover:-translate-y-0.5"
                    disabled={isLoading || isStreaming || connectionStatus === 'offline' || !input.trim()}
                  >
                    {isLoading || isStreaming ? (
                      <Loader2 className="h-5 w-5 animate-spin" />
                    ) : (
                      <ArrowUp className="h-5 w-5" />
                    )}
                  </Button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Main Floating Action Button */}
          {!showTextInput && (
            <div className="flex items-center gap-6">
              {/* Keyboard Toggle */}
              <motion.div whileHover={{ scale: 1.1 }} whileTap={{ scale: 0.95 }}>
                <Button
                  size="icon"
                  variant="outline"
                  onClick={() => setShowTextInput(true)}
                  className="rounded-full h-12 w-12 bg-background/60 backdrop-blur-xl border-border/50 shadow-xl text-muted-foreground hover:text-primary hover:bg-background/80 hover:border-primary/50 transition-all"
                  disabled={isRecording || isProcessing}
                >
                  <Keyboard className="h-5 w-5" />
                </Button>
              </motion.div>

              {/* Glowing Microphone */}
              <GlowingMicrophone
                isRecording={isRecording}
                isProcessing={isProcessing}
                disabled={isLoading || isStreaming || connectionStatus === 'offline'}
                onPointerDown={handleMicPress}
                onTouchStart={handleMicPress}
                onContextMenu={(e) => e.preventDefault()}
              />

              {/* AI Persona / Settings */}
              {userId && (
                <motion.div whileHover={{ scale: 1.1 }} whileTap={{ scale: 0.95 }}>
                  <Button
                    size="icon"
                    variant="outline"
                    onClick={() => setPersonaModalOpen(true)}
                    className="rounded-full h-12 w-12 bg-background/60 backdrop-blur-xl border-border/50 shadow-xl text-muted-foreground hover:text-accent hover:bg-background/80 hover:border-accent/50 transition-all"
                    disabled={isRecording || isProcessing}
                  >
                    <div className="h-6 w-6 rounded-full bg-gradient-to-br from-blue-500 via-purple-500 to-pink-500 opacity-80 shadow-lg" />
                  </Button>
                </motion.div>
              )}
            </div>
          )}

        </div>
      </div>
    </div>
  );
};
