import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import dotenv from 'dotenv';
import multer from 'multer';
import OpenAI from 'openai';
import type { CoreMessage } from 'ai';
import { getTaskAgent } from './mastra/agents/task-agent';
import { getEventAgent } from './mastra/agents/event-agent';
import { getRoutingAgent } from './mastra/agents/routing-agent';
import { getResearchAgent, conductDeepResearch, enrichResearchPrompt } from './mastra/agents/research-agent';
import { initializeDatabase, query } from './config/database';
import { mastra } from './mastra';
import { streamAgentNetwork } from './routes/stream';
import { webhookService } from './services/webhook-service';
import { pushNotificationService } from './services/push-notification-service';
import { WebhookConfigSchema, TaskWebhookConfigSchema } from './types';

// Load environment variables
dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;

// Initialize OpenAI client
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// Daily request limit configuration
const DAILY_REQUEST_LIMIT = process.env.DAILY_REQUEST_LIMIT 
  ? parseInt(process.env.DAILY_REQUEST_LIMIT, 15) 
  : null; // null means unlimited

// In-memory store for tracking daily requests
// Structure: { identifier: [{ timestamp: number }, ...] }
const requestTracker = new Map<string, number[]>();

// Clean up old entries periodically (older than 24 hours)
const cleanupOldEntries = () => {
  const now = Date.now();
  const twentyFourHoursAgo = now - (24 * 60 * 60 * 1000);
  
  for (const [identifier, timestamps] of requestTracker.entries()) {
    const filtered = timestamps.filter(ts => ts > twentyFourHoursAgo);
    if (filtered.length === 0) {
      requestTracker.delete(identifier);
    } else {
      requestTracker.set(identifier, filtered);
    }
  }
};

// Run cleanup every hour
setInterval(cleanupOldEntries, 60 * 60 * 1000);

// Configure multer for file uploads
const upload = multer({ 
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 }
});

// Daily request limit middleware
const dailyRequestLimitMiddleware = (req: Request, res: Response, next: NextFunction) => {
  // Skip if limit is not configured
  if (DAILY_REQUEST_LIMIT === null) {
    return next();
  }

  // Skip health check endpoint
  if (req.path === '/health') {
    return next();
  }

  // Get identifier (prefer userId from body/query, fallback to IP)
  const userId = req.body?.userId || req.query?.userId;
  const identifier = userId || req.ip || req.socket.remoteAddress || 'unknown';

  // Get current timestamps for this identifier
  const now = Date.now();
  const twentyFourHoursAgo = now - (24 * 60 * 60 * 1000);
  const currentTimestamps = requestTracker.get(identifier) || [];
  
  // Filter to only last 24 hours
  const recentRequests = currentTimestamps.filter(ts => ts > twentyFourHoursAgo);
  
  // Check if limit exceeded
  if (recentRequests.length >= DAILY_REQUEST_LIMIT) {
    const oldestRequest = Math.min(...recentRequests);
    const resetTime = new Date(oldestRequest + (24 * 60 * 60 * 1000));
    
    return res.status(429).json({
      success: false,
      error: 'Daily request limit exceeded',
      limit: DAILY_REQUEST_LIMIT,
      current: recentRequests.length,
      resetAt: resetTime.toISOString(),
      message: `You have exceeded the daily limit of ${DAILY_REQUEST_LIMIT} requests. Please try again after ${resetTime.toLocaleString()}.`
    });
  }

  // Add current request timestamp
  recentRequests.push(now);
  requestTracker.set(identifier, recentRequests);

  // Add rate limit headers
  res.setHeader('X-RateLimit-Limit', DAILY_REQUEST_LIMIT.toString());
  res.setHeader('X-RateLimit-Remaining', Math.max(0, DAILY_REQUEST_LIMIT - recentRequests.length).toString());
  
  next();
};

// Middleware
app.use(helmet());
app.use(cors());
app.use(morgan('combined'));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Apply daily request limit middleware (after basic middleware, before routes)
if (DAILY_REQUEST_LIMIT !== null) {
  app.use(dailyRequestLimitMiddleware);
  console.log(`🛡️  Daily request limit enabled: ${DAILY_REQUEST_LIMIT} requests per 24 hours per user/IP`);
} else {
  console.log('📊 Daily request limit: DISABLED (set DAILY_REQUEST_LIMIT env variable to enable)');
}

// Helper function to fetch and format conversation history for Mastra agents
async function getConversationHistoryForAgent(
  userId: string, 
  conversationId?: string, 
  sessionId?: string,
  limit: number = 10
): Promise<CoreMessage[]> {
  try {
    // Build query conditions
    let whereConditions = ['user_id = $1'];
    let queryParams: any[] = [userId];
    let paramIndex = 2;
    
    if (conversationId) {
      whereConditions.push(`conversation_id = $${paramIndex}`);
      queryParams.push(conversationId);
      paramIndex++;
    }
    
    if (sessionId) {
      whereConditions.push(`session_id = $${paramIndex}`);
      queryParams.push(sessionId);
      paramIndex++;
    }
    
    // Add limit
    queryParams.push(limit);
    
    const queryText = `
      SELECT role, content, actions
      FROM conversation_history 
      WHERE ${whereConditions.join(' AND ')}
      ORDER BY created_at DESC
      LIMIT $${paramIndex}
    `;
    
    const result = await query(queryText, queryParams);
    
    // Convert to Mastra format (reverse to get chronological order)
    const messages = result.rows.reverse().map((row: any) => {
      let content = row.content;
      
      // For assistant messages with actions, enrich the content with context
      if (row.role === 'assistant' && row.actions && Array.isArray(row.actions) && row.actions.length > 0) {
        const actionContext = row.actions.map((action: any) => {
          if (action.type === 'task' && action.data) {
            return `[Task ID: ${action.data.id}, Title: "${action.data.title}", Priority: ${action.data.priority}, Status: ${action.data.status}]`;
          }
          if (action.type === 'event' && action.data) {
            return `[Event ID: ${action.data.id}, Title: "${action.data.title}", Date: ${action.data.start_date}]`;
          }
          return '';
        }).filter(Boolean).join('\n');
        
        if (actionContext) {
          content = `${content}\n\nContext - Items mentioned:\n${actionContext}`;
        }
      }
      
      return {
        role: row.role as 'user' | 'assistant' | 'system',
        content
      };
    });
    
    return messages;
  } catch (error) {
    console.error('Error fetching conversation history for agent:', error);
    return [];
  }
}

// Health check endpoint
app.get('/health', (req: Request, res: Response) => {
  const hasApiKey = !!process.env.OPENAI_API_KEY;
  res.json({ 
    status: 'healthy', 
    timestamp: new Date().toISOString(),
    service: 'derplanner-task-event-planner-server',
    aiEnabled: hasApiKey,
    mode: 'mastra-agents-network',
    features: {
      streaming: true,
      agentNetwork: true,
      memory: true
    }
  });
});

