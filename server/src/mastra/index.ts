import { Mastra } from '@mastra/core';
import dotenv from 'dotenv';

dotenv.config();

// Export llm from separate file to avoid circular dependencies
export { llm } from './llm';

// Import workflows
import { intelligentRoutingWorkflow } from './workflows/intelligent-routing-workflow';
import { batchTaskWorkflow } from './workflows/batch-task-workflow';
import { taskEventWorkflow, dailySummaryWorkflow } from './workflows/task-event-workflow';

// Initialize Mastra instance with workflows
export const mastra = new Mastra({
  workflows: {
    intelligentRoutingWorkflow,
    batchTaskWorkflow,
    taskEventWorkflow,
    dailySummaryWorkflow
  }
});

// Export configured agents, tools, and workflows
export * from './agents/index';
export * from './tools/index';
export * from './workflows/index';
