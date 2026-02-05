/**
 * 分析 Agent
 * 分析实验结果，生成洞察和建议
 */

import OpenAI from 'openai';
import Anthropic from '@anthropic-ai/sdk';
import { createLogger } from '../utils/logger';
import { getConfig } from '../utils/config';
import type { Run, RunMetrics, Experiment } from '../models/types';

const logger = createLogger('agent:analysis');

export interface ExperimentResult {
  experiment: Experiment;
  runs: Run[];
  bestRun?: Run;
  averageMetrics?: RunMetrics;
}

export interface AnalysisInput {
  projectName: string;
  researchGoal: string;
  results: ExperimentResult[];
  baselineResult?: ExperimentResult;
}

export interface ExperimentAnalysis {
  summary: string;
  keyFindings: string[];
  performanceComparison: {
    experimentName: string;
    metrics: Record<string, number>;
    vsBaseline?: Record<string, number>;  // 相对于 baseline 的变化
  }[];
  insights: string[];
  recommendations: string[];
  suggestedNextSteps: Array<{
    action: string;
    rationale: string;
    priority: 'high' | 'medium' | 'low';
  }>;
  limitations: string[];
}

const ANALYSIS_SYSTEM_PROMPT = `You are an expert AI research analyst specializing in deep learning experiments. Your task is to analyze experiment results and provide actionable insights.

When analyzing results, you should:
1. Compare performance across experiments objectively
2. Identify statistically significant improvements
3. Explain why certain approaches worked or didn't work
4. Suggest concrete next steps based on findings
5. Acknowledge limitations and potential confounding factors

Output your analysis in the following JSON structure:
{
  "summary": "Executive summary of findings",
  "keyFindings": ["Finding 1", "Finding 2"],
  "performanceComparison": [
    {
      "experimentName": "name",
      "metrics": {"accuracy": 0.95, "loss": 0.1},
      "vsBaseline": {"accuracy": 0.05, "loss": -0.02}
    }
  ],
  "insights": ["Insight 1", "Insight 2"],
  "recommendations": ["Recommendation 1", "Recommendation 2"],
  "suggestedNextSteps": [
    {
      "action": "What to do",
      "rationale": "Why",
      "priority": "high|medium|low"
    }
  ],
  "limitations": ["Limitation 1", "Limitation 2"]
}`;

export class AnalysisAgent {
  private openai: OpenAI | null = null;
  private anthropic: Anthropic | null = null;
  private provider: 'openai' | 'anthropic' = 'openai';
  private initialized = false;

  private ensureInitialized() {
    if (this.initialized) return;

    const config = getConfig();
    this.provider = config.llm.provider;

    if (this.provider === 'openai' && config.llm.apiKey) {
      this.openai = new OpenAI({
        apiKey: config.llm.apiKey,
      });
    } else if (this.provider === 'anthropic' && config.llm.apiKey) {
      this.anthropic = new Anthropic({
        apiKey: config.llm.apiKey,
      });
    }

    this.initialized = true;
  }

  /**
   * 分析实验结果
   */
  async analyzeResults(input: AnalysisInput): Promise<ExperimentAnalysis> {
    const userPrompt = this.buildAnalysisPrompt(input);

    logger.info({ projectName: input.projectName, resultsCount: input.results.length }, 'Analyzing experiment results');

    try {
      const response = await this.callLLM(userPrompt);
      const analysis = this.parseResponse(response);

      logger.info(
        {
          projectName: input.projectName,
          findingsCount: analysis.keyFindings.length,
          recommendationsCount: analysis.recommendations.length,
        },
        'Analysis completed'
      );

      return analysis;
    } catch (error) {
      logger.error({ error, projectName: input.projectName }, 'Failed to analyze results');
      throw error;
    }
  }

  /**
   * 生成失败原因分析
   */
  async analyzeFailure(run: Run, logs: string[]): Promise<{
    likelyCause: string;
    suggestions: string[];
    shouldRetry: boolean;
  }> {
    const prompt = `Analyze the following failed experiment run:

Status: ${run.status}
Error Message: ${run.errorMessage || 'None'}
Metrics at failure: ${JSON.stringify(run.metrics)}

Recent logs:
${logs.slice(-50).join('\n')}

Provide analysis in JSON format:
{
  "likelyCause": "Most likely cause of failure",
  "suggestions": ["Suggestion 1", "Suggestion 2"],
  "shouldRetry": true/false
}`;

    const response = await this.callLLM(prompt);

    try {
      return JSON.parse(response);
    } catch {
      return {
        likelyCause: 'Unable to determine',
        suggestions: ['Check logs manually', 'Verify configuration'],
        shouldRetry: false,
      };
    }
  }

