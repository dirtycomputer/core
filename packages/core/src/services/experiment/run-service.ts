/**
 * 运行实例服务
 * 管理实验运行的 CRUD 操作
 */

import { eq, desc, and, inArray, sql } from 'drizzle-orm';
import { getDatabase } from '../../db/connection';
import { runs, metricSeries } from '../../models/schema';
import { generateId } from '../../utils/id';
import { createLogger } from '../../utils/logger';
import type { Run, RunStatus, RunMetrics } from '../../models/types';

const logger = createLogger('service:run');

export interface CreateRunInput {
  experimentId: string;
  clusterType: 'slurm' | 'kubernetes' | 'ssh';
  clusterJobId?: string;
  logPath?: string;
}

export interface UpdateRunInput {
  clusterJobId?: string;
  status?: RunStatus;
  startTime?: Date;
  endTime?: Date;
  metrics?: RunMetrics;
  finalMetrics?: RunMetrics;
  checkpointPath?: string;
  logPath?: string;
  errorMessage?: string;
}

export interface ListRunsOptions {
  experimentId?: string;
  status?: RunStatus | RunStatus[];
  limit?: number;
  offset?: number;
}

export interface LogMetricInput {
  runId: string;
  name: string;
  step: number;
  value: number | Record<string, unknown>;
}

export class RunService {
  private db = getDatabase();

  /**
   * 创建运行实例
   */
  async create(input: CreateRunInput): Promise<Run> {
    const id = generateId();
    const now = new Date();

    // 获取当前实验的最大 attempt 数
    const [maxAttempt] = await this.db
      .select({ max: sql<number>`COALESCE(MAX(attempt), 0)` })
      .from(runs)
      .where(eq(runs.experimentId, input.experimentId));

    const attempt = (maxAttempt?.max || 0) + 1;

    const [result] = await this.db
      .insert(runs)
      .values({
        id,
        experimentId: input.experimentId,
        attempt,
        clusterType: input.clusterType,
        clusterJobId: input.clusterJobId || null,
        status: 'pending',
        metrics: {},
        logPath: input.logPath || null,
        createdAt: now,
        updatedAt: now,
      })
      .returning();

    logger.info({ runId: id, experimentId: input.experimentId, attempt }, 'Run created');

    return this.mapToRun(result);
  }

  /**
   * 根据 ID 获取运行实例
   */
  async getById(id: string): Promise<Run | null> {
    const [result] = await this.db
      .select()
      .from(runs)
      .where(eq(runs.id, id))
      .limit(1);

    if (!result) {
      return null;
    }

    return this.mapToRun(result);
  }

  /**
   * 根据集群任务 ID 获取运行实例
   */
  async getByClusterJobId(clusterJobId: string): Promise<Run | null> {
    const [result] = await this.db
      .select()
      .from(runs)
      .where(eq(runs.clusterJobId, clusterJobId))
      .limit(1);

    if (!result) {
      return null;
    }

    return this.mapToRun(result);
  }

