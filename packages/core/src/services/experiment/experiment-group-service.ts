/**
 * 实验组服务
 * 管理实验组的 CRUD 操作
 */

import { eq, desc, and, inArray } from 'drizzle-orm';
import { getDatabase } from '../../db/connection';
import { experimentGroups } from '../../models/schema';
import { generateId } from '../../utils/id';
import { createLogger } from '../../utils/logger';
import type { ExperimentGroup, ExperimentGroupType, ExperimentGroupStatus } from '../../models/types';

const logger = createLogger('service:experiment-group');

export interface CreateExperimentGroupInput {
  projectId: string;
  name: string;
  type?: ExperimentGroupType;
  hypothesis?: string;
  expectedImpact?: string;
  verificationMethod?: string;
  priority?: number;
}

export interface UpdateExperimentGroupInput {
  name?: string;
  type?: ExperimentGroupType;
  hypothesis?: string;
  expectedImpact?: string;
  verificationMethod?: string;
  status?: ExperimentGroupStatus;
  priority?: number;
}

export interface ListExperimentGroupsOptions {
  projectId?: string;
  status?: ExperimentGroupStatus | ExperimentGroupStatus[];
  type?: ExperimentGroupType;
  limit?: number;
  offset?: number;
}

export class ExperimentGroupService {
  private db = getDatabase();

  /**
   * 创建实验组
   */
  async create(input: CreateExperimentGroupInput): Promise<ExperimentGroup> {
    const id = generateId();
    const now = new Date();

    const [result] = await this.db
      .insert(experimentGroups)
      .values({
        id,
        projectId: input.projectId,
        name: input.name,
        type: input.type || 'improvement',
        hypothesis: input.hypothesis || '',
        expectedImpact: input.expectedImpact || '',
        verificationMethod: input.verificationMethod || '',
        status: 'draft',
        priority: input.priority || 0,
        createdAt: now,
        updatedAt: now,
      })
      .returning();

    logger.info({ groupId: id, name: input.name }, 'Experiment group created');

    return this.mapToExperimentGroup(result);
  }

  /**
   * 根据 ID 获取实验组
   */
  async getById(id: string): Promise<ExperimentGroup | null> {
    const [result] = await this.db
      .select()
      .from(experimentGroups)
      .where(eq(experimentGroups.id, id))
      .limit(1);

    if (!result) {
      return null;
    }

    return this.mapToExperimentGroup(result);
  }

  /**
   * 获取实验组列表
   */
  async list(options: ListExperimentGroupsOptions = {}): Promise<{ data: ExperimentGroup[]; total: number }> {
    const conditions = [];

    if (options.projectId) {
      conditions.push(eq(experimentGroups.projectId, options.projectId));
    }

    if (options.status) {
      if (Array.isArray(options.status)) {
        conditions.push(inArray(experimentGroups.status, options.status));
      } else {
        conditions.push(eq(experimentGroups.status, options.status));
      }
    }

    if (options.type) {
      conditions.push(eq(experimentGroups.type, options.type));
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    // 获取总数
    const countResult = await this.db
      .select()
      .from(experimentGroups)
      .where(whereClause);
    const total = countResult.length;

    // 获取分页数据
    let query = this.db
      .select()
      .from(experimentGroups)
      .where(whereClause)
      .orderBy(desc(experimentGroups.priority), desc(experimentGroups.updatedAt));

    if (options.limit) {
      query = query.limit(options.limit) as typeof query;
    }
    if (options.offset) {
      query = query.offset(options.offset) as typeof query;
    }

    const results = await query;

    return {
      data: results.map((r) => this.mapToExperimentGroup(r)),
      total,
    };
  }

  /**
   * 更新实验组
   */
  async update(id: string, input: UpdateExperimentGroupInput): Promise<ExperimentGroup | null> {
    const updateData: Record<string, unknown> = {
      updatedAt: new Date(),
    };

    if (input.name !== undefined) updateData.name = input.name;
    if (input.type !== undefined) updateData.type = input.type;
    if (input.hypothesis !== undefined) updateData.hypothesis = input.hypothesis;
    if (input.expectedImpact !== undefined) updateData.expectedImpact = input.expectedImpact;
    if (input.verificationMethod !== undefined) updateData.verificationMethod = input.verificationMethod;
    if (input.status !== undefined) updateData.status = input.status;
    if (input.priority !== undefined) updateData.priority = input.priority;

    const [result] = await this.db
      .update(experimentGroups)
      .set(updateData)
      .where(eq(experimentGroups.id, id))
      .returning();

    if (!result) {
      return null;
    }

    logger.info({ groupId: id }, 'Experiment group updated');

    return this.mapToExperimentGroup(result);
  }

  /**
   * 删除实验组
   */
  async delete(id: string): Promise<boolean> {
    const result = await this.db
      .delete(experimentGroups)
      .where(eq(experimentGroups.id, id))
      .returning({ id: experimentGroups.id });

    if (result.length === 0) {
      return false;
    }

    logger.info({ groupId: id }, 'Experiment group deleted');
    return true;
  }

  /**
   * 审批实验组
   */
  async approve(id: string, approverId: string): Promise<ExperimentGroup | null> {
    const now = new Date();

    const [result] = await this.db
      .update(experimentGroups)
      .set({
        status: 'approved',
        approvedAt: now,
        approvedBy: approverId,
        updatedAt: now,
      })
      .where(eq(experimentGroups.id, id))
      .returning();

    if (!result) {
      return null;
    }

    logger.info({ groupId: id, approverId }, 'Experiment group approved');

    return this.mapToExperimentGroup(result);
  }

  /**
   * 映射数据库结果到 ExperimentGroup 类型
   */
  private mapToExperimentGroup(row: typeof experimentGroups.$inferSelect): ExperimentGroup {
    return {
      id: row.id,
      projectId: row.projectId,
      name: row.name,
      type: row.type as ExperimentGroupType,
      hypothesis: row.hypothesis,
      expectedImpact: row.expectedImpact,
      verificationMethod: row.verificationMethod,
      status: row.status as ExperimentGroupStatus,
      priority: row.priority,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      approvedAt: row.approvedAt || undefined,
      approvedBy: row.approvedBy || undefined,
    };
  }
}

// 单例导出
export const experimentGroupService = new ExperimentGroupService();