// Streaming Agent Network API - Uses Agent.network() with SSE streaming
app.post('/api/agent/stream', streamAgentNetwork);

// General Agent API - Uses Mastra Intelligent Routing Workflow
app.post('/api/agent/general', async (req: Request, res: Response): Promise<void> => {
  try {
    const { message, userId, context } = req.body;
    
    if (!message) {
      res.status(400).json({
        success: false,
        error: 'Message is required'
      });
      return;
    }

    if (!process.env.OPENAI_API_KEY) {
      res.status(500).json({
        success: false,
        error: 'OpenAI API key is required. Please set OPENAI_API_KEY in your .env file. Get one at: https://platform.openai.com/api-keys'
      });
      return;
    }

    // Fetch conversation history to provide context
    const conversationHistory = await getConversationHistoryForAgent(
      userId,
      context?.conversationId,
      context?.sessionId,
      10 // Last 10 messages
    );
    
    // Add current date/time context at the beginning
    const currentDateTime = context?.currentDateTime || new Date().toISOString();
    const timezone = context?.timezone || 'UTC';
    const dateTimeContext: CoreMessage = {
      role: 'system',
      content: `🔴 CRITICAL - CURRENT DATE AND TIME: ${currentDateTime} (Timezone: ${timezone})

YOU MUST USE THIS DATE AS YOUR REFERENCE POINT!
- Today is: ${new Date(currentDateTime).toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', timeZone: timezone })}
- When calculating "tomorrow", "next week", "Monday", etc., ALWAYS start from this date
- NEVER use dates from 2023 or any past years - we are in ${new Date(currentDateTime).getFullYear()}
- Double-check all dates you generate are in the correct year: ${new Date(currentDateTime).getFullYear()}`
    };
    
    console.log(`📜 Loaded ${conversationHistory.length} previous messages for context`);
    console.log(`📅 Current date/time: ${currentDateTime} (${timezone})`);
    
    // Add persona context if provided
    const personaContext: CoreMessage | null = context?.persona ? {
      role: 'system',
      content: `🎭 PERSONA / SYSTEM INSTRUCTION:\n\n${context.persona}`
    } : null;
    
    // Build conversation history with system messages
    const systemMessages: CoreMessage[] = [
      dateTimeContext,
      ...(personaContext ? [personaContext] : [])
    ];

    // Check if this looks like a batch operation
    const lowerMessage = message.toLowerCase();
    const isBatchDelete = (lowerMessage.includes('delete') && (
      lowerMessage.includes('these') || lowerMessage.includes('those') || 
      lowerMessage.includes('them') || lowerMessage.includes('all')
    ));
    const isBatchComplete = (lowerMessage.includes('complete') || lowerMessage.includes('finish')) && (
      lowerMessage.includes('these') || lowerMessage.includes('those') || 
      lowerMessage.includes('them') || lowerMessage.includes('all')
    );

    let responseData;

    // Route to batch workflow if it's a batch operation
    if (isBatchDelete || isBatchComplete) {
      console.log('📦 Using Batch Operations Workflow');
      
      const workflow = mastra.getWorkflow('batchTaskWorkflow');
      const run = await workflow.createRunAsync();
      
      // @ts-ignore - Type mismatch in conversation history
      const result = await run.start({
        inputData: {
          message,
          conversationHistory: [
            ...systemMessages,
            ...conversationHistory
          ].map(msg => ({
            role: msg.role,
            content: typeof msg.content === 'string' ? msg.content : ''
          })),
          operation: isBatchDelete ? 'delete' : 'complete'
        }
      });

      if (result.status === 'success') {
        responseData = {
          response: result.result.message || 'Batch operation completed',
          message: result.result.message || 'Batch operation completed',
          actions: result.result.actions || [],
          agent: 'batch'
        };
      } else {
        throw new Error('Batch workflow failed');
      }
    } else {
      // Use intelligent routing workflow for regular requests
      console.log('🧠 Using Intelligent Routing Workflow');
      
      const workflow = mastra.getWorkflow('intelligentRoutingWorkflow');
      const run = await workflow.createRunAsync();
      
      // @ts-ignore - Type mismatch in conversation history
      const result = await run.start({
        inputData: {
          message,
          conversationHistory: [
            ...systemMessages,
            ...conversationHistory
          ]
            .filter(msg => msg.role !== 'tool') // Filter out tool messages
            .map(msg => ({
              role: msg.role as 'user' | 'assistant' | 'system',
              content: typeof msg.content === 'string' ? msg.content : ''
            })),
          userId
        }
      });

      if (result.status === 'success') {
        // Debug: Log the full result structure
        console.log('🔍 Full workflow result:', JSON.stringify(result.result, null, 2));
        
        // The branched step result might be nested differently
        // Check if result has the expected structure or if it's wrapped
        // @ts-ignore - Dynamic property access from workflow result
        const workflowResult: any = result.result;
        const stepResult = workflowResult.handleWithTaskAgent || 
                          workflowResult.handleWithEventAgent || 
                          workflowResult.handleWithAnswerAgent ||
                          workflowResult.handleWithResearchAgent ||
                          workflowResult.handleWithBothAgents ||
                          workflowResult;
        
        responseData = {
          // @ts-ignore - Dynamic property access
          response: stepResult.response || 'Request processed',
          // @ts-ignore - Dynamic property access
          message: stepResult.response || 'Request processed',
          // @ts-ignore - Dynamic property access
          actions: stepResult.actions || [],
          // @ts-ignore - Dynamic property access
          agent: stepResult.agent || 'unknown'
        };
      } else {
        throw new Error('Routing workflow failed');
      }
    }

    console.log(`✅ Response: ${responseData.response?.substring(0, 100) || 'No response'}...`);
    console.log(`   Actions: ${responseData.actions?.length || 0} items`);
    console.log(`   Agent: ${responseData.agent}`);

    res.json({
      success: true,
      data: responseData
    });
    
  } catch (error) {
    console.error('❌ Error in general agent:', error);
    
    // Fallback to direct agent call if workflow fails
    try {
      const { message, userId, context } = req.body;
      const conversationHistory = await getConversationHistoryForAgent(
        userId,
        context?.conversationId,
        context?.sessionId,
        10
      );
      
      // Add current date/time context
      const currentDateTime = context?.currentDateTime || new Date().toISOString();
      const timezone = context?.timezone || 'UTC';
      
      const messages = [
        { 
          role: 'system' as const, 
          content: `🔴 CRITICAL - CURRENT DATE AND TIME: ${currentDateTime} (Timezone: ${timezone})

YOU MUST USE THIS DATE AS YOUR REFERENCE POINT!
- Today is: ${new Date(currentDateTime).toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', timeZone: timezone })}
- When calculating "tomorrow", "next week", "Monday", etc., ALWAYS start from this date
- NEVER use dates from 2023 or any past years - we are in ${new Date(currentDateTime).getFullYear()}
- Double-check all dates you generate are in the correct year: ${new Date(currentDateTime).getFullYear()}`
        },
        ...conversationHistory,
        { role: 'user' as const, content: message }
      ];
      
      console.log('⚠️  Falling back to direct agent call');
      const taskAgent = getTaskAgent();
      const response = await taskAgent.generate(messages);
      
      const actions: any[] = [];
      (response.toolResults || []).forEach((result: any) => {
        const toolResult = result.payload?.result;
        if (!toolResult || typeof toolResult !== 'object') return;
        
        if (toolResult.task) {
          actions.push({ type: 'task', data: toolResult.task });
        }
        if (toolResult.tasks && Array.isArray(toolResult.tasks)) {
          toolResult.tasks.forEach((task: any) => {
            actions.push({ type: 'task', data: task });
          });
        }
      });
      
      res.json({
        success: true,
        data: {
          response: response.text || 'Request processed',
          message: response.text || 'Request processed',
          actions,
          agent: 'fallback'
        }
      });
    } catch (fallbackError) {
      console.error('❌ Fallback also failed:', fallbackError);
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : 'Internal server error'
      });
    }
  }
});

