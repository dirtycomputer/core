import OpenAI from 'openai';
import { desc, eq } from 'drizzle-orm';
import { getDatabase } from '../../db/connection';
import { researchReviews } from '../../models/schema';
import { experimentGroupService, experimentService, runService } from '../experiment';
import { projectService } from '../project';
import { getConfig } from '../../utils/config';
import { generateId } from '../../utils/id';
import { createLogger } from '../../utils/logger';
import type {
  PaperReview,
  ResearchReviewRecord,
  Retrospective,
  Run,
} from '../../models/types';

const logger = createLogger('service:review');

export interface GenerateReviewInput {
  projectId: string;
  workflowId?: string;
  reportId?: string;
  title?: string;
}

export class ReviewService {
  private db = getDatabase();

  async generate(input: GenerateReviewInput): Promise<ResearchReviewRecord> {
    const project = await projectService.getById(input.projectId);
    if (!project) {
      throw new Error('Project not found');
    }

    const experimentGroups = await experimentGroupService.list({ projectId: input.projectId });

    const runs: Run[] = [];
    const experimentNames: string[] = [];

    for (const group of experimentGroups.data) {
      const experiments = await experimentService.list({ groupId: group.id });
      for (const experiment of experiments.data) {
        experimentNames.push(experiment.name);
        const runList = await runService.list({ experimentId: experiment.id });
        runs.push(...runList.data);
      }
    }

    const completedRuns = runs.filter((r) => r.status === 'completed');
    const failedRuns = runs.filter((r) => r.status === 'failed' || r.status === 'timeout');

    const avgAccuracy = this.averageMetric(completedRuns, 'accuracy');
    const avgLoss = this.averageMetric(completedRuns, 'loss');

    const fallback = this.generateFallbackReview({
      projectName: project.name,
      researchGoal: project.researchGoal,
      totalRuns: runs.length,
      completedRuns: completedRuns.length,
      failedRuns: failedRuns.length,
      avgAccuracy,
      avgLoss,
      experimentNames,
    });

    const llm = await this.tryGenerateLLMReview({
      projectName: project.name,
      researchGoal: project.researchGoal,
      totalRuns: runs.length,
      completedRuns: completedRuns.length,
      failedRuns: failedRuns.length,
      avgAccuracy,
      avgLoss,
      experimentNames,
      fallback,
    });

    const id = generateId();
    const now = new Date();
    const title = input.title || `${project.name} - Paper Review & Retrospective`;

    const [row] = await this.db
      .insert(researchReviews)
      .values({
        id,
        projectId: input.projectId,
        workflowId: input.workflowId || null,
        reportId: input.reportId || null,
        title,
        review: llm.review,
        retrospective: llm.retrospective,
        createdAt: now,
        updatedAt: now,
      })
      .returning();

    logger.info({ reviewId: id, projectId: input.projectId }, 'Research review generated');

    return this.mapReview(row);
  }

  async getById(id: string): Promise<ResearchReviewRecord | null> {
    const [row] = await this.db.select().from(researchReviews).where(eq(researchReviews.id, id)).limit(1);
    return row ? this.mapReview(row) : null;
  }

  async listByProject(projectId: string): Promise<ResearchReviewRecord[]> {
    const rows = await this.db
      .select()
      .from(researchReviews)
      .where(eq(researchReviews.projectId, projectId))
      .orderBy(desc(researchReviews.createdAt));

    return rows.map((row) => this.mapReview(row));
  }

  private async tryGenerateLLMReview(input: {
    projectName: string;
    researchGoal: string;
    totalRuns: number;
    completedRuns: number;
    failedRuns: number;
    avgAccuracy?: number;
    avgLoss?: number;
    experimentNames: string[];
    fallback: { review: PaperReview; retrospective: Retrospective };
  }): Promise<{ review: PaperReview; retrospective: Retrospective }> {
    const config = getConfig();
    if (!config.llm.apiKey) {
      return input.fallback;
    }

    try {
      const client = new OpenAI({ apiKey: config.llm.apiKey, baseURL: config.llm.baseUrl || undefined });
      const response = await client.chat.completions.create({
        model: config.llm.model,
        max_tokens: 1600,
        temperature: 0.2,
        messages: [
          {
            role: 'system',
            content: 'You are an academic reviewer. Return strict JSON with keys: review, retrospective. review must include overallScore, novelty, soundness, reproducibility, clarity, decision, strengths, weaknesses, suggestions. retrospective must include summary, whatWorked, whatDidNotWork, actionItems(array of {action,priority,owner?}).',
          },
          {
            role: 'user',
            content: JSON.stringify({
              projectName: input.projectName,
              researchGoal: input.researchGoal,
              totalRuns: input.totalRuns,
              completedRuns: input.completedRuns,
              failedRuns: input.failedRuns,
              avgAccuracy: input.avgAccuracy,
              avgLoss: input.avgLoss,
              experimentNames: input.experimentNames,
            }),
          },
        ],
      });

      const content: unknown = response.choices?.[0]?.message?.content;
      if (!content) {
        return input.fallback;
      }

      const text = typeof content === 'string'
        ? content
        : Array.isArray(content)
          ? content.map((c: any) => (typeof c === 'string' ? c : c?.text || '')).join('\n')
          : '';

      const match = text.match(/```(?:json)?\s*([\s\S]*?)```/);
      const jsonText = match ? match[1] : text;
      const parsed = JSON.parse(jsonText);

      if (!parsed?.review || !parsed?.retrospective) {
        return input.fallback;
      }

      return {
        review: parsed.review as PaperReview,
        retrospective: parsed.retrospective as Retrospective,
      };
    } catch (error) {
      logger.warn({ error }, 'LLM review generation failed, using fallback');
      return input.fallback;
    }
  }

