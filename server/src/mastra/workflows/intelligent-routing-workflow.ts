/**
 * Intelligent Routing Workflow
 * 
 * Uses LLM to intelligently route user requests to the appropriate agent
 * with proper context and parameter extraction.
 */

import { createWorkflow, createStep } from '@mastra/core/workflows';
import { z } from 'zod';
import { Agent } from '@mastra/core/agent';
import { llm } from '../llm';
import { taskAgent } from '../agents/task-agent';
import { eventAgent, getEventAgent } from '../agents/event-agent';
import { researchAgent } from '../agents/research-agent';
import { answerAgent } from '../agents/answer-agent';

// Single source of truth for routing instructions
const ROUTING_INSTRUCTIONS = `You are an intelligent routing assistant that analyzes user messages and determines the best agent to handle them based on semantic understanding of user intent.

**Available Agent Types:**
- "answer" - General knowledge questions, definitions, explanations that can be answered from training data
- "task" - Task management operations (creating, updating, listing, deleting tasks, todos, work items)
- "event" - Calendar/scheduling operations (meetings, appointments, calendar events, time-blocking)
- "research" - Web research requiring real-time information gathering, citations, or current data
- "both" - Requests that semantically require both task AND event operations

**Routing Decision Framework:**

1. **Answer Agent** - Use when:
   - Question can be answered from general knowledge in training data
   - No real-time web search or current data verification needed
   - User seeks explanations, definitions, or conceptual understanding
   - Decision criteria: "Can this be answered from static knowledge?"
   - Examples: "What is machine learning?", "Explain REST APIs", "How does React work?"

2. **Research Agent** - Use when:
   - Requires real-time web search or current information
   - Needs citations or data-backed analysis
   - User explicitly requests web search, research, or current information
   - Information changes frequently (trends, prices, news, current events)
   - Decision criteria: "Does this require accessing current web data?"
   - Examples: "Search for latest AI trends", "Research competitors", "What's the current price of X?"

3. **Task Agent** - Use when:
   - User wants to manage work items, todos, or actionable items
   - Operations involve creating, updating, listing, deleting tasks
   - Queries about user's work or task status
   - Marking items complete or changing task properties
   - Decision criteria: "Is this about managing work items or todos?"
   - Examples: "Create a task", "What's on my plate?", "Mark task X as done"

4. **Event Agent** - Use when:
   - User wants to schedule calendar events or meetings
   - Operations involve time-blocking or calendar management
   - Setting reminders or appointments
   - Queries about calendar or scheduled events
   - Decision criteria: "Is this about scheduling or calendar management?"
   - Examples: "Schedule a meeting", "What's on my calendar?", "Block time for X"

5. **Both Agent** - Use when:
   - Request semantically requires both task management AND calendar operations
   - User wants to create a task with a deadline AND schedule time for it
   - Request involves coordinating tasks with calendar events
   - Decision criteria: "Does this require both task AND event operations?"
   - Examples: "Prepare presentation and block 2 hours tomorrow", "Set up project tasks and schedule kickoff meeting"

**Edge Cases:**
- Reminders: If time-specific → event, if general → task
- "What's on my plate?" → task (work items)
- "What's on my calendar?" → event (scheduled events)
- "Do I have anything due this week?" → task (work deadlines)
- "Move my 3pm to 4pm" → event (calendar rescheduling)
- "Push everything back an hour" → both (may affect tasks with deadlines AND events)

**Critical Guidelines:**
- Analyze semantic intent, not just keywords
- **ALWAYS prioritize conversation context and history**
- **CRITICAL: If the previous assistant message asked a clarifying question (e.g., "For how many occurrences?", "What time?", "Which one?"), the user's response is almost certainly a follow-up to that same agent**
- **Single-word, single-number, or very short responses (< 5 words) are typically continuations of the previous agent's flow, not new requests**
- When uncertain between answer/research: prefer answer unless explicitly requesting current data
- When uncertain between task/event: prefer task unless explicitly about scheduling
- When uncertain: use lower confidence score (< 0.7)

**Conversational Context Rules:**
1. **Follow-up Detection**: If the last assistant message contains questions like:
   - "For how many occurrences?" → User's number response goes to the SAME agent
   - "What time?" / "When?" → User's time/date response goes to the SAME agent
   - "Which one?" / "Which task/event?" → User's selection goes to the SAME agent
   - Any clarifying question ending with "?" → User's response continues that flow

2. **Short Response Detection**: Messages that are:
   - Single numbers (e.g., "8", "12", "3")
   - Single words (e.g., "yes", "no", "tomorrow")
   - Very short phrases (< 5 words)
   - Should be routed to the SAME agent as the previous interaction unless clearly starting a new topic

3. **Context Continuity**: Look for patterns in conversation history:
   - If user started with "set reminder" → event agent
   - If assistant asked about occurrences → user's number response → event agent
   - If assistant asked about time → user's time response → same agent type
   - Don't switch agents mid-conversation unless user explicitly changes topic`;

