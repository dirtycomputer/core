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
      if (error instanceof Error && error.message === 'No LLM provider configured') {
        logger.warn({ projectName: input.projectName }, 'LLM not configured, using fallback planner');
        return this.generateFallbackPlan(input);
      }
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

    try {
      const response = await this.callLLM(prompt);
      return JSON.parse(response);
    } catch (error) {
      if (error instanceof Error && error.message === 'No LLM provider configured') {
        return components.map((component, index) => ({
          name: `ablation_${component}`,
          description: `Disable component '${component}' to quantify contribution`,
          hypothesis: `${component} contributes to final metric and removing it reduces quality`,
          type: 'ablation',
          config: baseExperiment.config,
          variables: { ...baseExperiment.variables, ablationComponent: component, enabled: false },
          expectedImpact: 'Performance drop indicates positive contribution',
          priority: index + 1,
        }));
      }
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
        prompt: `${Anthropic.HUMAN_PROMPT} ${PLANNER_SYSTEM_PROMPT}\n\n${userPrompt}${Anthropic.AI_PROMPT}`,
      });

      logger.debug({ response }, 'Anthropic response received');
      return response.completion || '';
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

  private generateFallbackPlan(input: ResearchPlanInput): ResearchPlan {
    const maxExperiments = Math.max(3, Math.min(input.constraints?.maxExperiments || 6, 12));
    const baseModel = input.baselineInfo?.model || 'lightweight-transformer';
    const baseDataset = input.baselineInfo?.dataset || 'custom-dataset';
    const cpuCount = 4;

    const baselineExperiment: ExperimentPlan = {
      name: 'baseline_cpu',
      description: 'CPU baseline run for reproducible reference.',
      hypothesis: 'Baseline can establish reference metrics for later improvements.',
      type: 'baseline',
      config: {
        model: { name: baseModel },
        data: { dataset: baseDataset },
        training: { epochs: 5, batchSize: 8, learningRate: 0.001, optimizer: 'adamw' },
        resources: { cpuCount, gpuCount: 0, memoryGb: 8, timeLimit: '00:20:00' },
      },
      variables: { precision: 'fp32', seed: 42 },
      expectedImpact: 'Stable baseline for comparing future changes',
      priority: 1,
    };

    const improvementExperiment: ExperimentPlan = {
      name: 'improvement_lr_scheduler',
      description: 'Enable learning rate scheduler and warmup on CPU run.',
      hypothesis: 'Scheduler can improve convergence stability.',
      type: 'improvement',
      config: {
        model: { name: baseModel },
        data: { dataset: baseDataset },
        training: { epochs: 6, batchSize: 8, learningRate: 0.0008, scheduler: 'cosine', warmupSteps: 50 },
        resources: { cpuCount, gpuCount: 0, memoryGb: 8, timeLimit: '00:25:00' },
      },
      variables: { scheduler: 'cosine', warmupSteps: 50 },
      expectedImpact: 'Higher final accuracy and smoother loss curve',
      priority: 2,
    };

    const ablationExperiment: ExperimentPlan = {
      name: 'ablation_no_scheduler',
      description: 'Disable scheduler while keeping other settings aligned.',
      hypothesis: 'Removing scheduler reduces final performance.',
      type: 'ablation',
      config: {
        model: { name: baseModel },
        data: { dataset: baseDataset },
        training: { epochs: 6, batchSize: 8, learningRate: 0.0008 },
        resources: { cpuCount, gpuCount: 0, memoryGb: 8, timeLimit: '00:25:00' },
      },
      variables: { scheduler: 'none' },
      expectedImpact: 'Observe measurable degradation to confirm contribution',
      priority: 3,
    };

    const candidates = [baselineExperiment, improvementExperiment, ablationExperiment];
    const selected = candidates.slice(0, maxExperiments);

    return {
      summary: `CPU-first fallback plan for ${input.projectName}. Start from baseline, then improvement, then ablation verification.`,
      methodology: 'Iterative experimentation: baseline -> targeted improvement -> ablation validation.',
      experimentGroups: [
        {
          name: 'Baseline Group',
          type: 'baseline' as const,
          hypothesis: baselineExperiment.hypothesis,
          experiments: [selected[0]],
        },
        {
          name: 'Improvement Group',
          type: 'improvement' as const,
          hypothesis: improvementExperiment.hypothesis,
          experiments: selected[1] ? [selected[1]] : [],
        },
        {
          name: 'Ablation Group',
          type: 'ablation' as const,
          hypothesis: ablationExperiment.hypothesis,
          experiments: selected[2] ? [selected[2]] : [],
        },
      ].filter((group) => group.experiments.length > 0),
      riskAssessment: [
        'CPU runs are slower than GPU and may need reduced epoch count.',
        'Small batch size can increase metric variance.',
      ],
      successCriteria: [
        'Improvement group final accuracy >= baseline + 1%.',
        'Ablation removes at least part of the observed gain.',
      ],
      estimatedResources: {
        totalGpuHours: 0,
        experimentsCount: selected.length,
      },
    };
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