  /**
   * 生成消融分析
   */
  async analyzeAblation(
    fullModelResult: ExperimentResult,
    ablationResults: ExperimentResult[]
  ): Promise<{
    componentContributions: Array<{
      component: string;
      contribution: number;
      significance: 'high' | 'medium' | 'low';
    }>;
    interactions: string[];
    recommendations: string[];
  }> {
    const prompt = `Analyze the following ablation study results:

Full Model Performance:
${JSON.stringify(fullModelResult.bestRun?.metrics || fullModelResult.averageMetrics)}

Ablation Results:
${ablationResults.map((r) => `- ${r.experiment.name}: ${JSON.stringify(r.bestRun?.metrics || r.averageMetrics)}`).join('\n')}

Provide ablation analysis in JSON format:
{
  "componentContributions": [
    {"component": "name", "contribution": 0.05, "significance": "high|medium|low"}
  ],
  "interactions": ["Interaction finding 1"],
  "recommendations": ["Recommendation 1"]
}`;

    const response = await this.callLLM(prompt);

    try {
      return JSON.parse(response);
    } catch {
      return {
        componentContributions: [],
        interactions: [],
        recommendations: ['Manual analysis recommended'],
      };
    }
  }

  private buildAnalysisPrompt(input: AnalysisInput): string {
    let prompt = `Please analyze the following experiment results:

Project: ${input.projectName}
Research Goal: ${input.researchGoal}

`;

    if (input.baselineResult) {
      prompt += `Baseline Experiment:
- Name: ${input.baselineResult.experiment.name}
- Best Metrics: ${JSON.stringify(input.baselineResult.bestRun?.metrics || input.baselineResult.averageMetrics)}
- Runs: ${input.baselineResult.runs.length}

`;
    }

    prompt += `Experiment Results:\n`;

    for (const result of input.results) {
      prompt += `
- ${result.experiment.name}
  - Type: ${result.experiment.config.model?.name || 'N/A'}
  - Variables: ${JSON.stringify(result.experiment.variables)}
  - Best Metrics: ${JSON.stringify(result.bestRun?.metrics || result.averageMetrics)}
  - Runs: ${result.runs.length} (${result.runs.filter((r) => r.status === 'completed').length} completed)
`;
    }

    return prompt;
  }

  private async callLLM(userPrompt: string): Promise<string> {
    this.ensureInitialized();
    const config = getConfig();

    if (this.provider === 'openai' && this.openai) {
      const response = await this.openai.chat.completions.create({
        model: config.llm.model,
        messages: [
          { role: 'system', content: ANALYSIS_SYSTEM_PROMPT },
          { role: 'user', content: userPrompt },
        ],
        max_tokens: config.llm.maxTokens,
        temperature: 0.3,  // 分析任务使用较低温度
        response_format: { type: 'json_object' },
      });

      return response.choices[0]?.message?.content || '';
    } else if (this.anthropic) {
      const response = await this.anthropic.beta.messages.create({
        model: config.llm.model.includes('claude') ? config.llm.model : 'claude-3-sonnet-20240229',
        max_tokens: config.llm.maxTokens,
        system: ANALYSIS_SYSTEM_PROMPT,
        messages: [{ role: 'user', content: userPrompt }],
      });

      const textBlock = response.content.find((block: { type: string }) => block.type === 'text');
      return textBlock?.type === 'text' ? (textBlock as { type: 'text'; text: string }).text : '';
    }

    throw new Error('No LLM provider configured');
  }

  private parseResponse(response: string): ExperimentAnalysis {
    let jsonStr = response;

    const jsonMatch = response.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch) {
      jsonStr = jsonMatch[1];
    }

    try {
      return JSON.parse(jsonStr);
    } catch (error) {
      logger.error({ response }, 'Failed to parse analysis response');
      throw new Error('Invalid analysis format from LLM');
    }
  }
}

// 单例导出
export const analysisAgent = new AnalysisAgent();