  private generateFallbackReview(input: {
    projectName: string;
    researchGoal: string;
    totalRuns: number;
    completedRuns: number;
    failedRuns: number;
    avgAccuracy?: number;
    avgLoss?: number;
    experimentNames: string[];
  }): { review: PaperReview; retrospective: Retrospective } {
    const completionRatio = input.totalRuns > 0 ? input.completedRuns / input.totalRuns : 0;
    const overall = Math.min(10, Math.max(1, Math.round((completionRatio * 6 + (input.avgAccuracy || 0) * 4) * 10) / 10));

    const review: PaperReview = {
      overallScore: overall,
      novelty: Math.max(1, Math.min(10, Math.round((6 + completionRatio * 3) * 10) / 10)),
      soundness: Math.max(1, Math.min(10, Math.round((5 + completionRatio * 4) * 10) / 10)),
      reproducibility: Math.max(1, Math.min(10, Math.round((6 + (input.completedRuns > 0 ? 2 : 0) - (input.failedRuns > 0 ? 1 : 0)) * 10) / 10)),
      clarity: 7,
      decision: overall >= 8 ? 'accept' : overall >= 7 ? 'weak_accept' : overall >= 6 ? 'borderline' : overall >= 5 ? 'weak_reject' : 'reject',
      strengths: [
        '具备端到端实验编排能力（计划、执行、分析、报告）',
        '实验结果可追踪，支持告警与状态回写',
        '具备人类介入闸门，决策路径透明',
      ],
      weaknesses: [
        '当前评估主要来自 CPU 小规模验证，外推到大规模 GPU 尚需验证',
        '部分运行指标仍依赖训练脚本显式上报',
      ],
      suggestions: [
        '增加更严格的统计显著性检验与置信区间报告',
        '补充更多数据集和任务类型的跨域验证',
        '在失败样本上执行更细粒度错误归因分析',
      ],
    };

    const retrospective: Retrospective = {
      summary: `${input.projectName} 已形成从计划到报告的闭环流程，当前重点是提升实验外部有效性。`,
      whatWorked: [
        '自动计划与实验结构化落地减少了手工配置负担',
        '运行状态与告警机制提升了问题发现速度',
        '人工闸门在关键决策点提供了方向校正能力',
      ],
      whatDidNotWork: [
        '少量运行失败暴露出环境与脚本兼容性问题',
        '部分指标覆盖不足，难以全面支持审稿结论',
      ],
      actionItems: [
        {
          action: '扩展到至少 2 个额外数据集并复现实验',
          priority: 'high',
          owner: 'research-team',
        },
        {
          action: '完善训练脚本指标上报与 artifact 归档规范',
          priority: 'high',
          owner: 'platform-team',
        },
        {
          action: '对关键结论补充消融实验与失败案例剖析',
          priority: 'medium',
          owner: 'research-team',
        },
      ],
    };

    return { review, retrospective };
  }

  private averageMetric(runs: Run[], metricName: string): number | undefined {
    const values = runs
      .map((run) => run.finalMetrics?.[metricName] ?? run.metrics?.[metricName])
      .filter((v): v is number => typeof v === 'number' && Number.isFinite(v));

    if (values.length === 0) {
      return undefined;
    }

    const sum = values.reduce((acc, v) => acc + v, 0);
    return Number((sum / values.length).toFixed(6));
  }

  private mapReview(row: typeof researchReviews.$inferSelect): ResearchReviewRecord {
    return {
      id: row.id,
      projectId: row.projectId,
      workflowId: row.workflowId || undefined,
      reportId: row.reportId || undefined,
      title: row.title,
      review: row.review as PaperReview,
      retrospective: row.retrospective as Retrospective,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
}

export const reviewService = new ReviewService();
