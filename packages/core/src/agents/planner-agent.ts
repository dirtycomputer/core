/**
 * 研究计划 Agent
 * 基于研究目标生成实验计划
 */

import OpenAI from 'openai';
import Anthropic from '@anthropic-ai/sdk';
import { createLogger } from '../utils/logger';
import { getConfig } from '../utils/config';
import type { ExperimentConfig } from '../models/types';

const logger = createLogger('agent:planner');

export interface ResearchPlanInput {
  projectName: string;
  researchGoal: string;
  constraints?: {
    budget?: number;        // GPU 小时预算
    deadline?: string;      // 截止日期
    resources?: string[];   // 可用资源
    maxExperiments?: number; // 最大实验数
  };
  baselineInfo?: {
    model?: string;
    dataset?: string;
    metrics?: Record<string, number>;
  };
  context?: string;  // 额外上下文信息
}

export interface ExperimentPlan {
  name: string;
  description: string;
  hypothesis: string;
  type: 'baseline' | 'improvement' | 'ablation';
  config: Partial<ExperimentConfig>;
  variables: Record<string, unknown>;
  expectedImpact: string;
  priority: number;
}

export interface ResearchPlan {
  summary: string;
  methodology: string;
  experimentGroups: Array<{
    name: string;
    type: 'baseline' | 'improvement' | 'ablation';
    hypothesis: string;
    experiments: ExperimentPlan[];
  }>;
  riskAssessment: string[];
  successCriteria: string[];
  estimatedResources: {
    totalGpuHours: number;
    experimentsCount: number;
  };
}

const PLANNER_SYSTEM_PROMPT = `You are an expert AI research planner specializing in deep learning and LLM experiments. Your task is to generate comprehensive, well-structured research plans.

When creating a research plan, you should:
1. Break down the research goal into testable hypotheses
2. Design a baseline experiment first
3. Propose improvement experiments with clear variables
4. Include ablation studies to validate contributions
5. Consider resource constraints and prioritize experiments
6. Provide clear success criteria and risk assessment

Output your plan in the following JSON structure:
{
  "summary": "Brief summary of the research plan",
  "methodology": "Overall methodology description",
  "experimentGroups": [
    {
      "name": "Group name",
      "type": "baseline|improvement|ablation",
      "hypothesis": "What we're testing",
      "experiments": [
        {
          "name": "Experiment name",
          "description": "What this experiment does",
          "hypothesis": "Specific hypothesis",
          "type": "baseline|improvement|ablation",
          "config": {
            "model": { "name": "model_name" },
            "data": { "dataset": "dataset_name" },
            "training": { "epochs": 10, "batchSize": 32, "learningRate": 0.001 },
            "resources": { "gpuCount": 1, "gpuType": "A100" }
          },
          "variables": { "key": "value" },
          "expectedImpact": "Expected outcome",
          "priority": 1
        }
      ]
    }
  ],
  "riskAssessment": ["Risk 1", "Risk 2"],
  "successCriteria": ["Criterion 1", "Criterion 2"],
  "estimatedResources": {
    "totalGpuHours": 100,
    "experimentsCount": 10
  }
}`;

export class PlannerAgent {
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
   * 生成研究计划
   */
  async generatePlan(input: ResearchPlanInput): Promise<ResearchPlan> {
    const userPrompt = this.buildUserPrompt(input);

    logger.info({ projectName: input.projectName }, 'Generating research plan');

    try {
      const response = await this.callLLM(userPrompt);
      const plan = this.parseResponse(response);

      logger.info(
        {
          projectName: input.projectName,
          groupsCount: plan.experimentGroups.length,
          experimentsCount: plan.estimatedResources.experimentsCount,
        },
        'Research plan generated'
      );

      return plan;
    } catch (error) {
      logger.error({ error, projectName: input.projectName }, 'Failed to generate plan');
      throw error;
    }
  }

  /**
   * 生成消融实验计划
   */
  async generateAblationPlan(
    baseExperiment: ExperimentPlan,
    components: string[]
  ): Promise<ExperimentPlan[]> {
    const prompt = `Given the following base experiment configuration:
${JSON.stringify(baseExperiment, null, 2)}

Generate ablation experiments to test the contribution of each component: ${components.join(', ')}

For each component, create an experiment that removes or disables that component while keeping everything else the same.

Output as a JSON array of experiment plans.`;

    const response = await this.callLLM(prompt);

    try {
      return JSON.parse(response);
    } catch {
      logger.error('Failed to parse ablation plan response');
      return [];
    }
  }

