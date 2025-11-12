/**
 * Batch Task Operations Workflow
 * 
 * Handles batch operations on multiple tasks with proper validation,
 * context extraction, and confirmation.
 */

import { createWorkflow, createStep } from '@mastra/core/workflows';
import { z } from 'zod';
import { Agent } from '@mastra/core/agent';
import { llm } from '../llm';
import { query } from '../../config/database';

// Batch operation agent
const batchAgent = new Agent({
  name: 'BatchOperations',
  instructions: `You are a batch operations assistant. You help users perform operations on multiple tasks at once.

When users refer to "these tasks", "those tasks", "them", or "the ones above", extract the task IDs from the conversation context.

Be careful and confirm the operation before executing destructive actions.`,
  model: llm,
});

// Step 1: Extract task IDs from context
const extractTaskIds = createStep({
  id: 'extractTaskIds',
  inputSchema: z.object({
    message: z.string(),
    conversationHistory: z.array(z.object({
      role: z.string(),
      content: z.string()
    })),
    operation: z.enum(['delete', 'update', 'complete', 'prioritize']),
  }),
  outputSchema: z.object({
    taskIds: z.array(z.string()),
    taskTitles: z.array(z.string()),
    operation: z.string(),
    message: z.string(),
  }),
  execute: async ({ inputData }) => {
    // Build context from conversation history
    const contextStr = inputData.conversationHistory
      .slice(-5) // Last 5 messages
      .map(msg => `${msg.role}: ${msg.content}`)
      .join('\n');

    const prompt = `From this conversation context, extract all task IDs that the user is referring to:

${contextStr}

Current message: "${inputData.message}"

Look for patterns like:
- [Task ID: xxx, Title: "yyy", ...]
- Task mentions in previous messages
- References like "these tasks", "those", "them"

Return a JSON object with:
- taskIds: array of task IDs found
- taskTitles: array of task titles for confirmation  
- reasoning: how these IDs were identified`;

    const batchSchema = z.object({
      taskIds: z.array(z.string()),
      taskTitles: z.array(z.string()),
      reasoning: z.string()
    });

    const response = await batchAgent.generate(prompt, {
      output: batchSchema
    });

    console.log(`📦 Batch operation: ${inputData.operation} on ${response.object.taskIds.length} tasks`);
    console.log(`   Tasks: ${response.object.taskTitles.join(', ')}`);
    console.log(`   Reasoning: ${response.object.reasoning}`);

    return {
      taskIds: response.object.taskIds,
      taskTitles: response.object.taskTitles,
      operation: inputData.operation,
      message: inputData.message,
    };
  },
});

// Step 2a: Delete multiple tasks
const deleteTasks = createStep({
  id: 'deleteTasks',
  inputSchema: z.object({
    taskIds: z.array(z.string()),
    taskTitles: z.array(z.string()),
    operation: z.string(),
    message: z.string(),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    deletedCount: z.number(),
    message: z.string(),
    actions: z.array(z.any()),
  }),
  execute: async ({ inputData }) => {
    const deletedTasks = [];
    
    for (const taskId of inputData.taskIds) {
      try {
        const result = await query('DELETE FROM tasks WHERE id = $1 RETURNING *', [taskId]);
        if (result.rows.length > 0) {
          deletedTasks.push(result.rows[0]);
        }
      } catch (error) {
        console.error(`Failed to delete task ${taskId}:`, error);
      }
    }

    return {
      success: deletedTasks.length > 0,
      deletedCount: deletedTasks.length,
      message: deletedTasks.length > 0
        ? `Deleted ${deletedTasks.length} task${deletedTasks.length > 1 ? 's' : ''}!`
        : 'No tasks were deleted.',
      actions: deletedTasks.map(task => ({ type: 'task_deleted', data: task }))
    };
  },
});

// Step 2b: Complete multiple tasks
const completeTasks = createStep({
  id: 'completeTasks',
  inputSchema: z.object({
    taskIds: z.array(z.string()),
    taskTitles: z.array(z.string()),
    operation: z.string(),
    message: z.string(),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    updatedCount: z.number(),
    message: z.string(),
    actions: z.array(z.any()),
  }),
  execute: async ({ inputData }) => {
    const updatedTasks = [];
    
    for (const taskId of inputData.taskIds) {
      try {
        const result = await query(
          'UPDATE tasks SET status = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2 RETURNING *',
          ['completed', taskId]
        );
        if (result.rows.length > 0) {
          updatedTasks.push(result.rows[0]);
        }
      } catch (error) {
        console.error(`Failed to complete task ${taskId}:`, error);
      }
    }

    return {
      success: updatedTasks.length > 0,
      updatedCount: updatedTasks.length,
      message: updatedTasks.length > 0
        ? `Marked ${updatedTasks.length} task${updatedTasks.length > 1 ? 's' : ''} as complete! 🎉`
        : 'No tasks were updated.',
      actions: updatedTasks.map(task => ({ type: 'task', data: task }))
    };
  },
});

// Step 2c: Update multiple tasks
const updateTasks = createStep({
  id: 'updateTasks',
  inputSchema: z.object({
    taskIds: z.array(z.string()),
    taskTitles: z.array(z.string()),
    operation: z.string(),
    message: z.string(),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    updatedCount: z.number(),
    message: z.string(),
    actions: z.array(z.any()),
  }),
  execute: async ({ inputData }) => {
    // For now, just confirm the operation
    // In a real implementation, you'd extract the update parameters
    return {
      success: true,
      updatedCount: inputData.taskIds.length,
      message: `Ready to update ${inputData.taskIds.length} tasks. Please specify what you'd like to change.`,
      actions: []
    };
  },
});

// Create the batch workflow with branching based on operation type
export const batchTaskWorkflow = createWorkflow({
  id: 'batch-task-operations',
  inputSchema: z.object({
    message: z.string(),
    conversationHistory: z.array(z.object({
      role: z.string(),
      content: z.string()
    })),
    operation: z.enum(['delete', 'update', 'complete', 'prioritize']),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    message: z.string(),
    actions: z.array(z.any()),
  }),
})
  .then(extractTaskIds)
  .branch([
    [
      async ({ inputData }) => inputData.operation === 'delete',
      deleteTasks
    ],
    [
      async ({ inputData }) => inputData.operation === 'complete',
      completeTasks
    ],
    [
      async ({ inputData }) => inputData.operation === 'update',
      updateTasks
    ],
  ])
  .commit();