// Task Agent API - Direct access to task management
app.post('/api/agent/task', async (req: Request, res: Response): Promise<void> => {
  try {
    const { message, userId, context } = req.body;
    
    if (!message) {
      res.status(400).json({
        success: false,
        error: 'Message is required'
      });
      return;
    }

    if (!process.env.OPENAI_API_KEY) {
      res.status(500).json({
        success: false,
        error: 'OpenAI API key required'
      });
      return;
    }

    console.log('🎯 Task Agent processing:', message);
    
    // Fetch conversation history to provide context
    const conversationHistory = await getConversationHistoryForAgent(
      userId,
      context?.conversationId,
      context?.sessionId,
      10 // Last 10 messages
    );
    
    // Add current date/time context
    const currentDateTime = context?.currentDateTime || new Date().toISOString();
    const timezone = context?.timezone || 'UTC';
    
    // Build message array with history + current message
    const messages = [
      { 
        role: 'system' as const, 
        content: `🔴 CRITICAL - CURRENT DATE AND TIME: ${currentDateTime} (Timezone: ${timezone})

YOU MUST USE THIS DATE AS YOUR REFERENCE POINT!
- Today is: ${new Date(currentDateTime).toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', timeZone: timezone })}
- When calculating "tomorrow", "next week", "Monday", etc., ALWAYS start from this date
- NEVER use dates from 2023 or any past years - we are in ${new Date(currentDateTime).getFullYear()}
- Double-check all dates you generate are in the correct year: ${new Date(currentDateTime).getFullYear()}`
      },
      ...conversationHistory,
      { role: 'user' as const, content: message }
    ];
    
    console.log(`📜 Loaded ${conversationHistory.length} previous messages for context`);
    console.log(`📅 Current date/time: ${currentDateTime} (${timezone})`);
    
    const taskAgent = getTaskAgent();
    const response = await taskAgent.generate(messages);

    // Extract tool results/actions and flatten them for the frontend
    const actions: any[] = [];
    
    console.log(`🔍 Extracting from ${response.toolResults?.length || 0} tool results...`);
    
    (response.toolResults || []).forEach((result: any, index: number) => {
      console.log(`\n   === Tool ${index + 1} ===`);
      console.log(`   All keys:`, Object.keys(result));
      
      // Try multiple possible locations for the data
      const possibleDataLocations = [
        { name: 'result.payload.result', data: result.payload?.result },  // Mastra stores it here!
        { name: 'result.result', data: result.result },
        { name: 'result.output', data: result.output },
        { name: 'result.data', data: result.data },
        { name: 'result itself', data: result },
      ];
      
      for (const location of possibleDataLocations) {
        const toolResult = location.data;
        if (!toolResult || typeof toolResult !== 'object') continue;
        
        // Handle single task
        if (toolResult.task) {
          console.log(`   ✅ Found single task at ${location.name}`);
          actions.push({
            type: 'task',
            data: toolResult.task
          });
          break;
        }
        
        // Handle list of tasks
        if (toolResult.tasks && Array.isArray(toolResult.tasks)) {
          console.log(`   ✅ Found ${toolResult.tasks.length} tasks at ${location.name}`);
          toolResult.tasks.forEach((task: any) => {
            actions.push({
              type: 'task',
              data: task
            });
          });
          break;
        }
      }
    });

    res.json({
      success: true,
      data: {
        response: response.text || 'Task processed',
        message: response.text || 'Task processed',
        actions
      }
    });
    
  } catch (error) {
    console.error('❌ Error in task agent:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Internal server error'
    });
  }
});

// Research Agent API - Direct access to web research
app.post('/api/agent/research', async (req: Request, res: Response): Promise<void> => {
  try {
    const { message, userId, context } = req.body;
    
    if (!message) {
      res.status(400).json({
        success: false,
        error: 'Message is required'
      });
      return;
    }

    if (!process.env.OPENAI_API_KEY) {
      res.status(500).json({
        success: false,
        error: 'OpenAI API key required'
      });
      return;
    }

    console.log('🔍 Research Agent processing:', message);
    
    try {
      // Enrich the query for better results
      const enrichedQuery = await enrichResearchPrompt(message);
      console.log(`📝 Enriched query: "${enrichedQuery.substring(0, 100)}..."`);
      
      // Conduct deep research
      const result = await conductDeepResearch({
        query: enrichedQuery,
        useBackgroundMode: false,
        maxToolCalls: context?.maxToolCalls || 10
      });
      
      // Format response with citations
      let responseText = result.outputText;
      
      if (result.citations.length > 0) {
        responseText += '\n\n**Sources:**\n';
        const uniqueCitations = new Map();
        result.citations.forEach(citation => {
          if (!uniqueCitations.has(citation.url)) {
            uniqueCitations.set(citation.url, citation.title);
          }
        });
        
        Array.from(uniqueCitations.entries()).forEach(([url, title], index) => {
          responseText += `${index + 1}. [${title}](${url})\n`;
        });
      }
      
      console.log(`✅ Research completed with ${result.citations.length} citations`);
      
      // Format actions for frontend
      const actions = [{
        type: 'research',
        data: {
          query: message,
          report: result.outputText,
          citations: result.citations,
          searchCount: result.webSearchCalls.length
        }
      }];

      res.json({
        success: true,
        data: {
          response: responseText,
          message: responseText,
          actions
        }
      });
      
    } catch (researchError) {
      console.error('❌ Research error:', researchError);
      throw researchError;
    }
    
  } catch (error) {
    console.error('❌ Error in research agent:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Internal server error'
    });
  }
});

