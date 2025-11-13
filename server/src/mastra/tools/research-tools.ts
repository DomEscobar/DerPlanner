import { createTool } from '@mastra/core';
import { z } from 'zod';
import { conductWebSearch, conductDeepResearch } from './research-utils';

/**
 * Web Research Tool
 * 
 * Conducts web research using OpenAI's Web Search tool.
 * This is faster than deep research and uses the standard web_search tool.
 */
export const webResearchTool = createTool({
  id: 'web-research',
  description: `Conducts web research on a given topic using AI-powered web search with real-time information.
  
  Use this tool when the user asks for:
  - Research on a specific topic
  - Current information and latest updates
  - Background information with citations
  - Analysis based on multiple web sources
  - Information that requires up-to-date data
  
  This tool returns a detailed answer with inline citations and source URLs.`,
  
  inputSchema: z.object({
    query: z.string().describe('The research query or topic to investigate'),
    model: z.enum(['gpt-5', 'gpt-4o', 'gpt-4o-mini', 'o4-mini']).optional().describe('Model to use for research'),
    reasoningEffort: z.enum(['low', 'medium', 'high']).optional().describe('Reasoning effort level for gpt-5 or o4-mini'),
    allowedDomains: z.array(z.string()).optional().describe('Limit search to specific domains'),
    includeSources: z.boolean().optional().describe('Include complete list of sources consulted'),
  }),
  
  outputSchema: z.object({
    report: z.string().describe('The research report with findings and citations'),
    citations: z.array(z.object({
      url: z.string(),
      title: z.string(),
      startIndex: z.number(),
      endIndex: z.number()
    })).describe('List of citations with URLs and positions in the report'),
    sources: z.array(z.string()).optional().describe('Complete list of URLs consulted'),
    searchCount: z.number().describe('Number of web searches performed'),
    success: z.boolean()
  }),
  
  execute: async ({ context }) => {
    const { query, model, reasoningEffort, allowedDomains, includeSources } = context;
    try {
      console.log(`🔍 Conducting web research: "${query}"`);
      
      const result = await conductWebSearch({
        query: query,
        model: model || 'gpt-4o',
        reasoningEffort: reasoningEffort,
        allowedDomains: allowedDomains,
        includeSources: includeSources || false,
        externalWebAccess: true
      });
      
      console.log(`✅ Research completed with ${result.citations.length} citations`);
      
      return {
        report: result.outputText,
        citations: result.citations,
        sources: result.sources,
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
 * Performs faster, lighter research using the standard web search.
 * Uses a faster model for quick responses.
 */
export const quickResearchTool = createTool({
  id: 'quick-research',
  description: `Performs quick research on a topic using fast web search.
  
  Use this tool when the user needs:
  - Quick facts or definitions
  - Recent news or updates on a topic
  - Basic information that doesn't require deep analysis
  - Faster responses without comprehensive research
  
  This tool is optimized for speed using gpt-4o-mini.`,
  
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
      
      const result = await conductWebSearch({
        query: query,
        model: 'gpt-4o-mini',
        externalWebAccess: true
      });
      
      const sources = result.citations.map(c => c.url);
      
      console.log(`✅ Quick research completed with ${sources.length} sources`);
      
      return {
        answer: result.outputText,
        sources: Array.from(new Set(sources)),
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
 * Deep Research Tool
 * 
 * Performs comprehensive, in-depth research using OpenAI's Deep Research API.
 * This conducts multi-step research with extensive web searches over several minutes.
 */
export const deepResearchTool = createTool({
  id: 'deep-research',
  description: `Conducts comprehensive deep research using specialized reasoning models.
  
  Use this tool when the user needs:
  - In-depth analysis requiring hundreds of sources
  - Complex research requiring multi-step investigation
  - Comprehensive reports with extensive citations
  - Thorough market research or competitive analysis
  
  This tool is slower but more comprehensive than standard web research.
  Best for tasks that require extensive investigation.`,
  
  inputSchema: z.object({
    query: z.string().describe('The research query or topic to investigate'),
    includeCodeInterpreter: z.boolean().optional().describe('Whether to enable code interpreter for data analysis'),
    maxToolCalls: z.number().optional().describe('Maximum number of web searches (default: 10)'),
  }),
  
  outputSchema: z.object({
    report: z.string().describe('The comprehensive research report'),
    citations: z.array(z.object({
      url: z.string(),
      title: z.string(),
      startIndex: z.number(),
      endIndex: z.number()
    })).describe('List of citations with URLs and positions'),
    searchCount: z.number().describe('Number of web searches performed'),
    success: z.boolean()
  }),
  
  execute: async ({ context }) => {
    const { query, includeCodeInterpreter, maxToolCalls } = context;
    try {
      console.log(`🔬 Conducting deep research: "${query}"`);
      
      const result = await conductDeepResearch({
        query: query,
        useBackgroundMode: false,
        includeCodeInterpreter: includeCodeInterpreter || false,
        maxToolCalls: maxToolCalls || 10
      });
      
      console.log(`✅ Deep research completed with ${result.citations.length} citations`);
      
      return {
        report: result.outputText,
        citations: result.citations,
        searchCount: result.webSearchCalls.length,
        success: true
      };
      
    } catch (error) {
      console.error('❌ Deep research error:', error);
      return {
        report: `Deep research failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        citations: [],
        searchCount: 0,
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
  quickResearchTool,
  deepResearchTool
};