// Router agent that decides which agent to use
const routerAgent = new Agent({
  name: 'Router',
  instructions: ROUTING_INSTRUCTIONS,
  model: llm,
});

// Agent type enum - single source of truth
const AGENT_TYPES = ['answer', 'task', 'event', 'research', 'both'] as const;
type AgentType = typeof AGENT_TYPES[number];

// Routing schema - single source of truth
const routingSchema = z.object({
  agentType: z.enum(AGENT_TYPES),
  confidence: z.number(),
  reasoning: z.string()
});

// Confidence threshold for routing decisions
const CONFIDENCE_THRESHOLD = 0.6;

// Conversation message schema
const conversationMessageSchema = z.object({
  role: z.enum(['user', 'assistant', 'system']),
  content: z.string()
});

// Step 1: Analyze and route the request
const analyzeRequest = createStep({
  id: 'analyzeRequest',
  // @ts-ignore - Mastra workflow type system has limitations with complex nested schemas
  inputSchema: z.object({
    message: z.string(),
    conversationHistory: z.array(conversationMessageSchema).default([]),
    userId: z.string(),
  }),
  // @ts-ignore - Mastra workflow type system has limitations with complex nested schemas
  outputSchema: z.object({
    agentType: z.enum(AGENT_TYPES),
    confidence: z.number(),
    message: z.string(),
    conversationHistory: z.array(z.any()),
    userId: z.string(),
  }),
  execute: async ({ inputData }) => {
    // Get recent conversation history (last 5 messages for better context)
    const recentHistory = inputData.conversationHistory.slice(-5);
    // Format history with most recent first for better readability
    const reversedHistory = [...recentHistory].reverse();
    const contextInfo = recentHistory.length > 0 
      ? `\n\n**RECENT CONVERSATION HISTORY (most recent first):**\n${reversedHistory.map((msg, idx) => 
          `${idx === 0 ? '[MOST RECENT] ' : ''}${msg.role.toUpperCase()}: ${msg.content}`
        ).join('\n')}`
      : '';

    // Detect if this might be a follow-up message
    const isShortResponse = inputData.message.trim().split(/\s+/).length <= 3;
    const isNumberOnly = /^\d+$/.test(inputData.message.trim());
    // Find the most recent assistant message (first in reversed array = most recent)
    const lastAssistantMessage = reversedHistory.find(msg => msg.role === 'assistant');
    const hasClarifyingQuestion = lastAssistantMessage?.content.includes('?') || false;

    const followUpContext = (isShortResponse || isNumberOnly || hasClarifyingQuestion) && lastAssistantMessage
      ? `\n\n**⚠️ FOLLOW-UP DETECTION:**
- Current message is very short (${isShortResponse ? 'YES' : 'NO'}) or number-only (${isNumberOnly ? 'YES' : 'NO'})
- Last assistant message: "${lastAssistantMessage.content.substring(0, 100)}..."
- This appears to be a FOLLOW-UP response. Route to the SAME agent type that handled the previous message unless the user explicitly changed topics.`
      : '';

    const prompt = `Analyze this user message and determine the appropriate agent to handle it:
"${inputData.message}"${contextInfo}${followUpContext}

**CRITICAL ROUTING RULES:**
1. **FIRST**: Check if this is a follow-up to a previous agent's question
   - If the last assistant message asked a clarifying question (ends with "?") AND the current message is short/number-only → Route to the SAME agent
   - Look for patterns: "For how many occurrences?" → number response → event agent
   - Look for patterns: "What time?" → time response → same agent type

2. **SECOND**: If not a follow-up, analyze the semantic intent of the message

3. **ALWAYS**: Consider the full conversation context, not just the current message

Follow the routing guidelines provided in your instructions. Analyze semantic intent, not just keywords.

Return a JSON object with:
- agentType: One of "answer", "task", "event", "research", or "both"
- confidence: A number between 0 and 1 indicating your confidence in this routing decision
- reasoning: A brief explanation of why this routing was chosen, including:
  * Whether you detected this as a follow-up message
  * What agent handled the previous message (if applicable)
  * Why you chose this routing (or why you're continuing the same agent flow)`;

    const response = await routerAgent.generate(prompt, {
      output: routingSchema
    });

    const agentType = response.object?.agentType || 'answer';
    const confidence = response.object?.confidence ?? 0.5;
    const reasoning = response.object?.reasoning || 'No reasoning provided';

    // Log routing decision with confidence warning if low
    if (confidence < CONFIDENCE_THRESHOLD) {
      console.warn(`⚠️ Low confidence routing: ${agentType} (confidence: ${confidence.toFixed(2)})`);
      console.warn(`   Reasoning: ${reasoning}`);
    } else {
      console.log(`🎯 Routing decision: ${agentType} (confidence: ${confidence.toFixed(2)})`);
      console.log(`   Reasoning: ${reasoning}`);
    }

    // If confidence is very low, default to answer agent as safe fallback
    const finalAgentType = confidence < 0.4 ? 'answer' : agentType;

    return {
      agentType: finalAgentType,
      confidence: confidence,
      message: inputData.message,
      conversationHistory: inputData.conversationHistory,
      userId: inputData.userId,
    };
  },
});

