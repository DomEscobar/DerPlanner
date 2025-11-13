import OpenAI from 'openai';
import dotenv from 'dotenv';

dotenv.config();

/**
 * Research Utility Functions
 * 
 * Shared utilities for conducting deep research using OpenAI's API
 */

// Singleton OpenAI client for Deep Research
let openaiClient: OpenAI | null = null;

export function getOpenAIClient(): OpenAI {
  if (!openaiClient) {
    openaiClient = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
      timeout: 600000, // 10 minutes timeout for deep research
    });
  }
  return openaiClient;
}

/**
 * Interface for Deep Research request
 */
export interface DeepResearchRequest {
  query: string;
  useBackgroundMode?: boolean;
  maxToolCalls?: number;
  includeCodeInterpreter?: boolean;
  vectorStoreIds?: string[];
}

/**
 * Interface for Deep Research response
 */
export interface DeepResearchResponse {
  outputText: string;
  citations: Array<{
    url: string;
    title: string;
    startIndex: number;
    endIndex: number;
  }>;
  webSearchCalls: Array<{
    id: string;
    action: any;
  }>;
  status: 'completed' | 'pending' | 'failed';
  responseId?: string;
}

/**
 * Conducts deep research using OpenAI's Deep Research API
 * 
 * @param request - Research request configuration
 * @returns Deep research response with citations and web search calls
 */
export async function conductDeepResearch(
  request: DeepResearchRequest
): Promise<DeepResearchResponse> {
  const client = getOpenAIClient();
  
  // Build tools array - web search is required for deep research
  const tools: any[] = [
    { type: 'web_search_preview' }
  ];
  
  // Add code interpreter if requested
  if (request.includeCodeInterpreter) {
    tools.push({
      type: 'code_interpreter',
      container: { type: 'auto' }
    });
  }
  
  // Add file search if vector stores are provided
  if (request.vectorStoreIds && request.vectorStoreIds.length > 0) {
    tools.push({
      type: 'file_search',
      vector_store_ids: request.vectorStoreIds.slice(0, 2) // Max 2 vector stores
    });
  }

  try {
    // Use o4-mini-deep-research for faster, cost-effective research
    // Switch to o3-deep-research for more comprehensive analysis
    const response = await client.responses.create({
      model: 'o4-mini-deep-research',
      input: request.query,
      background: request.useBackgroundMode || false,
      tools: tools as any,
      max_tool_calls: request.maxToolCalls,
    } as any);

    // Extract citations from annotations
    const citations: DeepResearchResponse['citations'] = [];
    const webSearchCalls: DeepResearchResponse['webSearchCalls'] = [];
    
    // Parse output array to extract web search calls and citations
    if (response.output && Array.isArray(response.output)) {
      for (const item of response.output) {
        // Extract web search calls
        if (item.type === 'web_search_call') {
          webSearchCalls.push({
            id: item.id,
            action: (item as any).action
          });
        }
        
        // Extract citations from message content
        if (item.type === 'message' && item.content) {
          for (const content of item.content) {
            if (content.type === 'output_text' && content.annotations) {
              // Filter only URL citations
              const urlCitations = content.annotations.filter(
                (a: any) => a.type === 'url_citation'
              );
              citations.push(...urlCitations as any);
            }
          }
        }
      }
    }

    return {
      outputText: response.output_text || '',
      citations,
      webSearchCalls,
      status: 'completed',
      responseId: response.id
    };
    
  } catch (error) {
    console.error('❌ Deep research error:', error);
    throw new Error(
      `Deep research failed: ${error instanceof Error ? error.message : 'Unknown error'}`
    );
  }
}

/**
 * Interface for Web Search request
 */
export interface WebSearchRequest {
  query: string;
  model?: 'gpt-5' | 'gpt-4o' | 'gpt-4o-mini' | 'o4-mini';
  reasoningEffort?: 'low' | 'medium' | 'high';
  allowedDomains?: string[];
  userLocation?: {
    country?: string;
    city?: string;
    region?: string;
    timezone?: string;
  };
  externalWebAccess?: boolean;
  includeSources?: boolean;
}

/**
 * Interface for Web Search response
 */
export interface WebSearchResponse {
  outputText: string;
  citations: Array<{
    url: string;
    title: string;
    startIndex: number;
    endIndex: number;
  }>;
  sources?: string[];
  webSearchCalls: Array<{
    id: string;
    status: string;
    action?: any;
  }>;
  status: 'completed' | 'failed';
  responseId?: string;
}

/**
 * Conducts web search using OpenAI's Web Search tool
 * 
 * This is faster than deep research and suitable for most queries.
 * Supports both non-reasoning (fast) and agentic search with reasoning models.
 * 
 * @param request - Web search request configuration
 * @returns Web search response with citations and sources
 */