// Audio Transcription API - Using OpenAI Whisper
app.post('/api/transcribe', upload.single('audio'), async (req: Request, res: Response): Promise<void> => {
  try {
    const { userId } = req.body;
    
    if (!req.file) {
      res.status(400).json({
        success: false,
        error: 'Audio file is required'
      });
      return;
    }

    if (!process.env.OPENAI_API_KEY) {
      res.status(500).json({
        success: false,
        error: 'OpenAI API key required'
      });
      return;
    }

    console.log('🎤 Transcribing audio:', {
      size: req.file.size,
      mimetype: req.file.mimetype,
      userId
    });

    // Use OpenAI SDK - it handles multipart form correctly
    const transcription = await openai.audio.transcriptions.create({
      file: new File([req.file.buffer], 'audio.webm', { type: req.file.mimetype }),
      model: 'whisper-1',
    });
    
    console.log('✅ Transcription successful:', transcription.text.substring(0, 100));

    res.json({
      success: true,
      data: {
        text: transcription.text,
      }
    });
    
  } catch (error) {
    console.error('❌ Error in transcription:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Transcription failed'
    });
  }
});

// Event Agent API - Direct access to event management
app.post('/api/agent/event', async (req: Request, res: Response): Promise<void> => {
  try {
    const { message, userId, context } = req.body;
    
    if (!message) {
      res.status(400).json({
        success: false,
        error: 'Message is required'
      });
      return;
    }

    if (!process.env.OPENAI_API_KEY) {
      res.status(500).json({
        success: false,
        error: 'OpenAI API key required'
      });
      return;
    }

    console.log('📅 Event Agent processing:', message);
    
    // Fetch conversation history to provide context
    const conversationHistory = await getConversationHistoryForAgent(
      userId,
      context?.conversationId,
      context?.sessionId,
      10 // Last 10 messages
    );
    
    // Add current date/time context
    const currentDateTime = context?.currentDateTime || new Date().toISOString();
    const timezone = context?.timezone || 'UTC';
    
    // Build message array with history + current message
    const messages = [
      { 
        role: 'system' as const, 
        content: `🔴 CRITICAL - CURRENT DATE AND TIME: ${currentDateTime} (Timezone: ${timezone})

YOU MUST USE THIS DATE AS YOUR REFERENCE POINT!
- Today is: ${new Date(currentDateTime).toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', timeZone: timezone })}
- When calculating "tomorrow", "next week", "Monday", etc., ALWAYS start from this date
- NEVER use dates from 2023 or any past years - we are in ${new Date(currentDateTime).getFullYear()}
- Double-check all dates you generate are in the correct year: ${new Date(currentDateTime).getFullYear()}`
      },
      ...conversationHistory,
      { role: 'user' as const, content: message }
    ];
    
    console.log(`📜 Loaded ${conversationHistory.length} previous messages for context`);
    console.log(`📅 Current date/time: ${currentDateTime} (${timezone})`);
    
    const eventAgent = getEventAgent();
    const response = await eventAgent.generate(messages);

    // Extract tool results/actions and flatten them for the frontend
    const actions: any[] = [];
    
    console.log(`🔍 Extracting from ${response.toolResults?.length || 0} tool results...`);
    
    (response.toolResults || []).forEach((result: any, index: number) => {
      console.log(`\n   === Tool ${index + 1} ===`);
      console.log(`   All keys:`, Object.keys(result));
      
      // Try multiple possible locations for the data
      const possibleDataLocations = [
        { name: 'result.payload.result', data: result.payload?.result },  // Mastra stores it here!
        { name: 'result.result', data: result.result },
        { name: 'result.output', data: result.output },
        { name: 'result.data', data: result.data },
        { name: 'result itself', data: result },
      ];
      
      for (const location of possibleDataLocations) {
        const toolResult = location.data;
        if (!toolResult || typeof toolResult !== 'object') continue;
        
        // Handle single event
        if (toolResult.event) {
          console.log(`   ✅ Found single event at ${location.name}`);
          actions.push({
            type: 'event',
            data: toolResult.event
          });
          break;
        }
        
        // Handle list of events
        if (toolResult.events && Array.isArray(toolResult.events)) {
          console.log(`   ✅ Found ${toolResult.events.length} events at ${location.name}`);
          toolResult.events.forEach((event: any) => {
            actions.push({
              type: 'event',
              data: event
            });
          });
          break;
        }
      }
    });

    res.json({
      success: true,
      data: {
        response: response.text || 'Event processed',
        message: response.text || 'Event processed',
        actions
      }
    });
    
  } catch (error) {
    console.error('❌ Error in event agent:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Internal server error'
    });
  }
});

// ==================== TASK CRUD ENDPOINTS ====================

// Get all tasks
app.get('/api/tasks', async (req: Request, res: Response): Promise<void> => {
  try {
    const { status, priority, userId, limit = '50', offset = '0' } = req.query;
    
    let whereClause = 'WHERE user_id = $1';
    const values: any[] = [userId];
    let paramCount = 2;
    
    if (status) {
      whereClause += ` AND status = $${paramCount}`;
      values.push(status);
      paramCount++;
    }
    
    if (priority) {
      whereClause += ` AND priority = $${paramCount}`;
      values.push(priority);
      paramCount++;
    }
    
    values.push(parseInt(limit as string), parseInt(offset as string));
    
    const result = await query(
      `SELECT * FROM tasks ${whereClause} ORDER BY created_at DESC LIMIT $${paramCount} OFFSET $${paramCount + 1}`,
      values
    );
    
    res.json({
      success: true,
      data: result.rows
    });
  } catch (error) {
    console.error('Error fetching tasks:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch tasks'
    });
  }
});

// Get a single task
app.get('/api/tasks/:id', async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    
    const result = await query('SELECT * FROM tasks WHERE id = $1', [id]);
    
    if (result.rows.length === 0) {
      res.status(404).json({
        success: false,
        error: 'Task not found'
      });
      return;
    }
    
    res.json({
      success: true,
      data: result.rows[0]
    });
  } catch (error) {
    console.error('Error fetching task:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch task'
    });
  }
});

