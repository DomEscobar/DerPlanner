import { createTool } from '@mastra/core';
import { z } from 'zod';
import { conductDeepResearch, enrichResearchPrompt } from './research-utils';

/**
 * Web Research Tool
 * 
 * Conducts comprehensive web research using OpenAI's Deep Research API.
 * This tool performs multi-step research with web search capabilities.
 */
export const webResearchTool = createTool({
  id: 'web-research',
  description: `Conducts comprehensive web research on a given topic using multi-step analysis and web search.
  
  Use this tool when the user asks for:
  - Research on a specific topic
  - Market analysis or competitive intelligence
  - Background information with citations
  - Detailed analysis of trends or patterns
  - Information that requires synthesizing multiple sources
  
  This tool will return a detailed report with inline citations and source URLs.`,
  
  inputSchema: z.object({
    query: z.string().describe('The research query or topic to investigate'),
    includeCodeInterpreter: z.boolean().optional().describe('Whether to enable code interpreter for data analysis'),
    maxToolCalls: z.number().optional().describe('Maximum number of tool calls (web searches) to make. Controls cost and latency.')
  }),
  
  outputSchema: z.object({
    report: z.string().describe('The research report with findings and citations'),
    citations: z.array(z.object({
      url: z.string(),
      title: z.string(),
      startIndex: z.number(),
      endIndex: z.number()
    })).describe('List of citations with URLs and positions in the report'),
    searchCount: z.number().describe('Number of web searches performed'),
    success: z.boolean()
  }),
  
  execute: async ({ context }) => {
    const { query, includeCodeInterpreter, maxToolCalls } = context;
    try {
      console.log(`🔍 Conducting web research: "${query}"`);
      
      // Use a simplified query without enrichment for speed
      console.log(`📝 Using query: "${query}"`);
      
      // Conduct deep research with very limited tool calls for speed
      const result = await conductDeepResearch({
        query: query,
        useBackgroundMode: false, // Streaming mode for real-time updates
        includeCodeInterpreter: includeCodeInterpreter || false,
        maxToolCalls: maxToolCalls || 3 // Default to 3 searches for speed
      });
      
      console.log(`✅ Research completed with ${result.citations.length} citations`);
      
      return {
        report: result.outputText,
        citations: result.citations,
        searchCount: result.webSearchCalls.length,
        success: true
      };
      
    } catch (error) {
      console.error('❌ Web research error:', error);
      return {
        report: `Research failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        citations: [],
        searchCount: 0,
        success: false
      };
    }
  }
});

/**
 * Quick Research Tool
 * 
 * Performs faster, lighter research without the full deep research process.
 * Good for quick fact-checking or basic information gathering.
 */
export const quickResearchTool = createTool({
  id: 'quick-research',
  description: `Performs quick research on a topic using a single web search and analysis.
  
  Use this tool when the user needs:
  - Quick facts or definitions
  - Recent news or updates on a topic
  - Basic information that doesn't require deep analysis
  - Faster responses without comprehensive research
  
  This tool is faster but less comprehensive than full web research.`,
  
  inputSchema: z.object({
    query: z.string().describe('The question or topic to research')
  }),
  
  outputSchema: z.object({
    answer: z.string().describe('The research answer'),
    sources: z.array(z.string()).describe('Source URLs referenced'),
    success: z.boolean()
  }),
  
  execute: async ({ context }) => {
    const { query } = context;
    try {
      console.log(`⚡ Quick research: "${query}"`);
      
      // Use deep research with very limited tool calls for faster results
      const result = await conductDeepResearch({
        query: query,
        useBackgroundMode: false,
        maxToolCalls: 2 // Limit to 2 searches for speed
      });
      
      const sources = result.citations.map(c => c.url);
      
      console.log(`✅ Quick research completed with ${sources.length} sources`);
      
      return {
        answer: result.outputText,
        sources: Array.from(new Set(sources)), // Remove duplicates
        success: true
      };
      
    } catch (error) {
      console.error('❌ Quick research error:', error);
      return {
        answer: `Research failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        sources: [],
        success: false
      };
    }
  }
});

/**
 * Export all research tools
 */
export const researchTools = {
  webResearchTool,
  quickResearchTool
};