export async function conductWebSearch(
  request: WebSearchRequest
): Promise<WebSearchResponse> {
  const client = getOpenAIClient();
  
  console.log(`🔍 [conductWebSearch] Starting with model: ${request.model || 'gpt-4o'}`);
  console.log(`🔍 [conductWebSearch] Query: "${request.query}"`);
  const startTime = Date.now();
  
  const webSearchTool: any = {
    type: 'web_search'
  };
  
  if (request.allowedDomains && request.allowedDomains.length > 0) {
    webSearchTool.filters = {
      allowed_domains: request.allowedDomains.slice(0, 20)
    };
  }
  
  if (request.userLocation) {
    webSearchTool.user_location = {
      type: 'approximate',
      ...request.userLocation
    };
  }
  
  if (request.externalWebAccess !== undefined) {
    webSearchTool.external_web_access = request.externalWebAccess;
  }

  const apiRequest: any = {
    model: request.model || 'gpt-4o',
    tools: [webSearchTool],
    tool_choice: 'auto',
    input: request.query
  };
  
  if (request.reasoningEffort && (request.model === 'gpt-5' || request.model === 'o4-mini')) {
    apiRequest.reasoning = { effort: request.reasoningEffort };
    console.log(`🔍 [conductWebSearch] Reasoning effort: ${request.reasoningEffort}`);
  }
  
  if (request.includeSources) {
    apiRequest.include = ['web_search_call.action.sources'];
    console.log(`🔍 [conductWebSearch] Sources inclusion enabled`);
  }

  try {
    console.log(`📡 [conductWebSearch] Sending request to OpenAI API...`);
    const apiStartTime = Date.now();
    const response = await client.responses.create(apiRequest);
    const apiDuration = Date.now() - apiStartTime;
    console.log(`⏱️ [conductWebSearch] API response received in ${apiDuration}ms`);

    const citations: WebSearchResponse['citations'] = [];
    const webSearchCalls: WebSearchResponse['webSearchCalls'] = [];
    const sources: string[] = [];
    
    if (response.output && Array.isArray(response.output)) {
      
      for (const item of response.output) {
        if (item.type === 'web_search_call') {
          webSearchCalls.push({
            id: item.id,
            status: item.status || 'completed',
            action: (item as any).action
          });
          
          if (request.includeSources && (item as any).action?.sources) {
            sources.push(...(item as any).action.sources);
          }
        }
        
        if (item.type === 'message' && item.content) {
          for (const content of item.content) {
            if (content.type === 'output_text' && content.annotations) {
              const urlCitations = content.annotations.filter(
                (a: any) => a.type === 'url_citation'
              );
              citations.push(...urlCitations as any);
            }
          }
        }
      }
    }

    return {
      outputText: response.output_text || '',
      citations,
      sources: request.includeSources ? sources : undefined,
      webSearchCalls,
      status: 'completed',
      responseId: response.id
    };
    
  } catch (error) {
    throw new Error(
      `Web search failed: ${error instanceof Error ? error.message : 'Unknown error'}`
    );
  }
}

/**
 * Enriches a user prompt for better deep research results
 * Uses a faster model (gpt-4.1 or gpt-4o) to expand and clarify the prompt
 */
export async function enrichResearchPrompt(userQuery: string): Promise<string> {
  const client = getOpenAIClient();
  
  const instructions = `You will be given a research task by a user. Your job is to produce a set of
instructions for a researcher that will complete the task. Do NOT complete the
task yourself, just provide instructions on how to complete it.

GUIDELINES:
1. **Maximize Specificity and Detail**
   - Include all known user preferences and explicitly list key attributes or dimensions to consider.
   - It is of utmost importance that all details from the user are included in the instructions.

2. **Fill in Unstated But Necessary Dimensions as Open-Ended**
   - If certain attributes are essential for a meaningful output but the user has not provided them, 
     explicitly state that they are open-ended or default to no specific constraint.

3. **Avoid Unwarranted Assumptions**
   - If the user has not provided a particular detail, do not invent one.
   - Instead, state the lack of specification and guide the researcher to treat it as flexible.

4. **Use the First Person**
   - Phrase the request from the perspective of the user.

5. **Tables and Formatting**
   - If including a table will help organize or enhance the information, explicitly request it.
   - Request proper headers and formatting for structured content.

6. **Sources**
   - Request prioritization of reliable, up-to-date sources.
   - For research queries, prefer primary sources and peer-reviewed publications.
   - Request inline citations and source metadata.`;

  try {
    const response = await client.responses.create({
      model: 'gpt-4o',
      input: userQuery,
      instructions,
    } as any);

    return response.output_text || userQuery;
  } catch (error) {
    console.warn('⚠️ Prompt enrichment failed, using original query:', error);
    return userQuery;
  }
}