// Step 2a: Handle with Task Agent
const handleWithTaskAgent = createStep({
  id: 'handleWithTaskAgent',
  inputSchema: z.object({
    message: z.string(),
    conversationHistory: z.array(z.any()),
    userId: z.string(),
    agentType: z.enum(AGENT_TYPES),
    confidence: z.number(),
  }),
  outputSchema: z.object({
    response: z.string(),
    actions: z.array(z.any()),
    agent: z.string(),
  }),
  execute: async ({ inputData }) => {
    // Add userId to the conversation context as a system message
    const userIdMessage = {
      role: 'system' as const,
      content: `User ID: ${inputData.userId}`
    };

    const messages = [
      userIdMessage,
      ...inputData.conversationHistory,
      { role: 'user' as const, content: inputData.message }
    ];

    const response = await taskAgent.generate(messages);

    // Extract actions from tool results (using the same logic as server.ts)
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

    return {
      response: response.text || 'Task processed',
      actions,
      agent: 'task'
    };
  },
});

// Step 2b: Handle with Event Agent
const handleWithEventAgent = createStep({
  id: 'handleWithEventAgent',
  inputSchema: z.object({
    message: z.string(),
    conversationHistory: z.array(z.any()),
    userId: z.string(),
    agentType: z.enum(AGENT_TYPES),
    confidence: z.number(),
  }),
  outputSchema: z.object({
    response: z.string(),
    actions: z.array(z.any()),
    agent: z.string(),
  }),
  execute: async ({ inputData }) => {
    // Add userId to the conversation context as a system message
    const userIdMessage = {
      role: 'system' as const,
      content: `User ID: ${inputData.userId}`
    };

    const messages = [
      userIdMessage,
      ...inputData.conversationHistory,
      { role: 'user' as const, content: inputData.message }
    ];

    const response = await eventAgent.generate(messages);

    // Extract actions from tool results
    const actions: any[] = [];

    (response.toolResults || []).forEach((result: any) => {
      const toolResult = result.payload?.result;
      if (!toolResult || typeof toolResult !== 'object') return;

      if (toolResult.event) {
        actions.push({ type: 'event', data: toolResult.event });
      }

      if (toolResult.events && Array.isArray(toolResult.events)) {
        toolResult.events.forEach((event: any) => {
          actions.push({ type: 'event', data: event });
        });
      }
    });

    return {
      response: response.text || 'Event processed',
      actions,
      agent: 'event'
    };
  },
});

