/**
 * 实验服务
 * 管理实验的 CRUD 操作
 */

import { eq, desc, and, inArray } from 'drizzle-orm';
import { getDatabase } from '../../db/connection';
import { experiments } from '../../models/schema';
import { generateId } from '../../utils/id';
import { createLogger } from '../../utils/logger';
import type { Experiment, ExperimentStatus, ExperimentConfig } from '../../models/types';

const logger = createLogger('service:experiment');

export interface CreateExperimentInput {
  groupId: string;
  name: string;
  description?: string;
  config: ExperimentConfig;
  variables?: Record<string, unknown>;
  controlVariables?: Record<string, unknown>;
  priority?: number;
  codeSnapshot?: string;
}

export interface UpdateExperimentInput {
  name?: string;
  description?: string;
  config?: ExperimentConfig;
  variables?: Record<string, unknown>;
  controlVariables?: Record<string, unknown>;
  status?: ExperimentStatus;
  priority?: number;
  codeSnapshot?: string;
}

export interface ListExperimentsOptions {
  groupId?: string;
  status?: ExperimentStatus | ExperimentStatus[];
  limit?: number;
  offset?: number;
}

export class ExperimentService {
  private db = getDatabase();

  /**
   * 创建实验
   */
  async create(input: CreateExperimentInput): Promise<Experiment> {
    const id = generateId();
    const now = new Date();

    const [result] = await this.db
      .insert(experiments)
      .values({
        id,
        groupId: input.groupId,
        name: input.name,
        description: input.description || null,
        config: input.config,
        variables: input.variables || {},
        controlVariables: input.controlVariables || {},
        status: 'pending',
        priority: input.priority || 0,
        codeSnapshot: input.codeSnapshot || null,
        createdAt: now,
        updatedAt: now,
      })
      .returning();

    logger.info({ experimentId: id, name: input.name }, 'Experiment created');

    return this.mapToExperiment(result);
  }

  /**
   * 批量创建实验 (用于实验矩阵)
   */
  async createBatch(inputs: CreateExperimentInput[]): Promise<Experiment[]> {
    const now = new Date();
    const values = inputs.map((input) => ({
      id: generateId(),
      groupId: input.groupId,
      name: input.name,
      description: input.description || null,
      config: input.config,
      variables: input.variables || {},
      controlVariables: input.controlVariables || {},
      status: 'pending' as const,
      priority: input.priority || 0,
      codeSnapshot: input.codeSnapshot || null,
      createdAt: now,
      updatedAt: now,
    }));

    const results = await this.db
      .insert(experiments)
      .values(values)
      .returning();

    logger.info({ count: results.length }, 'Batch experiments created');

    return results.map((r) => this.mapToExperiment(r));
  }

  /**
   * 根据 ID 获取实验
   */
  async getById(id: string): Promise<Experiment | null> {
    const [result] = await this.db
      .select()
      .from(experiments)
      .where(eq(experiments.id, id))
      .limit(1);

    if (!result) {
      return null;
    }

    return this.mapToExperiment(result);
  }

  /**
   * 获取实验列表
   */
  async list(options: ListExperimentsOptions = {}): Promise<{ data: Experiment[]; total: number }> {
    const conditions = [];

    if (options.groupId) {
      conditions.push(eq(experiments.groupId, options.groupId));
    }

    if (options.status) {
      if (Array.isArray(options.status)) {
        conditions.push(inArray(experiments.status, options.status));
      } else {
        conditions.push(eq(experiments.status, options.status));
      }
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    // 获取总数
    const countResult = await this.db
      .select()
      .from(experiments)
      .where(whereClause);
    const total = countResult.length;

    // 获取分页数据
    let query = this.db
      .select()
      .from(experiments)
      .where(whereClause)
      .orderBy(desc(experiments.priority), desc(experiments.updatedAt));

    if (options.limit) {
      query = query.limit(options.limit) as typeof query;
    }
    if (options.offset) {
      query = query.offset(options.offset) as typeof query;
    }

    const results = await query;

    return {
      data: results.map((r) => this.mapToExperiment(r)),
      total,
    };
  }

  /**
   * 更新实验
   */
  async update(id: string, input: UpdateExperimentInput): Promise<Experiment | null> {
    const updateData: Record<string, unknown> = {
      updatedAt: new Date(),
    };

    if (input.name !== undefined) updateData.name = input.name;
    if (input.description !== undefined) updateData.description = input.description;
    if (input.config !== undefined) updateData.config = input.config;
    if (input.variables !== undefined) updateData.variables = input.variables;
    if (input.controlVariables !== undefined) updateData.controlVariables = input.controlVariables;
    if (input.status !== undefined) updateData.status = input.status;
    if (input.priority !== undefined) updateData.priority = input.priority;
    if (input.codeSnapshot !== undefined) updateData.codeSnapshot = input.codeSnapshot;

    const [result] = await this.db
      .update(experiments)
      .set(updateData)
      .where(eq(experiments.id, id))
      .returning();

    if (!result) {
      return null;
    }

    logger.info({ experimentId: id }, 'Experiment updated');

    return this.mapToExperiment(result);
  }

  /**
   * 删除实验
   */
  async delete(id: string): Promise<boolean> {
    const result = await this.db
      .delete(experiments)
      .where(eq(experiments.id, id))
      .returning({ id: experiments.id });

    if (result.length === 0) {
      return false;
    }

    logger.info({ experimentId: id }, 'Experiment deleted');
    return true;
  }

  /**
   * 更新实验状态
   */
  async updateStatus(id: string, status: ExperimentStatus): Promise<Experiment | null> {
    return this.update(id, { status });
  }

  /**
   * 映射数据库结果到 Experiment 类型
   */
  private mapToExperiment(row: typeof experiments.$inferSelect): Experiment {
    return {
      id: row.id,
      groupId: row.groupId,
      name: row.name,
      description: row.description || undefined,
      config: row.config as ExperimentConfig,
      variables: row.variables as Record<string, unknown>,
      controlVariables: row.controlVariables as Record<string, unknown>,
      status: row.status as ExperimentStatus,
      priority: row.priority,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      codeSnapshot: row.codeSnapshot || undefined,
    };
  }
}

// 单例导出
export const experimentService = new ExperimentService();
