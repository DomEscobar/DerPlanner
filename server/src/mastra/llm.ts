import { openai } from '@ai-sdk/openai';
import dotenv from 'dotenv';

dotenv.config();

// Disable Mastra telemetry
if (typeof globalThis !== 'undefined') {
  (globalThis as any).___MASTRA_TELEMETRY___ = true;
}

// Export configured LLM instance
export const llm = openai('gpt-4o-mini');