  /**
   * 获取运行实例列表
   */
  async list(options: ListRunsOptions = {}): Promise<{ data: Run[]; total: number }> {
    const conditions = [];

    if (options.experimentId) {
      conditions.push(eq(runs.experimentId, options.experimentId));
    }

    if (options.status) {
      if (Array.isArray(options.status)) {
        conditions.push(inArray(runs.status, options.status));
      } else {
        conditions.push(eq(runs.status, options.status));
      }
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    // 获取总数
    const countResult = await this.db
      .select()
      .from(runs)
      .where(whereClause);
    const total = countResult.length;

    // 获取分页数据
    let query = this.db
      .select()
      .from(runs)
      .where(whereClause)
      .orderBy(desc(runs.createdAt));

    if (options.limit) {
      query = query.limit(options.limit) as typeof query;
    }
    if (options.offset) {
      query = query.offset(options.offset) as typeof query;
    }

    const results = await query;

    return {
      data: results.map((r) => this.mapToRun(r)),
      total,
    };
  }

  /**
   * 获取活跃的运行实例
   */
  async getActiveRuns(): Promise<Run[]> {
    const results = await this.db
      .select()
      .from(runs)
      .where(inArray(runs.status, ['pending', 'queued', 'running']))
      .orderBy(desc(runs.createdAt));

    return results.map((r) => this.mapToRun(r));
  }

  /**
   * 更新运行实例
   */
  async update(id: string, input: UpdateRunInput): Promise<Run | null> {
    const updateData: Record<string, unknown> = {
      updatedAt: new Date(),
    };

    if (input.clusterJobId !== undefined) updateData.clusterJobId = input.clusterJobId;
    if (input.status !== undefined) updateData.status = input.status;
    if (input.startTime !== undefined) updateData.startTime = input.startTime;
    if (input.endTime !== undefined) updateData.endTime = input.endTime;
    if (input.metrics !== undefined) updateData.metrics = input.metrics;
    if (input.finalMetrics !== undefined) updateData.finalMetrics = input.finalMetrics;
    if (input.checkpointPath !== undefined) updateData.checkpointPath = input.checkpointPath;
    if (input.logPath !== undefined) updateData.logPath = input.logPath;
    if (input.errorMessage !== undefined) updateData.errorMessage = input.errorMessage;

    const [result] = await this.db
      .update(runs)
      .set(updateData)
      .where(eq(runs.id, id))
      .returning();

    if (!result) {
      return null;
    }

    logger.info({ runId: id, status: input.status }, 'Run updated');

    return this.mapToRun(result);
  }

  /**
   * 更新运行状态
   */
  async updateStatus(id: string, status: RunStatus, errorMessage?: string): Promise<Run | null> {
    const input: UpdateRunInput = { status };

    if (status === 'running') {
      input.startTime = new Date();
    } else if (['completed', 'failed', 'cancelled', 'timeout'].includes(status)) {
      input.endTime = new Date();
    }

    if (errorMessage) {
      input.errorMessage = errorMessage;
    }

    return this.update(id, input);
  }

  /**
   * 记录指标
   */
  async logMetric(input: LogMetricInput): Promise<void> {
    const id = generateId();

    await this.db.insert(metricSeries).values({
      id,
      runId: input.runId,
      name: input.name,
      step: input.step,
      value: typeof input.value === 'number' ? { value: input.value } : input.value,
      timestamp: new Date(),
    });

    // 同时更新 run 的 metrics 字段
    const [run] = await this.db
      .select({ metrics: runs.metrics })
      .from(runs)
      .where(eq(runs.id, input.runId))
      .limit(1);

    if (run) {
      const currentMetrics = run.metrics as Record<string, number>;
      const newValue = typeof input.value === 'number' ? input.value : (input.value as Record<string, number>).value;
      currentMetrics[input.name] = newValue;

      await this.db
        .update(runs)
        .set({ metrics: currentMetrics, updatedAt: new Date() })
        .where(eq(runs.id, input.runId));
    }
  }

  /**
   * 批量记录指标
   */
  async logMetrics(runId: string, metrics: Record<string, number>, step: number): Promise<void> {
    const now = new Date();
    const values = Object.entries(metrics).map(([name, value]) => ({
      id: generateId(),
      runId,
      name,
      step,
      value: { value },
      timestamp: now,
    }));

    if (values.length > 0) {
      await this.db.insert(metricSeries).values(values);
    }

    // 更新 run 的 metrics 字段
    const [run] = await this.db
      .select({ metrics: runs.metrics })
      .from(runs)
      .where(eq(runs.id, runId))
      .limit(1);

    if (run) {
      const currentMetrics = { ...(run.metrics as Record<string, number>), ...metrics };
      await this.db
        .update(runs)
        .set({ metrics: currentMetrics, updatedAt: now })
        .where(eq(runs.id, runId));
    }
  }

  /**
   * 获取指标时序数据
   */
  async getMetricSeries(runId: string, metricName?: string): Promise<Array<{ name: string; step: number; value: number; timestamp: Date }>> {
    const conditions = [eq(metricSeries.runId, runId)];

    if (metricName) {
      conditions.push(eq(metricSeries.name, metricName));
    }

    const results = await this.db
      .select()
      .from(metricSeries)
      .where(and(...conditions))
      .orderBy(metricSeries.step);

    return results.map((r) => ({
      name: r.name,
      step: r.step,
      value: (r.value as Record<string, number>).value,
      timestamp: r.timestamp,
    }));
  }

  /**
   * 删除运行实例
   */
  async delete(id: string): Promise<boolean> {
    const result = await this.db
      .delete(runs)
      .where(eq(runs.id, id))
      .returning({ id: runs.id });

    if (result.length === 0) {
      return false;
    }

    logger.info({ runId: id }, 'Run deleted');
    return true;
  }

  /**
   * 映射数据库结果到 Run 类型
   */
  private mapToRun(row: typeof runs.$inferSelect): Run {
    return {
      id: row.id,
      experimentId: row.experimentId,
      attempt: row.attempt,
      clusterType: row.clusterType as 'slurm' | 'kubernetes' | 'ssh',
      clusterJobId: row.clusterJobId || undefined,
      status: row.status as RunStatus,
      startTime: row.startTime || undefined,
      endTime: row.endTime || undefined,
      metrics: row.metrics as RunMetrics,
      finalMetrics: row.finalMetrics as RunMetrics | undefined,
      checkpointPath: row.checkpointPath || undefined,
      logPath: row.logPath || undefined,
      errorMessage: row.errorMessage || undefined,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
}

// 单例导出
export const runService = new RunService();
