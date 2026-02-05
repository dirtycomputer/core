/**
 * 项目服务
 * 管理研究项目的 CRUD 操作
 */

import { eq, desc, and, like, inArray } from 'drizzle-orm';
import { getDatabase } from '../../db/connection';
import { projects } from '../../models/schema';
import { generateId } from '../../utils/id';
import { createLogger } from '../../utils/logger';
import type { Project, ProjectStatus, ProjectConstraints } from '../../models/types';

const logger = createLogger('service:project');

export interface CreateProjectInput {
  name: string;
  description?: string;
  researchGoal?: string;
  constraints?: ProjectConstraints;
  baselineMetrics?: Record<string, number>;
  tags?: string[];
  ownerId: string;
}

export interface UpdateProjectInput {
  name?: string;
  description?: string;
  researchGoal?: string;
  constraints?: ProjectConstraints;
  baselineMetrics?: Record<string, number>;
  status?: ProjectStatus;
  tags?: string[];
}

export interface ListProjectsOptions {
  ownerId?: string;
  status?: ProjectStatus | ProjectStatus[];
  search?: string;
  limit?: number;
  offset?: number;
}

export class ProjectService {
  private db = getDatabase();

  /**
   * 创建项目
   */
  async create(input: CreateProjectInput): Promise<Project> {
    const id = generateId();
    const now = new Date();

    const [result] = await this.db
      .insert(projects)
      .values({
        id,
        name: input.name,
        description: input.description || '',
        researchGoal: input.researchGoal || '',
        constraints: input.constraints || {},
        baselineMetrics: input.baselineMetrics || {},
        status: 'planning',
        tags: input.tags || [],
        ownerId: input.ownerId,
        createdAt: now,
        updatedAt: now,
      })
      .returning();

    logger.info({ projectId: id, name: input.name }, 'Project created');

    return this.mapToProject(result);
  }

  /**
   * 根据 ID 获取项目
   */
  async getById(id: string): Promise<Project | null> {
    const [result] = await this.db
      .select()
      .from(projects)
      .where(eq(projects.id, id))
      .limit(1);

    if (!result) {
      return null;
    }

    return this.mapToProject(result);
  }

  /**
   * 获取项目列表
   */
  async list(options: ListProjectsOptions = {}): Promise<{ data: Project[]; total: number }> {
    const conditions = [];

    if (options.ownerId) {
      conditions.push(eq(projects.ownerId, options.ownerId));
    }

    if (options.status) {
      if (Array.isArray(options.status)) {
        conditions.push(inArray(projects.status, options.status));
      } else {
        conditions.push(eq(projects.status, options.status));
      }
    }

    if (options.search) {
      conditions.push(like(projects.name, `%${options.search}%`));
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    // 获取总数
    const countResult = await this.db
      .select()
      .from(projects)
      .where(whereClause);
    const total = countResult.length;

    // 获取分页数据
    let query = this.db
      .select()
      .from(projects)
      .where(whereClause)
      .orderBy(desc(projects.updatedAt));

    if (options.limit) {
      query = query.limit(options.limit) as typeof query;
    }
    if (options.offset) {
      query = query.offset(options.offset) as typeof query;
    }

    const results = await query;

    return {
      data: results.map((r) => this.mapToProject(r)),
      total,
    };
  }

  /**
   * 更新项目
   */
  async update(id: string, input: UpdateProjectInput): Promise<Project | null> {
    const updateData: Record<string, unknown> = {
      updatedAt: new Date(),
    };

    if (input.name !== undefined) updateData.name = input.name;
    if (input.description !== undefined) updateData.description = input.description;
    if (input.researchGoal !== undefined) updateData.researchGoal = input.researchGoal;
    if (input.constraints !== undefined) updateData.constraints = input.constraints;
    if (input.baselineMetrics !== undefined) updateData.baselineMetrics = input.baselineMetrics;
    if (input.status !== undefined) updateData.status = input.status;
    if (input.tags !== undefined) updateData.tags = input.tags;

    const [result] = await this.db
      .update(projects)
      .set(updateData)
      .where(eq(projects.id, id))
      .returning();

    if (!result) {
      return null;
    }

    logger.info({ projectId: id }, 'Project updated');

    return this.mapToProject(result);
  }

  /**
   * 删除项目
   */
  async delete(id: string): Promise<boolean> {
    const result = await this.db
      .delete(projects)
      .where(eq(projects.id, id))
      .returning({ id: projects.id });

    if (result.length === 0) {
      return false;
    }

    logger.info({ projectId: id }, 'Project deleted');
    return true;
  }

  /**
   * 更新项目状态
   */
  async updateStatus(id: string, status: ProjectStatus): Promise<Project | null> {
    return this.update(id, { status });
  }

  /**
   * 映射数据库结果到 Project 类型
   */
  private mapToProject(row: typeof projects.$inferSelect): Project {
    return {
      id: row.id,
      name: row.name,
      description: row.description,
      researchGoal: row.researchGoal,
      constraints: row.constraints as ProjectConstraints,
      baselineMetrics: row.baselineMetrics as Record<string, number>,
      status: row.status as ProjectStatus,
      tags: row.tags as string[],
      ownerId: row.ownerId,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
}

// 单例导出
export const projectService = new ProjectService();