// Step 2c: Handle with Research Agent
const handleWithResearchAgent = createStep({
  id: 'handleWithResearchAgent',
  inputSchema: z.object({
    message: z.string(),
    conversationHistory: z.array(z.any()),
    userId: z.string(),
    agentType: z.enum(AGENT_TYPES),
    confidence: z.number(),
  }),
  outputSchema: z.object({
    response: z.string(),
    actions: z.array(z.any()),
    agent: z.string(),
  }),
  execute: async ({ inputData }) => {
    console.log('🔍 Calling ResearchAgent with tools...');
    
    try {
      // Add userId to the conversation context as a system message
      const userIdMessage = {
        role: 'system' as const,
        content: `User ID: ${inputData.userId}`
      };

      const messages = [
        userIdMessage,
        ...inputData.conversationHistory,
        { role: 'user' as const, content: inputData.message }
      ];

      // Use the research agent with its tools
      const response = await researchAgent.generate(messages);

      // Extract research results from tool calls
      const actions: any[] = [];
      let hasResearchResults = false;

      (response.toolResults || []).forEach((result: any) => {
        const toolResult = result.payload?.result;
        if (!toolResult || typeof toolResult !== 'object') return;

        // Check if this is a research tool result
        if (toolResult.report || toolResult.answer) {
          hasResearchResults = true;
          actions.push({ 
            type: 'research', 
            data: {
              query: inputData.message,
              report: toolResult.report || toolResult.answer,
              citations: toolResult.citations || [],
              searchCount: toolResult.searchCount || 0
            }
          });
        }
      });

      console.log(`✅ Research agent completed. Tool results: ${hasResearchResults ? 'Yes' : 'No'}`);
      
      return {
        response: response.text || 'Research completed',
        actions,
        agent: 'research'
      };
      
    } catch (error) {
      console.error('❌ Research agent error:', error);
      return {
        response: `I encountered an error while researching: ${error instanceof Error ? error.message : 'Unknown error'}. Please try again.`,
        actions: [],
        agent: 'research'
      };
    }
  },
});

// Step 2d: Handle with Answer Agent
const handleWithAnswerAgent = createStep({
  id: 'handleWithAnswerAgent',
  inputSchema: z.object({
    message: z.string(),
    conversationHistory: z.array(z.any()),
    userId: z.string(),
    agentType: z.enum(AGENT_TYPES),
    confidence: z.number(),
  }),
  outputSchema: z.object({
    response: z.string(),
    actions: z.array(z.any()),
    agent: z.string(),
  }),
  execute: async ({ inputData }) => {
    console.log('💡 Calling AnswerAgent for general knowledge question...');
    
    const userIdMessage = {
      role: 'system' as const,
      content: `User ID: ${inputData.userId}`
    };

    const messages = [
      userIdMessage,
      ...inputData.conversationHistory,
      { role: 'user' as const, content: inputData.message }
    ];

    const response = await answerAgent.generate(messages);

    return {
      response: response.text || 'Answer provided',
      actions: [],
      agent: 'answer'
    };
  },
});

