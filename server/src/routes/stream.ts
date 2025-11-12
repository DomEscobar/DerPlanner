import { Request, Response } from 'express';
import { mastra } from '../mastra';
import type { CoreMessage } from 'ai';
import { query } from '../config/database';

/**
 * Streaming Endpoint for AI Network
 * 
 * This endpoint uses Server-Sent Events (SSE) to stream real-time progress
 * as the AI network orchestrates different agents and workflows.
 */
export async function streamAgentNetwork(req: Request, res: Response) {
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

  // Set up Server-Sent Events (SSE)
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no'); // Disable nginx buffering

  // Send initial connection event
  res.write(`data: ${JSON.stringify({ type: 'connected', timestamp: new Date().toISOString() })}\n\n`);

  try {
    const currentDateTime = context?.currentDateTime || new Date().toISOString();
    const timezone = context?.timezone || 'UTC';

    // Fetch conversation history for context
    async function getConversationHistoryForAgent(
      userId: string, 
      conversationId?: string, 
      sessionId?: string,
      limit: number = 10
    ): Promise<CoreMessage[]> {
      try {
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
        
        queryParams.push(limit);
        
        const queryText = `
          SELECT role, content, actions
          FROM conversation_history 
          WHERE ${whereConditions.join(' AND ')}
          ORDER BY created_at DESC
          LIMIT $${paramIndex}
        `;
        
        const result = await query(queryText, queryParams);
        
        const messages = result.rows.reverse().map((row: any) => {
          let content = row.content;
          
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
        console.error('Error fetching conversation history:', error);
        return [];
      }
    }

    // Send processing start event
    res.write(`data: ${JSON.stringify({ 
      type: 'start', 
      message: 'Analyzing your request...',
      timestamp: new Date().toISOString()
    })}\n\n`);

    // Fetch conversation history
    const conversationHistory = await getConversationHistoryForAgent(
      userId,
      context?.conversationId,
      context?.sessionId,
      10
    );

    // Build date/time context message
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

    // Send step update
    res.write(`data: ${JSON.stringify({ 
      type: 'step', 
      step: {
        number: 1,
        agent: 'RoutingAgent',
        action: 'Analyzing request and determining best approach',
        status: 'completed',
        timestamp: new Date().toISOString()
      }
    })}\n\n`);

    // Use the intelligent routing workflow for consistency
    console.log('🧠 Using Intelligent Routing Workflow via streaming');
    
    const workflow = mastra.getWorkflow('intelligentRoutingWorkflow');
    const run = await workflow.createRunAsync();
    
    // Send agent execution step
    res.write(`data: ${JSON.stringify({ 
      type: 'step', 
      step: {
        number: 2,
        agent: 'AgentNetwork',
        action: 'Routing and executing agent(s)',
        status: 'in_progress',
        timestamp: new Date().toISOString()
      }
    })}\n\n`);
    
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

    let responseMessage = '';
    let actions: any[] = [];
    let agentType = 'unknown';

    if (result.status === 'success') {
      // Extract response from workflow result
      // @ts-ignore - Type mismatch between workflow result structure
      const workflowResult: any = result.result;
      
      // Try to find the step result - check each handle method explicitly
      let stepResult = null;
      const handleKeys = [
        'handleWithTaskAgent',
        'handleWithEventAgent', 
        'handleWithAnswerAgent',
        'handleWithResearchAgent',
        'handleWithBothAgents'
      ];
      
      for (const key of handleKeys) {
        if (workflowResult[key]) {
          stepResult = workflowResult[key];
          break;
        }
      }
      
      // Fallback to workflowResult itself if no handle method found
      if (!stepResult) {
        stepResult = workflowResult;
      }
      
      // Extract response, actions, and agent type
      // @ts-ignore - Dynamic property access
      responseMessage = stepResult?.response || stepResult?.message || '';
      
      // If stepResult is the workflowResult itself, try to find nested response
      if (!responseMessage && stepResult === workflowResult) {
        for (const key of Object.keys(workflowResult)) {
          if (key.startsWith('handleWith') && workflowResult[key]?.response) {
            responseMessage = workflowResult[key].response;
            // @ts-ignore - Dynamic property access
            actions = workflowResult[key].actions || [];
            // @ts-ignore - Dynamic property access
            agentType = workflowResult[key].agent || 'unknown';
            break;
          }
        }
      }
      
      // Final extraction if still empty
      if (!responseMessage) {
        // @ts-ignore - Dynamic property access
        responseMessage = stepResult?.response || stepResult?.message || '';
        // @ts-ignore - Dynamic property access
        actions = stepResult?.actions || [];
        // @ts-ignore - Dynamic property access
        agentType = stepResult?.agent || 'unknown';
      } else {
        // Extract actions and agent type if we found response but haven't set these yet
        if (!actions || actions.length === 0) {
          // @ts-ignore - Dynamic property access
          actions = stepResult?.actions || [];
        }
        if (agentType === 'unknown') {
          // @ts-ignore - Dynamic property access
          agentType = stepResult?.agent || 'unknown';
        }
      }
      
      // Send agent execution completion
      const agentLabel = 
        agentType === 'both' ? 'TaskAgent + EventAgent' : 
        agentType === 'task' ? 'TaskAgent' : 
        agentType === 'event' ? 'EventAgent' : 
        agentType === 'research' ? 'ResearchAgent' : 
        agentType === 'answer' ? 'AnswerAgent' :
        'Agent';
      
      const actionLabel = 
        agentType === 'both' ? 'Executing task and event agents' : 
        agentType === 'task' ? 'Executing task agent' : 
        agentType === 'event' ? 'Executing event agent' : 
        agentType === 'research' ? 'Conducting deep research with web search' : 
        agentType === 'answer' ? 'Answering general knowledge question' :
        'Processing request';
      
      res.write(`data: ${JSON.stringify({ 
        type: 'step', 
        step: {
          number: 2,
          agent: agentLabel,
          action: actionLabel,
          status: 'completed',
          timestamp: new Date().toISOString()
        }
      })}\n\n`);
      
      // Send tool execution step if actions were performed
      if (actions && actions.length > 0) {
        res.write(`data: ${JSON.stringify({ 
          type: 'step', 
          step: {
            number: 3,
            agent: 'ToolExecutor',
            action: `Executed ${actions.length} action(s): ${actions.map(a => a.type).join(', ')}`,
            status: 'completed',
            timestamp: new Date().toISOString()
          }
        })}\n\n`);
      }
    }

    // Fallback if still empty
    if (!responseMessage) {
      console.warn('⚠️  Empty response from workflow, using fallback');
      responseMessage = 'I understand your request. How can I help you with your tasks or events?';
    }

    // Send completion event with full result
    res.write(`data: ${JSON.stringify({ 
      type: 'complete', 
      result: {
        response: responseMessage,
        actions: actions,
        timestamp: new Date().toISOString()
      }
    })}\n\n`);

    // Close the connection
    res.write(`data: ${JSON.stringify({ type: 'done' })}\n\n`);
    res.end();

  } catch (error) {
    console.error('❌ Error in streaming endpoint:', error);
    
    // Send error event
    res.write(`data: ${JSON.stringify({ 
      type: 'error', 
      error: error instanceof Error ? error.message : 'Internal server error',
      timestamp: new Date().toISOString()
    })}\n\n`);
    
    res.end();
  }
}