// Create a new task
app.post('/api/tasks', async (req: Request, res: Response): Promise<void> => {
  try {
    const { title, description, priority = 'medium', status = 'pending', dueDate, tags = [], userId } = req.body;
    
    if (!title) {
      res.status(400).json({
        success: false,
        error: 'Title is required'
      });
      return;
    }
    
    let dueDateISO: string | null = null;
    if (dueDate) {
      const dueDateObj = new Date(dueDate);
      if (isNaN(dueDateObj.getTime())) {
        res.status(400).json({
          success: false,
          error: 'Invalid dueDate format'
        });
        return;
      }
      dueDateISO = dueDateObj.toISOString();
    }
    
    const result = await query(
      `INSERT INTO tasks (title, description, priority, status, due_date, tags, user_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [title, description, priority, status, dueDateISO, tags, userId]
    );
    
    res.status(201).json({
      success: true,
      data: result.rows[0]
    });
  } catch (error) {
    console.error('Error creating task:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to create task'
    });
  }
});

// Update a task
app.put('/api/tasks/:id', async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const updates = req.body;
    
    // First, get the current task to compare status
    const currentTaskResult = await query('SELECT * FROM tasks WHERE id = $1', [id]);
    
    if (currentTaskResult.rows.length === 0) {
      res.status(404).json({
        success: false,
        error: 'Task not found'
      });
      return;
    }
    
    const currentTask = currentTaskResult.rows[0];
    const previousStatus = currentTask.status;
    
    const updateFields = [];
    const values = [];
    let paramCount = 1;
    
    const allowedFields = ['title', 'description', 'status', 'priority', 'due_date', 'tags'];
    
    Object.entries(updates).forEach(([key, value]) => {
      const dbKey = key === 'dueDate' ? 'due_date' : key;
      if (allowedFields.includes(dbKey) && value !== undefined) {
        updateFields.push(`${dbKey} = $${paramCount}`);
        if (key === 'dueDate') {
          if (value) {
            const dateObj = new Date(value as string);
            if (isNaN(dateObj.getTime())) {
              throw new Error('Invalid dueDate format');
            }
            values.push(dateObj.toISOString());
          } else {
            values.push(null);
          }
        } else {
          values.push(value);
        }
        paramCount++;
      }
    });
    
    if (updateFields.length === 0) {
      res.status(400).json({
        success: false,
        error: 'No valid fields to update'
      });
      return;
    }
    
    updateFields.push('updated_at = CURRENT_TIMESTAMP');
    values.push(id);
    
    const result = await query(
      `UPDATE tasks SET ${updateFields.join(', ')} WHERE id = $${paramCount} RETURNING *`,
      values
    );
    
    const updatedTask = result.rows[0];
    const newStatus = updatedTask.status;
    
    // Check if webhook should be triggered
    if (currentTask.webhook_config && currentTask.webhook_config.enabled) {
      const webhookConfig = currentTask.webhook_config;
      
      // Determine trigger event
      let triggerEvent = 'updated';
      if (previousStatus !== newStatus) {
        triggerEvent = 'status_changed';
        if (newStatus === 'completed') {
          triggerEvent = 'completed';
        }
      }
      
      // Trigger webhook asynchronously (don't wait for response)
      webhookService.executeTaskWebhook(
        id,
        updatedTask,
        webhookConfig,
        triggerEvent,
        previousStatus,
        newStatus
      ).catch(error => {
        console.error('Error triggering task webhook:', error);
      });
    }
    
    res.json({
      success: true,
      data: updatedTask
    });
  } catch (error) {
    console.error('Error updating task:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to update task'
    });
  }
});

// Delete a task
app.delete('/api/tasks/:id', async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    
    const result = await query('DELETE FROM tasks WHERE id = $1 RETURNING *', [id]);
    
    if (result.rows.length === 0) {
      res.status(404).json({
        success: false,
        error: 'Task not found'
      });
      return;
    }
    
    res.json({
      success: true,
      message: 'Task deleted successfully'
    });
  } catch (error) {
    console.error('Error deleting task:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to delete task'
    });
  }
});

// ==================== EVENT CRUD ENDPOINTS ====================

// Get all events
app.get('/api/events', async (req: Request, res: Response): Promise<void> => {
  try {
    const { type, status, userId, limit = '50', offset = '0', upcoming } = req.query;
    
    let whereClause = 'WHERE user_id = $1';
    const values: any[] = [userId];
    let paramCount = 2;
    
    if (type) {
      whereClause += ` AND type = $${paramCount}`;
      values.push(type);
      paramCount++;
    }
    
    if (status) {
      whereClause += ` AND status = $${paramCount}`;
      values.push(status);
      paramCount++;
    }
    
    if (upcoming === 'true') {
      whereClause += ` AND start_date >= NOW()`;
    }
    
    values.push(parseInt(limit as string), parseInt(offset as string));
    
    const result = await query(
      `SELECT * FROM events ${whereClause} ORDER BY start_date ASC LIMIT $${paramCount} OFFSET $${paramCount + 1}`,
      values
    );
    
    res.json({
      success: true,
      data: result.rows
    });
  } catch (error) {
    console.error('Error fetching events:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch events'
    });
  }
});

// Get a single event
app.get('/api/events/:id', async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    
    const result = await query('SELECT * FROM events WHERE id = $1', [id]);
    
    if (result.rows.length === 0) {
      res.status(404).json({
        success: false,
        error: 'Event not found'
      });
      return;
    }
    
    res.json({
      success: true,
      data: result.rows[0]
    });
  } catch (error) {
    console.error('Error fetching event:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch event'
    });
  }
});

// Create a new event
app.post('/api/events', async (req: Request, res: Response): Promise<void> => {
  try {
    const { 
      title, 
      description, 
      startDate, 
      endDate, 
      location, 
      type = 'other', 
      status = 'scheduled', 
      attendees = [], 
      userId 
    } = req.body;
    
    if (!title || !startDate || !endDate) {
      res.status(400).json({
        success: false,
        error: 'Title, startDate, and endDate are required'
      });
      return;
    }
    
    const startDateObj = new Date(startDate);
    const endDateObj = new Date(endDate);
    
    if (isNaN(startDateObj.getTime()) || isNaN(endDateObj.getTime())) {
      res.status(400).json({
        success: false,
        error: 'Invalid date format'
      });
      return;
    }
    
    const result = await query(
      `INSERT INTO events (title, description, start_date, end_date, location, type, status, attendees, user_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING *`,
      [title, description, startDateObj.toISOString(), endDateObj.toISOString(), location, type, status, attendees, userId]
    );
    
    res.status(201).json({
      success: true,
      data: result.rows[0]
    });
  } catch (error) {
    console.error('Error creating event:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to create event'
    });
  }
});

// Update an event
app.put('/api/events/:id', async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const updates = req.body;
    
    const updateFields = [];
    const values = [];
    let paramCount = 1;
    
    const allowedFields = ['title', 'description', 'start_date', 'end_date', 'location', 'type', 'status', 'attendees'];
    
    Object.entries(updates).forEach(([key, value]) => {
      const dbKey = key === 'startDate' ? 'start_date' : key === 'endDate' ? 'end_date' : key;
      if (allowedFields.includes(dbKey) && value !== undefined) {
        updateFields.push(`${dbKey} = $${paramCount}`);
        if (key === 'startDate' || key === 'endDate') {
          const dateObj = new Date(value as string);
          if (isNaN(dateObj.getTime())) {
            throw new Error(`Invalid date format for ${key}`);
          }
          values.push(dateObj.toISOString());
        } else {
          values.push(value);
        }
        paramCount++;
      }
    });
    
    if (updateFields.length === 0) {
      res.status(400).json({
        success: false,
        error: 'No valid fields to update'
      });
      return;
    }
    
    updateFields.push('updated_at = CURRENT_TIMESTAMP');
    values.push(id);
    
    const result = await query(
      `UPDATE events SET ${updateFields.join(', ')} WHERE id = $${paramCount} RETURNING *`,
      values
    );
    
    if (result.rows.length === 0) {
      res.status(404).json({
        success: false,
        error: 'Event not found'
      });
      return;
    }
    
    res.json({
      success: true,
      data: result.rows[0]
    });
  } catch (error) {
    console.error('Error updating event:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to update event'
    });
  }
});

// Delete an event
app.delete('/api/events/:id', async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    
    const result = await query('DELETE FROM events WHERE id = $1 RETURNING *', [id]);
    
    if (result.rows.length === 0) {
      res.status(404).json({
        success: false,
        error: 'Event not found'
      });
      return;
    }
    
    res.json({
      success: true,
      message: 'Event deleted successfully'
    });
  } catch (error) {
    console.error('Error deleting event:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to delete event'
    });
  }
});

// ==================== EVENT WEBHOOK ENDPOINTS ====================

// Update event webhook configuration
app.put('/api/events/:id/webhook', async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const { webhookConfig } = req.body;

    // Validate webhook config
    const validated = WebhookConfigSchema.parse(webhookConfig);

    const result = await query(
      `UPDATE events 
       SET webhook_config = $1, updated_at = CURRENT_TIMESTAMP
       WHERE id = $2
       RETURNING *`,
      [JSON.stringify(validated), id]
    );

    if (result.rows.length === 0) {
      res.status(404).json({
        success: false,
        error: 'Event not found'
      });
      return;
    }

    res.json({
      success: true,
      data: result.rows[0],
      message: 'Webhook configuration updated successfully'
    });
  } catch (error) {
    console.error('Error updating webhook config:', error);
    res.status(400).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to update webhook configuration'
    });
  }
});

// Get webhook logs for an event
app.get('/api/events/:id/webhook/logs', async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const { limit = '50' } = req.query;

    const logs = await webhookService.getWebhookLogs(id, parseInt(limit as string));

    res.json({
      success: true,
      data: logs
    });
  } catch (error) {
    console.error('Error fetching webhook logs:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch webhook logs'
    });
  }
});

// Test webhook configuration
app.post('/api/events/:id/webhook/test', async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const { webhookConfig } = req.body;

    // Validate webhook config
    const validated = WebhookConfigSchema.parse(webhookConfig);

    // Get event data for test
    const eventResult = await query('SELECT * FROM events WHERE id = $1', [id]);
    
    if (eventResult.rows.length === 0) {
      res.status(404).json({
        success: false,
        error: 'Event not found'
      });
      return;
    }

    const testResult = await webhookService.testWebhook(validated, {
      event: eventResult.rows[0],
      test: true,
      triggeredAt: new Date().toISOString()
    });

    res.json({
      success: true,
      data: testResult
    });
  } catch (error) {
    console.error('Error testing webhook:', error);
    res.status(400).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to test webhook'
    });
  }
});

// Manually trigger webhook for an event
app.post('/api/events/:id/webhook/trigger', async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;

    const result = await query(
      'SELECT * FROM events WHERE id = $1 AND webhook_config IS NOT NULL',
      [id]
    );

    if (result.rows.length === 0) {
      res.status(404).json({
        success: false,
        error: 'Event not found or has no webhook configured'
      });
      return;
    }

    const event = result.rows[0];
    const webhookConfig = event.webhook_config;

    const success = await webhookService.executeWebhook(id, event, webhookConfig);

    res.json({
      success,
      message: success ? 'Webhook triggered successfully' : 'Webhook trigger failed'
    });
  } catch (error) {
    console.error('Error triggering webhook:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to trigger webhook'
    });
  }
});

// ==================== TASK WEBHOOK ENDPOINTS ====================

// Update task webhook configuration
app.put('/api/tasks/:id/webhook', async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const { webhookConfig } = req.body;

    // Validate webhook config
    const validated = TaskWebhookConfigSchema.parse(webhookConfig);

    const result = await query(
      `UPDATE tasks 
       SET webhook_config = $1, updated_at = CURRENT_TIMESTAMP
       WHERE id = $2
       RETURNING *`,
      [JSON.stringify(validated), id]
    );

    if (result.rows.length === 0) {
      res.status(404).json({
        success: false,
        error: 'Task not found'
      });
      return;
    }

    res.json({
      success: true,
      data: result.rows[0],
      message: 'Task webhook configuration updated successfully'
    });
  } catch (error) {
    console.error('Error updating task webhook config:', error);
    res.status(400).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to update webhook configuration'
    });
  }
});

// Get webhook logs for a task
app.get('/api/tasks/:id/webhook/logs', async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const { limit = '50' } = req.query;

    const logs = await webhookService.getTaskWebhookLogs(id, parseInt(limit as string));

    res.json({
      success: true,
      data: logs
    });
  } catch (error) {
    console.error('Error fetching task webhook logs:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch webhook logs'
    });
  }
});

// Test task webhook configuration
app.post('/api/tasks/:id/webhook/test', async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const { webhookConfig } = req.body;

    const validated = TaskWebhookConfigSchema.parse(webhookConfig);

    const taskResult = await query('SELECT * FROM tasks WHERE id = $1', [id]);
    
    if (taskResult.rows.length === 0) {
      res.status(404).json({
        success: false,
        error: 'Task not found'
      });
      return;
    }

    const testResult = await webhookService.testTaskWebhook(validated, {
      task: taskResult.rows[0],
      event: { type: 'test', timestamp: new Date().toISOString() },
      test: true,
      triggeredAt: new Date().toISOString()
    });

    res.json({
      success: true,
      data: testResult
    });
  } catch (error) {
    console.error('Error testing task webhook:', error);
    res.status(400).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to test webhook'
    });
  }
});

// Manually trigger webhook for a task
app.post('/api/tasks/:id/webhook/trigger', async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const { triggerEvent = 'manual' } = req.body;

    const result = await query(
      'SELECT * FROM tasks WHERE id = $1 AND webhook_config IS NOT NULL',
      [id]
    );

    if (result.rows.length === 0) {
      res.status(404).json({
        success: false,
        error: 'Task not found or has no webhook configured'
      });
      return;
    }

    const task = result.rows[0];
    const webhookConfig = task.webhook_config;

    const success = await webhookService.executeTaskWebhook(
      id, 
      task, 
      webhookConfig, 
      triggerEvent,
      task.status,
      task.status
    );

    res.json({
      success,
      message: success ? 'Task webhook triggered successfully' : 'Task webhook trigger failed'
    });
  } catch (error) {
    console.error('Error triggering task webhook:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to trigger webhook'
    });
  }
});

// Debug endpoint to manually trigger webhook check
app.post('/api/webhooks/debug/check', async (req: Request, res: Response): Promise<void> => {
  try {
    console.log('\n🔧 Manual webhook check triggered via API');
    // Access the private method via reflection (for debugging only)
    await (webhookService as any).checkAndTriggerWebhooks();
    
    res.json({
      success: true,
      message: 'Webhook check cycle completed. Check server logs for detailed output.'
    });
  } catch (error) {
    console.error('Error during manual webhook check:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to run webhook check'
    });
  }
});

// ==================== PUSH NOTIFICATION ENDPOINTS ====================

// Get VAPID public key
app.get('/api/push/public-key', (req: Request, res: Response) => {
  const publicKey = process.env.VAPID_PUBLIC_KEY;
  
  if (!publicKey) {
    res.status(503).json({
      success: false,
      error: 'Push notifications not configured. VAPID keys missing.'
    });
    return;
  }
  
  res.json({
    success: true,
    publicKey
  });
});

// Subscribe to push notifications
app.post('/api/push/subscribe', async (req: Request, res: Response): Promise<void> => {
  try {
    const { userId, subscription, alarmSettings } = req.body;
    
    if (!userId || !subscription) {
      res.status(400).json({
        success: false,
        error: 'userId and subscription are required'
      });
      return;
    }
    
    if (!process.env.VAPID_PUBLIC_KEY || !process.env.VAPID_PRIVATE_KEY) {
      res.status(503).json({
        success: false,
        error: 'Push notifications not configured'
      });
      return;
    }
    
    await pushNotificationService.subscribe(userId, subscription, alarmSettings);
    
    res.json({
      success: true,
      message: 'Successfully subscribed to push notifications'
    });
  } catch (error) {
    console.error('Error subscribing to push notifications:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to subscribe to push notifications'
    });
  }
});

// Unsubscribe from push notifications
app.post('/api/push/unsubscribe', async (req: Request, res: Response): Promise<void> => {
  try {
    const { userId, endpoint } = req.body;
    
    if (!userId || !endpoint) {
      res.status(400).json({
        success: false,
        error: 'userId and endpoint are required'
      });
      return;
    }
    
    await pushNotificationService.unsubscribe(userId, endpoint);
    
    res.json({
      success: true,
      message: 'Successfully unsubscribed from push notifications'
    });
  } catch (error) {
    console.error('Error unsubscribing from push notifications:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to unsubscribe from push notifications'
    });
  }
});

// Send test push notification
app.post('/api/push/test', async (req: Request, res: Response): Promise<void> => {
  try {
    const { userId, subscription } = req.body;
    
    if (!userId || !subscription) {
      res.status(400).json({
        success: false,
        error: 'userId and subscription are required'
      });
      return;
    }
    
    const result = await pushNotificationService.sendTestNotification(userId, subscription);
    
    res.json(result);
  } catch (error) {
    console.error('Error sending test notification:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to send test notification'
    });
  }
});

// Get push notification logs
app.get('/api/push/logs/:userId', async (req: Request, res: Response): Promise<void> => {
  try {
    const { userId } = req.params;
    const { limit = '50' } = req.query;
    
    const logs = await pushNotificationService.getNotificationLogs(userId, parseInt(limit as string));
    
    res.json({
      success: true,
      data: logs
    });
  } catch (error) {
    console.error('Error fetching notification logs:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch notification logs'
    });
  }
});

// Get user's push subscriptions
app.get('/api/push/subscriptions/:userId', async (req: Request, res: Response): Promise<void> => {
  try {
    const { userId } = req.params;
    
    const subscriptions = await pushNotificationService.getUserSubscriptions(userId);
    
    res.json({
      success: true,
      data: subscriptions
    });
  } catch (error) {
    console.error('Error fetching subscriptions:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch subscriptions'
    });
  }
});

// Daily Summary API
app.get('/api/summary/daily', async (req: Request, res: Response): Promise<void> => {
  try {
    const { userId } = req.query;
    
    // Get task statistics
    const taskStats = await query(
      `SELECT 
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE status = 'completed') as completed,
        COUNT(*) FILTER (WHERE status = 'pending') as pending,
        COUNT(*) FILTER (WHERE status = 'in_progress') as in_progress
       FROM tasks WHERE user_id = $1`,
      [userId]
    );
    
    // Get event statistics
    const eventStats = await query(
      `SELECT 
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE start_date >= NOW() AND status = 'scheduled') as upcoming,
        COUNT(*) FILTER (WHERE status = 'completed') as completed
       FROM events WHERE user_id = $1`,
      [userId]
    );
    
    res.json({
      success: true,
      data: {
        date: new Date().toISOString().split('T')[0],
        tasks: {
          total: parseInt(taskStats.rows[0].total),
          completed: parseInt(taskStats.rows[0].completed),
          pending: parseInt(taskStats.rows[0].pending),
          inProgress: parseInt(taskStats.rows[0].in_progress)
        },
        events: {
          total: parseInt(eventStats.rows[0].total),
          upcoming: parseInt(eventStats.rows[0].upcoming),
          completed: parseInt(eventStats.rows[0].completed)
        },
        message: 'Daily summary'
      }
    });
  } catch (error) {
    console.error('Error fetching daily summary:', error);
    res.json({
      success: true,
      data: {
        date: new Date().toISOString().split('T')[0],
        tasks: { total: 0, completed: 0, pending: 0, inProgress: 0 },
        events: { total: 0, upcoming: 0, completed: 0 },
        message: 'Daily summary (error fetching data)'
      }
    });
  }
});

// Search endpoint
app.post('/api/search', (req: Request, res: Response) => {
  res.json({
    success: true,
    data: []
  });
});

// Conversation history endpoints
app.get('/api/conversation/history', async (req: Request, res: Response) => {
  try {
    const { userId, conversationId, sessionId, limit = '50' } = req.query;
    
    console.log('📜 Fetching conversation history:', { userId, conversationId, sessionId, limit });
    
    if (!userId) {
      res.status(400).json({
        success: false,
        error: 'userId is required'
      });
      return;
    }
    
    // Build query conditions
    let whereConditions = ['user_id = $1'];
    let queryParams: any[] = [userId];
    let paramIndex = 2;
    
    if (conversationId) {
      whereConditions.push(`conversation_id = $${paramIndex}`);
      queryParams.push(conversationId);
      paramIndex++;
    }
    
    if (sessionId) {
      whereConditions.push(`session_id = $${paramIndex}`);
      queryParams.push(sessionId);
      paramIndex++;
    }
    
    // Add limit
    queryParams.push(parseInt(limit as string));
    
    const queryText = `
      SELECT id, role, content, actions, created_at
      FROM conversation_history 
      WHERE ${whereConditions.join(' AND ')}
      ORDER BY created_at DESC
      LIMIT $${paramIndex}
    `;
    
    const result = await query(queryText, queryParams);
    
    // Transform to frontend format
    const messages = result.rows.map((row: any) => ({
      id: row.id,
      role: row.role,
      content: row.content,
      timestamp: row.created_at,
      actions: row.actions || []
    })).reverse(); // Reverse to get chronological order
    
    res.json({
      success: true,
      data: messages
    });
    
  } catch (error) {
    console.error('Error fetching conversation history:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch conversation history'
    });
  }
});

app.post('/api/conversation/message', async (req: Request, res: Response) => {
  try {
    const { userId, conversationId, sessionId, role, content, context } = req.body;
    
    console.log('💬 Storing conversation message:', { userId, conversationId, sessionId, role });
    
    if (!userId || !role || !content) {
      res.status(400).json({
        success: false,
        error: 'userId, role, and content are required'
      });
      return;
    }
    
    const result = await query(
      `INSERT INTO conversation_history (user_id, conversation_id, session_id, role, content, actions)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, created_at`,
      [userId, conversationId, sessionId, role, content, JSON.stringify(context?.actions || [])]
    );
    
    res.json({
      success: true,
      data: {
        id: result.rows[0].id,
        timestamp: result.rows[0].created_at
      }
    });
    
  } catch (error) {
    console.error('Error storing conversation message:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to store conversation message'
    });
  }
});

app.delete('/api/conversation/history', async (req: Request, res: Response) => {
  try {
    const { userId, conversationId, sessionId } = req.query;
    
    console.log('🗑️  Clearing conversation history:', { userId, conversationId, sessionId });
    
    if (!userId) {
      res.status(400).json({
        success: false,
        error: 'userId is required'
      });
      return;
    }
    
    // Build query conditions
    let whereConditions = ['user_id = $1'];
    let queryParams: any[] = [userId];
    let paramIndex = 2;
    
    if (conversationId) {
      whereConditions.push(`conversation_id = $${paramIndex}`);
      queryParams.push(conversationId);
      paramIndex++;
    }
    
    if (sessionId) {
      whereConditions.push(`session_id = $${paramIndex}`);
      queryParams.push(sessionId);
      paramIndex++;
    }
    
    const result = await query(
      `DELETE FROM conversation_history WHERE ${whereConditions.join(' AND ')}`,
      queryParams
    );
    
    res.json({
      success: true,
      message: 'Conversation history cleared',
      deletedCount: result.rowCount
    });
    
  } catch (error) {
    console.error('Error clearing conversation history:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to clear conversation history'
    });
  }
});

// Memory endpoints - using Mastra Memory (PostgreSQL-backed)
// Note: Mastra Memory stores conversation context automatically
// These endpoints provide access to conversation history
app.get('/api/memory/:userId/all', async (req: Request, res: Response) => {
  try {
    const { userId } = req.params;
    const { sessionId, conversationId, limit = 100 } = req.query;
    
    if (!userId) {
      res.status(400).json({
        success: false,
        error: 'userId is required'
      });
      return;
    }

    console.log(`🧠 Fetching conversation history for user: ${userId}`);
    
    // Fetch conversation history from PostgreSQL
    let sqlQuery = 'SELECT * FROM conversation_history WHERE user_id = $1';
    const params: any[] = [userId];
    let paramIndex = 2;
    
    if (sessionId) {
      sqlQuery += ` AND session_id = $${paramIndex}`;
      params.push(sessionId);
      paramIndex++;
    }
    
    if (conversationId) {
      sqlQuery += ` AND conversation_id = $${paramIndex}`;
      params.push(conversationId);
      paramIndex++;
    }
    
    sqlQuery += ` ORDER BY created_at DESC LIMIT $${paramIndex}`;
    params.push(limit);
    
    const result = await query(sqlQuery, params);
    
    res.json({
      success: true,
      data: {
        memories: result.rows.map((row: any) => ({
          id: row.id,
          memory: `${row.role}: ${row.content}`,
          metadata: {
            role: row.role,
            sessionId: row.session_id,
            conversationId: row.conversation_id,
            actions: row.actions
          },
          created_at: row.created_at
        })),
        count: result.rows.length
      }
    });
  } catch (error) {
    console.error('Error fetching conversation history:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch conversation history'
    });
  }
});

app.delete('/api/memory/:userId/:memoryId', async (req: Request, res: Response) => {
  try {
    const { userId, memoryId } = req.params;
    
    if (!userId || !memoryId) {
      res.status(400).json({
        success: false,
        error: 'userId and memoryId are required'
      });
      return;
    }

    console.log(`🗑️  Deleting conversation entry ${memoryId} for user: ${userId}`);
    
    // Delete from conversation_history table
    await query(
      'DELETE FROM conversation_history WHERE id = $1 AND user_id = $2',
      [memoryId, userId]
    );
    
    res.json({
      success: true,
      message: 'Conversation entry deleted successfully'
    });
  } catch (error) {
    console.error('Error deleting conversation entry:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to delete conversation entry'
    });
  }
});

// Legacy memory endpoints (for backward compatibility)
app.get('/api/memory/:userId', (req: Request, res: Response) => {
  res.json({
    success: true,
    data: []
  });
});

app.delete('/api/memory/:userId', (req: Request, res: Response) => {
  res.json({
    success: true,
    message: 'Memory cleared'
  });
});

// Error handling
app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ success: false, error: 'Internal server error' });
});

// 404 handler
app.use('*', (req: Request, res: Response) => {
  res.status(404).json({ success: false, error: 'Endpoint not found' });
});

// Initialize and start
const startServer = async () => {
  try {
    console.log('🔄 Initializing database...');
    await initializeDatabase();
    console.log('✅ Database initialized');
    
    // Start webhook monitoring service
    webhookService.start();
    
    // Start push notification service
    pushNotificationService.start();
    
    if (!process.env.OPENAI_API_KEY) {
      console.warn('⚠️  WARNING: OpenAI API key not configured!');
      console.warn('   Set OPENAI_API_KEY in your .env file');
      console.warn('   Get one at: https://platform.openai.com/api-keys');
      console.warn('   The AI agents will not work without it.');
    } else {
      console.log('🤖 Mastra AI Agents: ENABLED');
      console.log('   - Task Agent: Ready');
      console.log('   - Event Agent: Ready');
      console.log('   - Research Agent: Ready (Deep Research)');
    }
    
    app.listen(PORT, () => {
      console.log(`⚡ DerPlanner Task Event Planner Server running on port ${PORT}`);
      console.log(`📊 Health check: http://localhost:${PORT}/health`);
      console.log(`🤖 General Agent: POST http://localhost:${PORT}/api/agent/general`);
      console.log(`🎯 Task Agent: POST http://localhost:${PORT}/api/agent/task`);
      console.log(`📅 Event Agent: POST http://localhost:${PORT}/api/agent/event`);
      console.log(`🔍 Research Agent: POST http://localhost:${PORT}/api/agent/research`);
      console.log(`🎣 Webhook Service: ENABLED`);
      console.log(`🔔 Push Notifications: ${process.env.VAPID_PUBLIC_KEY ? 'ENABLED' : 'DISABLED'}`);
      console.log(`✅ Server ready with Mastra AI agents + Deep Research + Webhooks + Push Notifications!`);
    });
  } catch (error) {
    console.error('❌ Failed to start server:', error);
    process.exit(1);
  }
};

startServer();

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\n🛑 Shutting down...');
  webhookService.stop();
  pushNotificationService.stop();
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('\n🛑 Shutting down...');
  webhookService.stop();
  pushNotificationService.stop();
  process.exit(0);
});
