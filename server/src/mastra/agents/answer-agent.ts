import { Agent } from '@mastra/core';
import { llm } from '../llm';

/**
 * General Answer Agent
 * 
 * Provides quick, direct answers to general knowledge questions
 * without web search. Fast and efficient for definitions,
 * explanations, and general inquiries.
 */
export const answerAgent = new Agent({
  name: 'AnswerAgent',
  instructions: `Answer the users query`,
  
  model: llm,
  // No tools - just pure LLM capability
});

export function getAnswerAgent() {
  return answerAgent;
}
