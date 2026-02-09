import { createLogger } from '../../utils/logger';
import { getConfig } from '../../utils/config';
import OpenAI from 'openai';

const logger = createLogger('service:deep-research');

export interface DeepResearchInput {
  query: string;
  maxResults?: number;
  topic?: 'general' | 'news' | 'finance';
}

export interface DeepResearchResult {
  mode: 'deepagents' | 'fallback';
  query: string;
  report: string;
  notes: string[];
}

const DEEP_RESEARCH_SYSTEM_PROMPT = `You are a senior research analyst.
Produce a structured report with:
1) Executive summary
2) Key findings (bulleted)
3) Supporting evidence with sources
4) Risks and unknowns
5) Concrete next actions
Always be explicit when information is uncertain.`;

export class DeepResearchService {
  async run(input: DeepResearchInput): Promise<DeepResearchResult> {
    const query = input.query?.trim();
    if (!query) {
      throw new Error('query is required');
    }

    const config = getConfig();
    const llmApiKey = config.llm.apiKey || process.env.OPENAI_API_KEY;
    const tavilyApiKey = config.llm.tavilyApiKey || process.env.TAVILY_API_KEY;

    if (!llmApiKey || !tavilyApiKey) {
      logger.warn('Missing LLM or Tavily key, falling back to lightweight research');
      return this.runFallback(input, [
        !llmApiKey ? 'Missing LLM API key' : '',
        !tavilyApiKey ? 'Missing TAVILY_API_KEY' : '',
      ].filter(Boolean));
    }

    try {
      const { createDeepAgent } = require('deepagents');
      const { ChatOpenAI } = require('@langchain/openai');
      const { TavilySearch } = require('@langchain/tavily');
      const { tool } = require('langchain');
      const { z } = require('zod');

      const internetSearch = tool(
        async ({
          query,
          maxResults = input.maxResults || 6,
          topic = input.topic || 'general',
          includeRawContent = false,
        }: {
          query: string;
          maxResults?: number;
          topic?: 'general' | 'news' | 'finance';
          includeRawContent?: boolean;
        }) => {
          const tavilySearch = new TavilySearch({
            maxResults,
            tavilyApiKey,
            includeRawContent,
            topic,
          });
          return await tavilySearch._call({ query });
        },
        {
          name: 'internet_search',
          description: 'Search internet content for research evidence',
          schema: z.object({
            query: z.string().describe('Search query'),
            maxResults: z.number().optional().default(input.maxResults || 6),
            topic: z.enum(['general', 'news', 'finance']).optional().default(input.topic || 'general'),
            includeRawContent: z.boolean().optional().default(false),
          }),
        }
      );

      const modelName = process.env.DEEP_RESEARCH_MODEL || config.llm.model || 'gpt-4o-mini';

      const agent = createDeepAgent({
        model: new ChatOpenAI({
          apiKey: llmApiKey,
          model: modelName,
          temperature: 0.1,
          configuration: config.llm.baseUrl ? { baseURL: config.llm.baseUrl } : undefined,
        }),
        tools: [internetSearch],
        systemPrompt: DEEP_RESEARCH_SYSTEM_PROMPT,
      });

      const result = await agent.invoke({
        messages: [{ role: 'user', content: query }],
      });

      const report = this.extractMessageText(result);

      if (!report.trim()) {
        throw new Error('empty report from deepagents');
      }

      return {
        mode: 'deepagents',
        query,
        report,
        notes: [
          `model=${modelName}`,
          `maxResults=${input.maxResults || 6}`,
          `topic=${input.topic || 'general'}`,
        ],
      };
    } catch (error) {
      logger.warn({ error }, 'Deepagents run failed, using fallback research');
      return this.runFallback(input, ['Deepagents execution failed']);
    }
  }

  private async runFallback(input: DeepResearchInput, notes: string[]): Promise<DeepResearchResult> {
    const query = input.query.trim();
    const config = getConfig();
    const llmApiKey = config.llm.apiKey || process.env.OPENAI_API_KEY;

    if (!llmApiKey) {
      return {
        mode: 'fallback',
        query,
        report: [
          '# Deep Research (Fallback)',
          '',
          'LLM key not configured. Generated a scaffold report only.',
          '',
          '## Research Question',
          query,
          '',
          '## Suggested Research Plan',
          '- Identify top 5 authoritative sources',
          '- Summarize each source and extract claims',
          '- Cross-check contradictory claims',
          '- Produce actionable recommendations',
          '',
          '## Risks',
          '- No real web retrieval performed in fallback mode',
        ].join('\n'),
        notes: [...notes, 'No LLM key available'],
      };
    }

    const openai = new OpenAI({
      apiKey: llmApiKey,
      baseURL: config.llm.baseUrl || undefined,
    });

    try {
      const completion = await openai.chat.completions.create({
        model: config.llm.model,
        temperature: 0.2,
        max_tokens: 1200,
        messages: [
          {
            role: 'system',
            content:
              'You are a research assistant. No live web access is available. Write a best-effort structured research memo and clearly mark assumptions.',
          },
          {
            role: 'user',
            content: `Research topic: ${query}\n\nPlease provide:\n1) Executive summary\n2) Key hypotheses\n3) Evidence needed\n4) Risks\n5) Next actions`,
          },
        ],
      });

      const content: unknown = completion?.choices?.[0]?.message?.content;
      const report = typeof content === 'string'
        ? content
        : Array.isArray(content)
          ? content
            .map((c: any) => (typeof c === 'string' ? c : c?.text || ''))
            .join('\n')
          : '';

      if (report.trim()) {
        return {
          mode: 'fallback',
          query,
          report,
          notes: [...notes, 'Used OpenAI summarization fallback without live web search'],
        };
      }
    } catch (error) {
      logger.warn({ error }, 'OpenAI fallback generation failed, returning scaffold report');
    }

    return {
      mode: 'fallback',
      query,
      report: [
        '# Deep Research (Fallback Scaffold)',
        '',
        'Live generation failed. Returning a deterministic scaffold report.',
        '',
        '## Research Question',
        query,
        '',
        '## Suggested Research Plan',
        '- Define 3-5 concrete sub-questions',
        '- Collect primary/authoritative sources for each sub-question',
        '- Mark every claim with confidence and source trace',
        '- Summarize risks, trade-offs, and deployment constraints',
        '',
        '## Next Actions',
        '- Retry with a verified OpenAI-compatible model and endpoint',
        '- Keep TAVILY_API_KEY configured for evidence retrieval',
      ].join('\n'),
      notes: [...notes, 'OpenAI fallback generation failed; returned scaffold report'],
    };
  }

  private extractMessageText(result: unknown): string {
    const data = result as any;

    if (typeof data === 'string') {
      return data;
    }

    if (data?.messages && Array.isArray(data.messages)) {
      const lastAssistant = [...data.messages]
        .reverse()
        .find((m) => m?.role === 'assistant' || m?._getType?.() === 'ai');

      if (typeof lastAssistant?.content === 'string') {
        return lastAssistant.content;
      }

      if (Array.isArray(lastAssistant?.content)) {
        return lastAssistant.content
          .map((c: any) => (typeof c === 'string' ? c : c?.text || ''))
          .join('\n');
      }
    }

    if (data?.content && typeof data.content === 'string') {
      return data.content;
    }

    return JSON.stringify(data, null, 2);
  }
}

export const deepResearchService = new DeepResearchService();
