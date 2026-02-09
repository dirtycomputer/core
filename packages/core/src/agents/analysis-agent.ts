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

  /**
   * 重置初始化状态，用于配置更新后重新初始化
   */
  resetInitialization() {
    this.initialized = false;
    this.openai = null;
    this.anthropic = null;
  }

  private ensureInitialized() {
    if (this.initialized) return;

    const config = getConfig();
    this.provider = config.llm.provider;

    if (this.provider === 'openai' && config.llm.apiKey) {
      this.openai = new OpenAI({
        apiKey: config.llm.apiKey,
        baseURL: config.llm.baseUrl || undefined,
      });
    } else if (this.provider === 'anthropic' && config.llm.apiKey) {
      this.anthropic = new Anthropic({
        apiKey: config.llm.apiKey,
        baseURL: config.llm.baseUrl || undefined,
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
      if (error instanceof Error && error.message === 'No LLM provider configured') {
        logger.warn({ projectName: input.projectName }, 'LLM not configured, using fallback analysis');
        return this.generateFallbackAnalysis(input);
      }
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
      });

      logger.debug({ response }, 'OpenAI response received');

      if (!response.choices || response.choices.length === 0) {
        logger.error({ response }, 'Invalid OpenAI response: no choices');
        throw new Error('Invalid response from LLM: no choices returned');
      }

      return response.choices[0]?.message?.content || '';
    } else if (this.provider === 'anthropic' && this.anthropic) {
      const response = await this.anthropic.completions.create({
        model: config.llm.model,
        max_tokens_to_sample: config.llm.maxTokens,
        prompt: `${Anthropic.HUMAN_PROMPT} ${ANALYSIS_SYSTEM_PROMPT}\n\n${userPrompt}${Anthropic.AI_PROMPT}`,
      });

      logger.debug({ response }, 'Anthropic response received');
      return response.completion || '';
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

  private generateFallbackAnalysis(input: AnalysisInput): ExperimentAnalysis {
    const baselineMetrics = input.baselineResult?.bestRun?.metrics || input.baselineResult?.averageMetrics || {};
    const baselineAccuracy = baselineMetrics.accuracy || 0;

    const performanceComparison = input.results.map((result) => {
      const metrics = result.bestRun?.metrics || result.averageMetrics || {};
      const currentAccuracy = metrics.accuracy || 0;
      return {
        experimentName: result.experiment.name,
        metrics: metrics as Record<string, number>,
        vsBaseline: baselineAccuracy
          ? { accuracy: Number((currentAccuracy - baselineAccuracy).toFixed(4)) }
          : undefined,
      };
    });

    const ranked = [...performanceComparison].sort(
      (a, b) => (b.metrics.accuracy || 0) - (a.metrics.accuracy || 0)
    );

    const best = ranked[0];
    const bestAcc = best?.metrics.accuracy || 0;
    const delta = baselineAccuracy ? bestAcc - baselineAccuracy : 0;

    return {
      summary: `Fallback analysis completed for ${input.projectName}; best candidate is ${best?.experimentName || 'N/A'}.`,
      keyFindings: [
        `Evaluated ${input.results.length} experiment variants under current setup.`,
        `Best observed accuracy: ${bestAcc.toFixed(4)}.`,
        baselineAccuracy
          ? `Compared with baseline, delta accuracy is ${delta >= 0 ? '+' : ''}${delta.toFixed(4)}.`
          : 'No explicit baseline metrics were provided.',
      ],
      performanceComparison,
      insights: [
        'CPU test run indicates workflow is operational, but final quality still needs larger-scale validation.',
        'Priority should be given to the highest-accuracy variant and one controlled ablation.',
      ],
      recommendations: [
        'Promote the best variant into a longer validation run.',
        'Run at least one ablation that removes the key changed component.',
      ],
      suggestedNextSteps: [
        {
          action: 'Execute extended run on best variant',
          rationale: 'Confirm stability over longer steps',
          priority: 'high',
        },
        {
          action: 'Run targeted ablation',
          rationale: 'Verify contribution of critical component',
          priority: 'high',
        },
        {
          action: 'Prepare final report',
          rationale: 'Document reproducible setup and results',
          priority: 'medium',
        },
      ],
      limitations: [
        'Fallback analysis is heuristic and does not replace a true LLM-based qualitative review.',
        'CPU-scale metrics may not extrapolate to GPU-scale training dynamics.',
      ],
    };
  }
}

// 单例导出
export const analysisAgent = new AnalysisAgent();