  /**
   * 生成超参数搜索矩阵
   */
  async generateHyperparameterGrid(
    baseConfig: Partial<ExperimentConfig>,
    searchSpace: Record<string, unknown[]>
  ): Promise<ExperimentPlan[]> {
    const experiments: ExperimentPlan[] = [];

    // 生成所有组合
    const keys = Object.keys(searchSpace);
    const combinations = this.cartesianProduct(Object.values(searchSpace));

    for (let i = 0; i < combinations.length; i++) {
      const combo = combinations[i];
      const variables: Record<string, unknown> = {};

      keys.forEach((key, idx) => {
        variables[key] = combo[idx];
      });

      experiments.push({
        name: `hp_search_${i + 1}`,
        description: `Hyperparameter search: ${JSON.stringify(variables)}`,
        hypothesis: 'Testing hyperparameter combination',
        type: 'improvement',
        config: baseConfig,
        variables,
        expectedImpact: 'Find optimal hyperparameters',
        priority: i + 1,
      });
    }

    return experiments;
  }

  private buildUserPrompt(input: ResearchPlanInput): string {
    let prompt = `Please create a research plan for the following project:

Project Name: ${input.projectName}
Research Goal: ${input.researchGoal}
`;

    if (input.constraints) {
      prompt += `\nConstraints:`;
      if (input.constraints.budget) {
        prompt += `\n- GPU Hours Budget: ${input.constraints.budget}`;
      }
      if (input.constraints.deadline) {
        prompt += `\n- Deadline: ${input.constraints.deadline}`;
      }
      if (input.constraints.resources) {
        prompt += `\n- Available Resources: ${input.constraints.resources.join(', ')}`;
      }
      if (input.constraints.maxExperiments) {
        prompt += `\n- Max Experiments: ${input.constraints.maxExperiments}`;
      }
    }

    if (input.baselineInfo) {
      prompt += `\n\nBaseline Information:`;
      if (input.baselineInfo.model) {
        prompt += `\n- Model: ${input.baselineInfo.model}`;
      }
      if (input.baselineInfo.dataset) {
        prompt += `\n- Dataset: ${input.baselineInfo.dataset}`;
      }
      if (input.baselineInfo.metrics) {
        prompt += `\n- Current Metrics: ${JSON.stringify(input.baselineInfo.metrics)}`;
      }
    }

    if (input.context) {
      prompt += `\n\nAdditional Context:\n${input.context}`;
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
          { role: 'system', content: PLANNER_SYSTEM_PROMPT },
          { role: 'user', content: userPrompt },
        ],
        max_tokens: config.llm.maxTokens,
        temperature: config.llm.temperature,
        response_format: { type: 'json_object' },
      });

      return response.choices[0]?.message?.content || '';
    } else if (this.anthropic) {
      const response = await this.anthropic.beta.messages.create({
        model: config.llm.model.includes('claude') ? config.llm.model : 'claude-3-sonnet-20240229',
        max_tokens: config.llm.maxTokens,
        system: PLANNER_SYSTEM_PROMPT,
        messages: [{ role: 'user', content: userPrompt }],
      });

      const textBlock = response.content.find((block: { type: string }) => block.type === 'text');
      return textBlock?.type === 'text' ? (textBlock as { type: 'text'; text: string }).text : '';
    }

    throw new Error('No LLM provider configured');
  }

  private parseResponse(response: string): ResearchPlan {
    // 尝试提取 JSON
    let jsonStr = response;

    // 如果响应包含 markdown 代码块，提取其中的 JSON
    const jsonMatch = response.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch) {
      jsonStr = jsonMatch[1];
    }

    try {
      return JSON.parse(jsonStr);
    } catch (error) {
      logger.error({ response }, 'Failed to parse LLM response as JSON');
      throw new Error('Invalid plan format from LLM');
    }
  }

  private cartesianProduct<T>(arrays: T[][]): T[][] {
    return arrays.reduce<T[][]>(
      (acc, arr) => acc.flatMap((x) => arr.map((y) => [...x, y])),
      [[]]
    );
  }
}

// 单例导出
export const plannerAgent = new PlannerAgent();