// Step 2e: Handle with both agents (sequential execution for better coordination)
const handleWithBothAgents = createStep({
  id: 'handleWithBothAgents',
  inputSchema: z.object({
    message: z.string(),
    conversationHistory: z.array(z.any()),
    userId: z.string(),
    agentType: z.enum(AGENT_TYPES),
    confidence: z.number(),
  }),
  outputSchema: z.object({
    response: z.string(),
    actions: z.array(z.any()),
    agent: z.string(),
  }),
  execute: async ({ inputData }) => {
    const userIdMessage = {
      role: 'system' as const,
      content: `User ID: ${inputData.userId}`
    };

    const baseMessages = [
      userIdMessage,
      ...inputData.conversationHistory,
      { role: 'user' as const, content: inputData.message }
    ];

    // Execute task agent first to understand task requirements
    const taskResponse = await taskAgent.generate(baseMessages);
    
    // Extract task actions and build context for event agent
    const taskActions: any[] = [];
    (taskResponse.toolResults || []).forEach((result: any) => {
      const toolResult = result.payload?.result;
      if (!toolResult || typeof toolResult !== 'object') return;

      if (toolResult.task) {
        taskActions.push({ type: 'task', data: toolResult.task });
      }

      if (toolResult.tasks && Array.isArray(toolResult.tasks)) {
        toolResult.tasks.forEach((task: any) => {
          taskActions.push({ type: 'task', data: task });
        });
      }
    });

    // Build enhanced context for event agent with task results
    const eventContext = taskActions.length > 0
      ? `Task operations completed: ${taskActions.length} task(s) created/updated.`
      : '';

    const eventMessages = [
      ...baseMessages,
      ...(eventContext ? [{ 
        role: 'system' as const, 
        content: eventContext 
      }] : [])
    ];

    // Execute event agent with context from task operations
    const eventResponse = await eventAgent.generate(eventMessages);

    // Extract event actions
    const eventActions: any[] = [];
    (eventResponse.toolResults || []).forEach((result: any) => {
      const toolResult = result.payload?.result;
      if (!toolResult || typeof toolResult !== 'object') return;

      if (toolResult.event) {
        eventActions.push({ type: 'event', data: toolResult.event });
      }

      if (toolResult.events && Array.isArray(toolResult.events)) {
        toolResult.events.forEach((event: any) => {
          eventActions.push({ type: 'event', data: event });
        });
      }
    });

    // Combine all actions
    const allActions = [...taskActions, ...eventActions];

    // Intelligently combine responses
    const taskText = taskResponse.text || '';
    const eventText = eventResponse.text || '';
    
    let combinedResponse = '';
    if (taskText && eventText) {
      // Both agents returned responses - combine with coordination
      combinedResponse = `${taskText}\n\n${eventText}`;
    } else if (taskText) {
      combinedResponse = taskText;
    } else if (eventText) {
      combinedResponse = eventText;
    } else {
      // Neither returned text, but actions were taken
      if (allActions.length > 0) {
        const taskCount = taskActions.length;
        const eventCount = eventActions.length;
        combinedResponse = `Processed ${taskCount} task(s) and ${eventCount} event(s).`;
      } else {
        combinedResponse = 'Request processed.';
      }
    }

    return {
      response: combinedResponse,
      actions: allActions,
      agent: 'both'
    };
  },
});

// Create the workflow with branching
export const intelligentRoutingWorkflow = createWorkflow({
  id: 'intelligent-routing',
  inputSchema: z.object({
    message: z.string(),
    conversationHistory: z.array(z.object({
      role: z.enum(['user', 'assistant', 'system']),
      content: z.string()
    })).default([]),
    userId: z.string(),
  }),
  outputSchema: z.object({
    response: z.string(),
    actions: z.array(z.any()),
    agent: z.string(),
  }),
})
  .then(analyzeRequest)
  // @ts-ignore - Type mismatch between workflow step schemas
  .branch([
    [
      async ({ inputData }) => inputData.agentType === 'task',
      handleWithTaskAgent
    ],
    [
      async ({ inputData }) => inputData.agentType === 'event',
      handleWithEventAgent
    ],
    [
      async ({ inputData }) => inputData.agentType === 'research',
      handleWithResearchAgent
    ],
    [
      async ({ inputData }) => inputData.agentType === 'answer',
      handleWithAnswerAgent
    ],
    [
      async ({ inputData }) => inputData.agentType === 'both',
      handleWithBothAgents
    ],
  ])
  .commit();

